/**
 * DATA DUMPER - Background Job
 * 
 * Subscribes to Fyers WebSocket and dumps real-time tick data to JSON files:
 * - All 50 Nifty stocks
 * - Nifty 50 Index
 * - Nifty Options: ±10 strike levels from ATM (both CE and PE)
 * 
 * Runs independently from the frontend. Data saved to /data/ folder.
 */

const fs = require("fs");
const path = require("path");
const { nifty50Symbols } = require("../config/symbols");

const DATA_DIR = path.join(__dirname, "../../data");
const STRIKE_INTERVAL = 50;
const STRIKE_LEVELS = 10; // ±10 from ATM

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// In-memory store for latest ticks
let liveData = {
  timestamp: null,
  niftyIndex: null,
  stocks: {},
  options: { CE: {}, PE: {} },
  meta: {
    atmStrike: null,
    strikeLevels: STRIKE_LEVELS,
    strikeInterval: STRIKE_INTERVAL,
    subscribedSymbols: [],
  },
};

let wsConnection = null;
let isRunning = false;
let lastDumpTime = null;
let dumpInterval = null;
let dumpFrequencyMs = 5000; // write to file every 5 seconds

// ===== SYMBOL GENERATION =====

function getStockSymbols() {
  return nifty50Symbols.map((s) => `NSE:${s}-EQ`);
}

function getIndexSymbol() {
  return "NSE:NIFTY50-INDEX";
}

function getOptionSymbols(atmStrike) {
  const symbols = [];
  const currentMonth = getCurrentExpiryPrefix();

  for (let i = -STRIKE_LEVELS; i <= STRIKE_LEVELS; i++) {
    const strike = atmStrike + i * STRIKE_INTERVAL;
    symbols.push(`NSE:NIFTY${currentMonth}${strike}CE`);
    symbols.push(`NSE:NIFTY${currentMonth}${strike}PE`);
  }
  return symbols;
}

function getCurrentExpiryPrefix() {
  // Format: YYMM e.g. "2505" for May 2025
  // Fyers uses format like NIFTY25MAY24200CE or NIFTY2550524200CE
  // Using weekly format: NIFTYYYMD format varies, use nearest Thursday
  const now = new Date();
  const year = String(now.getFullYear()).slice(2);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = months[now.getMonth()];

  // Find next Thursday (weekly expiry)
  const day = now.getDate();
  const dayOfWeek = now.getDay();
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7 || 7;
  const nextThursday = day + (dayOfWeek <= 4 ? (4 - dayOfWeek) : daysUntilThursday);
  const expiryDay = String(nextThursday).padStart(2, "0");

  // Monthly format: NIFTY25MAY24200CE
  return `${year}${month}`;
}

function estimateATM(niftyLtp) {
  return Math.round(niftyLtp / STRIKE_INTERVAL) * STRIKE_INTERVAL;
}

// ===== WEBSOCKET CONNECTION =====

function startWebSocket(fyersClient, appId, accessToken) {
  if (isRunning) return { error: "Already running" };

  try {
    const { fyersDataSocket } = require("fyers-api-v3");

    const tokenStr = `${appId}:${accessToken}`;
    const logPath = path.join(__dirname, "../../logs");

    wsConnection = fyersDataSocket.getInstance(tokenStr, logPath, false);

    wsConnection.on("connect", () => {
      console.log("[DataDumper] WebSocket connected");

      // Subscribe to stocks + index
      const stockSymbols = getStockSymbols();
      const indexSymbol = getIndexSymbol();
      const allSymbols = [indexSymbol, ...stockSymbols];

      wsConnection.subscribe(allSymbols);
      liveData.meta.subscribedSymbols = allSymbols;

      console.log(`[DataDumper] Subscribed to ${allSymbols.length} symbols (stocks + index)`);
    });

    wsConnection.on("message", (message) => {
      processTickData(message);
    });

    wsConnection.on("error", (err) => {
      console.error("[DataDumper] WebSocket error:", err);
    });

    wsConnection.on("close", () => {
      console.log("[DataDumper] WebSocket closed");
      isRunning = false;
    });

    wsConnection.autoReconnect(10);
    wsConnection.connect();
    isRunning = true;

    // Start periodic file dump
    startFileDump();

    return { success: true, message: "WebSocket data dumper started" };
  } catch (err) {
    console.error("[DataDumper] Failed to start:", err.message);
    return { error: err.message };
  }
}

