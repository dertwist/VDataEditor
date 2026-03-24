# VDataEditor Startup Performance Measurement Guide

This guide walks you through measuring the actual startup performance of VDataEditor and identifying bottlenecks.

## Quick Start (5 minutes)

### 1. Run the App with Performance Monitoring

```bash
# Terminal 1: Start the app
npm start

# Terminal 2: Wait for app to fully load, then go to DevTools
```

### 2. Open Chrome DevTools Performance Panel

```
Keyboard: Ctrl+Shift+I (or F12)
Menu: Help > Toggle DevTools
```

### 3. Measure Startup Time

**Method A: DevTools Performance Tab (Most Detailed)**

1. Click **Performance** tab
2. Click **Record** (red circle) button
3. Immediately close and reopen the app (or press F5 to refresh if in browser context)
4. Wait for app to fully load
5. Click **Record** button again to stop
6. Analyze the flame chart:
   - Look for long tasks (yellow/red bars = blocking work)
   - Note the "Main" thread activity
   - Check Network waterfall for GitHub requests

**Key Metrics to Note:**
- **First paint** — When window first shows content
- **First contentful paint (FCP)** — When meaningful content appears
- **Long tasks** — Any main thread block > 50ms
- **Network requests** — GitHub schema fetches

---

**Method B: Console Metrics (Simplest)**

Open DevTools **Console** tab and run:

```javascript
// Get startup metrics after app fully loads
window.StartupProfiler.printReport()
```

**Output will show:**
- Total startup time
- All phases with individual timings
- Schema loading metrics (decompress, parse)
- Which phase took longest

---

**Method C: VDataPerf Metrics (Schema-Specific)**

In DevTools Console:

```javascript
// Get detailed schema loading metrics
window.VDataPerf.getMetrics()
// Look for:
// - lastSchemaLoad: {game, source, msTotal}
// - lastSteps: {gunzipDecompressMs, gunzipParseMs}
```

Output example:
```
{
  lastSchemaLoad: {game: "cs2", source: "network-gzip", msTotal: 1243.5},
  lastSteps: {
    gunzipDecompressMs: 287.3,
    gunzipParseMs: 156.8
  },
  measures: [...]
}
```

---

## Advanced Measurement (15 minutes)

### Test 1: Measure Cold Start (No Cache)

**Scenario:** App hasn't been run before or cache is cleared.

```bash
# Clear all cached data
# Windows:
del %APPDATA%\VDataEditor\*

# macOS:
rm -rf ~/Library/Application\ Support/VDataEditor/*

# Linux:
rm -rf ~/.config/VDataEditor/*

# Launch app
npm start

# Measure startup time using one of the methods above
```

**Expected Baseline:**
- First paint: ~800ms-1.2s
- Editor ready: ~1.5-2s
- Schema loaded: ~3-5s (network dependent)

---

### Test 2: Measure Warm Start (Cached Schemas)

**Scenario:** App has been run before, schemas are in IndexedDB cache.

```bash
# Run app normally (cache preserved)
npm start

# Measure startup time
# Should be ~2-3s faster than cold start
```

**Expected Improvement:**
- First paint: Same (~800ms-1.2s)
- Editor ready: ~1.5-2s
- **Schema ready: ~500ms (cached, no network!)**

---

### Test 3: Test Offline Scenario

**Scenario:** Network unavailable but schemas cached.

**Using DevTools:**
1. Open DevTools (Ctrl+Shift+I)
2. Go to **Network** tab
3. Check **Offline** checkbox
4. Refresh app or restart
5. App should still start using cached schemas

**Measure:** Time to editor ready (should be fast, no network delay)

---

### Test 4: Slow Network Simulation

**Scenario:** Measure impact on slow 3G network (typical for mobile users).

**Using DevTools:**
1. Open **Network** tab
2. Click throttling dropdown (default: "No throttling")
3. Select **Slow 3G**
4. Hard-refresh app (Ctrl+Shift+R)
5. Measure startup time

**Expected Impact:**
- Cold start with Slow 3G: +5-10s
- This highlights the importance of caching optimizations

---

## Detailed Performance Analysis

### Understanding the DevTools Flame Chart

**What to Look For:**

1. **Yellow/Orange Bars** = JavaScript execution (parsing/compiling/execution)
   - Normal for script loading
   - Watch for long continuous blocks (> 100ms)

2. **Purple Bars** = Layout/Rendering
   - Property tree DOM construction will show here
   - Watch for layout thrashing

3. **Green Bars** = Painting
   - UI drawing

4. **Gray Bars** = Idle time
   - CPU available, not doing work
   - Network wait time appears here

