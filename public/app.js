// AIRangers - Frontend Application
const API = "";

// State
let currentPage = "dashboard";
let refreshInterval = null;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupAuth();
  setupTradeForm();
  setupFilters();
  setupResetButton();
  setupClearTradesButton();
  loadDashboard();
  startAutoRefresh();
});

// ===== NAVIGATION =====
function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      switchPage(item.dataset.page);
    });
  });
  document.getElementById("refresh-btn").addEventListener("click", refreshCurrentPage);
}

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  document.querySelector(`[data-page="${page}"]`).classList.add("active");
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.getElementById(`page-${page}`).classList.add("active");

  const titles = {
    dashboard: "Dashboard",
    market: "Market Data",
    trades: "Trades",
    positions: "Positions",
    wallet: "Wallet & Funds",
    analytics: "Analytics",
    scheduler: "Auto-Trader",
    livedata: "Live Data & Options",
  };
  document.getElementById("page-title").textContent = titles[page] || "Dashboard";
  refreshCurrentPage();
}

function refreshCurrentPage() {
  switch (currentPage) {
    case "dashboard": loadDashboard(); break;
    case "market": loadMarketData(); break;
    case "trades": loadTradeHistory(); break;
    case "positions": loadPositions(); break;
    case "wallet": loadWallet(); break;
    case "analytics": loadAnalytics(); break;
    case "scheduler": loadScheduler(); break;
    case "livedata": loadLiveData(); break;
  }
}

// ===== AUTO REFRESH =====
function startAutoRefresh() {
  refreshInterval = setInterval(() => {
    loadNiftyIndex();
    if (currentPage === "dashboard") loadDashboard();
  }, 10000);
}

// ===== AUTH =====
function setupAuth() {
  document.getElementById("login-btn").addEventListener("click", showLoginModal);
  checkAuthStatus();

  // Handle auth callback params in URL
  const params = new URLSearchParams(window.location.search);
  if (params.get("login") === "success") {
    showNotification("Successfully connected to Fyers!", "success");
    window.history.replaceState({}, "", "/");
    checkAuthStatus();
  }
  if (params.get("auth_error")) {
    showNotification(`Login failed: ${decodeURIComponent(params.get("auth_error"))}`, "error");
    window.history.replaceState({}, "", "/");
  }
}

function showLoginModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:500px;text-align:left;">
      <h3 style="text-align:center;margin-bottom:16px;">Connect to Fyers</h3>
      <p style="text-align:center;margin-bottom:20px;color:var(--text-secondary);">Choose how you want to connect:</p>

      <div style="display:flex;flex-direction:column;gap:12px;">
        <button class="btn btn-primary" id="modal-fyers-login" style="width:100%;padding:14px;">
          🔐 Login with Fyers Account
        </button>

        <div style="text-align:center;color:var(--text-secondary);font-size:12px;">— or paste auth code from redirect URL —</div>
        <div style="display:flex;gap:8px;">
          <input type="text" id="modal-authcode-input" placeholder="Paste auth_code from URL after login"
            style="flex:1;padding:10px 12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px;" />
          <button class="btn btn-primary btn-sm" id="modal-submit-code">Submit</button>
        </div>

        <div style="text-align:center;color:var(--text-secondary);font-size:12px;">— or paste access token directly —</div>
        <div style="display:flex;gap:8px;">
          <input type="text" id="modal-token-input" placeholder="Paste access token here"
            style="flex:1;padding:10px 12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:13px;" />
          <button class="btn btn-outline btn-sm" id="modal-set-token">Set Token</button>
        </div>

        <div style="text-align:center;color:var(--text-secondary);font-size:12px;">— or —</div>
        <button class="btn btn-success" id="modal-simulate" style="width:100%;padding:14px;">
          📊 Use Simulated Mode (No Account Needed)
        </button>
      </div>

      <p id="modal-redirect-info" style="margin-top:16px;font-size:11px;color:var(--text-secondary);text-align:center;"></p>
      <p style="margin-top:4px;font-size:11px;color:var(--text-secondary);text-align:center;">
        Get API credentials at <a href="https://myapi.fyers.in/dashboard" target="_blank" style="color:var(--accent);">myapi.fyers.in/dashboard</a>
      </p>

      <div style="text-align:center;margin-top:12px;">
        <button class="btn btn-outline btn-sm" id="modal-close-auth">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Fyers OAuth login
  overlay.querySelector("#modal-fyers-login").onclick = async () => {
    const res = await fetch(`${API}/auth/login`);
    const data = await res.json();
    if (data.error) {
      showNotification(data.message, "error");
    } else if (data.url) {
      // Show info about where the redirect goes
      if (!data.isLocalCallback) {
        showNotification("After login, copy the auth_code from the redirected URL and paste it here.", "info");
        overlay.querySelector("#modal-redirect-info").textContent =
          `Redirect URL: ${data.redirectUrl} — After login, copy auth_code param from the URL.`;
      }
      window.open(data.url, "_blank");
    }
    if (data.isLocalCallback) overlay.remove();
  };

  // Submit auth code manually
  overlay.querySelector("#modal-submit-code").onclick = async () => {
    let code = overlay.querySelector("#modal-authcode-input").value.trim();
    if (!code) { showNotification("Paste the auth_code from the redirect URL", "error"); return; }

    // Extract auth_code from full URL if user pasted the whole URL
    if (code.includes("auth_code=")) {
      const url = new URL(code);
      code = url.searchParams.get("auth_code") || code;
    } else if (code.includes("code=")) {
      try {
        const url = new URL(code);
        code = url.searchParams.get("code") || code;
      } catch (e) {}
    }

    const res = await fetch(`${API}/auth/exchange-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authCode: code }),
    });
    const data = await res.json();
    if (data.success) {
      showNotification(data.message, "success");
      checkAuthStatus();
    } else {
      showNotification(data.error || "Failed to exchange code", "error");
    }
    overlay.remove();
  };

  // Manual token
  overlay.querySelector("#modal-set-token").onclick = async () => {
    const token = overlay.querySelector("#modal-token-input").value.trim();
    if (!token) { showNotification("Enter a valid token", "error"); return; }
    const res = await fetch(`${API}/auth/set-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (data.success) {
      showNotification(data.message, "success");
      checkAuthStatus();
    } else {
      showNotification(data.error || "Failed to set token", "error");
    }
    overlay.remove();
  };

  // Simulated mode
  overlay.querySelector("#modal-simulate").onclick = async () => {
    await fetch(`${API}/auth/simulate`, { method: "POST" });
    showNotification("Connected in simulated mode", "success");
    checkAuthStatus();
    overlay.remove();
  };

  // Close
  overlay.querySelector("#modal-close-auth").onclick = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

async function checkAuthStatus() {
  try {
    const res = await fetch(`${API}/auth/status`);
    const data = await res.json();
    const badge = document.getElementById("auth-status");
    const btn = document.getElementById("login-btn");

    if (data.loggedIn) {
      const label = data.simulated ? "Simulated" : (data.profile?.name || "Live");
      badge.textContent = `● ${label}`;
      badge.className = `auth-badge ${data.simulated ? "offline" : "online"}`;
      btn.textContent = "Disconnect";
      btn.onclick = async () => {
        await fetch(`${API}/auth/logout`, { method: "POST" });
        checkAuthStatus();
        showNotification("Disconnected", "info");
      };
    } else {
      badge.textContent = "● Not Connected";
      badge.className = "auth-badge offline";
      btn.textContent = "Connect";
      btn.onclick = showLoginModal;
    }
  } catch (e) {
    console.error("Auth check failed:", e);
  }
}

// ===== RESET & CLEAR =====
function setupResetButton() {
  document.getElementById("reset-all-btn").addEventListener("click", () => {
    showConfirmModal(
      "Reset Everything?",
      "This will clear all trades, positions, and reset your balance to ₹1,00,000. This cannot be undone.",
      resetAccount
    );
  });
}

function setupClearTradesButton() {
  document.getElementById("clear-trades-btn").addEventListener("click", () => {
    showConfirmModal(
      "Clear All Trades?",
      "This will remove all trades and reset your account to the original state.",
      resetAccount
    );
  });
}

async function resetAccount() {
  try {
    const res = await fetch(`${API}/api/trades/reset-account`, { method: "POST" });
    const data = await res.json();
    showNotification(data.message || "Account reset successfully", "success");
    refreshCurrentPage();
    loadWalletBar();
  } catch (e) {
    showNotification("Reset failed", "error");
  }
}

async function clearAllTrades() {
  showConfirmModal(
    "Clear All Trades?",
    "This will remove all trades and reset your account.",
    resetAccount
  );
}

async function closeAllPositions() {
  try {
    const res = await fetch(`${API}/api/trades/positions`);
    const positions = await res.json();

    if (!positions.length) {
      showNotification("No open positions to close", "info");
      return;
    }

    let totalPnl = 0;
    for (const pos of positions) {
      const closeRes = await fetch(`${API}/api/trades/close/${pos.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await closeRes.json();
      totalPnl += result.pnl || 0;
    }

    showNotification(
      `Closed ${positions.length} positions. Net P&L: ₹${totalPnl.toFixed(2)}`,
      totalPnl >= 0 ? "success" : "error"
    );
    refreshCurrentPage();
    loadWalletBar();
  } catch (e) {
    showNotification("Failed to close positions", "error");
  }
}

// ===== DASHBOARD =====
async function loadDashboard() {
  await Promise.all([loadNiftyIndex(), loadMomentum(), loadSignal(), loadPnL(), loadRecentTrades(), loadWalletBar()]);
}

async function loadWalletBar() {
  try {
    const res = await fetch(`${API}/api/trades/wallet`);
    const data = await res.json();
    document.getElementById("dash-balance").textContent = `₹${parseFloat(data.balance).toLocaleString()}`;
    document.getElementById("dash-available").textContent = `₹${parseFloat(data.availableBalance).toLocaleString()}`;
    document.getElementById("dash-margin").textContent = `₹${parseFloat(data.blockedMargin).toLocaleString()}`;

    const nw = document.getElementById("dash-networth");
    nw.textContent = `₹${parseFloat(data.netWorth).toLocaleString()}`;
    nw.style.color = parseFloat(data.netWorth) >= parseFloat(data.initialCapital) ? "var(--green)" : "var(--red)";
  } catch (e) {
    console.error("Wallet bar error:", e);
  }
}

async function loadNiftyIndex() {
  try {
    const res = await fetch(`${API}/api/market/nifty-index`);
    const data = await res.json();
    document.getElementById("nifty-ltp").textContent = `₹${parseFloat(data.ltp).toLocaleString()}`;
    const changeEl = document.getElementById("nifty-change");
    const change = parseFloat(data.change);
    changeEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)} (${data.changePercent}%)`;
    changeEl.className = `ticker-change ${change >= 0 ? "positive" : "negative"}`;
  } catch (e) {}
}

async function loadMomentum() {
  try {
    await fetch(`${API}/api/market/nifty50`);
    const res = await fetch(`${API}/api/market/momentum`);
    const data = await res.json();

    const score = parseFloat(data.score || 0);
    document.getElementById("momentum-score").textContent = score.toFixed(0);

    const dirEl = document.getElementById("momentum-direction");
    dirEl.textContent = data.direction || "neutral";
    dirEl.style.color = score > 0 ? "var(--green)" : score < 0 ? "var(--red)" : "var(--yellow)";

    const total = (data.bullish || 0) + (data.bearish || 0) + (data.neutral || 0) || 50;
    document.getElementById("bar-bearish").style.width = `${((data.bearish || 0) / total) * 100}%`;
    document.getElementById("bar-neutral").style.width = `${((data.neutral || 0) / total) * 100}%`;
    document.getElementById("bar-bullish").style.width = `${((data.bullish || 0) / total) * 100}%`;

    document.getElementById("bearish-count").textContent = `${data.bearish || 0} Bearish`;
    document.getElementById("neutral-count").textContent = `${data.neutral || 0} Neutral`;
    document.getElementById("bullish-count").textContent = `${data.bullish || 0} Bullish`;
  } catch (e) {}
}

async function loadSignal() {
  try {
    const res = await fetch(`${API}/api/market/options`);
    const data = await res.json();

    const typeEl = document.getElementById("signal-type");
    typeEl.textContent = data.recommendedDirection || "--";
    typeEl.style.color = data.recommendedDirection === "CE" ? "var(--green)" : "var(--red)";

    document.getElementById("signal-strike").textContent = `Strike: ${data.strikePrice || "--"}`;
    document.getElementById("signal-premium").textContent = `Premium: ₹${data.estimatedPremium || "--"}`;
    document.getElementById("signal-confidence").textContent = `Confidence: ${data.confidence || "--"}%`;

    document.getElementById("auto-trade-btn").onclick = () => executeAutoTrade();
  } catch (e) {}
}

async function loadPnL() {
  try {
    const res = await fetch(`${API}/api/trades/pnl`);
    const data = await res.json();

    const totalPnl = parseFloat(data.totalPnl || 0);
    const totalEl = document.getElementById("total-pnl");
    totalEl.textContent = `₹${totalPnl.toFixed(2)}`;
    totalEl.style.color = totalPnl >= 0 ? "var(--green)" : "var(--red)";

    document.getElementById("realized-pnl").textContent = `₹${data.realizedPnl || "0.00"}`;
    document.getElementById("unrealized-pnl").textContent = `₹${data.unrealizedPnl || "0.00"}`;
    document.getElementById("open-trades-count").textContent = data.openTrades || 0;
  } catch (e) {}
}

async function loadRecentTrades() {
  try {
    const res = await fetch(`${API}/api/trades`);
    const trades = await res.json();
    const tbody = document.getElementById("recent-trades-body");

    if (!trades.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-secondary)">No trades yet. Use Auto Trade or place manually.</td></tr>`;
      return;
    }

    tbody.innerHTML = trades
      .slice(-10)
      .reverse()
      .map((t) => `
        <tr>
          <td><strong>${t.symbol}</strong></td>
          <td><span class="badge ${t.type === "CE" ? "badge-bullish" : "badge-bearish"}">${t.direction} ${t.type}</span></td>
          <td>${t.strikePrice}</td>
          <td>₹${parseFloat(t.entryPremium).toFixed(2)}</td>
          <td>${t.quantity}</td>
          <td class="${(t.pnl || 0) >= 0 ? "green" : "red"}">₹${(t.pnl || 0).toFixed(2)}</td>
          <td><span class="badge ${t.status === "open" ? "badge-open" : "badge-closed"}">${t.status}</span></td>
          <td>${t.status === "open" ? `<button class="btn btn-danger btn-sm" onclick="closeTrade('${t.id}')">Close</button>` : "—"}</td>
        </tr>
      `)
      .join("");
  } catch (e) {}
}

// ===== AUTO TRADE =====
async function executeAutoTrade() {
  try {
    const momRes = await fetch(`${API}/api/market/momentum`);
    const momentum = await momRes.json();
    const idxRes = await fetch(`${API}/api/market/nifty-index`);
    const idx = await idxRes.json();

    const res = await fetch(`${API}/api/trades/auto-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ momentum, niftyLtp: idx.ltp }),
    });

    const result = await res.json();
    showNotification(result.message, result.trade ? "success" : "info");
    loadDashboard();
  } catch (e) {
    showNotification("Auto trade failed", "error");
  }
}

// ===== CLOSE TRADE =====
async function closeTrade(id) {
  try {
    const res = await fetch(`${API}/api/trades/close/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const result = await res.json();
    showNotification(`Trade closed. P&L: ₹${(result.pnl || 0).toFixed(2)}`, result.pnl >= 0 ? "success" : "error");
    refreshCurrentPage();
    loadWalletBar();
  } catch (e) {
    showNotification("Failed to close trade", "error");
  }
}

// ===== MARKET DATA =====
async function loadMarketData(filter = "all") {
  try {
    const res = await fetch(`${API}/api/market/nifty50`);
    const stocks = await res.json();
    const tbody = document.getElementById("market-body");
    const filtered = filter === "all" ? stocks : stocks.filter((s) => s.momentum === filter);

    tbody.innerHTML = filtered
      .map((s) => `
        <tr>
          <td><strong>${s.symbol}</strong></td>
          <td>₹${parseFloat(s.ltp).toLocaleString()}</td>
          <td class="${parseFloat(s.change) >= 0 ? "green" : "red"}">${parseFloat(s.change) >= 0 ? "+" : ""}${parseFloat(s.change).toFixed(2)}</td>
          <td class="${parseFloat(s.changePercent) >= 0 ? "green" : "red"}">${parseFloat(s.changePercent) >= 0 ? "+" : ""}${parseFloat(s.changePercent).toFixed(2)}%</td>
          <td>₹${parseFloat(s.high).toLocaleString()}</td>
          <td>₹${parseFloat(s.low).toLocaleString()}</td>
          <td><span class="badge badge-${s.momentum}">${s.momentum}</span></td>
        </tr>
      `)
      .join("");
  } catch (e) {}
}

function setupFilters() {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadMarketData(btn.dataset.filter);
    });
  });
}

