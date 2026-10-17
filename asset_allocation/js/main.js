// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: entry point — state, init, calculateMetrics, renderVisualizations, wiring.
// Imports below; import graph is a DAG (no cycles).
import { STRATEGY_KEYS, buildMergedData } from './state.js';
import { calcMetrics, calculateDrawdown, calculateMonthlyReturns, calculateRollingCagrStats, calculateRollingReturns, calculateXIRR, calculateYearlyReturns, getMatrixColor, getMatrixTextColor, pearsonCorrelation } from './metrics.js';
import { runBacktest } from './engine.js';
import { getAssetStats, runBenchmarkSimulation } from './benchmark.js';
import { ASSET_COLORS, chartInstances, drawPerformanceLines, formatCurrency, getBaseChartOptions, initializeChart, updateAllChartThemes, updateFairValueChart, updateSpaghettiChart } from './charts-core.js';
import { renderCorrelationMatrix, updateCorrelatedDownturnsTable, updateCorrelatedUpturnsTable, updateGrowthDynamicSipTable, updateMasterLedger, updateRebalanceLogTable, updateValueDynamicSipTable, updateYearlyPerformanceTable, updateYoYPerformanceChart } from './tables.js';
import { updateAvgRollingReturnsChart, updateMoMPerformanceChart, updateQuarterlySection } from './quarterly.js';
import { updateCrashAnalysis } from './crash.js';
import { updateFearMonitorChart, updateValuationDotChart } from './valuation.js';
import { updateDeploymentBattle } from './deployment.js';
import { setRandomWalkData, setupRandomWalkControls } from './simulate.js';

// ddddddddddddddddddddd
let data = [];

// ===== Dynamic strategy state (Phase 1: data.json driven) =====
let rawJsonData = null;
let currentStrategy = "nseMidcap150Mom50";

// Merge selected equity NAVs with constant gold/benchmark by exact date-string match.
// Returns [{date, EQUITY, GOLD, BENCHMARK}] sorted by date (YYYY-MM-DD sorts lexicographically).
// Unknown/empty strategy key (placeholder with no rows yet) -> warns and returns [].
function calculateCorrelationMatrix(data) {
    if (data.length < 2) return { assets: [], matrix: [] };
    const assets = Object.keys(data[0]).filter(key => key !== 'date' && key !== 'BENCHMARK');
    const returns = {}; assets.forEach(asset => { returns[asset] = []; });
    for (let i = 1; i < data.length; i++) {
        assets.forEach(asset => {
            if (data[i - 1][asset] > 0) returns[asset].push(data[i][asset] / data[i - 1][asset] - 1);
            else returns[asset].push(0);
        });
    }
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const stdDev = (arr, avg) => Math.sqrt(arr.reduce((sq, n) => sq + Math.pow(n - avg, 2), 0) / (arr.length - 1));
    const matrix = [];
    for (let i = 0; i < assets.length; i++) {
        matrix[i] = [];
        for (let j = 0; j < assets.length; j++) {
            if (i === j) { matrix[i][j] = 1.0; continue; }
            const x = returns[assets[i]], y = returns[assets[j]], meanX = mean(x), meanY = mean(y), stdDevX = stdDev(x, meanX), stdDevY = stdDev(y, meanY);
            let covariance = 0; for (let k = 0; k < x.length; k++) covariance += (x[k] - meanX) * (y[k] - meanY);
            covariance /= (x.length - 1); matrix[i][j] = covariance / (stdDevX * stdDevY);
        }
    }
    return { assets, matrix };
}

