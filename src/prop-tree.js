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
    return 'string';
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const keysOk = (o) => Object.keys(o).every((k) => k === 'type' || k === 'value');
    if (value.type === 'resource_name' && typeof value.value === 'string' && keysOk(value)) return 'resource';
    if (value.type === 'soundevent' && typeof value.value === 'string' && keysOk(value)) return 'soundevent';
  }
  if (Array.isArray(value)) {
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

function resolveRowWidgetType(key, value, parentObj) {
  const mode = getActiveMode();
  if (mode && typeof mode.resolveWidget === 'function') {
    const w = mode.resolveWidget(key, value, parentObj);
    if (w) return w;
  }
  const inferred = inferType(key, value);
  return VDataSettings.resolveWidgetType(key, inferred);
}

const TYPE_CAST_OPTIONS = {
  string: ['int', 'float', 'bool', 'resource', 'soundevent'],
  int: ['float', 'string', 'bool'],
  float: ['int', 'string', 'bool'],
  bool: ['int', 'string'],
  resource: ['string', 'soundevent'],
  soundevent: ['string', 'resource'],
  vec2: ['vec3', 'vec4', 'array', 'string'],
  vec3: ['vec2', 'vec4', 'array', 'string'],
  vec4: ['vec2', 'vec3', 'array', 'string']
};

const STATIC_TYPE_SUMMARY = new Set(['object', 'array', 'null', 'unknown']);
const ALL_CAST_TARGETS = ['string', 'int', 'float', 'bool', 'resource', 'soundevent', 'vec2', 'vec3', 'vec4', 'array', 'object'];

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

function castPropertyType(parentRef, key, value, fromType, toType, arrayIdx) {
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
        else newValue = String(value);
        break;
      case 'resource':
        newValue = {
          type: 'resource_name',
          value: typeof value === 'string' ? value : typedResourceDisplay(value, 'resource_name') || ''
        };
        break;
      case 'soundevent':
        newValue = {
          type: 'soundevent',
          value: typeof value === 'string' ? value : typedResourceDisplay(value, 'soundevent') || ''
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
  withDocUndo(() => {
    const isArrayIndex = typeof arrayIdx === 'number' && Array.isArray(parentRef);
    if (isArrayIndex) parentRef[arrayIdx] = newValue;
    else parentRef[key] = newValue;
  });
}

function isPropRowInHiddenBranch(row) {
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
}

function buildPropertyTree() {
  const container = document.getElementById('propTreeRoot');
  if (!container) return;
  const d = docManager.activeDoc;
  const root = d?.root;
  if (!root || typeof root !== 'object') {
    container.innerHTML = '';
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

  if (!_propTreeStructuralDirty && container.querySelector('.prop-row')) {
    updatePropRowValues(container);
    if (q) filterPropTree(q);
    stripePropTree();
    syncPropTreeSelectionClasses();
    return;
  }

  _propTreeStructuralDirty = false;
  container.innerHTML = '';
  renderObjectRows(container, root, 0, '');
  prunePropTreeSelectionFromDom();
  syncPropTreeSelectionClasses();
  if (q) filterPropTree(q);
  stripePropTree();
  syncPropTreeSelectionClasses();
  requestAnimationFrame(() => {
    container.scrollTop = scrollTop;
  });
}

function updatePropRowValues(container) {
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
        const newStr = parseFloat(axisVal.toFixed(6)).toString();
        if (numInput && numInput !== document.activeElement && numInput.value !== newStr) {
          numInput.value = newStr;
        }
        if (slider && slider !== document.activeElement) {
          const min = Number(slider.min);
          const max = Number(slider.max);
          if (Number.isFinite(min) && Number.isFinite(max) && axisVal >= min && axisVal <= max) {
            const sliderStr = String(axisVal);
            if (slider.value !== sliderStr) slider.value = sliderStr;
          }
        }
      });
    } else {
      const inp = row.querySelector('.prop-input:not([readonly])');
      if (inp && inp !== document.activeElement) {
        const newStr = value == null ? '' : String(value);
        if (inp.value !== newStr) inp.value = newStr;
      }
    }
    const cb = row.querySelector('.prop-input-bool');
    if (cb && cb !== document.activeElement) {
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
  for (let idx = 0; idx < total; idx++) {
    const [key, value] = entries[idx];
    if (value === undefined) continue;
    const type = resolveRowWidgetType(key, value, obj);
    const rowPath = parentPath ? `${parentPath}/${key}` : key;
    const row = buildPropRow(key, value, type, depth, obj, undefined, rowPath, {
      index: idx,
      total,
      parentKind: 'object'
    });
    container.appendChild(row);
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
      container.appendChild(children);
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
      container.appendChild(children);
      const toggle = row.querySelector('.prop-key-toggle');
      if (toggle && depth >= 1) setPropKeyToggleIcon(toggle, propEx().has(rowPath));
      else if (toggle && depth === 0) setPropKeyToggleIcon(toggle, !propCol().has(rowPath), !propCol().has(rowPath));
    }
  }
}

