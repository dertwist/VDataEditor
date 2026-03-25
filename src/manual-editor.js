// ── Manual Edit Panel ─────────────────────────────────────────────────────
// Single CodeMirror 6 instance shared across all tabs.
// Model → CM:  syncManualEditor() / syncManualEditorDebounced()
// CM → Model:  applyManualEdit() via Apply button or Ctrl+Enter

(() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let _cmView = null; // CM EditorView, created once on first access
  let _cmFormatComp = null; // CM Compartment for language switching
  let _themeComp = null; // CM Compartment for light/dark base theme
  let _meFormat = 'kv3'; // 'json' | 'kv3' (radio); doc.format may be 'keyvalue'
  let _suppressSync = false; // true while CM is being written from model
  let _liveSyncTimer = null;
  let _lastLiveSyncKeystrokeTs = 0;
  let _manualEditorDeferredApplyWhenPropsHidden = false;
  let _applyManualEditGeneration = 0;
  let _debounceTimer = null;
  let _manualEditorModelDirty = false;
  let _suppressManualDirtyMark = false;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _doc() {
    return docManager?.activeDoc ?? null;
  }

  function _getAdaptiveLiveSyncDelay(docLen) {
    const n = Number(docLen) || 0;
    if (n < 50_000) return 200;
    if (n < 200_000) return 400;
    if (n < 1_000_000) return 800;
    return 1_500;
  }

  function _isPropsPanelEffectivelyVisible() {
    const p = document.getElementById('propsPanel');
    if (!p) return true; // assume visible (safer than silently skipping)
    const st = window.getComputedStyle(p);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = p.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  }

  function _serialize() {
    const d = _doc();
    if (!d) return '';
    const root = d.root ?? {};
    try {
      if (_meFormat === 'json') return JSON.stringify(root, null, 2);
      if (d.format === 'keyvalue') return KeyValueFormat.jsonToKeyValue(root);
      return KV3Format.jsonToKV3(root, { fileName: d.fileName, header: d.kv3Header });
    } catch (e) {
      console.error('[ManualEditor] serialize failed:', e);
      return JSON.stringify(root, null, 2);
    }
  }

  function _setStatus(msg, type) {
    if (typeof setStatus === 'function') setStatus(msg, type);
  }

  // ── CodeMirror theme (Catppuccin-matching) ─────────────────────────────────

  function _codemirrorIsDark() {
    return document.documentElement.getAttribute('data-theme') !== 'light';
  }

  function _buildTheme() {
    return CM.EditorView.theme(
      {
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
        '.cm-searchMatch-selected': { background: 'rgba(250,179,135,.55)' },
        '.cm-selectionBackground': {
          background: 'rgba(var(--accent-rgb), 0.22) !important'
        },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
          background: 'rgba(var(--accent-rgb), 0.38) !important'
        }
      },
      { dark: _codemirrorIsDark() }
    );
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
    _themeComp = new CM.Compartment();

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
                  void applyManualEdit();
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
            _themeComp.of(_buildTheme()),
            CM.EditorView.updateListener.of((upd) => {
              if (!upd.docChanged || _suppressSync) return;
              if (!document.getElementById('meLiveSync')?.checked) return;
              if (!_isPropsPanelEffectivelyVisible()) {
                _manualEditorDeferredApplyWhenPropsHidden = true;
                clearTimeout(_liveSyncTimer);
                _liveSyncTimer = null;
                return;
              }
              clearTimeout(_liveSyncTimer);
              const isUndoRedo =
                Array.isArray(upd.transactions) &&
                upd.transactions.some((tr) => {
                  if (!tr || typeof tr.isUserEvent !== 'function') return false;
                  return (
                    tr.isUserEvent('undo') ||
                    tr.isUserEvent('redo') ||
                    tr.isUserEvent('select.undo') ||
                    tr.isUserEvent('select.redo')
                  );
                });

              const delay = isUndoRedo ? 0 : _getAdaptiveLiveSyncDelay(upd.state.doc.length);
              const typingTs = Date.now();
              _lastLiveSyncKeystrokeTs = typingTs;
              _liveSyncTimer = setTimeout(async () => {
                // Typing-stopped guard (defensive; debounce already cancels older timers).
                if (!isUndoRedo && Date.now() - typingTs < delay - 10) return;

                const prevForce =
                  typeof window !== 'undefined' ? window.__vde_forcePropTreeSyncFocusedInputs : undefined;
                if (typeof window !== 'undefined' && isUndoRedo) {
                  window.__vde_forcePropTreeSyncFocusedInputs = true;
                }
                try {
                  await applyManualEdit();
                } finally {
                  if (typeof window !== 'undefined' && isUndoRedo) {
                    window.__vde_forcePropTreeSyncFocusedInputs = prevForce;
                  }
                }
              }, delay);
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

    // ── Cross-panel reveal hotkey (Ctrl+Shift+F) ───────────────────────────
    // Property-tree side also binds a global handler; if that one exists,
    // we skip binding here to avoid duplicate behavior.
    if (!window.__vdeRevealHotkeyBound && !window.__vdeCtrlShiftFGlobalBound) {
      window.__vdeRevealHotkeyBound = true;
      document.addEventListener(
        'keydown',
        (e) => {
          if (!e || !e.ctrlKey || !e.shiftKey || (e.key || '').toLowerCase() !== 'f') return;
          // Only handle when manual editor is focused.
          const t = e.target;
          if (!t || !(t.closest?.('#cmEditor') || t.closest?.('.cm-editor'))) return;
          e.preventDefault();
          e.stopPropagation();
          revealPropTreeFromManualCursor();
        },
        { capture: true }
      );
    }

    return true;
  }

  function unescapeKV3QuotedString(s) {
    if (typeof s !== 'string') return '';
    // s is the inner contents (without surrounding quotes).
    return s.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
  }

  function parseScalarFromKv3Text(raw) {
    const t = String(raw ?? '').trim();
    if (!t) return null;
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (t.startsWith('"')) {
      const m = t.match(/^"((?:[^"\\]|\\.)*)"$/s);
      if (!m) return null;
      return unescapeKV3QuotedString(m[1]);
    }
    const num = Number(t);
    return Number.isFinite(num) ? num : null;
  }

  function revealPropTreeFromManualCursor() {
    try {
      if (!_cmView) return;
      if (!docManager?.activeDoc?.root) return;

      const pos = _cmView.state.selection.main.head;
      const line = _cmView.state.doc.lineAt(pos);
      const text = line.text;

      // KV3 assignment line:
      //   key = <value>
      //   "quoted.key" = <value>
      const m = text.match(
        /^\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_][A-Za-z0-9_.]*))\s*=\s*(.*?)\s*(?:(?:\/\/).*?)?$/
      );
      if (!m) return;

      const keyName = m[2] || unescapeKV3QuotedString(m[1]);
      if (!keyName) return;

      // Parse value from the remainder of the line (best-effort).
      const parsedValue = parseScalarFromKv3Text(m[3]);

      const rootEl = document.getElementById('propTreeRoot');
      if (!rootEl) return;
      const rows = rootEl.querySelectorAll('.prop-row');

      let bestRow = null;
      let bestOk = false;

      rows.forEach((row) => {
        const p = row.dataset?.propPath || '';
        if (!p) return;
        if (/\/\[\d+\]$/.test(p)) return; // array element row has no key segment
        const seg = p.split('/').pop();
        if (seg !== keyName) return;

        // If we could parse a scalar, prefer exact value match.
        if (parsedValue !== null && typeof VDataPathUtils !== 'undefined') {
          const v = VDataPathUtils.getAtPath(docManager.activeDoc.root, p);
          if (v === parsedValue) {
            bestRow = row;
            bestOk = true;
          }
        }

        if (!bestRow) bestRow = row;
      });

      if (!bestRow) return;

      bestRow.scrollIntoView({ block: 'center', behavior: 'auto' });
      const focusTarget =
        bestRow.querySelector('.prop-input:not([readonly])') ||
        bestRow.querySelector('.prop-input-bool') ||
        bestRow;
      if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus();
        if (typeof focusTarget.select === 'function') focusTarget.select();
      }
    } catch (_) {
      // Non-fatal: reveal is best-effort.
    }
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

    _manualEditorModelDirty = false;

    requestAnimationFrame(() => {
      if (_cmView) _cmView.scrollDOM.scrollTop = scroll;
    });
    try {
      _cmView.requestMeasure();
    } catch (_) {}
  }

  function markManualEditorNeedsSync() {
    if (_suppressManualDirtyMark) return;
    _manualEditorModelDirty = true;
  }

  function isEditorsPanelEffectivelyVisible() {
    const p = document.getElementById('editorsPanel');
    if (!p) return false;
    const st = window.getComputedStyle(p);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = p.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  }

  function syncManualEditorIfNeeded() {
    if (!isEditorsPanelEffectivelyVisible()) return;
    if (!_manualEditorModelDirty) return;
    syncManualEditor();
  }

  function attachEditorsPanelResizeSync() {
    const ep = document.getElementById('editorsPanel');
    if (!ep || typeof ResizeObserver === 'undefined') return;
    let lastVisible = isEditorsPanelEffectivelyVisible();
    const ro = new ResizeObserver(() => {
      const vis = isEditorsPanelEffectivelyVisible();
      if (vis && (!lastVisible || _manualEditorModelDirty)) syncManualEditorIfNeeded();
      lastVisible = vis;
    });
    ro.observe(ep);
  }

  function attachPropsPanelVisibilityDeferredApplySync() {
    const pp = document.getElementById('propsPanel');
    if (!pp || typeof ResizeObserver === 'undefined') return;
    let lastVisible = _isPropsPanelEffectivelyVisible();
    const ro = new ResizeObserver(() => {
      const vis = _isPropsPanelEffectivelyVisible();
      if (vis && !lastVisible && _manualEditorDeferredApplyWhenPropsHidden) {
        _manualEditorDeferredApplyWhenPropsHidden = false;
        applyManualEdit();
      }
      lastVisible = vis;
    });
    ro.observe(pp);
  }

  function syncManualEditorDebounced() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      syncManualEditor();
    }, 400);
  }

  /** Coalesce model→CM sync after property-tree edits; skips work when the editors panel is hidden (stays dirty until shown). */
  function scheduleManualEditorSyncFromModel() {
    markManualEditorNeedsSync();
    if (!isEditorsPanelEffectivelyVisible()) return;
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      if (!isEditorsPanelEffectivelyVisible()) return;
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

  async function applyManualEdit() {
    const gen = ++_applyManualEditGeneration;
    if (!_cmView) return;
    const d = _doc();
    if (!d) {
      _setStatus('No active document', 'error');
      return;
    }

    const text = _cmView.state.doc.toString();

    const label =
      _meFormat === 'json' ? 'Apply JSON' : d.format === 'keyvalue' ? 'Apply KeyValues' : 'Apply KV3';

    let parsed;
    try {
      const formatOverride =
        _meFormat === 'json' ? 'json' : d.format === 'keyvalue' ? 'keyvalue' : 'kv3';

      const hint = d.fileName || d.filePath || 'manual.kv3';

      const NATIVE_PARSE_MIN_UTF16 = 50_000;
      const canNativeKv3 =
        formatOverride === 'kv3' &&
        window.electronAPI &&
        typeof window.electronAPI.parseKv3DocumentNative === 'function' &&
        typeof text === 'string' &&
        text.length >= NATIVE_PARSE_MIN_UTF16;

      if (canNativeKv3) {
        parsed = await window.electronAPI.parseKv3DocumentNative(text, hint);
      } else if (typeof window.parseFileContentInWorker === 'function') {
        const wr = await window.parseFileContentInWorker(hint, text, formatOverride);
        parsed = wr?.parsed;
      } else {
        // Fallback (should be rare): parse on the main thread.
        if (formatOverride === 'json') {
          parsed = JSON.parse(text);
          if (parsed === null || typeof parsed !== 'object') {
            throw new Error('Root must be a JSON object or array');
          }
          parsed = { root: parsed, format: 'json' };
        } else if (formatOverride === 'keyvalue') {
          parsed = { root: KeyValueFormat.keyValueToJSON(text), format: 'keyvalue' };
        } else {
          const parsedDoc = KV3Format.parseKV3Document(text);
          const kv3Header =
            parsedDoc.header || d.kv3Header || KV3Format.detectKV3HeaderFromFileName(d.fileName);
          parsed = { root: parsedDoc.root, format: 'kv3', kv3Header: kv3Header };
        }
      }
    } catch (e) {
      if (gen !== _applyManualEditGeneration) return; // stale parse result
      _setStatus('Parse error: ' + (e?.message ? e.message : String(e)), 'error');
      return;
    }

    if (gen !== _applyManualEditGeneration) return; // stale parse result
    if (!parsed || typeof parsed !== 'object') return;

    try {
      const prevRoot = d.root;
      const prevFormat = d.format;
      const prevEx = [...d.expandedPaths];
      const prevCol = [...d.collapsedPaths];

      // Keep kv3Header updates compatible with the old sync path.
      if (parsed.format === 'kv3' && parsed.kv3Header) d.kv3Header = parsed.kv3Header;

      d.root = parsed.root;
      d.format = parsed.format;
      if (typeof ensureSmartPropRootArrays === 'function') ensureSmartPropRootArrays(d);
      const nextRoot = d.root;
      const nextFormat = d.format;
      d.root = prevRoot;
      d.format = prevFormat;
      if (typeof withDocUndo === 'function' && typeof VDataCommands !== 'undefined') {
        withDocUndo(
          {
            type: VDataCommands.CMD.DOC_REPLACE,
            rootBefore: prevRoot,
            rootAfter: nextRoot,
            formatBefore: prevFormat,
            formatAfter: nextFormat,
            expandedBefore: prevEx,
            expandedAfter: prevEx,
            collapsedBefore: prevCol,
            collapsedAfter: prevCol
          },
          label
        );
      }

      _setStatus(label + ' — OK', 'edited');
    } catch (e) {
      if (gen !== _applyManualEditGeneration) return;
      _setStatus('Apply error: ' + (e?.message ? e.message : String(e)), 'error');
    }
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

  window.resetManualEditor = () => {
    try {
      clearTimeout(_liveSyncTimer);
    } catch (_) {}
    _liveSyncTimer = null;
    try {
      clearTimeout(_debounceTimer);
    } catch (_) {}
    _debounceTimer = null;

    _manualEditorDeferredApplyWhenPropsHidden = false;
    _manualEditorModelDirty = false;

    // Invalidate any in-flight worker parse so stale results don't apply after a tab switch/close.
    _applyManualEditGeneration++;
  };

  attachEditorsPanelResizeSync();
  attachPropsPanelVisibilityDeferredApplySync();

  window.syncManualEditorTheme = function syncManualEditorTheme() {
    if (!_cmView || !_themeComp) return;
    try {
      _cmView.dispatch({ effects: _themeComp.reconfigure(_buildTheme()) });
    } catch (_) {}
  };

  window.flushSyncDebounce = flushSyncDebounce;
  window.markManualEditorNeedsSync = markManualEditorNeedsSync;
  window.scheduleManualEditorSyncFromModel = scheduleManualEditorSyncFromModel;
  window.syncManualEditor = syncManualEditor;
  window.syncManualEditorDebounced = syncManualEditorDebounced;
  window.applyManualEdit = applyManualEdit;
  window.toggleMeSearchBar = toggleMeSearchBar;
  window.getManualEditorCM = () => _cmView;
  window.__vdeRevealPropTreeFromManualCursor = revealPropTreeFromManualCursor;
  window.initManualEditPanel = () => true;
})();
