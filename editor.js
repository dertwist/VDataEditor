// Delegate KV3 serialisation/parsing to the shared library (format/kv3.js).
const { jsonToKV3, kv3ToJSON } = KV3Format;
const { keyValueToJSON, jsonToKeyValue } = KeyValueFormat;

/** How the right-hand "source" tab and Save serialise: KV3, JSON, or Valve KeyValues (.vmat / .vmt). */
let documentFormat = 'kv3';

const kv3Document = VDataKV3.KV3Document.createSmartPropDefault();
let doc = kv3Document.getRoot();

function assignDocRoot(nextRoot) {
  kv3Document.setRoot(nextRoot);
  doc = kv3Document.getRoot();
}

let nextElementId = 1;
let currentFileName = 'Untitled';
let currentFilePath = null;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function fileExtension(name) {
  if (!name || typeof name !== 'string') return '';
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

function syncDocumentFormatFromFilename(name) {
  const ext = fileExtension(name);
  if (ext === 'vmat' || ext === 'vmt') documentFormat = 'keyvalue';
  else if (ext === 'json') documentFormat = 'json';
  else documentFormat = 'kv3';
}

function parseDocumentContent(text, hintFileName) {
  const ext = fileExtension(hintFileName);
  if (ext === 'vmat' || ext === 'vmt') return { root: keyValueToJSON(text), format: 'keyvalue' };
  if (ext === 'json') return { root: JSON.parse(text), format: 'json' };
  return { root: kv3ToJSON(text), format: 'kv3' };
}

function serializeDocument() {
  if (documentFormat === 'keyvalue') return jsonToKeyValue(doc);
  if (documentFormat === 'json') return JSON.stringify(doc, null, 2);
  return jsonToKV3(doc);
}

/** KV3 text extensions we can round-trip; used for Save As default name in browser. */
const KV3_LIKE_EXT = new Set([
  'vdata',
  'vsmart',
  'vpcf',
  'kv3',
  'vsurf',
  'vsndstck',
  'vsndevts',
  'vpulse',
  'vmdl',
  'txt'
]);

function defaultDownloadExtension() {
  if (documentFormat === 'keyvalue') return 'vmat';
  if (documentFormat === 'json') return 'json';
  const ext = fileExtension(currentFileName);
  if (KV3_LIKE_EXT.has(ext)) return ext;
  return 'vdata';
}

/** Smart-prop roots expect these arrays; do not add them to arbitrary KeyValues trees (e.g. VMAT). */
function ensureSmartPropRootArrays() {
  if (doc && doc.generic_data_type === 'CSmartPropRoot') {
    if (!doc.m_Children) doc.m_Children = [];
    if (!doc.m_Variables) doc.m_Variables = [];
  }
}

function markDirty() {
  kv3Document.dirty = true;
}

function recalcMaxId(node) {
  if (!node) return;
  if (node.m_nElementID != null && node.m_nElementID >= nextElementId) nextElementId = node.m_nElementID + 1;
  if (node.m_Children) node.m_Children.forEach(recalcMaxId);
  if (node.m_Modifiers) node.m_Modifiers.forEach(recalcMaxId);
  if (node.m_SelectionCriteria) node.m_SelectionCriteria.forEach(recalcMaxId);
}

function recalcAllIds() {
  nextElementId = 1;
  if (doc.m_Children) doc.m_Children.forEach(recalcMaxId);
  if (doc.m_Variables) doc.m_Variables.forEach(recalcMaxId);
}

// ── Undo / redo (command stack, no DOM history panel) ─────────────────
const commandUndoStack = [];
const commandRedoStack = [];
const MAX_UNDO_COMMANDS = 200;

function pushUndoCommand(cmd) {
  commandUndoStack.push(cmd);
  if (commandUndoStack.length > MAX_UNDO_COMMANDS) commandUndoStack.shift();
  commandRedoStack.length = 0;
}

function undo() {
  const cmd = commandUndoStack.pop();
  if (!cmd) return;
  cmd.undo();
  commandRedoStack.push(cmd);
}

function redo() {
  const cmd = commandRedoStack.pop();
  if (!cmd) return;
  cmd.redo();
  commandUndoStack.push(cmd);
}

/** Wrap a synchronous document mutation with undo/redo that snapshots `doc` and `documentFormat`. */
function withDocUndo(applyFn) {
  const prev = deepClone(doc);
  const prevFormat = documentFormat;
  applyFn();
  const next = deepClone(doc);
  const nextFormat = documentFormat;
  pushUndoCommand({
    undo: () => {
      documentFormat = prevFormat;
      assignDocRoot(deepClone(prev));
      doc = kv3Document.getRoot();
      recalcAllIds();
      markDirty();
      renderAll();
    },
    redo: () => {
      documentFormat = nextFormat;
      assignDocRoot(deepClone(next));
      doc = kv3Document.getRoot();
      recalcAllIds();
      markDirty();
      renderAll();
    }
  });
  markDirty();
  renderAll();
}

let _meFormat = 'json';
let _meLiveSyncTimer = null;

function updateMeGutter() {
  const ta = document.getElementById('manualEditor');
  const gutter = document.getElementById('meGutter');
  if (!ta || !gutter) return;
  const lines = ta.value.split('\n').length;
  let t = '';
  for (let i = 1; i <= lines; i++) t += i + '\n';
  gutter.textContent = t;
  gutter.scrollTop = ta.scrollTop;
}

function refreshManualEditor() {
  const ta = document.getElementById('manualEditor');
  if (!ta) return;
  const prev = ta.scrollTop;
  if (_meFormat === 'json') ta.value = JSON.stringify(doc, null, 2);
  else ta.value = serializeDocument();
  ta.scrollTop = prev;
  updateMeGutter();
}

function applyManualEdit() {
  const ta = document.getElementById('manualEditor');
  if (!ta) return;
  try {
    let parsed;
    if (_meFormat === 'json') {
      parsed = JSON.parse(ta.value);
      withDocUndo(() => {
        documentFormat = 'json';
        assignDocRoot(parsed);
        ensureSmartPropRootArrays();
        recalcAllIds();
      });
    } else {
      parsed = documentFormat === 'keyvalue' ? keyValueToJSON(ta.value) : kv3ToJSON(ta.value);
      withDocUndo(() => {
        assignDocRoot(parsed);
        ensureSmartPropRootArrays();
        recalcAllIds();
      });
    }
    setStatus(_meFormat === 'json' ? 'JSON applied' : documentFormat === 'keyvalue' ? 'KeyValues applied' : 'KV3 applied');
  } catch (e) {
    setStatus('Parse error: ' + e.message);
  }
}

function toggleMeSearchBar(forceOpen) {
  const bar = document.getElementById('meSearchBar');
  if (!bar) return;
  const open = forceOpen ?? bar.style.display === 'none';
  bar.style.display = open ? 'flex' : 'none';
  if (open) document.getElementById('meSearchInput')?.focus();
}

function initMeSearch(ta) {
  const searchInput = document.getElementById('meSearchInput');
  const replaceInput = document.getElementById('meReplaceInput');
  const matchCount = document.getElementById('meMatchCount');
  const closeBtn = document.getElementById('meSearchClose');
  if (!searchInput) return;

  let _matches = [];
  let _matchIdx = 0;

  function findMatches() {
    const needle = searchInput.value;
    _matches = [];
    _matchIdx = 0;
    if (!needle) {
      matchCount.textContent = '0/0';
      return;
    }
    const text = ta.value;
    let idx = 0;
    while (true) {
      const pos = text.indexOf(needle, idx);
      if (pos === -1) break;
      _matches.push({ start: pos, end: pos + needle.length });
      idx = pos + 1;
    }
    matchCount.textContent = _matches.length > 0 ? `1/${_matches.length}` : '0/0';
  }

  function jumpToMatch(idx) {
    if (_matches.length === 0) return;
    _matchIdx = ((idx % _matches.length) + _matches.length) % _matches.length;
    const m = _matches[_matchIdx];
    ta.focus();
    ta.setSelectionRange(m.start, m.end);
    const linesBefore = ta.value.slice(0, m.start).split('\n').length - 1;
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, linesBefore * lineHeight - ta.clientHeight / 2);
    matchCount.textContent = `${_matchIdx + 1}/${_matches.length}`;
  }

  searchInput.addEventListener('input', () => {
    findMatches();
    if (_matches.length) jumpToMatch(0);
  });
  document.getElementById('meNextMatch')?.addEventListener('click', () => jumpToMatch(_matchIdx + 1));
  document.getElementById('mePrevMatch')?.addEventListener('click', () => jumpToMatch(_matchIdx - 1));

  document.getElementById('meReplaceOne')?.addEventListener('click', () => {
    if (_matches.length === 0) return;
    const m = _matches[_matchIdx];
    const repVal = replaceInput.value;
    ta.setSelectionRange(m.start, m.end);
    document.execCommand('insertText', false, repVal);
    findMatches();
    if (_matches.length) jumpToMatch(Math.min(_matchIdx, _matches.length - 1));
    updateMeGutter();
  });

  document.getElementById('meReplaceAll')?.addEventListener('click', () => {
    const needle = searchInput.value;
    if (!needle) return;
    const repVal = replaceInput.value;
    ta.value = ta.value.split(needle).join(repVal);
    findMatches();
    updateMeGutter();
  });

  closeBtn?.addEventListener('click', () => toggleMeSearchBar(false));

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jumpToMatch(e.shiftKey ? _matchIdx - 1 : _matchIdx + 1);
    }
    if (e.key === 'Escape') toggleMeSearchBar(false);
  });
}

