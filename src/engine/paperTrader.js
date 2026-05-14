const crypto = require("crypto");

// Singleton state persisted across route instances
let trades = [];
let wallet = {
  balance: 100000,
  initialCapital: 100000,
  deposits: [],
  withdrawals: [],
};
let autoTradeEnabled = false;
let autoTradeInterval = null;
let autoTradeConfig = {
  maxOpenPositions: 5,
  lotSize: 50,
  stopLossPercent: 2.5,
  targetPercent: 4,
  trailingSL: true,
  minMomentumScore: 8,
  autoCloseMinutes: 20, // auto close after 20 min if no SL/target hit
};

class PaperTrader {
  constructor() {}

  // ===== WALLET / FUNDS =====
  getWallet() {
    const realized = this._getRealizedPnl();
    const unrealized = this._getUnrealizedPnl();
    const blocked = this._getBlockedMargin();
    return {
      balance: wallet.balance.toFixed(2),
      availableBalance: (wallet.balance - blocked).toFixed(2),
      blockedMargin: blocked.toFixed(2),
      initialCapital: wallet.initialCapital.toFixed(2),
      totalDeposits: wallet.deposits.reduce((s, d) => s + d.amount, 0).toFixed(2),
      realizedPnl: realized.toFixed(2),
      unrealizedPnl: unrealized.toFixed(2),
      netWorth: (wallet.balance + unrealized).toFixed(2),
      returns: (((wallet.balance - wallet.initialCapital + unrealized) / wallet.initialCapital) * 100).toFixed(2),
      deposits: wallet.deposits,
    };
  }

  addFunds(amount) {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return { error: "Invalid amount" };
    wallet.balance += amt;
    wallet.deposits.push({ amount: amt, time: new Date().toISOString(), type: "deposit" });
    return { success: true, newBalance: wallet.balance.toFixed(2), message: `₹${amt} added successfully` };
  }

  withdrawFunds(amount) {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return { error: "Invalid amount" };
    const blocked = this._getBlockedMargin();
    if (amt > wallet.balance - blocked) return { error: "Insufficient available balance" };
    wallet.balance -= amt;
    wallet.withdrawals.push({ amount: amt, time: new Date().toISOString(), type: "withdrawal" });
    return { success: true, newBalance: wallet.balance.toFixed(2), message: `₹${amt} withdrawn` };
  }

  resetAccount() {
    trades = [];
    wallet = { balance: 100000, initialCapital: 100000, deposits: [], withdrawals: [] };
    return { success: true, message: "Account reset to ₹1,00,000" };
  }

  // ===== TRADING =====
  placeTrade({ symbol, type, strikePrice, premium, quantity, direction }) {
    const qty = quantity || autoTradeConfig.lotSize;
    const cost = premium * qty;
    const blocked = this._getBlockedMargin();

    if (cost > wallet.balance - blocked) {
      return { error: "Insufficient funds", required: cost.toFixed(2), available: (wallet.balance - blocked).toFixed(2) };
    }

    const id = crypto.randomBytes(8).toString("hex");
    const slPercent = autoTradeConfig.stopLossPercent / 100;
    const tgtPercent = autoTradeConfig.targetPercent / 100;

    const trade = {
      id,
      symbol: symbol || `NIFTY${strikePrice}${type}`,
      type,
      direction: direction || "BUY",
      strikePrice,
      entryPremium: parseFloat(premium),
      currentPremium: parseFloat(premium),
      quantity: qty,
      entryTime: new Date().toISOString(),
      exitTime: null,
      exitPremium: null,
      pnl: 0,
      pnlPercent: 0,
      status: "open",
      stopLoss: parseFloat((premium * (1 - slPercent)).toFixed(2)),
      target: parseFloat((premium * (1 + tgtPercent)).toFixed(2)),
      margin: cost,
      autoTrade: false,
    };

    trades.push(trade);
    return trade;
  }

