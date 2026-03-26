// Key/value suggestions for the property tree — uses VDataEditorModes for file kind + runtime schema cache (VDataSchemaRuntime).
(function () {
  'use strict';

  let _schemas = null;
  /** @type {Map<string, {flat: object, sources: object}>} */
  let _resolveWithSourcesCache = new Map();

  function collectKeyNamesDeep(obj, seen) {
    const s = seen || new Set();
    if (!obj || typeof obj !== 'object') return s;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) collectKeyNamesDeep(obj[i], s);
      return s;
    }
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      s.add(k);
      collectKeyNamesDeep(obj[k], s);
    }
    return s;
  }

  function modeSuggestionBlock(modeId) {
    if (!modeId || !window.VDataEditorModes || typeof window.VDataEditorModes.getModeById !== 'function') {
      return null;
    }
    const mode = window.VDataEditorModes.getModeById(modeId);
    return mode && mode.suggestionSchema ? mode.suggestionSchema : null;
  }

  /**
   * Merge order: _global → static mode.suggestionSchema → mode:{id} (runtime) → ext: → type: (later wins).
   * Static mode schema alone can drive suggestions before/without runtime fetch.
   */
  function schemaCandidates(ctx) {
    const c = ctx || {};
    const fileExt = c.fileExt || '';
    const genericDataType = c.genericDataType || '';
    const modeId = c.modeId || '';
    const staticMode = modeSuggestionBlock(modeId);
    return [
      _schemas && _schemas._global,
      staticMode,
      modeId && _schemas ? _schemas['mode:' + modeId] : null,
      _schemas ? _schemas['ext:' + fileExt] : null,
      _schemas && genericDataType ? _schemas['type:' + genericDataType] : null
    ].filter(Boolean);
  }

  function schemaCandidatesWithSources(ctx) {
    const c = ctx || {};
    const fileExt = c.fileExt || '';
    const genericDataType = c.genericDataType || '';
    const modeId = c.modeId || '';
    const staticMode = modeSuggestionBlock(modeId);

    const out = [];
    if (_schemas && _schemas._global) out.push({ sourceId: '_global', sch: _schemas._global });
    if (staticMode) out.push({ sourceId: 'static:' + modeId, sch: staticMode });
    if (modeId && _schemas && _schemas['mode:' + modeId]) out.push({ sourceId: 'mode:' + modeId, sch: _schemas['mode:' + modeId] });
    if (_schemas && _schemas['ext:' + fileExt]) out.push({ sourceId: 'ext:' + fileExt, sch: _schemas['ext:' + fileExt] });
    if (_schemas && genericDataType && _schemas['type:' + genericDataType]) out.push({ sourceId: 'type:' + genericDataType, sch: _schemas['type:' + genericDataType] });
    return out;
  }

  function cacheKeyForResolve(ctx) {
    const c = ctx || {};
    return [c.modeId || '', c.fileExt || '', c.genericDataType || '', c.parentKey || ''].join('|');
  }

  function resolveSchemaWithSources(ctx) {
    const c = ctx || {};
    const cacheKey = cacheKeyForResolve(c);
    if (_resolveWithSourcesCache.has(cacheKey)) return _resolveWithSourcesCache.get(cacheKey);

    const parentKey = c.parentKey || '';
    const candidates = schemaCandidatesWithSources(c);
    if (!candidates.length) {
      const empty = { flat: {}, sources: {} };
      _resolveWithSourcesCache.set(cacheKey, empty);
      return empty;
    }

    let usedCandidates = candidates;
    if (parentKey) {
      const childCandidates = candidates
        .map(function (cand) {
          const ch = cand.sch && cand.sch.children ? cand.sch.children[parentKey] : null;
          return ch ? { sourceId: cand.sourceId, sch: ch } : null;
        })
        .filter(Boolean);
      if (childCandidates.length) usedCandidates = childCandidates;
    }

    const flat = {};
    const sources = {};
    for (let i = 0; i < usedCandidates.length; i++) {
      const cand = usedCandidates[i];
      const keyMap = cand.sch && cand.sch.keys ? cand.sch.keys : {};
      const ks = Object.keys(keyMap);
      for (let j = 0; j < ks.length; j++) {
        const k = ks[j];
        const nextDef = keyMap[k];
        if (!nextDef || typeof nextDef !== 'object') continue;
        flat[k] = Object.assign({}, flat[k] || {}, nextDef);
        sources[k] = cand.sourceId;
      }
    }

    const out = { flat: flat, sources: sources };
    _resolveWithSourcesCache.set(cacheKey, out);
    return out;
  }

  function resolveSchema(ctx) {
    return resolveSchemaWithSources(ctx).flat;
  }

  function inferFromConvention(key) {
    if (key.indexOf('m_b') === 0) return ['true', 'false'];
    return [];
  }

  function applySchemasPostLoad() {
    if (_schemas && window.VDataEditorModes && typeof window.VDataEditorModes.applyRuntimeSchemaTypes === 'function') {
      window.VDataEditorModes.applyRuntimeSchemaTypes(_schemas);
    }
    if (_schemas && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('vdata-schema-modes-updated'));
    }
  }

  /**
   * @param {function(string, number): void} [onProgress] message, percent 0–100
   * @param {{ forceRefresh?: boolean }} [options] forceRefresh skips TTL and re-downloads all remote schema sources
   */
  async function initSchemas(onProgress, options) {
    if (!window.VDataSchemaRuntime || typeof window.VDataSchemaRuntime.loadSchemasRuntime !== 'function') {
      console.warn('[schema] VDataSchemaRuntime not loaded');
      _schemas = null;
      return;
    }
    const loadOpts = Object.assign({}, options && typeof options === 'object' ? options : {});
    if (typeof onProgress === 'function') loadOpts.onProgress = onProgress;
    try {
      _schemas = await window.VDataSchemaRuntime.loadSchemasRuntime(loadOpts);
    } catch (e) {
      console.warn('[schema] init failed', e);
      _schemas = null;
    }
    _resolveWithSourcesCache.clear();
    applySchemasPostLoad();
  }

  /**
   * Advanced refresh: optionally force a full re-download (overwrites localStorage cache).
   * @param {function(string, number): void} [onProgress]
   * @param {{ forceRefresh?: boolean }} [options]
   */
  async function refreshSchemasAdvanced(onProgress, options) {
    const o = options && typeof options === 'object' ? options : {};
    return initSchemas(onProgress, { forceRefresh: !!o.forceRefresh });
  }

  function getSuggestedKeys(context) {
    const ctx = context || {};
    const siblingKeys = ctx.siblingKeys || [];
    const schemaKeys = new Set();
    const results = new Set();

    const flat = resolveSchema(ctx);
    Object.keys(flat).forEach(function (k) {
      schemaKeys.add(k);
      results.add(k);
    });

    const root = typeof docManager !== 'undefined' ? docManager.activeDoc && docManager.activeDoc.root : null;
    if (root && typeof root === 'object') {
      collectKeyNamesDeep(root, results);
    }

    const includeExistingSiblings = !!ctx.includeExistingSiblings;
    const outSchema = [];
    const outDoc = [];
    results.forEach(function (k) {
      if (!includeExistingSiblings && siblingKeys.indexOf(k) >= 0) return;
      if (schemaKeys.has(k)) outSchema.push(k);
      else outDoc.push(k);
    });
    outSchema.sort();
    outDoc.sort();
    return outSchema.concat(outDoc);
  }

  function isSchemaEnumField(key, context) {
    const ctx = context || {};
    const flat = resolveSchema(ctx);
    const def = flat[key];
    if (!def) return false;
    if (Array.isArray(def.enum) && def.enum.length > 0) return true;

    if (def.enumRef && window.VDataDependencyEngine && typeof window.VDataDependencyEngine.resolveEnumValues === 'function') {
      const enumCtx = Object.assign({}, ctx, {
        liveRoot: ctx.liveRoot || ctx.root || (typeof docManager !== 'undefined' ? docManager.activeDoc && docManager.activeDoc.root : null) || null
      });
      const vals = window.VDataDependencyEngine.resolveEnumValues(def.enumRef, enumCtx);
      return Array.isArray(vals) && vals.length > 0;
    }

    if (
      def.enumWidgetId &&
      typeof def.enumWidgetId === 'string' &&
      def.enumWidgetId.indexOf('bitmaskEnum:') === 0
    ) {
      return false;
    }

    if (
      def.enumWidgetId &&
      typeof def.enumWidgetId === 'string' &&
      window.SchemaDB &&
      typeof window.SchemaDB.getEnumValuesForWidgetId === 'function'
    ) {
      const vals = window.SchemaDB.getEnumValuesForWidgetId(def.enumWidgetId);
      return Array.isArray(vals) && vals.length > 0;
    }
    return false;
  }

  function getSuggestedValues(key, context) {
    const ctx = context || {};
    const flat = resolveSchema(ctx);
    const def = flat[key];
    if (def && Array.isArray(def.enum) && def.enum.length) return def.enum.slice();

    if (def && def.enumRef && window.VDataDependencyEngine && typeof window.VDataDependencyEngine.resolveEnumValues === 'function') {
      const enumCtx = Object.assign({}, ctx, {
        liveRoot: ctx.liveRoot || ctx.root || (typeof docManager !== 'undefined' ? docManager.activeDoc && docManager.activeDoc.root : null) || null
      });
      const vals = window.VDataDependencyEngine.resolveEnumValues(def.enumRef, enumCtx);
      if (Array.isArray(vals) && vals.length) return vals.slice();
    }

    if (
      def &&
      def.enumWidgetId &&
      typeof def.enumWidgetId === 'string' &&
      window.SchemaDB &&
      typeof window.SchemaDB.getEnumValuesForWidgetId === 'function'
    ) {
      const vals = window.SchemaDB.getEnumValuesForWidgetId(def.enumWidgetId);
      if (vals && vals.length) return vals.slice();
    }
    return inferFromConvention(key);
  }

  function getWidgetType(key, context) {
    const ctx = context || {};
    const flat = resolveSchema(ctx);
    const def = flat[key];
    return def && def.widget ? def.widget : null;
  }

  function inferTypeFromKeyName(key) {
    if (key === 'm_name') return 'string';
    if (key === 'generic_data_type_value') return 'string';

    // Keep color keys as `color` even if they also start with `m_v`.
    if (/color|colour/i.test(key)) return 'color';

    if (key.indexOf('m_b') === 0) return 'bool';
    if (key.indexOf('m_n') === 0 || key.indexOf('m_i') === 0) return 'int';
    if (key.indexOf('m_fl') === 0) return 'float';

    // Explicit: treat `m_s*` as string.
    if (key.indexOf('m_s') === 0) return 'string';

    if (key.indexOf('m_v') === 0 || key.indexOf('m_vec') === 0) return 'vec3';
    if (key.indexOf('m_ang') === 0) return 'vec3';
    if (key.indexOf('m_sz') === 0) return 'string';
    return 'string';
  }

  function widgetToEditorType(widget) {
    if (!widget) return null;
    if (widget === 'checkbox') return 'bool';
    if (widget === 'number-int') return 'int';
    if (widget === 'number-float') return 'float';
    if (widget === 'vec2') return 'vec2';
    if (widget === 'vec3') return 'vec3';
    if (widget === 'vec4') return 'vec4';
    if (widget === 'color') return 'color';
    if (widget === 'resource') return 'resource';
    if (widget === 'soundevent') return 'soundevent';
    if (widget === 'select' || widget === 'string') return 'string';
    return null;
  }

  function extFromFileName(fileName) {
    const m = /\.([a-z0-9]+)$/i.exec(fileName || '');
    return m ? m[1].toLowerCase() : '';
  }

  function getValueAtPath(obj, pathStr) {
    if (!pathStr) return obj;
    const parts = pathStr.split('/');
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (cur == null) return undefined;
      const m = /^\[(\d+)\]$/.exec(part);
      if (m) cur = cur[parseInt(m[1], 10)];
      else cur = cur[part];
    }
    return cur;
  }

  /**
   * @param {string} fileName
   * @param {string} [parentObjectPath]
   * @param {{ includeExistingSiblings?: boolean }} [options] When true (Property Browser), list keys even if already present on parent.
   */
  function getSuggestions(fileName, parentObjectPath, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const root = typeof docManager !== 'undefined' ? docManager.activeDoc && docManager.activeDoc.root : null;
    const parentPath = parentObjectPath && typeof parentObjectPath === 'string' ? parentObjectPath : '';
    const parentKey = parentPath ? parentPath.slice(parentPath.lastIndexOf('/') + 1) : '';
    const parentObj =
      root && typeof root === 'object'
        ? parentPath
          ? getValueAtPath(root, parentPath)
          : root
        : null;
    const siblingKeys =
      parentObj && typeof parentObj === 'object' && !Array.isArray(parentObj) ? Object.keys(parentObj) : [];

    const base =
      window.VDataEditorModes && typeof window.VDataEditorModes.getSuggestionContext === 'function'
        ? window.VDataEditorModes.getSuggestionContext(fileName, root)
        : {
            modeId: 'generic',
            fileExt: extFromFileName(fileName),
            genericDataType: (root && root.generic_data_type) || ''
          };

    const keys = getSuggestedKeys(
      Object.assign({}, base, {
        parentKey,
        siblingKeys,
        includeExistingSiblings: !!opts.includeExistingSiblings
      })
    );

    const resolved = resolveSchemaWithSources(Object.assign({}, base, { parentKey }));
    const flat = resolved.flat;
    const sources = resolved.sources;

    return keys.map(function (k) {
      const def = flat[k];
      const fromWidget = def && def.widget ? widgetToEditorType(def.widget) : null;
      const t = (def && def.type) || fromWidget || inferTypeFromKeyName(k);
      return {
        key: k,
        type: t,
        hint: '',
        description: def ? def.description || def.doc || '' : '',
        enumRef: def ? def.enumRef || null : null,
        enumWidgetId: def ? def.enumWidgetId || null : null,
        enum: def && Array.isArray(def.enum) ? def.enum.slice() : null,
        showIf: def ? def.showIf || null : null,
        enableIf: def ? def.enableIf || null : null,
        __source: sources[k] || null
      };
    });
  }

  function getSchemaEntry(key, context) {
    if (!key || typeof key !== 'string') return null;
    const ctx = context || {};
    const resolved = resolveSchemaWithSources(ctx);
    const def = resolved.flat[key];
    if (!def) return null;
    const out = Object.assign({}, def);
    if (resolved.sources && resolved.sources[key]) out.__source = resolved.sources[key];
    return out;
  }

  const api = {
    initSchemas,
    refreshSchemasAdvanced,
    getSuggestedKeys,
    isSchemaEnumField,
    getSuggestedValues,
    getWidgetType,
    inferTypeFromKeyName,
    getSuggestions,
    getSchemaEntry
  };

  if (typeof window !== 'undefined') window.VDataSuggestions = api;
})();
