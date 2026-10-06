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

  // 2. Analisis Struktur Harga 15 Menit (Primary Setup)
  if (currentPrice > ta15m.ema50 && ta15m.ema9 > ta15m.ema21) {
    longScore += 25;
    reasons.push("Struktur 15m Bullish (EMA9 di atas EMA21)");
  } else if (currentPrice < ta15m.ema50 && ta15m.ema9 < ta15m.ema21) {
    shortScore += 25;
    reasons.push("Struktur 15m Bearish (EMA9 di bawah EMA21)");
  }

  // 3. Momentum RSI 15m
  if (ta15m.rsi14 >= 42 && ta15m.rsi14 <= 65) {
    longScore += 25;
    reasons.push(`RSI 15m Sehat (${ta15m.rsi14.toFixed(1)})`);
  } else if (ta15m.rsi14 >= 35 && ta15m.rsi14 <= 58) {
    shortScore += 25;
    reasons.push(`RSI 15m Melemah (${ta15m.rsi14.toFixed(1)})`);
  }

  // 4. Momentum MACD 15m
  if (ta15m.macd.histogram > 0 && ta15m.macd.macdLine > ta15m.macd.signalLine) {
    longScore += 15;
    reasons.push("MACD 15m Bullish Crossover");
  } else if (ta15m.macd.histogram < 0 && ta15m.macd.macdLine < ta15m.macd.signalLine) {
    shortScore += 15;
    reasons.push("MACD 15m Bearish Crossover");
  }

  // 5. Filter Sentimen Pasar
  if (sentiment.isExtremeGreed) {
    longScore -= 20; // Waspada koreksi tajam jika pasar terlalu serakah
  }
  if (sentiment.isExtremeFear) {
    shortScore -= 20; // Waspada rebound tajam jika pasar terlalu panik
  }

  const minScoreThreshold = 65;
  const slDistance = atr * config.atrMultiplierSl;
  const tpDistance = slDistance * config.rrRatio;

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
