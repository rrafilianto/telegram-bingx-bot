import { getAllTickers, getKlines } from "../bingx/market.js";
import { analyzeKlines } from "./technical.js";
import { getMarketSentiment } from "./sentiment.js";
import { evaluateStrategy, TradeSignal } from "./strategy.js";
import { config } from "../config.js";
import { storage } from "../utils/storage.js";
import { logger } from "../utils/logger.js";

export async function runMarketScan(): Promise<TradeSignal[]> {
  logger.scan("Memulai pemindaian pasar dinamis (Dynamic Volume Scanner)...");

  const [allTickers, sentiment] = await Promise.all([
    getAllTickers(),
    getMarketSentiment(),
  ]);

  if (allTickers.length === 0) {
    logger.warn("Tidak ada ticker yang diterima dari BingX.");
    return [];
  }

  // Filter pasangan USDT-M Perpetual
  const usdtPairs = allTickers.filter((t) => {
    if (!t.symbol.endsWith("-USDT")) return false;
    if (t.symbol.startsWith("NC")) return false; // Abaikan instrumen Non-Crypto (TradFi)
    if (config.blacklistSymbols.includes(t.symbol)) return false;
    if (storage.isSymbolInCooldown(t.symbol)) return false;
    return true;
  });

  // Urutkan berdasarkan volume 24 jam (USDT) tertinggi
  usdtPairs.sort((a, b) => parseFloat(b.quoteVolume || "0") - parseFloat(a.quoteVolume || "0"));

  const topCandidates = usdtPairs.slice(0, config.topVolumeLimit);
  logger.scan(`Menganalisis Top ${topCandidates.length} token volume tertinggi di BingX Swap...`);

  const signals: TradeSignal[] = [];

  for (const item of topCandidates) {
    try {
      // 1. Ambil K-line 15m
      const klines15m = await getKlines(item.symbol, config.timeframePrimary, 80);
      const ta15m = analyzeKlines(klines15m);
      if (!ta15m) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Jeda 200ms sebelum request timeframe 1h
      await new Promise((r) => setTimeout(r, 200));

      // 2. Ambil K-line 1h untuk filter tren makro
      const klines1h = await getKlines(item.symbol, config.timeframeTrend, 60);
      const ta1h = analyzeKlines(klines1h);

      const signal = evaluateStrategy(item.symbol, ta15m, ta1h, sentiment);

      if (signal) {
        logger.trade(
          `Sinyal terdeteksi! [${signal.positionSide}] ${signal.symbol} (Skor: ${signal.score}) Entry: ${signal.entryPrice} SL: ${signal.stopLossPrice} TP: ${signal.takeProfitPrice}`
        );
        signals.push(signal);
      }

      // Jeda 450ms antar token agar frekuensi request aman di bawah batas 2-3 req/s
      await new Promise((r) => setTimeout(r, 450));
    } catch (err: any) {
      if (err?.message?.includes("100410")) {
        logger.warn(`Rate limit terdeteksi pada ${item.symbol}. Memberikan jeda 2 detik...`);
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        logger.debug(`Gagal menganalisis token ${item.symbol}:`, err?.message || err);
      }
    }
  }

  // Urutkan sinyal berdasarkan skor tertinggi
  signals.sort((a, b) => b.score - a.score);
  logger.scan(`Pemindaian selesai. Ditemukan ${signals.length} peluang sinyal valid.`);
  return signals;
}
