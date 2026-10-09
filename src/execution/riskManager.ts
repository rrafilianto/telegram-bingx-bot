import { getContractSpec } from "../bingx/market.js";
import { getBalance, getPositions, PositionData } from "../bingx/account.js";
import { TradeSignal } from "../analysis/strategy.js";
import { config } from "../config.js";
import { storage } from "../utils/storage.js";
import { logger } from "../utils/logger.js";

export interface SizingResult {
  allowed: boolean;
  reason?: string;
  quantity: number;
  formattedQuantity: number;
  formattedPrice: number;
  formattedSl: number;
  formattedTp: number;
  trailingActivationPrice: number;
  trailingCallbackRate: number;
  notionalValueUsdt: number;
  requiredMarginUsdt: number;
}

function roundToPrecision(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

function emptyResult(reason: string): SizingResult {
  return {
    allowed: false,
    reason,
    quantity: 0,
    formattedQuantity: 0,
    formattedPrice: 0,
    formattedSl: 0,
    formattedTp: 0,
    trailingActivationPrice: 0,
    trailingCallbackRate: 0,
    notionalValueUsdt: 0,
    requiredMarginUsdt: 0,
  };
}

export interface CircuitBreakerStatus {
  triggered: boolean;
  currentLoss: number;
  maxLossAllowed: number;
  drawdownPercent: number;
  startingBalance: number;
  reason?: string;
}

export async function checkCircuitBreaker(): Promise<CircuitBreakerStatus> {
  const dailyStats = storage.getDailyStats();
  let startingBalance = dailyStats.startingBalance;

  // Jika starting balance belum ada (misal bot baru start hari ini),
  // sinkronkan dari saldo akun BingX terkini.
  if (startingBalance <= 0) {
    try {
      const balanceInfo = await getBalance();
      if (balanceInfo) {
        const equity = parseFloat(balanceInfo.equity) || parseFloat(balanceInfo.balance) || 0;
        storage.checkDailyReset(equity);
        storage.updateStartingBalance(equity);
        startingBalance = storage.getDailyStats().startingBalance;
      }
    } catch (err: any) {
      logger.debug("Gagal menyinkronkan saldo awal untuk circuit breaker:", err?.message || err);
    }
  }

  const maxLossAllowed = (startingBalance * config.maxDailyDrawdownPercent) / 100;
  const currentLoss = dailyStats.netProfit !== undefined ? dailyStats.netProfit : dailyStats.realizedPnl;
  const triggered = currentLoss <= -maxLossAllowed && maxLossAllowed > 0;
  const drawdownPercent = startingBalance > 0 ? (Math.abs(currentLoss) / startingBalance) * 100 : 0;

  return {
    triggered,
    currentLoss,
    maxLossAllowed,
    drawdownPercent,
    startingBalance,
    reason: triggered
      ? `Circuit Breaker: Batas kerugian harian (-${config.maxDailyDrawdownPercent}%) tercapai.`
      : undefined,
  };
}

export async function validateAndSizeTrade(
  signal: TradeSignal
): Promise<SizingResult> {
  // 1. Cek apakah auto-trade sedang di-pause
  if (storage.isPaused()) {
    return emptyResult("Auto-Trade sedang di-pause oleh user via Telegram.");
  }

  // 2. Cek Saldo & Circuit Breaker Harian
  const balanceInfo = await getBalance();
  if (!balanceInfo) {
    return emptyResult("Tidak dapat mengambil data saldo dari BingX.");
  }

  const equity = parseFloat(balanceInfo.equity) || parseFloat(balanceInfo.balance) || 0;
  const availableMargin = parseFloat(balanceInfo.availableMargin) || 0;

  storage.checkDailyReset(equity);
  storage.updateStartingBalance(equity);

  const cb = await checkCircuitBreaker();
  if (cb.triggered) {
    logger.warn(`CIRCUIT BREAKER: Batas kerugian harian (-${config.maxDailyDrawdownPercent}%) tercapai!`);
    return emptyResult(cb.reason || `Circuit Breaker: Batas kerugian harian (-${config.maxDailyDrawdownPercent}%) tercapai.`);
  }

  // 3. Cek Batas Maksimal Posisi Terbuka
  const openPositions = await getPositions();
  if (openPositions.length >= config.maxConcurrentPositions) {
    return emptyResult(`Jumlah posisi aktif (${openPositions.length}) sudah mencapai batas maksimal (${config.maxConcurrentPositions}).`);
  }

  // Cek apakah koin ini sudah punya posisi terbuka
  const alreadyOpen = openPositions.some((p) => p.symbol === signal.symbol);
  if (alreadyOpen) {
    return emptyResult(`Posisi pada token ${signal.symbol} sudah terbuka saat ini.`);
  }

  // 4. Kalkulasi Ukuran Lot (Position Sizing)
  const spec = await getContractSpec(signal.symbol);
  const qtyPrecision = spec ? spec.quantityPrecision : 4;
  const pricePrecision = spec ? spec.pricePrecision : 2;
  const minQty = spec ? spec.tradeMinQuantity : 0.001;
  const minUsdt = spec ? spec.tradeMinUSDT : 2;

  const dollarRisk = (equity * config.riskPerTradePercent) / 100;
  const priceDistance = Math.abs(signal.entryPrice - signal.stopLossPrice);

  if (priceDistance <= 0) {
    return emptyResult("Jarak Stop Loss tidak valid.");
  }

  let theoreticalQty = dollarRisk / priceDistance;

  // Batasi Maksimal Notional Value (Cap ukuran kontrak terhadap Equity)
  const maxNotionalUsdt = (equity * config.maxPositionNotionalPercent) / 100;
  if (maxNotionalUsdt > 0 && theoreticalQty * signal.entryPrice > maxNotionalUsdt) {
    theoreticalQty = maxNotionalUsdt / signal.entryPrice;
    logger.info(
      `Ukuran posisi ${signal.symbol} dibatasi ke batas maksimal notional $${maxNotionalUsdt.toFixed(2)} (${config.maxPositionNotionalPercent}% Equity).`
    );
  }

  let formattedQty = roundToPrecision(theoreticalQty, qtyPrecision);

  if (formattedQty < minQty) {
    formattedQty = minQty;
  }

  const notionalValue = formattedQty * signal.entryPrice;
  if (notionalValue < minUsdt) {
    formattedQty = roundToPrecision(minUsdt / signal.entryPrice, qtyPrecision);
    if (formattedQty < minQty) formattedQty = minQty;
  }

  const requiredMargin = (formattedQty * signal.entryPrice) / config.defaultLeverage;
  if (requiredMargin > availableMargin) {
    return emptyResult(`Margin tidak cukup. Diperlukan: $${requiredMargin.toFixed(2)}, Tersedia: $${availableMargin.toFixed(2)}`);
  }

  const formattedPrice = roundToPrecision(signal.entryPrice, pricePrecision);
  const formattedSl = roundToPrecision(signal.stopLossPrice, pricePrecision);
  const formattedTp = roundToPrecision(signal.takeProfitPrice, pricePrecision);
  const formattedTrailingActivation = roundToPrecision(signal.trailingActivationPrice, pricePrecision);

  return {
    allowed: true,
    quantity: theoreticalQty,
    formattedQuantity: formattedQty,
    formattedPrice,
    formattedSl,
    formattedTp,
    trailingActivationPrice: formattedTrailingActivation,
    trailingCallbackRate: signal.trailingCallbackRate,
    notionalValueUsdt: formattedQty * signal.entryPrice,
    requiredMarginUsdt: requiredMargin,
  };
}
