// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: benchmark simulation + asset stats
export function runBenchmarkSimulation(data, options) {
    const {
        useSip = false, monthlySipAmount = 0, sipDuration = 12, lumpsumAmount = 0,
        monthlyWithdrawal = 0, inflationRate = 0, withdrawalDelayYears = 0,
        withdrawalStrategy = 'standard', dynamicWithdrawalSettings = {},
        asset = 'BENCHMARK' // Phase 7: single-asset buy-and-hold sim (BENCHMARK/EQUITY/GOLD)
    } = options;

    const initialCapital = useSip ? 0 : lumpsumAmount;
    let corpusWithWithdrawals = initialCapital, corpusWithoutWithdrawals = initialCapital;
    let history = [corpusWithWithdrawals], historyWithoutWithdrawals = [corpusWithoutWithdrawals], cumulativeWithdrawals = [0];
    let withdrawalSummary = { totalWithdrawn: 0, first: null, last: null, totalInvested: initialCapital }, totalWithdrawnRunning = 0;
    let baseMonthlyWithdrawal = monthlyWithdrawal;
    const withdrawalStartMonth = (withdrawalDelayYears * 12) + (useSip ? sipDuration : 0);
    if (withdrawalDelayYears > 0 && inflationRate > 0) { baseMonthlyWithdrawal *= Math.pow(1 + inflationRate, useSip ? withdrawalDelayYears + (sipDuration/12) : withdrawalDelayYears); }

    for (let i = 1; i < data.length; i++) {
        const curr = data[i], prev = data[i - 1];
        const assetReturn = prev[asset] > 0 ? (curr[asset] / prev[asset]) - 1 : 0;
        const prevCorpusValue = corpusWithWithdrawals;
        corpusWithWithdrawals *= (1 + assetReturn);
        corpusWithoutWithdrawals *= (1 + assetReturn);
        if (useSip && i <= sipDuration) {
            withdrawalSummary.totalInvested += monthlySipAmount;
            corpusWithWithdrawals += monthlySipAmount;
            corpusWithoutWithdrawals += monthlySipAmount;
        }
        let finalTotal = corpusWithWithdrawals, withdrawalAmountThisMonth = 0;
        if (monthlyWithdrawal > 0 && i > withdrawalStartMonth) {
            if ((i - withdrawalStartMonth - 1) > 0 && (i - withdrawalStartMonth - 1) % 12 === 0) {
                baseMonthlyWithdrawal *= (1 + inflationRate);
            }
            let adjustedMonthlyWithdrawal = baseMonthlyWithdrawal;
            const monthlyReturn = prevCorpusValue > 0 ? (corpusWithWithdrawals / prevCorpusValue) - 1 : 0;
            if (withdrawalStrategy === 'dynamicThreshold') {
                if (monthlyReturn <= dynamicWithdrawalSettings.downsideReturnThreshold) adjustedMonthlyWithdrawal *= (1 - dynamicWithdrawalSettings.downsideAdjustmentPct);
                else if (monthlyReturn > dynamicWithdrawalSettings.upsideReturnThreshold) adjustedMonthlyWithdrawal *= (1 + dynamicWithdrawalSettings.upsideAdjustmentPct);
            } else if (withdrawalStrategy === 'proportionalShield') {
                if (monthlyReturn < 0 && monthlyReturn <= dynamicWithdrawalSettings.proportionalShieldThreshold) adjustedMonthlyWithdrawal *= (1 - Math.abs(monthlyReturn));
            }
            const withdrawalAmount = Math.min(adjustedMonthlyWithdrawal, finalTotal);
            withdrawalAmountThisMonth = withdrawalAmount;
            if (withdrawalSummary.first === null) withdrawalSummary.first = { amount: withdrawalAmount, corpus: finalTotal, pct: finalTotal > 0 ? (withdrawalAmount / finalTotal * 100) : 0 };
            withdrawalSummary.last = { amount: withdrawalAmount, corpus: finalTotal, pct: finalTotal > 0 ? (withdrawalAmount / finalTotal * 100) : 0 };
            withdrawalSummary.totalWithdrawn += withdrawalAmount;
            finalTotal -= withdrawalAmount;
        }
        corpusWithWithdrawals = finalTotal;
        history.push(corpusWithWithdrawals); historyWithoutWithdrawals.push(corpusWithoutWithdrawals);
        totalWithdrawnRunning += withdrawalAmountThisMonth; cumulativeWithdrawals.push(totalWithdrawnRunning);
    }
    return { history, historyWithoutWithdrawals, withdrawalSummary, cumulativeWithdrawals };
}

export function getAssetStats(historicalData, activeAssets) {
    const returns = {}; activeAssets.forEach(asset => { returns[asset] = []; });
    for (let i = 1; i < historicalData.length; i++) {
        activeAssets.forEach(asset => {
            if (historicalData[i-1][asset] > 0) returns[asset].push(historicalData[i][asset] / historicalData[i-1][asset] - 1);
            else returns[asset].push(0);
        });
    }
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const stdDev = (arr, avg) => Math.sqrt(arr.reduce((sq, n) => sq + Math.pow(n - avg, 2), 0) / (arr.length - 1));
    const means = {}, stdDevs = {}, correlationMatrix = [];
    activeAssets.forEach(asset => { const avg = mean(returns[asset]); means[asset] = avg; stdDevs[asset] = stdDev(returns[asset], avg); });
    for (let i = 0; i < activeAssets.length; i++) {
        correlationMatrix[i] = [];
        for (let j = 0; j < activeAssets.length; j++) {
            if (i === j) { correlationMatrix[i][j] = 1.0; continue; }
            const x = returns[activeAssets[i]], y = returns[activeAssets[j]]; let covariance = 0;
            for (let k = 0; k < x.length; k++) covariance += (x[k] - means[activeAssets[i]]) * (y[k] - means[activeAssets[j]]);
            covariance /= (x.length - 1); correlationMatrix[i][j] = covariance / (stdDevs[activeAssets[i]] * stdDevs[activeAssets[j]]);
        }
    }
    const covarianceMatrix = [];
    for(let i=0; i < activeAssets.length; i++){ covarianceMatrix[i] = []; for(let j=0; j < activeAssets.length; j++) covarianceMatrix[i][j] = correlationMatrix[i][j] * stdDevs[activeAssets[i]] * stdDevs[activeAssets[j]]; }
    const L = Array(activeAssets.length).fill(0).map(() => Array(activeAssets.length).fill(0));
    for (let i=0; i < activeAssets.length; i++) for (let j=0; j <= i; j++) { let sum = 0; for (let k=0; k < j; k++) sum += L[i][k] * L[j][k]; if (i === j) L[i][j] = Math.sqrt(covarianceMatrix[i][i] - sum); else L[i][j] = (1.0 / L[j][j] * (covarianceMatrix[i][j] - sum)); }
    return { means, cholesky: L, assets: activeAssets };
}
