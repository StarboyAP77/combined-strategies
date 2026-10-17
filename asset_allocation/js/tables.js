// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: HTML data tables (ledger/master/SIP/correlation/yearly)
import { calculateYearlyReturns } from './metrics.js';
import { chartInstances, drawPerformanceLines, formatCurrency, getBaseChartOptions } from './charts-core.js';
export function updateRebalanceLogTable(rebalanceEvents) {
    const tbody = document.querySelector("#rebalance-log-table tbody");
    if (!tbody) return;
    
    let html = '';
    const reversedEvents = rebalanceEvents;

    reversedEvents.forEach(event => {
        if (!event.transactions || event.transactions.length === 0) return;

        const dateStr = new Date(event.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        
        const sells = event.transactions.filter(t => t.amount < 0);
        const buys = event.transactions.filter(t => t.amount > 0);

        if (sells.length === 0 && buys.length === 0) return;

        // Formatter for Sell Column (With Profit/Loss Tags)
        const formatSells = (items) => items.map(i => {
            const val = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.abs(i.amount));
            const tagClass = i.status === 'Profit' ? 'tag-profit' : (i.status === 'Loss' ? 'tag-loss' : '');
            const tagLabel = i.status === 'Profit' ? 'PROFIT' : (i.status === 'Loss' ? 'LOSS' : '');
            
            // Don't show tag if Neutral/Unknown
            const tagHtml = tagLabel ? `<span class="${tagClass}">${tagLabel}</span>` : '';
            
            return `<div style="margin-bottom:6px;">
                      <b>${i.asset}</b><br/>
                      <span style="color:#c0392b">${val}</span> ${tagHtml}
                    </div>`;
        }).join('');

        // Formatter for Buy Column (Just Asset)
        const formatBuys = (items) => items.map(i => `<div style="margin-bottom:6px;"><b>${i.asset}</b></div>`).join('');
        
        const totalShift = buys.reduce((sum, item) => sum + item.percentChange, 0);

        html += `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="font-weight:600; color:#555; vertical-align:middle;">${dateStr}</td>
                
                <!-- SELL COLUMN (Includes Amount & Status) -->
                <td style="text-align:left; padding:10px;">${formatSells(sells)}</td>
                
                <!-- BUY COLUMN (Asset Name Only) -->
                <td style="text-align:left; padding:10px; color:#27ae60;">${formatBuys(buys)}</td>
                
                <!-- IMPACT -->
                <td style="vertical-align:middle; font-weight:bold; color:#555;">
                    ${totalShift.toFixed(2)}%
                </td>
            </tr>
        `;
    });

    if (reversedEvents.length === 0) {
        html = '<tr><td colspan="4" style="text-align:center; padding:20px;">No rebalancing events triggered yet.</td></tr>';
    }

    tbody.innerHTML = html;
}

