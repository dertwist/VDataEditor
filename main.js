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

function extractFilePath(argv) {
  // argv[0] is the executable; skip it
  return argv.slice(1).find((a) => OPEN_FILE_RE.test(a)) || null
}

let mainWindow = null

function sendOpenFile(filePath) {
  if (!filePath || !mainWindow || mainWindow.isDestroyed()) return
  pushRecent(filePath)
  mainWindow.webContents.send('open-file', filePath)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function createWindow(filePath) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'assets/images/vdata_editor/appicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  })
  mainWindow.loadFile('index.html')
  Menu.setApplicationMenu(null)

  if (filePath) {
    mainWindow.webContents.once('did-finish-load', () => sendOpenFile(filePath))
  }
}

// ── Single-instance lock ───────────────────────────────────────────────────
// If a second instance is launched (e.g. double-clicking a file on Windows),
// Electron calls this handler in the FIRST (existing) instance, then
// immediately quits the second instance.
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const filePath = extractFilePath(argv)
    if (mainWindow) {
      if (filePath) sendOpenFile(filePath)
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // macOS: file opened via Finder (Apple Events — no new process spawned)
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    if (mainWindow) {
      sendOpenFile(filePath)
    } else {
      app.whenReady().then(() => createWindow(filePath))
    }
  })

  app.whenReady().then(() => {
    loadRecent()
    const filePath = extractFilePath(process.argv)
    createWindow(filePath)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(null)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

// ── IPC handlers ───────────────────────────────────────────────────────────

const SCHEMA_BUNDLE_GAMES = new Set(['cs2', 'dota2', 'deadlock'])

ipcMain.handle('read-schema-bundle', async (_e, game) => {
  const g = typeof game === 'string' ? game.toLowerCase() : 'cs2'
  if (!SCHEMA_BUNDLE_GAMES.has(g)) {
    return { ok: false, error: 'Unknown game: ' + g }
  }
  const bundlePath = path.join(__dirname, 'schemas', g + '.json')
  try {
    const raw = fs.readFileSync(bundlePath, 'utf8')
    const data = JSON.parse(raw)
    return { ok: true, data, path: bundlePath }
  } catch (e) {
    return {
      ok: false,
      error: e && e.message ? e.message : String(e),
      path: bundlePath
    }
  }
})

ipcMain.handle('read-file', async (_e, filePath) => fs.readFileSync(filePath, 'utf-8'))

ipcMain.handle('save-file', async (_e, filePath, content) => {
  fs.writeFileSync(filePath, content, 'utf-8')
  pushRecent(filePath)
  return true
})

ipcMain.handle('show-save-dialog', async (_e, opts) => dialog.showSaveDialog(mainWindow, opts))

ipcMain.handle('pick-resource-file', async (_e, opts) => {
  const w = BrowserWindow.getFocusedWindow() || mainWindow
  const o = opts && typeof opts === 'object' ? opts : {}
  const relativeTo = typeof o.relativeTo === 'string' && o.relativeTo.length ? o.relativeTo : null
  const filters = Array.isArray(o.filters) && o.filters.length ? o.filters : [{ name: 'Resources', extensions: ['vmdl', 'vpcf', 'vnmskel', 'vmat', 'vsndevts'] }]
  const r = await dialog.showOpenDialog(w, {
    properties: ['openFile'],
    defaultPath: o.defaultPath || relativeTo || undefined,
    filters
  })
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return null
  const abs = r.filePaths[0]
  if (relativeTo) {
    try {
      return path.relative(relativeTo, abs).replace(/\\/g, '/')
    } catch {
      return abs.replace(/\\/g, '/')
    }
  }
  return abs.replace(/\\/g, '/')
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

ipcMain.handle('add-recent-file', (_e, filePath) => {
  pushRecent(filePath)
  return recentFiles
})

ipcMain.on('app-quit', () => app.quit())
ipcMain.on('window-minimize', () => BrowserWindow.getFocusedWindow()?.minimize())
ipcMain.on('window-zoom', () => {
  const w = BrowserWindow.getFocusedWindow()
  if (w) w.isMaximized() ? w.unmaximize() : w.maximize()
})
ipcMain.on('window-fullscreen', () => {
  const w = BrowserWindow.getFocusedWindow()
  if (w) w.setFullScreen(!w.isFullScreen())
})
