import { Bot, InlineKeyboard, InputFile } from "grammy";
import { getBalance, getPositions, PositionData } from "../bingx/account.js";
import { closePositionMarket, placeStopLossOrder, placeTrailingStopOrder } from "../bingx/trade.js";
import { getMarketSentiment } from "../analysis/sentiment.js";
import { runMarketScan } from "../analysis/scanner.js";
import { checkCircuitBreaker } from "../execution/riskManager.js";
import { checkPositions } from "../execution/positionMonitor.js";
import { config, getActivePreset, setTradingMode, TradingMode } from "../config.js";
import { storage } from "../utils/storage.js";
import { logger } from "../utils/logger.js";
import { sendDailySummaryReport } from "./notifier.js";

function buildModeMessage(): { text: string; keyboard: InlineKeyboard } {
  const currentMode = storage.getTradingMode();
  const currentPreset = getActivePreset();

  const text =
    `🎛️ <b>PENGATURAN PRESET STRATEGI TRADING</b>\n\n` +
    `Mode Aktif Saat Ini: <b>${currentPreset.badge}</b> (${currentPreset.label})\n` +
    `<i>${currentPreset.description}</i>\n\n` +
    `📋 <b>Parameter Mode ${currentPreset.label}:</b>\n` +
    `• <b>Strategi:</b> <code>Aggression Mark + Hourly ORB</code>\n` +
    `• <b>Timeframe Eksekusi:</b> <code>${currentPreset.timeframePrimary}</code> (Macro: <code>${currentPreset.timeframeTrend}</code>)\n` +
    `• <b>Opening Range (ORB):</b> <code>${currentPreset.orbMinutes} menit pertama</code>\n` +
    `• <b>Absorption Threshold:</b> <code>${currentPreset.absorptionThreshold}x StDev</code>\n` +
    `• <b>Interval Pemindaian:</b> Setiap <code>${currentPreset.scanIntervalMinutes} menit</code>\n` +
    `• <b>Target Token:</b> Top <code>${currentPreset.topVolumeLimit} Koin</code> Volume Tertinggi\n` +
    `• <b>Interval Monitor:</b> Setiap <code>${currentPreset.monitorIntervalSeconds} detik</code>\n` +
    `• <b>Safety Stop Loss:</b> <code>${currentPreset.minSlPercent}% – ${currentPreset.maxSlPercent}%</code>\n` +
    `• <b>Break-Even Trigger:</b> <code>+${currentPreset.breakEvenTriggerR}R</code>\n` +
    `• <b>Trailing TP Activation:</b> <code>+${currentPreset.trailingActivationR}R</code> (Callback: ${(currentPreset.trailingMinCallbackRate * 100).toFixed(1)}% – ${(currentPreset.trailingMaxCallbackRate * 100).toFixed(1)}%)\n\n` +
    `👇 <i>Klik salah satu tombol di bawah untuk beralih mode secara instan:</i>`;

  const keyboard = new InlineKeyboard();
  if (currentMode === "scalping") {
    keyboard
      .text("✅ ⚡ ORB Scalp 1m (Aktif)", "noop")
      .row()
      .text("📊 Switch ke ORB Daytrade 5m", "set_mode:daytrade");
  } else {
    keyboard
      .text("⚡ Switch ke ORB Scalp 1m", "set_mode:scalping")
      .row()
      .text("✅ 📊 ORB Daytrade 5m (Aktif)", "noop");
  }

  return { text, keyboard };
}

