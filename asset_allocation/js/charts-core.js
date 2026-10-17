// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: shared ECharts instances, theme, formatting, generic charts
    export const chartInstances = {};
    export const ASSET_COLORS = { EQUITY: '#006400', GOLD: '#DAA520', BOND: '#00008B', NASDAQ: '#8A2BE2', default: '#808080' };
    export function getBaseChartOptions() {
        const rootStyles = getComputedStyle(document.documentElement);
        const textColor = rootStyles.getPropertyValue('--text-color').trim(), gridColor = rootStyles.getPropertyValue('--chart-grid-color').trim(), axisColor = rootStyles.getPropertyValue('--label-color').trim(), cardBgColor = rootStyles.getPropertyValue('--card-bg-color').trim(), borderColor = rootStyles.getPropertyValue('--border-color').trim();
        return { grid: { top: 60, right: 40, bottom: 65, left: 65 }, title: { textStyle: { color: textColor, fontSize: 16 }, left: 'center', top: 10, }, legend: { textStyle: { color: textColor }, top: 35, type: 'scroll' }, tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, backgroundColor: cardBgColor, borderColor: borderColor, textStyle: { color: textColor } }, xAxis: { type: 'category', axisLine: { lineStyle: { color: axisColor } }, axisLabel: { color: textColor }, splitLine: { show: false } }, yAxis: { type: 'value', axisLine: { lineStyle: { color: axisColor } }, axisLabel: { color: textColor }, splitLine: { lineStyle: { color: gridColor, type: 'dashed' } }, scale: true }, dataZoom: [ { type: 'inside', start: 0, end: 100, zoomOnMouseWheel: false }, { type: 'slider', start: 0, end: 100, height: 20, bottom: 5 } ], };
    }
    export function initializeChart(chartId) { const chartDom = document.getElementById(chartId); if (chartDom) { const chart = echarts.init(chartDom); chart.setOption(getBaseChartOptions()); chartInstances[chartId] = chart; return chart; } return null; }
    export function formatCurrency(num) { if (typeof num !== 'number' || isNaN(num)) return "N/A"; return num.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }); }
    export function updateAllChartThemes() { const baseOptions = getBaseChartOptions(); for (const id in chartInstances) { if (chartInstances[id]) { const themeOption = { title: { textStyle: baseOptions.title.textStyle }, legend: { textStyle: baseOptions.legend.textStyle }, tooltip: { ...baseOptions.tooltip }, xAxis: [{ axisLine: baseOptions.xAxis.axisLine, axisLabel: baseOptions.xAxis.axisLabel, }], yAxis: [{ axisLine: baseOptions.yAxis.axisLine, axisLabel: baseOptions.yAxis.axisLabel, splitLine: baseOptions.yAxis.splitLine, }], }; chartInstances[id].setOption(themeOption); } } }
    export function drawPerformanceLines() {
        const svg = document.getElementById('performance-lines-svg'), table = document.getElementById('yearly-performance-table'); if (!svg || !table || !svg.parentElement) return;
        svg.innerHTML = ''; const containerRect = svg.parentElement.getBoundingClientRect(), allAssetDivs = Array.from(table.querySelectorAll('tbody td > div[data-asset]')), uniqueAssets = [...new Set(allAssetDivs.map(div => div.dataset.asset))];
        const ASSET_LINE_COLORS = { EQUITY: 'green', BOND: 'blue', GOLD: 'rgba(218, 165, 32, 0.9)', NASDAQ: 'rgba(255, 0, 0, 0.7)', REBALANCED: 'rgba(255, 140, 0, 0.9)', NON_REBALANCED: 'rgba(255, 105, 180, 0.9)', BENCHMARK: 'grey' };
        uniqueAssets.forEach(asset => {
            const assetDivs = allAssetDivs.filter(div => div.dataset.asset === asset); assetDivs.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
            const points = assetDivs.map(div => { const divRect = div.getBoundingClientRect(); return `${divRect.left + divRect.width / 2 - containerRect.left},${divRect.top + divRect.height / 2 - containerRect.top}`; });
            if (points.length > 1) { const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); polyline.setAttribute('points', points.join(' ')); polyline.setAttribute('stroke', ASSET_LINE_COLORS[asset] || 'black'); polyline.setAttribute('stroke-width', '2.5'); polyline.setAttribute('stroke-linecap', 'round'); polyline.setAttribute('stroke-linejoin', 'round'); polyline.setAttribute('fill', 'none'); polyline.setAttribute('style', 'opacity: 0.7;'); svg.appendChild(polyline); }
        });
    }
    export function updateSpaghettiChart(domId, dates, historyValues, mainColor) {
        const chartDom = document.getElementById(domId);
        if (!chartDom) return;
        let chart = echarts.getInstanceByDom(chartDom);
        if (!chart) chart = echarts.init(chartDom);

        const yearsObj = {};
        
        // 1. Group Data by Year based on monthly data points
        for (let i = 0; i < dates.length; i++) {
            const d = new Date(dates[i]);
            const year = d.getFullYear();
            const month = d.getMonth(); // 0 (Jan) to 11 (Dec)
            
            if (!yearsObj[year]) {
                const baseValue = i > 0 ? historyValues[i-1] : historyValues[0]; 
                yearsObj[year] = { base: baseValue, data: [] };
            }
            
            const ytd = ((historyValues[i] / yearsObj[year].base) - 1) * 100;
            yearsObj[year].data.push([month, ytd]);
        }

        // 2. Build Series
        const series = [];
        const allYears = Object.keys(yearsObj).sort();
        const latestYear = allYears[allYears.length - 1];

        allYears.forEach(year => {
            const isLatest = year === latestYear;
            const finalReturn = yearsObj[year].data[yearsObj[year].data.length - 1][1];
            
            series.push({
                name: year,
                type: 'line',
                data: yearsObj[year].data,
                smooth: true,
                showSymbol: false,
                lineStyle: {
                    width: isLatest ? 4 : 1.5, // Highlight current year
                    color: isLatest ? mainColor : undefined, // Force main color for current, auto for others (rainbow)
                    opacity: isLatest ? 1 : 0.4
                },
                // Emphasize on hover
                emphasis: {
                    focus: 'series',
                    lineStyle: { width: 3, opacity: 1, color: mainColor }
                },
                // Add label to the end of the line
                endLabel: {
                    show: true,
                    formatter: `{a}: ${finalReturn.toFixed(1)}%`,
                    fontSize: 10,
                    offset: [5, 0]
                },
                z: isLatest ? 10 : 1
            });
        });

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        const option = {
            tooltip: {
                trigger: 'axis',
                order: 'valueDesc', // Sort tooltip by return (highest on top)
                formatter: (params) => {
                    let txt = `<b>End of ${params[0].axisValueLabel}</b><br/>`;
                    // Only show top 5 and bottom 5 in tooltip if too many years to prevent clutter
                    const sortedParams = params.sort((a,b) => b.value[1] - a.value[1]);
                    
                    sortedParams.forEach(p => {
                        const isCurr = p.seriesName === latestYear;
                        const style = isCurr ? `font-weight:bold; color:${mainColor}` : '';
                        const marker = isCurr ? `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${mainColor};"></span>` : p.marker;
                        txt += `${marker} <span style="${style}">${p.seriesName}: ${p.value[1].toFixed(2)}%</span><br/>`;
                    });
                    return txt;
                }
            },
            grid: {
                left: 50,
                right: 70, // Extra space for end labels
                top: 30,
                bottom: 30
            },
            xAxis: {
                type: 'category',
                data: months,
                boundaryGap: false,
            },
            yAxis: {
                name: 'YTD Return %',
                type: 'value',
                axisLabel: { formatter: '{value}%' },
                splitLine: { show: true, lineStyle: { type: 'dashed' } }
            },
            series: series,
            // 0% Reference Line
            graphic: [
                {
                    type: 'line',
                    left: 50, right: 70,
                    shape: { y1: 0, y2: 0 } // This is tricky in graphic coords, better to use markLine
                }
            ]
        };
        
        // Add 0% MarkLine to the first series
        if(series.length > 0) {
            series[0].markLine = {
                silent: true,
                symbol: ['none', 'none'],
                data: [{ yAxis: 0 }],
                lineStyle: { color: '#666', width: 1, type: 'solid' },
                label: { show: false }
            };
        }

        chart.setOption(option);
    }    

    
    // Groups monthly data into Years and Quarters
    export function updateFairValueChart(domId, dates, historyValues, mainColor) {
        const chartDom = document.getElementById(domId);
        if (!chartDom) return;
        let chart = echarts.getInstanceByDom(chartDom);
        if (!chart) chart = echarts.init(chartDom);

        // Parameters
        const window = 12; // 2-Year Trend (Long term fair value)
        const stdDevs = 1.5; // Width of the band
        
        // Data Arrays
        const lowerBand = [];
        const bandWidth = []; // Difference between Upper and Lower (for stacking)
        const priceData = [];
        const xDates = [];

        // Helper: Calculate Std Dev
        const getStats = (arr) => {
            const m = arr.reduce((a,b)=>a+b,0)/arr.length;
            const s = Math.sqrt(arr.reduce((sq, n) => sq + Math.pow(n - m, 2), 0) / (arr.length - 1));
            return { mean: m, std: s };
        };

        // We need log-space calculations for correct bands on compounding assets
        const logHist = historyValues.map(v => Math.log(v));

        for (let i = 0; i < historyValues.length; i++) {
            // Plot everything, but bands only start after window
            xDates.push(dates[i]);
            priceData.push(historyValues[i]);

            if (i >= window) {
                const slice = logHist.slice(i - window, i);
                const stats = getStats(slice);
                
                // Calculate bands in Log Space
                const upperLog = stats.mean + (stdDevs * stats.std);
                const lowerLog = stats.mean - (stdDevs * stats.std);
                
                // Convert back to Linear Price
                const upper = Math.exp(upperLog);
                const lower = Math.exp(lowerLog);
                
                lowerBand.push(lower);
                // ECharts Stacked Area logic: Series 2 adds to Series 1.
                // So Series 2 value should be (Upper - Lower)
                bandWidth.push(upper - lower);
            } else {
                // Filler for start
                lowerBand.push(null);
                bandWidth.push(null);
            }
        }

        const option = {
            tooltip: {
                trigger: 'axis',
                formatter: (params) => {
                    let txt = `<b>${params[0].axisValueLabel}</b><br/>`;
                    const price = params.find(p => p.seriesName === 'Portfolio Value');
                    
                    if(price) {
                         txt += `Value: <b>${formatCurrency(price.value)}</b><br/>`;
                         // Check position relative to band (Need to manually calculate from data index as band data is hidden)
                         const idx = price.dataIndex;
                         const lower = lowerBand[idx];
                         const width = bandWidth[idx];
                         
                         if(lower !== null && width !== null) {
                             const upper = lower + width;
                             if(price.value > upper) txt += `<span style="color:#c0392b">Status: OVERVALUED (Expensive)</span>`;
                             else if(price.value < lower) txt += `<span style="color:#27ae60">Status: UNDERVALUED (Cheap)</span>`;
                             else txt += `<span style="color:#7f8c8d">Status: FAIR VALUE</span>`;
                         }
                    }
                    return txt;
                }
            },
            legend: { data: ['Portfolio Value', 'Fair Value Range'], bottom: 0 },
            grid: { left: 60, right: 30, top: 20, bottom: 40 },
            xAxis: { 
                type: 'category', 
                data: xDates,
                axisLabel: { formatter: (value) => new Date(value).getFullYear() } // Show Years
            },
            yAxis: { 
                type: 'log', // Log scale makes the band width look consistent visually over time
                logBase: 10,
                axisLabel: { formatter: (v) => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(v) } 
            },
            series: [
                // 1. Invisible Lower Base Line
                {
                    name: 'Lower Band Base',
                    type: 'line',
                    data: lowerBand,
                    lineStyle: { opacity: 0 },
                    stack: 'confidence-band',
                    symbol: 'none',
                    silent: true
                },
                // 2. The Band Itself (Stacked on top of Lower)
                {
                    name: 'Fair Value Range',
                    type: 'line',
                    data: bandWidth,
                    lineStyle: { opacity: 0 },
                    areaStyle: { 
                        color: '#95a5a6', 
                        opacity: 0.4, // Grey band like the Vanguard chart
                        origin: 'start'
                    },
                    stack: 'confidence-band',
                    symbol: 'none'
                },
                // 3. The Actual Price Line (Not Stacked)
                {
                    name: 'Portfolio Value',
                    type: 'line',
                    data: priceData,
                    lineStyle: { color: mainColor, width: 2 },
                    showSymbol: false,
                    z: 10 // Draw on top
                }
            ]
        };
        chart.setOption(option);
    }

    // --- VALUATION PERCENTILE DASHBOARD (VANGUARD STYLE REPLICA) ---
