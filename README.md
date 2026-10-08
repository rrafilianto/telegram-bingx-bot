# BingX 24/7 Futures Trading & Telegram Monitoring Bot

A robust, autonomous 24/7 algorithmic trading bot for **BingX USDT-M Perpetual Futures**, designed for rock-solid stability on VPS servers using **PM2** and featuring full bi-directional **Telegram Bot** control & real-time monitoring.

---

## 🌟 Key Features

### 1. Dynamic Market Scanner & Pure Crypto Filter
- **Top Volume Liquidity Ranking**: Periodically scans BingX USDT-M perpetual contracts (default: every 5 minutes) and filters the highest 24h volume pairs for optimal liquidity and minimal slippage.
- **Pure Crypto Filtering**: Automatically detects and excludes BingX TradFi/Non-Crypto instruments (symbols with prefixes `NCFX` Forex, `NCCO` Commodities, `NCSK` Stocks, `NCSI` Indices), ensuring only crypto perpetual futures are scanned and traded.
- **Multi-Timeframe Trend Confirmation**:
  - **15-Minute Timeframe (Execution)**: EMA (9/21/50), RSI (14), MACD histogram, and ATR (14) to catch pullback continuations with rejection confirmation.
  - **1-Hour Timeframe (Macro Trend)**: 50 EMA and EMA 9/21 alignment to ensure trades align with macro market momentum.

### 2. Crypto Market Sentiment & Funding Rate Safeguard
- **Fear & Greed Index Integration**: Live sentiment scoring via Alternative.me to avoid aggressive long entries in extreme euphoria or counter-trend shorts in panic depressions.
- **Average Funding Rate Monitoring**: Tracks broad BingX perpetual funding rates to safeguard against crowd overcrowding and squeeze risks.

### 3. Dynamic Risk Management & Circuit Breakers
- **ATR-Based Dynamic Lot Sizing**: Calculates position size dynamically based on wallet equity, leverage, and a configurable risk percentage per trade (default: 2% of equity).
- **Concurrent Position Cap**: Enforces a strict limit on active concurrent positions (default: **5 positions**) to prevent overexposure.
- **Daily Drawdown Circuit Breaker**: Automatically halts automated trade execution if net daily losses reach the maximum threshold (default: -5% of daily starting balance).
- **Post-Loss Cooldown**: Enforces a cooldown period (default: 45 minutes) on any symbol that hits Stop Loss before allowing new entries on that pair.
- **Configurable Blacklist**: Exclude risky, delisting, or illiquid symbols (e.g. `LUNA-USDT,USTC-USDT`).

### 4. ATR-Based Dynamic Trailing Take Profit
- **Uncapped Profit Potential**: Fixed Take Profit targets are replaced by exchange-native Trailing Stops, allowing winning trades to ride major market breakouts.
- **Native BingX `TRAILING_STOP_MARKET` Orders**: Placed directly on the BingX matching engine for ultra-low latency execution and reliability during network hiccups or bot restarts.
- **Volatility-Adapted Callback Rate**: The callback rate (`priceRate`) dynamically adapts to each coin's 15m ATR ratio (`ATR / EntryPrice`), clamped between **0.6% and 2.5%**:
  - Calmer pairs (e.g., BTC, ETH) receive tighter callback buffers.
  - Volatile altcoins (e.g., SOL, POL, meme tokens) receive wider breathing room to prevent premature stop-outs.
- **Dynamic Activation Price**: The trailing stop activates once price reaches $+1.5\text{R}$ in profit.

### 5. Automated Break-Even (BE) Stop Protection
- When price reaches $+1.0\text{R}$ in profit (matching the initial stop-loss risk distance), the bot automatically moves the Stop Loss to the **Entry price**.
- Transforms the trade into a **Risk-Free** position before Trailing TP locks in profits.

### 6. Accurate Exchange Reconciliation & PnL Breakdown
- **Zero-Guesswork Execution**: Resolves closed positions directly from BingX Position History (`/openApi/swap/v1/trade/positionHistory`) and Trade Orders (`/openApi/swap/v2/trade/allOrders`) with multi-cycle retry and deferred finalization.
- **Transparent PnL Accounting**:
  - **Realized PnL (Gross)**: Pure price differential profit.
  - **Trading Fees**: Exact exchange commission paid.
  - **Funding Fees**: Total cumulative funding paid or received.
  - **Net Profit**: Final net earnings after all fees and funding deductions.
- Persists trade history, daily statistics, and cooldowns in `data/bot_state.json`.

