// Split from index.html in Phase 4 (GSD). See .planning/phases/04-js-css-separation/PLAN.md.
// Concern: strategy keys + pure data.json merge
export const STRATEGY_KEYS = ["nseMidcap150Mom50", "bseMidcap150Mom30", "nse500Mom50"];
export function buildMergedData(rawJsonData, strategy) {
    if (!rawJsonData) return [];
    const eq = rawJsonData[strategy], gold = rawJsonData["gold"], bench = rawJsonData["benchmark"];
    if (!eq || eq.length === 0) { console.warn(`[strategy] no rows for "${strategy}" yet — keeping previous dataset`); return []; }
    if (!gold || !bench) { console.warn("[strategy] data.json must contain gold + benchmark"); return []; }
    const goldByDate = new Map(gold.map(r => [r.date, r.nav]));
    const benchByDate = new Map(bench.map(r => [r.date, r.nav]));
    const merged = [];
    for (const r of eq) {
        if (goldByDate.has(r.date) && benchByDate.has(r.date)) {
            merged.push({ date: r.date, EQUITY: r.nav, GOLD: goldByDate.get(r.date), BENCHMARK: benchByDate.get(r.date) });
        }
    }
    merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return merged;
}

// ====================== BACKTEST ENGINE (Main Thread) ======================