// ===== TRADE FORM =====
function setupTradeForm() {
  document.getElementById("trade-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const direction = document.getElementById("trade-direction").value;
    const type = document.getElementById("trade-type").value;
    const strike = document.getElementById("trade-strike").value;
    const premium = document.getElementById("trade-premium").value;
    const qty = document.getElementById("trade-qty").value;

    if (!strike || !premium) {
      showNotification("Please fill strike price and premium", "error");
      return;
    }

    try {
      const res = await fetch(`${API}/api/trades/place`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          strikePrice: parseInt(strike),
          premium: parseFloat(premium),
          quantity: parseInt(qty),
          direction,
        }),
      });

      const trade = await res.json();
      if (trade.error) {
        showNotification(trade.error, "error");
        return;
      }
      showNotification(`${direction} order placed: ${trade.symbol} @ ₹${trade.entryPremium}`, "success");
      document.getElementById("trade-form").reset();
      document.getElementById("trade-qty").value = "50";
      loadTradeHistory();
      loadWalletBar();
    } catch (e) {
      showNotification("Order failed", "error");
    }
  });
}

// ===== TRADE HISTORY =====
async function loadTradeHistory() {
  try {
    const res = await fetch(`${API}/api/trades/history`);
    const trades = await res.json();
    const tbody = document.getElementById("history-body");

    if (!trades.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-secondary)">No closed trades yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = trades
      .reverse()
      .map((t) => `
        <tr>
          <td><strong>${t.symbol}</strong></td>
          <td><span class="badge ${t.direction === "BUY" ? "badge-bullish" : "badge-bearish"}">${t.direction}</span></td>
          <td>₹${parseFloat(t.entryPremium).toFixed(2)}</td>
          <td>₹${parseFloat(t.exitPremium || 0).toFixed(2)}</td>
          <td>${t.quantity}</td>
          <td class="${(t.pnl || 0) >= 0 ? "green" : "red"}">₹${(t.pnl || 0).toFixed(2)}</td>
          <td>${t.exitTime ? new Date(t.exitTime).toLocaleString() : "—"}</td>
        </tr>
      `)
      .join("");
  } catch (e) {}
}

