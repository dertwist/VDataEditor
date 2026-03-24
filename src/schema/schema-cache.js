/**
 * IndexedDB cache for parsed SchemaExplorer bundles (multiple games per store).
 * Speeds up repeat loads and game switches; keeps one entry per game key.
 * @global VDataSchemaCache
 */
(function () {
  'use strict';

  var DB_NAME = 'vdata_schema_parsed_v1';
  var DB_VER = 2;
  var STORE = 'bundles';
  var CACHE_BUILD_KEY = 'vdata_schema_cache_build';
  var CACHE_BUILD = '2';
  var openChain = null;

  if (typeof indexedDB === 'undefined') {
    if (typeof window !== 'undefined') {
      window.VDataSchemaCache = {
        getParsed: function () {
          return Promise.resolve(null);
        },
        setParsed: function () {
          return Promise.resolve();
        },
        clear: function () {
          return Promise.resolve();
        },
        clearAll: function () {
          return Promise.resolve();
        },
        getSize: function () {
          return Promise.resolve(0);
        },
        getCacheBuild: function () {
          return CACHE_BUILD;
        }
      };
    }
    return;
  }

  function ensureCacheVersionAndOpen() {
    return new Promise(function (resolve, reject) {
      var needDelete = false;
      try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem(CACHE_BUILD_KEY) !== CACHE_BUILD) {
          localStorage.setItem(CACHE_BUILD_KEY, CACHE_BUILD);
          needDelete = true;
        }
      } catch (_) {}

      function runOpen() {
        var req = indexedDB.open(DB_NAME, DB_VER);
        req.onerror = function () {
          reject(req.error);
        };
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (db.objectStoreNames.contains(STORE)) {
            db.deleteObjectStore(STORE);
          }
          db.createObjectStore(STORE);
        };
      }

      if (needDelete) {
        openChain = null;
        var del = indexedDB.deleteDatabase(DB_NAME);
        del.onerror = function () {
          reject(del.error);
        };
        del.onsuccess = runOpen;
      } else {
        runOpen();
      }
    });
  }

  function openDb() {
    if (openChain) return openChain;
    openChain = ensureCacheVersionAndOpen().catch(function (e) {
      openChain = null;
      return Promise.reject(e);
    });
    return openChain;
  }

  /**
   * @param {string} game
   * @returns {Promise<object|null>}
   */
  function getParsed(game) {
    if (!game || typeof game !== 'string') return Promise.resolve(null);
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(game);
        req.onsuccess = function () {
          resolve(req.result != null ? req.result : null);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    });
  }

  /**
   * @param {string} game
   * @param {object} data parsed schema root
   */
  function setParsed(game, data) {
    if (!game || typeof game !== 'string' || !data || typeof data !== 'object') return Promise.resolve();
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(data, game);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function clearAll() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function clear(game) {
    if (!game || typeof game !== 'string') return Promise.resolve();
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(game);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  /**
   * Approximate serialized size in bytes (UTF-8) for one entry.
   * @param {string} game
   * @returns {Promise<number>}
   */
  function getSize(game) {
    return getParsed(game).then(function (data) {
      if (!data || typeof data !== 'object') return 0;
      try {
        return new Blob([JSON.stringify(data)]).size;
      } catch (_) {
        return 0;
      }
    });
  }

  function getCacheBuild() {
    return CACHE_BUILD;
  }

  if (typeof window !== 'undefined') {
    window.VDataSchemaCache = {
      getParsed: getParsed,
      setParsed: setParsed,
      clear: clear,
      clearAll: clearAll,
      getSize: getSize,
      getCacheBuild: getCacheBuild
    };
  }
})();
