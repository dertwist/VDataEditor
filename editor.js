/** Set true after CodeMirror + history dock are initialized, so we do not render before panels exist. */
let _editorShellReady = false;

// ── Debug Console (runtime errors + console output) ──────────────────────
const _debugConsole = {
  entries: [],
  maxEntries: 400,
  open: false,
  hasNewErrors: false,
  captureInstalled: false,
  ui: {
    btn: null,
    panel: null,
    output: null,
    clearBtn: null,
    closeBtn: null
  },
  originalConsole: null
};

function _dbgTime() {
  // Short, stable time format for the console panel.
  try {
    return new Date().toISOString().slice(11, 19);
  } catch (_) {
    return '';
  }
}

function _dbgArgToString(v) {
  if (v instanceof Error) {
    const head = v.name ? `${v.name}: ${v.message}` : v.message;
    return v.stack ? `${head}\n${v.stack}` : String(head);
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || v == null) return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch (_) {
    try {
      return String(v);
    } catch (_) {
      return '[Unprintable]';
    }
  }
}

function debugConsoleRender() {
  const out = _debugConsole.ui.output;
  if (!out) return;
  out.textContent = _debugConsole.entries.join('\n');
  out.scrollTop = out.scrollHeight;
}

function debugConsoleSetOpen(open) {
  _debugConsole.open = !!open;
  const { panel, btn } = _debugConsole.ui;
  if (panel) {
    panel.classList.toggle('open', _debugConsole.open);
    panel.setAttribute('aria-hidden', String(!_debugConsole.open));
  }
  if (btn) {
    btn.classList.toggle('has-new', _debugConsole.hasNewErrors && !_debugConsole.open);
  }
  if (_debugConsole.open) {
    _debugConsole.hasNewErrors = false;
    if (btn) btn.classList.toggle('has-new', false);
    debugConsoleRender();
  }
}

function debugConsoleAdd(level, args, stack) {
  const time = _dbgTime();
  const parts = (Array.isArray(args) ? args : [args]).filter((x) => x !== undefined);
  const msg = parts.map(_dbgArgToString).filter(Boolean).join(' ');
  const head = time ? `[${time}] ${level.toUpperCase()}: ${msg}` : `${level.toUpperCase()}: ${msg}`;
  const full = stack ? `${head}\n${stack}` : head;

  _debugConsole.entries.push(full);
  if (_debugConsole.entries.length > _debugConsole.maxEntries) {
    _debugConsole.entries.splice(0, _debugConsole.entries.length - _debugConsole.maxEntries);
  }

  if ((level === 'error' || level === 'warn') && !_debugConsole.open) {
    _debugConsole.hasNewErrors = true;
    if (_debugConsole.ui.btn) _debugConsole.ui.btn.classList.add('has-new');
  }

  if (_debugConsole.open) debugConsoleRender();
}

function initDebugConsole() {
  const btn = document.getElementById('debugConsoleToggleBtn');
  const panel = document.getElementById('debugConsolePanel');
  const output = document.getElementById('debugConsoleOutput');
  const clearBtn = document.getElementById('debugConsoleClearBtn');
  const closeBtn = document.getElementById('debugConsoleCloseBtn');
  if (!btn || !panel || !output) return;

  _debugConsole.ui = { btn, panel, output, clearBtn, closeBtn };

  btn.addEventListener('click', () => debugConsoleSetOpen(!_debugConsole.open));
  clearBtn?.addEventListener('click', () => {
    _debugConsole.entries = [];
    _debugConsole.hasNewErrors = false;
    btn.classList.toggle('has-new', false);
    debugConsoleRender();
    debugConsoleAdd('info', ['Console cleared']);
  });
  closeBtn?.addEventListener('click', () => debugConsoleSetOpen(false));

  if (!_debugConsole.captureInstalled) {
    _debugConsole.captureInstalled = true;
    _debugConsole.originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug
    };

    const orig = _debugConsole.originalConsole;
    if (orig && typeof orig.error === 'function') {
      console.error = (...args) => {
        orig.error.apply(console, args);
        debugConsoleAdd('error', args);
      };
    }
    if (orig && typeof orig.warn === 'function') {
      console.warn = (...args) => {
        orig.warn.apply(console, args);
        debugConsoleAdd('warn', args);
      };
    }

    // Keep noise low when the console is closed.
    const maybeCapture = (level) => (...args) => {
      if (_debugConsole.open) debugConsoleAdd(level, args);
    };
    if (orig && typeof orig.log === 'function') console.log = (...args) => { orig.log.apply(console, args); if (_debugConsole.open) debugConsoleAdd('log', args); };
    if (orig && typeof orig.info === 'function') console.info = (...args) => { orig.info.apply(console, args); if (_debugConsole.open) debugConsoleAdd('info', args); };
    if (orig && typeof orig.debug === 'function') console.debug = (...args) => { orig.debug.apply(console, args); if (_debugConsole.open) debugConsoleAdd('debug', args); };

    // If something throws before init runs, we still get `window.error` / `unhandledrejection`.
  }
}

