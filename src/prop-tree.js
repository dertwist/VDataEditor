function propEx() {
  const d = docManager.activeDoc;
  return d ? d.expandedPaths : new Set();
}
function propCol() {
  const d = docManager.activeDoc;
  return d ? d.collapsedPaths : new Set();
}

/** Full DOM rebuild on next `buildPropertyTree` (structural edits, manual apply, tab doc switch). */
let _propTreeStructuralDirty = true;
let _propTreeBuiltForDoc = null;
// Used to defer heavy DOM rebuilds so cursor updates can paint before work blocks.
let _propTreeRebuildPending = false;
let _propTreeRebuildGeneration = 0;

/** Internal clipboard for context-menu paste (row Copy). */
let _clipboard = null;

const PROP_SUGGESTION_MIME = 'application/x-vdata-property-suggestion';

/** @type {Set<string>} */
let _propTreeSelection = new Set();
/** Last plain-click path (for Shift+click range). */
let _propTreeSelectionAnchorPath = '';

function markPropTreeStructureDirty() {
  _propTreeStructuralDirty = true;
}
window.markPropTreeStructureDirty = markPropTreeStructureDirty;

/** @type {Map<string, HTMLElement>} */
const _propRowRegistry = new Map();
/** @type {WeakMap<HTMLElement, object>} */
const _propRowDependencyDef = new WeakMap();

// Cache for auto-harvested enum options (Pattern E and C).
// Cleared automatically when the document's `structVersion` changes.
let _enumHarvestCache = new Map(); // effectiveEnumKey -> string[]
let _enumHarvestCacheVersion = null;

function clearPropRowRegistry() {
  _propRowRegistry.clear();
}

/** Full root deep-snapshot undo step for complex in-place mutations (drag move, reorder, schema add, etc.). */
function withDocUndoRootPair(applyFn, label) {
  const d = docManager.activeDoc;
  if (!d || typeof VDataCommands === 'undefined') return;
  const prevRoot = deepClone(d.root);
  const prevFormat = d.format;
  const prevEx = [...d.expandedPaths];
  const prevCol = [...d.collapsedPaths];
  applyFn();
  const nextRoot = deepClone(d.root);
  const nextFormat = d.format;
  const nextEx = [...d.expandedPaths];
  const nextCol = [...d.collapsedPaths];
  withDocUndo(
    {
      type: VDataCommands.CMD.ROOT_STATE_PAIR,
      rootBefore: prevRoot,
      rootAfter: nextRoot,
      formatBefore: prevFormat,
      formatAfter: nextFormat,
      expandedBefore: prevEx,
      expandedAfter: nextEx,
      collapsedBefore: prevCol,
      collapsedAfter: nextCol
    },
    label
  );
}

function cloneUndoValue(v) {
  if (v === null || typeof v !== 'object') return v;
  try {
    if (typeof structuredClone === 'function') return structuredClone(v);
  } catch (_) {}
  return JSON.parse(JSON.stringify(v));
}

/**
 * Cheap-ish deep check used to decide whether DOC_REPLACE can safely avoid full DOM rebuild.
 * We compare "shape" (arrays/objects/keys) and scalar kinds (typeof/null), but ignore scalar values.
 */
function rootsHaveSameStructure(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;

  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;
  if (aIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!rootsHaveSameStructure(a[i], b[i])) return false;
    return true;
  }

  const aIsObj = typeof a === 'object';
  const bIsObj = typeof b === 'object';
  if (aIsObj !== bIsObj) return false;
  if (!aIsObj) {
    // scalar kinds (string/number/boolean) must match
    return typeof a === typeof b;
  }

  // objects: keys set and nested kinds
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const k = aKeys[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!rootsHaveSameStructure(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Update one property row's inputs from a model value (skips focused controls).
 * @returns {boolean} true if row found and basic widgets updated
 */
function updatePropRowValueFromModel(row, value) {
  if (!row) return false;
  const skipFocused = !(
    typeof window !== 'undefined' &&
    window.__vde_forcePropTreeSyncFocusedInputs === true
  );
  const vecWidget = row.querySelector('.vec-widget');
  if (vecWidget && Array.isArray(value)) {
    const axisRows = row.querySelectorAll('.vec-axis-row');
    axisRows.forEach((axisRow, i) => {
      const axisVal = Number(value[i]);
      if (!Number.isFinite(axisVal)) return;
      const numInput = axisRow.querySelector('.slider-input');
      const slider = axisRow.querySelector('.slider-range');
      const wrap = axisRow.querySelector('.slider-input-wrap');
      const newStr = parseFloat(axisVal.toFixed(6)).toString();

      // Prefer updating slider closure state via hook (undo/redo safe),
      // but skip focused controls unless we are forced.
      const isNumFocused = !!numInput && numInput === document.activeElement;
      const isSliderFocused = !!slider && slider === document.activeElement;
      const canUpdateFocusedState = !skipFocused || (!isNumFocused && !isSliderFocused);
      if (wrap && typeof wrap.__vdeSetValueFromModel === 'function' && canUpdateFocusedState) {
        wrap.__vdeSetValueFromModel(axisVal);
        return;
      }

      if (
        numInput &&
        (!skipFocused || numInput !== document.activeElement) &&
        numInput.value !== newStr
      ) {
        numInput.value = newStr;
      }
      if (slider && (!skipFocused || slider !== document.activeElement)) {
        const min = Number(slider.min);
        const max = Number(slider.max);
        if (Number.isFinite(min) && Number.isFinite(max) && axisVal >= min && axisVal <= max) {
          const sliderStr = String(axisVal);
          if (slider.value !== sliderStr) slider.value = sliderStr;
        }
      }
    });
  } else {
    // Color widget has multiple controls (swatch + hidden picker + RGB(A) inputs).
    // Undo/redo should refresh all of them, not just the first `.prop-input`.
    const swatch = row.querySelector('.prop-color-swatch');
    if (swatch && Array.isArray(value)) {
      const arr = Array.isArray(value) ? value : [0, 0, 0];
      const toHex = (a) =>
        '#' +
        a
          .slice(0, 3)
          .map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0'))
          .join('');

      const picker = row.querySelector('.prop-color-input');
      const hex = toHex(arr);
      if (!skipFocused || swatch !== document.activeElement) {
        swatch.style.background = hex;
      }
      if (picker && (!skipFocused || picker !== document.activeElement)) {
        picker.value = hex;
      }

      const numInputs = row.querySelectorAll('.prop-input');
      numInputs.forEach((inp, i) => {
        if (i >= arr.length) return;
        if (skipFocused && inp === document.activeElement) return;
        const next = String(arr[i] ?? 0);
        if (inp.value !== next) inp.value = next;
      });
      return true;
    }

    const inp = row.querySelector('.prop-input:not([readonly])');
    if (inp && (!skipFocused || inp !== document.activeElement)) {
      const newStr = value == null ? '' : String(value);
      if (inp.value !== newStr) inp.value = newStr;
    }
  }
  const cb = row.querySelector('.prop-input-bool');
  if (cb && (!skipFocused || cb !== document.activeElement)) {
    if (cb.checked !== !!value) cb.checked = !!value;
  }
  return true;
}

function applyDependencyStateToPropRow(row, depDef, parentObj, schemaCtx) {
  if (!row || !depDef || typeof window.VDataDependencyEngine === 'undefined') return;
  const engine = window.VDataDependencyEngine;
  if (!engine || typeof engine.evaluateDependency !== 'function') return;

  const res = engine.evaluateDependency(depDef, parentObj, schemaCtx);
  const visible = !!res.visible;
  const enabled = !!res.enabled;

  // Visibility: hide the row itself and its immediate children container (if any).
  row.style.display = visible ? '' : 'none';

  const childWrap = row.nextElementSibling;
  if (childWrap && childWrap.classList && childWrap.classList.contains('prop-row-children')) {
    if (!visible) {
      row.dataset.depChildrenPrevDisplay = childWrap.style.display;
      childWrap.style.display = 'none';
    } else if (row.dataset.depChildrenPrevDisplay != null) {
      childWrap.style.display = row.dataset.depChildrenPrevDisplay || '';
      delete row.dataset.depChildrenPrevDisplay;
    }
  }

  // Enablement: disable interactive form controls.
  const disable = !enabled;
  row.querySelectorAll('input,select,textarea,button').forEach((el) => {
    if ('disabled' in el) el.disabled = disable;
  });
}

/**
 * Apply a typed command to the property tree DOM where possible.
 * @param {object} cmd — see VDataCommands
 */
function patchPropertyTree(cmd) {
  const VC = typeof VDataCommands !== 'undefined' ? VDataCommands : null;
  if (!cmd || !VC) return;

  if (cmd.type === VC.CMD.BATCH) {
    for (let i = 0; i < cmd.commands.length; i++) patchPropertyTree(cmd.commands[i]);
    return;
  }

  if (cmd.type === VC.CMD.SET_VALUE) {
    if (cmd.relayout) {
      markPropTreeStructureDirty();
      buildPropertyTree();
      return;
    }
    const row = _propRowRegistry.get(cmd.pathStr);
    if (!row) {
      markPropTreeStructureDirty();
      buildPropertyTree();
      return;
    }
    updatePropRowValueFromModel(row, cmd.nextValue);

    // Targeted dependency invalidation:
    // If a sibling key changes, only re-evaluate rows that declared dependency
    // references to that key.
    const changedKey = objectKeyFromPropPath(cmd.pathStr);
    if (changedKey) {
      const schemaCtx = schemaCtxForPropertyTree();
      for (const r of _propRowRegistry.values()) {
        const depKeys = r?.dataset?.depKeys;
        if (!depKeys || depKeys.indexOf(',' + changedKey + ',') < 0) continue;

        const depDef = _propRowDependencyDef.get(r);
        if (!depDef) continue;

        const p = r.dataset.propPath;
        const parentPathOnly = parentPathFromRowPath(p);
        const doc = docManager.activeDoc;
        const parentObj = parentPathOnly ? getValueAtPath(doc.root, parentPathOnly) : doc.root;
        applyDependencyStateToPropRow(r, depDef, parentObj, schemaCtx);
      }
    }
    stripePropTree();
    syncPropTreeSelectionClasses();
    return;
  }

  if (cmd.type === VC.CMD.EXPAND_STATE) {
    markPropTreeStructureDirty();
    buildPropertyTree();
    return;
  }

  if (cmd.type === VC.CMD.DOC_REPLACE) {
    const container = document.getElementById('propTreeRoot');
    const hasRows = !!container?.querySelector?.('.prop-row');
    if (hasRows && rootsHaveSameStructure(cmd.rootBefore, cmd.rootAfter)) {
      // Value-only / shape-compatible replace: update widget inputs in-place.
      updatePropRowValues(container);

      // Re-evaluate dependency-driven visibility/enabled state.
      try {
        const schemaCtx = schemaCtxForPropertyTree();
        const doc = docManager.activeDoc;
        for (const r of _propRowRegistry.values()) {
          const depDef = _propRowDependencyDef.get(r);
          if (!depDef) continue;
          const p = r.dataset.propPath;
          const parentPathOnly = parentPathFromRowPath(p);
          const parentObj = parentPathOnly ? getValueAtPath(doc.root, parentPathOnly) : doc.root;
          applyDependencyStateToPropRow(r, depDef, parentObj, schemaCtx);
        }
      } catch (_) {
        // If dependency evaluation fails, fall back to full rebuild.
        markPropTreeStructureDirty();
        buildPropertyTree();
        return;
      }

      const q = document.getElementById('propTreeSearch')?.value?.trim().toLowerCase() ?? '';
      if (q) filterPropTree(q);
      stripePropTree();
      syncPropTreeSelectionClasses();
      return;
    }
  }

  if (VC.commandIsStructural(cmd) || cmd.type === VC.CMD.DOC_REPLACE || cmd.type === VC.CMD.SET_FORMAT) {
    markPropTreeStructureDirty();
    buildPropertyTree();
    return;
  }
}

window.patchPropertyTree = patchPropertyTree;

// ── Property Tree ───────────────────────────────────────────────────────
// Expansion state lives on the active VDataDocument (propEx / propCol helpers above).

function escapePropPathRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Path to the array value for a row that represents an array element (strip trailing `/[i]`). */
function arrayContainerPathFromRowPath(rowPath) {
  return rowPath.replace(/\/\[\d+\]$/, '');
}

/**
 * Parent path of a row path.
 * e.g. "root/child/key" → "root/child"; "topLevelKey" → ""
 */
function parentPathFromRowPath(p) {
  if (!p) return '';
  const idx = p.lastIndexOf('/');
  return idx < 0 ? '' : p.slice(0, idx);
}

/** Last path segment as object key, or null for array index rows (`/[n]` ). */
function objectKeyFromPropPath(pathStr) {
  if (!pathStr) return null;
  const parentPath = parentPathFromRowPath(pathStr);
  const last = parentPath ? pathStr.slice(parentPath.length + 1) : pathStr;
  if (/^\[\d+\]$/.test(last)) return null;
  return last;
}

/** Move `movedKey` next to `refKey` in insertion order (object parent only). */
function insertObjectKeyBesideReference(parentRef, movedKey, refKey, placeAfter) {
  if (!parentRef || Array.isArray(parentRef) || typeof movedKey !== 'string' || typeof refKey !== 'string') return;
  if (movedKey === refKey) return;
  if (!Object.prototype.hasOwnProperty.call(parentRef, movedKey)) return;
  if (!Object.prototype.hasOwnProperty.call(parentRef, refKey)) return;
  const entries = Object.entries(parentRef);
  const picked = entries.find(([k]) => k === movedKey);
  if (!picked) return;
  const without = entries.filter(([k]) => k !== movedKey);
  const dstIdx = without.findIndex(([k]) => k === refKey);
  if (dstIdx < 0) return;
  const insertAt = dstIdx + (placeAfter ? 1 : 0);
  const newEntries = [...without.slice(0, insertAt), picked, ...without.slice(insertAt)];
  for (const k of Object.keys(parentRef)) delete parentRef[k];
  for (const [k, v] of newEntries) parentRef[k] = v;
}

/** Reorder several object keys as a block before/after `refKey` in `parentRef`. */
function reorderObjectKeysBlock(parentRef, movingKeys, refKey, placeAfter) {
  if (!parentRef || Array.isArray(parentRef) || typeof refKey !== 'string' || !movingKeys.length) return false;
  const movingSet = new Set(movingKeys);
  if (movingSet.has(refKey)) return false;
  const entries = Object.entries(parentRef);
  if (!entries.some(([k]) => k === refKey)) return false;
  const picked = entries.filter(([k]) => movingSet.has(k));
  if (picked.length !== movingKeys.length) return false;
  const rest = entries.filter(([k]) => !movingSet.has(k));
  const dstIdx = rest.findIndex(([k]) => k === refKey);
  if (dstIdx < 0) return false;
  const insertBase = dstIdx + (placeAfter ? 1 : 0);
  const newEntries = [...rest.slice(0, insertBase), ...picked, ...rest.slice(insertBase)];
  for (const k of Object.keys(parentRef)) delete parentRef[k];
  for (const [k, v] of newEntries) parentRef[k] = v;
  return true;
}

function rowDragItemFromPath(p, parentPathForKeys) {
  const parentPath = parentPathForKeys != null ? parentPathForKeys : parentPathFromRowPath(p);
  const last = parentPath ? p.slice(parentPath.length + 1) : p;
  const am = /^\[(\d+)\]$/.exec(last);
  if (am) return { key: null, arrayIdx: parseInt(am[1], 10), propPath: p };
  return { key: last, arrayIdx: null, propPath: p };
}

function collectSelectedRowDragItems(propPath, key, arrayIdx) {
  const primary = { key, arrayIdx: typeof arrayIdx === 'number' ? arrayIdx : null, propPath };
  if (typeof arrayIdx === 'number') return [primary];
  if (!_propTreeSelection.has(propPath) || _propTreeSelection.size < 2) return [primary];
  const primaryParent = parentPathFromRowPath(propPath);
  const ordered = getVisiblePropRowPathsOrdered();
  const orderIndex = (path) => ordered.indexOf(path);
  const selectedSameParent = [..._propTreeSelection].filter((p) => parentPathFromRowPath(p) === primaryParent);
  if (selectedSameParent.length < 2) return [primary];
  selectedSameParent.sort((a, b) => orderIndex(a) - orderIndex(b));
  return selectedSameParent.map((p) => rowDragItemFromPath(p, primaryParent));
}

/** After splice, indices under this array change — drop expansion state for those rows (and descendants). */
function invalidatePropTreePathsForArrayContainer(arrayPath) {
  const re = new RegExp('^' + escapePropPathRe(arrayPath) + '/\\[\\d+\\](?:/|$)');
  for (const p of [...propEx()]) if (re.test(p)) propEx().delete(p);
  for (const p of [...propCol()]) if (re.test(p)) propCol().delete(p);
}

function invalidatePropTreePathsUnderObjectKey(keyPath) {
  const re = new RegExp('^' + escapePropPathRe(keyPath) + '(?:/|$)');
  for (const p of [...propEx()]) if (re.test(p)) propEx().delete(p);
  for (const p of [...propCol()]) if (re.test(p)) propCol().delete(p);
}

function snapshotAfterArrayContainerInvalidate(arrayPath, exSet, colSet) {
  const re = new RegExp('^' + escapePropPathRe(arrayPath) + '/\\[\\d+\\](?:/|$)');
  const exCopy = new Set(exSet);
  const colCopy = new Set(colSet);
  for (const p of [...exCopy]) if (re.test(p)) exCopy.delete(p);
  for (const p of [...colCopy]) if (re.test(p)) colCopy.delete(p);
  return { expandedAfter: [...exCopy], collapsedAfter: [...colCopy] };
}

function snapshotAfterObjectKeyInvalidate(keyPath, exSet, colSet) {
  const re = new RegExp('^' + escapePropPathRe(keyPath) + '(?:/|$)');
  const exCopy = new Set(exSet);
  const colCopy = new Set(colSet);
  for (const p of [...exCopy]) if (re.test(p)) exCopy.delete(p);
  for (const p of [...colCopy]) if (re.test(p)) colCopy.delete(p);
  return { expandedAfter: [...exCopy], collapsedAfter: [...colCopy] };
}

function makeDeleteRowBatch(d, propPath, isArrayIndex) {
  const VC = VDataCommands;
  const CMD = VC.CMD;
  const exBefore = [...d.expandedPaths];
  const colBefore = [...d.collapsedPaths];
  const snap = isArrayIndex
    ? snapshotAfterArrayContainerInvalidate(arrayContainerPathFromRowPath(propPath), d.expandedPaths, d.collapsedPaths)
    : snapshotAfterObjectKeyInvalidate(propPath, d.expandedPaths, d.collapsedPaths);
  return {
    type: CMD.BATCH,
    commands: [
      {
        type: CMD.EXPAND_STATE,
        expandedBefore: exBefore,
        collapsedBefore: colBefore,
        expandedAfter: snap.expandedAfter,
        collapsedAfter: snap.collapsedAfter
      },
      { type: CMD.REMOVE_NODE, pathStr: propPath }
    ]
  };
}

function makeDuplicateArrayBatch(d, arrayContainerPath, arrayIdx, cloneValue) {
  const VC = VDataCommands;
  const CMD = VC.CMD;
  const exBefore = [...d.expandedPaths];
  const colBefore = [...d.collapsedPaths];
  const snap = snapshotAfterArrayContainerInvalidate(arrayContainerPath, d.expandedPaths, d.collapsedPaths);
  const insertPath = `${arrayContainerPath}/[${arrayIdx + 1}]`;
  return {
    type: CMD.BATCH,
    commands: [
      {
        type: CMD.EXPAND_STATE,
        expandedBefore: exBefore,
        collapsedBefore: colBefore,
        expandedAfter: snap.expandedAfter,
        collapsedAfter: snap.collapsedAfter
      },
      { type: CMD.ADD_NODE, pathStr: insertPath, value: cloneValue }
    ]
  };
}

function makeRemoveArrayDupesBatch(d, arrayPropPath, prevArr, nextArr) {
  const CMD = VDataCommands.CMD;
  const exBefore = [...d.expandedPaths];
  const colBefore = [...d.collapsedPaths];
  const snap = snapshotAfterArrayContainerInvalidate(arrayPropPath, d.expandedPaths, d.collapsedPaths);
  return {
    type: CMD.BATCH,
    commands: [
      {
        type: CMD.EXPAND_STATE,
        expandedBefore: exBefore,
        collapsedBefore: colBefore,
        expandedAfter: snap.expandedAfter,
        collapsedAfter: snap.collapsedAfter
      },
      {
        type: CMD.SET_VALUE,
        pathStr: arrayPropPath,
        prevValue: cloneUndoValue(prevArr),
        nextValue: nextArr,
        relayout: true
      }
    ]
  };
}

function clearPropTreeViewState() {
  propEx().clear();
  propCol().clear();
}

const COLOUR_KEYS = new Set([
  'm_Color',
  'm_Background',
  'm_Grid',
  'm_vColorFade',
  'm_colorFade'
]);

function isColorArray(key, arr) {
  if (!Array.isArray(arr)) return false;
  if (arr.length !== 3 && arr.length !== 4) return false;
  if (!arr.every((v) => typeof v === 'number' && v >= 0 && v <= 255)) return false;
  return COLOUR_KEYS.has(key) || /[Cc]olor/.test(key) || /[Cc]olour/.test(key);
}

function isVec3Array(key, arr) {
  if (!Array.isArray(arr)) return false;
  if (arr.length !== 3) return false;
  if (!arr.every((v) => typeof v === 'number')) return false;
  return /[Dd]ir|[Pp]os|[Vv]ec|[Oo]ffset|[Ss]cale/.test(key);
}

function isVec2Array(key, arr) {
  if (!Array.isArray(arr) || arr.length !== 2) return false;
  if (!arr.every((v) => typeof v === 'number')) return false;
  return /[Uu][Vv]$|[Uu][Vv][0-9]$|[Ss]ize2[Dd]$|[Tt]exel/.test(key);
}

function isVec4Array(key, arr) {
  if (!Array.isArray(arr) || arr.length !== 4) return false;
  if (!arr.every((v) => typeof v === 'number')) return false;
  return /[Qq]uat$|[Rr]otation$|[Pp]lane$|[Vv]ec4/.test(key);
}

function inferType(key, value) {
  if (window.KV3Format?.isKV3LineCommentNode && window.KV3Format.isKV3LineCommentNode(value)) {
    const parsed = parseArrayCommentNode(value);
    return parsed.kind === 'commented_value' ? 'commented_value' : 'comment_label';
  }
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') {
    if (value.startsWith('resource_name:')) return 'resource';
    if (value.startsWith('soundevent:')) return 'soundevent';
    if (value.startsWith('panorama:')) return 'panorama';
    return 'string';
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const keysOk = (o) => Object.keys(o).every((k) => k === 'type' || k === 'value');
    if (value.type === 'resource_name' && typeof value.value === 'string' && keysOk(value)) return 'resource';
    if (value.type === 'soundevent' && typeof value.value === 'string' && keysOk(value)) return 'soundevent';
    if (value.type === 'panorama' && typeof value.value === 'string' && keysOk(value)) return 'panorama';
  }
  if (Array.isArray(value)) {
    // Pattern A (inline numeric vectors): any 2-4 element numeric array becomes
    // vec2/vec3/vec4, and color becomes `color` when the key/value looks like RGBA.
    const shapeUtils = window?.VDataKV3ShapeUtils;
    const inferredVecWidget =
      shapeUtils && typeof shapeUtils.classifyNumericVectorArray === 'function'
        ? shapeUtils.classifyNumericVectorArray(key, value)
        : null;
    if (inferredVecWidget) return inferredVecWidget;

    // Fallback: existing key-based heuristics.
    if (isVec4Array(key, value)) return 'vec4';
    if (isVec2Array(key, value)) return 'vec2';
    if (isColorArray(key, value)) return 'color';
    if (isVec3Array(key, value)) return 'vec3';
    return 'array';
  }
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

function escapeKV3CommentString(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseArrayCommentNode(node) {
  const text = typeof node?.text === 'string' ? node.text : '';
  const m = text.match(/^\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/);
  if (!m) return { kind: 'comment_label', text };
  const unescaped = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return { kind: 'commented_value', value: unescaped, text };
}

function makeCommentedValueNode(value) {
  const t = ` "${escapeKV3CommentString(value)}",`;
  if (window.KV3Format?.createKV3LineComment) return window.KV3Format.createKV3LineComment(t);
  return { __kv3LineComment: true, text: t };
}

function paintTypeBadgeCircle(el, type, value, keyName) {
  if (!el) return;
  if (window.VsmartIconCache && typeof window.VsmartIconCache.paintKeyColumnBadge === 'function') {
    window.VsmartIconCache.paintKeyColumnBadge(el, type, value === undefined ? null : value, keyName === undefined ? '' : keyName);
    return;
  }
  el.innerHTML = '<span class="vsmart-icon-badge vsmart-icon-badge-fallback" role="presentation"><span class="vsmart-icon-badge-text">?</span></span>';
}

function getActiveMode() {
  if (window.VDataEditorModes?.resolveActiveEditorMode) {
    return window.VDataEditorModes.resolveActiveEditorMode();
  }
  return window.VDataEditorModes.getModeForFile(docManager.activeDoc?.fileName ?? 'Untitled');
}

function schemaParentKeyFromRowPath(propPath) {
  const parentOnly = parentPathFromRowPath(propPath);
  return parentOnly ? parentOnly.slice(parentOnly.lastIndexOf('/') + 1) : '';
}

function resolveRowWidgetType(key, value, parentObj, propPath) {
  const mode = getActiveMode();
  if (mode && typeof mode.resolveWidget === 'function') {
    const w = mode.resolveWidget(key, value, parentObj);
    if (w) return w;
  }

  // Pattern E/C: enum-like string values should render as dropdowns.
  // This bypasses system widget overrides (which are key-based).
  const shapeUtils = window?.VDataKV3ShapeUtils;
  if (typeof value === 'string' && shapeUtils?.isEnumLikeValue?.(value)) return 'enum';

  if (
    propPath != null &&
    typeof VDataSuggestions !== 'undefined' &&
    typeof VDataSuggestions.isSchemaEnumField === 'function' &&
    (typeof value === 'string' || typeof value === 'number' || value == null) &&
    !(value !== null && typeof value === 'object')
  ) {
    const ctx = Object.assign(schemaCtxForPropertyTree(), { parentKey: schemaParentKeyFromRowPath(propPath) });
    if (VDataSuggestions.isSchemaEnumField(key, ctx)) return 'enum';
  }
  const inferred = inferType(key, value);
  return VDataSettings.resolveWidgetType(key, inferred);
}

const TYPE_CAST_OPTIONS = {
  string: ['int', 'float', 'bool', 'resource', 'soundevent', 'panorama'],
  int: ['float', 'string', 'bool'],
  float: ['int', 'string', 'bool'],
  bool: ['int', 'string'],
  resource: ['string', 'soundevent', 'panorama'],
  soundevent: ['string', 'resource', 'panorama'],
  panorama: ['string', 'resource', 'soundevent'],
  vec2: ['vec3', 'vec4', 'array', 'string'],
  vec3: ['vec2', 'vec4', 'array', 'string'],
  vec4: ['vec2', 'vec3', 'array', 'string']
};

const STATIC_TYPE_SUMMARY = new Set(['object', 'array', 'null', 'unknown']);
const ALL_CAST_TARGETS = [
  'string',
  'int',
  'float',
  'bool',
  'resource',
  'soundevent',
  'panorama',
  'vec2',
  'vec3',
  'vec4',
  'array',
  'object'
];

/** Opens on the key-column type badge; object/array/null/unknown get the full cast list. */
function attachPropTreeTypeCastToBadge(badgeEl, currentType, onCast) {
  if (!badgeEl) return;
  let options;
  if (STATIC_TYPE_SUMMARY.has(currentType)) {
    options = ALL_CAST_TARGETS;
  } else {
    options = TYPE_CAST_OPTIONS[currentType];
    if (!options || options.length === 0) return;
  }
  badgeEl.classList.add('prop-type-badge-interactive');
  badgeEl.title = `Type: ${currentType} (click to change)`;
  badgeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.prop-type-dropdown').forEach((el) => el.remove());

    const dropdown = document.createElement('div');
    dropdown.className = 'prop-type-dropdown';
    const rect = badgeEl.getBoundingClientRect();
    dropdown.style.top = rect.bottom + 2 + 'px';
    dropdown.style.left = rect.left + 'px';

    options.forEach((opt) => {
      const item = document.createElement('div');
      item.className = 'prop-type-dropdown-item';
      item.textContent = opt;
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        dropdown.remove();
        onCast(opt);
      });
      dropdown.appendChild(item);
    });

    document.body.appendChild(dropdown);

    const close = (ev) => {
      if (!dropdown.contains(ev.target) && ev.target !== badgeEl) {
        dropdown.remove();
        document.removeEventListener('mousedown', close, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  });
}

function castPropertyType(parentRef, key, value, fromType, toType, arrayIdx, propPath) {
  let newValue;
  try {
    switch (toType) {
      case 'int': {
        const n = parseInt(value, 10);
        newValue = Number.isNaN(n) ? 0 : n;
        break;
      }
      case 'float': {
        const n = parseFloat(value);
        newValue = Number.isNaN(n) ? 0 : n;
        break;
      }
      case 'bool':
        if (value === true || value === false) newValue = Boolean(value);
        else if (typeof value === 'string') {
          const s = value.toLowerCase();
          newValue = s === 'true' || s === '1' || s === 'yes';
        } else newValue = Number(value) !== 0 && !Number.isNaN(Number(value));
        break;
      case 'string':
        if (fromType === 'resource') newValue = typedResourceDisplay(value, 'resource_name');
        else if (fromType === 'soundevent') newValue = typedResourceDisplay(value, 'soundevent');
        else if (fromType === 'panorama') newValue = typedResourceDisplay(value, 'panorama');
        else newValue = String(value);
        break;
      case 'resource':
        newValue = {
          type: 'resource_name',
          value:
            typeof value === 'string'
              ? value
              : fromType === 'panorama'
                ? typedResourceDisplay(value, 'panorama') || ''
                : typedResourceDisplay(value, 'resource_name') || ''
        };
        break;
      case 'soundevent':
        newValue = {
          type: 'soundevent',
          value:
            typeof value === 'string'
              ? value
              : fromType === 'panorama'
                ? typedResourceDisplay(value, 'panorama') || ''
                : typedResourceDisplay(value, 'soundevent') || ''
        };
        break;
      case 'panorama':
        newValue = {
          type: 'panorama',
          value:
            typeof value === 'string'
              ? value
              : fromType === 'resource'
                ? typedResourceDisplay(value, 'resource_name') || ''
                : fromType === 'soundevent'
                  ? typedResourceDisplay(value, 'soundevent') || ''
                  : typedResourceDisplay(value, 'panorama') || ''
        };
        break;
      case 'vec2': {
        const a = Array.isArray(value) ? value.map((x) => Number(x)) : [];
        newValue = [0, 0].map((_, i) => (Number.isFinite(a[i]) ? a[i] : 0));
        break;
      }
      case 'vec3': {
        const a = Array.isArray(value) ? value.map((x) => Number(x)) : [];
        newValue = [0, 0, 0].map((_, i) => (Number.isFinite(a[i]) ? a[i] : 0));
        break;
      }
      case 'vec4': {
        const a = Array.isArray(value) ? value.map((x) => Number(x)) : [];
        newValue = [0, 0, 0, 0].map((_, i) => (Number.isFinite(a[i]) ? a[i] : 0));
        break;
      }
      case 'object':
        newValue = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
        break;
      case 'array':
        newValue = Array.isArray(value) ? [...value] : value != null ? [value] : [];
        break;
      default:
        newValue = value;
    }
  } catch (_) {
    newValue = value;
  }
  if (!propPath || typeof VDataCommands === 'undefined') return;
  const useIdx = typeof arrayIdx === 'number' && Array.isArray(parentRef);
  const prev = useIdx ? parentRef[arrayIdx] : parentRef[key];
  const prevCopy = cloneUndoValue(prev);
  withDocUndo(VDataCommands.setValueCommand(propPath, prevCopy, newValue, true), 'Change type');
}

function isPropRowInHiddenBranch(row) {
  if (!row) return false;
  try {
    const csRow = window.getComputedStyle(row);
    if (csRow && csRow.display === 'none') return true;
  } catch (_) {}

  let el = row.parentElement;
  while (el && el.id !== 'propTreeRoot') {
    if (el.classList && el.classList.contains('prop-row-children')) {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none') return true;
    }
    el = el.parentElement;
  }
  return false;
}

/** Visible-order zebra striping (flat `.prop-row` list; skips hidden/collapsed branches). */
function stripePropTree() {
  let i = 0;
  document.querySelectorAll('#propTreeRoot .prop-row').forEach((row) => {
    if (row.classList.contains('search-hidden')) return;
    if (isPropRowInHiddenBranch(row)) return;
    row.classList.toggle('prop-row-even', i % 2 === 0);
    row.classList.toggle('prop-row-odd', i % 2 === 1);
    i++;
  });
}

function getVisiblePropRowPathsOrdered() {
  const out = [];
  document.querySelectorAll('#propTreeRoot .prop-row').forEach((row) => {
    if (row.classList.contains('search-hidden')) return;
    if (isPropRowInHiddenBranch(row)) return;
    const p = row.dataset.propPath;
    if (p) out.push(p);
  });
  return out;
}

function syncPropTreeSelectionClasses() {
  document.querySelectorAll('#propTreeRoot .prop-row').forEach((row) => {
    const p = row.dataset.propPath;
    row.classList.toggle('is-selected', !!(p && _propTreeSelection.has(p)));
  });
}

function prunePropTreeSelectionFromDom() {
  const keep = new Set();
  document.querySelectorAll('#propTreeRoot .prop-row').forEach((row) => {
    const p = row.dataset.propPath;
    if (p && _propTreeSelection.has(p)) keep.add(p);
  });
  _propTreeSelection.clear();
  keep.forEach((p) => _propTreeSelection.add(p));
  if (_propTreeSelectionAnchorPath && !_propTreeSelection.has(_propTreeSelectionAnchorPath)) {
    _propTreeSelectionAnchorPath = _propTreeSelection.size ? [..._propTreeSelection][0] : '';
  }
}

function applyPropTreePointerSelection(ev, path) {
  if (!path) return;
  const ordered = getVisiblePropRowPathsOrdered();
  if (ev.shiftKey) {
    const anchor = _propTreeSelectionAnchorPath || path;
    let ia = ordered.indexOf(anchor);
    const ib = ordered.indexOf(path);
    if (ib < 0) return;
    if (ia < 0) ia = ib;
    const lo = Math.min(ia, ib);
    const hi = Math.max(ia, ib);
    _propTreeSelection.clear();
    for (let i = lo; i <= hi; i++) _propTreeSelection.add(ordered[i]);
  } else if (ev.ctrlKey || ev.metaKey) {
    if (_propTreeSelection.has(path)) _propTreeSelection.delete(path);
    else _propTreeSelection.add(path);
    _propTreeSelectionAnchorPath = path;
  } else {
    _propTreeSelection.clear();
    _propTreeSelection.add(path);
    _propTreeSelectionAnchorPath = path;
  }
  syncPropTreeSelectionClasses();
  const row = _propRowRegistry.get(path);
  row?.focus();
}

function collectPropTreeBulkSameParentPaths(primaryPath) {
  if (!primaryPath) return [];
  if (!_propTreeSelection.has(primaryPath) || _propTreeSelection.size < 2) return [primaryPath];
  const par = parentPathFromRowPath(primaryPath);
  const same = [..._propTreeSelection].filter((p) => parentPathFromRowPath(p) === par);
  return same.length >= 2 ? same : [primaryPath];
}

function sortPropPathsForDelete(paths) {
  const unique = [...new Set(paths)];
  function arrayTail(path) {
    let m = /^(.*)\/\[(\d+)\]$/.exec(path);
    if (m) return { parent: m[1], idx: parseInt(m[2], 10) };
    m = /^\[(\d+)\]$/.exec(path);
    if (m) return { parent: '', idx: parseInt(m[1], 10) };
    return null;
  }
  return unique.sort((a, b) => {
    if (b.startsWith(a + '/')) return 1;
    if (a.startsWith(b + '/')) return -1;
    const ta = arrayTail(a);
    const tb = arrayTail(b);
    if (ta && tb && ta.parent === tb.parent) return tb.idx - ta.idx;
    return b.length - a.length || a.localeCompare(b);
  });
}

function propTreeDeletePaths(paths) {
  const d = docManager.activeDoc;
  if (!d || !paths?.length || typeof VDataPathUtils === 'undefined') return;
  const sorted = sortPropPathsForDelete(paths);
  withDocUndoRootPair(() => {
    let ex = new Set(d.expandedPaths);
    let col = new Set(d.collapsedPaths);
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const item = rowDragItemFromPath(p);
      const isArr = item.arrayIdx !== null;
      const snap = isArr
        ? snapshotAfterArrayContainerInvalidate(arrayContainerPathFromRowPath(p), ex, col)
        : snapshotAfterObjectKeyInvalidate(p, ex, col);
      ex = new Set(snap.expandedAfter);
      col = new Set(snap.collapsedAfter);
      VDataPathUtils.deleteAtPath(d.root, p);
    }
    d.expandedPaths = ex;
    d.collapsedPaths = col;
  }, 'Delete');
  _propTreeSelection.clear();
  _propTreeSelectionAnchorPath = '';
}

function normalizeClipboardEntries() {
  if (!_clipboard) return [];
  if (Array.isArray(_clipboard.entries) && _clipboard.entries.length) return _clipboard.entries;
  return [{ key: _clipboard.key, value: _clipboard.value, type: _clipboard.type }];
}

function getPropTreeSelectedPathsOrdered() {
  const ordered = getVisiblePropRowPathsOrdered();
  const out = [];
  for (let i = 0; i < ordered.length; i++) {
    if (_propTreeSelection.has(ordered[i])) out.push(ordered[i]);
  }
  return out;
}

function propTreePrimaryPathForAction() {
  const sel = getPropTreeSelectedPathsOrdered();
  if (sel.length) return sel[sel.length - 1];
  const r = document.activeElement?.closest?.('#propTreeRoot .prop-row');
  return r?.dataset?.propPath || '';
}

function propTreeActiveEditorStealsKeys() {
  return !!document.activeElement?.closest?.('.cm-editor');
}

function propTreeIsTreeTextFieldTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  return (
    el.closest(
      '#propTreeRoot input:not([type="checkbox"]):not([type="color"]):not([type="range"]):not([type="button"]), ' +
        '#propTreeRoot textarea, #propTreeRoot select, #propTreeRoot .prop-key-rename'
    ) != null
  );
}