export function renderCorrelationMatrix(data, containerId) {
    const { assets, matrix } = data; const container = document.getElementById(containerId);
    if (!assets || assets.length === 0) { container.innerHTML = "<p>Not enough data to calculate correlation.</p>"; return; }
    const getColor = (v) => `rgb(${v > 0 ? 255 - v * 255 : 255},${v < 0 ? 255 + v * 255 : 255},${255 - Math.abs(v) * 255})`;
    let table = '<table><thead><tr><th>&nbsp;</th>'; assets.forEach(asset => table += `<th>${asset}</th>`); table += '</tr></thead><tbody>';
    matrix.forEach((row, i) => { table += `<tr><th>${assets[i]}</th>`; row.forEach(val => { table += `<td style="background-color: ${getColor(val)}">${val.toFixed(2)}</td>`; }); table += '</tr>'; });
    container.innerHTML = table + '</tbody></table>';
}

    export function updateYearlyPerformanceTable(filteredData, dates, targetAlloc, rebNAV, noRebNAV, benchmarkNAV, equityOnlyNAV, goldOnlyNAV) {
        const container = document.getElementById('yearly-performance-container'), table = document.getElementById('yearly-performance-table'); const activeAssets = Object.keys(targetAlloc).filter(k => targetAlloc[k] > 0);
        if (activeAssets.length === 0) { container.parentElement.style.display = 'none'; return; }
        container.parentElement.style.display = 'block'; const performanceData = {};
        activeAssets.forEach(asset => { const firstValue = filteredData[0][asset]; if (firstValue <= 0) return; const assetNAV = filteredData.map(d => (d[asset] / firstValue) * 100); const yearlyReturns = calculateYearlyReturns(assetNAV, dates); yearlyReturns.labels.forEach((year, i) => { if (!performanceData[year]) performanceData[year] = []; performanceData[year].push({ name: asset, return: yearlyReturns.data[i] }); }); });
        const rebYearlyReturns = calculateYearlyReturns(rebNAV.historyWithoutWithdrawals, dates); rebYearlyReturns.labels.forEach((year, i) => { if (!performanceData[year]) performanceData[year] = []; performanceData[year].push({ name: 'REBALANCED', return: rebYearlyReturns.data[i] }); });
        const noRebYearlyReturns = calculateYearlyReturns(noRebNAV.historyWithoutWithdrawals, dates); noRebYearlyReturns.labels.forEach((year, i) => { if (!performanceData[year]) performanceData[year] = []; performanceData[year].push({ name: 'NON_REBALANCED', return: noRebYearlyReturns.data[i] }); });
        const benchmarkYearlyReturns = calculateYearlyReturns(benchmarkNAV, dates); benchmarkYearlyReturns.labels.forEach((year, i) => { if (!performanceData[year]) performanceData[year] = []; performanceData[year].push({ name: 'BENCHMARK', return: benchmarkYearlyReturns.data[i] }); });
        if (equityOnlyNAV) { const eqYearlyReturns = calculateYearlyReturns(equityOnlyNAV, dates); eqYearlyReturns.labels.forEach((year, i) => { if (!performanceData[year]) performanceData[year] = []; performanceData[year].push({ name: 'EQUITY_ONLY', return: eqYearlyReturns.data[i] }); }); }
        if (goldOnlyNAV) { const gdYearlyReturns = calculateYearlyReturns(goldOnlyNAV, dates); gdYearlyReturns.labels.forEach((year, i) => { if (!performanceData[year]) performanceData[year] = []; performanceData[year].push({ name: 'GOLD_ONLY', return: gdYearlyReturns.data[i] }); }); }
        const sortedYears = Object.keys(performanceData).sort(); sortedYears.forEach(year => { performanceData[year].sort((a, b) => b.return - a.return); });
        if (sortedYears.length === 0) { container.parentElement.style.display = 'none'; return; }
        table.querySelector('thead').innerHTML = `<tr>${sortedYears.map(y => `<th>${y}</th>`).join('')}</tr>`;
        const tbody = table.querySelector('tbody'); tbody.innerHTML = '';
        const maxRows = Math.max(0, ...Object.values(performanceData).map(arr => arr.length));
        for (let i = 0; i < maxRows; i++) {
            const row = document.createElement('tr');
            sortedYears.forEach(year => { const cellData = performanceData[year][i], td = document.createElement('td'); if (cellData) { let assetNameDisplay = cellData.name; if(assetNameDisplay === 'REBALANCED') assetNameDisplay = 'Rebalanced'; else if(assetNameDisplay === 'NON_REBALANCED') assetNameDisplay = 'Non-Rebalanced'; else if(assetNameDisplay === 'BENCHMARK') assetNameDisplay = 'Benchmark'; else if(assetNameDisplay === 'EQUITY_ONLY') assetNameDisplay = 'Equity Only'; else if(assetNameDisplay === 'GOLD_ONLY') assetNameDisplay = 'Gold Only'; td.innerHTML = `<div class="asset-color-${cellData.name}" data-asset="${cellData.name}"><span class="asset-name">${assetNameDisplay}</span><span class="asset-return">${cellData.return.toFixed(1)}%</span></div>`; } row.appendChild(td); });
            tbody.appendChild(row);
        }
        setTimeout(drawPerformanceLines, 0);
        return { performanceData, sortedYears };
    }
    export function updateYoYPerformanceChart(performanceData, sortedYears) {
        const chart = chartInstances['yoy-rank-chart']; if (!chart || sortedYears.length === 0) return;
        const seriesData = {}, allAssets = Object.values(performanceData).flat().map(d => d.name), uniqueAssets = [...new Set(allAssets)];
        uniqueAssets.forEach(asset => { seriesData[asset] = []; });
        sortedYears.forEach(year => { const yearlyRanks = performanceData[year]; yearlyRanks.forEach((assetData, index) => { seriesData[assetData.name].push({ rank: index + 1, return: assetData.return }); }); });
        const legendSelected = {}; uniqueAssets.forEach(asset => { let displayName = asset; if (asset === 'REBALANCED') displayName = 'Rebalanced'; else if (asset === 'NON_REBALANCED') displayName = 'Non-Rebalanced'; else if (asset === 'EQUITY_ONLY') displayName = 'Equity Only'; else if (asset === 'GOLD_ONLY') displayName = 'Gold Only'; if (asset === 'EQUITY' || asset === 'GOLD' || asset === 'BOND' || asset === 'NON_REBALANCED') legendSelected[displayName] = false; else legendSelected[displayName] = true; });
        const ASSET_CHART_COLORS = { EQUITY: 'green', BOND: 'blue', GOLD: '#DAA520', NASDAQ: '#e53935', REBALANCED: '#ff8f00', NON_REBALANCED: '#d81b60', BENCHMARK: 'grey', EQUITY_ONLY: '#006400', GOLD_ONLY: '#b8912a' };
        const series = Object.keys(seriesData).map(assetName => { let displayName = assetName; if (assetName === 'REBALANCED') displayName = 'Rebalanced'; else if (assetName === 'NON_REBALANCED') displayName = 'Non-Rebalanced'; else if (assetName === 'EQUITY_ONLY') displayName = 'Equity Only'; else if (assetName === 'GOLD_ONLY') displayName = 'Gold Only'; return { name: displayName, type: 'line', smooth: 0.3, symbol: 'circle', symbolSize: 8, data: seriesData[assetName].map(d => ({ value: d.rank, originalReturn: d.return })), lineStyle: { width: 3, color: ASSET_CHART_COLORS[assetName] || 'black' }, itemStyle: { color: ASSET_CHART_COLORS[assetName] || 'black' } }; });
        const option = { ...getBaseChartOptions(), legend: { ...getBaseChartOptions().legend, selected: legendSelected, }, title: { text: 'Year-on-Year Asset Performance Rank' }, tooltip: { trigger: 'axis', formatter: (params) => { let tooltipText = `<b>${params[0].axisValueLabel}</b><br/>`; params.sort((a, b) => a.value - b.value); params.forEach(param => { tooltipText += `${param.marker} Rank ${param.value}: ${param.seriesName} (${param.data.originalReturn.toFixed(1)}%)<br/>`; }); return tooltipText; } }, grid: { left: 40, right: 40, top: 80, bottom: 60 }, xAxis: { type: 'category', data: sortedYears, boundaryGap: false, }, yAxis: { type: 'value', inverse: true, min: 1, max: uniqueAssets.length, axisLabel: { formatter: 'Rank {value}' } }, series: series };
        chart.setOption(option, true);
    }

    export function updateMasterLedger(ledgerData, targetAlloc) {
        const tbody = document.querySelector("#master-ledger-table tbody");
        if (!tbody) return;
        
        if (!ledgerData || ledgerData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No transactions yet.</td></tr>';
            return;
        }

        // Sort by date descending (newest first)
        const sortedLog = [...ledgerData].sort((a, b) => new Date(b.date) - new Date(a.date));
        
        let html = '';
        
        sortedLog.forEach(row => {
            const dateStr = new Date(row.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
            const amountStr = row.amount > 0 ? formatCurrency(row.amount) : '-';
            
            let rowClass = 'row-withdrawal';
            let eventLabel = 'Withdrawal';
            let detailsHtml = '';
            
            if (row.type === 'WITHDRAWAL') {
                rowClass = row.isCrash ? 'row-crash' : 'row-withdrawal';
                eventLabel = row.isCrash ? '🔥 CRASH BURN' : '💰 Withdrawal';
                
                // Build Source Badges
                if(row.sources) {
                    row.sources.forEach(src => {
                        let badgeClass = src.asset === 'EQUITY' ? 'badge-equity' : (src.asset === 'GOLD' ? 'badge-gold' : 'badge-bunker');
                        detailsHtml += `<span class="badge ${badgeClass}">${src.asset}: ${formatCurrency(src.amount)}</span> `;
                    });
                }
            } 
            else if (row.type === 'REBALANCE') {
                rowClass = 'row-rebalance';
                eventLabel = '⚖️ Rebalance';
                detailsHtml = `Portfolio Re-aligned (Moved ~${amountStr})`;
            }
            else if (row.type === 'REFILL') {
                rowClass = 'row-rebalance'; // Reuse blue
                eventLabel = '🐿️ Bunker Refill';
                detailsHtml = `<span class="badge badge-equity">Sold Equity</span> ➔ <span class="badge badge-bunker">Bunker</span>`;
            }
            else if (row.type === 'SKIPPED') {
                rowClass = 'row-skipped';
                eventLabel = '🛡️ Skipped';
                detailsHtml = `<span style="color:#2ecc71; font-style:italic;">No action needed.</span>`;
            }

            const eqValStr = row.equityVal ? formatCurrency(row.equityVal) : '-';
            const gdValStr = row.goldVal ? formatCurrency(row.goldVal) : '-';
            const totValStr = row.totalVal ? formatCurrency(row.totalVal) : '-';

            html += `
                <tr class="${rowClass}">
                    <td><strong>${dateStr}</strong></td>
                    <td>${eventLabel}</td>
                    <td>${detailsHtml}</td>
                    <td style="font-size:12px; color:#555;">${row.reason || ''}</td>
                    <td style="font-size:12px; font-family:monospace;">${amountStr}</td>
                    <td style="font-size:12px; font-family:monospace; color:#27ae60;">${eqValStr}</td>
                    <td style="font-size:12px; font-family:monospace; color:#dcb000;">${gdValStr}</td>
                    <td style="font-size:12px; font-family:monospace; font-weight:bold;">${totValStr}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    // --- REUSABLE YEARLY PATH (SPAGHETTI) CHART ---
    export function updateGrowthDynamicSipTable(growthSipLog, monthlySipAmount) {
        const container = document.getElementById('growth-dynamic-sip-analysis-container');
        const tableBody = document.querySelector("#growth-dynamic-sip-log-table tbody");
        const summaryDiv = document.getElementById('growth-dynamic-sip-summary');
        const investmentMethod = document.querySelector('input[name="investment-method"]:checked').value;

        if (!container || !tableBody || !summaryDiv || investmentMethod !== 'growthDynamicSip' || !growthSipLog || growthSipLog.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        let tableHtml = '';
        let equitySipCount = 0;
        let goldSipCount = 0;

        growthSipLog.forEach(log => {
            if (log.investedIn === 'EQUITY') equitySipCount++;
            if (log.investedIn === 'GOLD') goldSipCount++;
            
            const formatPercent = (val) => {
                const color = val >= 0 ? '#2e7d32' : '#e53935';
                return `<span style="color: ${color};">${val.toFixed(2)}%</span>`;
            };
            
            tableHtml += `
                <tr>
                    <td>${new Date(log.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</td>
                    <td><b>${log.investedIn}</b></td>
                    <td>${formatPercent(log.equityReturn)}</td>
                    <td>${formatPercent(log.goldReturn)}</td>
                    <td>${log.reason}</td>
                </tr>
            `;
        });

        tableBody.innerHTML = tableHtml;

        const totalEquityInvestment = equitySipCount * monthlySipAmount;
        const totalGoldInvestment = goldSipCount * monthlySipAmount;
        
        summaryDiv.innerHTML = `
            <table class="metrics-table">
                <thead><tr><th>Metric</th><th>Equity</th><th>Gold</th></tr></thead>
                <tbody>
                    <tr><td>No. of SIPs</td><td>${equitySipCount}</td><td>${goldSipCount}</td></tr>
                    <tr><td>Total Amount Invested</td><td>${formatCurrency(totalEquityInvestment)}</td><td>${formatCurrency(totalGoldInvestment)}</td></tr>
                </tbody>
            </table>
        `;
    }

    export function updateValueDynamicSipTable(dynamicSipLog, monthlySipAmount) {
        const container = document.getElementById('dynamic-sip-analysis-container');
        const tableBody = document.querySelector("#dynamic-sip-log-table tbody");
        const summaryDiv = document.getElementById('dynamic-sip-summary');
        const investmentMethod = document.querySelector('input[name="investment-method"]:checked').value;

         if (!container || !tableBody || !summaryDiv || investmentMethod !== 'valueDynamicSip' || !dynamicSipLog || dynamicSipLog.length === 0) {
            container.style.display = 'none'; // Hide the table if not dynamic SIP
            return;
        }

        container.style.display = 'block'; // Show the table
        let tableHtml = '';
        let equitySipCount = 0;
        let goldSipCount = 0;

        dynamicSipLog.forEach(log => {
            if (log.investedIn === 'EQUITY') equitySipCount++;
            if (log.investedIn === 'GOLD') goldSipCount++;
            
            const formatPercent = (val) => {
                const color = val >= 0 ? '#2e7d32' : '#e53935';
                return `<span style="color: ${color};">${val.toFixed(2)}%</span>`;
            };
            
            tableHtml += `
                <tr>
                    <td>${new Date(log.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</td>
                    <td><b>${log.investedIn}</b></td>
                    <td>${formatPercent(log.equityReturn)}</td>
                    <td>${formatPercent(log.goldReturn)}</td>
                    <td>${log.reason}</td>
                </tr>
            `;
        });

        tableBody.innerHTML = tableHtml;

        // Calculate and display summary
        const totalEquityInvestment = equitySipCount * monthlySipAmount;
        const totalGoldInvestment = goldSipCount * monthlySipAmount;
        
        summaryDiv.innerHTML = `
            <table class="metrics-table">
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Equity</th>
                        <th>Gold</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>No. of SIPs</td>
                        <td>${equitySipCount}</td>
                        <td>${goldSipCount}</td>
                    </tr>
                    <tr>
                        <td>Total Amount Invested</td>
                        <td>${formatCurrency(totalEquityInvestment)}</td>
                        <td>${formatCurrency(totalGoldInvestment)}</td>
                    </tr>
                </tbody>
            </table>
        `;
    }

    export function updateCorrelatedDownturnsTable(filteredData, dates, rebData) {
        const tableBody = document.querySelector("#correlated-downturns-table tbody");
        if (!tableBody) return;

        const downturns = [];
        const rebHistory = rebData.historyWithoutWithdrawals;
        const portfolioCompositionHistory = rebData.portfolioCompositionHistory;

        // Start from the second data point to calculate returns
        for (let i = 1; i < filteredData.length; i++) {
            const prevEquityPrice = filteredData[i - 1].EQUITY;
            const currEquityPrice = filteredData[i].EQUITY;
            const prevGoldPrice = filteredData[i - 1].GOLD;
            const currGoldPrice = filteredData[i].GOLD;
            
            if (prevEquityPrice > 0 && prevGoldPrice > 0) {
                const equityReturn = (currEquityPrice / prevEquityPrice) - 1;
                const goldReturn = (currGoldPrice / prevGoldPrice) - 1;

                // Check for the core condition: both assets fell
                if (equityReturn < 0 && goldReturn < 0) {
                    const prevPortfolioValue = rebHistory[i - 1];
                    const currPortfolioValue = rebHistory[i];
                    const portfolioReturn = (currPortfolioValue / prevPortfolioValue) - 1;

                    const prevPortfolioComposition = portfolioCompositionHistory[i - 1];
                    const prevEquityValue = prevPortfolioComposition.EQUITY || 0;
                    const prevGoldValue = prevPortfolioComposition.GOLD || 0;
                    
                    const equityRupeeFall = prevEquityValue * equityReturn;
                    const goldRupeeFall = prevGoldValue * goldReturn;
                    const portfolioRupeeFall = prevPortfolioValue * portfolioReturn;

                    const calculateFutureReturn = (months) => {
                        if (i + months < rebHistory.length) {
                            const futureValue = rebHistory[i + months];
                            return ((futureValue / currPortfolioValue) - 1) * 100;
                        }
                        return null; // Not enough data
                    };

                    downturns.push({
                        date: dates[i],
                        equityReturn,
                        goldReturn,
                        portfolioReturn,
                        equityRupeeFall,
                        goldRupeeFall,
                        portfolioRupeeFall,
                        return3M: calculateFutureReturn(3),
                        return6M: calculateFutureReturn(6),
                        return12M: calculateFutureReturn(12),
                        return24M: calculateFutureReturn(24),
                    });
                }
            }
        }

        if (downturns.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center;">No months found where both Equity and Gold fell together in this period.</td></tr>`;
            return;
        }

        let tableHtml = '';
        downturns.forEach(d => {
            const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
            const formatPercent = (val) => val !== null ? `<span style="color: #e53935;">${(val * 100).toFixed(2)}%</span>` : 'N/A';
            const formatFuturePercent = (val) => {
                if (val === null) return 'N/A';
                const color = val > 0 ? '#2e7d32' : '#e53935';
                return `<span style="color: ${color};">${val.toFixed(2)}%</span>`;
            };
            const formatLoss = (val) => `<span style="color: #e53935;">${formatCurrency(val)}</span>`;

            tableHtml += `
                <tr>
                    <td>${formatDate(d.date)}</td>
                    <td>${formatPercent(d.equityReturn)}</td>
                    <td>${formatPercent(d.goldReturn)}</td>
                    <td><b>${formatPercent(d.portfolioReturn)}</b></td>
                    <td>${formatLoss(d.equityRupeeFall)}</td>
                    <td>${formatLoss(d.goldRupeeFall)}</td>
                    <td><b>${formatLoss(d.portfolioRupeeFall)}</b></td>
                    <td>${formatFuturePercent(d.return3M)}</td>
                    <td>${formatFuturePercent(d.return6M)}</td>
                    <td>${formatFuturePercent(d.return12M)}</td>
                    <td>${formatFuturePercent(d.return24M)}</td>
                </tr>
            `;
        });
        
        tableBody.innerHTML = tableHtml;
    }

    export function updateCorrelatedUpturnsTable(filteredData, dates, rebData) {
        const tableBody = document.querySelector("#correlated-upturns-table tbody");
        if (!tableBody) return;

        const upturns = [];
        const rebHistory = rebData.historyWithoutWithdrawals;
        const portfolioCompositionHistory = rebData.portfolioCompositionHistory;

        // Start from the second data point to calculate returns
        for (let i = 1; i < filteredData.length; i++) {
            const prevEquityPrice = filteredData[i - 1].EQUITY;
            const currEquityPrice = filteredData[i].EQUITY;
            const prevGoldPrice = filteredData[i - 1].GOLD;
            const currGoldPrice = filteredData[i].GOLD;
            
            if (prevEquityPrice > 0 && prevGoldPrice > 0) {
                const equityReturn = (currEquityPrice / prevEquityPrice) - 1;
                const goldReturn = (currGoldPrice / prevGoldPrice) - 1;

                // Check for the core condition: both assets rose
                if (equityReturn > 0 && goldReturn > 0) {
                    const prevPortfolioValue = rebHistory[i - 1];
                    const currPortfolioValue = rebHistory[i];
                    const portfolioReturn = (currPortfolioValue / prevPortfolioValue) - 1;

                    const prevPortfolioComposition = portfolioCompositionHistory[i - 1];
                    const prevEquityValue = prevPortfolioComposition.EQUITY || 0;
                    const prevGoldValue = prevPortfolioComposition.GOLD || 0;
                    
                    const equityRupeeGain = prevEquityValue * equityReturn;
                    const goldRupeeGain = prevGoldValue * goldReturn;
                    const portfolioRupeeGain = prevPortfolioValue * portfolioReturn;

                    const calculateFutureReturn = (months) => {
                        if (i + months < rebHistory.length) {
                            const futureValue = rebHistory[i + months];
                            return ((futureValue / currPortfolioValue) - 1) * 100;
                        }
                        return null; // Not enough data
                    };

                    upturns.push({
                        date: dates[i],
                        equityReturn,
                        goldReturn,
                        portfolioReturn,
                        equityRupeeGain,
                        goldRupeeGain,
                        portfolioRupeeGain,
                        return3M: calculateFutureReturn(3),
                        return6M: calculateFutureReturn(6),
                        return12M: calculateFutureReturn(12),
                        return24M: calculateFutureReturn(24),
                    });
                }
            }
        }

        if (upturns.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center;">No months found where both Equity and Gold rose together in this period.</td></tr>`;
            return;
        }

        let tableHtml = '';
        upturns.forEach(d => {
            const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
            // Green for positive gains
            const formatPercent = (val) => val !== null ? `<span style="color: #2e7d32;">${(val * 100).toFixed(2)}%</span>` : 'N/A';
            const formatFuturePercent = (val) => {
                if (val === null) return 'N/A';
                const color = val > 0 ? '#2e7d32' : '#e53935';
                return `<span style="color: ${color};">${val.toFixed(2)}%</span>`;
            };
            const formatGain = (val) => `<span style="color: #2e7d32;">${formatCurrency(val)}</span>`;

            tableHtml += `
                <tr>
                    <td>${formatDate(d.date)}</td>
                    <td>${formatPercent(d.equityReturn)}</td>
                    <td>${formatPercent(d.goldReturn)}</td>
                    <td><b>${formatPercent(d.portfolioReturn)}</b></td>
                    <td>${formatGain(d.equityRupeeGain)}</td>
                    <td>${formatGain(d.goldRupeeGain)}</td>
                    <td><b>${formatGain(d.portfolioRupeeGain)}</b></td>
                    <td>${formatFuturePercent(d.return3M)}</td>
                    <td>${formatFuturePercent(d.return6M)}</td>
                    <td>${formatFuturePercent(d.return12M)}</td>
                    <td>${formatFuturePercent(d.return24M)}</td>
                </tr>
            `;
        });
        
        tableBody.innerHTML = tableHtml;
    }
