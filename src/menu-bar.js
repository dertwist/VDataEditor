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
        if (menu === 'settings' && typeof refreshThemeMenuMarks === 'function') refreshThemeMenuMarks();
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
      else if (action === 'exportUserConfig') {
        downloadBlob(new Blob([VDataSettings.exportUserConfig()], { type: 'application/json' }), 'vdata_widget_config.json');
      } else if (action === 'importUserConfig') {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json';
        inp.onchange = (ev) => {
          const f = ev.target.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = (ev2) => {
            try {
              VDataSettings.importUserConfig(ev2.target.result);
              renderAll();
              setStatus('Widget config imported', 'info');
            } catch (err) {
              setStatus('Import error: ' + err.message, 'error');
            }
          };
          r.readAsText(f);
        };
        inp.click();
      } else if (action === 'setAppTheme') {
        const pref = el.getAttribute('data-theme-pref');
        if (pref && typeof setAppThemePreference === 'function') setAppThemePreference(pref);
      } else if (action === 'openWin11FreezeReg') {
        if (window.electronAPI?.openWin11FreezeReg) {
          window.electronAPI.openWin11FreezeReg().then((r) => {
            if (r && r.ok) {
              if (typeof setStatus === 'function') setStatus('Opened OverlayMinFPS registry file — merge if prompted, then restart DWM (see README).', 'info');
            } else if (typeof setStatus === 'function') {
              setStatus((r && r.error) || 'Could not open registry file.', 'error');
            }
          });
        } else if (typeof setStatus === 'function') {
          setStatus('Registry helper is only available in the desktop app on Windows.', 'info');
        }
      } else if (action === 'openWidgetConfig') {
        openWidgetConfigDialog();
      } else if (action === 'minimize' && window.electronAPI?.minimize) window.electronAPI.minimize();
      else if (action === 'zoom' && window.electronAPI?.zoom) window.electronAPI.zoom();
      else if (action === 'fullscreen' && window.electronAPI?.toggleFullScreen) window.electronAPI.toggleFullScreen();
      else if (action === 'schemaManage') {
        if (typeof window.showSchemaCacheAdvancedDialog === 'function') {
          window.showSchemaCacheAdvancedDialog();
        } else if (typeof VDataSuggestions?.refreshSchemasAdvanced === 'function') {
          // Fallback for environments where the schema dialog is not available.
          const rep =
            typeof window.reportSchemaDownloadProgress === 'function'
              ? window.reportSchemaDownloadProgress
              : function (msg, pct) {
                  setStatus(pct != null ? msg + ' (' + pct + '%)' : msg, 'info');
                };
          VDataSuggestions.refreshSchemasAdvanced(rep, { forceRefresh: false }).finally(function () {
            if (typeof setSchemaProgress === 'function') setSchemaProgress(false);
            setStatus('Schemas updated', 'info');
          });
        } else {
          setStatus('Schema tools unavailable', 'error');
        }
      } else if (action === 'about') {
        if (window.electronAPI?.getVersion) {
          window.electronAPI.getVersion().then((v) => setStatus(`VDataEditor v${v}`, 'info'));
        } else {
          setStatus('VDataEditor', 'info');
        }
      }
      dropdowns.forEach((d) => d.classList.remove('open'));
      activeDropdown = null;
    });
  });
}
