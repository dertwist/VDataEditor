// Key/value suggestions for the property tree — uses VDataEditorModes for file kind + runtime schema cache (VDataSchemaRuntime).
(function () {
  'use strict';

  let _schemas = null;

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

  function resolveSchema(ctx) {
    const c = ctx || {};
    const parentKey = c.parentKey || '';
    const candidates = schemaCandidates(c);
    if (candidates.length === 0) return {};

    if (parentKey) {
      const childCandidates = candidates
        .map(function (sch) {
          return sch.children && sch.children[parentKey];
        })
        .filter(Boolean);
      if (childCandidates.length) {
        return Object.assign.apply(
          null,
          [{}].concat(
            childCandidates.map(function (ch) {
              return ch.keys || {};
            })
          )
        );
      }
    }

    return Object.assign.apply(
      null,
      [{}].concat(
        candidates.map(function (sch) {
          return sch.keys || {};
        })
      )
    );
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

  function getSuggestedValues(key, context) {
    const ctx = context || {};
    const flat = resolveSchema(ctx);
    const def = flat[key];
    if (def && Array.isArray(def.enum) && def.enum.length) return def.enum.slice();
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
    if (key.indexOf('m_b') === 0) return 'bool';
    if (key.indexOf('m_n') === 0 || key.indexOf('m_i') === 0) return 'int';
    if (key.indexOf('m_fl') === 0) return 'float';
    if (key.indexOf('m_v') === 0 || key.indexOf('m_vec') === 0) return 'vec3';
    if (key.indexOf('m_ang') === 0) return 'vec3';
    if (/color|colour/i.test(key)) return 'color';
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

    const flat = resolveSchema(Object.assign({}, base, { parentKey }));

    return keys.map(function (k) {
      const def = flat[k];
      const fromWidget = def && def.widget ? widgetToEditorType(def.widget) : null;
      const t = (def && def.type) || fromWidget || inferTypeFromKeyName(k);
      return { key: k, type: t, hint: '' };
    });
  }

  const api = {
    initSchemas,
    refreshSchemasAdvanced,
    getSuggestedKeys,
    getSuggestedValues,
    getWidgetType,
    inferTypeFromKeyName,
    getSuggestions
  };

  if (typeof window !== 'undefined') window.VDataSuggestions = api;
})();
