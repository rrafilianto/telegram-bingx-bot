import { bingxSignedRequest } from "./client.js";
import { logger } from "../utils/logger.js";

export interface PlaceOrderResult {
  order: {
    symbol: string;
    orderId: string;
    clientOrderId?: string;
    side: string;
    positionSide: string;
    type: string;
    price: string;
    quantity: string;
    status: string;
  };
}

export async function setLeverage(
  symbol: string,
  side: "LONG" | "SHORT",
  leverage: number
): Promise<any> {
  try {
    return await bingxSignedRequest("POST", "/openApi/swap/v2/trade/leverage", {
      symbol,
      side,
      leverage,
    });
  } catch (err: any) {
    // Abaikan jika leverage sudah bernilai sama
    if (err?.message?.includes("leverage not modified") || err?.message?.includes("same")) {
      return null;
    }
    logger.warn(`Peringatan setting leverage ${symbol}: ${err?.message || err}`);
    return null;
  }
}

export async function setMarginType(
  symbol: string,
  marginType: "ISOLATED" | "CROSSED"
): Promise<any> {
  try {
    return await bingxSignedRequest("POST", "/openApi/swap/v2/trade/marginType", {
      symbol,
      marginType,
    });
  } catch (err: any) {
    // Abaikan jika margin type sudah bernilai sama
    if (err?.message?.includes("marginType not modified") || err?.message?.includes("same")) {
      return null;
    }
    logger.warn(`Peringatan setting margin type ${symbol}: ${err?.message || err}`);
    return null;
  }
}

export async function placeMarketOrder(params: {
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: "LONG" | "SHORT";
  quantity: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}): Promise<PlaceOrderResult> {
  const req: Record<string, unknown> = {
    symbol: params.symbol,
    side: params.side,
    positionSide: params.positionSide,
    type: "MARKET",
    quantity: params.quantity,
  };

  if (params.takeProfitPrice && params.takeProfitPrice > 0) {
    req.takeProfit = JSON.stringify({
      type: "TAKE_PROFIT_MARKET",
      stopPrice: params.takeProfitPrice,
      price: params.takeProfitPrice,
      workingType: "MARK_PRICE",
    });
  }

  if (params.stopLossPrice && params.stopLossPrice > 0) {
    req.stopLoss = JSON.stringify({
      type: "STOP_MARKET",
      stopPrice: params.stopLossPrice,
      price: params.stopLossPrice,
      workingType: "MARK_PRICE",
    });
  }

  return await bingxSignedRequest<PlaceOrderResult>("POST", "/openApi/swap/v2/trade/order", req);
}

export async function closePositionMarket(params: {
  symbol: string;
  positionSide: "LONG" | "SHORT";
  quantity: number;
}): Promise<PlaceOrderResult> {
  // Untuk menutup posisi di Hedge Mode:
  // Jika LONG -> sell to close (side: SELL, positionSide: LONG)
  // Jika SHORT -> buy to close (side: BUY, positionSide: SHORT)
  const side = params.positionSide === "LONG" ? "SELL" : "BUY";

  return await bingxSignedRequest<PlaceOrderResult>("POST", "/openApi/swap/v2/trade/order", {
    symbol: params.symbol,
    side,
    positionSide: params.positionSide,
    type: "MARKET",
    quantity: params.quantity,
  });
}

export async function placeStopLossOrder(params: {
  symbol: string;
  positionSide: "LONG" | "SHORT";
  quantity: number;
  stopPrice: number;
}): Promise<PlaceOrderResult> {
  const side = params.positionSide === "LONG" ? "SELL" : "BUY";

  return await bingxSignedRequest<PlaceOrderResult>("POST", "/openApi/swap/v2/trade/order", {
    symbol: params.symbol,
    side,
    positionSide: params.positionSide,
    type: "STOP_MARKET",
    stopPrice: params.stopPrice,
    quantity: params.quantity,
    workingType: "MARK_PRICE",
  });
}

export async function placeTrailingStopOrder(params: {
  symbol: string;
  positionSide: "LONG" | "SHORT";
  quantity: number;
  activationPrice: number;
  priceRate: number;
}): Promise<PlaceOrderResult> {
  const side = params.positionSide === "LONG" ? "SELL" : "BUY";

  return await bingxSignedRequest<PlaceOrderResult>("POST", "/openApi/swap/v2/trade/order", {
    symbol: params.symbol,
    side,
    positionSide: params.positionSide,
    type: "TRAILING_STOP_MARKET",
    quantity: params.quantity,
    activationPrice: params.activationPrice,
    priceRate: params.priceRate,
  });
}


export async function cancelAllOpenOrders(symbol: string): Promise<any> {
  try {
    return await bingxSignedRequest("DELETE", "/openApi/swap/v2/trade/allOpenOrders", {
      symbol,
    });
  } catch (err) {
    logger.debug(`Gagal cancel order terbuka untuk ${symbol}:`, err);
    return null;
  }
}

export async function getOpenOrders(symbol?: string): Promise<any[]> {
  const params: Record<string, unknown> = {};
  if (symbol) params.symbol = symbol;

  const data = await bingxSignedRequest<any[]>(
    "GET",
    "/openApi/swap/v2/trade/openOrders",
    params
  );
  return Array.isArray(data) ? data : [];
}

export interface SwapOrder {
  symbol: string;
  orderId: string;
  side: string;
  positionSide: string;
  type: string;
  origQty: string;
  price: string;
  executedQty: string;
  avgPrice: string;
  cumQuote: string;
  stopPrice: string;
  profit: string;
  commission: string;
  status: string;
  time: number;
  updateTime: number;
  leverage: string;
  reduceOnly?: boolean;
}

export async function getAllOrders(
  symbol: string,
  limit = 50,
  startTime?: number
): Promise<SwapOrder[]> {
  try {
    const params: Record<string, unknown> = { symbol, limit };
    if (startTime && startTime > 0) {
      params.startTime = startTime;
    }
    const data = await bingxSignedRequest<{ orders?: SwapOrder[] } | SwapOrder[]>(
      "GET",
      "/openApi/swap/v2/trade/allOrders",
      params
    );
    if (data && Array.isArray((data as any).orders)) {
      return (data as any).orders;
    }
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  } catch (err) {
    logger.debug(`Gagal mengambil allOrders untuk ${symbol}:`, err);
    return [];
  }
}

export interface ClosedPositionRecord {
  positionId: string;
  symbol: string;
  isolated: boolean;
  positionSide: "LONG" | "SHORT";
  openTime: number;
  updateTime: number;
  avgPrice: string;
  avgClosePrice: string;
  realisedProfit: string;
  netProfit: string;
  positionAmt: string;
  closePositionAmt: string;
  leverage: number;
  positionCommission?: string;
  totalFunding?: string;
}

export async function getLatestPositionHistory(
  symbol: string
): Promise<ClosedPositionRecord | null> {
  try {
    const now = Date.now();
    const data = await bingxSignedRequest<{ positionHistory?: ClosedPositionRecord[] }>(
      "GET",
      "/openApi/swap/v1/trade/positionHistory",
      {
        symbol,
        startTs: now - 7 * 24 * 3600 * 1000,
        endTs: now,
        pageSize: 5,
      }
    );
    const list = data?.positionHistory;
    if (Array.isArray(list) && list.length > 0) {
      return list[0];
    }
    return null;
  } catch (err) {
    logger.debug(`Gagal mengambil positionHistory untuk ${symbol}:`, err);
    return null;
  }
}

