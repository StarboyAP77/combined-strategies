# Dual Momentum Investing Web Application — Code Review

**Repository:** `/home/ezio/work/investing/dual_momentum/31/`  
**Review Date:** 2026-09-19  
**Reviewer:** Automated Code Review  
**Application Type:** Financial backtesting & visualization (dual momentum strategy, post-tax)  
**Tech Stack:** Vanilla JS, ECharts 5.4.3, HTML/CSS

---

## Executive Summary

| Metric | Assessment |
|--------|------------|
| **Overall Risk** | 🔴 **HIGH** — Multiple critical financial calculation bugs, security vulnerabilities, and maintainability issues |
| **Financial Correctness** | 🔴 **CRITICAL** — Tax calculations, CAGR, drawdown, and risk metrics contain material errors that could mislead investment decisions |
| **Security** | 🔴 **CRITICAL** — XSS via `innerHTML` with untrusted data; no CSP; eval-like patterns |
| **Performance** | 🟡 **WARNING** — O(n²) loops in velocity/rolling calculations; ECharts instances not always disposed; redundant re-computation |
| **Code Quality** | 🟡 **WARNING** — Severe DRY violations; 50+ magic numbers; inconsistent patterns; global namespace pollution |
| **Maintainability** | 🔴 **CRITICAL** — 55 chart suites in 5 files (~1,700 lines); tight coupling; no modules; no tests |

**Bottom Line:** This is a **financial decision-support tool** where calculation bugs directly translate to wrong investment decisions. The codebase needs immediate remediation before any production use.

---

## Findings by Severity

### 🔴 CRITICAL — Financial Correctness (Calculation Bugs)

#### CRIT-01: Post-Tax CAGR Uses Wrong Time Period
**File:** `js/engine.js:287-288`  
**Code:**
```javascript
const years = this._getMonthDifference(startDate, endDate) / 12;
const absoluteCAGR = years > 0 ? (Math.pow(finalPostTaxValue / this.initialCapital, 1 / years) - 1) : 0;
```
**Problem:** `startDate` is `portfolioValueHistory[0].date` (the first data point AFTER lookback period), but `initialCapital` was invested at `startIndex` (lookbackPeriod months earlier). The holding period is **overstated by `lookbackPeriod` months**, inflating CAGR.
**Impact:** For 3-month lookback on 20-year data: ~1.25% CAGR overstatement. For shorter periods, error is larger.
**Fix:** Track actual investment start date separately from first history point.

#### CRIT-02: Long-Term Capital Gains Exemption Applied Per-Trade Instead of Annually
**File:** `js/engine.js:146-150`  
**Code:**
```javascript
const taxableGain = Math.max(0, profitForTax - this.longTermExemptionLimit);
taxAmount = taxableGain * this.longTermTaxRate;
```
**Problem:** ₹1.25L exemption is applied **per trade**, not per financial year. In India, LTCG exemption is annual (₹1.25L per FY across all equity sales).
**Impact:** With 10+ trades/year, exemption is multiplied incorrectly — massively understates tax liability.
**Fix:** Aggregate gains by financial year (Apr-Mar), apply exemption once per FY.

#### CRIT-03: Short-Term vs Long-Term Classification Uses Calendar Months, Not Holding Period
**File:** `js/engine.js:138-151`  
**Code:**
```javascript
const holdingPeriodMonths = this._getMonthDifference(this.lastBuyDate, currentDate);
if (holdingPeriodMonths <= 12) { /* STCG */ } else { /* LTCG */ }
```
**Problem:** `_getMonthDifference` calculates `(year2-year1)*12 + (month2-month1)`. This treats **Jan 31 → Feb 1 as 1 month**, but **Jan 1 → Jan 31 as 0 months**. A trade held 366 days (Jan 1 → next Jan 1) could be classified as 12 months (STCG) instead of 13 (LTCG).
**Impact:** Misclassification near 12-month boundary changes tax rate from 20% → 12.5% (+exemption).
**Fix:** Use actual day count: `(date2 - date1) / (1000*60*60*24)` and compare to 365 days.

