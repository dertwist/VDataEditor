# JavaScript performance guide

Practical techniques and libraries for making **vanilla JS + Electron** apps feel instant. Written for contributors to **VDataEditor**; many items apply to any desktop web UI.

**See also:** [`src/performance-monitor.js`](../src/performance-monitor.js) (`window.VDataPerf`), debounced manual-editor sync in [`src/manual-editor.js`](../src/manual-editor.js), and large-file open handling in [`src/document-manager.js`](../src/document-manager.js).

---

## 1. DOM performance

### Batch DOM reads and writes

The browser recalculates layout when you read geometry (`offsetHeight`, `getBoundingClientRect()`) after a write. Interleaving reads and writes causes **layout thrashing**.

```js
// Bad — forces layout recalculation on every iteration
items.forEach((el) => {
  const h = el.offsetHeight; // read
  el.style.height = h + 10 + 'px'; // write → next read may force reflow
});

// Good — batch all reads, then all writes
const heights = items.map((el) => el.offsetHeight);
items.forEach((el, i) => {
  el.style.height = heights[i] + 10 + 'px';
});
```

**Library: [fastdom](https://github.com/wilsonpage/fastdom)** — queues DOM reads and writes into separate frames (original repo by nickstenning moved; `wilsonpage/fastdom` is the maintained line).

```js
fastdom.measure(() => {
  const h = element.offsetHeight;
  fastdom.mutate(() => {
    element.style.height = h + 10 + 'px';
  });
});
```

### Use `requestAnimationFrame` for visual updates

Group visual changes into the next frame. Avoid updating the DOM from a tight loop or directly from every scroll/resize event.

```js
let ticking = false;
window.addEventListener('scroll', () => {
  if (!ticking) {
    requestAnimationFrame(() => {
      updateVisuals();
      ticking = false;
    });
    ticking = true;
  }
});
```

### Prefer `textContent` over `innerHTML`

`textContent` is faster and skips HTML parsing. Use `innerHTML` only when you need markup.

### Use `DocumentFragment` for bulk inserts

```js
const frag = document.createDocumentFragment();
for (let i = 0; i < 1000; i++) {
  const li = document.createElement('li');
  li.textContent = items[i];
  frag.appendChild(li);
}
list.appendChild(frag); // single attach
```

### Use CSS `contain`

Tell the browser a subtree is independent so it can limit layout/paint work.

```css
.panel {
  contain: layout style paint;
}
```

---

## 2. Virtual scrolling

For hundreds or thousands of rows, only render what is in the viewport.

### Libraries

| Library | Notes | Link |
|--------|--------|------|
| **Clusterize.js** | Small, zero-deps, plain DOM lists/tables | [NeXTs/Clusterize.js](https://github.com/NeXTs/Clusterize.js) |
| **HyperList** | Very small virtual list | [tbranyen/hyperlist](https://github.com/tbranyen/hyperlist) |

### DIY (no library)

```js
function renderVisibleItems(container, allItems, rowHeight) {
  const scrollTop = container.scrollTop;
  const viewHeight = container.clientHeight;
  const startIdx = Math.floor(scrollTop / rowHeight);
  const endIdx = Math.min(startIdx + Math.ceil(viewHeight / rowHeight) + 1, allItems.length);

  container.style.paddingTop = startIdx * rowHeight + 'px';
  container.style.paddingBottom = (allItems.length - endIdx) * rowHeight + 'px';

  const frag = document.createDocumentFragment();
  for (let i = startIdx; i < endIdx; i++) {
    frag.appendChild(createRow(allItems[i]));
  }
  container.replaceChildren(frag);
}
```

**VDataEditor context:** The property tree builds real DOM per row; very large objects benefit from lazy expansion and from deferring work (see property tree in `src/prop-tree.js`). Virtualizing the tree is a larger future improvement.

---

## 3. Debounce and throttle

Limit how often expensive handlers run (input, scroll, resize).

```js
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function throttle(fn, interval) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= interval) {
      last = now;
      fn(...args);
    }
  };
}
```

Typical choices: debounce search inputs (~150–300 ms); throttle scroll/resize (~16 ms for 60 fps).

---

## 4. Web workers and off–main-thread work

Heavy work (parsing multi‑MB KV3, indexing) should not block the UI thread.

**Library: [Comlink](https://github.com/GoogleChromeLabs/comlink)** — wraps `postMessage` in async function calls.

```js
// worker.js
import { expose } from 'comlink';

const api = {
  parseHeavyText(text) {
    /* … */
    return result;
  }
};
expose(api);

// main.js
import { wrap } from 'comlink';

const worker = wrap(new Worker(new URL('worker.js', import.meta.url), { type: 'module' }));
const result = await worker.parseHeavyText(largeText);
```

Use workers when work often exceeds **~16 ms** (one frame).

---

## 5. Electron-specific tips

### Minimize IPC round-trips

Each `ipcRenderer.invoke` / `ipcMain.handle` has cost. Prefer one call with a batch payload.

```js
// Bad — N round-trips
for (const file of files) {
  await window.api.readFile(file);
}

// Good — single round-trip (add a handler that accepts an array)
const contents = await window.api.readFiles(files);
```

### Faster window startup

```js
const win = new BrowserWindow({
  show: false,
  backgroundColor: '#1e1e1e',
  webPreferences: {
    /* … */
  }
});

win.once('ready-to-show', () => win.show());
```

Use `backgroundThrottling` deliberately; disabling it keeps background work hot but uses more battery.

### Lazy-load heavy modules

```js
async function loadSchemaDB(game) {
  const { SchemaDB } = await import('./schema-db.js');
  return new SchemaDB(game);
}
```

### `requestIdleCallback` for non-critical work

```js
requestIdleCallback(
  () => {
    /* warm caches, secondary indexes … */
  },
  { timeout: 2000 }
);
```

---

## 6. Efficient DOM updates (diffing)

When data changes often, replacing `innerHTML` on a large tree discards nodes and loses focus.

**[morphdom](https://github.com/patrick-steele-idem/morphdom)** — diff and patch an existing tree.

```js
import morphdom from 'morphdom';

morphdom(container, newNodeOrMarkup); // updates only what changed
```

**[nanomorph](https://github.com/choojs/nanomorph)** — smaller alternative, same idea.

---

## 7. Data handling

### Immutable updates with [Immer](https://github.com/immerjs/immer)

Nice for undo/redo and change detection without manual cloning.

```js
import { produce } from 'immer';

const nextState = produce(currentState, (draft) => {
  draft.nodes[5].value = 'updated';
});
```

### `Map` / `Set` for large collections

Frequent add/delete/lookup can be cheaper than plain objects for some workloads.

### `structuredClone` for deep copies

Supported in Chromium/Electron; often better than `JSON.parse(JSON.stringify(x))` for rich objects (Dates, etc.). VDataEditor also uses this path in `src/parse-utils.js` when available.

---

## 8. CSS performance

### Avoid expensive selectors on huge trees

```css
/* Often slower — very broad */
.tree-view * {
}

/* Prefer specific classes */
.tree-node {
}
```

### `will-change` sparingly

Only on elements that will animate; it promotes layers and uses memory.

### Animate `transform` and `opacity`

They usually stay on the compositor; animating `width`/`top`/etc. triggers layout.

---

## 9. Build and bundle

### esbuild (used for CodeMirror in this repo)

From `README.md`: `src/cm-bundle.js` is bundled to `vendor/cm.js` with `npm run build:cm`. For production bundles:

- Enable **minify** and **tree-shaking** where applicable.
- Set **target** to match Electron’s Chromium version.
- Use **splitting** for optional heavy chunks.

---

## 10. Profiling and measurement

### `VDataPerf` in VDataEditor

[`src/performance-monitor.js`](../src/performance-monitor.js) exposes `window.VDataPerf`:

```js
VDataPerf.mark('parse-start');
// … work …
VDataPerf.mark('parse-end');
VDataPerf.measure('parse', 'parse-start', 'parse-end');
console.log(VDataPerf.getMetrics());
```

### Chrome DevTools (Electron)

**Ctrl+Shift+I** — Performance, Memory, and console; record while reproducing sluggish interactions.

### `console.time` / `console.timeEnd`

Quick timings around suspect blocks.

---

## Library summary (small footprint)

| Library | Purpose | Link |
|---------|---------|------|
| fastdom | Batch DOM measure/mutate | [wilsonpage/fastdom](https://github.com/wilsonpage/fastdom) |
| morphdom | DOM diffing | [patrick-steele-idem/morphdom](https://github.com/patrick-steele-idem/morphdom) |
| nanomorph | Smaller diffing | [choojs/nanomorph](https://github.com/choojs/nanomorph) |
| Clusterize.js | Virtual scroll | [NeXTs/Clusterize.js](https://github.com/NeXTs/Clusterize.js) |
| Comlink | Worker RPC | [GoogleChromeLabs/comlink](https://github.com/GoogleChromeLabs/comlink) |
| Immer | Immutable updates | [immerjs/immer](https://github.com/immerjs/immer) |

Sizes vary with bundling; all can work with vanilla JS and Electron.

---

## Quick checklist

- [ ] Large lists/trees: virtual scroll or aggressive lazy rendering?
- [ ] Scroll/resize/input: debounced or throttled?
- [ ] Heavy parse/CPU: Web Worker or chunked yields?
- [ ] DOM: reads/writes batched (no layout thrashing)?
- [ ] IPC: batched where possible?
- [ ] Startup: `show: false` + `ready-to-show` where it helps?
- [ ] Heavy code: dynamic `import()`?
- [ ] Animations: `transform` / `opacity` preferred?
- [ ] Regression hunting: Performance panel + `VDataPerf` / `console.time`?