function initManualEditPanel() {
  const ta = document.getElementById('manualEditor');
  const gutter = document.getElementById('meGutter');
  if (!ta) return;

  document.querySelectorAll('input[name="meFormat"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) _meFormat = radio.value;
      refreshManualEditor();
    });
  });

  document.getElementById('meApplyBtn')?.addEventListener('click', applyManualEdit);
  document.getElementById('meCopyBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(ta.value);
    setStatus('Copied to clipboard');
  });

  ta.addEventListener('scroll', () => {
    if (gutter) gutter.scrollTop = ta.scrollTop;
  });
  ta.addEventListener('input', () => {
    updateMeGutter();
    if (document.getElementById('meLiveSync')?.checked) {
      clearTimeout(_meLiveSyncTimer);
      _meLiveSyncTimer = setTimeout(applyManualEdit, 800);
    }
  });

  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault();
      toggleMeSearchBar();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      toggleMeSearchBar(true);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      applyManualEdit();
    }
  });

  initMeSearch(ta);
  updateMeGutter();
}

function openWidgetConfigDialog() {
  document.getElementById('widgetConfigDialog')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'widgetConfigDialog';
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Widget Config</span>
      <button type="button" class="modal-close" id="wc-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-section-label">User Rules <span class="modal-hint">(overwrite system)</span></div>
      <div id="wc-user-rules"></div>
      <div class="modal-row" style="margin-top:8px">
        <input type="text" id="wc-new-match" class="prop-input" placeholder="key or /regex/" style="flex:1">
        <select id="wc-new-type" class="prop-input" style="width:110px">
          <option>string</option><option>int</option><option>float</option><option>bool</option>
          <option>color</option><option>vec2</option><option>vec3</option><option>vec4</option>
          <option>resource</option><option>soundevent</option>
        </select>
        <button type="button" class="btn btn-sm btn-accent" id="wc-add-btn">Add</button>
      </div>
      <div class="modal-section-label" style="margin-top:12px">System Rules <span class="modal-hint">(read-only)</span></div>
      <div id="wc-sys-rules" class="wc-readonly-list"></div>
    </div>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  function refreshUserRules() {
    const container = document.getElementById('wc-user-rules');
    container.innerHTML = '';
    VDataSettings.getUserRules().forEach((rule) => {
      const row = document.createElement('div');
      row.className = 'modal-row';
      row.innerHTML = `<span class="wc-match"></span><span class="wc-type prop-type-badge">${rule.type}</span>`;
      row.querySelector('.wc-match').textContent = rule.match;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-sm btn-danger';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        VDataSettings.removeUserRule(rule.match);
        refreshUserRules();
        renderAll();
      });
      row.appendChild(del);
      container.appendChild(row);
    });
  }

  const sysContainer = document.getElementById('wc-sys-rules');
  VDataSettings.SYSTEM_CONFIG.rules.forEach((rule) => {
    const row = document.createElement('div');
    row.className = 'modal-row wc-sys-row';
    row.innerHTML = `<span class="wc-match"></span><span class="wc-type prop-type-badge">${rule.type}</span>`;
    row.querySelector('.wc-match').textContent = rule.match;
    sysContainer.appendChild(row);
  });

  refreshUserRules();

  document.getElementById('wc-add-btn').addEventListener('click', () => {
    const match = document.getElementById('wc-new-match').value.trim();
    const wtype = document.getElementById('wc-new-type').value;
    if (!match) return;
    VDataSettings.setUserRule(match, wtype);
    document.getElementById('wc-new-match').value = '';
    refreshUserRules();
    renderAll();
  });

  document.getElementById('wc-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function syncManualEditor() {
  refreshManualEditor();
}

