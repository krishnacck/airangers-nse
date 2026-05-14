require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fyersAuth = require("./src/routes/auth");
const marketRoutes = require("./src/routes/market");
const tradeRoutes = require("./src/routes/trades");
const analyticsRoutes = require("./src/routes/analytics");
const schedulerRoutes = require("./src/routes/scheduler");
const datadumpRoutes = require("./src/routes/datadump");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.use("/auth", fyersAuth);
app.use("/api/market", marketRoutes);
app.use("/api/trades", tradeRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/scheduler", schedulerRoutes);
app.use("/api/datadump", datadumpRoutes);

// Serve main app
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`AIRangers running on http://localhost:${PORT}`);
  console.log(`Auto-trader available at /api/scheduler/start`);
  console.log(`Market hours check: /api/scheduler/market-hours`);

  // Auto-start scheduler if configured
  if (process.env.AUTO_START_SCHEDULER === "true") {
    const scheduler = require("./src/engine/autoTradeScheduler");
    scheduler.startScheduler(() => fyersAuth.getFyersClient());
    console.log("⚡ Auto-trader started on boot");
  }

  // Auto-start data dumper
  if (process.env.AUTO_START_DATADUMP !== "false") {
    const dataDumper = require("./src/engine/dataDumper");
    const client = fyersAuth.getFyersClient();
    if (client && !fyersAuth.isSimulated()) {
      dataDumper.startPolling(client);
      console.log("📡 Data dumper started (live polling)");
    } else {
      dataDumper.startSimulated();
      console.log("📡 Data dumper started (simulated)");
    }
  }
});
