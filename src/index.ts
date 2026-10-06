import { config, validateConfig } from "./config.js";
import { logger } from "./utils/logger.js";
import { storage } from "./utils/storage.js";
import { getPositions } from "./bingx/account.js";
import { startTelegramBot, bot } from "./telegram/bot.js";
import {
  notifyBotStarted,
  notifyOpenPositionsUpdate,
  sendDailySummaryReport,
} from "./telegram/notifier.js";
import { runMarketScan } from "./analysis/scanner.js";
import { validateAndSizeTrade } from "./execution/riskManager.js";
import { executeTrade } from "./execution/orderExecutor.js";
import { checkPositions } from "./execution/positionMonitor.js";
import { startSwapWebSocket, stopWebSocket } from "./bingx/ws.js";

let scanTimer: NodeJS.Timeout | null = null;
let monitorTimer: NodeJS.Timeout | null = null;
let updatePositionsTimer: NodeJS.Timeout | null = null;
let dailySummaryTimer: NodeJS.Timeout | null = null;
let lastDailySummaryDate = "";
let isScanning = false;

async function executeScanCycle() {
  if (isScanning) return;

  // 1. Lewati jika auto-trade sedang di-pause oleh user
  if (storage.isPaused()) {
    logger.info("Auto-Trade sedang di-pause oleh user. Pemindaian pasar dilewati.");
    return;
  }

  // 2. Cek apakah kapasitas posisi aktif sudah penuh (misal 3/3)
  try {
    const openPositions = await getPositions();
    if (openPositions.length >= config.maxConcurrentPositions) {
      logger.info(
        `Kapasitas posisi aktif sudah penuh (${openPositions.length}/${config.maxConcurrentPositions}). Pemindaian pasar otomatis dilewati untuk menghemat kuota API.`
      );
      return;
    }
  } catch (err: any) {
    logger.debug("Gagal memeriksa posisi terbuka sebelum scan:", err?.message || err);
  }

  isScanning = true;

  try {
    const signals = await runMarketScan();

    if (signals.length > 0) {
      logger.info(`Ditemukan ${signals.length} sinyal dari pemindaian pasar.`);

      for (const signal of signals) {
        // Cek validasi risiko dan ukuran posisi
        const sizing = await validateAndSizeTrade(signal);

        if (sizing.allowed) {
          logger.trade(
            `Menyetujui eksekusi sinyal ${signal.symbol} (${signal.positionSide}). Ukuran: ${sizing.formattedQuantity} koin`
          );
          const success = await executeTrade(signal, sizing);
          if (success) {
            // Beri jeda 2 detik antar order jika ada lebih dari 1 sinyal
            await new Promise((r) => setTimeout(r, 2000));
          }
        } else {
          logger.debug(`Sinyal ${signal.symbol} dilewati: ${sizing.reason}`);
        }
      }
    }
  } catch (err: any) {
    logger.error("Terjadi error pada siklus pemindaian pasar:", err?.message || err);
  } finally {
    isScanning = false;
  }
}