let _meDebounceTimer = null;
function syncManualEditorDebounced() {
  clearTimeout(_meDebounceTimer);
  _meDebounceTimer = setTimeout(() => {
    _meDebounceTimer = null;
    syncManualEditor();
  }, 400);
}

function flushSyncDebounce() {
  if (_meDebounceTimer) {
    clearTimeout(_meDebounceTimer);
    _meDebounceTimer = null;
  }
}

function renderAll() {
  flushSyncDebounce();
  buildPropertyTree();
  syncManualEditor();
  updateStatusBar();
}

function updateStatusBar() {
  const elCount = countNodes(doc.m_Children);
  const varCount = (doc.m_Variables && doc.m_Variables.length) || 0;
  setStatus(`Elements: ${elCount} | Variables: ${varCount}`);
}

function countNodes(arr) {
  let c = 0;
  if (!arr) return 0;
  arr.forEach((n) => {
    c++;
    if (n.m_Children) c += countNodes(n.m_Children);
    if (n.m_Modifiers) c += n.m_Modifiers.length;
    if (n.m_SelectionCriteria) c += n.m_SelectionCriteria.length;
  });
  return c;
}

// ── Property Tree ───────────────────────────────────────────────────────

/** Stable paths like `m_Children/[0]/m_Foo` — kept across full tree rebuilds (undo, duplicate, etc.). */
const propTreeExpandedPaths = new Set();
/** Depth-0 rows only: user collapsed this branch (nested defaults are lazy + expandedPaths). */
const propTreeCollapsedPaths = new Set();

function escapePropPathRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Path to the array value for a row that represents an array element (strip trailing `/[i]`). */
function arrayContainerPathFromRowPath(rowPath) {
  return rowPath.replace(/\/\[\d+\]$/, '');
}

/** After splice, indices under this array change — drop expansion state for those rows (and descendants). */
function invalidatePropTreePathsForArrayContainer(arrayPath) {
  const re = new RegExp('^' + escapePropPathRe(arrayPath) + '/\\[\\d+\\](?:/|$)');
  for (const p of [...propTreeExpandedPaths]) if (re.test(p)) propTreeExpandedPaths.delete(p);
  for (const p of [...propTreeCollapsedPaths]) if (re.test(p)) propTreeCollapsedPaths.delete(p);
}

function invalidatePropTreePathsUnderObjectKey(keyPath) {
  const re = new RegExp('^' + escapePropPathRe(keyPath) + '(?:/|$)');
  for (const p of [...propTreeExpandedPaths]) if (re.test(p)) propTreeExpandedPaths.delete(p);
  for (const p of [...propTreeCollapsedPaths]) if (re.test(p)) propTreeCollapsedPaths.delete(p);
}

function clearPropTreeViewState() {
  propTreeExpandedPaths.clear();
  propTreeCollapsedPaths.clear();
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
  unknown: 'typeUnknown'
};

function resolveRowWidgetType(key, value) {
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

function buildPropertyTree() {
  const container = document.getElementById('propTreeRoot');
  if (!container) return;
  const scrollTop = container.scrollTop;
  container.innerHTML = '';
  if (!doc || typeof doc !== 'object') return;
  renderObjectRows(container, doc, 0, '');
  const q = document.getElementById('propTreeSearch')?.value?.trim().toLowerCase() ?? '';
  if (q) filterPropTree(q);
  requestAnimationFrame(() => {
    container.scrollTop = scrollTop;
  });
}

function renderObjectRows(container, obj, depth, parentPath) {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const type = resolveRowWidgetType(key, value);
    const rowPath = parentPath ? `${parentPath}/${key}` : key;
    const row = buildPropRow(key, value, type, depth, obj, undefined, rowPath);
    container.appendChild(row);
    if (type === 'object' && value !== null) {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      if (depth >= 1) {
        if (propTreeExpandedPaths.has(rowPath)) {
          renderObjectRows(children, value, depth + 1, rowPath);
          children.style.display = '';
        } else {
          children.dataset.lazy = '1';
          children.style.display = 'none';
        }
      } else {
        renderObjectRows(children, value, depth + 1, rowPath);
        if (propTreeCollapsedPaths.has(rowPath)) {
          children.style.display = 'none';
        }
      }
      container.appendChild(children);
      const toggle = row.querySelector('.prop-key-toggle');
      if (toggle && depth >= 1) toggle.textContent = propTreeExpandedPaths.has(rowPath) ? '▾' : '▸';
      else if (toggle && depth === 0 && propTreeCollapsedPaths.has(rowPath)) toggle.textContent = '▸';
    } else if (type === 'array') {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      if (depth >= 1) {
        if (propTreeExpandedPaths.has(rowPath)) {
          renderArrayRows(children, value, depth + 1, rowPath);
          children.style.display = '';
        } else {
          children.dataset.lazy = '1';
          children.style.display = 'none';
        }
      } else {
        renderArrayRows(children, value, depth + 1, rowPath);
        if (propTreeCollapsedPaths.has(rowPath)) {
          children.style.display = 'none';
        }
      }
      container.appendChild(children);
      const toggle = row.querySelector('.prop-key-toggle');
      if (toggle && depth >= 1) toggle.textContent = propTreeExpandedPaths.has(rowPath) ? '▾' : '▸';
      else if (toggle && depth === 0 && propTreeCollapsedPaths.has(rowPath)) toggle.textContent = '▸';
    }
  }
}