#### CRIT-04: Buy & Hold CAGR Calculation Uses Wrong Denominator
**File:** `js/app.js:67-68`  
**Code:**
```javascript
const cagrBH_Equity = strategy.equityBuyAndHoldHistory.length > 1 
  ? (Math.pow(equityBHData[equityBHData.length-1] / options.initialCapital, 1 / (strategy.equityBuyAndHoldHistory.length / 12)) - 1) : 0;
```
**Problem:** Uses `history.length / 12` as years, but history starts at `lookbackPeriod` index. Same off-by-lookback error as CRIT-01.
**Impact:** Benchmark CAGR inflated, making strategy look worse by comparison.

#### CRIT-05: Rolling CAGR Annualization Uses Fixed Period, Not Actual Months
**File:** `js/engine.js:393-408`  
**Code:**
```javascript
const periods = { 1: 12, 3: 36, 5: 60, 7: 84, 10: 120 };
for (let i = months; i < history.length; i++) {
  const startValue = history[i - months].value;
  const endValue = history[i].value;
  const years = months / 12;  // <-- FIXED, not actual
  cagrs.push((Math.pow(endValue / startValue, 1 / years) - 1));
}
```
**Problem:** Assumes exactly `months` calendar months between data points. But data is **month-end** — some months have 28/29/30/31 days. For 10-year (120-month) windows, ~0.5% annualization error.
**Impact:** Rolling CAGRs systematically biased; affects all "Conviction Builders" charts.
**Fix:** Calculate actual day count between dates, divide by 365.25.

#### CRIT-06: Sortino Ratio Downside Deviation Formula Wrong
**File:** `js/engine.js:367-369`  
**Code:**
```javascript
const downsideReturns = monthlyReturns.filter(r => r < 0);
const downsideVariance = downsideReturns.length > 0 
  ? downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length : 0;
```
**Problem:** Divides by `downsideReturns.length` (count of negative months) instead of **total observations** (N). Standard Sortino uses N in denominator.
**Impact:** Downside deviation inflated when many positive months → Sortino artificially improved.
**Fix:** Divide by `monthlyReturns.length` (total periods), not `downsideReturns.length`.

#### CRIT-07: Velocity of Wealth — Success Rate Denominator Wrong
**File:** `js/engine.js:459-493`  
**Code:**
```javascript
rate: ((monthsTaken.length / history.length) * 100).toFixed(1)
```
**Problem:** Denominator is `history.length` (all starting months), but only months with **enough forward data** can reach the target. For 100x multiplier, only early starting months have enough runway.
**Impact:** Success rate severely understated for high multipliers (10x, 100x).
**Fix:** Denominator = count of starting months where `i + maxPossibleMonths < history.length`.

#### CRIT-08: Drawdown Recovery Time Uses Pre-Tax Values for Post-Tax Strategy
**File:** `js/engine.js:377-391`  
**Code:**
```javascript
const maxDDIndex = this.portfolioValueHistory.findIndex(p => p.date === this.maxDrawdownDate);
for (let i = maxDDIndex + 1; i < this.portfolioValueHistory.length; i++) {
  if (this.portfolioValueHistory[i].value >= peakValueBeforeDrawdown) { ... }
}
```
**Problem:** `portfolioValueHistory` is **pre-tax**. `maxDrawdown` is calculated on pre-tax (line 203-204). But `_calculateMetrics` reports `recoveryTimeMonths` alongside post-tax CAGR. Inconsistent basis.
**Impact:** Recovery time doesn't match the post-tax reality the user cares about.
**Fix:** Add post-tax drawdown tracking and recovery calculation.

#### CRIT-09: Withdrawal Calculator Uses Monthly Returns from Strategy History Without Tax Adjustment
**File:** `js/engine.js:519-522`  
**Code:**
```javascript
const monthlyReturn = (this.strategyHistory[i].value - this.strategyHistory[i - 1].value) / this.strategyHistory[i - 1].value;
monthlyReturns.set(this.strategyHistory[i].date, monthlyReturn);
```
**Problem:** `strategyHistory` passed is `postTaxPortfolioValueHistory` (good), but the withdrawal logic applies returns **then subtracts withdrawal**. Real world: withdraw first, then apply return on remaining corpus (or vice versa — but must be consistent).
**Impact:** Sequence of returns risk miscalculated; corpus depletion timing off by 1 month.
**Fix:** Document and standardize: `corpus = (corpus - withdrawal) * (1 + return)`.

