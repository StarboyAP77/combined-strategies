// 31/js/utils.js — shared helpers (load before charts-*.js)
// M7: single ECharts CDN can fail (offline/CSP/blocked) — every chart path
// must degrade to warn+return, never throw at boot or on lazy expand.
function noEcharts(where) {
    if (typeof echarts === 'undefined') { console.warn('[charts] ECharts unavailable, skipping ' + (where || 'render')); return true; }
    return false;
}
// M15: missing/renamed container id — follow s1:139-140 pattern (warn + return).
function noEl(el, where) {
    if (!el) { console.warn('[charts] missing container, skipping ' + (where || 'render')); return true; }
    return false;
}
// M21: parallel histories zipped by index — never silently plot NaN on unequal lengths.
function minLen(where, ...arrs) {
    const lens = arrs.map(a => (a ? a.length : 0));
    const n = Math.min(...lens);
    if (new Set(lens).size > 1) console.warn('[charts] unequal history lengths in ' + (where || 'render') + ' ' + JSON.stringify(lens) + ' — clamping to ' + n);
    return n;
}
function safeInit(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (typeof echarts === 'undefined') return null;
    try { return echarts.init(el); } catch (e) { return null; }
}

// =================================================================
// SHARED CALCULATION + FORMATTING HELPERS
// Single source of truth so engine.js and every charts-*.js file use
// identical definitions (docs/REVIEW.md CRIT-03/05/06/07, M22, WARN-09).
// Loaded before engine.js/charts-*.js -> available everywhere.
// =================================================================

const DAYS_PER_YEAR = 365.25;

// CRIT-03/WARN-07: parse 'YYYY-MM-DD' as UTC midnight. `new Date(str)` on a
// bare date string is already UTC, but be explicit so no local-timezone drift
// can shift a month boundary.
function parseDate(str) {
    if (str instanceof Date) return str;
    if (typeof str !== 'string' || str.length < 10) return null;
    const d = new Date(str + 'T00:00:00Z');
    return isNaN(d.getTime()) ? null : d;
}
function daysBetween(dateStr1, dateStr2) {
    const d1 = parseDate(dateStr1), d2 = parseDate(dateStr2);
    if (!d1 || !d2) return 0;
    return (d2.getTime() - d1.getTime()) / 86400000;
}
function yearsBetween(dateStr1, dateStr2) {
    return daysBetween(dateStr1, dateStr2) / DAYS_PER_YEAR;
}
// Calendar-month count — DISPLAY ONLY (trade log "Held" column).
// Never use this for tax classification or annualisation.
function monthsBetween(dateStr1, dateStr2) {
    const d1 = parseDate(dateStr1), d2 = parseDate(dateStr2);
    if (!d1 || !d2) return 0;
    return (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + (d2.getUTCMonth() - d1.getUTCMonth());
}

// CRIT-05/CRIT-07/M22: the ONE CAGR definition. Annualises with actual
// elapsed days (365.25/yr), never `months/12` and never `len/12`.
function cagrFrom(startValue, endValue, years) {
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return 0;
    if (!(startValue > 0) || !(years > 0)) return 0;
    const ratio = endValue / startValue;
    if (!(ratio > 0)) return -1;
    return Math.pow(ratio, 1 / years) - 1;
}

// CRIT-06/M22: the ONE annualised volatility definition. Population variance,
// sqrt(12) annualisation for monthly input.
function annVolFromReturns(returns) {
    if (!returns || returns.length < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance) * Math.sqrt(12);
}
// Derive monthly returns from a value series (post-tax NAV, corpus, etc).
function monthlyReturnsFrom(history) {
    if (!history || history.length < 2) return [];
    const out = [];
    for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1] && history[i - 1].value;
        const cur = history[i] && history[i].value;
        if (!Number.isFinite(prev) || !Number.isFinite(cur) || !(prev > 0)) continue;
        out.push((cur - prev) / prev);
    }
    return out;
}
function annVolFromHistory(history) {
    return annVolFromReturns(monthlyReturnsFrom(history));
}

// CRIT-06: Sortino downside deviation. Numerator = SUM(min(r - MAR, 0)^2) over
// ALL periods; denominator = ALL periods (N), never the count of negative
// months. MAR defaults to 0.
function downsideDevFromReturns(returns, mar) {
    const target = Number.isFinite(mar) ? mar : 0;
    if (!returns || returns.length < 1) return 0;
    let sum = 0;
    for (const r of returns) {
        const d = r - target;
        if (d < 0) sum += d * d;
    }
    return Math.sqrt(sum / returns.length) * Math.sqrt(12);
}
function downsideDevFromHistory(history, mar) {
    return downsideDevFromReturns(monthlyReturnsFrom(history), mar);
}

// C1/M12/M22: divide without ever producing Infinity/NaN.
function safeDiv(a, b, fallback) {
    const fb = fallback === undefined ? 0 : fallback;
    const na = Number(a), nb = Number(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb) || nb === 0) return fb;
    const r = na / nb;
    return Number.isFinite(r) ? r : fb;
}
// Guard a value before it reaches a formatter or a chart series.
function finiteOr(v, fallback) {
    const fb = fallback === undefined ? null : fallback;
    // Number(null) === 0 and Number('') === 0, so a missing value would
    // silently become a real 0. Reject null/undefined/blank/boolean/object
    // before coercion or "N/A" cells render as 0.00.
    if (v === null || v === undefined) return fb;
    if (typeof v === 'boolean' || typeof v === 'object' || typeof v === 'function') return fb;
    if (typeof v === 'string' && v.trim() === '') return fb;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fb;
}

// CRIT-11: escape before interpolating into innerHTML.
function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// CRIT-12: strip prototypes/getters before handing arrays to ECharts.
function plainData(v) {
    try { return JSON.parse(JSON.stringify(v)); }
    catch (e) { return v; }
}

// WARN-09: single formatter set.
function fmtINRv(num) {
    const n = finiteOr(num, null);
    if (n === null) return 'N/A';
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtINRv0(num) {
    const n = finiteOr(num, null);
    if (n === null) return 'N/A';
    return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function fmtPct(fraction, digits) {
    const n = finiteOr(fraction, null);
    if (n === null) return 'N/A';
    return (n * 100).toFixed(digits === undefined ? 2 : digits) + '%';
}
function fmtNum(num, digits) {
    const n = finiteOr(num, null);
    if (n === null) return 'N/A';
    return n.toFixed(digits === undefined ? 2 : digits);
}