// Start without WebSocket (polling mode for when WS isn't available)
function startPolling(fyersClient) {
  if (isRunning) return { error: "Already running" };

  isRunning = true;
  console.log("[DataDumper] Starting in polling mode");

  const pollInterval = setInterval(async () => {
    if (!isRunning) {
      clearInterval(pollInterval);
      return;
    }

    try {
      await pollData(fyersClient);
    } catch (err) {
      console.error("[DataDumper] Poll error:", err.message);
    }
  }, dumpFrequencyMs);

  // Initial poll
  pollData(fyersClient);
  startFileDump();

  return { success: true, message: "Data dumper started (polling mode)" };
}

async function pollData(fyersClient) {
  if (!fyersClient) return;

  try {
    // Fetch stocks + index
    const stockSymbols = getStockSymbols();
    const indexSymbol = getIndexSymbol();

    const [stocksRes, indexRes] = await Promise.all([
      fyersClient.getQuotes(stockSymbols),
      fyersClient.getQuotes([indexSymbol]),
    ]);

    // Process index
    if (indexRes.s === "ok" && indexRes.d && indexRes.d[0]) {
      const d = indexRes.d[0].v;
      liveData.niftyIndex = {
        symbol: "NIFTY50",
        ltp: d.lp,
        change: d.ch,
        changePercent: d.chp,
        open: d.open_price,
        high: d.high_price,
        low: d.low_price,
        close: d.prev_close_price,
        timestamp: new Date().toISOString(),
      };

      // Subscribe to options based on ATM
      const atm = estimateATM(d.lp);
      if (atm !== liveData.meta.atmStrike) {
        liveData.meta.atmStrike = atm;
        await fetchOptions(fyersClient, atm);
      }
    }

    // Process stocks
    if (stocksRes.s === "ok" && stocksRes.d) {
      for (const q of stocksRes.d) {
        const d = q.v;
        const symbol = d.short_name || d.symbol;
        liveData.stocks[symbol] = {
          symbol,
          ltp: d.lp,
          change: d.ch,
          changePercent: d.chp,
          open: d.open_price,
          high: d.high_price,
          low: d.low_price,
          close: d.prev_close_price,
          volume: d.volume || d.vol_traded_today,
          bid: d.bid,
          ask: d.ask,
          timestamp: new Date().toISOString(),
        };
      }
    }

    liveData.timestamp = new Date().toISOString();
  } catch (err) {
    console.error("[DataDumper] Poll error:", err.message);
  }
}

async function fetchOptions(fyersClient, atmStrike) {
  try {
    const optionSymbols = getOptionSymbols(atmStrike);
    liveData.meta.subscribedSymbols = [
      ...getStockSymbols(),
      getIndexSymbol(),
      ...optionSymbols,
    ];

    const res = await fyersClient.getQuotes(optionSymbols);
    if (res.s === "ok" && res.d) {
      for (const q of res.d) {
        const d = q.v;
        const sym = d.short_name || d.symbol || "";
        const isCE = sym.includes("CE");
        const isPE = sym.includes("PE");

        const optData = {
          symbol: sym,
          ltp: d.lp,
          change: d.ch,
          changePercent: d.chp,
          open: d.open_price,
          high: d.high_price,
          low: d.low_price,
          close: d.prev_close_price,
          volume: d.volume || d.vol_traded_today,
          oi: d.open_interest || 0,
          bid: d.bid,
          ask: d.ask,
          timestamp: new Date().toISOString(),
        };

        if (isCE) liveData.options.CE[sym] = optData;
        else if (isPE) liveData.options.PE[sym] = optData;
      }
    }
  } catch (err) {
    console.error("[DataDumper] Options fetch error:", err.message);
  }
}

