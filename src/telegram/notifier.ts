import { config } from "../config.js";
import { storage } from "../utils/storage.js";
import { logger } from "../utils/logger.js";
import { PositionData, getBalance, getPositions } from "../bingx/account.js";
import { checkCircuitBreaker } from "../execution/riskManager.js";
import { bot } from "./bot.js";

export function escapeHtml(text: string): string {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getTargetChatId(): string {
  return config.telegramChatId || storage.getChatId();
}

export async function sendMessage(text: string): Promise<void> {
  const chatId = getTargetChatId();
  if (!chatId || !config.telegramBotToken) {
    logger.debug("Telegram Chat ID atau Bot Token belum diset, notifikasi dilewati.");
    return;
  }

  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
  } catch (err: any) {
    logger.warn(`Gagal mengirim pesan Telegram (HTML): ${err?.message || err}. Mencoba kirim plain text...`);
    try {
      // Fallback: bersihkan tag HTML dan kirim sebagai plain text agar notifikasi tidak hilang
      const plainText = text.replace(/<[^>]*>/g, "");
      await bot.api.sendMessage(chatId, plainText);
    } catch (e2: any) {
      logger.error(`Gagal mengirim pesan Telegram (fallback plain text): ${e2?.message || e2}`);
    }
  }
}

export async function notifyBotStarted(): Promise<void> {
  const envText = config.bingxEnv === "prod-live" ? "🔴 <b>LIVE (Real Funds)</b>" : "🟢 <b>VST (Simulasi Virtual)</b>";
  const msg =
    `🚀 <b>BingX 24/7 Futures Bot Aktif!</b>\n\n` +
    `• <b>Environment:</b> ${envText}\n` +
    `• <b>Default Leverage:</b> ${config.defaultLeverage}x (${config.marginType})\n` +
    `• <b>Max Open Posisi:</b> ${config.maxConcurrentPositions}\n` +
    `• <b>Risk per Trade:</b> ${config.riskPerTradePercent}%\n` +
    `• <b>Daily Max Loss:</b> ${config.maxDailyDrawdownPercent}%\n` +
    `• <b>Scanner Timeframe:</b> ${config.timeframePrimary} & ${config.timeframeTrend}\n\n` +
    `Ketik /help atau /status untuk melihat perintah yang tersedia.`;

  await sendMessage(msg);
}

export async function notifyNewOrder(data: {
  symbol: string;
  positionSide: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  leverage: number;
  stopLoss: number;
  takeProfit?: number;
  trailingActivationPrice?: number;
  trailingCallbackRate?: number;
  requiredMargin: number;
  score: number;
  reasons: string[];
}): Promise<void> {
  const icon = data.positionSide === "LONG" ? "🟢" : "🔴";
  const reasonsList = data.reasons.map((r) => `  - ${escapeHtml(r)}`).join("\n");

  let tpLine = "";
  if (data.trailingActivationPrice && data.trailingCallbackRate) {
    const cbPercent = (data.trailingCallbackRate * 100).toFixed(2);
    tpLine = `• <b>Trailing TP (ATR):</b> Aktif di $${data.trailingActivationPrice} (Callback: ${cbPercent}%)\n`;
  } else if (data.takeProfit && data.takeProfit > 0) {
    tpLine = `• <b>Take Profit (TP):</b> $${data.takeProfit}\n`;
  } else {
    tpLine = `• <b>Take Profit:</b> <i>Trailing Stop Dinamis</i>\n`;
  }

  const msg =
    `⚡ <b>POSISI BARU DIBUKA</b> ${icon} <b>${data.positionSide}</b>\n\n` +
    `• <b>Token:</b> <code>${data.symbol}</code>\n` +
    `• <b>Harga Entry:</b> $${data.entryPrice}\n` +
    `• <b>Jumlah:</b> ${data.quantity} koin\n` +
    `• <b>Margin Digunakan:</b> ~$${data.requiredMargin.toFixed(2)} (${data.leverage}x)\n` +
    tpLine +
    `• <b>Stop Loss (SL):</b> $${data.stopLoss}\n` +
    `• <b>Skor Sinyal:</b> ${data.score}/100\n\n` +
    `<b>Alasan Eksekusi:</b>\n${reasonsList}`;

  await sendMessage(msg);
}

