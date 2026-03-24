# VDataEditor Startup Performance Analysis

## Executive Summary

VDataEditor has a modular vanilla JavaScript architecture with proper performance awareness through `VDataPerf` monitoring. However, **schema loading from GitHub is the critical path bottleneck**, blocking full editor readiness despite the UI appearing sooner.

**Current Startup Bottlenecks (in priority order):**
1. 🔴 **Schema Network Fetch** - GitHub .json.gz download (variable, ~0.5-2s+ on slow networks)
2. 🟠 **Gzip Decompression** - Browser decompression of 5-10MB gzipped schema files
3. 🟠 **JSON Parsing** - Schema object indexing and class/enum map building
4. 🟡 **Script Loading Order** - 28 deferred scripts load sequentially by dependency
5. 🟡 **UI Panel Initialization** - Property tree, manual editor, menu bar construction

---

## Detailed Bottleneck Analysis

### 1. **Schema Loading from GitHub** (PRIMARY BOTTLENECK)
**File:** `src/schema/schema-db.js` (line 268-282)
**Impact:** Blocks editor full functionality, shows progress bar during load

**What Happens:**
```
User launches → Window renders → "Loading schemas..." progress bar
  ↓
  fetch(SCHEMA_URLS.cs2) [async, ~500ms-2s+ depending on network]
  ↓
  arrayBuffer received → gunzipToJson() decompression
  ↓
  JSON.parse() → buildIndexes() (creates _classesByName, _enumByKey Maps)
  ↓
  IndexedDB cache write (async)
  ↓
  'vdata-schema-loaded' event → UI suggests enabled
```

**Metrics to Track:**
- Fetch time (network latency + transfer)
- Gzip decompression time (tracked separately in `gunzipToJson`)
- JSON parse + index build time (tracked separately in `applySchemaPayload`)
- Cache hit rate (local IndexedDB success)
- Total end-to-end schema load time

**Code Locations:**
- `SCHEMA_URLS` (line 8-12) — GitHub URLs for cs2, dota2, deadlock
- `loadFromNetwork()` (line 268) — Fetch gzipped JSON from GitHub
- `gunzipToJson()` (line 152-203) — Decompression pipeline
- `applySchemaPayload()` (line 231-266) — Indexing and storage
- `VDataPerf.recordSchemaSteps()` — Already tracks gzip/parse timing

**Current Mitigations:**
- ✅ Gzip compression (5-10MB → ~500KB-1MB)
- ✅ IndexedDB caching (`src/schema/schema-cache.js`)
- ✅ Local fallback schemas in `schemas/*.json`
- ✅ Performance tracking in `performance-monitor.js`
- ❌ No pre-warming of cache
- ❌ No offline-first strategy
- ❌ No parallel schema fetching

---

### 2. **Gzip Decompression Performance**
**File:** `src/schema/schema-db.js` (line 152-203)
**Impact:** ~100-500ms depending on browser/CPU

**Current Approach:**
```js
async function gunzipToJson(gzipBuffer) {
  const tp = performance.now();
  // Decompression (uses pako library or browser API)
  const decompressMs = performance.now() - tp;
  // JSON.parse()
  const parseMs = performance.now() - tp2;
  // Records both separately
  VDataPerf.recordSchemaSteps({ gunzipDecompressMs, gunzipParseMs });
  return data;
}
```

**Issues:**
- All decompression happens on main thread (can block for 100-300ms+)
- No chunking or yielding during large decompression

---

### 3. **Script Loading Order** (MEDIUM IMPACT)
**File:** `index.html` (lines 189-248)
**Impact:** Delays first DOM interactivity

**Current Order (all use `defer`):**
```
1. format/kv3.js (format parsing)
2-5. Model layer (kv3-node, kv3-document, format registry)
6-7. Settings (system-config, widget-config)
8. app-theme.js (theme switching)
9. src/modes/index.js (mode dispatch)
10. icons.js (SVG icon defs)
11. src/icon-cache.js
12. vendor/cm.js (CodeMirror — LARGE, ~200-400KB)
13-18. Parse, document, file-ops, status-bar, history, widgets
19. src/performance-monitor.js (perf API wrapper)
20-23. Schema layer (schema-cache, schema-db, runtime-fetcher, suggestions)
24. src/prop-tree.js (3,100 lines — MASSIVE)
25. src/manual-editor.js (CodeMirror sync)
26-28. Menu, tab bar initialization
29. editor.js (main initialization)
```

**Issues:**
- ❌ `vendor/cm.js` (CodeMirror bundle) may not all be needed at startup
- ❌ `src/prop-tree.js` (3,100 lines) builds full DOM tree structure upfront
- ✅ Most dependencies properly ordered
- ✅ All use `defer` for non-blocking load

**Potential Gains:**
- Tree-shake CodeMirror: ~20-50KB savings (if possible)
- Lazy-load prop-tree rendering: show placeholder → progressive render

---

