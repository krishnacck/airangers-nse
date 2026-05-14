const express = require("express");
const router = express.Router();
const PaperTrader = require("../engine/paperTrader");

const trader = new PaperTrader();

// Get all trades
router.get("/", (req, res) => {
  res.json(trader.getAllTrades());
});

// Get open positions
router.get("/positions", (req, res) => {
  res.json(trader.getOpenPositions());
});

// Place a paper trade (BUY or SELL)
router.post("/place", (req, res) => {
  const { symbol, type, strikePrice, premium, quantity, direction } = req.body;
  const trade = trader.placeTrade({
    symbol,
    type,
    strikePrice,
    premium,
    quantity: quantity || 50,
    direction: direction || "BUY",
  });
  res.json(trade);
});

// Close a position
router.post("/close/:id", (req, res) => {
  const { exitPremium } = req.body;
  const result = trader.closeTrade(req.params.id, exitPremium);
  res.json(result);
});

// Get P&L summary
router.get("/pnl", (req, res) => {
  res.json(trader.getPnLSummary());
});

// Auto-trade based on momentum
router.post("/auto-trade", (req, res) => {
  const { momentum, niftyLtp } = req.body;
  const trade = trader.autoTrade(momentum, niftyLtp);
  res.json(trade);
});

// Get trade history
router.get("/history", (req, res) => {
  res.json(trader.getTradeHistory());
});

// ===== AUTO TRADE CONTROLS =====
router.get("/auto-status", (req, res) => {
  res.json(trader.getAutoTradeStatus());
});

router.post("/auto-toggle", (req, res) => {
  const { enabled } = req.body;
  res.json(trader.setAutoTradeEnabled(enabled));
});

router.post("/auto-config", (req, res) => {
  res.json(trader.updateAutoTradeConfig(req.body));
});

// ===== WALLET / FUNDS =====
router.get("/wallet", (req, res) => {
  res.json(trader.getWallet());
});

router.post("/add-funds", (req, res) => {
  const { amount } = req.body;
  res.json(trader.addFunds(amount));
});

router.post("/withdraw-funds", (req, res) => {
  const { amount } = req.body;
  res.json(trader.withdrawFunds(amount));
});

router.post("/reset-account", (req, res) => {
  res.json(trader.resetAccount());
});

module.exports = router;
