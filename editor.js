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

function pathBasename(p) {
  if (!p || typeof p !== 'string') return '';
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/** Parent container path for a property row (sibling rows share the same parent path). */
function parentPathFromRowPath(propPath) {
  if (!propPath) return '';
  const i = propPath.lastIndexOf('/');
  if (i === -1) return '';
  return propPath.slice(0, i);
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
  commandUndoStack.push({
    undo: cmd.undo,
    redo: cmd.redo,
    label: cmd.label ?? 'Edit',
    time: cmd.time ?? Date.now()
  });
  if (commandUndoStack.length > MAX_UNDO_COMMANDS) commandUndoStack.shift();
  commandRedoStack.length = 0;
  refreshHistoryDock();
}

function undo() {
  const cmd = commandUndoStack.pop();
  if (!cmd) return;
  cmd.undo();
  commandRedoStack.push(cmd);
  refreshHistoryDock();
}

function redo() {
  const cmd = commandRedoStack.pop();
  if (!cmd) return;
  cmd.redo();
  commandUndoStack.push(cmd);
  refreshHistoryDock();
}

let _historyBatchDepth = 0;
let _historyRefreshQueued = false;

function buildHistoryEntry(cmd, idx, extraClass) {
  const el = document.createElement('div');
  el.className = `history-entry ${extraClass || ''}`.trim();
  const timeStr = cmd.time
    ? new Date(cmd.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';
  el.innerHTML = `
    <span class="history-entry-idx">${idx + 1}</span>
    <span class="history-entry-label"></span>
    <span class="history-entry-time">${timeStr}</span>
  `;
  const lbl = cmd.label || 'Edit';
  el.querySelector('.history-entry-label').textContent = lbl;
  el.title = lbl;

  el.addEventListener('click', () => {
    const currentTop = commandUndoStack.length - 1;
    const targetIdx = idx;
    if (targetIdx === currentTop) return;

    _historyBatchDepth++;
    try {
      if (targetIdx < currentTop) {
        for (let j = currentTop; j > targetIdx; j--) undo();
      } else if (targetIdx > currentTop) {
        for (let j = currentTop; j < targetIdx; j++) redo();
      }
    } finally {
      _historyBatchDepth--;
      if (_historyBatchDepth === 0 && _historyRefreshQueued) {
        _historyRefreshQueued = false;
        refreshHistoryDock();
      }
    }
  });

  return el;
}

function refreshHistoryDock() {
  if (_historyBatchDepth > 0) {
    _historyRefreshQueued = true;
    return;
  }
  const list = document.getElementById('historyList');
  if (!list) return;

  list.innerHTML = '';

  const totalUndo = commandUndoStack.length;

  commandUndoStack.forEach((cmd, i) => {
    const extra = totalUndo > 0 && i === totalUndo - 1 ? 'is-current' : '';
    list.appendChild(buildHistoryEntry(cmd, i, extra));
  });

  [...commandRedoStack]
    .reverse()
    .forEach((cmd, i) => {
      list.appendChild(buildHistoryEntry(cmd, totalUndo + i, 'is-redo'));
    });

  list.querySelector('.is-current')?.scrollIntoView({ block: 'nearest' });
}

function initHistoryDock() {
  const historyUndoBtn = document.getElementById('historyUndoBtn');
  const historyRedoBtn = document.getElementById('historyRedoBtn');
  const historyClearBtn = document.getElementById('historyClearBtn');
  if (historyUndoBtn && typeof ICONS !== 'undefined') historyUndoBtn.innerHTML = ICONS.undo;
  if (historyRedoBtn && typeof ICONS !== 'undefined') historyRedoBtn.innerHTML = ICONS.redo;
  if (historyClearBtn && typeof ICONS !== 'undefined') historyClearBtn.innerHTML = ICONS.x;

  historyUndoBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    undo();
  });
  historyRedoBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    redo();
  });

  historyClearBtn?.addEventListener('click', () => {
    commandUndoStack.length = 0;
    commandRedoStack.length = 0;
    refreshHistoryDock();
  });

  const meResizer = document.getElementById('meHistoryResizer');
  if (meResizer) {
    let startY;
    let editorWrap;
    let historyDock;
    let startEditorH;
    let startHistoryH;

    meResizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      meResizer.classList.add('active');
      editorWrap = meResizer.previousElementSibling;
      historyDock = meResizer.nextElementSibling;
      if (!editorWrap || !historyDock) return;

      startY = e.clientY;
      startEditorH = editorWrap.offsetHeight;
      startHistoryH = historyDock.offsetHeight;

      function onMove(e2) {
        const dy = e2.clientY - startY;
        const nextEditorH = Math.max(60, startEditorH + dy);
        const nextHistoryH = Math.max(40, startHistoryH - dy);
        editorWrap.style.flex = 'none';
        editorWrap.style.height = nextEditorH + 'px';
        historyDock.style.flex = 'none';
        historyDock.style.height = nextHistoryH + 'px';
      }

      function onUp() {
        meResizer.classList.remove('active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  refreshHistoryDock();
}

/** Wrap a synchronous document mutation with undo/redo that snapshots `doc` and `documentFormat`. */
function withDocUndo(applyFn, label) {
  const prev = deepClone(doc);
  const prevFormat = documentFormat;
  applyFn();
  const next = deepClone(doc);
  const nextFormat = documentFormat;
  pushUndoCommand({
    label: label ?? 'Edit',
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
  setStatus('Property edited', 'edited');
}

let _meFormat = 'json';
let _meLiveSyncTimer = null;
let _cmView = null;
let _cmFormatComp = null;
/** True while CM content is replaced from `doc` — avoids Live sync treating it as user input. */
let _cmSuppressLiveSync = false;

function buildCmTheme() {
  return CM.EditorView.theme({
    '&': {
      height: '100%',
      fontSize: '12px',
      fontFamily: 'var(--font-mono), monospace',
      background: 'var(--bg-base)',
      color: 'var(--text-primary)'
    },
    '.cm-content': { caretColor: 'var(--accent)' },
    '.cm-line': { padding: '0 8px' },
    '.cm-line:nth-child(even)': { background: 'rgba(255,255,255,.008)' },
    '.cm-activeLine': { background: 'rgba(var(--accent-rgb), 0.06) !important' },
    '.cm-gutters': {
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border-subtle)',
      color: 'var(--text-muted)'
    },
    '.cm-activeLineGutter': { background: 'rgba(var(--accent-rgb), 0.1)' },
    '.cm-keyword': { color: '#cba6f7' },
    '.cm-string': { color: '#a6e3a1' },
    '.cm-number': { color: '#fab387' },
    '.cm-atom': { color: '#89dceb' },
    '.cm-comment': { color: '#585b70', fontStyle: 'italic' },
    '.cm-property': { color: '#89b4fa' },
    '.cm-propertyName': { color: '#89b4fa' },
    '.cm-variable': { color: '#cdd6f4' },
    '.cm-searchMatch': { background: 'rgba(250,179,135,.25)', borderRadius: '2px' },
    '.cm-searchMatch-selected': { background: 'rgba(250,179,135,.55)' }
  });
}

function buildKv3Language() {
  return CM.StreamLanguage.define({
    name: 'kv3',
    token(stream) {
      if (stream.eatSpace()) return null;
      if (stream.match('//')) {
        stream.skipToEnd();
        return 'comment';
      }
      if (stream.match('/*')) {
        let ch;
        while ((ch = stream.next()) != null) {
          if (ch === '*' && stream.eat('/')) break;
        }
        return 'comment';
      }
      if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
      if (stream.match(/^(?:resource_name|soundevent|panorama|subclass_reference):/)) return 'keyword';
      if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return 'number';
      if (stream.match(/^(?:true|false|null)/)) return 'atom';
      if (stream.match(/^[{}[\]]/)) return 'keyword';
      if (stream.match(/^[a-zA-Z_][\w.]*/)) return 'variable';
      stream.next();
      return null;
    }
  });
}

function getCmLanguageExtension() {
  return _meFormat === 'json' ? CM.json() : buildKv3Language();
}

function refreshManualEditor() {
  if (!_cmView) return;
  const text = _meFormat === 'json' ? JSON.stringify(doc, null, 2) : serializeDocument();
  const prev = _cmView.scrollDOM.scrollTop;
  clearTimeout(_meLiveSyncTimer);
  _meLiveSyncTimer = null;
  _cmSuppressLiveSync = true;
  try {
    _cmView.dispatch({
      changes: { from: 0, to: _cmView.state.doc.length, insert: text }
    });
  } finally {
    _cmSuppressLiveSync = false;
  }
  _cmView.scrollDOM.scrollTop = prev;
}

function applyManualEdit() {
  if (!_cmView) return;
  const text = _cmView.state.doc.toString();
  try {
    let parsed;
    if (_meFormat === 'json') {
      parsed = JSON.parse(text);
      withDocUndo(() => {
        documentFormat = 'json';
        assignDocRoot(parsed);
        ensureSmartPropRootArrays();
        recalcAllIds();
      });
    } else {
      parsed = documentFormat === 'keyvalue' ? keyValueToJSON(text) : kv3ToJSON(text);
      withDocUndo(() => {
        assignDocRoot(parsed);
        ensureSmartPropRootArrays();
        recalcAllIds();
      });
    }
    setStatus(_meFormat === 'json' ? 'JSON applied' : documentFormat === 'keyvalue' ? 'KeyValues applied' : 'KV3 applied', 'edited');
  } catch (e) {
    setStatus('Parse error: ' + e.message, 'error');
  }
}

function toggleMeSearchBar(forceOpen) {
  const bar = document.getElementById('meSearchBar');
  if (!bar) return;
  const open = forceOpen ?? bar.style.display === 'none';
  bar.style.display = open ? 'flex' : 'none';
  if (open) document.getElementById('meSearchInput')?.focus();
}

function initMeSearchBridge() {
  const searchInput = document.getElementById('meSearchInput');
  const replaceInput = document.getElementById('meReplaceInput');
  const matchCount = document.getElementById('meMatchCount');

  let _matches = [];
  let _matchIdx = 0;

  function findInCm() {
    const needle = searchInput?.value ?? '';
    _matches = [];
    if (!needle || !_cmView) {
      if (matchCount) matchCount.textContent = '0/0';
      return;
    }
    const text = _cmView.state.doc.toString();
    let from = 0;
    while (true) {
      const pos = text.indexOf(needle, from);
      if (pos === -1) break;
      _matches.push({ from: pos, to: pos + needle.length });
      from = pos + 1;
    }
    if (matchCount) matchCount.textContent = _matches.length ? `1/${_matches.length}` : '0/0';
    _matchIdx = 0;
  }

  function jumpCm(idx) {
    if (!_matches.length || !_cmView) return;
    _matchIdx = ((idx % _matches.length) + _matches.length) % _matches.length;
    const m = _matches[_matchIdx];
    _cmView.dispatch({
      selection: CM.EditorSelection.create([CM.EditorSelection.range(m.from, m.to)]),
      scrollIntoView: true
    });
    if (matchCount) matchCount.textContent = `${_matchIdx + 1}/${_matches.length}`;
  }

  searchInput?.addEventListener('input', () => {
    findInCm();
    if (_matches.length) jumpCm(0);
  });
  document.getElementById('meNextMatch')?.addEventListener('click', () => jumpCm(_matchIdx + 1));
  document.getElementById('mePrevMatch')?.addEventListener('click', () => jumpCm(_matchIdx - 1));

  document.getElementById('meReplaceOne')?.addEventListener('click', () => {
    if (!_matches.length || !_cmView) return;
    const m = _matches[_matchIdx];
    _cmView.dispatch({ changes: { from: m.from, to: m.to, insert: replaceInput?.value ?? '' } });
    findInCm();
    jumpCm(Math.min(_matchIdx, _matches.length - 1));
  });

  document.getElementById('meReplaceAll')?.addEventListener('click', () => {
    if (!_cmView) return;
    const needle = searchInput?.value ?? '';
    if (!needle) return;
    const text = _cmView.state.doc.toString();
    const replaced = text.split(needle).join(replaceInput?.value ?? '');
    _cmView.dispatch({ changes: { from: 0, to: _cmView.state.doc.length, insert: replaced } });
    findInCm();
  });

  document.getElementById('meSearchClose')?.addEventListener('click', () => toggleMeSearchBar(false));

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jumpCm(e.shiftKey ? _matchIdx - 1 : _matchIdx + 1);
    }
    if (e.key === 'Escape') toggleMeSearchBar(false);
  });
}

