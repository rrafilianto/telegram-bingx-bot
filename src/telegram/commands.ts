import { Bot, InlineKeyboard } from "grammy";
import { getBalance, getPositions } from "../bingx/account.js";
import { closePositionMarket } from "../bingx/trade.js";
import { getMarketSentiment } from "../analysis/sentiment.js";
import { runMarketScan } from "../analysis/scanner.js";
import { config } from "../config.js";
import { storage } from "../utils/storage.js";
import { logger } from "../utils/logger.js";
import { sendDailySummaryReport } from "./notifier.js";

export function registerBotCommands(bot: Bot) {
  // /start
  bot.command("start", async (ctx) => {
    const chatId = String(ctx.chat.id);
    storage.setChatId(chatId);

    const text =
      `👋 <b>Halo! BingX Futures Trading Bot siap melayani Anda 24/7.</b>\n\n` +
      `Chat ID Anda (<code>${chatId}</code>) telah didaftarkan untuk menerima seluruh alert dan laporan.\n\n` +
      `<b>Daftar Perintah:</b>\n` +
      `• /status - Cek status bot & ringkasan performa\n` +
      `• /balance - Cek saldo wallet & floating PnL\n` +
      `• /positions - Daftar posisi terbuka & tombol tutup\n` +
      `• /summary - Ringkasan trading harian (08:00 WIB)\n` +
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
      `• <code>/status</code> : Status uptime, mode bot, & statistik harian\n` +
      `• <code>/balance</code> : Saldo USDT, margin terpakai, & PnL berjalan\n` +
      `• <code>/positions</code> : Monitoring posisi aktif saat ini\n` +
      `• <code>/summary</code> : Laporan ringkasan harian (pukul 08:00 WIB)\n` +
      `• <code>/sentiment</code> : Kondisi Fear & Greed pasar kripto\n` +
      `• <code>/scan</code> : Scan Top 15 token volume tertinggi manual\n` +
      `• <code>/pause</code> : Hentikan sementara auto-trade\n` +
      `• <code>/resume</code> : Aktifkan kembali auto-trade`;
    await ctx.reply(text, { parse_mode: "HTML" });
  });

  // /summary
  bot.command("summary", async (ctx) => {
    await sendDailySummaryReport();
  });


  // /status
  bot.command("status", async (ctx) => {
    const uptimeMinutes = Math.floor(process.uptime() / 60);
    const uptimeHours = (uptimeMinutes / 60).toFixed(1);
    const envText = config.bingxEnv === "prod-live" ? "🔴 Live (Uang Asli)" : "🟢 VST (Simulasi)";
    const pauseText = storage.isPaused() ? "⏸️ <b>DI-PAUSE</b>" : "▶️ <b>BERJALAN AKTIF</b>";

    const daily = storage.getDailyStats();
    const winRate = daily.tradesCount > 0 ? ((daily.winCount / daily.tradesCount) * 100).toFixed(1) : "0";
    const grossSign = daily.realizedPnl >= 0 ? "+" : "";
    const finalNet = daily.netProfit !== undefined ? daily.netProfit : daily.realizedPnl;
    const netSign = finalNet >= 0 ? "+" : "";

    const text =
      `📊 <b>STATUS SISTEM BOT (24/7 PM2)</b>\n\n` +
      `• <b>Uptime:</b> ${uptimeMinutes} menit (${uptimeHours} jam)\n` +
      `• <b>Environment:</b> ${envText}\n` +
      `• <b>Status Auto-Trade:</b> ${pauseText}\n\n` +
      `<b>Statistik Hari Ini (${daily.date}):</b>\n` +
      `• Total Trade: ${daily.tradesCount} (${daily.winCount} Menang / ${daily.lossCount} Kalah)\n` +
      `• Win Rate: ${winRate}%\n` +
      `• Realized PnL (Gross): ${grossSign}$${daily.realizedPnl.toFixed(2)}\n` +
      `• Net Profit (Bersih): ${finalNet >= 0 ? "🟢" : "🔴"} <b>${netSign}$${finalNet.toFixed(2)}</b>`;

    await ctx.reply(text, { parse_mode: "HTML" });
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

  // /positions
  bot.command("positions", async (ctx) => {
    try {
      const positions = await getPositions();
      if (positions.length === 0) {
        await ctx.reply("ℹ️ Saat ini tidak ada posisi terbuka di BingX Futures.");
        return;
      }

      for (const pos of positions) {
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

        const keyboard = new InlineKeyboard().text(
          `❌ Tutup Posisi ${pos.symbol}`,
          `close_${pos.symbol}_${pos.positionSide}_${amt}`
        );

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
      await ctx.reply("🔎 Memulai scanner dinamis pasar... Mohon tunggu ~10 detik.", {
        parse_mode: "HTML",
      });
      const signals = await runMarketScan();

      if (signals.length === 0) {
        await ctx.reply("ℹ️ Pemindaian selesai. Belum ditemukan peluang sinyal dengan skor tinggi saat ini.");
        return;
      }

      let text = `🎯 <b>HASIL PEMINDAIAN PASAR (${signals.length} Sinyal Ditemukan):</b>\n\n`;
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

  // Callback query: Tutup Posisi Manual via tombol inline
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data.startsWith("close_")) {
      const parts = data.split("_");
      const symbol = parts[1];
      const positionSide = parts[2] as "LONG" | "SHORT";
      const quantity = parseFloat(parts[3]);

      try {
        await ctx.answerCallbackQuery({ text: `Menutup posisi ${symbol}...` });
        await closePositionMarket({ symbol, positionSide, quantity });
        storage.removeManagedPosition(symbol);

        await ctx.editMessageText(
          `✅ <b>Posisi ${symbol} (${positionSide}) berhasil ditutup secara manual!</b>`,
          { parse_mode: "HTML" }
        );
      } catch (err: any) {
        logger.error(`Gagal menutup posisi ${symbol}:`, err);
        await ctx.reply(`❌ Gagal menutup posisi ${symbol}: ${err?.message || err}`);
      }
    }
  });
}
