// 31/js/lazy.js — lazy rendering for collapsible chart sections.
// Plain script, shared globals. Load AFTER utils.js, BEFORE app.js.
// Charts render only when their <details data-lazy> section is open:
// on first load, on section expand (toggle), on re-run (open ones only),
// or on demand (export PDF renders everything first).
const LazyCharts = {
    renderers: {},
    // CRIT-14: the percentile playback timer was a bare `window.__gsPlay`,
    // a global that charts-s4.js set and lazy.js cleared — two files mutating
    // one undeclared namespace property, with no contract between them.
    // The timer now lives on this object. window.__gsPlay is kept as a
    // mirror so a mid-flight deploy of either file can't orphan an interval
    // that would then tick into a disposed chart instance.
    playTimer: null,
    setPlayTimer(id) { this.playTimer = id; window.__gsPlay = id; },
    clearPlayTimer() {
        if (this.playTimer) { clearInterval(this.playTimer); }
        if (window.__gsPlay) { clearInterval(window.__gsPlay); }
        this.playTimer = null;
        window.__gsPlay = null;
    },
    // Drop all renderers from the previous run. Called at the start of every
    // runBacktestAndRender() — register() is append-only, so without this each
    // re-run would stack ~40 more closures and replay stale ones.
    clear() {
        this.renderers = {};
    },
    // Append; a section may register several chart fns, all run in order.
    register(key, fn) {
        if (!this.renderers[key]) this.renderers[key] = [];
        this.renderers[key].push(fn);
    },
    renderOne(details) {
        if (!details || typeof AppState === 'undefined' || !AppState.ready) return;
        const key = details.dataset ? details.dataset.lazy : null;
        if (!key || !this.renderers[key]) return;
        if (details.dataset.renderedRun === String(AppState.runId)) return; // fresh already
        // M7: ECharts CDN failed — no total boot failure; user-visible message instead.
        if (typeof echarts === 'undefined') {
            console.warn('[lazy] ECharts missing, skipping section:', key);
            try {
                const host = details.querySelector('.details-content');
                let badge = details.querySelector('.lazy-error-badge');
                if (badge) badge.remove();
                if (host) {
                    badge = document.createElement('div');
                    badge.className = 'lazy-error-badge';
                    badge.style.cssText = 'margin:0 0 10px;padding:8px 12px;border-radius:4px;background:#fef9e7;color:#7d6608;font-size:13px;';
                    badge.textContent = '⚠️ Charts unavailable — chart library failed to load. Check connection and reload; tables are unaffected.';
                    host.prepend(badge);
                }
            } catch (e) {}
            return;
        }
        try {
            // Stop percentile playback + drop stale instances before re-render.
            // Unconditional: one playback timer exists at a time, any re-render
            // must kill it or the tick will hit a disposed chart (M16).
            this.clearPlayTimer();
            details.querySelectorAll('[id$="-chart"]').forEach(el => {
                try { const c = echarts.getInstanceByDom(el); if (c) c.dispose(); } catch (e) {}
            });
        } catch (e) {}
        let failed = 0;
        try {
            (this.renderers[key] || []).forEach(fn => {
                try { fn(); }
                catch (e) { failed++; console.warn('[lazy] chart failed:', key, e); }
            });
        } catch (e) { failed++; console.warn('[lazy] render failed:', key, e); }
        // M6: only stamp fresh when nothing failed, so close/re-open retries.
        if (failed === 0) details.dataset.renderedRun = String(AppState.runId);
        // Visible badge so one bad chart is obvious (and can't silently blank neighbors).
        try {
            const host = details.querySelector('.details-content');
            let badge = details.querySelector('.lazy-error-badge');
            if (badge) badge.remove();
            if (failed > 0 && host) {
                badge = document.createElement('div');
                badge.className = 'lazy-error-badge';
                badge.style.cssText = 'margin:0 0 10px;padding:8px 12px;border-radius:4px;background:#fdecea;color:#a93226;font-size:13px;';
                badge.textContent = `⚠️ ${failed} chart${failed > 1 ? 's' : ''} in this section failed to render — see console.`;
                host.prepend(badge);
            }
        } catch (e) {}
        // Resize after layout settles (section may just have opened).
        requestAnimationFrame(() => {
            if (typeof echarts === 'undefined') return;
            try {
                details.querySelectorAll('[id$="-chart"]').forEach(el => {
                    try { const c = echarts.getInstanceByDom(el); if (c) c.resize(); } catch (e) {}
                });
            } catch (e) {}
        });
    },
    renderOpen() {
        document.querySelectorAll('details.chart-group[data-lazy][open]').forEach(d => this.renderOne(d));
    },
    renderAll() {
        document.querySelectorAll('details.chart-group[data-lazy]').forEach(d => this.renderOne(d));
    }
};

// Render on expand. Deferred so the browser lays out the opened section
// first — ECharts needs real (non-zero) container size.
document.addEventListener('toggle', (e) => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('details.chart-group[data-lazy]')) return;
    if (!t.open) {
        // M16: collapsing any section must not orphan the percentile timer.
        LazyCharts.clearPlayTimer();
        return;
    }
    requestAnimationFrame(() => setTimeout(() => LazyCharts.renderOne(t), 30));
}, true);