export async function notifyTradeClosed(data: {
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  realizedPnl?: number;
  commission?: number;
  fundingFee?: number;
  netProfit?: number;
  pnlUsdt?: number;
  pnlPercent: number;
  reason: string;
}): Promise<void> {
  const finalNetProfit = data.netProfit !== undefined ? data.netProfit : (data.pnlUsdt ?? 0);
  const grossRealized = data.realizedPnl !== undefined ? data.realizedPnl : finalNetProfit;
  const isWin = finalNetProfit >= 0;
  const icon = isWin ? "🎯 <b>PROFIT</b> ✅" : "🛑 <b>LOSS</b> ❌";
  const netSign = finalNetProfit >= 0 ? "+" : "";
  const grossSign = grossRealized >= 0 ? "+" : "";
  const percentSign = data.pnlPercent >= 0 ? "+" : "";

  let feeFundingSection = "";
  if (data.commission !== undefined || data.fundingFee !== undefined) {
    const commStr = data.commission !== undefined ? `$${data.commission.toFixed(2)}` : "$0.00";
    const fundStr = data.fundingFee !== undefined
      ? `${data.fundingFee >= 0 ? "+" : ""}$${data.fundingFee.toFixed(2)}`
      : "$0.00";
    feeFundingSection =
      `• <b>Fee Trading:</b> ${commStr}\n` +
      `• <b>Funding Fee:</b> ${fundStr}\n`;
  }

  const msg =
    `${icon} <b>POSISI TERTUTUP: ${data.symbol}</b>\n\n` +
    `• <b>Arah:</b> ${data.side}\n` +
    `• <b>Entry:</b> $${data.entryPrice}\n` +
    `• <b>Exit:</b> $${data.exitPrice}\n` +
    `• <b>Realized PnL (Gross):</b> ${grossSign}$${grossRealized.toFixed(2)} USDT\n` +
    feeFundingSection +
    `• <b>Net Profit (Bersih):</b> <b>${netSign}$${finalNetProfit.toFixed(2)} USDT (${percentSign}${data.pnlPercent.toFixed(2)}%)</b>\n` +
    `• <b>Pemicu Tutup:</b> <code>${data.reason}</code>`;

  await sendMessage(msg);
}

export async function notifyBreakEvenActivated(
  symbol: string,
  side: "LONG" | "SHORT",
  entryPrice: number
): Promise<void> {
  const msg =
    `🛡️ <b>BREAK-EVEN STOP AKTIF!</b>\n\n` +
    `Posisi <b>${symbol}</b> (${side}) sudah mengamankan keuntungan +1R!\n` +
    `Stop Loss otomatis dipindahkan ke harga Entry ($${entryPrice}).\n` +
    `<i>Trade ini sekarang berstatus Bebas Risiko (Risk-Free).</i>`;

  await sendMessage(msg);
}

export async function notifyTrailingActivated(
  symbol: string,
  side: "LONG" | "SHORT",
  activationPrice: number,
  callbackPercent: string
): Promise<void> {
  const msg =
    `🚀 <b>TRAILING TAKE PROFIT AKTIF!</b>\n\n` +
    `Posisi <b>${symbol}</b> (${side}) telah menyentuh target aktivasi di <b>$${activationPrice}</b>!\n` +
    `Server BingX sekarang membuntuti pergerakan harga ke atas (Callback: ${callbackPercent}%).\n` +
    `<i>Keuntungan akan terus bertambah mengikuti tren pasar.</i>`;

  await sendMessage(msg);
}

