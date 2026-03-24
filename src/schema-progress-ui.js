/**
 * Per-game schema load progress (listens for vdata-schema-progress from schema-db).
 */
(function () {
  'use strict';

  var STAGE_LABEL = {
    'cache-hit': 'Loaded from cache',
    'stale-serve': 'Updating…',
    'fetch-start': 'Connecting…',
    fetching: 'Downloading…',
    decompressing: 'Decompressing…',
    applying: 'Indexing…',
    ready: 'Ready',
    error: 'Failed'
  };

  var STAGE_PROGRESS = {
    'cache-hit': 100,
    'stale-serve': 100,
    'fetch-start': 10,
    fetching: 30,
    decompressing: 60,
    applying: 85,
    ready: 100,
    error: 0
  };

  /**
   * @param {string[]} gameIds
   * @param {string} [rootId]
   */
  function initSchemaProgressUI(gameIds, rootId) {
    var rid = rootId || 'schema-progress-root';
    var root = document.getElementById(rid);
    if (!root) return;

    var state = {};
    var i;
    for (i = 0; i < gameIds.length; i++) state[gameIds[i]] = 'pending';

    var html = '';
    for (i = 0; i < gameIds.length; i++) {
      var g = gameIds[i];
      html +=
        '<div class="schema-progress-game" data-game="' +
        g +
        '">' +
        '<span class="schema-progress-label">' +
        g.toUpperCase() +
        '</span>' +
        '<div class="schema-progress-track">' +
        '<div class="schema-progress-fill" id="spf-' +
        g +
        '" style="width:0%"></div>' +
        '</div>' +
        '<span class="schema-progress-stage" id="sps-' +
        g +
        '">Waiting…</span>' +
        '</div>';
    }
    root.innerHTML = html;

    var bars = {};
    for (i = 0; i < gameIds.length; i++) {
      var gid = gameIds[i];
      bars[gid] = {
        fill: document.getElementById('spf-' + gid),
        stage: document.getElementById('sps-' + gid)
      };
    }

    root.classList.remove('hidden');

    document.addEventListener('vdata-schema-progress', function (e) {
      var detail = e.detail || {};
      var game = detail.game;
      var stage = detail.stage;
      if (!bars[game]) return;

      state[game] = stage;
      var pct = STAGE_PROGRESS[stage] != null ? STAGE_PROGRESS[stage] : 0;
      if (bars[game].fill) bars[game].fill.style.width = pct + '%';
      if (bars[game].stage) bars[game].stage.textContent = STAGE_LABEL[stage] || stage;

      if (stage === 'error' && bars[game].fill) bars[game].fill.classList.add('schema-progress-error');
      if (stage === 'ready' || stage === 'cache-hit' || stage === 'stale-serve') {
        if (bars[game].fill) bars[game].fill.classList.add('schema-progress-done');
      }

      var allDone = gameIds.every(function (gid) {
        var st = state[gid];
        return st === 'ready' || st === 'cache-hit' || st === 'stale-serve' || st === 'error';
      });
      if (allDone) {
        setTimeout(function () {
          root.classList.add('hidden');
        }, 600);
      }
    });
  }

  if (typeof window !== 'undefined') {
    window.initSchemaProgressUI = initSchemaProgressUI;
  }
})();
