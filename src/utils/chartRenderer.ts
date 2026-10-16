import { Resvg } from "@resvg/resvg-js";
import { KlineItem } from "../bingx/market.js";
import { HourlyOrbData, AggressionMark } from "../analysis/technical.js";
import { TradeSignal } from "../analysis/strategy.js";
import { logger } from "./logger.js";

export interface ChartRenderOptions {
  symbol: string;
  timeframe: string;
  klines: KlineItem[];
  orb: HourlyOrbData;
  signal: TradeSignal;
  aggression?: AggressionMark;
}

/**
 * Generate visual TradingView-style dark theme candlestick chart with Hourly ORB levels,
 * Aggression Mark bubbles, and Entry / SL / TP lines as a PNG Buffer.
 */
export function generateChartSnapshot(options: ChartRenderOptions): Buffer | null {
  try {
    const { symbol, timeframe, klines, orb, signal, aggression } = options;

    if (!klines || klines.length < 10) {
      return null;
    }

    // Ambil 35 candle terakhir agar visual sweep dan ORB terlihat proporsional dan jelas
    const candleSlice = klines.slice(Math.max(0, klines.length - 35));

    // Dimensi Chart
    const width = 850;
    const height = 480;
    const padding = { top: 70, bottom: 45, left: 20, right: 95 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    // Hitung range harga (termasuk orHigh, orLow, SL, dan TP agar semua garis muat rapi)
    let minPrice = Math.min(
      ...candleSlice.map((c) => c.low),
      orb.orLow > 0 ? orb.orLow : Infinity,
      signal.stopLossPrice > 0 ? signal.stopLossPrice : Infinity,
      signal.takeProfitPrice > 0 ? signal.takeProfitPrice : Infinity
    );
    let maxPrice = Math.max(
      ...candleSlice.map((c) => c.high),
      orb.orHigh > 0 ? orb.orHigh : -Infinity,
      signal.stopLossPrice > 0 ? signal.stopLossPrice : -Infinity,
      signal.takeProfitPrice > 0 ? signal.takeProfitPrice : -Infinity
    );

    if (minPrice === Infinity || maxPrice === -Infinity || minPrice >= maxPrice) {
      minPrice = Math.min(...candleSlice.map((c) => c.low));
      maxPrice = Math.max(...candleSlice.map((c) => c.high));
    }

    const priceSpan = maxPrice - minPrice || 1;
    const paddedMin = minPrice - priceSpan * 0.06;
    const paddedMax = maxPrice + priceSpan * 0.06;
    const paddedSpan = paddedMax - paddedMin;

    const y = (price: number) => {
      const normalized = (paddedMax - price) / paddedSpan;
      return padding.top + normalized * plotHeight;
    };

    const candleCount = candleSlice.length;
    const candleStep = plotWidth / candleCount;
    const candleWidth = Math.max(4, Math.min(14, candleStep * 0.72));

    const x = (index: number) => padding.left + index * candleStep + candleStep / 2;

    // SVG Elements
    const elements: string[] = [];

    // Background & Border
    elements.push(`<rect width="${width}" height="${height}" fill="#131722" />`);

    // Gridlines Horisontal (5 level harga)
    for (let i = 0; i <= 5; i++) {
      const gridPrice = paddedMin + (paddedSpan / 5) * i;
      const gridY = y(gridPrice);
      elements.push(
        `<line x1="${padding.left}" y1="${gridY}" x2="${width - padding.right}" y2="${gridY}" stroke="#2a2e39" stroke-width="1" stroke-dasharray="3,3" />`
      );
      elements.push(
        `<text x="${width - padding.right + 6}" y="${gridY + 4}" fill="#787b86" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11">$${gridPrice.toFixed(
          gridPrice < 1 ? 4 : 2
        )}</text>`
      );
    }

    // Shading Area Pembentukan ORB (N menit pertama jam ini)
    if (orb.hourStartBarTime > 0) {
      const orbStartIdx = candleSlice.findIndex((c) => c.time >= orb.hourStartBarTime);
      const orbEndIdx = candleSlice.findIndex(
        (c) => c.time >= orb.hourStartBarTime + (orb.barsFromHour >= 0 ? 6 * 60000 : 0)
      );

      if (orbStartIdx !== -1) {
        const startX = padding.left + orbStartIdx * candleStep;
        const endX =
          orbEndIdx !== -1
            ? padding.left + orbEndIdx * candleStep
            : padding.left + Math.min(candleCount, orbStartIdx + 6) * candleStep;
        const boxWidth = Math.max(10, endX - startX);

        elements.push(
          `<rect x="${startX}" y="${padding.top}" width="${boxWidth}" height="${plotHeight}" fill="rgba(41, 98, 255, 0.08)" stroke="rgba(41, 98, 255, 0.25)" stroke-dasharray="3,3" />`
        );
        elements.push(
          `<text x="${startX + 4}" y="${padding.top + 14}" fill="#2962ff" font-family="-apple-system, sans-serif" font-size="10" font-weight="700">ORB RANGE (6m)</text>`
        );
      }
    }

    // Render Candlesticks
    candleSlice.forEach((c, idx) => {
      const cx = x(idx);
      const isGreen = c.close >= c.open;
      const color = isGreen ? "#089981" : "#f23645";

      const highY = y(c.high);
      const lowY = y(c.low);
      const openY = y(c.open);
      const closeY = y(c.close);

      // Ekor (Wick)
      elements.push(
        `<line x1="${cx}" y1="${highY}" x2="${cx}" y2="${lowY}" stroke="${color}" stroke-width="1.5" />`
      );

      // Badan (Body)
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(2, Math.abs(closeY - openY));
      elements.push(
        `<rect x="${cx - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${bodyHeight}" fill="${color}" rx="1" />`
      );

      // Label Waktu pada candle tiap 6 bar
      if (idx % 6 === 0 || idx === candleCount - 1) {
        const date = new Date(c.time);
        const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        elements.push(
          `<text x="${cx}" y="${height - 15}" fill="#787b86" font-family="-apple-system, sans-serif" font-size="10" text-anchor="middle">${timeStr}</text>`
        );
      }
    });

    // Render Garis Level OR High
    if (orb.orHigh > 0) {
      const orHighY = y(orb.orHigh);
      elements.push(
        `<line x1="${padding.left}" y1="${orHighY}" x2="${width - padding.right}" y2="${orHighY}" stroke="#00e676" stroke-width="2" stroke-dasharray="5,3" />`
      );
      elements.push(
        `<rect x="${width - padding.right + 4}" y="${orHighY - 10}" width="84" height="18" fill="#00e676" rx="3" />`
      );
      elements.push(
        `<text x="${width - padding.right + 46}" y="${orHighY + 3}" fill="#000000" font-family="-apple-system, sans-serif" font-size="10" font-weight="700" text-anchor="middle">OR HIGH $${orb.orHigh.toFixed(
          orb.orHigh < 1 ? 4 : 2
        )}</text>`
      );
    }

    // Render Garis Level OR Low
    if (orb.orLow > 0) {
      const orLowY = y(orb.orLow);
      elements.push(
        `<line x1="${padding.left}" y1="${orLowY}" x2="${width - padding.right}" y2="${orLowY}" stroke="#ff5252" stroke-width="2" stroke-dasharray="5,3" />`
      );
      elements.push(
        `<rect x="${width - padding.right + 4}" y="${orLowY - 10}" width="84" height="18" fill="#ff5252" rx="3" />`
      );
      elements.push(
        `<text x="${width - padding.right + 46}" y="${orLowY + 3}" fill="#ffffff" font-family="-apple-system, sans-serif" font-size="10" font-weight="700" text-anchor="middle">OR LOW $${orb.orLow.toFixed(
          orb.orLow < 1 ? 4 : 2
        )}</text>`
      );
    }

    // Render Garis Level OR Mid
    if (orb.orMid > 0) {
      const orMidY = y(orb.orMid);
      elements.push(
        `<line x1="${padding.left}" y1="${orMidY}" x2="${width - padding.right}" y2="${orMidY}" stroke="#ffb74d" stroke-width="1.5" stroke-dasharray="3,3" />`
      );
      elements.push(
        `<rect x="${width - padding.right + 4}" y="${orMidY - 9}" width="84" height="17" fill="#2a2e39" stroke="#ffb74d" stroke-width="1" rx="3" />`
      );
      elements.push(
        `<text x="${width - padding.right + 46}" y="${orMidY + 3}" fill="#ffb74d" font-family="-apple-system, sans-serif" font-size="9" font-weight="600" text-anchor="middle">OR MID $${orb.orMid.toFixed(
          orb.orMid < 1 ? 4 : 2
        )}</text>`
      );
    }

    // Render Garis Stop Loss
    if (signal.stopLossPrice > 0) {
      const slY = y(signal.stopLossPrice);
      elements.push(
        `<line x1="${padding.left}" y1="${slY}" x2="${width - padding.right}" y2="${slY}" stroke="#e91e63" stroke-width="1.8" stroke-dasharray="4,2" />`
      );
      elements.push(
        `<text x="${padding.left + 8}" y="${slY - 4}" fill="#e91e63" font-family="-apple-system, sans-serif" font-size="10" font-weight="700">SL: $${signal.stopLossPrice.toFixed(
          signal.stopLossPrice < 1 ? 4 : 2
        )}</text>`
      );
    }

    // Render Garis Take Profit
    if (signal.takeProfitPrice > 0) {
      const tpY = y(signal.takeProfitPrice);
      elements.push(
        `<line x1="${padding.left}" y1="${tpY}" x2="${width - padding.right}" y2="${tpY}" stroke="#00e676" stroke-width="1.8" stroke-dasharray="4,2" />`
      );
      elements.push(
        `<text x="${padding.left + 8}" y="${tpY - 4}" fill="#00e676" font-family="-apple-system, sans-serif" font-size="10" font-weight="700">TP: $${signal.takeProfitPrice.toFixed(
          signal.takeProfitPrice < 1 ? 4 : 2
        )}</text>`
      );
    }

    // Render Aggression Mark Bubble pada Candle Terakhir
    const lastIdx = candleCount - 1;
    const lastCx = x(lastIdx);
    const triggerCandle = candleSlice[lastIdx];

    if (aggression && aggression.isAbsorption) {
      const isUpper = aggression.upperZone;
      const bubbleY = isUpper ? y(triggerCandle.high) - 10 : y(triggerCandle.low) + 10;
      const bubbleColor = isUpper ? "#00e676" : "#ff1744"; // Lime jika sell absorption di atas, Red jika buy absorption di bawah
      const labelText = isUpper ? "WHALE SELLING ABSORPTION" : "WHALE BUYING ABSORPTION";
      const radius = aggression.tier === "E" ? 12 : aggression.tier === "D" ? 10 : 8;

      // Lingkaran luar glowing
      elements.push(
        `<circle cx="${lastCx}" cy="${bubbleY}" r="${radius + 5}" fill="${bubbleColor}" opacity="0.35" />`
      );
      // Lingkaran inti
      elements.push(
        `<circle cx="${lastCx}" cy="${bubbleY}" r="${radius}" fill="${bubbleColor}" stroke="#ffffff" stroke-width="2" />`
      );

      // Label penanda box (diposisikan agar tidak keluar canvas)
      const badgeBoxWidth = 190;
      const badgeX = Math.max(padding.left + 10, Math.min(lastCx - badgeBoxWidth / 2, width - padding.right - badgeBoxWidth));
      const badgeY = isUpper
        ? Math.max(padding.top + 20, bubbleY - 16)
        : Math.min(height - padding.bottom - 20, bubbleY + 20);

      elements.push(
        `<rect x="${badgeX}" y="${badgeY - 11}" width="${badgeBoxWidth}" height="20" fill="rgba(19, 23, 34, 0.95)" stroke="${bubbleColor}" stroke-width="1.2" rx="4" />`
      );
      elements.push(
        `<text x="${badgeX + badgeBoxWidth / 2}" y="${badgeY + 3}" fill="${bubbleColor}" font-family="-apple-system, sans-serif" font-size="9" font-weight="700" text-anchor="middle">[${labelText} Tier ${aggression.tier}]</text>`
      );
    }

    // Header Chart (Badge & Informasi Trade)
    const isShort = signal.positionSide === "SHORT";
    const badgeColor = isShort ? "#f23645" : "#089981";
    const badgeText = isShort ? "SHORT ENTRY (SWEEP OR HIGH)" : "LONG ENTRY (SWEEP OR LOW)";

    elements.push(
      `<text x="${padding.left}" y="28" fill="#ffffff" font-family="-apple-system, sans-serif" font-size="18" font-weight="700">${symbol} [${timeframe}]</text>`
    );
    elements.push(
      `<rect x="${padding.left}" y="36" width="220" height="20" fill="${badgeColor}" rx="4" />`
    );
    elements.push(
      `<text x="${padding.left + 110}" y="50" fill="#ffffff" font-family="-apple-system, sans-serif" font-size="10" font-weight="700" text-anchor="middle">${badgeText}</text>`
    );

    // Header Right
    elements.push(
      `<text x="${width - padding.right + 85}" y="28" fill="#ffd700" font-family="-apple-system, sans-serif" font-size="14" font-weight="700" text-anchor="end">Score: ${signal.score}/100 [High]</text>`
    );
    elements.push(
      `<text x="${width - padding.right + 85}" y="48" fill="#787b86" font-family="-apple-system, sans-serif" font-size="11" text-anchor="end">Aggression Mark + Hourly ORB</text>`
    );

    const svgContent = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${elements.join(
      ""
    )}</svg>`;

    const resvg = new Resvg(svgContent, {
      fitTo: { mode: "width", value: width },
      font: {
        loadSystemFonts: true,
      },
    });

    const pngData = resvg.render();
    return pngData.asPng();
  } catch (err: any) {
    logger.error("Gagal membuat chart snapshot:", err?.message || err);
    return null;
  }
}

export interface TradeCloseChartOptions {
  symbol: string;
  timeframe: string;
  klines: KlineItem[];
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  initialSl?: number;
  openedAt?: number;
  closedAt?: number;
  netProfit: number;
  pnlPercent: number;
  realizedPnl?: number;
  commission?: number;
  reason: string;
  leverage?: number;
}

/**
 * Generate Trade Lifecycle Chart: visualizes the trade journey from Entry to Exit,
 * with shaded PnL zone, Entry & Exit markers, PnL badge, and performance HUD.
 */
export function generateTradeCloseChart(options: TradeCloseChartOptions): Buffer | null {
  try {
    const {
      symbol,
      timeframe,
      klines,
      side,
      entryPrice,
      exitPrice,
      initialSl,
      openedAt,
      closedAt,
      netProfit,
      pnlPercent,
      realizedPnl,
      commission,
      reason,
      leverage,
    } = options;

    if (!klines || klines.length < 5) {
      return null;
    }

    // Ambil 35 candle terakhir
    const candleSlice = klines.slice(Math.max(0, klines.length - 35));
    const candleCount = candleSlice.length;

    const width = 850;
    const height = 480;
    const padding = { top: 75, bottom: 65, left: 20, right: 95 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    // Hitung range harga (termasuk entry, exit, initialSl)
    const validPrices = [
      ...candleSlice.map((c) => c.low),
      ...candleSlice.map((c) => c.high),
      entryPrice,
      exitPrice,
    ];
    if (initialSl && initialSl > 0) validPrices.push(initialSl);

    let minPrice = Math.min(...validPrices);
    let maxPrice = Math.max(...validPrices);
    const priceRange = maxPrice - minPrice || 1;
    minPrice -= priceRange * 0.1;
    maxPrice += priceRange * 0.1;

    const x = (idx: number) => padding.left + (idx + 0.5) * (plotWidth / candleCount);
    const y = (price: number) => padding.top + (1 - (price - minPrice) / (maxPrice - minPrice)) * plotHeight;
    const candleWidth = Math.max(3, (plotWidth / candleCount) * 0.7);
    const priceDecimals = exitPrice < 1 ? 4 : 2;

    const elements: string[] = [];

    // Background chart
    elements.push(`<rect width="${width}" height="${height}" fill="#131722"/>`);

    // Grid horizontal & Price Labels
    const gridSteps = 5;
    for (let i = 0; i <= gridSteps; i++) {
      const p = minPrice + (maxPrice - minPrice) * (i / gridSteps);
      const gridY = y(p);
      elements.push(
        `<line x1="${padding.left}" y1="${gridY}" x2="${width - padding.right}" y2="${gridY}" stroke="#2a2e39" stroke-width="0.8" stroke-dasharray="3,3" />`
      );
      elements.push(
        `<text x="${width - padding.right + 8}" y="${gridY + 4}" fill="#787b86" font-family="-apple-system, sans-serif" font-size="10">$${p.toFixed(
          priceDecimals
        )}</text>`
      );
    }

    // Grid vertical & Time Labels
    const timeStep = Math.max(1, Math.floor(candleCount / 6));
    for (let i = 0; i < candleCount; i += timeStep) {
      const cx = x(i);
      elements.push(
        `<line x1="${cx}" y1="${padding.top}" x2="${cx}" y2="${height - padding.bottom}" stroke="#1f232d" stroke-width="0.8" />`
      );
      const date = new Date(candleSlice[i].time);
      const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      elements.push(
        `<text x="${cx}" y="${height - padding.bottom + 16}" fill="#787b86" font-family="-apple-system, sans-serif" font-size="10" text-anchor="middle">${timeStr}</text>`
      );
    }

    // Render Candlesticks
    candleSlice.forEach((c, idx) => {
      const cx = x(idx);
      const isUp = c.close >= c.open;
      const color = isUp ? "#089981" : "#f23645";
      const yHigh = y(c.high);
      const yLow = y(c.low);
      const yOpen = y(c.open);
      const yClose = y(c.close);

      // Wick
      elements.push(
        `<line x1="${cx}" y1="${yHigh}" x2="${cx}" y2="${yLow}" stroke="${color}" stroke-width="1.2" />`
      );

      // Body
      const bodyTop = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen));
      elements.push(
        `<rect x="${cx - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${bodyHeight}" fill="${color}" stroke="${color}" stroke-width="0.5" rx="1" />`
      );
    });

    // Identifikasi Candle Entry & Candle Exit
    const exitIdx = candleCount - 1;
    let entryIdx = 0;
    if (openedAt && openedAt > 0) {
      let minDiff = Infinity;
      for (let i = 0; i < candleCount; i++) {
        const diff = Math.abs(candleSlice[i].time - openedAt);
        if (diff < minDiff) {
          minDiff = diff;
          entryIdx = i;
        }
      }
      entryIdx = Math.min(entryIdx, exitIdx - 1);
    } else {
      entryIdx = Math.max(0, candleCount - 15);
    }

    const xEntry = x(entryIdx);
    const xExit = x(exitIdx);
    const yEntry = y(entryPrice);
    const yExit = y(exitPrice);

    // Hitung R-Multiple jika ada initial SL
    let rMultipleStr = "";
    if (initialSl && initialSl > 0) {
      const riskPerUnit = Math.abs(entryPrice - initialSl);
      if (riskPerUnit > 0) {
        const pnlUnits = side === "LONG" ? exitPrice - entryPrice : entryPrice - exitPrice;
        const r = pnlUnits / riskPerUnit;
        rMultipleStr = `${r >= 0 ? "+" : ""}${r.toFixed(1)}R`;
      }
    }

    // Tentukan Win / Loss / BE status
    const isBE = reason === "BREAK_EVEN" || (Math.abs(pnlPercent) < 0.5 && Math.abs(netProfit) < 1.0);
    const isWin = netProfit >= 0;

    let zoneFill = "rgba(8, 153, 129, 0.22)";
    let zoneStroke = "rgba(8, 153, 129, 0.7)";
    let zoneTitle = "PROFIT ZONE";
    let themeColor = "#00e676";

    if (isBE) {
      zoneFill = "rgba(33, 150, 243, 0.20)";
      zoneStroke = "rgba(33, 150, 243, 0.7)";
      zoneTitle = "BREAK-EVEN ZONE";
      themeColor = "#29b6f6";
    } else if (!isWin) {
      zoneFill = "rgba(242, 54, 69, 0.22)";
      zoneStroke = "rgba(242, 54, 69, 0.7)";
      zoneTitle = "LOSS ZONE";
      themeColor = "#ff1744";
    }

    // 1. Shaded PnL Zone (Kotak Arsiran Entry ➡️ Exit)
    const zoneX = Math.min(xEntry, xExit);
    const zoneWidth = Math.max(Math.abs(xExit - xEntry), 35);
    const zoneY = Math.min(yEntry, yExit);
    const zoneHeight = Math.max(Math.abs(yExit - yEntry), 6);

    elements.push(
      `<rect x="${zoneX}" y="${zoneY}" width="${zoneWidth}" height="${zoneHeight}" fill="${zoneFill}" stroke="${zoneStroke}" stroke-width="1.2" stroke-dasharray="4,3" rx="4" />`
    );

    const zoneLabelX = zoneX + zoneWidth / 2;
    const zoneLabelY = zoneY + zoneHeight / 2;
    const zoneLabelText = rMultipleStr ? `${zoneTitle} (${rMultipleStr})` : zoneTitle;
    const badgeW = zoneLabelText.length * 7 + 16;
    elements.push(
      `<rect x="${zoneLabelX - badgeW / 2}" y="${zoneLabelY - 9}" width="${badgeW}" height="18" fill="rgba(19, 23, 34, 0.92)" stroke="${themeColor}" stroke-width="1" rx="3" />`
    );
    elements.push(
      `<text x="${zoneLabelX}" y="${zoneLabelY + 4}" fill="${themeColor}" font-family="-apple-system, sans-serif" font-size="9" font-weight="700" text-anchor="middle">${zoneLabelText}</text>`
    );

    // 2. Garis Vektor Penghubung Entry ke Exit
    elements.push(
      `<line x1="${xEntry}" y1="${yEntry}" x2="${xExit}" y2="${yExit}" stroke="${themeColor}" stroke-width="2" stroke-dasharray="5,3" />`
    );

    // 3. Initial Stop Loss Line (jika ada)
    if (initialSl && initialSl > 0) {
      const slY = y(initialSl);
      elements.push(
        `<line x1="${padding.left}" y1="${slY}" x2="${width - padding.right}" y2="${slY}" stroke="#e91e63" stroke-width="1.2" stroke-dasharray="3,3" opacity="0.7" />`
      );
      elements.push(
        `<text x="${padding.left + 8}" y="${slY - 4}" fill="#e91e63" font-family="-apple-system, sans-serif" font-size="9" font-weight="600" opacity="0.8">INITIAL SL: $${initialSl.toFixed(
          priceDecimals
        )}</text>`
      );
    }

    // 4. Marker Titik Entry
    elements.push(
      `<circle cx="${xEntry}" cy="${yEntry}" r="8" fill="#2962ff" opacity="0.4" />`
    );
    elements.push(
      `<circle cx="${xEntry}" cy="${yEntry}" r="4" fill="#2962ff" stroke="#ffffff" stroke-width="1.5" />`
    );
    const entryBadgeY = yEntry > padding.top + 30 ? yEntry - 18 : yEntry + 22;
    elements.push(
      `<rect x="${Math.max(padding.left, xEntry - 55)}" y="${entryBadgeY - 10}" width="110" height="18" fill="rgba(19, 23, 34, 0.95)" stroke="#2962ff" stroke-width="1" rx="3" />`
    );
    elements.push(
      `<text x="${Math.max(padding.left + 55, xEntry)}" y="${entryBadgeY + 3}" fill="#82b1ff" font-family="-apple-system, sans-serif" font-size="9" font-weight="700" text-anchor="middle">ENTRY: $${entryPrice.toFixed(
        priceDecimals
      )}</text>`
    );

    // 5. Marker Titik Exit
    elements.push(
      `<circle cx="${xExit}" cy="${yExit}" r="9" fill="${themeColor}" opacity="0.4" />`
    );
    elements.push(
      `<circle cx="${xExit}" cy="${yExit}" r="5" fill="${themeColor}" stroke="#ffffff" stroke-width="2" />`
    );
    const exitBadgeY = yExit > padding.top + 30 ? yExit - 18 : yExit + 22;
    elements.push(
      `<rect x="${xExit - 105}" y="${exitBadgeY - 10}" width="105" height="18" fill="rgba(19, 23, 34, 0.95)" stroke="${themeColor}" stroke-width="1" rx="3" />`
    );
    elements.push(
      `<text x="${xExit - 52}" y="${exitBadgeY + 3}" fill="${themeColor}" font-family="-apple-system, sans-serif" font-size="9" font-weight="700" text-anchor="middle">EXIT: $${exitPrice.toFixed(
        priceDecimals
      )}</text>`
    );

    // 6. Header (Title, Badge PnL, Trigger & Durasi)
    const levText = leverage ? ` (${leverage}x)` : "";
    elements.push(
      `<text x="${padding.left}" y="28" fill="#ffffff" font-family="-apple-system, sans-serif" font-size="18" font-weight="700">${symbol} [${timeframe}] - ${side}${levText} CLOSE</text>`
    );

    let badgeBg = "#089981";
    let badgeText = `WIN: +$${netProfit.toFixed(2)} (+${pnlPercent.toFixed(2)}%)`;
    if (isBE) {
      badgeBg = "#0288d1";
      badgeText = `BREAK-EVEN: +$${netProfit.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`;
    } else if (!isWin) {
      badgeBg = "#f23645";
      badgeText = `LOSS: -$${Math.abs(netProfit).toFixed(2)} (${pnlPercent.toFixed(2)}%)`;
    }

    elements.push(
      `<rect x="${padding.left}" y="36" width="240" height="22" fill="${badgeBg}" rx="4" />`
    );
    elements.push(
      `<text x="${padding.left + 120}" y="51" fill="#ffffff" font-family="-apple-system, sans-serif" font-size="11" font-weight="700" text-anchor="middle">${badgeText}</text>`
    );

    let durationStr = "-";
    if (openedAt && closedAt && closedAt > openedAt) {
      const diffMins = Math.round((closedAt - openedAt) / 60000);
      if (diffMins < 60) {
        durationStr = `${diffMins}m`;
      } else {
        const h = Math.floor(diffMins / 60);
        const m = diffMins % 60;
        durationStr = `${h}j ${m}m`;
      }
    }

    elements.push(
      `<text x="${width - padding.right + 85}" y="28" fill="${themeColor}" font-family="-apple-system, sans-serif" font-size="13" font-weight="700" text-anchor="end">Trigger: [${reason}]</text>`
    );
    elements.push(
      `<text x="${width - padding.right + 85}" y="48" fill="#90caf9" font-family="-apple-system, sans-serif" font-size="11" text-anchor="end">Duration: ${durationStr}</text>`
    );

    // 7. Footer Performance Bar (HUD)
    const grossVal = realizedPnl !== undefined ? realizedPnl : netProfit;
    const grossSign = grossVal >= 0 ? "+" : "";
    const grossStr = `${grossSign}$${grossVal.toFixed(2)}`;
    const feeStr = commission !== undefined ? `-$${Math.abs(commission).toFixed(2)}` : "$0.00";
    const netSign = netProfit >= 0 ? "+" : "";
    const netStr = `${netSign}$${netProfit.toFixed(2)} USDT`;
    const rMultiTag = rMultipleStr ? ` | R-Mult: ${rMultipleStr}` : "";
    const hudText = `Gross: ${grossStr} | Fee: ${feeStr} | Net PnL: ${netStr}${rMultiTag} | Hold: ${durationStr}`;

    elements.push(
      `<rect x="${padding.left}" y="${height - 28}" width="${width - padding.left - 15}" height="22" fill="rgba(255, 255, 255, 0.05)" rx="4" />`
    );
    elements.push(
      `<text x="${(width - padding.left - 15) / 2 + padding.left}" y="${height - 14}" fill="#b2b5be" font-family="-apple-system, sans-serif" font-size="10" font-weight="600" text-anchor="middle">${hudText}</text>`
    );

    const svgContent = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${elements.join(
      ""
    )}</svg>`;

    const resvg = new Resvg(svgContent, {
      fitTo: { mode: "width", value: width },
      font: {
        loadSystemFonts: true,
      },
    });

    const pngData = resvg.render();
    return pngData.asPng();
  } catch (err: any) {
    logger.error("Gagal membuat trade close chart:", err?.message || err);
    return null;
  }
}