async function bootstrap() {
  console.log(`
======================================================
  🤖 BINGX 24/7 USDT-M FUTURES TRADING BOT
  Integrasi Telegram & Dynamic Market Scanner
======================================================
  `);

  const { valid, warnings } = validateConfig();
  if (warnings.length > 0) {
    warnings.forEach((w) => logger.warn(`[CONFIG WARNING] ${w}`));
  }

  logger.info(`Environment: ${config.bingxEnv === "prod-live" ? "🔴 PROD-LIVE (Real Funds)" : "🟢 PROD-VST (Simulasi)"}`);
  logger.info(`Default Leverage: ${config.defaultLeverage}x (${config.marginType})`);
  logger.info(`Max Concurrent Positions: ${config.maxConcurrentPositions}`);
  logger.info(`Risk per Trade: ${config.riskPerTradePercent}%`);
  logger.info(`Scanner Interval: Setiap ${config.scanIntervalMinutes} menit`);
  logger.info(`Monitor Interval: Setiap ${config.monitorIntervalSeconds} detik`);

  // 1. Inisialisasi Telegram Bot
  await startTelegramBot();
  await notifyBotStarted();

  // 2. Inisialisasi WebSocket Stream (Realtime Account Updates)
  startSwapWebSocket((msg) => {
    logger.debug("Menerima WebSocket payload:", msg?.e || "event");
  });

  // 3. Jalankan Monitoring Posisi Terbuka 24/7 (setiap 15 detik)
  logger.info("Memulai background worker pemantauan posisi...");
  await checkPositions();
  monitorTimer = setInterval(async () => {
    await checkPositions();
  }, config.monitorIntervalSeconds * 1000);

  // 4. Jadwalkan update berkala status posisi terbuka (setiap 10 menit jika ada posisi terbuka)
  updatePositionsTimer = setInterval(async () => {
    try {
      const openPositions = await getPositions();
      if (openPositions.length > 0) {
        logger.info(`Mengirim notifikasi rekap status posisi terbuka (${openPositions.length} koin) ke Telegram...`);
        await notifyOpenPositionsUpdate(openPositions);
      }
    } catch (err: any) {
      logger.debug("Gagal mengirim update posisi 10 menit:", err?.message || err);
    }
  }, 10 * 60 * 1000);

  // 5. Jadwalkan Laporan Ringkasan Harian (Setiap pukul 08:00 WIB)
  const scheduledTimeStr = `${String(config.dailySummaryHour).padStart(2, "0")}:${String(config.dailySummaryMinute).padStart(2, "0")}`;
  logger.info(`Laporan ringkasan trade harian dijadwalkan setiap pukul ${scheduledTimeStr} (${config.timeZone}).`);

  dailySummaryTimer = setInterval(async () => {
    try {
      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-GB", { timeZone: config.timeZone, hour12: false });
      const [h, m] = timeStr.split(":").map(Number);
      const dateStr = now.toLocaleDateString("en-CA", { timeZone: config.timeZone });

      if (h === config.dailySummaryHour && m === config.dailySummaryMinute && lastDailySummaryDate !== dateStr) {
        lastDailySummaryDate = dateStr;
        logger.info(`Waktu menunjukkan ${scheduledTimeStr} ${config.timeZone}. Mengirim ringkasan harian...`);
        await sendDailySummaryReport();
      }
    } catch (err: any) {
      logger.debug("Error saat memeriksa jadwal ringkasan harian:", err?.message || err);
    }
  }, 30 * 1000);

  // 6. Jalankan Siklus Pertama Pemindaian Pasar
  logger.info("Menjalankan siklus pemindaian pasar perdana...");
  await executeScanCycle();

  // 7. Jadwalkan Siklus Pemindaian Rutin (setiap X menit)
  scanTimer = setInterval(async () => {
    await executeScanCycle();
  }, config.scanIntervalMinutes * 60 * 1000);

  logger.success("Seluruh modul bot telah aktif dan berjalan 24 jam!");
}

// Graceful Shutdown Handler
function gracefulShutdown(signal: string) {
  logger.warn(`Menerima sinyal shutdown (${signal}). Membersihkan proses...`);
  if (scanTimer) clearInterval(scanTimer);
  if (monitorTimer) clearInterval(monitorTimer);
  if (updatePositionsTimer) clearInterval(updatePositionsTimer);
  if (dailySummaryTimer) clearInterval(dailySummaryTimer);
  stopWebSocket();
  bot.stop();
  logger.info("Proses bot dihentikan secara aman.");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

process.on("unhandledRejection", (reason: any) => {
  logger.error("Unhandled Promise Rejection:", reason?.message || reason);
});

process.on("uncaughtException", (error: Error) => {
  logger.error("Uncaught Exception:", error.message, error.stack);
});

bootstrap();
