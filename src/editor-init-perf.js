/**
 * Deferred startup initialisation helpers (classic script; no ES modules).
 */
(function (global) {
  'use strict';

  function runCriticalInit(opts) {
    if (!opts || typeof opts !== 'object') opts = {};
    var t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;

    if (typeof opts.initAppTheme === 'function') opts.initAppTheme();
    if (typeof opts.initMenuBar === 'function') opts.initMenuBar();
    if (typeof opts.initTabBar === 'function') opts.initTabBar();
    if (typeof opts.initPropTreeLazy === 'function') opts.initPropTreeLazy();

    if (opts.docManager && typeof opts.docManager.newDoc === 'function') {
      opts.docManager.newDoc();
    }

    if (typeof opts.markShellReady === 'function') {
      opts.markShellReady();
    }

    if (typeof opts.renderAll === 'function') {
      opts.renderAll({ immediateManualSync: true });
    }

    if (typeof opts.onReady === 'function') {
      opts.onReady();
    }

    var criticalMs = typeof performance !== 'undefined' && performance.now ? performance.now() - t0 : 0;
    if (typeof global.VDataPerf !== 'undefined' && global.VDataPerf.mark) {
      global.VDataPerf.mark('shell-ready');
    }
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[editor-init] Shell ready in ' + criticalMs.toFixed(1) + 'ms');
    }
  }

  function scheduleIdle(label, fn, idleTimeout) {
    if (typeof fn !== 'function') return;
    var timeout = idleTimeout != null ? idleTimeout : 2000;
    var wrapped = function (deadline) {
      if (deadline && deadline.timeRemaining() < 5 && !deadline.didTimeout) {
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(wrapped, { timeout: timeout });
        } else {
          setTimeout(fn, 0);
        }
        return;
      }
      var t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
      try {
        fn();
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[editor-init] Deferred task "' + label + '" threw:', err);
        }
      }
      var elapsed = typeof performance !== 'undefined' && performance.now ? performance.now() - t0 : 0;
      if (elapsed > 16 && typeof console !== 'undefined' && console.warn) {
        console.warn('[editor-init] Deferred task "' + label + '" took ' + elapsed.toFixed(1) + 'ms');
      }
    }
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(wrapped, { timeout: timeout });
    } else {
      setTimeout(fn, 200);
    }
  }

  function runDeferredInit(opts) {
    if (!opts || typeof opts !== 'object') opts = {};
    var idleTimeout = opts.idleTimeout != null ? opts.idleTimeout : 2000;
    var tasks = [
      { name: 'history-dock', fn: opts.initHistoryDock },
      { name: 'property-browser', fn: opts.initPropertyBrowser },
      { name: 'schema-suggestions', fn: opts.initSchemas }
    ];
    for (var i = 0; i < tasks.length; i++) {
      if (typeof tasks[i].fn !== 'function') continue;
      (function (task) {
        scheduleIdle(task.name, task.fn, idleTimeout);
      })(tasks[i]);
    }
  }

  function timedInit(label, fn) {
    if (typeof fn !== 'function') return;
    var t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
    var result = fn();
    var ms = typeof performance !== 'undefined' && performance.now ? performance.now() - t0 : 0;
    if (ms > 8 && typeof console !== 'undefined' && console.warn) {
      console.warn('[editor-init] ' + label + ' took ' + ms.toFixed(1) + 'ms');
    }
    return result;
  }

  global.runEditorCriticalInit = runCriticalInit;
  global.runEditorDeferredInit = runDeferredInit;
  global.timedInit = timedInit;
})(typeof window !== 'undefined' ? window : this);
