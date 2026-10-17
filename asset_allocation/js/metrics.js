// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: pure performance-math helpers (CAGR/XIRR/rolling/drawdown/returns)
export function calcMetrics(values, dates, cashFlows = null) {
    if (!values || values.length < 2) return {};
    const n = values.length;
    const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    let peak = -Infinity, peakIndex = 0, maxDD = 0, maxDDpeakIndex = 0, maxDDtroughIndex = 0;
    let inDrawdown = false, currentDrawdownPeakValue = -Infinity, currentDrawdownTroughIndex = -1, currentDrawdownMinVal = Infinity;
    const recoveryDurations = [], allDrawdownDepths = [];
    for (let i = 0; i < n; i++) {
        if (values[i] >= currentDrawdownPeakValue && inDrawdown) {
            recoveryDurations.push(i - currentDrawdownTroughIndex);
            allDrawdownDepths.push((currentDrawdownMinVal - currentDrawdownPeakValue) / currentDrawdownPeakValue);
            inDrawdown = false;
            currentDrawdownMinVal = Infinity;
        }
        if (values[i] > peak) { peak = values[i]; peakIndex = i; }
        if (values[i] < peak) {
            if (!inDrawdown) { inDrawdown = true; currentDrawdownPeakValue = peak; currentDrawdownTroughIndex = i; currentDrawdownMinVal = values[i]; }
            else { if (values[i] < values[currentDrawdownTroughIndex]) currentDrawdownTroughIndex = i; if (values[i] < currentDrawdownMinVal) currentDrawdownMinVal = values[i]; }
        }
        const drawdown = peak > 0 ? (values[i] - peak) / peak : 0;
        if (drawdown < maxDD) { maxDD = drawdown; maxDDpeakIndex = peakIndex; maxDDtroughIndex = i; }
    }
    if (inDrawdown) allDrawdownDepths.push((currentDrawdownMinVal - currentDrawdownPeakValue) / currentDrawdownPeakValue);
    const averageDrawdown = allDrawdownDepths.length > 0 ? `${(allDrawdownDepths.reduce((a, b) => a + b, 0) / allDrawdownDepths.length * 100).toFixed(2)}%` : 'N/A';
    let timeToRecoveryMaxDD = 'N/A';
    if (maxDD < 0) {
        const peakValue = values[maxDDpeakIndex];
        let recoveryIndex = -1;
        for (let i = maxDDtroughIndex; i < n; i++) if (values[i] >= peakValue) { recoveryIndex = i; break; }
        if (recoveryIndex !== -1) timeToRecoveryMaxDD = `${recoveryIndex - maxDDtroughIndex} month(s) (by ${formatDate(dates[recoveryIndex])})`;
        else timeToRecoveryMaxDD = 'Not Recovered';
    }
    let avgTimeToRecovery = recoveryDurations.length > 0 ? `${(recoveryDurations.reduce((a, b) => a + b, 0) / recoveryDurations.length).toFixed(1)} month(s)` : 'N/A';
    const start = values[0], end = values[n - 1], years = (n - 1) / 12;
    const absoluteReturn = start > 0 ? (end / start) - 1 : 0;
    const cagr = start > 0 ? Math.pow(end / start, 1 / years) - 1 : NaN;
    const maxDDDate = maxDD < 0 ? formatDate(dates[maxDDtroughIndex]) : 'N/A';
    let rets = []; for (let i = 1; i < n; i++) if (values[i-1] > 0) rets.push(values[i] / values[i-1] - 1);
    const positiveReturns = rets.filter(r => r > 0), negativeReturns = rets.filter(r => r < 0);
    const positiveMonths = positiveReturns.length, negativeMonths = negativeReturns.length;
    const avgPositiveReturn = positiveMonths > 0 ? positiveReturns.reduce((a, b) => a + b, 0) / positiveMonths : 0;
    const avgNegativeReturn = negativeMonths > 0 ? negativeReturns.reduce((a, b) => a + b, 0) / negativeMonths : 0;
    const gainLossRatio = avgNegativeReturn !== 0 ? Math.abs(avgPositiveReturn / avgNegativeReturn) : Infinity;
    let maxPositiveStreak = 0, maxNegativeStreak = 0, currentPositiveStreak = 0, currentNegativeStreak = 0, maxPositiveStreakEndIndex = -1, maxNegativeStreakEndIndex = -1;
    for (let i = 0; i < rets.length; i++) {
        const ret = rets[i];
        if (ret > 0) { currentPositiveStreak++; currentNegativeStreak = 0; if (currentPositiveStreak > maxPositiveStreak) { maxPositiveStreak = currentPositiveStreak; maxPositiveStreakEndIndex = i; } }
        else if (ret < 0) { currentNegativeStreak++; currentPositiveStreak = 0; if (currentNegativeStreak > maxNegativeStreak) { maxNegativeStreak = currentNegativeStreak; maxNegativeStreakEndIndex = i; } }
        else { currentPositiveStreak = 0; currentNegativeStreak = 0; }
    }
    let positiveStreakText = maxPositiveStreak > 0 && maxPositiveStreakEndIndex !== -1 ? `${maxPositiveStreak} (${formatDate(dates[maxPositiveStreakEndIndex - maxPositiveStreak + 2])} - ${formatDate(dates[maxPositiveStreakEndIndex + 1])})` : maxPositiveStreak;
    let negativeStreakText = maxNegativeStreak > 0 && maxNegativeStreakEndIndex !== -1 ? `${maxNegativeStreak} (${formatDate(dates[maxNegativeStreakEndIndex - maxNegativeStreak + 2])} - ${formatDate(dates[maxNegativeStreakEndIndex + 1])})` : maxNegativeStreak;
    const avg = rets.length > 0 ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const vol = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / (rets.length - 1)) * Math.sqrt(12) : 0;
    let downsideDev = 0; if (negativeReturns.length > 1) downsideDev = Math.sqrt(negativeReturns.reduce((a, b) => a + Math.pow(b, 2), 0) / negativeReturns.length) * Math.sqrt(12);
    let xirr = null; if (cashFlows && cashFlows.length > 1) xirr = calculateXIRR(cashFlows);
    return { 'Absolute Return': (absoluteReturn * 100).toFixed(2) + "%", CAGR: isNaN(cagr) ? 'N/A' : (cagr * 100).toFixed(2) + "%", 'Absolute XIRR': xirr !== null ? `${(xirr * 100).toFixed(2)}%` : 'N/A', MaxDD: (maxDD * 100).toFixed(2) + "%", MaxDDDate: maxDDDate, 'Time To Recovery(MaxDD)': timeToRecoveryMaxDD, 'Average Drawdown %': averageDrawdown, 'Average Time To recovery': avgTimeToRecovery, Vol: isNaN(vol) ? "N/A" : (vol * 100).toFixed(2) + "%", Sharpe: vol > 0 ? (cagr / vol).toFixed(2) : 'N/A', Sortino: downsideDev > 0 && !isNaN(cagr) ? (cagr / downsideDev).toFixed(2) : 'N/A', Calmar: maxDD < 0 && !isNaN(cagr) ? (cagr / Math.abs(maxDD)).toFixed(2) : 'N/A', PositiveMonths: positiveMonths, NegativeMonths: negativeMonths, 'Max Consecutive + Months': positiveStreakText, 'Max Consecutive - Months': negativeStreakText, 'Avg Positive Month': (avgPositiveReturn * 100).toFixed(2) + '%', 'Avg Negative Month': (avgNegativeReturn * 100).toFixed(2) + '%', 'Gain/Loss Ratio': isFinite(gainLossRatio) ? gainLossRatio.toFixed(2) : 'N/A', };
}
export function calculateRollingCagrStats(history, periodInYears) {
    const periodInMonths = periodInYears * 12;
    if (history.length <= periodInMonths) return null;
    let rollingCAGRs = [];
    for (let i = periodInMonths; i < history.length; i++) {
        const startValue = history[i - periodInMonths]; const endValue = history[i];
        if (startValue > 0) rollingCAGRs.push(Math.pow(endValue / startValue, 1 / periodInYears) - 1);
    }
    if (rollingCAGRs.length === 0) return null;
    const avg = rollingCAGRs.reduce((sum, cagr) => sum + cagr, 0) / rollingCAGRs.length;
    return { avg: (avg * 100).toFixed(2) + '%', min: (Math.min(...rollingCAGRs) * 100).toFixed(2) + '%', max: (Math.max(...rollingCAGRs) * 100).toFixed(2) + '%' };
}
export function calculateXIRR(cashFlows) {
    if (cashFlows.length < 2) return null;
    const maxIterations = 100, tolerance = 1e-7; let guess = 0.1;
    const npv = (rate) => { let sum = 0; const firstDate = cashFlows[0].date.getTime(); for (const cf of cashFlows) { sum += cf.amount / Math.pow(1 + rate, ((cf.date.getTime() - firstDate) / (1000*60*60*24)) / 365.25); } return sum; };
    const derivative = (rate) => { let sum = 0; const firstDate = cashFlows[0].date.getTime(); for (const cf of cashFlows) { const daysDiff = (cf.date.getTime() - firstDate) / (1000*60*60*24); if (rate > -1) sum -= (cf.amount * daysDiff) / (365.25 * Math.pow(1 + rate, (daysDiff / 365.25) + 1)); } return sum; };
    for (let i = 0; i < maxIterations; i++) {
        const npvResult = npv(guess), derivativeResult = derivative(guess);
        if (Math.abs(npvResult) < tolerance) return guess;
        if (derivativeResult === 0) break;
        guess = guess - npvResult / derivativeResult;
    }
    return null;
}
export function calculateYearlyReturns(history, dates) {
    if (history.length < 2) return { labels: [], data: [], drawdowns: [] };
    const yearlyData = {};
    dates.forEach((dateStr, i) => { const year = new Date(dateStr).getUTCFullYear(); if (!yearlyData[year]) yearlyData[year] = []; yearlyData[year].push({ date: new Date(dateStr), value: history[i] }); });
    const sortedYears = Object.keys(yearlyData).sort();
    const yearlyValues = sortedYears.map(year => { const lastEntry = yearlyData[year].reduce((latest, entry) => entry.date > latest.date ? entry : latest, yearlyData[year][0]); return { year: parseInt(year), value: lastEntry.value }; });
    const labels = [], data = [], drawdowns = [];
    for (let i = 1; i < yearlyValues.length; i++) {
        const prevYearValue = yearlyValues[i - 1].value, currentYearData = yearlyData[yearlyValues[i].year.toString()], currentYearValue = yearlyValues[i].value;
        if (prevYearValue > 0) { const yearlyReturn = (currentYearValue / prevYearValue) - 1; labels.push(yearlyValues[i].year.toString()); data.push(yearlyReturn * 100); }
        else { labels.push(yearlyValues[i].year.toString()); data.push(0); }
        let peakInYear = prevYearValue, maxDrawdownInYear = 0;
        const sortedYearData = currentYearData.sort((a, b) => a.date - b.date);
        for (const entry of sortedYearData) { if (entry.value > peakInYear) peakInYear = entry.value; if (peakInYear > 0) { const drawdown = (entry.value - peakInYear) / peakInYear; if (drawdown < maxDrawdownInYear) maxDrawdownInYear = drawdown; } }
        drawdowns.push(maxDrawdownInYear * 100);
    }
    return { labels, data, drawdowns };
}

