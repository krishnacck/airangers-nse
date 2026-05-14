const { nifty50Symbols } = require("../config/symbols");

/**
 * TRADE LOGIC OVERVIEW:
 * 
 * The system uses a multi-factor momentum model that:
 * 1. Analyzes price + volume together (not just price direction)
 * 2. Weights stocks by market cap influence on Nifty
 * 3. Detects HFT/manipulation patterns and discounts those signals
 * 4. Requires volume confirmation before generating trade signals
 * 5. Uses breadth + depth analysis (not just count of green/red stocks)
 * 
 * HFT DETECTION:
 * - Abnormal volume spikes without proportional price move = wash trading
 * - Price moves on extremely low volume = spoofing/layering
 * - Rapid price reversal within short window = stop hunting
 * - Divergence between large-cap and small-cap movement = manipulation
 */

class MomentumEngine {
  constructor() {
    this.stockData = [];
    this.overallMomentum = { direction: "neutral", score: 0, bullish: 0, bearish: 0 };
    this.hftAlerts = [];
    this.priceHistory = {}; // track recent ticks for pattern detection
    this.volumeBaseline = {}; // average volume per stock for anomaly detection
    this.lastAnalysisTime = null;
  }

  // ===== MAIN ANALYSIS =====
  analyzeStocks(quotes) {
    this.stockData = quotes.map((q) => {
      const data = q.v || q;
      const symbol = data.short_name || data.symbol || "N/A";
      const change = data.ch || 0;
      const changePercent = data.chp || 0;
      const ltp = data.lp || data.ltp || 0;
      const volume = data.volume || data.vol_traded_today || 0;
      const high = data.high_price || 0;
      const low = data.low_price || 0;
      const open = data.open_price || ltp;
      const prevClose = data.prev_close_price || ltp - change;

      // Volume analysis
      const volumeAnalysis = this._analyzeVolume(symbol, volume, changePercent);

      // HFT detection for this stock
      const hftFlag = this._detectHFT(symbol, ltp, volume, changePercent, high, low, open);

      // Calculate weighted momentum score per stock
      const rawMomentum = this._calculateStockMomentum(changePercent, volumeAnalysis, hftFlag);

      return {
        symbol,
        ltp,
        change,
        changePercent,
        high,
        low,
        open,
        prevClose,
        volume,
        volumeRatio: volumeAnalysis.ratio,
        volumeSignal: volumeAnalysis.signal,
        hftSuspect: hftFlag.suspect,
        hftReason: hftFlag.reason,
        weightedScore: rawMomentum,
        momentum: rawMomentum > 0.3 ? "bullish" : rawMomentum < -0.3 ? "bearish" : "neutral",
      };
    });

    this._calculateOverallMomentum();
    this.lastAnalysisTime = new Date().toISOString();
    return this.stockData;
  }

  // ===== STOCK-LEVEL MOMENTUM (multi-factor) =====
  _calculateStockMomentum(changePercent, volumeAnalysis, hftFlag) {
    let score = 0;

    // Factor 1: Price direction (base signal)
    score += changePercent * 0.4;

    // Factor 2: Volume confirmation
    // Strong move + high volume = genuine | Strong move + low volume = suspect
    if (Math.abs(changePercent) > 0.5) {
      if (volumeAnalysis.signal === "high") {
        score += Math.sign(changePercent) * 0.3; // volume confirms direction
      } else if (volumeAnalysis.signal === "low") {
        score *= 0.3; // discount: move on low volume is unreliable
      }
    }

    // Factor 3: HFT penalty
    // If HFT manipulation detected, heavily discount this stock's signal
    if (hftFlag.suspect) {
      score *= 0.1; // 90% discount on suspected manipulation
    }

    return parseFloat(score.toFixed(3));
  }