### 4. **Initial UI Panel Rendering** (MEDIUM IMPACT)
**File:** `editor.js` (line 748-793)

**Initialization Sequence:**
```
1. initAppTheme() — applies CSS variables, dark/light mode
2. initMenuBar() — builds menu DOM
3. initTabBar() — builds tab bar
4. VDataSuggestions.initSchemas() [ASYNC] — starts schema fetch
5. docManager.newDoc() — creates first blank document
6. initPropTree*() — builds property tree UI (full DOM)
7. initHistoryDock() — builds history panel
8. _editorShellReady = true
9. renderAll({ immediateManualSync: true }) — paints UI
```

**Issues:**
- Step 6 (initPropTree) builds full tree DOM even for empty doc
- Step 5 (newDoc) triggers renderAll only after shell ready, but if no file is open, property tree is empty and being fully built

**Optimization Opportunity:**
- Defer property tree DOM construction until file is opened or user interacts

---

## Performance Measurement Setup

### How to Measure Current Startup Time

**Option 1: Browser DevTools (Recommended)**
```bash
npm start
# Press Ctrl+Shift+I (DevTools)
# Performance tab → Record → Let app fully load
# Stop recording → Analyze timeline
```

**Option 2: Console Metrics**
```js
// In browser console after app loads:
VDataPerf.getMetrics()
// Returns object with:
// - lastSchemaLoad: {game, source, msTotal}
// - lastSteps: {gunzipDecompressMs, gunzipParseMs}
// - measures: [array of all VDataPerf marks/measures]
```

**Option 3: Electron Main Process Timing**
Modify `main.js` to log window show timing:
```js
const startTime = Date.now();
win.once('ready-to-show', () => {
  console.log('Window ready-to-show:', Date.now() - startTime, 'ms');
  win.show();
});
```

### Key Metrics to Capture

| Metric | Source | Target |
|--------|--------|--------|
| **Window visible** | Electron main → 'ready-to-show' | < 1s |
| **DOM interactive** | DevTools Performance → First paint | < 1s |
| **Editor UI ready** | `_editorShellReady = true` | < 2s |
| **Schema loaded (first)** | VDataPerf.getMetrics() | < 3s |
| **All schemas ready** | 'vdata-schema-loaded' events | < 5s |
| **Total user-perceived startup** | App launch to fully interactive | < 5s |

---

## Recommended Optimizations (Prioritized)

### 🔴 HIGH PRIORITY (Biggest Impact)

#### 1.1 Pre-warm IndexedDB Schema Cache
**Impact:** Eliminates GitHub fetch on repeat sessions
**Effort:** Low (1-2 hours)
**Location:** `src/schema/schema-db.js`, `index.html`

**Approach:**
- Ship app with pre-compressed schemas in `schemas/` folder
- On app start, check IndexedDB cache age
- If cache missing or stale (>7 days), fetch fresh from GitHub in background
- Use offline-first strategy: load cached version, then update in background

**Implementation:**
```js
// Pseudo-code for offline-first schema loading
async function initSchemas() {
  // 1. Try IndexedDB cache first (instant, no network)
  const cached = await SchemaCache.get('cs2');
  if (cached && !isStale(cached)) {
    applySchema(cached); // Show UI immediately
  }

  // 2. Background refresh if stale or missing
  refreshSchemasInBackground();
}
```

**Benefit:** Startup goes from "wait for GitHub" to instant on repeat uses.

---

#### 1.2 Move Schema Decompression to Web Worker
**Impact:** Unblock main thread during gzip decompression (~100-300ms)
**Effort:** Medium (4-6 hours)
**Location:** `src/schema/schema-db.js`, new `src/schema/schema-worker.js`

**Approach:**
- Create Web Worker for `gunzipToJson()` operation
- Move decompression + JSON.parse to worker thread
- Main thread receives parsed data back via `postMessage`
- UI stays responsive during decompression

**Benefit:** UI remains interactive while schemas load in background.

---

#### 1.3 Parallelize Schema Fetching
**Impact:** Load all 3 schemas concurrently instead of sequentially
**Effort:** Low (1-2 hours)
**Location:** `src/modes/suggestions.js` (where `initSchemas` is likely called)

**Current Flow:**
```
Fetch cs2 → Decompress → Parse → IndexedDB
Fetch dota2 → Decompress → Parse → IndexedDB  [serialized]
Fetch deadlock → Decompress → Parse → IndexedDB
Total: 3x latency
```

**Optimized Flow:**
```
Promise.all([
  load('cs2'),
  load('dota2'),
  load('deadlock')
])
Total: 1x latency
```

**Benefit:** 60-70% reduction in total schema load time.

---

### 🟠 MEDIUM PRIORITY (Incremental Improvements)

#### 2.1 Lazy-load Property Tree DOM
**Impact:** Shows editor UI 200-500ms faster
**Effort:** Medium (3-4 hours)
**Location:** `src/prop-tree.js`

