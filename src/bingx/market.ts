import { bingxPublicRequest } from "./client.js";

export interface TickerData {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string; // Volume in USDT
  openPrice: string;
  askPrice: string;
  bidPrice: string;
}

export interface ContractSpec {
  contractId: string;
  symbol: string;
  quantityPrecision: number;
  pricePrecision: number;
  tradeMinQuantity: number;
  tradeMinUSDT: number;
  status: number;
  apiStateOpen: string;
  apiStateClose: string;
}

export interface KlineItem {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
}

export interface PremiumIndexData {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}

let contractsCache: Map<string, ContractSpec> = new Map();
let lastContractsFetchTime = 0;

export async function getAllTickers(): Promise<TickerData[]> {
  const data = await bingxPublicRequest<TickerData[]>("/openApi/swap/v2/quote/ticker");
  if (!Array.isArray(data)) return [];
  // Hanya ambil pasangan crypto murni, abaikan instrumen TradFi (NC: Forex, Komoditas, Saham, Indeks)
  return data.filter((t) => t.symbol && !t.symbol.startsWith("NC"));
}

export async function getContracts(): Promise<Map<string, ContractSpec>> {
  const now = Date.now();
  if (contractsCache.size > 0 && now - lastContractsFetchTime < 1000 * 60 * 60) {
    return contractsCache;
  }

  const data = await bingxPublicRequest<ContractSpec[]>("/openApi/swap/v2/quote/contracts");
  const map = new Map<string, ContractSpec>();
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.symbol && !item.symbol.startsWith("NC")) {
        map.set(item.symbol, {
          ...item,
          quantityPrecision: Number(item.quantityPrecision) || 2,
          pricePrecision: Number(item.pricePrecision) || 2,
          tradeMinQuantity: Number(item.tradeMinQuantity) || 0.001,
          tradeMinUSDT: Number(item.tradeMinUSDT) || 2,
        });
      }
    }
  }

  contractsCache = map;
  lastContractsFetchTime = now;
  return contractsCache;
}

export async function getContractSpec(symbol: string): Promise<ContractSpec | undefined> {
  const contracts = await getContracts();
  return contracts.get(symbol);
}

export async function getKlines(
  symbol: string,
  interval = "15m",
  limit = 100
): Promise<KlineItem[]> {
  const raw = await bingxPublicRequest<any[]>("/openApi/swap/v3/quote/klines", {
    symbol,
    interval,
    limit,
  });

  if (!Array.isArray(raw)) return [];

  // BingX mengembalikan urutan candle terbaru di index 0.
  // Untuk kalkulasi indikator, kita balik urutannya (oldest first).
  return raw
    .map((item) => ({
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
      volume: parseFloat(item.volume),
      time: Number(item.time),
    }))
    .reverse();
}

export async function getPremiumIndex(symbol?: string): Promise<PremiumIndexData[]> {
  const params: Record<string, unknown> = {};
  if (symbol) params.symbol = symbol;

  const data = await bingxPublicRequest<PremiumIndexData | PremiumIndexData[]>(
    "/openApi/swap/v2/quote/premiumIndex",
    params
  );

  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return [data];
  return [];
}