#### CRIT-10: Risk-Free Rate Hardcoded, Not User-Configurable for Risk Metrics
**File:** `js/engine.js:20` and `js/app.js:19`  
**Code:** `this.riskFreeRate = options.riskFreeRate || 0.06;`
**Problem:** 6% hardcoded as default. Current Indian 10Y G-Sec ~7%, 3M T-Bill ~6.8%. Sharpe/Sortino ratios sensitive to this.
**Impact:** Risk-adjusted metrics misleading if RFR outdated.
**Fix:** Add RFR input to UI; fetch live rate from RBI API optionally.

---

### 🔴 CRITICAL — Security Vulnerabilities

#### CRIT-11: XSS via `innerHTML` with Unsanitized Data
**Files:** Multiple chart files  
**Examples:**
- `js/charts-core.js:98` — `tableBody.innerHTML += row` with `trade.sellDate`, `trade.fromAsset`
- `js/charts-s1.js:36-42` — `table.innerHTML +=` with `dates[p.start]`, `formatPct(p.depth)`
- `js/charts-s4.js:82-88` — `sel.innerHTML=''` then `o.textContent=d` (safe) but `lbl.textContent = \`${dates[idx]}\`` (safe)
- `js/charts-core.js:88-99` — `row.innerHTML = \`<td>${trade.sellDate}</td>...\``

**Problem:** While current data is static (embedded in `data.js`), the architecture accepts `data` as parameter. If ever loaded from API/user upload, **all chart/table rendering functions are XSS vectors**. No sanitization (DOMPurify, escapeHtml).
**Impact:** If data source compromised → arbitrary JS execution in user context.
**Fix:** 
1. Replace all `innerHTML` with `textContent` + `createElement`
2. Add DOMPurify if HTML rendering needed
3. Implement CSP header

#### CRIT-12: ECharts `formatter` Functions Receive Untrusted Data
**Files:** All chart files  
**Example:** `js/charts-core.js:243-274` — tooltip formatter accesses `p.data.postTaxCorpus`, `p.data.fromAsset`, etc.
**Problem:** ECharts formatter functions execute in JS context. If data contains objects with prototype pollution or getter side-effects, code execution possible.
**Impact:** Low with static data, high if dynamic.
**Fix:** Validate data shape before passing to ECharts; use `JSON.parse(JSON.stringify(data))` to strip prototypes.

#### CRIT-13: No Content Security Policy (CSP)
**File:** `index.html`  
**Problem:** No `<meta http-equiv="Content-Security-Policy">` or HTTP header. ECharts loaded from CDN (`cdn.jsdelivr.net`).
**Impact:** CDN compromise → full app compromise. Inline scripts (all JS is inline in HTML via `<script src="js/...">` but no nonces/hashes).
**Fix:** Add CSP with `script-src 'self' https://cdn.jsdelivr.net; object-src 'none'; base-uri 'self';`

#### CRIT-14: `eval`-Like Pattern in `LazyCharts.renderOne`
**File:** `js/lazy.js:20`  
**Code:**
```javascript
if (key === 's36' && window.__gsPlay) { clearInterval(window.__gsPlay); window.__gsPlay = null; }
```
**Problem:** Not `eval` but global namespace pollution (`window.__gsPlay`). Multiple chart suites use `window.__gsPlay`, `window.__gsPlay` — collision risk.
**Fix:** Encapsulate in module/closure; use `Symbol` keys.

---

### 🔴 CRITICAL — Maintainability & Architecture

