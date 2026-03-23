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

let _propTreeTable = null;
let _propTreeSearchQuery = '';

function escapeHtmlProp(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function flattenObjectRows(obj, depth, parentPath) {
  const rows = [];
  if (!obj || typeof obj !== 'object') return rows;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const type = resolveRowWidgetType(key, value, obj);
    const propPath = parentPath ? `${parentPath}/${key}` : key;
    const row = {
      id: propPath,
      propPath,
      key,
      depth,
      type,
      isContainer: type === 'object' || type === 'array'
    };
    if (row.isContainer && value !== null) {
      row._children =
        type === 'object'
          ? flattenObjectRows(value, depth + 1, propPath)
          : flattenArrayRows(value, depth + 1, propPath);
    }
    rows.push(row);
  }
  return rows;
}

function flattenArrayRows(arr, depth, parentPath) {
  const rows = [];
  if (!Array.isArray(arr)) return rows;
  arr.forEach((item, idx) => {
    const key = `[${idx}]`;
    const itemType = resolveRowWidgetType(key, item, arr);
    const propPath = `${parentPath}/${key}`;
    const row = {
      id: propPath,
      propPath,
      key,
      depth,
      type: itemType,
      isContainer: itemType === 'object' || itemType === 'array'
    };
    if (row.isContainer && item !== null) {
      row._children =
        itemType === 'object'
          ? flattenObjectRows(item, depth + 1, propPath)
          : flattenArrayRows(item, depth + 1, propPath);
    }
    rows.push(row);
  });
  return rows;
}

function getBindingForPath(propPath) {
  const d = docManager.activeDoc;
  const root = d?.root;
  if (!root) return null;
  const value = getValueAtPath(root, propPath);
  const parentPath = parentPathFromRowPath(propPath);
  const parentRef = parentPath ? getValueAtPath(root, parentPath) : root;
  const tail = parentPath ? propPath.slice(parentPath.length + 1) : propPath;
  const m = /^\[(\d+)\]$/.exec(tail);
  const key = m ? `[${m[1]}]` : tail;
  const arrayIdx = m ? parseInt(m[1], 10) : undefined;
  const type = resolveRowWidgetType(key, value, parentRef);
  return { key, value, type, parentRef, arrayIdx, propPath };
}

function syncTreeExpandFromDoc(table) {
  function walk(rowList) {
    if (!rowList || !rowList.length) return;
    for (let i = 0; i < rowList.length; i++) {
      const row = rowList[i];
      const d = row.getData();
      if (!d.isContainer) continue;
      const path = d.propPath;
      const depth = d.depth;
      const exp = depth >= 1 ? propEx().has(path) : !propCol().has(path);
      if (exp) {
        row.treeExpand();
        walk(row.getTreeChildren());
      } else {
        row.treeCollapse();
      }
    }
  }
  walk(table.getRows());
}

function propKeyFormatter(cell) {
  const d = cell.getRow().getData();
  const ik = TYPE_ICONS[d.type];
  const iconHtml = ik && ICONS[ik] ? ICONS[ik] : '';
  return (
    '<span class="prop-row-drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>' +
    '<span class="prop-type-icon-badge">' +
    iconHtml +
    '</span><span class="prop-key-text">' +
    escapeHtmlProp(d.key) +
    '</span>'
  );
}

function onPropKeyCellRendered(cell) {
  const handle = cell.getElement().querySelector('.prop-row-drag-handle');
  if (handle) initRowDragDropTabulator(cell.getRow(), handle);
}

function commitKeyRename(oldKey, newKey, propPath, parentRef) {
  if (!newKey || newKey === oldKey) return true;
  if (Object.prototype.hasOwnProperty.call(parentRef, newKey)) {
    setStatus(`Key "${newKey}" already exists`, 'error');
    return false;
  }

  const d = docManager.activeDoc;
  if (!d) return false;

  const oldPath = propPath;
  const prefix = parentPathFromRowPath(oldPath);
  const newPath = prefix ? `${prefix}/${newKey}` : newKey;
  const oldPrefix = `${oldPath}/`;
  const newPrefix = `${newPath}/`;

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
  return true;
}

