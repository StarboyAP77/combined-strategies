// 32/js/vendor-echarts.js — ECharts CDN loader with fallback (CRIT-13).
// Why this file exists: the previous inline `onerror="..."` attribute on the
// <script> tag in index.html is blocked by a Content-Security-Policy with
// script-src 'self' (inline event handlers are script-src, not style-src), so
// the jsDelivr -> unpkg fallback silently died the moment CSP was added.
// Building the loader in JS keeps the fallback working under CSP.
//
// Load order: place <script src="js/vendor-echarts.js"></script> where the old
// CDN tag was. async=false so dynamically inserted scripts keep their relative
// order. The app only touches echarts from DOMContentLoaded onward, so a
// late resolve is survivable — every chart path is typeof-echarts guarded
// (see js/utils.js noEcharts) and js/app.js re-renders if we land late.
(function () {
    const SOURCES = [
        'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js',
        'https://unpkg.com/echarts@5.4.3/dist/echarts.min.js'
    ];
    // Diagnostics only: which CDN actually answered. null = not resolved yet,
    // null after total failure too — use window.__echartsLoadFailed for that.
    window.__echartsSource = null;
    window.__echartsLoadFailed = false;

    function announce() {
        // Lets app.js recover if the library lands after its boot render.
        try { document.dispatchEvent(new CustomEvent('echarts-ready', { detail: { source: window.__echartsSource } })); }
        catch (e) { /* CustomEvent unavailable — boot banner stays, tables still work */ }
    }

    function loadNext(i) {
        if (i >= SOURCES.length) {
            window.__echartsLoadFailed = true;
            console.warn('[vendor] ECharts failed to load from all sources');
            return;
        }
        const s = document.createElement('script');
        s.src = SOURCES[i];
        s.async = false;
        s.onload = function () { window.__echartsSource = SOURCES[i]; announce(); };
        s.onerror = function () { s.remove(); loadNext(i + 1); };
        document.head.appendChild(s);
    }
    loadNext(0);
})();