function renderArrayRows(container, arr, depth, parentPath) {
  if (!Array.isArray(arr)) return;
  arr.forEach((item, idx) => {
    const itemType = resolveRowWidgetType(`[${idx}]`, item);
    const rowPath = `${parentPath}/[${idx}]`;
    const row = buildPropRow(`[${idx}]`, item, itemType, depth, arr, idx, rowPath);
    container.appendChild(row);
    if (itemType === 'object' && item !== null) {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      if (depth >= 1) {
        if (propTreeExpandedPaths.has(rowPath)) {
          renderObjectRows(children, item, depth + 1, rowPath);
          children.style.display = '';
        } else {
          children.dataset.lazy = '1';
          children.style.display = 'none';
        }
      } else {
        renderObjectRows(children, item, depth + 1, rowPath);
        if (propTreeCollapsedPaths.has(rowPath)) {
          children.style.display = 'none';
        }
      }
      container.appendChild(children);
      const toggle = row.querySelector('.prop-key-toggle');
      if (toggle && depth >= 1) toggle.textContent = propTreeExpandedPaths.has(rowPath) ? '▾' : '▸';
      else if (toggle && depth === 0 && propTreeCollapsedPaths.has(rowPath)) toggle.textContent = '▸';
    } else if (itemType === 'array') {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      if (depth >= 1) {
        if (propTreeExpandedPaths.has(rowPath)) {
          renderArrayRows(children, item, depth + 1, rowPath);
          children.style.display = '';
        } else {
          children.dataset.lazy = '1';
          children.style.display = 'none';
        }
      } else {
        renderArrayRows(children, item, depth + 1, rowPath);
        if (propTreeCollapsedPaths.has(rowPath)) {
          children.style.display = 'none';
        }
      }
      container.appendChild(children);
      const toggle = row.querySelector('.prop-key-toggle');
      if (toggle && depth >= 1) toggle.textContent = propTreeExpandedPaths.has(rowPath) ? '▾' : '▸';
      else if (toggle && depth === 0 && propTreeCollapsedPaths.has(rowPath)) toggle.textContent = '▸';
    }
  });
}

function buildPropRow(key, value, type, depth, parentRef, arrayIdx, propPath) {
  const row = document.createElement('div');
  row.className = 'prop-row' + (type === 'object' || type === 'array' ? ' is-object' : '');
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

  const keyIcon = document.createElement('span');
  keyIcon.className = 'prop-type-icon-badge';
  keyIcon.title = type;
  const iconKey = TYPE_ICONS[type];
  if (iconKey && ICONS[iconKey]) keyIcon.innerHTML = ICONS[iconKey];
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
        if (wasCollapsed) propTreeExpandedPaths.add(propPath);
        else propTreeExpandedPaths.delete(propPath);
      } else {
        if (wasCollapsed) propTreeCollapsedPaths.delete(propPath);
        else propTreeCollapsedPaths.add(propPath);
      }
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
  } else {
    valEl.appendChild(
      buildTypeBadge(type, (newType) => {
        castPropertyType(parentRef, key, value, type, newType, arrayIdx);
      })
    );
  }

  const onScalarChange = (v) => commitValue(parentRef, key, v, arrayIdx, false);

  switch (type) {
    case 'bool':
      buildBoolWidget(valEl, value, onScalarChange);
      break;
    case 'int':
    case 'float':
      buildNumberWidget(valEl, value, type, onScalarChange);
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
      buildVec3Widget(valEl, value, onScalarChange);
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
  return row;
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
      setStatus(`Key "${newKey}" already exists`);
      return;
    }
    withDocUndo(() => {
      const entries = Object.entries(parentRef);
      for (const [k] of entries) delete parentRef[k];
      for (const [k, v] of entries) {
        parentRef[k === oldKey ? newKey : k] = v;
      }
    });
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

