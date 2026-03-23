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

const TYPE_ICONS = {
  string: 'typeString',
  int: 'typeInt',
  float: 'typeFloat',
  bool: 'typeBool',
  color: 'typeColor',
  object: 'typeObject',
  array: 'typeArray',
  vec2: 'typeVec2',
  vec3: 'typeVec3',
  vec4: 'typeVec4',
  resource: 'typeResource',
  soundevent: 'typeSound',
  null: 'typeNull',
  unknown: 'typeUnknown',
  components: 'typeVec3',
  readonly_string: 'typeString',
  float_slider_01: 'typeFloat'
};

function getActiveMode() {
  const sel = document.getElementById('editorModeSelect');
  const v = sel ? sel.value : 'auto';
  if (!v || v === 'auto')
    return window.VDataEditorModes.getModeForFile(docManager.activeDoc?.fileName ?? 'Untitled');
  return window.VDataEditorModes.getModeById(v);
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

function buildTypeBadge(currentType, onCast) {
  const wrap = document.createElement('span');
  wrap.className = 'prop-type-icon-badge prop-type-badge-interactive';
  wrap.title = `Type: ${currentType} (click to change)`;
  const ik = TYPE_ICONS[currentType];
  if (ik && ICONS[ik]) wrap.innerHTML = ICONS[ik];

  const options = TYPE_CAST_OPTIONS[currentType];
  if (!options || options.length === 0) {
    wrap.classList.remove('prop-type-badge-interactive');
    wrap.removeAttribute('title');
    wrap.title = currentType;
    return wrap;
  }

  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.prop-type-dropdown').forEach((el) => el.remove());

    const dropdown = document.createElement('div');
    dropdown.className = 'prop-type-dropdown';
    const rect = wrap.getBoundingClientRect();
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
      if (!dropdown.contains(ev.target) && ev.target !== wrap) {
        dropdown.remove();
        document.removeEventListener('mousedown', close, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  });

  return wrap;
}

function buildForceTypeBadge(currentType, onCast) {
  // For normal types: keep the existing limited cast dropdown behavior.
  if (!STATIC_TYPE_SUMMARY.has(currentType)) return buildTypeBadge(currentType, onCast);

  const wrap = document.createElement('span');
  wrap.className = 'prop-force-type-btn prop-type-badge-interactive';
  wrap.title = `Type: ${currentType} (click to change)`;
  wrap.textContent = '⊞';

  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.prop-type-dropdown').forEach((el) => el.remove());

    const options = ALL_CAST_TARGETS;
    const dropdown = document.createElement('div');
    dropdown.className = 'prop-type-dropdown';
    const rect = wrap.getBoundingClientRect();
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
      if (!dropdown.contains(ev.target) && ev.target !== wrap) {
        dropdown.remove();
        document.removeEventListener('mousedown', close, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  });

  return wrap;
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
    return;
  }

  _propTreeStructuralDirty = false;
  container.innerHTML = '';
  renderObjectRows(container, root, 0, '');
  if (q) filterPropTree(q);
  stripePropTree();
  requestAnimationFrame(() => {
    container.scrollTop = scrollTop;
  });
}

function updatePropRowValues(container) {
  for (const row of container.querySelectorAll(':scope > .prop-row')) {
    const path = row.dataset.propPath;
    const value = getValueAtPath(docManager.activeDoc.root, path);
    const inp = row.querySelector('.prop-input:not([readonly])');
    if (inp && inp !== document.activeElement) {
      const newStr = value == null ? '' : String(value);
      if (inp.value !== newStr) inp.value = newStr;
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
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const type = resolveRowWidgetType(key, value, obj);
    const rowPath = parentPath ? `${parentPath}/${key}` : key;
    const row = buildPropRow(key, value, type, depth, obj, undefined, rowPath);
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
      if (toggle && depth >= 1) toggle.textContent = propEx().has(rowPath) ? '▾' : '▸';
      else if (toggle && depth === 0 && propCol().has(rowPath)) toggle.textContent = '▸';
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
      if (toggle && depth >= 1) toggle.textContent = propEx().has(rowPath) ? '▾' : '▸';
      else if (toggle && depth === 0 && propCol().has(rowPath)) toggle.textContent = '▸';
    }
  }
}

function renderArrayRows(container, arr, depth, parentPath) {
  if (!Array.isArray(arr)) return;
  arr.forEach((item, idx) => {
    const itemType = resolveRowWidgetType(`[${idx}]`, item, arr);
    const rowPath = `${parentPath}/[${idx}]`;
    const row = buildPropRow(`[${idx}]`, item, itemType, depth, arr, idx, rowPath);
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
      if (toggle && depth >= 1) toggle.textContent = propEx().has(rowPath) ? '▾' : '▸';
      else if (toggle && depth === 0 && propCol().has(rowPath)) toggle.textContent = '▸';
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
      if (toggle && depth >= 1) toggle.textContent = propEx().has(rowPath) ? '▾' : '▸';
      else if (toggle && depth === 0 && propCol().has(rowPath)) toggle.textContent = '▸';
    }
  });
}