export async function notifyOpenPositionsUpdate(positions: PositionData[]): Promise<void> {
  if (positions.length === 0) return;

  let totalUnPnl = 0;
  let detailList = "";

  for (const pos of positions) {
    const sideIcon = pos.positionSide === "LONG" ? "🟢" : "🔴";
    const entry = parseFloat(pos.avgPrice) || parseFloat(pos.entryPrice) || 0;
    const mark = parseFloat(pos.markPrice) || 0;
    const unPnl = parseFloat(pos.unrealizedProfit) || 0;
    const pnlSign = unPnl >= 0 ? "+" : "";
    totalUnPnl += unPnl;

    let pnlPercent = 0;
    if (entry > 0) {
      const priceDiff = pos.positionSide === "LONG" ? (mark - entry) : (entry - mark);
      pnlPercent = (priceDiff / entry) * 100 * (pos.leverage || 10);
    }
    const percentSign = pnlPercent >= 0 ? "+" : "";

    const managed = storage.getManagedPosition(pos.symbol);
    const slText = managed && (managed.currentSl || managed.initialSl)
      ? `$${managed.currentSl || managed.initialSl}`
      : "-";

    const beStatus = managed
      ? (managed.isBreakEvenApplied ? "✅ Sudah Aktif" : "⏳ Belum Aktif")
      : "-";

    let tpText = "-";
    let trailingStatus = "-";
    if (managed && managed.trailingActivationPrice && managed.trailingCallbackRate) {
      const cb = (managed.trailingCallbackRate * 100).toFixed(1);
      tpText = `Trailing Stop (CB ${cb}%)`;
      trailingStatus = managed.isTrailingActive
        ? "🚀 Sudah Aktif (Running)"
        : `⏳ Belum Aktif (Target $${managed.trailingActivationPrice})`;
    } else if (managed && managed.initialTp) {
      tpText = `$${managed.initialTp}`;
      trailingStatus = "❌ Tidak Digunakan (Fixed TP)";
    }

    const pnlIcon = unPnl >= 0 ? "🟢" : "🔴";
    detailList +=
      `${sideIcon} <b>${pos.symbol}</b> (${pos.positionSide} ${pos.leverage}x)\n` +
      `  • Entry: $${entry} | Sekarang: $${mark}\n` +
      `  • Stop Loss: ${slText}\n` +
      `  • Break-Even: <b>${beStatus}</b>\n` +
      `  • Take Profit: ${tpText}\n` +
      `  • Trailing TP: <b>${trailingStatus}</b>\n` +
      `  • Floating PnL: ${pnlIcon} <b>${pnlSign}$${unPnl.toFixed(2)} (${percentSign}${pnlPercent.toFixed(2)}%)</b>\n\n`;
  }

  const totalIcon = totalUnPnl >= 0 ? "🟢" : "🔴";
  const totalSign = totalUnPnl >= 0 ? "+" : "";

  const cb = await checkCircuitBreaker();
  const cbText = cb.triggered
    ? `🚨 <b>AKTIF (Max -${config.maxDailyDrawdownPercent}% tercapai: -$${Math.abs(cb.currentLoss).toFixed(2)})</b>`
    : `🛡️ Normal (Batas Maks -${config.maxDailyDrawdownPercent}%)`;

  const msg =
    `⏱️ <b>UPDATE STATUS POSISI (Berkala)</b>\n\n` +
    `• <b>Total Posisi Aktif:</b> ${positions.length} koin\n` +
    `• <b>Total Floating PnL:</b> ${totalIcon} <b>${totalSign}$${totalUnPnl.toFixed(2)} USDT</b>\n` +
    `• <b>Circuit Breaker:</b> ${cbText}\n\n` +
    detailList +
    `<i>Ketik /positions untuk opsi kontrol & tutup posisi.</i>`;

  await sendMessage(msg);
}

