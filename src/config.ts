import dotenv from "dotenv";
import { storage } from "./utils/storage.js";
dotenv.config();

export type TradingMode = "scalping" | "daytrade";

export interface ModePreset {
  name: TradingMode;
  label: string;
  badge: string;
  description: string;
  timeframePrimary: string;
  timeframeTrend: string;
  scanIntervalMinutes: number;
  monitorIntervalSeconds: number;
  topVolumeLimit: number;
  minSlPercent: number;
  maxSlPercent: number;
  atrMultiplierSl: number;
  breakEvenTriggerR: number;
  trailingActivationR: number;
  trailingAtrMultiplier: number;
  trailingMinCallbackRate: number;
  trailingMaxCallbackRate: number;
  pullbackMaxDeviationPercent: number;
}

export const MODE_PRESETS: Record<TradingMode, ModePreset> = {
  daytrade: {
    name: "daytrade",
    label: "Day Trade (15m)",
    badge: "📊 DAY TRADE",
    description: "Trend-following intraday. Entry 15m, konfirmasi tren 1h. Menangkap kelanjutan tren pasca-koreksi.",
    timeframePrimary: "15m",
    timeframeTrend: "1h",
    scanIntervalMinutes: 5,
    monitorIntervalSeconds: 15,
    topVolumeLimit: 15,
    minSlPercent: 1.5,
    maxSlPercent: 4.5,
    atrMultiplierSl: 2.5,
    breakEvenTriggerR: 1.0,
    trailingActivationR: 1.5,
    trailingAtrMultiplier: 1.0,
    trailingMinCallbackRate: 0.006, // 0.6%
    trailingMaxCallbackRate: 0.025, // 2.5%
    pullbackMaxDeviationPercent: 2.5, // 2.5%
  },
  scalping: {
    name: "scalping",
    label: "Scalping (3m)",
    badge: "⚡ SCALPING",
    description: "Eksekusi cepat 3m, filter tren 15m. Stop loss ketat, monitor agresif pada Top 5 koin paling likuid.",
    timeframePrimary: "3m",
    timeframeTrend: "15m",
    scanIntervalMinutes: 1,
    monitorIntervalSeconds: 5,
    topVolumeLimit: 5,
    minSlPercent: 0.5,
    maxSlPercent: 1.5,
    atrMultiplierSl: 1.5,
    breakEvenTriggerR: 0.8,
    trailingActivationR: 1.2,
    trailingAtrMultiplier: 0.8,
    trailingMinCallbackRate: 0.002, // 0.2%
    trailingMaxCallbackRate: 0.008, // 0.8%
    pullbackMaxDeviationPercent: 0.8, // 0.8%
  },
};

type ModeChangeCallback = (mode: TradingMode, preset: ModePreset) => void;
let modeChangeCallback: ModeChangeCallback | null = null;

export function onTradingModeChanged(cb: ModeChangeCallback): void {
  modeChangeCallback = cb;
}

export function getActiveTradingMode(): TradingMode {
  return storage.getTradingMode();
}

export function getActivePreset(): ModePreset {
  const mode = storage.getTradingMode();
  return MODE_PRESETS[mode] || MODE_PRESETS.daytrade;
}

export function setTradingMode(mode: TradingMode): ModePreset {
  storage.setTradingMode(mode);
  const preset = MODE_PRESETS[mode] || MODE_PRESETS.daytrade;
  if (modeChangeCallback) {
    try {
      modeChangeCallback(mode, preset);
    } catch (err) {
      // Callback error protection
    }
  }
  return preset;
}

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
  maxPositionNotionalPercent: number;
  cooldownMinutesAfterLoss: number;
  
  // Dynamic Scanner & Strategy Parameters (Resolved from Active Preset)
  scanIntervalMinutes: number;
  monitorIntervalSeconds: number;
  topVolumeLimit: number;
  timeframePrimary: string;
  timeframeTrend: string;
  rrRatio: number;
  atrMultiplierSl: number;
  minSlPercent: number;
  maxSlPercent: number;
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
  maxConcurrentPositions: parseEnvNumber("MAX_CONCURRENT_POSITIONS", 5),
  riskPerTradePercent: parseEnvNumber("RISK_PER_TRADE_PERCENT", 2.0),
  maxDailyDrawdownPercent: parseEnvNumber("MAX_DAILY_DRAWDOWN_PERCENT", 5.0),
  maxPositionNotionalPercent: parseEnvNumber("MAX_POSITION_NOTIONAL_PERCENT", 100),
  cooldownMinutesAfterLoss: parseEnvNumber("COOLDOWN_MINUTES_AFTER_LOSS", 45),

  rrRatio: parseEnvNumber("RR_RATIO", 1.5),
  trailingStopPercent: parseEnvNumber("TRAILING_STOP_PERCENT", 1.0),
  dailySummaryHour: parseEnvNumber("DAILY_SUMMARY_HOUR", 8),
  dailySummaryMinute: parseEnvNumber("DAILY_SUMMARY_MINUTE", 0),
  timeZone: parseEnvString("TIME_ZONE", "Asia/Jakarta"),
  blacklistSymbols: parseEnvString("BLACKLIST_SYMBOLS", "LUNA-USDT,USTC-USDT")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),

  // Dynamic getters reflecting currently active preset mode
  get scanIntervalMinutes() {
    return getActivePreset().scanIntervalMinutes;
  },
  get monitorIntervalSeconds() {
    return getActivePreset().monitorIntervalSeconds;
  },
  get topVolumeLimit() {
    return getActivePreset().topVolumeLimit;
  },
  get timeframePrimary() {
    return getActivePreset().timeframePrimary;
  },
  get timeframeTrend() {
    return getActivePreset().timeframeTrend;
  },
  get atrMultiplierSl() {
    return getActivePreset().atrMultiplierSl;
  },
  get minSlPercent() {
    return getActivePreset().minSlPercent;
  },
  get maxSlPercent() {
    return getActivePreset().maxSlPercent;
  },
  get breakEvenTriggerR() {
    return getActivePreset().breakEvenTriggerR;
  },
  get trailingActivationR() {
    return getActivePreset().trailingActivationR;
  },
  get trailingAtrMultiplier() {
    return getActivePreset().trailingAtrMultiplier;
  },
  get trailingMinCallbackRate() {
    return getActivePreset().trailingMinCallbackRate;
  },
  get trailingMaxCallbackRate() {
    return getActivePreset().trailingMaxCallbackRate;
  },
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
