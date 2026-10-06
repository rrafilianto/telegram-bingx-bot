import { getPremiumIndex, PremiumIndexData } from "../bingx/market.js";
import { logger } from "../utils/logger.js";

export interface FearAndGreedData {
  value: number; // 0 - 100
  classification: string; // "Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"
}

export interface MarketSentiment {
  fearAndGreed: FearAndGreedData;
  averageFundingRate: number;
  isExtremeGreed: boolean;
  isExtremeFear: boolean;
  timestamp: number;
}

let cachedSentiment: MarketSentiment | null = null;
let lastSentimentFetch = 0;

export async function fetchFearAndGreed(): Promise<FearAndGreedData> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      signal: AbortSignal.timeout(6000),
    });
    const json: any = await res.json();
    if (json?.data?.[0]) {
      return {
        value: Number(json.data[0].value) || 50,
        classification: json.data[0].value_classification || "Neutral",
      };
    }
  } catch (err) {
    logger.warn("Gagal mengambil data Fear & Greed index:", err);
  }

  return { value: 50, classification: "Neutral" };
}

export async function getMarketSentiment(): Promise<MarketSentiment> {
  const now = Date.now();
  // Cache sentiment selama 10 menit
  if (cachedSentiment && now - lastSentimentFetch < 1000 * 60 * 10) {
    return cachedSentiment;
  }

  const fng = await fetchFearAndGreed();

  let avgFunding = 0;
  try {
    const premiumData = await getPremiumIndex();
    if (premiumData.length > 0) {
      const validRates = premiumData
        .map((p) => parseFloat(p.lastFundingRate))
        .filter((r) => !isNaN(r));
      if (validRates.length > 0) {
        avgFunding = validRates.reduce((a, b) => a + b, 0) / validRates.length;
      }
    }
  } catch (err) {
    logger.debug("Gagal mengambil data average funding rate:", err);
  }

  const sentiment: MarketSentiment = {
    fearAndGreed: fng,
    averageFundingRate: avgFunding,
    isExtremeGreed: fng.value >= 80,
    isExtremeFear: fng.value <= 20,
    timestamp: now,
  };

  cachedSentiment = sentiment;
  lastSentimentFetch = now;
  return sentiment;
}
