import dotenv from "dotenv";
dotenv.config();

export interface BotConfig {
  // BingX Credentials & Environment
  bingxApiKey: string;
  bingxSecretKey: string;
  bingxEnv: "prod-live" | "prod-vst";

  // Telegram Settings
  telegramBotToken: string;
  telegramChatId: string;

  // Trading & Risk Parameters
  defaultLeverage: number;
  marginType: "ISOLATED" | "CROSSED";
  maxConcurrentPositions: number;
  riskPerTradePercent: number;
  maxDailyDrawdownPercent: number;
  cooldownMinutesAfterLoss: number;
  
  // Scanner & Strategy Parameters
  scanIntervalMinutes: number;
  monitorIntervalSeconds: number;
  topVolumeLimit: number;
  timeframePrimary: string;
  timeframeTrend: string;
  rrRatio: number;
  atrMultiplierSl: number;
  breakEvenTriggerR: number;
  trailingStopPercent: number;
  trailingActivationR: number;
  trailingAtrMultiplier: number;
  trailingMinCallbackRate: number;
  trailingMaxCallbackRate: number;
  dailySummaryHour: number;
  dailySummaryMinute: number;
  timeZone: string;
  blacklistSymbols: string[];
}

function parseEnvString(key: string, defaultValue = ""): string {
  return process.env[key]?.trim() || defaultValue;
}

function parseEnvNumber(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (!val) return defaultValue;
  const num = Number(val);
  return isNaN(num) ? defaultValue : num;
}

export const config: BotConfig = {
  bingxApiKey: parseEnvString("BINGX_API_KEY"),
  bingxSecretKey: parseEnvString("BINGX_SECRET_KEY"),
  bingxEnv: (parseEnvString("BINGX_ENV", "prod-vst") as "prod-live" | "prod-vst") || "prod-vst",

  telegramBotToken: parseEnvString("TELEGRAM_BOT_TOKEN"),
  telegramChatId: parseEnvString("TELEGRAM_CHAT_ID"),

  defaultLeverage: parseEnvNumber("DEFAULT_LEVERAGE", 10),
  marginType: (parseEnvString("MARGIN_TYPE", "ISOLATED") as "ISOLATED" | "CROSSED") || "ISOLATED",
  maxConcurrentPositions: parseEnvNumber("MAX_CONCURRENT_POSITIONS", 3),
  riskPerTradePercent: parseEnvNumber("RISK_PER_TRADE_PERCENT", 2.0),
  maxDailyDrawdownPercent: parseEnvNumber("MAX_DAILY_DRAWDOWN_PERCENT", 5.0),
  cooldownMinutesAfterLoss: parseEnvNumber("COOLDOWN_MINUTES_AFTER_LOSS", 45),

  scanIntervalMinutes: parseEnvNumber("SCAN_INTERVAL_MINUTES", 5),
  monitorIntervalSeconds: parseEnvNumber("MONITOR_INTERVAL_SECONDS", 15),
  topVolumeLimit: parseEnvNumber("TOP_VOLUME_LIMIT", 15),
  timeframePrimary: parseEnvString("TIMEFRAME_PRIMARY", "15m"),
  timeframeTrend: parseEnvString("TIMEFRAME_TREND", "1h"),
  rrRatio: parseEnvNumber("RR_RATIO", 1.5),
  atrMultiplierSl: parseEnvNumber("ATR_MULTIPLIER_SL", 1.5),
  breakEvenTriggerR: parseEnvNumber("BREAK_EVEN_TRIGGER_R", 1.0),
  trailingStopPercent: parseEnvNumber("TRAILING_STOP_PERCENT", 1.0),
  trailingActivationR: parseEnvNumber("TRAILING_ACTIVATION_R", 1.5),
  trailingAtrMultiplier: parseEnvNumber("TRAILING_ATR_MULTIPLIER", 1.0),
  trailingMinCallbackRate: parseEnvNumber("TRAILING_MIN_CALLBACK_RATE", 0.006),
  trailingMaxCallbackRate: parseEnvNumber("TRAILING_MAX_CALLBACK_RATE", 0.025),
  dailySummaryHour: parseEnvNumber("DAILY_SUMMARY_HOUR", 8),
  dailySummaryMinute: parseEnvNumber("DAILY_SUMMARY_MINUTE", 0),
  timeZone: parseEnvString("TIME_ZONE", "Asia/Jakarta"),
  blacklistSymbols: parseEnvString("BLACKLIST_SYMBOLS", "LUNA-USDT,USTC-USDT")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
};

export function validateConfig(): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (!config.bingxApiKey || !config.bingxSecretKey) {
    warnings.push("BINGX_API_KEY atau BINGX_SECRET_KEY belum diisi di .env. Fitur trading akun tidak akan berfungsi.");
  }

  if (!config.telegramBotToken) {
    warnings.push("TELEGRAM_BOT_TOKEN belum diisi di .env. Bot Telegram tidak dapat mengirim pesan.");
  }

  if (!config.telegramChatId) {
    warnings.push("TELEGRAM_CHAT_ID belum diset. Bot akan mendeteksi Chat ID otomatis saat Anda mengetik /start di Telegram.");
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