function initManualEditPanel() {
  const mount = document.getElementById('cmEditor');
  if (!mount) return;
  if (typeof CM === 'undefined') {
    setStatus('CodeMirror bundle missing — run npm run build:cm', 'error');
    return;
  }

  _cmFormatComp = new CM.Compartment();
  const initialDoc = JSON.stringify(doc, null, 2);

  _cmView = new CM.EditorView({
    state: CM.EditorState.create({
      doc: initialDoc,
      extensions: [
        CM.lineNumbers(),
        CM.highlightActiveLine(),
        CM.highlightActiveLineGutter(),
        CM.drawSelection(),
        CM.history(),
        CM.search({ top: false }),
        CM.keymap.of([
          ...CM.defaultKeymap,
          ...CM.historyKeymap,
          ...CM.searchKeymap,
          { key: 'Mod-Enter', run: () => { applyManualEdit(); return true; } }
        ]),
        CM.Prec.highest(
          CM.keymap.of([
            { key: 'Mod-f', run: () => { toggleMeSearchBar(true); return true; } },
            { key: 'Mod-h', run: () => { toggleMeSearchBar(); return true; } }
          ])
        ),
        _cmFormatComp.of(getCmLanguageExtension()),
        buildCmTheme(),
        CM.EditorView.updateListener.of((update) => {
          if (
            !update.docChanged ||
            _cmSuppressLiveSync ||
            !document.getElementById('meLiveSync')?.checked
          ) {
            return;
          }
          clearTimeout(_meLiveSyncTimer);
          _meLiveSyncTimer = setTimeout(applyManualEdit, 800);
        })
      ]
    }),
    parent: mount
  });

  document.querySelectorAll('input[name="meFormat"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        _meFormat = radio.value;
        _cmView.dispatch({ effects: _cmFormatComp.reconfigure(getCmLanguageExtension()) });
        refreshManualEditor();
      }
    });
  });

  document.getElementById('meApplyBtn')?.addEventListener('click', applyManualEdit);
  document.getElementById('meCopyBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(_cmView.state.doc.toString());
    setStatus('Copied to clipboard', 'info');
  });

  initMeSearchBridge();
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
  setStatus(`Elements: ${elCount} | Variables: ${varCount}`, 'info');
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
  unknown: 'typeUnknown',
  components: 'typeVec3',
  readonly_string: 'typeString',
  float_slider_01: 'typeFloat'
};