function propTreeCopySelection() {
  const d = docManager.activeDoc;
  if (!d) return;
  let paths = getPropTreeSelectedPathsOrdered();
  if (!paths.length) {
    const one = propTreePrimaryPathForAction();
    if (one) paths = [one];
  }
  if (!paths.length) return;
  const entries = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const v = getValueAtPath(d.root, p);
    const item = rowDragItemFromPath(p);
    const parentPathOnly = parentPathFromRowPath(p);
    const parentVal = parentPathOnly ? getValueAtPath(d.root, parentPathOnly) : d.root;
    const keyName = item.key != null ? item.key : `[${item.arrayIdx}]`;
    const parentObj = Array.isArray(parentVal) || (parentVal && typeof parentVal === 'object') ? parentVal : {};
    const t = resolveRowWidgetType(keyName, v, parentObj, p);
    entries.push({ key: item.key, value: deepClone(v), type: t, propPath: p });
  }
  _clipboard = { entries };
  const vals = entries.map((e) => e.value);
  const text = JSON.stringify(vals.length === 1 ? vals[0] : vals, null, 2);
  navigator.clipboard.writeText(text).catch(() => {});
}

/** Paste clipboard into the selected row: replace its value and keep full nested structure (object/array children). */
function propTreePasteIntoSelection(anchorPath) {
  const entries = normalizeClipboardEntries();
  if (!entries.length) return;
  const d = docManager.activeDoc;
  if (!d || !anchorPath) return;
  const val0 = deepClone(entries[0].value);
  const item = rowDragItemFromPath(anchorPath);
  const parentPath = parentPathFromRowPath(anchorPath);
  const parentRef = parentPath ? getValueAtPath(d.root, parentPath) : d.root;
  if (!parentRef || typeof parentRef !== 'object') return;
  const row = _propRowRegistry.get(anchorPath);
  const depth =
    row != null ? parseInt(row.dataset.depth || '0', 10) : (anchorPath.match(/\//g) || []).length;
  const isStruct = val0 !== null && typeof val0 === 'object';
  const hasKids = isStruct && (Array.isArray(val0) ? val0.length > 0 : Object.keys(val0).length > 0);
  if (hasKids) {
    if (depth === 0) propCol().delete(anchorPath);
    else propEx().add(anchorPath);
  }
  commitValue(parentRef, item.key, val0, item.arrayIdx, isStruct, anchorPath);
}

async function propTreeTryPasteSystemClipboardIntoSelection(anchorPath) {
  const d = docManager.activeDoc;
  if (!d || !anchorPath) return;
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch (_) {
    return;
  }
  if (!text || !text.trim()) return;
  let v;
  try {
    v = JSON.parse(text);
  } catch (_) {
    return;
  }
  _clipboard = { key: null, value: v, type: inferType('', v) };
  propTreePasteIntoSelection(anchorPath);
}

function sortPropPathsForDuplicate(paths) {
  const unique = [...new Set(paths)];
  function arrayTail(path) {
    let m = /^(.*)\/\[(\d+)\]$/.exec(path);
    if (m) return { parent: m[1], idx: parseInt(m[2], 10) };
    m = /^\[(\d+)\]$/.exec(path);
    if (m) return { parent: '', idx: parseInt(m[1], 10) };
    return null;
  }
  return unique.sort((a, b) => {
    if (b.startsWith(a + '/')) return 1;
    if (a.startsWith(b + '/')) return -1;
    const ta = arrayTail(a);
    const tb = arrayTail(b);
    if (ta && tb && ta.parent === tb.parent) return tb.idx - ta.idx;
    return b.length - a.length || a.localeCompare(b);
  });
}

function propTreeDuplicatePaths(paths) {
  const d = docManager.activeDoc;
  if (!d || !paths.length) return;
  const parentGroups = new Map();
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const par = parentPathFromRowPath(p);
    if (!parentGroups.has(par)) parentGroups.set(par, []);
    parentGroups.get(par).push(p);
  }
  withDocUndoRootPair(() => {
    const parStr = [...parentGroups.keys()].sort();
    for (let g = 0; g < parStr.length; g++) {
      const sorted = sortPropPathsForDuplicate(parentGroups.get(parStr[g]));
      for (let j = 0; j < sorted.length; j++) {
        const p = sorted[j];
        const value = getValueAtPath(d.root, p);
        if (value === undefined) continue;
        const item = rowDragItemFromPath(p);
        const parentPath = parentPathFromRowPath(p);
        const parentRef = parentPath ? getValueAtPath(d.root, parentPath) : d.root;
        if (typeof item.arrayIdx === 'number') {
          const arrP = arrayContainerPathFromRowPath(p);
          const arr = getValueAtPath(d.root, arrP);
          if (!Array.isArray(arr)) continue;
          const snap = snapshotAfterArrayContainerInvalidate(arrP, d.expandedPaths, d.collapsedPaths);
          d.expandedPaths = new Set(snap.expandedAfter);
          d.collapsedPaths = new Set(snap.collapsedAfter);
          arr.splice(item.arrayIdx + 1, 0, deepClone(value));
        } else {
          const key = item.key;
          if (typeof key !== 'string' || !parentRef || typeof parentRef !== 'object' || Array.isArray(parentRef))
            continue;
          let newKey = key + '_copy';
          let n = 1;
          while (Object.prototype.hasOwnProperty.call(parentRef, newKey)) newKey = key + '_copy' + ++n;
          parentRef[newKey] = deepClone(value);
        }
      }
    }
  }, 'Duplicate');
}

function propTreeToggleExpandForRow(row) {
  if (!row) return;
  const t = row.querySelector('.prop-key-toggle');
  if (t) t.click();
}

function propTreeStartRenameFocusedPath(path) {
  if (!path) return;
  const row = _propRowRegistry.get(path);
  if (!row) return;
  if (/\/\[(\d+)\]$/.test(path) || /^\[(\d+)\]$/.test(path)) return;
  const keyText = row.querySelector('.prop-key-text');
  const keyEl = row.querySelector('.prop-key');
  if (!keyEl || !keyText) return;
  const keyName = objectKeyFromPropPath(path);
  if (keyName == null) return;
  const d = docManager.activeDoc;
  if (!d) return;
  const parentPath = parentPathFromRowPath(path);
  const parentRef = parentPath ? getValueAtPath(d.root, parentPath) : d.root;
  if (!parentRef || typeof parentRef !== 'object' || Array.isArray(parentRef)) return;
  startInlineRename(keyEl, keyText, keyName, parentRef, path);
}

function propTreeMoveFocus(delta) {
  const ordered = getVisiblePropRowPathsOrdered();
  if (!ordered.length) return;
  let cur = propTreePrimaryPathForAction();
  let i = cur ? ordered.indexOf(cur) : 0;
  if (i < 0) i = 0;
  i = Math.max(0, Math.min(ordered.length - 1, i + delta));
  const nextPath = ordered[i];
  _propTreeSelection.clear();
  _propTreeSelection.add(nextPath);
  _propTreeSelectionAnchorPath = nextPath;
  syncPropTreeSelectionClasses();
  _propRowRegistry.get(nextPath)?.focus();
}

function escapeRegExp(s) {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeKV3QuotedStringForSearch(s) {
  // Model strings are unescaped; KV3 uses backslash escapes for " and \.
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function unescapeKV3QuotedStringForSearch(s) {
  // Input is the inner quoted string contents (no surrounding quotes).
  return String(s ?? '').replace(/\\\\/g, '\\').replace(/\\"/g, '"');
}

function revealManualEditorFromPropPath(propPath) {
  try {
    const getCM = window?.getManualEditorCM;
    let cmView = typeof getCM === 'function' ? getCM() : null;
    if (!cmView || !cmView.state?.doc) {
      // Manual editor may be lazily initialized; try to force a sync
      // so CodeMirror exists before we reveal.
      try {
        window.syncManualEditor?.();
      } catch (_) {}
      cmView = typeof getCM === 'function' ? getCM() : null;
    }
    if (!cmView || !cmView.state?.doc) return;

  const activeDoc = docManager?.activeDoc;
  const root = activeDoc?.root;
  if (!root) return;

  const text = cmView.state.doc.toString();

  const keyName = objectKeyFromPropPath(propPath);
  const rawValue = getValueAtPath(root, propPath);

  let targetPos = -1;

  if (typeof keyName === 'string' && keyName.length) {
    const k = keyName;
    const escapedKey = escapeRegExp(k);

    // KV3 key is either bare or quoted.
    const quotedKey = `"${escapeKV3QuotedStringForSearch(k)}"`;
    const quotedKeyRe = new RegExp(escapeRegExp(quotedKey) + '\\s*=', 'm');
    const bareKeyRe = new RegExp(escapedKey + '\\s*=', 'm');

    let m = quotedKeyRe.exec(text);
    if (m && typeof m.index === 'number') targetPos = m.index;
    if (targetPos < 0) {
      m = bareKeyRe.exec(text);
      if (m && typeof m.index === 'number') targetPos = m.index;
    }
    // Plain substring fallback if KV3 quoting style doesn't match our regex.
    if (targetPos < 0) {
      const bi = text.indexOf(k);
      if (bi >= 0) targetPos = bi;
      else {
        const qi = text.indexOf(`"${escapeKV3QuotedStringForSearch(k)}"`);
        if (qi >= 0) targetPos = qi;
      }
    }

    // If we can parse a scalar string/number/bool, try to move within the key line.
    if (targetPos >= 0 && rawValue != null) {
      let needle = null;
      if (typeof rawValue === 'string') needle = `"${escapeKV3QuotedStringForSearch(rawValue)}"`;
      else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) needle = String(rawValue);
      else if (typeof rawValue === 'boolean') needle = rawValue ? 'true' : 'false';
      else if (rawValue && typeof rawValue === 'object' && typeof rawValue.value === 'string')
        needle = `"${escapeKV3QuotedStringForSearch(rawValue.value)}"`;

      if (needle) {
        const windowText = text.slice(targetPos, Math.min(text.length, targetPos + 400));
        const p2 = windowText.indexOf(needle);
        if (p2 >= 0) targetPos = targetPos + p2;
      }
    }
  } else {
    // Array element row: path like `${parentKey}/[idx]`.
    const am = /\/\[(\d+)\]$/.exec(propPath);
    const idx = am ? parseInt(am[1], 10) : null;
    const pParent = parentPathFromRowPath(propPath);
    const parentKey = pParent ? pParent.split('/').pop() : '';
    if (idx != null && parentKey) {
      const escapedParentKey = escapeRegExp(parentKey);
      const assignRe = new RegExp(`(?:^|\\s)${escapedParentKey}\\s*=\\s*\\[`, 'm');
      const m = assignRe.exec(text);
      if (m && typeof m.index === 'number') {
        const start = m.index + m[0].lastIndexOf('[');

        // Bracket-scan to the matching closing `]`.
        let depth = 0;
        let end = -1;
        for (let i = start; i < text.length; i++) {
          const ch = text[i];
          if (ch === '[') depth++;
          else if (ch === ']') {
            depth--;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }

        if (end > start) {
          const block = text.slice(start, end + 1);

          let tokens = [];
          if (typeof rawValue === 'string') {
            const re = /"((?:[^"\\]|\\.)*)"/g;
            let mm;
            while ((mm = re.exec(block))) {
              tokens.push({ at: mm.index, tok: unescapeKV3QuotedStringForSearch(mm[1]) });
            }
            // Helper: reuse same unescape function we use for searching.
          } else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            const re = /[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?/g;
            let mm;
            while ((mm = re.exec(block))) tokens.push({ at: mm.index, tok: Number(mm[0]) });
          } else if (typeof rawValue === 'boolean') {
            const re = /true|false|null/g;
            let mm;
            while ((mm = re.exec(block))) tokens.push({ at: mm.index, tok: mm[0] });
          }

          if (tokens.length && idx >= 0 && idx < tokens.length) {
            targetPos = start + tokens[idx].at;
          }
        }
      }
    }
  }

  if (targetPos < 0) {
    // Array element fallback: scroll to parent array assignment.
    const am = typeof propPath === 'string' ? /\/\[(\d+)\]$/.exec(propPath) : null;
    if (!keyName && am) {
      const pParent = parentPathFromRowPath(propPath);
      const parentKey = pParent ? pParent.split('/').pop() : '';
      if (parentKey) {
        const escapedParentKey = escapeRegExp(parentKey);
        const fallbackRe = new RegExp(`(?:^|\\s)${escapedParentKey}\\s*=\\s*\\[`, 'm');
        const mf = fallbackRe.exec(text);
        if (mf && typeof mf.index === 'number') targetPos = mf.index;
      }
    }
  }

  if (targetPos < 0) return;

  // Prefer the line containing the match (more stable than exact character).
  try {
    targetPos = cmView.state.doc.lineAt(targetPos).from;
  } catch (_) {}

  try {
    // Scroll + select a 0-length range at the target.
    cmView.dispatch({
      selection: CM.EditorSelection.create([CM.EditorSelection.range(targetPos, targetPos)]),
      scrollIntoView: true
    });
  } catch (_) {
    // no-op
  }
  return;
  } catch (e) {
    console.error('revealManualEditorFromPropPath failed', e);
    setStatus?.('Reveal failed: ' + (e?.message ? e.message : String(e)), 'error');
  }
}

function initPropTreeKeyboard() {
  const treeRoot = document.getElementById('propTreeRoot');
  if (!treeRoot || treeRoot.dataset.kbInit) return;
  treeRoot.dataset.kbInit = '1';
  treeRoot.tabIndex = -1;
  treeRoot.addEventListener('keydown', (e) => {
    if (propTreeActiveEditorStealsKeys()) return;
    const hasSel = getPropTreeSelectedPathsOrdered().length > 0;
    if (!treeRoot.contains(document.activeElement) && !hasSel) return;
    if (propTreeIsTreeTextFieldTarget(e.target)) return;

    const mod = e.metaKey || e.ctrlKey;
    const primary = propTreePrimaryPathForAction();

    // Ctrl+Shift+F: reveal current property tree row in manual editor.
    if (e.ctrlKey && e.shiftKey && (e.key || '').toLowerCase() === 'f') {
      if (!primary) return;
      e.preventDefault();
      e.stopPropagation();
      revealManualEditorFromPropPath(primary);
      return;
    }

    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      const ord = getVisiblePropRowPathsOrdered();
      _propTreeSelection.clear();
      ord.forEach((p) => _propTreeSelection.add(p));
      _propTreeSelectionAnchorPath = ord.length ? ord[ord.length - 1] : '';
      syncPropTreeSelectionClasses();
      return;
    }

    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      propTreeCopySelection();
      return;
    }

    if (mod && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      const anchor = primary || getPropTreeSelectedPathsOrdered()[0];
      if (!anchor) return;
      const paths = collectPropTreeBulkSameParentPaths(anchor);
      propTreeCopySelection();
      propTreeDeletePaths(paths);
      return;
    }

    if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      const anchor = primary;
      if (!anchor) return;
      if (normalizeClipboardEntries().length) {
        propTreePasteIntoSelection(anchor);
      } else {
        void propTreeTryPasteSystemClipboardIntoSelection(anchor);
      }
      return;
    }

    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const anchor = primary || getPropTreeSelectedPathsOrdered()[0];
      if (!anchor) return;
      propTreeDuplicatePaths(collectPropTreeBulkSameParentPaths(anchor));
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const anchor = primary || getPropTreeSelectedPathsOrdered()[0];
      if (!anchor) return;
      e.preventDefault();
      propTreeDeletePaths(collectPropTreeBulkSameParentPaths(anchor));
      return;
    }

    if (e.key === 'F2') {
      e.preventDefault();
      propTreeStartRenameFocusedPath(primary);
      return;
    }

    if (e.key === 'Enter') {
      if (!primary) return;
      e.preventDefault();
      propTreeToggleExpandForRow(_propRowRegistry.get(primary));
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      propTreeMoveFocus(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      propTreeMoveFocus(-1);
      return;
    }
    if (e.key === 'ArrowRight') {
      if (!primary) return;
      e.preventDefault();
      const row = _propRowRegistry.get(primary);
      const ch = row?.nextElementSibling;
      if (ch?.classList.contains('prop-row-children') && ch.style.display === 'none') propTreeToggleExpandForRow(row);
      return;
    }
    if (e.key === 'ArrowLeft') {
      if (!primary) return;
      e.preventDefault();
      const row = _propRowRegistry.get(primary);
      const ch = row?.nextElementSibling;
      if (ch?.classList.contains('prop-row-children') && ch.style.display !== 'none') propTreeToggleExpandForRow(row);
      return;
    }
  });

  // ── Cross-panel reveal hotkey (Ctrl+Shift+F) ────────────────────────────
  // Global capture handler so the shortcut works reliably regardless of
  // which specific element inside each panel has focus.
  if (!window.__vdeCtrlShiftFGlobalBound) {
    window.__vdeCtrlShiftFGlobalBound = true;
    const propRoot = treeRoot;
    document.addEventListener(
      'keydown',
      (e) => {
        if (!e || !e.ctrlKey || !e.shiftKey || (e.key || '').toLowerCase() !== 'f') return;
        const t = e.target;
        const inPropTree = !!(t && propRoot.contains(t));
        const inManualEditor = !!(t && (t.closest?.('#cmEditor') || t.closest?.('.cm-editor')));
        if (!inPropTree && !inManualEditor) return;

        // Don't hijack when user is typing into a text field/textarea within the tree.
        if (inPropTree && propTreeIsTreeTextFieldTarget(t)) return;

        e.preventDefault();
        e.stopPropagation();

        if (inPropTree) {
          const p = propTreePrimaryPathForAction() || getPropTreeSelectedPathsOrdered()[0];
          if (p) revealManualEditorFromPropPath(p);
          return;
        }

        // Manual editor -> property tree.
        const fn = window.__vdeRevealPropTreeFromManualCursor;
        if (typeof fn === 'function') fn();
      },
      { capture: true }
    );
  }
}