  closeTrade(id, exitPremium) {
    const trade = trades.find((t) => t.id === id);
    if (!trade) return { error: "Trade not found" };
    if (trade.status === "closed") return { error: "Trade already closed" };

    const exit = exitPremium != null ? parseFloat(exitPremium) : this._simulateExit(trade);
    trade.exitPremium = exit;
    trade.currentPremium = exit;
    trade.exitTime = new Date().toISOString();
    trade.status = "closed";

    if (trade.direction === "BUY") {
      trade.pnl = parseFloat(((exit - trade.entryPremium) * trade.quantity).toFixed(2));
    } else {
      trade.pnl = parseFloat(((trade.entryPremium - exit) * trade.quantity).toFixed(2));
    }
    trade.pnlPercent = parseFloat(((trade.pnl / (trade.entryPremium * trade.quantity)) * 100).toFixed(2));

    // Update wallet balance with realized P&L
    wallet.balance += trade.pnl;

    return trade;
  }

  // ===== AUTOMATED TRADING =====
  autoTrade(momentum, niftyLtp) {
    const score = parseFloat(momentum.score || 0);
    const manipulationRisk = momentum.manipulationRisk || "LOW";
    const hftSuspects = momentum.hftSuspects || 0;
    const openPositions = trades.filter((t) => t.status === "open");

    // Check if we should close existing positions first
    const closedTrades = this._checkAutoClose(openPositions);

    // SAFETY: Block trading during high manipulation risk
    if (manipulationRisk === "HIGH") {
      return {
        message: `⚠️ BLOCKED: High manipulation risk (${hftSuspects} HFT flags). Protecting capital.`,
        trade: null,
        closedTrades,
        autoEnabled: autoTradeEnabled,
        blocked: true,
        reason: "HFT_MANIPULATION_RISK",
      };
    }

    // Require stronger signal if medium manipulation risk
    const threshold = manipulationRisk === "MEDIUM"
      ? autoTradeConfig.minMomentumScore * 1.5
      : autoTradeConfig.minMomentumScore;

    if (Math.abs(score) < threshold) {
      return {
        message: `Momentum ${score.toFixed(0)} below threshold (${threshold.toFixed(0)}). ${manipulationRisk !== "LOW" ? "⚠️ Raised due to HFT activity." : "Watching..."}`,
        trade: null,
        closedTrades,
        autoEnabled: autoTradeEnabled,
      };
    }

    if (openPositions.length >= autoTradeConfig.maxOpenPositions) {
      return {
        message: `Max positions (${autoTradeConfig.maxOpenPositions}) reached. Monitoring existing trades.`,
        trade: null,
        closedTrades,
        autoEnabled: autoTradeEnabled,
      };
    }

    const ltp = parseFloat(niftyLtp) || 24200;
    const strikeInterval = 50;
    const nearestStrike = Math.round(ltp / strikeInterval) * strikeInterval;

    // Determine direction based on volume-confirmed signals
    const type = score > 0 ? "CE" : "PE";
    const direction = "BUY";
    const strike = type === "CE" ? nearestStrike + 50 : nearestStrike - 50;

    // Simulate realistic premium
    const distFromATM = Math.abs(strike - ltp);
    const basePremium = Math.max(50, 200 - distFromATM * 0.5);
    const premium = parseFloat((basePremium + Math.random() * 80).toFixed(2));

    const trade = this.placeTrade({
      symbol: `NIFTY${strike}${type}`,
      type,
      strikePrice: strike,
      premium,
      quantity: autoTradeConfig.lotSize,
      direction,
    });

    if (trade.error) {
      return { message: `Cannot place trade: ${trade.error}`, trade: null, closedTrades };
    }

    trade.autoTrade = true;

    return {
      message: `AUTO ${direction} ${type} @ Strike ${strike} | Premium ₹${premium}`,
      signal: score > 0 ? "BULLISH" : "BEARISH",
      trade,
      closedTrades,
      autoEnabled: autoTradeEnabled,
    };
  }

