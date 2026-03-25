/** Above this UTF-16 length (~byte size for ASCII), first paint skips immediate CodeMirror full-doc sync (still happens debounced). */
const LARGE_DOCUMENT_UTF16_UNITS = 350_000;

/** Prefer Web Worker parse at or above this size (avoids main-thread stalls on large KV3). */
const WORKER_PARSE_MIN_UTF16 = 50_000;

async function parseContentMaybeWorker(filePath, content, fileName) {
  const ext = typeof fileName === 'string' ? fileName.split('.').pop().toLowerCase() : '';
  const isKv3Like = new Set([
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
  ]).has(ext);

  if (
    isKv3Like &&
    typeof window !== 'undefined' &&
    window.electronAPI &&
    typeof window.electronAPI.parseKv3DocumentNative === 'function' &&
    typeof content === 'string' &&
    content.length >= WORKER_PARSE_MIN_UTF16
  ) {
    try {
      const hint = typeof fileName === 'string' && fileName.length ? fileName : filePath;
      return await window.electronAPI.parseKv3DocumentNative(content, hint);
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[doc-manager] Native KV3 parse failed; using worker/JS fallback', e);
      }
    }
  }

  if (
    typeof window.parseFileContentInWorker === 'function' &&
    typeof content === 'string' &&
    content.length >= WORKER_PARSE_MIN_UTF16
  ) {
    try {
      const wr = await window.parseFileContentInWorker(filePath, content);
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[doc-manager] Parsed ' + filePath + ' in ' + wr.parseMs.toFixed(1) + 'ms (worker)');
      }
      return wr.parsed;
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[doc-manager] Worker parse failed, using main thread', e);
      }
    }
  }
  return parseDocumentContent(content, fileName);
}

async function yieldToUiForPaint() {
  if (typeof flushStatusToDom === 'function') {
    await flushStatusToDom();
    return;
  }
  await new Promise(function (resolve) {
    requestAnimationFrame(function () {
      requestAnimationFrame(resolve);
    });
  });
}

// Global busy cursor (ref-counted) so multiple async operations don't fight.
const _VDE_BUSY_CURSOR_CLASS = 'vde-cursor-busy';
let _vdeBusyCursorRefs = 0;

function beginBusyCursor() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  _vdeBusyCursorRefs++;
  document.documentElement.classList.add(_VDE_BUSY_CURSOR_CLASS);
}

function endBusyCursor() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  _vdeBusyCursorRefs = Math.max(0, _vdeBusyCursorRefs - 1);
  if (_vdeBusyCursorRefs === 0) document.documentElement.classList.remove(_VDE_BUSY_CURSOR_CLASS);
}

if (typeof window !== 'undefined') {
  window.VDataBusyCursor = { begin: beginBusyCursor, end: endBusyCursor };
}

class DocumentManager extends EventTarget {
  constructor() {
    super();
    this._docs = [];
    this._activeIdx = -1;
    this._openFileGeneration = 0;
  }

  get docs() {
    return this._docs;
  }
  get activeDoc() {
    return this._docs[this._activeIdx] ?? null;
  }
  get activeIdx() {
    return this._activeIdx;
  }

  newDoc() {
    const doc = new VDataDocument();
    this._docs.push(doc);
    this._activate(this._docs.length - 1);
    return doc;
  }

  async openFromContent(content, fileName, filePath = null) {
    const gen = ++this._openFileGeneration;
    beginBusyCursor();
    try {
      if (typeof setStatus === 'function') setStatus('Parsing ' + fileName + '…', 'info');
      await yieldToUiForPaint();
      const { root, format, kv3Header = '' } = await parseContentMaybeWorker(
        filePath || fileName,
        content,
        fileName
      );
      if (typeof setStatus === 'function') setStatus('Preparing document…', 'info');
      await yieldToUiForPaint();
      if (gen !== this._openFileGeneration) return null;
      const doc = new VDataDocument({ root, format, filePath, fileName, kv3Header });
      if (typeof content === 'string' && content.length >= LARGE_DOCUMENT_UTF16_UNITS) {
        doc.deferInitialManualEditorSync = true;
        doc.deferInitialPropTreeRender = true;
      }
      ensureSmartPropRootArrays(doc);
      doc.dirty = false;
      this._docs.push(doc);
      this._activate(this._docs.length - 1);
      if (filePath && window.electronAPI?.addRecentFile) await window.electronAPI.addRecentFile(filePath);
      return doc;
    } finally {
      endBusyCursor();
    }
  }