function buildPropertyTree() {
  const container = document.getElementById('propTreeRoot');
  if (!container) return;
  const d = docManager.activeDoc;
  const root = d?.root;
  if (!root || typeof root !== 'object') {
    container.innerHTML = '';
    clearPropRowRegistry();
    _propTreeBuiltForDoc = null;
    _propTreeStructuralDirty = true;
    return;
  }

  if (_propTreeBuiltForDoc !== d) {
    _propTreeBuiltForDoc = d;
    _propTreeStructuralDirty = true;
  }

  const scrollTop = container.scrollTop;
  const q = document.getElementById('propTreeSearch')?.value?.trim().toLowerCase() ?? '';

  if (!_propTreeStructuralDirty && !_propTreeRebuildPending && container.querySelector('.prop-row')) {
    updatePropRowValues(container);
    if (q) filterPropTree(q);
    stripePropTree();
    syncPropTreeSelectionClasses();
    return;
  }

  // Defer the first heavy DOM rebuild for large docs so the UI can paint the placeholder first.
  if (d?.deferInitialPropTreeRender && !container.dataset.vdePropTreeDeferred) {
    container.dataset.vdePropTreeDeferred = '1';
    // Mark this doc as "huge initial mode" so the next rebuild can avoid eager depth-0 subtree population.
    container.dataset.vdePropTreeInitialCollapsedDepth0 = '1';
    d.deferInitialPropTreeRender = false;
    requestAnimationFrame(() => {
      delete container.dataset.vdePropTreeDeferred;
      buildPropertyTree();
    });
    return;
  }

  _propTreeStructuralDirty = false;
  const busyApi = typeof window !== 'undefined' ? window.VDataBusyCursor : null;
  let busyDidStart = false;
  if (typeof busyApi?.begin === 'function') {
    busyApi.begin();
    busyDidStart = true;
  }
  const gen = ++_propTreeRebuildGeneration;
  _propTreeRebuildPending = true;

  // Snapshot focus before we clear/rebuild DOM (helps keep typing position stable).
  const focusSnapshot = (() => {
    const ae = document.activeElement;
    if (!ae || !container.contains(ae)) return null;
    const row = ae.closest?.('#propTreeRoot .prop-row');
    const propPath = row?.dataset?.propPath;
    if (!propPath) return null;

    const axisRow = ae.closest?.('.vec-axis-row');
    if (axisRow) {
      const axisLabel = axisRow.querySelector?.('.vec-axis-label')?.textContent?.trim() ?? '';
      return { propPath, kind: 'vec-axis', axisLabel };
    }

    const tag = (ae.tagName || '').toLowerCase();
    const type =
      typeof HTMLInputElement !== 'undefined' && ae instanceof HTMLInputElement ? ae.type : null;
    const isSliderInput = ae.classList?.contains?.('slider-input') ?? false;
    return {
      propPath,
      kind: 'control',
      tag,
      type,
      isSliderInput
    };
  })();

  // Defer heavy sync DOM work so cursor can update and user input doesn't feel "dead".
  requestAnimationFrame(() => {
    if (gen !== _propTreeRebuildGeneration) {
      if (typeof busyApi?.end === 'function' && busyDidStart) busyApi.end();
      return;
    }

    (async () => {
      try {
      container.innerHTML = '';
      clearPropRowRegistry();

      const hugeInitialMode = container.dataset.vdePropTreeInitialCollapsedDepth0 === '1';

      // Build root rows only (no eager depth-0 subtree) when huge-doc mode is enabled.
      if (hugeInitialMode) {
        // JS fallback plan (also used when native IPC fails).
        function jsBuildPlan() {
          const entries = Array.isArray(root) ? root.entries() : Object.entries(root);
          const rows = [];
          for (const [key, value] of entries) {
            const isArr = Array.isArray(value);
            const isObj = !isArr && value !== null && typeof value === 'object';
            const isExpandable = isArr || isObj;
            rows.push({
              key: String(key),
              propPath: String(key),
              kind: isArr ? 'array' : isObj ? 'object' : 'scalar',
              isExpandable: !!isExpandable,
              collapsedByDefault: !!isExpandable
            });
          }
          return { rows };
        }

        let plan = null;
        try {
          plan = await window.electronAPI?.buildPropTreeInitialPlan?.(root, {
            collapsedDefaultDepth0: true
          });
        } catch (e) {
          // Native plan computation is a performance hint; fallback must be safe.
          plan = null;
        }
        const planRows = plan?.rows && Array.isArray(plan.rows) ? plan.rows : jsBuildPlan().rows;

        // Ensure collapsed-by-default depth-0 parents are reflected in doc state.
        // (This keeps future rebuilds consistent with the initial UI.)
        planRows.forEach((r) => {
          if (!r || !r.isExpandable || !r.collapsedByDefault) return;
          if (!propEx().has(r.propPath) && !propCol().has(r.propPath)) propCol().add(r.propPath);
        });

        const total = planRows.length;
        const frag = document.createDocumentFragment();
        const yieldNextFrame = () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => resolve());
          });
        const FRAME_BUDGET_MS = 10;
        const ROWS_PER_SLICE_FALLBACK = 4;
        const perfNow =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? () => performance.now()
            : () => Date.now();
        let sliceStart = perfNow();

        for (let idx = 0; idx < total; idx++) {
          if (gen !== _propTreeRebuildGeneration) {
            return;
          }
          const r = planRows[idx];
          if (!r) continue;
          const key = r.key;
          const propPath = r.propPath;
          const value = root?.[key];

          const type = resolveRowWidgetType(key, value, root, propPath);
          const row = buildPropRow(key, value, type, 0, root, undefined, propPath, {
            index: idx,
            total,
            parentKind: 'object'
          });
          frag.appendChild(row);

          if (type === 'object' || type === 'array') {
            const children = document.createElement('div');
            children.className = 'prop-row-children';
            children.dataset.lazy = '1';
            const shouldCollapse = !!r.collapsedByDefault;
            children.style.display = shouldCollapse ? 'none' : '';
            frag.appendChild(children);

            // buildPropRow initializes as "expanded" for depth==0; override to collapsed state.
            const toggle = row.querySelector?.('.prop-key-toggle');
            if (toggle) setPropKeyToggleIcon(toggle, !shouldCollapse, false);
          }

          const hasMore = idx < total - 1;
          if (!hasMore) break;
          const elapsed = perfNow() - sliceStart;
          const hitBudget = elapsed >= FRAME_BUDGET_MS;
          const hitFallbackRows = (idx + 1) % ROWS_PER_SLICE_FALLBACK === 0;
          if (hitBudget || hitFallbackRows) {
            await yieldNextFrame();
            if (gen !== _propTreeRebuildGeneration) {
              return;
            }
            sliceStart = perfNow();
          }
        }

        container.appendChild(frag);
        delete container.dataset.vdePropTreeInitialCollapsedDepth0;
      } else {
        renderObjectRows(container, root, 0, '');
      }

      prunePropTreeSelectionFromDom();
      syncPropTreeSelectionClasses();
      if (q) filterPropTree(q);
      stripePropTree();
      syncPropTreeSelectionClasses();
    } finally {
      if (typeof busyApi?.end === 'function' && busyDidStart) busyApi.end();
      _propTreeRebuildPending = false;
      delete container.dataset.vdePropTreeInitialCollapsedDepth0;
    }

      requestAnimationFrame(() => {
        container.scrollTop = scrollTop;
        if (!focusSnapshot) return;
        const row = _propRowRegistry.get(focusSnapshot.propPath);
        if (!row) return;

        if (focusSnapshot.kind === 'vec-axis') {
          const axisRows = row.querySelectorAll('.vec-axis-row');
          let target = null;
          axisRows.forEach((ar) => {
            if (target) return;
            const lbl = ar.querySelector?.('.vec-axis-label')?.textContent?.trim() ?? '';
            if (lbl === focusSnapshot.axisLabel) {
              target = ar.querySelector?.('.slider-input');
            }
          });
          if (target && typeof target.focus === 'function') target.focus();
          return;
        }

        if (focusSnapshot.type === 'checkbox') {
          row.querySelector?.('.prop-input-bool')?.focus?.();
          return;
        }
        if (focusSnapshot.isSliderInput) {
          row.querySelector?.('.slider-input')?.focus?.();
          return;
        }

        // Best-effort: focus the first editable prop input in the row.
        row.querySelector?.('.prop-input:not([readonly])')?.focus?.();
      });
    })();
  });

  return;
}

