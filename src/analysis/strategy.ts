import { TechnicalIndicators } from "./technical.js";
import { MarketSentiment } from "./sentiment.js";
import { config, getActivePreset } from "../config.js";

export interface TradeSignal {
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: "LONG" | "SHORT";
  score: number; // 0 - 100
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  trailingActivationPrice: number;
  trailingCallbackRate: number;
  atr: number;
  riskRewardRatio: number;
  reasons: string[];
}

export function evaluateStrategy(
  symbol: string,
  taPrimary: TechnicalIndicators,
  taTrend: TechnicalIndicators | null,
  sentiment: MarketSentiment
): TradeSignal | null {
  const preset = getActivePreset();
  const reasons: string[] = [];
  let longScore = 0;
  let shortScore = 0;

  const currentPrice = taPrimary.currentPrice;
  const atr = taPrimary.atr14;

  if (atr <= 0 || currentPrice <= 0) return null;

  // 1. Analisis Tren Makro (Macro Trend Filter)
  if (taTrend) {
    if (taTrend.currentPrice > taTrend.ema50 && taTrend.ema9 > taTrend.ema21) {
      longScore += 25;
      reasons.push(`Tren ${preset.timeframeTrend} Bullish (Harga di atas EMA50)`);
    } else if (taTrend.currentPrice < taTrend.ema50 && taTrend.ema9 < taTrend.ema21) {
      shortScore += 25;
      reasons.push(`Tren ${preset.timeframeTrend} Bearish (Harga di bawah EMA50)`);
    }
  }

  // 2. Analisis Struktur Tren Timeframe Primer
  if (currentPrice > taPrimary.ema50 && taPrimary.ema21 > taPrimary.ema50) {
    longScore += 20;
    reasons.push(`Struktur ${preset.timeframePrimary} Uptrend (EMA21 > EMA50)`);
  } else if (currentPrice < taPrimary.ema50 && taPrimary.ema21 < taPrimary.ema50) {
    shortScore += 20;
    reasons.push(`Struktur ${preset.timeframePrimary} Downtrend (EMA21 < EMA50)`);
  }

  // 3. Konfirmasi Pullback & Rejection Timeframe Primer (Dinamis Sesuai Mode Preset)
  const maxDev = preset.pullbackMaxDeviationPercent / 100;
  const overextendedDev = (preset.pullbackMaxDeviationPercent * 1.4) / 100;

  // LONG PULLBACK:
  // - Low 3 candle terakhir sempat koreksi ke area EMA21/EMA50
  // - Harga saat ini bertahan di atas EMA21
  // - Deviasi harga tidak overextended di atas EMA21
  // - Ada candle pantulan (rejection)
  const isLongPullback =
    taPrimary.recentLow3 <= taPrimary.ema21 * (1 + maxDev * 0.3) &&
    currentPrice >= taPrimary.ema21 * (1 - maxDev * 0.2) &&
    (currentPrice - taPrimary.ema21) / taPrimary.ema21 <= maxDev;

  const isLongRejection =
    currentPrice > taPrimary.lastCandle.open ||
    taPrimary.prevCandle.close > taPrimary.prevCandle.open;

  if (isLongPullback && isLongRejection) {
    longScore += 30;
    reasons.push(`Pullback ${preset.timeframePrimary} Terkonfirmasi (Memantul di area EMA21/EMA50)`);
  } else if ((currentPrice - taPrimary.ema21) / taPrimary.ema21 > overextendedDev) {
    // Penalti jika harga sudah terbang terlalu jauh (menghindari beli di pucuk)
    longScore -= 25;
  }

  // SHORT PULLBACK:
  // - High 3 candle terakhir sempat retest naik ke area EMA21/EMA50
  // - Harga saat ini tertahan di bawah EMA21
  // - Deviasi harga tidak overextended ke bawah
  // - Ada candle penolakan ke bawah
  const isShortPullback =
    taPrimary.recentHigh3 >= taPrimary.ema21 * (1 - maxDev * 0.3) &&
    currentPrice <= taPrimary.ema21 * (1 + maxDev * 0.2) &&
    (taPrimary.ema21 - currentPrice) / taPrimary.ema21 <= maxDev;

  const isShortRejection =
    currentPrice < taPrimary.lastCandle.open ||
    taPrimary.prevCandle.close < taPrimary.prevCandle.open;

  if (isShortPullback && isShortRejection) {
    shortScore += 30;
    reasons.push(`Pullback ${preset.timeframePrimary} Terkonfirmasi (Tertolak di area EMA21/EMA50)`);
  } else if ((taPrimary.ema21 - currentPrice) / taPrimary.ema21 > overextendedDev) {
    // Penalti jika harga sudah dump terlalu jauh (menghindari short di dasar)
    shortScore -= 25;
  }

  // 4. Momentum RSI Pasca Koreksi
  if (taPrimary.rsi14 >= 38 && taPrimary.rsi14 <= 58) {
    longScore += 15;
    reasons.push(`RSI ${preset.timeframePrimary} Rebound Sehat (${taPrimary.rsi14.toFixed(1)})`);
  } else if (taPrimary.rsi14 > 68) {
    longScore -= 25; // Overbought, jangan beli
  }

  if (taPrimary.rsi14 >= 42 && taPrimary.rsi14 <= 62) {
    shortScore += 15;
    reasons.push(`RSI ${preset.timeframePrimary} Retest Sehat (${taPrimary.rsi14.toFixed(1)})`);
  } else if (taPrimary.rsi14 < 32) {
    shortScore -= 25; // Oversold, jangan short
  }

  // 5. Momentum MACD Timeframe Primer
  if (taPrimary.macd.histogram > 0 || taPrimary.macd.macdLine > taPrimary.macd.signalLine) {
    longScore += 10;
    reasons.push(`MACD ${preset.timeframePrimary} Positif`);
  }
  if (taPrimary.macd.histogram < 0 || taPrimary.macd.macdLine < taPrimary.macd.signalLine) {
    shortScore += 10;
    reasons.push(`MACD ${preset.timeframePrimary} Negatif`);
  }

  // 6. Filter Sentimen Pasar
  if (sentiment.isExtremeGreed) {
    longScore -= 15;
  }
  if (sentiment.isExtremeFear) {
    shortScore -= 15;
  }

  const minScoreThreshold = 70;

  // 7. Kalkulasi Stop Loss dengan Safety Bracket Sesuai Preset
  let slDistance = atr * preset.atrMultiplierSl;
  let slPercent = (slDistance / currentPrice) * 100;

  // Bracket Bawah: Jarak SL minimal (misal 0.5% scalping / 1.5% daytrade)
  if (slPercent < preset.minSlPercent) {
    slDistance = currentPrice * (preset.minSlPercent / 100);
    slPercent = preset.minSlPercent;
    reasons.push(`SL diperlebar ke batas minimal ${preset.minSlPercent}%`);
  }

  // Bracket Atas: Jika koin terlalu liar (jarak SL > maxSlPercent), batalkan sinyal
  if (slPercent > preset.maxSlPercent) {
    return null;
  }

  // Hitung callback rate dinamis berdasarkan rasio ATR terhadap harga koin
  const rawCallback = (atr * preset.trailingAtrMultiplier) / currentPrice;
  const trailingCallbackRate = Math.min(
    Math.max(rawCallback, preset.trailingMinCallbackRate),
    preset.trailingMaxCallbackRate
  );

  // Signal LONG
  if (longScore >= minScoreThreshold && longScore > shortScore) {
    const sl = currentPrice - slDistance;
    const trailingActivationPrice = currentPrice + (slDistance * preset.trailingActivationR);

    return {
      symbol,
      side: "BUY",
      positionSide: "LONG",
      score: longScore,
      entryPrice: currentPrice,
      stopLossPrice: sl,
      takeProfitPrice: trailingActivationPrice,
      trailingActivationPrice,
      trailingCallbackRate,
      atr,
      riskRewardRatio: config.rrRatio,
      reasons,
    };
  }

  // Signal SHORT
  if (shortScore >= minScoreThreshold && shortScore > longScore) {
    const sl = currentPrice + slDistance;
    const trailingActivationPrice = currentPrice - (slDistance * preset.trailingActivationR);

    return {
      symbol,
      side: "SELL",
      positionSide: "SHORT",
      score: shortScore,
      entryPrice: currentPrice,
      stopLossPrice: sl,
      takeProfitPrice: trailingActivationPrice,
      trailingActivationPrice,
      trailingCallbackRate,
      atr,
      riskRewardRatio: config.rrRatio,
      reasons,
    };
  }

  return null;
}