// ===== POSITIONS =====
async function loadPositions() {
  try {
    const res = await fetch(`${API}/api/trades/positions`);
    const positions = await res.json();
    const tbody = document.getElementById("positions-body");

    if (!positions.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-secondary)">No open positions.</td></tr>`;
      return;
    }

    tbody.innerHTML = positions
      .map((p) => {
        const pnl = p.direction === "BUY"
          ? (p.currentPremium - p.entryPremium) * p.quantity
          : (p.entryPremium - p.currentPremium) * p.quantity;
        return `
          <tr>
            <td><strong>${p.symbol}</strong></td>
            <td><span class="badge ${p.type === "CE" ? "badge-bullish" : "badge-bearish"}">${p.type}</span></td>
            <td>${p.direction}</td>
            <td>${p.strikePrice}</td>
            <td>₹${parseFloat(p.entryPremium).toFixed(2)}</td>
            <td>₹${parseFloat(p.currentPremium).toFixed(2)}</td>
            <td>${p.quantity}</td>
            <td class="${pnl >= 0 ? "green" : "red"}">₹${pnl.toFixed(2)}</td>
            <td><button class="btn btn-danger btn-sm" onclick="closeTrade('${p.id}')">Close</button></td>
          </tr>
        `;
      })
      .join("");
  } catch (e) {}
}