### Identifying Bottlenecks

**Look for:**
- ❌ **Long tasks** (>50ms yellow bar) — indicates blocking work
- ❌ **Repetitive layout** — suggests DOM thrashing
- ❌ **Network waterfall** — shows GitHub fetch delays
- ✅ **Gaps in main thread** — CPU available for work

### Example Interpretation

```
Timeline (zoomed to 1-3 seconds):

1000ms ├─ [Yellow: Script parsing] ← vendor/cm.js bundle
1200ms │  [Gray: Network] ← Fetching from GitHub
2000ms │  [Yellow: JSON parse + indexing] ← Schema processing
2500ms │  [Purple: Layout] ← Property tree DOM
3000ms └─ [Green: Paint] ← First visible content

Insights:
- GitHub fetch (1200-2000ms) is the longest operation
- Schema parsing adds another 500ms
- Property tree DOM adds 500ms more
- Total: ~2s from app launch to visible UI
```

---

## Recording Metrics for Comparison

### Create a Baseline

**Before Making Changes:**

1. Run startup measurement test 5 times
2. Record each result:
   ```
   Test 1 (cold): 2850ms
   Test 2 (cold): 2920ms
   Test 3 (cold): 2890ms
   Test 4 (warm): 1250ms
   Test 5 (warm): 1290ms
   ```

3. Calculate averages:
   - Cold start average: 2887ms
   - Warm start average: 1270ms

### After Each Optimization

Repeat measurements and compare:
```
Before optimization:  2887ms (cold), 1270ms (warm)
After optimization A: 2450ms (cold), 1150ms (warm)
Improvement: +15% (cold), +9% (warm)
```

---

## Tips for Accurate Measurement

### ✅ DO:
- Run tests multiple times and average results
- Use the same machine each time
- Keep background processes consistent
- Clear cache between cold-start tests
- Test with realistic network conditions
- Take screenshots of DevTools timeline

### ❌ DON'T:
- Measure once and assume it's representative
- Mix cold and warm start results
- Trust single measurements (variance is high)
- Ignore network conditions (GitHub fetch is huge variable)
- Forget to clear cache for cold-start testing

---

## Reporting Results

### Template for Performance Improvement PR

```markdown
## Performance Improvement: [Optimization Name]

### Baseline Metrics (Before)
- Cold start: 2850ms ± 50ms (avg of 5 runs)
- Warm start: 1250ms ± 30ms (avg of 5 runs)
- Schema load: 2100ms ± 200ms (network dependent)
- Bottleneck: GitHub fetch + gzip decompression

### After Optimization
- Cold start: 2450ms ± 40ms (avg of 5 runs)
- Warm start: 1150ms ± 25ms (avg of 5 runs)
- Schema load: 1100ms ± 150ms
- Improvement: -14% (cold), -8% (warm)

### Changes Made
1. [Describe optimization 1]
2. [Describe optimization 2]
3. [Describe optimization 3]

### Testing
- [x] Tested on clean install
- [x] Tested with cached schemas
- [x] Tested offline (cached schemas)
- [x] Tested on Slow 3G network
- [x] DevTools flame chart reviewed
```

---

## Troubleshooting Measurement Issues

### App crashes during startup profiling
- Close DevTools, let app fully load, then open DevTools
- The act of recording can slow things down
- Alternative: Use `window.StartupProfiler.printReport()` after app loads

### Schema metrics not showing
- Ensure `src/performance-monitor.js` is loaded
- Check console for errors
- Schema loading is async; wait for progress bar to finish

### Network tab shows no GitHub requests
- Check if schemas are already cached
- Clear IndexedDB cache: Settings > Storage > IndexedDB > Delete
- Ensure online mode is enabled

### DevTools says "Recording aborted" or recording lost
- App may have crashed or closed during recording
- Try again with shorter recording duration
- Restart app and record again

---

## Next Steps

After collecting baseline metrics:

1. **Identify the bottleneck** — Which phase takes the longest?
2. **Refer to STARTUP_PERFORMANCE_REPORT.md** — What optimizations apply?
3. **Implement optimizations** — Start with highest-impact changes
4. **Re-measure** — Compare before/after metrics
5. **Document results** — Share findings with team

---

## References

- **Chrome DevTools Performance:** https://developer.chrome.com/docs/devtools/performance/
- **Web Vitals:** https://web.dev/vitals/
- **VDataEditor Performance Monitor:** `src/performance-monitor.js`
- **Startup Profiler:** `src/startup-profiler.js`
- **Performance Report:** `STARTUP_PERFORMANCE_REPORT.md`
