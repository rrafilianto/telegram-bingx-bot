import { TechnicalIndicators } from "./technical.js";
import { MarketSentiment } from "./sentiment.js";
import { config } from "../config.js";

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
  ta15m: TechnicalIndicators,
  ta1h: TechnicalIndicators | null,
  sentiment: MarketSentiment
): TradeSignal | null {
  const reasons: string[] = [];
  let longScore = 0;
  let shortScore = 0;

  const currentPrice = ta15m.currentPrice;
  const atr = ta15m.atr14;

  if (atr <= 0 || currentPrice <= 0) return null;

  // 1. Analisis Tren 1 Jam (Macro Filter)
  if (ta1h) {
    if (ta1h.currentPrice > ta1h.ema50 && ta1h.ema9 > ta1h.ema21) {
      longScore += 25;
      reasons.push("Tren 1H Bullish (Harga di atas EMA50)");
    } else if (ta1h.currentPrice < ta1h.ema50 && ta1h.ema9 < ta1h.ema21) {
      shortScore += 25;
      reasons.push("Tren 1H Bearish (Harga di bawah EMA50)");
    }
  }

  // 2. Analisis Struktur Tren 15 Menit
  if (currentPrice > ta15m.ema50 && ta15m.ema21 > ta15m.ema50) {
    longScore += 20;
    reasons.push("Struktur 15m Uptrend (EMA21 > EMA50)");
  } else if (currentPrice < ta15m.ema50 && ta15m.ema21 < ta15m.ema50) {
    shortScore += 20;
    reasons.push("Struktur 15m Downtrend (EMA21 < EMA50)");
  }

  // 3. Konfirmasi Pullback & Rejection 15 Menit (Inti Strategi Pullback)
  // LONG PULLBACK:
  // - Low 3 candle terakhir sempat koreksi ke area EMA21/EMA50
  // - Harga saat ini bertahan di atas EMA21 (tidak jebol)
  // - Harga tidak overextended di atas EMA21 (< 2.5% dari EMA)
  // - Ada candle pantulan (rejection)
  const isLongPullback =
    ta15m.recentLow3 <= ta15m.ema21 * 1.008 &&
    currentPrice >= ta15m.ema21 * 0.995 &&
    (currentPrice - ta15m.ema21) / ta15m.ema21 <= 0.025;

  const isLongRejection =
    currentPrice > ta15m.lastCandle.open ||
    ta15m.prevCandle.close > ta15m.prevCandle.open;

  if (isLongPullback && isLongRejection) {
    longScore += 30;
    reasons.push("Pullback 15m Terkonfirmasi (Memantul di area EMA21/EMA50)");
  } else if ((currentPrice - ta15m.ema21) / ta15m.ema21 > 0.035) {
    // Penalti jika harga sudah terbang terlalu jauh (menghindari beli di pucuk)
    longScore -= 25;
  }

  // SHORT PULLBACK:
  // - High 3 candle terakhir sempat retest naik ke area EMA21/EMA50
  // - Harga saat ini tertahan di bawah EMA21
  // - Harga tidak overextended ke bawah (< 2.5% dari EMA)
  // - Ada candle penolakan ke bawah
  const isShortPullback =
    ta15m.recentHigh3 >= ta15m.ema21 * 0.992 &&
    currentPrice <= ta15m.ema21 * 1.005 &&
    (ta15m.ema21 - currentPrice) / ta15m.ema21 <= 0.025;

  const isShortRejection =
    currentPrice < ta15m.lastCandle.open ||
    ta15m.prevCandle.close < ta15m.prevCandle.open;

  if (isShortPullback && isShortRejection) {
    shortScore += 30;
    reasons.push("Pullback 15m Terkonfirmasi (Tertolak di area EMA21/EMA50)");
  } else if ((ta15m.ema21 - currentPrice) / ta15m.ema21 > 0.035) {
    // Penalti jika harga sudah dump terlalu jauh (menghindari short di dasar)
    shortScore -= 25;
  }

  // 4. Momentum RSI 15m Pasca Koreksi
  if (ta15m.rsi14 >= 38 && ta15m.rsi14 <= 58) {
    longScore += 15;
    reasons.push(`RSI 15m Rebound Sehat (${ta15m.rsi14.toFixed(1)})`);
  } else if (ta15m.rsi14 > 68) {
    longScore -= 25; // Overbought, jangan beli
  }

  if (ta15m.rsi14 >= 42 && ta15m.rsi14 <= 62) {
    shortScore += 15;
    reasons.push(`RSI 15m Retest Sehat (${ta15m.rsi14.toFixed(1)})`);
  } else if (ta15m.rsi14 < 32) {
    shortScore -= 25; // Oversold, jangan short
  }

  // 5. Momentum MACD 15m
  if (ta15m.macd.histogram > 0 || ta15m.macd.macdLine > ta15m.macd.signalLine) {
    longScore += 10;
    reasons.push("MACD 15m Positif");
  }
  if (ta15m.macd.histogram < 0 || ta15m.macd.macdLine < ta15m.macd.signalLine) {
    shortScore += 10;
    reasons.push("MACD 15m Negatif");
  }

  // 6. Filter Sentimen Pasar
  if (sentiment.isExtremeGreed) {
    longScore -= 15;
  }
  if (sentiment.isExtremeFear) {
    shortScore -= 15;
  }

  const minScoreThreshold = 70;

  // 7. Kalkulasi Stop Loss dengan Safety Bracket
  let slDistance = atr * config.atrMultiplierSl;
  let slPercent = (slDistance / currentPrice) * 100;

  // Bracket Bawah: Jarak SL minimal (misal 1.5%) agar koin besar tidak kena noise
  if (slPercent < config.minSlPercent) {
    slDistance = currentPrice * (config.minSlPercent / 100);
    slPercent = config.minSlPercent;
    reasons.push(`SL diperlebar ke batas minimal ${config.minSlPercent}%`);
  }

  // Bracket Atas: Jika koin terlalu liar (jarak SL > maxSlPercent, misal 4.5%),
  // batalkan sinyal karena leverage 10x tidak aman menahan volatilitas ini
  if (slPercent > config.maxSlPercent) {
    return null;
  }

  // Hitung callback rate dinamis berdasarkan rasio ATR terhadap harga koin
  const rawCallback = (atr * config.trailingAtrMultiplier) / currentPrice;
  const trailingCallbackRate = Math.min(
    Math.max(rawCallback, config.trailingMinCallbackRate),
    config.trailingMaxCallbackRate
  );

  // Signal LONG
  if (longScore >= minScoreThreshold && longScore > shortScore) {
    const sl = currentPrice - slDistance;
    const trailingActivationPrice = currentPrice + (slDistance * config.trailingActivationR);

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
    const trailingActivationPrice = currentPrice - (slDistance * config.trailingActivationR);

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
