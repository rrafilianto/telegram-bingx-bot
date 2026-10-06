# BingX 24/7 Futures Trading & Telegram Monitoring Bot

A robust, autonomous 24/7 algorithmic trading bot for **BingX USDT-M Perpetual Futures**, designed for stability on VPS servers using **PM2** and featuring full bi-directional **Telegram Bot** integration.

---

## 🌟 Key Features

### 1. Dynamic Market Scanner (Top Volume Ranking)
- Scans BingX perpetual swap pairs periodically (default: every 5 minutes).
- Automatically filters and analyzes the top volume trading pairs.
- Multi-timeframe trend evaluation:
  - **15-Minute Timeframe (Execution)**: EMA (9/21), RSI (14), MACD, and ATR (14).
  - **1-Hour Timeframe (Macro Trend)**: EMA (50) trend filter to ensure trading aligns with the macro market direction.

### 2. Crypto Market Sentiment & Macro Filters
- Integrated with the **Crypto Fear & Greed Index** (via Alternative.me).
- Monitors BingX **Average Funding Rates** to safeguard against extreme crowd positioning and potential liquidation squeezes.

### 3. Dynamic Risk Management & Circuit Breakers
- **Dynamic Lot Sizing**: Computes position size based on account equity and configured risk percentage per trade (e.g., 2% of equity).
- **Daily Circuit Breaker**: Automatically halts automated trading if daily losses hit the maximum drawdown threshold (default: -5%).
- **Cooldown After Loss**: Applies a cooldown period (default: 45 minutes) to symbols that hit Stop Loss before considering them again.
- **Position Limit**: Enforces a maximum number of concurrent open positions (default: 3 pairs).

### 4. ATR-Based Dynamic Trailing Take Profit
- **Uncapped Profit Potential**: Fixed Take Profit (TP) targets are removed in favor of a native exchange Trailing Stop to let profits run during strong trends and market breakouts.
- **Native BingX `TRAILING_STOP_MARKET` Orders**: Placed directly on the BingX matching engine for ultra-low latency execution and reliability even during server restarts.
- **Volatility-Adapted Callback Rate**: The callback rate (`priceRate`) dynamically adapts to each coin's 15m ATR ratio (`ATR / EntryPrice`), clamped between **0.6% and 2.5%**:
  - Calmer pairs (e.g., BTC, ETH) receive tighter callback buffers.
  - Volatile altcoins (e.g., SOL, POL, meme tokens) receive wider breathing room to avoid premature stop-outs from normal market noise.
- **Dynamic Activation Price**: The trailing stop activates once price travels $+1.5\text{R}$ into profit.

### 5. Break-Even (BE) Stop Protection
- When a position reaches $+1\text{R}$ profit (matching the initial risk distance), the bot automatically moves the Stop Loss to the **Entry price**.
- Transforms the trade into a **Risk-Free** position before Trailing TP takes over.

### 6. Accurate Exchange Reconciliation & Trade Journaling
- When a position closes, the bot queries BingX historical trade orders (`/openApi/swap/v2/trade/allOrders`) to record:
  - Exact filled exit price (`avgPrice`).
  - Real realized PnL and commissions directly from BingX.
  - Actual trigger reason: `TRAILING_TP`, `TAKE_PROFIT`, `BREAK_EVEN`, or `STOP_LOSS`.
- Persists trade history, daily statistics, and cooldowns in `data/bot_state.json`.

### 7. Automated Telegram Reports & Notifications
- **Real-Time Trade Alerts**: Sent on Order Opened, Break-Even Activated, Trailing TP Activated, and Position Closed.
- **Daily 08:00 AM (WIB) Trading Summary**: Sends a comprehensive account summary every morning at 08:00 AM (configurable timezone: `Asia/Jakarta`).
- **Periodic 10-Minute Position Updates**: Broadcasts floating PnL, mark prices, SL levels, and trailing status every 10 minutes when positions are open.

### 8. Interactive Telegram Commands
- `/status` : View bot uptime, environment mode, and today's PnL statistics.
- `/balance` : View wallet balance, available margin, equity, and floating PnL.
- `/positions` : Monitor live active positions with inline **[Close Position]** buttons.
- `/summary` : Instantly request the daily summary performance report on demand.
- `/sentiment` : Check real-time Fear & Greed index and funding rate sentiment.
- `/scan` : Trigger an immediate manual market scan of top volume pairs.
- `/pause` & `/resume` : Temporarily pause or re-enable autonomous trade executions.
- `/help` : Display command guide and available shortcuts.

