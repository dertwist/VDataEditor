const { kv3ToJSON } = KV3Format;
const { keyValueToJSON } = KeyValueFormat;

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
  if (!_cmView || !docManager.activeDoc) return;
  const text = _meFormat === 'json' ? JSON.stringify(docManager.activeDoc.root, null, 2) : serializeDocument();
  if (text == null || text === '') {
    // If this happens, it usually means document serialization failed or root is missing.
    setStatus?.('Manual editor text is empty', 'error');
  }
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
        docManager.activeDoc.format = 'json';
        docManager.activeDoc.root = parsed;
        ensureSmartPropRootArrays(docManager.activeDoc);
        docManager.activeDoc.recalcElementIds();
      });
    } else {
      parsed = docManager.activeDoc.format === 'keyvalue' ? keyValueToJSON(text) : kv3ToJSON(text);
      withDocUndo(() => {
        docManager.activeDoc.root = parsed;
        ensureSmartPropRootArrays(docManager.activeDoc);
        docManager.activeDoc.recalcElementIds();
      });
    }
    setStatus(_meFormat === 'json' ? 'JSON applied' : docManager.activeDoc.format === 'keyvalue' ? 'KeyValues applied' : 'KV3 applied', 'edited');
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
  setStatus('Initializing manual editor…', 'info');
  const mount = document.getElementById('cmEditor');
  if (!mount) return;
  if (typeof CM === 'undefined') {
    setStatus('CodeMirror bundle missing — run npm run build:cm', 'error');
    return;
  }
  if (!docManager.activeDoc) {
    console.error('initManualEditPanel: no active document');
    setStatus('No document to edit', 'error');
    return;
  }

  _cmFormatComp = new CM.Compartment();
  let initialDoc;
  try {
    initialDoc = JSON.stringify(docManager.activeDoc.root, null, 2);
  } catch (e) {
    console.error('initManualEditPanel: could not serialize root', e);
    setStatus('Could not load document for manual editor', 'error');
    return;
  }

  try {
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
  } catch (e) {
    console.error('initManualEditPanel: CodeMirror failed', e);
    setStatus('Manual editor failed to start: ' + (e && e.message ? e.message : String(e)), 'error');
    return;
  }

  setStatus('Manual editor ready', 'info');

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

  // Ensure the CM instance is populated immediately from the active doc.
  // (renderAll() should do this too, but this avoids init-order edge cases.)
  refreshManualEditor();
}

// Ensure other scripts can reliably call it, even if global bindings differ.
window.initManualEditPanel = initManualEditPanel;

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

// Make flush available to other scripts (e.g. editor.js undo paths).
window.flushSyncDebounce = flushSyncDebounce;
