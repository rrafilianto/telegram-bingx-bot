import WebSocket from "ws";
import pako from "pako";
import { bingxSignedRequest } from "./client.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

const WS_SWAP_URL = "wss://open-api-swap.bingx.com/swap-market";

let wsClient: WebSocket | null = null;
let currentListenKey: string | null = null;
let listenKeyTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

export async function createListenKey(): Promise<string | null> {
  try {
    const data = await bingxSignedRequest<{ listenKey: string }>(
      "POST",
      "/openApi/user/auth/userDataStream"
    );
    return data?.listenKey || null;
  } catch (err) {
    logger.debug("Gagal membuat listenKey (mungkin API key belum aktif):", err);
    return null;
  }
}

export async function keepAliveListenKey(listenKey: string): Promise<void> {
  try {
    await bingxSignedRequest("PUT", "/openApi/user/auth/userDataStream", {
      listenKey,
    });
  } catch (err) {
    logger.debug("Gagal memperpanjang listenKey:", err);
  }
}

function decompressMessage(data: WebSocket.RawData): string {
  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
    const decompressed = pako.ungzip(new Uint8Array(buffer));
    return new TextDecoder("utf-8").decode(decompressed);
  } catch {
    return data.toString();
  }
}

export async function startSwapWebSocket(onAccountUpdate?: (msg: any) => void): Promise<void> {
  if (!config.bingxApiKey || !config.bingxSecretKey) {
    logger.info("API Key belum diset, WebSocket streaming akun dilewati.");
    return;
  }

  try {
    currentListenKey = await createListenKey();
    const wsUrl = currentListenKey ? `${WS_SWAP_URL}?listenKey=${currentListenKey}` : WS_SWAP_URL;

    wsClient = new WebSocket(wsUrl);

    wsClient.on("open", () => {
      logger.success("WebSocket BingX Swap terhubung.");

      // Perpanjang listenKey setiap 30 menit
      if (currentListenKey) {
        if (listenKeyTimer) clearInterval(listenKeyTimer);
        listenKeyTimer = setInterval(() => {
          if (currentListenKey) keepAliveListenKey(currentListenKey);
        }, 1000 * 60 * 30);
      }
    });

    wsClient.on("message", (raw) => {
      const text = decompressMessage(raw);

      // Heartbeat ping pong wajib dibalas
      if (text === "Ping" || text.toLowerCase().includes("ping")) {
        wsClient?.send("Pong");
        return;
      }

      try {
        const json = JSON.parse(text);
        if (onAccountUpdate) {
          onAccountUpdate(json);
        }
      } catch {
        // Non-JSON message
      }
    });

    wsClient.on("error", (err) => {
      logger.warn("WebSocket error:", err.message);
    });

    wsClient.on("close", () => {
      logger.warn("WebSocket terputus, mencoba rekoneksi dalam 10 detik...");
      if (listenKeyTimer) clearInterval(listenKeyTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        startSwapWebSocket(onAccountUpdate);
      }, 10000);
    });
  } catch (err) {
    logger.warn("Gagal inisialisasi WebSocket:", err);
  }
}

export function stopWebSocket(): void {
  if (listenKeyTimer) clearInterval(listenKeyTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (wsClient) {
    wsClient.close();
    wsClient = null;
  }
}