function getActiveMode() {
  const sel = document.getElementById('editorModeSelect');
  const v = sel ? sel.value : 'auto';
  if (!v || v === 'auto') return window.VDataEditorModes.getModeForFile(currentFileName);
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
  const scrollTop = container.scrollTop;
  container.innerHTML = '';
  if (!doc || typeof doc !== 'object') return;
  renderObjectRows(container, doc, 0, '');
  const q = document.getElementById('propTreeSearch')?.value?.trim().toLowerCase() ?? '';
  if (q) filterPropTree(q);
  stripePropTree();
  requestAnimationFrame(() => {
    container.scrollTop = scrollTop;
  });
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
    const itemType = resolveRowWidgetType(`[${idx}]`, item, arr);
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
        if (wasCollapsed) propTreeExpandedPaths.add(propPath);
        else propTreeExpandedPaths.delete(propPath);
      } else {
        if (wasCollapsed) propTreeCollapsedPaths.delete(propPath);
        else propTreeCollapsedPaths.add(propPath);
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

  const onScalarChange = (v) => commitValue(parentRef, key, v, arrayIdx, false);

  switch (type) {
    case 'bool':
      buildBoolWidget(valEl, value, onScalarChange);
      break;
    case 'int':
    case 'float':
      buildNumberWidget(valEl, value, type, onScalarChange);
      break;
    case 'float_slider_01':
      buildFloatSlider01Widget(valEl, value, onScalarChange);
      break;
    case 'readonly_string':
      buildReadonlyStringWidget(valEl, value);
      break;
    case 'components':
      valEl.appendChild(
        buildComponentsWidget(value, (newArr) => {
          commitValue(parentRef, key, newArr, arrayIdx, true);
        })
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
  propTreeExpandedPaths.clear();
  propTreeCollapsedPaths.clear();
  const all = collectContainerPaths(doc, '', 0);
  if (collapsed) {
    for (const k of Object.keys(doc)) {
      if (doc[k] !== null && typeof doc[k] === 'object') propTreeCollapsedPaths.add(k);
    }
  } else {
    all.forEach(({ path, depth }) => {
      if (depth >= 1) propTreeExpandedPaths.add(path);
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
    const val = getValueAtPath(doc, path);
    if (type === 'object' && val && typeof val === 'object') renderObjectRows(ch, val, depth + 1, path);
    else if (type === 'array' && Array.isArray(val)) renderArrayRows(ch, val, depth + 1, path);
  }
  propTreeExpandedPaths.add(path);
  const val = getValueAtPath(doc, path);
  const sub = collectContainerPaths(val && typeof val === 'object' ? val : {}, path, depth);
  sub.forEach(({ path: p }) => propTreeExpandedPaths.add(p));
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

/** Scrub slider for int/float (Shift+click input for plain edit). opts.clamp01 clamps to [0,1]. */
function buildSliderInput(value, type, onChange, opts) {
  opts = opts || {};
  const clamp01 = !!opts.clamp01;
  const wrap = document.createElement('div');
  wrap.className = 'slider-input-wrap' + (clamp01 ? ' float-slider-01' : '');

  const track = document.createElement('div');
  track.className = 'slider-track';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'prop-input slider-input';
  input.value =
    type === 'float' || clamp01
      ? String(Number(value).toFixed(4)).replace(/\.?0+$/, '')
      : String(value);

  function updateTrack(v) {
    let pct = 0;
    if (clamp01) {
      const n = Math.max(0, Math.min(1, Number(v)));
      pct = n * 100;
    } else {
      const nv = Number(v);
      if (!Number.isFinite(nv)) pct = 0;
      else pct = Math.min(100, (Math.abs(nv) / (Math.abs(nv) + 100)) * 100);
    }
    track.style.width = pct + '%';
  }
  updateTrack(parseFloat(input.value) || 0);

  wrap.appendChild(track);
  wrap.appendChild(input);

  const STEP = type === 'int' ? 1 : 0.01;

  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target === input && !e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startVal = parseFloat(input.value);
    const base = Number.isFinite(startVal) ? startVal : 0;

    function onMove(e2) {
      const dx = e2.clientX - startX;
      const delta = dx * STEP;
      let newVal = base + delta;
      if (type === 'int') newVal = Math.round(newVal);
      else newVal = parseFloat(newVal.toFixed(6));
      if (clamp01) newVal = Math.max(0, Math.min(1, newVal));
      input.value = type === 'int' ? String(newVal) : newVal.toFixed(4);
      updateTrack(newVal);
      onChange(newVal);
    }
    function onUp() {
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.body.style.cursor = 'ew-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  input.addEventListener('change', () => {
    const v = type === 'int' ? parseInt(input.value, 10) : parseFloat(input.value);
    if (!Number.isNaN(v)) {
      let nv = v;
      if (clamp01) nv = Math.max(0, Math.min(1, nv));
      updateTrack(nv);
      onChange(nv);
    }
  });

  return wrap;
}

function buildNumberWidget(container, value, type, onChange) {
  container.appendChild(buildSliderInput(value, type, onChange));
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

function buildFloatSlider01Widget(container, value, onChange) {
  const v = typeof value === 'number' ? value : parseFloat(value) || 0;
  container.appendChild(
    buildSliderInput(
      v,
      'float',
      (nv) => onChange(nv),
      { clamp01: true }
    )
  );
}

function buildComponentsWidget(arr, onChange) {
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
      });
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
    const wrap = buildSliderInput(v[i], 'float', (nv) => {
      v[i] = nv;
      onChange([...v]);
    });
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
    },
    label: `Edit: ${key}`
  });

  if (useIdx) parentRef[arrayIdx] = newValue;
  else parentRef[key] = newValue;
  markDirty();
  setStatus('Property edited', 'edited');
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
  stripePropTree();
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
  setStatus('New document created', 'created');
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
        setStatus('Opened: ' + file.name, 'info');
      } catch (err) {
        setStatus('Open error: ' + err.message, 'error');
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
      .then(() => setStatus('Saved: ' + currentFileName, 'saved'))
      .catch((e) => setStatus('Save error: ' + e.message, 'error'));
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
            setStatus('Saved: ' + currentFileName, 'saved');
          })
          .catch((e) => setStatus('Save error: ' + e.message, 'error'));
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

