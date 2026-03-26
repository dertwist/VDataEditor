const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenFile: (callback) => ipcRenderer.on('open-file', (_event, path) => callback(path)),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readSchemaBundle: (game) => ipcRenderer.invoke('read-schema-bundle', game),
  parseKv3DocumentNative: (text, hintFileName) => ipcRenderer.invoke('parse-kv3-native', { text, hintFileName }),
  buildPropTreeInitialPlan: (root, options) => ipcRenderer.invoke('build-prop-tree-initial-plan', { root, options }),
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  showSaveDialog: (opts) => ipcRenderer.invoke('show-save-dialog', opts),
  pickResourceFile: (opts) => ipcRenderer.invoke('pick-resource-file', opts),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  openWin11FreezeReg: () => ipcRenderer.invoke('open-win11-freeze-reg'),
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  clearRecentFiles: () => ipcRenderer.invoke('clear-recent-files'),
  addRecentFile: (filePath) => ipcRenderer.invoke('add-recent-file', filePath),
  onRecentFilesUpdated: (callback) =>
    ipcRenderer.on('recent-files-updated', (_event, list) => callback(list)),
  quitApp: () => ipcRenderer.send('app-quit'),
  minimize: () => ipcRenderer.send('window-minimize'),
  zoom: () => ipcRenderer.send('window-zoom'),
  toggleFullScreen: () => ipcRenderer.send('window-fullscreen')
})