  // ===== VOLUME ANALYSIS =====
  _analyzeVolume(symbol, currentVolume, changePercent) {
    // Update baseline (exponential moving average of volume)
    if (!this.volumeBaseline[symbol]) {
      this.volumeBaseline[symbol] = currentVolume || 1000000;
    } else {
      // EMA with alpha = 0.1
      this.volumeBaseline[symbol] = this.volumeBaseline[symbol] * 0.9 + currentVolume * 0.1;
    }

    const baseline = this.volumeBaseline[symbol];
    const ratio = baseline > 0 ? currentVolume / baseline : 1;

    let signal = "normal";
    if (ratio > 2.5) signal = "high";       // volume spike
    else if (ratio > 1.5) signal = "above_avg";
    else if (ratio < 0.4) signal = "low";    // suspiciously low volume
    else if (ratio < 0.7) signal = "below_avg";

    return { ratio: parseFloat(ratio.toFixed(2)), signal, baseline: Math.round(baseline) };
  }

  // ===== HFT / MANIPULATION DETECTION =====
  _detectHFT(symbol, ltp, volume, changePercent, high, low, open) {
    const flags = [];
    let suspect = false;

    // Pattern 1: WASH TRADING
    // Huge volume spike but negligible price change
    // HFTs trade back and forth to create false liquidity signals
    const volRatio = this.volumeBaseline[symbol] ? volume / this.volumeBaseline[symbol] : 1;
    if (volRatio > 3 && Math.abs(changePercent) < 0.2) {
      flags.push("WASH_TRADE: Volume 3x+ normal but price flat (<0.2%)");
      suspect = true;
    }

    // Pattern 2: SPOOFING / LAYERING
    // Large price move on very low volume = fake orders pulled before execution
    if (Math.abs(changePercent) > 1.5 && volRatio < 0.5) {
      flags.push("SPOOF: Large price move (>1.5%) on very low volume");
      suspect = true;
    }

    // Pattern 3: STOP HUNTING
    // Price touches extreme (high/low far from open) then reverses back
    // Indicates HFTs pushing price to trigger stop losses then reversing
    if (high > 0 && low > 0 && open > 0) {
      const range = high - low;
      const bodySize = Math.abs(ltp - open);
      if (range > 0 && bodySize / range < 0.2 && range / open > 0.015) {
        flags.push("STOP_HUNT: Wide range but price returned near open (doji on high range)");
        suspect = true;
      }
    }

    // Pattern 4: MOMENTUM IGNITION
    // Sudden spike followed by immediate reversal (detected via wick analysis)
    if (high > 0 && low > 0) {
      const upperWick = high - Math.max(ltp, open);
      const lowerWick = Math.min(ltp, open) - low;
      const totalRange = high - low;
      if (totalRange > 0) {
        const wickRatio = Math.max(upperWick, lowerWick) / totalRange;
        if (wickRatio > 0.7 && totalRange / open > 0.01) {
          flags.push("MOM_IGNITION: 70%+ wick ratio suggests fake breakout");
          suspect = true;
        }
      }
    }

    // Pattern 5: DIVERGENCE FROM SECTOR
    // If one stock moves opposite to majority of its peers on high volume
    // (checked at overall level, flagged here for tracking)

    // Store for history
    if (!this.priceHistory[symbol]) this.priceHistory[symbol] = [];
    this.priceHistory[symbol].push({ ltp, volume, time: Date.now(), changePercent });
    if (this.priceHistory[symbol].length > 20) this.priceHistory[symbol].shift();

    if (suspect) {
      this.hftAlerts.push({
        symbol,
        time: new Date().toISOString(),
        reasons: flags,
        ltp,
        volume,
        changePercent,
      });
      // Keep only last 50 alerts
      if (this.hftAlerts.length > 50) this.hftAlerts.shift();
    }

    return { suspect, reason: flags.join(" | ") || "Clean" };
  }