function updatePropRowValues(container) {
  const skipFocused = !(
    typeof window !== 'undefined' &&
    window.__vde_forcePropTreeSyncFocusedInputs === true
  );
  for (const row of container.querySelectorAll(':scope > .prop-row')) {
    const path = row.dataset.propPath;
    const value = getValueAtPath(docManager.activeDoc.root, path);
    const vecWidget = row.querySelector('.vec-widget');
    if (vecWidget && Array.isArray(value)) {
      const axisRows = row.querySelectorAll('.vec-axis-row');
      axisRows.forEach((axisRow, i) => {
        const axisVal = Number(value[i]);
        if (!Number.isFinite(axisVal)) return;
        const numInput = axisRow.querySelector('.slider-input');
        const slider = axisRow.querySelector('.slider-range');
        const wrap = axisRow.querySelector('.slider-input-wrap');
        const newStr = parseFloat(axisVal.toFixed(6)).toString();

        const isNumFocused = !!numInput && numInput === document.activeElement;
        const isSliderFocused = !!slider && slider === document.activeElement;
        const canUpdateFocusedState = !skipFocused || (!isNumFocused && !isSliderFocused);
        if (wrap && typeof wrap.__vdeSetValueFromModel === 'function' && canUpdateFocusedState) {
          wrap.__vdeSetValueFromModel(axisVal);
          return;
        }

        if (
          numInput &&
          (!skipFocused || numInput !== document.activeElement) &&
          numInput.value !== newStr
        ) {
          numInput.value = newStr;
        }
        if (slider && (!skipFocused || slider !== document.activeElement)) {
          const min = Number(slider.min);
          const max = Number(slider.max);
          if (Number.isFinite(min) && Number.isFinite(max) && axisVal >= min && axisVal <= max) {
            const sliderStr = String(axisVal);
            if (slider.value !== sliderStr) slider.value = sliderStr;
          }
        }
      });
    } else {
      // Color widget has multiple controls (swatch + hidden picker + RGBA inputs).
      const swatch = row.querySelector('.prop-color-swatch');
      if (swatch && Array.isArray(value)) {
        const arr = Array.isArray(value) ? value : [0, 0, 0];
        const toHex = (a) =>
          '#' +
          a
            .slice(0, 3)
            .map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0'))
            .join('');

        const picker = row.querySelector('.prop-color-input');
        const hex = toHex(arr);
        if (!skipFocused || swatch !== document.activeElement) {
          swatch.style.background = hex;
        }
        if (picker && (!skipFocused || picker !== document.activeElement)) {
          picker.value = hex;
        }

        const numInputs = row.querySelectorAll('.prop-input');
        numInputs.forEach((inp, i) => {
          if (i >= arr.length) return;
          if (skipFocused && inp === document.activeElement) return;
          const next = String(arr[i] ?? 0);
          if (inp.value !== next) inp.value = next;
        });
      } else {
        const inp = row.querySelector('.prop-input:not([readonly])');
        if (inp && (!skipFocused || inp !== document.activeElement)) {
          const newStr = value == null ? '' : String(value);
          if (inp.value !== newStr) inp.value = newStr;
        }
      }
    }
    const cb = row.querySelector('.prop-input-bool');
    if (cb && (!skipFocused || cb !== document.activeElement)) {
      if (cb.checked !== !!value) cb.checked = !!value;
    }
    const ch = row.nextElementSibling;
    if (ch?.classList.contains('prop-row-children') && ch.style.display !== 'none') {
      const v = getValueAtPath(docManager.activeDoc.root, path);
      if (v && typeof v === 'object') updatePropRowValues(ch);
    }
  }
}

function renderObjectRows(container, obj, depth, parentPath) {
  if (!obj || typeof obj !== 'object') return;
  const entries = Object.entries(obj).filter(([, value]) => value !== undefined);
  const total = entries.length;
  const frag = document.createDocumentFragment();
  for (let idx = 0; idx < total; idx++) {
    const [key, value] = entries[idx];
    if (value === undefined) continue;
    const rowPath = parentPath ? `${parentPath}/${key}` : key;
    const type = resolveRowWidgetType(key, value, obj, rowPath);
    const row = buildPropRow(key, value, type, depth, obj, undefined, rowPath, {
      index: idx,
      total,
      parentKind: 'object'
    });
    frag.appendChild(row);
    if (type === 'object' && value !== null) {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      if (depth >= 1) {
        if (propEx().has(rowPath)) {
          renderObjectRows(children, value, depth + 1, rowPath);
          children.style.display = '';
        } else {
          children.dataset.lazy = '1';
          children.style.display = 'none';
        }
      } else {
        renderObjectRows(children, value, depth + 1, rowPath);
        if (propCol().has(rowPath)) {
          children.style.display = 'none';
        }
      }
      frag.appendChild(children);
      const toggle = row.querySelector('.prop-key-toggle');
      if (toggle && depth >= 1) setPropKeyToggleIcon(toggle, propEx().has(rowPath));
      else if (toggle && depth === 0) setPropKeyToggleIcon(toggle, !propCol().has(rowPath), !propCol().has(rowPath));
    } else if (type === 'array') {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      if (depth >= 1) {
        if (propEx().has(rowPath)) {
          renderArrayRows(children, value, depth + 1, rowPath);
          children.style.display = '';
        } else {
          children.dataset.lazy = '1';
          children.style.display = 'none';
        }
      } else {
        renderArrayRows(children, value, depth + 1, rowPath);
        if (propCol().has(rowPath)) {
          children.style.display = 'none';
        }
      }
      frag.appendChild(children);
      const toggle = row.querySelector('.prop-key-toggle');
      if (toggle && depth >= 1) setPropKeyToggleIcon(toggle, propEx().has(rowPath));
      else if (toggle && depth === 0) setPropKeyToggleIcon(toggle, !propCol().has(rowPath), !propCol().has(rowPath));
    }
  }
  container.appendChild(frag);
}

function renderArrayRows(container, arr, depth, parentPath) {
  if (!Array.isArray(arr)) return;
  const total = arr.length;
  const frag = document.createDocumentFragment();
  arr.forEach((item, idx) => {
    const rowPath = `${parentPath}/[${idx}]`;
    const itemType = resolveRowWidgetType(`[${idx}]`, item, arr, rowPath);
    const row = buildPropRow(`[${idx}]`, item, itemType, depth, arr, idx, rowPath, {
      index: idx,
      total,
      parentKind: 'array'
    });
    frag.appendChild(row);
    if (itemType === 'object' && item !== null) {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      if (depth >= 1) {
        if (propEx().has(rowPath)) {
          renderObjectRows(children, item, depth + 1, rowPath);
          children.style.display = '';
        } else {
          children.dataset.lazy = '1';
          children.style.display = 'none';
        }
      } else {
        renderObjectRows(children, item, depth + 1, rowPath);
        if (propCol().has(rowPath)) {
          children.style.display = 'none';
        }
      }
      frag.appendChild(children);
      const toggle = row.querySelector('.prop-key-toggle');
      if (toggle && depth >= 1) setPropKeyToggleIcon(toggle, propEx().has(rowPath));
      else if (toggle && depth === 0) setPropKeyToggleIcon(toggle, !propCol().has(rowPath), !propCol().has(rowPath));
    } else if (itemType === 'array') {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      if (depth >= 1) {
        if (propEx().has(rowPath)) {
          renderArrayRows(children, item, depth + 1, rowPath);
          children.style.display = '';
        } else {
          children.dataset.lazy = '1';
          children.style.display = 'none';
        }
      } else {
        renderArrayRows(children, item, depth + 1, rowPath);
        if (propCol().has(rowPath)) {
          children.style.display = 'none';
        }
      }
      frag.appendChild(children);
      const toggle = row.querySelector('.prop-key-toggle');
      if (toggle && depth >= 1) setPropKeyToggleIcon(toggle, propEx().has(rowPath));
      else if (toggle && depth === 0) setPropKeyToggleIcon(toggle, !propCol().has(rowPath), !propCol().has(rowPath));
    }
  });
  container.appendChild(frag);
}

function resolveHierarchyIconKey(type, depth, hierarchyMeta) {
  const idx = hierarchyMeta?.index ?? 0;
  const total = hierarchyMeta?.total ?? 1;
  const isParent = type === 'object' || type === 'array';
  const prefix = isParent ? 'parentChildParent' : 'parentChildChild'; // fallback family
  if (depth === 0 && isParent && ICONS.hierarchyForceExpanded) return 'hierarchyForceExpanded';
  if (total <= 1) {
    if (ICONS.hierarchyLastChild) return 'hierarchyLastChild';
    return prefix + 'Only';
  }
  if (idx >= total - 1) {
    if (ICONS.hierarchyLastChild) return 'hierarchyLastChild';
    return prefix + 'Last';
  }
  if (ICONS.hierarchyChild) return 'hierarchyChild';
  if (idx <= 0) return prefix + 'First';
  return prefix + 'Mid';
}

function setPropKeyToggleIcon(toggle, isExpanded, forceExpanded = false) {
  if (!toggle) return;
  toggle.classList.toggle('is-expanded', !!isExpanded);
  toggle.classList.toggle('is-collapsed', !isExpanded);
  toggle.classList.toggle('is-force-expanded', !!forceExpanded);
  if (forceExpanded && ICONS.hierarchyForceExpanded) {
    toggle.innerHTML = ICONS.hierarchyForceExpanded;
    return;
  }
  if (isExpanded) {
    toggle.innerHTML = ICONS.hierarchyExpanded || '▾';
  } else {
    toggle.innerHTML = ICONS.hierarchyCollapsed || '▸';
  }
}

function buildPropRow(key, value, type, depth, parentRef, arrayIdx, propPath, hierarchyMeta) {
  const row = document.createElement('div');
  row.className = 'prop-row' + (type === 'object' || type === 'array' ? ' is-object' : '');
  row.tabIndex = -1;
  const mode = getActiveMode();
  if (mode && typeof mode.rowClass === 'function') {
    const rc = mode.rowClass(key, value);
    if (rc) row.className += ' ' + rc;
  }
  const d = Math.min(depth, 9);
  row.dataset.depth = String(d);
  row.dataset.type = type;
  row.dataset.propPath = propPath;
  _propRowRegistry.set(propPath, row);

  // Dependency evaluation (schema-driven showIf/enableIf).
  // This is evaluated once when the row is built, then re-evaluated selectively
  // after `SET_VALUE` edits.
  if (typeof window !== 'undefined' && window.VDataDependencyEngine && typeof window.VDataDependencyEngine.getDependencyForKey === 'function') {
    const schemaCtx = schemaCtxForPropertyTree();
    const parentKey = schemaParentKeyFromRowPath(propPath);
    const depDef = window.VDataDependencyEngine.getDependencyForKey(key, Object.assign({}, schemaCtx, { parentKey }));
    if (depDef) {
      const refKeys = window.VDataDependencyEngine.collectReferencedKeys(depDef);
      if (refKeys && refKeys.length) {
        row.dataset.depKeys = ',' + refKeys.join(',') + ',';
      }
      _propRowDependencyDef.set(row, depDef);
      applyDependencyStateToPropRow(row, depDef, parentRef, schemaCtx);
    }
  }

  row.addEventListener('focus', () => {
    showPropertyInfo(null, key, type, propPath);
  });

  if (depth > 9) row.style.setProperty('--prop-depth', String(depth));
  if (type === 'commented_value') row.classList.add('prop-row-commented-value');
  if (type === 'comment_label') row.classList.add('prop-row-comment-label');

  const isArrayIndex = typeof arrayIdx === 'number';

  const keyEl = document.createElement('div');
  keyEl.className = 'prop-key';
  const pad = Math.min(depth, 12) * 16;
  keyEl.style.paddingLeft = pad + 'px';

  const dragHandle = document.createElement('span');
  dragHandle.className = 'prop-row-drag-handle';
  dragHandle.draggable = true;
  dragHandle.title = 'Drag to reorder';
  dragHandle.setAttribute('aria-label', 'Drag to reorder');
  dragHandle.textContent = '⋮⋮';
  if (type === 'commented_value' || type === 'comment_label') {
    dragHandle.style.visibility = 'hidden';
    dragHandle.draggable = false;
  }

  const keyIcon = document.createElement('span');
  keyIcon.className = 'prop-type-icon-badge';
  keyIcon.title = type;
  paintTypeBadgeCircle(keyIcon, type, value, key);
  if (type !== 'commented_value' && type !== 'comment_label') {
    attachPropTreeTypeCastToBadge(keyIcon, type, (newType) => {
      castPropertyType(parentRef, key, value, type, newType, arrayIdx, propPath);
    });
  }

  const treeNodeIcon = document.createElement('span');
  treeNodeIcon.className = 'prop-tree-node-icon';

  keyEl.appendChild(dragHandle);
  keyEl.appendChild(treeNodeIcon);
  if (type !== 'commented_value' && type !== 'comment_label') keyEl.appendChild(keyIcon);

  if (type === 'object' || type === 'array') {
    const childrenWillBeLazy = depth >= 1;
    treeNodeIcon.classList.add('prop-key-toggle');
    setPropKeyToggleIcon(treeNodeIcon, !childrenWillBeLazy, depth === 0 && !childrenWillBeLazy);
    treeNodeIcon.addEventListener('click', () => {
      const ch = row.nextElementSibling;
      if (!ch || !ch.classList.contains('prop-row-children')) return;
      if (ch.dataset.lazy === '1') {
        ch.removeAttribute('data-lazy');
        if (type === 'object') renderObjectRows(ch, value, depth + 1, propPath);
        else renderArrayRows(ch, value, depth + 1, propPath);
      }
      const wasCollapsed = ch.style.display === 'none';
      ch.style.display = wasCollapsed ? '' : 'none';
      setPropKeyToggleIcon(treeNodeIcon, wasCollapsed, depth === 0 && wasCollapsed);
      if (depth >= 1) {
        if (wasCollapsed) propEx().add(propPath);
        else propEx().delete(propPath);
      } else {
        if (wasCollapsed) propCol().delete(propPath);
        else propCol().add(propPath);
      }
      stripePropTree();
    });
  } else {
    treeNodeIcon.classList.add('prop-hierarchy-icon');
    const hierarchyIconKey = resolveHierarchyIconKey(type, depth, hierarchyMeta);
    if (hierarchyIconKey && ICONS[hierarchyIconKey]) {
      treeNodeIcon.innerHTML = ICONS[hierarchyIconKey];
    }
  }

  const keyText = document.createElement('span');
  keyText.className = 'prop-key-text';
  const parsedComment = type === 'commented_value' || type === 'comment_label' ? parseArrayCommentNode(value) : null;
  keyText.textContent = type === 'comment_label' ? '// ' + (parsedComment?.text?.trim() || '') : key;
  if (!isArrayIndex) {
    keyText.title = 'Double-click to rename';
    keyText.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineRename(keyEl, keyText, key, parentRef, propPath);
    });
  }
  keyEl.appendChild(keyText);

  keyEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.prop-row-drag-handle, .prop-key-toggle, .prop-type-icon-badge')) return;
    if (e.target.closest('.prop-key-rename')) return;
    if (isPropRowDragExemptTarget(e.target)) return;
    applyPropTreePointerSelection(e, propPath);
  });

  const valEl = document.createElement('div');
  valEl.className = 'prop-value';

  if (STATIC_TYPE_SUMMARY.has(type)) {
    const sum = document.createElement('span');
    sum.className = 'prop-value-summary';
    if (type === 'object' && value !== null) sum.textContent = `{ ${Object.keys(value).length} keys }`;
    else if (type === 'array') sum.textContent = `[ ${value.length} items ]`;
    else if (type === 'null') sum.textContent = 'null';
    else sum.textContent = type;
    valEl.appendChild(sum);
  }
  // Vector widgets need grouped undo for multi-component edits (e.g. X/Y/Z).
  // Slider scrubs update the document live; we coalesce the resulting undo entry.
  const isVecType = type === 'vec2' || type === 'vec3' || type === 'vec4';
  const VEC_UNDO_COALESCE_MS = 250;
  let vecCoalesce = null; // { propPath, prevValue, label, timer, changed }

  function flushVecCoalesce() {
    if (!isVecType || !vecCoalesce) return;
    if (vecCoalesce.timer) clearTimeout(vecCoalesce.timer);

    const d = docManager.activeDoc;
    const pending = vecCoalesce;
    vecCoalesce = null;
    if (!d) return;

    const nextValue = cloneUndoValue(getValueAtPath(d.root, pending.propPath));
    try {
      if (JSON.stringify(pending.prevValue) === JSON.stringify(nextValue)) return;
    } catch (_) {
      if (pending.prevValue === nextValue) return;
    }

    const cmd = VDataCommands.setValueCommand(pending.propPath, pending.prevValue, nextValue, false);
    pushUndoCommand({ cmd, label: pending.label, time: Date.now() });

    d.dirty = true;
    docManager.dispatchEvent(new Event('tabs-changed'));
    patchPropertyTree(cmd);
    window.scheduleManualEditorSyncFromModel?.();
    setStatus('Property edited', 'edited');
  }

  function scheduleVecCoalesceFlush() {
    if (!isVecType || !vecCoalesce) return;
    if (vecCoalesce.timer) clearTimeout(vecCoalesce.timer);
    vecCoalesce.timer = setTimeout(flushVecCoalesce, VEC_UNDO_COALESCE_MS);
  }

  if (isVecType) {
    // If focus leaves the vector widget entirely, commit now so undo works predictably.
    valEl.addEventListener('focusout', (e) => {
      const rt = e.relatedTarget;
      if (rt && valEl.contains(rt)) return; // still inside widget
      flushVecCoalesce();
    });
  }

  // Slider scrubs update the document live but only push ONE undo entry for the whole drag.
  let sliderScrubActive = false;
  let sliderScrubDidChange = false;
  let sliderScrubTx = null;

  function setScalarNoUndo(v) {
    const useIdx = arrayIdx !== undefined && arrayIdx !== null && Array.isArray(parentRef);
    if (useIdx) parentRef[arrayIdx] = v;
    else parentRef[key] = v;
  }

  function beginSliderScrub() {
    if (sliderScrubActive) return;
    const d = docManager.activeDoc;
    if (!d) return;
    sliderScrubActive = true;
    sliderScrubDidChange = false;
    sliderScrubTx = {
      propPath,
      prevValue: cloneUndoValue(getValueAtPath(d.root, propPath)),
      label: `Edit: ${key}`
    };
  }

  function endSliderScrub() {
    if (!sliderScrubActive) return;
    sliderScrubActive = false;

    const tx = sliderScrubTx;
    sliderScrubTx = null;

    if (!tx || !sliderScrubDidChange) {
      sliderScrubDidChange = false;
      return;
    }

    const d = docManager.activeDoc;
    if (!d) return;

    sliderScrubDidChange = false;

    const nextValue = cloneUndoValue(getValueAtPath(d.root, tx.propPath));
    try {
      if (JSON.stringify(tx.prevValue) === JSON.stringify(nextValue)) return;
    } catch (_) {
      if (tx.prevValue === nextValue) return;
    }

    if (isVecType) {
      // Coalesce the whole drag (and possibly multiple component edits) into one undo entry.
      if (!vecCoalesce) {
        vecCoalesce = {
          propPath: tx.propPath,
          prevValue: cloneUndoValue(tx.prevValue),
          label: tx.label,
          timer: null,
          changed: true
        };
      } else {
        vecCoalesce.changed = true;
      }
      scheduleVecCoalesceFlush();
      return;
    }

    const cmd = VDataCommands.setValueCommand(tx.propPath, tx.prevValue, nextValue, false);
    pushUndoCommand({ cmd, label: tx.label, time: Date.now() });

    d.dirty = true;
    docManager.dispatchEvent(new Event('tabs-changed'));
    patchPropertyTree(cmd);
    window.scheduleManualEditorSyncFromModel?.();
    setStatus('Property edited', 'edited');
  }

  const sliderOpts = {
    onScrubStart: beginSliderScrub,
    onScrubEnd: endSliderScrub
  };

  const onScalarChange = (v) => {
    if (sliderScrubActive) {
      sliderScrubDidChange = true;
      setScalarNoUndo(v);
      return;
    }

    if (isVecType) {
      const d = docManager.activeDoc;
      if (!d) return;

      if (!vecCoalesce) {
        vecCoalesce = {
          propPath,
          prevValue: cloneUndoValue(getValueAtPath(d.root, propPath)),
          label: `Edit: ${key}`,
          timer: null,
          changed: false
        };
      }

      setScalarNoUndo(v);
      vecCoalesce.changed = true;
      scheduleVecCoalesceFlush();
      return;
    }

    commitValue(parentRef, key, v, arrayIdx, false, propPath);
  };

  const onComponentsChange = (newArr) => {
    if (sliderScrubActive) {
      sliderScrubDidChange = true;
      setScalarNoUndo(newArr);
      return;
    }
    commitValue(parentRef, key, newArr, arrayIdx, true, propPath);
  };

  switch (type) {
    case 'comment_label': {
      const label = document.createElement('span');
      label.className = 'prop-value-summary';
      label.textContent = '// section label';
      valEl.appendChild(label);
      break;
    }
    case 'commented_value': {
      const disabledVal = parsedComment?.value ?? '';
      const label = document.createElement('span');
      label.className = 'prop-value-summary';
      label.textContent = `"${disabledVal}"`;
      valEl.appendChild(label);
      break;
    }
    case 'bool':
      buildBoolWidget(valEl, value, onScalarChange);
      break;
    case 'int':
    case 'float':
      buildNumberWidget(valEl, value, type, onScalarChange, sliderOpts);
      break;
    case 'float_slider_01':
      buildFloatSlider01Widget(valEl, value, onScalarChange, sliderOpts);
      break;
    case 'readonly_string':
      buildReadonlyStringWidget(valEl, value);
      break;
    case 'components':
      valEl.appendChild(
        buildComponentsWidget(value, onComponentsChange, sliderOpts)
      );
      break;
    case 'string': {
      let listVals = [];
      if (typeof VDataSuggestions !== 'undefined' && VDataSuggestions.getSuggestedValues) {
        const pp = parentPathFromRowPath(propPath);
        const parentKey = pp ? pp.slice(pp.lastIndexOf('/') + 1) : '';
        listVals = VDataSuggestions.getSuggestedValues(key, Object.assign(schemaCtxForPropertyTree(), { parentKey }));
      }
      buildStringWidget(valEl, value, onScalarChange, { suggestedValues: listVals });
      break;
    }
    case 'enum': {
      // Pattern E/C: merge schema suggestions + document-wide enum harvesting.
      // For array element rows, `key` is `[idx]`; dropdown options should be harvested for the *parent* key.
      const pp = parentPathFromRowPath(propPath);
      const parentKey = pp ? pp.slice(pp.lastIndexOf('/') + 1) : '';
      const effectiveEnumKey = /^\[\d+\]$/.test(key) ? parentKey : key;

      const shapeUtils = window?.VDataKV3ShapeUtils;
      const doc = docManager?.activeDoc;
      const docRoot = doc?.root;

      let schemaVals = [];
      if (typeof VDataSuggestions !== 'undefined' && VDataSuggestions.getSuggestedValues) {
        schemaVals = VDataSuggestions.getSuggestedValues(
          key,
          Object.assign(schemaCtxForPropertyTree(), { parentKey })
        );
      }
      if (!Array.isArray(schemaVals)) schemaVals = [];

      let harvestVals = [];
      if (shapeUtils?.harvestEnumValues && docRoot && effectiveEnumKey) {
        if (_enumHarvestCacheVersion !== doc?.structVersion) {
          _enumHarvestCache = new Map();
          _enumHarvestCacheVersion = doc?.structVersion;
        }

        if (_enumHarvestCache.has(effectiveEnumKey)) {
          harvestVals = _enumHarvestCache.get(effectiveEnumKey) || [];
        } else {
          harvestVals = shapeUtils.harvestEnumValues(docRoot, effectiveEnumKey) || [];
          _enumHarvestCache.set(effectiveEnumKey, harvestVals);
        }
      }

      // Preserve "schema first" order, then append harvested values.
      const merged = [];
      const seen = new Set();
      const pushUnique = (arr) => {
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i];
          if (v == null) continue;
          const s = String(v);
          if (!s || seen.has(s)) continue;
          seen.add(s);
          merged.push(s);
        }
      };
      pushUnique(schemaVals);
      pushUnique(harvestVals);

      buildEnumWidget(valEl, value, (v) => onScalarChange(v), { enumValues: merged });
      break;
    }
    case 'resource':
      buildResourceWidget(valEl, value, 'resource_name', onScalarChange);
      break;
    case 'soundevent':
      buildResourceWidget(valEl, value, 'soundevent', onScalarChange);
      break;
    case 'panorama':
      buildResourceWidget(valEl, value, 'panorama', onScalarChange);
      break;
    case 'color':
      buildColorWidget(valEl, value, onScalarChange);
      break;
    case 'vec2':
      buildVec2Widget(valEl, key, value, onScalarChange, sliderOpts);
      break;
    case 'vec3':
      buildVec3Widget(valEl, key, value, onScalarChange, sliderOpts);
      break;
    case 'vec4':
      buildVec4Widget(valEl, key, value, onScalarChange, sliderOpts);
      break;
    case 'object':
    case 'array':
    case 'null':
      break;
    default:
      buildStringWidget(valEl, String(value ?? ''), onScalarChange);
  }

  const actions = document.createElement('div');
  actions.className = 'prop-row-actions';
  if (type === 'comment_label' || type === 'commented_value') actions.style.display = 'none';

  if (isArrayIndex && type === 'string') {
    const disableBtn = document.createElement('button');
    disableBtn.type = 'button';
    disableBtn.className = 'prop-action-btn';
    disableBtn.title = 'Comment out entry';
    disableBtn.textContent = '//';
    disableBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      withDocUndo(
        VDataCommands.setValueCommand(propPath, cloneUndoValue(value), makeCommentedValueNode(value), true),
        'Disable list item'
      );
    });
    actions.appendChild(disableBtn);
  }

  const dupBtn = document.createElement('button');
  dupBtn.type = 'button';
  dupBtn.className = 'prop-action-btn';
  dupBtn.title = 'Duplicate';
  dupBtn.textContent = '⧉';
  dupBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const paths = collectPropTreeBulkSameParentPaths(propPath);
    if (paths.length > 1) {
      propTreeDuplicatePaths(paths);
      return;
    }
    const d = docManager.activeDoc;
    if (!d) return;
    if (isArrayIndex) {
      withDocUndo(makeDuplicateArrayBatch(d, arrayContainerPathFromRowPath(propPath), arrayIdx, deepClone(value)), 'Duplicate');
    } else {
      let newKey = key + '_copy';
      let n = 1;
      while (Object.prototype.hasOwnProperty.call(parentRef, newKey)) newKey = key + '_copy' + ++n;
      const parentObjPath = parentPathFromRowPath(propPath);
      const newPath = parentObjPath ? `${parentObjPath}/${newKey}` : newKey;
      withDocUndo({ type: VDataCommands.CMD.ADD_NODE, pathStr: newPath, value: deepClone(value) }, 'Duplicate');
    }
  });
  actions.appendChild(dupBtn);

  if (type === 'object' || type === 'array') {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'prop-action-btn';
    addBtn.title = type === 'array' ? 'Add item' : 'Add property';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (type === 'array') {
        const insertPath = `${propPath}/[${value.length}]`;
        withDocUndo({ type: VDataCommands.CMD.ADD_NODE, pathStr: insertPath, value: '' }, 'Add child');
      } else {
        let newKey = 'new_key';
        let n = 1;
        while (Object.prototype.hasOwnProperty.call(value, newKey)) newKey = 'new_key_' + ++n;
        const newPath = `${propPath}/${newKey}`;
        withDocUndo({ type: VDataCommands.CMD.ADD_NODE, pathStr: newPath, value: '' }, 'Add child');
      }
    });
    actions.appendChild(addBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'prop-action-btn danger';
  delBtn.title = 'Delete';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const paths = collectPropTreeBulkSameParentPaths(propPath);
    if (paths.length > 1) {
      propTreeDeletePaths(paths);
      return;
    }
    const d = docManager.activeDoc;
    if (!d) return;
    withDocUndo(makeDeleteRowBatch(d, propPath, isArrayIndex), 'Delete');
  });
  actions.appendChild(delBtn);

  valEl.appendChild(actions);

  row.appendChild(keyEl);
  row.appendChild(valEl);

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showPropContextMenu(e.clientX, e.clientY, key, value, type, parentRef, arrayIdx, propPath, row);
  });
  initRowDragDrop(row, dragHandle, key, parentRef, arrayIdx, propPath);

  return row;
}