// ===== TICK PROCESSING (WebSocket mode) =====

function processTickData(tick) {
  if (!tick) return;

  const symbol = tick.symbol || tick.sym || "";
  const data = {
    symbol,
    ltp: tick.ltp || tick.lp,
    change: tick.ch,
    changePercent: tick.chp,
    open: tick.open_price || tick.o,
    high: tick.high_price || tick.h,
    low: tick.low_price || tick.l,
    close: tick.prev_close_price || tick.c,
    volume: tick.vol_traded_today || tick.v,
    bid: tick.bid,
    ask: tick.ask,
    oi: tick.oi,
    timestamp: new Date().toISOString(),
  };

  if (symbol.includes("NIFTY50-INDEX") || symbol === "NSE:NIFTY50-INDEX") {
    liveData.niftyIndex = data;

    // Update ATM and option subscriptions
    const atm = estimateATM(data.ltp);
    if (atm !== liveData.meta.atmStrike) {
      liveData.meta.atmStrike = atm;
      // Re-subscribe to new option strikes
      const optSymbols = getOptionSymbols(atm);
      if (wsConnection) {
        wsConnection.subscribe(optSymbols);
      }
    }
  } else if (symbol.includes("CE")) {
    liveData.options.CE[symbol] = data;
  } else if (symbol.includes("PE")) {
    liveData.options.PE[symbol] = data;
  } else {
    const cleanSymbol = symbol.replace("NSE:", "").replace("-EQ", "");
    liveData.stocks[cleanSymbol] = data;
  }

  liveData.timestamp = new Date().toISOString();
}

// ===== FILE DUMP =====

function startFileDump() {
  if (dumpInterval) clearInterval(dumpInterval);

  dumpInterval = setInterval(() => {
    writeDumpFile();
  }, dumpFrequencyMs);
}

