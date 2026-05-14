const express = require("express");
const router = express.Router();
const { fyersModel } = require("fyers-api-v3");
const path = require("path");

let fyers = null;
let accessToken = process.env.FYERS_ACCESS_TOKEN || "";
let simulatedMode = !accessToken;
let userProfile = null;

// Initialize Fyers model
function initFyers() {
  if (fyers) return fyers;

  const appId = process.env.FYERS_APP_ID;
  if (!appId || appId === "your_app_id_here") return null;

  fyers = new fyersModel({
    path: path.join(__dirname, "../../logs"),
    enableLogging: true,
  });

  fyers.setAppId(appId);
  fyers.setRedirectUrl(getRedirectUrl());

  if (accessToken && !simulatedMode) {
    fyers.setAccessToken(accessToken);
  }

  return fyers;
}

// Determine redirect URL based on environment
function getRedirectUrl() {
  const envUrl = process.env.FYERS_REDIRECT_URL;
  if (envUrl && envUrl !== "auto") return envUrl;

  const isProduction = process.env.NODE_ENV === "production";
  const productionDomain = process.env.PRODUCTION_DOMAIN || "airangers.in";
  const port = process.env.PORT || 3000;

  if (isProduction) {
    return `https://${productionDomain}/auth/callback`;
  }
  return `http://localhost:${port}/auth/callback`;
}

// Step 1: Generate Fyers login URL
router.get("/login", (req, res) => {
  const client = initFyers();

  if (!client) {
    return res.json({
      error: true,
      message: "Fyers API not configured. Add FYERS_APP_ID and FYERS_SECRET_KEY to your .env file. Get credentials from https://myapi.fyers.in/dashboard",
    });
  }

  const authUrl = client.generateAuthCode();
  const redirectUrl = getRedirectUrl();
  const isLocalCallback = redirectUrl.includes("localhost");

  res.json({ url: authUrl, redirectUrl, isLocalCallback });
});

// Step 2: Fyers redirects here after user logs in (only works if redirect URL points here)
router.get("/callback", async (req, res) => {
  const authCode = req.query.auth_code || req.query.code;
  const error = req.query.error;
  const errorDescription = req.query.error_description;

  if (error) {
    return res.redirect(`/?auth_error=${encodeURIComponent(errorDescription || error)}`);
  }

  if (!authCode) {
    return res.redirect("/?auth_error=no_auth_code_received");
  }

  const result = await exchangeAuthCode(authCode);
  if (result.success) {
    return res.redirect("/?login=success");
  }
  return res.redirect(`/?auth_error=${encodeURIComponent(result.error)}`);
});

// Step 2 (alternative): Manually submit auth_code from the redirected URL
// Use this when your Fyers redirect URL is NOT localhost (e.g. trade.fyers.in default)
router.post("/exchange-code", async (req, res) => {
  const { authCode } = req.body;
  if (!authCode) return res.json({ error: "Auth code is required" });

  const result = await exchangeAuthCode(authCode);
  if (result.success) {
    return res.json({ success: true, message: "Connected to Fyers!", profile: userProfile });
  }
  res.json({ error: result.error });
});

// Shared logic: exchange auth_code for access_token
async function exchangeAuthCode(authCode) {
  try {
    const client = initFyers();
    if (!client) return { success: false, error: "Fyers not configured" };

    const response = await client.generate_access_token({
      client_id: process.env.FYERS_APP_ID,
      secret_key: process.env.FYERS_SECRET_KEY,
      auth_code: authCode,
    });

    if (response.s === "ok" && response.access_token) {
      accessToken = response.access_token;
      simulatedMode = false;
      client.setAccessToken(accessToken);

      try {
        const profile = await client.get_profile();
        if (profile.s === "ok" && profile.data) {
          userProfile = profile.data;
        }
      } catch (e) {
        userProfile = { name: "Fyers User" };
      }

      return { success: true };
    }

    return { success: false, error: response.message || "Token exchange failed" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Check login status
router.get("/status", (req, res) => {
  const hasCredentials = process.env.FYERS_APP_ID && process.env.FYERS_APP_ID !== "your_app_id_here";
  res.json({
    loggedIn: !!accessToken,
    simulated: simulatedMode,
    mode: simulatedMode ? "Simulated" : "Live (Fyers)",
    profile: userProfile,
    hasCredentials,
    redirectUrl: getRedirectUrl(),
  });
});

// Connect in simulated mode
router.post("/simulate", (req, res) => {
  simulatedMode = true;
  accessToken = "simulated_token";
  userProfile = { name: "Paper Trader", email: "simulated@airangers.local" };
  res.json({ success: true, message: "Connected in simulated mode" });
});

// Manually paste access token
router.post("/set-token", (req, res) => {
  const { token } = req.body;
  if (!token) return res.json({ error: "Access token is required" });

  accessToken = token;
  simulatedMode = false;

  const client = initFyers();
  if (client) {
    client.setAccessToken(accessToken);
    client.get_profile().then((profile) => {
      if (profile.s === "ok" && profile.data) {
        userProfile = profile.data;
      }
    }).catch(() => {});
  }

  userProfile = userProfile || { name: "Fyers User" };
  res.json({ success: true, message: "Access token set. Live mode active." });
});

// Logout
router.post("/logout", (req, res) => {
  accessToken = "";
  simulatedMode = true;
  userProfile = null;
  fyers = null;
  res.json({ success: true });
});

module.exports = router;
module.exports.getToken = () => accessToken;
module.exports.isSimulated = () => simulatedMode;
module.exports.autoConnect = () => {
  if (!accessToken) {
    // If real credentials exist and token is set, use live mode
    if (process.env.FYERS_ACCESS_TOKEN) {
      accessToken = process.env.FYERS_ACCESS_TOKEN;
      simulatedMode = false;
      userProfile = { name: "Fyers User (Token)" };
      console.log("🔐 Connected with pre-set access token (live mode)");
    } else {
      // Otherwise activate simulated mode
      accessToken = "simulated_token";
      simulatedMode = true;
      userProfile = { name: "Paper Trader" };
      console.log("📊 Connected in simulated mode");
    }
  }
};
module.exports.getFyersClient = () => {
  if (simulatedMode || !accessToken) return null;
  const client = initFyers();
  if (client) client.setAccessToken(accessToken);
  return client;
};