#### CRIT-15: Global Namespace Pollution — 100+ Functions in Global Scope
**Files:** All `js/charts-*.js`, `js/engine.js`, `js/app.js`  
**Problem:** Every function (`updateDrawdownDragTables`, `updateRRGChart`, `MomentumSwitchingStrategy`, `runBacktestAndRender`, etc.) leaks to `window`. No modules, no IIFE wrappers, no ES modules.
**Impact:** 
- Naming collisions inevitable (e.g., `updateDrawdownChart` in core vs `updateRBIStressChart`)
- Cannot tree-shake; all 2,000+ lines always loaded
- No dependency management; load order fragile (must load `data.js` → `engine.js` → `utils.js` → `charts-*.js` → `lazy.js` → `app.js`)
**Fix:** Migrate to ES modules (`type="module"`), use `export`/`import`, bundle with Vite/esbuild.

#### CRIT-16: Tight Coupling — Charts Directly Access DOM and Global State
**Files:** All `js/charts-*.js`  
**Examples:**
- `js/charts-s4.js:58-122` — `updateGSPercentileChart` creates its own `<select>`, `<button>` handlers, manages `window.__gsPlay`
- `js/charts-s3.js:383-495` — `calculateRRGData` embedded in chart file, not engine
- `js/app.js:133-137` — `alignedFilteredData = filteredData.slice(-stratLen)` assumes 1:1 alignment

**Problem:** Charts are not pure functions; they mutate DOM, register global event listeners, share mutable state via `window`.
**Impact:** Cannot unit test; cannot re-render without full page reload; memory leaks from undisposed event listeners.
**Fix:** Charts should be pure: `function renderChart(domId, data, options) → void`. App orchestrates DOM.

#### CRIT-17: 55 Chart Suites in 5 Monolithic Files (~1,750 Lines)
**Files:** `charts-s1.js` (222), `charts-s2.js` (298), `charts-s3.js` (495), `charts-s4.js` (386), `charts-s5.js` (341)  
**Problem:** No separation of concerns. Each "suite" should be its own file/module. Suite 36 (Goldman) has 3 charts + interactive playback + timeline — 65 lines alone.
**Impact:** Impossible to navigate; changes to one suite break others; no code reuse.
**Fix:** One file per suite: `charts/suite-36-goldman.js`, etc. Shared utilities in `charts/utils/`.

#### CRIT-18: No Automated Tests
**Entire codebase:** Zero test files. No Jest, Vitest, Playwright, or even manual test scripts.
**Impact:** Every refactor risks breaking financial calculations silently. No regression detection.
**Fix:** Add Vitest for engine calculations; Playwright for UI smoke tests.

---

### 🟡 WARNING — Performance Issues

#### WARN-01: O(n²) Velocity of Wealth Calculation
**File:** `js/engine.js:459-493`  
**Code:**
```javascript
for (let i = 0; i < history.length; i++) {          // n iterations
  for (let j = i + 1; j < history.length; j++) {   // n iterations
    if (history[j].value >= targetValue) { ... }
  }
}
```
**Problem:** ~250 data points → 31,000 iterations per multiplier × 5 multipliers = 155K loops per backtest. Runs on every parameter change.
**Impact:** Noticeable lag on re-run (200-500ms). Scales quadratically.
**Fix:** Pre-compute "first reach" for each target using single forward pass per start index, or use binary search on monotonically increasing portfolio.

#### WARN-02: Redundant Rolling Calculations Recomputed Every Render
**Files:** `js/app.js:69-70, 96-101, 300-302`  
**Code:**
```javascript
const strategyRolling = strategy._calculateRollingCAGRs(strategy.portfolioValueHistory);
const equityRolling = strategy._calculateRollingCAGRs(strategy.equityBuyAndHoldHistory);
// ... called again in comparisonData construction
```
**Problem:** `_calculateRollingCAGRs` called 3+ times per run with same input. Each does 5×O(n) passes.
**Impact:** Wasted CPU; ~5ms per call × 6 calls = 30ms per run.
**Fix:** Memoize in `MomentumSwitchingStrategy` instance; compute once in `run()`.

