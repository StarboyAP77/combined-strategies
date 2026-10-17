// 31/js/engine.js — backtest engine (pre-tax + post-tax ledgers)
    // =================================================================
    // 5. STRATEGY IMPLEMENTATION (POST-TAX)
    // =================================================================

    class MomentumSwitchingStrategy {
        constructor(data, options = {}) {
            if (!data || data.length < 2) {
                throw new Error("Insufficient data provided. Need at least two data points.");
            }
            // Minor: copy the caller array — post-construction caller mutation
            // (push/splice/reorder) must not corrupt the engine mid-run.
            this.data = (data || []).slice();
            this.lookbackPeriod = options.lookbackPeriod ?? 3;
            this.initialCapital = options.initialCapital ?? 100000;
            this.startingAsset = options.startingAsset ?? 'EQUITY';
            this.minMomentumThreshold = options.minMomentumThreshold ?? 0.05;
            this.minMomentumDivergence = options.minMomentumDivergence ?? 0.01;
            this.shortTermTaxRate = options.shortTermTaxRate ?? 0.20;
            this.longTermTaxRate = options.longTermTaxRate ?? 0.125;
            this.longTermExemptionLimit = options.longTermExemptionLimit ?? 125000;
            this.riskFreeRate = options.riskFreeRate ?? 0.06;
            // WARN-14: round-trip cost as a fraction of sell proceeds, default 0 so
            // programmatic callers (app.js) are unaffected until they opt in.
            this.transactionCostPct = options.transactionCostPct ?? 0;

            this.portfolioValueHistory = [];
            this.postTaxPortfolioValueHistory = [];
            this.tradeLog = [];
            this.taxTradeLog = [];
            this.switchLog = [];
            this.totalSwitches = 0;
            this.switchesToEquity = 0;
            this.switchesToGold = 0;
            this.totalTransactionCost = 0;
            // CRIT-08: headline drawdown/recovery is POST-tax (matches absoluteCAGR);
            // the pre-tax figures are kept alongside for transparency.
            this.maxDrawdown = 0;
            this.maxDrawdownDate = null;
            this.postTaxPeakValue = this.initialCapital;
            this.postTaxPeakDate = null;
            this.preTaxMaxDrawdown = 0;
            this.preTaxMaxDrawdownDate = null;
            this.preTaxPeakValue = this.initialCapital;
            this.preTaxPeakDate = null;
            this.currentAsset = this.startingAsset;
            
            this.preTaxCurrentUnits = 0;
            this.postTaxCurrentUnits = 0;
            this.preTaxLastBuyPrice = 0;
            this.postTaxLastBuyPrice = 0;

            this.lastBuyDate = null;
            this.ltcgExemptionUsedByFY = {};
            this.results = {};
            this.equityBuyAndHoldHistory = [];
            this.goldBuyAndHoldHistory = [];
        }

        _calculateMomentum(currentIndex, asset) {
            const lookbackIndex = currentIndex - this.lookbackPeriod;
            if (lookbackIndex < 0) return 0;
            const currentPrice = this.data[currentIndex][asset];
            const pastPrice = this.data[lookbackIndex][asset];
            // C3: guard missing/zero/NaN prices — one bad row must not poison the run with NaN/Infinity
            if (!Number.isFinite(currentPrice) || !Number.isFinite(pastPrice) || pastPrice <= 0 || currentPrice <= 0) return 0;
            return (currentPrice - pastPrice) / pastPrice;
        }

        run() {
            // C4: reset all run-mutated state so run() is idempotent —
            // a second run() on the same instance must produce identical results
            // (histories/logs were appended, never reset; duplicates then collapsed
            // in WithdrawalCalculator's monthlyReturns Map and hit stale first
            // copies via findIndex in _calculateRecoveryTime).
            this.portfolioValueHistory = [];
            this.postTaxPortfolioValueHistory = [];
            this.tradeLog = [];
            this.taxTradeLog = [];
            this.switchLog = [];
            this.equityBuyAndHoldHistory = [];
            this.goldBuyAndHoldHistory = [];
            this.totalSwitches = 0;
            this.switchesToEquity = 0;
            this.switchesToGold = 0;
            this.totalTransactionCost = 0;
            // CRIT-08: reset the post-tax (headline) and pre-tax drawdown trackers too —
            // otherwise a second run() would inherit the first run's peaks.
            this.maxDrawdown = 0;
            this.maxDrawdownDate = null;
            this.postTaxPeakValue = this.initialCapital;
            this.postTaxPeakDate = null;
            this.preTaxMaxDrawdown = 0;
            this.preTaxMaxDrawdownDate = null;
            this.preTaxPeakValue = this.initialCapital;
            this.preTaxPeakDate = null;
            this.currentAsset = this.startingAsset;
            this.preTaxCurrentUnits = 0;
            this.postTaxCurrentUnits = 0;
            this.preTaxLastBuyPrice = 0;
            this.postTaxLastBuyPrice = 0;
            this.lastBuyDate = null;
            this.ltcgExemptionUsedByFY = {};
            this.results = {};

            const startIndex = this.lookbackPeriod;
            if (this.data.length <= startIndex) return;

            // NOTE (review minor): the entry leg intentionally bypasses the
            // threshold/divergence/green-filter gates enforced on every later
            // switch — at startIndex there is no prior holding and (for the
            // green filter) no 3-month confirmation history yet.
            // The starting asset is the USER's choice (options.startingAsset) and
            // is honoured here — it must NOT be overwritten by momentum. Only the
            // monthly loop's switching logic below is momentum-driven.
            this.currentAsset = this.startingAsset;

            const startingDataPoint = this.data[startIndex];
            this.preTaxLastBuyPrice = startingDataPoint[this.currentAsset];
            this.postTaxLastBuyPrice = startingDataPoint[this.currentAsset];
            // C3: abort cleanly on bad start price — never Infinity units / NaN corpus
            if (!Number.isFinite(this.preTaxLastBuyPrice) || this.preTaxLastBuyPrice <= 0 ||
                !Number.isFinite(this.postTaxLastBuyPrice) || this.postTaxLastBuyPrice <= 0) return;
            this.lastBuyDate = startingDataPoint.date;
            this.preTaxCurrentUnits = this.initialCapital / this.preTaxLastBuyPrice;
            this.postTaxCurrentUnits = this.initialCapital / this.postTaxLastBuyPrice;

            this.preTaxPeakValue = this.initialCapital;
            this.preTaxPeakDate = this.lastBuyDate;
            this.postTaxPeakValue = this.initialCapital;
            this.postTaxPeakDate = this.lastBuyDate;
            
            this.portfolioValueHistory.push({ date: this.lastBuyDate, value: this.initialCapital, asset: this.currentAsset });
            // CRIT-01: date must stay this.lastBuyDate (the real investment date) — the
            // CAGR window is derived from this row. `asset` belongs here too (app.js
            // contract) and records the user's startingAsset, which the entry leg honours.
            this.postTaxPortfolioValueHistory.push({ date: this.lastBuyDate, value: this.initialCapital, asset: this.currentAsset });

            for (let i = startIndex + 1; i < this.data.length; i++) {
                const currentMonthData = this.data[i];
                const currentDate = currentMonthData.date;
                const equityMomentum = this._calculateMomentum(i, 'EQUITY');
                const goldMomentum = this._calculateMomentum(i, 'GOLD');
                let targetAsset = this.currentAsset;

                if (equityMomentum > goldMomentum) targetAsset = 'EQUITY';
                else if (goldMomentum > equityMomentum) targetAsset = 'GOLD';
                
                let shouldSwitch = false;
                const momentumDivergence = Math.abs(equityMomentum - goldMomentum);




                // ==========================================
                // START OF GREEN MONTHS FILTER
                // ==========================================
                if (targetAsset !== this.currentAsset) {
                    let greenCount = 0, greenSamples = 0;
                    // Check the current month and the 2 months before it
                    for (let k = 0; k < 3; k++) {
                        let checkIdx = i - k;
                        if (checkIdx > 0) {
                            greenSamples++;
                            const monthReturn = this.data[checkIdx][targetAsset] - this.data[checkIdx - 1][targetAsset];
                            if (monthReturn > 0) {
                                greenCount++;
                            }
                        }
                    }
                    
                    // The "2 out of 3" Rule — requires 3 real samples. With
                    // lookbackPeriod = 1 the first switch candidates only have
                    // 2 samples, so hold instead of judging 2-of-3 on 2.
                    const isTrendConsistent = greenSamples >= 3 ? greenCount >= 2 : false;

                    const winningMomentum = targetAsset === 'EQUITY' ? equityMomentum : goldMomentum;
                    
                    // Added 'isTrendConsistent' to the switch condition
                    if (winningMomentum > this.minMomentumThreshold && 
                        momentumDivergence > this.minMomentumDivergence && 
                        isTrendConsistent) {
                        shouldSwitch = true;
                    }
                }
                // ==========================================
                // END OF GREEN MONTHS FILTER
                // ==========================================

                // C3: bad tick → hold current position, never Infinity units / NaN proceeds
                if (shouldSwitch) {
                    const _sp = currentMonthData[this.currentAsset];
                    const _bp = currentMonthData[targetAsset];
                    if (!Number.isFinite(_sp) || _sp <= 0 || !Number.isFinite(_bp) || _bp <= 0) shouldSwitch = false;
                }
                if (shouldSwitch) {
                    const fromAsset = this.currentAsset;
                    const sellPrice = currentMonthData[fromAsset];
                    const buyPrice = currentMonthData[targetAsset];
                    
                    // Pre-tax calculation
                    const preTaxProceeds = this.preTaxCurrentUnits * sellPrice;
                    const preTaxProfit = preTaxProceeds - (this.preTaxCurrentUnits * this.preTaxLastBuyPrice);

                    // Post-tax calculation
                    const postTaxProceeds = this.postTaxCurrentUnits * sellPrice;
                    const profitForTax = postTaxProceeds - (this.postTaxCurrentUnits * this.postTaxLastBuyPrice);

                    const holdingPeriodMonths = this._getMonthDifference(this.lastBuyDate, currentDate);
                    // CRIT-03: the STCG/LTCG split is decided by ELAPSED DAYS, not calendar
                    // months. `months` collapses 365-day and 366-day holds into the same
                    // bucket, which mispriced holds sitting right on the 12/24-month line
                    // (e.g. 366 days read as "12 months" → STCG at 20% instead of LTCG 12.5%).
                    // daysBetween() returns 0 for an unparseable date, and 0 > threshold is
                    // false — so a bad date falls through to STCG, the conservative (higher) rate.
                    const holdingDays = daysBetween(this.lastBuyDate, currentDate);

                    let taxAmount = 0, stcgPaid = 0, ltcgPaid = 0, taxType = 'None';
                    if (profitForTax > 0) {
                        // M9: equity LTCG >365 days, gold LTCG >730 days (sold asset decides)
                        const ltcgThresholdDays = (fromAsset === 'GOLD') ? 730 : 365;
                        if (holdingDays > ltcgThresholdDays) {
                            // M10: 1.25L LTCG exemption is per financial year (Apr-Mar),
                            // not per switch — cap against remaining shield in this FY
                            const fy = this._getFinancialYear(currentDate);
                            const used = this.ltcgExemptionUsedByFY[fy] || 0;
                            const remaining = Math.max(0, this.longTermExemptionLimit - used);
                            const exemptApplied = Math.min(profitForTax, remaining);
                            const taxableGain = profitForTax - exemptApplied;
                            this.ltcgExemptionUsedByFY[fy] = used + exemptApplied;
                            taxAmount = taxableGain * this.longTermTaxRate;
                            ltcgPaid = taxAmount;
                            taxType = 'Long-Term';
                        } else {
                            taxAmount = profitForTax * this.shortTermTaxRate;
                            stcgPaid = taxAmount;
                            taxType = 'Short-Term';
                        }
                    }
                    
                    const netProceeds = postTaxProceeds - taxAmount;
                    // WARN-14: one round-trip cost, charged once per switch on the sell leg,
                    // before units are recomputed. At transactionCostPct === 0 this is exactly 0.
                    const txCost = Math.max(0, Math.min(this.transactionCostPct * preTaxProceeds, preTaxProceeds));
                    this.totalTransactionCost += txCost;
                    const profitPct = (this.preTaxCurrentUnits * this.preTaxLastBuyPrice > 0) ? (preTaxProfit / (this.preTaxCurrentUnits * this.preTaxLastBuyPrice)) : 0;

                    this.tradeLog.push({ 
                        sellDate: currentDate, fromAsset: fromAsset, toAsset: targetAsset,
                        profit: preTaxProfit, profitPct: profitPct, taxType: taxType, 
                        tax: taxAmount, corpusBeforeTax: preTaxProceeds, corpusAfterTax: netProceeds,
                        holdingPeriodMonths: holdingPeriodMonths, holdingDays: holdingDays,
                        transactionCost: txCost
                    });
                    
                    this.taxTradeLog.push({
                        date: currentDate, fromAsset: fromAsset, toAsset: targetAsset,
                        status: preTaxProfit > 0 ? 'Win' : 'Loss', profit: preTaxProfit, profitPct: profitPct,
                        taxPaid: taxAmount, stcgPaid: stcgPaid, ltcgPaid: ltcgPaid,
                        postTaxCorpus: netProceeds, transactionCost: txCost
                    });

                    // Update units for both portfolios (WARN-14: cost deducted from both ledgers)
                    this.preTaxCurrentUnits = (preTaxProceeds - txCost) / buyPrice;
                    this.postTaxCurrentUnits = (netProceeds - txCost) / buyPrice;
                    
                    // Update cost basis and date
                    this.preTaxLastBuyPrice = buyPrice;
                    this.postTaxLastBuyPrice = buyPrice;
                    this.lastBuyDate = currentDate;

                    this.totalSwitches++;
                    if (targetAsset === 'EQUITY') this.switchesToEquity++; else this.switchesToGold++;
                    
                    this.switchLog.push({ 
                        date: currentDate, from: fromAsset, to: targetAsset, corpus: preTaxProceeds,
                        equityMomentum: equityMomentum, goldMomentum: goldMomentum,
                        actualMomentumDivergence: momentumDivergence
                    });
                    this.currentAsset = targetAsset;
                }
                
                // Calculate and record daily values AFTER any switching logic
                // C3: carry forward last value on bad tick — never NaN corpus
                const _px = currentMonthData[this.currentAsset];
                const _prevPre = this.portfolioValueHistory.length > 0 ? this.portfolioValueHistory[this.portfolioValueHistory.length - 1].value : this.initialCapital;
                const _prevPost = this.postTaxPortfolioValueHistory.length > 0 ? this.postTaxPortfolioValueHistory[this.postTaxPortfolioValueHistory.length - 1].value : this.initialCapital;
                const preTaxPortfolioValue = (Number.isFinite(_px) && _px > 0) ? this.preTaxCurrentUnits * _px : _prevPre;
                const postTaxPortfolioValue = (Number.isFinite(_px) && _px > 0) ? this.postTaxCurrentUnits * _px : _prevPost;

                this.portfolioValueHistory.push({
                    date: currentDate, value: preTaxPortfolioValue, asset: this.currentAsset,
                    equityMomentum: equityMomentum, goldMomentum: goldMomentum, momentumDivergence: momentumDivergence
                });
                this.postTaxPortfolioValueHistory.push({ date: currentDate, value: postTaxPortfolioValue, asset: this.currentAsset });
                
                // CRIT-08: drawdown/recovery are reported next to a POST-tax CAGR, so
                // track the peak on the post-tax ledger as the headline figure and keep
                // the pre-tax peak/drawdown alongside it for transparency.
                if (preTaxPortfolioValue > this.preTaxPeakValue) { this.preTaxPeakValue = preTaxPortfolioValue; this.preTaxPeakDate = currentDate; }
                const preTaxDrawdown = this.preTaxPeakValue > 0 ? (this.preTaxPeakValue - preTaxPortfolioValue) / this.preTaxPeakValue : 0;
                if (preTaxDrawdown > this.preTaxMaxDrawdown) { this.preTaxMaxDrawdown = preTaxDrawdown; this.preTaxMaxDrawdownDate = currentDate; }

                if (postTaxPortfolioValue > this.postTaxPeakValue) { this.postTaxPeakValue = postTaxPortfolioValue; this.postTaxPeakDate = currentDate; }
                const postTaxDrawdown = this.postTaxPeakValue > 0 ? (this.postTaxPeakValue - postTaxPortfolioValue) / this.postTaxPeakValue : 0;
                if (postTaxDrawdown > this.maxDrawdown) { this.maxDrawdown = postTaxDrawdown; this.maxDrawdownDate = currentDate; }
            }




            // ===============================================
            // NEW CODE: Calculate Open Position (Current Holding)
            // ===============================================
            const lastData = this.data[this.data.length - 1];
            let currentPrice = lastData[this.currentAsset];
            // C3: fall back to cost basis on bad final tick — never NaN open row
            if (!Number.isFinite(currentPrice) || currentPrice <= 0) currentPrice = this.postTaxLastBuyPrice;
            
            // Calculate Current Market Value
            const currentMarketValue = this.postTaxCurrentUnits * currentPrice;
            const costBasis = this.postTaxCurrentUnits * this.postTaxLastBuyPrice;
            const unrealizedProfit = currentMarketValue - costBasis;
            
            // Calculate Holding Period
            const holdingMonths = this._getMonthDifference(this.lastBuyDate, lastData.date);
            // CRIT-03: same elapsed-days rule as the realised switch leg above.
            const holdingDays = daysBetween(this.lastBuyDate, lastData.date);

            // Calculate Hypothetical Tax (If sold today)
            let estTax = 0;
            let taxType = 'None (Unrealized)';
            
            if (unrealizedProfit > 0) {
                // M9: equity LTCG >365 days, gold LTCG >730 days (held asset decides).
                // holdingDays === 0 (unparseable date) fails `>` and stays STCG — conservative.
                const ltcgThresholdDays = (this.currentAsset === 'GOLD') ? 730 : 365;
                if (holdingDays > ltcgThresholdDays) {
                    // M10: estimate against remaining FY shield — read-only, do not consume
                    const fy = this._getFinancialYear(lastData.date);
                    const used = this.ltcgExemptionUsedByFY[fy] || 0;
                    const remaining = Math.max(0, this.longTermExemptionLimit - used);
                    const taxableGain = Math.max(0, unrealizedProfit - remaining);
                    estTax = taxableGain * this.longTermTaxRate;
                    taxType = 'Long-Term (Est.)';
                } else {
                    estTax = unrealizedProfit * this.shortTermTaxRate;
                    taxType = 'Short-Term (Est.)';
                }
            }
            
            const liquidationValue = currentMarketValue - estTax;
            const profitPct = costBasis > 0 ? (unrealizedProfit / costBasis) : 0;

            // Push specific "Open Position" entry to log
            this.tradeLog.push({ 
                sellDate: lastData.date + " (Current)", 
                fromAsset: this.currentAsset, 
                toAsset: "HOLDING", 
                profit: unrealizedProfit, 
                profitPct: profitPct, 
                taxType: taxType, 
                tax: estTax, 
                corpusBeforeTax: currentMarketValue, 
                corpusAfterTax: liquidationValue,
                holdingPeriodMonths: holdingMonths, holdingDays: holdingDays,
                transactionCost: 0, // open position — nothing sold, so no round-trip cost
                isOpen: true // Flag to identify this row for styling
            });

            // End of NEW CODE: Calculate Open Position (Current Holding)


            this._calculateBuyAndHoldCurves();
            this._calculateMetrics();
        }

        _calculateBuyAndHoldCurves() {
            const startIndex = this.lookbackPeriod;
            if (this.data.length <= startIndex) return;

            const equityStartPrice = this.data[startIndex].EQUITY;
            const goldStartPrice = this.data[startIndex].GOLD;
            // C3: skip curves on bad start price — never Infinity units
            if (!Number.isFinite(equityStartPrice) || equityStartPrice <= 0 || !Number.isFinite(goldStartPrice) || goldStartPrice <= 0) return;

            const equityUnits = this.initialCapital / equityStartPrice;
            const goldUnits = this.initialCapital / goldStartPrice;

            for (let i = startIndex; i < this.data.length; i++) {
                this.equityBuyAndHoldHistory.push({ date: this.data[i].date, value: equityUnits * this.data[i].EQUITY });
                this.goldBuyAndHoldHistory.push({ date: this.data[i].date, value: goldUnits * this.data[i].GOLD });
            }
        }

        _calculateMetrics() {
            if (this.portfolioValueHistory.length === 0) { this.results = {}; return; }
            
            const finalValue = this.portfolioValueHistory[this.portfolioValueHistory.length - 1].value;
            const finalPostTaxValue = this.postTaxPortfolioValueHistory[this.postTaxPortfolioValueHistory.length - 1].value;
            const startDate = this.portfolioValueHistory[0].date;
            const endDate = this.portfolioValueHistory[this.portfolioValueHistory.length - 1].date;
            // CRIT-01: INVARIANT — portfolioValueHistory[0] is pushed in run() with
            // date = this.lastBuyDate = data[lookbackPeriod].date, the actual investment
            // date, so startDate is NOT an artificial Jan-1 anchor. Keep it that way: never
            // re-anchor history[0] to a calendar-year start or the CAGR window shifts.
            const years = yearsBetween(startDate, endDate);
            const absoluteCAGR = cagrFrom(this.initialCapital, finalPostTaxValue, years);
            const recoveryTime = this._calculateRecoveryTime();
            const preTaxRecoveryTime = this._calculateRecoveryTimeFor(this.portfolioValueHistory);
            const winningTrades = this.tradeLog.filter(t => t.profit > 0).length;
            const losingTrades = this.tradeLog.filter(t => t.profit < 0).length;
            const totalTrades = winningTrades + losingTrades;
            const winRate = totalTrades > 0 ? (winningTrades / totalTrades) : 0;
            const totalProfit = this.tradeLog.filter(t => t.profit > 0).reduce((sum, t) => sum + t.profit, 0);
            const totalLoss = Math.abs(this.tradeLog.filter(t => t.profit < 0).reduce((sum, t) => sum + t.profit, 0));
            const profitFactor = totalLoss > 0 ? (totalProfit / totalLoss) : (totalProfit > 0 ? Infinity : 0);
            const averageWin = winningTrades > 0 ? (totalProfit / winningTrades) : 0;
            const averageLoss = losingTrades > 0 ? (totalLoss / losingTrades) : 0;
            const totalTax = this.tradeLog.reduce((sum, t) => sum + (t.tax || 0), 0);
            const rollingCAGRs = this._calculateRollingCAGRs(this.postTaxPortfolioValueHistory);
            const avgRollingCAGR = rollingCAGRs && Object.keys(rollingCAGRs).length > 0 ? Object.values(rollingCAGRs).reduce((a, b) => a + b, 0) / Object.keys(rollingCAGRs).length : 0;
            const riskMetrics = this._calculateRiskRatios(this.postTaxPortfolioValueHistory, absoluteCAGR);
            const yearlyStats = this._calculateCalendarYearStats(this.postTaxPortfolioValueHistory);

            this.results = {
                strategy: `Momentum Switching`, period: `${startDate} to ${endDate}`,
                startingCapital: this.initialCapital, preTaxCorpus: finalValue, postTaxCorpus: finalPostTaxValue,
                totalTaxPaid: totalTax, totalTransactionCost: this.totalTransactionCost,
                absoluteCAGR: absoluteCAGR, rollingCAGRs: rollingCAGRs,
                avgRollingCAGR: avgRollingCAGR,
                // CRIT-08: maxDrawdown/recoveryTimeMonths are POST-tax (same basis as
                // absoluteCAGR above); the pre-tax figures ride alongside for transparency.
                maxDrawdown: this.maxDrawdown, maxDrawdownDate: this.maxDrawdownDate,
                recoveryTimeMonths: recoveryTime,
                preTaxMaxDrawdown: this.preTaxMaxDrawdown, preTaxMaxDrawdownDate: this.preTaxMaxDrawdownDate,
                preTaxRecoveryTimeMonths: preTaxRecoveryTime,
                totalSwitches: this.totalSwitches,
                switchesToEquity: this.switchesToEquity, switchesToGold: this.switchesToGold,
                currentHolding: this.currentAsset, winningTrades: winningTrades, losingTrades: losingTrades,
                winRate: winRate, profitFactor: profitFactor, averageWin: averageWin, averageLoss: averageLoss,
                ...riskMetrics, yearlyStats: yearlyStats
            };
        }

        _calculateCalendarYearStats(history, isBuyAndHold = false) {
            if (history.length < 2) return [];
            const yearlyPoints = {};
            history.forEach(p => {
                // WARN-07: UTC getters — 'YYYY-MM-DD' is UTC-parsed, so local-time
                // getFullYear() can shift the year in negative-offset timezones.
                const year = new Date(p.date).getUTCFullYear();
                if (!yearlyPoints[year]) yearlyPoints[year] = [];
                yearlyPoints[year].push(p);
            });
            const results = [];
            let lastYearEndValue = this.initialCapital;
            const sortedYears = Object.keys(yearlyPoints).sort();
            for (const year of sortedYears) {
                const pointsInYear = yearlyPoints[year];
                const startValue = lastYearEndValue;
                const endValue = pointsInYear[pointsInYear.length - 1].value;
                const yearlyReturn = startValue > 0 ? (endValue - startValue) / startValue : 0;
                let peakInYear = startValue;
                let maxDDInYear = 0;
                pointsInYear.forEach(point => {
                    peakInYear = Math.max(peakInYear, point.value);
                    const currentDD = peakInYear > 0 ? (peakInYear - point.value) / peakInYear : 0;
                    if (currentDD > maxDDInYear) maxDDInYear = currentDD;
                });
                // NOTE (review minor): the first calendar year is seeded from
                // initialCapital though the strategy starts mid-year — mark it
                // partial (<12 months of history) so tables/charts can label
                // it instead of presenting it as a full-year return. No math
                // change: return/maxDD computed exactly as before.
                results.push({ year: parseInt(year), return: yearlyReturn, maxDD: maxDDInYear, partial: pointsInYear.length < 12 });
                lastYearEndValue = endValue;
            }
            return results;
        }

        _calculateMonthlyReturnsAndDD(history) {
            if (history.length < 2) return [];
            const monthlyStats = [];
            for (let i = 1; i < history.length; i++) {
                const prevPoint = history[i - 1];
                const currentPoint = history[i];
                const monthlyReturn = (currentPoint.value - prevPoint.value) / prevPoint.value;
                const maxDD = monthlyReturn < 0 ? monthlyReturn : 0;
                monthlyStats.push({ month: currentPoint.date.substring(0, 7), return: monthlyReturn, maxDD: maxDD });
            }
            return monthlyStats;
        }

        _calculateRiskRatios(history, cagr) {
            if (history.length < 2) return { sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, standardDeviation: 0, downsideDeviation: 0 };
            // M22/CRIT-06: one volatility definition for the whole codebase — hand-rolled
            // population variance + sqrt(12) here drifted from annVolFromReturns().
            const standardDeviation = annVolFromHistory(history);
            // CRIT-06: the old code divided by the count of NEGATIVE months, which
            // inflated downside deviation and depressed Sortino. downsideDevFromHistory
            // divides by ALL periods (N) and annualises with sqrt(12).
            const downsideDeviation = downsideDevFromHistory(history);
            const annualizedMeanReturn = cagr;
            const sharpeRatio = standardDeviation > 0 ? (annualizedMeanReturn - this.riskFreeRate) / standardDeviation : 0;
            const sortinoRatio = downsideDeviation > 0 ? (annualizedMeanReturn - this.riskFreeRate) / downsideDeviation : 0;
            // Calmar must divide the passed-in history's OWN max drawdown by its own CAGR.
            // It previously used this.maxDrawdown — correct for the strategy, but app.js
            // also calls this for the equity/gold buy-and-hold curves, where it silently
            // reported the strategy's drawdown against the benchmark's CAGR.
            const ownMaxDD = this._calculateMaxDrawdown(history).maxDrawdown;
            const calmarRatio = ownMaxDD > 0 ? cagr / ownMaxDD : 0;
            return { sharpeRatio, sortinoRatio, calmarRatio, standardDeviation, downsideDeviation };
        }

        _calculateRecoveryTime() {
            // CRIT-08: headline recovery is measured on the POST-tax ledger, matching the
            // post-tax maxDrawdown it is reported beside.
            return this._calculateRecoveryTimeFor(this.postTaxPortfolioValueHistory, this.maxDrawdownDate);
        }

        // CRIT-08: shared recovery walk. `maxDDDate` lets the caller pass the drawdown it
        // already tracked (post-tax) instead of recomputing one from the history.
        _calculateRecoveryTimeFor(history, maxDDDate) {
            if (!history || history.length === 0) return null;
            const ddDate = maxDDDate !== undefined ? maxDDDate : this._calculateMaxDrawdown(history).maxDrawdownDate;
            if (!ddDate) return null;
            const maxDDIndex = history.findIndex(p => p.date === ddDate);
            if (maxDDIndex === -1) return null;
            let peakValueBeforeDrawdown = 0;
            for (let i = 0; i <= maxDDIndex; i++) {
                if (history[i].value > peakValueBeforeDrawdown) peakValueBeforeDrawdown = history[i].value;
            }
            for (let i = maxDDIndex + 1; i < history.length; i++) {
                if (history[i].value >= peakValueBeforeDrawdown) {
                    // WARN-07: calendar months are a DISPLAY unit here, never an
                    // annualisation or tax input — monthsBetween is UTC-correct.
                    return monthsBetween(ddDate, history[i].date);
                }
            }
            return null;
        }

        _calculateRollingCAGRs(history) {
            const periods = { 1: 12, 3: 36, 5: 60, 7: 84, 10: 120 }; const results = {};
            for (const [yearStr, months] of Object.entries(periods)) {
                const cagrs = [];
                if (history.length > months) {
                    for (let i = months; i < history.length; i++) {
                        const startValue = history[i - months].value;
                        const endValue = history[i].value;
                        // CRIT-05: month-END dates are 28/29/30/31 days apart, so `months / 12`
                        // mis-annualises every window. Use actual elapsed days (365.25/yr).
                        const years = yearsBetween(history[i - months].date, history[i].date);
                        if (startValue > 0 && years > 0) cagrs.push(cagrFrom(startValue, endValue, years));
                    }
                }
                results[`${yearStr}Year`] = cagrs.length > 0 ? cagrs.reduce((a, b) => a + b, 0) / cagrs.length : 0;
            }
            return results;
        }

        _getFinancialYear(dateStr) {
            // Indian FY: Apr-Mar. Key = starting calendar year (e.g. May 2024 / Feb 2025 → FY 2024).
            // WARN-07: 'YYYY-MM-DD' parses as UTC — local getFullYear()/getMonth() can roll
            // the month/year back in negative-offset timezones, mis-bucketing the FY and
            // therefore the 1.25L LTCG exemption.
            const d = parseDate(dateStr);
            if (!d) return null;
            const y = d.getUTCFullYear();
            const m = d.getUTCMonth(); // 0=Jan … 3=Apr
            return (m >= 3) ? y : y - 1;
        }

        _getMonthDifference(dateStr1, dateStr2) {
            // WARN-07: delegate to the shared UTC-correct monthsBetween. Kept as a method
            // because other code may call it; DISPLAY ONLY (trade-log "Held" column) —
            // tax classification uses daysBetween, annualisation uses yearsBetween.
            return monthsBetween(dateStr1, dateStr2);
        }

        _calculateMaxDrawdown(history) {
            if (history.length === 0) return { maxDrawdown: 0, maxDrawdownDate: null };
            let peakValue = history[0].value;
            let maxDD = 0;
            let maxDDDate = null;
            for (let i = 1; i < history.length; i++) {
                if (history[i].value > peakValue) peakValue = history[i].value;
                const drawdown = peakValue > 0 ? (peakValue - history[i].value) / peakValue : 0;
                if (drawdown > maxDD) {
                    maxDD = drawdown;
                    maxDDDate = history[i].date;
                }
            }
            return { maxDrawdown: maxDD, maxDrawdownDate: maxDDDate };
        }

        _calculateRecoveryTimeForHistory(history) {
            // CRIT-08: public entry point for arbitrary histories (app.js passes the
            // buy-and-hold curves). Recomputes its own drawdown, then measures in
            // calendar months for DISPLAY only.
            return this._calculateRecoveryTimeFor(history);
        }

        _calculateDrawdownSeries(history) {
            if (history.length === 0) return [];
            let runningPeak = history.length > 0 ? history[0].value : 0;
            return history.map(point => {
                if (point.value > runningPeak) runningPeak = point.value;
                const drawdown = runningPeak > 0 ? (runningPeak - point.value) / runningPeak : 0;
                return [point.date, drawdown];
            });
        }

        _calculateVelocityOfWealth(history) {
            const multipliers = [2, 3, 5, 10, 100];
            const results = {};

            multipliers.forEach(m => {
                const monthsTaken = [];
                // reachedAt[i] = months from start i to hitting m x, or -1 if never hit.
                // Kept per start index so the success rate can be restricted to the
                // SAME population as its denominator (see below).
                const reachedAt = new Array(history.length).fill(-1);
                for (let i = 0; i < history.length; i++) {
                    const targetValue = history[i].value * m;
                    for (let j = i + 1; j < history.length; j++) {
                        if (history[j].value >= targetValue) {
                            reachedAt[i] = j - i;
                            monthsTaken.push(j - i);
                            break;
                        }
                    }
                }

                if (monthsTaken.length > 0) {
                    // CRIT-07: dividing successes by history.length counts start months that
                    // sit too close to the end of the series to possibly reach the target —
                    // they count as failures they never got the chance to fail. A start month
                    // is eligible only if it has at least as much runway as the worst observed
                    // time-to-target for this multiplier. Numerator AND denominator must use
                    // that same eligible population, or the rate can exceed 100%.
                    const maxRunway = Math.max(...monthsTaken);
                    let eligible = 0, eligibleSuccesses = 0;
                    for (let i = 0; i < history.length; i++) {
                        if ((history.length - 1 - i) >= maxRunway) {
                            eligible++;
                            if (reachedAt[i] > 0) eligibleSuccesses++;
                        }
                    }
                    results[m] = {
                        avg: (monthsTaken.reduce((a, b) => a + b, 0) / monthsTaken.length / 12).toFixed(1),
                        min: (Math.min(...monthsTaken) / 12).toFixed(1),
                        max: (Math.max(...monthsTaken) / 12).toFixed(1),
                        rate: eligible > 0 ? ((eligibleSuccesses / eligible) * 100).toFixed(1) : '0.0',
                        eligibleStarts: eligible
                    };
                } else {
                    results[m] = { avg: "N/A", min: "N/A", max: "N/A", rate: "0.0", eligibleStarts: 0 };
                }
            });
            return results;
        }
    }

    // =================================================================
    // 6. WITHDRAWAL CALCULATOR
    // =================================================================
    class WithdrawalCalculator {
        constructor(options = {}) {
            this.initialCapital = options.withdrawalInitialCapital || 2500000;
            this.monthlyWithdrawal = options.monthlyWithdrawal || 20000;
            this.yearlyInflation = options.yearlyInflation || 0.04;
            this.data = (options.data || []).slice();
            this.strategyHistory = (options.strategyHistory || []).slice();
        }

        calculate() {
            if (!this.data || this.data.length === 0 || !this.strategyHistory || this.strategyHistory.length === 0) {
                return { corpusHistory: [], totalWithdrawalHistory: [] };
            }
            const corpusHistory = [];
            const totalWithdrawalHistory = [];
            let currentCorpus = this.initialCapital;
            let totalWithdrawn = 0;
            let currentMonthlyWithdrawal = this.monthlyWithdrawal;
            let currentYear = parseDate(this.strategyHistory[0].date) ? parseDate(this.strategyHistory[0].date).getUTCFullYear() : null;
            const monthlyReturns = new Map();
            for (let i = 1; i < this.strategyHistory.length; i++) {
                const monthlyReturn = (this.strategyHistory[i].value - this.strategyHistory[i - 1].value) / this.strategyHistory[i - 1].value;
                monthlyReturns.set(this.strategyHistory[i].date, monthlyReturn);
            }
            corpusHistory.push({ date: this.strategyHistory[0].date, value: currentCorpus });
            totalWithdrawalHistory.push({ date: this.strategyHistory[0].date, value: 0 });
            for (let i = 1; i < this.strategyHistory.length; i++) {
                const date = this.strategyHistory[i].date;
                // WARN-07: UTC year — 'YYYY-MM-DD' is UTC-parsed, so the local year can
                // differ in negative-offset timezones and inflate the wrong year.
                const d = parseDate(date);
                const year = d ? d.getUTCFullYear() : null;
                if (year !== null && year > currentYear) {
                    currentYear = year;
                    currentMonthlyWithdrawal *= (1 + this.yearlyInflation);
                }
                // CRIT-09: SEQUENCING CONVENTION (deliberate, unchanged) — the month's
                // return is applied FIRST, then the withdrawal is taken out of the
                // post-return corpus. Withdraw-then-return would give every month one extra
                // month of market exposure on the withdrawal amount. Both conventions are
                // defensible; this one is the standard "end-of-month draw" model. The math
                // below is intentionally left byte-for-byte identical — reordering it would
                // shift every reported number without being any more correct.
                currentCorpus *= (1 + monthlyReturns.get(date));
                // M11: cap withdrawal at available corpus — no phantom withdrawals after ruin
                const actualWithdrawal = Math.min(currentMonthlyWithdrawal, currentCorpus);
                currentCorpus -= actualWithdrawal;
                if (currentCorpus < 0) currentCorpus = 0;
                totalWithdrawn += actualWithdrawal;
                corpusHistory.push({ date: date, value: currentCorpus });
                totalWithdrawalHistory.push({ date: date, value: totalWithdrawn });
            }
            return { corpusHistory, totalWithdrawalHistory };
        }
    }

    // =================================================================
    // 7. NEW TOOLS LOGIC (Integration)
    // =================================================================
    // Tool 1: Drawdown Protection
