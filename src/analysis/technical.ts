import { KlineItem } from "../bingx/market.js";

export interface TechnicalIndicators {
  currentPrice: number;
  rsi14: number;
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  macd: {
    macdLine: number;
    signalLine: number;
    histogram: number;
  };
  atr14: number;
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
  };
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  lastCandle: KlineItem;
  prevCandle: KlineItem;
  recentLow3: number;
  recentHigh3: number;
}

/**
 * Menghitung Exponential Moving Average (EMA)
 */
export function calculateEMA(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const emaArray: number[] = [];

  // Hitung SMA awal sebagai basis EMA pertama
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let currentEma = sum / period;
  emaArray.push(currentEma);

  for (let i = period; i < values.length; i++) {
    currentEma = values[i] * k + currentEma * (1 - k);
    emaArray.push(currentEma);
  }

  return emaArray;
}

/**
 * Menghitung Relative Strength Index (RSI Wilder 14)
 */
export function calculateRSI(closes: number[], period = 14): number[] {
  if (closes.length <= period) return [];

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  const rsiValues: number[] = [];
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiValues.push(100 - 100 / (1 + rs));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const currentRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - 100 / (1 + currentRs));
  }

  return rsiValues;
}

/**
 * Menghitung Average True Range (ATR 14)
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
 * Menghitung MACD (12, 26, 9)
 */
export function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macdLine: number; signalLine: number; histogram: number } {
  const fastEma = calculateEMA(closes, fastPeriod);
  const slowEma = calculateEMA(closes, slowPeriod);

  // Samakan panjang array
  const offset = fastEma.length - slowEma.length;
  const macdSeries: number[] = [];
  for (let i = 0; i < slowEma.length; i++) {
    macdSeries.push(fastEma[i + offset] - slowEma[i]);
  }

  const signalEma = calculateEMA(macdSeries, signalPeriod);
  const lastMacd = macdSeries[macdSeries.length - 1] || 0;
  const lastSignal = signalEma[signalEma.length - 1] || 0;
  const lastHist = lastMacd - lastSignal;

  return {
    macdLine: lastMacd,
    signalLine: lastSignal,
    histogram: lastHist,
  };
}

/**
 * Menghitung Bollinger Bands (20, 2)
 */
export function calculateBollingerBands(
  closes: number[],
  period = 20,
  multiplier = 2
): { upper: number; middle: number; lower: number } {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };

  const slice = closes.slice(closes.length - period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + multiplier * stdDev,
    middle,
    lower: middle - multiplier * stdDev,
  };
}

/**
 * Menghitung Ringkasan Indikator Lengkap untuk satu kumpulan Klines
 */
export function analyzeKlines(klines: KlineItem[]): TechnicalIndicators | null {
  if (klines.length < 50) return null;

  const closes = klines.map((k) => k.close);
  const currentPrice = closes[closes.length - 1];

  const ema9Arr = calculateEMA(closes, 9);
  const ema21Arr = calculateEMA(closes, 21);
  const ema50Arr = calculateEMA(closes, 50);
  const ema200Arr = calculateEMA(closes, 200);

  const rsiArr = calculateRSI(closes, 14);
  const atrArr = calculateATR(klines, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes);

  const ema9 = ema9Arr[ema9Arr.length - 1] || currentPrice;
  const ema21 = ema21Arr[ema21Arr.length - 1] || currentPrice;
  const ema50 = ema50Arr[ema50Arr.length - 1] || currentPrice;
  const ema200 = ema200Arr.length > 0 ? ema200Arr[ema200Arr.length - 1] : ema50;

  const rsi14 = rsiArr[rsiArr.length - 1] || 50;
  const atr14 = atrArr[atrArr.length - 1] || currentPrice * 0.01;

  // Tentukan arah tren
  let trend: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (currentPrice > ema50 && ema9 > ema21) {
    trend = "BULLISH";
  } else if (currentPrice < ema50 && ema9 < ema21) {
    trend = "BEARISH";
  }

  const lastCandle = klines[klines.length - 1];
  const prevCandle = klines[klines.length - 2] || lastCandle;
  const recent3 = klines.slice(Math.max(0, klines.length - 3));
  const recentLow3 = Math.min(...recent3.map((k) => k.low));
  const recentHigh3 = Math.max(...recent3.map((k) => k.high));

  return {
    currentPrice,
    rsi14,
    ema9,
    ema21,
    ema50,
    ema200,
    macd,
    atr14,
    bollingerBands: bb,
    trend,
    lastCandle,
    prevCandle,
    recentLow3,
    recentHigh3,
  };
}