function collectContainerPaths(obj, parentPath, depth) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    obj.forEach((el, i) => {
      const p = parentPath ? `${parentPath}/[${i}]` : `[${i}]`;
      if (el !== null && typeof el === 'object') {
        out.push({ path: p, depth });
        out.push(...collectContainerPaths(el, p, depth + 1));
      }
    });
  } else {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const p = parentPath ? `${parentPath}/${k}` : k;
      if (v !== null && typeof v === 'object') {
        out.push({ path: p, depth });
        out.push(...collectContainerPaths(v, p, depth + 1));
      }
    }
  }
  return out;
}

function setAllCollapsed(collapsed) {
  const d = docManager.activeDoc;
  if (!d?.root || typeof d.root !== 'object') return;
  markPropTreeStructureDirty();
  propEx().clear();
  propCol().clear();
  const all = collectContainerPaths(d.root, '', 0);
  if (collapsed) {
    for (const k of Object.keys(d.root)) {
      if (d.root[k] !== null && typeof d.root[k] === 'object') propCol().add(k);
    }
  } else {
    all.forEach(({ path, depth }) => {
      if (depth >= 1) propEx().add(path);
    });
  }
  buildPropertyTree();
}

function expandAllChildrenForRow(row) {
  const ch = row.nextElementSibling;
  if (!ch || !ch.classList.contains('prop-row-children')) return;
  markPropTreeStructureDirty();
  const path = row.dataset.propPath;
  const depth = parseInt(row.dataset.depth, 10);
  if (ch.dataset.lazy === '1') {
    ch.removeAttribute('data-lazy');
    const type = row.dataset.type;
    const val = getValueAtPath(docManager.activeDoc.root, path);
    if (type === 'object' && val && typeof val === 'object') renderObjectRows(ch, val, depth + 1, path);
    else if (type === 'array' && Array.isArray(val)) renderArrayRows(ch, val, depth + 1, path);
  }
  propEx().add(path);
  const val = getValueAtPath(docManager.activeDoc.root, path);
  const sub = collectContainerPaths(val && typeof val === 'object' ? val : {}, path, depth);
  sub.forEach(({ path: p }) => propEx().add(p));
  ch.style.display = '';
  const toggle = row.querySelector('.prop-key-toggle');
  if (toggle) setPropKeyToggleIcon(toggle, true, depth === 0);
  buildPropertyTree();
}

function getValueAtPath(root, pathStr) {
  if (!pathStr) return root;
  const parts = pathStr.split('/');
  let cur = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    const m = /^\[(\d+)\]$/.exec(part);
    if (m) cur = cur[parseInt(m[1], 10)];
    else cur = cur[part];
  }
  return cur;
}

