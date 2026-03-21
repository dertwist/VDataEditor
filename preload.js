const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenFile: (callback) => ipcRenderer.on('open-file', (_event, path) => callback(path)),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  showSaveDialog: (opts) => ipcRenderer.invoke('show-save-dialog', opts),
  getVersion: () => ipcRenderer.invoke('get-version'),
  quitApp: () => ipcRenderer.send('app-quit'),
  minimize: () => ipcRenderer.send('window-minimize'),
  zoom: () => ipcRenderer.send('window-zoom'),
  toggleFullScreen: () => ipcRenderer.send('window-fullscreen')
})
