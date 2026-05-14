const express = require("express");
const router = express.Router();
const scheduler = require("../engine/autoTradeScheduler");
const auth = require("./auth");

// Get scheduler status
router.get("/status", (req, res) => {
  res.json(scheduler.getSchedulerStatus());
});

// Start auto-trading
router.post("/start", (req, res) => {
  const result = scheduler.startScheduler(() => auth.getFyersClient());
  res.json(result);
});

// Stop auto-trading
router.post("/stop", (req, res) => {
  res.json(scheduler.stopScheduler());
});

// Get scheduler logs
router.get("/logs", (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(scheduler.getSchedulerLogs(limit));
});

// Update scheduler config
router.post("/config", (req, res) => {
  res.json(scheduler.updateSchedulerConfig(req.body));
});

// Check market hours
router.get("/market-hours", (req, res) => {
  res.json(scheduler.isMarketHours());
});

module.exports = router;
