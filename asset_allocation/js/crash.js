// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: crash analysis + VIX proxy + stress zones
    export function updateCrashAnalysis(dates, results) {
        
        // 1. Radio Button Listener
        const radios = document.querySelectorAll('input[name="crash-view-mode"]');
        
        const refreshCrashCharts = () => {
            const mode = document.querySelector('input[name="crash-view-mode"]:checked').value;
            let histData;
            
            if (mode === 'reb') histData = results.standard.reb.historyWithoutWithdrawals;
            else if (mode === 'noReb') histData = results.standard.noReb.historyWithoutWithdrawals;
            else if (mode === 'equityOnly') histData = results.standard.equityOnly.historyWithoutWithdrawals;
            else if (mode === 'goldOnly') histData = results.standard.goldOnly.historyWithoutWithdrawals;
            else histData = results.standard.benchmark.historyWithoutWithdrawals;
            
            if(!histData || histData.length < 12) return;

            // --- CALCULATIONS ---
            const scatterData = []; // [Drawdown%, 3Y_CAGR, Date]
            const crashEvents = [];
            
            let peak = -Infinity;
            const drawdowns = [];
            
            // 1. Calculate Drawdown Series & Future Returns
            for(let i=0; i<histData.length; i++) {
                const val = histData[i];
                if(val > peak) peak = val;
                
                const dd = (val - peak) / peak; // Negative value e.g. -0.15
                drawdowns.push(dd);

                // Forward Returns (if data available)
                // 3 Year Forward
                if(i < histData.length - 36) {
                    const futureVal = histData[i+36];
                    const cagr3y = (Math.pow(futureVal/val, 1/3) - 1) * 100;
                    
                    // Add to scatter
                    scatterData.push([Math.abs(dd*100), cagr3y, dates[i]]);
                }
                
                // Log Major Crashes (Local Troughs)
                // Logic: If DD is worse than -10% AND it is a local trough (lower than neighbors)
                if(dd < -0.10) {
                    // Check if local minima (simplified lookahead)
                    const prev = i > 0 ? drawdowns[i-1] : 0;
                    const next = i < drawdowns.length-1 ? drawdowns[i+1] : 0;
                    
                    if(dd < prev && dd < next) {
                        // It's a trough
                        let ret1y = "N/A", ret3y = "N/A";
                        
                        if(i < histData.length - 12) {
                            const v1 = histData[i+12];
                            ret1y = (((v1/val)-1)*100).toFixed(1) + "%";
                        }
                        if(i < histData.length - 36) {
                            const v3 = histData[i+36];
                            const c = (Math.pow(v3/val, 1/3)-1)*100;
                            ret3y = c.toFixed(1) + "%";
                        }
                        
                        crashEvents.push({
                            date: dates[i],
                            depth: dd * 100,
                            ret1y,
                            ret3y
                        });
                    }
                }
            }
            
            // 2. Determine Dynamic Thresholds (Percentiles of Drawdowns)
            // Filter only negative drawdowns
            const negativeDDs = drawdowns.filter(d => d < 0).sort((a,b) => a-b); // Ascending (deepest first)
            
            // Tier 3 (Capitulation): Top 1% worst days (e.g. -40%)
            const t3 = negativeDDs[Math.floor(negativeDDs.length * 0.01)] || -0.20;
            // Tier 2 (Panic): Top 5% worst days (e.g. -20%)
            const t2 = negativeDDs[Math.floor(negativeDDs.length * 0.05)] || -0.15;
            // Tier 1 (Discount): Top 20% worst days (e.g. -10%)
            const t1 = negativeDDs[Math.floor(negativeDDs.length * 0.20)] || -0.05;

            // Current Status
            const currentDD = drawdowns[drawdowns.length-1];
            
            
            // --- CHART 1: SCATTER ---
            const chartScatter = echarts.getInstanceByDom(document.getElementById('crash-scatter-chart')) || echarts.init(document.getElementById('crash-scatter-chart'));
            
            chartScatter.setOption({
                tooltip: {
                    formatter: (p) => {
                        const d = new Date(p.data[2]).toLocaleDateString();
                        return `<b>${d}</b><br/>Drawdown: -${p.data[0].toFixed(1)}%<br/>Next 3Y CAGR: <b>${p.data[1].toFixed(1)}%</b>`;
                    }
                },
                xAxis: { name: 'Drawdown Depth (%)', type: 'value', min: 0 },
                yAxis: { name: '3-Year Annualized Return (%)', type: 'value' },
                series: [{
                    type: 'scatter',
                    data: scatterData,
                    symbolSize: 8,
                    itemStyle: {
                        color: (p) => {
                            const depth = -1 * (p.data[0]/100);
                            if(depth < t3) return '#27ae60'; // Deep Value
                            if(depth < t2) return '#2ecc71'; // Panic
                            if(depth < t1) return '#f1c40f'; // Discount
                            return '#34495e'; // Normal
                        }
                    },
                    markLine: {
                        data: [
                            { xAxis: Math.abs(t1*100), lineStyle: { color: '#f1c40f', type: 'dashed' }, label: { formatter: 'Tier 1' } },
                            { xAxis: Math.abs(t2*100), lineStyle: { color: '#e67e22', type: 'dashed' }, label: { formatter: 'Tier 2' } },
                            { xAxis: Math.abs(t3*100), lineStyle: { color: '#c0392b', type: 'dashed' }, label: { formatter: 'Tier 3' } }
                        ],
                        symbol: ['none', 'none']
                    }
                }],
                grid: { top: 30, right: 40, bottom: 40, left: 50 }
            });


            // --- CHART 2: GAUGE ---
            const chartGauge = echarts.getInstanceByDom(document.getElementById('crash-gauge-chart')) || echarts.init(document.getElementById('crash-gauge-chart'));

            let gaugeVal = 0;
            let gaugeText = "Expensive";
            let gaugeColor = "#c0392b";
            
            const cDD = currentDD; // negative
            
            if (cDD > t1) { // 0 to -5%
                gaugeVal = (cDD / t1) * 33; 
                gaugeText = "Wait / Hold";
                gaugeColor = "#95a5a6";
            } else if (cDD > t2) { // -5% to -15%
                gaugeVal = 33 + ((cDD - t1) / (t2 - t1)) * 33;
                gaugeText = "Deploy 25% (Discount)";
                gaugeColor = "#f1c40f";
            } else if (cDD > t3) { // -15% to -30%
                gaugeVal = 66 + ((cDD - t2) / (t3 - t2)) * 34;
                gaugeText = "Deploy 50% (Panic)";
                gaugeColor = "#e67e22";
            } else { // < -30%
                gaugeVal = 100;
                gaugeText = "ALL IN (Capitulation)";
                gaugeColor = "#27ae60";
            }

            chartGauge.setOption({
                series: [{
                    type: 'gauge',
                    min: 0, max: 100,
                    axisLine: {
                        lineStyle: {
                            width: 20,
                            color: [[0.33, '#95a5a6'], [0.66, '#f1c40f'], [0.90, '#e67e22'], [1, '#27ae60']]
                        }
                    },
                    pointer: { itemStyle: { color: 'auto' } },
                    detail: { 
                        formatter: () => `Current DD: ${(cDD*100).toFixed(1)}%\n${gaugeText}`,
                        fontSize: 16, offsetCenter: [0, '40%'], color: gaugeColor, fontWeight: 'bold'
                    },
                    data: [{ value: gaugeVal }]
                }]
            });


            // --- CHART 3: LOG TABLE ---
            const tbody = document.querySelector("#crash-log-table tbody");
            let html = '';
            
            // Sort by date descending
            crashEvents.reverse().forEach(e => {
                let tier = "Normal Dip";
                let tierClass = "";
                const dd = e.depth / 100 * -1; // back to negative decimal
                
                if(dd < t3) { tier = "TIER 3 (Historic)"; tierClass="log-buy"; } // Reuse buy class for green
                else if(dd < t2) { tier = "TIER 2 (Panic)"; tierClass="log-buy"; }
                else if(dd < t1) { tier = "TIER 1 (Dip)"; }
                
                const dateStr = new Date(e.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                
                html += `
                    <tr>
                        <td>${dateStr}</td>
                        <td style="color:#c0392b; font-weight:bold;">-${e.depth.toFixed(2)}%</td>
                        <td class="${tierClass}">${tier}</td>
                        <td style="color:${parseFloat(e.ret1y)>0?'#27ae60':'#c0392b'}">${e.ret1y}</td>
                        <td style="color:${parseFloat(e.ret3y)>0?'#27ae60':'#c0392b'}">${e.ret3y}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        };

        // Attach listeners
        if (!radios[0].hasAttribute('data-listener-crash')) {
            radios.forEach(r => {
                r.setAttribute('data-listener-crash', 'true');
                r.addEventListener('change', refreshCrashCharts);
            });
        }

        // Initial Run
        refreshCrashCharts();
    }


    // --- FAIR VALUE BAND CHART (VANGUARD STYLE) ---
    export function calculateProxyVIX(history) {
        const window = 3; // 3-Month rolling window for responsiveness
        const vixSeries = [];
        
        // Calculate Monthly Returns
        const rets = [];
        for(let i=1; i<history.length; i++) {
            rets.push((history[i] / history[i-1]) - 1);
        }

        // Rolling Volatility
        for(let i=window; i<rets.length; i++) {
            const slice = rets.slice(i-window, i);
            const mean = slice.reduce((a,b)=>a+b,0)/window;
            const variance = slice.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / (window - 1);
            const stdDev = Math.sqrt(variance);
            
            // Annualize: StdDev * Sqrt(12) * 100
            const annualizedVol = stdDev * Math.sqrt(12) * 100;
            vixSeries.push(annualizedVol);
        }
        // Let's return aligned data: [null, null, null, val1, val2...]
        const alignedVix = new Array(history.length).fill(null);
        for(let i=0; i<vixSeries.length; i++) {
            // Offset: 1 (for return) + window
            alignedVix[i + window + 1] = vixSeries[i];
        }
        return alignedVix;
    }

    // Identifies start and end dates for Grey Zones
    export function getStressZones(dates, vixData, threshold = 15) {
        const zones = [];
        let inStress = false;
        let startDate = null;

        for(let i=0; i<vixData.length; i++) {
            const val = vixData[i];
            if (val !== null && val > threshold) {
                if (!inStress) {
                    inStress = true;
                    startDate = dates[i];
                }
            } else {
                if (inStress) {
                    inStress = false;
                    zones.push([
                        { xAxis: startDate, itemStyle: { color: 'rgba(200, 200, 200, 0.4)' } }, 
                        { xAxis: dates[i-1] }
                    ]);
                }
            }
        }
        // Close zone if active at end
        if (inStress) {
            zones.push([
                { xAxis: startDate, itemStyle: { color: 'rgba(200, 200, 200, 0.4)' } }, 
                { xAxis: dates[dates.length-1] }
            ]);
        }
        return zones;
    }
    
    // FEAR MONITOR
