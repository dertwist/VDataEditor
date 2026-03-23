const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron/main')
const path = require('node:path')
const fs = require('fs')

const RECENT_MAX = 10
const recentPath = () => path.join(app.getPath('userData'), 'recent.json')
let recentFiles = []

function loadRecent() {
  try {
    const raw = fs.readFileSync(recentPath(), 'utf8')
    const parsed = JSON.parse(raw)
    recentFiles = Array.isArray(parsed) ? parsed : []
  } catch {
    recentFiles = []
  }
}

function saveRecent() {
  try {
    fs.writeFileSync(recentPath(), JSON.stringify(recentFiles.slice(0, RECENT_MAX)), 'utf8')
  } catch (e) {
    console.error('saveRecent', e)
  }
}

function pushRecent(filePath) {
  if (!filePath || typeof filePath !== 'string') return
  recentFiles = [filePath, ...recentFiles.filter((p) => p !== filePath)].slice(0, RECENT_MAX)
  saveRecent()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recent-files-updated', recentFiles)
  }
}

/** Keep in sync with package.json build.fileAssociations */
const OPEN_FILE_EXTENSIONS =
  'vdata|vsmart|vpcf|kv3|vsurf|vsndstck|vsndevts|vpulse|vmdl|vmat|vmt'
const OPEN_FILE_RE = new RegExp(`\\.(${OPEN_FILE_EXTENSIONS})$`, 'i')

let mainWindow = null

function createWindow(filePath) {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    icon: path.join(__dirname, 'assets/images/vdata_editor/appicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  })
  mainWindow.loadFile('index.html')

  // Use custom in-app menu bar (styled to match editor) instead of native OS menu
  Menu.setApplicationMenu(null)

  // Once loaded, send the file path to renderer
  if (filePath) {
    mainWindow.webContents.once('did-finish-load', () => {
      pushRecent(filePath)
      mainWindow.webContents.send('open-file', filePath)
    })
  }
}

// macOS: file opened via Finder
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (mainWindow) {
    pushRecent(filePath)
    mainWindow.webContents.send('open-file', filePath)
  } else {
    app.whenReady().then(() => createWindow(filePath))
  }
})

app.whenReady().then(() => {
  loadRecent()
  // Windows: file path passed as CLI argument
  const args = process.argv.slice(app.isPackaged ? 1 : 2)
  const filePath = args.find((a) => OPEN_FILE_RE.test(a)) || null
  createWindow(filePath)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(null)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('read-file', async (_event, filePath) => {
  return fs.readFileSync(filePath, 'utf-8')
})

ipcMain.handle('save-file', async (_event, filePath, content) => {
  fs.writeFileSync(filePath, content, 'utf-8')
  pushRecent(filePath)
  return true
})

ipcMain.handle('show-save-dialog', async (_event, opts) => {
  return dialog.showSaveDialog(mainWindow, opts)
})

ipcMain.handle('get-version', () => app.getVersion())

ipcMain.handle('get-recent-files', () => recentFiles)

ipcMain.handle('clear-recent-files', () => {
  recentFiles = []
  saveRecent()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recent-files-updated', recentFiles)
  }
  return recentFiles
})

ipcMain.handle('add-recent-file', (_event, filePath) => {
  pushRecent(filePath)
  return recentFiles
})

ipcMain.on('app-quit', () => app.quit())
ipcMain.on('window-minimize', () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.minimize() })
ipcMain.on('window-zoom', () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.isMaximized() ? w.unmaximize() : w.maximize() })
ipcMain.on('window-fullscreen', () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.setFullScreen(!w.isFullScreen()) })
