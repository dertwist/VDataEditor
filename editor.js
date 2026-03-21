// Delegate KV3 serialisation/parsing to the shared library (format/kv3.js).
const { jsonToKV3, kv3ToJSON } = KV3Format;

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

/** Wrap a synchronous document mutation with undo/redo that snapshots `doc`. */
function withDocUndo(applyFn) {
  const prev = deepClone(doc);
  applyFn();
  const next = deepClone(doc);
  pushUndoCommand({
    undo: () => {
      assignDocRoot(deepClone(prev));
      doc = kv3Document.getRoot();
      recalcAllIds();
      markDirty();
      renderAll();
    },
    redo: () => {
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

function syncRawEditors() {
  const jsonEl = document.getElementById('jsonEditor');
  if (jsonEl) jsonEl.value = JSON.stringify(doc, null, 2);
  const kv3El = document.getElementById('kv3Editor');
  if (kv3El) kv3El.value = jsonToKV3(doc);
}

function renderAll() {
  buildPropertyTree();
  syncRawEditors();
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
    if (isColorArray(key, value)) return 'color';
    if (isVec3Array(key, value)) return 'vec3';
    return 'array';
  }
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

function buildPropertyTree() {
  const container = document.getElementById('propTreeRoot');
  if (!container) return;
  container.innerHTML = '';
  if (!doc || typeof doc !== 'object') return;
  renderObjectRows(container, doc, 0);
  const q = document.getElementById('propTreeSearch')?.value?.trim().toLowerCase() ?? '';
  if (q) filterPropTree(q);
}

function renderObjectRows(container, obj, depth) {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const type = inferType(key, value);
    const row = buildPropRow(key, value, type, depth, obj, undefined);
    container.appendChild(row);
    if (type === 'object' && value !== null) {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      renderObjectRows(children, value, depth + 1);
      container.appendChild(children);
    } else if (type === 'array') {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      renderArrayRows(children, value, depth + 1);
      container.appendChild(children);
    }
  }
}

function renderArrayRows(container, arr, depth) {
  if (!Array.isArray(arr)) return;
  arr.forEach((item, idx) => {
    const itemType = inferType(`[${idx}]`, item);
    const row = buildPropRow(`[${idx}]`, item, itemType, depth, arr, idx);
    container.appendChild(row);
    if (itemType === 'object' && item !== null) {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      renderObjectRows(children, item, depth + 1);
      container.appendChild(children);
    } else if (itemType === 'array') {
      const children = document.createElement('div');
      children.className = 'prop-row-children';
      renderArrayRows(children, item, depth + 1);
      container.appendChild(children);
    }
  });
}

function buildPropRow(key, value, type, depth, parentRef, arrayIdx) {
  const row = document.createElement('div');
  row.className = 'prop-row' + (type === 'object' || type === 'array' ? ' is-object' : '');
  const d = Math.min(depth, 9);
  row.dataset.depth = String(d);
  if (depth > 9) row.style.setProperty('--prop-depth', String(depth));

  const keyEl = document.createElement('div');
  keyEl.className = 'prop-key';
  const pad = Math.min(depth, 12) * 16;
  keyEl.style.paddingLeft = pad + 'px';

  if (type === 'object' || type === 'array') {
    const toggle = document.createElement('span');
    toggle.className = 'prop-key-toggle';
    toggle.textContent = '▾';
    toggle.addEventListener('click', () => {
      const ch = row.nextElementSibling;
      if (!ch || !ch.classList.contains('prop-row-children')) return;
      const collapsed = ch.style.display === 'none';
      ch.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? '▾' : '▸';
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
  keyText.textContent = key;
  keyEl.appendChild(keyText);

  const valEl = document.createElement('div');
  valEl.className = 'prop-value';

  const badge = document.createElement('span');
  badge.className = 'prop-type-badge';
  badge.textContent = type;
  valEl.appendChild(badge);

  const onScalarChange = (v) => commitValue(parentRef, key, v, arrayIdx);

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
    case 'vec3':
      buildVec3Widget(valEl, value, onScalarChange);
      break;
    case 'object':
      valEl.appendChild(
        Object.assign(document.createElement('span'), {
          className: 'prop-type-badge',
          textContent: `{ ${Object.keys(value).length} keys }`
        })
      );
      break;
    case 'array':
      valEl.appendChild(
        Object.assign(document.createElement('span'), {
          className: 'prop-type-badge',
          textContent: `[ ${value.length} ]`
        })
      );
      break;
    case 'null':
      valEl.appendChild(
        Object.assign(document.createElement('span'), {
          className: 'prop-type-badge',
          textContent: 'null'
        })
      );
      break;
    default:
      buildStringWidget(valEl, String(value ?? ''), onScalarChange);
  }

  const actions = document.createElement('div');
  actions.className = 'prop-row-actions';

  const isArrayIndex = typeof arrayIdx === 'number';

  if (!isArrayIndex) {
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'prop-action-btn';
    renameBtn.title = 'Rename key';
    renameBtn.textContent = '✎';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startInlineRename(keyEl, keyText, key, parentRef);
    });
    actions.appendChild(renameBtn);
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
      if (isArrayIndex) parentRef.splice(arrayIdx, 1);
      else delete parentRef[key];
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

function commitValue(parentRef, key, newValue, arrayIdx) {
  const useIdx = arrayIdx !== undefined && arrayIdx !== null && Array.isArray(parentRef);
  const oldValue = useIdx ? deepClone(parentRef[arrayIdx]) : deepClone(parentRef[key]);
  const newSnapshot = deepClone(newValue);

  pushUndoCommand({
    undo: () => {
      if (useIdx) parentRef[arrayIdx] = deepClone(oldValue);
      else parentRef[key] = deepClone(oldValue);
      markDirty();
      buildPropertyTree();
      syncRawEditors();
    },
    redo: () => {
      if (useIdx) parentRef[arrayIdx] = deepClone(newSnapshot);
      else parentRef[key] = deepClone(newSnapshot);
      markDirty();
      buildPropertyTree();
      syncRawEditors();
    }
  });

  if (useIdx) parentRef[arrayIdx] = newValue;
  else parentRef[key] = newValue;
  markDirty();
  buildPropertyTree();
  syncRawEditors();
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

// ── Tabs & raw apply ───────────────────────────────────────────────────

function switchTab(btn, tabId) {
  btn.parentElement.querySelectorAll('.panel-tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  btn.closest('.panel').querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  if (tabId === 'jsonEdit') document.getElementById('jsonEditor').value = JSON.stringify(doc, null, 2);
  if (tabId === 'kv3Tab') document.getElementById('kv3Editor').value = jsonToKV3(doc);
}

function applyJSONEdit() {
  try {
    const newDoc = JSON.parse(document.getElementById('jsonEditor').value);
    withDocUndo(() => {
      assignDocRoot(newDoc);
      if (!doc.m_Children) doc.m_Children = [];
      if (!doc.m_Variables) doc.m_Variables = [];
      recalcAllIds();
    });
    setStatus('JSON applied successfully');
  } catch (e) {
    setStatus('Invalid JSON: ' + e.message);
  }
}

function applyKV3Edit() {
  try {
    document.getElementById('kv3Editor').removeAttribute('readonly');
    const kv3 = document.getElementById('kv3Editor').value;
    const parsed = kv3ToJSON(kv3);
    withDocUndo(() => {
      assignDocRoot(parsed);
      if (!doc.m_Children) doc.m_Children = [];
      if (!doc.m_Variables) doc.m_Variables = [];
      recalcAllIds();
    });
    setStatus('KV3 applied successfully');
  } catch (e) {
    setStatus('KV3 parse error: ' + e.message);
  }
}

function copyKV3() {
  navigator.clipboard.writeText(document.getElementById('kv3Editor').value);
  setStatus('KV3 copied to clipboard');
}

// ── File operations ──────────────────────────────────────────────────────

function newDocument() {
  withDocUndo(() => {
    assignDocRoot({ generic_data_type: 'CSmartPropRoot', m_Children: [], m_Variables: [] });
    nextElementId = 1;
    currentFilePath = null;
    setDocumentTitle('Untitled');
  });
  setStatus('New document created');
}

function importKV3() {
  const input = document.getElementById('fileInput');
  input.accept = '.json,.vsmart,.vdata,.vpcf,.kv3,.vsurf,.vsndstck,.vpulse,.txt';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = kv3ToJSON(ev.target.result);
        withDocUndo(() => {
          assignDocRoot(parsed);
          if (!doc.m_Children) doc.m_Children = [];
          if (!doc.m_Variables) doc.m_Variables = [];
          recalcAllIds();
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
      .saveFile(currentFilePath, jsonToKV3(doc))
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
        defaultPath: base + '.vdata',
        filters: [
          { name: 'VData / KV3', extensions: ['vsmart', 'vdata', 'vpcf', 'kv3'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      .then((result) => {
        if (result.canceled || !result.filePath) return;
        window.electronAPI
          .saveFile(result.filePath, jsonToKV3(doc))
          .then(() => {
            currentFilePath = result.filePath;
            setDocumentTitle(result.filePath.split(/[\\/]/).pop());
            setStatus('Saved: ' + currentFileName);
          })
          .catch((e) => setStatus('Save error: ' + e.message));
      });
  } else {
    const base = currentFileName.replace(/\.[^.]+$/, '') || 'untitled';
    downloadBlob(new Blob([jsonToKV3(doc)], { type: 'text/plain' }), base + '.vdata');
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
      else if (action === 'minimize' && window.electronAPI?.minimize) window.electronAPI.minimize();
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
        const parsed = content.trim().startsWith('<!--') ? kv3ToJSON(content) : JSON.parse(content);
        const fileName = filePath.split(/[\\/]/).pop();
        withDocUndo(() => {
          assignDocRoot(parsed);
          if (!doc.m_Children) doc.m_Children = [];
          if (!doc.m_Variables) doc.m_Variables = [];
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
