/**
 * Minimal shim for electronAPI when running in Pake or a standard browser.
 * This prevents crashes and provides basic fallbacks.
 */
(function() {
  if (window.electronAPI) return;

  window.electronAPI = {
    onOpenFile: () => {},
    readFile: () => Promise.reject(new Error('File system access not available in this mode.')),
    readSchemaBundle: () => Promise.resolve({ ok: false, error: 'Schemas not available locally.' }),
    parseKv3DocumentNative: () => Promise.reject(new Error('Native parsing not available.')),
    buildPropTreeInitialPlan: () => Promise.reject(new Error('Native prop-tree plan not available.')),
    saveFile: () => Promise.reject(new Error('Saving directly to disk not available.')),
    showSaveDialog: () => Promise.resolve({ canceled: true }),
    pickResourceFile: () => Promise.resolve(null),
    getVersion: () => Promise.resolve('Pake Version'),
    getPlatform: () => Promise.resolve(navigator.platform.toLowerCase().includes('win') ? 'win32' : 'darwin'),
    openWin11FreezeReg: () => Promise.resolve({ ok: false, error: 'Registry helper not available.' }),
    getRecentFiles: () => Promise.resolve([]),
    clearRecentFiles: () => Promise.resolve([]),
    addRecentFile: () => Promise.resolve([]),
    onRecentFilesUpdated: () => {},
    quitApp: () => {
      if (confirm('Quit application?')) {
        window.close();
      }
    },
    minimize: () => {},
    zoom: () => {},
    toggleFullScreen: () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  };
})();
