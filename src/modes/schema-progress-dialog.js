/**
 * Modal progress UI for schema refresh (GameTracking-CS2 crawl + parse + SDK + save).
 */
(function () {
  'use strict';

  function showSchemaUpdateDialog(opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const forceRefresh = options.forceRefresh !== false;

    document.getElementById('vde-schema-dlg')?.remove();

    const dlg = document.createElement('div');
    dlg.id = 'vde-schema-dlg';
    dlg.innerHTML =
      '<div class="sdlg-backdrop"></div>' +
      '<div class="sdlg-panel">' +
      '  <div class="sdlg-head">' +
      '    <span class="sdlg-title">Schema Update</span>' +
      '    <span class="sdlg-phase" id="sdlg-phase">Initializing…</span>' +
      '  </div>' +
      '  <div class="sdlg-progress">' +
      '    <div class="sdlg-track"><div class="sdlg-fill" id="sdlg-fill"></div></div>' +
      '    <span class="sdlg-pct" id="sdlg-pct">0%</span>' +
      '  </div>' +
      '  <div class="sdlg-msg" id="sdlg-msg"></div>' +
      '  <div class="sdlg-log" id="sdlg-log"></div>' +
      '  <div class="sdlg-foot">' +
      '    <span class="sdlg-info" id="sdlg-info"></span>' +
      '    <button type="button" class="sdlg-btn btn btn-sm" id="sdlg-close" disabled>Close</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(dlg);

    const fill = dlg.querySelector('#sdlg-fill');
    const pctEl = dlg.querySelector('#sdlg-pct');
    const msg = dlg.querySelector('#sdlg-msg');
    const phase = dlg.querySelector('#sdlg-phase');
    const log = dlg.querySelector('#sdlg-log');
    const info = dlg.querySelector('#sdlg-info');
    const btn = dlg.querySelector('#sdlg-close');

    const R = window.VDataSchemaRuntime;
    const status = R && typeof R.getSchemaCacheStatus === 'function' ? R.getSchemaCacheStatus() : null;
    if (status && status.hasData) {
      const ageH = Math.round(status.ageMs / 3600000);
      info.textContent = 'Cached: ' + status.schemaKeyCount + ' buckets, ~' + ageH + 'h old';
    }

    function addLog(text, type) {
      const line = document.createElement('div');
      line.className = 'sdlg-line' + (type ? ' ' + type : '');
      line.textContent = text;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }

    function onProgress(message, percent) {
      const p = typeof percent === 'number' && !Number.isNaN(percent) ? Math.max(0, Math.min(100, percent)) : 0;
      fill.style.width = p + '%';
      pctEl.textContent = p + '%';
      msg.textContent = message || '';

      if (typeof message === 'string') {
        if (message.indexOf('Discover') === 0) phase.textContent = 'Phase 1 — Discovering';
        else if (message.indexOf('Found') === 0) phase.textContent = 'Phase 1 — Discovering';
        else if (message.indexOf('Parsed') === 0) phase.textContent = 'Phase 2 — Parsing';
        else if (message.indexOf('SDK') === 0) phase.textContent = 'Phase 3 — SDK types';
        else if (message.indexOf('Saving') === 0) phase.textContent = 'Phase 4 — Saving';
        else if (message.indexOf('Done') === 0) phase.textContent = 'Complete';
        else if (message.indexOf('Failed') === 0 || message.indexOf('Skipped') === 0) {
          addLog('\u26a0 ' + message, 'warn');
          return;
        }
      }

      addLog(message);

      if (p >= 100) {
        btn.disabled = false;
        btn.focus();
        const st = R && typeof R.getSchemaCacheStatus === 'function' ? R.getSchemaCacheStatus() : null;
        if (st && st.hasData) info.textContent = 'Loaded: ' + st.schemaKeyCount + ' schema buckets';
      }
    }

    btn.addEventListener('click', function () {
      dlg.remove();
    });

    dlg.querySelector('.sdlg-backdrop')?.addEventListener('click', function () {
      if (!btn.disabled) dlg.remove();
    });

    const run =
      typeof window.VDataSuggestions?.refreshSchemasAdvanced === 'function'
        ? function () {
            return window.VDataSuggestions.refreshSchemasAdvanced(onProgress, { forceRefresh: forceRefresh });
          }
        : function () {
            if (!R || typeof R.loadSchemasRuntime !== 'function') {
              return Promise.reject(new Error('VDataSchemaRuntime unavailable'));
            }
            return R.loadSchemasRuntime({ forceRefresh: forceRefresh, onProgress: onProgress });
          };

    run().catch(function (e) {
      addLog('\u2717 Fatal: ' + (e && e.message ? e.message : String(e)), 'error');
      btn.disabled = false;
    });
  }

  if (typeof window !== 'undefined') window.showSchemaUpdateDialog = showSchemaUpdateDialog;
})();