**Current:** Full tree DOM built even for empty documents
**Proposed:** Render placeholder → build tree on first file open

**Implementation:**
```js
function initPropTree() {
  // Instead of building full DOM, create placeholder
  const container = document.getElementById('propTreeRoot');
  container.innerHTML = '<div class="prop-tree-placeholder">No document open</div>';

  // Defer full tree initialization until docManager fires 'active-changed'
}
```

**Benefit:** Perceived startup time improves by ~200-300ms.

---

#### 2.2 Split CodeMirror Bundle
**Impact:** Reduce initial script load by ~50KB
**Effort:** Medium (2-3 hours)
**Location:** `src/cm-bundle.js`, `vendor/cm.js`

**Current:** All CodeMirror modules bundled upfront
**Proposed:** Core editor + essential features bundled, optional extensions lazy-loaded

**Implementation:**
```js
// vendor/cm-core.js — only essential extensions
// src/cm-extensions.js — loaded on demand
```

**Benefit:** Initial script bundle 20-30% smaller, faster parse + eval.

---

#### 2.3 Defer Non-Critical UI Panels
**Impact:** Main thread freed up ~100ms
**Effort:** Low (1-2 hours)
**Location:** `editor.js` (lines 781-790)

**Current:** All UI panels init synchronously before `_editorShellReady`
**Proposed:** Init critical panels (menu, tab bar), defer others (history dock, property browser secondary init)

**Implementation:**
```js
// Critical path
initMenuBar();
initTabBar();
initPropTree(); // essential
_editorShellReady = true;

// Deferred (after shell ready)
requestIdleCallback(() => {
  initHistoryDock();
  initPropertyBrowser();
});
```

**Benefit:** ~100-150ms faster shell ready.

---

### 🟡 LOW PRIORITY (Polish & Edge Cases)

#### 3.1 Add Startup Performance Dashboard
Create a built-in startup metrics display:
```js
// Add to Help menu or Settings
showStartupMetrics() {
  const metrics = VDataPerf.getMetrics();
  // Display waterfall chart of all startup phases
}
```

#### 3.2 Network Throttling Support
Test with slow network simulation:
```bash
# Chrome DevTools → Network → Slow 3G
# Measure impact of optimizations
```

#### 3.3 Cache Invalidation Strategy
Document when to refresh schemas:
- On new app version release
- Manual refresh via Help → Manage Schemas
- TTL-based (7 days) automatic refresh

---

## Measurement Checklist

Before implementing any optimizations, establish baselines:

- [ ] Record startup time on clean session (no cache)
- [ ] Record startup time on repeat session (cached)
- [ ] Measure schema fetch time
- [ ] Measure schema decompress time
- [ ] Measure schema parse + indexing time
- [ ] Profile DevTools Performance tab during startup
- [ ] Check for long tasks (>50ms on main thread)
- [ ] Measure time to interactive (TTI)
- [ ] Test with network throttling (Slow 3G)

---

## Testing Recommendations

### Test Scenarios
1. **Cold Start** - App closes, cache cleared, no network
2. **Warm Start** - App closes, cache preserved, network available
3. **Offline Mode** - Network unavailable, schemas from cache only
4. **Slow Network** - 3G throttling, test timeout behavior

### Performance Targets
| Phase | Current Estimate | Target |
|-------|-----------------|--------|
| Window visible → DOM ready | ~500ms | < 500ms ✓ |
| DOM interactive (first paint) | ~800ms | < 800ms ✓ |
| Editor shell ready | ~1.5s | < 1.5s ✓ |
| First schema loaded | ~2-4s* | < 2s (network dependent) |
| All schemas loaded | ~6-10s* | < 5s |

*Network dependent (GitHub latency 200-1000ms, transfer 500ms-2s)

---

## Implementation Order

**Phase 1 - Measurement (Week 1)**
1. Set up Chrome DevTools profiling
2. Establish baseline metrics for all key startup phases
3. Document findings in issue/PR

**Phase 2 - High-Impact Optimizations (Week 2-3)**
1. Pre-warm IndexedDB cache with shipped schemas
2. Move decompression to Web Worker
3. Parallelize schema fetching

**Phase 3 - Medium-Impact Optimizations (Week 3-4)**
1. Lazy-load property tree DOM
2. Split CodeMirror bundle (if impactful)
3. Defer non-critical UI panels

**Phase 4 - Verification (Week 4)**
1. Measure improvements across all metrics
2. Test on slow network (3G throttling)
3. Document results and success criteria met

---

## References

- **Performance Monitor:** `src/performance-monitor.js` (window.VDataPerf)
- **Performance Guide:** `readme/js-performance-guide.md`
- **Schema Loading:** `src/schema/schema-db.js`
- **Editor Initialization:** `editor.js`
- **DevTools Profiling:** `Ctrl+Shift+I` → Performance tab

---

*Report generated based on code analysis. Actual bottlenecks should be confirmed with Chrome DevTools profiling.*
