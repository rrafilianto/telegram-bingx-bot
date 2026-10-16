import { getAllTickers, getKlines } from "../bingx/market.js";
import { analyzeKlines } from "./technical.js";
import { getMarketSentiment } from "./sentiment.js";
import { evaluateStrategy, TradeSignal } from "./strategy.js";
import { generateChartSnapshot } from "../utils/chartRenderer.js";
import { config, getActivePreset } from "../config.js";
import { storage } from "../utils/storage.js";
import { logger } from "../utils/logger.js";

export async function runMarketScan(): Promise<TradeSignal[]> {
  const preset = getActivePreset();
  logger.scan(`Memulai pemindaian pasar dinamis [${preset.badge}]...`);

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

  const topCandidates = usdtPairs.slice(0, preset.topVolumeLimit);
  logger.scan(`Menganalisis Top ${topCandidates.length} token volume tertinggi [${preset.badge}] di BingX Swap...`);

  const signals: TradeSignal[] = [];

  for (const item of topCandidates) {
    try {
      // 1. Ambil 120 K-line timeframe primer (cukup untuk lookback 100 volume stdev + range jam berjalan)
      const klinesPrimary = await getKlines(item.symbol, preset.timeframePrimary, 120);
      const taPrimary = analyzeKlines(
        klinesPrimary,
        preset.orbMinutes,
        preset.absorptionThreshold,
        preset.absorptionLookback
      );

      if (!taPrimary) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Jeda 200ms sebelum request timeframe tren
      await new Promise((r) => setTimeout(r, 200));

      // 2. Ambil K-line timeframe tren makro
      const klinesTrend = await getKlines(item.symbol, preset.timeframeTrend, 60);
      const taTrend = analyzeKlines(
        klinesTrend,
        preset.orbMinutes,
        preset.absorptionThreshold,
        preset.absorptionLookback
      );

      const signal = evaluateStrategy(item.symbol, taPrimary, taTrend, sentiment);

      if (signal) {
        logger.trade(
          `Sinyal terdeteksi! [${signal.positionSide}] ${signal.symbol} (Skor: ${signal.score}) Entry: ${signal.entryPrice} SL: ${signal.stopLossPrice} TP: ${signal.takeProfitPrice}`
        );

        // Generate Visual Chart Snapshot TradingView Style
        try {
          const chartBuffer = generateChartSnapshot({
            symbol: item.symbol,
            timeframe: preset.timeframePrimary,
            klines: klinesPrimary,
            orb: taPrimary.orb,
            signal,
            aggression: taPrimary.aggression,
          });
          signal.chartBuffer = chartBuffer;
        } catch (chartErr) {
          logger.debug("Gagal membuat chart snapshot untuk sinyal:", chartErr);
        }

        signals.push(signal);
      }

      // Jeda 450ms antar token agar frekuensi request aman di bawah batas rate limit
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
