/**
 * Main-thread client for src/file-load-worker.js
 */
(function () {
  'use strict';

  var _worker = null;
  var _nextId = 0;
  var _pending = new Map();

  function getWorker() {
    if (_worker) return _worker;
    try {
      _worker = new Worker('src/file-load-worker.js');
    } catch (e) {
      return null;
    }
    _worker.onmessage = function (ev) {
      var data = ev.data;
      var cb = _pending.get(data.id);
      if (!cb) return;
      _pending.delete(data.id);
      if (data.ok) {
        cb.resolve({ parsed: data.parsed, parseMs: data.parseMs });
      } else {
        cb.reject(new Error(data.error || 'parse failed'));
      }
    };
    _worker.onerror = function (e) {
      _pending.forEach(function (c) {
        try {
          c.reject(new Error(e && e.message ? e.message : 'worker error'));
        } catch (_) {}
      });
      _pending.clear();
      _worker = null;
    };
    return _worker;
  }

  /**
   * @param {string} filePath
   * @param {string} text
   * @param {string} [formatOverride] One of: 'json' | 'keyvalue' | 'kv3'
   * @returns {Promise<{ parsed: object, parseMs: number }>}
   */
  function parseFileContentInWorker(filePath, text, formatOverride) {
    var w = getWorker();
    if (!w) {
      return Promise.reject(new Error('file load worker unavailable'));
    }
    var id = _nextId++;
    return new Promise(function (resolve, reject) {
      _pending.set(id, { resolve: resolve, reject: reject });
      try {
        w.postMessage({ id: id, filePath: filePath, text: text, formatOverride: formatOverride });
      } catch (postErr) {
        _pending.delete(id);
        reject(postErr);
      }
    });
  }

  function terminateFileLoadWorker() {
    if (_worker) {
      _worker.terminate();
      _worker = null;
    }
    _pending.forEach(function (c) {
      try {
        c.reject(new Error('Worker terminated'));
      } catch (_) {}
    });
    _pending.clear();
  }

  if (typeof window !== 'undefined') {
    window.parseFileContentInWorker = parseFileContentInWorker;
    window.terminateFileLoadWorker = terminateFileLoadWorker;
  }
})();