function buildNumberWidget(container, value, type, onChange) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.className = 'prop-input';
  inp.value = String(value);
  inp.step = type === 'int' ? '1' : 'any';
  inp.addEventListener('change', () => {
    const v = type === 'int' ? parseInt(inp.value, 10) : parseFloat(inp.value);
    if (!Number.isNaN(v)) onChange(v);
  });
  container.appendChild(inp);
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
  picker.addEventListener('input', () => {
    const rgb = fromHex(picker.value);
    swatch.style.background = picker.value;
    const next = arr.length === 4 ? [...rgb, arr[3]] : rgb;
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

function buildVec3Widget(container, value, onChange) {
  const v = Array.isArray(value) ? [...value] : [0, 0, 0];
  ['X', 'Y', 'Z'].forEach((axis, i) => {
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
  const useIdx = arrayIdx !== undefined && arrayIdx !== null && Array.isArray(parentRef);
  const oldValue = useIdx ? deepClone(parentRef[arrayIdx]) : deepClone(parentRef[key]);
  const newSnapshot = deepClone(newValue);

  pushUndoCommand({
    undo: () => {
      if (useIdx) parentRef[arrayIdx] = deepClone(oldValue);
      else parentRef[key] = deepClone(oldValue);
      markDirty();
      flushSyncDebounce();
      buildPropertyTree();
      syncManualEditor();
    },
    redo: () => {
      if (useIdx) parentRef[arrayIdx] = deepClone(newSnapshot);
      else parentRef[key] = deepClone(newSnapshot);
      markDirty();
      flushSyncDebounce();
      buildPropertyTree();
      syncManualEditor();
    }
  });

  if (useIdx) parentRef[arrayIdx] = newValue;
  else parentRef[key] = newValue;
  markDirty();
  if (isStructural) {
    flushSyncDebounce();
    buildPropertyTree();
    syncManualEditor();
  } else {
    syncManualEditorDebounced();
  }
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
}

function initPropTreeSearch() {
  const inp = document.getElementById('propTreeSearch');
  if (!inp || inp.dataset.bound) return;
  inp.dataset.bound = '1';
  inp.addEventListener('input', () => filterPropTree(inp.value.trim().toLowerCase()));
}

// ── File operations ──────────────────────────────────────────────────────

function newDocument() {
  withDocUndo(() => {
    clearPropTreeViewState();
    documentFormat = 'kv3';
    assignDocRoot({ generic_data_type: 'CSmartPropRoot', m_Children: [], m_Variables: [] });
    nextElementId = 1;
    currentFilePath = null;
    setDocumentTitle('Untitled');
  });
  setStatus('New document created');
}

function importKV3() {
  const input = document.getElementById('fileInput');
  input.accept = '.json,.vdata,.vsmart,.vpcf,.kv3,.vsurf,.vsndstck,.vsndevts,.vpulse,.vmdl,.vmat,.vmt,.txt';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const { root, format } = parseDocumentContent(ev.target.result, file.name);
        withDocUndo(() => {
          clearPropTreeViewState();
          documentFormat = format;
          assignDocRoot(root);
          ensureSmartPropRootArrays();
          recalcAllIds();
          currentFilePath = null;
          setDocumentTitle(file.name);
        });
        setStatus('Opened: ' + file.name);
      } catch (err) {
        setStatus('Open error: ' + err.message);
      }
    };
    reader.readAsText(file);
    input.value = '';
  };
  input.click();
}

function saveFile() {
  if (currentFilePath && window.electronAPI?.saveFile) {
    window.electronAPI
      .saveFile(currentFilePath, serializeDocument())
      .then(() => setStatus('Saved: ' + currentFileName))
      .catch((e) => setStatus('Save error: ' + e.message));
  } else {
    saveFileAs();
  }
}

function saveFileAs() {
  if (window.electronAPI?.showSaveDialog) {
    const base = currentFileName.replace(/\.[^.]+$/, '') || 'untitled';
    window.electronAPI
      .showSaveDialog({
        defaultPath: base + '.' + defaultDownloadExtension(),
        filters: [
          {
            name: 'VData / KV3',
            extensions: [
              'vdata',
              'vsmart',
              'vpcf',
              'kv3',
              'vsurf',
              'vsndstck',
              'vsndevts',
              'vpulse',
              'vmdl',
              'vmat',
              'vmt'
            ]
          },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      .then((result) => {
        if (result.canceled || !result.filePath) return;
        const savedName = result.filePath.split(/[\\/]/).pop();
        window.electronAPI
          .saveFile(result.filePath, serializeDocument())
          .then(() => {
            currentFilePath = result.filePath;
            syncDocumentFormatFromFilename(savedName);
            setDocumentTitle(savedName);
            setStatus('Saved: ' + currentFileName);
          })
          .catch((e) => setStatus('Save error: ' + e.message));
      });
  } else {
    const base = currentFileName.replace(/\.[^.]+$/, '') || 'untitled';
    const ext = defaultDownloadExtension();
    downloadBlob(new Blob([serializeDocument()], { type: 'text/plain' }), base + '.' + ext);
  }
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setStatus(msg) {
  document.getElementById('statusBar').textContent = msg;
}

function setDocumentTitle(name) {
  currentFileName = name;
  document.title = 'VDataEditor - ' + name;
}

// ── Docking ─────────────────────────────────────────────────────────────

const dockPanelMap = {
  properties: document.getElementById('propsPanel'),
  editors: document.getElementById('editorsPanel')
};
const dockFloatingState = {};

function undockPanel(id) {
  const panel = dockPanelMap[id];
  if (!panel || panel.classList.contains('dock-floating')) return;
  const rect = panel.getBoundingClientRect();
  const container = document.getElementById('dockContainer');
  dockFloatingState[id] = {
    nextSibling: panel.nextElementSibling,
    parent: panel.parentElement,
    width: panel.style.width,
    flex: panel.style.flex,
    minWidth: panel.style.minWidth
  };
  panel.classList.add('dock-floating');
  panel.style.left = Math.min(rect.left, window.innerWidth - 400) + 'px';
  panel.style.top = Math.min(rect.top, window.innerHeight - 300) + 'px';
  panel.style.width = Math.max(rect.width, 300) + 'px';
  panel.style.height = Math.max(rect.height, 250) + 'px';
  panel.style.flex = 'none';
  panel.style.minWidth = '0';
  container.appendChild(panel);
  const btn = panel.querySelector('.dock-handle-actions button[onclick*="undockPanel"]');
  if (btn) {
    btn.onclick = () => redockPanel(id);
    btn.title = 'Dock';
    btn.innerHTML = ICONS.dock;
  }
  makeDraggable(panel, panel.querySelector('.dock-handle'));
  makeResizable(panel);
}

function redockPanel(id) {
  const panel = dockPanelMap[id];
  if (!panel || !panel.classList.contains('dock-floating')) return;
  const state = dockFloatingState[id];
  panel.classList.remove('dock-floating');
  panel.style.left = '';
  panel.style.top = '';
  panel.style.height = '';
  panel.style.position = '';
  if (state) {
    panel.style.width = state.width;
    panel.style.flex = state.flex;
    panel.style.minWidth = state.minWidth;
    if (state.nextSibling && state.parent.contains(state.nextSibling)) {
      state.parent.insertBefore(panel, state.nextSibling);
    } else {
      state.parent.appendChild(panel);
    }
  }
  delete dockFloatingState[id];
  const btn = panel.querySelector('.dock-handle-actions button[title="Dock"]');
  if (btn) {
    btn.onclick = () => undockPanel(id);
    btn.title = 'Undock';
    btn.innerHTML = ICONS.undock;
  }
  panel.querySelectorAll('.floating-resize-handle').forEach((h) => h.remove());
}

function makeDraggable(panel, handle) {
  let startX, startY, startLeft, startTop;
  function onMouseDown(e) {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseInt(panel.style.left, 10) || 0;
    startTop = parseInt(panel.style.top, 10) || 0;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }
  function onMouseMove(e) {
    panel.style.left = startLeft + e.clientX - startX + 'px';
    panel.style.top = startTop + e.clientY - startY + 'px';
  }
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
  handle.addEventListener('mousedown', onMouseDown);
}

function makeResizable(panel) {
  const handle = document.createElement('div');
  handle.className = 'floating-resize-handle';
  handle.style.cssText =
    'position:absolute;bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize;z-index:101';
  panel.appendChild(handle);
  let startX, startY, startW, startH;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    startW = panel.offsetWidth;
    startH = panel.offsetHeight;
    function onMove(e2) {
      panel.style.width = Math.max(250, startW + e2.clientX - startX) + 'px';
      panel.style.height = Math.max(200, startH + e2.clientY - startY) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

document.querySelectorAll('.dock-resize-h').forEach((handle) => {
  let startX, leftPanel, rightPanel, startLeftW, startRightW;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('active');
    leftPanel = handle.previousElementSibling;
    rightPanel = handle.nextElementSibling;
    if (!leftPanel || !rightPanel) return;
    startX = e.clientX;
    startLeftW = leftPanel.offsetWidth;
    startRightW = rightPanel.offsetWidth;
    function onMove(e2) {
      const dx = e2.clientX - startX;
      const newLeft = Math.max(180, startLeftW + dx);
      const newRight = Math.max(200, startRightW - dx);
      leftPanel.style.width = newLeft + 'px';
      leftPanel.style.flex = 'none';
      rightPanel.style.width = newRight + 'px';
      rightPanel.style.flex = 'none';
    }
    function onUp() {
      handle.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
});

// ── Menu bar ────────────────────────────────────────────────────────────

function initMenuBar() {
  const menuItems = document.querySelectorAll('.menu-item[data-menu]');
  const dropdowns = document.querySelectorAll('.menu-dropdown');
  let activeDropdown = null;

  menuItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = item.dataset.menu;
      const dd = document.getElementById('menu' + menu.charAt(0).toUpperCase() + menu.slice(1));
      if (activeDropdown === dd) {
        activeDropdown.classList.remove('open');
        activeDropdown = null;
        return;
      }
      dropdowns.forEach((d) => d.classList.remove('open'));
      if (dd) {
        dd.classList.add('open');
        const rect = item.getBoundingClientRect();
        dd.style.left = rect.left + 'px';
        dd.style.top = rect.bottom + 'px';
        activeDropdown = dd;
      }
    });
  });

  document.addEventListener('click', () => {
    dropdowns.forEach((d) => d.classList.remove('open'));
    activeDropdown = null;
  });

  document.querySelectorAll('.menu-dropdown-item[data-action]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = el.dataset.action;
      if (action === 'newDocument') newDocument();
      else if (action === 'importKV3') importKV3();
      else if (action === 'saveFile') saveFile();
      else if (action === 'saveFileAs') saveFileAs();
      else if (action === 'quit') {
        if (window.electronAPI) window.electronAPI.quitApp();
        else window.close();
      } else if (action === 'undo') undo();
      else if (action === 'redo') redo();
      else if (action === 'exportUserConfig') {
        downloadBlob(new Blob([VDataSettings.exportUserConfig()], { type: 'application/json' }), 'vdata_widget_config.json');
      } else if (action === 'importUserConfig') {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json';
        inp.onchange = (ev) => {
          const f = ev.target.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = (ev2) => {
            try {
              VDataSettings.importUserConfig(ev2.target.result);
              renderAll();
              setStatus('Widget config imported');
            } catch (err) {
              setStatus('Import error: ' + err.message);
            }
          };
          r.readAsText(f);
        };
        inp.click();
      } else if (action === 'openWidgetConfig') {
        openWidgetConfigDialog();
      } else if (action === 'minimize' && window.electronAPI?.minimize) window.electronAPI.minimize();
      else if (action === 'zoom' && window.electronAPI?.zoom) window.electronAPI.zoom();
      else if (action === 'fullscreen' && window.electronAPI?.toggleFullScreen) window.electronAPI.toggleFullScreen();
      else if (action === 'about') {
        if (window.electronAPI?.getVersion) {
          window.electronAPI.getVersion().then((v) => setStatus(`VDataEditor v${v}`));
        } else {
          setStatus('VDataEditor');
        }
      }
      dropdowns.forEach((d) => d.classList.remove('open'));
      activeDropdown = null;
    });
  });
}

// ── Keyboard ────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'n') {
      e.preventDefault();
      newDocument();
      return;
    }
    if (e.key === 's') {
      e.preventDefault();
      if (e.shiftKey) saveFileAs();
      else saveFile();
      return;
    }
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (e.key === 'y' || e.key === 'Y') {
      e.preventDefault();
      redo();
      return;
    }
  }
});

// ── Init ────────────────────────────────────────────────────────────────

setDocumentTitle('Untitled');
initMenuBar();
initPropTreeSearch();
initManualEditPanel();
renderAll();

if (window.electronAPI?.getVersion) {
  window.electronAPI.getVersion().then((v) => {
    const lbl = document.getElementById('versionLabel');
    if (lbl) lbl.textContent = `VDataEditor v${v}`;
  });
}

if (window.electronAPI) {
  window.electronAPI.onOpenFile((filePath) => {
    window.electronAPI.readFile(filePath).then((content) => {
      try {
        const fileName = filePath.split(/[\\/]/).pop();
        const { root, format } = parseDocumentContent(content, fileName);
        withDocUndo(() => {
          clearPropTreeViewState();
          documentFormat = format;
          assignDocRoot(root);
          ensureSmartPropRootArrays();
          recalcAllIds();
          currentFilePath = filePath;
          setDocumentTitle(fileName);
        });
        setStatus('Opened: ' + fileName);
      } catch (err) {
        setStatus('Error opening file: ' + err.message);
      }
    });
  });
}
