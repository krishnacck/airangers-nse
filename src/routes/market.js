const express = require("express");
const router = express.Router();
const { nifty50Symbols } = require("../config/symbols");
const MomentumEngine = require("../engine/momentum");
const auth = require("./auth");

const momentumEngine = new MomentumEngine();

// Get Nifty 50 stocks data with momentum
router.get("/nifty50", async (req, res) => {
  try {
    const client = auth.getFyersClient();

    if (client) {
      // Live mode: fetch real data from Fyers
      const symbols = nifty50Symbols.map((s) => `NSE:${s}-EQ`);
      const response = await client.getQuotes(symbols);

      if (response.s === "ok" && response.d) {
        const analyzed = momentumEngine.analyzeStocks(response.d);
        return res.json(analyzed);
      }
    }

    // Simulated mode
    res.json(momentumEngine.getSimulatedNifty50Data());
  } catch (err) {
    console.error("Market data error:", err.message);
    res.json(momentumEngine.getSimulatedNifty50Data());
  }
});

// Get overall market momentum
router.get("/momentum", (req, res) => {
  res.json(momentumEngine.getOverallMomentum());
});

// Get option recommendation for Nifty
router.get("/options", async (req, res) => {
  try {
    const momentum = momentumEngine.getOverallMomentum();
    const options = momentumEngine.getOptionRecommendation(momentum);
    res.json(options);
  } catch (err) {
    console.error("Options error:", err.message);
    res.status(500).json({ error: "Failed to fetch options data" });
  }
});

// Get HFT / manipulation alerts
router.get("/hft-alerts", (req, res) => {
  res.json(momentumEngine.getHFTAlerts());
});

// Get live Nifty index value
router.get("/nifty-index", async (req, res) => {
  try {
    const client = auth.getFyersClient();

    if (client) {
      const response = await client.getQuotes(["NSE:NIFTY50-INDEX"]);

      if (response.s === "ok" && response.d && response.d.length > 0) {
        const data = response.d[0].v;
        return res.json({
          symbol: "NIFTY 50",
          ltp: data.lp,
          change: data.ch,
          changePercent: data.chp,
          high: data.high_price,
          low: data.low_price,
          open: data.open_price,
          close: data.prev_close_price,
        });
      }
    }

    // Simulated
    res.json(momentumEngine.getSimulatedNiftyIndex());
  } catch (err) {
    res.json(momentumEngine.getSimulatedNiftyIndex());
  }
});

module.exports = router;
