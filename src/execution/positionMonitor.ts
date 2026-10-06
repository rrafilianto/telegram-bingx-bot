import { getPositions, PositionData } from "../bingx/account.js";
import {
  placeStopLossOrder,
  cancelAllOpenOrders,
  getAllOrders,
} from "../bingx/trade.js";
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
        // Ambil riwayat order terbaru dari BingX untuk memeriksa apakah memang ada order penutupan
        const recentOrders = await getAllOrders(symbol, 10);
        const closeSide = managed.positionSide === "LONG" ? "SELL" : "BUY";

        // Cari order penutupan yang berstatus FILLED setelah waktu pembukaan posisi
        const filledCloseOrder = recentOrders
          .filter(
            (o) =>
              o.status === "FILLED" &&
              (o.side === closeSide || o.reduceOnly === true) &&
              (o.positionSide === managed.positionSide || o.positionSide === "BOTH") &&
              (o.time >= (managed.openedAt - 5000) || o.updateTime >= (managed.openedAt - 5000))
          )
          .sort((a, b) => (b.updateTime || b.time || 0) - (a.updateTime || a.time || 0))[0];

        // Grace Period: Jika posisi baru dibuka dalam 15 detik terakhir dan tidak ada order penutupan riil,
        // ini adalah delay propagasi bursa. Jangan ditutup!
        if (!filledCloseOrder && Date.now() - managed.openedAt < 15000) {
          logger.debug(`Posisi ${symbol} baru dibuka (${Math.round((Date.now() - managed.openedAt) / 1000)}s lalu), menunggu propagasi BingX...`);
          continue;
        }

        logger.trade(`Posisi ${symbol} terdeteksi sudah tertutup di BingX.`);

        // Batalkan order sisa jika ada
        await cancelAllOpenOrders(symbol);

        // Ambil riwayat order terbaru dari BingX untuk mendapatkan eksekusi riil
        let exitPrice = managed.positionSide === "LONG"
          ? (managed.lowestPrice || managed.entryPrice)
          : (managed.highestPrice || managed.entryPrice);
        let pnlUsdt = 0;
        let pnlPercent = 0;
        let reason: "TAKE_PROFIT" | "STOP_LOSS" | "BREAK_EVEN" | "TRAILING_TP" = "TAKE_PROFIT";
        let isWin = false;

        if (filledCloseOrder) {
          const filledAvgPrice = parseFloat(filledCloseOrder.avgPrice) || 0;
          if (filledAvgPrice > 0) exitPrice = filledAvgPrice;

          // BingX menyertakan field profit langsung pada order penutupan
          const parsedProfit = parseFloat(filledCloseOrder.profit);
          if (!isNaN(parsedProfit) && filledCloseOrder.profit !== "") {
            pnlUsdt = parsedProfit;
          } else {
            if (managed.positionSide === "LONG") {
              pnlUsdt = (exitPrice - managed.entryPrice) * managed.quantity;
            } else {
              pnlUsdt = (managed.entryPrice - exitPrice) * managed.quantity;
            }
          }

          // Hitung persentase PnL
          const margin = (managed.entryPrice * managed.quantity) / (managed.leverage || 10);
          pnlPercent = margin > 0 ? (pnlUsdt / margin) * 100 : 0;

          isWin = pnlUsdt >= 0;

          // Tentukan trigger penutupan berdasarkan jenis order sebenarnya
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
        } else {
          // Fallback jika API riwayat tidak mengembalikan order
          if (managed.positionSide === "LONG") {
            pnlUsdt = (exitPrice - managed.entryPrice) * managed.quantity;
          } else {
            pnlUsdt = (managed.entryPrice - exitPrice) * managed.quantity;
          }
          const margin = (managed.entryPrice * managed.quantity) / (managed.leverage || 10);
          pnlPercent = margin > 0 ? (pnlUsdt / margin) * 100 : 0;
          isWin = pnlUsdt >= 0;
          reason = isWin
            ? managed.isBreakEvenApplied && Math.abs(pnlPercent) < 2
              ? "BREAK_EVEN"
              : "TAKE_PROFIT"
            : "STOP_LOSS";
        }

        // Jika terkena Stop Loss (Loss), berikan masa cooldown
        if (!isWin) {
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
      }

      // Update harga tertinggi & terendah yang pernah dicapai
      if (markPrice > (managed.highestPrice || 0)) managed.highestPrice = markPrice;
      if (markPrice < (managed.lowestPrice || Infinity)) managed.lowestPrice = markPrice;
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