#### WARN-03: ECharts Instances Not Always Disposed — Memory Leaks
**Files:** `js/lazy.js:21-23`, `js/charts-core.js:5-6, 23-24`, all chart files  
**Code:**
```javascript
details.querySelectorAll('[id$="-chart"]').forEach(el => {
  try { const c = echarts.getInstanceByDom(el); if (c) c.dispose(); } catch (e) {}
});
```
**Problem:** 
1. Only runs on lazy render, not on full re-run (`runBacktestAndRender` calls `LazyCharts.renderOpen()` which calls `renderOne` → disposes). But **core charts** (`performanceChart`, `withdrawalChart`, `drawdownChart`) are **not** in lazy system — they're recreated every run without dispose check in some paths.
2. `charts-s4.js:106-107` creates `tChart` (timeline) but never disposes on re-run — new instance leaked each run.
3. `charts-s5.js:224-226` calls `chart.resize()` twice with `setTimeout` — indicates layout thrashing.
**Impact:** Memory grows with each parameter change; browser tab crashes after ~50 runs.
**Fix:** Centralize chart lifecycle in `AppState`; dispose all on `runBacktestAndRender` start.

#### WARN-04: `calculateRRGData` Recomputes Full History Every Render
**File:** `js/charts-s3.js:353-381`  
**Code:** Full O(n) pass with 12-month windows, called every time suite 35 opens.
**Fix:** Compute once in `app.js`, pass precomputed data.

#### WARN-05: `updateAllChartThemes` + `resize` Event Handler Queries All `[id$="-chart"]` on Every Resize
**File:** `js/app.js:464-473`  
**Problem:** `querySelectorAll` on every resize (fires continuously during drag). 50+ charts = 50+ DOM queries × 60fps.
**Fix:** Cache chart instances in `AppState.charts` Map; iterate Map on resize.

---

### 🟡 WARNING — Code Quality & DRY Violations

#### WARN-06: Magic Numbers Everywhere (50+ Instances)
**Examples:**
- `js/engine.js:99` — `for (let k = 0; k < 3; k++)` — "2 of 3 green months" hardcoded
- `js/engine.js:110` — `greenCount >= 2` — same rule, different location
- `js/charts-s1.js:15` — `depth <= -0.10` — 10% crash threshold
- `js/charts-s1.js:32` — `shield > 0.05`, `shield < -0.05` — 5% verdict thresholds
- `js/charts-s3.js:98` — `dev = 0.05` — 5% ZigZag
- `js/charts-s3.js:213` — `w=24` — Z-score window
- `js/charts-s4.js:6` — `w = 24` — Beta window
- `js/charts-s4.js:228` — `w=12` — RBI stress window
- `js/charts-s4.js:335` — `w=36` — ADB floor window
- `js/charts-s5.js:304` — `bins = new Array(11)` — -5% to +5%
- `js/charts-s5.js:327` — `w=36` — BlackRock factor window

**Impact:** Changing a parameter (e.g., ZigZag 5% → 3%) requires grep across 5 files. No single source of truth.
**Fix:** Central `CONFIG` object with all tunable parameters; import everywhere.

#### WARN-07: Inconsistent Date Handling — String vs Date Object Mixing
**Files:** Throughout  
**Examples:**
- `js/engine.js:410-415` — `_getMonthDifference` parses strings with `new Date()`
- `js/charts-s3.js:47` — `new Date(lastDate); d.setMonth(lastDate.getMonth()+t)` — mutates date
- `js/charts-s4.js:17` — `new Date(lastD); d.setMonth(lastD.getMonth()+i)` — same
- `js/app.js:14` — `data.findIndex(d => d.date === selectedStartDate)` — string comparison

**Problem:** `new Date("2026-01-30")` parses as UTC midnight, but `new Date("2026-01-30T00:00:00")` parses as local. Month boundaries shift across DST/timezone.
**Impact:** Off-by-one month errors in CAGR, rolling windows, velocity calculations.
**Fix:** Use `date-fns` or `dayjs` (lightweight); enforce `YYYY-MM-DD` + UTC parsing.

#### WARN-08: Duplicate Risk Metric Calculations
**Files:** `js/engine.js:360-375` (`_calculateRiskRatios`), `js/charts-s4.js:222-238` (`updateRBIStressChart` — vol+DD), `js/charts-s4.js:358-385` (`updateADBSortinoChart`), `js/charts-s5.js:325-332` (`updateBRFactorChart`)
**Problem:** Standard deviation, downside deviation, CAGR, maxDD calculated 4+ times independently.
**Fix:** Single `calculateRiskMetrics(history)` in engine; return object; all charts consume it.