function onPropKeyCellEdited(cell) {
  const newKey = cell.getValue();
  const oldKey = cell.getOldValue();
  const row = cell.getRow();
  const d = row.getData();
  if (/^\[\d+\]$/.test(d.key)) return;
  const bind = getBindingForPath(d.propPath);
  if (!bind || typeof bind.arrayIdx === 'number') return;
  const ok = commitKeyRename(oldKey, newKey.trim(), d.propPath, bind.parentRef);
  if (!ok) {
    try {
      row.update({ key: oldKey });
    } catch (_) {}
  }
}

function getPropTabulatorHost() {
  return document.getElementById('propTabulatorHost');
}

function destroyPropTreeTable() {
  if (_propTreeTable) {
    try {
      _propTreeTable.destroy();
    } catch (_) {}
    _propTreeTable = null;
  }
}

function ensurePropTreeTable() {
  const host = getPropTabulatorHost();
  if (!host || typeof Tabulator === 'undefined') return null;
  if (_propTreeTable) return _propTreeTable;

  _propTreeTable = new Tabulator(host, {
    index: 'id',
    dataTree: true,
    dataTreeStartExpanded: false,
    dataTreeChildIndentWidth: 16,
    dataTreeChildField: '_children',
    height: '100%',
    layout: 'fitColumns',
    virtualDom: true,
    selectable: 1,
    editTriggerEvent: 'dblclick',
    columns: [
      {
        title: 'Key',
        field: 'key',
        widthGrow: 1,
        formatter: propKeyFormatter,
        cellRendered: onPropKeyCellRendered,
        editor:
          window.VDataKeyEditor && typeof window.VDataKeyEditor.keyEditor === 'function'
            ? window.VDataKeyEditor.keyEditor
            : 'input',
        editable: function (cell) {
          const k = cell.getRow().getData().key;
          return !/^\[\d+\]$/.test(k);
        },
        cellEdited: onPropKeyCellEdited
      },
      {
        title: 'Value',
        field: '_v',
        widthGrow: 2,
        formatter: function () {
          return '';
        },
        cellRendered: function (cell) {
          const el = cell.getElement();
          el.innerHTML = '';
          mountValueCell(el, cell.getRow().getData());
        },
        editable: false,
        headerSort: false
      }
    ],
    rowContextMenu: buildTabulatorRowContextMenu,
    rowFormatter: function (row) {
      const el = row.getElement();
      const d0 = row.getData();
      el.setAttribute('data-type', d0.type || '');
      let i = 0;
      try {
        i = typeof row.getPosition === 'function' ? row.getPosition(true) : 0;
      } catch (_) {
        i = 0;
      }
      el.classList.toggle('prop-row-even', i % 2 === 0);
      el.classList.toggle('prop-row-odd', i % 2 === 1);
      const q = _propTreeSearchQuery;
      if (!q) {
        el.classList.remove('search-hidden', 'search-match');
        return;
      }
      const d = row.getData();
      const bind = getBindingForPath(d.propPath);
      const keyText = (d.key || '').toLowerCase();
      let valText = '';
      try {
        valText = JSON.stringify(bind?.value ?? '').toLowerCase();
      } catch (_) {
        valText = '';
      }
      const match = keyText.includes(q) || valText.includes(q);
      el.classList.toggle('search-match', match);
      el.classList.toggle('search-hidden', !match);
    }
  });

  _propTreeTable.on('dataTreeRowExpanded', function (row) {
    const d = row.getData();
    if (d.depth >= 1) propEx().add(d.propPath);
    else propCol().delete(d.propPath);
  });
  _propTreeTable.on('dataTreeRowCollapsed', function (row) {
    const d = row.getData();
    if (d.depth >= 1) propEx().delete(d.propPath);
    else propCol().add(d.propPath);
  });

  return _propTreeTable;
}

