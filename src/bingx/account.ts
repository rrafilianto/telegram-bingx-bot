import { bingxSignedRequest } from "./client.js";

export interface BalanceAsset {
  asset: string;
  balance: string; // Wallet balance
  equity: string; // Equity (balance + unrealizedProfit)
  unrealizedProfit: string; // Floating PnL
  realisedProfit: string;
  availableMargin: string;
  usedMargin: string;
  freezedMargin: string;
}

export interface PositionData {
  symbol: string;
  positionId: string;
  positionSide: "LONG" | "SHORT" | "BOTH";
  positionAmt: string; // Jumlah koin (bisa positif/negatif)
  availableAmt: string;
  entryPrice: string;
  avgPrice: string;
  markPrice: string;
  liquidationPrice: string | number;
  leverage: number;
  isolated?: boolean;
  marginType?: string; // "ISOLATED" atau "CROSSED"
  isolatedMargin?: string;
  unrealizedProfit: string;
  realisedProfit: string;
  riskRate: string;
  updateTime: number;
}

let cachedBalance: BalanceAsset | null = null;
let lastBalanceFetchTime = 0;

let cachedPositions: PositionData[] = [];
let lastPositionsFetchTime = 0;

export async function getBalance(forceRefresh = false): Promise<BalanceAsset | null> {
  const now = Date.now();
  if (!forceRefresh && cachedBalance && now - lastBalanceFetchTime < 3000) {
    return cachedBalance;
  }

  const data = await bingxSignedRequest<any>(
    "GET",
    "/openApi/swap/v3/user/balance"
  );

  if (!data) return cachedBalance;

  let assetData: BalanceAsset | null = null;

  if (Array.isArray(data) && data.length > 0) {
    // Ambil aset USDT atau VST
    assetData = data.find((a: any) => a.asset === "USDT" || a.asset === "VST") || data[0];
  } else if ("balance" in data && typeof data.balance === "object" && data.balance !== null) {
    assetData = data.balance as BalanceAsset;
  } else {
    assetData = data as BalanceAsset;
  }

  if (assetData) {
    cachedBalance = assetData;
    lastBalanceFetchTime = now;
  }

  return cachedBalance;
}

export async function getPositions(symbol?: string, forceRefresh = false): Promise<PositionData[]> {
  const now = Date.now();
  if (!forceRefresh && !symbol && cachedPositions.length > 0 && now - lastPositionsFetchTime < 3000) {
    return cachedPositions;
  }

  const params: Record<string, unknown> = {};
  if (symbol) params.symbol = symbol;

  const data = await bingxSignedRequest<PositionData[]>(
    "GET",
    "/openApi/swap/v2/user/positions",
    params
  );

  if (!Array.isArray(data)) return [];

  const activePositions = data
    .filter((pos) => {
      const amt = Math.abs(parseFloat(pos.positionAmt) || 0);
      return amt > 0;
    })
    .map((pos) => ({
      ...pos,
      marginType: pos.isolated === true ? "ISOLATED" : pos.isolated === false ? "CROSSED" : (pos.marginType || "ISOLATED"),
    }));

  if (!symbol) {
    cachedPositions = activePositions;
    lastPositionsFetchTime = now;
  }

  return activePositions;
}

export function clearPositionsCache(): void {
  cachedPositions = [];
  lastPositionsFetchTime = 0;
}


export async function getIncomeHistory(limit = 20): Promise<any[]> {
  const data = await bingxSignedRequest<any[]>("GET", "/openApi/swap/v2/user/income", {
    limit,
  });
  return Array.isArray(data) ? data : [];
}
