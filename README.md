# AIRangers - Nifty 50 Options Paper Trading

AI-powered real-time paper trading system for Nifty 50 options using Fyers API.

## Features

- **Real-time Market Data** - Live Nifty 50 stock prices and momentum analysis
- **Momentum Engine** - Analyzes all 50 stocks to determine overall market direction
- **Auto Trading** - Automatically picks nearest strike CE/PE based on momentum
- **Paper Trading** - Place and track mock orders with P&L tracking
- **Analytics Dashboard** - Win rate, profit factor, daily P&L breakdown
- **Fyers API Integration** - Connect your Fyers account for live data
- **Simulated Mode** - Works without API connection using simulated data

## Setup

1. Install dependencies:
```bash
cd airangers
npm install
```

2. Configure `.env` file with your Fyers API credentials:
```
FYERS_APP_ID=your_app_id_here
FYERS_SECRET_KEY=your_secret_key_here
FYERS_REDIRECT_URL=http://localhost:3000/auth/callback
```

3. Start the server:
```bash
npm start
```

4. Open `http://localhost:3000` in your browser.

## How It Works

1. **Market Analysis** - Fetches all Nifty 50 stock prices
2. **Momentum Calculation** - Counts bullish/bearish/neutral stocks
3. **Signal Generation** - If momentum is strong, recommends CE (bullish) or PE (bearish)
4. **Strike Selection** - Picks nearest ATM strike price (50-point intervals)
5. **Paper Order** - Places mock order with stop-loss and target
6. **P&L Tracking** - Tracks all trades and calculates profitability

## Pages

- **Dashboard** - Overview with momentum, signals, P&L
- **Market Data** - All 50 stocks with live momentum indicators
- **Trades** - Manual order placement and trade history
- **Positions** - Open positions with SL/Target
- **Analytics** - Detailed performance metrics

## Getting Fyers API Credentials

1. Go to https://myapi.fyers.in/
2. Create an app with redirect URL: `http://localhost:3000/auth/callback`
3. Copy App ID and Secret Key to `.env`