function showContextMenu(items, x, y) {
  document.querySelectorAll('.ctx-menu-root').forEach((el) => el.remove());
  const root = document.createElement('div');
  root.className = 'ctx-menu-root';
  root.style.position = 'fixed';
  root.style.left = x + 'px';
  root.style.top = y + 'px';
  root.style.zIndex = '6000';

  items.forEach((it) => {
    if (it.sep) {
      const s = document.createElement('div');
      s.className = 'ctx-sep';
      root.appendChild(s);
      return;
    }
    const row = document.createElement('div');
    row.className = 'ctx-item' + (it.disabled ? ' ctx-item-disabled' : '') + (it.cls ? ' ' + it.cls : '');
    row.innerHTML =
      '<span class="ctx-content">' +
      (it.icon ? '<span class="ctx-icon">' + it.icon + '</span>' : '<span class="ctx-icon-placeholder"></span>') +
      '<span class="ctx-label"></span></span>';
    row.querySelector('.ctx-label').textContent = it.label;
    if (!it.disabled) {
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        it.action();
        root.remove();
      });
    }
    root.appendChild(row);
  });

  document.body.appendChild(root);
  const close = (ev) => {
    if (!root.contains(ev.target)) {
      root.remove();
      document.removeEventListener('mousedown', close, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

function ctxTypeBadgeHtml(type) {
  // Reuse the same filled-circle badges as the property tree key column.
  if (window.VsmartIconCache?.nodeBadgeHtml) {
    if (type === 'array') return window.VsmartIconCache.nodeBadgeHtml('array');
    if (type === 'object') return window.VsmartIconCache.nodeBadgeHtml('object');
  }
  // Fallback: older PNG icons (should still render something).
  return type === 'array' ? ICONS.typeArray : ICONS.typeObject;
}

function showAddKeyDialog(parentRef, parentObjectPath) {
  document.getElementById('addKeyDialog')?.remove();

  const d = docManager.activeDoc;
  if (!d) return;

  const fileName = d.fileName || '';
  const pp = parentObjectPath ?? '';

  let suggestions = [];
  if (typeof VDataSuggestions !== 'undefined' && VDataSuggestions.getSuggestions) {
    suggestions = VDataSuggestions.getSuggestions(fileName, pp);
  }

  const overlay = document.createElement('div');
  overlay.id = 'addKeyDialog';
  overlay.className = 'modal-overlay';

  overlay.innerHTML = `
    <div class="modal-dialog" style="width:340px">
      <div class="modal-header">
        <span class="modal-title">Add Property</span>
        <button type="button" class="modal-close" id="akd-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="modal-row akd-key-row">
          <label class="modal-label" for="akd-key">Key</label>
          <div class="akd-key-field">
            <input id="akd-key" class="prop-input" list="akd-suggestions"
                   placeholder="property_name" autocomplete="off">
            <datalist id="akd-suggestions"></datalist>
          </div>
        </div>
        <div class="modal-row" style="margin-top:6px">
          <label class="modal-label" for="akd-type">Type</label>
          <select id="akd-type" class="prop-input" style="width:120px;flex:0 0 auto">
            <option value="string">string</option>
            <option value="int">int</option>
            <option value="float">float</option>
            <option value="bool">bool</option>
            <option value="object">object {}</option>
            <option value="array">list []</option>
            <option value="vec2">vec2</option>
            <option value="vec3">vec3</option>
            <option value="vec4">vec4</option>
            <option value="color">color</option>
            <option value="resource">resource</option>
            <option value="soundevent">soundevent</option>
            <option value="panorama">panorama</option>
          </select>
        </div>
        <div class="modal-row" style="margin-top:8px;justify-content:flex-end;gap:8px">
          <button type="button" class="btn btn-sm" id="akd-cancel">Cancel</button>
          <button type="button" class="btn btn-sm btn-accent" id="akd-add">Add</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const keyInput = document.getElementById('akd-key');
  const typeInput = document.getElementById('akd-type');
  const datalist = document.getElementById('akd-suggestions');

  suggestions.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.key;
    if (s.hint) opt.label = s.hint;
    datalist.appendChild(opt);
  });

  keyInput.addEventListener('input', () => {
    const match = suggestions.find((s) => s.key === keyInput.value);
    if (match && match.type) typeInput.value = match.type;
  });

  function defaultValueFor(t) {
    switch (t) {
      case 'string':
        return '';
      case 'int':
        return 0;
      case 'float':
        return 0.0;
      case 'bool':
        return false;
      case 'object':
        return {};
      case 'array':
        return [];
      case 'vec2':
        return [0, 0];
      case 'vec3':
        return [0, 0, 0];
      case 'vec4':
        return [0, 0, 0, 0];
      case 'color':
        return [0, 0, 0];
      case 'resource':
        return { type: 'resource_name', value: '' };
      case 'soundevent':
        return { type: 'soundevent', value: '' };
      case 'panorama':
        return { type: 'panorama', value: '' };
      default:
        return '';
    }
  }

  function doAdd() {
    const newKey = keyInput.value.trim();
    if (!newKey) {
      keyInput.focus();
      return;
    }
    if (Object.prototype.hasOwnProperty.call(parentRef, newKey)) {
      setStatus(`Key "${newKey}" already exists`, 'error');
      return;
    }
    const newVal = defaultValueFor(typeInput.value);
    const pathStr = pp ? `${pp}/${newKey}` : newKey;
    withDocUndo({ type: VDataCommands.CMD.ADD_NODE, pathStr, value: newVal }, 'Add key');
    overlay.remove();
  }

  document.getElementById('akd-add').addEventListener('click', doAdd);
  document.getElementById('akd-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('akd-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doAdd();
    }
    if (e.key === 'Escape') overlay.remove();
  });

  requestAnimationFrame(() => keyInput.focus());
}

function showPropContextMenu(x, y, key, value, type, parentRef, arrayIdx, propPath, row) {
  const isContainer = type === 'object' || type === 'array';
  const isArrayIndex = typeof arrayIdx === 'number';
  const items = [
    {
      label: 'Copy value',
      icon: ICONS.copy,
      action: () => navigator.clipboard.writeText(JSON.stringify(value))
    },
    {
      label: 'Paste value',
      icon: ICONS.clipboard,
      action: async () => {
        try {
          const text = await navigator.clipboard.readText();
          const v = JSON.parse(text);
          commitValue(parentRef, key, v, arrayIdx, true, propPath);
        } catch (_) {}
      }
    },
    { sep: true },
    {
      label: 'Duplicate',
      icon: ICONS.duplicate,
      action: () => {
        const d = docManager.activeDoc;
        if (!d) return;
        if (isArrayIndex) {
          withDocUndo(
            makeDuplicateArrayBatch(d, arrayContainerPathFromRowPath(propPath), arrayIdx, deepClone(value)),
            'Duplicate'
          );
        } else {
          let newKey = key + '_copy';
          let n = 1;
          while (Object.prototype.hasOwnProperty.call(parentRef, newKey)) newKey = key + '_copy' + ++n;
          const parentObjPath = parentPathFromRowPath(propPath);
          const newPath = parentObjPath ? `${parentObjPath}/${newKey}` : newKey;
          withDocUndo(
            { type: VDataCommands.CMD.ADD_NODE, pathStr: newPath, value: deepClone(value) },
            'Duplicate'
          );
        }
      }
    },
    {
      label: 'Delete',
      icon: ICONS.trash,
      cls: 'danger',
      action: () => {
        const d = docManager.activeDoc;
        if (!d) return;
        withDocUndo(makeDeleteRowBatch(d, propPath, isArrayIndex), 'Delete');
      }
    },
    { sep: true },
    {
      label: 'Rename key…',
      icon: ICONS.pencil,
      disabled: isArrayIndex,
      action: () => {
        if (isArrayIndex) return;
        const keyEl = row.querySelector('.prop-key');
        const keyText = row.querySelector('.prop-key-text');
        if (!keyEl || !keyText) return;
        startInlineRename(keyEl, keyText, key, parentRef, propPath);
      }
    },
    { sep: true },
    {
      label: 'Copy',
      icon: ICONS.copy,
      action: () => {
        _clipboard = { key, value: deepClone(value), type };
        navigator.clipboard.writeText(JSON.stringify(value, null, 2)).catch(() => {});
      }
    },
    {
      label: 'Paste (replace value)',
      icon: ICONS.clipboard,
      disabled: !_clipboard,
      action: () => {
        if (!_clipboard) return;
        commitValue(parentRef, key, deepClone(_clipboard.value), arrayIdx, true, propPath);
      }
    },
    {
      label: 'Paste as sibling',
      icon: ICONS.clipboard,
      disabled: !_clipboard,
      action: () => {
        if (!_clipboard) return;
        (() => {
          const d = docManager.activeDoc;
          if (!d) return;
          if (isArrayIndex) {
            withDocUndo(
              makeDuplicateArrayBatch(d, arrayContainerPathFromRowPath(propPath), arrayIdx, deepClone(_clipboard.value)),
              'Paste sibling'
            );
          } else {
            let nk = _clipboard.key || 'pasted';
            let n = 1;
            while (Object.prototype.hasOwnProperty.call(parentRef, nk)) nk = nk + '_' + ++n;
            const parentObjPath = parentPathFromRowPath(propPath);
            const newPath = parentObjPath ? `${parentObjPath}/${nk}` : nk;
            withDocUndo(
              { type: VDataCommands.CMD.ADD_NODE, pathStr: newPath, value: deepClone(_clipboard.value) },
              'Paste sibling'
            );
          }
        })();
      }
    },
    { sep: true },
    {
      label: 'Remove duplicates in array',
      icon: ICONS.x,
      disabled: type !== 'array' || !Array.isArray(value),
      action: () => {
        if (type !== 'array' || !Array.isArray(value)) return;
        (() => {
          const d = docManager.activeDoc;
          if (!d) return;
          const seen = new Set();
          const next = value.filter((item) => {
            const k = JSON.stringify(item);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          withDocUndo(makeRemoveArrayDupesBatch(d, propPath, value, next), 'Remove duplicates');
        })();
      }
    },
    { sep: true },
    {
      label: 'Add object here…',
      icon: ctxTypeBadgeHtml('object'),
      disabled: isArrayIndex,
      action: () => {
        (() => {
          let nk = 'new_object';
          let n = 1;
          while (Object.prototype.hasOwnProperty.call(parentRef, nk)) nk = 'new_object_' + ++n;
          const parentObjPath = parentPathFromRowPath(propPath);
          const newPath = parentObjPath ? `${parentObjPath}/${nk}` : nk;
          withDocUndo({ type: VDataCommands.CMD.ADD_NODE, pathStr: newPath, value: {} }, 'Add object');
        })();
      }
    },
    {
      label: 'Add list here…',
      icon: ctxTypeBadgeHtml('array'),
      disabled: isArrayIndex,
      action: () => {
        (() => {
          let nk = 'new_list';
          let n = 1;
          while (Object.prototype.hasOwnProperty.call(parentRef, nk)) nk = 'new_list_' + ++n;
          const parentObjPath = parentPathFromRowPath(propPath);
          const newPath = parentObjPath ? `${parentObjPath}/${nk}` : nk;
          withDocUndo({ type: VDataCommands.CMD.ADD_NODE, pathStr: newPath, value: [] }, 'Add list');
        })();
      }
    },
    { sep: true }
  ];
  if (isContainer) {
    items.push({
      label: 'Toggle collapse',
      action: () => row.querySelector('.prop-key-toggle')?.click()
    });
    items.push({
      label: 'Expand branch',
      action: () => expandAllChildrenForRow(row)
    });
  }
  items.push({
    label: 'Add child',
    icon: ICONS.plus,
    disabled: !isContainer,
    action: () => {
      if (!isContainer) return;
      (() => {
        if (type === 'array') {
          const insertPath = `${propPath}/[${value.length}]`;
          withDocUndo({ type: VDataCommands.CMD.ADD_NODE, pathStr: insertPath, value: '' }, 'Add child');
        } else {
          let nk = 'new_key';
          let n = 1;
          while (Object.prototype.hasOwnProperty.call(value, nk)) nk = 'new_key_' + ++n;
          const newPath = `${propPath}/${nk}`;
          withDocUndo({ type: VDataCommands.CMD.ADD_NODE, pathStr: newPath, value: '' }, 'Add child');
        }
      })();
    }
  });
  items.push({ sep: true });
  items.push({
    label: 'Copy property path',
    action: () => navigator.clipboard.writeText(propPath)
  });

  items.push({
    label: 'Reveal in manual editor',
    action: () => {
      revealManualEditorFromPropPath(propPath);
    }
  });

  showContextMenu(items, x, y);
}

/** Value / key controls inside a property row — row drag-reorder must not steal drags or drops here. */
function isPropRowDragExemptTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  return (
    el.closest(
      'input, textarea, button, select, ' +
        '.prop-key-toggle, ' +
        '.prop-row-drag-handle, ' +
        '.slider-input-wrap, ' +
        '.prop-color-swatch, ' +
        '.components-widget, ' +
        '.prop-row-actions'
    ) != null
  );
}

/** True if `dstPath` is the moved node or a descendant (cannot reparent into self). */
function propPathIsUnderOrEqual(ancestorPath, candidatePath) {
  if (!ancestorPath || !candidatePath) return candidatePath === ancestorPath;
  return candidatePath === ancestorPath || candidatePath.startsWith(ancestorPath + '/');
}

function movedKeyNameForObject(src) {
  if (typeof src.key === 'string' && /^\[\d+\]$/.test(src.key)) return 'moved';
  if (typeof src.key === 'string' && src.key.length) return src.key;
  return 'moved';
}

function collectPropTreeStateUnder(pathPrefix) {
  const oldPrefix = pathPrefix + '/';
  return {
    ex: [...propEx()].filter((p) => p === pathPrefix || p.startsWith(oldPrefix)),
    col: [...propCol()].filter((p) => p === pathPrefix || p.startsWith(oldPrefix))
  };
}

function restorePropTreeStateUnder(oldPrefix, newPrefix, snapshot) {
  const oldWithSlash = oldPrefix + '/';
  const newWithSlash = newPrefix + '/';
  (snapshot.ex || []).forEach((p) => {
    if (p === oldPrefix) propEx().add(newPrefix);
    else if (p.startsWith(oldWithSlash)) propEx().add(newWithSlash + p.slice(oldWithSlash.length));
  });
  (snapshot.col || []).forEach((p) => {
    if (p === oldPrefix) propCol().add(newPrefix);
    else if (p.startsWith(oldWithSlash)) propCol().add(newWithSlash + p.slice(oldWithSlash.length));
  });
}

function isMovePropIntoContainerAllowed(src, dstContainerPath, dstType) {
  const root = docManager.activeDoc?.root;
  if (!root || !src?.propPath || !dstContainerPath) return false;
  if (src.propPath === dstContainerPath) return false;
  if (propPathIsUnderOrEqual(src.propPath, dstContainerPath)) return false;

  const target = getValueAtPath(root, dstContainerPath);
  if (!target || typeof target !== 'object') return false;
  if (dstType === 'array' && !Array.isArray(target)) return false;
  if (dstType === 'object' && Array.isArray(target)) return false;

  const srcParentPath = parentPathFromRowPath(src.propPath);
  const srcParent = getValueAtPath(root, srcParentPath);
  if (srcParent == null || typeof srcParent !== 'object') return false;

  if (typeof src.arrayIdx === 'number') {
    if (!Array.isArray(srcParent)) return false;
    if (src.arrayIdx < 0 || src.arrayIdx >= srcParent.length) return false;
  } else {
    if (typeof src.key !== 'string' || !Object.prototype.hasOwnProperty.call(srcParent, src.key)) return false;
  }
  return true;
}

/** Mutates doc root — caller must wrap in `withDocUndoRootPair`. */
function mutateMovePropIntoContainer(src, dstContainerPath, dstType) {
  const root = docManager.activeDoc?.root;
  if (!root) return;
  const target = getValueAtPath(root, dstContainerPath);
  const srcParentPath = parentPathFromRowPath(src.propPath);
  const srcParent = getValueAtPath(root, srcParentPath);
  const movedTreeState = collectPropTreeStateUnder(src.propPath);
  let moved;
  let movedNewPath = '';
  if (typeof src.arrayIdx === 'number') {
    moved = deepClone(srcParent[src.arrayIdx]);
    invalidatePropTreePathsForArrayContainer(arrayContainerPathFromRowPath(src.propPath));
    srcParent.splice(src.arrayIdx, 1);
  } else {
    moved = deepClone(srcParent[src.key]);
    invalidatePropTreePathsUnderObjectKey(src.propPath);
    delete srcParent[src.key];
  }

  if (dstType === 'array' && Array.isArray(target)) {
    invalidatePropTreePathsForArrayContainer(dstContainerPath);
    target.push(moved);
    movedNewPath = `${dstContainerPath}/[${target.length - 1}]`;
  } else {
    let nk = movedKeyNameForObject(src);
    const base = nk;
    let n = 1;
    while (Object.prototype.hasOwnProperty.call(target, nk)) nk = base + '_' + ++n;
    invalidatePropTreePathsUnderObjectKey(dstContainerPath);
    target[nk] = moved;
    movedNewPath = `${dstContainerPath}/${nk}`;
  }
  if (movedNewPath) restorePropTreeStateUnder(src.propPath, movedNewPath, movedTreeState);
}

/**
 * Move a property from its current parent into an object or array row's value.
 * @returns {boolean} true if handled
 */
function movePropIntoContainer(src, dstContainerPath, dstType) {
  if (!isMovePropIntoContainerAllowed(src, dstContainerPath, dstType)) return false;
  withDocUndoRootPair(() => {
    mutateMovePropIntoContainer(src, dstContainerPath, dstType);
  }, 'Move into');
  return true;
}

function batchMovePropIntoContainers(items, dstContainerPath, dstType) {
  if (!items || !items.length) return false;
  for (let i = 0; i < items.length; i++) {
    if (!isMovePropIntoContainerAllowed(items[i], dstContainerPath, dstType)) return false;
  }
  const sorted = [...items].sort((a, b) => b.propPath.length - a.propPath.length);
  withDocUndoRootPair(() => {
    for (let j = 0; j < sorted.length; j++) {
      mutateMovePropIntoContainer(sorted[j], dstContainerPath, dstType);
    }
  }, 'Move into');
  return true;
}

function parseRowDragPayload(dt) {
  const raw = dt.getData('application/x-vdata-row') || dt.getData('text/plain');
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && o.kind === 'vdata-row-multi' && Array.isArray(o.items) && o.items.length) return o;
    if (o && o.propPath) return o;
  } catch (_) {
    return null;
  }
  return null;
}

function dataTransferIsBrowserSuggestion(dt) {
  if (!dt || !dt.types) return false;
  if (typeof dt.types.includes === 'function') return dt.types.includes(PROP_SUGGESTION_MIME);
  for (let i = 0; i < dt.types.length; i++) if (dt.types[i] === PROP_SUGGESTION_MIME) return true;
  return false;
}

function parseBrowserDragPayload(dt) {
  if (!dt) return null;
  const raw = dt.getData(PROP_SUGGESTION_MIME);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && o.kind === 'vdata-property-suggestion' && typeof o.key === 'string') return o;
  } catch (_) {}
  return null;
}

const PROP_DROP_ZONE_BEFORE = 'before';
const PROP_DROP_ZONE_AFTER = 'after';
const PROP_DROP_ZONE_INTO = 'into';

function clearPropDropZoneClasses(row) {
  row.classList.remove('drag-over', 'drag-over-before', 'drag-over-after', 'drag-over-into');
}

function setPropDropZoneClass(row, zone) {
  clearPropDropZoneClasses(row);
  if (zone === PROP_DROP_ZONE_BEFORE) row.classList.add('drag-over', 'drag-over-before');
  else if (zone === PROP_DROP_ZONE_AFTER) row.classList.add('drag-over', 'drag-over-after');
  else if (zone === PROP_DROP_ZONE_INTO) row.classList.add('drag-over', 'drag-over-into');
}

function detectRowDropZone(row, evt) {
  const rect = row.getBoundingClientRect();
  const y = evt.clientY - rect.top;
  const h = rect.height || 1;
  const edge = Math.max(4, Math.min(10, h * 0.25));
  const dstType = row.dataset.type;
  const canDropInto = dstType === 'object' || dstType === 'array';
  if (y < edge) return PROP_DROP_ZONE_BEFORE;
  if (y > h - edge) return PROP_DROP_ZONE_AFTER;
  return canDropInto ? PROP_DROP_ZONE_INTO : PROP_DROP_ZONE_AFTER;
}

function autoScrollPropTreeOnDrag(evt) {
  const root = document.getElementById('propTreeRoot');
  if (!root) return;
  const rect = root.getBoundingClientRect();
  const threshold = 28;
  const speed = 14;
  if (evt.clientY < rect.top + threshold) root.scrollTop -= speed;
  else if (evt.clientY > rect.bottom - threshold) root.scrollTop += speed;
}

function batchReorderPropSameParent(parentRef, items, dst, dropZone) {
  if (!items || items.length < 2) return false;
  if (Array.isArray(parentRef)) return false;
  const keys = items.map((i) => i.key);
  if (keys.some((k) => typeof k !== 'string')) return false;
  if (typeof dst.key !== 'string') return false;
  withDocUndoRootPair(() => {
    reorderObjectKeysBlock(parentRef, keys, dst.key, dropZone === PROP_DROP_ZONE_AFTER);
  }, 'Reorder');
  return true;
}

function initRowDragDrop(row, dragHandle, key, parentRef, arrayIdx, propPath) {
  dragHandle.addEventListener('dragstart', (e) => {
    const items = collectSelectedRowDragItems(propPath, key, arrayIdx);
    const payload =
      items.length > 1
        ? JSON.stringify({ kind: 'vdata-row-multi', items })
        : JSON.stringify({
            key,
            arrayIdx: typeof arrayIdx === 'number' ? arrayIdx : null,
            propPath
          });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-vdata-row', payload);
    e.dataTransfer.setData('text/plain', payload);
    document.querySelectorAll('#propTreeRoot .prop-row').forEach((r) => {
      if (items.some((it) => it.propPath === r.dataset.propPath)) r.classList.add('drag-source');
    });
  });
  dragHandle.addEventListener('dragend', () => {
    clearPropDropZoneClasses(row);
    document.querySelectorAll('#propTreeRoot .prop-row.drag-source').forEach((r) => r.classList.remove('drag-source'));
  });
  row.addEventListener('dragover', (e) => {
    if (dataTransferIsBrowserSuggestion(e.dataTransfer)) {
      const zone = detectRowDropZone(row, e);
      const d = docManager.activeDoc;
      const rowPath = row.dataset.propPath;
      if (zone === PROP_DROP_ZONE_INTO && row.dataset.type === 'object') {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        autoScrollPropTreeOnDrag(e);
        setPropDropZoneClass(row, zone);
        return;
      }
      if (
        (zone === PROP_DROP_ZONE_BEFORE || zone === PROP_DROP_ZONE_AFTER) &&
        objectKeyFromPropPath(rowPath) != null &&
        d &&
        d.root
      ) {
        const pp = parentPathFromRowPath(rowPath);
        const po = pp ? getValueAtPath(d.root, pp) : d.root;
        if (po && typeof po === 'object' && !Array.isArray(po)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          autoScrollPropTreeOnDrag(e);
          setPropDropZoneClass(row, zone);
          return;
        }
      }
      clearPropDropZoneClasses(row);
      return;
    }
    if (isPropRowDragExemptTarget(e.target)) {
      clearPropDropZoneClasses(row);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    autoScrollPropTreeOnDrag(e);
    const zone = detectRowDropZone(row, e);
    setPropDropZoneClass(row, zone);
  });
  row.addEventListener('dragleave', () => clearPropDropZoneClasses(row));
  row.addEventListener('drop', (e) => {
    const sug = parseBrowserDragPayload(e.dataTransfer);
    if (sug) {
      e.preventDefault();
      e.stopPropagation();
      const dropZone = detectRowDropZone(row, e);
      clearPropDropZoneClasses(row);
      const dstType = row.dataset.type;
      const d = docManager.activeDoc;
      const rowPath = row.dataset.propPath;
      if (dropZone === PROP_DROP_ZONE_INTO && dstType === 'object') {
        addSuggestedPropertyAtPath(sug.key, propPath, sug.type);
        return;
      }
      if ((dropZone === PROP_DROP_ZONE_BEFORE || dropZone === PROP_DROP_ZONE_AFTER) && d && d.root) {
        const refKey = objectKeyFromPropPath(rowPath);
        const parentPath = parentPathFromRowPath(rowPath);
        if (refKey == null) {
          setStatus('Cannot add property next to this row', 'error');
          return;
        }
        const parentObj = parentPath ? getValueAtPath(d.root, parentPath) : d.root;
        if (!parentObj || typeof parentObj !== 'object' || Array.isArray(parentObj)) {
          setStatus('Cannot add property here', 'error');
          return;
        }
        addSuggestedPropertyAtPath(sug.key, parentPath, sug.type, {
          referenceKey: refKey,
          placeAfter: dropZone === PROP_DROP_ZONE_AFTER
        });
      }
      return;
    }
    if (isPropRowDragExemptTarget(e.target)) return;
    e.preventDefault();
    const dropZone = detectRowDropZone(row, e);
    clearPropDropZoneClasses(row);
    const parsed = parseRowDragPayload(e.dataTransfer);
    if (!parsed) return;

    if (parsed.kind === 'vdata-row-multi') {
      const items = parsed.items;
      const blocked = items.some((it) => it.propPath === propPath);
      if (blocked) return;
      const dstType = row.dataset.type;
      if (dropZone === PROP_DROP_ZONE_INTO && (dstType === 'object' || dstType === 'array')) {
        batchMovePropIntoContainers(items, propPath, dstType);
        return;
      }
      if (parentPathFromRowPath(items[0].propPath) !== parentPathFromRowPath(propPath)) return;
      if (batchReorderPropSameParent(parentRef, items, { key, arrayIdx, propPath }, dropZone)) return;
      return;
    }

    const src = parsed;
    if (!src || !src.propPath) return;
    if (src.propPath === propPath) return;

    const dstType = row.dataset.type;
    if (dropZone === PROP_DROP_ZONE_INTO && (dstType === 'object' || dstType === 'array') && movePropIntoContainer(src, propPath, dstType)) {
      return;
    }

    if (parentPathFromRowPath(src.propPath) !== parentPathFromRowPath(propPath)) return;
    reorderProp(parentRef, src, { key, arrayIdx, propPath }, dropZone);
  });
}

function reorderProp(parentRef, src, dst, dropZone) {
  const placeAfter = dropZone === PROP_DROP_ZONE_AFTER;
  if (Array.isArray(parentRef)) {
    const si = src.arrayIdx;
    const di = dst.arrayIdx;
    if (typeof si !== 'number' || typeof di !== 'number') return;
    const insertBase = di + (placeAfter ? 1 : 0);
    const insert = si < insertBase ? insertBase - 1 : insertBase;
    if (si === insert) return;
    withDocUndoRootPair(() => {
      invalidatePropTreePathsForArrayContainer(arrayContainerPathFromRowPath(dst.propPath || ''));
      const [item] = parentRef.splice(si, 1);
      parentRef.splice(insert, 0, item);
    }, 'Reorder');
    return;
  }
  if (typeof src.key !== 'string' || typeof dst.key !== 'string') return;
  if (src.key === dst.key) return;
  withDocUndoRootPair(() => {
    const entries = Object.entries(parentRef);
    const srcIdx = entries.findIndex(([k]) => k === src.key);
    const dstIdx = entries.findIndex(([k]) => k === dst.key);
    if (srcIdx < 0 || dstIdx < 0) return;
    const [entry] = entries.splice(srcIdx, 1);
    const insertBase = dstIdx + (placeAfter ? 1 : 0);
    const insert = srcIdx < insertBase ? insertBase - 1 : insertBase;
    entries.splice(insert, 0, entry);
    for (const k of Object.keys(parentRef)) delete parentRef[k];
    for (const [k, v] of entries) parentRef[k] = v;
  }, 'Reorder');
}

function startInlineRename(keyEl, keyTextSpan, oldKey, parentRef, propPath) {
  if (keyEl.querySelector('.prop-key-rename')) return;

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'prop-key-rename';
  inp.value = oldKey;

  let renameListEl = null;
  const d = docManager.activeDoc;
  const parentObjectPath = parentPathFromRowPath(propPath || oldKey);
  let keySuggestions = [];
  if (d && typeof VDataSuggestions !== 'undefined' && VDataSuggestions.getSuggestions) {
    try {
      keySuggestions = VDataSuggestions
        .getSuggestions(d.fileName || '', parentObjectPath)
        .map((s) => s.key)
        .filter((k) => typeof k === 'string' && k.length);
    } catch (_) {}
  }
  if (keySuggestions.length) {
    const listId = 'prop-key-rename-sug-' + ++_propKeyRenameSuggestSeq;
    renameListEl = document.createElement('datalist');
    renameListEl.id = listId;
    const seen = new Set();
    keySuggestions.forEach((k) => {
      if (seen.has(k)) return;
      seen.add(k);
      const opt = document.createElement('option');
      opt.value = k;
      renameListEl.appendChild(opt);
    });
    inp.setAttribute('list', listId);
    inp.setAttribute('autocomplete', 'off');
    keyEl.appendChild(renameListEl);
  }

  keyTextSpan.replaceWith(inp);
  inp.focus();
  inp.select();

  let aborted = false;

  function commit() {
    if (aborted) return;
    const newKey = inp.value.trim();
    if (renameListEl) renameListEl.remove();
    inp.replaceWith(keyTextSpan);
    if (!newKey || newKey === oldKey) {
      keyTextSpan.textContent = oldKey;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(parentRef, newKey)) {
      keyTextSpan.textContent = oldKey;
      setStatus(`Key "${newKey}" already exists`, 'error');
      return;
    }

    const d = docManager.activeDoc;
    if (!d) return;

    const row = keyEl.closest('.prop-row');
    const oldPath = row?.dataset?.propPath ?? oldKey;
    const prefix = parentPathFromRowPath(oldPath);
    const newPath = prefix ? `${prefix}/${newKey}` : newKey;
    const oldPrefix = oldPath + '/';
    const newPrefix = newPath + '/';

    withDocUndoRootPair(() => {
      const entries = Object.entries(parentRef);
      for (const [k] of entries) delete parentRef[k];
      for (const [k, v] of entries) {
        parentRef[k === oldKey ? newKey : k] = v;
      }

      for (const set of [propEx(), propCol()]) {
        for (const p of [...set]) {
          if (p === oldPath) {
            set.delete(p);
            set.add(newPath);
          } else if (p.startsWith(oldPrefix)) {
            set.delete(p);
            set.add(newPrefix + p.slice(oldPrefix.length));
          }
        }
      }
    }, `Rename: ${oldKey}`);

    setStatus('Key renamed', 'edited');
  }

  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inp.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      aborted = true;
      inp.removeEventListener('blur', commit);
      if (renameListEl) renameListEl.remove();
      inp.replaceWith(keyTextSpan);
      keyTextSpan.textContent = oldKey;
    }
  });
}

function buildBoolWidget(container, value, onChange) {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'prop-input-bool';
  cb.checked = !!value;
  cb.addEventListener('change', () => onChange(cb.checked));
  container.appendChild(cb);
}

function buildNumberWidget(container, value, type, onChange, sliderOpts) {
  container.appendChild(buildSliderInput(value, type, onChange, sliderOpts || {}));
}

function buildReadonlyStringWidget(container, value) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'prop-input';
  inp.readOnly = true;
  inp.value = value == null ? '' : String(value);
  inp.title = 'Read-only';
  container.appendChild(inp);
}

function buildFloatSlider01Widget(container, value, onChange, sliderOpts) {
  const v = typeof value === 'number' ? value : parseFloat(value) || 0;
  container.appendChild(
    buildSliderInput(
      v,
      'float',
      (nv) => onChange(nv),
      { clamp01: true, ...(sliderOpts || {}) }
    )
  );
}

function buildComponentsWidget(arr, onChange, sliderOpts) {
  const wrap = document.createElement('div');
  wrap.className = 'components-widget';
  const labels = ['X', 'Y', 'Z'];
  const axes = ['x', 'y', 'z'];
  const list = Array.isArray(arr) && arr.length === 3 ? arr : [0, 0, 0];

  list.forEach((item, i) => {
    const isExpr =
      item !== null && typeof item === 'object' && !Array.isArray(item) && Object.prototype.hasOwnProperty.call(item, 'm_Expression');

    const cell = document.createElement('div');
    cell.className = 'components-cell';

    const lbl = document.createElement('span');
    lbl.className = 'components-label components-label-' + axes[i];
    lbl.textContent = labels[i];

    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'btn btn-sm btn-icon components-mode-btn';
    modeBtn.title = isExpr ? 'Expression — click for literal' : 'Literal — click for expression';
    modeBtn.innerHTML = isExpr ? ICONS.bracesCurly : ICONS.typeFloat;
    modeBtn.setAttribute('data-mode', isExpr ? 'expr' : 'literal');

    let inputEl;
    if (isExpr) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'prop-input components-expr-input';
      inp.value = item.m_Expression ?? '';
      inp.placeholder = 'expression…';
      inp.addEventListener('change', () => {
        const newArr = [...list];
        newArr[i] = { m_Expression: inp.value };
        onChange(newArr);
      });
      inputEl = inp;
    } else {
      const num = typeof item === 'number' ? item : parseFloat(item) || 0;
      inputEl = buildSliderInput(num, 'float', (v) => {
        const newArr = [...list];
        newArr[i] = v;
        onChange(newArr);
      }, sliderOpts);
    }

    modeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newArr = [...list];
      if (modeBtn.getAttribute('data-mode') === 'literal') {
        newArr[i] = { m_Expression: '' };
      } else {
        newArr[i] = 0;
      }
      onChange(newArr);
    });

    cell.appendChild(lbl);
    cell.appendChild(modeBtn);
    cell.appendChild(inputEl);
    wrap.appendChild(cell);
  });

  return wrap;
}

let _propStrSuggestSeq = 0;
let _propKeyRenameSuggestSeq = 0;

function schemaCtxForPropertyTree() {
  const d = docManager.activeDoc;
  if (!d || !window.VDataEditorModes?.getSuggestionContext) {
    const fn = d?.fileName || '';
    const m = /\.([a-z0-9]+)$/i.exec(fn);
    return {
      modeId: 'generic',
      fileExt: m ? m[1].toLowerCase() : '',
      genericDataType: d?.root?.generic_data_type ?? '',
      liveRoot: d?.root || null
    };
  }
  const ctx = window.VDataEditorModes.getSuggestionContext(d.fileName, d.root) || {};
  ctx.liveRoot = d.root || null;
  return ctx;
}

function buildStringWidget(container, value, onChange, options) {
  const opts = options || {};
  const listVals = opts.suggestedValues;
  if (Array.isArray(listVals) && listVals.length) {
    const listId = 'prop-str-sug-' + ++_propStrSuggestSeq;
    const list = document.createElement('datalist');
    list.id = listId;
    for (let i = 0; i < listVals.length; i++) {
      const o = document.createElement('option');
      o.value = String(listVals[i]);
      list.appendChild(o);
    }
    container.appendChild(list);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'prop-input';
    inp.setAttribute('list', listId);
    inp.setAttribute('autocomplete', 'off');
    inp.value = value == null ? '' : String(value);
    inp.addEventListener('change', () => onChange(inp.value));
    container.appendChild(inp);
    return;
  }
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'prop-input';
  inp.value = value == null ? '' : String(value);
  inp.addEventListener('change', () => onChange(inp.value));
  container.appendChild(inp);
}

function typedResourceDisplay(value, kind) {
  if (value && typeof value === 'object' && value.type === kind && typeof value.value === 'string') return value.value;
  if (typeof value === 'string' && value.startsWith(kind + ':"')) {
    const inner = value.slice(kind.length + 2);
    if (inner.endsWith('"')) return inner.slice(0, -1).replace(/\\"/g, '"');
  }
  return typeof value === 'string' ? value : '';
}

function buildResourceWidget(container, value, prefix, onChange) {
  const raw = typedResourceDisplay(value, prefix);
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'prop-input';
  inp.value = raw;
  inp.addEventListener('change', () => {
    onChange({ type: prefix, value: inp.value });
  });

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'prop-resource-btn';
  btn.textContent = prefix === 'soundevent' ? '🔊' : '📁';
  btn.title =
    prefix === 'soundevent' ? 'Pick sound asset' : prefix === 'panorama' ? 'Panorama path' : 'Pick resource file';
  btn.addEventListener('click', async () => {
    if (!window.electronAPI?.pickResourceFile) return;
    const doc = docManager.activeDoc;
    const fp = doc?.filePath;
    const baseDir =
      typeof fp === 'string' && fp.length ? fp.replace(/[/\\][^/\\]+$/, '') : undefined;
    const filters =
      prefix === 'soundevent'
        ? [{ name: 'Sound', extensions: ['vsndevts', 'vsndstck', 'wav', 'mp3'] }]
        : prefix === 'panorama'
          ? [
              {
                name: 'Images / layouts',
                extensions: ['png', 'jpg', 'jpeg', 'psd', 'svg', 'vgui', 'xml']
              }
            ]
          : [{ name: 'Models / particles / materials', extensions: ['vmdl', 'vpcf', 'vnmskel', 'vmat', 'vmdl_c'] }];
    const rel = await window.electronAPI.pickResourceFile({
      defaultPath: baseDir,
      relativeTo: baseDir,
      filters
    });
    if (rel == null) return;
    inp.value = rel;
    onChange({ type: prefix, value: rel });
  });

  container.appendChild(inp);
  container.appendChild(btn);
}

function buildColorWidget(container, value, onChange) {
  const arr = Array.isArray(value) ? [...value] : [0, 0, 0];
  const toHex = (a) =>
    '#' + a.slice(0, 3).map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
  const fromHex = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  };

  const swatch = document.createElement('div');
  swatch.className = 'prop-color-swatch';
  swatch.style.background = toHex(arr);

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.className = 'prop-color-input';
  picker.value = toHex(arr);
  picker.setAttribute('aria-hidden', 'true');

  const numInputs = [];

  picker.addEventListener('input', () => {
    swatch.style.background = picker.value;
    const rgb = fromHex(picker.value);
    numInputs.forEach((num, i) => {
      if (i < 3) {
        arr[i] = rgb[i];
        num.value = String(rgb[i]);
      }
    });
  });

  picker.addEventListener('change', () => {
    const next = [...arr];
    onChange(next);
  });

  swatch.addEventListener('click', () => picker.click());
  container.appendChild(swatch);
  container.appendChild(picker);

  arr.forEach((ch, i) => {
    if (i > 3) return;
    const label = ['R', 'G', 'B', 'A'][i];
    const span = document.createElement('span');
    span.className = 'prop-type-badge';
    span.textContent = label;
    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'prop-input';
    num.style.width = '42px';
    num.style.flex = 'none';
    num.min = 0;
    num.max = 255;
    num.step = 1;
    num.value = String(ch);
    numInputs.push(num);
    num.addEventListener('change', () => {
      const nv = Math.max(0, Math.min(255, parseInt(num.value, 10) || 0));
      arr[i] = nv;
      const next = [...arr];
      picker.value = toHex(next);
      swatch.style.background = picker.value;
      onChange(next);
    });
    container.appendChild(span);
    container.appendChild(num);
  });
}

function buildVec3Widget(container, keyName, value, onChange, sliderOpts) {
  const v = Array.isArray(value) ? [...value] : [0, 0, 0];
  const wrapAll = document.createElement('div');
  wrapAll.className = 'vec-widget vec-widget-3d';
  const shapeUtils = window?.VDataKV3ShapeUtils;
  const labels = shapeUtils?.getVectorLabels?.(keyName, 3) || ['X', 'Y', 'Z'];
  labels.forEach((axisLabel, i) => {
    const row = document.createElement('div');
    row.className = 'vec-axis-row vec3-axis-row';
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge vec-axis-label';
    lbl.textContent = axisLabel;
    const wrap = buildSliderInput(v[i], 'float', (nv) => {
      v[i] = nv;
      onChange([...v]);
    }, sliderOpts);
    wrap.classList.add('vec-axis-control');
    row.appendChild(lbl);
    row.appendChild(wrap);
    wrapAll.appendChild(row);
  });
  container.appendChild(wrapAll);
}

function buildVec2Widget(container, keyName, value, onChange, sliderOpts) {
  const v = Array.isArray(value) ? [...value] : [0, 0];
  const wrapAll = document.createElement('div');
  wrapAll.className = 'vec-widget vec-widget-2d';
  const shapeUtils = window?.VDataKV3ShapeUtils;
  const labels = shapeUtils?.getVectorLabels?.(keyName, 2) || ['X', 'Y'];
  labels.forEach((axisLabel, i) => {
    const row = document.createElement('div');
    row.className = 'vec-axis-row vec2-axis-row';
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge vec-axis-label';
    lbl.textContent = axisLabel;
    const wrap = buildSliderInput(v[i], 'float', (nv) => {
      v[i] = nv;
      onChange([...v]);
    }, sliderOpts);
    wrap.classList.add('vec-axis-control');
    row.appendChild(lbl);
    row.appendChild(wrap);
    wrapAll.appendChild(row);
  });
  container.appendChild(wrapAll);
}

function buildVec4Widget(container, keyName, value, onChange, sliderOpts) {
  const v = Array.isArray(value) ? [...value] : [0, 0, 0, 0];
  const wrapAll = document.createElement('div');
  wrapAll.className = 'vec-widget vec-widget-4d';
  const shapeUtils = window?.VDataKV3ShapeUtils;
  const labels = shapeUtils?.getVectorLabels?.(keyName, 4) || ['X', 'Y', 'Z', 'W'];
  labels.forEach((axisLabel, i) => {
    const row = document.createElement('div');
    row.className = 'vec-axis-row vec4-axis-row';
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge vec-axis-label';
    lbl.textContent = axisLabel;
    const wrap = buildSliderInput(v[i], 'float', (nv) => {
      v[i] = nv;
      onChange([...v]);
    }, sliderOpts);
    wrap.classList.add('vec-axis-control');
    row.appendChild(lbl);
    row.appendChild(wrap);
    wrapAll.appendChild(row);
  });
  container.appendChild(wrapAll);
}

function commitValue(parentRef, key, newValue, arrayIdx, isStructural, propPath) {
  if (!propPath || typeof VDataCommands === 'undefined') return;
  const useIdx = arrayIdx !== undefined && arrayIdx !== null && Array.isArray(parentRef);
  const prev = useIdx ? parentRef[arrayIdx] : parentRef[key];
  const prevCopy = cloneUndoValue(prev);
  const cmd = VDataCommands.setValueCommand(propPath, prevCopy, newValue, !!isStructural);
  withDocUndo(cmd, `Edit: ${key}`);
}

function filterPropTree(query) {
  const rows = document.querySelectorAll('#propTreeRoot .prop-row');

  rows.forEach((row) => {
    if (!query) {
      row.classList.remove('search-hidden', 'search-match');
      return;
    }
    const keyText = row.querySelector('.prop-key')?.textContent?.toLowerCase() ?? '';
    const inp = row.querySelector('.prop-input');
    const valText = (inp && 'value' in inp ? inp.value : '')?.toLowerCase?.() ?? '';
    const rest = row.querySelector('.prop-value')?.textContent?.toLowerCase() ?? '';
    const match = keyText.includes(query) || valText.includes(query) || rest.includes(query);
    row.classList.toggle('search-match', match);
    row.classList.toggle('search-hidden', !match);
  });

  if (query) {
    document.querySelectorAll('#propTreeRoot .prop-row.search-match').forEach((row) => {
      let el = row.parentElement;
      while (el && el.id !== 'propTreeRoot') {
        if (el.classList.contains('prop-row-children') && el.style.display === 'none') {
          const parentRow = el.previousElementSibling;
          if (el.dataset.lazy === '1') {
            el.removeAttribute('data-lazy');
            if (parentRow) {
              const pPath = parentRow.dataset.propPath;
              const pDepth = parseInt(parentRow.dataset.depth ?? '0', 10);
              const pType = parentRow.dataset.type;
              const pVal = getValueAtPath(docManager.activeDoc?.root, pPath);
              if (pType === 'object' && pVal && typeof pVal === 'object')
                renderObjectRows(el, pVal, pDepth + 1, pPath);
              else if (pType === 'array' && Array.isArray(pVal)) renderArrayRows(el, pVal, pDepth + 1, pPath);
            }
          }
          el.style.display = '';
          if (parentRow?.dataset?.propPath != null) {
            const pp = parentRow.dataset.propPath;
            const dep = parseInt(parentRow.dataset.depth ?? '0', 10);
            if (dep === 0) propCol().delete(pp);
            else propEx().add(pp);
          }
          const toggle = parentRow?.querySelector('.prop-key-toggle');
          if (toggle) setPropKeyToggleIcon(toggle, true, dep === 0);
        }
        el = el.parentElement;
      }
    });
  }

  stripePropTree();
}

const PROP_TREE_KEY_COL_STORAGE = 'vdata_prop_tree_key_col_v1';
const PROP_TREE_KEY_COL_PREF_MIN = 120;
const PROP_TREE_VAL_COL_MIN = 100;
const PROP_TREE_GRID_GAP = 8;
const PROP_TREE_H_PAD = 16;

function parsePropTreeKeyColPx(panel) {
  const inline = panel.style.getPropertyValue('--prop-tree-key-col').trim();
  if (inline) {
    const n = parseFloat(inline);
    if (Number.isFinite(n)) return n;
  }
  const cs = getComputedStyle(panel).getPropertyValue('--prop-tree-key-col').trim();
  const n2 = parseFloat(cs);
  return Number.isFinite(n2) ? n2 : 180;
}

function clampPropTreeKeyCol(panel, px) {
  const maxKey = Math.max(
    0,
    panel.clientWidth - PROP_TREE_H_PAD - PROP_TREE_GRID_GAP - PROP_TREE_VAL_COL_MIN
  );
  const minKey = Math.min(PROP_TREE_KEY_COL_PREF_MIN, maxKey);
  return Math.min(Math.max(minKey, px), Math.max(minKey, maxKey));
}

function initPropTreeColumnResize() {
  const panel = document.getElementById('propsContainer');
  const resizer = panel?.querySelector('.prop-tree-col-resizer');
  if (!panel || !resizer || resizer.dataset.bound) return;
  resizer.dataset.bound = '1';

  function applyStoredWidth() {
    try {
      const raw = localStorage.getItem(PROP_TREE_KEY_COL_STORAGE);
      if (raw == null) return;
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || panel.clientWidth < 48) return;
      panel.style.setProperty('--prop-tree-key-col', clampPropTreeKeyCol(panel, n) + 'px');
    } catch (_) {}
  }
  applyStoredWidth();
  if (panel.clientWidth < 48) requestAnimationFrame(applyStoredWidth);

  let startX;
  let startW;
  function onMove(e2) {
    const next = clampPropTreeKeyCol(panel, startW + (e2.clientX - startX));
    panel.style.setProperty('--prop-tree-key-col', next + 'px');
  }
  function onUp() {
    resizer.classList.remove('active');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const px = Math.round(parsePropTreeKeyColPx(panel));
    try {
      localStorage.setItem(PROP_TREE_KEY_COL_STORAGE, String(px));
    } catch (_) {}
  }
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = parsePropTreeKeyColPx(panel);
    resizer.classList.add('active');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function initPropTreeSearch() {
  const inp = document.getElementById('propTreeSearch');
  if (!inp || inp.dataset.bound) return;
  inp.dataset.bound = '1';
  inp.addEventListener('input', () => {
    filterPropTree(inp.value.trim().toLowerCase());
    syncPropTreeSelectionClasses();
  });
}

/** Right-click empty area in the property panel (not on a row) — root-level actions. */
function initPropTreePanelContextMenu() {
  const panel = document.getElementById('propsContainer');
  if (!panel || panel.dataset.emptyCtxBound) return;
  panel.dataset.emptyCtxBound = '1';
  panel.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.prop-row')) return;
    e.preventDefault();
    const d = docManager.activeDoc;
    if (!d || !d.root || typeof d.root !== 'object') return;

    const items = [
      {
        label: 'Add object',
        icon: ctxTypeBadgeHtml('object'),
        action: () => {
          withDocUndoRootPair(() => {
            let nk = 'new_object';
            let n = 1;
            while (Object.prototype.hasOwnProperty.call(d.root, nk)) nk = 'new_object_' + ++n;
            d.root[nk] = {};
          }, 'Add object');
        }
      },
      {
        label: 'Add list',
        icon: ctxTypeBadgeHtml('array'),
        action: () => {
          withDocUndoRootPair(() => {
            let nk = 'new_list';
            let n = 1;
            while (Object.prototype.hasOwnProperty.call(d.root, nk)) nk = 'new_list_' + ++n;
            d.root[nk] = [];
          }, 'Add list');
        }
      },
      { sep: true },
      {
        label: 'Paste as new key',
        icon: ICONS.clipboard,
        disabled: !_clipboard,
        action: () => {
          if (!_clipboard) return;
          withDocUndoRootPair(() => {
            let nk = _clipboard.key || 'pasted';
            let n = 1;
            while (Object.prototype.hasOwnProperty.call(d.root, nk)) nk = nk + '_' + ++n;
            d.root[nk] = deepClone(_clipboard.value);
          }, 'Paste as new key');
        }
      },
      { sep: true },
      {
        label: 'Expand all',
        icon: ICONS.expandAll,
        action: () => setAllCollapsed(false)
      },
      {
        label: 'Collapse all',
        icon: ICONS.collapseAll,
        action: () => setAllCollapsed(true)
      }
    ];
    showContextMenu(items, e.clientX, e.clientY);
  });
}

let _propertyBrowserContextFilter = '';
let _propertyBrowserPropertyFilter = '';
let _propertyBrowserSelectedContext = 'auto';
let _propertyBrowserSelectedProperty = '';

function defaultValueForPropertyType(t) {
  switch (t) {
    case 'string':
      return '';
    case 'int':
      return 0;
    case 'float':
      return 0.0;
    case 'bool':
      return false;
    case 'object':
      return {};
    case 'array':
      return [];
    case 'vec2':
      return [0, 0];
    case 'vec3':
      return [0, 0, 0];
    case 'vec4':
      return [0, 0, 0, 0];
    case 'color':
      return [0, 0, 0];
    case 'resource':
      return { type: 'resource_name', value: '' };
    case 'soundevent':
      return { type: 'soundevent', value: '' };
    case 'panorama':
      return { type: 'panorama', value: '' };
    default:
      return '';
  }
}

function inferPropertyTypeFromSuggestion(suggestion) {
  if (!suggestion) return 'string';
  const st = suggestion.type;
  if (
    st === 'bool' ||
    st === 'int' ||
    st === 'float' ||
    st === 'vec2' ||
    st === 'vec3' ||
    st === 'vec4' ||
    st === 'color' ||
    st === 'resource' ||
    st === 'soundevent' ||
    st === 'panorama' ||
    st === 'array' ||
    st === 'object'
  )
    return st;
  return 'string';
}

function getPropertyBrowserContextEntries() {
  if (!window.VDataEditorModes) return [{ value: 'auto', label: 'Document Context' }];
  const out = [{ value: 'auto', label: 'Document Context' }];
  const generic = window.VDataEditorModes.getModeById('generic');
  if (generic) out.push({ value: 'generic', label: generic.label || 'Generic' });
  const modes = window.VDataEditorModes.listModes();
  for (let i = 0; i < modes.length; i++) {
    out.push({ value: modes[i].id, label: modes[i].label || modes[i].id });
  }
  return out;
}

function buildPropertyBrowserContextList() {
  const list = document.getElementById('propertyBrowserContextList');
  const sel = document.getElementById('editorModeSelect');
  if (!list || !sel) return;
  const entries = getPropertyBrowserContextEntries();
  const q = _propertyBrowserContextFilter;
  const selected = sel.value || 'auto';
  _propertyBrowserSelectedContext = selected;
  list.innerHTML = '';
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    if (q && item.label.toLowerCase().indexOf(q) < 0 && item.value.toLowerCase().indexOf(q) < 0) continue;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'property-browser-item' + (item.value === selected ? ' is-selected' : '');
    row.textContent = item.label;
    row.title = item.value;
    row.addEventListener('click', () => {
      if (sel.value === item.value) return;
      sel.value = item.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    list.appendChild(row);
  }
}

function getPropertyBrowserSuggestions() {
  const d = docManager.activeDoc;
  if (!d || !d.root || typeof d.root !== 'object') return [];
  if (!window.VDataSuggestions || typeof window.VDataSuggestions.getSuggestions !== 'function') return [];
  return window.VDataSuggestions.getSuggestions(d.fileName || '', '', { includeExistingSiblings: true });
}

function inferTypeForKeyAtParent(key, parentObjectPath) {
  const d = docManager.activeDoc;
  if (!d || !window.VDataSuggestions || typeof VDataSuggestions.getSuggestions !== 'function') return 'string';
  const list = VDataSuggestions.getSuggestions(d.fileName || '', parentObjectPath || '');
  const match = list.find((s) => s.key === key);
  return inferPropertyTypeFromSuggestion(match);
}

/**
 * @param {string} keyRaw
 * @param {string} parentObjectPath
 * @param {string} [editorTypeOverride]
 * @param {{ referenceKey: string, placeAfter?: boolean }} [insertNear] Order new key next to sibling (same parent object).
 */
function addSuggestedPropertyAtPath(keyRaw, parentObjectPath, editorTypeOverride, insertNear) {
  const d = docManager.activeDoc;
  if (!d || !d.root || typeof d.root !== 'object') return false;
  const key = String(keyRaw || '').trim();
  if (!key) {
    setStatus('Select a property first', 'error');
    return false;
  }
  const parentPath = parentObjectPath != null && typeof parentObjectPath === 'string' ? parentObjectPath : '';
  const parentObj = parentPath ? getValueAtPath(d.root, parentPath) : d.root;
  if (parentObj == null || typeof parentObj !== 'object' || Array.isArray(parentObj)) {
    setStatus('Cannot add property here', 'error');
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(parentObj, key)) {
    setStatus(`Key "${key}" already exists`, 'error');
    return false;
  }
  const type =
    editorTypeOverride && typeof editorTypeOverride === 'string'
      ? editorTypeOverride
      : inferTypeForKeyAtParent(key, parentPath);
  const near =
    insertNear && typeof insertNear.referenceKey === 'string' ? insertNear.referenceKey : null;
  if (near !== null && near === key) {
    setStatus('Invalid insert reference', 'error');
    return false;
  }
  withDocUndoRootPair(() => {
    parentObj[key] = defaultValueForPropertyType(type);
    if (near != null && Object.prototype.hasOwnProperty.call(parentObj, near)) {
      insertObjectKeyBesideReference(parentObj, key, near, !!insertNear.placeAfter);
    }
  }, 'Add key');
  const focusPath = parentPath ? `${parentPath}/${key}` : key;
  requestAnimationFrame(() => {
    const rows = document.querySelectorAll('#propTreeRoot .prop-row');
    let row = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].dataset.propPath === focusPath) {
        row = rows[i];
        break;
      }
    }
    const target = row?.querySelector('.prop-input, .prop-input-bool');
    if (target && typeof target.focus === 'function') {
      target.focus();
      if (typeof target.select === 'function') target.select();
    }
  });
  return true;
}

function formatDependencyLeaf(cond) {
  if (!cond || typeof cond !== 'object') return '';
  if (cond.and || cond.or || cond.not) return '';
  const key = typeof cond.key === 'string' ? cond.key : '';
  const k = key || '';
  if (!k) return '';

  if (Object.prototype.hasOwnProperty.call(cond, 'eq')) return `${k} = ${cond.eq}`;
  if (Object.prototype.hasOwnProperty.call(cond, 'ne')) return `${k} != ${cond.ne}`;
  if (Object.prototype.hasOwnProperty.call(cond, 'in')) return `${k} in [${Array.isArray(cond.in) ? cond.in.join(', ') : ''}]`;
  if (Object.prototype.hasOwnProperty.call(cond, 'lt')) return `${k} < ${cond.lt}`;
  if (Object.prototype.hasOwnProperty.call(cond, 'lte')) return `${k} <= ${cond.lte}`;
  if (Object.prototype.hasOwnProperty.call(cond, 'gt')) return `${k} > ${cond.gt}`;
  if (Object.prototype.hasOwnProperty.call(cond, 'gte')) return `${k} >= ${cond.gte}`;
  if (Object.prototype.hasOwnProperty.call(cond, 'regex')) return `${k} ~ /${cond.regex}/`;
  return `${k} (truthy)`;
}

function formatDependencyExpr(expr) {
  if (!expr) return '';
  if (Array.isArray(expr)) return expr.map(formatDependencyExpr).filter(Boolean).join(' AND ');
  if (typeof expr !== 'object') return String(expr);
  if (expr.and) return expr.and.map(formatDependencyExpr).filter(Boolean).join(' AND ');
  if (expr.or) return expr.or.map(formatDependencyExpr).filter(Boolean).join(' OR ');
  if (expr.not) return `NOT (${formatDependencyExpr(expr.not)})`;
  return formatDependencyLeaf(expr);
}

function showPropertyInfo(suggestion, key, type, propPath) {
  const headerEl = document.getElementById('propertyInfoHeader');
  const bodyEl = document.getElementById('propertyInfoBody');
  if (!headerEl || !bodyEl) return;

  const d = docManager && docManager.activeDoc ? docManager.activeDoc : null;
  const liveRoot = d && d.root ? d.root : null;

  const schemaCtx = schemaCtxForPropertyTree();
  schemaCtx.liveRoot = liveRoot;
  const parentKey = propPath ? schemaParentKeyFromRowPath(propPath) : '';
  const schemaEntry = window.VDataSuggestions?.getSchemaEntry ? window.VDataSuggestions.getSchemaEntry(key, Object.assign({}, schemaCtx, { parentKey })) : null;

  const desc =
    (suggestion && (suggestion.description || suggestion.doc)) ||
    (schemaEntry && (schemaEntry.description || schemaEntry.doc)) ||
    '';

  const showIf = (schemaEntry && schemaEntry.showIf != null ? schemaEntry.showIf : suggestion && suggestion.showIf != null ? suggestion.showIf : null) || null;
  const enableIf = (schemaEntry && schemaEntry.enableIf != null ? schemaEntry.enableIf : suggestion && suggestion.enableIf != null ? suggestion.enableIf : null) || null;

  const enumRef =
    (schemaEntry && schemaEntry.enumRef) ||
    (suggestion && suggestion.enumRef) ||
    null;

  const enumWidgetId =
    (schemaEntry && schemaEntry.enumWidgetId) ||
    (suggestion && suggestion.enumWidgetId) ||
    null;

  let enumValues = null;
  if (enumRef && window.VDataDependencyEngine?.resolveEnumValues) {
    enumValues = window.VDataDependencyEngine.resolveEnumValues(enumRef, schemaCtx);
  } else if ((schemaEntry && schemaEntry.enum) || (schemaEntry && schemaEntry.enumWidgetId) || (suggestion && suggestion.enumWidgetId)) {
    if (window.VDataSuggestions?.getSuggestedValues) {
      enumValues = window.VDataSuggestions.getSuggestedValues(key, Object.assign({}, schemaCtx, { parentKey }));
    }
  }

  const depSummary = showIf || enableIf ? [] : null;
  if (showIf) depSummary.push(`Visible when ${formatDependencyExpr(showIf)}`);
  if (enableIf) depSummary.push(`Enabled when ${formatDependencyExpr(enableIf)}`);

  let currentVal = '';
  if (d && propPath && typeof propPath === 'string' && d.root) {
    try {
      const v = getValueAtPath(d.root, propPath);
      if (v === undefined) currentVal = '';
      else if (v === null) currentVal = 'null';
      else if (typeof v === 'object') currentVal = JSON.stringify(v);
      else currentVal = String(v);
    } catch (_) {}
  }

  const source = schemaEntry && schemaEntry.__source ? schemaEntry.__source : suggestion && suggestion.__source ? suggestion.__source : null;

  // Header
  headerEl.innerHTML = '';
  const kEl = document.createElement('div');
  kEl.style.fontWeight = '700';
  kEl.style.fontSize = '12px';
  kEl.style.overflow = 'hidden';
  kEl.style.textOverflow = 'ellipsis';
  kEl.style.whiteSpace = 'nowrap';
  kEl.textContent = key || '';
  headerEl.appendChild(kEl);

  const badge = document.createElement('span');
  badge.className = 'prop-type-badge';
  badge.textContent = type || (schemaEntry && schemaEntry.type) || '';
  headerEl.appendChild(badge);

  // Body
  bodyEl.innerHTML = '';
  if (desc) {
    const sec = document.createElement('div');
    sec.className = 'property-info-section';
    const title = document.createElement('div');
    title.className = 'property-info-section-title';
    title.textContent = 'Description';
    const txt = document.createElement('div');
    txt.className = 'property-info-muted';
    txt.textContent = desc;
    sec.appendChild(title);
    sec.appendChild(txt);
    bodyEl.appendChild(sec);
  }

  if (enumValues && Array.isArray(enumValues) && enumValues.length) {
    const sec = document.createElement('div');
    sec.className = 'property-info-section';
    const title = document.createElement('div');
    title.className = 'property-info-section-title';
    title.textContent = 'Enum values';
    sec.appendChild(title);
    const list = document.createElement('div');
    list.textContent = enumValues.slice(0, 200).join(', ') + (enumValues.length > 200 ? '…' : '');
    bodyEl.appendChild(sec);
    sec.appendChild(list);
  }

  if (depSummary && depSummary.length) {
    const sec = document.createElement('div');
    sec.className = 'property-info-section';
    const title = document.createElement('div');
    title.className = 'property-info-section-title';
    title.textContent = 'Dependencies';
    sec.appendChild(title);
    const txt = document.createElement('div');
    txt.textContent = depSummary.join(' • ');
    bodyEl.appendChild(sec);
    sec.appendChild(txt);
  }

  if (propPath && d && d.root) {
    const sec = document.createElement('div');
    sec.className = 'property-info-section';
    const title = document.createElement('div');
    title.className = 'property-info-section-title';
    title.textContent = 'Current value';
    const txt = document.createElement('div');
    txt.className = 'property-info-muted';
    txt.textContent = currentVal || '(not set)';
    sec.appendChild(title);
    sec.appendChild(txt);
    bodyEl.appendChild(sec);
  }

  if (source) {
    const sec = document.createElement('div');
    sec.className = 'property-info-section';
    const title = document.createElement('div');
    title.className = 'property-info-section-title';
    title.textContent = 'Schema source';
    const txt = document.createElement('div');
    txt.className = 'property-info-muted';
    txt.textContent = source;
    sec.appendChild(title);
    sec.appendChild(txt);
    bodyEl.appendChild(sec);
  }

  if (!desc && (!enumValues || !enumValues.length) && (!depSummary || !depSummary.length) && !currentVal && !source) {
    const empty = document.createElement('div');
    empty.className = 'property-info-muted';
    empty.textContent = 'No schema info for this property.';
    bodyEl.appendChild(empty);
  }
}

function buildPropertyBrowserPropertyList() {
  const list = document.getElementById('propertyBrowserPropertyList');
  if (!list) return;
  const suggestions = getPropertyBrowserSuggestions();
  const q = _propertyBrowserPropertyFilter;
  list.innerHTML = '';

  const d = docManager && docManager.activeDoc ? docManager.activeDoc : null;
  const existingKeys =
    d && d.root && typeof d.root === 'object' && !Array.isArray(d.root) ? new Set(Object.keys(d.root)) : new Set();

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    const key = s.key || '';
    const type = inferPropertyTypeFromSuggestion(s);
    if (existingKeys.has(key)) continue;
    if (q && key.toLowerCase().indexOf(q) < 0 && type.toLowerCase().indexOf(q) < 0) continue;
    const row = document.createElement('div');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.className = 'property-browser-item property-browser-prop-item' + (_propertyBrowserSelectedProperty === key ? ' is-selected' : '');
    row.draggable = true;
    row.innerHTML = '<span class="property-browser-prop-key"></span><span class="property-browser-prop-type"></span>';
    row.querySelector('.property-browser-prop-key').textContent = key;
    const typeCell = row.querySelector('.property-browser-prop-type');
    typeCell.textContent = '';
    paintTypeBadgeCircle(typeCell, type, null, key);
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(
        PROP_SUGGESTION_MIME,
        JSON.stringify({ kind: 'vdata-property-suggestion', key, type })
      );
    });
    row.addEventListener('click', () => {
      _propertyBrowserSelectedProperty = key;
      showPropertyInfo(s, key, type, key);
      buildPropertyBrowserPropertyList();
    });
    row.addEventListener('focus', () => {
      showPropertyInfo(s, key, type, key);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        row.click();
      }
    });
    row.addEventListener('dblclick', (e) => {
      e.preventDefault();
      _propertyBrowserSelectedProperty = key;
      addPropertyFromBrowser(key);
      buildPropertyBrowserPropertyList();
    });
    list.appendChild(row);
  }
}

function refreshPropertyBrowserContextList() {
  buildPropertyBrowserContextList();
}
window.refreshPropertyBrowserContextList = refreshPropertyBrowserContextList;

function refreshPropertyBrowserPropertyList() {
  buildPropertyBrowserPropertyList();
}
window.refreshPropertyBrowserPropertyList = refreshPropertyBrowserPropertyList;

function addPropertyFromBrowser(overrideKey) {
  const key = (overrideKey != null ? String(overrideKey) : _propertyBrowserSelectedProperty || '').trim();
  addSuggestedPropertyAtPath(key, '');
}

function initPropertyBrowser() {
  const contextFilter = document.getElementById('propertyBrowserContextFilter');
  const propFilter = document.getElementById('propertyBrowserPropertyFilter');
  const addBtn = document.getElementById('propertyBrowserAddBtn');
  if (!contextFilter || !propFilter || !addBtn || contextFilter.dataset.bound) return;
  contextFilter.dataset.bound = '1';
  contextFilter.addEventListener('input', () => {
    _propertyBrowserContextFilter = contextFilter.value.trim().toLowerCase();
    buildPropertyBrowserContextList();
  });
  propFilter.addEventListener('input', () => {
    _propertyBrowserPropertyFilter = propFilter.value.trim().toLowerCase();
    buildPropertyBrowserPropertyList();
  });
  addBtn.addEventListener('click', addPropertyFromBrowser);
  if (typeof docManager !== 'undefined' && docManager && !docManager._propertyBrowserBound) {
    docManager._propertyBrowserBound = true;
    docManager.addEventListener('active-changed', () => {
      _propertyBrowserSelectedProperty = '';
      buildPropertyBrowserContextList();
      buildPropertyBrowserPropertyList();
    });
  }
  if (!window.__vdataPropertyBrowserSchemaBound) {
    window.__vdataPropertyBrowserSchemaBound = true;
    window.addEventListener('vdata-schema-modes-updated', () => {
      buildPropertyBrowserContextList();
      buildPropertyBrowserPropertyList();
    });
  }
  buildPropertyBrowserContextList();
  buildPropertyBrowserPropertyList();

  const vSplit = document.getElementById('propertyBrowserVSplit');
  const paneTop = document.getElementById('propertyBrowserPaneContext');
  const paneBottom = document.getElementById('propertyBrowserPaneProps');
  if (vSplit && paneTop && paneBottom && !vSplit.dataset.bound) {
    vSplit.dataset.bound = '1';
    const MIN_PANE = 80;
    vSplit.addEventListener('mousedown', (e) => {
      e.preventDefault();
      vSplit.classList.add('active');
      const startY = e.clientY;
      const startTopH = paneTop.offsetHeight;
      const startBotH = paneBottom.offsetHeight;
      function onMove(e2) {
        const dy = e2.clientY - startY;
        const newTop = Math.max(MIN_PANE, startTopH + dy);
        const newBot = Math.max(MIN_PANE, startBotH - dy);
        paneTop.style.flex = `${newTop} 1 ${newTop}px`;
        paneBottom.style.flex = `${newBot} 1 ${newBot}px`;
      }
      function onUp() {
        vSplit.classList.remove('active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  const infoSplit = document.getElementById('propertyBrowserInfoSplit');
  const paneInfo = document.getElementById('propertyBrowserPaneInfo');
  if (infoSplit && paneBottom && paneInfo && !infoSplit.dataset.bound) {
    infoSplit.dataset.bound = '1';
    const MIN_PANE = 80;
    infoSplit.addEventListener('mousedown', (e) => {
      e.preventDefault();
      infoSplit.classList.add('active');
      const startY = e.clientY;
      const startPropsH = paneBottom.offsetHeight;
      const startInfoH = paneInfo.offsetHeight;

      function onMove(e2) {
        const dy = e2.clientY - startY;
        const newPropsH = Math.max(MIN_PANE, startPropsH + dy);
        const newInfoH = Math.max(MIN_PANE, startInfoH - dy);
        paneBottom.style.flex = `${newPropsH} 1 ${newPropsH}px`;
        paneInfo.style.flex = `${newInfoH} 1 ${newInfoH}px`;
      }

      function onUp() {
        infoSplit.classList.remove('active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
window.initPropertyBrowser = initPropertyBrowser;

function initPropTreeMultiSelect() {
  if (typeof document === 'undefined') return;
  if (document.documentElement.dataset.vdataPropTreeSelectInit) return;
  document.documentElement.dataset.vdataPropTreeSelectInit = '1';

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!_propTreeSelection.size) return;
    _propTreeSelection.clear();
    _propTreeSelectionAnchorPath = '';
    syncPropTreeSelectionClasses();
  });

  if (typeof docManager !== 'undefined' && docManager && !docManager._propTreeMultiSelectDocBound) {
    docManager._propTreeMultiSelectDocBound = true;
    docManager.addEventListener('active-changed', () => {
      _propTreeSelection.clear();
      _propTreeSelectionAnchorPath = '';
      syncPropTreeSelectionClasses();
    });
  }

  const treeRoot = document.getElementById('propTreeRoot');
  if (treeRoot && !treeRoot.dataset.selectionBgBound) {
    treeRoot.dataset.selectionBgBound = '1';
    treeRoot.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target !== treeRoot) return;
      _propTreeSelection.clear();
      _propTreeSelectionAnchorPath = '';
      syncPropTreeSelectionClasses();
    });
  }
}

function initPropTreeRootSuggestionDrop() {
  const treeRoot = document.getElementById('propTreeRoot');
  if (!treeRoot || treeRoot.dataset.suggestionDropInit) return;
  treeRoot.dataset.suggestionDropInit = '1';

  treeRoot.addEventListener('dragenter', (e) => {
    if (!dataTransferIsBrowserSuggestion(e.dataTransfer)) return;
    e.preventDefault();
  });
  treeRoot.addEventListener('dragover', (e) => {
    if (!dataTransferIsBrowserSuggestion(e.dataTransfer)) return;
    if (e.target.closest && e.target.closest('.prop-row')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  treeRoot.addEventListener('drop', (e) => {
    const sug = parseBrowserDragPayload(e.dataTransfer);
    if (!sug) return;
    if (e.target.closest && e.target.closest('.prop-row')) return;
    e.preventDefault();
    e.stopPropagation();
    addSuggestedPropertyAtPath(sug.key, '', sug.type);
  });
}

function initPropsContainerSuggestionDragAffordance() {
  const panel = document.getElementById('propsContainer');
  if (!panel || panel.dataset.suggestionAffordanceInit) return;
  panel.dataset.suggestionAffordanceInit = '1';

  panel.addEventListener('dragenter', (e) => {
    if (!dataTransferIsBrowserSuggestion(e.dataTransfer)) return;
    e.preventDefault();
    panel.classList.add('prop-tree-panel-suggestion-drag-over');
  });
  panel.addEventListener('dragover', (e) => {
    if (!dataTransferIsBrowserSuggestion(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    panel.classList.add('prop-tree-panel-suggestion-drag-over');
  });
  panel.addEventListener('dragleave', (e) => {
    if (!panel.contains(e.relatedTarget)) panel.classList.remove('prop-tree-panel-suggestion-drag-over');
  });
  panel.addEventListener('drop', () => {
    panel.classList.remove('prop-tree-panel-suggestion-drag-over');
  });
  document.addEventListener('dragend', () => {
    panel.classList.remove('prop-tree-panel-suggestion-drag-over');
  });
}

function initPropTreeSelectionAndSuggestionDnD() {
  initPropTreeMultiSelect();
  initPropTreeKeyboard();
  initPropTreeRootSuggestionDrop();
  initPropsContainerSuggestionDragAffordance();
}
window.initPropTreeSelectionAndSuggestionDnD = initPropTreeSelectionAndSuggestionDnD;

// Expose reveal helper for context-menu actions and any external callers.
window.revealManualEditorFromPropPath = revealManualEditorFromPropPath;