document.addEventListener('DOMContentLoaded', async () => {
    // Phase 1: load data.json once (cached in rawJsonData; strategy switches reuse it, no re-fetch).
    try {
        const res = await fetch('../data.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        rawJsonData = await res.json();
    } catch (err) {
        console.error('[strategy] failed to load ../data.json — dashboard has no data', err);
    }
    // Expose future keys dropped into data.json as extra options (zero code change);
    // disable placeholder keys with no rows yet so they can't blank the dashboard.
    const strategySelect = document.getElementById('strategy-selector');
    if (strategySelect && rawJsonData) {
        Object.keys(rawJsonData).forEach(k => {
            if (k === 'gold' || k === 'benchmark' || STRATEGY_KEYS.includes(k)) return;
            const opt = document.createElement('option');
            opt.value = k; opt.textContent = k;
            strategySelect.appendChild(opt);
        });
        Array.from(strategySelect.options).forEach(o => {
            const rows = rawJsonData[o.value];
            if (!rows || rows.length === 0) { o.disabled = true; o.textContent += ' (data pending)'; }
        });
        currentStrategy = strategySelect.value;
    }
    data = buildMergedData(rawJsonData, currentStrategy);
    console.log(`[strategy] ${currentStrategy}:`, data.length, 'rows', data.slice(0, 3));
    const defaultInitialAllocations = { "EQUITY": 60, "GOLD": 40, "BOND": 0, "NASDAQ": 0 };
    let savedAllocations = [];
    let globalDates =[];
    let globalResults = {};
    let globalFilteredData =[];
    let timingSectionNeedsUpdate = true;
    let horizonSectionNeedsUpdate = true;
    let correlationSectionNeedsUpdate = true;
    let harvestSectionNeedsUpdate = true;
    let worstMonthsSectionNeedsUpdate = true;
    let returnDistSectionNeedsUpdate = true;
    
    let currentMetrics = {};
    let mcWorker = null;
    let comparisonData = {};
    const possibleAssets = data.length > 0 ? Object.keys(data[0]).filter(key => key !== 'date' && key !== 'BENCHMARK') : Object.keys(defaultInitialAllocations);
    const chartIds = [ 'equity-chart', 'corpus-chart-rebalanced', 'corpus-chart-no-rebalance', 'corpus-chart-benchmark', 'corpus-chart-equityonly', 'corpus-chart-goldonly', 'allocation-chart-rebalanced', 'allocation-chart-no-rebalance', 'yearly-returns-rebalanced', 'yearly-returns-no-rebalance', 'yearly-returns-benchmark', 'monthly-returns-rebalanced', 'monthly-returns-no-rebalance', 'monthly-returns-benchmark', 'drawdown-chart-rebalanced', 'drawdown-chart-no-rebalance', 'drawdown-chart-benchmark', 'rolling-returns-chart', 'rolling-returns-no-rebalance-chart', 'rolling-returns-benchmark-chart', 'risk-return-scatter-plot', 'mc-funnel-chart-rebalanced', 'mc-histogram-chart-rebalanced', 'mc-funnel-chart-no-rebalance', 'mc-histogram-chart-no-rebalance', 'yoy-rank-chart', 'mom-rank-chart' , 'yearly-path-equityonly', 'yearly-path-goldonly', 'fair-value-equityonly', 'fair-value-goldonly', 'yearly-returns-equityonly', 'yearly-returns-goldonly', 'monthly-returns-equityonly', 'monthly-returns-goldonly', 'drawdown-chart-equityonly', 'drawdown-chart-goldonly', 'rolling-returns-equityonly-chart', 'rolling-returns-goldonly-chart' ];
    chartIds.forEach(id => initializeChart(id));
    window.addEventListener('resize', () => { setTimeout(() => { Object.values(chartInstances).forEach(chart => { if (chart) chart.resize(); }); }, 200); });
    function generateAllocationInputs() {
        const container = document.getElementById('allocation-inputs');
        container.innerHTML = '';
        possibleAssets.forEach(asset => {
            const label = document.createElement('label'); label.htmlFor = `alloc-${asset}`; label.textContent = asset;
            const input = document.createElement('input'); input.type = 'number'; input.id = `alloc-${asset}`; input.dataset.asset = asset; input.value = defaultInitialAllocations[asset] || 0;
            container.appendChild(label); container.appendChild(input);
        });
    }
    function populateDateDropdowns() {
        const startDateSelect = document.getElementById('start-date'), endDateSelect = document.getElementById('end-date');
        startDateSelect.innerHTML = ''; endDateSelect.innerHTML = '';
        data.forEach((entry) => {
            const option = document.createElement('option');
            option.value = entry.date;
            option.textContent = new Date(entry.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
            startDateSelect.appendChild(option.cloneNode(true));
            endDateSelect.appendChild(option);
        });
        endDateSelect.selectedIndex = data.length - 1;
    }
    function updateRiskReturnChart() {
        const chart = chartInstances['risk-return-scatter-plot']; if (!chart) return;
        const savedData = savedAllocations.map(s => ({ value: [parseFloat(s.vol), parseFloat(s.cagr)], name: s.name }));
        const currentNoReb = { value: [parseFloat(currentMetrics.noReb?.Vol), parseFloat(currentMetrics.noReb?.CAGR)], name: 'Current No Rebalance' };
        const currentReb = { value: [parseFloat(currentMetrics.reb?.Vol), parseFloat(currentMetrics.reb?.CAGR)], name: 'Current Rebalance' }; const currentEqOnly = { value: [parseFloat(currentMetrics.equityOnly?.Vol), parseFloat(currentMetrics.equityOnly?.CAGR)], name: 'Equity Only' }; const currentGdOnly = { value: [parseFloat(currentMetrics.goldOnly?.Vol), parseFloat(currentMetrics.goldOnly?.CAGR)], name: 'Gold Only' };
        const option = { ...getBaseChartOptions(), title: { ...getBaseChartOptions().title, text: 'Risk vs. Return' }, xAxis: { ...getBaseChartOptions().xAxis, name: 'Volatility (%)', type: 'value', scale: true }, yAxis: { ...getBaseChartOptions().yAxis, name: 'CAGR (%)', type: 'value', axisLabel: { formatter: '{value}%' }, scale: true }, tooltip: { ...getBaseChartOptions().tooltip, trigger: 'item', formatter: params => { if(!params.data || !params.data.value) return ''; return `${params.data.name}<br/>CAGR: ${params.data.value[1].toFixed(2)}%<br/>Volatility: ${params.data.value[0].toFixed(2)}%`; } }, series: [ { name: 'Saved Allocations', type: 'scatter', data: savedData, itemStyle: { color: 'rgba(128, 128, 128, 0.7)' }, symbolSize: 10 }, { name: 'Current No Rebalance', type: 'scatter', data: [currentNoReb], itemStyle: { color: 'rgba(255, 99, 132, 1)' }, symbol: 'rect', symbolSize: 12 }, { name: 'Current Rebalance', type: 'scatter', data: [currentReb], itemStyle: { color: 'rgba(54, 162, 235, 1)' }, symbol: 'triangle', symbolSize: 12 }, { name: 'Equity Only', type: 'scatter', data: [currentEqOnly], itemStyle: { color: 'rgba(0, 100, 0, 1)' }, symbol: 'circle', symbolSize: 12 }, { name: 'Gold Only', type: 'scatter', data: [currentGdOnly], itemStyle: { color: 'rgba(218, 165, 32, 1)' }, symbol: 'diamond', symbolSize: 12 } ], dataZoom: null, toolbox: null, };
        chart.setOption(option);
    }
    function updateSavedAllocationsList() {
        const listContainer = document.getElementById('saved-allocations-list'); if (savedAllocations.length === 0) { listContainer.innerHTML = ''; return; }
        let html = '<h4>Saved Allocations:</h4><ul>';
        savedAllocations.forEach(s => { html += `<li><strong>${s.name}</strong> (CAGR: ${s.cagr}%, Vol: ${s.vol}%)<div style="font-size: 13px; font-family: 'Courier New', Courier, monospace; color: var(--label-color); margin-top: 5px;">Sharpe: ${s.sharpe} | Sortino: ${s.sortino} | Calmar: ${s.calmar}</div></li>`; });
        listContainer.innerHTML = html + '</ul>';
    }
    function calculateMetrics(mergedData) {
        // ---- purge previous run: no cross-contamination between strategies ----
        globalResults = {};
        globalFilteredData = [];
        globalDates = [];
        currentMetrics = {};
        timingSectionNeedsUpdate = true;
        horizonSectionNeedsUpdate = true;
        correlationSectionNeedsUpdate = true;
        harvestSectionNeedsUpdate = true;
        worstMonthsSectionNeedsUpdate = true;
        returnDistSectionNeedsUpdate = true;

        // ---- input snapshot (moved verbatim from updateChartAndTable) ----
            // 1. GET NEW WITHDRAWAL INPUTS
            const freqEl = document.querySelector('input[name="withdrawal-freq"]:checked');
            const withdrawalFreq = freqEl ? parseInt(freqEl.value) : 1;
            // 2. Get Strategy Mode
            const withdrawalStrategyMode = document.querySelector('input[name="withdrawal-strategy-mode"]:checked').value;
            // --- PARSE BUNKER CONFIG (Safe Fallbacks) ---
            // We use safe parsing (|| 0) to prevent crashes if elements aren't found
            const bunkerConfig = {
                initial: parseFloat(document.getElementById('bunker-initial')?.value) || 0,
                crashThreshold: parseFloat(document.getElementById('crash-threshold')?.value) || 20,
                enableRefill: document.getElementById('enable-bunker-refill')?.checked || false,
                cap: parseFloat(document.getElementById('bunker-cap')?.value) || 1000000,
                refillThreshold: parseFloat(document.getElementById('refill-threshold')?.value) || 2
            };

            const liquidReturnEl = document.getElementById('liquid-return');
            const liquidReturn = liquidReturnEl ? (parseFloat(liquidReturnEl.value) / 100) : 0.06;

            // --- PARSE GUYTON-KLINGER CONFIG (Safe Fallbacks) ---
            const gkConfig = {
                initialRate: parseFloat(document.getElementById('gk-initial-rate')?.value) || 5,
                upperThreshold: parseFloat(document.getElementById('gk-upper-threshold')?.value) || 6,
                lowerThreshold: parseFloat(document.getElementById('gk-lower-threshold')?.value) || 4,
                adjustmentMagnitude: parseFloat(document.getElementById('gk-adjustment-magnitude')?.value) || 10,
                bunkerRefillAmount: parseFloat(document.getElementById('gk-bunker-refill-amount')?.value) || 50000,
                enableFlexibility: document.getElementById('gk-enable-flexibility')?.checked ?? true
            };

            // 3. GET TAX INPUTS
            const taxStcgRate = parseFloat(document.getElementById('tax-stcg').value) / 100 || 0.20;
            const taxLtcgRate = parseFloat(document.getElementById('tax-ltcg').value) / 100 || 0.125;
            const taxExemptionLimit = parseFloat(document.getElementById('tax-exemption').value) || 125000;

        // ---- date-range filter on the PASSED dataset (was: module-global `data`) ----
            const startDateSelect = document.getElementById('start-date'), endDateSelect = document.getElementById('end-date');
            if (startDateSelect.selectedIndex > endDateSelect.selectedIndex) endDateSelect.selectedIndex = startDateSelect.selectedIndex;
            const startIndex = mergedData.findIndex(d => d.date === startDateSelect.value), endIndex = mergedData.findIndex(d => d.date === endDateSelect.value);
            const filteredData = mergedData.slice(startIndex, endIndex + 1);
        if (!filteredData || filteredData.length < 2) return null;

                const targetAlloc = {}; document.querySelectorAll('#allocation-inputs input').forEach(input => { targetAlloc[input.dataset.asset] = parseFloat(input.value) / 100 || 0; });
                
                const investmentMethod = document.querySelector('input[name="investment-method"]:checked').value;
                const useSip = investmentMethod === 'sip' || investmentMethod === 'valueDynamicSip' || investmentMethod === 'growthDynamicSip';
                
                const dynamicWithdrawalSettings = { downsideReturnThreshold: parseFloat(document.getElementById('downside-return-threshold').value)/100, downsideAdjustmentPct: parseFloat(document.getElementById('downside-adjustment-pct').value)/100, upsideReturnThreshold: parseFloat(document.getElementById('upside-return-threshold').value)/100, upsideAdjustmentPct: parseFloat(document.getElementById('upside-adjustment-pct').value)/100, proportionalShieldThreshold: parseFloat(document.getElementById('proportional-shield-threshold').value)/100, };
                const smartDriftTolerance = parseFloat(document.getElementById('smart-drift-tolerance')?.value) / 100 || 0.05;
                
                const commonOptions = {
                    investmentMethod,
                    useSip,
                    monthlySipAmount: parseFloat(document.getElementById('monthly-sip-amount').value),
                    sipDuration: parseInt(document.getElementById('sip-duration').value, 10),
                    lumpsumAmount: parseFloat(document.getElementById('lumpsum-amount').value),
                    monthlyWithdrawal: parseFloat(document.getElementById('monthly-withdrawal').value),
                    withdrawalDelayYears: parseFloat(document.getElementById('withdrawal-delay').value),
                    inflationRate: parseFloat(document.getElementById('inflation-rate').value) / 100,
                    withdrawalFreq: withdrawalFreq,
                    liquidReturn: liquidReturn,
                    taxStcgRate,
                    taxLtcgRate,
                    taxExemptionLimit,
                    // NEW: PASS THE BUNKER CONFIG HERE
                    withdrawalStrategy: withdrawalStrategyMode,
                    bunkerConfig: bunkerConfig,
                    smartDriftTolerance,
                    // NEW: PASS THE GUYTON-KLINGER CONFIG HERE
                    gkConfig
                };

            const rebalanceStrategy = document.querySelector('input[name="rebalance-strategy"]:checked').value;
            const momentumLookback = parseInt(document.getElementById('momentum-lookback').value, 10);
            const enableGoldTrendFilter = document.getElementById('gold-trend-filter').checked;
            
            const rebalanceThreshold = (parseFloat(document.getElementById('rebalance-threshold')?.value) || 0) / 100;

            const rebalanceOptions = { 
                withRebalance: true, 
                rebalanceFrequency: parseInt(document.getElementById('rebalance-frequency').value, 10),
                rebalanceThreshold,
                rebalanceStrategy,
                momentumLookback,
                enableGoldTrendFilter
            };
            
            const strategies = ['standard', 'dynamicThreshold', 'proportionalShield', 'guyton_klinger']; 
            const results = {};
            
            strategies.forEach(strat => { 
                const gkParams = (strat === 'guyton_klinger' && gkConfig) ? {
                    gkInitialRate: (gkConfig.initialRate || 5) / 100,
                    gkUpperThreshold: (gkConfig.upperThreshold || 6) / 100,
                    gkLowerThreshold: (gkConfig.lowerThreshold || 4) / 100,
                    gkAdjustmentMagnitude: (gkConfig.adjustmentMagnitude || 10) / 100,
                    gkBunkerRefillAmount: gkConfig.bunkerRefillAmount || 50000,
                    gkEnableFlexibility: gkConfig.enableFlexibility !== false
                } : {};
                results[strat] = { 
                    // REBALANCED
                    reb: runBacktest(filteredData, targetAlloc, { 
                        ...commonOptions, 
                        ...rebalanceOptions, 
                        // CRITICAL: We pass the calculation method separately from the "Smart" toggle
                        withdrawalCalcMethod: strat, 
                        useSmartDefense: (withdrawalStrategyMode === 'smart_rebalance'), 
                        dynamicWithdrawalSettings,
                        ...gkParams
                    }), 
                    
                    // NO REBALANCE
                    noReb: runBacktest(filteredData, targetAlloc, { 
                        ...commonOptions, 
                        withRebalance: false, 
                        withdrawalCalcMethod: strat, 
                        useSmartDefense: (withdrawalStrategyMode === 'smart_rebalance'),
                        dynamicWithdrawalSettings,
                        ...gkParams
                    }), 
                    
                    // BENCHMARK (Usually standard proportional)
                    benchmark: runBenchmarkSimulation(filteredData, {
                        ...commonOptions, 
                        withdrawalStrategy: strat, 
                        dynamicWithdrawalSettings,
                        ...gkParams
                    }),

                    // Phase 7: single-asset buy-and-hold legs (same shape as benchmark)
                    equityOnly: runBenchmarkSimulation(filteredData, {
                        ...commonOptions,
                        withdrawalStrategy: strat,
                        dynamicWithdrawalSettings,
                        ...gkParams,
                        asset: 'EQUITY'
                    }),
                    goldOnly: runBenchmarkSimulation(filteredData, {
                        ...commonOptions,
                        withdrawalStrategy: strat,
                        dynamicWithdrawalSettings,
                        ...gkParams,
                        asset: 'GOLD'
                    })
                }; 
            });


            const dates = filteredData.map(d => d.date);

        // ---- headline + rolling + with-withdrawal metrics (moved verbatim) ----
            const noRebMetrics = { ...calcMetrics(results.standard.noReb.historyWithoutWithdrawals, dates), Rebalances: results.standard.noReb.navRebalanceCount || 0 };
            const rebMetrics = { ...calcMetrics(results.standard.reb.historyWithoutWithdrawals, dates), Rebalances: results.standard.reb.navRebalanceCount };
            const benchmarkMetrics = calcMetrics(results.standard.benchmark.historyWithoutWithdrawals, dates);
            const equityOnlyMetrics = calcMetrics(results.standard.equityOnly.historyWithoutWithdrawals, dates);
            const goldOnlyMetrics = calcMetrics(results.standard.goldOnly.historyWithoutWithdrawals, dates);
            currentMetrics = { reb: rebMetrics, noReb: noRebMetrics, equityOnly: equityOnlyMetrics, goldOnly: goldOnlyMetrics };
            const periods = [1, 3, 5, 7, 10]; periods.forEach(p => { const noRebStats = calculateRollingCagrStats(results.standard.noReb.historyWithoutWithdrawals, p); noRebMetrics[`Avg Rolling CAGR (${p}Y)`] = noRebStats ? noRebStats.avg : 'N/A'; const rebStats = calculateRollingCagrStats(results.standard.reb.historyWithoutWithdrawals, p); rebMetrics[`Avg Rolling CAGR (${p}Y)`] = rebStats ? rebStats.avg : 'N/A'; const benchmarkStats = calculateRollingCagrStats(results.standard.benchmark.historyWithoutWithdrawals, p); benchmarkMetrics[`Avg Rolling CAGR (${p}Y)`] = benchmarkStats ? benchmarkStats.avg : 'N/A'; const eqOnlyStats = calculateRollingCagrStats(results.standard.equityOnly.historyWithoutWithdrawals, p); equityOnlyMetrics[`Avg Rolling CAGR (${p}Y)`] = eqOnlyStats ? eqOnlyStats.avg : 'N/A'; const gdOnlyStats = calculateRollingCagrStats(results.standard.goldOnly.historyWithoutWithdrawals, p); goldOnlyMetrics[`Avg Rolling CAGR (${p}Y)`] = gdOnlyStats ? gdOnlyStats.avg : 'N/A'; });
            const noRebMetricsWithWithdrawals = calcMetrics(results.standard.noReb.history, dates, results.standard.noReb.cashFlows);
            const rebMetricsWithWithdrawals = calcMetrics(results.standard.reb.history, dates, results.standard.reb.cashFlows);
            const benchmarkMetricsWithWithdrawals = calcMetrics(results.standard.benchmark.history, dates, results.standard.benchmark.cashFlows);
            const equityOnlyMetricsWithWithdrawals = calcMetrics(results.standard.equityOnly.history, dates, results.standard.equityOnly.cashFlows);
            const goldOnlyMetricsWithWithdrawals = calcMetrics(results.standard.goldOnly.history, dates, results.standard.goldOnly.cashFlows);

            // --- SAVE STATE FOR LAZY LOADING ---
            globalDates = dates;
            globalResults = results;
            timingSectionNeedsUpdate = true;
            globalFilteredData = filteredData;

        return { filteredData, dates, targetAlloc, results, commonOptions, useSip, withdrawalStrategyMode, gkConfig, noRebMetrics, rebMetrics, benchmarkMetrics, noRebMetricsWithWithdrawals, rebMetricsWithWithdrawals, benchmarkMetricsWithWithdrawals, equityOnlyMetrics, goldOnlyMetrics, equityOnlyMetricsWithWithdrawals, goldOnlyMetricsWithWithdrawals };
    }
    window.calculateMetrics = calculateMetrics; // console verification hook (Phase 2)

    // Phase 3: reusable render layer over the EXISTING ECharts setup. Takes the
    // calculateMetrics() bundle and pushes it into charts/tables via setOption —
    // instances are reused, never re-initialised (see initializeChart/getInstanceByDom).
    // Phase 5: section-visibility gate. Closed <details> sections are skipped
    // (rendered on first open via the toggle listener in init). Unknown id fails open.
    function isSectionOpen(id) {
        let el = document.getElementById(id);
        if (!el) return true;
        while (el) {
            if (el.tagName === 'DETAILS' && !el.open) return false;
            el = el.parentElement;
        }
        return true;
    }

    function renderVisualizations(calc) {
            const { filteredData, dates, targetAlloc, results, commonOptions, useSip, withdrawalStrategyMode, gkConfig, noRebMetrics, rebMetrics, benchmarkMetrics, noRebMetricsWithWithdrawals, rebMetricsWithWithdrawals, benchmarkMetricsWithWithdrawals, equityOnlyMetrics, goldOnlyMetrics, equityOnlyMetricsWithWithdrawals, goldOnlyMetricsWithWithdrawals } = calc;

            try {
            if (isSectionOpen('sec-asset-correlation-matrix')) {
                    renderCorrelationMatrix(calculateCorrelationMatrix(filteredData), 'correlation-matrix-container');
            }

            let performanceData = null, sortedYears = null;
            if (isSectionOpen('sec-year-on-year-asset-performance-table') || isSectionOpen('sec-year-on-year-asset-rank-chart')) {
                ({ performanceData, sortedYears } = updateYearlyPerformanceTable(filteredData, dates, targetAlloc, results.standard.reb, results.standard.noReb, results.standard.benchmark.historyWithoutWithdrawals, results.standard.equityOnly.historyWithoutWithdrawals, results.standard.goldOnly.historyWithoutWithdrawals));
            }
            if (isSectionOpen('sec-year-on-year-asset-rank-chart') && performanceData) updateYoYPerformanceChart(performanceData, sortedYears);
            
            if (isSectionOpen('sec-yearly-paths')) {
                updateSpaghettiChart('yearly-path-rebalanced', dates, results.standard.reb.historyWithoutWithdrawals, '#2980b9');
                updateSpaghettiChart('yearly-path-no-rebalance', dates, results.standard.noReb.historyWithoutWithdrawals, '#c0392b');
                updateSpaghettiChart('yearly-path-benchmark', dates, results.standard.benchmark.historyWithoutWithdrawals, '#34495e');
                updateSpaghettiChart('yearly-path-equityonly', dates, results.standard.equityOnly.historyWithoutWithdrawals, '#006400');
                updateSpaghettiChart('yearly-path-goldonly', dates, results.standard.goldOnly.historyWithoutWithdrawals, '#DAA520');
            }

            if (isSectionOpen('sec-quarterly-performance-heatmap')) {
                updateQuarterlySection(dates, results);
            }

            if (isSectionOpen('sec-month-on-month-asset-rank-chart')) {
                updateMoMPerformanceChart(filteredData, dates, targetAlloc, results.standard.reb, results.standard.noReb, results.standard.benchmark.historyWithoutWithdrawals, results.standard.equityOnly.historyWithoutWithdrawals, results.standard.goldOnly.historyWithoutWithdrawals);
            }

            if (isSectionOpen('sec-average-rolling-returns-1m-12m')) {
                updateAvgRollingReturnsChart(results.standard.reb, results.standard.noReb, results.standard.benchmark, results.standard.equityOnly, results.standard.goldOnly);
            }

            if (isSectionOpen('deployment-section')) {
                updateDeploymentBattle(dates, results.standard.reb);
            }

            if (isSectionOpen('crash-analysis-section')) {
                updateCrashAnalysis(dates, results);
            }

            if (isSectionOpen('sec-rebalancing-ledger-one-view')) {
                updateRebalanceLogTable(results.standard.reb.rebalanceEvents);
            }

            if (isSectionOpen('sec-fair-value-analysis')) {
                // Fair Value Band Charts (Vanguard Style)
                updateFairValueChart('fair-value-rebalanced', dates, results.standard.reb.historyWithoutWithdrawals, '#2980b9');
                updateFairValueChart('fair-value-no-rebalance', dates, results.standard.noReb.historyWithoutWithdrawals, '#c0392b');
                updateFairValueChart('fair-value-benchmark', dates, results.standard.benchmark.historyWithoutWithdrawals, '#34495e');
                updateFairValueChart('fair-value-equityonly', dates, results.standard.equityOnly.historyWithoutWithdrawals, '#006400');
                updateFairValueChart('fair-value-goldonly', dates, results.standard.goldOnly.historyWithoutWithdrawals, '#DAA520');
            }

            if (isSectionOpen('bunker-chart-section')) {
                if (withdrawalStrategyMode === 'smart_rebalance' || withdrawalStrategyMode === 'guyton_klinger') {
                    const activeRebResult = withdrawalStrategyMode === 'guyton_klinger' ? results.guyton_klinger.reb : results.standard.reb;
                    const bunkerData = activeRebResult.bunkerHistory;
                    const bunkerChart = echarts.getInstanceByDom(document.getElementById('bunker-balance-chart')) || echarts.init(document.getElementById('bunker-balance-chart'));
                
                    if (bunkerData && bunkerData.length > 0) {
                        const seriesData = bunkerData.map(d => [d.date, d.value]);
                    
                        const option = {
                            ...getBaseChartOptions(),
                            title: { text: 'Fortress (Bunker) Balance', left: 'center' },
                            tooltip: { trigger: 'axis', formatter: (p) => `${p[0].axisValueLabel}<br/>Cash: <b>${formatCurrency(p[0].value[1])}</b>` },
                            xAxis: { type: 'time' },
                            yAxis: { type: 'value', name: 'Amount (₹)', axisLabel: { formatter: (v) => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) } },
                            series: [{
                                name: 'Bunker Balance', type: 'line', data: seriesData, showSymbol: false,
                                lineStyle: { width: 3, color: '#f1c40f' },
                                areaStyle: { color: 'rgba(241, 196, 15, 0.2)' },
                                markLine: {
                                    data: [{ yAxis: bunkerConfig.cap, name: 'Cap' }],
                                    lineStyle: { color: '#e67e22', type: 'dashed' },
                                    label: { formatter: 'Cap', position: 'end' }
                                }
                            }]
                        };
                        bunkerChart.setOption(option);
                    
                        // Update Stats HTML
                        const monthsSurvived = activeRebResult.monthsSurvivedOnBunker || 0;
                        const currentBal = seriesData[seriesData.length-1][1];
                        document.getElementById('bunker-stats-summary').innerHTML = `
                            <div style="display:flex; justify-content:space-around; background:#fafafa; padding:10px; border-radius:6px; border:1px solid #eee;">
                                <div style="text-align:center;"><div style="font-size:12px; color:#666;">Crash Survival</div><div style="font-size:18px; font-weight:bold; color:#d35400;">${monthsSurvived} Months</div></div>
                                <div style="text-align:center;"><div style="font-size:12px; color:#666;">Current Fortress</div><div style="font-size:18px; font-weight:bold; color:${currentBal < 100000 ? 'red' : '#27ae60'}">${formatCurrency(currentBal)}</div></div>
                            </div>
                        `;
                    }

                    // Withdrawn stack
                    const breakdownData = activeRebResult.withdrawalBreakdown;
                    const breakdownChart = echarts.getInstanceByDom(document.getElementById('withdrawal-source-chart')) || echarts.init(document.getElementById('withdrawal-source-chart'));

                    if (breakdownData && breakdownData.length > 0) {
                        const dates = breakdownData.map(d => d.date);
                        const equityData = breakdownData.map(d => d.equity);
                        const goldData = breakdownData.map(d => d.gold);
                        const bunkerData = breakdownData.map(d => d.bunker);

                        const optionBreakdown = {
                            ...getBaseChartOptions(), // Inherit theme
                            title: { text: 'Withdrawal Sources', left: 'center', show: false }, // Hidden title to save space
                            tooltip: {
                                trigger: 'axis',
                                axisPointer: { type: 'shadow' },
                                formatter: (params) => {
                                    let total = 0;
                                    let html = `<b>${params[0].axisValueLabel}</b><br/>`;
                                    let equityAmt = 0, goldAmt = 0, bunkerAmt = 0;
                                
                                    // 1. Sum up totals and find amounts
                                    params.forEach(p => {
                                        total += p.value;
                                        if(p.seriesName === 'From Equity') equityAmt = p.value;
                                        if(p.seriesName === 'From Gold') goldAmt = p.value;
                                        if(p.seriesName === 'From Bunker') bunkerAmt = p.value;
                                    });

                                    // 2. Find Reason (using index from original data)
                                    const dataIndex = params[0].dataIndex;
                                    const reason = breakdownData[dataIndex].reason;

                                    // 3. Construct Tooltip
                                    html += `Total Withdrawn: <b>${formatCurrency(total)}</b><br/>`;
                                    html += `<div style="margin:5px 0; border-top:1px solid #eee; padding-top:5px; font-size:12px;">`;
                                
                                    if(equityAmt > 0) html += `<span style="color:#2ecc71">●</span> Equity: ${formatCurrency(equityAmt)} (${((equityAmt/total)*100).toFixed(0)}%)<br/>`;
                                    if(goldAmt > 0) html += `<span style="color:#f1c40f">●</span> Gold: ${formatCurrency(goldAmt)} (${((goldAmt/total)*100).toFixed(0)}%)<br/>`;
                                    if(bunkerAmt > 0) html += `<span style="color:#e74c3c">●</span> Bunker: ${formatCurrency(bunkerAmt)} (${((bunkerAmt/total)*100).toFixed(0)}%)<br/>`;
                                
                                    html += `</div>`;
                                    html += `<div style="margin-top:5px; font-style:italic; font-size:11px;">Logic: ${reason}</div>`;
                                
                                    return html;
                                }
                            },
                            legend: { data: ['From Equity', 'From Gold', 'From Bunker'], bottom: 0 },
                            xAxis: { type: 'category', data: dates },
                            yAxis: { 
                                type: 'value', 
                                name: 'Withdrawal (₹)',
                                axisLabel: { formatter: (v) => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) }
                            },
                            series: [
                                {
                                    name: 'From Equity',
                                    type: 'bar',
                                    stack: 'total',
                                    data: equityData,
                                    itemStyle: { color: '#27ae60' } // Green
                                },
                                {
                                    name: 'From Gold',
                                    type: 'bar',
                                    stack: 'total',
                                    data: goldData,
                                    itemStyle: { color: '#f1c40f' } // Gold
                                },
                                {
                                    name: 'From Bunker',
                                    type: 'bar',
                                    stack: 'total',
                                    data: bunkerData,
                                    itemStyle: { color: '#e74c3c' } // Red (Crisis money)
                                }
                            ],
                            grid: { top: 30, right: 30, bottom: 40, left: 60 }
                        };
                    
                        breakdownChart.setOption(optionBreakdown);
                    }
                }
            }

            if (isSectionOpen('gk-guardrail-chart-section')) {
                if (withdrawalStrategyMode === 'guyton_klinger') {
                    const gkResult = results.guyton_klinger.reb;
                    const guardrailData = gkResult.gkGuardrailHistory || [];
                    const guardrailChart = echarts.getInstanceByDom(document.getElementById('gk-guardrail-chart')) || echarts.init(document.getElementById('gk-guardrail-chart'));

                    if (guardrailData.length > 0) {
                        const seriesData = guardrailData.map(d => [d.date, d.rate]);
                        const upperVal = guardrailData[0].upper;
                        const lowerVal = guardrailData[0].lower;
                        const initialVal = guardrailData[0].initial;

                        const option = {
                            ...getBaseChartOptions(),
                            title: { text: 'Withdrawal Rate vs Guardrails (%)', left: 'center' },
                            tooltip: {
                                trigger: 'axis',
                                formatter: (p) => {
                                    const d = guardrailData[p[0].dataIndex];
                                    let html = `<b>${p[0].axisValueLabel}</b><br/>`;
                                    p.forEach(s => {
                                        if (s.seriesName === 'Actual Withdrawal Rate') html += `<span style="color:#7b1fa2">●</span> ${s.seriesName}: <b>${s.value[1].toFixed(2)}%</b> (₹${new Intl.NumberFormat('en-IN').format(Math.round(d.annualAmount))}/yr)<br/>`;
                                        else html += `<span style="color:${s.color}">●</span> ${s.seriesName}: ${s.value[1].toFixed(1)}%<br/>`;
                                    });
                                    return html;
                                }
                            },
                            legend: { top: 35 },
                            xAxis: { type: 'time' },
                            yAxis: { type: 'value', name: 'Rate (%)', scale: true },
                            series: [
                                {
                                    name: 'Actual Withdrawal Rate', type: 'line', data: seriesData, showSymbol: false,
                                    lineStyle: { width: 3, color: '#7b1fa2' },
                                    areaStyle: { color: 'rgba(123, 31, 162, 0.1)' }
                                },
                                {
                                    name: 'Upper Guardrail', type: 'line', data: guardrailData.map(d => [d.date, upperVal]), showSymbol: false,
                                    lineStyle: { color: '#e74c3c', type: 'dashed', width: 2 },
                                    markLine: {
                                        silent: true, symbol: 'none',
                                        lineStyle: { color: '#e74c3c', type: 'dashed' },
                                        label: { formatter: `Upper ${upperVal.toFixed(1)}%`, position: 'insideEndTop' },
                                        data: [{ yAxis: upperVal }]
                                    }
                                },
                                {
                                    name: 'Lower Guardrail', type: 'line', data: guardrailData.map(d => [d.date, lowerVal]), showSymbol: false,
                                    lineStyle: { color: '#27ae60', type: 'dashed', width: 2 },
                                    markLine: {
                                        silent: true, symbol: 'none',
                                        lineStyle: { color: '#27ae60', type: 'dashed' },
                                        label: { formatter: `Lower ${lowerVal.toFixed(1)}%`, position: 'insideEndBottom' },
                                        data: [{ yAxis: lowerVal }]
                                    }
                                },
                                {
                                    name: 'Initial Rate', type: 'line', data: guardrailData.map(d => [d.date, initialVal]), showSymbol: false,
                                    lineStyle: { color: '#3498db', type: 'dotted', width: 2 }
                                }
                            ],
                            grid: { top: 70, right: 40, bottom: 40, left: 60 }
                        };
                        guardrailChart.setOption(option);

                        // Stats summary
                        let maxRate = -Infinity, minRate = Infinity, maxRateDate = '', minRateDate = '', adjustmentCount = 0;
                        let prevAnnualAmount = guardrailData[0].annualAmount;
                        guardrailData.forEach(d => {
                            if (d.rate > maxRate) { maxRate = d.rate; maxRateDate = d.date; }
                            if (d.rate < minRate) { minRate = d.rate; minRateDate = d.date; }
                            if (Math.abs(d.annualAmount - prevAnnualAmount) > 0.01 && d.annualAmount !== prevAnnualAmount) adjustmentCount++;
                            prevAnnualAmount = d.annualAmount;
                        });
                        const first = guardrailData[0];
                        const last = guardrailData[guardrailData.length - 1];
                        document.getElementById('gk-guardrail-stats').innerHTML = `
                            <h4 style="margin-bottom:10px;">Guardrail Statistics</h4>
                            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:10px;">
                                <div style="background:#faf5ff; border:1px solid #e0d4f0; border-radius:8px; padding:10px; text-align:center;">
                                    <div style="font-size:12px; color:#666;">Start Rate</div>
                                    <div style="font-size:18px; font-weight:bold; color:#7b1fa2;">${first.rate.toFixed(2)}%</div>
                                    <div style="font-size:11px; color:#888;">₹${new Intl.NumberFormat('en-IN').format(Math.round(first.annualAmount))}/yr</div>
                                </div>
                                <div style="background:#faf5ff; border:1px solid #e0d4f0; border-radius:8px; padding:10px; text-align:center;">
                                    <div style="font-size:12px; color:#666;">Latest Rate</div>
                                    <div style="font-size:18px; font-weight:bold; color:#7b1fa2;">${last.rate.toFixed(2)}%</div>
                                    <div style="font-size:11px; color:#888;">₹${new Intl.NumberFormat('en-IN').format(Math.round(last.annualAmount))}/yr</div>
                                </div>
                                <div style="background:#fdf0f0; border:1px solid #f0d4d4; border-radius:8px; padding:10px; text-align:center;">
                                    <div style="font-size:12px; color:#666;">Highest Rate</div>
                                    <div style="font-size:18px; font-weight:bold; color:#e74c3c;">${maxRate.toFixed(2)}%</div>
                                    <div style="font-size:11px; color:#888;">${new Date(maxRateDate).toLocaleDateString('en-IN', {month:'short', year:'numeric'})}</div>
                                </div>
                                <div style="background:#f0fdf4; border:1px solid #d4f0dc; border-radius:8px; padding:10px; text-align:center;">
                                    <div style="font-size:12px; color:#666;">Lowest Rate</div>
                                    <div style="font-size:18px; font-weight:bold; color:#27ae60;">${minRate.toFixed(2)}%</div>
                                    <div style="font-size:11px; color:#888;">${new Date(minRateDate).toLocaleDateString('en-IN', {month:'short', year:'numeric'})}</div>
                                </div>
                                <div style="background:#fff8e1; border:1px solid #f0e4b0; border-radius:8px; padding:10px; text-align:center;">
                                    <div style="font-size:12px; color:#666;">Guardrail Adjustments</div>
                                    <div style="font-size:18px; font-weight:bold; color:#e67e22;">${adjustmentCount}</div>
                                    <div style="font-size:11px; color:#888;">annual ±${(gkConfig.adjustmentMagnitude*100).toFixed(0)}% changes</div>
                                </div>
                                <div style="background:#eaf6fd; border:1px solid #d0e8f5; border-radius:8px; padding:10px; text-align:center;">
                                    <div style="font-size:12px; color:#666;">Upper / Lower Bands</div>
                                    <div style="font-size:18px; font-weight:bold; color:#2980b9;">${first.upper.toFixed(1)}% / ${first.lower.toFixed(1)}%</div>
                                    <div style="font-size:11px; color:#888;">initially ${first.initial.toFixed(1)}%</div>
                                </div>
                            </div>
                        `;
                    }
            }
            }

            if (isSectionOpen('sec-strategy-comparison')) {
                const useLogScale = document.getElementById('log-scale-toggle').checked;
                // Phase 6: standalone buy-and-hold lines, rebased to the portfolio's own
                // starting value so they share the scale of the other series.
                const rebBase = results.standard.reb.historyWithoutWithdrawals[0];
                const eqBase = filteredData[0].EQUITY, gdBase = filteredData[0].GOLD;
                const equityOnly = (eqBase > 0) ? filteredData.map((d, i) => [dates[i], d.EQUITY / eqBase * rebBase]) : [];
                const goldOnly = (gdBase > 0) ? filteredData.map((d, i) => [dates[i], d.GOLD / gdBase * rebBase]) : [];
                const mainChartSeries = [
                    { name: 'No Rebalance', type: 'line', showSymbol: false, data: results.standard.noReb.historyWithoutWithdrawals.map((val, i) => [dates[i], val]), itemStyle: { color: 'rgb(255, 99, 132)' } },
                    { name: 'Periodic Rebalance', type: 'line', showSymbol: false, data: results.standard.reb.historyWithoutWithdrawals.map((val, i) => [dates[i], val]), itemStyle: { color: 'rgb(54, 162, 235)' } },
                    { name: 'Benchmark', type: 'line', showSymbol: false, data: results.standard.benchmark.historyWithoutWithdrawals.map((val, i) => [dates[i], val]), itemStyle: { color: 'rgb(156, 156, 156)' } },
                    { name: 'Equity Only', type: 'line', showSymbol: false, data: equityOnly, itemStyle: { color: ASSET_COLORS.EQUITY } },
                    { name: 'Gold Only', type: 'line', showSymbol: false, data: goldOnly, itemStyle: { color: ASSET_COLORS.GOLD } },
                    { name: 'Rebalance Event', type: 'scatter', symbolSize: 8, itemStyle: { color: 'red' }, data: results.standard.reb.rebalanceEvents.map(e => ({ value: [e.date, e.y] })) }
                ];

                if (useSip) {
                    mainChartSeries.push({
                        name: 'Cumulative Investment', type: 'line', showSymbol: false, lineStyle: { type: 'dashed' },
                        data: results.standard.reb.cumulativeInvestment.map((val, i) => [dates[i], val]),
                        itemStyle: { color: '#2ecc71' }
                    });
                }
            
                chartInstances['equity-chart'].setOption({
                    title: { text: 'Strategy Comparison' },
                    tooltip: { formatter: (params) => { let txt = `${params[0].axisValueLabel}<br/>`; params.forEach(p => { if (p.seriesName !== 'Rebalance Event') txt += `${p.marker} ${p.seriesName}: ${formatCurrency(p.value[1])}<br/>`; }); return txt; } },
                    xAxis: { type: 'time' },
                    yAxis: { type: useLogScale ? 'log' : 'value', logBase: 10, axisLabel: { formatter: (v) => new Intl.NumberFormat('en-IN', { notation: 'compact', compactDisplay: 'short' }).format(v) } },
                    series: mainChartSeries.filter(s => s)
                });
            }
            
            if (isSectionOpen('sec-allocation-drift-stacked')) {
                const activeAssets = Object.keys(targetAlloc).filter(k => targetAlloc[k] > 0);
                const allocationTooltipFormatter = (p) => { let txt = `${p[0].axisValueLabel}<br/>`, total = 0; p.forEach(item => { total += item.value[1]; txt += `${item.marker} ${item.seriesName}: ${item.value[1].toFixed(2)}%<br/>`; }); txt += `<b>Total: ${total.toFixed(2)}%</b>`; return txt; };
                chartInstances['allocation-chart-rebalanced'].setOption({ title: { text: 'Rebalanced Allocation' }, tooltip: { formatter: allocationTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { min: 0, max: 100, axisLabel: { formatter: '{value}%' } }, series: activeAssets.map(asset => ({ name: asset, type: 'line', stack: 'total', areaStyle: {}, showSymbol: false, data: results.standard.reb.allocationHistory.map(h => [h.date, h[asset]]), color: ASSET_COLORS[asset] || ASSET_COLORS.default })) });
                chartInstances['allocation-chart-no-rebalance'].setOption({ title: { text: 'Non-Rebalanced Allocation' }, tooltip: { formatter: allocationTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { min: 0, max: 100, axisLabel: { formatter: '{value}%' } }, series: activeAssets.map(asset => ({ name: asset, type: 'line', stack: 'total', areaStyle: {}, showSymbol: false, data: results.standard.noReb.allocationHistory.map(h => [h.date, h[asset]]), color: ASSET_COLORS[asset] || ASSET_COLORS.default })) });
            }

            if (isSectionOpen('sec-withdrawal-charts')) {
                const corpusYAxisFormatter = v => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0, notation: 'compact' }).format(v);
                const corpusTooltipFormatter = (p) => { let txt = `${p[0].axisValueLabel}<br/>`; p.forEach(item => { txt += `${item.marker} ${item.seriesName}: ${formatCurrency(item.value[1])}<br/>`; }); return txt; };
                const chartConfigs = [ { id: 'corpus-chart-rebalanced', title: 'Corpus Simulation (With Rebalancing)', dataKey: 'reb' }, { id: 'corpus-chart-no-rebalance', title: 'Corpus Simulation (Without Rebalancing)', dataKey: 'noReb' }, { id: 'corpus-chart-benchmark', title: 'Corpus Simulation (Benchmark)', dataKey: 'benchmark' }, { id: 'corpus-chart-equityonly', title: 'Corpus Simulation (Equity Only)', dataKey: 'equityOnly' }, { id: 'corpus-chart-goldonly', title: 'Corpus Simulation (Gold Only)', dataKey: 'goldOnly' } ];
                chartConfigs.forEach(config => { chartInstances[config.id].setOption({ title: { text: config.title }, tooltip: { formatter: corpusTooltipFormatter }, legend: { top: 35 }, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: corpusYAxisFormatter } }, series: [ { name: 'Corpus w/o Withdrawals', type: 'line', showSymbol: false, lineStyle: { type: 'dashed', color: 'rgb(128, 128, 128)' }, data: results.standard[config.dataKey].historyWithoutWithdrawals.map((d, i) => [dates[i], d]) }, { name: 'Standard - Corpus', type: 'line', showSymbol: false, data: results.standard[config.dataKey].history.map((d, i) => [dates[i], d]), itemStyle: { color: 'rgb(255, 99, 132)' } }, { name: 'Standard - Total Withdrawn', type: 'line', showSymbol: false, data: results.standard[config.dataKey].cumulativeWithdrawals.map((d, i) => [dates[i], d]), itemStyle: { color: 'rgb(204, 79, 105)' } }, { name: 'Dyn. Threshold - Corpus', type: 'line', showSymbol: false, data: results.dynamicThreshold[config.dataKey].history.map((d, i) => [dates[i], d]), itemStyle: { color: 'rgb(54, 162, 235)' } }, { name: 'Dyn. Threshold - Total Withdrawn', type: 'line', showSymbol: false, data: results.dynamicThreshold[config.dataKey].cumulativeWithdrawals.map((d, i) => [dates[i], d]), itemStyle: { color: 'rgb(153, 102, 255)' } }, { name: 'Prop. Shield - Corpus', type: 'line', showSymbol: false, data: results.proportionalShield[config.dataKey].history.map((d, i) => [dates[i], d]), itemStyle: { color: 'rgb(75, 192, 192)' } }, { name: 'Prop. Shield - Total Withdrawn', type: 'line', showSymbol: false, data: results.proportionalShield[config.dataKey].cumulativeWithdrawals.map((d, i) => [dates[i], d]), itemStyle: { color: 'rgb(46, 139, 87)' } }, { name: 'Guyton-Klinger - Corpus', type: 'line', showSymbol: false, data: results.guyton_klinger[config.dataKey].history.map((d, i) => [dates[i], d]), itemStyle: { color: 'rgb(186, 85, 211)' } }, { name: 'Guyton-Klinger - Total Withdrawn', type: 'line', showSymbol: false, data: results.guyton_klinger[config.dataKey].cumulativeWithdrawals.map((d, i) => [dates[i], d]), itemStyle: { color: 'rgb(138, 43, 226)' } } ] }); });
            }
            
            const percentTooltipFormatter = (p) => { let txt = `${p[0].axisValueLabel}<br/>`; p.forEach(item => { txt += `${item.marker} ${item.seriesName}: ${item.value[1].toFixed(2)}%<br/>`; }); return txt; };
            if (isSectionOpen('sec-yearly-returns')) {

                const yearlyTooltipFormatter = (p) => { let txt = `${p[0].axisValueLabel}<br/>`; p.forEach(param => { txt += `${param.marker} ${param.seriesName}: ${param.value.toFixed(2)}%<br/>`; }); return txt; };
                const yrReb = calculateYearlyReturns(results.standard.reb.historyWithoutWithdrawals, dates); chartInstances['yearly-returns-rebalanced'].setOption({ title: { text: 'Rebalanced Strategy - Yearly Returns' }, tooltip: { formatter: yearlyTooltipFormatter }, xAxis: { type: 'category', data: yrReb.labels }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [ { name: 'Yearly Return', type: 'bar', data: yrReb.data, itemStyle: { color: 'lightblue' }, markLine: { data: [{ type: 'average', name: 'Avg' }], lineStyle: { color: 'red' } } }, { name: 'Max Yearly Drawdown', type: 'bar', data: yrReb.drawdowns, itemStyle: { color: 'rgba(255, 99, 132, 0.7)' } } ] });
                const yrNoReb = calculateYearlyReturns(results.standard.noReb.historyWithoutWithdrawals, dates); chartInstances['yearly-returns-no-rebalance'].setOption({ title: { text: 'Non-Rebalanced Strategy - Yearly Returns' }, tooltip: { formatter: yearlyTooltipFormatter }, xAxis: { type: 'category', data: yrNoReb.labels }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [ { name: 'Yearly Return', type: 'bar', data: yrNoReb.data, itemStyle: { color: 'lightcoral' }, markLine: { data: [{ type: 'average', name: 'Avg' }], lineStyle: { color: 'red' } } }, { name: 'Max Yearly Drawdown', type: 'bar', data: yrNoReb.drawdowns, itemStyle: { color: 'rgba(255, 99, 132, 0.7)' } } ] });
                const yrBenchmark = calculateYearlyReturns(results.standard.benchmark.historyWithoutWithdrawals, dates); chartInstances['yearly-returns-benchmark'].setOption({ title: { text: 'Benchmark - Yearly Returns' }, tooltip: { formatter: yearlyTooltipFormatter }, xAxis: { type: 'category', data: yrBenchmark.labels }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [ { name: 'Yearly Return', type: 'bar', data: yrBenchmark.data, itemStyle: { color: 'lightgrey' }, markLine: { data: [{ type: 'average', name: 'Avg' }], lineStyle: { color: 'red' } } }, { name: 'Max Yearly Drawdown', type: 'bar', data: yrBenchmark.drawdowns, itemStyle: { color: 'rgba(255, 99, 132, 0.7)' } } ] });
                const yrEqOnly = calculateYearlyReturns(results.standard.equityOnly.historyWithoutWithdrawals, dates); chartInstances['yearly-returns-equityonly'].setOption({ title: { text: 'Equity Only - Yearly Returns' }, tooltip: { formatter: yearlyTooltipFormatter }, xAxis: { type: 'category', data: yrEqOnly.labels }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [ { name: 'Yearly Return', type: 'bar', data: yrEqOnly.data, itemStyle: { color: 'lightgreen' }, markLine: { data: [{ type: 'average', name: 'Avg' }], lineStyle: { color: 'red' } } }, { name: 'Max Yearly Drawdown', type: 'bar', data: yrEqOnly.drawdowns, itemStyle: { color: 'rgba(255, 99, 132, 0.7)' } } ] });
                const yrGdOnly = calculateYearlyReturns(results.standard.goldOnly.historyWithoutWithdrawals, dates); chartInstances['yearly-returns-goldonly'].setOption({ title: { text: 'Gold Only - Yearly Returns' }, tooltip: { formatter: yearlyTooltipFormatter }, xAxis: { type: 'category', data: yrGdOnly.labels }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [ { name: 'Yearly Return', type: 'bar', data: yrGdOnly.data, itemStyle: { color: 'gold' }, markLine: { data: [{ type: 'average', name: 'Avg' }], lineStyle: { color: 'red' } } }, { name: 'Max Yearly Drawdown', type: 'bar', data: yrGdOnly.drawdowns, itemStyle: { color: 'rgba(255, 99, 132, 0.7)' } } ] });
            }
            
            if (isSectionOpen('sec-monthly-returns')) {
                const monthlyTooltipFormatter = (p) => `${p[0].seriesName}: ${p[0].value[1].toFixed(2)}%`;
                const mrReb = calculateMonthlyReturns(results.standard.reb.historyWithoutWithdrawals, dates); chartInstances['monthly-returns-rebalanced'].setOption({ title: { text: 'Rebalanced Strategy - Monthly Returns' }, tooltip: { formatter: monthlyTooltipFormatter}, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Monthly Return', type: 'bar', data: mrReb, itemStyle: { color: 'lightblue' }, markLine: { data: [{ type: 'average', name: 'Avg' }], lineStyle: { color: 'red' } } }] });
                const mrNoReb = calculateMonthlyReturns(results.standard.noReb.historyWithoutWithdrawals, dates); chartInstances['monthly-returns-no-rebalance'].setOption({ title: { text: 'Non-Rebalanced Strategy - Monthly Returns' }, tooltip: { formatter: monthlyTooltipFormatter}, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Monthly Return', type: 'bar', data: mrNoReb, itemStyle: { color: 'lightcoral' }, markLine: { data: [{ type: 'average', name: 'Avg' }], lineStyle: { color: 'red' } } }] });
                const mrBenchmark = calculateMonthlyReturns(results.standard.benchmark.historyWithoutWithdrawals, dates); chartInstances['monthly-returns-benchmark'].setOption({ title: { text: 'Benchmark - Monthly Returns' }, tooltip: { formatter: monthlyTooltipFormatter}, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Monthly Return', type: 'bar', data: mrBenchmark, itemStyle: { color: 'lightgrey' }, markLine: { data: [{ type: 'average', name: 'Avg' }], lineStyle: { color: 'red' } } }] });
                const mrEqOnly = calculateMonthlyReturns(results.standard.equityOnly.historyWithoutWithdrawals, dates); chartInstances['monthly-returns-equityonly'].setOption({ title: { text: 'Equity Only - Monthly Returns' }, tooltip: { formatter: monthlyTooltipFormatter}, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Monthly Return', type: 'bar', data: mrEqOnly, itemStyle: { color: 'lightgreen' }, markLine: { data: [{ type: 'average', name: 'Avg' }], lineStyle: { color: 'red' } } }] });
                const mrGdOnly = calculateMonthlyReturns(results.standard.goldOnly.historyWithoutWithdrawals, dates); chartInstances['monthly-returns-goldonly'].setOption({ title: { text: 'Gold Only - Monthly Returns' }, tooltip: { formatter: monthlyTooltipFormatter}, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Monthly Return', type: 'bar', data: mrGdOnly, itemStyle: { color: 'gold' }, markLine: { data: [{ type: 'average', name: 'Avg' }], lineStyle: { color: 'red' } } }] });
            }

            if (isSectionOpen('sec-underwater-drawdown-chart')) {
                const drawdownTooltipFormatter = p => `Drawdown: ${p[0].value[1].toFixed(2)}%<br/>Months to recover: ${p[0].data.monthsInDrawdown}`;
                const ddReb = calculateDrawdown(results.standard.reb.historyWithoutWithdrawals, dates); chartInstances['drawdown-chart-rebalanced'].setOption({ title: { text: 'Rebalanced Strategy - Drawdown' }, tooltip: { formatter: drawdownTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Drawdown', type: 'line', data: ddReb, showSymbol: false, areaStyle: {}, itemStyle: { color: 'rgb(54, 162, 235)'} }] });
                const ddNoReb = calculateDrawdown(results.standard.noReb.historyWithoutWithdrawals, dates); chartInstances['drawdown-chart-no-rebalance'].setOption({ title: { text: 'Non-Rebalanced Strategy - Drawdown' }, tooltip: { formatter: drawdownTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Drawdown', type: 'line', data: ddNoReb, showSymbol: false, areaStyle: {}, itemStyle: { color: 'rgb(255, 99, 132)'} }] });
                const ddBenchmark = calculateDrawdown(results.standard.benchmark.historyWithoutWithdrawals, dates); chartInstances['drawdown-chart-benchmark'].setOption({ title: { text: 'Benchmark - Drawdown' }, tooltip: { formatter: drawdownTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Drawdown', type: 'line', data: ddBenchmark, showSymbol: false, areaStyle: {}, itemStyle: { color: 'rgb(156, 156, 156)'} }] });
                const ddEqOnly = calculateDrawdown(results.standard.equityOnly.historyWithoutWithdrawals, dates); chartInstances['drawdown-chart-equityonly'].setOption({ title: { text: 'Equity Only - Drawdown' }, tooltip: { formatter: drawdownTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Drawdown', type: 'line', data: ddEqOnly, showSymbol: false, areaStyle: {}, itemStyle: { color: 'rgb(0, 100, 0)'} }] });
                const ddGdOnly = calculateDrawdown(results.standard.goldOnly.historyWithoutWithdrawals, dates); chartInstances['drawdown-chart-goldonly'].setOption({ title: { text: 'Gold Only - Drawdown' }, tooltip: { formatter: drawdownTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: [{ name: 'Drawdown', type: 'line', data: ddGdOnly, showSymbol: false, areaStyle: {}, itemStyle: { color: 'rgb(218, 165, 32)'} }] });
            }

            const rollingPeriods = [1, 3, 5, 7, 10, 15];
            if (isSectionOpen('sec-rolling-returns-rebalanced-strategy')) {
                chartInstances['rolling-returns-chart'].setOption({ title: { text: 'Rolling Returns (Rebalanced Strategy)' }, tooltip: { formatter: percentTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: calculateRollingReturns(results.standard.reb.historyWithoutWithdrawals, dates, rollingPeriods) });
            }
            if (isSectionOpen('sec-rolling-returns-non-rebalanced-strategy')) {
                chartInstances['rolling-returns-no-rebalance-chart'].setOption({ title: { text: 'Rolling Returns (Non-Rebalanced Strategy)' }, tooltip: { formatter: percentTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: calculateRollingReturns(results.standard.noReb.historyWithoutWithdrawals, dates, rollingPeriods) });
            }
            if (isSectionOpen('sec-rolling-returns-benchmark')) {
                chartInstances['rolling-returns-benchmark-chart'].setOption({ title: { text: 'Rolling Returns (Benchmark)' }, tooltip: { formatter: percentTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: calculateRollingReturns(results.standard.benchmark.historyWithoutWithdrawals, dates, rollingPeriods) });
            }
            if (isSectionOpen('sec-rolling-returns-equity-only')) {
                chartInstances['rolling-returns-equityonly-chart'].setOption({ title: { text: 'Rolling Returns (Equity Only)' }, tooltip: { formatter: percentTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: calculateRollingReturns(results.standard.equityOnly.historyWithoutWithdrawals, dates, rollingPeriods) });
            }
            if (isSectionOpen('sec-rolling-returns-gold-only')) {
                chartInstances['rolling-returns-goldonly-chart'].setOption({ title: { text: 'Rolling Returns (Gold Only)' }, tooltip: { formatter: percentTooltipFormatter }, xAxis: { type: 'time' }, yAxis: { axisLabel: { formatter: '{value}%' } }, series: calculateRollingReturns(results.standard.goldOnly.historyWithoutWithdrawals, dates, rollingPeriods) });
            }

            if (isSectionOpen('sec-risk-vs-return-scatter-plot')) {
                updateRiskReturnChart();
            }
            
            if (isSectionOpen('sec-perfomance-metrics-without-withdrawals') || isSectionOpen('sec-performance-metrics-with-withdrawals')) {
                const periods = [1, 3, 5, 7, 10]; periods.forEach(p => { const noRebStats = calculateRollingCagrStats(results.standard.noReb.historyWithoutWithdrawals, p); noRebMetrics[`Avg Rolling CAGR (${p}Y)`] = noRebStats ? noRebStats.avg : 'N/A'; const rebStats = calculateRollingCagrStats(results.standard.reb.historyWithoutWithdrawals, p); rebMetrics[`Avg Rolling CAGR (${p}Y)`] = rebStats ? rebStats.avg : 'N/A'; const benchmarkStats = calculateRollingCagrStats(results.standard.benchmark.historyWithoutWithdrawals, p); benchmarkMetrics[`Avg Rolling CAGR (${p}Y)`] = benchmarkStats ? benchmarkStats.avg : 'N/A'; const eqOnlyStats = calculateRollingCagrStats(results.standard.equityOnly.historyWithoutWithdrawals, p); equityOnlyMetrics[`Avg Rolling CAGR (${p}Y)`] = eqOnlyStats ? eqOnlyStats.avg : 'N/A'; const gdOnlyStats = calculateRollingCagrStats(results.standard.goldOnly.historyWithoutWithdrawals, p); goldOnlyMetrics[`Avg Rolling CAGR (${p}Y)`] = gdOnlyStats ? gdOnlyStats.avg : 'N/A'; });
            }

            const higherIsBetterMetrics = new Set(['Absolute Return', 'CAGR', 'Sharpe', 'Sortino', 'Calmar', 'PositiveMonths', 'Max Consecutive + Months', 'Avg Positive Month', 'Gain/Loss Ratio', 'Avg Rolling CAGR (1Y)', 'Avg Rolling CAGR (3Y)', 'Avg Rolling CAGR (5Y)', 'Avg Rolling CAGR (7Y)', 'Avg Rolling CAGR (10Y)']);
            const lowerIsBetterMetrics = new Set(['MaxDD', 'Vol', 'NegativeMonths', 'Max Consecutive - Months', 'Avg Negative Month', 'Rebalances', 'Time To Recovery(MaxDD)', 'Average Time To recovery', 'Average Drawdown %']);
            const parseMetricValue = (v) => { if (typeof v !== 'string' && typeof v !== 'number') return null; const s = String(v); if (s.toLowerCase().includes('n/a') || s.toLowerCase().includes('not')) return null; const match = s.match(/(-?\d+\.?\d*)/); if (match) return parseFloat(match[0]); return null; };
            const metricKeys = [ "Absolute Return", "CAGR", "MaxDD", "MaxDDDate", "Time To Recovery(MaxDD)", "Average Drawdown %", "Average Time To recovery", "Vol", "Sharpe", "Sortino", "Calmar", "PositiveMonths", "NegativeMonths", "Max Consecutive + Months", "Max Consecutive - Months", "Avg Positive Month", "Avg Negative Month", "Gain/Loss Ratio", "Avg Rolling CAGR (1Y)", "Avg Rolling CAGR (3Y)", "Avg Rolling CAGR (5Y)", "Avg Rolling CAGR (7Y)", "Avg Rolling CAGR (10Y)", "Rebalances" ];
            const metricKeysWithWithdrawals = [ "Absolute XIRR", "MaxDD", "MaxDDDate", "Time To Recovery(MaxDD)", "Average Drawdown %", "Average Time To recovery", "Vol", "Sharpe", "Sortino", "Calmar", "PositiveMonths", "NegativeMonths", "Max Consecutive + Months", "Max Consecutive - Months", "Avg Positive Month", "Avg Negative Month", "Gain/Loss Ratio", "Avg Rolling CAGR (1Y)", "Avg Rolling CAGR (3Y)", "Avg Rolling CAGR (5Y)", "Avg Rolling CAGR (7Y)", "Avg Rolling CAGR (10Y)", "Rebalances" ];

            if (isSectionOpen('sec-perfomance-metrics-without-withdrawals')) {

                let tableBodyHtml = metricKeys.map(key => {
                    let noRebClass = '', rebClass = '';
                    const noRebVal = parseMetricValue(noRebMetrics[key]), rebVal = parseMetricValue(rebMetrics[key]);
                    if (noRebVal !== null && rebVal !== null && Math.abs(noRebVal - rebVal) > 1e-6) {
                        if (higherIsBetterMetrics.has(key)) { if (noRebVal > rebVal) { noRebClass = 'better'; rebClass = 'worse'; } else { rebClass = 'better'; noRebClass = 'worse'; } }
                        else if (lowerIsBetterMetrics.has(key)) { if (key === 'MaxDD' || key === 'Avg Negative Month' || key === 'Average Drawdown %') { if (noRebVal > rebVal) { noRebClass = 'better'; rebClass = 'worse'; } else { rebClass = 'better'; noRebClass = 'worse'; } } else { if (noRebVal < rebVal) { noRebClass = 'better'; rebClass = 'worse'; } else { rebClass = 'better'; noRebClass = 'worse'; } } }
                    }
                    return `<tr><td><strong>${key}</strong></td><td class="${noRebClass}">${noRebMetrics[key] ?? 'N/A'}</td><td class="${rebClass}">${rebMetrics[key] ?? 'N/A'}</td><td>${key === 'Rebalances' ? 'N/A' : (benchmarkMetrics[key] ?? 'N/A')}</td><td>${key === 'Rebalances' ? 'N/A' : (equityOnlyMetrics[key] ?? 'N/A')}</td><td>${key === 'Rebalances' ? 'N/A' : (goldOnlyMetrics[key] ?? 'N/A')}</td></tr>`;
                }).join('');


                const totalTaxPaid = results.standard.reb.totalTaxPaid || 0;
                const fmt = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);

                // Append Tax Row
                tableBodyHtml += `
                    <tr style="border-top: 2px solid #eee;">
                        <td><strong>Total Tax Paid (Real-Time)</strong></td>
                        <td>-</td>
                        <td style="color:#c0392b; font-weight:bold;">${fmt(totalTaxPaid)}</td>
                        <td>-</td>
                        <td>-</td>
                        <td>-</td>
                    </tr>
                `;

                if (results.standard.reb.bunkerBurnMonths > 0) {
                    tableBodyHtml += `
                    <tr style="background-color: #fff3cd;">
                        <td><strong>🔥 Bunker Burn Months (Survival)</strong></td>
                        <td>-</td>
                        <td style="font-weight:bold; color:#d35400;">${results.standard.reb.bunkerBurnMonths} Months</td>
                        <td>-</td>
                        <td>-</td>
                        <td>-</td>
                    </tr>
                    `;
                }

                document.querySelector("#metrics-table tbody").innerHTML = tableBodyHtml;
            }
            
            if (isSectionOpen('sec-performance-metrics-with-withdrawals')) {
                const tableBodyHtmlWithWithdrawals = metricKeysWithWithdrawals.map(key => {
                    if (key === 'Rebalances') return ''; let noRebClass = '', rebClass = '';
                    const noRebVal = parseMetricValue(noRebMetricsWithWithdrawals[key]), rebVal = parseMetricValue(rebMetricsWithWithdrawals[key]);
                    if (noRebVal !== null && rebVal !== null && Math.abs(noRebVal - rebVal) > 1e-6) {
                        if (higherIsBetterMetrics.has(key)) { if (noRebVal > rebVal) { noRebClass = 'better'; rebClass = 'worse'; } else { rebClass = 'better'; noRebClass = 'worse'; } }
                        else if (lowerIsBetterMetrics.has(key)) { if (key === 'MaxDD' || key === 'Avg Negative Month' || key === 'Average Drawdown %') { if (noRebVal > rebVal) { noRebClass = 'better'; rebClass = 'worse'; } else { rebClass = 'better'; noRebClass = 'worse'; } } else { if (noRebVal < rebVal) { noRebClass = 'better'; rebClass = 'worse'; } else { rebClass = 'better'; noRebClass = 'worse'; } } }
                    }
                    return `<tr><td><strong>${key}</strong></td><td class="${noRebClass}">${noRebMetricsWithWithdrawals[key] ?? 'N/A'}</td><td class="${rebClass}">${rebMetricsWithWithdrawals[key] ?? 'N/A'}</td><td>${benchmarkMetricsWithWithdrawals[key] ?? 'N/A'}</td><td>${equityOnlyMetricsWithWithdrawals[key] ?? 'N/A'}</td><td>${goldOnlyMetricsWithWithdrawals[key] ?? 'N/A'}</td></tr>`;
                }).join('');
                document.querySelector("#metrics-table-with-withdrawals tbody").innerHTML = tableBodyHtmlWithWithdrawals;
            }

            if (isSectionOpen('dynamic-sip-analysis-container')) {
                updateValueDynamicSipTable(results.standard.reb.dynamicSipLog, commonOptions.monthlySipAmount);
            }
            if (isSectionOpen('growth-dynamic-sip-analysis-container')) {
                updateGrowthDynamicSipTable(results.standard.reb.growthSipLog, commonOptions.monthlySipAmount);
            }
            if (isSectionOpen('sec-analysis-of-simultaneous-equity-gold-decline')) {
                updateCorrelatedDownturnsTable(filteredData, dates, results.standard.reb);
            }
            if (isSectionOpen('sec-analysis-of-simultaneous-equity-gold-advance')) {
                updateCorrelatedUpturnsTable(filteredData, dates, results.standard.reb);
            }
           
            if (isSectionOpen('sec-valuation-dot-plot')) {
                // Valuation Dot Plot (Vanguard Style)
                updateValuationDotChart(dates, results);
            }

            if (isSectionOpen('sec-the-fear-monitor-vix-proxy')) {
                // FEAR MONITOR
                updateFearMonitorChart(dates, results);
            }

            if (isSectionOpen('sec-master-transaction-ledger')) {
                // Get the ledger from the result
                const masterLedger = results.standard.reb.masterLedger;
                // Render
                updateMasterLedger(masterLedger, targetAlloc);
            }


            // Phase 2: state purged + persisted inside calculateMetrics().

            // If the section is already open, update it immediately
            const timingSection = document.getElementById('timing-dilemma-section');
            if (timingSection && timingSection.open) {
                renderTimingDilemma();
            }

            // If the Horizon section is already open, update it immediately
            horizonSectionNeedsUpdate = true;
            const horizonSection = document.getElementById('horizon-matrix-section');
            if (horizonSection && horizonSection.open) {
                renderHorizonMatrix();
            }

            correlationSectionNeedsUpdate = true;
            const corrSection = document.getElementById('correlation-charts-section');
            if (corrSection && corrSection.open) {
                renderCorrelationCharts();
            }

            // If Harvest section is open, update it
            harvestSectionNeedsUpdate = true;
            const harvestSection = document.getElementById('harvest-charts-section');
            if (harvestSection && harvestSection.open) {
                renderHarvestSection();
            }

            // If Worst-Months section is open, update it
            worstMonthsSectionNeedsUpdate = true;
            const worstMonthsSection = document.getElementById('worst-months-section');
            if (worstMonthsSection && worstMonthsSection.open) {
                renderWorstMonths();
            }

            // If Return-Distribution section is open, update it
            returnDistSectionNeedsUpdate = true;
            const returnDistSection = document.getElementById('return-dist-section');
            if (returnDistSection && returnDistSection.open) {
                renderReturnDist();
            }
            
        } catch (e) { console.error("Error updating charts:", e); }
    }
    window.renderVisualizations = renderVisualizations; // console verification hook (Phase 5)

    function updateChartAndTable() {

            // 2. Get Strategy Mode
            const withdrawalStrategyMode = document.querySelector('input[name="withdrawal-strategy-mode"]:checked').value;
            
            // --- UI VISIBILITY LOGIC ---
            const bunkerPanel = document.getElementById('bunker-config-panel');
            const bunkerChartSection = document.getElementById('bunker-chart-section');
            const gkPanel = document.getElementById('gk-config-panel');
            const gkGuardrailSection = document.getElementById('gk-guardrail-chart-section');
            
            if(withdrawalStrategyMode === 'smart_rebalance' || withdrawalStrategyMode === 'guyton_klinger') {
                if(bunkerPanel) bunkerPanel.style.display = 'block';
                if(bunkerChartSection) bunkerChartSection.style.display = 'block';
            } else {
                if(bunkerPanel) bunkerPanel.style.display = 'none';
                if(bunkerChartSection) bunkerChartSection.style.display = 'none';
            }

            if(withdrawalStrategyMode === 'guyton_klinger') {
                if(gkPanel) gkPanel.style.display = 'block';
                if(gkGuardrailSection) gkGuardrailSection.style.display = 'block';
            } else {
                if(gkPanel) gkPanel.style.display = 'none';
                if(gkGuardrailSection) gkGuardrailSection.style.display = 'none';
            }

            // Phase 3 chain: Data Select -> Merge -> Recalculate -> Re-render.
            const calc = calculateMetrics(data);
            if (!calc) {
                chartInstances['equity-chart'].clear();
                return;
            }
            setRandomWalkData(calc.results.standard.reb.historyWithoutWithdrawals);
            renderVisualizations(calc);
    }

    const themeToggle = document.getElementById('theme-toggle');
    function applyTheme(theme) { document.body.classList.toggle('dark-mode', theme === 'dark'); themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙'; setTimeout(updateAllChartThemes, 50); }
    themeToggle.addEventListener('click', () => { const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark'; localStorage.setItem('theme', newTheme); applyTheme(newTheme); });
    const savedTheme = localStorage.getItem('theme') || (window.matchMedia("(prefers-color-scheme: dark)").matches ? 'dark' : 'light');
    
    document.getElementById('save-allocation-btn').addEventListener('click', () => {
        const targetAlloc = {}; let allocName = [];
        document.querySelectorAll('#allocation-inputs input').forEach(input => { const val = parseFloat(input.value) || 0; if (val > 0) { targetAlloc[input.dataset.asset] = val / 100; allocName.push(`${input.dataset.asset.substring(0,3)}:${val}`); } });
        const rebMetrics = currentMetrics.reb;
        if (!rebMetrics || !rebMetrics.CAGR || rebMetrics.CAGR === 'N/A') { alert("Cannot save an allocation with invalid metrics."); return; }
        savedAllocations.push({ name: allocName.join('|'), cagr: rebMetrics.CAGR.replace('%',''), vol: rebMetrics.Vol.replace('%',''), sharpe: rebMetrics.Sharpe || 'N/A', sortino: rebMetrics.Sortino || 'N/A', calmar: rebMetrics.Calmar || 'N/A', allocation: targetAlloc });
        updateRiskReturnChart(); updateSavedAllocationsList();
    });
    document.getElementById('clear-saved-btn').addEventListener('click', () => { savedAllocations = []; updateRiskReturnChart(); updateSavedAllocationsList(); });
    try {
        const workerScript = document.getElementById('mc-worker-script').textContent;
        const workerBlob = new Blob([workerScript], { type: 'application/javascript' });
        mcWorker = new Worker(URL.createObjectURL(workerBlob));
        mcWorker.onmessage = function(e) {
            const { type, progress, results } = e.data;
            const runBtn = document.getElementById('run-mc-btn'), progressBar = document.getElementById('mc-progress-bar');
            if (type === 'progress') { progressBar.style.width = `${progress}%`; progressBar.textContent = `${Math.round(progress)}%`; }
            else if (type === 'complete') {
                processMcResults(results.rebalanced, 'rebalanced'); 
                processMcResults(results.noRebalance, 'no-rebalance');
                document.getElementById('mc-status').textContent = 'Simulation complete.'; runBtn.disabled = false;
            }
        };
    } catch (e) { console.error("Failed to initialize Web Worker.", e); document.getElementById('mc-status').textContent = 'Error: Could not initialize simulation worker.'; }

    document.getElementById('run-mc-btn').addEventListener('click', () => {
        if (!mcWorker) { alert("Simulation worker is not available."); return; }
        const runBtn = document.getElementById('run-mc-btn'), statusEl = document.getElementById('mc-status'), progressBarContainer = document.getElementById('mc-progress-bar-container'), progressBar = document.getElementById('mc-progress-bar');
        statusEl.textContent = 'Running simulations...'; progressBarContainer.style.display = 'block'; progressBar.style.width = '0%'; progressBar.textContent = '0%'; runBtn.disabled = true;
        const numYears = parseInt(document.getElementById('mc-years').value), numSims = parseInt(document.getElementById('mc-simulations').value);
        const startIndex = data.findIndex(d => d.date === document.getElementById('start-date').value), endIndex = data.findIndex(d => d.date === document.getElementById('end-date').value);
        const historicalData = data.slice(startIndex, endIndex + 1);
        const targetAlloc = {}; document.querySelectorAll('#allocation-inputs input').forEach(input => { targetAlloc[input.dataset.asset] = parseFloat(input.value) / 100 || 0; });
        const activeAssets = Object.keys(targetAlloc).filter(k => targetAlloc[k] > 0);
        
        const useSip = document.querySelector('input[name="investment-method"]:checked').value === 'sip';
        const commonOptions = {
            investmentMethod: 'lumpsum',
            useSip,
            monthlySipAmount: parseFloat(document.getElementById('monthly-sip-amount').value),
            sipDuration: parseInt(document.getElementById('sip-duration').value, 10),
            lumpsumAmount: parseFloat(document.getElementById('lumpsum-amount').value),
            monthlyWithdrawal: parseFloat(document.getElementById('monthly-withdrawal').value),
            withdrawalDelayYears: parseFloat(document.getElementById('withdrawal-delay').value),
            inflationRate: parseFloat(document.getElementById('inflation-rate').value) / 100,
        };
        const optionsReb = { ...commonOptions, withRebalance: true, rebalanceFrequency: parseInt(document.getElementById('rebalance-frequency').value, 10) };
        const optionsNoReb = { ...commonOptions, withRebalance: false };
        mcWorker.postMessage({ numSims, numMonths: numYears * 12, stats: getAssetStats(historicalData, activeAssets), targetAlloc, optionsReb, optionsNoReb });
    });


    const corpusYAxisFormatterMC = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0, notation: 'compact' }).format(value);
    function processMcResults(results, type) {
        const { percentileData, finalValues, successCount } = results;
        const numSims = finalValues.length; if(numSims === 0) return;
        const numMonths = percentileData.p50.length - 1;
        document.getElementById(`mc-success-rate-${type}`).textContent = `${(successCount / numSims * 100).toFixed(2)}%`;
        const funnelChart = chartInstances[`mc-funnel-chart-${type}`], funnelColors = type === 'rebalanced' ? { median: '#36A2EB', p75: 'rgba(54, 162, 235, 0.4)', p90: 'rgba(54, 162, 235, 0.2)' } : { median: '#FF6384', p75: 'rgba(255, 99, 132, 0.4)', p90: 'rgba(255, 99, 132, 0.2)' };
        funnelChart.setOption({ title: { text: "Outcome Distribution Funnel" }, tooltip: { formatter: (params) => { const i = params[0].dataIndex; return `Year: ${params[0].axisValueLabel}<br/>${params[4].marker} Median (50th): ${formatCurrency(percentileData.p50[i])}<br/>25th-75th: ${formatCurrency(percentileData.p25[i])} - ${formatCurrency(percentileData.p75[i])}<br/>10th-90th: ${formatCurrency(percentileData.p10[i])} - ${formatCurrency(percentileData.p90[i])}<br/>`; } }, xAxis: { type: 'category', data: Array.from({length: numMonths + 1}, (_, i) => (i/12).toFixed(1)), name: 'Simulation Year' }, yAxis: { axisLabel: { formatter: corpusYAxisFormatterMC } }, legend: { data: ['10th-90th Percentile', '25th-75th Percentile', 'Median (50th)'] }, series: [ { name: '10th-90th Percentile', type: 'line', data: percentileData.p90, lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: funnelColors.p90, origin: 'auto' }, stack: 'percentiles_outer' }, { name: '_hidden_10', type: 'line', data: percentileData.p10, lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: 'rgba(0,0,0,0)' }, stack: 'percentiles_outer' }, { name: '25th-75th Percentile', type: 'line', data: percentileData.p75, lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: funnelColors.p75, origin: 'auto' }, stack: 'percentiles_inner' }, { name: '_hidden_25', type: 'line', data: percentileData.p25, lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: 'rgba(0,0,0,0)' }, stack: 'percentiles_inner' }, { name: 'Median (50th)', type: 'line', data: percentileData.p50, showSymbol: false, lineStyle: { color: funnelColors.median, width: 2 } } ] });
        const histogramChart = chartInstances[`mc-histogram-chart-${type}`]; const maxFinal = Math.max(...finalValues); const numBins = 20; const binSize = maxFinal > 0 ? maxFinal / numBins : 1; const bins = Array(numBins).fill(0); const labels = Array.from({length: numBins}, (_, i) => `${formatCurrency(i*binSize)} - ${formatCurrency((i+1)*binSize)}`);
        finalValues.forEach(val => { bins[Math.min(Math.floor(val / binSize), numBins - 1)]++; });
        histogramChart.setOption({ title: { text: 'Distribution of Final Portfolio Values' }, tooltip: { formatter: (p) => `Range: ${p[0].axisValueLabel}<br/>Simulations: ${p[0].value}` }, xAxis: { type: 'category', data: labels, axisLabel: { interval: 1, rotate: 30 } }, yAxis: { name: 'Number of Simulations' }, series: [{ name: 'Simulations', type: 'bar', data: bins, itemStyle: { color: funnelColors.median } }] });
        document.getElementById(`mc-${type}-results`).style.display = 'block'; document.getElementById(`mc-${type}-results`).open = true;
        if (funnelChart) funnelChart.resize(); if (histogramChart) histogramChart.resize();
    }
    const tooltip = document.getElementById('comparison-tooltip'), summaryTable = document.getElementById('withdrawal-strategy-summary-table');
    summaryTable.addEventListener('mouseover', (e) => {
        if (e.target.tagName === 'TD' && e.target.dataset.strategy) {
            const strategy = e.target.dataset.strategy, metric = e.target.dataset.metric, type = e.target.dataset.type;
            const allValues = comparisonData[strategy][metric], hoveredValue = allValues[type], peers = Object.entries(allValues).filter(([key]) => key !== type);
            const metricName = metric === 'corpus' ? 'Final Corpus' : 'Total Withdrawn';
            let title = type === 'standard' ? 'Standard vs. Others' : (type === 'dynamicThreshold' ? 'Dynamic Threshold vs. Others' : (type === 'proportionalShield' ? 'Proportional Shield vs. Others' : 'Guyton-Klinger vs. Others'));
            let tooltipContent = `<h5>Differences in ${metricName}<br/>${title}</h5><table>`;
            peers.forEach(([peerType, peerValue]) => {
                const diff = hoveredValue - peerValue, pctDiff = peerValue !== 0 ? (diff / Math.abs(peerValue)) * 100 : Infinity;
                const colorClass = diff >= 0 ? 'diff-positive' : 'diff-negative';
                let peerName = peerType === 'standard' ? 'Standard' : (peerType === 'dynamicThreshold' ? 'Dyn. Threshold' : (peerType === 'proportionalShield' ? 'Prop. Shield' : 'Guyton-Klinger'));
                tooltipContent += `<tr><td>vs. ${peerName}:</td><td class="${colorClass}">${formatCurrency(diff)}</td><td class="${colorClass}">${isFinite(pctDiff) ? pctDiff.toFixed(2) + '%' : 'N/A'}</td></tr>`;
            });
            tooltip.innerHTML = tooltipContent + '</table>';
            tooltip.style.left = `${e.pageX + 15}px`; tooltip.style.top = `${e.pageY + 15}px`; tooltip.style.display = 'block';
        }
    });
    summaryTable.addEventListener('mouseout', () => { tooltip.style.display = 'none'; });
    generateAllocationInputs();
    populateDateDropdowns();
    // Phase 3 chain: Data Select -> Merge Array -> Recalculate Metrics -> Re-render Visualizations.
    // Reuses cached rawJsonData (no re-fetch); updateChartAndTable() runs calculateMetrics + renderVisualizations.
    if (strategySelect) strategySelect.addEventListener('change', () => {
        currentStrategy = strategySelect.value;
        const merged = buildMergedData(rawJsonData, currentStrategy);
        if (merged.length === 0) return; // keep previous dataset on placeholder keys
        data = merged;
        console.log(`[strategy] ${currentStrategy}:`, data.length, 'rows', data.slice(0, 3));
        populateDateDropdowns();
        updateChartAndTable();
    });
    // Phase 3: #strategy-selector has its own change handler above (rebuild + render), so exclude it here to avoid double renders.
    document.querySelectorAll('.controls input, .controls select:not(#strategy-selector)').forEach(input => input.addEventListener('input', updateChartAndTable));
    // Phase 5: opening any collapsed section renders it on demand (closed sections skipped above).
    document.addEventListener('toggle', (e) => {
        if (e.target && e.target.matches && e.target.matches('details.chart-group') && e.target.open) updateChartAndTable();
    }, true);
    document.getElementById('log-scale-toggle').addEventListener('change', updateChartAndTable);
    
    function handleInvestmentMethodChange() {
        const investmentMethod = document.querySelector('input[name="investment-method"]:checked').value;
        const isSip = investmentMethod === 'sip' || investmentMethod === 'valueDynamicSip' || investmentMethod === 'growthDynamicSip';
        
        document.getElementById('lumpsum-group').style.display = isSip ? 'none' : 'block';
        document.getElementById('sip-group').style.display = isSip ? 'block' : 'none';
        updateChartAndTable();
    }
    document.querySelectorAll('input[name="investment-method"]').forEach(radio => {
        radio.addEventListener('change', handleInvestmentMethodChange);
    });
    
    // Handle rebalance strategy toggle visibility
    document.querySelectorAll('input[name="rebalance-strategy"]').forEach(radio => {
        radio.addEventListener('change', function() {
            const momentumSettings = document.getElementById('momentum-settings');
            if (this.value === 'momentum') {
                momentumSettings.style.display = 'block';
            } else {
                momentumSettings.style.display = 'none';
            }
            updateChartAndTable();
        });
    });

    // At the end of script
    document.querySelectorAll('#tax-stcg, #tax-ltcg, #tax-exemption').forEach(input => {
        input.addEventListener('input', updateChartAndTable);
    });

    // Handle gold trend filter toggle
    document.getElementById('gold-trend-filter').addEventListener('change', updateChartAndTable);

    applyTheme(localStorage.getItem('theme') || (window.matchMedia("(prefers-color-scheme: dark)").matches ? 'dark' : 'light'));
    handleInvestmentMethodChange(); // Initial call to set correct visibility
    
    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { drawPerformanceLines(); }, 150); });

    setupRandomWalkControls();



    // EXPORT PDF
    document.getElementById('export-pdf-btn').addEventListener('click', () => {
        const wasDarkMode = document.body.classList.contains('dark-mode');
        if (wasDarkMode) {
            document.body.classList.remove('dark-mode');
            updateAllChartThemes(); 
        }
        const allDetails = document.querySelectorAll('details');
        const closedDetails = [];
        allDetails.forEach(d => {
            if (!d.open) {
                d.open = true;
                closedDetails.push(d); // Remember which ones we forced open
            }
        });

        setTimeout(() => {
            window.print();
            if (wasDarkMode) {
                document.body.classList.add('dark-mode');
                updateAllChartThemes();
            }
        }, 500); // 500ms delay to ensure DOM reflow
    });

    // Withdrawal Frequency Toggles
    document.querySelectorAll('input[name="withdrawal-freq"]').forEach(radio => {
        radio.addEventListener('change', () => {
            // Optional: Update label text to reflect frequency
            const val = parseInt(radio.value);
            const lbl = document.getElementById('lbl-withdrawal-amount');
            if(lbl) {
                if(val === 1) lbl.textContent = "Target Monthly Expense (₹)";
                else if(val === 3) lbl.textContent = "Target Quarterly Expense (₹)";
                else if(val === 12) lbl.textContent = "Target Yearly Expense (₹)";
            }
            updateChartAndTable();
        });
    });

    document.querySelectorAll('input[name="withdrawal-strategy-mode"]').forEach(radio => {
        radio.addEventListener('change', updateChartAndTable);
    });

    // Liquid Return Input
    const liqInput = document.getElementById('liquid-return');
    if(liqInput) {
        liqInput.addEventListener('input', updateChartAndTable);
    }



    // =========================================================================
    // ⏳ THE TIMING DILEMMA (LAZY LOADED ENGINE)
    // =========================================================================

    function renderTimingDilemma() {
        if (!globalDates.length) return;
        
        const wrapper = document.getElementById('timing-content-wrapper');
        const loader = document.getElementById('timing-loading-indicator');
        loader.style.display = 'block';
        wrapper.style.display = 'none';

        // Use setTimeout to allow UI to show loader before blocking main thread
        setTimeout(() => {
            const mode = document.querySelector('input[name="timing-strategy-mode"]:checked').value;
            let hist;
            if (mode === 'reb') hist = globalResults.standard.reb.historyWithoutWithdrawals;
            else if (mode === 'noReb') hist = globalResults.standard.noReb.historyWithoutWithdrawals;
            else if (mode === 'equityOnly') hist = globalResults.standard.equityOnly.historyWithoutWithdrawals;
            else if (mode === 'goldOnly') hist = globalResults.standard.goldOnly.historyWithoutWithdrawals;
            else hist = globalResults.standard.benchmark.historyWithoutWithdrawals;

            const TOTAL_CAPITAL = 2500000;
            const N = hist.length;

            // 1. Identify Peaks and Troughs
            const peaks = new Set();
            const troughs = new Set();

            for (let i = 1; i < N - 1; i++) {
                if (hist[i] > hist[i-1] && hist[i] > hist[i+1]) peaks.add(i);
                if (hist[i] < hist[i-1] && hist[i] < hist[i+1]) troughs.add(i);
            }
            
            // Edge case fallbacks
            if (peaks.size === 0) peaks.add(N - 1);
            if (troughs.size === 0) troughs.add(0);

            // 2. Define Installment Sizes
            const instA = TOTAL_CAPITAL / troughs.size; // Dip Buyer
            const instB = TOTAL_CAPITAL / peaks.size;   // FOMO Buyer
            const instC = TOTAL_CAPITAL / N;            // SIP Buyer

            // 3. State Variables for Simulation
            let portA = 0, portB = 0, portC = 0;
            let invA = 0, invB = 0, invC = 0;
            
            const trajA = [], trajB = [], trajC =[];
            const underA = [], underB = [], underC = [];
            const cfA = [], cfB = [], cfC =[];

            let underMonthsA = 0, underMonthsB = 0, underMonthsC = 0;

            // 4. Run Simulation
            for (let i = 0; i < N; i++) {
                const ret = i > 0 ? (hist[i] / hist[i-1]) - 1 : 0;
                
                // Grow existing portfolios
                portA *= (1 + ret);
                portB *= (1 + ret);
                portC *= (1 + ret);

                // Add Cashflows
                const currentDate = new Date(globalDates[i]);

                // SIP (Every Month)
                portC += instC;
                invC += instC;
                cfC.push({ date: currentDate, amount: -instC });

                // Dip Buyer
                if (troughs.has(i)) {
                    portA += instA;
                    invA += instA;
                    cfA.push({ date: currentDate, amount: -instA });
                }

                // FOMO Buyer
                if (peaks.has(i)) {
                    portB += instB;
                    invB += instB;
                    cfB.push({ date: currentDate, amount: -instB });
                }

                // Log Trajectories
                trajA.push([globalDates[i], portA]);
                trajB.push([globalDates[i], portB]);
                trajC.push([globalDates[i], portC]);

                // Log Underwater Amount (Pain Index)
                const uwA = portA - invA;
                const uwB = portB - invB;
                const uwC = portC - invC;
                
                underA.push([globalDates[i], uwA]);
                underB.push([globalDates[i], uwB]);
                underC.push([globalDates[i], uwC]);

                // Track Months Underwater
                if (uwA < 0) underMonthsA++;
                if (uwB < 0) underMonthsB++;
                if (uwC < 0) underMonthsC++;
            }

            // Final Cashflows for XIRR
            const finalDate = new Date(globalDates[N-1]);
            cfA.push({ date: finalDate, amount: portA });
            cfB.push({ date: finalDate, amount: portB });
            cfC.push({ date: finalDate, amount: portC });

            const xirrA = calculateXIRR(cfA) * 100 || 0;
            const xirrB = calculateXIRR(cfB) * 100 || 0;
            const xirrC = calculateXIRR(cfC) * 100 || 0;

            // --- RENDER VISUAL 1: WEALTH TRAJECTORY ---
            const chartWealth = echarts.getInstanceByDom(document.getElementById('timing-wealth-chart')) || echarts.init(document.getElementById('timing-wealth-chart'));
            chartWealth.setOption({
                ...getBaseChartOptions(),
                tooltip: { trigger: 'axis', formatter: p => {
                    let str = `<b>${p[0].axisValueLabel}</b><br/>`;
                    p.sort((a,b)=>b.value[1]-a.value[1]).forEach(s => str += `${s.marker} ${s.seriesName}: ${formatCurrency(s.value[1])}<br/>`);
                    return str;
                }},
                legend: { data:['🟢 Buy the Dip', '🔴 FOMO Tops', '🔵 Dumb SIP'], bottom: 0 },
                xAxis: { type: 'time' },
                yAxis: { type: 'value', axisLabel: { formatter: v => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) } },
                series:[
                    { name: '🟢 Buy the Dip', type: 'line', data: trajA, showSymbol: false, lineStyle: { color: '#27ae60', width: 2 } },
                    { name: '🔴 FOMO Tops', type: 'line', data: trajB, showSymbol: false, lineStyle: { color: '#c0392b', width: 2 } },
                    { name: '🔵 Dumb SIP', type: 'line', data: trajC, showSymbol: false, lineStyle: { color: '#2980b9', width: 2, type: 'dashed' } }
                ]
            });

            // --- RENDER VISUAL 2: BAR CHART (CORPUS & XIRR) ---
            const chartBar = echarts.getInstanceByDom(document.getElementById('timing-bar-chart')) || echarts.init(document.getElementById('timing-bar-chart'));
            chartBar.setOption({
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                legend: { data:['Final Corpus (₹)', 'XIRR (%)'], bottom: 0 },
                xAxis: { type: 'category', data: ['Dip Buyer', 'FOMO Buyer', 'Dumb SIP'] },
                yAxis:[
                    { type: 'value', name: 'Corpus', axisLabel: { formatter: v => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) } },
                    { type: 'value', name: 'XIRR', position: 'right', axisLabel: { formatter: '{value}%' } }
                ],
                series:[
                    { name: 'Final Corpus (₹)', type: 'bar', data:[
                        { value: portA, itemStyle: { color: '#27ae60' } },
                        { value: portB, itemStyle: { color: '#c0392b' } },
                        { value: portC, itemStyle: { color: '#2980b9' } }
                    ]},
                    { name: 'XIRR (%)', type: 'bar', yAxisIndex: 1, data:[
                        { value: xirrA.toFixed(2), itemStyle: { color: 'rgba(39, 174, 96, 0.5)' } },
                        { value: xirrB.toFixed(2), itemStyle: { color: 'rgba(192, 57, 43, 0.5)' } },
                        { value: xirrC.toFixed(2), itemStyle: { color: 'rgba(41, 128, 185, 0.5)' } }
                    ]}
                ],
                grid: { top: 30, right: 40, bottom: 40, left: 50 }
            });

            // --- RENDER VISUAL 3: PAIN INDEX (UNDERWATER) ---
            const chartUnderwater = echarts.getInstanceByDom(document.getElementById('timing-underwater-chart')) || echarts.init(document.getElementById('timing-underwater-chart'));
            chartUnderwater.setOption({
                ...getBaseChartOptions(),
                tooltip: { trigger: 'axis', formatter: p => {
                    let str = `<b>${p[0].axisValueLabel}</b><br/>`;
                    p.forEach(s => {
                        let color = s.value[1] >= 0 ? 'green' : 'red';
                        str += `${s.marker} ${s.seriesName}: <span style="color:${color}">${formatCurrency(s.value[1])}</span><br/>`;
                    });
                    return str;
                }},
                legend: { data:['🟢 Dip Buyer', '🔴 FOMO Buyer', '🔵 SIP Buyer'], bottom: 0 },
                xAxis: { type: 'time' },
                yAxis: { type: 'value', axisLabel: { formatter: v => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) } },
                series:[
                    { name: '🟢 Dip Buyer', type: 'line', data: underA, showSymbol: false, areaStyle: { opacity: 0.2 }, lineStyle: { color: '#27ae60', width: 1 } },
                    { name: '🔴 FOMO Buyer', type: 'line', data: underB, showSymbol: false, areaStyle: { opacity: 0.2 }, lineStyle: { color: '#c0392b', width: 1 } },
                    { name: '🔵 SIP Buyer', type: 'line', data: underC, showSymbol: false, areaStyle: { opacity: 0.2 }, lineStyle: { color: '#2980b9', width: 1 } }
                ],
                graphic:[{ type: 'line', left: 50, right: 30, shape: { y1: 0, y2: 0 } }] // visual zero line handled by axis
            });

            // --- POPULATE METRICS TABLE ---
            document.querySelector('#timing-metrics-table tbody').innerHTML = `
                <tr>
                    <td><strong>Strategy Profile</strong></td>
                    <td>Invested in ${troughs.size} Crashes</td>
                    <td>Invested in ${peaks.size} Bubbles</td>
                    <td>Invested in ${N} Months</td>
                </tr>
                <tr>
                    <td><strong>Installment Size</strong></td>
                    <td>${formatCurrency(instA)}</td>
                    <td>${formatCurrency(instB)}</td>
                    <td>${formatCurrency(instC)}</td>
                </tr>
                <tr>
                    <td><strong>Final Corpus</strong></td>
                    <td><strong>${formatCurrency(portA)}</strong></td>
                    <td><strong>${formatCurrency(portB)}</strong></td>
                    <td><strong>${formatCurrency(portC)}</strong></td>
                </tr>
                <tr>
                    <td><strong>Annualized Return (XIRR)</strong></td>
                    <td style="color:#27ae60; font-weight:bold;">${xirrA.toFixed(2)}%</td>
                    <td style="color:#c0392b; font-weight:bold;">${xirrB.toFixed(2)}%</td>
                    <td style="color:#2980b9; font-weight:bold;">${xirrC.toFixed(2)}%</td>
                </tr>
                <tr>
                    <td><strong>Time Spent Underwater (Loss)</strong></td>
                    <td>${underMonthsA} Months</td>
                    <td style="color:#c0392b;">${underMonthsB} Months</td>
                    <td>${underMonthsC} Months</td>
                </tr>
            `;

            timingSectionNeedsUpdate = false;
            loader.style.display = 'none';
            wrapper.style.display = 'block';

            // Ensure charts resize properly when revealed
            setTimeout(() => {
                chartWealth.resize();
                chartBar.resize();
                chartUnderwater.resize();
            }, 100);
        }, 100); // 100ms delay for UI paints
    }

    // Attach listeners for Radio Buttons
    document.querySelectorAll('input[name="timing-strategy-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            timingSectionNeedsUpdate = true;
            if (document.getElementById('timing-dilemma-section').open) {
                renderTimingDilemma();
            }
        });
    });

    // Attach Toggle Listener for Lazy Loading
    document.getElementById('timing-dilemma-section').addEventListener('toggle', function(e) {
        if (this.open && timingSectionNeedsUpdate) {
            renderTimingDilemma();
        }
    });


    // =========================================================================
    // 📅 THE HORIZON MATRIX (LAZY LOADED ENGINE)
    // =========================================================================

    function renderHorizonMatrix() {
        if (!globalDates.length) return;
        
        const wrapper = document.getElementById('horizon-content-wrapper');
        const loader = document.getElementById('horizon-loading-indicator');
        loader.style.display = 'block';
        wrapper.style.display = 'none';

        setTimeout(() => {
            const mode = document.querySelector('input[name="horizon-strategy-mode"]:checked').value;
            let hist;
            if (mode === 'reb') hist = globalResults.standard.reb.historyWithoutWithdrawals;
            else if (mode === 'noReb') hist = globalResults.standard.noReb.historyWithoutWithdrawals;
            else if (mode === 'equityOnly') hist = globalResults.standard.equityOnly.historyWithoutWithdrawals;
            else if (mode === 'goldOnly') hist = globalResults.standard.goldOnly.historyWithoutWithdrawals;
            else hist = globalResults.standard.benchmark.historyWithoutWithdrawals;

            // --- 1. BUILD THE HEATMAP MATRIX ---
            // Group data by Year (Anchor points: First month of each year)
            const yearAnchors =[];
            let currentYear = -1;
            for(let i = 0; i < globalDates.length; i++) {
                const yr = new Date(globalDates[i]).getFullYear();
                if(yr !== currentYear) {
                    yearAnchors.push({ year: yr, index: i, value: hist[i] });
                    currentYear = yr;
                }
            }

            let maxDuration = yearAnchors.length - 1;
            
            // Build Table Header
            let thead = '<tr><th>Invested In</th>';
            for(let i = 1; i <= maxDuration; i++) thead += `<th>${i}yr</th>`;
            thead += '</tr>';

            // Build Table Body
            let tbody = '';
            for(let i = 0; i < yearAnchors.length - 1; i++) {
                const startNode = yearAnchors[i];
                let tr = `<tr><td class="heatmap-row-label">${startNode.year}</td>`;
                
                for(let d = 1; d <= maxDuration; d++) {
                    const targetIndex = i + d;
                    if(targetIndex < yearAnchors.length) {
                        const endNode = yearAnchors[targetIndex];
                        const cagr = Math.pow(endNode.value / startNode.value, 1 / d) - 1;
                        const bg = getMatrixColor(cagr);
                        const tc = getMatrixTextColor(cagr);
                        tr += `<td style="background-color:${bg}; color:${tc};">${(cagr*100).toFixed(0)}%</td>`;
                    } else {
                        tr += `<td></td>`; // Empty space to form the triangle
                    }
                }
                tr += `</tr>`;
                tbody += tr;
            }
            document.getElementById('horizon-heatmap-table').innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;

            // --- 2. CALCULATE CONE & PROBABILITIES (Using Monthly Rolling Data) ---
            const horizons =[1, 2, 3, 5, 7, 10, 15]; // Years to analyze
            const coneData = { min: [], max: [], avg: [], labels:[] };
            const probData = { win: [], beatFD:[] };

            horizons.forEach(h => {
                const months = h * 12;
                if(months >= hist.length) return; // Skip if backtest is shorter than horizon
                
                let min = Infinity, max = -Infinity, sum = 0, count = 0;
                let winCount = 0, beatFDCount = 0;
                
                for(let i = months; i < hist.length; i++) {
                    const startVal = hist[i - months];
                    const endVal = hist[i];
                    if(startVal > 0) {
                        const cagr = Math.pow(endVal / startVal, 1 / h) - 1;
                        if(cagr < min) min = cagr;
                        if(cagr > max) max = cagr;
                        sum += cagr;
                        count++;
                        
                        if(cagr > 0) winCount++;
                        if(cagr > 0.08) beatFDCount++;
                    }
                }
                
                if(count > 0) {
                    coneData.labels.push(`${h}Y`);
                    coneData.min.push((min * 100).toFixed(1));
                    coneData.max.push((max * 100).toFixed(1));
                    coneData.avg.push(((sum / count) * 100).toFixed(1));
                    
                    probData.win.push(((winCount / count) * 100).toFixed(1));
                    probData.beatFD.push(((beatFDCount / count) * 100).toFixed(1));
                }
            });

            // --- RENDER VISUAL 2: THE CONE CHART ---
            const chartCone = echarts.getInstanceByDom(document.getElementById('horizon-cone-chart')) || echarts.init(document.getElementById('horizon-cone-chart'));
            chartCone.setOption({
                ...getBaseChartOptions(),
                tooltip: { trigger: 'axis', formatter: p => {
                    let str = `<b>Holding Period: ${p[0].axisValueLabel}</b><br/>`;
                    p.forEach(s => str += `${s.marker} ${s.seriesName}: <b>${s.value}%</b><br/>`);
                    return str;
                }},
                legend: { data:['Max Historical Return', 'Average Return', 'Min Historical Return'], bottom: 0 },
                xAxis: { type: 'category', data: coneData.labels, name: 'Holding Period' },
                yAxis: { type: 'value', name: 'CAGR %', axisLabel: { formatter: '{value}%' } },
                series:[
                    { name: 'Max Historical Return', type: 'line', data: coneData.max, lineStyle: { color: '#27ae60', type: 'dashed', width: 2 }, itemStyle: { color: '#27ae60'} },
                    { name: 'Average Return', type: 'line', data: coneData.avg, lineStyle: { color: '#2980b9', width: 4 }, itemStyle: { color: '#2980b9'}, z: 10 },
                    { name: 'Min Historical Return', type: 'line', data: coneData.min, lineStyle: { color: '#c0392b', type: 'dashed', width: 2 }, itemStyle: { color: '#c0392b'} }
                ]
            });

            // --- RENDER VISUAL 3: THE PROBABILITY CHART ---
            const chartProb = echarts.getInstanceByDom(document.getElementById('horizon-prob-chart')) || echarts.init(document.getElementById('horizon-prob-chart'));
            chartProb.setOption({
                ...getBaseChartOptions(),
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => {
                    let str = `<b>Holding Period: ${p[0].axisValueLabel}</b><br/>`;
                    p.forEach(s => str += `${s.marker} ${s.seriesName}: <b>${s.value}%</b><br/>`);
                    return str;
                }},
                legend: { data:['Probability > 0% (Capital Safe)', 'Probability > 8% (Beat FD)'], bottom: 0 },
                xAxis: { type: 'category', data: coneData.labels, name: 'Holding Period' },
                yAxis: { type: 'value', name: 'Probability %', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
                series:[
                    { name: 'Probability > 0% (Capital Safe)', type: 'bar', data: probData.win, itemStyle: { color: '#27ae60', borderRadius:[4, 4, 0, 0] } },
                    { name: 'Probability > 8% (Beat FD)', type: 'bar', data: probData.beatFD, itemStyle: { color: '#f39c12', borderRadius:[4, 4, 0, 0] } }
                ]
            });

            horizonSectionNeedsUpdate = false;
            loader.style.display = 'none';
            wrapper.style.display = 'block';

            setTimeout(() => { chartCone.resize(); chartProb.resize(); }, 100);
        }, 50); // Small delay to render loader
    }

    // Attach listeners for Radio Buttons
    document.querySelectorAll('input[name="horizon-strategy-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            horizonSectionNeedsUpdate = true;
            if (document.getElementById('horizon-matrix-section').open) {
                renderHorizonMatrix();
            }
        });
    });

    // Attach Toggle Listener for Lazy Loading
    document.getElementById('horizon-matrix-section').addEventListener('toggle', function(e) {
        if (this.open && horizonSectionNeedsUpdate) {
            renderHorizonMatrix();
        }
    });

    // Helper: Calculate Pearson Correlation Coefficient
    function renderCorrelationCharts() {
        if (!globalFilteredData.length) return;

        const wrapper = document.getElementById('correlation-content-wrapper');
        const loader = document.getElementById('correlation-loading-indicator');
        loader.style.display = 'block';
        wrapper.style.display = 'none';

        setTimeout(() => {
            const windowMonths = 84; // 7-Year Rolling Window
            
            // 1. Extract Raw Monthly Returns
            const retsEq = [];
            const retsGd =[];
            for(let i = 1; i < globalFilteredData.length; i++) {
                const prevEq = globalFilteredData[i-1].EQUITY || 1;
                const currEq = globalFilteredData[i].EQUITY || 1;
                const prevGd = globalFilteredData[i-1].GOLD || 1;
                const currGd = globalFilteredData[i].GOLD || 1;
                
                retsEq.push((currEq / prevEq) - 1);
                retsGd.push((currGd / prevGd) - 1);
            }

            // 2. Calculate 36-Month Rolling Correlation
            const rollingData =[];
            for (let i = windowMonths; i <= retsEq.length; i++) {
                const xSlice = retsEq.slice(i - windowMonths, i);
                const ySlice = retsGd.slice(i - windowMonths, i);
                const corr = pearsonCorrelation(xSlice, ySlice);
                // Index + 1 matches the globalDates index corresponding to the end of the return period
                rollingData.push([globalDates[i], parseFloat(corr.toFixed(3))]); 
            }

            // 3. Calculate Horizon (Yearly) Correlation
            const horizonData = { labels: [], values:[] };
            // Calculate total years in dataset
            const totalYears = Math.floor(globalFilteredData.length / 12);

            // RULE: Cap correlation horizons to half the dataset length (max 10 years) 
            // to prevent "Overlapping Window" statistical illusions.
            const maxYears = Math.min(10, Math.floor(totalYears / 2));

            for (let y = 1; y <= maxYears; y++) {
                const months = y * 12;
                const xRet = [], yRet =[];
                
                // Calculate rolling overlapping cumulative returns for 'y' years
                for (let i = months; i < globalFilteredData.length; i++) {
                    const startEq = globalFilteredData[i - months].EQUITY || 1;
                    const endEq = globalFilteredData[i].EQUITY || 1;
                    const startGd = globalFilteredData[i - months].GOLD || 1;
                    const endGd = globalFilteredData[i].GOLD || 1;

                    xRet.push((endEq / startEq) - 1);
                    yRet.push((endGd / startGd) - 1);
                }
                
                if (xRet.length > 2) {
                    const corr = pearsonCorrelation(xRet, yRet);
                    horizonData.labels.push(`${y}Y`);
                    horizonData.values.push(parseFloat(corr.toFixed(3)));
                }
            }

            // --- RENDER CHART 1: ROLLING CORRELATION ---
            const chartRolling = echarts.getInstanceByDom(document.getElementById('rolling-correlation-chart')) || echarts.init(document.getElementById('rolling-correlation-chart'));
            chartRolling.setOption({
                ...getBaseChartOptions(),
                tooltip: { 
                    trigger: 'axis',
                    formatter: p => `<b>${p[0].axisValueLabel}</b><br/>${windowMonths}-Month Correlation: <b>${p[0].value[1]}</b>`
                },
                xAxis: { type: 'time', name: 'Date' },
                yAxis: { type: 'value', min: -1, max: 1, name: 'Correlation' },
                visualMap: {
                    show: false,
                    dimension: 1,
                    pieces:[
                        { min: 0, max: 1, color: '#c0392b' }, // Positive = Red (Bad for diversification)
                        { min: -1, max: 0, color: '#27ae60' } // Negative = Green (Good for diversification)
                    ]
                },
                series:[{
                    name: `${windowMonths} Month Correlation`,
                    type: 'line',
                    data: rollingData,
                    showSymbol: false,
                    lineStyle: { width: 2 },
                    markLine: {
                        silent: true,
                        data: [{ yAxis: 0 }],
                        lineStyle: { color: '#7f8c8d', type: 'dashed', width: 2 }
                    },
                    areaStyle: {
                        opacity: 0.2
                    }
                }]
            });

            // --- RENDER CHART 2: HORIZON CORRELATION ---
            const chartHorizon = echarts.getInstanceByDom(document.getElementById('horizon-correlation-chart')) || echarts.init(document.getElementById('horizon-correlation-chart'));
            chartHorizon.setOption({
                ...getBaseChartOptions(),
                tooltip: { 
                    trigger: 'axis',
                    axisPointer: { type: 'shadow' },
                    formatter: p => `<b>Holding Period: ${p[0].name}</b><br/>Correlation: <b>${p[0].value}</b>`
                },
                xAxis: { type: 'category', data: horizonData.labels, name: 'Holding Period' },
                yAxis: { type: 'value', min: -1, max: 1, name: 'Correlation Coefficient' },
                series:[{
                    name: 'Correlation',
                    type: 'bar',
                    data: horizonData.values.map(val => ({
                        value: val,
                        itemStyle: { color: val >= 0 ? '#e74c3c' : '#2ecc71' } // Red if positive, Green if negative
                    })),
                    markLine: {
                        silent: true,
                        data: [{ yAxis: 0 }],
                        lineStyle: { color: '#7f8c8d', type: 'dashed', width: 2 }
                    }
                }]
            });

            correlationSectionNeedsUpdate = false;
            loader.style.display = 'none';
            wrapper.style.display = 'block';

            setTimeout(() => { chartRolling.resize(); chartHorizon.resize(); }, 100);
        }, 50); // Delay for loader UI
    }

    // =========================================================================
    // 🌾 VOLATILITY HARVESTING (LAZY LOADED ENGINE)
    // =========================================================================
    function renderHarvestSection() {
        if (!globalFilteredData.length) return;

        const wrapper = document.getElementById('harvest-content-wrapper');
        const loader = document.getElementById('harvest-loading-indicator');
        loader.style.display = 'block';
        wrapper.style.display = 'none';

        setTimeout(() => {
            // We use historyWithoutWithdrawals to measure pure strategy Alpha
            const histReb = globalResults.standard.reb.historyWithoutWithdrawals;
            const histNoReb = globalResults.standard.noReb.historyWithoutWithdrawals;
            const rebalanceEvents = globalResults.standard.reb.rebalanceEvents;

            // --- 1. CALCULATE CUMULATIVE ALPHA (Rebalanced minus No-Rebalance) ---
            const alphaData =[];
            for (let i = 0; i < histReb.length; i++) {
                const diff = histReb[i] - histNoReb[i];
                alphaData.push([globalDates[i], parseFloat(diff.toFixed(2))]);
            }

            // --- 2. CALCULATE VOLATILITY (Risk) ---
            const getVol = (histArr) => {
                const rets =[];
                for (let i = 1; i < histArr.length; i++) {
                    rets.push((histArr[i] / histArr[i-1]) - 1);
                }
                const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
                const variance = rets.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / (rets.length - 1);
                return Math.sqrt(variance) * Math.sqrt(12) * 100; // Annualized
            };

            // Calculate raw asset histories to get their individual volatility
            const histEq = [], histGd =[];
            let eqVal = 100, gdVal = 100;
            histEq.push(eqVal); histGd.push(gdVal);
            for (let i = 1; i < globalFilteredData.length; i++) {
                const prevData = globalFilteredData[i-1];
                const currData = globalFilteredData[i];
                eqVal *= (currData.EQUITY / prevData.EQUITY);
                gdVal *= (currData.GOLD / prevData.GOLD);
                histEq.push(eqVal);
                histGd.push(gdVal);
            }

            const volEq = getVol(histEq);
            const volGd = getVol(histGd);
            const volReb = getVol(histReb);
            const volNoReb = getVol(histNoReb);

            // --- 3. HARVESTING LEDGER (Skims and Injections) ---
            let eqSkim = 0, eqInject = 0;
            let gdSkim = 0, gdInject = 0;

            rebalanceEvents.forEach(ev => {
                if (ev.transactions) {
                    ev.transactions.forEach(t => {
                        if (t.asset === 'EQUITY') {
                            if (t.amount < 0) eqSkim += Math.abs(t.amount);
                            else eqInject += t.amount;
                        } else if (t.asset === 'GOLD') {
                            if (t.amount < 0) gdSkim += Math.abs(t.amount);
                            else gdInject += t.amount;
                        }
                    });
                }
            });

            const finalRebVal = histReb[histReb.length - 1];
            const finalNoRebVal = histNoReb[histNoReb.length - 1];
            const netAlphaRupees = finalRebVal - finalNoRebVal;
            const netAlphaPct = (finalRebVal / finalNoRebVal - 1) * 100;

            // --- RENDER VISUAL 1: THE ALPHA CHART ---
            const chartAlpha = echarts.getInstanceByDom(document.getElementById('harvest-alpha-chart')) || echarts.init(document.getElementById('harvest-alpha-chart'));
            chartAlpha.setOption({
                ...getBaseChartOptions(),
                tooltip: { 
                    trigger: 'axis',
                    formatter: p => `<b>${p[0].axisValueLabel}</b><br/>Net Alpha: <b><span style="color:${p[0].value[1] >= 0 ? '#27ae60' : '#c0392b'}">${formatCurrency(p[0].value[1])}</span></b>`
                },
                xAxis: { type: 'time', name: 'Date' },
                yAxis: { type: 'value', name: 'Alpha (₹)', axisLabel: { formatter: v => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) } },
                visualMap: {
                    show: false, dimension: 1,
                    pieces:[
                        { min: 0, max: 9999999999, color: '#27ae60' }, // Positive Alpha (Green)
                        { min: -9999999999, max: 0, color: '#c0392b' }  // Negative Alpha (Red)
                    ]
                },
                series:[{
                    name: 'Alpha', type: 'line', data: alphaData, showSymbol: false,
                    lineStyle: { width: 2 }, areaStyle: { opacity: 0.2 },
                    markLine: { silent: true, data:[{ yAxis: 0 }], lineStyle: { color: '#7f8c8d', type: 'dashed' } }
                }]
            });

            // --- RENDER VISUAL 2: THE FREE LUNCH (VOLATILITY) ---
            const chartVol = echarts.getInstanceByDom(document.getElementById('harvest-vol-chart')) || echarts.init(document.getElementById('harvest-vol-chart'));
            chartVol.setOption({
                ...getBaseChartOptions(),
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: '{b}<br/>Risk: <b>{c}%</b>' },
                grid: { top: 30, right: 30, bottom: 40, left: 50 },
                xAxis: { type: 'category', data: ['Pure Equity', 'Pure Gold', 'Drifting (No-Reb)', 'Rebalanced'] },
                yAxis: { type: 'value', name: 'Annual Volatility %', axisLabel: { formatter: '{value}%' } },
                series:[{
                    name: 'Volatility', type: 'bar',
                    data:[
                        { value: volEq.toFixed(1), itemStyle: { color: '#bdc3c7' } },
                        { value: volGd.toFixed(1), itemStyle: { color: '#bdc3c7' } },
                        { value: volNoReb.toFixed(1), itemStyle: { color: '#e74c3c' } }, // Red
                        { value: volReb.toFixed(1), itemStyle: { color: '#2980b9' } }  // Blue
                    ]
                }]
            });

            // --- POPULATE LEDGER TABLE ---
            document.querySelector('#harvest-metrics-table tbody').innerHTML = `
                <tr>
                    <td style="text-align:left;"><strong>Equity Top-Skimming</strong></td>
                    <td style="color:#27ae60;">+ ${formatCurrency(eqSkim)}</td>
                </tr>
                <tr>
                    <td style="text-align:left;"><strong>Equity Dip-Buying</strong></td>
                    <td style="color:#2980b9;">- ${formatCurrency(eqInject)}</td>
                </tr>
                <tr>
                    <td style="text-align:left;"><strong>Gold Top-Skimming</strong></td>
                    <td style="color:#f1c40f;">+ ${formatCurrency(gdSkim)}</td>
                </tr>
                <tr>
                    <td style="text-align:left;"><strong>Gold Dip-Buying</strong></td>
                    <td style="color:#2980b9;">- ${formatCurrency(gdInject)}</td>
                </tr>
                <tr style="border-top: 2px solid #ccc; background-color: ${netAlphaRupees >= 0 ? '#e8f5e9' : '#ffebee'};">
                    <td style="text-align:left; font-size: 15px;"><strong>Net Strategy Alpha</strong></td>
                    <td style="font-weight:bold; font-size: 15px; color:${netAlphaRupees >= 0 ? '#27ae60' : '#c0392b'};">
                        ${netAlphaRupees >= 0 ? '+' : ''}${formatCurrency(netAlphaRupees)} (${netAlphaPct > 0 ? '+' : ''}${netAlphaPct.toFixed(2)}%)
                    </td>
                </tr>
            `;

            harvestSectionNeedsUpdate = false;
            loader.style.display = 'none';
            wrapper.style.display = 'block';

            setTimeout(() => { chartAlpha.resize(); chartVol.resize(); }, 100);
        }, 50);
    }

    // Attach Toggle Listener for Lazy Loading
    document.getElementById('harvest-charts-section').addEventListener('toggle', function(e) {
        if (this.open && harvestSectionNeedsUpdate) {
            renderHarvestSection();
        }
    });

    // Attach Toggle Listener for Lazy Loading
    document.getElementById('correlation-charts-section').addEventListener('toggle', function(e) {
        if (this.open && correlationSectionNeedsUpdate) {
            renderCorrelationCharts();
        }
    });

    // =========================================================================
    // 🩹 AFTER THE WORST MONTHS: RECOVERY TRACKER (LAZY LOADED ENGINE)
    // Finds the 10 worst single months for the selected strategy and shows the
    // total return 1Y / 5Y / 10Y after each one — colourful bars + ledger table.
    // =========================================================================
    function renderWorstMonths() {
        if (!globalDates.length || !globalResults.standard) return;

        const wrapper = document.getElementById('worst-months-content-wrapper');
        const loader = document.getElementById('worst-months-loading-indicator');
        if (!wrapper || !loader) return;
        loader.style.display = 'block';
        wrapper.style.display = 'none';

        setTimeout(() => {
            const mode = document.querySelector('input[name="worst-months-strategy-mode"]:checked').value;
            let hist;
            if (mode === 'reb') hist = globalResults.standard.reb.historyWithoutWithdrawals;
            else if (mode === 'noReb') hist = globalResults.standard.noReb.historyWithoutWithdrawals;
            else if (mode === 'equityOnly') hist = globalResults.standard.equityOnly.historyWithoutWithdrawals;
            else if (mode === 'goldOnly') hist = globalResults.standard.goldOnly.historyWithoutWithdrawals;
            else hist = globalResults.standard.benchmark.historyWithoutWithdrawals;
            if (!hist || hist.length < 13) { loader.style.display = 'none'; return; }

            const N = hist.length;

            // --- 1. Monthly returns + 10 worst months (worst first) ---
            const months = [];
            for (let i = 1; i < N; i++) {
                const prev = hist[i - 1];
                if (prev > 0) months.push({ idx: i, date: globalDates[i], ret: (hist[i] / prev) - 1 });
            }
            months.sort((a, b) => a.ret - b.ret);
            const worst = months.slice(0, Math.min(10, months.length));

            // --- 2. Forward TOTAL returns from each worst month's low ---
            const fwd = (idx, span) => {
                if (idx + span >= N || hist[idx] <= 0) return null;
                return (hist[idx + span] / hist[idx]) - 1;
            };
            worst.forEach(w => {
                w.r1y = fwd(w.idx, 12);
                w.r5y = fwd(w.idx, 60);
                w.r10y = fwd(w.idx, 120);
            });

            const avg = (key) => {
                const vals = worst.map(w => w[key]).filter(v => v !== null);
                return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
            };
            const avgMonth = worst.reduce((a, b) => a + b.ret, 0) / worst.length;
            const avg1y = avg('r1y'), avg5y = avg('r5y'), avg10y = avg('r10y');

            const fmtPct = (v) => v === null ? '—' : `${(v * 100).toFixed(1)}%`;
            const cellColor = (v) => v === null ? '#999' : (v >= 0 ? '#27ae60' : '#c0392b');
            const shortLabel = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

            // --- 3. CHART: grouped colourful bars (green/blue/purple wins, red losses) ---
            const labels = worst.map(w => shortLabel(w.date));
            const paint = (vals, posColor, negColor) => vals.map(v =>
                v === null
                    ? { value: 0, itemStyle: { color: '#e0e0e0' } }
                    : { value: parseFloat((v * 100).toFixed(1)), itemStyle: { color: v >= 0 ? posColor : negColor } }
            );
            const chart = echarts.getInstanceByDom(document.getElementById('worst-months-chart')) || echarts.init(document.getElementById('worst-months-chart'));
            chart.setOption({
                ...getBaseChartOptions(),
                tooltip: {
                    trigger: 'axis', axisPointer: { type: 'shadow' },
                    formatter: (p) => {
                        const w = worst[p[0].dataIndex];
                        const mRet = `<span style="color:#c0392b"><b>${(w.ret * 100).toFixed(1)}%</b></span>`;
                        let str = `<b>${new Date(w.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</b> (that month: ${mRet})<br/>`;
                        p.forEach(s => {
                            const v = s.value === 0 && worst[s.dataIndex][s.seriesName === '1Y After' ? 'r1y' : s.seriesName === '5Y After' ? 'r5y' : 'r10y'] === null
                                ? 'not yet finished' : `<b>${s.value}%</b>`;
                            str += `${s.marker} ${s.seriesName}: ${v}<br/>`;
                        });
                        return str;
                    }
                },
                legend: { data: ['1Y After', '5Y After', '10Y After'], bottom: 0 },
                grid: { top: 40, right: 20, bottom: 70, left: 55 },
                xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: 30 } },
                yAxis: { type: 'value', name: 'Total Return %', axisLabel: { formatter: '{value}%' } },
                series: [
                    { name: '1Y After', type: 'bar', data: paint(worst.map(w => w.r1y), '#27ae60', '#c0392b'), barGap: '15%' },
                    { name: '5Y After', type: 'bar', data: paint(worst.map(w => w.r5y), '#2980b9', '#e74c3c') },
                    { name: '10Y After', type: 'bar', data: paint(worst.map(w => w.r10y), '#8e44ad', '#e67e22') }
                ]
            });

            // --- 4. TABLE: ledger with red/green cells + averages row ---
            const rowHtml = (w) => {
                const dStr = new Date(w.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
                return `<tr>
                    <td><strong>${dStr}</strong></td>
                    <td style="color:#c0392b; font-weight:bold;">${(w.ret * 100).toFixed(1)}%</td>
                    <td style="color:${cellColor(w.r1y)}; font-weight:bold;">${fmtPct(w.r1y)}</td>
                    <td style="color:${cellColor(w.r5y)}; font-weight:bold;">${fmtPct(w.r5y)}</td>
                    <td style="color:${cellColor(w.r10y)}; font-weight:bold;">${fmtPct(w.r10y)}</td>
                </tr>`;
            };
            document.querySelector('#worst-months-table tbody').innerHTML =
                worst.map(rowHtml).join('') +
                `<tr style="border-top: 2px solid #2c3e50; background-color: #eaf2f8;">
                    <td><strong>Averages</strong></td>
                    <td style="color:#c0392b; font-weight:bold;">${(avgMonth * 100).toFixed(1)}%</td>
                    <td style="color:${cellColor(avg1y)}; font-weight:bold;">${fmtPct(avg1y)}</td>
                    <td style="color:${cellColor(avg5y)}; font-weight:bold;">${fmtPct(avg5y)}</td>
                    <td style="color:${cellColor(avg10y)}; font-weight:bold;">${fmtPct(avg10y)}</td>
                </tr>`;

            worstMonthsSectionNeedsUpdate = false;
            loader.style.display = 'none';
            wrapper.style.display = 'block';

            setTimeout(() => { chart.resize(); }, 100);
        }, 50);
    }

    // Radio switches re-render chart + table for the selected strategy
    document.querySelectorAll('input[name="worst-months-strategy-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            worstMonthsSectionNeedsUpdate = true;
            if (document.getElementById('worst-months-section').open) {
                renderWorstMonths();
            }
        });
    });

    // Collapsed section renders on first open (lazy load)
    document.getElementById('worst-months-section').addEventListener('toggle', function(e) {
        if (this.open && worstMonthsSectionNeedsUpdate) {
            renderWorstMonths();
        }
    });

    // =========================================================================
    // 📊 MONTHLY RETURN DISTRIBUTION / RETURN STACK (LAZY LOADED ENGINE)
    // Buckets every month of the selected strategy by its single-month return —
    // colourful histogram + full month-wise stack table (best month first).
    // =========================================================================
    function renderReturnDist() {
        if (!globalDates.length || !globalResults.standard) return;

        const wrapper = document.getElementById('return-dist-content-wrapper');
        const loader = document.getElementById('return-dist-loading-indicator');
        if (!wrapper || !loader) return;
        loader.style.display = 'block';
        wrapper.style.display = 'none';

        setTimeout(() => {
            const mode = document.querySelector('input[name="return-dist-strategy-mode"]:checked').value;
            let hist;
            if (mode === 'reb') hist = globalResults.standard.reb.historyWithoutWithdrawals;
            else if (mode === 'noReb') hist = globalResults.standard.noReb.historyWithoutWithdrawals;
            else if (mode === 'equityOnly') hist = globalResults.standard.equityOnly.historyWithoutWithdrawals;
            else if (mode === 'goldOnly') hist = globalResults.standard.goldOnly.historyWithoutWithdrawals;
            else hist = globalResults.standard.benchmark.historyWithoutWithdrawals;
            if (!hist || hist.length < 3) { loader.style.display = 'none'; return; }

            // --- 1. BUCKETS (monthly-return ranges, worst first like the figure) ---
            const BUCKETS = [
                { label: '−10% or worse', test: (r) => r <= -0.10, color: '#7f0000', headBg: '#fadbd8', headTx: '#7f0000' },
                { label: '−10% to −5%', test: (r) => r > -0.10 && r <= -0.05, color: '#c0392b', headBg: '#fadbd8', headTx: '#922b21' },
                { label: '−5% to 0%', test: (r) => r > -0.05 && r < 0, color: '#e67e22', headBg: '#fae5d3', headTx: '#935116' },
                { label: '0% to 5%', test: (r) => r >= 0 && r < 0.05, color: '#2ecc71', headBg: '#d5f5e3', headTx: '#1e8449' },
                { label: '5% to 10%', test: (r) => r >= 0.05 && r < 0.10, color: '#27ae60', headBg: '#d5f5e3', headTx: '#145a32' },
                { label: '10% or better', test: (r) => r >= 0.10, color: '#1e8449', headBg: '#d5f5e3', headTx: '#0e6251' }
            ];
            BUCKETS.forEach(b => { b.items = []; });

            for (let i = 1; i < hist.length; i++) {
                const prev = hist[i - 1];
                if (prev <= 0) continue;
                const r = (hist[i] / prev) - 1;
                const b = BUCKETS.find(bk => bk.test(r));
                if (b) b.items.push({ date: globalDates[i], ret: r });
            }
            BUCKETS.forEach(b => b.items.sort((a, c) => c.ret - a.ret)); // best first
            const total = BUCKETS.reduce((a, b) => a + b.items.length, 0) || 1;

            // --- 2. CHART: colourful bucket-count bars + win-rate note ---
            const chart = echarts.getInstanceByDom(document.getElementById('return-dist-chart')) || echarts.init(document.getElementById('return-dist-chart'));
            chart.setOption({
                ...getBaseChartOptions(),
                tooltip: {
                    trigger: 'axis', axisPointer: { type: 'shadow' },
                    formatter: (p) => {
                        const b = BUCKETS[p[0].dataIndex];
                        const share = ((b.items.length / total) * 100).toFixed(1);
                        return `<b>${b.label}</b><br/>Months: <b>${b.items.length}</b> (${share}%)`;
                    }
                },
                grid: { top: 50, right: 20, bottom: 70, left: 55 },
                xAxis: { type: 'category', data: BUCKETS.map(b => b.label), axisLabel: { interval: 0, rotate: 25 } },
                yAxis: { type: 'value', name: 'Months' },
                series: [{
                    name: 'Months', type: 'bar',
                    data: BUCKETS.map(b => ({ value: b.items.length, itemStyle: { color: b.color, borderRadius: [5, 5, 0, 0] } })),
                    label: { show: true, position: 'top', fontWeight: 'bold' },
                    markLine: {
                        silent: true, symbol: ['none', 'none'],
                        data: [{ xAxis: 2.5 }],
                        lineStyle: { color: '#2c3e50', type: 'dashed', width: 2 },
                        label: { formatter: 'Losses ←  |  → Gains', position: 'insideEndTop', fontWeight: 'bold' }
                    }
                }]
            });

            // --- 3. TABLE: month-wise stack (columns = buckets, best first) ---
            const maxRows = Math.max(...BUCKETS.map(b => b.items.length), 0);
            const dateShort = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
            const dateLong = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

            let thead = '<tr>' + BUCKETS.map(b => {
                const share = ((b.items.length / total) * 100).toFixed(1);
                return `<th style="background-color:${b.headBg}; color:${b.headTx};">${b.label}<br/><small>n=${b.items.length} (${share}%)</small></th>`;
            }).join('') + '</tr>';

            let tbody = '';
            for (let r = 0; r < maxRows; r++) {
                tbody += '<tr>' + BUCKETS.map(b => {
                    const it = b.items[r];
                    if (!it) return '<td></td>';
                    const col = it.ret >= 0 ? '#27ae60' : '#c0392b';
                    return `<td title="${dateLong(it.date)}" style="color:${col}; font-weight:bold;">${(it.ret * 100).toFixed(1)}%<br/><small style="color:#999; font-weight:normal;">${dateShort(it.date)}</small></td>`;
                }).join('') + '</tr>';
            }
            // Averages footer
            tbody += '<tr style="border-top: 2px solid #2c3e50; background-color: #eaf2f8;">' + BUCKETS.map(b => {
                if (!b.items.length) return '<td>—</td>';
                const a = b.items.reduce((s, it) => s + it.ret, 0) / b.items.length;
                const col = a >= 0 ? '#1e8449' : '#922b21';
                return `<td style="color:${col}; font-weight:bold;">avg ${(a * 100).toFixed(1)}%</td>`;
            }).join('') + '</tr>';

            document.querySelector('#return-dist-table thead').innerHTML = thead;
            document.querySelector('#return-dist-table tbody').innerHTML = tbody;

            returnDistSectionNeedsUpdate = false;
            loader.style.display = 'none';
            wrapper.style.display = 'block';

            setTimeout(() => { chart.resize(); }, 100);
        }, 50);
    }

    // Radio switches re-render chart + table for the selected strategy
    document.querySelectorAll('input[name="return-dist-strategy-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            returnDistSectionNeedsUpdate = true;
            if (document.getElementById('return-dist-section').open) {
                renderReturnDist();
            }
        });
    });

    // Collapsed section renders on first open (lazy load)
    document.getElementById('return-dist-section').addEventListener('toggle', function(e) {
        if (this.open && returnDistSectionNeedsUpdate) {
            renderReturnDist();
        }
    });
});