function buildPropertyTree() {
  const wrap = document.getElementById('propTreeRoot');
  if (!wrap) return;
  const d = docManager.activeDoc;
  const root = d?.root;

  if (!root || typeof root !== 'object') {
    destroyPropTreeTable();
    if (getPropTabulatorHost()) getPropTabulatorHost().innerHTML = '';
    _propTreeBuiltForDoc = null;
    _propTreeStructuralDirty = true;
    return;
  }

  if (typeof Tabulator === 'undefined') {
    console.warn('[prop-tree] Tabulator not loaded');
    return;
  }

  if (_propTreeBuiltForDoc !== d) {
    _propTreeBuiltForDoc = d;
    _propTreeStructuralDirty = true;
  }

  const table = ensurePropTreeTable();
  if (!table) return;

  const scrollTop = wrap.scrollTop;
  const q = document.getElementById('propTreeSearch')?.value?.trim().toLowerCase() ?? '';
  _propTreeSearchQuery = q;

  if (!_propTreeStructuralDirty) {
    table.redraw(true);
    return;
  }

  _propTreeStructuralDirty = false;
  const rows = flattenObjectRows(root, 0, '');
  table
    .setData(rows)
    .then(function () {
      syncTreeExpandFromDoc(table);
      table.redraw(true);
      requestAnimationFrame(function () {
        wrap.scrollTop = scrollTop;
      });
    })
    .catch(function () {
      syncTreeExpandFromDoc(table);
    });
}

function updatePropRowValues(_container) {
  if (_propTreeTable && !_propTreeStructuralDirty) {
    _propTreeTable.redraw(true);
  }
}