// ===== WALLET =====
async function loadWallet() {
  try {
    const res = await fetch(`${API}/api/trades/wallet`);
    const data = await res.json();

    document.getElementById("wallet-balance").textContent = `₹${parseFloat(data.balance).toLocaleString()}`;
    document.getElementById("wallet-available").textContent = `₹${parseFloat(data.availableBalance).toLocaleString()}`;
    document.getElementById("wallet-margin").textContent = `₹${parseFloat(data.blockedMargin).toLocaleString()}`;

    const retEl = document.getElementById("wallet-returns");
    retEl.textContent = `${data.returns}%`;
    retEl.className = `stat-value ${parseFloat(data.returns) >= 0 ? "green" : "red"}`;

    // Transactions
    const txContainer = document.getElementById("wallet-transactions");
    const deposits = data.deposits || [];
    if (!deposits.length) {
      txContainer.innerHTML = `<p style="color:var(--text-secondary);font-size:13px;">No transactions yet. Add funds to get started.</p>`;
    } else {
      txContainer.innerHTML = deposits
        .reverse()
        .map((d) => `
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
            <span>${d.type === "deposit" ? "➕ Deposit" : "➖ Withdrawal"}</span>
            <span class="${d.type === "deposit" ? "green" : "red"}">₹${d.amount.toLocaleString()}</span>
            <span style="color:var(--text-secondary)">${new Date(d.time).toLocaleString()}</span>
          </div>
        `)
        .join("");
    }
  } catch (e) {}
}

