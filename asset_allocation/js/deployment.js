// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: deployment battle (STP/Lumpsum/SIP)
    export function updateDeploymentBattle(dates, rebData) {
        // 1. Get User Inputs
        const capital = parseFloat(document.getElementById('dep-capital').value) || 3000000;
        const duration = parseInt(document.getElementById('dep-months').value) || 24;
        const liquidRate = parseFloat(document.getElementById('dep-liquid-rate').value) || 6;

        // Monthly Liquid Rate
        const monthlyLiquidRate = Math.pow(1 + liquidRate/100, 1/12) - 1;

        // Get Strategy Returns (Monthly)
        const hist = rebData.historyWithoutWithdrawals;
        const strategyReturns = [];
        for(let i=1; i<hist.length; i++) {
            if(hist[i-1] > 0) strategyReturns.push(hist[i]/hist[i-1] - 1);
            else strategyReturns.push(0);
        }
        
        // Align Dates (strategyReturns starts from index 1 of dates)
        const simDates = dates.slice(1);

        const lumpCurve = [capital];
        const stpCurve = [capital];
        
        let stpLiquid = capital;
        let stpInvested = 0;
        const monthlyTransfer = capital / duration; // Fixed Installment

        // Run Simulation
        for(let i=0; i<strategyReturns.length; i++) {
            const ret = strategyReturns[i];

            // 1. Lumpsum Logic: Fully invested from Day 0
            const prevLump = lumpCurve[lumpCurve.length-1];
            lumpCurve.push(prevLump * (1 + ret));

            // 2. STP Logic
            // Liquid grows
            stpLiquid = stpLiquid * (1 + monthlyLiquidRate);
            
            // Transfer to Strategy (if liquid remains)
            let transfer = 0;
            if(i < duration) {
                // Check if last installment needs adjustment (floating point errors)
                if(i === duration - 1) transfer = stpLiquid; 
                else transfer = monthlyTransfer;
                
                // Adjust balances
                stpLiquid -= transfer;
            }

            // Strategy portion grows
            stpInvested = stpInvested * (1 + ret) + transfer;
            
            // Total STP Wealth
            stpCurve.push(stpLiquid + stpInvested);
        }

        // --- CHART 1: WEALTH OVERTAKE ---
        const chartWealth = echarts.getInstanceByDom(document.getElementById('dep-wealth-chart')) || echarts.init(document.getElementById('dep-wealth-chart'));
        
        chartWealth.setOption({
            tooltip: { trigger: 'axis', formatter: (p) => {
                const lump = p[0].value[1];
                const stp = p[1].value[1];
                const diff = lump - stp;
                return `${p[0].axisValueLabel}<br/>
                        Lumpsum: <b>${new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:0}).format(lump)}</b><br/>
                        STP (${duration}m): <b>${new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:0}).format(stp)}</b><br/>
                        Difference: <b style="color:${diff>0?'green':'red'}">${diff>0?'+':''}${new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:0}).format(diff)}</b>`;
            }},
            legend: { data: ['Lumpsum (Immediate)', `STP (${duration} Months)`], bottom: 0 },
            xAxis: { type: 'category', data: dates, axisLabel: { formatter: (val) => new Date(val).getFullYear() } }, // Simplified dates
            yAxis: { type: 'value', axisLabel: { formatter: (v) => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) } },
            series: [
                {
                    name: 'Lumpsum (Immediate)',
                    type: 'line',
                    data: lumpCurve.map((v, i) => [dates[i], v]),
                    showSymbol: false,
                    lineStyle: { width: 2, color: '#2980b9' },
                    areaStyle: { color: '#2980b9', opacity: 0.1 }
                },
                {
                    name: `STP (${duration} Months)`,
                    type: 'line',
                    data: stpCurve.map((v, i) => [dates[i], v]),
                    showSymbol: false,
                    lineStyle: { width: 2, color: '#e67e22' }
                }
            ],
            grid: { top: 20, right: 20, bottom: 40, left: 60 }
        });


        // --- CHART 2: COST OF HESITATION ---
        const chartCost = echarts.getInstanceByDom(document.getElementById('dep-cost-chart')) || echarts.init(document.getElementById('dep-cost-chart'));
        const diffData = [];
        
        for(let i=0; i<lumpCurve.length; i++) {
            const diff = lumpCurve[i] - stpCurve[i];
            diffData.push([dates[i], diff]);
        }

        chartCost.setOption({
            tooltip: { trigger: 'axis', formatter: (p) => {
                const val = p[0].value[1];
                const label = val > 0 ? "Cost of Waiting" : "Savings from Waiting";
                return `${p[0].axisValueLabel}<br/>${label}: <b>${new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:0}).format(Math.abs(val))}</b>`;
            }},
            xAxis: { type: 'time' },
            yAxis: { name: 'Difference (₹)', type: 'value', axisLabel: { formatter: (v) => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) } },
            series: [{
                name: 'Opportunity Cost',
                type: 'bar',
                data: diffData,
                itemStyle: {
                    color: (p) => p.value[1] >= 0 ? '#27ae60' : '#c0392b' // Green = Lumpsum Wins (Waiting had a cost)
                }
            }],
            grid: { top: 30, right: 20, bottom: 30, left: 70 }
        });


        // --- CHART 3: WIN RATE GAUGE (ROLLING ANALYSIS) ---
        const chartGauge = echarts.getInstanceByDom(document.getElementById('dep-gauge-chart')) || echarts.init(document.getElementById('dep-gauge-chart'));
        
        let wins = 0;
        let totalTrials = 0;
        const window = duration; // 30 months

        for(let i=0; i <= strategyReturns.length - window; i++) {
            // Run mini-simulation for this window
            let lumpVal = capital;
            let stpVal = 0;
            let liquidVal = capital;
            
            for(let m=0; m<window; m++) {
                const r = strategyReturns[i+m];
                
                // Lumpsum
                lumpVal *= (1+r);
                
                // STP
                liquidVal *= (1+monthlyLiquidRate);
                let transfer = monthlyTransfer;
                // Precise adjustment not needed for aggregate stats, assume perfectly divisible
                liquidVal -= transfer;
                stpVal = stpVal * (1+r) + transfer;
            }
            // Final STP check (add remaining liquid if any small change left)
            stpVal += liquidVal; // Should be near 0
            
            if(lumpVal > stpVal) wins++;
            totalTrials++;
        }

        const winRate = totalTrials > 0 ? (wins / totalTrials) * 100 : 0;

        chartGauge.setOption({
            series: [{
                type: 'gauge',
                min: 0, max: 100,
                axisLine: {
                    lineStyle: {
                        width: 25,
                        color: [[0.5, '#c0392b'], [1, '#27ae60']] // Red < 50%, Green > 50%
                    }
                },
                pointer: { itemStyle: { color: 'auto' } },
                detail: { formatter: '{value}%', fontSize: 30, offsetCenter: [0, '30%'] },
                data: [{ value: winRate.toFixed(1), name: `Lumpsum Win Rate\n(Rolling ${duration}m)` }],
                title: { offsetCenter: [0, '60%'], fontSize: 14, color: '#555' }
            }]
        });
    }
    // Attach Event Listener to the "Run Simulation" button
    document.getElementById('run-deployment-btn').addEventListener('click', () => {
        document.getElementById('log-scale-toggle').dispatchEvent(new Event('change')); // Hack to trigger main update
    });


    // ==========================================
    // 📉 CRASH OPPORTUNITY ENGINE
    // ==========================================
