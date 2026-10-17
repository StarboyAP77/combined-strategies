// 31/js/charts-s4.js — suites 36,37,38,39,40,41,42
// Plain script, shared globals. Load after engine.js/utils.js. Dataset is provided by app.js from js/data.json.
// C1 convention: every division whose denominator is not a literal goes through
// safeDiv(), so a flat/zero window can never hand Infinity/NaN to a formatter.

    function updateGSBetaChart(dates, pVal, bVal) {
        if (noEcharts('gs-beta')) return;
        const _el = document.getElementById('gs-beta-chart');
        if (noEl(_el, 'gs-beta')) return;
        // M21 — pRets/bRets zipped by index, clamp so bVal[i] is never undefined.
        const _n = minLen('gs-beta', dates, pVal, bVal);
        if (_n < 2) return;
        const w = 24, betaData = [];
        if (_n - 1 > w) {
            const pRets = [], bRets = [], rIdx = [];
            for (let i = 1; i < _n; i++) {
                // C1 — ratio via safeDiv; a zero prior corpus must not become Infinity.
                const rp = safeDiv(pVal[i], pVal[i - 1], null);
                const rb = safeDiv(bVal[i], bVal[i - 1], null);
                if (rp === null || rb === null) continue;
                pRets.push(rp - 1); bRets.push(rb - 1); rIdx.push(i);
            }
            for (let i = w; i < pRets.length; i++) {
                const pS = pRets.slice(i - w, i), bS = bRets.slice(i - w, i);
                const mP = safeDiv(pS.reduce((a, b) => a + b, 0), w, 0);
                const mB = safeDiv(bS.reduce((a, b) => a + b, 0), w, 0);
                const cov = safeDiv(pS.reduce((s, p, k) => s + (p - mP) * (bS[k] - mB), 0), w - 1, 0);
                const varB = safeDiv(bS.reduce((s, b) => s + (b - mB) ** 2, 0), w - 1, 0);
                // M14 — rets[k] is the return INTO vals[k+1], so the window i-w..i ends at
                // vals[rIdx[i]]: the beta is known there and belongs on that date, not i+1.
                // A flat benchmark gives varB 0 — beta is unmeasurable, plot a gap not 0.
                betaData.push([dates[rIdx[i]], varB > 0 ? safeDiv(cov, varB, null) : null]);
            }
        }
        const chart = echarts.init(_el);
        chart.setOption({
            tooltip: { trigger:'axis' }, xAxis: { type:'time' }, yAxis: { name:'Beta', min:-0.5, max:1.5 },
            series: [{ type:'line', data:plainData(betaData), showSymbol:false, markLine:{data:[{yAxis:1}, {yAxis:0.5, lineStyle:{color:'green'}}]} }],
            grid: { left:40, right:20, top:30, bottom:30 }
        });
    }

    function updateGSDistributionChart(pVal, bVal) {
        if (noEcharts('gs-distribution')) return;
        const _el = document.getElementById('gs-distribution-chart');
        if (noEl(_el, 'gs-distribution')) return;
        // M21 — histograms are independent, but bVal[i-1] must never be undefined.
        const _n = minLen('gs-distribution', pVal, bVal);
        if (_n < 2) return;
        const pR = [], bR = [];
        for (let i = 1; i < _n; i++) {
            // C1 — guarded ratio; an unusable prior period is dropped, never Infinity.
            const rp = safeDiv(pVal[i], pVal[i - 1], null), rb = safeDiv(bVal[i], bVal[i - 1], null);
            if (rp !== null) pR.push((rp - 1) * 100);
            if (rb !== null) bR.push((rb - 1) * 100);
        }

        // Bins -10 to 10
        const bins = []; for(let i=-10; i<=10; i++) bins.push(i);
        const pC = new Array(bins.length).fill(0);
        const bC = new Array(bins.length).fill(0);

        const fill = (arr, counts) => {
            arr.forEach(v => {
                if (!Number.isFinite(v)) return;
                let idx = Math.floor(v) + 10;
                if(idx<0) idx=0; if(idx>=bins.length) idx=bins.length-1;
                counts[idx]++;
            });
        };
        fill(pR, pC); fill(bR, bC);

        const chart = echarts.init(_el);
        chart.setOption({
            tooltip: { trigger:'axis' }, legend:{}, xAxis: { type:'category', data:bins }, yAxis: { show:false },
            series: [
                { name:'Strategy', type:'bar', data:plainData(pC), itemStyle:{color:'#2980b9', opacity:0.6}, barGap:'-100%' },
                { name:'Benchmark', type:'line', smooth:true, data:plainData(bC), itemStyle:{color:'#e74c3c'}, lineStyle:{width:2}, symbol:'none' }
            ],
            grid: { top:30, bottom:30 }
        });
    }

    function updateGSPercentileChart(dates, pVal, bVal) {
        // M16 — a re-render must always kill the previous playback before anything else,
        // otherwise the old tick keeps running against a chart this pass will replace.
        if (window.LazyCharts) LazyCharts.clearPlayTimer();
        if (noEcharts('gs-percentile')) return;
        const el = document.getElementById('gs-percentile-chart');
        if (noEl(el, 'gs-percentile')) return;
        const tEl = document.getElementById('gs-percentile-timeline-chart');
        const sel = document.getElementById('gs-percentile-month-select');
        const lbl = document.getElementById('gs-percentile-month-label');
        const playBtn = document.getElementById('gs-percentile-play-btn');
        // M21 — dates/sH/bH zipped by index, clamp to the shortest series.
        const _n = minLen('gs-percentile', dates, pVal, bVal);
        if (_n < 2) return;
        const dArr = dates.slice(0, _n);
        // C1 — drawdown ratio via safeDiv; a zero/flat peak must not become Infinity.
        const ddOf = (vals) => {
            let peak = -Infinity;
            return vals.slice(0, _n).map(v => {
                if (v > peak) peak = v;
                const r = safeDiv(v, peak, null);
                return r === null ? 0 : Math.abs(r) * 100;
            });
        };
        const sDD = ddOf(pVal), bDD = ddOf(bVal || pVal);
        // expanding-window cheapness: rank of current DD vs history so far
        const cheapHist = (dd) => dd.map((cur,i) => {
            if (i < 1) return 0;
            const past = dd.slice(0, i + 1);
            const rank = past.filter(d => d < cur).length;
            return finiteOr(+safeDiv(rank, past.length, 0).toFixed(1), 0);
        });
        const sH = cheapHist(sDD), bH = cheapHist(bDD);
        const sData = dArr.map((d,i)=>[d, sH[i]]), bData = dArr.map((d,i)=>[d, bH[i]]);
        // M16 — dispose whatever is already on these two doms (the timeline chart was
        // never disposed on re-render, so a second init would leak an instance).
        try { const _old = echarts.getInstanceByDom(el); if (_old) _old.dispose(); } catch (e) {}
        if (tEl) { try { const _oldT = echarts.getInstanceByDom(tEl); if (_oldT) _oldT.dispose(); } catch (e) {} }
        const chart = echarts.init(el);
        let tChart = null;
        let playTimer = null;
        const setGauges = (idx) => {
            idx = Math.max(0, Math.min(idx, _n - 1));
            const sv = finiteOr(sH[idx], 0), bv = finiteOr(bH[idx], 0);
            chart.setOption({
                series: [
                    { type:'gauge', center:['25%','55%'], radius:'85%', min:0, max:100, detail:{formatter:'{value}%', fontSize:14}, title:{fontSize:12, offsetCenter:[0,'60%']}, data:[{value:+sv.toFixed(0), name:'Strategy Cheapness'}] },
                    { type:'gauge', center:['75%','55%'], radius:'85%', min:0, max:100, detail:{formatter:'{value}%', fontSize:14}, title:{fontSize:12, offsetCenter:[0,'60%']}, data:[{value:+bv.toFixed(0), name:'Benchmark Cheapness'}], axisLine:{lineStyle:{color:[[0.2,'#27ae60'],[0.8,'#f1c40f'],[1,'#c0392b']]}} }
                ]
            });
            if(lbl) lbl.textContent = `${dArr[idx]} — Strat ${sv.toFixed(0)}% / Bench ${bv.toFixed(0)}% (DD ${sDD[idx].toFixed(1)}% / ${bDD[idx].toFixed(1)}%)`;
        };
        // M16 — single stop path: local handle plus the LazyCharts singleton, so the
        // button label and the interval can never disagree.
        const stopPlay = () => {
            if (playTimer !== null) { clearInterval(playTimer); playTimer = null; }
            if (window.LazyCharts) LazyCharts.clearPlayTimer();
            if (playBtn) playBtn.textContent = '▶ Play history';
        };
        setGauges(_n - 1);
        // month selector
        if(sel) {
            sel.textContent = '';
            dArr.forEach((d,i)=>{ const o=document.createElement('option'); o.value=String(i); o.textContent=d; sel.appendChild(o); });
            sel.value = String(_n - 1);
            sel.onchange = () => { stopPlay(); const i=+sel.value; setGauges(i); if(tChart) tChart.dispatchAction({type:'showTip', seriesIndex:0, dataIndex:i}); };
        }
        // timeline chart
        if(tEl) {
            tChart = echarts.init(tEl);
            tChart.setOption({
                tooltip:{trigger:'axis'},
                legend:{data:['Strategy cheapness','Benchmark cheapness'], bottom:0},
                xAxis:{type:'time'}, yAxis:{name:'Cheaper than %', min:0, max:100},
                dataZoom:[{type:'slider', bottom:25}, {type:'inside'}],
                series:[
                    {name:'Strategy cheapness', type:'line', data:plainData(sData), showSymbol:false, lineStyle:{color:'#2980b9', width:2}, areaStyle:{opacity:0.08, color:'#2980b9'}, markLine:{silent:true, data:[{yAxis:70, lineStyle:{color:'#27ae60', type:'dashed'}, label:{formatter:'Cheap >70%'}}]}},
                    {name:'Benchmark cheapness', type:'line', data:plainData(bData), showSymbol:false, lineStyle:{color:'#e74c3c', width:1.5, type:'dashed'}}
                ],
                grid:{left:50, right:20, top:30, bottom:75, containLabel:true}
            });
            tChart.on('click', (p)=>{ if(p && p.dataIndex!=null){ stopPlay(); setGauges(p.dataIndex); if(sel) sel.value=String(p.dataIndex); } });
        }
        if(playBtn) {
            playBtn.textContent = '▶ Play history';
            playBtn.onclick = () => {
                // M16 — already playing means "pause"; never start a second interval.
                if (playTimer !== null) { stopPlay(); return; }
                stopPlay(); // defensive: clear anything LazyCharts still owns
                let i = 0;
                playBtn.textContent = '❚❚ Pause';
                playTimer = setInterval(() => {
                    // M16 — the section may have been re-rendered, collapsed or disposed
                    // since the last tick, so re-resolve the instance by dom every tick
                    // and bail out (clearing the timer) instead of throwing every 120ms.
                    let inst = null;
                    try { inst = echarts.getInstanceByDom(el); } catch (e) { stopPlay(); return; }
                    if (!inst || (typeof inst.isDisposed === 'function' && inst.isDisposed())) { stopPlay(); return; }
                    if (i >= _n) { stopPlay(); return; }
                    try {
                        setGauges(i);
                        if(sel) sel.value = String(i);
                        const tInst = tEl ? echarts.getInstanceByDom(tEl) : null;
                        if (tInst && !(typeof tInst.isDisposed === 'function' && tInst.isDisposed())) tInst.dispatchAction({type:'showTip', seriesIndex:0, dataIndex:i});
                    } catch (e) { stopPlay(); return; }
                    i += 3;
                }, 120);
                if (window.LazyCharts) LazyCharts.setPlayTimer(playTimer);
            };
        }
    }

    function updateMSMountainChart(dates, pVal, bVal) {
        if (noEcharts('ms-mountain')) return;
        const el = document.getElementById('ms-mountain-chart');
        if (noEl(el, 'ms-mountain')) return;
        // M21 — dates[peakIdx] zipped by index, clamp before labelling the scatter points.
        const _n = minLen('ms-mountain', dates, pVal);
        if (_n < 2) return;
        const dArr = dates.slice(0, _n), vals = pVal.slice(0, _n);
        const chart = echarts.init(el);
        const getDDs = (series) => {
            const dds=[];
            let peak=-Infinity, peakIdx=0, inDD=false;
            for(let i=0; i<series.length; i++) {
                if(series[i]>peak) {
                    if(inDD) {
                        // C1 — depth ratio via safeDiv; a zero peak must not become Infinity.
                        const depth = safeDiv(Math.min(...series.slice(peakIdx, i)) - peak, peak, null);
                        if(depth !== null && depth < -0.02) dds.push([Math.abs(depth*100), i-peakIdx, dArr[peakIdx]]);
                        inDD=false;
                    }
                    peak=series[i]; peakIdx=i;
                } else inDD=true;
            }
            if(inDD) {
                const depth = safeDiv(Math.min(...series.slice(peakIdx)) - peak, peak, null);
                if(depth !== null && depth < -0.02) dds.push([Math.abs(depth*100), series.length-peakIdx, dArr[peakIdx], true]);
            }
            return dds;
        };
        const sDD = getDDs(vals);
        const bDD = (bVal && bVal.length >= _n) ? getDDs(bVal.slice(0, _n)) : [];
        chart.setOption({
            // CRIT-11 — tooltip content is injected as HTML, escape every data part.
            tooltip: { formatter: p => `${escHtml(p.seriesName)}<br/>${escHtml(p.data[2])}<br/>Depth: ${fmtNum(p.data[0],1)}%<br/>Duration: ${escHtml(p.data[1])} Mo${p.data[3] ? '<br/>(ongoing)' : ''}` },
            legend: { data:['Strategy','Benchmark'], bottom:0 },
            xAxis: { name:'Depth %' }, yAxis: { name:'Duration (Mo)' },
            series: [
                { name:'Strategy', type:'scatter', data:plainData(sDD), symbolSize: d=>Math.min(30, 6+d[0]), itemStyle:{color: p=>p.data[3]?'#000':'#2980b9', opacity:0.85} },
                { name:'Benchmark', type:'scatter', data:plainData(bDD), symbolSize: d=>Math.min(30, 6+d[0]), itemStyle:{color:'#e74c3c', opacity:0.85, borderColor:'#fff', borderWidth:1} }
            ],
            grid: { left:50, right:30, top:30, bottom:55, containLabel:true }
        });
    }

    function updateWBCrisisRadarChart(dates, pVal, bVal) {
        if (noEcharts('wb-crisis-radar')) return;
        const _el = document.getElementById('wb-crisis-radar-chart');
        if (noEl(_el, 'wb-crisis-radar')) return;
        // M21 — dates/pVal zipped by index, clamp before any window lookup. bVal is
        // optional, so it is dropped (not mixed into the clamp) when it is too short.
        const _n = minLen('wb-crisis-radar', dates, pVal);
        if (_n < 2) return;
        const dArr = dates.slice(0, _n), pArr = pVal.slice(0, _n);
        const bArr = (bVal && bVal.length >= _n) ? bVal.slice(0, _n) : null;
        const chart = echarts.init(_el);
        const crises = [
            {n:'2008 GFC', s:'2008-01-01', e:'2009-03-01'},
            {n:'2020 Covid', s:'2020-02-01', e:'2020-04-01'},
            {n:'2022 Infl', s:'2022-01-01', e:'2022-10-01'}
        ];

        // M19 — out-of-sample crisis → null (gap/N-A), never 0% —
        // 0 is indistinguishable from "flat through crisis".
        const getRet = (vals, start, end) => {
            if (!vals) return null;
            // M19 — findIndex returning -1 must be checked explicitly everywhere.
            const sI = dArr.findIndex(d => d >= start);
            const eI = dArr.findIndex(d => d >= end);
            if (sI < 0 || eI < 0 || eI <= sI) return null;
            // C1 — window return via safeDiv; a zero start level must not become Infinity.
            const r = safeDiv(vals[eI], vals[sI], null);
            if (r === null || !Number.isFinite(vals[sI]) || vals[sI] <= 0) return null;
            return (r - 1) * 100;
        };

        const pR = crises.map(c => { const r = getRet(pArr, c.s, c.e); return r === null ? null : finiteOr(+r.toFixed(1), null); });
        const bR = crises.map(c => { const r = getRet(bArr, c.s, c.e); return r === null ? null : finiteOr(+r.toFixed(1), null); });
        // Crises genuinely lose money — keep true (negative) values but give
        // the radar an explicit floor so sub-zero points don't break layout.
        // M19 — nulls (out-of-sample) excluded from the floor computation.
        const _nums = [...pR, ...bR].filter(v => typeof v === 'number' && isFinite(v));
        const floor = Math.floor(Math.min(..._nums, 0));

        chart.setOption({
            // M19 — N/A is spelled out in the axis label and the tooltip.
            tooltip: { trigger:'item', formatter: p => {
                const v = p.value || [];
                const rows = crises.map((c, i) => `<div>${escHtml(c.n)}: ${v[i] === null || v[i] === undefined ? 'N/A (outside sample)' : fmtPct(safeDiv(v[i], 100, 0), 1)}</div>`).join('');
                return `<b>${escHtml(p.name)}</b><br/>${rows}`;
            } },
            legend:{ bottom:0 },
            radar: { indicator: crises.map((c, i) => ({ name: c.n + (pR[i] === null && bR[i] === null ? ' (N/A)' : ''), min:floor })) },
            series: [{ type:'radar', data:[
                { value:pR, name:'Strategy', itemStyle:{color:'#2980b9'}, areaStyle:{opacity:0.4} },
                { value:bR, name:'Benchmark', itemStyle:{color:'#e74c3c'} }
            ]}]
        });
    }

    function updateWEFRadarChart(pVal, bVal) {
        if (noEcharts('wef-radar')) return;
        const _el = document.getElementById('wef-radar-chart');
        if (noEl(_el, 'wef-radar')) return;
        // M21 — two independent scorecards, clamped to one common sample.
        const _n = minLen('wef-radar', pVal, bVal);
        if (_n < 2) return;
        // M22 — app.js calls this with (postTaxVals, benchVals) only, so there is no date
        // array to measure elapsed years with; fall back to the month count. Once app.js
        // passes dateVals as the 3rd argument the real elapsed span is used automatically.
        const years = (typeof dates !== 'undefined' && dates && dates.length >= _n)
            ? yearsBetween(dates[0], dates[_n - 1])
            : safeDiv(_n - 1, 12, 0);

        const getM = (vals) => {
            const v = vals.slice(0, _n);
            const rets = [];
            for (let i = 1; i < v.length; i++) {
                // C1 — monthly return via safeDiv.
                const r = safeDiv(v[i], v[i - 1], null);
                if (r !== null) rets.push(r - 1);
            }
            // M22 — the one CAGR definition (actual elapsed years) and the one vol
            // definition (demeaned population sd, sqrt(12) annualised).
            const cagr = cagrFrom(v[0], v[v.length - 1], years) * 100;
            const vol = annVolFromReturns(rets) * 100;

            let peak=-Infinity, maxDD=0;
            v.forEach(x=>{ if(x>peak) peak=x; const d = safeDiv(x, peak, null); if(d !== null && d < maxDD) maxDD = d; });

            // Recovery — derived (return from the worst trough to the end of the sample),
            // not a copy of Defense wearing a Recovery label.
            let trough = Infinity, troughIdx = 0;
            v.forEach((x,i)=>{ if(x < trough){ trough = x; troughIdx = i; } });
            const recovery = finiteOr(safeDiv(v[v.length - 1], trough, null), 0) - 1;

            // Scores 0-10 — C1 every ratio via safeDiv so a flat window cannot reach
            // Infinity and blow up the radar.
            const sC = Math.min(10, safeDiv(cagr, 2, 0));
            const sD = Math.max(0, 10 - safeDiv(Math.abs(maxDD * 100), 5, 0));
            const sV = Math.max(0, 10 - safeDiv(vol, 3, 0));
            const sR = Math.max(0, Math.min(10, finiteOr(recovery * 10, 0)));

            return [sC, sD, sV, sR, sD];
        };

        const chart = echarts.init(_el);
        chart.setOption({
            tooltip: {}, legend:{ bottom:0 },
            radar: { indicator: [{name:'Growth'},{name:'Defense'},{name:'Stability'},{name:'Recovery'},{name:'Consistency'}] },
            series: [{ type:'radar', data:[
                { value:plainData(getM(pVal)), name:'Strategy', itemStyle:{color:'#2980b9'}, areaStyle:{opacity:0.4} },
                { value:plainData(getM(bVal)), name:'Benchmark', itemStyle:{color:'#e74c3c'} }
            ]}]
        });
    }

    function updateRBIStressChart(dates, pVal, bVal) {
        if (noEcharts('rbi-stress')) return;
        const el = document.getElementById('rbi-stress-chart');
        if (noEl(el, 'rbi-stress')) return;
        // M21 — dates zipped by index, clamp before plotting.
        const _n = minLen('rbi-stress', dates, pVal, bVal);
        if (_n < 2) return;
        const dArr = dates.slice(0, _n);
        const chart = echarts.init(el);
        const calc = (vals) => {
            const w=12, data=[], rIdx=[], rets=[];
            for (let i = 1; i < vals.length; i++) {
                // C1 — monthly return via safeDiv.
                const r = safeDiv(vals[i], vals[i-1], null);
                if (r === null) continue;
                rets.push(r - 1); rIdx.push(i);
            }
            for (let i = w; i < rets.length; i++) {
                const s = rets.slice(i - w, i);
                // M22 — shared annualised vol (demeaned), not a local second moment.
                const vol = annVolFromReturns(s) * 100;
                // M14 — rets[k] is the return INTO vals[k+1], so the window ends at
                // vals[rIdx[i]]: the stress reading belongs on that date, not one later.
                const last = rIdx[i];
                const peak = Math.max(...vals.slice(last - w, last + 1));
                const dd = Math.abs(finiteOr(safeDiv(vals[last], peak, null), 0)) * 100;
                data.push([dArr[last], finiteOr(+(vol + dd).toFixed(2), null)]);
            }
            return data;
        };
        chart.setOption({
            tooltip: { trigger:'axis' }, legend:{data:['Strategy','Benchmark'], bottom:0},
            xAxis: { type:'time' }, yAxis: { name:'Stress Index' },
            series: [
                { name:'Strategy', type:'line', data:plainData(calc(pVal)), showSymbol:false, lineStyle:{color:'#2980b9', width:2} },
                { name:'Benchmark', type:'line', data:(bVal?plainData(calc(bVal)):[]), showSymbol:false, lineStyle:{color:'#e74c3c', width:2, type:'dashed'} }
            ],
            grid: { left:50, right:20, top:30, bottom:55, containLabel:true }
        });
    }

    // --- SUITE 40: RBI (UPDATED BASEL III) ---

    function updateRBIVaRChart(dates, pVal, bVal) {
        if (noEcharts('rbi-var')) return;
        const _el = document.getElementById('rbi-var-chart');
        if (noEl(_el, 'rbi-var')) return;
        // M21 — clamp the two series to one common sample.
        const _n = minLen('rbi-var', pVal, bVal);
        if (_n < 2) return;
        const chart = echarts.init(_el);

        const getVaR = (vals) => {
            const rets = [];
            for (let i = 1; i < vals.length; i++) {
                // C1 — monthly return via safeDiv.
                const r = safeDiv(vals[i], vals[i-1], null);
                if (r !== null) rets.push((r - 1) * 100);
            }
            if (!rets.length) return null;
            rets.sort((a,b)=>a-b);
            // 99% Confidence = 1st percentile
            const idx = Math.floor(rets.length * 0.01);
            return Math.abs(finiteOr(rets[idx], 0));
        };

        const pVaR = getVaR(pVal.slice(0, _n));
        const bVaR = getVaR(bVal.slice(0, _n));

        chart.setOption({
            tooltip: { trigger: 'axis', axisPointer:{type:'shadow'}, formatter: '{b}<br/>1-Month VaR (99%): <b>{c}%</b>' },
            legend: { data: ['Strategy', 'Benchmark'] },
            xAxis: { type: 'category', data: ['Capital at Risk (99% Conf.)'] },
            yAxis: { name: 'Worst Case Monthly Loss %', inverse: true }, // Inverted to show loss
            series: [
                { name: 'Strategy', type: 'bar', data: [finiteOr(pVaR, 0)], itemStyle: { color: '#2980b9' }, label: { show: true, position: 'bottom', formatter: '-{c}%' } },
                { name: 'Benchmark', type: 'bar', data: [finiteOr(bVaR, 0)], itemStyle: { color: '#e74c3c' }, label: { show: true, position: 'bottom', formatter: '-{c}%' } }
            ],
            grid: { top: 30, bottom: 30 }
        });
    }

    // --- SUITE 41: FED (UPDATED WITH BENCHMARK) ---

    function updateFedSoftLandingChart(pVal, bVal) {
        if (noEcharts('fed-soft-landing')) return;
        const _el = document.getElementById('fed-soft-landing-chart');
        if (noEl(_el, 'fed-soft-landing')) return;
        // M21 — clamp the two series to one common sample.
        const _n = minLen('fed-soft-landing', pVal, bVal);
        if (_n < 2) return;
        const chart = echarts.init(_el);

        const calcProb = (hist) => {
            const w=12; let wC=0, t=0;
            if(hist.length <= w) return null;
            for(let i=w; i<hist.length; i++) {
                if(hist[i] > hist[i-w]) wC++;
                t++;
            }
            // C1 — percentage via safeDiv; t is 0 only when the window never ran.
            return finiteOr(safeDiv(wC, t, 0) * 100, 0);
        };

        const pProb = calcProb(pVal.slice(0, _n));
        const bProb = calcProb(bVal.slice(0, _n));
        const pLbl = fmtNum(pProb, 0) + '%', bLbl = fmtNum(bProb, 0) + '%';

        chart.setOption({
            series: [{
                type: 'gauge',
                min: 0, max: 100,
                pointer: { show:false }, // Hide default pointer, use custom data pointers
                progress: { show: true, width: 10 },
                axisLine: { lineStyle: { width: 10 } },
                axisTick: { show: false },
                splitLine: { length: 5 },
                detail: { show:false },
                title: { fontSize: 12, offsetCenter: [0, '30%'] },
                // Two pointers
                data: plainData([
                    {
                        value: finiteOr(pProb, 0),
                        name: `Strat: ${pLbl}`,
                        itemStyle: { color: '#2980b9' },
                        title: { offsetCenter: ['-40%', '80%'], color:'#2980b9' }
                    },
                    {
                        value: finiteOr(bProb, 0),
                        name: `Bench: ${bLbl}`,
                        itemStyle: { color: '#e74c3c' },
                        title: { offsetCenter: ['40%', '80%'], color:'#e74c3c' }
                    }
                ]),
                // Add explicit pointers
                anchor: { show: true, showAbove: true, size: 18, itemStyle: { borderWidth: 2 } },
                pointer: { show:true, width:4 }
            }]
        });
    }

    function updateADBInfraFloorChart(dates, pVal, bVal) {
        if (noEcharts('adb-infra-floor')) return;
        const el = document.getElementById('adb-infra-floor-chart');
        if (noEl(el, 'adb-infra-floor')) return;
        // M21 — dates zipped by index, clamp before plotting.
        const _n = minLen('adb-infra-floor', dates, pVal, bVal);
        if (_n < 2) return;
        const dArr = dates.slice(0, _n);
        const chart = echarts.init(el);
        const calc = (vals) => {
            const w=36, minData=[], rets1y=[], rIdx=[];
            for (let i = 12; i < vals.length; i++) {
                // C1 — 1-year return via safeDiv.
                const r = safeDiv(vals[i], vals[i-12], null);
                if (r === null) continue;
                rets1y.push((r - 1) * 100); rIdx.push(i);
            }
            for (let i = w; i < rets1y.length; i++) {
                const min = Math.min(...rets1y.slice(i - w, i));
                // M14 — rets1y[k] is the 1Y return ENDING at vals[rIdx[k]], so the worst
                // value in the window is known at vals[rIdx[i-1]]: plot it there. The old
                // dates[i+12] shifted the whole floor curve one month into the future.
                minData.push([dArr[rIdx[i - 1]], finiteOr(+min.toFixed(2), null)]);
            }
            return minData;
        };
        chart.setOption({
            tooltip: { trigger:'axis' }, legend:{data:['Strategy floor','Benchmark floor'], bottom:0},
            xAxis: { type:'time' }, yAxis: { name:'Min 1Y Return %' },
            series: [
                { name:'Strategy floor', type:'line', data:plainData(calc(pVal.slice(0,_n))), showSymbol:false, lineStyle:{color:'#2980b9', width:2}, areaStyle:{opacity:0.1, color:'#2980b9'} },
                { name:'Benchmark floor', type:'line', data:(bVal?plainData(calc(bVal.slice(0,_n))):[]), showSymbol:false, lineStyle:{color:'#e74c3c', width:2, type:'dashed'} }
            ],
            grid: { left:55, right:20, top:30, bottom:55, containLabel:true }
        });
    }

    function updateADBSortinoChart(dates, pVal, bVal) {
        if (noEcharts('adb-sortino')) return;
        const el = document.getElementById('adb-sortino-chart');
        if (noEl(el, 'adb-sortino')) return;
        // M21 — dates zipped by index, clamp before plotting.
        const _n = minLen('adb-sortino', dates, pVal, bVal);
        if (_n < 2) return;
        const dArr = dates.slice(0, _n);
        const chart = echarts.init(el);
        const calc = (vals) => {
            const w=24, sData=[], rets=[], rIdx=[];
            for (let i = 1; i < vals.length; i++) {
                // C1 — monthly return via safeDiv.
                const r = safeDiv(vals[i], vals[i-1], null);
                if (r === null) continue;
                rets.push(r - 1); rIdx.push(i);
            }
            for (let i = w; i < rets.length; i++) {
                const s = rets.slice(i - w, i);
                const m = safeDiv(s.reduce((a,b)=>a+b,0), w, 0);
                // M22 — shared downside deviation: sums min(r-MAR,0)^2 over ALL periods.
                const dd = downsideDevFromReturns(s, 0);
                // C1 — zero downside deviation makes Sortino undefined, not infinite.
                const v = safeDiv(m * 12, dd, null);
                // M14 — rets[k] is the return INTO vals[k+1]; the window ends at
                // vals[rIdx[i]], so the ratio belongs on that date, not one month later.
                if (v !== null && isFinite(v)) sData.push([dArr[rIdx[i]], finiteOr(+v.toFixed(3), null)]);
            }
            return sData;
        };
        chart.setOption({
            tooltip: { trigger:'axis' }, legend:{data:['Strategy','Benchmark'], bottom:0},
            xAxis: { type:'time' }, yAxis: { name:'Sortino' },
            series: [
                { name:'Strategy', type:'line', data:plainData(calc(pVal.slice(0,_n))), showSymbol:false, lineStyle:{color:'#2980b9', width:2} },
                { name:'Benchmark', type:'line', data:(bVal?plainData(calc(bVal.slice(0,_n))):[]), showSymbol:false, lineStyle:{color:'#e74c3c', width:2, type:'dashed'} }
            ],
            grid: { left:50, right:20, top:30, bottom:55, containLabel:true }
        });
    }