---

## 📁 Project Structure

```text
telegram-bingx/
├── src/
│   ├── index.ts                  # Main entry point & 24/7 background scheduler
│   ├── config.ts                 # Configuration loader and environment validator
│   ├── bingx/
│   │   ├── client.ts             # BingX REST client (HMAC SHA-256, auto-retry, fallback URL)
│   │   ├── market.ts             # 24h tickers, volume rankings, K-lines, contract specs
│   │   ├── trade.ts              # Order placement, Trailing Stops, SL, leverage & margin
│   │   ├── account.ts            # Balance, open positions, fee rates, income history
│   │   └── ws.ts                 # Real-time WebSocket connection (GZIP decompression, heartbeat)
│   ├── analysis/
│   │   ├── scanner.ts            # Dynamic market scanner for top volume tokens
│   │   ├── technical.ts          # Technical indicators (EMA 9/21/50, RSI 14, MACD, ATR 14)
│   │   ├── sentiment.ts          # Fear & Greed Index and funding rate evaluation
│   │   └── strategy.ts           # Signal generation, ATR-based trailing parameters
│   ├── execution/
│   │   ├── riskManager.ts        # Dynamic lot sizing, risk validation, circuit breaker
│   │   ├── orderExecutor.ts      # Market entry + SL + native Trailing Stop order placement
│   │   └── positionMonitor.ts    # 24/7 position tracking, Break-Even triggers, trade close reconciliation
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
- PM2 (for 24/7 VPS background operation)

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

> **Telegram Chat ID Tip**: If you do not know your Telegram Chat ID yet, you can leave `TELEGRAM_CHAT_ID` empty initially. Start the bot, open your bot in Telegram, and send `/start`. The bot will automatically detect and record your Chat ID!

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

You can customize trading and risk parameters inside [src/config.ts](file:///Users/ryan/Documents/Project/analyzer/telegram-bingx/src/config.ts) or by adding environment variables:

| Variable | Default | Description |
|---|---|---|
| `BINGX_ENV` | `prod-vst` | `prod-vst` for demo trading, `prod-live` for live trading |
| `DEFAULT_LEVERAGE` | `10` | Leverage multiplier (e.g., 10x) |
| `MARGIN_TYPE` | `ISOLATED` | `ISOLATED` or `CROSSED` margin mode |
| `MAX_CONCURRENT_POSITIONS` | `3` | Maximum concurrent open positions allowed |
| `RISK_PER_TRADE_PERCENT` | `2.0` | Risk percentage per trade relative to wallet equity |
| `MAX_DAILY_DRAWDOWN_PERCENT`| `5.0` | Maximum daily drawdown before triggering circuit breaker |
| `COOLDOWN_MINUTES_AFTER_LOSS`| `45` | Minutes a token is blacklisted from scanning after a Stop Loss |
| `SCAN_INTERVAL_MINUTES` | `5` | Market scanner execution frequency (in minutes) |
| `MONITOR_INTERVAL_SECONDS` | `15` | Position monitor loop frequency (in seconds) |
| `BREAK_EVEN_TRIGGER_R` | `1.0` | R-multiple profit distance to move Stop Loss to Entry price |
| `TRAILING_ACTIVATION_R` | `1.5` | R-multiple profit distance where BingX Trailing Stop activates |
| `TRAILING_ATR_MULTIPLIER` | `1.0` | Multiplier for ATR callback calculation |
| `DAILY_SUMMARY_HOUR` | `8` | Hour to dispatch the daily trading summary (e.g., 8 for 08:00 AM) |
| `TIME_ZONE` | `Asia/Jakarta` | Timezone for scheduled daily reports and date tracking |

---

## 🔒 Security Best Practices

1. **Test in Simulation First (`prod-vst`)**: Always run the bot in BingX virtual simulation mode (`prod-vst`) for several days before using real funds (`prod-live`).
2. **API Key Permissions**: Ensure your BingX API key only has **Perpetual Futures Trading** enabled. Do **NOT** enable withdrawal permissions.
3. **IP Whitelisting**: For live trading, whitelist your VPS server's static IP address in your BingX API management console.
4. **Environment Isolation**: Never commit `.env` or sensitive API keys to version control.

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
