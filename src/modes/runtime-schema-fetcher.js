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
      const vals =
        window.SchemaDB && typeof window.SchemaDB.getEnumValuesForWidgetId === 'function'
          ? window.SchemaDB.getEnumValuesForWidgetId(widgetStr)
          : [];
      return { type: 'string', widget: 'string', enum: vals };
    }
    return { type: 'string', widget: 'string' };
  }

  function buildRuntimeBuckets(onProgress) {
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
    const reportEvery = Math.max(1, Math.floor(total / 25));

    const globalFreq = {};
    const globalDef = {};
    for (let i = 0; i < names.length; i++) {
      const className = names[i];
      const fields = S.getFields(className);
      const keys = {};
      for (let j = 0; j < fields.length; j++) {
        const f = fields[j];
        const def = widgetToDef(f.type);
        keys[f.name] = def;
        globalFreq[f.name] = (globalFreq[f.name] || 0) + 1;
        if (!globalDef[f.name]) globalDef[f.name] = def;
      }
      out['type:' + className] = { keys: keys, children: {}, enums: {} };

      if (onProgress && (i % reportEvery === 0 || i === total - 1)) {
        onProgress('Building schema types…', Math.round(((i + 1) / total) * 100));
      }
    }

    const minFreq = Math.max(8, Math.floor(names.length * 0.01));
    const globalKeys = {};
    const allGlobalNames = Object.keys(globalFreq);
    for (let k = 0; k < allGlobalNames.length; k++) {
      const name = allGlobalNames[k];
      if (globalFreq[name] < minFreq) continue;
      globalKeys[name] = globalDef[name] || widgetToDef('string');
    }
    out._global.keys = globalKeys;

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

    if (!window.SchemaDB) {
      console.warn('[VDataSchemaRuntime] SchemaDB not available');
      _lastBuckets = { _global: { keys: {}, children: {}, enums: {} } };
      return _lastBuckets;
    }

    const game = getActiveGame();

    if (onProgress) onProgress('Loading Valve schema (SchemaExplorer)…', 2);

    await SchemaDB.load(game, { forceRemote: forceRefresh });

    if (onProgress) onProgress('Building suggestion index…', 35);

    const buckets = buildRuntimeBuckets(onProgress);

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
