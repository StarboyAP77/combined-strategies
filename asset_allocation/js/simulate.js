// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: random-walk simulation + controls
import { formatCurrency } from './charts-core.js';
    // 1. GLOBAL STATE for Random Walk
    let rwSimulationData = null; // Stores data from the main backtest
    // Fed by main.js after every calculateMetrics() run (fix: was never assigned).
    export function setRandomWalkData(historyWithoutWithdrawals) {
        rwSimulationData = historyWithoutWithdrawals ? { historyWithoutWithdrawals } : null;
    }
    export function getSeededRNG(seed) {
        return function() {
            var t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        }
    }

    export function getNormalRandom(rng) {
        let u = 0, v = 0;
        while(u === 0) u = rng(); 
        while(v === 0) v = rng();
        return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    }

    // 3. CORE FUNCTION: Execute Simulation & Render Chart
    export function runRandomWalkSimulation() {
        // Validation
        if (!rwSimulationData || !rwSimulationData.historyWithoutWithdrawals) {
            alert("⚠️ Please wait for the main strategy to finish calculating, then try again.");
            return;
        }

        const chartDom = document.getElementById('random-walk-chart');
        if(!chartDom) return;
        
        // Initialize Chart
        let chart = echarts.getInstanceByDom(chartDom);
        if(!chart) chart = echarts.init(chartDom);
        
        chart.showLoading();

        // Get Inputs
        const steps = parseInt(document.getElementById('rw-steps').value) || 120;
        const paths = parseInt(document.getElementById('rw-paths').value) || 50;
        const seedVal = parseInt(document.getElementById('rw-seed').value) || 12345;
        
        // Get Historical Data Stats (Drift & Volatility)
        const hist = rwSimulationData.historyWithoutWithdrawals;
        const startValue = hist[hist.length-1]; // Start from current portfolio value
        
        // Calculate Log Returns to determine Drift and Volatility
        const rets = [];
        for(let i=1; i<hist.length; i++) {
            if(hist[i-1] > 0) rets.push(Math.log(hist[i]/hist[i-1])); 
        }
        
        if(rets.length === 0) {
            chart.hideLoading();
            alert("Not enough historical data to simulate.");
            return;
        }

        const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
        const vol = Math.sqrt(rets.reduce((s,x)=>s+Math.pow(x-mean,2),0)/(rets.length-1));

        // Initialize RNG
        const rng = getSeededRNG(seedVal);
        
        // Generate Paths
        const allPaths = [];
        const finalValues = [];
        const xLabels = Array.from({length: steps+1}, (_, i) => i);

        for(let p=0; p<paths; p++) {
            const path = [startValue];
            let current = startValue;
            
            for(let t=1; t<=steps; t++) {
                const shock = getNormalRandom(rng);
                // Geometric Brownian Motion Formula
                const ret = mean + (vol * shock);
                current = current * Math.exp(ret);
                path.push(current);
            }
            allPaths.push(path);
            finalValues.push(current);
        }

        renderFanChart(chart, allPaths, startValue, steps, 'GBM');
    }

    // 2b. BOOTSTRAP (Phase 8): replay REAL joint months instead of bell-curve shocks.
    function logReturns(hist) {
        const r = [];
        for (let i = 1; i < hist.length; i++) if (hist[i-1] > 0) r.push(Math.log(hist[i] / hist[i-1]));
        return r;
    }
    // legs: { name: history[] }. One shared month-index sequence per path preserves
    // cross-leg correlation (same "world" for every leg). blockMonths>1 preserves momentum.
    export function resamplePaths(legs, { months, nPaths, seed, blockMonths = 1 }) {
        const names = Object.keys(legs);
        const rets = {};
        names.forEach(n => rets[n] = logReturns(legs[n]));
        const T = Math.min(...names.map(n => rets[n].length));
        if (T < 2 || months < 1 || nPaths < 1) return null;
        const B = Math.max(1, Math.min(blockMonths || 1, T));
        const rng = getSeededRNG(seed);
        const out = {};
        names.forEach(n => out[n] = []);
        for (let p = 0; p < nPaths; p++) {
            const idx = [];
            while (idx.length < months) {
                const s = Math.floor(rng() * T);
                for (let b = 0; b < B && idx.length < months; b++) idx.push((s + b) % T);
            }
            names.forEach(n => out[n].push(idx.map(i => rets[n][i])));
        }
        return out;
    }
    // Standard-plan accounting over a log-return path (mirrors runBenchmarkSimulation
    // timing/inflation rules; withdrawalDelayMonths counted from projection start).
    export function projectWithPlan(startValue, logRets, opts) {
        let v = startValue;
        const path = [v];
        let w = (opts && opts.monthlyWithdrawal) || 0;
        const delay = (opts && opts.withdrawalDelayMonths) || 0;
        const infl = (opts && opts.inflationRate) || 0;
        for (let t = 1; t <= logRets.length; t++) {
            v *= Math.exp(logRets[t - 1]);
            if (opts && opts.monthlySipAmount > 0 && t <= (opts.sipMonths || 0)) v += opts.monthlySipAmount;
            if (w > 0 && t > delay) {
                if ((t - delay - 1) > 0 && (t - delay - 1) % 12 === 0) w *= (1 + infl);
                v -= Math.min(w, v);
            }
            path.push(v);
        }
        return path;
    }

    // Shared fan renderer (GBM + bootstrap): verdict + spaghetti + median + setOption.
    function renderFanChart(chart, allPaths, startValue, steps, label) {
        const finalValues = allPaths.map(p => p[p.length - 1]);
    finalValues.sort((a,b) => a-b);
    const medianPathData = [];
    // Construct visual median line point-by-point
    for(let t=0; t<=steps; t++) {
        const timeSlice = allPaths.map(p => p[t]).sort((a,b)=>a-b);
        medianPathData.push(timeSlice[Math.floor(timeSlice.length * 0.5)]);
    }

    const successCount = finalValues.filter(v => v > startValue).length;
    const nPaths = allPaths.length;
    const winRate = (successCount / nPaths) * 100;
    const p10 = finalValues[Math.floor(nPaths * 0.1)];
    const p90 = finalValues[Math.floor(nPaths * 0.9)];

    // Update Text Verdict
    const verdictEl = document.getElementById('rw-verdict');
    if(verdictEl) {
        verdictEl.innerHTML = `
            Win Probability: <span style="color:${winRate>50?'#27ae60':'#c0392b'}">${winRate.toFixed(1)}%</span> | 
            Worst Case (10%): <span style="color:#c0392b">${formatCurrency(p10)}</span> | 
            Best Case (90%): <span style="color:#27ae60">${formatCurrency(p90)}</span>
        `;
    }

    // Build Chart Series
    const series = [];
    
    // 1. Add background spaghetti lines
    allPaths.forEach(path => {
        series.push({
            type: 'line',
            data: path,
            showSymbol: false,
            lineStyle: { width: 1, opacity: 0.15, color: '#8e44ad' },
            animation: false,
            silent: true // Performance boost
        });
    });

    // 2. Add Median Line (Bold)
    series.push({
        name: 'Median Scenario',
        type: 'line',
        data: medianPathData,
        showSymbol: false,
        lineStyle: { width: 3, color: '#2c3e50' },
        z: 10
    });

    const xLabels = Array.from({length: steps + 1}, (_, i) => i);
    const option = {
        title: { text: `Projecting ${steps} Months Forward (${label})`, left: 'center', top: 10, textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'axis', formatter: (p) => {
            const med = p.find(x => x.seriesName === 'Median Scenario');
            return med ? `Month ${med.axisValue}<br/>Median Value: <b>${formatCurrency(med.value)}</b>` : '';
        }},
        xAxis: { name: 'Months From Now', type: 'category', data: xLabels },
        yAxis: { 
            name: 'Portfolio Value', type: 'value', scale: true,
            axisLabel: { formatter: (v) => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) }
        },
        series: series,
        grid: { top: 50, right: 30, bottom: 30, left: 60 }
    };

    chart.hideLoading();
    chart.setOption(option, true); // true = Destructive update (clear old lines)
    }
    // Phase 8: bootstrap run — same panel inputs + verdict as GBM.
    export function runBootstrapSimulation() {
        if (!rwSimulationData || !rwSimulationData.historyWithoutWithdrawals) {
            alert("⚠️ Please wait for the main strategy to finish calculating, then try again.");
            return;
        }
        const chartDom = document.getElementById('random-walk-chart');
        if (!chartDom) return;
        let chart = echarts.getInstanceByDom(chartDom);
        if (!chart) chart = echarts.init(chartDom);
        chart.showLoading();
        const steps = parseInt(document.getElementById('rw-steps').value) || 120;
        const paths = parseInt(document.getElementById('rw-paths').value) || 50;
        const seedVal = parseInt(document.getElementById('rw-seed').value) || 12345;
        const blockMonths = Math.max(1, parseInt(document.getElementById('rw-block')?.value) || 1);
        const hist = rwSimulationData.historyWithoutWithdrawals;
        const startValue = hist[hist.length - 1];
        const legs = resamplePaths({ portfolio: hist }, { months: steps, nPaths: paths, seed: seedVal, blockMonths });
        if (!legs) {
            chart.hideLoading();
            alert("Not enough historical data to simulate.");
            return;
        }
        const method = document.querySelector('input[name="investment-method"]:checked')?.value || 'lumpsum';
        const planOpts = {
            monthlySipAmount: method === 'lumpsum' ? 0 : (parseFloat(document.getElementById('monthly-sip-amount').value) || 0),
            sipMonths: method === 'lumpsum' ? 0 : (parseInt(document.getElementById('sip-duration').value, 10) || 0),
            monthlyWithdrawal: parseFloat(document.getElementById('monthly-withdrawal').value) || 0,
            withdrawalDelayMonths: (parseFloat(document.getElementById('withdrawal-delay').value) || 0) * 12,
            inflationRate: (parseFloat(document.getElementById('inflation-rate').value) || 0) / 100
        };
        const allPaths = legs.portfolio.map(rets => projectWithPlan(startValue, rets, planOpts));
        renderFanChart(chart, allPaths, startValue, steps, 'Bootstrap');
    }

    // 4. SETUP FUNCTION: Hooks up the sliders and button
    export function setupRandomWalkControls() {
        console.log("Initializing Random Walk Controls...");
        
        // Link Sliders to Text displays
        const stepsIn = document.getElementById('rw-steps');
        const stepsOut = document.getElementById('rw-steps-val');
        if(stepsIn && stepsOut) stepsIn.addEventListener('input', (e) => stepsOut.textContent = e.target.value);

        const pathsIn = document.getElementById('rw-paths');
        const pathsOut = document.getElementById('rw-paths-val');
        if(pathsIn && pathsOut) pathsIn.addEventListener('input', (e) => pathsOut.textContent = e.target.value);

        // Link Button
        const btn = document.getElementById('run-rw-btn');
        if(btn) {
            // Remove old listeners to prevent duplicates if function called multiple times
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            newBtn.addEventListener('click', (e) => {
                e.preventDefault(); // Prevent detail/summary toggle if inside one
                const method = document.querySelector('input[name="rw-method"]:checked')?.value || 'gbm';
                console.log("Running simulation:", method);
                if (method === 'bootstrap') runBootstrapSimulation();
                else runRandomWalkSimulation();
            });
        }
    }

    // Phase 2: standalone calculation engine. Takes the active merged dataset
    // ([{date, EQUITY, GOLD, BENCHMARK}]) as an argument instead of reading the
    // module-global `data`, purges previous-run state on every call, and returns
    // everything the render layer needs. (Distinct from module-level
    // calcMetrics(values, dates, cashFlows) used inside.)