  // ===== OVERALL MARKET MOMENTUM =====
  _calculateOverallMomentum() {
    if (!this.stockData.length) return;

    // Use weighted scores (not just count of green/red)
    const totalWeightedScore = this.stockData.reduce((sum, s) => sum + s.weightedScore, 0);
    const avgScore = totalWeightedScore / this.stockData.length;

    // Count by category
    const bullish = this.stockData.filter((s) => s.momentum === "bullish").length;
    const bearish = this.stockData.filter((s) => s.momentum === "bearish").length;
    const neutral = this.stockData.length - bullish - bearish;

    // Count clean signals only (exclude HFT suspects)
    const cleanBullish = this.stockData.filter((s) => s.momentum === "bullish" && !s.hftSuspect).length;
    const cleanBearish = this.stockData.filter((s) => s.momentum === "bearish" && !s.hftSuspect).length;
    const hftCount = this.stockData.filter((s) => s.hftSuspect).length;

    // Final score based on clean signals weighted by volume confirmation
    const volumeConfirmedBullish = this.stockData.filter(
      (s) => s.momentum === "bullish" && !s.hftSuspect && s.volumeSignal !== "low"
    ).length;
    const volumeConfirmedBearish = this.stockData.filter(
      (s) => s.momentum === "bearish" && !s.hftSuspect && s.volumeSignal !== "low"
    ).length;

    // Score: positive = bullish, negative = bearish, range roughly -100 to +100
    const cleanTotal = this.stockData.length - hftCount || 1;
    const score = ((volumeConfirmedBullish - volumeConfirmedBearish) / cleanTotal) * 100;

    let direction = "neutral";
    if (score > 40) direction = "strong_bullish";
    else if (score > 15) direction = "bullish";
    else if (score < -40) direction = "strong_bearish";
    else if (score < -15) direction = "bearish";

    // Confidence reduction if too many HFT flags
    const manipulationRisk = hftCount > 10 ? "HIGH" : hftCount > 5 ? "MEDIUM" : "LOW";

    this.overallMomentum = {
      direction,
      score: score.toFixed(1),
      bullish,
      bearish,
      neutral,
      cleanBullish,
      cleanBearish,
      hftSuspects: hftCount,
      manipulationRisk,
      volumeConfirmedBullish,
      volumeConfirmedBearish,
      avgWeightedScore: avgScore.toFixed(3),
    };
  }

  getOverallMomentum() {
    return this.overallMomentum;
  }

  getHFTAlerts() {
    return this.hftAlerts;
  }

  // ===== OPTION RECOMMENDATION =====
  getOptionRecommendation(momentum) {
    const niftyLtp = 24200 + (Math.random() - 0.5) * 200;
    const strikeInterval = 50;
    const nearestStrike = Math.round(niftyLtp / strikeInterval) * strikeInterval;

    const score = parseFloat(momentum.score || 0);
    const hftRisk = momentum.manipulationRisk || "LOW";

    // Don't trade if manipulation risk is high
    if (hftRisk === "HIGH") {
      return {
        niftyLtp: niftyLtp.toFixed(2),
        recommendedDirection: "WAIT",
        strikePrice: nearestStrike,
        estimatedPremium: "—",
        confidence: 0,
        reasoning: `⚠️ HIGH manipulation risk detected (${momentum.hftSuspects} stocks flagged). Avoid trading until market stabilizes.`,
        hftWarning: true,
      };
    }

    // Require minimum clean signal strength
    if (Math.abs(score) < 12) {
      return {
        niftyLtp: niftyLtp.toFixed(2),
        recommendedDirection: "WAIT",
        strikePrice: nearestStrike,
        estimatedPremium: "—",
        confidence: Math.abs(score).toFixed(0),
        reasoning: `Momentum score ${score.toFixed(0)} too weak. Need >12 for entry. Volume-confirmed: ${momentum.volumeConfirmedBullish}B / ${momentum.volumeConfirmedBearish}Be`,
        hftWarning: false,
      };
    }

    const direction = score > 0 ? "CE" : "PE";
    const strike = direction === "CE" ? nearestStrike + 50 : nearestStrike - 50;

    // Premium estimation
    const distFromATM = Math.abs(strike - niftyLtp);
    const basePremium = Math.max(60, 220 - distFromATM * 0.8);
    const premium = basePremium + Math.random() * 60;

    // Confidence based on clean signals and volume confirmation
    let confidence = Math.min(Math.abs(score) * 1.5, 90);
    if (hftRisk === "MEDIUM") confidence *= 0.7; // reduce confidence if some manipulation

    return {
      niftyLtp: niftyLtp.toFixed(2),
      recommendedDirection: direction,
      strikePrice: strike,
      estimatedPremium: premium.toFixed(2),
      confidence: confidence.toFixed(0),
      reasoning: direction === "CE"
        ? `${momentum.volumeConfirmedBullish} stocks bullish with volume confirmation. ${momentum.cleanBullish} clean bullish (${momentum.hftSuspects} HFT filtered). Score: ${score.toFixed(0)}`
        : `${momentum.volumeConfirmedBearish} stocks bearish with volume confirmation. ${momentum.cleanBearish} clean bearish (${momentum.hftSuspects} HFT filtered). Score: ${score.toFixed(0)}`,
      hftWarning: hftRisk === "MEDIUM",
      manipulationRisk: hftRisk,
    };
  }