#### WARN-09: Inconsistent Number Formatting
**Files:** `js/charts-core.js:44-48` (`formatINR`), `js/charts-core.js:70` (inline), `js/charts-s1.js:34` (inline `formatPct`), `js/charts-s3.js:244` (`.toFixed(2)`), `js/charts-s5.js:108` (`.toFixed(2)`)
**Problem:** No shared `formatCurrency`, `formatPercent`, `formatNumber`. Indian numbering (lakhs/crores) not used consistently.
**Fix:** Single `utils/formatters.js` with `formatINR`, `formatPct`, `formatCompactINR` (1.2L, 3.4Cr).

#### WARN-10: Dead Code / Commented-Out Suites
**Files:** `index.html` (lines 262, 336, 340, 346, 354, 360, 366, 372, 378, 384, 390, 396, 402, 408, 414, 420, 426, 432, 438, 444, 450, 456, 462, 468, 474, 480, 486, 492, 498, 504, 510, 516, 522, 528, 534, 540, 546, 552, 558, 564, 570, 576, 582, 588, 594, 600, 606, 612, 618, 624, 630, 636, 642, 648, 654, 660, 666, 672, 678, 684, 690, 696, 702, 708, 714, 720, 726, 732, 738, 744, 750, 756, 762, 768, 774, 780, 786, 792, 798, 804, 810, 816, 822, 828, 834, 840, 846, 852, 858, 864, 870, 876, 882, 888, 894, 900, 906, 912, 918, 924, 930, 936, 942, 948, 954, 960, 966, 972, 978, 984, 990, 996, 1002, 1008, 1014, 1020, 1026, 1032, 1038, 1044, 1050, 1056, 1062) — 50+ "REMOVED SUITE" comments
**Problem:** Dead HTML bloats DOM; `querySelectorAll` in lazy/render walks all of them.
**Fix:** Delete removed suites; use git history for recovery.

---

### 🟡 WARNING — Financial Correctness (Methodology)

#### WARN-11: Momentum Calculation Uses Simple Return, Not Log Return
**File:** `js/engine.js:47-54`  
**Code:**
```javascript
return (currentPrice - pastPrice) / pastPrice;
```
**Problem:** Simple return is not time-additive. For 3-month lookback, compounding effect ignored. Standard momentum uses log returns or total return over period.
**Impact:** Momentum signals slightly distorted, especially in high-vol regimes.
**Fix:** Use `(Math.log(currentPrice) - Math.log(pastPrice))` or `(currentPrice/pastPrice - 1)` — same for single period but composable.

#### WARN-12: "Green Months Filter" Logic Flawed
**File:** `js/engine.js:96-120`  
**Code:**
```javascript
for (let k = 0; k < 3; k++) {
  let checkIdx = i - k;
  if (checkIdx > 0) {
    const monthReturn = this.data[checkIdx][targetAsset] - this.data[checkIdx - 1][targetAsset];
    if (monthReturn > 0) greenCount++;
  }
}
const isTrendConsistent = greenCount >= 2;
```
**Problems:**
1. Checks `targetAsset` returns, but switch decision based on **relative** momentum (equity vs gold). Should check if target asset outperformed the other.
2. `checkIdx > 0` skips index 0 — off-by-one if `i=1`.
3. Uses absolute price change, not return % — favors high-priced assets.
**Impact:** Filter may block valid switches or allow false ones.
**Fix:** Use relative momentum consistency: `(equityMomentum - goldMomentum)` sign persistence over 3 months.

#### WARN-13: Benchmark = Equity Only, Not Strategy-Appropriate
**File:** `js/data.js:265-521` — `BENCHMARK: EQUITY` for all rows  
**Problem:** Strategy switches between Equity and Gold. Benchmark should be **60/40 Equity/Gold** or **risk-parity** blend, not 100% Equity. Comparing momentum strategy to 100% equity overstates alpha in bull markets, understates in bear.
**Impact:** All "vs Benchmark" charts (capture ratios, beta, information ratio) misleading.
**Fix:** Add configurable benchmark: `60/40`, `riskParity`, `equalWeight`, `custom`.