export function calculateMonthlyReturnsForRank(history) {
    const returns = [];
    for (let i = 1; i < history.length; i++) {
        if (history[i - 1] > 0) returns.push((history[i] / history[i - 1] - 1) * 100);
        else returns.push(0);
    }
    return returns;
}

export function calculateMonthlyReturns(history, dates) {
    const data = [];
    for (let i = 1; i < history.length; i++) if (history[i - 1] > 0) data.push([dates[i], (history[i] / history[i - 1] - 1) * 100]);
    return data;
}

export function calculateDrawdown(history, dates) {
    let peak = -Infinity, peakIndex = 0;
    return history.map((value, i) => { if (value > peak) { peak = value; peakIndex = i; } return { value: [dates[i], peak > 0 ? ((value - peak) / peak) * 100 : 0], monthsInDrawdown: i - peakIndex, }; });
}

export function calculateRollingReturns(history, dates, periods) {
    const datasets = [];
    periods.forEach(p => {
        const periodInMonths = p * 12; if (history.length <= periodInMonths) return;
        const data = [];
        for (let i = periodInMonths; i < history.length; i++) if (history[i - periodInMonths] > 0) data.push([dates[i], (Math.pow(history[i] / history[i - periodInMonths], 1 / p) - 1) * 100]);
        datasets.push({ name: `${p}-Year Rolling CAGR`, type: 'line', data: data, showSymbol: false, emphasis: { focus: 'series' } });
    });
    return datasets;
}

    export function getMatrixColor(cagr) {
        const pct = cagr * 100;
        if (pct < -10) return '#e57373'; // Deep Red (Crash)
        if (pct < 0) return '#ffcdd2';   // Light Red (Loss)
        if (pct < 8) return '#c8e6c9';   // Light Green (FD Rate)
        if (pct < 12) return '#81c784';  // Medium Green (Good)
        return '#388e3c';                // Deep Green (Excellent)
    }

    export function getMatrixTextColor(cagr) {
        const pct = cagr * 100;
        if (pct < -10 || pct >= 12) return '#ffffff'; // White text on dark bg
        return '#2c3e50'; // Dark text on light bg
    }

    export function pearsonCorrelation(x, y) {
        let n = x.length;
        if (n === 0) return 0;
        let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
        for (let i = 0; i < n; i++) {
            sumX += x[i];
            sumY += y[i];
            sumX2 += x[i] * x[i];
            sumY2 += y[i] * y[i];
            sumXY += x[i] * y[i];
        }
        let numerator = (n * sumXY) - (sumX * sumY);
        let denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
        if (denominator === 0) return 0;
        return numerator / denominator;
    }