  // Simulate price movement and check SL/Target
  _checkAutoClose(openPositions) {
    const closed = [];
    for (const trade of openPositions) {
      // Simulate current premium movement
      const elapsed = (Date.now() - new Date(trade.entryTime).getTime()) / 60000;
      const drift = (Math.random() - 0.45) * 0.03 * Math.sqrt(elapsed);
      trade.currentPremium = parseFloat((trade.entryPremium * (1 + drift)).toFixed(2));

      // Check stop loss
      if (trade.direction === "BUY" && trade.currentPremium <= trade.stopLoss) {
        const result = this.closeTrade(trade.id, trade.stopLoss);
        result.closeReason = "STOP_LOSS";
        closed.push(result);
        continue;
      }

      // Check target
      if (trade.direction === "BUY" && trade.currentPremium >= trade.target) {
        const result = this.closeTrade(trade.id, trade.target);
        result.closeReason = "TARGET_HIT";
        closed.push(result);
        continue;
      }

      // Auto close after time limit
      if (elapsed > autoTradeConfig.autoCloseMinutes) {
        const result = this.closeTrade(trade.id, trade.currentPremium);
        result.closeReason = "TIME_EXPIRY";
        closed.push(result);
      }
    }
    return closed;
  }

  _simulateExit(trade) {
    const elapsed = (Date.now() - new Date(trade.entryTime).getTime()) / 60000;
    const drift = (Math.random() - 0.42) * 0.05 * Math.sqrt(Math.max(elapsed, 1));
    return parseFloat((trade.entryPremium * (1 + drift)).toFixed(2));
  }

  // ===== AUTO TRADE TOGGLE =====
  getAutoTradeStatus() {
    return { enabled: autoTradeEnabled, config: autoTradeConfig };
  }

  setAutoTradeEnabled(enabled) {
    autoTradeEnabled = enabled;
    return { enabled: autoTradeEnabled, message: enabled ? "Auto-trading ENABLED" : "Auto-trading DISABLED" };
  }

  updateAutoTradeConfig(config) {
    autoTradeConfig = { ...autoTradeConfig, ...config };
    return { success: true, config: autoTradeConfig };
  }

  // ===== HELPERS =====
  _getRealizedPnl() {
    return trades.filter((t) => t.status === "closed").reduce((s, t) => s + (t.pnl || 0), 0);
  }

  _getUnrealizedPnl() {
    return trades
      .filter((t) => t.status === "open")
      .reduce((s, t) => {
        const current = t.currentPremium || t.entryPremium;
        if (t.direction === "BUY") return s + (current - t.entryPremium) * t.quantity;
        return s + (t.entryPremium - current) * t.quantity;
      }, 0);
  }

  _getBlockedMargin() {
    return trades
      .filter((t) => t.status === "open")
      .reduce((s, t) => s + t.entryPremium * t.quantity, 0);
  }

  getAllTrades() {
    return trades;
  }

  getOpenPositions() {
    // Update current premiums for open positions
    trades.filter((t) => t.status === "open").forEach((t) => {
      const elapsed = (Date.now() - new Date(t.entryTime).getTime()) / 60000;
      const drift = (Math.random() - 0.45) * 0.02 * Math.sqrt(Math.max(elapsed, 0.5));
      t.currentPremium = parseFloat((t.entryPremium * (1 + drift)).toFixed(2));
    });
    return trades.filter((t) => t.status === "open");
  }

  getTradeHistory() {
    return trades.filter((t) => t.status === "closed");
  }

  getPnLSummary() {
    const closed = trades.filter((t) => t.status === "closed");
    const totalPnl = this._getRealizedPnl();
    const openPnl = this._getUnrealizedPnl();

    return {
      realizedPnl: totalPnl.toFixed(2),
      unrealizedPnl: openPnl.toFixed(2),
      totalPnl: (totalPnl + openPnl).toFixed(2),
      totalTrades: trades.length,
      openTrades: trades.filter((t) => t.status === "open").length,
      closedTrades: closed.length,
      balance: wallet.balance.toFixed(2),
      autoTradeEnabled: autoTradeEnabled,
    };
  }
}

module.exports = PaperTrader;