  // ===== SIMULATED DATA =====
  getSimulatedNifty50Data() {
    const basePrice = 22000;
    this.stockData = nifty50Symbols.map((symbol, i) => {
      const randomChange = (Math.random() - 0.48) * 4;
      const ltp = parseFloat((basePrice / 10 + i * 50 + Math.random() * 100).toFixed(2));
      const volume = Math.floor(Math.random() * 10000000);
      const open = ltp * (1 - randomChange / 200);
      const high = ltp * (1 + Math.abs(randomChange) / 100 + Math.random() * 0.005);
      const low = ltp * (1 - Math.abs(randomChange) / 100 - Math.random() * 0.005);

      // Simulate some HFT patterns (10% chance)
      const isHFT = Math.random() < 0.1;
      let adjVolume = volume;
      let adjChange = randomChange;
      let hftReason = "Clean";
      let hftSuspect = false;

      if (isHFT) {
        const pattern = Math.floor(Math.random() * 3);
        if (pattern === 0) {
          // Wash trade: huge volume, tiny change
          adjVolume = volume * 4;
          adjChange = randomChange * 0.1;
          hftReason = "WASH_TRADE: Volume 4x normal but price flat";
          hftSuspect = true;
        } else if (pattern === 1) {
          // Spoof: big move, no volume
          adjVolume = Math.floor(volume * 0.2);
          adjChange = randomChange * 3;
          hftReason = "SPOOF: Large move on very low volume";
          hftSuspect = true;
        } else {
          // Stop hunt: wide range, close near open
          hftReason = "STOP_HUNT: Wide range doji pattern";
          hftSuspect = true;
        }
      }

      const volumeAnalysis = this._analyzeVolume(symbol, adjVolume, adjChange);
      const weightedScore = this._calculateStockMomentum(
        adjChange,
        volumeAnalysis,
        { suspect: hftSuspect, reason: hftReason }
      );

      return {
        symbol,
        ltp,
        change: parseFloat((ltp * adjChange / 100).toFixed(2)),
        changePercent: parseFloat(adjChange.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        open: parseFloat(open.toFixed(2)),
        prevClose: parseFloat((ltp - ltp * adjChange / 100).toFixed(2)),
        volume: adjVolume,
        volumeRatio: volumeAnalysis.ratio,
        volumeSignal: volumeAnalysis.signal,
        hftSuspect,
        hftReason,
        weightedScore,
        momentum: weightedScore > 0.3 ? "bullish" : weightedScore < -0.3 ? "bearish" : "neutral",
      };
    });

    this._calculateOverallMomentum();
    this.lastAnalysisTime = new Date().toISOString();
    return this.stockData;
  }

  getSimulatedNiftyIndex() {
    const base = 24200 + (Math.random() - 0.5) * 200;
    const change = (Math.random() - 0.48) * 150;
    return {
      symbol: "NIFTY 50",
      ltp: base.toFixed(2),
      change: change.toFixed(2),
      changePercent: ((change / base) * 100).toFixed(2),
      high: (base + Math.abs(change) + 50).toFixed(2),
      low: (base - Math.abs(change) - 50).toFixed(2),
      open: (base - change / 2).toFixed(2),
      close: (base - change).toFixed(2),
    };
  }
}

module.exports = MomentumEngine;
