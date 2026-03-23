// ── Manual Edit Panel ─────────────────────────────────────────────────────
// Single CodeMirror 6 instance shared across all tabs.
// Model → CM:  syncManualEditor() / syncManualEditorDebounced()
// CM → Model:  applyManualEdit() via Apply button or Ctrl+Enter

(() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let _cmView = null; // CM EditorView, created once on first access
  let _cmFormatComp = null; // CM Compartment for language switching
  let _meFormat = 'json'; // 'json' | 'kv3' (radio); doc.format may be 'keyvalue'
  let _suppressSync = false; // true while CM is being written from model
  let _liveSyncTimer = null;
  let _debounceTimer = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _doc() {
    return docManager?.activeDoc ?? null;
  }

  function _serialize() {
    const d = _doc();
    if (!d) return '';
    const root = d.root ?? {};
    try {
      if (_meFormat === 'json') return JSON.stringify(root, null, 2);
      if (d.format === 'keyvalue') return KeyValueFormat.jsonToKeyValue(root);
      return KV3Format.jsonToKV3(root);
    } catch (e) {
      console.error('[ManualEditor] serialize failed:', e);
      return JSON.stringify(root, null, 2);
    }
  }

  function _setStatus(msg, type) {
    if (typeof setStatus === 'function') setStatus(msg, type);
  }

  // ── CodeMirror theme (Catppuccin-matching) ─────────────────────────────────

  function _buildTheme() {
    return CM.EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '12px',
        fontFamily: 'var(--font-mono), monospace',
        background: 'var(--bg-base)',
        color: 'var(--text-primary)'
      },
      '.cm-editor': { height: '100%' },
      '.cm-scroller': { overflow: 'auto', height: '100%' },
      '.cm-content': { caretColor: 'var(--accent)' },
      '.cm-line': { padding: '0 8px' },
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
      '.cm-property, .cm-propertyName': { color: '#89b4fa' },
      '.cm-variable': { color: '#cdd6f4' },
      '.cm-searchMatch': { background: 'rgba(250,179,135,.25)', borderRadius: '2px' },
      '.cm-searchMatch-selected': { background: 'rgba(250,179,135,.55)' }
    });
  }

  // ── KV3 language mode ──────────────────────────────────────────────────────

  function _buildKv3Lang() {
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

  function _langExt() {
    return _meFormat === 'json' ? CM.json() : _buildKv3Lang();
  }

  // ── CM init — called exactly once, on first syncManualEditor() ─────────────

  function _ensureCm() {
    if (_cmView) return true;

    const mount = document.getElementById('cmEditor');
    if (!mount) {
      console.error('[ManualEditor] #cmEditor not found in DOM');
      return false;
    }
    if (typeof CM === 'undefined') {
      _setStatus('CodeMirror bundle missing — run npm run build:cm', 'error');
      return false;
    }

    const checked = document.querySelector('input[name="meFormat"]:checked');
    if (checked) _meFormat = checked.value;

    _cmFormatComp = new CM.Compartment();

    try {
      _cmView = new CM.EditorView({
        state: CM.EditorState.create({
          doc: '',
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
              {
                key: 'Mod-Enter',
                run: () => {
                  applyManualEdit();
                  return true;
                }
              }
            ]),
            CM.Prec.highest(
              CM.keymap.of([
                { key: 'Mod-f', run: () => { toggleMeSearchBar(true); return true; } },
                { key: 'Mod-h', run: () => { toggleMeSearchBar(true); return true; } }
              ])
            ),
            _cmFormatComp.of(_langExt()),
            _buildTheme(),
            CM.EditorView.updateListener.of((upd) => {
              if (!upd.docChanged || _suppressSync) return;
              if (!document.getElementById('meLiveSync')?.checked) return;
              clearTimeout(_liveSyncTimer);
              _liveSyncTimer = setTimeout(applyManualEdit, 800);
            })
          ]
        }),
        parent: mount
      });
    } catch (e) {
      console.error('[ManualEditor] CM init failed:', e);
      _setStatus('Manual editor failed to start: ' + (e?.message ?? e), 'error');
      _cmView = null;
      return false;
    }

    document.getElementById('meApplyBtn')?.addEventListener('click', applyManualEdit);
    document.getElementById('meCopyBtn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(_cmView.state.doc.toString());
      _setStatus('Copied to clipboard', 'info');
    });

    document.querySelectorAll('input[name="meFormat"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        _meFormat = radio.value;
        _cmView.dispatch({ effects: _cmFormatComp.reconfigure(_langExt()) });
        syncManualEditor();
      });
    });

    _initSearchBridge();

    return true;
  }

  // ── Sync model → CM ────────────────────────────────────────────────────────

  function syncManualEditor() {
    if (!_ensureCm()) return;
    const text = _serialize();
    const scroll = _cmView.scrollDOM.scrollTop;

    clearTimeout(_liveSyncTimer);
    _liveSyncTimer = null;

    _suppressSync = true;
    try {
      _cmView.dispatch({
        changes: { from: 0, to: _cmView.state.doc.length, insert: text }
      });
    } finally {
      _suppressSync = false;
    }

    requestAnimationFrame(() => {
      if (_cmView) _cmView.scrollDOM.scrollTop = scroll;
    });
    try {
      _cmView.requestMeasure();
    } catch (_) {}
  }

  function syncManualEditorDebounced() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      syncManualEditor();
    }, 400);
  }

  function flushSyncDebounce() {
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
  }

  // ── Sync CM → model (Apply) ────────────────────────────────────────────────

  function applyManualEdit() {
    if (!_cmView) return;
    const d = _doc();
    if (!d) {
      _setStatus('No active document', 'error');
      return;
    }

    const text = _cmView.state.doc.toString();
    let parsed;

    try {
      if (_meFormat === 'json') {
        parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object') {
          throw new Error('Root must be a JSON object or array');
        }
      } else if (d.format === 'keyvalue') {
        parsed = KeyValueFormat.keyValueToJSON(text);
      } else {
        parsed = KV3Format.kv3ToJSON(text);
      }
    } catch (e) {
      _setStatus('Parse error: ' + e.message, 'error');
      return;
    }

    const label =
      _meFormat === 'json' ? 'Apply JSON' : d.format === 'keyvalue' ? 'Apply KeyValues' : 'Apply KV3';

    withDocUndo(() => {
      if (_meFormat === 'json') d.format = 'json';
      d.root = parsed;
      if (typeof ensureSmartPropRootArrays === 'function') ensureSmartPropRootArrays(d);
      d.recalcElementIds();
    }, label);

    _setStatus(label + ' — OK', 'edited');
  }

  // ── Search / replace ───────────────────────────────────────────────────────

  function toggleMeSearchBar(forceOpen) {
    const bar = document.getElementById('meSearchBar');
    if (!bar) return;
    const open = forceOpen ?? (bar.style.display === 'none');
    bar.style.display = open ? 'flex' : 'none';
    if (open) document.getElementById('meSearchInput')?.focus();
  }

  function _initSearchBridge() {
    const searchInput = document.getElementById('meSearchInput');
    const replaceInput = document.getElementById('meReplaceInput');
    const matchCount = document.getElementById('meMatchCount');

    let _matches = [];
    let _matchIdx = 0;

    function _scan() {
      _matches = [];
      const needle = searchInput?.value ?? '';
      if (!needle || !_cmView) {
        if (matchCount) matchCount.textContent = '0/0';
        return;
      }
      const full = _cmView.state.doc.toString();
      let from = 0;
      while (true) {
        const pos = full.indexOf(needle, from);
        if (pos === -1) break;
        _matches.push({ from: pos, to: pos + needle.length });
        from = pos + 1;
      }
      if (matchCount) matchCount.textContent = _matches.length ? `1/${_matches.length}` : '0/0';
      _matchIdx = 0;
    }

    function _jump(idx) {
      _scan();
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
      _scan();
      if (_matches.length) _jump(0);
    });
    document.getElementById('meNextMatch')?.addEventListener('click', () => _jump(_matchIdx + 1));
    document.getElementById('mePrevMatch')?.addEventListener('click', () => _jump(_matchIdx - 1));

    document.getElementById('meReplaceOne')?.addEventListener('click', () => {
      if (!_matches.length || !_cmView) return;
      const m = _matches[_matchIdx];
      _cmView.dispatch({ changes: { from: m.from, to: m.to, insert: replaceInput?.value ?? '' } });
      _jump(_matchIdx);
    });

    document.getElementById('meReplaceAll')?.addEventListener('click', () => {
      if (!_cmView) return;
      const needle = searchInput?.value ?? '';
      if (!needle) return;
      const full = _cmView.state.doc.toString();
      const replaced = full.split(needle).join(replaceInput?.value ?? '');
      _cmView.dispatch({ changes: { from: 0, to: _cmView.state.doc.length, insert: replaced } });
      _scan();
    });

    document.getElementById('meSearchClose')?.addEventListener('click', () => toggleMeSearchBar(false));

    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        _jump(e.shiftKey ? _matchIdx - 1 : _matchIdx + 1);
      }
      if (e.key === 'Escape') toggleMeSearchBar(false);
    });
  }

  window.resetManualEditor = () => {};

  window.flushSyncDebounce = flushSyncDebounce;
  window.syncManualEditor = syncManualEditor;
  window.syncManualEditorDebounced = syncManualEditorDebounced;
  window.applyManualEdit = applyManualEdit;
  window.toggleMeSearchBar = toggleMeSearchBar;
  window.initManualEditPanel = () => true;
})();
