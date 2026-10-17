// 31/js/charts-s5.js — suites 44,45,46,48,49,51,53
// Plain script, shared globals. Load after engine.js/utils.js. Dataset is provided by app.js from js/data.json.
// C1 convention: every division whose denominator is not a literal goes through
// safeDiv(), so a flat/zero window can never hand Infinity/NaN to a formatter.

    function updateMoodysScenarioChart(dates, pVal, bVal) {
        if (noEcharts('moodys-scenario')) return;
        const el = document.getElementById('moodys-scenario-chart');
        if (noEl(el, 'moodys-scenario')) return;
        // M17 — guards postTaxVals but never guarded dates, so new Date(undefined) ->
        // toISOString() threw a RangeError. Short/empty history is an explicit state.
        // M21 — dates/pVal zipped by index, clamp before projecting forward.
        const _n = (!dates || !pVal) ? 0 : minLen('moodys-scenario', dates, pVal);
        if (_n < 2) {
            console.warn('[charts] moodys-scenario: need >= 2 dated observations, got ' + _n);
            try { const _old = echarts.getInstanceByDom(el); if (_old) _old.dispose(); } catch (e) {}
            el.textContent = '⚠ Scenario projection not modelled — insufficient data (need at least 2 monthly observations).';
            el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
            el.style.textAlign = 'center'; el.style.fontSize = '13px'; el.style.color = '#7f8c8d';
            return;
        }
        const dArr = dates.slice(0, _n), pArr = pVal.slice(0, _n);
        const bArr = (bVal && bVal.length >= _n) ? bVal.slice(0, _n) : null;
        // WARN-07 — parse as UTC midnight and build months with the UTC setters.
        const lastD = parseDate(dArr[_n - 1]);
        if (!lastD) return;
        const sLast = pArr[_n - 1];
        const bLast = (bArr && bArr.length) ? bArr[bArr.length - 1] : sLast;
        if (!Number.isFinite(sLast) || !Number.isFinite(bLast)) return;
        // Reset the "insufficient data" styling a previous short run may have left behind.
        el.style.display = ''; el.style.alignItems = ''; el.style.justifyContent = ''; el.style.textAlign = '';
        const chart = echarts.init(el);
        // M22 — the one CAGR definition (actual elapsed days). Short history yields null
        // and the baseline is simply not modelled; never substitute a fixed 12%.
        const cagr = (vals) => {
            if (!vals || vals.length <= 12) return null;
            const years = yearsBetween(dArr[0], dArr[_n - 1]);
            const r = cagrFrom(vals[0], vals[vals.length - 1], years);
            return Number.isFinite(r) && years > 0 ? r : null;
        };
        const sT = cagr(pArr), bT = bArr ? cagr(bArr) : null;
        const mk = (start, ann) => {
            const out = [];
            const y0 = lastD.getUTCFullYear(), m0 = lastD.getUTCMonth(), day0 = lastD.getUTCDate();
            for (let i = 0; i <= 12; i++) {
                const d = new Date(Date.UTC(y0, m0 + i, 1));
                // WARN-07 — Date.UTC overflows a short month, so clamp the day instead.
                const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
                d.setUTCDate(Math.min(day0, dim));
                out.push([d.toISOString().split('T')[0], finiteOr(start * Math.pow(1 + ann, i/12), null)]);
            }
            return out;
        };
        // Stress paths are hypothetical scenarios, not measurements — they are labelled as
        // such. The baseline is the measured CAGR and is omitted when history is short.
        const series = [];
        if (sT !== null) series.push({ name:'S-Base (measured)', type:'line', data:mk(sLast, sT), showSymbol:false, lineStyle:{color:'#2980b9', width:2} });
        series.push({ name:'S-Stress: GFC-scale -40% (scenario)', type:'line', data:mk(sLast,-0.40), showSymbol:false, lineStyle:{color:'#c0392b', width:2} });
        series.push({ name:'S-Stress: Covid-scale -35% (scenario)', type:'line', data:mk(sLast,-0.35), showSymbol:false, lineStyle:{color:'#e67e22', width:2, type:'dashed'} });
        if (bT !== null) series.push({ name:'B-Base (measured)', type:'line', data:mk(bLast, bT), showSymbol:false, lineStyle:{color:'#8e44ad', width:1.5} });
        series.push({ name:'B-Stress: GFC-scale -40% (scenario)', type:'line', data:mk(bLast,-0.40), showSymbol:false, lineStyle:{color:'#7f0000', width:1.5} });
        series.push({ name:'B-Stress: Covid-scale -35% (scenario)', type:'line', data:mk(bLast,-0.35), showSymbol:false, lineStyle:{color:'#d35400', width:1.5, type:'dashed'} });
        const sub = sT === null
            ? 'Baseline not modelled — history too short to derive a CAGR. Stress lines are hypothetical scenarios.'
            : 'Baseline = measured CAGR over the sample. Stress lines are hypothetical scenarios.';
        chart.setOption({
            title: { text:sub, left:'center', top:0, textStyle:{fontSize:11, fontWeight:'normal', color:'#7f8c8d'} },
            tooltip: { trigger:'axis', axisLabel:{formatter:v=>'₹'+fmtINRv0(v)} },
            legend: { data:series.map(s=>s.name), bottom:0, type:'scroll' },
            xAxis: { type:'time' }, yAxis: { scale:true, axisLabel:{formatter:v=>'₹'+fmtINRv0(v)} },
            series: plainData(series),
            grid: { left:65, right:20, top:34, bottom:65, containLabel:true }
        });
    }

    function updateJPMCaptureChart(dates, pVal, bVal) {
        if (noEcharts('jpm-capture')) return;
        const _el = document.getElementById('jpm-capture-chart');
        if (noEl(_el, 'jpm-capture')) return;
        // M21 — pVal[i] was indexed inside a bVal.length-bounded loop; clamp both.
        const _n = minLen('jpm-capture', pVal, bVal);
        if (_n < 2) return;
        const chart = echarts.init(_el);
        let uS=0, uB=0, dS=0, dB=0;
        for(let i=1; i<_n; i++) {
            // C1 — monthly returns via safeDiv; a zero prior level is not -100%.
            const b = safeDiv(bVal[i], bVal[i-1], null), p = safeDiv(pVal[i], pVal[i-1], null);
            if (b === null || p === null) continue;
            if(b>=0) { uB+=b-1; uS+=p-1; }
            else { dB+=b-1; dS+=p-1; }
        }
        // C1 — capture ratios via safeDiv; a benchmark with no up (or no down) months
        // makes the ratio undefined, so plot a gap rather than Infinity.
        const up = safeDiv(uS, uB, null), dn = safeDiv(dS, dB, null);

        chart.setOption({
            tooltip: { formatter:'{b}: {c}%' }, xAxis: { type:'category', data:['Up Capture', 'Down Capture'] }, yAxis: { max:150 },
            series: [{ type:'bar', data:[finiteOr(up===null?null:up*100, null), finiteOr(dn===null?null:dn*100, null)], itemStyle:{color: v=>v.dataIndex===0?'#27ae60':'#c0392b'}, barWidth:50, label:{show:true, position:'top', formatter: p => p.value==null?'N/A':fmtNum(p.value,0)+'%'} }],
            grid: { top:30, bottom:30 }
        });
    }


    // --- SUITE 46: MORNINGSTAR ---

    function updateMSMRARChart(dates, pVal, bVal) {
        if (noEcharts('ms-mrar')) return;
        const _el = document.getElementById('ms-mrar-chart');
        if (noEl(_el, 'ms-mrar')) return;
        // M21 — dates/pVal/bVal zipped by index, clamp to the shortest.
        const _n = minLen('ms-mrar', dates, pVal, bVal);
        if (_n < 2) return;
        const dArr = dates.slice(0, _n);
        const chart = echarts.init(_el);
        const calcMRAR = (vals) => {
            if(vals.length<2) return 0;
            const rets = [];
            for (let i = 1; i < vals.length; i++) {
                // C1 — monthly return via safeDiv.
                const r = safeDiv(vals[i], vals[i-1], null);
                if (r !== null) rets.push(r - 1);
            }
            if (!rets.length) return 0;
            const u = safeDiv(rets.reduce((s,r)=>s+Math.pow(1+r, -2), 0), rets.length, null);
            // C1 — Math.pow(u,-1/2) is Infinity for u<=0; finiteOr keeps toFixed safe.
            if (u === null || !(u > 0)) return 0;
            return finiteOr((Math.pow(u, -1/2)*12 - 12)*100, 0);
        };
        // M22 — the one CAGR definition over the sample's real elapsed days,
        // not 12/(len-1) which assumes every observation is exactly one month.
        const calcCAGR = (vals) => cagrFrom(vals[0], vals[vals.length-1], yearsBetween(dArr[0], dArr[_n-1])) * 100;

        chart.setOption({
            tooltip: { trigger:'item' }, legend: { data:['CAGR', 'MRAR (Risk Adj)'] },
            xAxis: { type:'category', data:['Strategy', 'Benchmark'] }, yAxis: { name:'%' },
            series: [
                { name:'CAGR', type:'bar', data:[finiteOr(calcCAGR(pVal.slice(0,_n)), 0), finiteOr(calcCAGR(bVal.slice(0,_n)), 0)], itemStyle:{color:'#95a5a6'}, label:{show:true, position:'top', formatter:p=>fmtNum(p.value,2)+'%'} },
                { name:'MRAR (Risk Adj)', type:'bar', data:[finiteOr(calcMRAR(pVal.slice(0,_n)), 0), finiteOr(calcMRAR(bVal.slice(0,_n)), 0)], itemStyle:{color:'#2980b9'}, label:{show:true, position:'top', formatter:p=>fmtNum(p.value,2)+'%'} }
            ],
            grid: { top:30, bottom:30 }
        });
    }

    function updateMSRollingRangesChart(dates, pVal, bVal) {
        if (noEcharts('ms-rolling-ranges')) return;
        const _el = document.getElementById('ms-rolling-ranges-chart');
        if (noEl(_el, 'ms-rolling-ranges')) return;
        // M21 — dates/pVal/bVal zipped by index, clamp before any window read.
        const _n = minLen('ms-rolling-ranges', dates, pVal, bVal);
        if (_n < 2) return;
        const dArr = dates.slice(0, _n);
        const chart = echarts.init(_el);

        // Added 10Y (120 months)
        const horizons = [12, 36, 60, 120];
        const names = ['1Y', '3Y', '5Y', '10Y'];

        const calc = (vals, w) => {
            // Strict check: Need at least w+1 data points to calculate a return
            if(vals.length <= w) return null;

            const r = [];
            for(let i=w; i<vals.length; i++) {
                // M22 — the one CAGR definition, annualised over the window's real
                // elapsed days instead of assuming the window is exactly w months.
                const yrs = yearsBetween(dArr[i - w], dArr[i]);
                // C1 — cagrFrom returns 0 rather than Infinity for a non-positive window.
                r.push(cagrFrom(vals[i - w], vals[i], yrs) * 100);
            }

            if (r.length === 0) return null;

            return {
                min: Math.min(...r),
                max: Math.max(...r),
                avg: safeDiv(r.reduce((a,b)=>a+b,0), r.length, 0)
            };
        };

        // Calculate data for all horizons
        const pRaw = horizons.map(h => calc(pVal.slice(0, _n), h));
        const bRaw = horizons.map(h => calc(bVal.slice(0, _n), h));

        // Prepare Series Data: [CategoryIndex, Min, Max, Avg, Type(1=Strat, 0=Bench)]
        const pData = [];
        const bData = [];

        names.forEach((name, i) => {
            if (pRaw[i]) pData.push([i, pRaw[i].min, pRaw[i].max, pRaw[i].avg, 1]);
            if (bRaw[i]) bData.push([i, bRaw[i].min, bRaw[i].max, bRaw[i].avg, 0]);
        });

        const renderItem = (params, api) => {
            const xValue = api.value(0);
            const min = api.value(1);
            const max = api.value(2);
            const avg = api.value(3);
            const isPortfolio = api.value(4) === 1;

            // Get Coordinates
            const ptMax = api.coord([xValue, max]); // Top
            const ptMin = api.coord([xValue, min]); // Bottom
            const ptAvg = api.coord([xValue, avg]); // Middle dot

            // Offset to separate Strategy (Left) and Benchmark (Right)
            const offset = isPortfolio ? -15 : 15;
            const x = ptMax[0] + offset;

            // Styles
            const color = isPortfolio ? '#2980b9' : '#e74c3c';
            const width = 10; // Width of the horizontal caps

            return {
                type: 'group',
                children: [
                    // 1. Vertical Range Line
                    {
                        type: 'line',
                        shape: { x1: x, y1: ptMax[1], x2: x, y2: ptMin[1] },
                        style: api.style({ stroke: color, lineWidth: 2 })
                    },
                    // 2. Top Cap (Max)
                    {
                        type: 'line',
                        shape: { x1: x - width, y1: ptMax[1], x2: x + width, y2: ptMax[1] },
                        style: api.style({ stroke: color, lineWidth: 2 })
                    },
                    // 3. Bottom Cap (Min)
                    {
                        type: 'line',
                        shape: { x1: x - width, y1: ptMin[1], x2: x + width, y1: ptMin[1] },
                        style: api.style({ stroke: color, lineWidth: 2 })
                    },
                    // 4. Average Dot
                    {
                        type: 'circle',
                        shape: { cx: x, cy: ptAvg[1], r: 5 },
                        style: { fill: color, stroke: '#fff', lineWidth: 1 }
                    }
                ]
            };
        };

        chart.setOption({
            tooltip: {
                trigger: 'axis', confine: true,
                formatter: (params) => {
                    // Safe tooltip generation
                    if (!params || !params.length) return '';
                    // Better to use value[0]
                    const categoryIdx = params[0].value[0];

                    let res = `<b>${escHtml(names[categoryIdx])} Rolling Horizon</b><br/>`;

                    params.forEach(p => {
                        const isStrat = p.seriesName === 'Strategy';
                        const label = isStrat ? "Strategy" : "Benchmark";
                        const color = isStrat ? '#2980b9' : '#e74c3c';

                        // CRIT-11 — tooltip HTML is injected, so escape + guard every part.
                        const min = fmtNum(p.value[1], 1);
                        const max = fmtNum(p.value[2], 1);
                        const avg = fmtNum(p.value[3], 1);

                        res += `<span style="color:${color}">●</span> ${escHtml(label)}: Avg <b>${escHtml(avg)}%</b> (Range: ${escHtml(min)}% to ${escHtml(max)}%)<br/>`;
                    });
                    return res;
                }
            },
            legend: { data: ['Strategy', 'Benchmark'], bottom: 0 },
            xAxis: { type: 'category', data: names, axisLabel:{interval:0} },
            yAxis: { name: 'Annualized Return %', scale: true, axisLabel:{formatter:'{value}%'} },
            series: [
                {
                    name: 'Strategy',
                    type: 'custom',
                    renderItem: renderItem,
                    encode: { x: 0, y: [1, 2, 3] },
                    data: plainData(pData),
                    itemStyle: { color: '#2980b9' }
                },
                {
                    name: 'Benchmark',
                    type: 'custom',
                    renderItem: renderItem,
                    encode: { x: 0, y: [1, 2, 3] },
                    data: plainData(bData),
                    itemStyle: { color: '#e74c3c' }
                }
            ],
            grid: { top: 40, bottom: 60, left: 60, right: 30, containLabel: true }
        });
        try { chart.resize(); } catch(e) {}
        setTimeout(()=>{ try { chart.resize(); } catch(e) {} }, 300);
    }

    // --- SUITE 47: BOFA ---

    function updateVerdictCharts(dates, pVal, bVal) {
        if (noEcharts('verdict')) return;
        // M21 — every stat below indexes both series by date, clamp to the shortest.
        const _n = minLen('verdict', dates, pVal, bVal);
        if (_n < 2) { console.warn('[charts] verdict: need >= 2 dated observations, got ' + _n); return; }
        const dArr = dates.slice(0, _n);
        // The old "Return Cost" bar targeted a `verdict-deal-chart` container that no
        // longer exists in index.html, so it silently never rendered. The section is
        // renumbered to match the two charts that do exist.
        const calcStats = (vals) => {
            const v = vals.slice(0, _n), rets = [];
            for (let i = 1; i < v.length; i++) {
                // C1 — monthly return via safeDiv.
                const r = safeDiv(v[i], v[i-1], null);
                if (r !== null) rets.push(r - 1);
            }
            // M22 — shared CAGR (actual elapsed days) and shared annualised vol.
            const cagr = cagrFrom(v[0], v[v.length-1], yearsBetween(dArr[0], dArr[_n-1])) * 100;
            const vol = annVolFromReturns(rets) * 100;
            let peak=-Infinity, maxDD=0;
            v.forEach(x=>{ if(x>peak) peak=x; const d = safeDiv(x, peak, null); if (d !== null && d < maxDD) maxDD = d; });
            return { cagr, maxDD:Math.abs(maxDD*100), vol };
        };
        const pS = calcStats(pVal), bS = calcStats(bVal);
        // C1 — every ratio through the shared safeDiv. A flat benchmark (vol 0, maxDD 0)
        // yields null, which renders as N/A; Infinity.toFixed() used to throw a RangeError
        // and blank the whole verdict section.
        // 1. Efficiency
        const _effEl = document.getElementById('verdict-efficiency-chart');
        if (!noEl(_effEl, 'verdict-efficiency')) {
            const chart2 = echarts.init(_effEl);
            const pEff = safeDiv(pS.cagr, pS.vol, null), bEff = safeDiv(bS.cagr, bS.vol, null);
            chart2.setOption({
                xAxis: { type:'value', name:'Return per 1% Vol' }, yAxis: { type:'category', data:['Benchmark', 'Strategy'] },
                series: [{ type:'bar', data:[
                    {value:finiteOr(bEff, null), itemStyle:{color:'#e74c3c'}},
                    {value:finiteOr(pEff, null), itemStyle:{color:'#2980b9'}}
                ], label:{show:true, position:'right', formatter: p => p.value==null?'N/A':fmtNum(p.value,2)} }],
                grid: { top:30, bottom:30, left:70 }
            });
        }

        // 3. Pain Price — a missing efficiency container must not skip this one.
        const _painEl = document.getElementById('verdict-pain-return-chart');
        if (!noEl(_painEl, 'verdict-pain-return')) {
            const chart3 = echarts.init(_painEl);
            const pPain = safeDiv(pS.cagr, pS.maxDD, null), bPain = safeDiv(bS.cagr, bS.maxDD, null);
            chart3.setOption({
                xAxis: { type:'value', name:'Return per 1% Crash' }, yAxis: { type:'category', data:['Benchmark', 'Strategy'] },
                series: [{ type:'bar', data:[
                    {value:finiteOr(bPain, null), itemStyle:{color:'#e74c3c'}},
                    {value:finiteOr(pPain, null), itemStyle:{color:'#2980b9'}}
                ], label:{show:true, position:'right', formatter: p => p.value==null?'N/A':fmtNum(p.value,2)} }],
                grid: { top:30, bottom:30, left:70 }
            });
        }
    }

    // --- SUITE 49: GREED & FEAR ---

    function updateGFDiscountChart(dates, pVal, bVal) {
        if (noEcharts('gf-discount')) return;
        const _el = document.getElementById('gf-discount-chart');
        if (noEl(_el, 'gf-discount')) return;
        // M21 — getDD zips vals by dates[i], clamp so dates[i] is never undefined.
        const _n = minLen('gf-discount', dates, pVal, bVal);
        if (_n < 2) return;
        const _d = dates.slice(0, _n);
        const chart = echarts.init(_el);
        const getDD = (vals) => {
            let peak=-Infinity;
            return vals.slice(0, _n).map((v,i) => {
                if(v>peak) peak=v;
                // C1 — drawdown ratio via safeDiv; a zero peak must not become Infinity.
                return [_d[i], finiteOr(safeDiv(v, peak, null), 0) * 100];
            });
        };
        chart.setOption({
            tooltip: { trigger:'axis' }, legend: { data:['Strategy', 'Benchmark'] },
            xAxis: { type:'time' }, yAxis: { name:'Discount %', inverse:true },
            series: [
                { name:'Strategy', type:'line', data:plainData(getDD(pVal)), areaStyle:{color:'#2980b9', opacity:0.2}, lineStyle:{color:'#2980b9', width:1}, showSymbol:false },
                { name:'Benchmark', type:'line', data:plainData(getDD(bVal)), lineStyle:{color:'#e74c3c', width:1}, showSymbol:false }
            ],
            grid: { left:40, right:20, top:30, bottom:30 }
        });
    }

    function updateMacAnnuityChart(pVal, bVal) {
        if (noEcharts('mac-annuity')) return;
        const _el = document.getElementById('mac-annuity-chart');
        if (noEl(_el, 'mac-annuity')) return;
        // M21 — histograms are built independently, but clamp so vals[i-1] exists.
        const _n = minLen('mac-annuity', pVal, bVal);
        if (_n < 2) return;
        const chart = echarts.init(_el);
        const getHist = (vals) => {
            const bins = new Array(11).fill(0); // -5% to +5%
            for(let i=1; i<vals.length; i++) {
                // C1 — monthly return via safeDiv.
                const q = safeDiv(vals[i], vals[i-1], null);
                if (q === null) continue;
                let r = (q - 1) * 100;
                r = Math.max(-5, Math.min(5, r));
                const idx = Math.floor(r) + 5;
                if(idx>=0 && idx<=10) bins[idx]++;
            }
            return bins;
        };
        chart.setOption({
            tooltip: { trigger:'axis' }, legend:{}, xAxis: { type:'category', data:['-5%','-4%','-3%','-2%','-1%','0%','1%','2%','3%','4%','5%'] }, yAxis: { name:'Freq' },
            series: [
                { name:'Strategy', type:'bar', data:plainData(getHist(pVal.slice(0,_n))), itemStyle:{color:'#2980b9', opacity:0.7} },
                { name:'Benchmark', type:'line', data:plainData(getHist(bVal.slice(0,_n))), itemStyle:{color:'#e74c3c'} }
            ],
            grid: { top:30, bottom:30 }
        });
    }

    function updateBRFactorChart(pVal, bVal) {
        if (noEcharts('br-factor')) return;
        const _el = document.getElementById('br-factor-chart');
        if (noEl(_el, 'br-factor')) return;
        // M22 — app.js calls this with (postTaxVals, benchVals) only; if it ever passes
        // dateVals as the 3rd argument the CAGR window uses real elapsed days.
        const getDates = () => (typeof dates !== 'undefined' && dates && dates.length ? dates : null);
        // M21 — clamp the two series to one common sample.
        const _n = minLen('br-factor', pVal, bVal);
        const w = 36;
        // A price series carries no quality/value factor exposure — scoring those axes
        // would be invented data, so a short window renders an explicit empty state.
        if (_n < Math.max(2, w)) {
            console.warn('[charts] br-factor: need >= ' + w + ' months, got ' + _n);
            try { const _old = echarts.getInstanceByDom(_el); if (_old) _old.dispose(); } catch (e) {}
            _el.textContent = '⚠ Factor tilt not modelled — need at least 36 months of history.';
            _el.style.display = 'flex'; _el.style.alignItems = 'center';
            _el.style.justifyContent = 'center'; _el.style.textAlign = 'center';
            _el.style.fontSize = '13px'; _el.style.color = '#7f8c8d';
            return;
        }
        _el.style.display = ''; _el.style.alignItems = ''; _el.style.justifyContent = '';
        _el.style.textAlign = '';
        const chart = echarts.init(_el);
        const dArr = getDates();
        const getS = (vals) => {
            const v = vals.slice(0, _n), s = v.slice(-w);
            const rets = [];
            for (let i = 1; i < s.length; i++) {
                // C1 — monthly return via safeDiv.
                const r = safeDiv(s[i], s[i-1], null);
                if (r !== null) rets.push(r - 1);
            }
            // M22 — shared annualised vol and shared CAGR (actual elapsed days).
            const vol = annVolFromReturns(rets);
            const yrs = (dArr && dArr.length >= _n) ? yearsBetween(dArr[_n - w], dArr[_n - 1]) : safeDiv(w - 1, 12, 0);
            const cagr = cagrFrom(s[0], s[s.length-1], yrs);
            let peak=-Infinity, maxDD=0;
            s.forEach(x=>{ if(x>peak) peak=x; const d = safeDiv(x, peak, null); if (d !== null && d < maxDD) maxDD = d; });

            // Scores 0-10 — C1 every ratio via safeDiv; a flat window cannot reach Infinity.
            const sMom = Math.max(0, Math.min(10, finiteOr(cagr * 10, 0)));
            const sSafe = Math.max(0, Math.min(10, finiteOr(safeDiv(0.1, vol, 0), 0)));
            const sDd = Math.max(0, Math.min(10, 10 - safeDiv(Math.abs(maxDD * 100), 5, 0)));
            const sEff = Math.max(0, Math.min(10, finiteOr(safeDiv(cagr, vol, 0) * 2, 0)));
            return [sMom, sSafe, sDd, sEff];
        };

        chart.setOption({
            title: { text:'Quality and Value are not derivable from a price series — shown as Drawdown / Efficiency instead.', left:'center', top:0, textStyle:{fontSize:11, fontWeight:'normal', color:'#7f8c8d'} },
            tooltip: {}, legend:{ bottom:0 },
            radar: { indicator:[{name:'Momentum'},{name:'Safety'},{name:'Drawdown'},{name:'Efficiency'}], radius:'62%' },
            series: [{ type:'radar', data:[
                { value:plainData(getS(pVal)), name:'Strategy', itemStyle:{color:'#2980b9'}, areaStyle:{opacity:0.4} },
                { value:plainData(getS(bVal)), name:'Benchmark', itemStyle:{color:'#e74c3c'}, lineStyle:{type:'dashed'} }
            ]}]
        });
    }