function renderArrayRows(container, arr, depth, parentPath) {
  if (!Array.isArray(arr)) return;
  const total = arr.length;
  arr.forEach((item, idx) => {
    const itemType = resolveRowWidgetType(`[${idx}]`, item, arr);
    const rowPath = `${parentPath}/[${idx}]`;
    const row = buildPropRow(`[${idx}]`, item, itemType, depth, arr, idx, rowPath, {
      index: idx,
      total,
      parentKind: 'array'
    });
    container.appendChild(row);
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
      container.appendChild(children);
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
      container.appendChild(children);
      const toggle = row.querySelector('.prop-key-toggle');
      if (toggle && depth >= 1) setPropKeyToggleIcon(toggle, propEx().has(rowPath));
      else if (toggle && depth === 0) setPropKeyToggleIcon(toggle, !propCol().has(rowPath), !propCol().has(rowPath));
    }
  });
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
  const mode = getActiveMode();
  if (mode && typeof mode.rowClass === 'function') {
    const rc = mode.rowClass(key, value);
    if (rc) row.className += ' ' + rc;
  }
  const d = Math.min(depth, 9);
  row.dataset.depth = String(d);
  row.dataset.type = type;
  row.dataset.propPath = propPath;
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
      castPropertyType(parentRef, key, value, type, newType, arrayIdx);
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
      prevRoot: deepClone(d.root),
      prevFormat: d.format,
      prevEx: new Set(propEx()),
      prevCol: new Set(propCol()),
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

    const nextRoot = deepClone(d.root);
    const nextFormat = d.format;
    const nextEx = new Set(propEx());
    const nextCol = new Set(propCol());
    sliderScrubDidChange = false;

    pushUndoCommand({
      label: tx.label,
      undo: () => {
        d.format = tx.prevFormat;
        d.root = deepClone(tx.prevRoot);
        d.expandedPaths = new Set(tx.prevEx);
        d.collapsedPaths = new Set(tx.prevCol);
        d.recalcElementIds();
        d.dirty = true;
        docManager.dispatchEvent(new Event('tabs-changed'));
        renderAll();
      },
      redo: () => {
        d.format = nextFormat;
        d.root = deepClone(nextRoot);
        d.expandedPaths = new Set(nextEx);
        d.collapsedPaths = new Set(nextCol);
        d.recalcElementIds();
        d.dirty = true;
        docManager.dispatchEvent(new Event('tabs-changed'));
        renderAll();
      }
    });

    d.dirty = true;
    docManager.dispatchEvent(new Event('tabs-changed'));
    renderAll();
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
    commitValue(parentRef, key, v, arrayIdx, false);
  };

  const onComponentsChange = (newArr) => {
    if (sliderScrubActive) {
      sliderScrubDidChange = true;
      setScalarNoUndo(newArr);
      return;
    }
    commitValue(parentRef, key, newArr, arrayIdx, true);
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
    case 'resource':
      buildResourceWidget(valEl, value, 'resource_name', onScalarChange);
      break;
    case 'soundevent':
      buildResourceWidget(valEl, value, 'soundevent', onScalarChange);
      break;
    case 'color':
      buildColorWidget(valEl, value, onScalarChange);
      break;
    case 'vec2':
      buildVec2Widget(valEl, value, onScalarChange, sliderOpts);
      break;
    case 'vec3':
      buildVec3Widget(valEl, value, onScalarChange, sliderOpts);
      break;
    case 'vec4':
      buildVec4Widget(valEl, value, onScalarChange, sliderOpts);
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
      withDocUndo(() => {
        parentRef[arrayIdx] = makeCommentedValueNode(value);
      }, 'Disable list item');
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
    if (isArrayIndex) {
      withDocUndo(() => {
        invalidatePropTreePathsForArrayContainer(arrayContainerPathFromRowPath(propPath));
        parentRef.splice(arrayIdx + 1, 0, deepClone(value));
      });
    } else {
      withDocUndo(() => {
        let newKey = key + '_copy';
        let n = 1;
        while (Object.prototype.hasOwnProperty.call(parentRef, newKey)) newKey = key + '_copy' + ++n;
        parentRef[newKey] = deepClone(value);
      });
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
      withDocUndo(() => {
        if (type === 'array') {
          value.push('');
        } else {
          let newKey = 'new_key';
          let n = 1;
          while (Object.prototype.hasOwnProperty.call(value, newKey)) newKey = 'new_key_' + ++n;
          value[newKey] = '';
        }
      });
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
    withDocUndo(() => {
      if (isArrayIndex) {
        invalidatePropTreePathsForArrayContainer(arrayContainerPathFromRowPath(propPath));
        parentRef.splice(arrayIdx, 1);
      } else {
        invalidatePropTreePathsUnderObjectKey(propPath);
        delete parentRef[key];
      }
    });
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
    withDocUndo(() => {
      parentRef[newKey] = newVal;
    }, 'Add key');
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
  const castOptions = STATIC_TYPE_SUMMARY.has(type)
    ? ALL_CAST_TARGETS.filter((t) => t !== type)
    : TYPE_CAST_OPTIONS[type] || [];
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
          commitValue(parentRef, key, v, arrayIdx, true);
        } catch (_) {}
      }
    },
    { sep: true },
    {
      label: 'Duplicate',
      icon: ICONS.duplicate,
      action: () => {
        if (isArrayIndex) {
          withDocUndo(() => {
            invalidatePropTreePathsForArrayContainer(arrayContainerPathFromRowPath(propPath));
            parentRef.splice(arrayIdx + 1, 0, deepClone(value));
          }, 'Duplicate');
        } else {
          withDocUndo(() => {
            let newKey = key + '_copy';
            let n = 1;
            while (Object.prototype.hasOwnProperty.call(parentRef, newKey)) newKey = key + '_copy' + ++n;
            parentRef[newKey] = deepClone(value);
          }, 'Duplicate');
        }
      }
    },
    {
      label: 'Delete',
      icon: ICONS.trash,
      cls: 'danger',
      action: () => {
        withDocUndo(() => {
          if (isArrayIndex) {
            invalidatePropTreePathsForArrayContainer(arrayContainerPathFromRowPath(propPath));
            parentRef.splice(arrayIdx, 1);
          } else {
            invalidatePropTreePathsUnderObjectKey(propPath);
            delete parentRef[key];
          }
        }, 'Delete');
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
    ...castOptions.map((targetType) => ({
      label: `Change type → ${targetType}`,
      icon: ICONS.wrench,
      action: () => {
        castPropertyType(parentRef, key, value, type, targetType, arrayIdx);
      }
    })),
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
        commitValue(parentRef, key, deepClone(_clipboard.value), arrayIdx, true);
      }
    },
    {
      label: 'Paste as sibling',
      icon: ICONS.clipboard,
      disabled: !_clipboard,
      action: () => {
        if (!_clipboard) return;
        withDocUndo(() => {
          if (isArrayIndex) {
            parentRef.splice(arrayIdx + 1, 0, deepClone(_clipboard.value));
            invalidatePropTreePathsForArrayContainer(arrayContainerPathFromRowPath(propPath));
          } else {
            let nk = _clipboard.key || 'pasted';
            let n = 1;
            while (Object.prototype.hasOwnProperty.call(parentRef, nk)) nk = nk + '_' + ++n;
            parentRef[nk] = deepClone(_clipboard.value);
          }
        }, 'Paste sibling');
      }
    },
    { sep: true },
    {
      label: 'Remove duplicates in array',
      icon: ICONS.x,
      disabled: type !== 'array' || !Array.isArray(value),
      action: () => {
        if (type !== 'array' || !Array.isArray(value)) return;
        withDocUndo(() => {
          const seen = new Set();
          const next = value.filter((item) => {
            const k = JSON.stringify(item);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          if (isArrayIndex) parentRef[arrayIdx] = next;
          else parentRef[key] = next;
          invalidatePropTreePathsForArrayContainer(propPath);
        }, 'Remove duplicates');
      }
    },
    { sep: true },
    {
      label: 'Add object here…',
      icon: ICONS.typeObject,
      disabled: isArrayIndex,
      action: () => {
        withDocUndo(() => {
          let nk = 'new_object';
          let n = 1;
          while (Object.prototype.hasOwnProperty.call(parentRef, nk)) nk = 'new_object_' + ++n;
          parentRef[nk] = {};
        }, 'Add object');
      }
    },
    {
      label: 'Add list here…',
      icon: ICONS.typeArray,
      disabled: isArrayIndex,
      action: () => {
        withDocUndo(() => {
          let nk = 'new_list';
          let n = 1;
          while (Object.prototype.hasOwnProperty.call(parentRef, nk)) nk = 'new_list_' + ++n;
          parentRef[nk] = [];
        }, 'Add list');
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
      withDocUndo(() => {
        if (type === 'array') {
          value.push('');
        } else {
          let nk = 'new_key';
          let n = 1;
          while (Object.prototype.hasOwnProperty.call(value, nk)) nk = 'new_key_' + ++n;
          value[nk] = '';
        }
      }, 'Add child');
    }
  });
  items.push({ sep: true });
  items.push({
    label: 'Copy property path',
    action: () => navigator.clipboard.writeText(propPath)
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

/** Mutates doc root — caller must wrap in a single withDocUndo for batches. */
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
  withDocUndo(() => {
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
  withDocUndo(() => {
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
  withDocUndo(() => {
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
    withDocUndo(() => {
      invalidatePropTreePathsForArrayContainer(arrayContainerPathFromRowPath(dst.propPath || ''));
      const [item] = parentRef.splice(si, 1);
      parentRef.splice(insert, 0, item);
    }, 'Reorder');
    return;
  }
  if (typeof src.key !== 'string' || typeof dst.key !== 'string') return;
  if (src.key === dst.key) return;
  withDocUndo(() => {
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

    const prevRoot = deepClone(d.root);
    const prevFormat = d.format;
    const prevEx = new Set(propEx());
    const prevCol = new Set(propCol());

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

    const nextRoot = deepClone(d.root);
    const nextFormat = d.format;
    const nextEx = new Set(propEx());
    const nextCol = new Set(propCol());

    markPropTreeStructureDirty();
    pushUndoCommand({
      label: `Rename: ${oldKey}`,
      undo: () => {
        d.format = prevFormat;
        d.root = deepClone(prevRoot);
        d.expandedPaths = new Set(prevEx);
        d.collapsedPaths = new Set(prevCol);
        d.recalcElementIds();
        d.dirty = true;
        docManager.dispatchEvent(new Event('tabs-changed'));
        renderAll();
      },
      redo: () => {
        d.format = nextFormat;
        d.root = deepClone(nextRoot);
        d.expandedPaths = new Set(nextEx);
        d.collapsedPaths = new Set(nextCol);
        d.recalcElementIds();
        d.dirty = true;
        docManager.dispatchEvent(new Event('tabs-changed'));
        renderAll();
      }
    });

    d.dirty = true;
    docManager.dispatchEvent(new Event('tabs-changed'));
    setStatus('Key renamed', 'edited');
    renderAll();
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
      genericDataType: d?.root?.generic_data_type ?? ''
    };
  }
  return window.VDataEditorModes.getSuggestionContext(d.fileName, d.root);
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
  btn.title = prefix === 'soundevent' ? 'Pick sound asset' : 'Pick resource file';
  btn.addEventListener('click', async () => {
    if (!window.electronAPI?.pickResourceFile) return;
    const doc = docManager.activeDoc;
    const fp = doc?.filePath;
    const baseDir =
      typeof fp === 'string' && fp.length ? fp.replace(/[/\\][^/\\]+$/, '') : undefined;
    const filters =
      prefix === 'soundevent'
        ? [{ name: 'Sound', extensions: ['vsndevts', 'vsndstck', 'wav', 'mp3'] }]
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

function buildVec3Widget(container, value, onChange, sliderOpts) {
  const v = Array.isArray(value) ? [...value] : [0, 0, 0];
  const wrapAll = document.createElement('div');
  wrapAll.className = 'vec-widget vec-widget-3d';
  ['X', 'Y', 'Z'].forEach((axis, i) => {
    const row = document.createElement('div');
    row.className = 'vec-axis-row vec3-axis-row';
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge vec-axis-label';
    lbl.textContent = axis;
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

function buildVec2Widget(container, value, onChange, sliderOpts) {
  const v = Array.isArray(value) ? [...value] : [0, 0];
  const wrapAll = document.createElement('div');
  wrapAll.className = 'vec-widget vec-widget-2d';
  ['X', 'Y'].forEach((axis, i) => {
    const row = document.createElement('div');
    row.className = 'vec-axis-row vec2-axis-row';
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge vec-axis-label';
    lbl.textContent = axis;
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

function buildVec4Widget(container, value, onChange, sliderOpts) {
  const v = Array.isArray(value) ? [...value] : [0, 0, 0, 0];
  const wrapAll = document.createElement('div');
  wrapAll.className = 'vec-widget vec-widget-4d';
  ['X', 'Y', 'Z', 'W'].forEach((axis, i) => {
    const row = document.createElement('div');
    row.className = 'vec-axis-row vec4-axis-row';
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge vec-axis-label';
    lbl.textContent = axis;
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

function commitValue(parentRef, key, newValue, arrayIdx, isStructural = false) {
  const d = docManager.activeDoc;
  if (!d) return;

  const useIdx = arrayIdx !== undefined && arrayIdx !== null && Array.isArray(parentRef);

  const prevRoot = deepClone(d.root);
  const prevFormat = d.format;
  const prevEx = new Set(propEx());
  const prevCol = new Set(propCol());

  if (useIdx) parentRef[arrayIdx] = newValue;
  else parentRef[key] = newValue;

  const nextRoot = deepClone(d.root);
  const nextFormat = d.format;
  const nextEx = new Set(propEx());
  const nextCol = new Set(propCol());

  if (isStructural) markPropTreeStructureDirty();

  pushUndoCommand({
    label: `Edit: ${key}`,
    undo: () => {
      d.format = prevFormat;
      d.root = deepClone(prevRoot);
      d.expandedPaths = new Set(prevEx);
      d.collapsedPaths = new Set(prevCol);
      d.recalcElementIds();
      d.dirty = true;
      docManager.dispatchEvent(new Event('tabs-changed'));
      renderAll();
    },
    redo: () => {
      d.format = nextFormat;
      d.root = deepClone(nextRoot);
      d.expandedPaths = new Set(nextEx);
      d.collapsedPaths = new Set(nextCol);
      d.recalcElementIds();
      d.dirty = true;
      docManager.dispatchEvent(new Event('tabs-changed'));
      renderAll();
    }
  });

  d.dirty = true;
  docManager.dispatchEvent(new Event('tabs-changed'));
  setStatus('Property edited', 'edited');
  renderAll();
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
        icon: ICONS.typeObject,
        action: () => {
          withDocUndo(() => {
            let nk = 'new_object';
            let n = 1;
            while (Object.prototype.hasOwnProperty.call(d.root, nk)) nk = 'new_object_' + ++n;
            d.root[nk] = {};
          }, 'Add object');
        }
      },
      {
        label: 'Add list',
        icon: ICONS.typeArray,
        action: () => {
          withDocUndo(() => {
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
          withDocUndo(() => {
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
    default:
      return '';
  }
}

function inferPropertyTypeFromSuggestion(suggestion) {
  if (!suggestion) return 'string';
  const st = suggestion.type;
  if (st === 'bool' || st === 'int' || st === 'float' || st === 'vec2' || st === 'vec3' || st === 'vec4' || st === 'color' || st === 'resource' || st === 'soundevent' || st === 'array' || st === 'object') return st;
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
  withDocUndo(() => {
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

function buildPropertyBrowserPropertyList() {
  const list = document.getElementById('propertyBrowserPropertyList');
  if (!list) return;
  const suggestions = getPropertyBrowserSuggestions();
  const q = _propertyBrowserPropertyFilter;
  list.innerHTML = '';
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    const key = s.key || '';
    const type = inferPropertyTypeFromSuggestion(s);
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
      buildPropertyBrowserPropertyList();
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
  initPropTreeRootSuggestionDrop();
  initPropsContainerSuggestionDragAffordance();
}
window.initPropTreeSelectionAndSuggestionDnD = initPropTreeSelectionAndSuggestionDnD;

