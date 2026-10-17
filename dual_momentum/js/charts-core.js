// 31/js/charts-core.js — main/withdrawal/drawdown, yearly/monthly, metrics/trade tables
// Plain script, shared globals. Load after engine.js/utils.js. Dataset is provided by app.js from js/data.json.

    function createYearlyPerformanceChart(chartId, title, yearlyData, avgReturn, avgDD) {
        if (noEcharts('yearly:' + chartId)) return;
        const _el = document.getElementById(chartId);
        if (noEl(_el, 'yearly:' + chartId)) return;
        let existingChart = echarts.getInstanceByDom(_el);
        if (existingChart) existingChart.dispose();
        const myChart = echarts.init(_el);
        const option = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p) => { let r = `${p[0].name}<br/>`; p.forEach(i => { r += `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${i.color};"></span>${i.seriesName}: ${i.value}%<br/>`; }); return r; } },
            legend: { data: ['Yearly Return', 'Yearly Max DD'], bottom: 10 },
            grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
            xAxis: { type: 'category', data: yearlyData.map(d => d.year) },
            yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
            series: [
                { name: 'Yearly Return', type: 'bar', itemStyle: { color: 'rgba(75, 192, 192, 0.8)' }, data: yearlyData.map(d => (d.return * 100).toFixed(2)), markLine: { silent: true, symbol: 'none', data: [{ yAxis: (avgReturn * 100).toFixed(2), name: 'Avg Return' }], lineStyle: { type: 'dotted', color: '#28a745' }, label: { formatter: 'Avg: {c}%', position: 'end', color: '#28a745', fontWeight: 'bold' } } },
                { name: 'Yearly Max DD', type: 'bar', itemStyle: { color: 'rgba(255, 99, 132, 0.7)' }, data: yearlyData.map(d => (d.maxDD * -100).toFixed(2)), markLine: { silent: true, symbol: 'none', data: [{ yAxis: (avgDD * -100).toFixed(2), name: 'Avg Max DD' }], lineStyle: { type: 'dotted', color: '#dc3545' }, label: { formatter: 'Avg: {c}%', position: 'end', color: '#dc3545', fontWeight: 'bold' } } }
            ]
        };
        myChart.setOption(option);
    }

    function createMonthlyPerformanceChart(chartId, title, monthlyData, avgReturn, avgDD) {
        if (noEcharts('monthly:' + chartId)) return;
        const _el = document.getElementById(chartId);
        if (noEl(_el, 'monthly:' + chartId)) return;
        let existingChart = echarts.getInstanceByDom(_el);
        if (existingChart) existingChart.dispose();
        const myChart = echarts.init(_el);
        const option = {
            title: { text: title, left: 'center' },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p) => { if (!p || p.length === 0) return ''; let r = `${p[0].name}<br/>`; p.forEach(i => { r += `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${i.color};"></span>${i.seriesName}: ${i.value}%<br/>`; }); return r; } },
            legend: { data: ['Monthly Return', 'Monthly Max DD'], bottom: 10 },
            grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
            xAxis: { type: 'category', data: monthlyData.map(d => d.month), axisLabel: { rotate: 45 } },
            yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
            series: [
                { name: 'Monthly Return', type: 'bar', itemStyle: { color: 'rgba(75, 192, 192, 0.8)' }, data: monthlyData.map(d => (d.return * 100).toFixed(2)), markLine: { silent: true, symbol: 'none', data: [{ yAxis: (avgReturn * 100).toFixed(2), name: 'Avg Return' }], lineStyle: { type: 'dotted', color: '#28a745' }, label: { formatter: 'Avg: {c}%', position: 'end', color: '#28a745', fontWeight: 'bold' } } },
                { name: 'Monthly Max DD', type: 'bar', itemStyle: { color: 'rgba(255, 99, 132, 0.7)' }, data: monthlyData.map(d => (d.maxDD * 100).toFixed(2)), markLine: { silent: true, symbol: 'none', data: [{ yAxis: (avgDD * 100).toFixed(2), name: 'Avg Max DD' }], lineStyle: { type: 'dotted', color: '#dc3545' }, label: { formatter: 'Avg: {c}%', position: 'end', color: '#dc3545', fontWeight: 'bold' } } }
            ]
        };
        myChart.setOption(option);
    }

    function updateMetricsTable(data) {
        const tableBody = document.querySelector('#metricsTable tbody');
        if (noEl(tableBody, 'metrics-table')) return;
        tableBody.innerHTML = '';
        // CRIT-11: no innerHTML interpolation of data — build cells, set textContent.
        // WARN-09: no local formatINR, use shared fmtINRv/fmtPct/fmtNum.
        const mkTd = (text, className) => {
            const td = document.createElement('td');
            if (className) td.className = className;
            td.textContent = text == null ? '' : String(text);
            return td;
        };
        const metrics = [
            { key: 'cagr', label: 'Absolute CAGR', format: 'pct' }, { key: 'avgRollingCAGR', label: 'Avg Rolling CAGR (10Y)', format: 'pct' }, { key: 'rollingCAGRs.1Year', label: '1Y Roll. CAGR', format: 'pct' }, { key: 'rollingCAGRs.3Year', label: '3Y Roll. CAGR', format: 'pct' }, { key: 'rollingCAGRs.5Year', label: '5Y Roll. CAGR', format: 'pct' }, { key: 'rollingCAGRs.7Year', label: '7Y Roll. CAGR', format: 'pct' }, { key: 'rollingCAGRs.10Year', label: '10Y Roll. CAGR', format: 'pct' }, { key: 'maxDD', label: 'Max Drawdown', format: 'pct' }, { key: 'maxDDDate', label: 'Max DD Date', format: 'date' }, { key: 'recovery', label: 'Recovery (months)', format: 'number' }, { key: 'standardDeviation', label: 'Standard Deviation', format: 'pct' }, { key: 'downsideDeviation', label: 'Downside Deviation', format: 'pct' }, { key: 'sharpe', label: 'Sharpe Ratio', format: 'number' }, { key: 'sortino', label: 'Sortino Ratio', format: 'number' }, { key: 'calmar', label: 'Calmar Ratio', format: 'number' }, { key: 'totalSwitches', label: 'Total Switches', format: 'number' }, { key: 'winRate', label: 'Win Rate', format: 'pct' }, { key: 'profitFactor', label: 'Profit Factor', format: 'number' }, { key: 'averageWin', label: 'Average Win', format: 'inr' }, { key: 'averageLoss', label: 'Average Loss', format: 'inr' }, { key: 'startingCapital', label: 'Starting Capital', format: 'inr' }, { key: 'preTaxCorpus', label: 'Pre-Tax Corpus', format: 'inr' }, { key: 'postTaxCorpus', label: 'Post-Tax Corpus', format: 'inr' }, { key: 'totalTax', label: 'Total Tax Paid', format: 'inr' }, { key: 'totalTransactionCost', label: 'Transaction Cost Paid', format: 'inr' }, { key: 'preTaxMaxDrawdown', label: 'Pre-Tax Max Drawdown', format: 'pct' },
        ];
        metrics.forEach(metric => {
            const row = document.createElement('tr');
            let v1, v2, v3;
            if(metric.key.includes('.')){ const [p,c]=metric.key.split('.'); v1=data[0]?.[p]?.[c]; v2=data[1]?.[p]?.[c]; v3=data[2]?.[p]?.[c]; } 
            else { v1=data[0]?.[metric.key]; v2=data[1]?.[metric.key]; v3=data[2]?.[metric.key]; }
            let f1, f2, f3;
            const fmtOne = (v) => {
                // M13: only null/undefined is N/A — a legitimate 0 or '' must survive.
                if (v == null) return 'N/A';
                if (metric.format === 'inr') return '₹' + fmtINRv(v);
                if (metric.format === 'pct') return fmtPct(v, 2);
                if (metric.format === 'number') return fmtNum(v, 2);
                return String(v);
            };
            f1 = fmtOne(v1); f2 = fmtOne(v2); f3 = fmtOne(v3);
            const labelTd = document.createElement('td');
            const labelStrong = document.createElement('strong');
            labelStrong.textContent = metric.label;
            labelTd.appendChild(labelStrong);
            row.appendChild(labelTd);
            row.appendChild(mkTd(f1));
            row.appendChild(mkTd(f2));
            row.appendChild(mkTd(f3));
            tableBody.appendChild(row);
        });
    }

    function updateTradeLogTable(tradeLog) {
       const tableBody = document.querySelector('#tradeLogTable tbody');
       if (noEl(tableBody, 'tradelog-table')) return;
        tableBody.innerHTML = '';
        // M21: caller may hand us a non-array — never throw mid-render.
        if (!Array.isArray(tradeLog)) return;
        // CRIT-11: no innerHTML interpolation of trade data — build cells, set textContent.
        // WARN-09: no local formatINR, use shared fmtINRv/fmtPct.
        const mkTd = (text, className) => {
            const td = document.createElement('td');
            if (className) td.className = className;
            td.textContent = text == null ? '' : String(text);
            return td;
        };
        // C2: guard null/undefined/NaN — never throw mid-render on open-holding/partial rows
        // (finiteOr(null) coerces to 0, so the null check must happen before the formatter.)
        const money = (v) => '₹' + (v == null ? 'N/A' : fmtINRv(v));
        const pctCell = (v) => v == null ? 'N/A' : fmtPct(v, 2);
        tradeLog.forEach(trade => {
            const row = document.createElement('tr');
            
            // Logic to style the Current Holding row differently
            if (trade.isOpen) {
                row.style.backgroundColor = "#e3f2fd"; // Light Blue background
                row.style.fontWeight = "bold";
                row.style.borderTop = "2px solid #2196F3";
            }

            const profitClass = trade.profit >= 0 ? 'profit' : 'loss';

            // Prefer the exact holdingDays the engine records; fall back to a months
            // approximation only when the field is absent (older records).
            const holdingDays = Number.isFinite(trade.holdingDays) ? trade.holdingDays : Math.round((trade.holdingPeriodMonths || 0) * 30.44);

            row.appendChild(mkTd(trade.sellDate));
            row.appendChild(mkTd(trade.fromAsset));
            row.appendChild(mkTd(trade.toAsset));
            row.appendChild(mkTd(money(trade.profit), profitClass));
            row.appendChild(mkTd(pctCell(trade.profitPct), profitClass));
            row.appendChild(mkTd(trade.taxType || 'N/A'));
            row.appendChild(mkTd(money(trade.tax || 0)));
            row.appendChild(mkTd(money(trade.corpusBeforeTax)));
            row.appendChild(mkTd(money(trade.corpusAfterTax)));
            row.appendChild(mkTd(holdingDays));
            tableBody.appendChild(row);
        });
    }

    function updateTradeDistributionChart(tradeLog) {
        if (noEcharts('trade-distribution')) return;
        let chartDom = document.getElementById('tradeDistributionChart');
        if (noEl(chartDom, 'trade-distribution')) return;
        // M21: empty/partial log — sort on undefined profitPct yields NaN ordering.
        if (!Array.isArray(tradeLog) || !tradeLog.length) { console.warn('[charts] trade-distribution: no trades, skipping'); return; }
        let myChart = echarts.getInstanceByDom(chartDom);
        if (myChart) myChart.dispose();
        myChart = echarts.init(chartDom);

        // 1. Prepare Data: Sort trades by Profit % (Ascending)
        let sortedTrades = [...tradeLog].sort((a, b) => a.profitPct - b.profitPct);

        const dataPoints = sortedTrades.map((t, index) => {
            return {
                name: t.sellDate,
                value: [index, t.profitPct * 100], // X=Index, Y=Profit%
                itemStyle: {
                    // Dots are still Green if positive, Red if negative
                    color: t.profitPct >= 0 ? '#27ae60' : '#c0392b' 
                },
                originalData: t
            };
        });

        // 2. Calculate Min/Max for Y-Axis scaling
        const vals = sortedTrades.map(t => t.profitPct * 100);
        const minVal = Math.min(...vals, 0); // Ensure 0 is included
        const maxVal = Math.max(...vals, 0);

        // 3. Find Indices for the Colored Boxes
        let lastLoserIndex = -1;
        let firstBigWinnerIndex = -1; // First trade > 5%

        for (let i = 0; i < sortedTrades.length; i++) {
            if (sortedTrades[i].profitPct < 0) {
                lastLoserIndex = i;
            }
            // Check for > 5% (0.05)
            if (sortedTrades[i].profitPct > 0.05 && firstBigWinnerIndex === -1) {
                firstBigWinnerIndex = i;
            }
        }

        // 4. Build the MarkArea Data dynamically
        let areas = [];

        // Red Box: Covers all negative trades
        if (lastLoserIndex !== -1) {
            areas.push([
                {
                    name: 'Losers',
                    xAxis: 0,
                    yAxis: minVal - 5, // Extend slightly down
                    itemStyle: { color: '#ff0000', opacity: 0.1 },
                    label: { position: 'insideBottomLeft', color: '#c0392b', fontSize: 12 }
                },
                {
                    xAxis: lastLoserIndex,
                    yAxis: 0
                }
            ]);
        }

        // Green Box: Covers only trades > 5%
        if (firstBigWinnerIndex !== -1) {
            areas.push([
                {
                    name: 'Winners > 5%',
                    xAxis: firstBigWinnerIndex,
                    yAxis: 0,
                    itemStyle: { color: 'green', opacity: 0.1 },
                    label: { position: 'insideTopRight', color: 'green', fontSize: 12 }
                },
                {
                    xAxis: sortedTrades.length - 1,
                    yAxis: maxVal + 5 // Extend slightly up
                }
            ]);
        }

        const option = {
            tooltip: {
                trigger: 'item',
                formatter: function (params) {
                    if (!params || !params.data) return '';
                    const t = params.data.originalData;
                    // WARN-09: shared formatters only — never '₹' + N/A from a missing value.
                    const amount = finiteOr(t.profit, null);
                    const amountTxt = amount === null ? 'N/A' : '₹' + fmtINRv0(amount);
                    const pctVal = Array.isArray(params.value) ? finiteOr(params.value[1], null) : null;
                    const pctTxt = pctVal === null ? 'N/A' : pctVal.toFixed(2) + '%';
                    // Same expression as the trade-log "Held" column so both agree.
                    const heldDays = Number.isFinite(t.holdingDays) ? t.holdingDays : Math.round((t.holdingPeriodMonths || 0) * 30.44);
                    return `
                        <strong>Date:</strong> ${escHtml(t.sellDate)}<br/>
                        <strong>Trade:</strong> ${escHtml(t.fromAsset)} → ${escHtml(t.toAsset)}<br/>
                        <strong>Profit:</strong> ${pctTxt}<br/>
                        <strong>Amount:</strong> ${amountTxt}<br/>
                        <strong>Held:</strong> ${heldDays} days
                    `;
                }
            },
            grid: { top: '10%', bottom: '10%', left: '10%', right: '10%' },
            xAxis: {
                type: 'value',
                name: 'Trade Number (Sorted)',
                nameLocation: 'middle',
                nameGap: 25,
                minInterval: 1,
                splitLine: { show: false }
            },
            yAxis: {
                type: 'value',
                name: 'Return (%)',
                axisLabel: { formatter: '{value}%' },
                splitLine: { lineStyle: { type: 'dashed', color: '#eee' } }
            },
            series: [
                {
                    name: 'Returns',
                    type: 'scatter',
                    symbolSize: 8,
                    data: dataPoints,
                    markLine: {
                        symbol: 'none',
                        silent: true,
                        data: [{ yAxis: 0 }],
                        lineStyle: { color: '#333', width: 1 }
                    },
                    markArea: {
                        silent: true,
                        data: areas
                    }
                }
            ]
        };

        myChart.setOption(option);
    }

    let currentScaleType = 'value';
    let withdrawalScaleType = 'value';

    function updateMainChart(strategyHistory, postTaxStrategyData, equityBHData, goldBHData, switchPoints, taxSwitchPoints, options, labels, equityLabel) {
        equityLabel = equityLabel || 'Equity Buy & Hold';
        if (noEcharts('main-chart')) return;
        const _el = document.getElementById('performanceChart');
        if (noEl(_el, 'main-chart')) return;
        // M21: object series vs bare arrays zipped by index — clamp to shortest, never plot undefined.
        const _n = minLen('main-chart', labels, postTaxStrategyData, equityBHData, goldBHData, strategyHistory);
        const _labels = labels.slice(0, _n);
        const _post = postTaxStrategyData.slice(0, _n);
        const _eq = equityBHData.slice(0, _n);
        const _gd = goldBHData.slice(0, _n);
        const _hist = strategyHistory.slice(0, _n);
        // CRIT-12: scatter points are not index-aligned, but still strip prototypes and
        // drop anything ECharts cannot plot (no [x, y] pair / non-finite y).
        const safeScatter = (pts) => (Array.isArray(pts) ? pts : []).filter(p => p && Array.isArray(p.value) && Number.isFinite(p.value[1]));
        const _switchPts = safeScatter(plainData(switchPoints));
        const _taxSwitchPts = safeScatter(plainData(taxSwitchPoints));
        let chartInstance = echarts.getInstanceByDom(_el);
        if (chartInstance) chartInstance.dispose();
        const myChart = echarts.init(_el);
        const option = {
            tooltip: { 
                trigger: 'axis', axisPointer: { type: 'cross' }, 
                formatter: (params) => {
                    if(!params || params.length === 0) return '';
                    // WARN-09: shared formatters only — no third local formatINR variant.
                    const fmtMoney = (n) => { const v = finiteOr(n, null); return v === null ? 'N/A' : '₹' + fmtINRv(v); };
                    
                    if (params.some(p => p.seriesName === 'Tax Switches' && p.data)) {
                        const data = params.find(p => p.seriesName === 'Tax Switches').data;
                        return `<strong>Tax Event on ${escHtml(data.name)}</strong><br/>` +
                            `Post-Tax Corpus: ${fmtMoney(data.postTaxCorpus)}<br/>` +
                            `Trade: ${escHtml(data.fromAsset)} → ${escHtml(data.toAsset)}<br/>` +
                            `Status: <strong style="color:${data.status === 'Win' ? '#28a745' : '#dc3545'};">${escHtml(data.status)}</strong><br/>` +
                            `P/L: ${fmtMoney(data.profit)} (${fmtPct(data.profitPct, 2)})<br/>` +
                            `Total Tax Paid: ${fmtMoney(data.taxPaid)}`;
                    }

                    if (params.some(p => p.seriesName === 'Switches' && p.data)) {
                         const data = params.find(p => p.seriesName === 'Switches').data;
                         return `<strong>Switch on ${escHtml(data.name)}</strong><br/>` +
                            `Total Corpus: ${fmtMoney(data.corpus)}<br/>` +
                            `Equity Momentum (${options.lookbackPeriod}m): ${fmtPct(data.equityMomentum, 2)}<br/>` +
                            `Gold Momentum (${options.lookbackPeriod}m): ${fmtPct(data.goldMomentum, 2)}<br/>` +
                            `<strong>Switched to ${escHtml(data.switchedTo)}</strong>`;
                    }
                    
                    let result = escHtml(params[0].name) + '<br/>';
                    params.forEach(p => { 
                        if (!p.seriesName.includes('Switch') && p.value) {
                            result += `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${p.color};"></span>${p.seriesName}: ${fmtMoney(p.value[1])}<br/>`; 
                        }
                    });
                    return result;
                } 
            },
            legend: { data: ['Strategy (Before Tax)', 'Strategy (After Tax)', equityLabel, 'Gold Buy & Hold', 'Switches', 'Tax Switches'] },
            grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
            xAxis: { type: 'category', boundaryGap: false, data: _labels },
            yAxis: { type: currentScaleType, axisLabel: { formatter: (v) => '₹' + v.toLocaleString('en-IN') } },
            series: [
                { name: 'Strategy (Before Tax)', type: 'line', data: _hist.map(p => [p.date, p.value]), itemStyle: { color: 'rgba(75, 192, 192, 1)' }, areaStyle: { color: 'rgba(75, 192, 192, 0.2)' } },
                { name: 'Strategy (After Tax)', type: 'line', data: _post.map((val, idx) => [_labels[idx], val]), itemStyle: { color: 'rgba(255, 159, 64, 1)' } },
                { name: equityLabel, type: 'line', data: _eq.map((val, idx) => [_labels[idx], val]), itemStyle: { color: 'rgba(54, 162, 235, 1)' } },
                { name: 'Gold Buy & Hold', type: 'line', data: _gd.map((val, idx) => [_labels[idx], val]), itemStyle: { color: 'rgba(255, 206, 86, 1)' } },
                { name: 'Switches', type: 'scatter', data: _switchPts, itemStyle: { color: 'rgba(255, 99, 132, 1)' }, symbolSize: 10, z: 10 },
                { name: 'Tax Switches', type: 'scatter', data: _taxSwitchPts, itemStyle: { color: 'rgba(153, 102, 255, 1)' }, symbolSize: 8, z: 11 }
            ]
        };
        myChart.setOption(option);
    }

    function updateWithdrawalChart(corpusHistory, totalWithdrawalHistory) {
        if (noEcharts('withdrawal-chart')) return;
        const _el = document.getElementById('withdrawalChart');
        if (noEl(_el, 'withdrawal-chart')) return;
        if (!corpusHistory || !totalWithdrawalHistory || !corpusHistory.length) { console.warn('[charts] withdrawal-chart: empty history, skipping'); return; }
        let chartInstance = echarts.getInstanceByDom(_el);
        if (chartInstance) chartInstance.dispose();
        const withdrawalChart = echarts.init(_el);
        const option = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, formatter: (p) => { if (!p || p.length === 0) return ''; let r = escHtml(p[0].name) + '<br/>'; p.forEach(i => { const v = Array.isArray(i.value) ? i.value[1] : i.value; if (!Number.isFinite(v)) return; r += `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${i.color};"></span>${i.seriesName}: ₹${v.toLocaleString('en-IN')}<br/>`; }); return r; } },
            legend: { data: ['Corpus After Withdrawals', 'Total Withdrawn'] },
            grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
            xAxis: { type: 'category', boundaryGap: false, data: corpusHistory.map(p => p.date) },
            yAxis: { type: withdrawalScaleType, axisLabel: { formatter: (v) => '₹' + v.toLocaleString('en-IN') } },
            series: [
                { name: 'Corpus After Withdrawals', type: 'line', data: corpusHistory.map(p => [p.date, p.value <= 0 ? 0.01 : p.value]), itemStyle: { color: 'rgba(75, 192, 192, 1)' }, areaStyle: { color: 'rgba(75, 192, 192, 0.2)' } },
                { name: 'Total Withdrawn', type: 'line', data: totalWithdrawalHistory.map(p => [p.date, p.value <= 0 ? 0.01 : p.value]), itemStyle: { color: 'rgba(255, 99, 132, 1)' } }
            ]
        };
        withdrawalChart.setOption(option);
    }

    function updateDrawdownChart(labels, strategyDD, equityDD, goldDD) {
        if (noEcharts('drawdown-chart')) return;
        const _el = document.getElementById('drawdownChart');
        if (noEl(_el, 'drawdown-chart')) return;
        // M21: [[date,dd]] pairs vs parallel label array — warn on mismatch, never index blind.
        if (!labels || !strategyDD || !equityDD || !goldDD) { console.warn('[charts] drawdown-chart: missing series, skipping'); return; }
        const _n = minLen('drawdown-chart', labels, strategyDD, equityDD, goldDD);
        const _labels = labels.slice(0, _n);
        const _stratDD = strategyDD.slice(0, _n);
        const _eqDD = equityDD.slice(0, _n);
        const _goldDD = goldDD.slice(0, _n);
        let chartInstance = echarts.getInstanceByDom(_el);
        if (chartInstance) chartInstance.dispose();
        const drawdownChart = echarts.init(_el);
        const option = {
            tooltip: { trigger: 'axis', formatter: (p) => { if (!p || p.length === 0) return ''; let r = escHtml(p[0].name) + '<br/>'; p.forEach(i => { const v = Array.isArray(i.value) ? i.value[1] : i.value; if (!Number.isFinite(v)) return; r += `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${i.color};"></span>${i.seriesName}: ${fmtPct(-v, 2)}<br/>`; }); return r; } },
            legend: { data: ['Momentum Strategy', 'Equity Buy & Hold', 'Gold Buy & Hold'] },
            grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
            xAxis: { type: 'category', boundaryGap: false, data: _labels },
            yAxis: { type: 'value', axisLabel: { formatter: (v) => `${(-v*100).toFixed(1)}%` } },
            series: [
                { name: 'Momentum Strategy', type: 'line', data: _stratDD.map(p => [p[0], -p[1]]), showSymbol: false, itemStyle: { color: 'rgba(255, 0, 0, 1)' }, areaStyle: { color: 'rgba(255, 0, 0, 0.2)' } },
                { name: 'Equity Buy & Hold', type: 'line', data: _eqDD.map(p => [p[0], -p[1]]), showSymbol: false, itemStyle: { color: 'rgba(54, 162, 235, 1)' }, areaStyle: { color: 'rgba(54, 162, 235, 0.2)' } },
                { name: 'Gold Buy & Hold', type: 'line', data: _goldDD.map(p => [p[0], -p[1]]), showSymbol: false, itemStyle: { color: 'rgba(255, 206, 86, 1)' }, areaStyle: { color: 'rgba(255, 206, 86, 0.2)' } },
            ]
        };
        drawdownChart.setOption(option);
    }

    // --- Event Listeners ---
    // M3: null-guard the buttons — a bare .addEventListener on a missing id threw
    // at script-parse time and killed every chart in this file.
    const _scaleBtn = document.getElementById('scaleToggleBtn');
    if (_scaleBtn) _scaleBtn.addEventListener('click', function () {
        if (typeof echarts === 'undefined') return;
        const _chartEl = document.getElementById('performanceChart');
        if (noEl(_chartEl, 'main-chart')) return;
        currentScaleType = currentScaleType === 'value' ? 'log' : 'value';
        echarts.getInstanceByDom(_chartEl)?.setOption({ yAxis: { type: currentScaleType } });
        this.innerText = currentScaleType === 'value' ? 'Switch to Log Scale' : 'Switch to Normal Scale';
    });

    const _withdrawalScaleBtn = document.getElementById('withdrawalScaleToggleBtn');
    if (_withdrawalScaleBtn) _withdrawalScaleBtn.addEventListener('click', function () {
        if (typeof echarts === 'undefined') return;
        const _wdEl = document.getElementById('withdrawalChart');
        if (noEl(_wdEl, 'withdrawal-chart')) return;
        withdrawalScaleType = withdrawalScaleType === 'value' ? 'log' : 'value';
        echarts.getInstanceByDom(_wdEl)?.setOption({ yAxis: { type: withdrawalScaleType } });
        this.innerText = withdrawalScaleType === 'value' ? 'Switch to Log Scale' : 'Switch to Normal Scale';
    });