// If anything fails during startup/render, make it visible in the UI.
window.addEventListener('error', (e) => {
  const msg = e && e.message ? e.message : e && e.error ? String(e.error) : 'Unknown error';
  if (typeof setStatus === 'function') setStatus('Runtime error: ' + msg, 'error');
  debugConsoleAdd('error', ['Runtime error: ' + msg], e && e.error && e.error.stack ? e.error.stack : undefined);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg =
    e && e.reason && e.reason.message ? e.reason.message : e && e.reason ? String(e.reason) : 'Unknown rejection';
  if (typeof setStatus === 'function') setStatus('Unhandled promise: ' + msg, 'error');
  debugConsoleAdd('error', ['Unhandled promise: ' + msg], e && e.reason && e.reason.stack ? e.reason.stack : undefined);
});

initDebugConsole();

function markDirty() {
  const d = docManager.activeDoc;
  if (!d) return;
  d.dirty = true;
  docManager.dispatchEvent(new Event('tabs-changed'));
}

function withDocUndo(applyFn, label) {
  const d = docManager.activeDoc;
  if (!d) return;
  const prev = deepClone(d.root);
  const prevFormat = d.format;
  applyFn();
  const next = deepClone(d.root);
  const nextFormat = d.format;
  pushUndoCommand({
    label: label ?? 'Edit',
    undo: () => {
      d.format = prevFormat;
      d.root = deepClone(prev);
      d.recalcElementIds();
      d.dirty = true;
      docManager.dispatchEvent(new Event('tabs-changed'));
      renderAll();
    },
    redo: () => {
      d.format = nextFormat;
      d.root = deepClone(next);
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

function renderAll() {
  try {
    // Defined in src/manual-editor.js; accessed via window for reliability.
    window.flushSyncDebounce?.();
    if (typeof buildPropertyTree === 'function') buildPropertyTree();
    if (typeof syncManualEditor === 'function') syncManualEditor();
    if (typeof updateStatusBar === 'function') updateStatusBar();
  } catch (e) {
    console.error('renderAll failed', e);
    if (typeof setStatus === 'function') setStatus('Editor error: ' + (e && e.message ? e.message : String(e)), 'error');
  }
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

docManager.addEventListener('active-changed', () => {
  const d = docManager.activeDoc;
  if (d) {
    document.title = 'VDataEditor - ' + d.fileName;
    syncEditorModeSelect();
  }
  if (typeof refreshHistoryDock === 'function') refreshHistoryDock();
  if (_editorShellReady) renderAll();
});

initMenuBar();
initTabBar();

docManager.newDoc();

initPropTreeSearch();
window.initManualEditPanel?.();
initHistoryDock();
initEditorModeSelect();
initRecentFilesMenu();
initPropDockToolbar();

_editorShellReady = true;
renderAll();

if (window.electronAPI?.getVersion) {
  window.electronAPI.getVersion().then((v) => {
    const lbl = document.getElementById('versionLabel');
    if (lbl) lbl.textContent = `VDataEditor v${v}`;
  });
}

if (window.electronAPI) {
  window.electronAPI.onOpenFile((filePath) => {
    openFileByPath(filePath).catch(() => {});
  });
}
