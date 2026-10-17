// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: backtest engine (rebalance + runBacktest)
export function rebalance(portfolio, total, targetAlloc) {
    for (let asset in portfolio) if(targetAlloc[asset] > 0) portfolio[asset] = total * targetAlloc[asset];
}

export function runBacktest(data, targetAlloc, options) {
    const {
        investmentMethod = 'lumpsum', 
        useSip = false, monthlySipAmount = 0, sipDuration = 12, lumpsumAmount = 0,
        monthlyWithdrawal = 0, inflationRate = 0, withdrawalDelayYears = 0,
        withRebalance = false, rebalanceThreshold = 0, rebalanceFrequency = 12,
        rebalanceStrategy = 'static', momentumLookback = 12,
        // Separation of concerns:
        withdrawalCalcMethod = 'standard', // 'standard', 'dynamicThreshold', 'proportionalShield', 'guyton_klinger'
        useSmartDefense = false,           // TRUE = Fortress & Flow, FALSE = Proportional
        dynamicWithdrawalSettings = {},
        enableGoldTrendFilter = false,
        taxStcgRate = 0.20, taxLtcgRate = 0.125, taxExemptionLimit = 125000,
        withdrawalFreq = 1, liquidReturn = 0.06,
        bunkerConfig, smartDriftTolerance = 0.05,
        // Guyton-Klinger parameters
        gkInitialRate = 0.05,              // 5% initial withdrawal rate
        gkUpperThreshold = 0.06,           // 6% upper threshold
        gkLowerThreshold = 0.04,           // 4% lower threshold
        gkAdjustmentMagnitude = 0.10,      // 10% adjustment magnitude
        gkBunkerRefillAmount = 50000,      // Amount to skim into bunker on healthy signal
        gkEnableFlexibility = true,        // Flexibility rule (no inc after loss, no dec after gain)
    } = options;

    let withdrawalBreakdown = [];
    let masterLedger = []; // NEW: The Master Audit Log

    const cashFlows = [];
    const activeTargetAlloc = Object.fromEntries(Object.entries(targetAlloc).filter(([, alloc]) => alloc > 0));
    if (Object.keys(activeTargetAlloc).length === 0) return { history: [], historyWithoutWithdrawals: [], rebalanceEvents: [], withdrawalSummary: {}, cumulativeWithdrawals: [], allocationHistory: [], cumulativeInvestment: [], totalTaxPaid: 0, portfolioCompositionHistory: [], masterLedger: [] };
    
    const initialCapital = useSip ? 0 : lumpsumAmount;
    let portfolio = {}, portfolio_noW = {};
    let costBasis_noW = {}; 
    
    for (const asset in activeTargetAlloc) { 
        portfolio[asset] = initialCapital * activeTargetAlloc[asset]; 
        portfolio_noW[asset] = initialCapital * activeTargetAlloc[asset];
        costBasis_noW[asset] = initialCapital * activeTargetAlloc[asset];
    }

    // --- BUNKER INITIALIZATION ---
    let portfolioATH = initialCapital;
    let lastRefillWatermark = initialCapital; // High Watermark for Refill
    let currentBunker = bunkerConfig ? bunkerConfig.initial : 0;
    const bunkerCap = bunkerConfig ? bunkerConfig.cap : 0;
    const enableRefill = bunkerConfig ? bunkerConfig.enableRefill : false;
    const refillThreshold = bunkerConfig ? (bunkerConfig.refillThreshold / 100) : 0.02;
    const crashThreshold = bunkerConfig ? (bunkerConfig.crashThreshold / 100) : 0.20;
    let bunkerHistory = [];
    let bunkerEvents = [];
    let monthsSurvivedOnBunker = 0;

    // --- GUYTON-KLINGER STATE ---
    let gkAnnualAmount = (monthlyWithdrawal > 0) ? monthlyWithdrawal * 12 : initialCapital * gkInitialRate;
    let gkPrevYearTotal = initialCapital;
    let gkGuardrailHistory = []; // {date, rate%, upper%, lower%, initial%, annualAmount}

    let history = [initialCapital], historyWithoutWithdrawals = [initialCapital], cumulativeWithdrawals = [0], allocationHistory = [], portfolioCompositionHistory = [], cumulativeInvestment = [initialCapital], dynamicSipLog = [], growthSipLog = [];
    let rebalanceEvents = [], withdrawalSummary = { totalWithdrawn: 0, first: null, last: null, totalInvested: initialCapital }, totalWithdrawnRunning = 0;
    
    let gainsRealizedYTD = 0;       
    let taxPaidYTD = 0;             
    let totalTaxPaidLifetime = 0;   

    let currentMonthlyExpense = monthlyWithdrawal; 
    const withdrawalStartMonth = (withdrawalDelayYears * 12) + (useSip ? sipDuration : 0);
    if (withdrawalDelayYears > 0 && inflationRate > 0) currentMonthlyExpense *= Math.pow(1 + inflationRate, useSip ? withdrawalDelayYears + (sipDuration/12) : withdrawalDelayYears);

    let initialAlloc = {};
    for(const asset in activeTargetAlloc) initialAlloc[asset] = (portfolio_noW[asset] || 0) / (Object.values(portfolio_noW).reduce((a, b) => a + b, 0) || 1) * 100;
    
    if(data.length > 0) { 
        allocationHistory.push({date: data[0].date, ...initialAlloc}); 
        portfolioCompositionHistory.push({...portfolio_noW}); 
        if(!useSip) cashFlows.push({ amount: -initialCapital, date: new Date(data[0].date) }); 
        bunkerHistory.push({date: data[0].date, value: currentBunker});
    }

    let cumulativeInvestedAmount = initialCapital;

    // --- MAIN LOOP ---
    for (let i = 1; i < data.length; i++) {
        const curr = data[i], prev = data[i - 1];
        
        // A. Financial Year Reset
        if (i % 12 === 0) {
            gainsRealizedYTD = 0;
            taxPaidYTD = 0;
            if (i > withdrawalStartMonth) {
                currentMonthlyExpense *= (1 + inflationRate);
            }
        }

        // B. Apply Growth (Portfolio)
        for (let k in portfolio) {
            const assetReturn = (prev[k] > 0) ? (curr[k] / prev[k]) - 1 : 0;
            portfolio[k] = (portfolio[k] || 0) * (1 + assetReturn);
            portfolio_noW[k] = (portfolio_noW[k] || 0) * (1 + assetReturn);
        }

        // C. Apply Growth (Bunker)
        const liquidMonthlyRate = Math.pow(1 + liquidReturn, 1/12) - 1;
        currentBunker = (currentBunker || 0) * (1 + liquidMonthlyRate);

        // Calculate Totals after Growth
        let totalAfterGrowth = Object.values(portfolio).reduce((a, b) => a + b, 0);
        let total_noW_AfterGrowth = Object.values(portfolio_noW).reduce((a, b) => a + b, 0);

        // D. Apply SIP
        if ((investmentMethod === 'sip' || investmentMethod === 'valueDynamicSip' || investmentMethod === 'growthDynamicSip') && i <= sipDuration) {
             withdrawalSummary.totalInvested += monthlySipAmount;
             cumulativeInvestedAmount += monthlySipAmount;
             cashFlows.push({ amount: -monthlySipAmount, date: new Date(data[i].date) });
             
             if (investmentMethod === 'sip') {
                for(const asset in activeTargetAlloc) { 
                    const amount = monthlySipAmount * activeTargetAlloc[asset];
                    portfolio[asset] = (portfolio[asset] || 0) + amount; 
                    portfolio_noW[asset] = (portfolio_noW[asset] || 0) + amount;
                    costBasis_noW[asset] = (costBasis_noW[asset] || 0) + amount;
                }
             } else if (investmentMethod === 'valueDynamicSip') { 
                const equityReturn = (prev.EQUITY > 0) ? (curr.EQUITY / prev.EQUITY) - 1 : 0;
                const goldReturn = (prev.GOLD > 0) ? (curr.GOLD / prev.GOLD) - 1 : 0;                
                const returns = [{ asset: 'EQUITY', return: equityReturn }, { asset: 'GOLD', return: goldReturn }].sort((a, b) => a.return - b.return);
                const sipTargetAsset = returns[0].asset;
                let reason = '';
                if (returns[0].return < 0 && returns[1].return < 0) reason = `Both negative; chose ${sipTargetAsset} as it fell the most.`;
                else if (returns[0].return < 0) reason = `${sipTargetAsset} was the only one with a negative return.`;
                else reason = `Both positive; chose ${sipTargetAsset} as it had the lowest gain.`;

                const amount = monthlySipAmount; 
                portfolio[sipTargetAsset] = (portfolio[sipTargetAsset] || 0) + monthlySipAmount;
                portfolio_noW[sipTargetAsset] = (portfolio_noW[sipTargetAsset] || 0) + monthlySipAmount;
                costBasis_noW[sipTargetAsset] = (costBasis_noW[sipTargetAsset] || 0) + amount;
                dynamicSipLog.push({ date: curr.date, investedIn: sipTargetAsset, equityReturn: equityReturn * 100, goldReturn: goldReturn * 100, reason: reason });
            } else if (investmentMethod === 'growthDynamicSip') { 
                const equityReturn = (prev.EQUITY > 0) ? (curr.EQUITY / prev.EQUITY) - 1 : 0;
                const goldReturn = (prev.GOLD > 0) ? (curr.GOLD / prev.GOLD) - 1 : 0;
                const returns = [{ asset: 'EQUITY', return: equityReturn }, { asset: 'GOLD', return: goldReturn }].sort((a, b) => b.return - a.return);
                const sipTargetAsset = returns[0].asset;
                let reason = '';
                if (returns[0].return > 0 && returns[1].return > 0) reason = `Both positive; chose ${sipTargetAsset} as it had the highest gain.`;
                else if (returns[0].return > 0) reason = `Chose ${sipTargetAsset} as it was the only one with a positive return.`;
                else reason = `Both negative; chose ${sipTargetAsset} as it fell the least.`;

                const amount = monthlySipAmount;
                portfolio[sipTargetAsset] = (portfolio[sipTargetAsset] || 0) + monthlySipAmount;
                portfolio_noW[sipTargetAsset] = (portfolio_noW[sipTargetAsset] || 0) + monthlySipAmount;
                costBasis_noW[sipTargetAsset] = (costBasis_noW[sipTargetAsset] || 0) + amount;
                growthSipLog.push({ date: curr.date, investedIn: sipTargetAsset, equityReturn: equityReturn * 100, goldReturn: goldReturn * 100, reason: reason });
            }
        }
        cumulativeInvestment.push(cumulativeInvestedAmount);
        
        // Update totals after SIP
        totalAfterGrowth = Object.values(portfolio).reduce((a, b) => a + b, 0);
        total_noW_AfterGrowth = Object.values(portfolio_noW).reduce((a, b) => a + b, 0);

        // ----------------------------------------------------------------
        // PRE-CALCULATION FOR "SKIPPED REBALANCE" LOGIC (Drift Check)
        // ----------------------------------------------------------------
        let isRebalanceTime = (i % rebalanceFrequency === 0) && (!useSip || i > sipDuration);
        let rebalanceWasNeededBeforeWithdrawal = false;
        
        // Only run check if rebalancing is actually enabled and needed
        if (withRebalance && isRebalanceTime && rebalanceThreshold > 0) {
            for (let asset in activeTargetAlloc) {
                let w = totalAfterGrowth > 0 ? (portfolio[asset] / totalAfterGrowth) : 0;
                if (Math.abs(w - activeTargetAlloc[asset]) > rebalanceThreshold) {
                    rebalanceWasNeededBeforeWithdrawal = true;
                    console.log('w')
                    console.log(w)
                    break;
                }
            }
        }

        // F. WITHDRAWALS & BUNKER (SMART LOGIC)
        // ----------------------------------------------------
        
        // 1. Track ATH
        let currentTotalVal = totalAfterGrowth;
        if (currentTotalVal > portfolioATH) portfolioATH = currentTotalVal;

        // 2. Refill Bunker (Euphoria Protocol) - ONLY if using Smart Defense
        if (useSmartDefense && enableRefill && currentBunker < bunkerCap) {
            // NEW RULE: Only refill if Portfolio is 5% HIGHER than the last watermark
            if (currentTotalVal >= lastRefillWatermark * (1 + refillThreshold)) {
                
                let currentEquityWeight = (currentTotalVal > 0) ? (portfolio['EQUITY'] / currentTotalVal) : 0;
                let targetEquityWeight = activeTargetAlloc['EQUITY'] || 0;
                
                // Skim excess Equity
                if (currentEquityWeight > targetEquityWeight) {
                    let excessEquityVal = (currentEquityWeight - targetEquityWeight) * currentTotalVal;
                    let spaceInBunker = bunkerCap - currentBunker;
                    let harvestAmount = Math.min(excessEquityVal, spaceInBunker);
                    
                    if (harvestAmount > 1000) {
                        portfolio['EQUITY'] -= harvestAmount;
                        currentBunker += harvestAmount;
                        bunkerEvents.push({ date: curr.date, type: 'REFILL', amount: harvestAmount });
                        
                        // Ledger Entry for Refill
                        masterLedger.push({
                            date: curr.date,
                            type: 'REFILL',
                            amount: harvestAmount,
                            reason: `🐿️ Euphoria Refill. Portfolio 5% above high watermark.<br>Skimmed Equity.`,
                            sources: [{asset: 'EQUITY', amount: harvestAmount}],
                            equityVal: portfolio['EQUITY'] || 0,
                            goldVal: portfolio['GOLD'] || 0,
                            totalVal: currentTotalVal
                        });

                        lastRefillWatermark = currentTotalVal; // Update Watermark
                        currentTotalVal = Object.values(portfolio).reduce((a, b) => a + b, 0); // Update total
                    }
                }
            }
        }

        let finalTotal = currentTotalVal;
        let withdrawalAmountThisMonth = 0;
        let userReceivedAmount = 0;
        let withdrawalOccurred = false;

        let withdrawalEvent = { 
            date: curr.date, 
            total: 0, 
            equity: 0, 
            gold: 0, 
            bunker: 0, 
            reason: '' 
        };

        if (monthlyWithdrawal > 0 && i > withdrawalStartMonth) {
            const monthsSinceStart = i - withdrawalStartMonth;
            if ((monthsSinceStart - 1) % withdrawalFreq === 0) {
                withdrawalOccurred = true;
                
                // --- CALCULATION METHOD: HOW MUCH? ---
                let adjustedMonthlyNeed = currentMonthlyExpense;
                const monthlyReturn = prev ? (totalAfterGrowth / (Object.values(prev).reduce((a,b)=>a+b,0) || totalAfterGrowth)) - 1 : 0;

                if (withdrawalCalcMethod === 'dynamicThreshold') {
                    if (monthlyReturn <= dynamicWithdrawalSettings.downsideReturnThreshold) adjustedMonthlyNeed *= (1 - dynamicWithdrawalSettings.downsideAdjustmentPct);
                    else if (monthlyReturn > dynamicWithdrawalSettings.upsideReturnThreshold) adjustedMonthlyNeed *= (1 + dynamicWithdrawalSettings.upsideAdjustmentPct);
                } else if (withdrawalCalcMethod === 'proportionalShield') {
                    if (monthlyReturn < 0 && monthlyReturn <= dynamicWithdrawalSettings.proportionalShieldThreshold) adjustedMonthlyNeed *= (1 - Math.abs(monthlyReturn));
                } else if (withdrawalCalcMethod === 'guyton_klinger') {
                    // --- GUYTON-KLINGER GUARDRAILS ---
                    const isAnnualCheck = ((monthsSinceStart - 1) % 12 === 0);
                    if (isAnnualCheck) {
                        const portfolioVal = totalAfterGrowth;
                        const trailingReturn = gkPrevYearTotal > 0 ? (portfolioVal / gkPrevYearTotal) - 1 : 0;
                        gkPrevYearTotal = portfolioVal;
                        const currentRate = portfolioVal > 0 ? gkAnnualAmount / portfolioVal : 0;
                        const isLossYear = trailingReturn < 0;
                        const isGainYear = trailingReturn > 0;
                        let reasonParts = [];
                        // GUARDRAIL CHECK: adjust annual amount by ±adjustmentMagnitude
                        if (currentRate > gkUpperThreshold && !(gkEnableFlexibility && isGainYear)) {
                            gkAnnualAmount *= (1 - gkAdjustmentMagnitude);
                            reasonParts.push(`Rate ${(currentRate*100).toFixed(2)}% > Upper ${(gkUpperThreshold*100).toFixed(1)}% → −${(gkAdjustmentMagnitude*100).toFixed(0)}%`);
                        } else if (currentRate < gkLowerThreshold && !(gkEnableFlexibility && isLossYear)) {
                            gkAnnualAmount *= (1 + gkAdjustmentMagnitude);
                            reasonParts.push(`Rate ${(currentRate*100).toFixed(2)}% < Lower ${(gkLowerThreshold*100).toFixed(1)}% → +${(gkAdjustmentMagnitude*100).toFixed(0)}%`);
                        } else {
                            reasonParts.push(`Rate ${(currentRate*100).toFixed(2)}% within guardrails (${(gkLowerThreshold*100).toFixed(1)}%–${(gkUpperThreshold*100).toFixed(1)}%)`);
                        }
                        // GK-SPECIFIC BUNKER REFILL: healthy portfolio (rate below lower guardrail) → skim into Bunker
                        if (currentRate < gkLowerThreshold && currentBunker < bunkerCap) {
                            const spaceInBunker = bunkerCap - currentBunker;
                            let skimAmount = Math.min(gkBunkerRefillAmount, spaceInBunker, totalAfterGrowth * 0.05);
                            if (skimAmount > 0) {
                                const eqVal = portfolio['EQUITY'] || 0;
                                const gdVal = portfolio['GOLD'] || 0;
                                const tEq = activeTargetAlloc['EQUITY'] || 0;
                                if ((totalAfterGrowth > 0 && eqVal / totalAfterGrowth > tEq + 0.01) && eqVal >= skimAmount) {
                                    portfolio['EQUITY'] -= skimAmount;
                                } else if (gdVal >= skimAmount) {
                                    portfolio['GOLD'] -= skimAmount;
                                } else {
                                    skimAmount = 0;
                                }
                                if (skimAmount > 0) {
                                    currentBunker += skimAmount;
                                    finalTotal = Object.values(portfolio).reduce((a, b) => a + b, 0);
                                    bunkerEvents.push({ date: curr.date, type: 'REFILL', amount: skimAmount });
                                    reasonParts.push(`🐿️ GK Refill: skimmed ₹${skimAmount.toFixed(0)} into Bunker`);
                                }
                            }
                        }
                        adjustedMonthlyNeed = gkAnnualAmount / 12;
                        withdrawalEvent.reason += `<br>📏 GK: ${reasonParts.join(' | ')}`;
                    } else {
                        adjustedMonthlyNeed = gkAnnualAmount / 12;
                    }
                    gkGuardrailHistory.push({
                        date: curr.date,
                        rate: totalAfterGrowth > 0 ? (gkAnnualAmount / totalAfterGrowth) * 100 : 0,
                        upper: gkUpperThreshold * 100,
                        lower: gkLowerThreshold * 100,
                        initial: gkInitialRate * 100,
                        annualAmount: gkAnnualAmount
                    });
                }

                // NPV Calculation
                let lumpSumNeeded = 0;
                if (withdrawalFreq === 1) lumpSumNeeded = adjustedMonthlyNeed;
                else {
                    const r = liquidMonthlyRate;
                    for(let m=0; m<withdrawalFreq; m++) lumpSumNeeded += adjustedMonthlyNeed / Math.pow(1+r, m);
                }

                // --- EXECUTION STRATEGY: FROM WHERE? ---
                let amountToWithdraw = Math.min(lumpSumNeeded, finalTotal + currentBunker); 
                withdrawalEvent.total = amountToWithdraw;

                // Log Entry Construction
                let logEntry = {
                    date: curr.date,
                    type: 'WITHDRAWAL',
                    amount: amountToWithdraw,
                    sources: [],
                    reason: '',
                    isCrash: false
                };

                if (useSmartDefense) {
                    const currentDrawdown = (finalTotal - portfolioATH) / portfolioATH;
                    const crashLimit = -1 * Math.abs(crashThreshold); 

                    // 1. CRASH PROTOCOL
                    if (currentDrawdown < crashLimit && currentBunker >= lumpSumNeeded) {
                        currentBunker -= lumpSumNeeded;
                        userReceivedAmount = lumpSumNeeded;
                        monthsSurvivedOnBunker += withdrawalFreq;
                        bunkerEvents.push({ date: curr.date, type: 'BURN', amount: lumpSumNeeded });
                        
                        withdrawalEvent.bunker = lumpSumNeeded;
                        withdrawalEvent.reason = `🔥 CRASH PROTOCOL (Down ${(currentDrawdown*100).toFixed(1)}%)`;
                        
                        logEntry.sources.push({asset: 'BUNKER', amount: lumpSumNeeded});
                        logEntry.reason = withdrawalEvent.reason;
                        logEntry.isCrash = true;
                    } 
                    else {
                        // 2. SMART SOURCE SELECTOR
                        let safeWithdraw = Math.min(lumpSumNeeded, finalTotal);
                        
                        if (safeWithdraw > 0) {
                            let eqVal = portfolio['EQUITY'] || 0;
                            let gdVal = portfolio['GOLD'] || 0;
                            let eqW = eqVal / finalTotal;
                            let gdW = gdVal / finalTotal;
                            let tEq = activeTargetAlloc['EQUITY'] || 0;
                            let tGd = activeTargetAlloc['GOLD'] || 0;

                            // Sell Winner: Equity
                            if (eqW > (tEq + smartDriftTolerance) && eqVal >= safeWithdraw) {
                                portfolio['EQUITY'] -= safeWithdraw;
                                withdrawalEvent.equity = safeWithdraw;
                                withdrawalEvent.reason = `🟢 Equity Winner is ${(eqW*100).toFixed(2)}% (> ${(tEq*100 + smartDriftTolerance*100).toFixed(1)}%)`;
                                logEntry.sources.push({asset: 'EQUITY', amount: safeWithdraw});
                            } 
                            // Sell Winner: Gold
                            else if (gdW > (tGd + smartDriftTolerance) && gdVal >= safeWithdraw) {
                                portfolio['GOLD'] -= safeWithdraw;
                                withdrawalEvent.gold = safeWithdraw;
                                withdrawalEvent.reason = `🟡 Gold Winner is ${(gdW*100).toFixed(2)}%(> ${(tGd*100 + smartDriftTolerance*100).toFixed(1)}%)`;
                                logEntry.sources.push({asset: 'GOLD', amount: safeWithdraw});
                            } 
                            else {
                                // Balanced: Proportional
                                for(let k in portfolio) {
                                    let reduction = portfolio[k] * (safeWithdraw / finalTotal);
                                    portfolio[k] -= reduction;
                                    if(k === 'EQUITY') withdrawalEvent.equity += reduction;
                                    else if(k === 'GOLD') withdrawalEvent.gold += reduction;
                                    else withdrawalEvent.equity += reduction;
                                    
                                    logEntry.sources.push({asset: k, amount: reduction});
                                }
                                withdrawalEvent.reason = `⚖️ Balanced (Proportional Sell) <br> <b>Equity ${(eqW*100).toFixed(2)}% : Gold ${(gdW*100).toFixed(2)}% </b>`;
                            }
                            logEntry.reason = withdrawalEvent.reason;
                            userReceivedAmount = safeWithdraw;
                        } else if (currentBunker >= lumpSumNeeded) {
                            // Portfolio empty, use Bunker
                            currentBunker -= lumpSumNeeded;
                            userReceivedAmount = lumpSumNeeded;
                            withdrawalEvent.bunker = lumpSumNeeded;
                            withdrawalEvent.reason = `⚠️ Portfolio Empty (Bunker Backup)`;
                            logEntry.sources.push({asset: 'BUNKER', amount: lumpSumNeeded});
                            logEntry.reason = withdrawalEvent.reason;
                        }
                    }
                } else {
                    // STANDARD STRATEGY
                    let safeWithdraw = Math.min(lumpSumNeeded, finalTotal);
                    for(let k in portfolio) {
                        let reduction = portfolio[k] * (safeWithdraw / finalTotal);
                        portfolio[k] -= reduction;
                        if(k === 'EQUITY') withdrawalEvent.equity += reduction;
                        else if(k === 'GOLD') withdrawalEvent.gold += reduction;
                        else withdrawalEvent.equity += reduction;
                        
                        logEntry.sources.push({asset: k, amount: reduction});
                    }
                    userReceivedAmount = safeWithdraw;
                    if (withdrawalCalcMethod === 'guyton_klinger') {
                        withdrawalEvent.reason = `📏 GK Guardrails ${withdrawalEvent.reason}`;
                    } else {
                        withdrawalEvent.reason = `Standard Proportional`;
                    }
                    logEntry.reason = withdrawalEvent.reason;
                }

                // Store Log
                if (withdrawalEvent.total > 0) withdrawalBreakdown.push(withdrawalEvent);

                logEntry.equityVal = portfolio['EQUITY'] || 0;
                logEntry.goldVal = portfolio['GOLD'] || 0;
                logEntry.totalVal = finalTotal;

                masterLedger.push(logEntry);

                withdrawalSummary.totalWithdrawn += userReceivedAmount;
                finalTotal = Object.values(portfolio).reduce((a,b)=>a+b, 0); // Update Exact Total
                withdrawalAmountThisMonth = userReceivedAmount;
                if (userReceivedAmount > 0) cashFlows.push({ amount: userReceivedAmount, date: new Date(data[i].date) });
            }
        }

        // E. REBALANCE LOGIC (Periodic)
        // [MOVED DOWN - Rebalance AFTER Withdrawal to catch drift corrections]
        let thresholdBreached = false;

        if (withRebalance && (!useSip || i > sipDuration) && isRebalanceTime) {
            
            // Check drift AFTER withdrawal
            if (rebalanceThreshold > 0) {
                let currentTotal = Object.values(portfolio).reduce((a, b) => a + b, 0);
                for (let asset in activeTargetAlloc) {
                    let currentWeight = currentTotal > 0 ? (portfolio[asset] / currentTotal) : 0;
                    if (Math.abs(currentWeight - activeTargetAlloc[asset]) > rebalanceThreshold) {
                        thresholdBreached = true;
                        break; 
                    }
                }
            } else {
                thresholdBreached = true; // Always rebalance if threshold is 0
            }

            // LOGIC: SAVED BY THE BELL?
            if (rebalanceWasNeededBeforeWithdrawal && !thresholdBreached && withdrawalOccurred) {
                let eqVal = portfolio['EQUITY'] || 0;
                let gdVal = portfolio['GOLD'] || 0;
                let eqW = eqVal / finalTotal;
                let gdW = gdVal / finalTotal;
                
                masterLedger.push({
                    date: curr.date,
                    type: 'SKIPPED',
                    reason: `✅ Smart Withdrawal corrected the drift. 
                    <br><b>Rebalance avoided.</b>
                    <br><b>Drift is below ${rebalanceThreshold*100}% Rebalance Threshold</b> 
                    <br>
                    <b>
                        Equity is ${(eqW*100).toFixed(2)}% (>${activeTargetAlloc['EQUITY']*100 - rebalanceThreshold*100}% and <${activeTargetAlloc['EQUITY']*100 + rebalanceThreshold*100}%)
                    <br>
                        Gold is ${(gdW*100).toFixed(2)}% (>${activeTargetAlloc['GOLD']*100 - rebalanceThreshold*100}% and <${activeTargetAlloc['GOLD']*100 + rebalanceThreshold*100}%)
                    </b>`,
                    amount: 0,
                    sources: []
                });
            }

            if (thresholdBreached) {
                let rebalanceWeights = {...activeTargetAlloc}; 
                let triggerDetails = { triggeringAsset: 'Periodic', allocations: [] };

                if (rebalanceStrategy === 'momentum' && i >= momentumLookback) {
                    const pastIndex = i - momentumLookback;
                    const pastData = data[pastIndex];
                    const currentData = data[i];
                    let assetPerformance = [];
                    for (let asset in activeTargetAlloc) {
                        if (pastData[asset] > 0) {
                            const ret = (currentData[asset] / pastData[asset]) - 1;
                            assetPerformance.push({ asset, return: ret });
                        }
                    }
                    assetPerformance.sort((a, b) => b.return - a.return);
                    rebalanceWeights = {}; 
                    const availableWeights = Object.values(activeTargetAlloc).sort((a, b) => b - a);
                    assetPerformance.forEach((item, index) => {
                        if (index < availableWeights.length) rebalanceWeights[item.asset] = availableWeights[index];
                    });
                    triggerDetails.triggeringAsset = `Momentum (${assetPerformance[0].asset} leads)`;
                }
                if (enableGoldTrendFilter && rebalanceWeights['GOLD']) {
                    if (i >= 10) {
                        let sum = 0;
                        for(let k=0; k<10; k++) sum += data[i-k].GOLD;
                        const sma = sum / 10;
                        if (data[i].GOLD < sma) {
                            const goldAlloc = rebalanceWeights['GOLD'];
                            delete rebalanceWeights['GOLD'];
                            rebalanceWeights['BOND'] = (rebalanceWeights['BOND'] || 0) + goldAlloc;
                            triggerDetails.triggeringAsset += " + Gold Trend Filter (Switch to Bond)";
                        }
                    }
                }

                // Simplified Tax Logic for this step (reuse existing logic)
                let transactions = [];
                let currentTotalVal = total_noW_AfterGrowth;
                let taxToDeduct = 0;
                let totalMoved = 0; // For Ledger

                for(let asset in portfolio_noW) {
                    let currentAssetVal = portfolio_noW[asset];
                    let targetWeight = rebalanceWeights[asset] || 0;
                    let diff = (currentTotalVal * targetWeight) - currentAssetVal;

                    if(Math.abs(diff) > 10) {
                        let status = "Neutral";
                        if (diff < 0) { 
                            const sellAmount = Math.abs(diff);
                            totalMoved += sellAmount; // Track total rebalanced volume
                            
                            const totalCost = costBasis_noW[asset] || 0;
                            const fractionSold = currentAssetVal > 0 ? sellAmount / currentAssetVal : 0;
                            const costOfSold = totalCost * fractionSold;
                            const realizedGain = sellAmount - costOfSold;
                            
                            status = realizedGain >= 0 ? "Profit" : "Loss";

                            if (realizedGain > 0) {
                                gainsRealizedYTD += realizedGain;
                                const isLTCG = rebalanceFrequency >= 12;
                                let taxLiability = 0;
                                if(isLTCG) {
                                    const taxableIncome = Math.max(0, gainsRealizedYTD - taxExemptionLimit);
                                    const totalTaxDueYTD = taxableIncome * taxLtcgRate;
                                    taxLiability = Math.max(0, totalTaxDueYTD - taxPaidYTD);
                                } else {
                                    taxLiability = realizedGain * taxStcgRate;
                                }
                                if(taxLiability > 0) {
                                    taxToDeduct += taxLiability;
                                    taxPaidYTD += taxLiability;
                                }
                            }
                            costBasis_noW[asset] = costBasis_noW[asset] * (1 - fractionSold);
                        }
                        transactions.push({ asset, amount: diff, percentChange: (diff / currentTotalVal) * 100, status: status });
                    }
                }
                
                if (taxToDeduct > 0) {
                    totalTaxPaidLifetime += taxToDeduct;
                    total_noW_AfterGrowth -= taxToDeduct;
                    totalAfterGrowth -= (taxToDeduct * (totalAfterGrowth/total_noW_AfterGrowth));
                }

                for(let t of transactions) {
                    if(t.amount > 0) costBasis_noW[t.asset] = (costBasis_noW[t.asset] || 0) + t.amount;
                }

                rebalanceEvents.push({ date: curr.date, y: total_noW_AfterGrowth, details: triggerDetails, transactions: transactions, taxPaid: taxToDeduct });
                
                // Ledger Entry for Rebalance
                if (totalMoved > 0) {
                    masterLedger.push({
                        date: curr.date,
                        type: 'REBALANCE',
                        amount: totalMoved,
                        reason: `Drift > Threshold. Re-aligned portfolio.`,
                        sources: [],
                        equityVal: portfolio['EQUITY'] || 0,
                        goldVal: portfolio['GOLD'] || 0,
                        totalVal: currentTotalVal
                    });
                }

                rebalance(portfolio_noW, total_noW_AfterGrowth, rebalanceWeights);
                total_noW_AfterGrowth = Object.values(portfolio_noW).reduce((a, b) => a + b, 0);
                
                rebalance(portfolio, totalAfterGrowth, rebalanceWeights);
                totalAfterGrowth = Object.values(portfolio).reduce((a, b) => a + b, 0);
            }
        }
        
        const prevCum = cumulativeWithdrawals[cumulativeWithdrawals.length-1];
        cumulativeWithdrawals.push(prevCum + withdrawalAmountThisMonth);
        history.push(finalTotal); 
        historyWithoutWithdrawals.push(total_noW_AfterGrowth);
        
        const currentAllocations = {};
        for(const asset in portfolio_noW) currentAllocations[asset] = total_noW_AfterGrowth > 0 ? (portfolio_noW[asset]/total_noW_AfterGrowth)*100 : 0;
        allocationHistory.push({date: curr.date, ...currentAllocations});
        portfolioCompositionHistory.push({...portfolio_noW}); 
        bunkerHistory.push({date: curr.date, value: currentBunker});
    }
    
    return { 
        history, historyWithoutWithdrawals, cashFlows,
        navRebalanceCount: rebalanceEvents.length, 
        rebalanceEvents, withdrawalSummary, cumulativeWithdrawals, 
        allocationHistory, portfolioCompositionHistory, cumulativeInvestment, 
        dynamicSipLog, growthSipLog,
        totalTaxPaid: totalTaxPaidLifetime,
        bunkerHistory, monthsSurvivedOnBunker, withdrawalBreakdown, masterLedger,
        gkGuardrailHistory
    };
}
