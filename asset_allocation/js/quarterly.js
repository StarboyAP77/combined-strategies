// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: quarterly heatmap + MoM + avg-rolling charts
import { calculateMonthlyReturnsForRank } from './metrics.js';
import { chartInstances, getBaseChartOptions } from './charts-core.js';
    export function calculateQuarterlyData(dates, historyValues) {
        const years = {};
        
        for(let i=1; i<dates.length; i++) {
            const d = new Date(dates[i]);
            const y = d.getFullYear();
            const m = d.getMonth(); // 0-11
            
            // Determine Quarter (0=Q1, 1=Q2, 2=Q3, 3=Q4)
            const q = Math.floor(m / 3);
            
            if(!years[y]) {
                years[y] = { 
                    quarters: [null, null, null, null], // Q1, Q2, Q3, Q4
                    startVal: null,
                    endVal: null
                };
            }
            
            // Return for this specific month
            const monthlyRet = (historyValues[i] / historyValues[i-1]);
            
            // Initialize Quarter if null
            if(years[y].quarters[q] === null) years[y].quarters[q] = 1.0;
            
            // Compound the return into the quarter
            years[y].quarters[q] *= monthlyRet;
        }
        
        // 2. Format for Table
        const tableRows = [];
        const sortedYears = Object.keys(years).sort((a,b) => b-a); // Descending
        
        sortedYears.forEach(y => {
            const yearData = years[y];
            const quarters = yearData.quarters.map(val => val ? (val - 1) : null); // Convert to % float
            
            // Calculate Annual: Product of quarters
            let annual = 1.0;
            let hasData = false;
            yearData.quarters.forEach(q => {
                if(q !== null) {
                    annual *= q;
                    hasData = true;
                }
            });
            const annualRet = hasData ? (annual - 1) : null;
            
            tableRows.push({
                year: y,
                q1: quarters[0],
                q2: quarters[1],
                q3: quarters[2],
                q4: quarters[3],
                annual: annualRet
            });
        });
        
        return tableRows;
    }

    // Renders the table HTML
    export function renderQuarterlyTable(rows) {
        const tbody = document.querySelector('#quarterly-heatmap-table tbody');
        if(!tbody) return;
        
        let html = '';
        
        const formatPct = (val) => {
            if(val === null) return '<span class="q-neutral">-</span>';
            const pct = (val * 100).toFixed(2) + '%';
            const cls = val >= 0 ? 'q-pos-bg' : 'q-neg-bg';
            return `<td class="${cls}">${pct}</td>`;
        };

        // Helper for Pattern Bars
        const getPatternHtml = (quarters) => {
            let bars = '';
            // Max height pixels for the bar (half height of cell)
            const scaleFactor = 100; // amplification for visuals
            
            quarters.forEach(val => {
                if(val === null) {
                    bars += `<div class="pattern-bar-wrapper"></div>`;
                } else {
                    const height = Math.min(14, Math.abs(val * scaleFactor)); // Cap height at 14px
                    const colorClass = val >= 0 ? 'pattern-pos' : 'pattern-neg';
                    const style = `height: ${Math.max(2, height)}px;`; // Min 2px visibility
                    bars += `<div class="pattern-bar-wrapper"><div class="${colorClass} pattern-bar" style="${style}"></div></div>`;
                }
            });
            return `<td class="pattern-cell">${bars}</td>`;
        };
        
        rows.forEach(row => {
            html += `<tr>`;
            html += `<td><strong>${row.year}</strong></td>`;
            html += getPatternHtml([row.q1, row.q2, row.q3, row.q4]);
            html += formatPct(row.q1);
            html += formatPct(row.q2);
            html += formatPct(row.q3);
            html += formatPct(row.q4);
            html += formatPct(row.annual);
            html += `</tr>`;
        });
        
        tbody.innerHTML = html;
    }

    export function updateQuarterlySection(dates, results) {
        // 1. Radio Button Logic
        const radios = document.querySelectorAll('input[name="quarterly-view-mode"]');
        
        // Define the update logic wrapper to be called by listeners
        const refreshTable = () => {
            const mode = document.querySelector('input[name="quarterly-view-mode"]:checked').value;
            let histData;
            
            if (mode === 'reb') histData = results.standard.reb.historyWithoutWithdrawals;
            else if (mode === 'noReb') histData = results.standard.noReb.historyWithoutWithdrawals;
            else histData = results.standard.benchmark.historyWithoutWithdrawals;
            
            const quartData = calculateQuarterlyData(dates, histData);
            renderQuarterlyTable(quartData);
        };

        // Attach listeners (ensure only once)
        if (!radios[0].hasAttribute('data-listener')) {
            radios.forEach(r => {
                r.setAttribute('data-listener', 'true');
                r.addEventListener('change', refreshTable);
            });
        }

        // Initial Render
        refreshTable();
    }

    export function updateMoMPerformanceChart(filteredData, dates, targetAlloc, rebData, noRebData, benchmarkData, equityOnlyData, goldOnlyData) {
        const chart = chartInstances['mom-rank-chart']; if (!chart || dates.length < 2) return;
        const activeAssets = Object.keys(targetAlloc).filter(k => targetAlloc[k] > 0); if (activeAssets.length === 0) { chart.clear(); return; }
        const monthlyReturnsData = {}, seriesData = {}, allAssetNames = [...activeAssets, 'REBALANCED', 'NON_REBALANCED', 'BENCHMARK', 'EQUITY_ONLY', 'GOLD_ONLY'], uniqueAssets = [...new Set(allAssetNames)];
        uniqueAssets.forEach(asset => { seriesData[asset] = []; });
        allAssetNames.forEach(asset => { let navHistory; if (asset === 'REBALANCED') navHistory = rebData.historyWithoutWithdrawals; else if (asset === 'NON_REBALANCED') navHistory = noRebData.historyWithoutWithdrawals; else if (asset === 'BENCHMARK') navHistory = benchmarkData; else if (asset === 'EQUITY_ONLY') navHistory = equityOnlyData; else if (asset === 'GOLD_ONLY') navHistory = goldOnlyData; else if (asset === 'EQUITY_ONLY') navHistory = equityOnlyData; else if (asset === 'GOLD_ONLY') navHistory = goldOnlyData; else { const firstValue = filteredData[0][asset] || 1; navHistory = filteredData.map(d => (d[asset] / firstValue) * 100); } monthlyReturnsData[asset] = calculateMonthlyReturnsForRank(navHistory); });
        const monthlyRankData = {}; allAssetNames.forEach(asset => monthlyRankData[asset] = []);
        const monthCount = monthlyReturnsData[allAssetNames[0]].length;
        for (let i = 0; i < monthCount; i++) {
            const rankedForMonth = allAssetNames.map(asset => ({ name: asset, return: monthlyReturnsData[asset][i] })).sort((a, b) => b.return - a.return);
            rankedForMonth.forEach((assetData, rankIndex) => { monthlyRankData[assetData.name].push({ rank: rankIndex + 1, return: assetData.return }); });
        }
        const ASSET_CHART_COLORS = { EQUITY: 'green', BOND: 'blue', GOLD: '#DAA520', NASDAQ: '#e53935', REBALANCED: '#ff8f00', NON_REBALANCED: '#d81b60', BENCHMARK: 'grey', EQUITY_ONLY: '#006400', GOLD_ONLY: '#b8912a' };
        const series = allAssetNames.map(assetName => { let displayName = assetName; if (assetName === 'REBALANCED') displayName = 'Rebalanced'; else if (assetName === 'NON_REBALANCED') displayName = 'Non-Rebalanced'; else if (assetName === 'EQUITY_ONLY') displayName = 'Equity Only'; else if (assetName === 'GOLD_ONLY') displayName = 'Gold Only'; return { name: displayName, type: 'line', smooth: true, symbol: 'none', data: monthlyRankData[assetName].map(d => ({ value: d.rank, originalReturn: d.return })), lineStyle: { width: 2.5, color: ASSET_CHART_COLORS[assetName] || 'black' }, itemStyle: { color: ASSET_CHART_COLORS[assetName] || 'black' } }; });
        const legendSelected = {}; uniqueAssets.forEach(asset => { let displayName = asset; if (asset === 'REBALANCED') displayName = 'Rebalanced'; else if (asset === 'NON_REBALANCED') displayName = 'Non-Rebalanced'; else if (asset === 'EQUITY_ONLY') displayName = 'Equity Only'; else if (asset === 'GOLD_ONLY') displayName = 'Gold Only'; if (asset === 'EQUITY' || asset === 'GOLD' || asset === 'BOND' || asset === 'NON_REBALANCED') legendSelected[displayName] = false; else legendSelected[displayName] = true; });
        const option = { ...getBaseChartOptions(), legend: { ...getBaseChartOptions().legend, selected: legendSelected, }, title: { text: 'Month-on-Month Asset Performance Rank' }, tooltip: { trigger: 'axis', formatter: (params) => { let tooltipText = `<b>${params[0].axisValueLabel}</b><br/>`; params.sort((a, b) => a.value - b.value); params.forEach(param => { tooltipText += `${param.marker} Rank ${param.value}: ${param.seriesName} (${param.data.originalReturn.toFixed(2)}%)<br/>`; }); return tooltipText; } }, grid: { left: 40, right: 40, top: 80, bottom: 60 }, xAxis: { type: 'category', boundaryGap: false, data: dates.slice(1).map(d => new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })) }, yAxis: { type: 'value', inverse: true, min: 1, max: allAssetNames.length, axisLabel: { formatter: 'Rank {value}' } }, series: series };
        chart.setOption(option, true);
    }


    export function updateAvgRollingReturnsChart(rebData, noRebData, benchmarkData, equityOnlyData, goldOnlyData) {
        const chartDom = document.getElementById('avg-rolling-returns-chart');
        if(!chartDom) return;
        let chart = echarts.getInstanceByDom(chartDom);
        if(!chart) chart = echarts.init(chartDom);

        const horizons = Array.from({length: 12}, (_, i) => i + 1); // [1, 2, ..., 12]
        
        // Helper to calculate Average Rolling Return for a specific month window
        const calcAvgForWindow = (history, months) => {
            let sum = 0;
            let count = 0;
            
            for(let i = months; i < history.length; i++) {
                const startVal = history[i - months];
                const endVal = history[i];
                
                if(startVal > 0) {
                    // Absolute return for this specific window
                    const ret = (endVal / startVal) - 1;
                    sum += ret;
                    count++;
                }
            }
            return count > 0 ? (sum / count) * 100 : 0;
        };

        const pData = [];
        const nrData = [];
        const bData = [];
        const eqData = [];
        const gdData = [];

        // Calculate for 1 to 12 months
        horizons.forEach(h => {
            pData.push(calcAvgForWindow(rebData.historyWithoutWithdrawals, h).toFixed(2));
            nrData.push(calcAvgForWindow(noRebData.historyWithoutWithdrawals, h).toFixed(2));
            bData.push(calcAvgForWindow(benchmarkData.historyWithoutWithdrawals, h).toFixed(2));
            eqData.push(calcAvgForWindow(equityOnlyData.historyWithoutWithdrawals, h).toFixed(2));
            gdData.push(calcAvgForWindow(goldOnlyData.historyWithoutWithdrawals, h).toFixed(2));
        });

        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: (params) => {
                    let txt = `<b>${params[0].axisValue} Average Return</b><br/>`;
                    params.forEach(p => {
                        txt += `${p.marker} ${p.seriesName}: <b>${p.value}%</b><br/>`;
                    });
                    return txt;
                }
            },
            legend: { data: ['Rebalanced', 'Non-Rebalanced', 'Benchmark', 'Equity Only', 'Gold Only'], bottom: 0 },
            xAxis: { 
                type: 'category', 
                data: horizons.map(h => `${h} Mo`),
                axisLabel: { interval: 0 }
            },
            yAxis: { name: 'Average Return %', type: 'value' },
            series: [
                {
                    name: 'Rebalanced',
                    type: 'bar',
                    data: pData,
                    itemStyle: { color: 'rgb(54, 162, 235)' }, // Blue
                    barGap: '0%' 
                },
                {
                    name: 'Non-Rebalanced',
                    type: 'bar',
                    data: nrData,
                    itemStyle: { color: 'rgb(255, 99, 132)' } // Red/Pink
                },
                {
                    name: 'Benchmark',
                    type: 'bar',
                    data: bData,
                    itemStyle: { color: 'rgb(156, 156, 156)' } // Grey
                },
                {
                    name: 'Equity Only',
                    type: 'bar',
                    data: eqData,
                    itemStyle: { color: 'rgb(0, 100, 0)' }
                },
                {
                    name: 'Gold Only',
                    type: 'bar',
                    data: gdData,
                    itemStyle: { color: 'rgb(218, 165, 32)' }
                }
            ],
            grid: { top: 30, right: 20, bottom: 40, left: 50 }
        };

        chart.setOption(option);
    }


    // ==========================================
    // 💰 DEPLOYMENT BATTLE ENGINE
    // ==========================================
