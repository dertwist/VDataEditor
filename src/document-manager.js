class DocumentManager extends EventTarget {
  constructor() {
    super();
    this._docs = [];
    this._activeIdx = -1;
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

  openFromContent(content, fileName) {
    const { root, format } = parseDocumentContent(content, fileName);
    const doc = new VDataDocument({ root, format, filePath: null, fileName });
    ensureSmartPropRootArrays(doc);
    doc.recalcElementIds();
    doc.dirty = false;
    this._docs.push(doc);
    this._activate(this._docs.length - 1);
    return doc;
  }

  async openFile(filePath) {
    const existing = this._docs.findIndex((d) => d.filePath === filePath);
    if (existing !== -1) {
      this._activate(existing);
      return this._docs[existing];
    }
    const content = await window.electronAPI.readFile(filePath);
    const fileName = pathBasename(filePath);
    const { root, format } = parseDocumentContent(content, fileName);
    const doc = new VDataDocument({ root, format, filePath, fileName });
    ensureSmartPropRootArrays(doc);
    doc.recalcElementIds();
    doc.dirty = false;
    this._docs.push(doc);
    this._activate(this._docs.length - 1);
    if (window.electronAPI.addRecentFile) await window.electronAPI.addRecentFile(filePath);
    return doc;
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
    this._docs.splice(idx, 1);
    const newIdx = Math.min(idx, this._docs.length - 1);
    this._activeIdx = this._docs.length === 0 ? -1 : newIdx;
    this.dispatchEvent(new Event('tabs-changed'));
    this.dispatchEvent(new Event('active-changed'));
  }

  _activate(idx) {
    if (idx < 0 || idx >= this._docs.length) return;
    if (this._activeIdx === idx) return;
    this._activeIdx = idx;
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
