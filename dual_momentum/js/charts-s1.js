// 31/js/charts-s1.js — suites 1,3,4 + 7.1,8.3,9.3
// Plain script, shared globals. Load after engine.js/utils.js. Dataset is provided by app.js from js/data.json.

    function updateDrawdownDragTables(dates, pVal, bVal) {
        const table = document.querySelector('#equity-drawdown-drag-table tbody');
        if (noEl(table, 'drawdown-drag-table')) return;
        // CRIT-11: rows are built with createElement/textContent — dates and
        // percentages are data, never markup.
        const addRow = (cells) => {
            const tr = document.createElement('tr');
            cells.forEach(([txt, style]) => {
                const td = document.createElement('td');
                td.textContent = txt;
                if (style) {
                    if (style.color) td.style.color = style.color;
                    if (style.bold) td.style.fontWeight = 'bold';
                    if (style.colspan) td.colSpan = style.colspan;
                }
                tr.appendChild(td);
            });
            table.appendChild(tr);
        };
        table.textContent = '';
        
        let peak = -Infinity, peakIdx = 0, trough = Infinity, troughIdx = 0, inDD = false;
        const periods = [];
        // M21: clamp to shortest history so pVal[p.start] can never be undefined.
        const _n = minLen('drawdown-drag', dates, pVal, bVal);

        for(let i=0; i<_n; i++) {
            if(bVal[i] > peak) {
                if(inDD) {
                    const depth = (trough - peak)/peak;
                    if(depth <= -0.10) {
                        periods.push({ start: peakIdx, end: troughIdx, depth: depth });
                    }
                    inDD = false;
                }
                peak = bVal[i]; peakIdx = i; trough = Infinity;
            } else {
                inDD = true;
                if(bVal[i] < trough) { trough = bVal[i]; troughIdx = i; }
            }
        }
        if(inDD && (trough-peak)/peak <= -0.10) periods.push({ start: peakIdx, end: troughIdx, depth: (trough-peak)/peak });

        periods.forEach(p => {
            const pStart = pVal[p.start], pEnd = pVal[p.end];
            if (!(pStart > 0)) return;
            const pDrop = safeDiv(pEnd, pStart, 1) - 1;
            const shield = Math.abs(p.depth) - Math.abs(pDrop);
            const verdict = shield > 0.05 ? '✅ Shielded' : (shield < -0.05 ? '❌ Worse' : '⚠️ Similar');
            
            addRow([
                [dates[p.start] + ' - ' + dates[p.end], null],
                [fmtPct(p.depth, 2), { color: 'red', bold: true }],
                [fmtPct(pDrop, 2), { bold: true }],
                [fmtPct(shield, 2), { color: shield > 0 ? 'green' : 'red' }],
                [verdict, null]
            ]);
        });
        if(periods.length===0) addRow([['No Benchmark Crashes >10% found.', { colspan: 6 }]]);
    }

    // Tool 2: Rally Lag

    function updateResilienceTables(dates, pVal, bVal) {
        // CRIT-11: rows are built with createElement/textContent, never innerHTML.
        const addRow = (tbody, cells) => {
            const tr = document.createElement('tr');
            cells.forEach(([txt, color]) => {
                const td = document.createElement('td');
                td.textContent = txt;
                if (color) td.style.color = color;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        };
        // Sleep Well
        const t1 = document.querySelector('#sleep-well-table tbody');
        if (noEl(t1, 'sleep-well-table')) return;
        t1.textContent = '';
        const horizons = [1, 12, 36, 60];
        // M21: pVal/bVal/dates zipped by index — clamp so bVal[i] is never undefined.
        const _n = minLen('resilience', dates, pVal, bVal);
        
        horizons.forEach(h => {
            if(_n <= h) return;
            let bLoss=0, pLoss=0, count=0, bMin=Infinity, pMin=Infinity;
            for(let i=h; i<_n; i++) {
                const bR = safeDiv(bVal[i], bVal[i-h], 0) - 1;
                const pR = safeDiv(pVal[i], pVal[i-h], 0) - 1;
                if(!Number.isFinite(bR) || !Number.isFinite(pR)) continue;
                if(bR < 0) bLoss++;
                if(pR < 0) pLoss++;
                if(bR < bMin) bMin = bR;
                if(pR < pMin) pMin = pR;
                count++;
            }
            if(count === 0) return;
            const bProb = safeDiv(bLoss, count, 0)*100;
            const pProb = safeDiv(pLoss, count, 0)*100;
            const gain = bProb - pProb;
            
            addRow(t1, [
                [h + ' Month(s)', null],
                [fmtPct(bProb/100, 1), 'red'],
                [fmtPct(pProb/100, 1), pProb < bProb ? 'green' : 'red'],
                [fmtPct(bMin, 1), null],
                [fmtPct(pMin, 1), null],
                [(gain > 0 ? '+' : '') + fmtPct(gain/100, 1), 'green']
            ]);
        });

        // Nightmare Months
        const t2 = document.querySelector('#nightmare-months-table tbody');
        if (noEl(t2, 'nightmare-months-table')) return;
        t2.textContent = '';
        const moves = [];
        for(let i=1; i<_n; i++) {
            const bRet = safeDiv(bVal[i], bVal[i-1], 0) - 1;
            const pRet = safeDiv(pVal[i], pVal[i-1], 0) - 1;
            if(!Number.isFinite(bRet) || !Number.isFinite(pRet)) continue;
            moves.push({ date: dates[i], bRet, pRet });
        }
        moves.sort((a,b)=>a.bRet - b.bRet);
        const worst = moves.slice(0, 5);
        
        worst.forEach(m => {
            const saved = m.pRet - m.bRet;
            addRow(t2, [
                [m.date, null],
                [fmtPct(m.bRet, 2), 'red'],
                [fmtPct(m.pRet, 2), null],
                [fmtPct(saved, 2), saved > 0 ? 'green' : 'red']
            ]);
        });
    }

    // Tool 4: Probability

    function updateConsistencyMatrix(pVal) {
        const table = document.querySelector('#rolling-consistency-table tbody');
        if (noEl(table, 'consistency-table')) return;
        // CRIT-11: rows are built with createElement/textContent, never innerHTML.
        const addRow = (cells) => {
            const tr = document.createElement('tr');
            cells.forEach(([txt, color]) => {
                const td = document.createElement('td');
                td.textContent = txt;
                if (color) td.style.color = color;
                tr.appendChild(td);
            });
            table.appendChild(tr);
        };
        table.textContent = '';
        if (!pVal || pVal.length < 2) return;
        const years = [1, 3, 5, 7, 10];
        
        years.forEach(y => {
            const m = y*12;
            if(pVal.length <= m) return;
            let min=Infinity, max=-Infinity, sum=0, count=0, neg=0, beat=0;
            for(let i=m; i<pVal.length; i++) {
                if(!(pVal[i-m] > 0) || !(pVal[i] > 0)) continue;
                // M22: one CAGR definition (shared helper), not a local Math.pow.
                const cagr = cagrFrom(pVal[i-m], pVal[i], y);
                if(cagr < min) min = cagr;
                if(cagr > max) max = cagr;
                sum += cagr;
                if(cagr < 0) neg++;
                if(cagr > 0.06) beat++;
                count++;
            }
            if(count === 0) return;
            addRow([
                [y + ' Years', null],
                [fmtPct(min, 2), min < 0 ? 'red' : 'green'],
                [fmtPct(max, 2), null],
                [fmtPct(safeDiv(sum, count, 0), 2), null],
                [fmtPct(safeDiv(neg, count, 0), 1), neg > 0 ? 'red' : 'green'],
                [fmtPct(safeDiv(beat, count, 0), 1), null]
            ]);
        });
    }

    // Tool 5: Advanced Conviction

    function updateOstrichChart(dates, pVal) {
        if (noEcharts('ostrich-chart')) return;
        const _el = document.getElementById('ostrich-chart');
        if (noEl(_el, 'ostrich-chart')) return;
        const chart = echarts.init(_el);
        
        if (!pVal || pVal.length < 2) { chart.clear(); return; }

        const horizons = [1, 3, 12, 36, 60];
        const probs = horizons.map(h => {
            let loss = 0, tot = 0;
            if (pVal.length > h) {
                for(let i=h; i<pVal.length; i++) {
                    if(pVal[i] < pVal[i-h]) loss++;
                    tot++;
                }
            }
            return tot > 0 ? (loss/tot)*100 : 0;
        });
        
        chart.setOption({
            tooltip: { formatter: '{b}: <b>{c}%</b> chance of Red' },
            xAxis: { type: 'category', data: horizons.map(h=>h+' Mo') },
            yAxis: { name: 'Prob of Loss', max: 100 },
            series: [{ type:'bar', data:probs.map(v=>v.toFixed(1)), itemStyle:{color: v=>v.value>20?'#c0392b':'#27ae60'} }],
            grid: { top:30, bottom:30 }
        });
    }

    function updateCaptureMapChart(dates, pVal, bVal) {
        if (noEcharts('capture-map-chart')) return;
        const _el = document.getElementById('capture-map-chart');
        if (noEl(_el, 'capture-map-chart')) return;
        const chart = echarts.init(_el);
        
        let upCap = 0, dnCap = 0;
        
        if (pVal && pVal.length > 1 && bVal && bVal.length > 1) {
            let upS=0, upB=0, dnS=0, dnB=0;
            const pRets=[], bRets=[];
            // M21: pVal/bVal zipped by index — clamp so bVal[i-1] is never undefined.
            const _n = minLen('capture-map', pVal, bVal);
            for(let i=1; i<_n; i++) { 
                // bVal is a raw index level, pVal a rupee corpus — compare only
                // the *returns*, never the levels themselves.
                const pR = safeDiv(pVal[i], pVal[i-1], 0) - 1;
                const bR = safeDiv(bVal[i], bVal[i-1], 0) - 1;
                if(!Number.isFinite(pR) || !Number.isFinite(bR)) continue;
                pRets.push(pR); 
                bRets.push(bR); 
            }
            
            for(let i=0; i<pRets.length; i++) {
                if(bRets[i] >= 0) { upB+=bRets[i]; upS+=pRets[i]; }
                else { dnB+=bRets[i]; dnS+=pRets[i]; }
            }
            upCap = safeDiv(upS, upB, 0)*100;
            dnCap = safeDiv(dnS, dnB, 0)*100;
        }
        
        // M18: axis range derived from the data — a fixed min:0,max:120 clipped
        // negative down-capture (the hedging regime) and >120% up-capture.
        const _capLo = Math.min(0, Math.floor((Math.min(dnCap, upCap) - 10) / 10) * 10);
        const _capHi = Math.max(100, Math.ceil((Math.max(dnCap, upCap) + 10) / 10) * 10);
        const _pc = (v) => fmtNum(finiteOr(v, 0), 0) + '%';
        chart.setOption({
            tooltip: { formatter: p => `${p.name}<br/>Up: ${_pc(p.value[1])}<br/>Down: ${_pc(p.value[0])}` },
            xAxis: { name:'Down Capture', min:_capLo, max:_capHi },
            yAxis: { name:'Up Capture', min:_capLo, max:_capHi },
            series: [{ 
                type:'scatter', symbolSize:20,
                // M18: 100% stays visible as an explicit reference line.
                markLine: { silent:true, symbol:'none', lineStyle:{type:'dashed', color:'#e74c3c'},
                    data:[{xAxis:100},{yAxis:100}], label:{formatter:'100%', position:'end'} },
                data:[{value:[dnCap, upCap], name:'Strategy', itemStyle:{color:'#2980b9'}}, {value:[100, 100], name:'Benchmark', itemStyle:{color:'#e74c3c'}}]
            }],
            grid: { left:40, right:40, top:40, bottom:40 }
        });
    }

    // --- SUITE 9: INSTITUTIONAL RISK ---

    function updateHurdleTable(pVal, bVal) {
        const t = document.querySelector('#hurdle-probability-table tbody');
        if (noEl(t, 'hurdle-table')) return;
        // CRIT-11: rows are built with createElement/textContent, never innerHTML.
        const addRow = (cells) => {
            const tr = document.createElement('tr');
            cells.forEach(([txt, style]) => {
                const td = document.createElement('td');
                td.textContent = txt;
                if (style) {
                    if (style.color) td.style.color = style.color;
                    if (style.bold) td.style.fontWeight = 'bold';
                }
                tr.appendChild(td);
            });
            t.appendChild(tr);
        };
        t.textContent = '';
        if(!pVal || pVal.length < 37) return;
        if(!bVal || bVal.length < 37) return;
        // M21: pVal/bVal compared over the same 3Y windows — warn if histories differ.
        if (bVal.length !== pVal.length) console.warn('[charts] unequal history lengths in hurdle-table [' + pVal.length + ',' + bVal.length + ']');

        const hurdles = [0.06, 0.12, 0.20];
        hurdles.forEach(h => {
            const calcProb = (vals) => {
                let pass=0, tot=0;
                for(let i=36; i<vals.length; i++) {
                    // bVal is a raw index level — the ratio of two levels of the
                    // SAME series is a valid 3Y return, so CAGR is well defined.
                    if(!(vals[i-36] > 0) || !(vals[i] > 0)) continue;
                    // M22: shared CAGR definition.
                    if(cagrFrom(vals[i-36], vals[i], 3) > h) pass++;
                    tot++;
                }
                return safeDiv(pass, tot, 0)*100;
            };
            const pP = calcProb(pVal), bP = calcProb(bVal);
            addRow([
                [fmtPct(h, 0), null],
                [fmtPct(bP/100, 1), null],
                [fmtPct(pP/100, 1), { color: pP > bP ? 'green' : 'red', bold: true }],
                [pP > bP ? '✅ Pass' : '❌ Fail', null]
            ]);
        });
    }

    // --- SUITE 10: DEEP QUANT ---
