// 31/js/charts-s3.js — suites 24,26,27,28,29,31,35
// Plain script, shared globals. Load after engine.js/utils.js. Dataset is provided by app.js from js/data.json.

    function updateSeasonalityChart(dates, pVal) {
        if (noEcharts('seasonality')) return;
        const _el = document.getElementById('seasonality-chart');
        if (noEl(_el, 'seasonality')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) { chart.clear(); return; }
        // M21: dates/pVal zipped by index.
        const _n = minLen('seasonality', dates, pVal);
        
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const sums = new Array(12).fill(0);
        const counts = new Array(12).fill(0);
        
        for(let i=1; i<_n; i++) {
            // WARN-07: date strings are UTC-midnight — getMonth() would be
            // timezone-sensitive. parseDate + getUTCMonth never shifts a bucket.
            const d = parseDate(dates[i]);
            if (!d) continue;
            const m = d.getUTCMonth();
            const r = (safeDiv(pVal[i], pVal[i-1], 0) - 1)*100;
            if(!Number.isFinite(r)) continue;
            sums[m] += r;
            counts[m]++;
        }
        const avgs = sums.map((s,i) => safeDiv(s, counts[i], 0));
        
        chart.setOption({
            tooltip: { trigger:'axis' }, xAxis: { type:'category', data:months }, yAxis: { name:'Avg Return %' },
            series: [{ type:'bar', data:avgs.map(v=>v.toFixed(2)), itemStyle:{color: v=>v.value>0?'#2980b9':'#c0392b'} }],
            grid: { top:30, bottom:30 }
        });
    }

    function updateProbabilityConeChart(dates, pVal) {
        if (noEcharts('probability-cone')) return;
        const _el = document.getElementById('probability-cone-chart');
        if (noEl(_el, 'probability-cone')) return;
        const chart = echarts.init(_el);
        
        // Project from last point
        if(!pVal || pVal.length < 36) return;
        // M21: dates/pVal zipped by index — the anchor date must be the date of
        // the last point actually used, not dates[dates.length-1].
        const _n = minLen('probability-cone', dates, pVal);
        if(_n < 36) return;
        const last = pVal[_n-1];
        const lastDate = parseDate(dates[_n-1]);
        if(!lastDate) return;
        
        // M20: Math.log(<=0) is -Infinity/NaN and blanks the whole cone. Clamp
        // exactly as charts-core.js does, and never let a bad value through.
        let clamped = 0;
        const safe = (v) => { if(Number.isFinite(v) && v > 0) return v; clamped++; return 0.01; };
        const hist = pVal.slice(0, _n).map(safe);
        if(clamped > 0) console.warn('[charts] probability-cone: ' + clamped + ' non-positive corpus values clamped to 0.01 before log');
        const logRets = hist.slice(-36).map((v,i,a)=> i>0 ? Math.log(v/a[i-1]) : 0).slice(1)
            .filter(r => Number.isFinite(r));
        if(logRets.length < 3) {
            chart.setOption({ title: { text:'Not modelled — insufficient usable history', left:'center', top:'middle', textStyle:{ fontSize:13, color:'#888', fontWeight:'normal' } } });
            return;
        }
        const mu = logRets.reduce((a,b)=>a+b,0)/logRets.length;
        // NB: sigma here is the MONTHLY log-return dispersion used as a GBM
        // projection parameter — deliberately not annVolFromReturns (that would
        // annualise it and change the cone's meaning entirely).
        const sigma = Math.sqrt(logRets.reduce((s,x)=>s+(x-mu)**2,0)/(logRets.length-1));
        
        const upper=[], lower=[], mean=[];
        const startStr = lastDate.toISOString().split('T')[0];
        upper.push([startStr, last]); lower.push([startStr, last]); mean.push([startStr, last]);
        
        for(let t=1; t<=12; t++) {
            // WARN-07: UTC month arithmetic. Anchor on day 1 so a 29th/30th/31st
            // end-of-month date can never overflow into the following month.
            const d = new Date(Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth()+t, 1));
            const ds = d.toISOString().split('T')[0];
            
            const drift = (mu + 0.5*sigma**2)*t;
            const shock = 1.96 * sigma * Math.sqrt(t);
            
            mean.push([ds, last*Math.exp(drift)]);
            upper.push([ds, last*Math.exp(drift+shock)]);
            lower.push([ds, last*Math.exp(drift-shock)]);
        }
        
        chart.setOption({
            // Time axis, matching the sibling charts — a category axis would
            // space these monthly (unequal-in-days) points equally.
            tooltip: { trigger:'axis' }, xAxis: { type:'time' }, yAxis: { scale:true },
            series: [
                { type:'line', data:mean, lineStyle:{type:'dashed', color:'#333'} },
                { type:'line', data:upper, lineStyle:{width:0}, stack:'c', areaStyle:{color:'#2980b9', opacity:0.2} },
                { type:'line', data:lower, lineStyle:{width:0}, stack:'c', areaStyle:{color:'#fff', opacity:1} }
            ],
            grid: { left:60, right:20, top:30, bottom:30 }
        });
    }

    function updateRegimeBarcodeChart(dates, pVal) {
        if (noEcharts('regime-barcode')) return;
        const _el = document.getElementById('regime-barcode-chart');
        if (noEl(_el, 'regime-barcode')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) { chart.clear(); return; }
        // M21: dates/pVal zipped by index.
        const _n = minLen('regime-barcode', dates, pVal);
        
        const data = [];
        const w = 10;
        for(let i=w; i<_n; i++) {
            // Baseline is the PRECEDING w months; dates[i] is the month being
            // classified, so nothing is shifted by a month.
            const sma = pVal.slice(i-w, i).reduce((a,b)=>a+b,0)/w;
            // 0=Bear (Red), 1=Bull (Green)
            data.push([dates[i], 1, pVal[i]>sma ? 1 : 0]);
        }
        
        chart.setOption({
            tooltip: { trigger:'item' }, xAxis: { type:'time' }, yAxis: { show:false },
            visualMap: { type:'piecewise', categories:[0,1], pieces:[{value:0, color:'#c0392b'}, {value:1, color:'#27ae60'}], show:false },
            series: [{ type:'heatmap', data:data }],
            grid: { top:30, bottom:30 }
        });
    }

    function updateDowZigZagChart(dates, pVal) {
        if (noEcharts('dow-zigzag')) return;
        const _el = document.getElementById('dow-zigzag-chart');
        if (noEl(_el, 'dow-zigzag')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) return;
        // M21: dates/pVal zipped by index.
        const _n = minLen('dow-zigzag', dates, pVal);
        const _p = pVal.slice(0, _n);
        
        const pivots = [];
        let trend = 0, lastP = _p[0], lastIdx = 0;
        pivots.push([dates[0], lastP]);
        
        const dev = 0.05; // 5% zig zag
        
        for(let i=1; i<_n; i++) {
            const diff = safeDiv(_p[i], lastP, 0) - 1;
            if(trend===0) {
                if(diff>dev) { trend=1; lastP=_p[i]; lastIdx=i; }
                else if(diff<-dev) { trend=-1; lastP=_p[i]; lastIdx=i; }
            } else if(trend===1) {
                if(_p[i]>lastP) { lastP=_p[i]; lastIdx=i; }
                else if(diff<-dev) { pivots.push([dates[lastIdx], lastP]); trend=-1; lastP=_p[i]; lastIdx=i; }
            } else {
                if(_p[i]<lastP) { lastP=_p[i]; lastIdx=i; }
                else if(diff>dev) { pivots.push([dates[lastIdx], lastP]); trend=1; lastP=_p[i]; lastIdx=i; }
            }
        }
        pivots.push([dates[lastIdx], lastP]);
        
        chart.setOption({
            tooltip: { trigger:'axis' }, xAxis: { type:'time' }, yAxis: { scale:true },
            series: [
                { type:'line', data:pivots, lineStyle:{color:'#2c3e50', width:2}, symbolSize:6, name:'Structure' },
                { type:'line', data:_p.map((v,i)=>[dates[i],v]), lineStyle:{color:'#eee', width:1}, showSymbol:false, z:-1 }
            ],
            grid: { left:50, right:20, top:30, bottom:30 }
        });
    }

    function updateDowConfirmationChart(dates, filteredData) {
        if (noEcharts('dow-confirmation')) return;
        const _el = document.getElementById('dow-confirmation-chart');
        if (noEl(_el, 'dow-confirmation')) return;
        const chart = echarts.init(_el);
        const w = 12, data=[];
        const eq = (filteredData || []).map(d=>d.EQUITY), gl = (filteredData || []).map(d=>d.GOLD);
        // M21: dates vs EQUITY/GOLD rows zipped by index.
        const _n = minLen('dow-confirmation', dates, filteredData);
        
        if(_n > w) {
            for(let i=w; i<_n; i++) {
                const eqSMA = eq.slice(i-w, i).reduce((a,b)=>a+b,0)/w;
                const glSMA = gl.slice(i-w, i).reduce((a,b)=>a+b,0)/w;
                const eqBull = eq[i]>eqSMA, glBull = gl[i]>glSMA;
                let state = 1; // Mixed
                if(eqBull && glBull) state=2; // Bull
                else if(!eqBull && !glBull) state=0; // Bear
                data.push([dates[i], 1, state]);
            }
        }
        
        chart.setOption({
            tooltip: { formatter: p=>['Bear','Mixed','Bull'][p.value[2]] },
            xAxis: { type:'time' }, yAxis: { show:false },
            visualMap: { type:'piecewise', categories:[0,1,2], pieces:[{value:0, color:'#c0392b', label:'Bear'}, {value:1, color:'#f1c40f', label:'Mixed'}, {value:2, color:'#27ae60', label:'Bull'}], orient:'horizontal', top:0 },
            series: [{ type:'heatmap', data:data }],
            grid: { top:40, bottom:20, left:20, right:20 }
        });
    }

    // --- SUITE 27: VANGUARD ---

    function updateGravityLineChart(dates, pVal) {
        if (noEcharts('gravity-line')) return;
        const _el = document.getElementById('gravity-line-chart');
        if (noEl(_el, 'gravity-line')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) return;
        // M21: dates/pVal zipped by index.
        const _n = minLen('gravity-line', dates, pVal);
        const _p = pVal.slice(0, _n);
        
        // Overall CAGR line — M22: shared CAGR helper, elapsed years from the
        // actual dates (never months/12 with a different divisor elsewhere).
        const start = _p[0], end = _p[_n-1];
        const yrs = yearsBetween(dates[0], dates[_n-1]) || (_n-1)/12;
        const cagr = cagrFrom(start, end, yrs);
        const monthly = Math.pow(1 + cagr, 1/12);
        const gravity = _p.map((_, i) => [dates[i], start * Math.pow(monthly, i)]);
        
        chart.setOption({
            tooltip: { trigger:'axis' }, legend:{ data:['Price', 'Gravity (CAGR)'] },
            xAxis: { type:'time' }, yAxis: { scale:true },
            series: [
                { name:'Price', type:'line', data:_p.map((v,i)=>[dates[i],v]), lineStyle:{color:'#333'}, showSymbol:false },
                { name:'Gravity (CAGR)', type:'line', data:gravity, lineStyle:{color:'#3498db', type:'dashed'}, showSymbol:false }
            ],
            grid: { left:60, right:20, top:30, bottom:30 }
        });
    }

    function updateRecoveryHistogramChart(dates, pVal) {
        if (noEcharts('recovery-histogram')) return;
        const _el = document.getElementById('recovery-histogram-chart');
        if (noEl(_el, 'recovery-histogram')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) { chart.clear(); return; }
        // M21: dates/pVal zipped by index.
        const _n = minLen('recovery-histogram', dates, pVal);
        const _p = pVal.slice(0, _n);
        let peak = -Infinity, peakIdx = 0, inDD = false;
        const recs = [];
        
        for(let i=0; i<_n; i++) {
            if(_p[i] > peak) {
                if(inDD) {
                    const depth = (Math.min(..._p.slice(peakIdx, i)) - peak)/peak;
                    if(depth < -0.05) recs.push({ date:dates[peakIdx], months:i-peakIdx, depth:depth });
                    inDD = false;
                }
                peak = _p[i]; peakIdx = i;
            } else inDD = true;
        }
        
        chart.setOption({
            tooltip: { formatter: p => `${p.name}<br/>Depth: ${(p.data.depth*100).toFixed(1)}%<br/>Recovery: ${p.value} Months` },
            xAxis: { type:'category', data:recs.map(r=>r.date) },
            yAxis: { name:'Months' },
            series: [{ type:'bar', data:recs.map(r=>{return {value:r.months, depth:r.depth, itemStyle:{color: r.depth<-0.2?'#c0392b':(r.depth<-0.1?'#e67e22':'#f1c40f')}} }) }],
            grid: { left:40, right:20, top:30, bottom:30 }
        });
    }

    // --- SUITE 28: SCUTTLEBUTT (FISHER) ---

    function updateFisherChannelChart(dates, pVal) {
        if (noEcharts('fisher-channel')) return;
        const _el = document.getElementById('fisher-channel-chart');
        if (noEl(_el, 'fisher-channel')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 10) return;
        // M21: dates/pVal zipped by index.
        const _n = minLen('fisher-channel', dates, pVal);
        const _p = pVal.slice(0, _n);
        
        // M20: log of a depleted corpus (<=0) is -Infinity and blanks the whole
        // channel. Clamp exactly as charts-core.js does, warn when it bites, and
        // never let a NaN/-Infinity point reach the series.
        let clamped = 0;
        const safe = (v) => { if(Number.isFinite(v) && v > 0) return v; clamped++; return 0.01; };
        const price = _p.map(safe);
        if(clamped > 0) console.warn('[charts] fisher-channel: ' + clamped + ' non-positive corpus values clamped to 0.01 before log');
        
        // Log Linear Reg
        const n = price.length;
        let sumX=0, sumY=0, sumXY=0, sumXX=0;
        const logY = price.map(v => Math.log(v));
        for(let i=0; i<n; i++) { sumX+=i; sumY+=logY[i]; sumXY+=i*logY[i]; sumXX+=i*i; }
        const m = (n*sumXY - sumX*sumY)/(n*sumXX - sumX*sumX);
        const b = (sumY - m*sumX)/n;
        
        // Std Dev of Residuals
        const res = logY.map((y,i) => (y - (m*i+b))**2).reduce((a,b)=>a+b,0);
        const sd = Math.sqrt(res/n);
        
        const up=[], dn=[], mean=[];
        for(let i=0; i<n; i++) {
            const y = m*i+b;
            const pts = [Math.exp(y), Math.exp(y + 2*sd), Math.exp(y - 2*sd)];
            if(!pts.every(v => Number.isFinite(v))) continue; // no NaN/-Infinity
            mean.push([dates[i], pts[0]]);
            up.push([dates[i], pts[1]]);
            dn.push([dates[i], pts[2]]);
        }
        
        chart.setOption({
            tooltip: { trigger:'axis' }, xAxis: { type:'time' }, yAxis: { type:'log', scale:true },
            series: [
                { type:'line', data:price.map((v,i)=>[dates[i], v]), name:'Price', lineStyle:{color:'#2980b9'}, showSymbol:false },
                { type:'line', data:mean, name:'Trend', lineStyle:{color:'#333', type:'dashed'}, showSymbol:false },
                { type:'line', data:up, name:'+2SD', lineStyle:{width:0}, areaStyle:{color:'#c0392b', opacity:0.1}, showSymbol:false },
                { type:'line', data:dn, name:'-2SD', lineStyle:{width:0, color:'green'}, showSymbol:false }
            ],
            grid: { left:60, right:20, top:30, bottom:30 }
        });
    }

    function updateFisherThesisChart(dates, pVal) {
        if (noEcharts('fisher-thesis')) return;
        const _el = document.getElementById('fisher-thesis-chart');
        if (noEl(_el, 'fisher-thesis')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) { chart.clear(); return; }
        // M21: dates/pVal zipped by index.
        const _n = minLen('fisher-thesis', dates, pVal);
        const w = 36, data=[];
        if(_n > w) {
            for(let i=w; i<_n; i++) {
                if(pVal[i-w] > 0 && pVal[i] > 0) {
                    // M22: shared CAGR helper (w months = w/12 years).
                    const c = cagrFrom(pVal[i-w], pVal[i], w/12)*100;
                    if(isFinite(c)) data.push([dates[i], +c.toFixed(2)]);
                }
            }
        }
        chart.setOption({
            tooltip: { trigger:'axis', formatter: p => `${p[0].axisValueLabel}<br/>3Y CAGR: <b>${p[0].value[1]}%</b>` },
            legend: { data:['3Y CAGR'], bottom: 0 },
            xAxis: { type:'time' }, yAxis: { name:'3Y CAGR %', scale:true },
            series: [{ name:'3Y CAGR', type:'line', data:data, showSymbol:false, lineStyle:{width:2, color: data.length && data[data.length-1][1] > 10 ? '#27ae60' : '#c0392b'}, markLine:{silent:true, symbol:'none', data:[{yAxis:10, name:'10% thesis', lineStyle:{color:'#333', type:'dashed'}, label:{formatter:'Thesis 10%', position:'end'}}]} }],
            grid: { left:55, right:20, top:30, bottom:50, containLabel:true }
        });
    }

    function updateFisherQuietChart(dates, pVal) {
        if (noEcharts('fisher-quiet')) return;
        const _el = document.getElementById('fisher-quiet-chart');
        if (noEl(_el, 'fisher-quiet')) return;
        const chart = echarts.init(_el);
        if(!pVal || !pVal.length) { chart.clear(); return; }
        // M21: dates/pVal zipped by index.
        const _n = minLen('fisher-quiet', dates, pVal);
        // WARN-07: date strings are UTC-midnight — getFullYear() is
        // timezone-sensitive (west of UTC it lands in the previous year).
        const yearOf = (s) => { const d = parseDate(s); return d ? d.getUTCFullYear() : null; };
        const annual = [];
        let lastY = yearOf(dates[0]);
        annual.push([dates[0], pVal[0]]);
        for(let i=1; i<_n; i++) {
            const currY = yearOf(dates[i]);
            if(currY === null) continue;
            if(currY !== lastY) {
                annual.push([dates[i], pVal[i]]);
                lastY = currY;
            }
        }
        // The trailing point is pushed only if the loop did not already emit it
        // (a January-boundary end date would otherwise appear twice).
        const _lastD = dates[_n-1];
        if(annual.length === 0 || annual[annual.length-1][0] !== _lastD) annual.push([_lastD, pVal[_n-1]]);
        chart.setOption({
            tooltip: { trigger:'item' }, xAxis: { type:'time' }, yAxis: { scale:true, axisLabel:{formatter:v=>'₹'+v.toLocaleString('en-IN',{notation:'compact'})} },
            series: [{ type:'line', step:'end', data:annual, lineStyle:{width:3, color:'#34495e'}, symbolSize:8 }],
            grid: { left:60, right:20, top:30, bottom:30 }
        });
    }

    // --- SUITE 29: CONTRARIAN (TEMPLETON) ---

    function updateTempletonCycleChart(dates, pVal) {
        if (noEcharts('templeton-cycle')) return;
        const _el = document.getElementById('templeton-cycle-chart');
        if (noEl(_el, 'templeton-cycle')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) { chart.clear(); return; }
        // M21: dates/pVal zipped by index.
        const _n = minLen('templeton-cycle', dates, pVal);
        const wMom = 6, wTrend = 24, data=[];
        if(_n > wTrend) {
            for(let i=wTrend; i<_n; i++) {
                const mom = (safeDiv(pVal[i], pVal[i-wMom], 0) - 1)*100;
                const sma = pVal.slice(i-wTrend, i).reduce((a,b)=>a+b,0)/wTrend;
                const val = (sma>0) ? (pVal[i]-sma)/sma*100 : NaN;
                if(isFinite(mom) && isFinite(val)) data.push({ value:[+mom.toFixed(2), +val.toFixed(2)], name:dates[i] });
            }
        }
        const last = data.length > 0 ? data[data.length-1] : null;
        const trail = data.length > 12 ? data.slice(-13) : data.slice(); // 12m leading to current + current
        const trailLine = trail.map(d => d.value);
        chart.setOption({
            tooltip: { formatter: p => `${p.name||p.seriesName}<br/>Mom: ${p.value[0].toFixed(1)}%<br/>Val: ${p.value[1].toFixed(1)}%` },
            legend:{data:['History','Last 12M trail','YOU'], bottom:0},
            xAxis: { name:'Momentum %', splitLine:{show:false}, scale:true }, yAxis: { name:'Valuation Dev %', splitLine:{show:false}, scale:true },
            series: [
                { name:'History', type:'scatter', data:data, symbolSize:5, itemStyle:{color:'rgba(41, 128, 185, 0.25)'} },
                { name:'Last 12M trail', type:'line', data:trailLine, showSymbol:true, symbolSize:6, lineStyle:{color:'#e67e22', width:2.5}, itemStyle:{color:'#e67e22'}, z:5 },
                { name:'YOU', type:'scatter', data:last?[last]:[], symbolSize:16, itemStyle:{color:'#e74c3c', borderColor:'#fff', borderWidth:2}, label:{show:true, formatter:'YOU', position:'top', color:'#c0392b', fontWeight:'bold'} }
            ],
            grid: { left:50, right:30, top:30, bottom:55, containLabel:true }
        });
    }

    function updateBargainOscillatorChart(dates, pVal) {
        if (noEcharts('bargain-oscillator')) return;
        const _el = document.getElementById('bargain-oscillator-chart');
        if (noEl(_el, 'bargain-oscillator')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) { chart.clear(); return; }
        // M21: dates/pVal zipped by index.
        const _n = minLen('bargain-oscillator', dates, pVal);
        const _p = pVal.slice(0, _n);
        let peak = -Infinity;
        const ratios = _p.map(v => { if(v>peak) peak=v; return safeDiv(v, peak, 0)*100; }); // 100 = peak, 80 = -20% DD
        
        // Normalize 0-100 based on 14d stochastic of this ratio
        const osc = [];
        const w = 14;
        for(let i=w; i<ratios.length; i++) {
            const s = ratios.slice(i-w, i+1);
            const min = Math.min(...s), max = Math.max(...s);
            const k = max===min ? 50 : ((ratios[i]-min)/(max-min))*100;
            if(!Number.isFinite(k)) continue;
            osc.push([dates[i], k]);
        }
        
        chart.setOption({
            tooltip: { trigger:'axis' }, xAxis: { type:'time' }, yAxis: { name:'Oscillator', min:0, max:100 },
            visualMap: { show:false, pieces:[{gt:80, color:'#c0392b'}, {lte:20, color:'#27ae60'}, {gt:20, lte:80, color:'#34495e'}] },
            series: [{ type:'line', data:osc, showSymbol:false, markLine:{data:[{yAxis:20}, {yAxis:80}]} }],
            grid: { left:40, right:20, top:30, bottom:30 }
        });
    }

    // --- SUITE 30: PTJ (TUDOR JONES) ---

    function updateDruckHomeRunChart(pVal) {
        if (noEcharts('druck-homerun')) return;
        const _el = document.getElementById('druck-homerun-chart');
        if (noEl(_el, 'druck-homerun')) return;
        const chart = echarts.init(_el);
        if(!pVal || pVal.length < 2) { chart.clear(); return; }
        const rets = []; for(let i=1; i<pVal.length; i++) { const r = safeDiv(pVal[i], pVal[i-1], 0) - 1; if(Number.isFinite(r)) rets.push(r*100); }
        let bw=0, sw=0, sl=0, bl=0;
        rets.forEach(r => {
            if(r > 5) bw++; else if(r > 0) sw++;
            else if(r > -5) sl++; else bl++;
        });
        const tot = rets.length || 1;
        chart.setOption({
            tooltip: { trigger:'item' }, xAxis: { type:'category', data:['Big Win (>5%)', 'Win', 'Loss', 'Big Loss (<-5%)'] },
            yAxis: { name:'% Freq' },
            series: [{ type:'bar', data:[(bw/tot*100).toFixed(1), (sw/tot*100).toFixed(1), (sl/tot*100).toFixed(1), (bl/tot*100).toFixed(1)], itemStyle:{color: p=>p.dataIndex<2?'#27ae60':'#c0392b'} }],
            grid: { top:30, bottom:30 }
        });
    }

    function calculateRRGData(dates, pVal, bVal) {
        // M21: pVal/bVal zipped by index — clamp to shortest, never divide by undefined.
        const _n = minLen('rrg', dates, pVal, bVal);
        const _p = pVal.slice(0, _n), _b = bVal.slice(0, _n), _d = dates.slice(0, _n);
        // JdK RRG Logic (Simplified for Daily/Monthly data)
        // bVal is a raw index level and pVal a rupee corpus, so the RS-ratio
        // deliberately compares the two SERIES (scale-free, normalised around
        // 100 below) — never their raw difference or their sum.
        const rs = _p.map((v, i) => safeDiv(v, _b[i], 0));
        const w = 12; // 12-period smoothing
        const points = [];
        
        if(rs.length > w + 1 && rs.every(v => v > 0)) {
            // Pre-calculate RS-Ratios
            const ratios = [];
            for(let i=0; i<rs.length; i++) {
                if(i < w) { ratios.push(100); continue; }
                const slice = rs.slice(i-w+1, i+1);
                const sma = slice.reduce((a,b)=>a+b,0)/w;
                // Normalize around 100
                ratios.push(safeDiv(rs[i], sma, 0)*100);
            }

            // Calculate Momentum based on Ratio Rate of Change
            for(let i=w; i<ratios.length; i++) {
                // Momentum = (Ratio / Previous_Ratio) * 100
                // This creates the vertical movement centered at 100
                const prevRatio = ratios[i-1]; 
                const momentum = safeDiv(ratios[i], prevRatio, 1) * 100;
                
                if(Number.isFinite(momentum) && Number.isFinite(ratios[i])) points.push({ date:_d[i], ratio: ratios[i], momentum: momentum });
            }
        }
        return points;
    }

    function updateRRGChart(rrgData) {
        if (noEcharts('rrg')) return;
        const _el = document.getElementById('rrg-chart');
        if (noEl(_el, 'rrg')) return;
        const chart = echarts.init(_el);
        
        if(!rrgData || rrgData.length < 1) { chart.clear(); return; }
        
        // Use last 24 points for the trail to reduce clutter
        const tail = rrgData.slice(-24).map(d => [d.ratio, d.momentum, d.date]);
        
        // Dynamic Scaling Logic
        const xVals = tail.map(d => d[0]);
        const yVals = tail.map(d => d[1]);
        
        // Ensure 100 (Center) is always included in the scale calculation
        xVals.push(100); yVals.push(100);
        
        // Add padding
        const xMin = Math.floor(Math.min(...xVals) - 0.5);
        const xMax = Math.ceil(Math.max(...xVals) + 0.5);
        const yMin = Math.floor(Math.min(...yVals) - 0.5);
        const yMax = Math.ceil(Math.max(...yVals) + 0.5);

        chart.setOption({
            title: { text: 'Rotation Trail (Last 24 Months)', left: 'center', top: 10, textStyle: { fontSize: 14 } },
            tooltip: { 
                trigger: 'item',
                formatter: (p) => {
                    // WARN-07: format the UTC date, never the local-timezone one.
                    const d = parseDate(p.value[2]);
                    const date = d ? d.toLocaleDateString('en-US', {month:'short', year:'numeric', timeZone:'UTC'}) : '';
                    return `<b>${escHtml(date)}</b><br/>Trend (Ratio): ${finiteOr(p.value[0],0).toFixed(2)}<br/>Mom (ROC): ${finiteOr(p.value[1],0).toFixed(2)}`;
                }
            },
            xAxis: { 
                name: 'Relative Strength (Trend)', 
                min: xMin, max: xMax,
                nameLocation: 'middle', nameGap: 25,
                splitLine: { show: false }
            },
            yAxis: { 
                name: 'Relative Momentum', 
                min: yMin, max: yMax,
                scale: true,
                splitLine: { show: false }
            },
            series: [
                { 
                    type:'line', 
                    smooth:true, 
                    data:tail, 
                    lineStyle: { width: 3, color: '#333' },
                    symbol: 'circle',
                    symbolSize: 6,
                    itemStyle: {
                        color: (p) => {
                            // Color points by Quadrant
                            const x = p.value[0];
                            const y = p.value[1];
                            if (x >= 100 && y >= 100) return '#27ae60'; // Leading (Green)
                            if (x >= 100 && y < 100) return '#f1c40f'; // Weakening (Yellow)
                            if (x < 100 && y < 100) return '#c0392b'; // Lagging (Red)
                            return '#2980b9'; // Improving (Blue)
                        }
                    },
                    markArea: { 
                        silent:true, 
                        itemStyle: { opacity: 0.1 },
                        data: [
                            // Quadrant Backgrounds using dynamic Max/Min
                            [{coord:[100,100], itemStyle:{color:'#27ae60'}}, {coord:[xMax,yMax]}], // Leading
                            [{coord:[100,yMin], itemStyle:{color:'#f1c40f'}}, {coord:[xMax,100]}], // Weakening
                            [{coord:[xMin,yMin], itemStyle:{color:'#c0392b'}}, {coord:[100,100]}], // Lagging
                            [{coord:[xMin,100], itemStyle:{color:'#2980b9'}}, {coord:[100,yMax]}]  // Improving
                        ] 
                    },
                    markLine: {
                        silent: true,
                        symbol: 'none',
                        lineStyle: { color: '#666', width: 1 },
                        data: [{ xAxis: 100 }, { yAxis: 100 }]
                    }
                },
                // Add an Arrow or distinctive point for the CURRENT position
                {
                    type: 'scatter',
                    data: [tail[tail.length-1]],
                    symbolSize: 12,
                    itemStyle: { color: '#000', borderColor: '#fff', borderWidth: 2 },
                    label: { show: true, formatter: 'YOU', position: 'top' },
                    z: 10
                }
            ],
            grid: { left:40, right:40, top:30, bottom:40 }
        });
    }

    function updateRRGHistoryChart(rrgData) {
        if (noEcharts('rrg-history')) return;
        const _el = document.getElementById('rrg-history-chart');
        if (noEl(_el, 'rrg-history')) return;
        const chart = echarts.init(_el);
        if(!rrgData || !rrgData.length) { chart.clear(); return; }
        const data = rrgData.map(d => {
            let s=0;
            if(d.ratio>100 && d.momentum>100) s=3; // Leading
            else if(d.ratio>100) s=2; // Weakening
            else if(d.momentum>100) s=1; // Improving
            return [d.date, 1, s];
        });
        
        chart.setOption({
            tooltip: { formatter: p => ['Lagging','Improving','Weakening','Leading'][p.value[2]] },
            xAxis: { type:'time' }, yAxis: { show:false },
            visualMap: { type:'piecewise', categories:[0,1,2,3], pieces:[{value:0,color:'#c0392b'},{value:1,color:'#2980b9'},{value:2,color:'#f1c40f'},{value:3,color:'#27ae60'}], show:false },
            series: [{ type:'heatmap', data:data }],
            grid: { top:30, bottom:30 }
        });
    }
