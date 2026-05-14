const express = require("express");
const router = express.Router();
const dataDumper = require("../engine/dataDumper");
const auth = require("./auth");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");

// Get dumper status
router.get("/status", (req, res) => {
  res.json(dataDumper.getStatus());
});

// Start data dumper (auto-detects mode: websocket > polling > simulated)
router.post("/start", (req, res) => {
  const client = auth.getFyersClient();
  const appId = process.env.FYERS_APP_ID;
  const token = auth.getToken();

  if (client && token && !auth.isSimulated()) {
    // Try WebSocket first, fallback to polling
    const wsResult = dataDumper.startWebSocket(client, appId, token);
    if (wsResult.error) {
      // Fallback to polling
      const pollResult = dataDumper.startPolling(client);
      return res.json(pollResult);
    }
    return res.json(wsResult);
  }

  // No live connection, use simulated
  res.json(dataDumper.startSimulated());
});

// Stop data dumper
router.post("/stop", (req, res) => {
  res.json(dataDumper.stop());
});

// Get latest data snapshot (in-memory, fast)
router.get("/latest", (req, res) => {
  res.json(dataDumper.getLatestData());
});

// Get latest data from file
router.get("/file/latest", (req, res) => {
  const filepath = path.join(DATA_DIR, "latest.json");
  if (!fs.existsSync(filepath)) {
    return res.json({ error: "No data file yet. Start the data dumper first." });
  }
  const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));
  res.json(data);
});

// List all dump files
router.get("/files", (req, res) => {
  if (!fs.existsSync(DATA_DIR)) {
    return res.json([]);
  }
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      size: fs.statSync(path.join(DATA_DIR, f)).size,
      modified: fs.statSync(path.join(DATA_DIR, f)).mtime,
    }))
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));
  res.json(files);
});

// Download a specific dump file
router.get("/file/:filename", (req, res) => {
  const filepath = path.join(DATA_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "File not found" });
  }
  res.sendFile(filepath);
});

// Set dump frequency
router.post("/frequency", (req, res) => {
  const { ms } = req.body;
  res.json(dataDumper.setDumpFrequency(ms));
});

module.exports = router;
