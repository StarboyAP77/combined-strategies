// 31/js/charts-s2.js — suites 13,14,16,17,18,19,21
// Plain script, shared globals. Load after engine.js/utils.js. Dataset is provided by app.js from js/data.json.

    function updateEfficientFrontierChart(bVal, gVal, pVal) {
        if (noEcharts('efficient-frontier')) return;
        // FIX: Calculates frontier based on Equity(Benchmark) and Gold(Asset 2)
        const _el = document.getElementById('efficient-frontier-chart');
        if (noEl(_el, 'efficient-frontier')) return;
        const chart = echarts.init(_el);

        if(!bVal || bVal.length < 2 || !gVal || gVal.length < 2) {
            chart.setOption({ title: { text:'Not modelled — no Equity/Gold history', left:'center', top:'middle', textStyle:{ fontSize:13, color:'#888', fontWeight:'normal' } } });
            return;
        }

        // M22: one CAGR / one volatility definition (shared helpers) so this
        // section reports the same numbers as every other section.
        const getStats = (arr) => {
            if(!arr || arr.length < 2) return null;
            const rets = [];
            for(let i=1; i<arr.length; i++) { if(arr[i-1] > 0) rets.push((arr[i]-arr[i-1])/arr[i-1]); }
            return { r: cagrFrom(arr[0], arr[arr.length-1], (arr.length-1)/12), v: annVolFromReturns(rets), n: rets.length };
        };
        const retsOf = (arr) => {
            const out = [];
            for(let i=1; i<arr.length; i++) { if(arr[i-1] > 0) out.push((arr[i]-arr[i-1])/arr[i-1]); }
            return out;
        };

        // M21: Equity/Gold zipped by index for the correlation below.
        const eqR = retsOf(bVal), glR = retsOf(gVal);
        const _n = minLen('efficient-frontier', eqR, glR);
        const eqS = getStats(bVal), glS = getStats(gVal), ptS = getStats(pVal);

        // Pearson correlation of the two monthly return series. Never assume 0.
        let rho = null;
        if(_n >= 3) {
            let sa=0, sb=0;
            for(let i=0; i<_n; i++) { sa+=eqR[i]; sb+=glR[i]; }
            const ma=sa/_n, mb=sb/_n;
            let cov=0, va=0, vb=0;
            for(let i=0; i<_n; i++) {
                const da=eqR[i]-ma, db=glR[i]-mb;
                cov+=da*db; va+=da*da; vb+=db*db;
            }
            const r = safeDiv(cov, Math.sqrt(va*vb), NaN);
            if(Number.isFinite(r)) rho = Math.max(-1, Math.min(1, r));
        }
        if(rho === null) {
            chart.setOption({ title: { text:'Insufficient data — need 3+ overlapping months of Equity & Gold to compute correlation (ρ)', left:'center', top:'middle', textStyle:{ fontSize:12, color:'#888', fontWeight:'normal', lineHeight:18} } });
            return;
        }

        // Portfolio volatility of a 2-asset blend (two-asset covariance formula):
        //   vol = sqrt(w1²σ1² + w2²σ2² + 2·w1·w2·ρ·σ1·σ2)
        const curve = [];
        for(let w=0; w<=1.0001; w+=0.05) {
            const w2 = 1 - w;
            const v = Math.sqrt(Math.max(0, w*w*eqS.v*eqS.v + w2*w2*glS.v*glS.v + 2*w*w2*rho*eqS.v*glS.v))*100;
            curve.push([v, (w*eqS.r + w2*glS.r)*100]);
        }

        chart.setOption({
            tooltip: { formatter: p => `${p.seriesName}<br/>Risk: ${p.value[0].toFixed(2)}%<br/>Return: ${p.value[1].toFixed(2)}%` },
            xAxis: { name:'Risk (Vol)', type:'value', scale:true },
            yAxis: { name:'Return (CAGR)', type:'value', scale:true },
            series: [
                { type:'line', smooth:true, data:curve, lineStyle:{type:'dashed', color:'#999'}, symbol:'none', name:'Theory (ρ=' + rho.toFixed(2) + ')' },
                { type:'scatter', data:[[eqS.v*100, eqS.r*100]], name:'Equity', itemStyle:{color:'#e74c3c'} },
                { type:'scatter', data:[[glS.v*100, glS.r*100]], name:'Gold', itemStyle:{color:'#f1c40f'} },
                { type:'scatter', data: ptS ? [[ptS.v*100, ptS.r*100]] : [], name:'Strategy', symbolSize:15, itemStyle:{color:'#2980b9'} }
            ],
            grid: { left:40, right:40, top:30, bottom:30 }
        });
    }

    function updateRollingVolChart(dates, pVal) {
        if (noEcharts('rolling-volatility')) return;
        const _el = document.getElementById('rolling-volatility-chart');
        if (noEl(_el, 'rolling-volatility')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) { chart.clear(); return; }
        
        // M21: dates/pVal zipped by index.
        const _n = minLen('rolling-vol', dates, pVal);
        const volData = [];
        const w=12;
        if(_n > w) {
            // M14: rets[k-1] is the return realised IN month k, i.e. covering data
            // through pVal[k] = dates[k]. The window ending at month i is therefore
            // plotted at dates[i]; the first w months stay empty (never shifted
            // forward to fill them).
            for(let i=w; i<_n; i++) {
                const slice = [];
                for(let k=i-w+1; k<=i; k++) {
                    if(!(pVal[k-1] > 0) || !(pVal[k] > 0)) { slice.length = 0; break; }
                    slice.push(pVal[k]/pVal[k-1]-1);
                }
                if(slice.length < 2) continue;
                // M22: shared annualised-volatility definition.
                const s = annVolFromReturns(slice) * 100;
                if(!Number.isFinite(s)) continue;
                volData.push([dates[i], s]);
            }
        }
        chart.setOption({
            xAxis: { type:'time' }, yAxis: { name:'Vol %' },
            series: [{ type:'line', data:volData, showSymbol:false }],
            grid: { left:40, right:20, top:30, bottom:30 }
        });
    }

    // --- SUITE 14: FIRE ---

    function updateStressTestChart(pVal) {
        if (noEcharts('swr-stress')) return;
        const _el = document.getElementById('swr-stress-chart');
        if (noEl(_el, 'swr-stress')) return;
        const chart = echarts.init(_el);

        // Credibility fix: this used to plot a hardcoded [100,95,80,60] array
        // ("Mock data logic") under a "Success Rate" axis — fabricated numbers
        // presented as portfolio output. It is now a real sequence-of-returns
        // survival test computed from the post-tax corpus path: for every
        // historical month that still has a full 10Y horizon ahead, replay the
        // ACTUAL monthly return sequence against a level monthly withdrawal
        // (rate/12 of the corpus at that start date). Success = never depleted.
        const rates = [0.03, 0.04, 0.05, 0.06];
        const horizon = 120;
        const rets = [];
        let degraded = false;
        for(let i=1; i<(pVal ? pVal.length : 0); i++) {
            // A non-positive corpus month is a ruin month — never silently skip
            // it (that would understate the risk); bail to the explicit state.
            if(!(pVal[i-1] > 0) || !(pVal[i] > 0)) { degraded = true; break; }
            rets.push(pVal[i]/pVal[i-1]-1);
        }
        const starts = rets.length - horizon;
        if(degraded) {
            chart.setOption({ title: { text: 'Not modelled — the corpus path was depleted, so no survival rate can be derived', left:'center', top:'middle', textStyle:{ fontSize:12, color:'#888', fontWeight:'normal', lineHeight:18 } } });
            return;
        }
        if(starts < 1) {
            chart.setOption({ title: { text: 'Not modelled — need ' + (horizon+1) + '+ months of history to run a 10-year survival test (have ' + rets.length + ')', left:'center', top:'middle', textStyle:{ fontSize:12, color:'#888', fontWeight:'normal', lineHeight:18 } } });
            return;
        }
        const success = rates.map(rate => {
            let ok = 0;
            const wd = rate/12;
            for(let s=0; s<=starts; s++) {
                let corpus = 1, alive = true;
                for(let j=0; j<horizon; j++) {
                    corpus = corpus*(1 + rets[s+j]) - wd;
                    if(!(corpus > 0)) { alive = false; break; }
                }
                if(alive) ok++;
            }
            return safeDiv(ok, starts+1, 0)*100;
        });
        chart.setOption({
            tooltip: { trigger:'axis', formatter: p => `${p[0].name} withdrawal<br/>Survived 10Y in <b>${fmtNum(finiteOr(p[0].value, 0), 1)}%</b> of ${starts+1} start dates` },
            title: { text:'10-year survival of the actual post-tax return sequence', subtext:'Corpus starts at 1 unit, level withdrawal = rate/12 per month', left:'center', top:0, textStyle:{ fontSize:12, fontWeight:'normal' }, subtextStyle:{ fontSize:10 } },
            xAxis: { type:'category', data:rates.map(r=>fmtPct(r,0)) },
            yAxis: { name:'Success Rate', min:0, max:100 },
            series: [{ type:'bar', name:'Success Rate (computed)', data:success.map(v=>+finiteOr(v,0).toFixed(1)), itemStyle:{color: v=>v.value>90?'#27ae60':(v.value>50?'#e67e22':'#e74c3c')} }],
            grid: { left:40, right:20, top:50, bottom:30 }
        });
    }

    // --- SUITE 15: FUND MANAGER ---

    function updateSnowballChart(dates, pVal) {
        if (noEcharts('snowball')) return;
        const _el = document.getElementById('snowball-chart');
        if (noEl(_el, 'snowball')) return;
        const chart = echarts.init(_el);
        
        if(!pVal || pVal.length < 1) { chart.clear(); return; }
        // M21: dates/pVal zipped by index — clamp before reading dates[i].
        const _n = minLen('snowball', dates, pVal);

        const initial = pVal[0];
        let target = initial * 2;
        const doubles = [];
        let lastIdx = 0;

        for(let i=0; i<_n; i++) {
            if(pVal[i] >= target) {
                const years = (i - lastIdx)/12;
                doubles.push({ 
                    name: (target/initial/2)+'x to '+(target/initial)+'x', 
                    value: years.toFixed(1),
                    date: dates[i]
                });
                target *= 2;
                lastIdx = i;
            }
        }

        chart.setOption({
            tooltip: { formatter: p => `${p.name}<br/>Time: <b>${p.value} Years</b><br/>Date: ${p.data.date}` },
            xAxis: { type:'category', data:doubles.map(d=>d.name) },
            yAxis: { name:'Years to Double' },
            series: [{ type:'bar', data:doubles, itemStyle:{color:'#3498db'}, label:{show:true, position:'top', formatter:'{c} Yrs'} }],
            grid: { top:30, bottom:30 }
        });
    }

    function updateFourSeasonsChart(filteredData, pVal) {
        if (noEcharts('four-seasons')) return;
        const _el = document.getElementById('four-seasons-chart');
        if (noEl(_el, 'four-seasons')) return;
        const chart = echarts.init(_el);
        if(!filteredData || !pVal || pVal.length < 2) { chart.clear(); return; }

        // Need Eq and Gold Returns to define season
        // Season 1: Growth+ Inf+ (Eq+, Gold+)
        // Season 2: Growth+ Inf- (Eq+, Gold-)
        // Season 3: Growth- Inf+ (Eq-, Gold+)
        // Season 4: Growth- Inf- (Eq-, Gold-)
        
        const buckets = [[], [], [], []]; // [G+I+, G+I-, G-I+, G-I-]
        // M21: filteredData vs pVal zipped by index — clamp to the shortest so
        // pVal[i] is never read past its own end.
        const _n = minLen('four-seasons', filteredData, pVal);
        
        for(let i=1; i<_n; i++) {
            // filteredData holds RAW INDEX LEVELS — only their month-over-month
            // ratios are comparable with the rupee corpus's return.
            const eqRet = safeDiv(filteredData[i].EQUITY, filteredData[i-1].EQUITY, 0) - 1;
            const glRet = safeDiv(filteredData[i].GOLD, filteredData[i-1].GOLD, 0) - 1;
            const ptRet = safeDiv(pVal[i], pVal[i-1], 0) - 1;
            if(!Number.isFinite(eqRet) || !Number.isFinite(glRet) || !Number.isFinite(ptRet)) continue;
            
            if(eqRet>=0 && glRet>=0) buckets[0].push(ptRet);
            else if(eqRet>=0 && glRet<0) buckets[1].push(ptRet);
            else if(eqRet<0 && glRet>=0) buckets[2].push(ptRet);
            else buckets[3].push(ptRet);
        }
        
        const avgs = buckets.map(arr => safeDiv(arr.reduce((a,b)=>a+b,0), arr.length, 0)*100);
        const counts = buckets.map(arr => arr.length);
        
        // Heatmap Data: [X, Y, Value]
        // X: Inflation (0=Deflation, 1=Inflation)
        // Y: Growth (0=Recession, 1=Boom)
        const data = [
            [1, 1, avgs[0], "Reflation (G+ I+)", counts[0]],
            [0, 1, avgs[1], "Goldilocks (G+ I-)", counts[1]],
            [1, 0, avgs[2], "Stagflation (G- I+)", counts[2]],
            [0, 0, avgs[3], "Depression (G- I-)", counts[3]]
        ];

        chart.setOption({
            tooltip: { formatter: p => `${p.data[3]}<br/>Months: ${p.data[4]}<br/>Avg Return: <b>${p.data[2].toFixed(2)}%</b>` },
            visualMap: { min:-2, max:2, inRange:{color:['#c0392b','#fff','#27ae60']}, calculable:true, orient:'horizontal', left:'center', bottom:0 },
            xAxis: { type:'category', data:['Deflation (Gold -)', 'Inflation (Gold +)'], position:'top' },
            yAxis: { type:'category', data:['Recession (Eq -)', 'Boom (Eq +)'] },
            series: [{ 
                type:'heatmap', data:data, label:{show:true, formatter:p=>`${p.data[3]}\n${p.data[2].toFixed(2)}%`},
                itemStyle: {borderWidth:1, borderColor:'#fff'}
            }],
            grid: { top:60, bottom:40, left:100, right:20 }
        });
    }

    function updateLynchCategoryChart(dates, pVal) {
        if (noEcharts('lynch-category')) return;
        const _el = document.getElementById('lynch-category-chart');
        if (noEl(_el, 'lynch-category')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) { chart.clear(); return; }
        
        const w=12, counts={fast:0, stal:0, slow:0, cyc:0};
        if(pVal.length>w) {
            for(let i=w; i<pVal.length; i++) {
                const r = (safeDiv(pVal[i], pVal[i-w], 0) - 1)*100;
                if(!Number.isFinite(r)) continue;
                if(r>20) counts.fast++;
                else if(r>10) counts.stal++;
                else if(r>0) counts.slow++;
                else counts.cyc++;
            }
        }
        
        chart.setOption({
            tooltip: { trigger:'item', formatter:'{b}: {c} months ({d}%)' },
            series: [{
                type:'pie', radius:['40%','70%'],
                data:[
                    {value:counts.fast, name:'Fast (>20%)', itemStyle:{color:'#27ae60'}},
                    {value:counts.stal, name:'Stalwart (10-20%)', itemStyle:{color:'#2980b9'}},
                    {value:counts.slow, name:'Slow (0-10%)', itemStyle:{color:'#f1c40f'}},
                    {value:counts.cyc, name:'Cyclical (<0%)', itemStyle:{color:'#c0392b'}}
                ]
            }]
        });
    }

    // --- SUITE 19: CASSANDRA (BURRY) ---

    function updateZScoreChart(dates, pVal) {
        if (noEcharts('z-score')) return;
        const _el = document.getElementById('z-score-chart');
        if (noEl(_el, 'z-score')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 3) { chart.clear(); return; }
        // M21: dates/pVal zipped by index.
        const _n = minLen('z-score', dates, pVal);
        
        const w=24, zData=[];
        if(_n > w) {
            for(let i=w; i<_n; i++) {
                // Baseline is the PRECEDING w months; the point drawn at dates[i]
                // is pVal[i] measured against it (a trailing baseline z-score,
                // not a window that has been shifted by one month).
                const slice = pVal.slice(i-w, i);
                const m = slice.reduce((a,b)=>a+b,0)/w;
                const s = Math.sqrt(slice.reduce((x,v)=>x+(v-m)**2,0)/(w-1));
                const z = s>0 ? (pVal[i]-m)/s : 0;
                if(!Number.isFinite(z)) continue;
                zData.push([dates[i], z]);
            }
        }
        
        chart.setOption({
            tooltip: { trigger:'axis' }, xAxis: { type:'time' }, yAxis: { name:'Z-Score', min:-4, max:4 },
            visualMap: { show:false, pieces:[{gt:2, color:'#c0392b'}, {lte:-2, color:'#27ae60'}, {gt:-2, lte:2, color:'#2980b9'}] },
            series: [{ type:'line', data:zData, showSymbol:false }],
            grid: { left:40, right:20, top:30, bottom:30 }
        });
    }

    function updateUnderwaterChart(dates, pVal) {
        if (noEcharts('underwater-duration')) return;
        const _el = document.getElementById('underwater-duration-chart');
        if (noEl(_el, 'underwater-duration')) return;
        const chart = echarts.init(_el);
        if(!pVal || !pVal.length) { chart.clear(); return; }
        // M21: dates/pVal zipped by index.
        const _n = minLen('underwater', dates, pVal);
        
        let peak = -Infinity, peakIdx = 0;
        const durData = [];
        
        for(let i=0; i<_n; i++) {
            if(pVal[i] > peak) {
                peak = pVal[i]; peakIdx = i;
                durData.push([dates[i], 0]);
            } else {
                durData.push([dates[i], i - peakIdx]);
            }
        }
        
        chart.setOption({
            tooltip: { trigger:'axis' }, xAxis: { type:'time' }, yAxis: { name:'Months Underwater' },
            series: [{ type:'line', step:'end', data:durData, areaStyle:{color:'#34495e', opacity:0.4}, showSymbol:false }],
            grid: { left:40, right:20, top:30, bottom:30 }
        });
    }

    // --- SUITE 20: ANTIFRAGILE (TALEB) ---

    function updateResistanceLineChart(dates, pVal) {
        if (noEcharts('resistance-line')) return;
        const _el = document.getElementById('resistance-line-chart');
        if (noEl(_el, 'resistance-line')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) { chart.clear(); return; }
        // M21: dates/pVal zipped by index.
        const _n = minLen('resistance-line', dates, pVal);
        
        const w = 10, sma=[];
        for(let i=0; i<_n; i++) {
            if(i>=w) {
                const s = pVal.slice(i-w, i).reduce((a,b)=>a+b,0)/w;
                sma.push([dates[i], s]);
            }
            // M14: no trend exists before month w — leave it null. Substituting
            // the raw price would draw a price line labelled "10-Mo Trend".
            else sma.push([dates[i], null]);
        }
        
        chart.setOption({
            tooltip: { trigger:'axis' }, xAxis: { type:'time' }, yAxis: { scale:true, type:'value' },
            legend: { data:['Price', '10-Mo Trend'] },
            series: [
                { name:'Price', type:'line', data:pVal.slice(0,_n).map((v,i)=>[dates[i],v]), showSymbol:false, lineStyle:{color:'#333'} },
                { name:'10-Mo Trend', type:'line', data:sma, showSymbol:false, lineStyle:{color:'#f1c40f', type:'dashed'} }
            ],
            grid: { left:60, right:20, top:30, bottom:30 }
        });
    }

    function updateBreakoutStepChart(dates, pVal) {
        if (noEcharts('breakout-step')) return;
        const _el = document.getElementById('breakout-step-chart');
        if (noEl(_el, 'breakout-step')) return;
        const chart = echarts.init(_el);
        if(!pVal || !pVal.length) { chart.clear(); return; }
        // M21: dates/pVal zipped by index.
        const _n = minLen('breakout-step', dates, pVal);
        
        let max = -Infinity;
        const step = pVal.slice(0,_n).map((v, i) => {
            if(v > max) max = v;
            return [dates[i], max];
        });
        
        chart.setOption({
            tooltip: { trigger:'axis' }, xAxis: { type:'time' }, yAxis: { scale:true, type:'value' },
            series: [{ type:'line', step:'start', data:step, showSymbol:false, areaStyle:{color:'#27ae60', opacity:0.1}, lineStyle:{color:'#27ae60'} }],
            grid: { left:60, right:20, top:30, bottom:30 }
        });
    }