function stripePropTree() {
  if (_propTreeTable) _propTreeTable.redraw(true);
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

function expandAllChildrenForTabulatorRow(tRow) {
  markPropTreeStructureDirty();
  function expandRec(r) {
    const d = r.getData();
    if (!d.isContainer) return;
    if (d.depth >= 1) propEx().add(d.propPath);
    else propCol().delete(d.propPath);
    r.treeExpand();
    const ch = r.getTreeChildren();
    if (ch && ch.length) ch.forEach(expandRec);
  }
  expandRec(tRow);
  buildPropertyTree();
}

function showContextMenu(items, x, y) {
  document.querySelectorAll('.ctx-menu-root').forEach((el) => el.remove());
  const menuRoot = document.createElement('div');
  menuRoot.className = 'ctx-menu-root';
  menuRoot.style.position = 'fixed';
  menuRoot.style.left = x + 'px';
  menuRoot.style.top = y + 'px';
  menuRoot.style.zIndex = '6000';

  items.forEach((it) => {
    if (it.sep) {
      const s = document.createElement('div');
      s.className = 'ctx-sep';
      menuRoot.appendChild(s);
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
        menuRoot.remove();
      });
    }
    menuRoot.appendChild(row);
  });

  document.body.appendChild(menuRoot);
  const close = (ev) => {
    if (!menuRoot.contains(ev.target)) {
      menuRoot.remove();
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

function buildTabulatorRowContextMenu(e, row) {
  const bind = getBindingForPath(row.getData().propPath);
  if (!bind) return [];
  const { key, value, type, parentRef, arrayIdx, propPath } = bind;
  const isContainer = type === 'object' || type === 'array';
  const isArrayIndex = typeof arrayIdx === 'number';
  const tRow = row;

  return [
    {
      label: 'Copy value',
      action: function () {
        navigator.clipboard.writeText(JSON.stringify(value));
      }
    },
    {
      label: 'Paste value',
      action: function () {
        navigator.clipboard.readText().then((text) => {
          try {
            const v = JSON.parse(text);
            commitValue(parentRef, key, v, arrayIdx, true);
          } catch (_) {}
        });
      }
    },
    { separator: true },
    {
      label: 'Duplicate',
      action: function () {
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
      action: function () {
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
    { separator: true },
    {
      label: 'Copy',
      action: function () {
        _clipboard = { key, value: deepClone(value), type };
        navigator.clipboard.writeText(JSON.stringify(value, null, 2)).catch(() => {});
      }
    },
    {
      label: 'Paste (replace value)',
      disabled: !_clipboard,
      action: function () {
        if (!_clipboard) return;
        commitValue(parentRef, key, deepClone(_clipboard.value), arrayIdx, true);
      }
    },
    {
      label: 'Paste as sibling',
      disabled: !_clipboard,
      action: function () {
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
    { separator: true },
    {
      label: 'Remove duplicates in array',
      disabled: type !== 'array' || !Array.isArray(value),
      action: function () {
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
    { separator: true },
    {
      label: 'Add key here…',
      disabled: isArrayIndex,
      action: function () {
        showAddKeyDialog(parentRef, parentPathFromRowPath(propPath));
      }
    },
    {
      label: 'Add object here…',
      disabled: isArrayIndex,
      action: function () {
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
      disabled: isArrayIndex,
      action: function () {
        withDocUndo(() => {
          let nk = 'new_list';
          let n = 1;
          while (Object.prototype.hasOwnProperty.call(parentRef, nk)) nk = 'new_list_' + ++n;
          parentRef[nk] = [];
        }, 'Add list');
      }
    },
    { separator: true },
    ...(isContainer
      ? [
          {
            label: 'Toggle collapse',
            action: function () {
              tRow.treeToggle();
            }
          },
          {
            label: 'Expand branch',
            action: function () {
              expandAllChildrenForTabulatorRow(tRow);
            }
          }
        ]
      : []),
    {
      label: 'Add child',
      disabled: !isContainer,
      action: function () {
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
    },
    { separator: true },
    {
      label: 'Copy property path',
      action: function () {
        navigator.clipboard.writeText(propPath);
      }
    }
  ];
}

function isPropRowDragExemptTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  return (
    el.closest(
      'input, textarea, button, select, ' +
        '.prop-key-toggle, ' +
        '.slider-input-wrap, ' +
        '.prop-color-swatch, ' +
        '.components-widget, ' +
        '.prop-row-actions, ' +
        '.pt-key-editor, ' +
        '.tabulator-editor, ' +
        '.tabulator-cell.tabulator-editing'
    ) != null
  );
}

function propPathIsUnderOrEqual(ancestorPath, candidatePath) {
  if (!ancestorPath || !candidatePath) return candidatePath === ancestorPath;
  return candidatePath === ancestorPath || candidatePath.startsWith(ancestorPath + '/');
}

function movedKeyNameForObject(src) {
  if (typeof src.key === 'string' && /^\[\d+\]$/.test(src.key)) return 'moved';
  if (typeof src.key === 'string' && src.key.length) return src.key;
  return 'moved';
}

function movePropIntoContainer(src, dstContainerPath, dstType) {
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

  withDocUndo(() => {
    let moved;
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
    } else {
      let nk = movedKeyNameForObject(src);
      const base = nk;
      let n = 1;
      while (Object.prototype.hasOwnProperty.call(target, nk)) nk = base + '_' + ++n;
      invalidatePropTreePathsUnderObjectKey(dstContainerPath);
      target[nk] = moved;
    }
  }, 'Move into');

  return true;
}

function parseRowDragPayload(dt) {
  const raw = dt.getData('application/x-vdata-row') || dt.getData('text/plain');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function initRowDragDropTabulator(tabRow, dragHandle) {
  const d = tabRow.getData();
  const rowEl = tabRow.getElement();

  dragHandle.addEventListener('dragstart', (e) => {
    const km = /^\[(\d+)\]$/.exec(d.key);
    const payload = JSON.stringify({
      key: d.key,
      arrayIdx: km ? parseInt(km[1], 10) : null,
      propPath: d.propPath
    });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-vdata-row', payload);
    e.dataTransfer.setData('text/plain', payload);
    rowEl.classList.add('drag-source');
  });
  dragHandle.addEventListener('dragend', () => {
    rowEl.classList.remove('drag-source', 'drag-over');
  });

  rowEl.addEventListener('dragover', (e) => {
    if (isPropRowDragExemptTarget(e.target)) {
      rowEl.classList.remove('drag-over');
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    rowEl.classList.add('drag-over');
  });
  rowEl.addEventListener('dragleave', () => rowEl.classList.remove('drag-over'));
  rowEl.addEventListener('drop', (e) => {
    if (isPropRowDragExemptTarget(e.target)) return;
    e.preventDefault();
    rowEl.classList.remove('drag-over');
    const src = parseRowDragPayload(e.dataTransfer);
    if (!src || !src.propPath) return;
    if (src.propPath === d.propPath) return;

    const dstType = d.type;
    if ((dstType === 'object' || dstType === 'array') && movePropIntoContainer(src, d.propPath, dstType)) {
      return;
    }

    const bind = getBindingForPath(d.propPath);
    if (!bind) return;
    if (parentPathFromRowPath(src.propPath) !== parentPathFromRowPath(d.propPath)) return;
    reorderProp(bind.parentRef, src, {
      key: bind.key,
      arrayIdx: bind.arrayIdx,
      propPath: bind.propPath
    });
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

function filterPropTree(query) {
  _propTreeSearchQuery = (query || '').trim().toLowerCase();
  if (_propTreeTable) {
    _propTreeTable.redraw(true);
  }
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

function mountValueCell(cellEl, rowData) {
  const d = rowData;
  const bind = getBindingForPath(d.propPath);
  if (!bind) return;
  const { key, value, type, parentRef, arrayIdx, propPath } = bind;
  const isArrayIndex = typeof arrayIdx === 'number';

  const wrap = document.createElement('div');
  wrap.className = 'prop-value prop-value-tabulator';

  if (STATIC_TYPE_SUMMARY.has(type)) {
    const sum = document.createElement('span');
    sum.className = 'prop-value-summary';
    if (type === 'object' && value !== null) sum.textContent = `{ ${Object.keys(value).length} keys }`;
    else if (type === 'array') sum.textContent = `[ ${value.length} items ]`;
    else if (type === 'null') sum.textContent = 'null';
    else sum.textContent = type;
    wrap.appendChild(sum);
  }
  wrap.appendChild(
    buildForceTypeBadge(type, (newType) => {
      castPropertyType(parentRef, key, value, type, newType, arrayIdx);
    })
  );

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
    const doc0 = docManager.activeDoc;
    if (!doc0) return;
    sliderScrubActive = true;
    sliderScrubDidChange = false;
    sliderScrubTx = { prevRoot: deepClone(doc0.root), prevFormat: doc0.format, label: `Edit: ${key}` };
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

    const d0 = docManager.activeDoc;
    if (!d0) return;

    const nextRoot = deepClone(d0.root);
    const nextFormat = d0.format;
    sliderScrubDidChange = false;

    pushUndoCommand({
      label: tx.label,
      undo: () => {
        d0.format = tx.prevFormat;
        d0.root = deepClone(tx.prevRoot);
        d0.recalcElementIds();
        d0.dirty = true;
        docManager.dispatchEvent(new Event('tabs-changed'));
        renderAll();
      },
      redo: () => {
        d0.format = nextFormat;
        d0.root = deepClone(nextRoot);
        d0.recalcElementIds();
        d0.dirty = true;
        docManager.dispatchEvent(new Event('tabs-changed'));
        renderAll();
      }
    });

    d0.dirty = true;
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

  const valInner = document.createElement('div');
  valInner.className = 'prop-value-widgets';

  switch (type) {
    case 'bool':
      buildBoolWidget(valInner, value, onScalarChange);
      break;
    case 'int':
    case 'float':
      buildNumberWidget(valInner, value, type, onScalarChange, sliderOpts);
      break;
    case 'float_slider_01':
      buildFloatSlider01Widget(valInner, value, onScalarChange, sliderOpts);
      break;
    case 'readonly_string':
      buildReadonlyStringWidget(valInner, value);
      break;
    case 'components':
      valInner.appendChild(buildComponentsWidget(value, onComponentsChange, sliderOpts));
      break;
    case 'string': {
      let listVals = [];
      if (typeof VDataSuggestions !== 'undefined' && VDataSuggestions.getSuggestedValues) {
        const pp = parentPathFromRowPath(propPath);
        const parentKey = pp ? pp.slice(pp.lastIndexOf('/') + 1) : '';
        listVals = VDataSuggestions.getSuggestedValues(key, Object.assign(schemaCtxForPropertyTree(), { parentKey }));
      }
      buildStringWidget(valInner, value, onScalarChange, { suggestedValues: listVals });
      break;
    }
    case 'resource':
      buildResourceWidget(valInner, value, 'resource_name', onScalarChange);
      break;
    case 'soundevent':
      buildResourceWidget(valInner, value, 'soundevent', onScalarChange);
      break;
    case 'color':
      buildColorWidget(valInner, value, onScalarChange);
      break;
    case 'vec2':
      buildVec2Widget(valInner, value, onScalarChange);
      break;
    case 'vec3':
      buildVec3Widget(valInner, value, onScalarChange, sliderOpts);
      break;
    case 'vec4':
      buildVec4Widget(valInner, value, onScalarChange);
      break;
    case 'object':
    case 'array':
    case 'null':
      break;
    default:
      buildStringWidget(valInner, String(value ?? ''), onScalarChange);
  }
  wrap.appendChild(valInner);

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

  wrap.appendChild(actions);
  cellEl.appendChild(wrap);
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
    if (e.target.closest('.tabulator-row')) return;
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

