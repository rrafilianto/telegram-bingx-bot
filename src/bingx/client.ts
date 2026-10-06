import crypto from "crypto";
import JSONBig from "json-bigint";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const JSONBigParse = JSONBig({ storeAsString: true });

const BASE_URLS: Record<string, string[]> = {
  "prod-live": ["https://open-api.bingx.com", "https://open-api.bingx.pro"],
  "prod-vst": ["https://open-api-vst.bingx.com", "https://open-api-vst.bingx.pro"],
};

export interface ApiResponse<T = any> {
  code: number;
  msg: string;
  data: T;
}

function isNetworkOrTimeout(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && (e.name === "TimeoutError" || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(e.message))) {
    return true;
  }
  return false;
}

function validateParams(params: Record<string, unknown>): void {
  const FORBIDDEN = /[&=?#\r\n]/;
  for (const [k, v] of Object.entries(params)) {
    const s = String(v);
    if (FORBIDDEN.test(s)) {
      throw new Error(`Parameter "${k}" memiliki karakter terlarang: "${s}"`);
    }
  }
}

export async function bingxPublicRequest<T = any>(
  path: string,
  params: Record<string, unknown> = {},
  retries = 3
): Promise<T> {
  const urls = BASE_URLS[config.bingxEnv] ?? BASE_URLS["prod-live"];
  const allParams: Record<string, unknown> = {
    ...params,
    timestamp: Date.now(),
  };

  const qs = Object.keys(allParams)
    .sort()
    .filter((k) => allParams[k] !== undefined && allParams[k] !== null && allParams[k] !== "")
    .map((k) => `${k}=${allParams[k]}`)
    .join("&");

  let lastError: unknown;

  for (const base of urls) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const url = qs ? `${base}${path}?${qs}` : `${base}${path}`;
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "X-SOURCE-KEY": "BX-AI-SKILL",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(10000),
        });

        const text = await res.text();
        const json: ApiResponse<T> = JSONBigParse.parse(text);

        if (json.code === 100410) {
          if (attempt < retries) {
            const backoff = attempt * 1500;
            logger.warn(`Rate limit 100410 pada ${path}. Menunggu ${backoff}ms (percobaan ${attempt}/${retries})...`);
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
        }

        if (json.code !== 0) {
          throw new Error(`BingX Error [${json.code}]: ${json.msg || "Unknown error"}`);
        }

        return json.data;
      } catch (e: any) {
        lastError = e;
        if (e?.message?.includes("100410") && attempt < retries) {
          await new Promise((r) => setTimeout(r, attempt * 1500));
          continue;
        }
        if (!isNetworkOrTimeout(e) || base === urls[urls.length - 1]) {
          throw e;
        }
        logger.warn(`Network error pada ${base}, mencoba fallback URL...`);
        break;
      }
    }
  }

  throw lastError;
}

export async function bingxSignedRequest<T = any>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  params: Record<string, unknown> = {},
  retries = 3
): Promise<T> {
  const apiKey = config.bingxApiKey;
  const secretKey = config.bingxSecretKey;

  if (!apiKey || !secretKey) {
    throw new Error("BINGX_API_KEY atau BINGX_SECRET_KEY belum dikonfigurasi.");
  }

  const urls = BASE_URLS[config.bingxEnv] ?? BASE_URLS["prod-live"];
  const allParams: Record<string, unknown> = {
    ...params,
    timestamp: Date.now(),
  };

  validateParams(allParams);

  const qs = Object.keys(allParams)
    .sort()
    .filter((k) => allParams[k] !== undefined && allParams[k] !== null && allParams[k] !== "")
    .map((k) => `${k}=${allParams[k]}`)
    .join("&");

  const signature = crypto.createHmac("sha256", secretKey).update(qs).digest("hex");
  const signedPayload = `${qs}&signature=${signature}`;

  let lastError: unknown;

  for (const base of urls) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const hasBody = method === "POST" || method === "PUT";
        const url = hasBody ? `${base}${path}` : `${base}${path}?${signedPayload}`;

        const res = await fetch(url, {
          method,
          headers: {
            "X-BX-APIKEY": apiKey,
            "X-SOURCE-KEY": "BX-AI-SKILL",
            Accept: "application/json",
            ...(hasBody ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          },
          body: hasBody ? signedPayload : undefined,
          signal: AbortSignal.timeout(10000),
        });

        const text = await res.text();
        const json: ApiResponse<T> = JSONBigParse.parse(text);

        if (json.code === 100410) {
          if (attempt < retries) {
            const backoff = attempt * 1500;
            logger.warn(`Rate limit 100410 pada ${path}. Menunggu ${backoff}ms (percobaan ${attempt}/${retries})...`);
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
        }

        if (json.code !== 0) {
          throw new Error(`BingX Error [${json.code}]: ${json.msg || "Unknown error"}`);
        }

        return json.data;
      } catch (e: any) {
        lastError = e;
        if (e?.message?.includes("100410") && attempt < retries) {
          await new Promise((r) => setTimeout(r, attempt * 1500));
          continue;
        }
        if (!isNetworkOrTimeout(e) || base === urls[urls.length - 1]) {
          throw e;
        }
        logger.warn(`Network timeout/error pada ${base}, mencoba fallback URL...`);
        break;
      }
    }
  }

  throw lastError;
}