const STATUS_STATES = {
  saved: { icon: '✓', cls: 'status-saved', flash: true },
  created: { icon: '+', cls: 'status-created', flash: false },
  edited: { icon: '●', cls: 'status-edited', flash: false },
  error: { icon: '✕', cls: 'status-error', flash: false },
  info: { icon: '', cls: '', flash: false }
};

function setStatus(msg, state = 'info') {
  const bar = document.getElementById('statusBar');
  if (!bar) return;

  const icon = document.getElementById('statusIcon');
  const msgEl = document.getElementById('statusMsg');

  bar.classList.remove('status-saved', 'status-created', 'status-edited', 'status-error', 'status-flash');

  const s = STATUS_STATES[state] ?? STATUS_STATES.info;
  if (s.cls) bar.classList.add(s.cls);
  if (icon) icon.textContent = s.icon;
  if (msgEl) msgEl.textContent = msg;

  if (s.flash) {
    // Restart animation reliably.
    void bar.offsetWidth;
    bar.classList.add('status-flash');
  }
}

function setDocumentTitle(name) {
  currentFileName = name;
  document.title = 'VDataEditor - ' + name;
  syncEditorModeSelect();
}

function syncEditorModeSelect() {
  const sel = document.getElementById('editorModeSelect');
  if (!sel || !window.VDataEditorModes) return;
  const detected = window.VDataEditorModes.getModeForFile(currentFileName);
  if (sel.value === 'auto') {
    sel.title = 'Property editor mode — Auto: ' + (detected?.label || 'Generic');
  } else {
    sel.title = 'Property editor mode';
  }
}

