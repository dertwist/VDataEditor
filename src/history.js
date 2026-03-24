let _historyBatchDepth = 0;
let _historyRefreshQueued = false;

function pushUndoCommand(cmd) {
  const d = docManager.activeDoc;
  if (!d) return;
  d.pushUndo({
    undo: cmd.undo,
    redo: cmd.redo,
    label: cmd.label ?? 'Edit',
    time: cmd.time ?? Date.now()
  });
  refreshHistoryDock();
}

function undo() {
  const d = docManager.activeDoc;
  if (!d) return;
  const cmd = d.undo();
  if (!cmd) return;
  refreshHistoryDock();
}

function redo() {
  const d = docManager.activeDoc;
  if (!d) return;
  const cmd = d.redo();
  if (!cmd) return;
  refreshHistoryDock();
}

function buildEmptyHistoryEntry(displayIdx, isCurrent) {
  const el = document.createElement('div');
  el.className = `history-entry history-entry-empty${isCurrent ? ' is-current' : ''}`.trim();
  el.innerHTML = `
    <span class="history-entry-idx">${displayIdx + 1}</span>
    <span class="history-entry-label"></span>
    <span class="history-entry-time"></span>
  `;
  const lbl = 'Empty';
  el.querySelector('.history-entry-label').textContent = lbl;
  el.title = lbl;

  el.addEventListener('click', () => {
    const d = docManager.activeDoc;
    if (!d) return;
    const u = d.undoStack.length;
    const currentDisplayIdx = u === 0 ? 0 : u;
    if (displayIdx === currentDisplayIdx) return;

    _historyBatchDepth++;
    try {
      while (d.undoStack.length) undo();
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

function buildHistoryEntry(cmd, extraClass, displayIdx) {
  const el = document.createElement('div');
  el.className = `history-entry ${extraClass || ''}`.trim();
  const timeStr = cmd.time
    ? new Date(cmd.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';
  el.innerHTML = `
    <span class="history-entry-idx">${displayIdx + 1}</span>
    <span class="history-entry-label"></span>
    <span class="history-entry-time">${timeStr}</span>
  `;
  const lbl = cmd.label || 'Edit';
  el.querySelector('.history-entry-label').textContent = lbl;
  el.title = lbl;

  el.addEventListener('click', () => {
    const d = docManager.activeDoc;
    if (!d) return;
    const u = d.undoStack.length;
    const currentDisplayIdx = u === 0 ? 0 : u;
    if (displayIdx === currentDisplayIdx) return;

    _historyBatchDepth++;
    try {
      if (displayIdx <= u) {
        while (d.undoStack.length > displayIdx) undo();
        while (d.undoStack.length < displayIdx) redo();
      } else {
        for (let j = 0; j < displayIdx - u; j++) redo();
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

  const d = docManager.activeDoc;
  if (!d) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = '';

  const totalUndo = d.undoStack.length;

  list.appendChild(buildEmptyHistoryEntry(0, totalUndo === 0));

  d.undoStack.forEach((cmd, i) => {
    const extra = totalUndo > 0 && i === totalUndo - 1 ? 'is-current' : '';
    const disp = i + 1;
    list.appendChild(buildHistoryEntry(cmd, extra, disp));
  });

  [...d.redoStack]
    .reverse()
    .forEach((cmd, i) => {
      const disp = totalUndo + 1 + i;
      list.appendChild(buildHistoryEntry(cmd, 'is-redo', disp));
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
    const d = docManager.activeDoc;
    if (!d) return;
    d.undoStack.length = 0;
    d.redoStack.length = 0;
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
      historyDock.style.maxHeight = 'none';

      function onMove(e2) {
        const dy = e2.clientY - startY;
        const nextEditorH = Math.max(60, startEditorH + dy);
        const nextHistoryH = Math.max(40, startHistoryH - dy);
        editorWrap.style.flex = `${nextEditorH} 1 ${nextEditorH}px`;
        historyDock.style.flex = `${nextHistoryH} 1 ${nextHistoryH}px`;
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