### 7. Automated Telegram Reports & Notifications
- **Real-Time Trade Alerts**: Instant Telegram notifications for Order Opened, Break-Even Activated, Trailing TP Activated, and Position Closed.
- **Periodic 10-Minute Position Updates**: Live updates on active positions including:
  - Entry Price & Current Mark Price
  - Stop Loss & **Break-Even Status** (`⏳ Belum Aktif` / `✅ Sudah Aktif`)
  - Take Profit & **Trailing TP Status** (`⏳ Belum Aktif (Target $...)` / `🚀 Sudah Aktif (Running)`)
  - **Floating PnL** with profit/loss indicators (`🟢` / `🔴`)
- **Daily 08:00 AM (WIB) Trading Summary**: Comprehensive performance recap featuring equity, wallet balance, trade count, win rate, Gross PnL, Total Fees, Total Funding, Net Profit, and open positions.

### 8. Interactive Telegram Commands
- `/start` : Initialize bot interaction and automatically bind your Telegram Chat ID.
- `/help` : Display command guide and available shortcuts.
- `/status` : View bot uptime, environment mode (`prod-vst` / `prod-live`), auto-trade status, and today's Gross & Net PnL.
- `/balance` : View wallet balance, available margin, total equity, and floating PnL with status icon.
- `/positions` : Monitor live active positions with BE status, Trailing status, and interactive inline **[❌ Tutup Posisi]** buttons for instant manual close.
- `/summary` : Instantly request the daily performance report on demand.
- `/sentiment` : Check real-time Fear & Greed index and funding rate sentiment.
- `/scan` : Trigger an immediate manual market scan of top volume pairs.
- `/pause` & `/resume` : Temporarily pause or re-enable autonomous trade executions.

---

## 📁 Project Structure

```text
telegram-bingx/
├── src/
│   ├── index.ts                  # Main entry point & 24/7 background scheduler
│   ├── config.ts                 # Configuration loader and environment validator
│   ├── bingx/
│   │   ├── client.ts             # BingX REST client (HMAC SHA-256, auto-retry, fallback URL)
│   │   ├── market.ts             # 24h tickers, volume rankings, K-lines, contract specs (NC filter)
│   │   ├── trade.ts              # Order placement, Trailing Stops, SL, leverage & margin
│   │   ├── account.ts            # Balance, open positions, fee rates, income history
│   │   └── ws.ts                 # Real-time WebSocket connection (GZIP decompression, heartbeat)
│   ├── analysis/
│   │   ├── scanner.ts            # Dynamic market scanner for top volume crypto tokens
│   │   ├── technical.ts          # Technical indicators (EMA 9/21/50, RSI 14, MACD, ATR 14)
│   │   ├── sentiment.ts          # Fear & Greed Index and funding rate evaluation
│   │   └── strategy.ts           # Trend-following pullback strategy, ATR trailing parameters
│   ├── execution/
│   │   ├── riskManager.ts        # Dynamic lot sizing, risk validation, daily circuit breaker
│   │   ├── orderExecutor.ts      # Market entry + SL + native Trailing Stop order placement
│   │   └── positionMonitor.ts    # 24/7 position tracking, BE triggers, delay-tolerant reconciliation
│   ├── telegram/
│   │   ├── bot.ts                # Grammy Telegram bot initialization & menu setup
│   │   ├── notifier.ts           # Notification dispatcher (alerts, 10m update, daily summary)
│   │   └── commands.ts           # Interactive command handlers (/status, /positions, etc.)
│   └── utils/
│       ├── logger.ts             # Formatted console logger with timestamps
│       └── storage.ts            # Persistent JSON state manager (positions, journal, cooldowns)
├── data/
│   └── bot_state.json            # Local storage for bot state, active trades, and daily stats
├── ecosystem.config.cjs          # PM2 configuration for 24/7 process management
├── .env.example                  # Environment variables template
├── .gitignore                    # Git ignored patterns & secrets protection
├── package.json
└── tsconfig.json
```

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js (v18.x or v20.x recommended)
- npm
- PM2 (for 24/7 background operation on VPS)

### 1. Clone & Install Dependencies
```bash
git clone <repository-url>
cd telegram-bingx
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure your credentials inside `.env`:
```env
# ==========================================
# BingX API Credentials
# Get yours at: https://bingx.com/en/accounts/api
# ==========================================
BINGX_API_KEY=your_bingx_api_key
BINGX_SECRET_KEY=your_bingx_secret_key

# Environment: prod-vst (Demo / Paper Trading) or prod-live (Real Funds)
BINGX_ENV=prod-vst

