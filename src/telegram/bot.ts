import { Bot } from "grammy";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { registerBotCommands } from "./commands.js";

export const bot = new Bot(config.telegramBotToken || "DUMMY_TOKEN");

export async function startTelegramBot(): Promise<void> {
  if (!config.telegramBotToken) {
    logger.warn("TELEGRAM_BOT_TOKEN kosong di .env. Fitur bot Telegram tidak dijalankan.");
    return;
  }

  try {
    registerBotCommands(bot);

    // Daftarkan daftar command menu ke Telegram agar muncul di tombol [Menu /]
    try {
      await bot.api.setMyCommands([
        { command: "status", description: "Status bot & performa harian" },
        { command: "balance", description: "Cek saldo wallet & floating PnL" },
        { command: "positions", description: "Daftar posisi terbuka & opsi tutup" },
        { command: "summary", description: "Laporan ringkasan trade harian (08:00 WIB)" },
        { command: "history", description: "Total akumulasi & rekap semua trade history" },
        { command: "sentiment", description: "Indeks Fear & Greed pasar" },
        { command: "scan", description: "Scan Top 15 koin manual sekarang" },
        { command: "pause", description: "Hentikan sementara auto-trade" },
        { command: "resume", description: "Aktifkan kembali auto-trade" },
        { command: "help", description: "Panduan perintah bot" },
      ]);
      logger.info("Menu commands Telegram berhasil didaftarkan ke server Telegram.");
    } catch (cmdErr) {
      logger.warn("Peringatan saat mendaftarkan setMyCommands ke Telegram:", cmdErr);
    }

    // Jalankan bot dengan long polling
    bot.start({
      onStart: (botInfo) => {
        logger.success(`Telegram Bot berhasil tersambung sebagai @${botInfo.username}`);
      },
    });
  } catch (err) {
    logger.error("Gagal memulai Telegram Bot:", err);
  }
}