function buildPropRow(key, value, type, depth, parentRef, arrayIdx, propPath) {
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

  const keyIcon = document.createElement('span');
  keyIcon.className = 'prop-type-icon-badge';
  keyIcon.title = type;
  const iconKey = TYPE_ICONS[type];
  if (iconKey && ICONS[iconKey]) keyIcon.innerHTML = ICONS[iconKey];
  keyEl.appendChild(dragHandle);
  keyEl.appendChild(keyIcon);

  if (type === 'object' || type === 'array') {
    const childrenWillBeLazy = depth >= 1;
    const toggle = document.createElement('span');
    toggle.className = 'prop-key-toggle';
    toggle.textContent = childrenWillBeLazy ? '▸' : '▾';
    toggle.addEventListener('click', () => {
      const ch = row.nextElementSibling;
      if (!ch || !ch.classList.contains('prop-row-children')) return;
      if (ch.dataset.lazy === '1') {
        ch.removeAttribute('data-lazy');
        if (type === 'object') renderObjectRows(ch, value, depth + 1, propPath);
        else renderArrayRows(ch, value, depth + 1, propPath);
      }
      const wasCollapsed = ch.style.display === 'none';
      ch.style.display = wasCollapsed ? '' : 'none';
      toggle.textContent = wasCollapsed ? '▾' : '▸';
      if (depth >= 1) {
        if (wasCollapsed) propEx().add(propPath);
        else propEx().delete(propPath);
      } else {
        if (wasCollapsed) propCol().delete(propPath);
        else propCol().add(propPath);
      }
      stripePropTree();
    });
    keyEl.appendChild(toggle);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'prop-key-toggle';
    spacer.style.visibility = 'hidden';
    spacer.textContent = '▾';
    keyEl.appendChild(spacer);
  }

  const keyText = document.createElement('span');
  keyText.className = 'prop-key-text';
  keyText.textContent = key;
  if (!isArrayIndex) {
    keyText.title = 'Double-click to rename';
    keyText.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineRename(keyEl, keyText, key, parentRef);
    });
  }
  keyEl.appendChild(keyText);

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
  valEl.appendChild(
    buildForceTypeBadge(type, (newType) => {
      castPropertyType(parentRef, key, value, type, newType, arrayIdx);
    })
  );

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
    sliderScrubTx = { prevRoot: deepClone(d.root), prevFormat: d.format, label: `Edit: ${key}` };
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
    sliderScrubDidChange = false;

    pushUndoCommand({
      label: tx.label,
      undo: () => {
        d.format = tx.prevFormat;
        d.root = deepClone(tx.prevRoot);
        d.recalcElementIds();
        d.dirty = true;
        docManager.dispatchEvent(new Event('tabs-changed'));
        renderAll();
      },
      redo: () => {
        d.format = nextFormat;
        d.root = deepClone(nextRoot);
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
    case 'string':
      buildStringWidget(valEl, value, onScalarChange);
      break;
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
      buildVec2Widget(valEl, value, onScalarChange);
      break;
    case 'vec3':
      buildVec3Widget(valEl, value, onScalarChange, sliderOpts);
      break;
    case 'vec4':
      buildVec4Widget(valEl, value, onScalarChange);
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
  propEx().clear();
  propCol().clear();
  const all = collectContainerPaths(docManager.activeDoc.root, '', 0);
  if (collapsed) {
    for (const k of Object.keys(docManager.activeDoc.root)) {
      if (docManager.activeDoc.root[k] !== null && typeof docManager.activeDoc.root[k] === 'object') propCol().add(k);
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
  if (toggle) toggle.textContent = '▾';
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

function showAddKeyDialog(parentRef, contextPath) {
  document.getElementById('addKeyDialog')?.remove();

  const d = docManager.activeDoc;
  if (!d) return;

  const suggestions =
    typeof VDataSuggestions !== 'undefined' && VDataSuggestions.getSuggestions
      ? VDataSuggestions.getSuggestions(d.fileName, contextPath ?? '')
      : [];

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
      label: 'Add key here…',
      icon: ICONS.plus,
      disabled: isArrayIndex,
      action: () => showAddKeyDialog(parentRef, parentPathFromRowPath(propPath))
    },
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
        '.slider-input-wrap, ' +
        '.prop-color-swatch, ' +
        '.components-widget, ' +
        '.prop-row-actions'
    ) != null
  );
}

function initRowDragDrop(row, dragHandle, key, parentRef, arrayIdx, propPath) {
  dragHandle.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(
      'application/x-vdata-row',
      JSON.stringify({ key, arrayIdx: typeof arrayIdx === 'number' ? arrayIdx : null, propPath })
    );
    row.classList.add('drag-source');
  });
  dragHandle.addEventListener('dragend', () => {
    row.classList.remove('drag-source', 'drag-over');
  });
  row.addEventListener('dragover', (e) => {
    if (isPropRowDragExemptTarget(e.target)) {
      row.classList.remove('drag-over');
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', (e) => {
    if (isPropRowDragExemptTarget(e.target)) return;
    e.preventDefault();
    row.classList.remove('drag-over');
    let src;
    try {
      src = JSON.parse(e.dataTransfer.getData('application/x-vdata-row'));
    } catch (_) {
      return;
    }
    if (!src || src.propPath === propPath) return;
    if (parentPathFromRowPath(src.propPath) !== parentPathFromRowPath(propPath)) return;
    reorderProp(parentRef, src, { key, arrayIdx, propPath });
  });
}

function reorderProp(parentRef, src, dst) {
  if (Array.isArray(parentRef)) {
    const si = src.arrayIdx;
    const di = dst.arrayIdx;
    if (typeof si !== 'number' || typeof di !== 'number') return;
    if (si === di) return;
    withDocUndo(() => {
      invalidatePropTreePathsForArrayContainer(arrayContainerPathFromRowPath(dst.propPath || ''));
      const [item] = parentRef.splice(si, 1);
      const insert = si < di ? di - 1 : di;
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
    entries.splice(dstIdx, 0, entry);
    for (const k of Object.keys(parentRef)) delete parentRef[k];
    for (const [k, v] of entries) parentRef[k] = v;
  }, 'Reorder');
}

function startInlineRename(keyEl, keyTextSpan, oldKey, parentRef) {
  if (keyEl.querySelector('.prop-key-rename')) return;

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'prop-key-rename';
  inp.value = oldKey;

  keyTextSpan.replaceWith(inp);
  inp.focus();
  inp.select();

  let aborted = false;

  function commit() {
    if (aborted) return;
    const newKey = inp.value.trim();
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

function buildStringWidget(container, value, onChange) {
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
  btn.title = prefix === 'soundevent' ? 'Sound event' : 'Resource path';
  btn.addEventListener('click', () => {
    /* File picker can be wired via electron showOpenDialog when exposed in preload. */
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
  ['X', 'Y', 'Z'].forEach((axis, i) => {
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge';
    lbl.textContent = axis;
    const wrap = buildSliderInput(v[i], 'float', (nv) => {
      v[i] = nv;
      onChange([...v]);
    }, sliderOpts);
    wrap.style.flex = '1';
    wrap.style.minWidth = '48px';
    container.appendChild(lbl);
    container.appendChild(wrap);
  });
}

function buildVec2Widget(container, value, onChange) {
  const v = Array.isArray(value) ? [...value] : [0, 0];
  ['X', 'Y'].forEach((axis, i) => {
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge';
    lbl.textContent = axis;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'prop-input';
    inp.style.width = '62px';
    inp.style.flex = 'none';
    inp.step = 'any';
    inp.value = String(v[i]);
    inp.addEventListener('change', () => {
      v[i] = parseFloat(inp.value) || 0;
      onChange([...v]);
    });
    container.appendChild(lbl);
    container.appendChild(inp);
  });
}

function buildVec4Widget(container, value, onChange) {
  const v = Array.isArray(value) ? [...value] : [0, 0, 0, 0];
  ['X', 'Y', 'Z', 'W'].forEach((axis, i) => {
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge';
    lbl.textContent = axis;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'prop-input';
    inp.style.width = '55px';
    inp.style.flex = 'none';
    inp.step = 'any';
    inp.value = String(v[i]);
    inp.addEventListener('change', () => {
      v[i] = parseFloat(inp.value) || 0;
      onChange([...v]);
    });
    container.appendChild(lbl);
    container.appendChild(inp);
  });
}

function commitValue(parentRef, key, newValue, arrayIdx, isStructural = false) {
  const d = docManager.activeDoc;
  if (!d) return;

  const useIdx = arrayIdx !== undefined && arrayIdx !== null && Array.isArray(parentRef);

  const prevRoot = deepClone(d.root);
  const prevFormat = d.format;

  if (useIdx) parentRef[arrayIdx] = newValue;
  else parentRef[key] = newValue;

  const nextRoot = deepClone(d.root);
  const nextFormat = d.format;

  if (isStructural) markPropTreeStructureDirty();

  pushUndoCommand({
    label: `Edit: ${key}`,
    undo: () => {
      d.format = prevFormat;
      d.root = deepClone(prevRoot);
      d.recalcElementIds();
      d.dirty = true;
      docManager.dispatchEvent(new Event('tabs-changed'));
      renderAll();
    },
    redo: () => {
      d.format = nextFormat;
      d.root = deepClone(nextRoot);
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
          if (toggle) toggle.textContent = '▾';
        }
        el = el.parentElement;
      }
    });
  }

  stripePropTree();
}

function initPropTreeSearch() {
  const inp = document.getElementById('propTreeSearch');
  if (!inp || inp.dataset.bound) return;
  inp.dataset.bound = '1';
  inp.addEventListener('input', () => filterPropTree(inp.value.trim().toLowerCase()));
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
        label: 'Add property…',
        icon: ICONS.plus,
        action: () => showAddKeyDialog(d.root, '')
      },
      { sep: true },
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

