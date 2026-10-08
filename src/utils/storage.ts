import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

export interface ManagedPosition {
  symbol: string;
  positionSide: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  leverage: number;
  initialSl: number;
  currentSl: number;
  initialTp: number;
  trailingActivationPrice?: number;
  trailingCallbackRate?: number;
  isTrailingActive?: boolean;
  isBreakEvenApplied: boolean;
  highestPrice: number;
  lowestPrice: number;
  openedAt: number;
  closePendingAttempts?: number;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  realizedPnl: number;
  commission: number;
  fundingFee: number;
  netProfit: number;
  pnlUsdt: number;
  pnlPercent: number;
  reason: "TAKE_PROFIT" | "STOP_LOSS" | "MANUAL_CLOSE" | "BREAK_EVEN" | "TRAILING_TP";
  closedAt: number;
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  startingBalance: number;
  realizedPnl: number;
  totalCommission: number;
  totalFunding: number;
  netProfit: number;
  tradesCount: number;
  winCount: number;
  lossCount: number;
}

export interface BotState {
  isAutoTradePaused: boolean;
  telegramChatId: string;
  managedPositions: Record<string, ManagedPosition>;
  cooldowns: Record<string, number>; // symbol -> unix timestamp ms
  dailyStats: DailyStats;
  tradeHistory: TradeRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "bot_state.json");

function getTodayString(): string {
  return new Date().toISOString().substring(0, 10);
}

function getDefaultState(): BotState {
  return {
    isAutoTradePaused: false,
    telegramChatId: "",
    managedPositions: {},
    cooldowns: {},
    dailyStats: {
      date: getTodayString(),
      startingBalance: 0,
      realizedPnl: 0,
      totalCommission: 0,
      totalFunding: 0,
      netProfit: 0,
      tradesCount: 0,
      winCount: 0,
      lossCount: 0,
    },
    tradeHistory: [],
  };
}

class StorageManager {
  private state: BotState;

  constructor() {
    this.ensureDirectory();
    this.state = this.loadState();
    this.checkDailyReset();
  }

  private ensureDirectory() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadState(): BotState {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, "utf-8");
        return { ...getDefaultState(), ...JSON.parse(raw) };
      }
    } catch (err) {
      logger.error("Gagal membaca file state bot, menggunakan default state:", err);
    }
    return getDefaultState();
  }

  public saveState() {
    try {
      this.ensureDirectory();
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (err) {
      logger.error("Gagal menyimpan state bot ke file:", err);
    }
  }

  public checkDailyReset(currentBalance?: number) {
    const today = getTodayString();
    if (this.state.dailyStats.date !== today) {
      logger.info(`Pergantian hari terdeteksi (${this.state.dailyStats.date} -> ${today}). Mereset statistik harian.`);
      this.state.dailyStats = {
        date: today,
        startingBalance: currentBalance ?? this.state.dailyStats.startingBalance,
        realizedPnl: 0,
        totalCommission: 0,
        totalFunding: 0,
        netProfit: 0,
        tradesCount: 0,
        winCount: 0,
        lossCount: 0,
      };
      this.saveState();
    }
  }

  public setChatId(chatId: string) {
    if (this.state.telegramChatId !== chatId) {
      this.state.telegramChatId = chatId;
      this.saveState();
    }
  }

  public getChatId(): string {
    return this.state.telegramChatId;
  }

  public setPaused(paused: boolean) {
    this.state.isAutoTradePaused = paused;
    this.saveState();
  }

  public isPaused(): boolean {
    return this.state.isAutoTradePaused;
  }

  public setCooldown(symbol: string, minutes: number) {
    const expireAt = Date.now() + minutes * 60 * 1000;
    this.state.cooldowns[symbol] = expireAt;
    this.saveState();
    logger.info(`Token ${symbol} masuk cooldown selama ${minutes} menit (sampai ${new Date(expireAt).toLocaleTimeString()}).`);
  }

  public isSymbolInCooldown(symbol: string): boolean {
    const expireAt = this.state.cooldowns[symbol];
    if (!expireAt) return false;
    if (Date.now() > expireAt) {
      delete this.state.cooldowns[symbol];
      this.saveState();
      return false;
    }
    return true;
  }

  public getManagedPositions(): Record<string, ManagedPosition> {
    return this.state.managedPositions;
  }

  public getManagedPosition(symbol: string): ManagedPosition | undefined {
    return this.state.managedPositions[symbol];
  }

  public saveManagedPosition(position: ManagedPosition) {
    this.state.managedPositions[position.symbol] = position;
    this.saveState();
  }

  public removeManagedPosition(symbol: string) {
    delete this.state.managedPositions[symbol];
    this.saveState();
  }

  public recordTrade(trade: TradeRecord) {
    this.state.tradeHistory.push(trade);
    if (this.state.tradeHistory.length > 500) {
      this.state.tradeHistory.shift(); // keep last 500
    }

    const tradeRealized = trade.realizedPnl !== undefined ? trade.realizedPnl : (trade.pnlUsdt || 0);
    const tradeComm = trade.commission || 0;
    const tradeFund = trade.fundingFee || 0;
    const tradeNet = trade.netProfit !== undefined ? trade.netProfit : (tradeRealized + tradeComm + tradeFund);

    this.state.dailyStats.tradesCount += 1;
    this.state.dailyStats.realizedPnl += tradeRealized;
    this.state.dailyStats.totalCommission = (this.state.dailyStats.totalCommission || 0) + tradeComm;
    this.state.dailyStats.totalFunding = (this.state.dailyStats.totalFunding || 0) + tradeFund;
    this.state.dailyStats.netProfit = (this.state.dailyStats.netProfit || 0) + tradeNet;

    if (tradeNet >= 0) {
      this.state.dailyStats.winCount += 1;
    } else {
      this.state.dailyStats.lossCount += 1;
    }

    this.saveState();
  }

  public getDailyStats(): DailyStats {
    return this.state.dailyStats;
  }

  public updateStartingBalance(balance: number) {
    if (this.state.dailyStats.startingBalance === 0 && balance > 0) {
      this.state.dailyStats.startingBalance = balance;
      this.saveState();
    }
  }
}

export const storage = new StorageManager();