function setFundAmount(amount) {
  document.getElementById("add-fund-amount").value = amount;
}

async function addFunds() {
  const amount = document.getElementById("add-fund-amount").value;
  if (!amount || parseFloat(amount) <= 0) {
    showNotification("Enter a valid amount", "error");
    return;
  }

  try {
    const res = await fetch(`${API}/api/trades/add-funds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: parseFloat(amount) }),
    });
    const data = await res.json();
    if (data.error) {
      showNotification(data.error, "error");
      return;
    }
    showNotification(data.message, "success");
    document.getElementById("add-fund-amount").value = "";
    loadWallet();
    loadWalletBar();
  } catch (e) {
    showNotification("Failed to add funds", "error");
  }
}

// ===== ANALYTICS =====
async function loadAnalytics() {
  try {
    const res = await fetch(`${API}/api/analytics/summary`);
    const data = await res.json();

    document.getElementById("stat-total-trades").textContent = data.totalTrades;
    document.getElementById("stat-win-rate").textContent = `${data.winRate}%`;

    const pnlEl = document.getElementById("stat-total-pnl");
    pnlEl.textContent = `₹${parseFloat(data.totalPnl).toLocaleString()}`;
    pnlEl.className = `stat-value ${parseFloat(data.totalPnl) >= 0 ? "green" : "red"}`;

    document.getElementById("stat-returns").textContent = `${data.returns}%`;
    document.getElementById("stat-avg-win").textContent = `₹${data.avgWin}`;
    document.getElementById("stat-avg-loss").textContent = `₹${data.avgLoss}`;
    document.getElementById("stat-max-win").textContent = `₹${data.maxWin}`;
    document.getElementById("stat-profit-factor").textContent = data.profitFactor;

    const dailyRes = await fetch(`${API}/api/analytics/daily`);
    const daily = await dailyRes.json();
    const container = document.getElementById("daily-pnl-container");

    if (!daily.length) {
      container.innerHTML = `<p style="color:var(--text-secondary)">No daily data yet. Place some trades first.</p>`;
      return;
    }

    container.innerHTML = daily
      .map((d) => {
        const pnl = parseFloat(d.pnl);
        return `<div class="daily-pnl-item" style="background:${pnl >= 0 ? "var(--green-bg)" : "var(--red-bg)"}; color:${pnl >= 0 ? "var(--green)" : "var(--red)"}">
          ${d.date}: ₹${pnl.toFixed(0)}
        </div>`;
      })
      .join("");
  } catch (e) {}
}

// ===== CONFIRM MODAL =====
function showConfirmModal(title, message, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="modal-actions">
        <button class="btn btn-outline" id="modal-cancel">Cancel</button>
        <button class="btn btn-danger" id="modal-confirm">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#modal-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#modal-confirm").onclick = () => {
    overlay.remove();
    onConfirm();
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ===== NOTIFICATION =====
function showNotification(message, type = "info") {
  const notif = document.createElement("div");
  notif.style.cssText = `
    position: fixed; top: 20px; right: 20px; padding: 14px 20px;
    border-radius: 8px; font-size: 14px; font-weight: 500; z-index: 9999;
    max-width: 380px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    background: ${type === "success" ? "var(--green)" : type === "error" ? "var(--red)" : "var(--accent)"};
    color: white;
  `;
  notif.textContent = message;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 3500);
}

// ===== GLOBAL FUNCTIONS =====
window.closeTrade = closeTrade;
window.closeAllPositions = closeAllPositions;
window.clearAllTrades = clearAllTrades;
window.resetAccount = resetAccount;
window.addFunds = addFunds;
window.setFundAmount = setFundAmount;
window.startScheduler = startScheduler;
window.stopScheduler = stopScheduler;
window.updateSchedulerConfig = updateSchedulerConfig;
window.loadSchedulerLogs = loadSchedulerLogs;
window.startDataDump = startDataDump;
window.stopDataDump = stopDataDump;
window.downloadLatestDump = downloadLatestDump;
window.loadLiveData = loadLiveData;

// ===== LIVE DATA / OPTIONS CHAIN =====
async function loadLiveData() {
  try {
    const res = await fetch(`${API}/api/datadump/latest`);
    const data = await res.json();

    // Nifty LTP
    const nifty = data.niftyIndex;
    if (nifty) {
      const ltpEl = document.getElementById("ld-nifty-ltp");
      ltpEl.textContent = `₹${parseFloat(nifty.ltp).toLocaleString()}`;
      ltpEl.style.color = parseFloat(nifty.change) >= 0 ? "var(--green)" : "var(--red)";
    }

    // ATM Strike
    document.getElementById("ld-atm-strike").textContent = data.meta?.atmStrike || "—";

    // Feed status
    const statusRes = await fetch(`${API}/api/datadump/status`);
    const status = await statusRes.json();
    const feedEl = document.getElementById("ld-feed-status");
    feedEl.textContent = status.isRunning ? "Active" : "Stopped";
    feedEl.style.color = status.isRunning ? "var(--green)" : "var(--red)";
    document.getElementById("ld-dump-status").textContent = status.isRunning
      ? `Stocks: ${status.stockCount} | CE: ${status.ceStrikes} | PE: ${status.peStrikes}`
      : "Not running";

    // Last update
    if (data.timestamp) {
      document.getElementById("ld-last-update").textContent = new Date(data.timestamp).toLocaleTimeString();
    }

    // Options chain
    renderOptionsChain(data);

    // Top movers
    renderTopMovers(data.stocks);
  } catch (e) {
    console.error("Live data error:", e);
  }
}

function renderOptionsChain(data) {
  const tbody = document.getElementById("ld-options-body");
  const atm = data.meta?.atmStrike;
  if (!atm) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-secondary)">No options data. Start data dump first.</td></tr>`;
    return;
  }

  const rows = [];
  for (let i = -10; i <= 10; i++) {
    const strike = atm + i * 50;

    // Find CE and PE data for this strike
    const ceKey = Object.keys(data.options?.CE || {}).find((k) => k.includes(String(strike)) && k.includes("CE"));
    const peKey = Object.keys(data.options?.PE || {}).find((k) => k.includes(String(strike)) && k.includes("PE"));

    const ce = ceKey ? data.options.CE[ceKey] : null;
    const pe = peKey ? data.options.PE[peKey] : null;

    const isATM = i === 0;
    const rowStyle = isATM ? "background:rgba(99,102,241,0.1);" : "";

    rows.push(`
      <tr style="${rowStyle}">
        <td style="text-align:right;">${ce ? formatOI(ce.oi) : "—"}</td>
        <td style="text-align:right;">${ce ? formatVol(ce.volume) : "—"}</td>
        <td style="text-align:right;font-weight:600;color:var(--green);">${ce ? `₹${parseFloat(ce.ltp).toFixed(2)}` : "—"}</td>
        <td style="text-align:right;" class="${ce && parseFloat(ce.change) >= 0 ? "green" : "red"}">${ce ? parseFloat(ce.change).toFixed(2) : "—"}</td>
        <td style="text-align:center;font-weight:700;${isATM ? "color:var(--accent);" : ""}">${strike}${isATM ? " ⬅" : ""}</td>
        <td class="${pe && parseFloat(pe.change) >= 0 ? "green" : "red"}">${pe ? parseFloat(pe.change).toFixed(2) : "—"}</td>
        <td style="font-weight:600;color:var(--red);">${pe ? `₹${parseFloat(pe.ltp).toFixed(2)}` : "—"}</td>
        <td>${pe ? formatVol(pe.volume) : "—"}</td>
        <td>${pe ? formatOI(pe.oi) : "—"}</td>
      </tr>
    `);
  }

  tbody.innerHTML = rows.join("");
}

function renderTopMovers(stocks) {
  if (!stocks || !Object.keys(stocks).length) {
    document.getElementById("ld-gainers").innerHTML = `<p style="color:var(--text-secondary);font-size:13px;">No data</p>`;
    document.getElementById("ld-losers").innerHTML = `<p style="color:var(--text-secondary);font-size:13px;">No data</p>`;
    return;
  }

  const sorted = Object.values(stocks).sort((a, b) => parseFloat(b.changePercent) - parseFloat(a.changePercent));
  const gainers = sorted.slice(0, 5);
  const losers = sorted.slice(-5).reverse();

  document.getElementById("ld-gainers").innerHTML = gainers.map((s) => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <span style="font-weight:600;">${s.symbol}</span>
      <span>₹${parseFloat(s.ltp).toLocaleString()}</span>
      <span class="green">+${parseFloat(s.changePercent).toFixed(2)}%</span>
    </div>
  `).join("");

  document.getElementById("ld-losers").innerHTML = losers.map((s) => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <span style="font-weight:600;">${s.symbol}</span>
      <span>₹${parseFloat(s.ltp).toLocaleString()}</span>
      <span class="red">${parseFloat(s.changePercent).toFixed(2)}%</span>
    </div>
  `).join("");
}

function formatOI(val) {
  if (!val) return "—";
  if (val >= 1000000) return (val / 1000000).toFixed(1) + "M";
  if (val >= 1000) return (val / 1000).toFixed(0) + "K";
  return val;
}

function formatVol(val) {
  if (!val) return "—";
  if (val >= 1000000) return (val / 1000000).toFixed(1) + "M";
  if (val >= 1000) return (val / 1000).toFixed(0) + "K";
  return val;
}

async function startDataDump() {
  const res = await fetch(`${API}/api/datadump/start`, { method: "POST" });
  const data = await res.json();
  showNotification(data.message || data.error || "Started", data.success ? "success" : "error");
  setTimeout(loadLiveData, 2000);
}

async function stopDataDump() {
  const res = await fetch(`${API}/api/datadump/stop`, { method: "POST" });
  const data = await res.json();
  showNotification(data.message || "Stopped", "info");
  loadLiveData();
}

function downloadLatestDump() {
  window.open(`${API}/api/datadump/file/latest`, "_blank");
}

// ===== SCHEDULER =====
async function loadScheduler() {
  try {
    const res = await fetch(`${API}/api/scheduler/status`);
    const data = await res.json();

    const statusEl = document.getElementById("sched-status");
    statusEl.textContent = data.enabled ? "Running ⚡" : "Stopped";
    statusEl.style.color = data.enabled ? "var(--green)" : "var(--text-secondary)";

    const marketEl = document.getElementById("sched-market");
    marketEl.textContent = data.marketStatus?.reason || "—";
    marketEl.style.color = data.marketStatus?.open ? "var(--green)" : "var(--red)";

    document.getElementById("sched-trades-today").textContent = data.config?.tradesToday || 0;
    document.getElementById("sched-open-pos").textContent = data.openPositions || 0;
    document.getElementById("sched-interval").value = data.config?.intervalSeconds || 60;
    document.getElementById("sched-max-trades").value = data.config?.maxTradesPerDay || 10;

    loadSchedulerLogs();
  } catch (e) {}
}

async function startScheduler() {
  const res = await fetch(`${API}/api/scheduler/start`, { method: "POST" });
  const data = await res.json();
  showNotification(data.message || "Auto-trader started", "success");
  loadScheduler();
}

async function stopScheduler() {
  const res = await fetch(`${API}/api/scheduler/stop`, { method: "POST" });
  const data = await res.json();
  showNotification(data.message || "Auto-trader stopped", "info");
  loadScheduler();
}

async function updateSchedulerConfig() {
  const interval = document.getElementById("sched-interval").value;
  const maxTrades = document.getElementById("sched-max-trades").value;
  const res = await fetch(`${API}/api/scheduler/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intervalSeconds: interval, maxTradesPerDay: maxTrades }),
  });
  const data = await res.json();
  showNotification("Config updated", "success");
}

async function loadSchedulerLogs() {
  try {
    const res = await fetch(`${API}/api/scheduler/logs?limit=50`);
    const logs = await res.json();
    const container = document.getElementById("sched-logs");

    if (!logs.length) {
      container.innerHTML = `<p style="color:var(--text-secondary)">No activity yet. Start the auto-trader.</p>`;
      return;
    }

    const colors = {
      TRADE: "var(--green)", CLOSED: "var(--accent)", AUTO_CLOSE: "var(--yellow)",
      BLOCKED: "var(--red)", ERROR: "var(--red)", SKIP: "var(--text-secondary)",
      SCAN: "var(--text-secondary)", LIVE_SCAN: "var(--accent)", ANALYSIS: "var(--accent)",
      START: "var(--green)", STOP: "var(--red)", IDLE: "var(--text-secondary)",
      LIMIT: "var(--yellow)", CLOSE_ALL: "var(--yellow)", CONFIG: "var(--accent)",
    };

    container.innerHTML = logs.reverse().map((l) => {
      const color = colors[l.type] || "var(--text-secondary)";
      const time = new Date(l.time).toLocaleTimeString();
      return `<div style="padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="color:var(--text-secondary)">${time}</span>
        <span style="color:${color};font-weight:600;margin:0 8px;">[${l.type}]</span>
        <span>${l.message}</span>
      </div>`;
    }).join("");
  } catch (e) {}
}
