import { getPositions, PositionData } from "../bingx/account.js";
import {
  placeStopLossOrder,
  cancelAllOpenOrders,
  getAllOrders,
  getLatestPositionHistory,
  SwapOrder,
  ClosedPositionRecord,
} from "../bingx/trade.js";
import { getPremiumIndex } from "../bingx/market.js";
import { config } from "../config.js";
import { storage, ManagedPosition } from "../utils/storage.js";
import { logger } from "../utils/logger.js";
import {
  notifyTradeClosed,
  notifyBreakEvenActivated,
  notifyTrailingActivated,
} from "../telegram/notifier.js";

let isMonitoring = false;

export async function checkPositions(): Promise<void> {
  if (isMonitoring) return;
  isMonitoring = true;

  try {
    const livePositions = await getPositions(undefined, true);
    const livePositionMap = new Map<string, PositionData>();
    for (const pos of livePositions) {
      livePositionMap.set(pos.symbol, pos);
    }

    const managedMap = storage.getManagedPositions();

    // 1. Deteksi Posisi yang Sudah Tertutup (TP / SL / Manual Close)
    for (const [symbol, managed] of Object.entries(managedMap)) {
      if (!livePositionMap.has(symbol)) {
        const orderStartTime = managed.openedAt > 0 ? managed.openedAt - 60000 : undefined;
        const closeSide = managed.positionSide === "LONG" ? "SELL" : "BUY";

        let filledCloseOrder: SwapOrder | undefined;
        let closedPosRecord: ClosedPositionRecord | null = null;

        // Polling loop: Coba hingga 3 kali dengan jeda 1.5 detik
        // Memberikan waktu bagi server BingX untuk memproses & mempublikasikan riwayat resmi
        for (let attempt = 1; attempt <= 3; attempt++) {
          const recentOrders = await getAllOrders(symbol, 50, orderStartTime);
          filledCloseOrder = recentOrders
            .filter(
              (o) =>
                o.status === "FILLED" &&
                (o.side === closeSide || o.reduceOnly === true) &&
                (o.positionSide === managed.positionSide || o.positionSide === "BOTH") &&
                (o.time >= (managed.openedAt - 30000) || o.updateTime >= (managed.openedAt - 30000))
            )
            .sort((a, b) => (b.updateTime || b.time || 0) - (a.updateTime || a.time || 0))[0];

          closedPosRecord = await getLatestPositionHistory(symbol);
          if (
            closedPosRecord &&
            (closedPosRecord.positionSide !== managed.positionSide ||
              closedPosRecord.updateTime < (managed.openedAt - 30000))
          ) {
            closedPosRecord = null;
          }

          if (filledCloseOrder || closedPosRecord) {
            break;
          }

          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }

        // SOLUSI JIKA 3 KALI POLLING TETAP BELUM MENEMUKAN DATA RESMI BINGX:
        // Jangan menebak atau menggunakan fallback yang salah!
        if (!filledCloseOrder && !closedPosRecord) {
          const currentAttempts = (managed.closePendingAttempts || 0) + 1;
          managed.closePendingAttempts = currentAttempts;

          // Grace period untuk posisi baru (<15s)
          if (Date.now() - managed.openedAt < 15000) {
            logger.debug(`Posisi ${symbol} baru dibuka (${Math.round((Date.now() - managed.openedAt) / 1000)}s lalu), menunggu propagasi BingX...`);
            continue;
          }

          // Tunda ke siklus monitor berikutnya (maksimal 5 siklus = ~75 detik)
          if (currentAttempts < 5) {
            logger.warn(
              `Posisi ${symbol} tidak ditemukan di live positions, namun riwayat resmi belum siap di BingX (siklus ${currentAttempts}/5). Menunda ke siklus monitor berikutnya...`
            );
            storage.saveManagedPosition(managed);
            continue;
          }

          // Jika setelah 5 siklus berturut-turut tetap tidak ada riwayat resmi dari bursa:
          logger.warn(
            `Posisi ${symbol} tertutup di BingX tanpa riwayat order resmi setelah 5 siklus. Menyelesaikan sebagai MANUAL_CLOSE dengan harga pasar saat ini.`
          );
        }

        logger.trade(`Posisi ${symbol} terdeteksi sudah tertutup di BingX.`);

        // Batalkan order sisa jika ada
        await cancelAllOpenOrders(symbol);

        let exitPrice = managed.entryPrice;
        let pnlUsdt = 0;
        let pnlPercent = 0;
        let reason: "TAKE_PROFIT" | "STOP_LOSS" | "BREAK_EVEN" | "TRAILING_TP" | "MANUAL_CLOSE" = "MANUAL_CLOSE";

        // Prioritas 1: Buku besar resmi positionHistory BingX
        if (closedPosRecord) {
          const recClosePrice = parseFloat(closedPosRecord.avgClosePrice);
          if (recClosePrice > 0) exitPrice = recClosePrice;
          const recRealisedProfit = parseFloat(closedPosRecord.realisedProfit);
          if (!isNaN(recRealisedProfit)) pnlUsdt = recRealisedProfit;
        } else if (filledCloseOrder) {
          // Prioritas 2: Order penutupan terisi (filled close order)
          const filledAvgPrice = parseFloat(filledCloseOrder.avgPrice) || 0;
          if (filledAvgPrice > 0) exitPrice = filledAvgPrice;

          const parsedProfit = parseFloat(filledCloseOrder.profit);
          if (!isNaN(parsedProfit) && filledCloseOrder.profit !== "") {
            pnlUsdt = parsedProfit;
          } else {
            pnlUsdt = managed.positionSide === "LONG"
              ? (exitPrice - managed.entryPrice) * managed.quantity
              : (managed.entryPrice - exitPrice) * managed.quantity;
          }
        } else {
          // Kasus darurat setelah 5 siklus: ambil Mark Price pasar real-time terkini
          try {
            const premium = await getPremiumIndex(symbol);
            const markPrice = parseFloat(premium[0]?.markPrice || "0");
            if (markPrice > 0) exitPrice = markPrice;
          } catch {
            exitPrice = managed.entryPrice;
          }
          pnlUsdt = managed.positionSide === "LONG"
            ? (exitPrice - managed.entryPrice) * managed.quantity
            : (managed.entryPrice - exitPrice) * managed.quantity;
        }

        // Hitung persentase PnL
        const margin = (managed.entryPrice * managed.quantity) / (managed.leverage || 10);
        pnlPercent = margin > 0 ? (pnlUsdt / margin) * 100 : 0;
        const isWin = pnlUsdt >= 0;

        // Tentukan trigger penutupan berdasarkan jenis order sebenarnya
        if (filledCloseOrder) {
          if (filledCloseOrder.type === "STOP_MARKET" || filledCloseOrder.type === "STOP") {
            if (managed.isBreakEvenApplied && Math.abs(pnlPercent) < 2) {
              reason = "BREAK_EVEN";
            } else {
              reason = "STOP_LOSS";
            }
          } else if (
            filledCloseOrder.type === "TRAILING_STOP_MARKET" ||
            filledCloseOrder.type === "TRAILING_TP_SL"
          ) {
            reason = "TRAILING_TP";
          } else if (
            filledCloseOrder.type === "TAKE_PROFIT_MARKET" ||
            filledCloseOrder.type === "TAKE_PROFIT"
          ) {
            reason = "TAKE_PROFIT";
          } else {
            reason = isWin ? "TAKE_PROFIT" : "STOP_LOSS";
          }
        } else if (closedPosRecord) {
          if (managed.isTrailingActive && isWin) {
            reason = "TRAILING_TP";
          } else if (managed.isBreakEvenApplied && Math.abs(pnlPercent) < 2) {
            reason = "BREAK_EVEN";
          } else {
            reason = isWin ? "TAKE_PROFIT" : "STOP_LOSS";
          }
        } else {
          reason = "MANUAL_CLOSE";
        }

        // HANYA jika terkena Stop Loss riil, berikan masa cooldown
        if (reason === "STOP_LOSS" && !isWin) {
          storage.setCooldown(symbol, config.cooldownMinutesAfterLoss);
        }

        // Simpan ke riwayat jurnal
        storage.recordTrade({
          id: `${symbol}-${Date.now()}`,
          symbol,
          side: managed.positionSide,
          entryPrice: managed.entryPrice,
          exitPrice,
          quantity: managed.quantity,
          pnlUsdt,
          pnlPercent,
          reason,
          closedAt: Date.now(),
        });

        // Bersihkan tracking
        storage.removeManagedPosition(symbol);

        // Notifikasi Telegram
        await notifyTradeClosed({
          symbol,
          side: managed.positionSide,
          entryPrice: managed.entryPrice,
          exitPrice,
          pnlUsdt,
          pnlPercent,
          reason,
        });
      }
    }

    // 2. Monitoring Posisi yang Masih Aktif
    for (const [symbol, livePos] of livePositionMap.entries()) {
      const markPrice = parseFloat(livePos.markPrice) || parseFloat(livePos.avgPrice) || 0;
      const liqPrice = parseFloat(String(livePos.liquidationPrice)) || 0;
      const unPnl = parseFloat(livePos.unrealizedProfit) || 0;

      let managed = managedMap[symbol];

      // Jika posisi ini belum tercatat di managed map (misal buka manual di web), daftarkan
      if (!managed) {
        const entryPrice = parseFloat(livePos.avgPrice) || parseFloat(livePos.entryPrice) || markPrice;
        managed = {
          symbol,
          positionSide: (livePos.positionSide as "LONG" | "SHORT") || "LONG",
          entryPrice,
          quantity: Math.abs(parseFloat(livePos.positionAmt)),
          leverage: livePos.leverage || config.defaultLeverage,
          initialSl: 0,
          currentSl: 0,
          initialTp: 0,
          isBreakEvenApplied: false,
          highestPrice: markPrice,
          lowestPrice: markPrice,
          openedAt: Date.now(),
        };
        storage.saveManagedPosition(managed);
      } else {
        // Sinkronkan harga entry riil dari eksekusi bursa jika tersedia
        const realEntry = parseFloat(livePos.avgPrice) || parseFloat(livePos.entryPrice) || 0;
        if (realEntry > 0 && Math.abs(managed.entryPrice - realEntry) > 0.0001) {
          managed.entryPrice = realEntry;
        }
      }

      // Update harga tertinggi & terendah yang pernah dicapai
      if (markPrice > (managed.highestPrice || 0)) managed.highestPrice = markPrice;
      if (markPrice < (managed.lowestPrice || Infinity)) managed.lowestPrice = markPrice;
      if (managed.closePendingAttempts) managed.closePendingAttempts = 0;
      storage.saveManagedPosition(managed);

      // A. Cek Break-Even Trigger
      if (!managed.isBreakEvenApplied && managed.initialSl > 0) {
        const riskDistance = Math.abs(managed.entryPrice - managed.initialSl);

        if (managed.positionSide === "LONG") {
          const targetTrigger = managed.entryPrice + riskDistance * config.breakEvenTriggerR;
          if (markPrice >= targetTrigger) {
            logger.trade(`Mengaktifkan Break-Even Stop untuk ${symbol} (LONG) pada harga ${markPrice}`);
            try {
              // Pasang SL baru di harga Entry
              await placeStopLossOrder({
                symbol,
                positionSide: "LONG",
                quantity: managed.quantity,
                stopPrice: managed.entryPrice,
              });
              managed.isBreakEvenApplied = true;
              managed.currentSl = managed.entryPrice;
              storage.saveManagedPosition(managed);
              await notifyBreakEvenActivated(symbol, "LONG", managed.entryPrice);
            } catch (err) {
              logger.warn(`Gagal memindahkan SL ke Break-Even untuk ${symbol}:`, err);
            }
          }
        } else if (managed.positionSide === "SHORT") {
          const targetTrigger = managed.entryPrice - riskDistance * config.breakEvenTriggerR;
          if (markPrice <= targetTrigger) {
            logger.trade(`Mengaktifkan Break-Even Stop untuk ${symbol} (SHORT) pada harga ${markPrice}`);
            try {
              await placeStopLossOrder({
                symbol,
                positionSide: "SHORT",
                quantity: managed.quantity,
                stopPrice: managed.entryPrice,
              });
              managed.isBreakEvenApplied = true;
              managed.currentSl = managed.entryPrice;
              storage.saveManagedPosition(managed);
              await notifyBreakEvenActivated(symbol, "SHORT", managed.entryPrice);
            } catch (err) {
              logger.warn(`Gagal memindahkan SL ke Break-Even untuk ${symbol}:`, err);
            }
          }
        }
      }

      // B. Notifikasi saat Trailing Stop Mulai Aktif
      if (
        !managed.isTrailingActive &&
        managed.trailingActivationPrice &&
        managed.trailingActivationPrice > 0
      ) {
        const isTriggered =
          managed.positionSide === "LONG"
            ? markPrice >= managed.trailingActivationPrice
            : markPrice <= managed.trailingActivationPrice;

        if (isTriggered) {
          managed.isTrailingActive = true;
          storage.saveManagedPosition(managed);
          const cbPercent = ((managed.trailingCallbackRate || 0.01) * 100).toFixed(2);
          logger.trade(
            `Trailing Stop untuk ${symbol} (${managed.positionSide}) telah AKTIF di server BingX pada harga ${markPrice}`
          );
          await notifyTrailingActivated(
            symbol,
            managed.positionSide,
            managed.trailingActivationPrice,
            cbPercent
          );
        }
      }
    }
  } catch (err) {
    logger.debug("Error saat menjalankan position monitor:", err);
  } finally {
    isMonitoring = false;
  }
}
