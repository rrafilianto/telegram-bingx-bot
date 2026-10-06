import {
  setLeverage,
  setMarginType,
  placeMarketOrder,
  placeTrailingStopOrder,
} from "../bingx/trade.js";
import { clearPositionsCache } from "../bingx/account.js";
import { TradeSignal } from "../analysis/strategy.js";
import { SizingResult } from "./riskManager.js";
import { config } from "../config.js";
import { storage } from "../utils/storage.js";
import { logger } from "../utils/logger.js";
import { notifyNewOrder } from "../telegram/notifier.js";

export async function executeTrade(
  signal: TradeSignal,
  sizing: SizingResult
): Promise<boolean> {
  try {
    logger.trade(
      `Mengeksekusi order [${signal.positionSide}] ${signal.symbol} Qty: ${sizing.formattedQuantity} Leverage: ${config.defaultLeverage}x`
    );

    // 1. Konfigurasi Leverage dan Margin Mode
    await setMarginType(signal.symbol, config.marginType);
    await setLeverage(signal.symbol, signal.positionSide, config.defaultLeverage);

    // 2. Pasang Market Order dengan Stop Loss Awal (Fixed TP dilepas)
    const orderRes = await placeMarketOrder({
      symbol: signal.symbol,
      side: signal.side,
      positionSide: signal.positionSide,
      quantity: sizing.formattedQuantity,
      stopLossPrice: sizing.formattedSl,
    });

    logger.success(
      `Order entry berhasil dipasang di BingX! OrderID: ${orderRes?.order?.orderId || "OK"}`
    );

    // 3. Pasang order Trailing Stop Market ke BingX (Trailing TP berbasis ATR)
    if (sizing.trailingActivationPrice > 0 && sizing.trailingCallbackRate > 0) {
      try {
        await placeTrailingStopOrder({
          symbol: signal.symbol,
          positionSide: signal.positionSide,
          quantity: sizing.formattedQuantity,
          activationPrice: sizing.trailingActivationPrice,
          priceRate: sizing.trailingCallbackRate,
        });
        logger.info(
          `Trailing Stop BingX aktif untuk ${signal.symbol}: Aktif di $${sizing.trailingActivationPrice}, Callback ${(sizing.trailingCallbackRate * 100).toFixed(2)}% (ATR: ${signal.atr.toFixed(4)})`
        );
      } catch (err) {
        logger.warn(`Gagal memasang order Trailing Stop awal untuk ${signal.symbol}:`, err);
      }
    }

    // Bersihkan cache posisi agar pengecekan posisi berikutnya segera membaca data baru dari BingX
    clearPositionsCache();

    // 4. Simpan posisi ke tracker internal
    storage.saveManagedPosition({
      symbol: signal.symbol,
      positionSide: signal.positionSide,
      entryPrice: sizing.formattedPrice,
      quantity: sizing.formattedQuantity,
      leverage: config.defaultLeverage,
      initialSl: sizing.formattedSl,
      currentSl: sizing.formattedSl,
      initialTp: 0,
      trailingActivationPrice: sizing.trailingActivationPrice,
      trailingCallbackRate: sizing.trailingCallbackRate,
      isTrailingActive: false,
      isBreakEvenApplied: false,
      highestPrice: sizing.formattedPrice,
      lowestPrice: sizing.formattedPrice,
      openedAt: Date.now(),
    });

    // 5. Kirim notifikasi Telegram
    await notifyNewOrder({
      symbol: signal.symbol,
      positionSide: signal.positionSide,
      entryPrice: sizing.formattedPrice,
      quantity: sizing.formattedQuantity,
      leverage: config.defaultLeverage,
      stopLoss: sizing.formattedSl,
      trailingActivationPrice: sizing.trailingActivationPrice,
      trailingCallbackRate: sizing.trailingCallbackRate,
      requiredMargin: sizing.requiredMarginUsdt,
      score: signal.score,
      reasons: signal.reasons,
    });

    return true;
  } catch (err: any) {
    logger.error(`Gagal mengeksekusi order untuk ${signal.symbol}:`, err?.message || err);
    return false;
  }
}