export async function sendDailySummaryReport(): Promise<void> {
  try {
    const balance = await getBalance();
    const positions = await getPositions();
    const daily = storage.getDailyStats();

    const equity = balance ? parseFloat(balance.equity) || parseFloat(balance.balance) || 0 : 0;
    const walletBal = balance ? parseFloat(balance.balance) || 0 : 0;
    const unPnl = balance ? parseFloat(balance.unrealizedProfit) || 0 : 0;
    const unSign = unPnl >= 0 ? "+" : "";

    const winRate = daily.tradesCount > 0 ? ((daily.winCount / daily.tradesCount) * 100).toFixed(1) : "0.0";
    const finalNetProfit = daily.netProfit !== undefined ? daily.netProfit : daily.realizedPnl;
    const netSign = finalNetProfit >= 0 ? "+" : "";
    const grossSign = daily.realizedPnl >= 0 ? "+" : "";
    const pnlPercent = daily.startingBalance > 0 ? (finalNetProfit / daily.startingBalance) * 100 : 0;
    const percentSign = pnlPercent >= 0 ? "+" : "";
    const totalComm = daily.totalCommission || 0;
    const totalFund = daily.totalFunding || 0;

    const now = new Date();
    const dateStr = now.toLocaleDateString("id-ID", {
      timeZone: config.timeZone || "Asia/Jakarta",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    let openPosText = "";
    if (positions.length > 0) {
      openPosText = `\n💼 <b>Posisi Aktif (${positions.length} koin):</b>\n`;
      for (const p of positions) {
        const sideIcon = p.positionSide === "LONG" ? "🟢" : "🔴";
        const pUnPnl = parseFloat(p.unrealizedProfit) || 0;
        const pSign = pUnPnl >= 0 ? "+" : "";
        const pPnlIcon = pUnPnl >= 0 ? "🟢" : "🔴";
        openPosText += `• ${sideIcon} <b>${p.symbol}</b> (${p.positionSide} ${p.leverage}x): ${pPnlIcon} <b>${pSign}$${pUnPnl.toFixed(2)} USDT</b>\n`;
      }
    } else {
      openPosText = `\n💼 <b>Posisi Aktif:</b> <i>Tidak ada posisi terbuka saat ini.</i>\n`;
    }

    const unPnlIcon = unPnl >= 0 ? "🟢" : "🔴";
    const netIcon = finalNetProfit >= 0 ? "🟢" : "🔴";

    const msg =
      `📊 <b>RINGKASAN TRADING HARIAN (08:00 WIB)</b>\n` +
      `📅 <i>${dateStr}</i>\n\n` +
      `💰 <b>Kondisi Akun:</b>\n` +
      `• <b>Total Equity:</b> $${equity.toFixed(2)} USDT\n` +
      `• <b>Saldo Dompet:</b> $${walletBal.toFixed(2)} USDT\n` +
      `• <b>Floating PnL:</b> ${unPnlIcon} <b>${unSign}$${unPnl.toFixed(2)} USDT</b>\n\n` +
      `📈 <b>Performa Trading Hari Ini:</b>\n` +
      `• <b>Total Trade Selesai:</b> ${daily.tradesCount} (${daily.winCount} Menang / ${daily.lossCount} Kalah)\n` +
      `• <b>Win Rate:</b> ${winRate}%\n` +
      `• <b>Realized PnL (Gross):</b> ${grossSign}$${daily.realizedPnl.toFixed(2)} USDT\n` +
      `• <b>Total Fee Trading:</b> $${totalComm.toFixed(2)} USDT\n` +
      `• <b>Total Funding Fee:</b> ${totalFund >= 0 ? "+" : ""}$${totalFund.toFixed(2)} USDT\n` +
      `• <b>Net Profit (Bersih):</b> ${netIcon} <b>${netSign}$${finalNetProfit.toFixed(2)} USDT (${percentSign}${pnlPercent.toFixed(2)}%)</b>\n` +
      openPosText +
      `\n<i>Semoga hari Anda produktif dan profit konsisten! 🚀</i>`;

    await sendMessage(msg);
    logger.info("Laporan ringkasan trade harian (08:00 WIB) berhasil dikirim ke Telegram.");
  } catch (err: any) {
    logger.error("Gagal mengirim laporan ringkasan harian:", err?.message || err);
  }
}