function initEditorModeSelect() {
  const sel = document.getElementById('editorModeSelect');
  if (!sel || sel.dataset.bound || !window.VDataEditorModes) return;
  sel.dataset.bound = '1';
  const generic = window.VDataEditorModes.getModeById('generic');
  if (generic) {
    const opt = document.createElement('option');
    opt.value = 'generic';
    opt.textContent = generic.label || 'Generic';
    sel.appendChild(opt);
  }
  window.VDataEditorModes.listModes().forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    syncEditorModeSelect();
    renderAll();
  });
  syncEditorModeSelect();
}

async function loadRecentFiles() {
  if (!window.electronAPI?.getRecentFiles) return;
  try {
    const list = await window.electronAPI.getRecentFiles();
    renderRecentMenu(list);
  } catch (_) {
    renderRecentMenu([]);
  }
}

function renderRecentMenu(list) {
  const container = document.getElementById('menuRecentFiles');
  if (!container) return;
  container.innerHTML = '';
  if (!list || !list.length) {
    const empty = document.createElement('div');
    empty.className = 'menu-dropdown-item';
    empty.style.opacity = '0.45';
    empty.textContent = 'No recent files';
    container.appendChild(empty);
    return;
  }
  list.forEach((p) => {
    const item = document.createElement('div');
    item.className = 'menu-dropdown-item';
    item.textContent = pathBasename(p);
    item.title = p;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      openFileByPath(p);
      document.querySelectorAll('.menu-dropdown').forEach((d) => d.classList.remove('open'));
    });
    container.appendChild(item);
  });
  const sep = document.createElement('div');
  sep.className = 'menu-sep';
  const clear = document.createElement('div');
  clear.className = 'menu-dropdown-item';
  clear.textContent = 'Clear Recent';
  clear.addEventListener('click', (e) => {
    e.stopPropagation();
    window.electronAPI.clearRecentFiles().then(() => renderRecentMenu([]));
    document.querySelectorAll('.menu-dropdown').forEach((d) => d.classList.remove('open'));
  });
  container.appendChild(sep);
  container.appendChild(clear);
}

