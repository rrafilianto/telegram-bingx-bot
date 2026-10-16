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

/**
 * Evaluasi strategi Aggression Mark + Hourly ORB
 * Menghasilkan sinyal trading berdasarkan:
 * 1. Setup Reversal / Liquidity Sweep (Fading fakeout di OR High/Low dengan konfirmasi Whale Absorption)
 * 2. Setup Clean Breakout Continuation (Penembusan tegas OR High/Low dengan konfirmasi lonjakan volume tanpa wick rejection)
 */
export function evaluateStrategy(
  symbol: string,
  taPrimary: TechnicalIndicators,
  taTrend: TechnicalIndicators | null,
  sentiment: MarketSentiment
): TradeSignal | null {
  const preset = getActivePreset();

  if (!taPrimary || !taPrimary.orb || !taPrimary.orb.isFormed) {
    return null;
  }

  // Jeda saat rentang pembukaan (Opening Range N menit pertama) sedang terbentuk
  if (taPrimary.orb.inOpeningRange) {
    return null;
  }

  const { orHigh, orLow, orMid, rangePercent } = taPrimary.orb;
  const { currentPrice, lastCandle, prevCandle, atr14, aggression, prevAggression } = taPrimary;

  if (atr14 <= 0 || currentPrice <= 0 || orHigh <= orLow) {
    return null;
  }

  // Filter jika range per jam terlalu sempit (pasar mati/tidak ada likuiditas) atau terlalu liar
  if (rangePercent < 0.15 || rangePercent > 6.0) {
    return null;
  }

  const minScoreThreshold = 70;
  let signal: {
    side: "BUY" | "SELL";
    positionSide: "LONG" | "SHORT";
    score: number;
    sl: number;
    tp: number;
    reasons: string[];
  } | null = null;

  // =========================================================================
  // SETUP 1: LIQUIDITY SWEEP & REVERSAL (Core Edge dari Aggression + ORB)
  // =========================================================================

  // A. SHORT SETUP (Selling Absorption di pucuk OR High)
  const sweptHigh = lastCandle.high >= orHigh || (prevCandle && prevCandle.high >= orHigh);
  const hasSellingAbsorption =
    aggression.type === "SELLING_ABSORPTION" ||
    (prevAggression && prevAggression.type === "SELLING_ABSORPTION");
  const isRejectedDown =
    currentPrice <= orHigh * 1.002 && lastCandle.close < lastCandle.high;

  if (sweptHigh && hasSellingAbsorption && isRejectedDown) {
    const reasons: string[] = [
      `Hourly ORB Sweep: Harga menyapu OR High ($${orHigh.toFixed(4)})`,
      `Selling Absorption: Paus menyerap buy retail di ekor atas (Tier ${aggression.tier}, ScaledVol: ${aggression.scaledVol.toFixed(1)}x StDev)`,
      `Target Reversal: OR Mid ($${orMid.toFixed(4)}) & OR Low ($${orLow.toFixed(4)})`,
    ];

    let score = 75;
    if (aggression.tier === "E") score += 20;
    else if (aggression.tier === "D") score += 15;
    else if (aggression.tier === "C") score += 10;
    else if (aggression.tier === "B") score += 5;

    if (lastCandle.close < orHigh) score += 5; // Tutup kembali di bawah garis OR High
    if (sentiment.isExtremeFear) score -= 15;
    if (sentiment.isExtremeGreed) score += 10;

    const swingHigh = Math.max(lastCandle.high, prevCandle ? prevCandle.high : lastCandle.high);
    const sl = swingHigh + atr14 * 0.3;
    const tp = orLow;

    signal = {
      side: "SELL",
      positionSide: "SHORT",
      score,
      sl,
      tp,
      reasons,
    };
  }

  // B. LONG SETUP (Buying Absorption di dasar OR Low)
  const sweptLow = lastCandle.low <= orLow || (prevCandle && prevCandle.low <= orLow);
  const hasBuyingAbsorption =
    aggression.type === "BUYING_ABSORPTION" ||
    (prevAggression && prevAggression.type === "BUYING_ABSORPTION");
  const isRejectedUp =
    currentPrice >= orLow * 0.998 && lastCandle.close > lastCandle.low;

  if (!signal && sweptLow && hasBuyingAbsorption && isRejectedUp) {
    const reasons: string[] = [
      `Hourly ORB Sweep: Harga menyapu OR Low ($${orLow.toFixed(4)})`,
      `Buying Absorption: Paus menyerap sell retail di ekor bawah (Tier ${aggression.tier}, ScaledVol: ${aggression.scaledVol.toFixed(1)}x StDev)`,
      `Target Reversal: OR Mid ($${orMid.toFixed(4)}) & OR High ($${orHigh.toFixed(4)})`,
    ];

    let score = 75;
    if (aggression.tier === "E") score += 20;
    else if (aggression.tier === "D") score += 15;
    else if (aggression.tier === "C") score += 10;
    else if (aggression.tier === "B") score += 5;

    if (lastCandle.close > orLow) score += 5; // Tutup kembali di atas garis OR Low
    if (sentiment.isExtremeGreed) score -= 15;
    if (sentiment.isExtremeFear) score += 10;

    const swingLow = Math.min(lastCandle.low, prevCandle ? prevCandle.low : lastCandle.low);
    const sl = swingLow - atr14 * 0.3;
    const tp = orHigh;

    signal = {
      side: "BUY",
      positionSide: "LONG",
      score,
      sl,
      tp,
      reasons,
    };
  }

  // =========================================================================
  // SETUP 2: MOMENTUM BREAKOUT (Breakout Bersih tanpa Rejection)
  // =========================================================================
  if (!signal) {
    const rangeHeight = orHigh - orLow;

    // Breakout Bullish
    if (
      lastCandle.close > orHigh * 1.0005 &&
      lastCandle.close > lastCandle.open &&
      aggression.scaledVol >= preset.absorptionThreshold &&
      !aggression.upperZone
    ) {
      const sl = Math.max(orMid, orHigh - atr14 * 1.2);
      const tp = currentPrice + rangeHeight * 1.2;
      signal = {
        side: "BUY",
        positionSide: "LONG",
        score: 75,
        sl,
        tp,
        reasons: [
          `Hourly ORB Breakout: Penembusan valid di atas OR High ($${orHigh.toFixed(4)})`,
          `Volume Expansion: Volume terkonfirmasi kuat (${aggression.scaledVol.toFixed(1)}x StDev)`,
          `Target Expansion: $${tp.toFixed(4)}`,
        ],
      };
    }
    // Breakdown Bearish
    else if (
      lastCandle.close < orLow * 0.9995 &&
      lastCandle.close < lastCandle.open &&
      aggression.scaledVol >= preset.absorptionThreshold &&
      !aggression.lowerZone
    ) {
      const sl = Math.min(orMid, orLow + atr14 * 1.2);
      const tp = currentPrice - rangeHeight * 1.2;
      signal = {
        side: "SELL",
        positionSide: "SHORT",
        score: 75,
        sl,
        tp,
        reasons: [
          `Hourly ORB Breakdown: Penembusan valid di bawah OR Low ($${orLow.toFixed(4)})`,
          `Volume Expansion: Volume terkonfirmasi kuat (${aggression.scaledVol.toFixed(1)}x StDev)`,
          `Target Expansion: $${tp.toFixed(4)}`,
        ],
      };
    }
  }

  if (!signal || signal.score < minScoreThreshold) {
    return null;
  }

  // =========================================================================
  // KALKULASI RISK MANAGEMENT & SAFETY BRACKET SL
  // =========================================================================
  let slDistance = Math.abs(currentPrice - signal.sl);
  let slPercent = (slDistance / currentPrice) * 100;

  // Bracket Bawah: Jarak SL minimal
  if (slPercent < preset.minSlPercent) {
    slDistance = currentPrice * (preset.minSlPercent / 100);
    signal.sl =
      signal.positionSide === "LONG"
        ? currentPrice - slDistance
        : currentPrice + slDistance;
    slPercent = preset.minSlPercent;
    signal.reasons.push(`SL diperlebar ke batas minimal ${preset.minSlPercent}%`);
  }

  // Bracket Atas: Jika jarak SL terlalu jauh dari batas maksimal preset, batalkan sinyal
  if (slPercent > preset.maxSlPercent) {
    return null;
  }

  // Hitung callback rate dinamis berdasarkan rasio ATR
  const rawCallback = (atr14 * preset.trailingAtrMultiplier) / currentPrice;
  const trailingCallbackRate = Math.min(
    Math.max(rawCallback, preset.trailingMinCallbackRate),
    preset.trailingMaxCallbackRate
  );

  const trailingActivationPrice =
    signal.positionSide === "LONG"
      ? currentPrice + slDistance * preset.trailingActivationR
      : currentPrice - slDistance * preset.trailingActivationR;

  const riskRewardRatio =
    Math.abs(signal.tp - currentPrice) / Math.max(slDistance, 0.000001);

  return {
    symbol,
    side: signal.side,
    positionSide: signal.positionSide,
    score: signal.score,
    entryPrice: currentPrice,
    stopLossPrice: signal.sl,
    takeProfitPrice: signal.tp,
    trailingActivationPrice,
    trailingCallbackRate,
    atr: atr14,
    riskRewardRatio,
    reasons: signal.reasons,
  };
}
