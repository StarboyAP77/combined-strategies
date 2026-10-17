// 31/js/app.js — orchestrator, dropdowns, theme, export, init
    // 8. MAIN UI LOGIC
    // =================================================================
    let myChart, yearlyChart, drawdownChart, withdrawalChart;

    // Shared backtest output for lazy chart renderers (see js/lazy.js).
    // Tables render eagerly every run; charts render only for open sections.
    // WARN-03/WARN-05: `charts` caches live ECharts instances so the resize
    // handler doesn't walk 50+ DOM nodes at 60fps just to call resize().
    const AppState = { runId: 0, ready: false, charts: new Map(), dataReady: false, equityIndex: null };

    // Data source config: js/data.json keys → display labels. The raw JSON is
    // fetched once; buildRows() re-derives the engine's row shape per index.
    const EQUITY_INDEX_LABELS = {
        nseMidcap150Mom50: { name: 'NSE Midcap 150 Momentum 50', short: 'NSE Mom 50' },
        bseMidcap150Mom30: { name: 'BSE Midcap 150 Momentum 30', short: 'BSE Mom 30' }
    };
    const DEFAULT_EQUITY_INDEX = 'nseMidcap150Mom50';
    let data = [];      // rows {date, EQUITY, GOLD, BENCHMARK}, built from js/data.json
    let dataJson = null; // raw parsed data.json

    // Rebuild the live-instance registry. Cheap enough to call on demand,
    // expensive enough that it must NOT run per resize event.
    function refreshChartRegistry() {
        AppState.charts.clear();
        if (typeof echarts === 'undefined') return;
        document.querySelectorAll('[id$="-chart"], #performanceChart, #withdrawalChart, #drawdownChart').forEach(el => {
            try { const c = echarts.getInstanceByDom(el); if (c) AppState.charts.set(el, c); } catch (e) {}
        });
    }
    function forEachLiveChart(fn) {
        if (typeof echarts === 'undefined') return;
        refreshChartRegistry();
        AppState.charts.forEach(fn);
    }

    function runBacktestAndRender() {
        if (!AppState.dataReady || !data.length) return;
        const equityBHLabel = 'Equity Buy & Hold (' + EQUITY_INDEX_LABELS[AppState.equityIndex].short + ')';
        // M1: drop last run's lazy renderers before re-registering, otherwise
        // register() (append-only) stacks stale closures on every input change.
        LazyCharts.clear();
        // M4: fallback to defaults when inputs are cleared/non-numeric — prevents slice(NaN) silent wrong range
        const _int = (id, dflt) => { const v = parseInt(document.getElementById(id).value, 10); return Number.isFinite(v) ? v : dflt; };
        const _float = (id, dflt) => { const v = parseFloat(document.getElementById(id).value); return Number.isFinite(v) ? v : dflt; };
        const selectedStartDate = document.getElementById('startDate').value;
        const selectedEndDate = document.getElementById('endDate').value;
        const lookbackPeriod = _int('lookbackPeriod', 3);
        const fullDataStartIndex = data.findIndex(d => d.date === selectedStartDate);
        const fullDataEndIndex = data.findIndex(d => d.date === selectedEndDate);
        // Minor: -1 (no match) vs a valid index passes the end<=start check
        // below → silently wrong range. Unreachable via dropdowns today,
        // reachable programmatically — fail loudly instead.
        if (fullDataStartIndex < 0 || fullDataEndIndex < 0) { alert("Invalid date selection."); return; }
        if (fullDataEndIndex <= fullDataStartIndex) { alert("End Date must be after Start Date."); return; }
        const requiredDataStartIndex = Math.max(0, fullDataStartIndex - lookbackPeriod);
        const filteredData = data.slice(requiredDataStartIndex, fullDataEndIndex + 1);
        // CRIT-10: was hardcoded at 6% — Sharpe/Sortino are silently sensitive to it.
        const riskFreeRate = _float('riskFreeRate', 6) / 100;
        const options = {
            lookbackPeriod: lookbackPeriod,
            initialCapital: _int('initialCapital', 2500000),
            startingAsset: document.getElementById('startingAsset').value,
            minMomentumThreshold: _float('minMomentumThreshold', 5) / 100,
            minMomentumDivergence: _float('minMomentumDivergence', 1) / 100,
            shortTermTaxRate: _float('shortTermTaxRate', 20) / 100,
            longTermTaxRate: _float('longTermTaxRate', 12.5) / 100,
            longTermExemptionLimit: _int('longTermExemptionLimit', 125000),
            riskFreeRate,
            // WARN-14: UI half only — engine consumption owned elsewhere.
            transactionCostPct: _float('transactionCostPct', 0.2) / 100,
            withdrawalInitialCapital: _int('withdrawalInitialCapital', 2500000),
            monthlyWithdrawal: _int('monthlyWithdrawal', 20000),
            yearlyInflation: _float('yearlyInflation', 4) / 100,
        };

        const strategy = new MomentumSwitchingStrategy(filteredData, options);
        strategy.run();
        const r = strategy.results;

        const withdrawalCalculator = new WithdrawalCalculator({ ...options, data: filteredData, strategyHistory: strategy.postTaxPortfolioValueHistory });
        const { corpusHistory, totalWithdrawalHistory } = withdrawalCalculator.calculate();

        const labels = strategy.portfolioValueHistory.map(p => p.date);
        const strategyData = strategy.portfolioValueHistory.map(p => p.value);
        const postTaxStrategyData = strategy.postTaxPortfolioValueHistory.map(p => p.value);
        const equityBHData = strategy.equityBuyAndHoldHistory.map(p => p.value);
        const goldBHData = strategy.goldBuyAndHoldHistory.map(p => p.value);
        
        // CRIT-12: plainData() at the app->ECharts boundary strips prototypes/getters
        // so a polluted engine object can never reach a chart formatter.
        const switchPoints = plainData(strategy.switchLog.map(logEntry => {
            const point = strategy.portfolioValueHistory.find(p => p.date === logEntry.date);
            if (!point) return null;
            return { name: logEntry.date, value: [point.date, point.value], corpus: logEntry.corpus, equityMomentum: logEntry.equityMomentum, goldMomentum: logEntry.goldMomentum, actualMomentumDivergence: logEntry.actualMomentumDivergence, switchedTo: logEntry.to };
        }).filter(p => p !== null));

        const taxSwitchPoints = plainData(strategy.taxTradeLog.map(logEntry => {
            const point = strategy.postTaxPortfolioValueHistory.find(p => p.date === logEntry.date);
            if(!point) return null;
            return { name: logEntry.date, value: [logEntry.date, point.value], ...logEntry };
        }).filter(p => p !== null));

        const strategyYearlyStats = strategy._calculateCalendarYearStats(strategy.portfolioValueHistory);
        const equityYearlyStats = strategy._calculateCalendarYearStats(strategy.equityBuyAndHoldHistory, true);
        const goldYearlyStats = strategy._calculateCalendarYearStats(strategy.goldBuyAndHoldHistory, true);
        // CRIT-08: the strategy curve is POST-TAX so it plots the same basis the
        // metrics table reports (strategy.results.maxDrawdown is post-tax).
        // The two Buy & Hold series stay on their own histories — B&H has no
        // tax drag, so pre-tax == post-tax there.
        const strategyDrawdownSeries = strategy._calculateDrawdownSeries(strategy.postTaxPortfolioValueHistory);
        const equityDrawdownSeries = strategy._calculateDrawdownSeries(strategy.equityBuyAndHoldHistory);
        const goldDrawdownSeries = strategy._calculateDrawdownSeries(strategy.goldBuyAndHoldHistory);

        // CRIT-04: was `history.length / 12` years, which ignores the real
        // start/end months and biases the B&H CAGR high. Annualise on actual
        // elapsed time with the shared helpers (utils.js) so B&H and the
        // strategy CAGR use one definition.
        const bhCagr = (hist, lastVal) => {
            if (!hist || hist.length < 2) return 0;
            const years = yearsBetween(hist[0].date, hist[hist.length - 1].date);
            return cagrFrom(options.initialCapital, lastVal, years);
        };
        const cagrBH_Equity = bhCagr(strategy.equityBuyAndHoldHistory, equityBHData[equityBHData.length - 1]);
        const cagrBH_Gold = bhCagr(strategy.goldBuyAndHoldHistory, goldBHData[goldBHData.length - 1]);
        const equityBHRisk = strategy._calculateRiskRatios(strategy.equityBuyAndHoldHistory, cagrBH_Equity);
        const goldBHRisk = strategy._calculateRiskRatios(strategy.goldBuyAndHoldHistory, cagrBH_Gold);

        // WARN-02: these were recomputed 3x each (once for the map, twice
        // inside the avg expression) and _calculateMaxDrawdown 2x each.
        // Compute once per history; identical values, one pass.
        const equityRolling = strategy._calculateRollingCAGRs(strategy.equityBuyAndHoldHistory);
        const equityRollingVals = Object.values(equityRolling);
        const equityMaxDD = strategy._calculateMaxDrawdown(strategy.equityBuyAndHoldHistory);
        const goldRolling = strategy._calculateRollingCAGRs(strategy.goldBuyAndHoldHistory);
        const goldRollingVals = Object.values(goldRolling);
        const goldMaxDD = strategy._calculateMaxDrawdown(strategy.goldBuyAndHoldHistory);

        const comparisonData = [
            { ...r, name: r.strategy, cagr: r.absoluteCAGR, maxDD: r.maxDrawdown, recovery: r.recoveryTimeMonths, sharpe: r.sharpeRatio, sortino: r.sortinoRatio, calmar: r.calmarRatio, totalTax: r.totalTaxPaid },
            { name: equityBHLabel, cagr: cagrBH_Equity, rollingCAGRs: equityRolling, avgRollingCAGR: equityRollingVals.reduce((a,b) => a+b, 0) / (equityRollingVals.length || 1), maxDD: equityMaxDD.maxDrawdown, maxDDDate: equityMaxDD.maxDrawdownDate, recovery: strategy._calculateRecoveryTimeForHistory(strategy.equityBuyAndHoldHistory), ...equityBHRisk, totalSwitches: 0, winRate: 'N/A', profitFactor: 'N/A', averageWin: 'N/A', averageLoss: 'N/A', preTaxCorpus: equityBHData.length > 0 ? equityBHData[equityBHData.length-1] : 0, postTaxCorpus: equityBHData.length > 0 ? equityBHData[equityBHData.length-1] : 0, totalTax: 0, startingCapital: options.initialCapital },
            { name: 'Gold Buy & Hold', cagr: cagrBH_Gold, rollingCAGRs: goldRolling, avgRollingCAGR: goldRollingVals.reduce((a,b) => a+b, 0) / (goldRollingVals.length || 1), maxDD: goldMaxDD.maxDrawdown, maxDDDate: goldMaxDD.maxDrawdownDate, recovery: strategy._calculateRecoveryTimeForHistory(strategy.goldBuyAndHoldHistory), ...goldBHRisk, totalSwitches: 0, winRate: 'N/A', profitFactor: 'N/A', averageWin: 'N/A', averageLoss: 'N/A', preTaxCorpus: goldBHData.length > 0 ? goldBHData[goldBHData.length-1] : 0, postTaxCorpus: goldBHData.length > 0 ? goldBHData[goldBHData.length-1] : 0, totalTax: 0, startingCapital: options.initialCapital }
        ];

        updateMetricsTable(comparisonData);
        LazyCharts.register('perf', () => { updateMainChart(strategy.portfolioValueHistory, postTaxStrategyData, equityBHData, goldBHData, switchPoints, taxSwitchPoints, options, labels, equityBHLabel); });
        LazyCharts.register('withdrawal', () => { updateWithdrawalChart(corpusHistory, totalWithdrawalHistory); });

        const calculateAverages = (stats) => {
            if (stats.length === 0) return { avgReturn: 0, avgDD: 0 };
            const totalReturn = stats.reduce((sum, item) => sum + item.return, 0);
            const totalDD = stats.reduce((sum, item) => sum + item.maxDD, 0);
            return { avgReturn: totalReturn / stats.length, avgDD: totalDD / stats.length };
        };

        const strategyAvgs = calculateAverages(strategyYearlyStats);
        const equityAvgs = calculateAverages(equityYearlyStats);
        const goldAvgs = calculateAverages(goldYearlyStats);
        LazyCharts.register('calendar', () => { createYearlyPerformanceChart('yearlyPerfMomentum', 'Momentum Strategy', strategyYearlyStats, strategyAvgs.avgReturn, strategyAvgs.avgDD); });
        LazyCharts.register('calendar', () => { createYearlyPerformanceChart('yearlyPerfEquity', equityBHLabel, equityYearlyStats, equityAvgs.avgReturn, equityAvgs.avgDD); });
        LazyCharts.register('calendar', () => { createYearlyPerformanceChart('yearlyPerfGold', 'Gold Buy & Hold', goldYearlyStats, goldAvgs.avgReturn, goldAvgs.avgDD); });
        
        const strategyMonthlyStats = strategy._calculateMonthlyReturnsAndDD(strategy.portfolioValueHistory);
        const equityMonthlyStats = strategy._calculateMonthlyReturnsAndDD(strategy.equityBuyAndHoldHistory);
        const goldMonthlyStats = strategy._calculateMonthlyReturnsAndDD(strategy.goldBuyAndHoldHistory);
        const strategyMonthlyAvgs = calculateAverages(strategyMonthlyStats);
        const equityMonthlyAvgs = calculateAverages(equityMonthlyStats);
        const goldMonthlyAvgs = calculateAverages(goldMonthlyStats);
        LazyCharts.register('monthly', () => { createMonthlyPerformanceChart('monthlyPerfMomentum', 'Momentum Strategy', strategyMonthlyStats, strategyMonthlyAvgs.avgReturn, strategyMonthlyAvgs.avgDD); });
        LazyCharts.register('monthly', () => { createMonthlyPerformanceChart('monthlyPerfEquity', equityBHLabel, equityMonthlyStats, equityMonthlyAvgs.avgReturn, equityMonthlyAvgs.avgDD); });
        LazyCharts.register('monthly', () => { createMonthlyPerformanceChart('monthlyPerfGold', 'Gold Buy & Hold', goldMonthlyStats, goldMonthlyAvgs.avgReturn, goldMonthlyAvgs.avgDD); });

        LazyCharts.register('drawdown', () => { updateDrawdownChart(labels, strategyDrawdownSeries, equityDrawdownSeries, goldDrawdownSeries); });
        updateTradeLogTable(strategy.tradeLog);
        LazyCharts.register('dist', () => { updateTradeDistributionChart(strategy.tradeLog); });

        // Calculate Velocity of Wealth using Post-Tax History
        const velocityStats = strategy._calculateVelocityOfWealth(strategy.postTaxPortfolioValueHistory);

        // Render to the Table
        const vTableBody = document.querySelector('#velocity-wealth-table tbody');
        if (vTableBody) vTableBody.innerHTML = ''; // Clear previous

        [2, 3, 5, 10, 100].forEach(m => {
            // M5: guard missing stat (short range) — render N/A row, never throw before runId bump
            const stat = velocityStats[m] || { avg: '—', min: '—', max: '—', rate: '—' };
            const _cell = (v, suffix) => (v === undefined || v === null || v === '—' ? '—' : `${v}${suffix}`);
            if (!vTableBody) return;
            // CRIT-11: no innerHTML interpolation of stat values — build the
            // row and set textContent (same safe pattern as the export config).
            const tr = document.createElement('tr');
            const cells = [
                { text: `${m}x (Wealth Multiplier)`, strong: true },
                { text: _cell(stat.avg, ' Yrs') },
                { text: _cell(stat.min, ' Yrs'), style: 'color: #27ae60;' },
                { text: _cell(stat.max, ' Yrs'), style: 'color: #c0392b;' },
                { text: _cell(stat.rate, '%') }
            ];
            cells.forEach(c => {
                const td = document.createElement('td');
                if (c.style) td.style.cssText = c.style;
                if (c.strong) {
                    const b = document.createElement('strong');
                    b.textContent = c.text;
                    td.appendChild(b);
                } else {
                    td.textContent = c.text;
                }
                tr.appendChild(td);
            });
            vTableBody.appendChild(tr);
        });


        // ================= NEW TOOLS UPDATES =================
        const stratLen = strategy.portfolioValueHistory.length;
        const alignedFilteredData = filteredData.slice(-stratLen);
        // CRIT-12: plainData() before these reach any chart renderer.
        // alignedFilteredData is deliberately NOT wrapped — updateFourSeasons-
        // Chart / updateDowConfirmationChart look objects up by `date`, and a
        // JSON round-trip would break that identity.
        const benchVals = plainData(alignedFilteredData.map(d => d.BENCHMARK));
        const postTaxVals = plainData(strategy.postTaxPortfolioValueHistory.map(p => p.value));
        // const postTaxVals = strategy.portfolioValueHistory.map(p => p.value); // ==> use this if want to use pre-tax nav for the charts

        const dateVals = plainData(labels);
        // Need Gold Vals for certain charts
        const goldVals = plainData(alignedFilteredData.map(d => d.GOLD));


        updateDrawdownDragTables(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateRallyLagTables(dateVals, postTaxVals, benchVals);
        updateResilienceTables(dateVals, postTaxVals, benchVals);
        updateConsistencyMatrix(postTaxVals);
        // REMOVED-30 updateAdvancedConviction(dateVals, postTaxVals, benchVals);
       
       // 6. Market Cycle
        // REMOVED-30 updateUnitAccumulationChart(dateVals, postTaxVals);
        // REMOVED-30 updateRubberBandChart(dateVals, benchVals); // Market drop vs return
        // REMOVED-30 updateSmartSwitchChart(dateVals, benchVals, goldVals); // Eq/Gold Ratio

        // 7. Behavioral
        LazyCharts.register('s7', () => { updateOstrichChart(dateVals, postTaxVals); });
        // updateRollingCorrelationChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateBellCurveChart(dateVals, postTaxVals, benchVals);

        // 8. Efficiency
        // REMOVED-30 updateRollingSharpeChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateTimingLotteryChart(dateVals, postTaxVals, benchVals);
        LazyCharts.register('s8', () => { updateCaptureMapChart(dateVals, postTaxVals, benchVals); });

        // 9. Inst Risk
        // REMOVED-30 updateOmegaChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateCVaRChart(dateVals, postTaxVals, benchVals);
        updateHurdleTable(postTaxVals, benchVals);

        // 10. Deep Quant
        // REMOVED-30 updateMomentsTable(postTaxVals, benchVals);
        // REMOVED-30 updateHurstChart(postTaxVals);
        // REMOVED-30 updateTailRatioChart(postTaxVals, benchVals);

        // 11. Momentum Quality
        // REMOVED-30 updateTrendSmoothnessChart(dateVals, postTaxVals);
        // REMOVED-30 updateRegimeRadarChart(dateVals, benchVals, goldVals); // REFACTORED
        // REMOVED-30 updateBattingAvgChart(dateVals, postTaxVals);

        // 12. Indian Context
        // REMOVED-30 updateRealWealthChart(dateVals, postTaxVals);
        // REMOVED-30 updateCrorepatiTable(dateVals, postTaxVals);

        // 13. Inst Structure
        LazyCharts.register('s13', () => { updateEfficientFrontierChart(benchVals, goldVals, postTaxVals); }); // REFACTORED
        // REMOVED-30 updateHeatmapChart(dateVals, postTaxVals);
        LazyCharts.register('s13', () => { updateRollingVolChart(dateVals, postTaxVals); });

        // 14. FIRE
        // REMOVED-30 updateFireGaugeChart(postTaxVals);
        // REMOVED-30 updatePassiveBridgeChart(dateVals, postTaxVals);
        LazyCharts.register('s14', () => { updateStressTestChart(postTaxVals); });

        // 15. Fund Manager
        // REMOVED-30 updateRollingAlphaChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateCaptureRatiosChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateRelativeDrawdownChart(dateVals, postTaxVals, benchVals);

         // 16. Sage of Omaha
        LazyCharts.register('s16', () => { updateSnowballChart(dateVals, postTaxVals); });
        // REMOVED-30 updateMarginSafetyChart(dateVals, postTaxVals);
        // REMOVED-30 updateTenYearChart(dateVals, postTaxVals);

        // 17. Bridgewater
        LazyCharts.register('s17', () => { updateFourSeasonsChart(alignedFilteredData, postTaxVals); });
        // REMOVED-30 updateDalioRiskPremiumChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateDalioHolyGrailChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateDrawdownMathChart(dateVals, postTaxVals, benchVals);

        // 18. Magellan
        // REMOVED-30 updateTenbaggerChart(dateVals, postTaxVals);
        // REMOVED-30 updateMissedDaysChart(alignedFilteredData, postTaxVals);
        LazyCharts.register('s18', () => { updateLynchCategoryChart(dateVals, postTaxVals); });

        // 19. Cassandra
        LazyCharts.register('s19', () => { updateZScoreChart(dateVals, postTaxVals); });
        // REMOVED-30 updateLiquidityCrunchChart(dateVals, alignedFilteredData, postTaxVals);
        LazyCharts.register('s19', () => { updateUnderwaterChart(dateVals, postTaxVals); });

        // 20. Antifragile
        // REMOVED-30 updateConvexityChart(alignedFilteredData, dateVals, postTaxVals);
        // REMOVED-30 updateLeftTailChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateSigmaCounterChart(dateVals, postTaxVals);

        // 21. Speculator
        LazyCharts.register('s21', () => { updateResistanceLineChart(dateVals, postTaxVals); });
        LazyCharts.register('s21', () => { updateBreakoutStepChart(dateVals, postTaxVals); });
        // REMOVED-30 updateSittingMoneyChart(dateVals, postTaxVals);

        // 22. Adam Smith
        // REMOVED-30 updateProductivityChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateNaturalPriceChart(dateVals, postTaxVals);
        // REMOVED-30 updatePinFactoryChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateRentChart(dateVals, postTaxVals);

        // 23. Founding Father
        // REMOVED-30 updatePrincipalGainsChart(dateVals, postTaxVals, options.initialCapital);
        // REMOVED-30 updatePassiveWageChart(dateVals, postTaxVals);

        // 24. Medallion
        LazyCharts.register('s24', () => { updateSeasonalityChart(dateVals, postTaxVals); });
        LazyCharts.register('s24', () => { updateProbabilityConeChart(dateVals, postTaxVals); });
        LazyCharts.register('s24', () => { updateRegimeBarcodeChart(dateVals, postTaxVals); });
        // REMOVED-30 updateKellyChart(dateVals, postTaxVals);

        // 25. Quantum
        // REMOVED-30 updateVarianceDrainChart(dateVals, postTaxVals);
        // REMOVED-30 updateTailDependenceChart(alignedFilteredData, postTaxVals);


         // 26. Dow Theory
        // REMOVED-30 updateDowTideChart(dateVals, postTaxVals);
        LazyCharts.register('s26', () => { updateDowZigZagChart(dateVals, postTaxVals); });
        LazyCharts.register('s26', () => { updateDowConfirmationChart(dateVals, alignedFilteredData); });

        // 27. Vanguard
        // REMOVED-30 updateFeeErosionChart(dateVals, postTaxVals);
        LazyCharts.register('s27', () => { updateGravityLineChart(dateVals, postTaxVals); });
        LazyCharts.register('s27', () => { updateRecoveryHistogramChart(dateVals, postTaxVals); });

        // 28. Scuttlebutt
        LazyCharts.register('s28', () => { updateFisherChannelChart(dateVals, postTaxVals); });
        LazyCharts.register('s28', () => { updateFisherThesisChart(dateVals, postTaxVals); });
        LazyCharts.register('s28', () => { updateFisherQuietChart(dateVals, postTaxVals); });

        // 29. Contrarian
        // REMOVED-30 updatePessimismMap(dateVals, postTaxVals);
        LazyCharts.register('s29', () => { updateTempletonCycleChart(dateVals, postTaxVals); });
        LazyCharts.register('s29', () => { updateBargainOscillatorChart(dateVals, postTaxVals); });

        // 30. PTJ
        // updatePTJ200DayChart(dateVals, postTaxVals);
        // REMOVED-30 updatePTJPayoutChart(dateVals, postTaxVals);
        // REMOVED-30 updatePTJBreakoutChart(dateVals, postTaxVals);

        // 31. Druckenmiller
        // REMOVED-30 updateDruckGTPChart(dateVals, postTaxVals);
        LazyCharts.register('s31', () => { updateDruckHomeRunChart(postTaxVals); });
        // REMOVED-30 updateDruckSorosChart(dateVals, postTaxVals);
        // REMOVED-30 updateDruckStreakChart(dateVals, postTaxVals);

        // 32. T. Rowe Price
        // REMOVED-30 updateTRPHorizonChart(postTaxVals, benchVals);
        // REMOVED-30 updateTRPCharacteristicChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateTRPM2Chart(dateVals, postTaxVals, benchVals);

        // 33. Greenblatt
        // REMOVED-30 updateJGMagicFormulaChart(dateVals, postTaxVals);
        // REMOVED-30 updateJGDisciplineChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateJGYieldCostChart(dateVals, postTaxVals, options.initialCapital);

        // 34. Alok Jain
        // REMOVED-30 updateAJTrendFilterChart(dateVals, benchVals);
        // REMOVED-30 updateAJRotationChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateAJCashCallChart(dateVals, postTaxVals, alignedFilteredData);

        // 35. RRG
        LazyCharts.register('s35', () => {
            const rrgData = calculateRRGData(dateVals, postTaxVals, benchVals);
            updateRRGChart(rrgData);
            updateRRGHistoryChart(rrgData);
        });
        // REMOVED-30 updateRRGComponentsChart(rrgData);


        // 36. Goldman Sachs
        LazyCharts.register('s36', () => { updateGSBetaChart(dateVals, postTaxVals, benchVals); });
        LazyCharts.register('s36', () => { updateGSDistributionChart(postTaxVals, benchVals); });
        LazyCharts.register('s36', () => { updateGSPercentileChart(dateVals, postTaxVals, benchVals); });
        // REMOVED-30 updateGSInfoRatioChart(dateVals, postTaxVals, benchVals);

        // 37. Morgan Stanley
        // REMOVED-30 updateMSCompassChart(dateVals, postTaxVals);
        LazyCharts.register('s37', () => { updateMSMountainChart(dateVals, postTaxVals, benchVals); });
        // REMOVED-30 updateMSDownsideDevChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateMSHealthScoreChart(dateVals, postTaxVals);
        // REMOVED-30 updateMSPanicCorrChart(dateVals, postTaxVals, benchVals);

        // 38. World Bank
        // REMOVED-30 updateWBRealReturnChart(dateVals, postTaxVals, benchVals, options.yearlyInflation);
        // REMOVED-30 updateWBLorenzChart(postTaxVals, benchVals);
        // REMOVED-30 updateWBDevelopmentChart(dateVals, postTaxVals, benchVals);
        LazyCharts.register('s38', () => { updateWBCrisisRadarChart(dateVals, postTaxVals, benchVals); });
        // REMOVED-30 updateWBSovereignChart(dateVals, postTaxVals, benchVals);

        // 39. WEF
        LazyCharts.register('s39', () => { updateWEFRadarChart(dateVals, postTaxVals, benchVals); });
        // REMOVED-30 updateWEFRegimeChart(dateVals, postTaxVals);
        // REMOVED-30 updateWEFFragilityChart(postTaxVals, benchVals);
        // REMOVED-30 updateWEFLegacyChart(dateVals, postTaxVals);
        // REMOVED-30 updateWEFCouplingChart(dateVals, postTaxVals, benchVals);

         // 40. RBI (Updated VaR)
        // REMOVED-30 updateRBIRealRateChart(dateVals, postTaxVals, options.yearlyInflation);
        // REMOVED-30 updateRBISLRChart(dateVals, postTaxVals);
        // REMOVED-30 updateRBICurrencyChart(dateVals, postTaxVals, benchVals);
        LazyCharts.register('s40', () => { updateRBIStressChart(dateVals, postTaxVals, benchVals); });
        LazyCharts.register('s40', () => { updateRBIVaRChart(dateVals, postTaxVals, benchVals); });

        // 41. Fed
        // REMOVED-30 updateFedDotPlotChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateFedRStarChart(dateVals, postTaxVals, benchVals, options.yearlyInflation);
        LazyCharts.register('s41', () => { updateFedSoftLandingChart(postTaxVals, benchVals); });
        // REMOVED-30 updateFedTransitoryChart(dateVals, postTaxVals, benchVals);

        // 42. ADB (Updated Prosperity)
        // REMOVED-30 updateADBProsperityChart(dateVals, postTaxVals, benchVals, options.yearlyInflation);
        LazyCharts.register('s42', () => { updateADBInfraFloorChart(dateVals, postTaxVals, benchVals); });
        LazyCharts.register('s42', () => { updateADBSortinoChart(dateVals, postTaxVals, benchVals); });
        // REMOVED-30 updateADBCrisisBufferChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateADBSustainabilityChart(dateVals, postTaxVals, benchVals);

        // 43. S&P (Updated Ratings/Aristocrat/Drift)
        // REMOVED-30 updateSPCreditRatingChart(postTaxVals, benchVals);
        // REMOVED-30 updateSPIVAScorecardChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateSPAristocratChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateSPDriftChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateSPRiskControlChart(dateVals, postTaxVals, benchVals);

        // 44. Moody's (Updated Ratings)
        // REMOVED-30 updateMoodysDtDChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateMoodysELChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateMoodysRatingChart(dateVals, postTaxVals, benchVals);
        LazyCharts.register('s44', () => { updateMoodysScenarioChart(dateVals, postTaxVals, benchVals); });
        // REMOVED-30 updateMoodysRecoveryChart(dateVals, postTaxVals, benchVals);

        // 45. JPM (Already OK)
        // REMOVED-30 updateJPMRiskReturnChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateJPMYearlyBarChart(dateVals, postTaxVals, benchVals);
        LazyCharts.register('s45', () => { updateJPMCaptureChart(dateVals, postTaxVals, benchVals); });

         // 46. Morningstar
        // REMOVED-30 updateMSGrowth10kChart(dateVals, postTaxVals, benchVals);
        LazyCharts.register('s46', () => { updateMSMRARChart(dateVals, postTaxVals, benchVals); });
        // REMOVED-30 updateMSStyleBoxChart(dateVals, postTaxVals, benchVals);
        LazyCharts.register('s46', () => { updateMSRollingRangesChart(dateVals, postTaxVals, benchVals); });

        // 47. BofA
        // REMOVED-30 updateBofABullBearChart(postTaxVals, benchVals);
        // REMOVED-30 updateBofACashRuleChart(dateVals, postTaxVals, benchVals);
        // updateBofARotationChart(dateVals, alignedFilteredData);

        // 48. Verdict
        LazyCharts.register('s48', () => { updateVerdictCharts(dateVals, postTaxVals, benchVals); });

        // 49. Greed & Fear
        // REMOVED-30 updateGFRSIChart(dateVals, postTaxVals, benchVals);
        LazyCharts.register('s49', () => { updateGFDiscountChart(dateVals, postTaxVals, benchVals); });
        // REMOVED-30 updateGFBollingerChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateGFKnifeChart(dateVals, postTaxVals, benchVals);

        // 50. Jefferies
        // REMOVED-30 updateJefferiesWoodChart(dateVals, postTaxVals, benchVals, alignedFilteredData);
        // REMOVED-30 updateJefferiesJawsChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateJefferiesAccelerationChart(dateVals, postTaxVals, benchVals);

        // 51. Macquarie
        LazyCharts.register('s51', () => { updateMacAnnuityChart(postTaxVals, benchVals); });
        // REMOVED-30 updateMacInflationChart(dateVals, postTaxVals, benchVals, alignedFilteredData);
        // REMOVED-30 updateMacFloorChart(alignedFilteredData, postTaxVals, benchVals);

        // 52. Citi
        // REMOVED-30 updateCitiSurpriseChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateCitiBearChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateCitiClockChart(dateVals, postTaxVals, benchVals);

        // 53. BlackRock
        LazyCharts.register('s53', () => { updateBRFactorChart(dateVals, postTaxVals, benchVals); });
        // REMOVED-30 updateBRConeChart(dateVals, postTaxVals);
        // REMOVED-30 updateBRScenarioChart(alignedFilteredData, postTaxVals, benchVals);

        // 54. O'Neil
        // updateOneilRSChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateOneilRSLineChart(dateVals, postTaxVals, benchVals);

        // 55. Swensen
        // REMOVED-30 updateSwensenRebalBonusChart(dateVals, postTaxVals, benchVals);
        // REMOVED-30 updateSwensenFrontierPathChart(dateVals, postTaxVals, benchVals);

        // New run computed: stamp it, then paint only open sections.
        // Closed sections render lazily on expand (see js/lazy.js).
        AppState.runId += 1;
        AppState.ready = true;
        LazyCharts.renderOpen();
        // WARN-03/WARN-05: snapshot live instances now, so the resize handler
        // and updateAllChartThemes() don't have to re-walk the DOM.
        refreshChartRegistry();

    }

    // Pure transform: js/data.json → engine row shape. No DOM, unit-testable.
    // BENCHMARK mirrors the selected equity index (user decision); the JSON's
    // own "benchmark" key is deliberately ignored.
    function buildRows(json, equityKey) {
        const eq = json && json[equityKey];
        const gold = json && json.gold;
        if (!Array.isArray(eq) || eq.length < 3) throw new Error('data.json: missing or too-short series "' + equityKey + '"');
        if (!Array.isArray(gold) || gold.length < 3) throw new Error('data.json: missing or too-short series "gold"');
        if (eq.length !== gold.length) throw new Error('data.json: point-count mismatch between "' + equityKey + '" (' + eq.length + ') and "gold" (' + gold.length + ')');
        const dateMismatches = [];
        for (let i = 0; i < eq.length; i++) {
            if (!eq[i] || !gold[i]) throw new Error('data.json: malformed point at index ' + i);
            // Tolerate stray date-label drift by aligning on index and using
            // the equity date, but warn so a genuine misalignment stays visible.
            if (eq[i].date !== gold[i].date) dateMismatches.push(i + ' ("' + eq[i].date + '" vs "' + gold[i].date + '")');
        }
        if (dateMismatches.length) console.warn('[app] data.json: equity/gold date label mismatch at index ' + dateMismatches.join(', ') + ' — aligning by index, using equity dates');
        return eq.map((pt, i) => ({ date: pt.date, EQUITY: pt.nav, GOLD: gold[i].nav, BENCHMARK: pt.nav }));
    }

    async function loadDataJson() {
        const res = await fetch('../data.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        dataJson = await res.json();
    }

    function showDataErrorBanner(detail) {
        try {
            const old = document.getElementById('data-load-error');
            if (old) old.remove();
            const host = document.querySelector('.results');
            const banner = document.createElement('div');
            banner.id = 'data-load-error';
            banner.className = 'data-load-error-banner';
            // Same visual pattern as the echarts-missing banner (~line 590).
            banner.style.cssText = 'margin:0 0 12px;padding:10px 14px;border-radius:4px;background:#fdecea;color:#922b21;font-size:14px;';
            banner.textContent = 'Failed to load ../data.json — the page must be served over HTTP (e.g. python3 -m http.server). ' + detail;
            if (host) host.prepend(banner);
        } catch (e) {}
        console.warn('[app] data.json load failed:', detail);
    }

    function applyEquityIndex(key) {
        if (!EQUITY_INDEX_LABELS[key]) throw new Error('Unknown equity index: ' + key);
        data = buildRows(dataJson, key);
        AppState.equityIndex = key;
        document.title = 'Momentum Asset Switching (Post-Tax) — ' + EQUITY_INDEX_LABELS[key].name;
    }

    async function initDataDrivenUi() {
        let saved = null;
        try { saved = localStorage.getItem('equityIndex'); } catch (e) {}
        const key = (saved && EQUITY_INDEX_LABELS[saved]) ? saved : DEFAULT_EQUITY_INDEX;
        try {
            await loadDataJson();
            applyEquityIndex(key);
        } catch (err) {
            showDataErrorBanner(err && err.message ? err.message : String(err));
            return;
        }
        if (data.length < 3) {
            // Keep an "Insufficient Data" message in .results (textContent).
            const host = document.querySelector('.results');
            if (host) {
                host.innerHTML = '';
                const h3 = document.createElement('h3');
                h3.style.cssText = 'text-align:center; color:red; margin-top:50px;';
                h3.textContent = 'Error: Insufficient Data in ../data.json (need > 3 points).';
                host.appendChild(h3);
            }
            return;
        }
        const sel = document.getElementById('equityIndex');
        if (sel) { sel.value = key; sel.disabled = false; }
        populateDateDropdowns();
        AppState.dataReady = true;
        runBacktestAndRender();
    }

    function populateDateDropdowns() {
        const startDateSelect = document.getElementById('startDate');
        const endDateSelect = document.getElementById('endDate');
        startDateSelect.innerHTML = '';
        endDateSelect.innerHTML = '';
        const lookback = parseInt(document.getElementById('lookbackPeriod').value) || 3;
        for (let i = lookback; i < data.length; i++) {
            const option = document.createElement('option');
            option.value = data[i].date;
            option.textContent = data[i].date;
            startDateSelect.appendChild(option);
        }
        data.forEach(item => {
            const option = document.createElement('option');
            option.value = item.date;
            option.textContent = item.date;
            endDateSelect.appendChild(option);
        });
        startDateSelect.selectedIndex = 0;
        endDateSelect.selectedIndex = endDateSelect.options.length - 1;
    }

    function applyTheme(theme, skipRerun) {
        document.body.classList.toggle('dark-mode', theme === 'dark');
        // M3: local lookup + null guard — never throw if toggle button missing/reordered
        const _themeBtn = document.getElementById('theme-toggle');
        if (_themeBtn) _themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
        // Need to redraw charts for theme to apply fully — but only for user
        // toggles. Boot applies the theme BEFORE the single initial run, so it
        // must not schedule a second backtest (M2: was double run on every load).
        if (!skipRerun) setTimeout(runBacktestAndRender, 100);
    }
    // M3: defer binding until DOM ready + null-guard — bare global threw ReferenceError at eval time if provider failed/reordered
    document.addEventListener('DOMContentLoaded', () => {
        const _themeBtn = document.getElementById('theme-toggle');
        if (_themeBtn) _themeBtn.addEventListener('click', () => {
            const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
            try { localStorage.setItem('theme', newTheme); } catch (e) {}
            applyTheme(newTheme);
        });
    });

    // Minor: 'input' covers typing; 'change' covers keyboard/AT-driven
    // <select> commits that never fire 'input'. Split by element so a select
    // firing both events can't schedule a double backtest.
    document.querySelectorAll('input').forEach(input => input.addEventListener('input', runBacktestAndRender));
    document.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => {
        // equityIndex has its own listener below (it must rebuild rows first).
        if (sel.id === 'equityIndex') return;
        runBacktestAndRender();
    }));

    // Equity-index switch: rebuild rows from the cached JSON, then re-run.
    // Date dropdowns are deliberately NOT repopulated — all indices share
    // identical dates, and repopulating would reset the user's selected range.
    document.addEventListener('DOMContentLoaded', () => {
        const sel = document.getElementById('equityIndex');
        if (!sel) return;
        sel.addEventListener('change', (e) => {
            const key = e.target.value;
            if (!AppState.dataReady || !EQUITY_INDEX_LABELS[key]) return;
            try { localStorage.setItem('equityIndex', key); } catch (err) {}
            try { applyEquityIndex(key); } catch (err) { showDataErrorBanner(err.message); return; }
            runBacktestAndRender();
        });
    });

    function updateAllChartThemes(){ forEachLiveChart(c => { try { c.resize(); } catch (e) {} }); }
    // WARN-05: coalesce resize events into at most one pass per animation
    // frame — the handler used to fire on every mousemove pixel while dragging.
    let resizeRafPending = false;
    window.addEventListener('resize', () => {
        if (typeof echarts === 'undefined') return;
        if (resizeRafPending) return;
        resizeRafPending = true;
        requestAnimationFrame(() => {
            resizeRafPending = false;
            forEachLiveChart(c => { try { c.resize(); } catch (e) {} });
        });
    });

    // --- Initial Load ---
    document.addEventListener('DOMContentLoaded', () => {
        // M7: CDN failed — boot must still succeed (tables render); banner explains blank charts.
        if (typeof echarts === 'undefined') {
            try {
                const host = document.querySelector('.results');
                const banner = document.createElement('div');
                banner.className = 'echarts-missing-banner';
                banner.style.cssText = 'margin:0 0 12px;padding:10px 14px;border-radius:4px;background:#fef9e7;color:#7d6608;font-size:14px;';
                banner.textContent = '⚠️ Charts unavailable — chart library failed to load (offline or blocked CDN). Data tables below are unaffected; reload to retry charts.';
                if (host) host.prepend(banner);
            } catch (e) {}
            console.warn('[app] ECharts missing at boot — tables only');
            // CRIT-13: js/vendor-echarts.js inserts the CDN <script> dynamically,
            // so DOMContentLoaded no longer blocks on it. On a cold/slow network
            // the library can resolve *after* this boot render — recover instead
            // of leaving a stale "unavailable" banner over a working page.
            document.addEventListener('echarts-ready', () => {
                try {
                    document.querySelectorAll('.echarts-missing-banner').forEach(el => el.remove());
                } catch (e) {}
                runBacktestAndRender();
            });
        }
        // M2: single boot run — theme first (no re-run), then data load + one backtest.
        applyTheme(localStorage.getItem('theme') || (window.matchMedia("(prefers-color-scheme: dark)").matches ? 'dark' : 'light'), true);
        initDataDrivenUi();


        document.getElementById('export-pdf-btn').addEventListener('click', openExportDialog);
        document.getElementById('export-select-all')?.addEventListener('click', () => setAllExportChecks(true));
        document.getElementById('export-clear')?.addEventListener('click', () => setAllExportChecks(false));
        document.getElementById('export-confirm')?.addEventListener('click', runExportPrint);
        document.getElementById('export-cancel')?.addEventListener('click', closeExportDialog);
        document.getElementById('export-dialog')?.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'export-dialog') closeExportDialog();
        });

        // --- Selective PDF export: dialog → config table → hide unselected → print → restore ---
        function exportSections() {
            return Array.from(document.querySelectorAll('.results details.chart-group'));
        }
        function exportSectionLabel(details, idx) {
            const h3 = details.querySelector('summary h3');
            const txt = h3 ? h3.textContent.trim() : '';
            return txt || ('Section ' + (idx + 1));
        }
        function exportSectionKey(details, idx) {
            return (details.dataset && details.dataset.lazy) ? details.dataset.lazy : ('idx-' + idx);
        }
        function closeExportDialog() {
            const dlg = document.getElementById('export-dialog');
            if (!dlg) return;
            try {
                if (typeof dlg.close === 'function' && dlg.open) dlg.close();
                else dlg.removeAttribute('open');
            } catch (e) { dlg.removeAttribute('open'); }
        }
        function openExportDialog() {
            const dlg = document.getElementById('export-dialog');
            const list = document.getElementById('export-section-list');
            const warn = document.getElementById('export-dialog-warn');
            if (!dlg || !list) return;
            // One checkbox per details section, derived live from the DOM, all checked.
            list.innerHTML = '';
            exportSections().forEach((d, i) => {
                const row = document.createElement('label');
                row.className = 'export-dialog-row';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = true;
                cb.setAttribute('data-export-key', exportSectionKey(d, i));
                row.appendChild(cb);
                row.appendChild(document.createTextNode(' ' + exportSectionLabel(d, i)));
                list.appendChild(row);
            });
            const cfg = document.getElementById('export-include-configs');
            if (cfg) cfg.checked = true;
            if (warn) warn.textContent = '';
            // Native <dialog> preferred; plain [open] attribute as fallback.
            try {
                if (typeof dlg.showModal === 'function') dlg.showModal();
                else dlg.setAttribute('open', '');
            } catch (e) { dlg.setAttribute('open', ''); }
        }
        function setAllExportChecks(on) {
            document.querySelectorAll('#export-section-list input[type="checkbox"]').forEach(cb => { cb.checked = on; });
            const warn = document.getElementById('export-dialog-warn');
            if (warn) warn.textContent = '';
        }
        function exportVal(id) {
            const el = document.getElementById(id);
            if (!el || el.value === undefined || el.value === null) return '—';
            const v = String(el.value).trim();
            return v === '' ? '—' : v;
        }
        function buildExportConfigSummary() {
            const stale = document.getElementById('export-config-summary');
            if (stale) stale.remove();
            const rows = [
                ['Start Date', exportVal('startDate')],
                ['End Date', exportVal('endDate')],
                ['Equity Index', AppState.equityIndex ? EQUITY_INDEX_LABELS[AppState.equityIndex].name : '—'],
                ['Lookback Period (months)', exportVal('lookbackPeriod')],
                ['Initial Capital (₹)', exportVal('initialCapital')],
                ['Starting Asset', exportVal('startingAsset')],
                ['Min. Momentum Threshold (%)', exportVal('minMomentumThreshold')],
                ['Min. Momentum Divergence (%)', exportVal('minMomentumDivergence')],
                // CRIT-10 / WARN-14: both new sidebar inputs must appear here —
                // the PDF is the artifact a reader keeps, so an unlisted input
                // silently loses its provenance.
                ['Risk-Free Rate (%)', exportVal('riskFreeRate')],
                ['Transaction Cost per Switch (%)', exportVal('transactionCostPct')],
                ['Short-Term Tax Rate (%)', exportVal('shortTermTaxRate')],
                ['Long-Term Tax Rate (%)', exportVal('longTermTaxRate')],
                ['LTG Exemption Limit (₹)', exportVal('longTermExemptionLimit')],
                ['Withdrawal Initial Capital (₹)', exportVal('withdrawalInitialCapital')],
                ['Monthly Withdrawal (₹)', exportVal('monthlyWithdrawal')],
                ['Yearly Inflation (%)', exportVal('yearlyInflation')]
            ];
            const box = document.createElement('div');
            box.id = 'export-config-summary';
            const title = document.createElement('h3');
            title.textContent = 'Report Configuration';
            box.appendChild(title);
            const stamp = document.createElement('p');
            stamp.className = 'export-config-stamp';
            stamp.textContent = 'Generated: ' + new Date().toLocaleString();
            box.appendChild(stamp);
            const table = document.createElement('table');
            const tbody = document.createElement('tbody');
            rows.forEach(([k, v]) => {
                const tr = document.createElement('tr');
                const th = document.createElement('td');
                const b = document.createElement('strong');
                b.textContent = k;
                th.appendChild(b);
                const td = document.createElement('td');
                td.textContent = v;
                tr.appendChild(th);
                tr.appendChild(td);
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            box.appendChild(table);
            const host = document.querySelector('.results');
            if (host) host.prepend(box);
        }
        function runExportPrint() {
            const checked = Array.from(document.querySelectorAll('#export-section-list input[type="checkbox"]:checked'))
                .map(cb => cb.getAttribute('data-export-key'));
            if (checked.length === 0) {
                const warn = document.getElementById('export-dialog-warn');
                if (warn) warn.textContent = 'Select at least one section to export.';
                else alert('Select at least one section to export.');
                return; // abort — dialog stays open, page state untouched
            }
            const includeConfigs = document.getElementById('export-include-configs')?.checked !== false;
            const selected = new Set(checked);
            // Snapshot: theme, every details open state, stale artifacts.
            const wasDarkMode = document.body.classList.contains('dark-mode');
            const sections = exportSections();
            const openSnapshot = sections.map(d => ({ el: d, open: d.open }));
            closeExportDialog();
            const stale = document.getElementById('export-config-summary');
            if (stale) stale.remove();
            if (includeConfigs) buildExportConfigSummary();
            // Hide unselected, open all selected.
            sections.forEach((d, i) => {
                if (selected.has(exportSectionKey(d, i))) {
                    d.classList.remove('export-hidden');
                    d.open = true;
                } else {
                    d.classList.add('export-hidden');
                }
            });
            // Render newly opened sections, then force light mode for print.
            try {
                if (window.LazyCharts && typeof LazyCharts.renderOne === 'function') {
                    sections.forEach((d, i) => {
                        if (selected.has(exportSectionKey(d, i))) { try { LazyCharts.renderOne(d); } catch (e) {} }
                    });
                } else if (window.LazyCharts && typeof LazyCharts.renderAll === 'function') {
                    LazyCharts.renderAll();
                }
            } catch (e) {}
            if (wasDarkMode) {
                document.body.classList.remove('dark-mode');
                try { updateAllChartThemes(); } catch (e) {}
            }
            let restored = false;
            const restoreExportState = () => {
                if (restored) return;
                restored = true;
                try { window.removeEventListener('afterprint', restoreExportState); } catch (e) {}
                sections.forEach(d => { d.classList.remove('export-hidden'); });
                openSnapshot.forEach(({ el, open }) => { el.open = open; });
                const artifact = document.getElementById('export-config-summary');
                if (artifact) artifact.remove();
                if (wasDarkMode) document.body.classList.add('dark-mode');
                try { updateAllChartThemes(); } catch (e) {}
            };
            try { window.addEventListener('afterprint', restoreExportState); } catch (e) {}
            // Give ECharts a beat to lay out in the expanded view, then print.
            setTimeout(() => {
                // User picks "Save as PDF" in the native dialog.
                window.print();
                // afterprint covers async browsers; this covers blocking ones.
                setTimeout(restoreExportState, 500);
            }, 1000);
        }

    });
