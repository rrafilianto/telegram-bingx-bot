import { KlineItem } from "../bingx/market.js";

export type AggressionType = "BUYING_ABSORPTION" | "SELLING_ABSORPTION" | "NONE";
export type AggressionTier = "A" | "B" | "C" | "D" | "E" | "NONE";

export interface AggressionMark {
  scaledVol: number;
  isAbsorption: boolean;
  type: AggressionType;
  tier: AggressionTier;
  upperZone: boolean;
  lowerZone: boolean;
  topBody: number;
  lowBody: number;
  midPrice: number;
}

export interface HourlyOrbData {
  orHigh: number;
  orLow: number;
  orMid: number;
  inOpeningRange: boolean;
  hourStartBarTime: number;
  barsFromHour: number;
  isFormed: boolean;
  rangePercent: number;
}

export interface TechnicalIndicators {
  currentPrice: number;
  lastCandle: KlineItem;
  prevCandle: KlineItem;
  atr14: number;
  orb: HourlyOrbData;
  aggression: AggressionMark;
  prevAggression?: AggressionMark;
  volStdev: number;
}

/**
 * Menghitung Average True Range (ATR 14) untuk proteksi volatilitas dan jarak Stop Loss
 */
export function calculateATR(klines: KlineItem[], period = 14): number[] {
  if (klines.length <= period) return [];

  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const current = klines[i];
    const prev = klines[i - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );
    trs.push(tr);
  }

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const atrValues: number[] = [atr];

  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    atrValues.push(atr);
  }

  return atrValues;
}

/**
 * Menghitung Standar Deviasi Volume (lookback 100 candle)
 */
export function calculateVolumeStdev(volumes: number[], lookback = 100): number {
  if (volumes.length < 5) return 0;
  const slice = volumes.slice(Math.max(0, volumes.length - lookback));
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / slice.length;
  return Math.sqrt(variance);
}

/**
 * Deteksi Aggression Mark (Absorption Bubbles) berbasis rumus Pine Script:
 * - volStdev = ta.stdev(volData, lookbackperiod)
 * - scaledVol = volData / volStdev
 * - midPrice = (high + low) / 2
 * - upperZone = midPrice >= topBody and midPrice <= high  (Selling Absorption)
 * - lowerZone = midPrice <= lowBody and midPrice >= low   (Buying Absorption)
 */
export function detectAggressionMark(
  candle: KlineItem,
  volStdev: number,
  limitFactor = 1.5
): AggressionMark {
  const midPrice = (candle.high + candle.low) / 2;
  const topBody = Math.max(candle.open, candle.close);
  const lowBody = Math.min(candle.open, candle.close);

  const upperZone = midPrice >= topBody && midPrice <= candle.high;
  const lowerZone = midPrice <= lowBody && midPrice >= candle.low;

  const scaledVol = volStdev > 0 ? candle.volume / volStdev : 0;

  let tier: AggressionTier = "NONE";
  let isAbsorption = false;

  if (scaledVol >= limitFactor + 6) {
    tier = "E"; // Huge
    isAbsorption = true;
  } else if (scaledVol >= limitFactor + 3) {
    tier = "D"; // Large
    isAbsorption = true;
  } else if (scaledVol >= limitFactor + 2) {
    tier = "C"; // Normal
    isAbsorption = true;
  } else if (scaledVol >= limitFactor + 1) {
    tier = "B"; // Small
    isAbsorption = true;
  } else if (scaledVol >= limitFactor) {
    tier = "A"; // Tiny
    isAbsorption = true;
  }

  let type: AggressionType = "NONE";
  if (isAbsorption) {
    if (upperZone) {
      type = "SELLING_ABSORPTION"; // Retail buy agresif diserap oleh limit sell whale
    } else if (lowerZone) {
      type = "BUYING_ABSORPTION"; // Retail sell panik diserap oleh limit buy whale
    }
  }

  return {
    scaledVol,
    isAbsorption,
    type,
    tier,
    upperZone,
    lowerZone,
    topBody,
    lowBody,
    midPrice,
  };
}