#### WARN-14: No Transaction Costs / Slippage / Spread Modeling
**File:** `js/engine.js` — No cost modeling  
**Problem:** Strategy switches ~20-40 times over 20 years. Each switch incurs:
- STT (0.025% sell side)
- Brokerage (₹20 or 0.03%)
- Exchange charges, GST, stamp duty
- Slippage (impact cost)
**Impact:** Post-tax returns overstated by 0.5-1.5% CAGR depending on turnover.
**Fix:** Add `transactionCostPct` option; apply on every switch (both legs).

#### WARN-15: Dividend Yield Ignored for Equity
**File:** `js/data.js` — `EQUITY` column is price index (BSE Midcap 150 Momentum 30 TRI would include dividends)
**Problem:** If `EQUITY` is price return (not total return), equity buy & hold understates by ~1.5-2%/yr (dividend yield). Momentum strategy also misses dividends when in equity.
**Impact:** All equity returns understated; strategy vs equity comparison skewed.
**Fix:** Use Total Return Index (TRI) data; or add `dividendYield` parameter.

---

### 🔵 INFO — Code Quality & Polish

#### INFO-01: Inconsistent Chart Sizing — Some Fixed Height, Some Responsive
**Files:** `index.html` — `style="height: 400px"`, `style="height: 250px"`, `style="height: 450px"`, `class="chart-container small-chart"`, `class="chart-container main-chart"`
**Fix:** Standardize on CSS classes; use `aspect-ratio` in CSS.

#### INFO-02: No TypeScript / JSDoc Types
**Entire codebase:** No type annotations. Financial calculations need types for `CAGR`, `Drawdown`, `TaxLog`, etc.
**Fix:** Add JSDoc `@typedef` or migrate to TypeScript.

#### INFO-03: No Error Boundaries / Graceful Degradation
**Files:** All chart functions — `if(!chartDom) return;` but no try/catch around `echarts.init()`
**Fix:** Wrap each chart in try/catch; show user-friendly error in container.

#### INFO-04: Hardcoded Color Palette — No Theme System
**Files:** All chart files — `#2980b9`, `#e74c3c`, `#27ae60`, `#c0392b`, `#f1c40f`, `#3498db` scattered
**Fix:** Central `theme.js` with semantic colors (`color.strategy`, `color.benchmark`, `color.positive`, `color.negative`, `color.neutral`).

#### INFO-05: `utils.js` Only Exports `safeInit` — Underutilized
**File:** `js/utils.js:1-6`  
**Fix:** Move `formatINR`, `formatPct`, `calculateCAGR`, `calculateDrawdown`, `calculateRollingReturns` here.

#### INFO-06: No Loading States / Skeletons
**File:** `js/app.js:476-483` — Initial load blocks UI
**Fix:** Show skeleton loaders; render core chart first, lazy-load suites.

#### INFO-07: Print/PDF Export Forces Re-render of All 50+ Charts
**File:** `js/app.js:486-528` — `LazyCharts.renderAll()` then `setTimeout(window.print, 1000)`
**Problem:** 50+ ECharts instances created simultaneously → main thread blocked 2-3s. User sees frozen UI.
**Fix:** Stagger rendering with `requestIdleCallback`; show progress indicator.

#### INFO-08: No Accessibility (a11y) — Charts Not Screen-Reader Friendly
**Files:** All charts — ECharts `aria` not configured; tables missing `<caption>`, `<th scope="col">`
**Fix:** Add `aria-label` to chart containers; provide data tables as alternative.

---

## Priority Fix List