# ==========================================
# Telegram Bot Credentials
# Obtain bot token from @BotFather on Telegram
# ==========================================
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
```

> **Telegram Chat ID Tip**: If you do not know your Telegram Chat ID yet, leave `TELEGRAM_CHAT_ID` empty initially. Start the bot, open your bot in Telegram, and send `/start`. The bot will automatically detect and bind your Chat ID!

---

### 3. Build the Project
Compile the TypeScript code to JavaScript:
```bash
npm run build
```

---

### 4. Running Locally / Development Mode
To run with automatic TypeScript compilation:
```bash
npm run dev
```

Or to run the compiled build:
```bash
npm start
```

---

### 5. Running 24/7 on VPS with PM2

Install PM2 globally:
```bash
npm install -g pm2
```

Start the bot process via PM2:
```bash
npm run pm2:start
```

Useful PM2 management commands:
```bash
npm run pm2:logs       # View real-time output logs
npm run pm2:restart    # Restart the bot process
npm run pm2:stop       # Stop the bot
pm2 save               # Save current PM2 process list to survive VPS reboots
pm2 startup            # Register PM2 as a system service for auto-start
```

---

## ⚙️ Configuration Reference

You can customize trading and risk parameters inside [src/config.ts](file:///Users/ryan/Documents/Project/analyzer/telegram-bingx/src/config.ts) or by overriding them via `.env`:

| Variable | Default | Description |
|---|---|---|
| `BINGX_ENV` | `prod-vst` | `prod-vst` for demo trading, `prod-live` for live trading |
| `DEFAULT_LEVERAGE` | `10` | Leverage multiplier (e.g., 10x) |
| `MARGIN_TYPE` | `ISOLATED` | `ISOLATED` or `CROSSED` margin mode |
| `MAX_CONCURRENT_POSITIONS` | `5` | Maximum concurrent open positions allowed |
| `RISK_PER_TRADE_PERCENT` | `2.0` | Risk percentage per trade relative to wallet equity |
| `MAX_DAILY_DRAWDOWN_PERCENT`| `5.0` | Maximum daily net drawdown before triggering circuit breaker |
| `MAX_POSITION_NOTIONAL_PERCENT` | `100` | Maximum notional value of a single position as % of equity |
| `COOLDOWN_MINUTES_AFTER_LOSS`| `45` | Minutes a token is blacklisted from scanning after a Stop Loss |
| `SCAN_INTERVAL_MINUTES` | `5` | Market scanner execution frequency (in minutes) |
| `MONITOR_INTERVAL_SECONDS` | `15` | Position monitor loop frequency (in seconds) |
| `TOP_VOLUME_LIMIT` | `15` | Number of top volume crypto pairs analyzed per scan cycle |
| `TIMEFRAME_PRIMARY` | `15m` | Primary timeframe for indicator calculation and entry triggers |
| `TIMEFRAME_TREND` | `1h` | Higher timeframe for macro trend filter (EMA 50) |
| `RR_RATIO` | `1.5` | Target Risk-Reward ratio |
| `ATR_MULTIPLIER_SL` | `2.5` | ATR multiplier to set initial Stop Loss distance |
| `MIN_SL_PERCENT` | `1.5` | Minimum Stop Loss distance from entry (%) |
| `MAX_SL_PERCENT` | `4.5` | Maximum Stop Loss distance from entry (%) |
| `BREAK_EVEN_TRIGGER_R` | `1.0` | R-multiple profit distance to move Stop Loss to Entry price |
| `TRAILING_ACTIVATION_R` | `1.5` | R-multiple profit distance where BingX Trailing Stop activates |
| `TRAILING_ATR_MULTIPLIER` | `1.0` | Multiplier for ATR callback calculation |
| `TRAILING_MIN_CALLBACK_RATE` | `0.006` | Minimum callback rate for Trailing Stop (0.6%) |
| `TRAILING_MAX_CALLBACK_RATE` | `0.025` | Maximum callback rate for Trailing Stop (2.5%) |
| `DAILY_SUMMARY_HOUR` | `8` | Hour to dispatch the daily trading summary (e.g., 8 for 08:00 AM) |
| `DAILY_SUMMARY_MINUTE` | `0` | Minute to dispatch the daily trading summary |
| `TIME_ZONE` | `Asia/Jakarta` | Timezone for scheduled daily reports and date tracking |
| `BLACKLIST_SYMBOLS` | `LUNA-USDT,USTC-USDT` | Comma-separated list of symbols to exclude from trading |

---

## 🔒 Security Best Practices

1. **Test in Simulation First (`prod-vst`)**: Always run the bot in BingX virtual simulation mode (`prod-vst`) for several days before using real funds (`prod-live`).
2. **API Key Permissions**: Ensure your BingX API key only has **Perpetual Futures Trading** enabled. Do **NOT** enable withdrawal permissions.
3. **IP Whitelisting**: For live trading, whitelist your VPS server's static IP address in your BingX API management console.
4. **Environment Isolation**: Never commit `.env` or sensitive API keys to version control.

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
