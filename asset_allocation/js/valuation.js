// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: valuation dot + fear monitor
import { calculateProxyVIX, getStressZones } from './crash.js';
    export function updateValuationDotChart(dates, results) {
        const chartDom = document.getElementById('valuation-percentile-chart');
        if(!chartDom) return;
        let chart = echarts.getInstanceByDom(chartDom);
        if(!chart) chart = echarts.init(chartDom);

        const window = 36; // 3-Year Trend Baseline

        // Helper to calculate Z-Score Percentile (0-100)
        const getPercentile = (hist, idx) => {
            if(idx < window) return 50; 
            
            const slice = hist.slice(idx - window, idx);
            const logSlice = slice.map(Math.log);
            const logCurr = Math.log(hist[idx]);
            
            const mean = logSlice.reduce((a,b)=>a+b,0)/slice.length;
            const std = Math.sqrt(logSlice.reduce((s,x)=>s+Math.pow(x-mean,2),0)/(slice.length-1));
            
            if(std === 0) return 50;
            
            const zScore = (logCurr - mean) / std;
            
            // Map Z (-2 to +2) to (0 to 100)
            let score = 50 + (zScore * 25);
            return Math.max(0, Math.min(100, score));
        };

        // Strategies (Top to Bottom visual order)
        const strategies = [
            { name: 'Strategy (Rebalanced)', data: results.standard.reb.historyWithoutWithdrawals },
            { name: 'No Rebalance (Drift)', data: results.standard.noReb.historyWithoutWithdrawals },
            { name: 'Benchmark', data: results.standard.benchmark.historyWithoutWithdrawals },
            { name: 'Equity Only', data: results.standard.equityOnly.historyWithoutWithdrawals },
            { name: 'Gold Only', data: results.standard.goldOnly.historyWithoutWithdrawals }
        ];

        const currentDots = [];
        const prevDots = [];
        const connectors = []; 

        strategies.forEach((strat, i) => {
            const hist = strat.data;
            const curIdx = hist.length - 1;
            const prevIdx = Math.max(0, hist.length - 13); // 12 months ago
            
            const curScore = getPercentile(hist, curIdx);
            const prevScore = getPercentile(hist, prevIdx);
            
            const yIndex = i; 

            // Color Logic based on zone
            // < 30: Undervalued (Green)
            // 30-70: Fair (Grey)
            // > 70: Stretched (Red)
            let color = '#7f8c8d'; // Grey (Fair)
            if(curScore > 70) color = '#e74c3c'; // Red
            if(curScore < 30) color = '#27ae60'; // Green

            // 1. Current Dot (Solid colored fill, black border)
            currentDots.push({
                name: strat.name,
                value: [curScore, yIndex],
                itemStyle: { 
                    color: color, 
                    borderColor: '#000', 
                    borderWidth: 1.5 
                }
            });

            // 2. Previous Dot (Hollow/White fill, Grey border)
            prevDots.push({
                name: strat.name,
                value: [prevScore, yIndex],
                itemStyle: { 
                    color: '#fff', 
                    borderColor: '#999', 
                    borderWidth: 2 
                }
            });

            // 3. Connector
            connectors.push([prevScore, yIndex, curScore]);
        });

        // Connector Renderer
        const renderConnector = (params, api) => {
            const yIndex = api.value(1);
            const start = api.coord([api.value(0), yIndex]);
            const end = api.coord([api.value(2), yIndex]);
            return {
                type: 'line',
                shape: { x1: start[0], y1: start[1], x2: end[0], y2: end[1] },
                style: { stroke: '#555', lineWidth: 1 }
            };
        };

        const option = {
            title: {
                text: 'Valuation percentile relative to fair value',
                left: 0,
                top: 0,
                textStyle: { fontSize: 14, fontWeight: 'bold' }
            },
            grid: { 
                top: 60,    // Space for header bars
                bottom: 30, 
                left: 200,  // Labels
                right: 30 
            },
            xAxis: { 
                type: 'value', 
                min: 0, max: 100,
                interval: 10, // 0, 25, 50, 75, 100
                position: 'bottom',
                axisLine: { show: true, lineStyle: { color: '#333' } },
                axisTick: { show: true, lineStyle: { color: '#333' } },
                axisLabel: { show: true, color: '#000', formatter: '{value}' }, 
                splitLine: { show: false }
            },
            yAxis: { 
                type: 'category', 
                data: strategies.map(s => s.name),
                inverse: true, // Rebalanced on Top
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { 
                    fontWeight: 'bold', 
                    fontSize: 13, 
                    color: '#000',
                    margin: 15,
                    align: 'right'
                }
            },
            // The Header Zones (Colored Backgrounds + Labels)
            markArea: {
                silent: true,
                data: [
                    // Undervalued Zone
                    [
                        { 
                            xAxis: 0, 
                            yAxis: -0.5, // Extend slightly above top row
                            itemStyle: { color: 'rgba(39, 174, 96, 0.05)' }, // Very Faint Green
                            label: { 
                                show: true, 
                                position: 'top', 
                                distance: 5,
                                formatter: 'Undervalued', 
                                color: '#000', 
                                fontWeight: 'bold',
                                backgroundColor: '#c8e6c9', // Header bar color
                                padding: [8, 40], // Wide padding for "Header" look
                                borderRadius: 0,
                                borderColor: '#999',
                                borderWidth: 0.5
                            } 
                        }, 
                        { xAxis: 30, yAxis: strategies.length - 0.5 }
                    ],
                    // Fairly Valued Zone
                    [
                        { 
                            xAxis: 30,
                            yAxis: -0.5,
                            itemStyle: { color: 'rgba(240, 240, 240, 0.2)' }, // Very Faint Grey
                            label: { 
                                show: true, 
                                position: 'top',
                                distance: 5,
                                formatter: 'Fairly valued', 
                                color: '#000', 
                                fontWeight: 'bold',
                                backgroundColor: '#e0e0e0', // Header bar color
                                padding: [8, 40],
                                borderRadius: 0,
                                borderColor: '#999',
                                borderWidth: 0.5
                            } 
                        }, 
                        { xAxis: 70, yAxis: strategies.length - 0.5 }
                    ],
                    // Stretched Zone
                    [
                        { 
                            xAxis: 70, 
                            yAxis: -0.5,
                            itemStyle: { color: 'rgba(192, 57, 43, 0.05)' }, // Very Faint Red
                            label: { 
                                show: true, 
                                position: 'top',
                                distance: 5,
                                formatter: 'Stretched', 
                                color: '#000', 
                                fontWeight: 'bold',
                                backgroundColor: '#ffccbc', // Header bar color
                                padding: [8, 50],
                                borderRadius: 0,
                                borderColor: '#999',
                                borderWidth: 0.5
                            } 
                        }, 
                        { xAxis: 100, yAxis: strategies.length - 0.5 }
                    ]
                ]
            },
            // Dashed Vertical Lines separating zones
            markLine: {
                silent: true,
                symbol: ['none', 'none'],
                label: { show: false },
                lineStyle: { color: '#999', type: 'dashed', width: 1 },
                data: [
                    { xAxis: 30 },
                    { xAxis: 70 }
                ]
            },
            series: [
                // 1. Connector Lines
                {
                    type: 'custom',
                    renderItem: renderConnector,
                    data: connectors,
                    z: 1,
                    silent: true
                },
                // 2. Previous Year (Hollow)
                {
                    name: '1 Year Ago',
                    type: 'scatter',
                    data: prevDots,
                    symbolSize: 14,
                    z: 2,
                    tooltip: { formatter: (p) => `${p.name}<br/>1 Year Ago: <b>${p.value[0].toFixed(0)}</b>/100` }
                },
                // 3. Current (Solid)
                {
                    name: 'Current Valuation',
                    type: 'scatter',
                    data: currentDots,
                    symbolSize: 16,
                    z: 3,
                    tooltip: { formatter: (p) => `${p.name}<br/>Current: <b>${p.value[0].toFixed(0)}</b>/100` }
                }
            ]
        };
        
        chart.setOption(option);
    }

    // Calculates 3-Month Rolling Annualized Volatility (The VIX Proxy)
    export function updateFearMonitorChart(dates, results) {
        const chartDom = document.getElementById('fear-monitor-chart');
        if(!chartDom) return;
        
        // Ensure chart instance exists
        let chart = echarts.getInstanceByDom(chartDom);
        if(!chart) {
            chart = echarts.init(chartDom);
            // Add click listener for radio buttons here to avoid re-binding loop
            document.querySelectorAll('input[name="vix-view-mode"]').forEach(radio => {
                radio.addEventListener('change', () => {
                    // We need access to the latest 'dates' and 'results'
                    // Re-calling updateFearMonitorChart requires these args.
                    // Best way: Trigger the main update cycle or store global ref.
                    // For this snippet, we will rely on the main updateChartAndTable calling this function.
                    // But to make the radio button instant, we can re-trigger:
                    updateFearMonitorChart(dates, results);
                });
            });
        }

        // 1. Determine which data to show
        const mode = document.querySelector('input[name="vix-view-mode"]:checked').value;
        
        let histData, nameColor, titleText;
        
        if (mode === 'reb') {
            histData = results.standard.reb.historyWithoutWithdrawals;
            nameColor = '#2980b9'; // Blue
            titleText = "Rebalanced Strategy";
        } else if (mode === 'noReb') {
            histData = results.standard.noReb.historyWithoutWithdrawals;
            nameColor = '#e74c3c'; // Red
            titleText = "Non-Rebalanced Strategy";
        } else if (mode === 'equityOnly') {
            histData = results.standard.equityOnly.historyWithoutWithdrawals;
            nameColor = '#006400'; // Green
            titleText = "Equity Only";
        } else if (mode === 'goldOnly') {
            histData = results.standard.goldOnly.historyWithoutWithdrawals;
            nameColor = '#DAA520'; // Gold
            titleText = "Gold Only";
        } else {
            histData = results.standard.benchmark.historyWithoutWithdrawals;
            nameColor = '#34495e'; // Grey/Black
            titleText = "Benchmark Index";
        }

        // 2. Calculate Metrics
        const vixData = calculateProxyVIX(histData);
        const stressZones = getStressZones(dates, vixData, 15); // >15% Volatility = Stress

        // 3. Prepare Series Data
        const priceSeries = histData.map((v, i) => [dates[i], v]);
        const vixSeries = vixData.map((v, i) => [dates[i], v]);

        const option = {
            title: { 
                text: `${titleText}: Value vs. Volatility Spikes`, 
                left: 'center', top: 5, 
                textStyle: { fontSize: 14 } 
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                formatter: (params) => {
                    const date = params[0].axisValueLabel;
                    let txt = `<b>${date}</b><br/>`;
                    params.forEach(p => {
                        if (p.seriesName === 'Asset Value') {
                            txt += `Value: <b>${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits:0 }).format(p.value[1])}</b><br/>`;
                        } else if (p.seriesName === 'VIX (Risk)') {
                            txt += `Risk (Vol): <b style="color:#2c3e50">${p.value[1].toFixed(2)}%</b>`;
                        }
                    });
                    return txt;
                }
            },
            legend: { data: ['Asset Value', 'VIX (Risk)'], bottom: 0 },
            grid: { top: 40, right: 50, bottom: 30, left: 50 },
            xAxis: { type: 'time' },
            yAxis: [
                // Left Axis: VIX (0 to 100)
                {
                    type: 'value',
                    name: 'VIX (Volatility)',
                    min: 0,
                    max: (val) => Math.max(50, val.max + 10), // Auto scale but keep some headroom
                    splitLine: { show: false },
                    nameTextStyle: { color: '#2c3e50', fontWeight:'bold' }
                },
                // Right Axis: Price (Log Scale usually looks best, but User asked for simple "Stocks Tumble")
                {
                    type: 'log', // Log scale to match long-term wealth curves
                    logBase: 10,
                    name: 'Portfolio Value',
                    position: 'right',
                    splitLine: { show: true, lineStyle: { type: 'dashed', color: '#eee' } },
                    axisLabel: { formatter: (v) => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) } 
                }
            ],
            series: [
                // Series 1: The "VIX" Line (Dark, Spiky)
                {
                    name: 'VIX (Risk)',
                    type: 'line',
                    yAxisIndex: 0, // Left Axis
                    data: vixSeries,
                    showSymbol: false,
                    lineStyle: { width: 1.5, color: '#2c3e50' }, // Dark Grey/Black like standard VIX
                    areaStyle: { color: '#2c3e50', opacity: 0.1 },
                    // The Grey Zones
                    markArea: {
                        data: stressZones,
                        silent: true
                    },
                    z: 1 // Behind price
                },
                // Series 2: The Price Line (Colored)
                {
                    name: 'Asset Value',
                    type: 'line',
                    yAxisIndex: 1, // Right Axis
                    data: priceSeries,
                    showSymbol: false,
                    lineStyle: { width: 2.5, color: nameColor }, // Strategy color
                    z: 2 // On Top
                }
            ]
        };

        chart.setOption(option);
    }