function writeDumpFile() {
  try {
    const filename = `market_data_${new Date().toISOString().split("T")[0]}.json`;
    const filepath = path.join(DATA_DIR, filename);

    // Write latest snapshot
    const snapshot = {
      ...liveData,
      dumpTime: new Date().toISOString(),
      stockCount: Object.keys(liveData.stocks).length,
      ceCount: Object.keys(liveData.options.CE).length,
      peCount: Object.keys(liveData.options.PE).length,
    };

    fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
    lastDumpTime = new Date().toISOString();

    // Also write a "latest.json" for quick access
    const latestPath = path.join(DATA_DIR, "latest.json");
    fs.writeFileSync(latestPath, JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.error("[DataDumper] File write error:", err.message);
  }
}

// ===== SIMULATED DUMP (when no Fyers connection) =====

function startSimulated() {
  if (isRunning) return { error: "Already running" };

  isRunning = true;
  console.log("[DataDumper] Starting in simulated mode");

  const niftyBase = 24200;
  liveData.meta.atmStrike = estimateATM(niftyBase);

  const simInterval = setInterval(() => {
    if (!isRunning) {
      clearInterval(simInterval);
      return;
    }

    const niftyLtp = niftyBase + (Math.random() - 0.5) * 300;
    const atm = estimateATM(niftyLtp);
    liveData.meta.atmStrike = atm;

    // Simulate index
    liveData.niftyIndex = {
      symbol: "NIFTY50",
      ltp: parseFloat(niftyLtp.toFixed(2)),
      change: parseFloat(((niftyLtp - niftyBase) * 0.5).toFixed(2)),
      changePercent: parseFloat((((niftyLtp - niftyBase) / niftyBase) * 100).toFixed(2)),
      open: niftyBase,
      high: parseFloat((niftyLtp + 80).toFixed(2)),
      low: parseFloat((niftyLtp - 80).toFixed(2)),
      close: niftyBase,
      timestamp: new Date().toISOString(),
    };

    // Simulate stocks
    for (const sym of nifty50Symbols) {
      const base = 500 + Math.random() * 3000;
      const change = (Math.random() - 0.48) * 3;
      liveData.stocks[sym] = {
        symbol: sym,
        ltp: parseFloat(base.toFixed(2)),
        change: parseFloat((base * change / 100).toFixed(2)),
        changePercent: parseFloat(change.toFixed(2)),
        open: parseFloat((base * 0.99).toFixed(2)),
        high: parseFloat((base * 1.02).toFixed(2)),
        low: parseFloat((base * 0.98).toFixed(2)),
        close: parseFloat((base * (1 - change / 100)).toFixed(2)),
        volume: Math.floor(Math.random() * 5000000),
        bid: parseFloat((base - 0.1).toFixed(2)),
        ask: parseFloat((base + 0.1).toFixed(2)),
        timestamp: new Date().toISOString(),
      };
    }

    // Simulate options ±10 strikes
    liveData.options.CE = {};
    liveData.options.PE = {};
    for (let i = -STRIKE_LEVELS; i <= STRIKE_LEVELS; i++) {
      const strike = atm + i * STRIKE_INTERVAL;
      const distFromATM = Math.abs(i) * STRIKE_INTERVAL;

      const cePremium = Math.max(5, 200 - distFromATM * 0.3 + (i > 0 ? -i * 10 : Math.abs(i) * 5) + Math.random() * 20);
      const pePremium = Math.max(5, 200 - distFromATM * 0.3 + (i < 0 ? Math.abs(i) * 10 : -i * 5) + Math.random() * 20);

      const ceSymbol = `NIFTY${strike}CE`;
      const peSymbol = `NIFTY${strike}PE`;

      liveData.options.CE[ceSymbol] = {
        symbol: ceSymbol,
        strike,
        ltp: parseFloat(cePremium.toFixed(2)),
        change: parseFloat(((Math.random() - 0.5) * 10).toFixed(2)),
        oi: Math.floor(Math.random() * 1000000),
        volume: Math.floor(Math.random() * 500000),
        bid: parseFloat((cePremium - 0.5).toFixed(2)),
        ask: parseFloat((cePremium + 0.5).toFixed(2)),
        timestamp: new Date().toISOString(),
      };

      liveData.options.PE[peSymbol] = {
        symbol: peSymbol,
        strike,
        ltp: parseFloat(pePremium.toFixed(2)),
        change: parseFloat(((Math.random() - 0.5) * 10).toFixed(2)),
        oi: Math.floor(Math.random() * 1000000),
        volume: Math.floor(Math.random() * 500000),
        bid: parseFloat((pePremium - 0.5).toFixed(2)),
        ask: parseFloat((pePremium + 0.5).toFixed(2)),
        timestamp: new Date().toISOString(),
      };
    }

    liveData.timestamp = new Date().toISOString();
  }, dumpFrequencyMs);

  startFileDump();
  return { success: true, message: "Data dumper started (simulated mode)" };
}

// ===== CONTROLS =====

function stop() {
  isRunning = false;
  if (wsConnection) {
    try { wsConnection.close(); } catch (e) {}
    wsConnection = null;
  }
  if (dumpInterval) {
    clearInterval(dumpInterval);
    dumpInterval = null;
  }
  console.log("[DataDumper] Stopped");
  return { success: true, message: "Data dumper stopped" };
}

function getStatus() {
  return {
    isRunning,
    lastDumpTime,
    dataDir: DATA_DIR,
    stockCount: Object.keys(liveData.stocks).length,
    ceStrikes: Object.keys(liveData.options.CE).length,
    peStrikes: Object.keys(liveData.options.PE).length,
    atmStrike: liveData.meta.atmStrike,
    niftyLtp: liveData.niftyIndex?.ltp || null,
    subscribedCount: liveData.meta.subscribedSymbols.length,
  };
}

function getLatestData() {
  return liveData;
}

function setDumpFrequency(ms) {
  dumpFrequencyMs = Math.max(1000, parseInt(ms) || 5000);
  if (isRunning) startFileDump(); // restart with new frequency
  return { success: true, frequency: dumpFrequencyMs };
}

module.exports = {
  startWebSocket,
  startPolling,
  startSimulated,
  stop,
  getStatus,
  getLatestData,
  setDumpFrequency,
};
