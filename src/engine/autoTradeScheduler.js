/**
 * AUTO TRADE SCHEDULER
 * 
 * Runs in the background on the server. No browser needed.
 * - Checks market hours (9:15 AM - 3:30 PM IST, Mon-Fri)
 * - Fetches market data at configurable intervals
 * - Analyzes momentum and places/closes trades automatically
 * - Logs all activity
 */

const MomentumEngine = require("./momentum");
const PaperTrader = require("./paperTrader");

const momentumEngine = new MomentumEngine();
const trader = new PaperTrader();

let schedulerInterval = null;
let isRunning = false;
let lastRun = null;
let logs = [];

const config = {
  enabled: false,
  intervalSeconds: 60, // check every 60 seconds
  marketOpenHour: 9,
  marketOpenMinute: 15,
  marketCloseHour: 15,
  marketCloseMinute: 30,
  preMarketMinutes: 5, // start analyzing 5 min before open
  autoCloseBeforeMarketClose: 5, // close all positions 5 min before close
  maxTradesPerDay: 10,
  tradesToday: 0,
  lastTradeDate: null,
};

function addLog(type, message, data = null) {
  const entry = {
    time: new Date().toISOString(),
    type,
    message,
    data,
  };
  logs.push(entry);
  if (logs.length > 200) logs.shift();
  console.log(`[AutoTrader][${type}] ${message}`);
}

function isMarketHours() {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = utcMinutes + istOffset;
  const istHour = Math.floor(istMinutes / 60) % 24;
  const istMinute = istMinutes % 60;
  const istDay = now.getUTCDay(); // 0=Sun, 6=Sat

  // Weekend check
  if (istDay === 0 || istDay === 6) return { open: false, reason: "Weekend" };

  const marketOpen = config.marketOpenHour * 60 + config.marketOpenMinute;
  const marketClose = config.marketCloseHour * 60 + config.marketCloseMinute;
  const currentIST = istHour * 60 + istMinute;

  // Pre-market window
  const preMarketStart = marketOpen - config.preMarketMinutes;

  if (currentIST < preMarketStart) {
    return { open: false, reason: `Before market (${istHour}:${String(istMinute).padStart(2, "0")} IST)` };
  }
  if (currentIST > marketClose) {
    return { open: false, reason: `After market close (${istHour}:${String(istMinute).padStart(2, "0")} IST)` };
  }

  // Close positions window
  const closeWindow = marketClose - config.autoCloseBeforeMarketClose;
  if (currentIST >= closeWindow) {
    return { open: true, closingTime: true, reason: "Market closing soon" };
  }

  return { open: true, closingTime: false, reason: "Market open" };
}

async function runTradeCycle() {
  if (!config.enabled) return;

  const marketStatus = isMarketHours();
  lastRun = new Date().toISOString();

  // Reset daily trade count
  const today = new Date().toISOString().split("T")[0];
  if (config.lastTradeDate !== today) {
    config.tradesToday = 0;
    config.lastTradeDate = today;
  }

  if (!marketStatus.open) {
    addLog("IDLE", `Market closed: ${marketStatus.reason}`);
    return;
  }

  // If market is about to close, close all open positions
  if (marketStatus.closingTime) {
    const openPositions = trader.getOpenPositions();
    if (openPositions.length > 0) {
      addLog("CLOSE_ALL", `Market closing in ${config.autoCloseBeforeMarketClose} min. Closing ${openPositions.length} positions.`);
      for (const pos of openPositions) {
        const result = trader.closeTrade(pos.id);
        addLog("CLOSED", `${pos.symbol} P&L: ₹${(result.pnl || 0).toFixed(2)}`, result);
      }
    }
    return;
  }

  // Check daily trade limit
  if (config.tradesToday >= config.maxTradesPerDay) {
    addLog("LIMIT", `Daily trade limit reached (${config.maxTradesPerDay}). Monitoring only.`);
    // Still check for SL/Target on open positions
    const openPositions = trader.getOpenPositions();
    if (openPositions.length > 0) {
      trader.autoTrade({ score: 0, manipulationRisk: "LOW", hftSuspects: 0 }, 24200);
    }
    return;
  }

  try {
    // Fetch and analyze market data
    addLog("SCAN", "Fetching market data...");
    const stockData = momentumEngine.getSimulatedNifty50Data(); // Replace with live data when connected
    const momentum = momentumEngine.getOverallMomentum();
    const niftyIndex = momentumEngine.getSimulatedNiftyIndex();

    addLog("ANALYSIS", `Momentum: ${momentum.direction} (${momentum.score}) | Bullish: ${momentum.volumeConfirmedBullish} | Bearish: ${momentum.volumeConfirmedBearish} | HFT: ${momentum.hftSuspects}`, momentum);

    // Attempt auto trade
    const result = trader.autoTrade(momentum, niftyIndex.ltp);

    if (result.trade) {
      config.tradesToday++;
      addLog("TRADE", result.message, result.trade);
    } else if (result.blocked) {
      addLog("BLOCKED", result.message);
    } else {
      addLog("SKIP", result.message);
    }

    // Log closed trades from SL/Target hits
    if (result.closedTrades && result.closedTrades.length > 0) {
      for (const ct of result.closedTrades) {
        addLog("AUTO_CLOSE", `${ct.symbol} closed (${ct.closeReason}) P&L: ₹${(ct.pnl || 0).toFixed(2)}`, ct);
      }
    }
  } catch (err) {
    addLog("ERROR", `Trade cycle error: ${err.message}`);
  }
}

