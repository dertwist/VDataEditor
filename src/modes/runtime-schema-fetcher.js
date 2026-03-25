/**
 * Builds VDataSuggestions buckets from SchemaExplorer data (SchemaDB).
 * Replaces the legacy GameTracking crawl; aligns with ValveResourceFormat/SchemaExplorer.
 */
(function () {
  'use strict';

  const TTL_MS = 14 * 86400000;
  const GAME_STORAGE_KEY = 'vdata_schema_bundle_game';

  /** @type {object|null} */
  let _lastBuckets = null;

  function widgetToDef(widgetStr) {
    if (!widgetStr) return { type: 'string', widget: 'string' };
    if (widgetStr === 'float') return { type: 'float', widget: 'number-float' };
    if (widgetStr === 'int') return { type: 'int', widget: 'number-int' };
    if (widgetStr === 'bool') return { type: 'bool', widget: 'checkbox' };
    if (widgetStr === 'vec2') return { type: 'string', widget: 'vec2' };
    if (widgetStr === 'vec3') return { type: 'string', widget: 'vec3' };
    if (widgetStr === 'vec4') return { type: 'string', widget: 'vec4' };
    if (widgetStr === 'color') return { type: 'string', widget: 'color' };
    if (widgetStr === 'resource') return { type: 'string', widget: 'resource' };
    if (widgetStr === 'soundevent') return { type: 'string', widget: 'soundevent' };
    if (widgetStr === 'array') return { type: 'string', widget: 'string' };
    if (widgetStr === 'object') return { type: 'string', widget: 'string' };
    if (widgetStr.indexOf('enum:') === 0) {
      return {
        type: 'string',
        widget: 'string',
        enum: [],
        enumWidgetId: widgetStr
      };
    }
    return { type: 'string', widget: 'string' };
  }

  function extractDocFromMetadata(metadata) {
    if (!Array.isArray(metadata) || metadata.length === 0) return '';

    const nameRe =
      /(^desc$|description|doc|tooltip|help|m_.*desc|m_.*description|m_.*tooltip)/i;

    for (let i = 0; i < metadata.length; i++) {
      const m = metadata[i];
      if (!m || typeof m !== 'object') continue;
      const n = m.name;
      if (typeof n !== 'string' || !nameRe.test(n)) continue;

      const v = m.value;
      if (typeof v === 'string') {
        const s = v.trim();
        if (s) return s;
      }

      // Some schema formats might store nested { value: "..." }.
      if (_isObj(v) && typeof v.value === 'string') {
        const s = v.value.trim();
        if (s) return s;
      }
    }

    return '';
  }

  function _isObj(x) {
    return x && typeof x === 'object' && !Array.isArray(x);
  }

  function widgetToDefFromField(field) {
    const def = widgetToDef(field && field.type ? field.type : null);
    const doc = extractDocFromMetadata(field && Array.isArray(field.metadata) ? field.metadata : []);
    if (doc) {
      def.description = doc;
      def.doc = doc;
    }
    return def;
  }

  async function buildRuntimeBuckets(onProgress) {
    const S = window.SchemaDB;
    if (!S || !S.isLoaded()) {
      _lastBuckets = { _global: { keys: {}, children: {}, enums: {} } };
      return _lastBuckets;
    }

    const names = S.listClassNames();
    const out = {
      _global: { keys: {}, children: {}, enums: {} }
    };

    const total = names.length;
    const reportEvery = Math.max(1, Math.floor(total / 30));
    const yieldEveryNClasses = 12;
    const yieldEveryNFields = 180;
    const yieldSliceMs = 18;
    const hasNow = typeof performance !== 'undefined' && typeof performance.now === 'function';

    const globalFreq = {};
    const globalDef = {};
    var fieldStepsSinceYield = 0;
    var fieldSliceStart = hasNow ? performance.now() : Date.now();
    for (let i = 0; i < names.length; i++) {
      const className = names[i];
      const fields = S.getFields(className);
      const keys = {};
      for (let j = 0; j < fields.length; j++) {
        const f = fields[j];
        const def = widgetToDefFromField(f);
        keys[f.name] = def;
        globalFreq[f.name] = (globalFreq[f.name] || 0) + 1;
        if (!globalDef[f.name]) globalDef[f.name] = def;
        fieldStepsSinceYield++;
        var nowTick = hasNow ? performance.now() : Date.now();
        if (
          fieldStepsSinceYield >= yieldEveryNFields ||
          nowTick - fieldSliceStart >= yieldSliceMs
        ) {
          fieldStepsSinceYield = 0;
          fieldSliceStart = hasNow ? performance.now() : Date.now();
          await new Promise(function (r) {
            setTimeout(r, 0);
          });
        }
      }
      out['type:' + className] = { keys: keys, children: {}, enums: {} };

      if (onProgress && (i % reportEvery === 0 || i === total - 1)) {
        const pct = 35 + Math.min(64, Math.floor((64 * (i + 1)) / Math.max(1, total)));
        onProgress('Building schema types…', pct);
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
      } else if (i % yieldEveryNClasses === yieldEveryNClasses - 1 && i !== total - 1) {
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
      }
    }

    const minFreq = Math.max(8, Math.floor(names.length * 0.01));
    const globalKeys = {};
    const allGlobalNames = Object.keys(globalFreq);
    if (onProgress) {
      onProgress('Merging global schema keys…', 62);
    }
    await new Promise(function (r) {
      setTimeout(r, 0);
    });
    for (let k = 0; k < allGlobalNames.length; k++) {
      const name = allGlobalNames[k];
      if (globalFreq[name] < minFreq) continue;
      globalKeys[name] = globalDef[name] || widgetToDef('string');
      if (k % 72 === 71) {
        if (onProgress) {
          var mergePct = Math.min(99, 62 + Math.floor((37 * k) / Math.max(1, allGlobalNames.length)));
          onProgress('Merging global schema keys…', mergePct);
        }
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
      }
    }
    out._global.keys = globalKeys;

    if (allGlobalNames.length > 400) {
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
    }

    _lastBuckets = out;
    return out;
  }

  function getActiveGame() {
    try {
      const g = localStorage.getItem(GAME_STORAGE_KEY);
      if (g === 'dota2' || g === 'deadlock' || g === 'cs2') return g;
    } catch (_) {}
    return 'cs2';
  }

  /**
   * @param {{ onProgress?: function(string, number): void, forceRefresh?: boolean }} [opts]
   */
  async function loadSchemasRuntime(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const onProgress = typeof o.onProgress === 'function' ? o.onProgress : null;
    const forceRefresh = !!o.forceRefresh;

    _lastBuckets = null;

    if (!window.SchemaDB) {
      console.warn('[VDataSchemaRuntime] SchemaDB not available');
      _lastBuckets = { _global: { keys: {}, children: {}, enums: {} } };
      return _lastBuckets;
    }

    const game = getActiveGame();

    if (onProgress) onProgress('Loading Valve schema (SchemaExplorer)…', 2);

    if (window.SchemaDB && typeof window.SchemaDB.prefetchOtherGamesParallel === 'function') {
      window.SchemaDB.prefetchOtherGamesParallel(game).catch(function () {});
    }

    await SchemaDB.load(game, { forceRemote: forceRefresh });

    if (onProgress) onProgress('Building suggestion index…', 35);

    const buckets = await buildRuntimeBuckets(onProgress);

    if (onProgress) onProgress('Schema ready', 100);

    return buckets;
  }

  function getSchemaCacheStatus() {
    const meta = window.SchemaDB && SchemaDB.readCachedMeta ? SchemaDB.readCachedMeta() : null;
    const loaded = window.SchemaDB && SchemaDB.isLoaded && SchemaDB.isLoaded();

    let schemaKeyCount = 0;
    if (_lastBuckets) {
      const keys = Object.keys(_lastBuckets);
      for (let i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('type:') === 0) schemaKeyCount++;
      }
    } else if (loaded && window.SchemaDB.listClassNames) {
      schemaKeyCount = SchemaDB.listClassNames().length;
    }

    const fetchedAt = meta && meta.loadedAt ? meta.loadedAt : null;
    let ageMs = null;
    if (fetchedAt) {
      ageMs = Date.now() - new Date(fetchedAt).getTime();
    }

    const hasData = loaded || !!meta;

    return {
      hasData: hasData,
      schemaKeyCount: schemaKeyCount,
      ttlMs: TTL_MS,
      isStale: !hasData || ageMs == null ? true : ageMs > TTL_MS,
      ageMs: ageMs,
      fetchedAt: fetchedAt,
      revision: window.SchemaDB && SchemaDB.getRevision ? SchemaDB.getRevision() : null,
      game: getActiveGame()
    };
  }

  function setSchemaGame(game) {
    const g = typeof game === 'string' ? game.toLowerCase() : 'cs2';
    if (g !== 'cs2' && g !== 'dota2' && g !== 'deadlock') return false;
    try {
      localStorage.setItem(GAME_STORAGE_KEY, g);
    } catch (_) {
      return false;
    }
    return true;
  }

  function getSchemaGame() {
    return getActiveGame();
  }

  if (typeof window !== 'undefined') {
    window.VDataSchemaRuntime = {
      loadSchemasRuntime: loadSchemasRuntime,
      getSchemaCacheStatus: getSchemaCacheStatus,
      setSchemaGame: setSchemaGame,
      getSchemaGame: getSchemaGame
    };
  }
})();