export function registerBotCommands(bot: Bot) {
  // /start
  bot.command("start", async (ctx) => {
    const chatId = String(ctx.chat.id);
    storage.setChatId(chatId);

    const preset = getActivePreset();
    const text =
      `👋 <b>Halo! BingX Futures Trading Bot siap melayani Anda 24/7.</b>\n\n` +
      `Mode Saat Ini: <b>${preset.badge}</b> (${preset.label})\n` +
      `Chat ID Anda (<code>${chatId}</code>) telah didaftarkan untuk menerima seluruh alert dan laporan.\n\n` +
      `<b>Daftar Perintah:</b>\n` +
      `• /mode - Pilih preset mode (Scalping / Day Trade)\n` +
      `• /status - Cek status bot & ringkasan performa\n` +
      `• /balance - Cek saldo wallet & floating PnL\n` +
      `• /positions - Daftar posisi terbuka & tombol tutup\n` +
      `• /summary - Ringkasan trading harian (08:00 WIB)\n` +
      `• /history - Total akumulasi & performa semua trade\n` +
      `• /sentiment - Indeks Fear & Greed dan funding rate\n` +
      `• /scan - Jalankan scanner pasar sekarang\n` +
      `• /pause - Jeda pembukaan posisi otomatis\n` +
      `• /resume - Lanjutkan pembukaan posisi otomatis\n` +
      `• /help - Tampilkan bantuan`;

    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // /help
  bot.command("help", async (ctx) => {
    const text =
      `📖 <b>Bantuan & Perintah Bot</b>\n\n` +
      `• <code>/mode</code> : Pilih preset strategi (Scalping 3m / Day Trade 15m)\n` +
      `• <code>/status</code> : Status uptime, mode bot, & statistik harian\n` +
      `• <code>/balance</code> : Saldo USDT, margin terpakai, & PnL berjalan\n` +
      `• <code>/positions</code> : Monitoring posisi aktif saat ini\n` +
      `• <code>/summary</code> : Laporan ringkasan harian (pukul 08:00 WIB)\n` +
      `• <code>/history</code> : Total statistik & performa seluruh history trade\n` +
      `• <code>/sentiment</code> : Kondisi Fear & Greed pasar kripto\n` +
      `• <code>/scan</code> : Scan token volume tertinggi manual\n` +
      `• <code>/pause</code> : Hentikan sementara auto-trade\n` +
      `• <code>/resume</code> : Aktifkan kembali auto-trade`;
    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // /mode
  bot.command("mode", async (ctx) => {
    const { text, keyboard } = buildModeMessage();
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  });

  // /summary
  bot.command("summary", async (ctx) => {
    await sendDailySummaryReport();
  });

  // /history (alias: /trades, /total)
  bot.command(["history", "trades", "total"], async (ctx) => {
    try {
      const stats = storage.getTradeHistoryStats();
      const history = storage.getTradeHistory();

      if (stats.totalTrades === 0) {
        await ctx.reply("ℹ️ Belum ada riwayat transaksi trade yang tersimpan di sistem bot.");
        return;
      }

      const winRateStr = stats.winRate.toFixed(1);
      const grossSign = stats.totalRealizedPnl >= 0 ? "+" : "";
      const netSign = stats.totalNetProfit >= 0 ? "+" : "";
      const netIcon = stats.totalNetProfit >= 0 ? "🟢" : "🔴";
      const avgSign = stats.avgNetProfit >= 0 ? "+" : "";
      const pfStr = stats.profitFactor > 0 ? stats.profitFactor.toFixed(2) : "-";

      let reasonText = "";
      if (stats.reasonCounts["TRAILING_TP"]) reasonText += `• Trailing TP: <b>${stats.reasonCounts["TRAILING_TP"]}</b>\n`;
      if (stats.reasonCounts["TAKE_PROFIT"]) reasonText += `• Fixed TP: <b>${stats.reasonCounts["TAKE_PROFIT"]}</b>\n`;
      if (stats.reasonCounts["STOP_LOSS"]) reasonText += `• Stop Loss: <b>${stats.reasonCounts["STOP_LOSS"]}</b>\n`;
      if (stats.reasonCounts["BREAK_EVEN"]) reasonText += `• Break-Even: <b>${stats.reasonCounts["BREAK_EVEN"]}</b>\n`;
      if (stats.reasonCounts["MANUAL_CLOSE"]) reasonText += `• Manual Close: <b>${stats.reasonCounts["MANUAL_CLOSE"]}</b>\n`;

      let bestWorstText = "";
      if (stats.bestTrade) {
        const b = stats.bestTrade;
        const bNet = b.netProfit !== undefined ? b.netProfit : b.realizedPnl;
        const bSign = bNet >= 0 ? "+" : "";
        bestWorstText += `🏆 <b>Trade Terbaik:</b> ${b.symbol} (${b.side}) <b>${bSign}$${bNet.toFixed(2)}</b> (+${b.pnlPercent.toFixed(1)}%)\n`;
      }
      if (stats.worstTrade) {
        const w = stats.worstTrade;
        const wNet = w.netProfit !== undefined ? w.netProfit : w.realizedPnl;
        const wSign = wNet >= 0 ? "+" : "";
        bestWorstText += `⚠️ <b>Trade Terburuk:</b> ${w.symbol} (${w.side}) <b>${wSign}$${wNet.toFixed(2)}</b> (${w.pnlPercent.toFixed(1)}%)\n`;
      }

      // 5 riwayat transaksi terakhir (diurutkan dari yang terbaru)
      const recent = [...history].reverse().slice(0, 5);
      let recentText = `\n📋 <b>5 Transaksi Terakhir:</b>\n`;
      for (const t of recent) {
        const tNet = t.netProfit !== undefined ? t.netProfit : (t.pnlUsdt || 0);
        const tSign = tNet >= 0 ? "+" : "";
        const tIcon = tNet >= 0 ? "🟢" : "🔴";
        const sideIcon = t.side === "LONG" ? "🟢" : "🔴";
        const dateStr = t.closedAt
          ? new Date(t.closedAt).toLocaleDateString("id-ID", {
              timeZone: config.timeZone || "Asia/Jakarta",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "-";

        recentText +=
          `${sideIcon} <b>${t.symbol}</b> (${t.side}) • <i>${t.reason}</i>\n` +
          `  Net: ${tIcon} <b>${tSign}$${tNet.toFixed(2)} USDT</b> (${t.pnlPercent >= 0 ? "+" : ""}${t.pnlPercent.toFixed(1)}%) | <i>${dateStr}</i>\n`;
      }

      const text =
        `📜 <b>TOTAL REKAPITULASI TRADE (ALL-TIME)</b>\n\n` +
        `📊 <b>Statistik Performa:</b>\n` +
        `• <b>Total Transaksi Selesai:</b> ${stats.totalTrades} trade\n` +
        `• <b>Win / Loss:</b> ${stats.winCount} Menang / ${stats.lossCount} Kalah${stats.breakEvenCount > 0 ? ` / ${stats.breakEvenCount} BE` : ""}\n` +
        `• <b>Win Rate:</b> <b>${winRateStr}%</b>\n` +
        `• <b>Profit Factor:</b> <b>${pfStr}</b>\n\n` +
        `💰 <b>Akumulasi Finansial:</b>\n` +
        `• <b>Realized PnL (Kotor):</b> ${grossSign}$${stats.totalRealizedPnl.toFixed(2)} USDT\n` +
        `• <b>Total Biaya Trading (Fee):</b> -$${Math.abs(stats.totalCommission).toFixed(2)} USDT\n` +
        `• <b>Total Funding Fee:</b> ${stats.totalFunding >= 0 ? "+" : ""}$${stats.totalFunding.toFixed(2)} USDT\n` +
        `• <b>Total Net Profit (Bersih):</b> ${netIcon} <b>${netSign}$${stats.totalNetProfit.toFixed(2)} USDT</b>\n` +
        `• <b>Rata-rata Net / Trade:</b> ${avgSign}$${stats.avgNetProfit.toFixed(2)} USDT\n\n` +
        `🎯 <b>Distribusi Exit:</b>\n` +
        (reasonText || "• Tidak ada data\n") +
        `\n` +
        bestWorstText +
        recentText;

      await ctx.reply(text, { parse_mode: "HTML" });
    } catch (err: any) {
      logger.error("Error pada perintah /history:", err);
      await ctx.reply(`❌ Error menampilkan ringkasan history: ${err?.message || err}`);
    }
  });


  // /status
  bot.command("status", async (ctx) => {
    const uptimeMinutes = Math.floor(process.uptime() / 60);
    const uptimeHours = (uptimeMinutes / 60).toFixed(1);
    const envText = config.bingxEnv === "prod-live" ? "🔴 Live (Uang Asli)" : "🟢 VST (Simulasi)";
    const pauseText = storage.isPaused() ? "⏸️ <b>DI-PAUSE</b>" : "▶️ <b>BERJALAN AKTIF</b>";

    const cb = await checkCircuitBreaker();
    const cbText = cb.triggered
      ? `🚨 <b>AKTIF (Max Drawdown -${config.maxDailyDrawdownPercent}% Tercapai)</b>`
      : `🛡️ Normal (Batas Maks -${config.maxDailyDrawdownPercent}%)`;

    const daily = storage.getDailyStats();
    const winRate = daily.tradesCount > 0 ? ((daily.winCount / daily.tradesCount) * 100).toFixed(1) : "0";
    const grossSign = daily.realizedPnl >= 0 ? "+" : "";
    const finalNet = daily.netProfit !== undefined ? daily.netProfit : daily.realizedPnl;
    const netSign = finalNet >= 0 ? "+" : "";
    const currentPreset = getActivePreset();

    const text =
      `📊 <b>STATUS SISTEM BOT (24/7 PM2)</b>\n\n` +
      `• <b>Uptime:</b> ${uptimeMinutes} menit (${uptimeHours} jam)\n` +
      `• <b>Environment:</b> ${envText}\n` +
      `• <b>Mode Preset:</b> <b>${currentPreset.badge}</b> (${currentPreset.label})\n` +
      `• <b>Timeframe:</b> ${currentPreset.timeframePrimary} (Entry) & ${currentPreset.timeframeTrend} (Trend)\n` +
      `• <b>Scanner:</b> Setiap ${currentPreset.scanIntervalMinutes}m (Top ${currentPreset.topVolumeLimit} Coins)\n` +
      `• <b>Status Auto-Trade:</b> ${pauseText}\n` +
      `• <b>Circuit Breaker:</b> ${cbText}\n\n` +
      `<b>Statistik Hari Ini (${daily.date}):</b>\n` +
      `• Total Trade: ${daily.tradesCount} (${daily.winCount} Menang / ${daily.lossCount} Kalah)\n` +
      `• Win Rate: ${winRate}%\n` +
      `• Realized PnL (Gross): ${grossSign}$${daily.realizedPnl.toFixed(2)}\n` +
      `• Net Profit (Bersih): ${finalNet >= 0 ? "🟢" : "🔴"} <b>${netSign}$${finalNet.toFixed(2)}</b>`;

    const statusKeyboard = new InlineKeyboard().text("🎛️ Ganti Preset Mode", "open_mode_menu");
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: statusKeyboard });
  });

  // /balance
  bot.command("balance", async (ctx) => {
    try {
      const balance = await getBalance();
      if (!balance) {
        await ctx.reply("❌ Gagal mengambil data saldo dari BingX.");
        return;
      }

      const equity = parseFloat(balance.equity) || parseFloat(balance.balance) || 0;
      const walletBal = parseFloat(balance.balance) || 0;
      const available = parseFloat(balance.availableMargin) || 0;
      const unPnl = parseFloat(balance.unrealizedProfit) || 0;
      const pnlSign = unPnl >= 0 ? "+" : "";

      const text =
        `💰 <b>SALDO AKUN USDT-M FUTURES</b>\n\n` +
        `• <b>Total Equity:</b> $${equity.toFixed(2)} USDT\n` +
        `• <b>Saldo Dompet:</b> $${walletBal.toFixed(2)} USDT\n` +
        `• <b>Margin Tersedia:</b> $${available.toFixed(2)} USDT\n` +
        `• <b>Floating PnL:</b> ${unPnl >= 0 ? "🟢" : "🔴"} <b>${pnlSign}$${unPnl.toFixed(2)} USDT</b>`;

      await ctx.reply(text, { parse_mode: "HTML" });
    } catch (err: any) {
      if (err?.message?.includes("100410")) {
        await ctx.reply("⏳ <i>Server BingX sedang membatasi frekuensi request (Rate Limit). Silakan tunggu sekitar 15-30 detik lalu ketik /balance kembali.</i>", { parse_mode: "HTML" });
      } else {
        await ctx.reply(`❌ Error mengambil saldo: ${err?.message || err}`);
      }
    }
  });

function buildPositionCard(pos: PositionData): { text: string; keyboard: InlineKeyboard } {
  const sideIcon = pos.positionSide === "LONG" ? "🟢" : "🔴";
  const amt = Math.abs(parseFloat(pos.positionAmt));
  const entry = parseFloat(pos.avgPrice) || parseFloat(pos.entryPrice);
  const mark = parseFloat(pos.markPrice) || 0;
  const unPnl = parseFloat(pos.unrealizedProfit) || 0;
  const pnlSign = unPnl >= 0 ? "+" : "";
  const pnlIcon = unPnl >= 0 ? "🟢" : "🔴";
  const liq = parseFloat(String(pos.liquidationPrice)) || 0;
  const marginMode = pos.marginType || (pos.isolated ? "ISOLATED" : "CROSSED");

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

  const text =
    `${sideIcon} <b>${pos.symbol}</b> (${pos.positionSide})\n\n` +
    `• <b>Jumlah:</b> ${amt} koin (${pos.leverage}x ${marginMode})\n` +
    `• <b>Entry:</b> $${entry}\n` +
    `• <b>Mark Price:</b> $${mark}\n` +
    `• <b>Stop Loss:</b> ${slText}\n` +
    `• <b>Break-Even:</b> <b>${beStatus}</b>\n` +
    `• <b>Take Profit:</b> ${tpText}\n` +
    `• <b>Trailing TP:</b> <b>${trailingStatus}</b>\n` +
    `• <b>Floating PnL:</b> ${pnlIcon} <b>${pnlSign}$${unPnl.toFixed(2)} USDT</b>\n` +
    `• <b>Harga Likuidasi:</b> $${liq}`;

  const keyboard = new InlineKeyboard()
    .text("🛡️ Set Break-Even", `be_${pos.symbol}`)
    .text("🚀 Aktifkan Trailing TP", `trailing_${pos.symbol}`)
    .row()
    .text(`❌ Tutup Posisi`, `close_${pos.symbol}_${pos.positionSide}_${amt}`)
    .text(`🔄 Refresh Status`, `refresh_${pos.symbol}`);

  return { text, keyboard };
}

  // /positions
  bot.command("positions", async (ctx) => {
    try {
      const positions = await getPositions();
      if (positions.length === 0) {
        await ctx.reply("ℹ️ Saat ini tidak ada posisi terbuka di BingX Futures.");
        return;
      }

      for (const pos of positions) {
        const { text, keyboard } = buildPositionCard(pos);
        await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
      }
    } catch (err: any) {
      await ctx.reply(`❌ Error mengambil posisi: ${err?.message || err}`);
    }
  });

  // /sentiment
  bot.command("sentiment", async (ctx) => {
    try {
      await ctx.reply("⏳ Mengambil data sentimen pasar...", { parse_mode: "HTML" });
      const sentiment = await getMarketSentiment();

      const fng = sentiment.fearAndGreed;
      let moodEmoji = "😐";
      if (fng.value >= 75) moodEmoji = "🤑";
      else if (fng.value >= 55) moodEmoji = "😊";
      else if (fng.value <= 25) moodEmoji = "😱";
      else if (fng.value <= 45) moodEmoji = "😨";

      const avgFundingPercent = (sentiment.averageFundingRate * 100).toFixed(4);

      const text =
        `🧠 <b>SENTIMEN PASAR KRIPTO</b>\n\n` +
        `• <b>Fear & Greed Index:</b> ${fng.value}/100 (${fng.classification}) ${moodEmoji}\n` +
        `• <b>Rata-rata Funding Rate:</b> ${avgFundingPercent}%\n` +
        `• <b>Kondisi Ekstrem:</b> ${
          sentiment.isExtremeGreed
            ? "⚠️ Extreme Greed (Hati-hati Long)"
            : sentiment.isExtremeFear
            ? "⚠️ Extreme Fear (Hati-hati Short)"
            : "Normal / Netral"
        }`;

      await ctx.reply(text, { parse_mode: "HTML" });
    } catch (err: any) {
      await ctx.reply(`❌ Error mengambil sentimen: ${err?.message || err}`);
    }
  });

  // /scan
  bot.command("scan", async (ctx) => {
    try {
      const cb = await checkCircuitBreaker();
      let headerNote = "";
      if (cb.triggered) {
        headerNote =
          `⚠️ <b>PERINGATAN: CIRCUIT BREAKER AKTIF!</b>\n` +
          `• Batas kerugian harian (-${config.maxDailyDrawdownPercent}%) telah tercapai.\n` +
          `• Kerugian hari ini: -$${Math.abs(cb.currentLoss).toFixed(2)} (${cb.drawdownPercent.toFixed(1)}%).\n` +
          `• Auto-Trade otomatis dimatikan sampai reset harian.\n` +
          `<i>ℹ️ Hasil pemindaian di bawah ini HANYA untuk referensi/pantauan manual:</i>\n\n`;
      }

      await ctx.reply("🔎 Memulai scanner dinamis pasar... Mohon tunggu ~10 detik.", {
        parse_mode: "HTML",
      });
      const signals = await runMarketScan();

      if (signals.length === 0) {
        await ctx.reply(`${headerNote}ℹ️ Pemindaian selesai. Belum ditemukan peluang sinyal dengan skor tinggi saat ini.`, {
          parse_mode: "HTML",
        });
        return;
      }

      let text = `${headerNote}🎯 <b>HASIL PEMINDAIAN PASAR (${signals.length} Sinyal Ditemukan):</b>\n\n`;
      for (const s of signals.slice(0, 5)) {
        const icon = s.positionSide === "LONG" ? "🟢" : "🔴";
        const escapedReasons = s.reasons.map((r) => r.replace(/</g, "&lt;").replace(/>/g, "&gt;")).join(", ");
        text +=
          `${icon} <b>${s.symbol}</b> (${s.positionSide})\n` +
          `• Skor: ${s.score}/100 | Entry: $${s.entryPrice}\n` +
          `• SL: $${s.stopLossPrice} | TP: $${s.takeProfitPrice}\n` +
          `• Alasan: ${escapedReasons}\n\n`;
      }

      await ctx.reply(text, { parse_mode: "HTML" });

      const topSignal = signals[0];
      if (topSignal && topSignal.chartBuffer && topSignal.chartBuffer.length > 0) {
        await ctx.replyWithPhoto(new InputFile(topSignal.chartBuffer, `${topSignal.symbol}_snapshot.png`), {
          caption: `📊 <b>Visual Chart Setup: ${topSignal.symbol} (${topSignal.positionSide})</b>\n• Strategi: Hourly ORB + Aggression Mark\n• Score: ${topSignal.score}/100 | SL: $${topSignal.stopLossPrice} | TP: $${topSignal.takeProfitPrice}`,
          parse_mode: "HTML",
        });
      }
    } catch (err: any) {
      await ctx.reply(`❌ Error saat pemindaian: ${err?.message || err}`);
    }
  });

  // /pause
  bot.command("pause", async (ctx) => {
    storage.setPaused(true);
    await ctx.reply("⏸️ <b>Auto-Trade telah DI-PAUSE.</b> Bot tidak akan membuka posisi baru otomatis.", {
      parse_mode: "HTML",
    });
  });

  // /resume
  bot.command("resume", async (ctx) => {
    storage.setPaused(false);
    await ctx.reply("▶️ <b>Auto-Trade telah DIAKTIFKAN KEMBALI.</b> Bot akan memindai & mengeksekusi order otomatis.", {
      parse_mode: "HTML",
    });
  });

  // Callback query: Tutup Posisi Manual & Ganti Preset Mode via tombol inline
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data === "noop") {
      await ctx.answerCallbackQuery({ text: "Preset mode ini sudah aktif saat ini." });
      return;
    }

    if (data === "open_mode_menu") {
      const { text, keyboard } = buildModeMessage();
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("set_mode:")) {
      const targetMode = data.replace("set_mode:", "") as TradingMode;
      const currentMode = storage.getTradingMode();

      if (targetMode === currentMode) {
        await ctx.answerCallbackQuery({ text: "Preset mode ini sudah aktif!" });
        return;
      }

      const newPreset = setTradingMode(targetMode);
      await ctx.answerCallbackQuery({ text: `Mode berhasil diubah ke ${newPreset.badge}!` });

      const { text, keyboard } = buildModeMessage();
      const updatedText =
        `✅ <b>BERHASIL BERGANTI PRESET KE ${newPreset.badge}!</b>\n\n` +
        `Jadwal pemindaian pasar & interval pemantauan posisi telah disesuaikan secara otomatis.\n\n` +
        text;

      try {
        await ctx.editMessageText(updatedText, { parse_mode: "HTML", reply_markup: keyboard });
      } catch {
        await ctx.reply(updatedText, { parse_mode: "HTML", reply_markup: keyboard });
      }
      return;
    }

    if (data.startsWith("be_")) {
      const symbol = data.split("_")[1];
      try {
        await ctx.answerCallbackQuery({ text: `Memproses Break-Even untuk ${symbol}...` });
        const positions = await getPositions(symbol, true);
        const livePos = positions.find((p) => p.symbol === symbol);
        if (!livePos || Math.abs(parseFloat(livePos.positionAmt)) === 0) {
          await ctx.answerCallbackQuery({ text: "Posisi sudah tidak aktif atau tertutup." });
          return;
        }

        let managed = storage.getManagedPosition(symbol);
        const entryPrice = parseFloat(livePos.avgPrice) || parseFloat(livePos.entryPrice) || (managed?.entryPrice ?? 0);
        const side = (livePos.positionSide as "LONG" | "SHORT") || managed?.positionSide || "LONG";
        const quantity = Math.abs(parseFloat(livePos.positionAmt));

        // Buffer 0.12% untuk meng-cover komisi taker roundtrip (open + close + slippage)
        const bePrice = side === "LONG"
          ? Number((entryPrice * 1.0012).toFixed(6))
          : Number((entryPrice * 0.9988).toFixed(6));

        await placeStopLossOrder({
          symbol,
          positionSide: side,
          quantity,
          stopPrice: bePrice,
        });

        if (!managed) {
          managed = {
            symbol,
            positionSide: side,
            entryPrice,
            quantity,
            leverage: livePos.leverage || config.defaultLeverage,
            initialSl: bePrice,
            currentSl: bePrice,
            initialTp: 0,
            isBreakEvenApplied: true,
            highestPrice: entryPrice,
            lowestPrice: entryPrice,
            openedAt: Date.now(),
          };
        } else {
          managed.isBreakEvenApplied = true;
          managed.currentSl = bePrice;
        }
        storage.saveManagedPosition(managed);

        await ctx.reply(
          `🛡️ <b>BREAK-EVEN BERHASIL DIAKTIFKAN!</b>\n\n` +
          `• <b>Token:</b> <code>${symbol}</code> (${side})\n` +
          `• <b>Stop Loss Baru:</b> $${bePrice} (Entry + 0.12% Taker Fee Buffer)\n` +
          `<i>Trade ini sekarang bebas risiko (Risk-Free).</i>`,
          { parse_mode: "HTML" }
        );

        try {
          const updated = buildPositionCard(livePos);
          await ctx.editMessageText(updated.text, { parse_mode: "HTML", reply_markup: updated.keyboard });
        } catch {}
      } catch (err: any) {
        logger.error(`Gagal memindahkan SL ke Break-Even untuk ${symbol}:`, err);
        await ctx.reply(`❌ Gagal mengaktifkan Break-Even: ${err?.message || err}`);
      }
      return;
    }

    if (data.startsWith("trailing_")) {
      const symbol = data.split("_")[1];
      try {
        await ctx.answerCallbackQuery({ text: `Mengaktifkan Trailing TP untuk ${symbol}...` });
        const positions = await getPositions(symbol, true);
        const livePos = positions.find((p) => p.symbol === symbol);
        if (!livePos || Math.abs(parseFloat(livePos.positionAmt)) === 0) {
          await ctx.answerCallbackQuery({ text: "Posisi sudah tidak aktif atau tertutup." });
          return;
        }

        let managed = storage.getManagedPosition(symbol);
        const side = (livePos.positionSide as "LONG" | "SHORT") || managed?.positionSide || "LONG";
        const quantity = Math.abs(parseFloat(livePos.positionAmt));
        const markPrice = parseFloat(livePos.markPrice) || parseFloat(livePos.avgPrice) || 0;
        const preset = getActivePreset();
        const callbackRate = managed?.trailingCallbackRate || preset.trailingMinCallbackRate || 0.01;

        // Pasang order Trailing Stop Market ke BingX
        await placeTrailingStopOrder({
          symbol,
          positionSide: side,
          quantity,
          activationPrice: markPrice,
          priceRate: callbackRate,
        });

        if (!managed) {
          managed = {
            symbol,
            positionSide: side,
            entryPrice: markPrice,
            quantity,
            leverage: livePos.leverage || config.defaultLeverage,
            initialSl: 0,
            currentSl: 0,
            initialTp: 0,
            isBreakEvenApplied: false,
            isTrailingActive: true,
            trailingActivationPrice: markPrice,
            trailingCallbackRate: callbackRate,
            highestPrice: markPrice,
            lowestPrice: markPrice,
            openedAt: Date.now(),
          };
        } else {
          managed.isTrailingActive = true;
          managed.trailingActivationPrice = markPrice;
          managed.trailingCallbackRate = callbackRate;
        }
        storage.saveManagedPosition(managed);

        const cbPercent = (callbackRate * 100).toFixed(1);
        await ctx.reply(
          `🚀 <b>TRAILING TAKE PROFIT DIAKTIFKAN!</b>\n\n` +
          `• <b>Token:</b> <code>${symbol}</code> (${side})\n` +
          `• <b>Harga Aktivasi:</b> $${markPrice} (Harga Saat Ini)\n` +
          `• <b>Callback Rate:</b> ${cbPercent}%\n` +
          `<i>Server BingX akan mengunci keuntungan secara dinamis mengikuti puncak harga!</i>`,
          { parse_mode: "HTML" }
        );

        try {
          const updated = buildPositionCard(livePos);
          await ctx.editMessageText(updated.text, { parse_mode: "HTML", reply_markup: updated.keyboard });
        } catch {}
      } catch (err: any) {
        logger.error(`Gagal mengaktifkan Trailing TP manual untuk ${symbol}:`, err);
        await ctx.reply(`❌ Gagal mengaktifkan Trailing TP: ${err?.message || err}`);
      }
      return;
    }

    if (data.startsWith("refresh_")) {
      const symbol = data.split("_")[1];
      try {
        await ctx.answerCallbackQuery({ text: `Memperbarui status ${symbol}...` });
        const positions = await getPositions(symbol, true);
        const livePos = positions.find((p) => p.symbol === symbol);
        if (!livePos || Math.abs(parseFloat(livePos.positionAmt)) === 0) {
          await ctx.editMessageText(
            `ℹ️ <b>Posisi ${symbol} saat ini sudah tidak aktif / tertutup.</b>`,
            { parse_mode: "HTML" }
          );
          return;
        }

        const updated = buildPositionCard(livePos);
        await ctx.editMessageText(updated.text, { parse_mode: "HTML", reply_markup: updated.keyboard });
      } catch (err: any) {
        logger.debug(`Refresh error: ${err?.message || err}`);
        await ctx.answerCallbackQuery({ text: "Gagal memperbarui status posisi." });
      }
      return;
    }

    if (data.startsWith("close_")) {
      const parts = data.split("_");
      const symbol = parts[1];
      const positionSide = parts[2] as "LONG" | "SHORT";
      const quantity = parseFloat(parts[3]);

      try {
        await ctx.answerCallbackQuery({ text: `Menutup posisi ${symbol}...` });
        await closePositionMarket({ symbol, positionSide, quantity });

        await ctx.editMessageText(
          `✅ <b>Posisi ${symbol} (${positionSide}) berhasil ditutup secara manual!</b>\n<i>Membuat visual recap & kalkulasi PnL...</i>`,
          { parse_mode: "HTML" }
        );

        // Beri jeda 1.2 detik agar server BingX memperbarui riwayat order, lalu buat visual recap
        setTimeout(() => checkPositions().catch(() => {}), 1200);
      } catch (err: any) {
        logger.error(`Gagal menutup posisi ${symbol}:`, err);
        await ctx.reply(`❌ Gagal menutup posisi ${symbol}: ${err?.message || err}`);
      }
    }
  });
}