  async openFile(filePath) {
    const existing = this._docs.findIndex((d) => d.filePath === filePath);
    if (existing !== -1) {
      this._activate(existing);
      return this._docs[existing];
    }
    const gen = ++this._openFileGeneration;
    const fileName = pathBasename(filePath);
    beginBusyCursor();
    try {
      if (typeof setStatus === 'function') setStatus('Reading ' + fileName + '…', 'info');
      await yieldToUiForPaint();
      const content = await window.electronAPI.readFile(filePath);
      if (typeof setStatus === 'function') setStatus('Parsing ' + fileName + '…', 'info');
      await yieldToUiForPaint();
      const { root, format, kv3Header = '' } = await parseContentMaybeWorker(filePath, content, fileName);
      if (typeof setStatus === 'function') setStatus('Preparing document…', 'info');
      await yieldToUiForPaint();
      if (gen !== this._openFileGeneration) return null;
      const doc = new VDataDocument({ root, format, filePath, fileName, kv3Header });
      if (content.length >= LARGE_DOCUMENT_UTF16_UNITS) {
        doc.deferInitialManualEditorSync = true;
        doc.deferInitialPropTreeRender = true;
      }
      ensureSmartPropRootArrays(doc);
      doc.dirty = false;
      this._docs.push(doc);
      this._activate(this._docs.length - 1);
      if (window.electronAPI.addRecentFile) await window.electronAPI.addRecentFile(filePath);
      return doc;
    } finally {
      endBusyCursor();
    }
  }

  closeDoc(idx) {
    const doc = this._docs[idx];
    if (!doc) return false;
    if (doc.dirty) {
      const ok = window.confirm(`Close "${doc.fileName}"? Unsaved changes will be lost.`);
      if (!ok) return false;
    }
    this._removeAt(idx);
    return true;
  }

  forceClose(idx) {
    this._removeAt(idx);
  }

  _removeAt(idx) {
    const prevActive = this._activeIdx;
    this._docs.splice(idx, 1);
    const len = this._docs.length;
    if (len === 0) {
      this._activeIdx = -1;
    } else if (idx < prevActive) {
      this._activeIdx = prevActive - 1;
    } else if (idx === prevActive) {
      this._activeIdx = Math.min(idx, len - 1);
    } else {
      // Closed a tab to the right; the active document stays selected at the same index.
      this._activeIdx = prevActive;
    }
    if (typeof window.resetManualEditor === 'function') window.resetManualEditor();
    if (typeof window.terminateFileLoadWorker === 'function') window.terminateFileLoadWorker();
    this.dispatchEvent(new Event('tabs-changed'));
    this.dispatchEvent(new Event('active-changed'));
  }

  _activate(idx) {
    if (idx < 0 || idx >= this._docs.length) return;
    if (this._activeIdx === idx) return;
    this._activeIdx = idx;
    if (typeof window.resetManualEditor === 'function') window.resetManualEditor();
    this.dispatchEvent(new Event('active-changed'));
    this.dispatchEvent(new Event('tabs-changed'));
  }

  activateAt(idx) {
    if (idx < 0 || idx >= this._docs.length) return;
    this._activate(idx);
  }

  async saveActive() {
    const doc = this.activeDoc;
    if (!doc) return;
    if (doc.filePath && window.electronAPI?.saveFile) {
      await window.electronAPI.saveFile(doc.filePath, doc.serialize());
      doc.dirty = false;
      this.dispatchEvent(new Event('tabs-changed'));
      if (typeof setStatus === 'function') setStatus('Saved: ' + doc.fileName, 'saved');
    } else {
      await this.saveActiveAs();
    }
  }

  async saveActiveAs() {
    const doc = this.activeDoc;
    if (!doc) return;
    if (window.electronAPI?.showSaveDialog) {
      const base = doc.fileName.replace(/\.[^.]+$/, '') || 'untitled';
      const defExt = defaultDownloadExtensionForDoc(doc);
      const result = await window.electronAPI.showSaveDialog({
        defaultPath: base + '.' + defExt,
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
      });
      if (result.canceled || !result.filePath) return;
      const savedName = result.filePath.split(/[\\/]/).pop();
      await window.electronAPI.saveFile(result.filePath, doc.serialize());
      doc.filePath = result.filePath;
      doc.fileName = savedName;
      syncDocumentFormatFromFilename(doc, savedName);
      doc.dirty = false;
      if (window.electronAPI.addRecentFile) await window.electronAPI.addRecentFile(result.filePath);
      this.dispatchEvent(new Event('tabs-changed'));
      if (typeof setDocumentTitle === 'function') setDocumentTitle(savedName);
      if (typeof setStatus === 'function') setStatus('Saved: ' + doc.fileName, 'saved');
    } else {
      const base = doc.fileName.replace(/\.[^.]+$/, '') || 'untitled';
      const ext = defaultDownloadExtensionForDoc(doc);
      if (typeof downloadBlob === 'function') {
        downloadBlob(new Blob([doc.serialize()], { type: 'text/plain' }), base + '.' + ext);
      }
    }
  }
}

function defaultDownloadExtensionForDoc(d) {
  if (!d) return 'vdata';
  if (d.format === 'keyvalue') return 'vmat';
  if (d.format === 'json') return 'json';
  const ext = fileExtension(d.fileName);
  if (KV3_LIKE_EXT.has(ext)) return ext;
  return 'vdata';
}

const docManager = new DocumentManager();