async function openFileByPath(filePath) {
  if (!filePath || !window.electronAPI?.readFile) return;
  try {
    const content = await window.electronAPI.readFile(filePath);
    const fileName = pathBasename(filePath);
    const { root, format } = parseDocumentContent(content, fileName);
    withDocUndo(() => {
      clearPropTreeViewState();
      documentFormat = format;
      assignDocRoot(root);
      ensureSmartPropRootArrays();
      recalcAllIds();
      currentFilePath = filePath;
      setDocumentTitle(fileName);
    }, 'Open file');
    if (window.electronAPI.addRecentFile) await window.electronAPI.addRecentFile(filePath);
    setStatus('Opened: ' + fileName, 'info');
  } catch (err) {
    setStatus('Open error: ' + err.message, 'error');
  }
}

function initRecentFilesMenu() {
  const wrap = document.querySelector('.menu-submenu-wrap');
  const sub = document.getElementById('menuRecentFiles');
  if (!wrap || !sub) return;

  wrap.addEventListener('mouseenter', () => {
    if (window.electronAPI?.getRecentFiles) loadRecentFiles();
  });

  if (window.electronAPI?.onRecentFilesUpdated) {
    window.electronAPI.onRecentFilesUpdated((list) => renderRecentMenu(list));
  }
  loadRecentFiles();
}

