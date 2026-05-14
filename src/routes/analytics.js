const express = require("express");
const router = express.Router();
const PaperTrader = require("../engine/paperTrader");

const trader = new PaperTrader();

// Get detailed analytics
router.get("/summary", (req, res) => {
  const trades = trader.getAllTrades();
  const closed = trades.filter((t) => t.status === "closed");
  const open = trades.filter((t) => t.status === "open");

  const totalTrades = closed.length;
  const winners = closed.filter((t) => t.pnl > 0);
  const losers = closed.filter((t) => t.pnl < 0);

  const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const avgWin = winners.length
    ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length
    : 0;
  const avgLoss = losers.length
    ? losers.reduce((s, t) => s + t.pnl, 0) / losers.length
    : 0;

  const winRate = totalTrades ? (winners.length / totalTrades) * 100 : 0;
  const maxWin = winners.length ? Math.max(...winners.map((t) => t.pnl)) : 0;
  const maxLoss = losers.length ? Math.min(...losers.map((t) => t.pnl)) : 0;

  res.json({
    totalTrades,
    openPositions: open.length,
    winRate: winRate.toFixed(1),
    totalPnl: totalPnl.toFixed(2),
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    maxWin: maxWin.toFixed(2),
    maxLoss: maxLoss.toFixed(2),
    profitFactor: avgLoss !== 0 ? Math.abs(avgWin / avgLoss).toFixed(2) : "N/A",
    capital: parseFloat(process.env.PAPER_TRADE_CAPITAL || 100000),
    returns: (
      (totalPnl / parseFloat(process.env.PAPER_TRADE_CAPITAL || 100000)) *
      100
    ).toFixed(2),
  });
});

// Get daily P&L breakdown
router.get("/daily", (req, res) => {
  const trades = trader.getAllTrades();
  const closed = trades.filter((t) => t.status === "closed");

  const dailyPnl = {};
  closed.forEach((t) => {
    const date = t.exitTime ? t.exitTime.split("T")[0] : t.entryTime.split("T")[0];
    dailyPnl[date] = (dailyPnl[date] || 0) + (t.pnl || 0);
  });

  const result = Object.entries(dailyPnl).map(([date, pnl]) => ({
    date,
    pnl: pnl.toFixed(2),
  }));

  res.json(result.sort((a, b) => a.date.localeCompare(b.date)));
});

module.exports = router;