/**
 * Menghitung Hourly Opening Range Breakout (Hourly ORB)
 * Menentukan orHigh, orLow, dan orMid dari N menit pertama setiap jam (XX:00 - XX:05).
 */
export function calculateHourlyORB(klines: KlineItem[], orbMinutes = 6): HourlyOrbData {
  if (klines.length === 0) {
    return {
      orHigh: 0,
      orLow: 0,
      orMid: 0,
      inOpeningRange: true,
      hourStartBarTime: 0,
      barsFromHour: 0,
      isFormed: false,
      rangePercent: 0,
    };
  }

  const latestCandle = klines[klines.length - 1];
  const latestTime = latestCandle.time;

  // Tentukan timestamp awal jam berjalan (UTC)
  const hourStartBarTime = Math.floor(latestTime / (60 * 60 * 1000)) * (60 * 60 * 1000);
  const orbEndTime = hourStartBarTime + orbMinutes * 60 * 1000;

  // Filter candle yang berada dalam rentang pembukaan jam ini (XX:00 s/d XX:orbMinutes)
  const orbCandles = klines.filter(
    (k) => k.time >= hourStartBarTime && k.time < orbEndTime
  );

  let orHigh = 0;
  let orLow = Infinity;

  if (orbCandles.length > 0) {
    for (const c of orbCandles) {
      if (c.high > orHigh) orHigh = c.high;
      if (c.low < orLow) orLow = c.low;
    }
  } else {
    // Fallback jika candle awal jam belum ada (misal bot baru fetch data tengah jam)
    // Ambil candle pertama dalam jam ini
    const hourCandles = klines.filter((k) => k.time >= hourStartBarTime);
    if (hourCandles.length > 0) {
      orHigh = hourCandles[0].high;
      orLow = hourCandles[0].low;
    } else {
      orHigh = latestCandle.high;
      orLow = latestCandle.low;
    }
  }

  if (orLow === Infinity) orLow = latestCandle.low;

  const orMid = (orHigh + orLow) / 2;
  const inOpeningRange = latestTime < orbEndTime;
  const barsFromHour = Math.floor((latestTime - hourStartBarTime) / (60 * 1000));
  const isFormed = orbCandles.length >= 1 && orHigh > 0 && orLow > 0 && orHigh > orLow;
  const rangePercent = orMid > 0 ? ((orHigh - orLow) / orMid) * 100 : 0;

  return {
    orHigh,
    orLow,
    orMid,
    inOpeningRange,
    hourStartBarTime,
    barsFromHour,
    isFormed,
    rangePercent,
  };
}

/**
 * Menganalisis K-lines untuk menghasilkan indikator Aggression Mark + Hourly ORB
 */
export function analyzeKlines(
  klines: KlineItem[],
  orbMinutes = 6,
  limitFactor = 1.5,
  lookback = 100
): TechnicalIndicators | null {
  if (klines.length < 20) return null;

  const lastCandle = klines[klines.length - 1];
  const prevCandle = klines[klines.length - 2] || lastCandle;
  const currentPrice = lastCandle.close;

  // 1. Hitung ATR untuk SL/TP dinamis
  const atrArr = calculateATR(klines, 14);
  const atr14 = atrArr[atrArr.length - 1] || currentPrice * 0.01;

  // 2. Hitung Standar Deviasi Volume
  const volumes = klines.map((k) => k.volume);
  const volStdev = calculateVolumeStdev(volumes, lookback);

  // 3. Deteksi Aggression Mark pada candle terkini dan candle sebelumnya
  const aggression = detectAggressionMark(lastCandle, volStdev, limitFactor);
  const prevAggression = detectAggressionMark(prevCandle, volStdev, limitFactor);

  // 4. Hitung Hourly ORB
  const orb = calculateHourlyORB(klines, orbMinutes);

  return {
    currentPrice,
    lastCandle,
    prevCandle,
    atr14,
    orb,
    aggression,
    prevAggression,
    volStdev,
  };
}
