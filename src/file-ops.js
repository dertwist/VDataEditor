function serializeDocument() {
  const d = docManager.activeDoc;
  return d ? d.serialize() : '';
}

function setDocumentTitle(name) {
  const d = docManager.activeDoc;
  if (d) d.fileName = name;
  document.title = 'VDataEditor - ' + name;
  syncEditorModeSelect();
  docManager.dispatchEvent(new Event('tabs-changed'));
}

function syncEditorModeSelect() {
  const sel = document.getElementById('editorModeSelect');
  if (!sel || !window.VDataEditorModes) return;
  const d = docManager.activeDoc;
  const fileName = d ? d.fileName : 'Untitled';
  const detected = window.VDataEditorModes.getModeForFile(fileName);
  if (sel.value === 'auto') {
    sel.title = 'Document context — Auto: ' + (detected?.label || 'Generic');
  } else {
    sel.title = 'Document context';
  }
  if (typeof refreshPropertyBrowserContextList === 'function') refreshPropertyBrowserContextList();
  if (typeof refreshPropertyBrowserPropertyList === 'function') refreshPropertyBrowserPropertyList();
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function newDocument() {
  docManager.newDoc();
  if (typeof setStatus === 'function') setStatus('New document created', 'created');
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
        const opened = docManager.openFromContent(ev.target.result, file.name, file.path || null);
        Promise.resolve(opened).then(() => {
          if (typeof setStatus === 'function') setStatus('Opened: ' + file.name, 'info');
        });
      } catch (err) {
        if (typeof setStatus === 'function') setStatus('Open error: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    input.value = '';
  };
  input.click();
}

function saveFile() {
  docManager.saveActive();
}

function saveFileAs() {
  docManager.saveActiveAs();
}

async function openFileByPath(filePath) {
  if (!filePath || !window.electronAPI?.readFile) return;
  try {
    await docManager.openFile(filePath);
    const d = docManager.activeDoc;
    if (typeof setStatus === 'function') setStatus('Opened: ' + (d ? d.fileName : ''), 'info');
  } catch (err) {
    if (typeof setStatus === 'function') setStatus('Open error: ' + err.message, 'error');
  }
}