// Use live Fyers data if available
async function runTradeCycleLive(fyersClient) {
  if (!config.enabled) return;
  if (!fyersClient) {
    return runTradeCycle(); // fallback to simulated
  }

  const marketStatus = isMarketHours();
  lastRun = new Date().toISOString();

  const today = new Date().toISOString().split("T")[0];
  if (config.lastTradeDate !== today) {
    config.tradesToday = 0;
    config.lastTradeDate = today;
  }

  if (!marketStatus.open) {
    addLog("IDLE", `Market closed: ${marketStatus.reason}`);
    return;
  }

  if (marketStatus.closingTime) {
    const openPositions = trader.getOpenPositions();
    if (openPositions.length > 0) {
      addLog("CLOSE_ALL", `Closing ${openPositions.length} positions before market close.`);
      for (const pos of openPositions) {
        const result = trader.closeTrade(pos.id);
        addLog("CLOSED", `${pos.symbol} P&L: ₹${(result.pnl || 0).toFixed(2)}`, result);
      }
    }
    return;
  }

  if (config.tradesToday >= config.maxTradesPerDay) {
    addLog("LIMIT", `Daily limit (${config.maxTradesPerDay}) reached.`);
    return;
  }

  try {
    const { nifty50Symbols } = require("../config/symbols");
    const symbols = nifty50Symbols.map((s) => `NSE:${s}-EQ`);

    // Fetch live quotes
    const quotesRes = await fyersClient.getQuotes(symbols);
    if (quotesRes.s === "ok" && quotesRes.d) {
      momentumEngine.analyzeStocks(quotesRes.d);
    } else {
      momentumEngine.getSimulatedNifty50Data();
    }

    // Fetch Nifty index
    let niftyLtp = 24200;
    const indexRes = await fyersClient.getQuotes(["NSE:NIFTY50-INDEX"]);
    if (indexRes.s === "ok" && indexRes.d && indexRes.d[0]) {
      niftyLtp = indexRes.d[0].v.lp;
    }

    const momentum = momentumEngine.getOverallMomentum();
    addLog("LIVE_SCAN", `Score: ${momentum.score} | Dir: ${momentum.direction} | HFT: ${momentum.hftSuspects}`, momentum);

    const result = trader.autoTrade(momentum, niftyLtp);

    if (result.trade) {
      config.tradesToday++;
      addLog("TRADE", result.message, result.trade);
    } else if (result.blocked) {
      addLog("BLOCKED", result.message);
    } else {
      addLog("SKIP", result.message);
    }

    if (result.closedTrades && result.closedTrades.length > 0) {
      for (const ct of result.closedTrades) {
        addLog("AUTO_CLOSE", `${ct.symbol} (${ct.closeReason}) P&L: ₹${(ct.pnl || 0).toFixed(2)}`, ct);
      }
    }
  } catch (err) {
    addLog("ERROR", `Live cycle error: ${err.message}`);
    // Fallback to simulated
    runTradeCycle();
  }
}

// ===== SCHEDULER CONTROLS =====
function startScheduler(fyersClientGetter) {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  config.enabled = true;
  isRunning = true;
  addLog("START", `Auto-trader started. Interval: ${config.intervalSeconds}s`);

  // Run immediately
  const client = fyersClientGetter ? fyersClientGetter() : null;
  if (client) {
    runTradeCycleLive(client);
  } else {
    runTradeCycle();
  }

  // Then run on interval
  schedulerInterval = setInterval(() => {
    const client = fyersClientGetter ? fyersClientGetter() : null;
    if (client) {
      runTradeCycleLive(client);
    } else {
      runTradeCycle();
    }
  }, config.intervalSeconds * 1000);

  return { success: true, message: "Auto-trader started" };
}

function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  config.enabled = false;
  isRunning = false;
  addLog("STOP", "Auto-trader stopped");
  return { success: true, message: "Auto-trader stopped" };
}

function getSchedulerStatus() {
  return {
    enabled: config.enabled,
    isRunning,
    lastRun,
    marketStatus: isMarketHours(),
    config: {
      intervalSeconds: config.intervalSeconds,
      maxTradesPerDay: config.maxTradesPerDay,
      tradesToday: config.tradesToday,
      autoCloseBeforeMarketClose: config.autoCloseBeforeMarketClose,
    },
    openPositions: trader.getOpenPositions().length,
  };
}

function getSchedulerLogs(limit = 50) {
  return logs.slice(-limit);
}

function updateSchedulerConfig(newConfig) {
  if (newConfig.intervalSeconds) config.intervalSeconds = parseInt(newConfig.intervalSeconds);
  if (newConfig.maxTradesPerDay) config.maxTradesPerDay = parseInt(newConfig.maxTradesPerDay);
  if (newConfig.autoCloseBeforeMarketClose) config.autoCloseBeforeMarketClose = parseInt(newConfig.autoCloseBeforeMarketClose);

  // Restart if running with new interval
  if (isRunning && newConfig.intervalSeconds) {
    addLog("CONFIG", `Interval changed to ${config.intervalSeconds}s. Restarting...`);
    stopScheduler();
    startScheduler();
  }

  return { success: true, config };
}

module.exports = {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  getSchedulerLogs,
  updateSchedulerConfig,
  isMarketHours,
};