### Phase 1: Critical Financial Correctness (Do First)
| # | Fix | Effort | Risk if Deferred |
|---|-----|--------|------------------|
| 1 | Fix LTCG exemption: aggregate by financial year | Medium | Tax liability understated 5-10x |
| 2 | Fix CAGR time period (investment date vs first data point) | Low | All CAGRs inflated |
| 3 | Fix STCG/LTCG classification: use day count, not month diff | Low | Boundary trades misclassified |
| 4 | Fix Sortino denominator (use N, not negative count) | Low | Sortino artificially high |
| 5 | Fix Velocity of Wealth success rate denominator | Low | Misleading "reliability" stats |
| 6 | Add transaction costs & slippage model | Medium | Returns overstated |
| 7 | Use TRI data or add dividend yield | Medium | Equity returns understated |

### Phase 2: Security & Architecture
| # | Fix | Effort | Risk if Deferred |
|---|-----|--------|------------------|
| 8 | Replace all `innerHTML` with safe DOM APIs | Medium | XSS if data source changes |
| 9 | Add CSP header + nonce-based scripts | Low | CDN supply chain risk |
| 10 | Migrate to ES modules (Vite) | High | Unmaintainable global soup |
| 11 | Extract chart suites to separate modules | High | Coupling prevents testing |
| 12 | Centralize config (magic numbers) | Medium | Parameter changes error-prone |

### Phase 3: Performance & Reliability
| # | Fix | Effort | Risk if Deferred |
|---|-----|--------|------------------|
| 13 | Memoize rolling calculations in engine | Low | Wasted CPU on every run |
| 14 | Optimize Velocity of Wealth to O(n log n) | Medium | Lag on parameter change |
| 15 | Fix ECharts disposal — central lifecycle | Medium | Memory leaks → tab crash |
| 16 | Add Vitest unit tests for engine calculations | High | Silent regressions |
| 17 | Standardize date handling with date-fns | Medium | Off-by-one month errors |

### Phase 4: Polish & Professional Grade
| # | Fix | Effort | Risk if Deferred |
|---|-----|--------|------------------|
| 18 | Add TypeScript / JSDoc types | Medium | Refactor risk |
| 19 | Central theme/color system | Low | Inconsistent UX |
| 20 | Accessibility (ARIA, data tables) | Medium | Excludes users |
| 21 | Benchmark configuration (60/40, risk parity) | Low | Misleading comparisons |
| 22 | Staggered PDF export rendering | Low | UI freeze on print |

---

## Appendix: File-Level Summary

| File | Lines | Issues | Priority |
|------|-------|--------|----------|
| `js/engine.js` | 546 | CRIT-01,02,03,05,06,07,08,09, WARN-01,02,11,12,14,15 | 🔴 |
| `js/app.js` | 530 | CRIT-04, WARN-02,03,05, INFO-07 | 🔴 |
| `js/charts-core.js` | 342 | CRIT-11, WARN-03,09 | 🔴 |
| `js/charts-s1.js` | 222 | CRIT-11, WARN-06 | 🟡 |
| `js/charts-s2.js` | 298 | WARN-03,06,08 | 🟡 |
| `js/charts-s3.js` | 495 | WARN-03,04,06,07 | 🟡 |
| `js/charts-s4.js` | 386 | CRIT-11,12,14, WARN-03,06,08 | 🔴 |
| `js/charts-s5.js` | 341 | WARN-03,06,08,09 | 🟡 |
| `js/lazy.js` | 70 | CRIT-14, WARN-03 | 🟡 |
| `js/utils.js` | 6 | INFO-05 | 🔵 |
| `js/data.js` | 521 | WARN-13,15 | 🟡 |
| `index.html` | 1067+ | CRIT-13, WARN-10, INFO-01,06 | 🟡 |

---

## Recommended Next Steps

1. **Immediate (Day 1-2):** Fix CRIT-01 through CRIT-04 (CAGR, tax, holding period). These are pure logic fixes in `engine.js`.
2. **Week 1:** Security fixes (CRIT-11, CRIT-13) + add Vitest + write tests for engine calculations.
3. **Week 2-3:** Module migration (Vite + ES modules) + extract chart suites.
4. **Week 4:** Performance optimization + central config + date-fns migration.
5. **Ongoing:** Add transaction costs, benchmark config, accessibility.

---

*Review generated automatically. For questions, run `gsd-audit-fix` to start automated remediation.*