function initPropDockToolbar() {
  const c = document.getElementById('tb-collapse-all');
  const x = document.getElementById('tb-expand-all');
  c?.addEventListener('click', () => setAllCollapsed(true));
  x?.addEventListener('click', () => setAllCollapsed(false));
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
      // Keep the dragged widths as flex-basis, but allow both panels to resize with the window.
      leftPanel.style.flex = `${newLeft} 1 ${newLeft}px`;
      rightPanel.style.width = newRight + 'px';
      rightPanel.style.flex = `${newRight} 1 ${newRight}px`;
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
              setStatus('Widget config imported', 'info');
            } catch (err) {
              setStatus('Import error: ' + err.message, 'error');
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
          window.electronAPI.getVersion().then((v) => setStatus(`VDataEditor v${v}`, 'info'));
        } else {
          setStatus('VDataEditor', 'info');
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

initMenuBar();
initPropTreeSearch();
initManualEditPanel();
initHistoryDock();
initEditorModeSelect();
initRecentFilesMenu();
initPropDockToolbar();
setDocumentTitle('Untitled');
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
        const fileName = pathBasename(filePath);
        const { root, format } = parseDocumentContent(content, fileName);
        withDocUndo(() => {
          clearPropTreeViewState();
          documentFormat = format;
          assignDocRoot(root);
          ensureSmartPropRootArrays();
          recalcAllIds();
          currentFilePath = filePath;
          setDocumentTitle(fileName);
        }, 'Open file');
        setStatus('Opened: ' + fileName, 'info');
      } catch (err) {
        setStatus('Error opening file: ' + err.message, 'error');
      }
    });
  });
}
