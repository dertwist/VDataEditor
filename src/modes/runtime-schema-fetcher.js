// Mode-layer runtime data: fetch CS2 vdata/SDK hints from GitHub, parse with KV3Format, cache in localStorage.
(function () {
  'use strict';

  const CACHE_KEY = 'vdata_schema_cache';
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

  function readCacheMeta() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.fetchedAt !== 'number' || !parsed.schemas || typeof parsed.schemas !== 'object') {
        return null;
      }
      return { fetchedAt: parsed.fetchedAt, schemas: parsed.schemas };
    } catch {
      return null;
    }
  }
  const GT_RAW = 'https://raw.githubusercontent.com/SteamTracking/GameTracking-CS2/master';
  const SDK_RAW = 'https://raw.githubusercontent.com/neverlosecc/source2sdk/main/cs2';

  function parseKV3Text(text) {
    const K = typeof KV3Format !== 'undefined' ? KV3Format : null;
    if (!K || typeof K.kv3ToJSON !== 'function') throw new Error('KV3Format.kv3ToJSON not available');
    return K.kv3ToJSON(text);
  }

  function extractSchemaFromVdata(text) {
    const tree = parseKV3Text(text);
    const schema = { keys: {}, enums: {}, children: {} };

    for (const [, val] of Object.entries(tree)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        walkObject(val, schema, null);
      }
    }

    pruneEnumsDeep(schema);
    return schema;
  }

  function walkObject(obj, schema, _parentKey) {
    for (const [key, val] of Object.entries(obj)) {
      const widget = inferWidget(key, val);

      if (!schema.keys[key]) {
        schema.keys[key] = { type: inferType(key, val), widget, count: 1 };
      } else {
        schema.keys[key].count++;
      }

      if (widget === 'string' && typeof val === 'string' && val.length > 0) {
        if (!schema.enums[key]) schema.enums[key] = {};
        schema.enums[key][val] = (schema.enums[key][val] ?? 0) + 1;
      }

      if (val && typeof val === 'object' && !Array.isArray(val)) {
        if (!schema.children[key]) schema.children[key] = { keys: {}, enums: {}, children: {} };
        walkObject(val, schema.children[key], key);
      }
    }
  }

  function inferWidget(key, val) {
    void key;
    if (typeof val === 'boolean') return 'checkbox';
    if (typeof val === 'number') return Number.isInteger(val) ? 'number-int' : 'number-float';
    if (Array.isArray(val) && val.length === 3 && val.every((v) => typeof v === 'number')) return 'vec3';
    if (Array.isArray(val) && val.length === 4 && val.every((v) => typeof v === 'number')) return 'vec4';
    if (Array.isArray(val) && val.length === 2 && val.every((v) => typeof v === 'number')) return 'vec2';
    if (typeof val === 'string' && val.startsWith('resource_name:')) return 'resource';
    if (typeof val === 'string' && val.startsWith('soundevent:')) return 'soundevent';
    return 'string';
  }

  function inferType(key, val) {
    if (key.indexOf('m_b') === 0) return 'bool';
    if (key.indexOf('m_fl') === 0) return 'float';
    if (key.indexOf('m_n') === 0 || key.indexOf('m_i') === 0) return 'int';
    if (key.indexOf('m_sz') === 0 || key.indexOf('m_e') === 0) return 'string';
    if (key.indexOf('m_vec') === 0) return 'vec3';
    return typeof val === 'number' ? 'float' : 'string';
  }

  function pruneEnums(schema) {
    const enums = schema.enums || {};
    for (const [key, counts] of Object.entries(enums)) {
      const values = Object.entries(counts)
        .filter(([, n]) => n >= 2)
        .map(([v]) => v)
        .sort();
      if (values.length >= 2) {
        schema.keys[key] = Object.assign({}, schema.keys[key] || {}, { widget: 'select', enum: values });
      }
      delete schema.enums[key];
    }
  }

  function pruneEnumsDeep(s) {
    if (!s || typeof s !== 'object') return;
    pruneEnums(s);
    const ch = s.children || {};
    for (const k of Object.keys(ch)) pruneEnumsDeep(ch[k]);
  }

  function parseSDKHeader(text) {
    const fields = {};
    const re = /^\s+([\w:<>*, ]+?)\s+(m_\w+)\s*;/gm;
    for (const m of text.matchAll(re)) {
      const cppType = m[1].trim();
      const name = m[2];
      fields[name] = cppTypeToWidget(cppType);
    }
    return fields;
  }

  function cppTypeToWidget(t) {
    if (t === 'bool') return 'checkbox';
    if (t === 'float' || t === 'float32') return 'number-float';
    if (/^(int|uint|int32|uint32|int64)/.test(t)) return 'number-int';
    if (t.includes('Vector2D')) return 'vec2';
    if (t === 'Vector' || t === 'QAngle') return 'vec3';
    if (t.includes('Vector4D')) return 'vec4';
    if (t.includes('Color')) return 'color';
    if (t.includes('CResourceNameTyped')) return 'resource';
    return 'string';
  }

  function mergeSDKIntoSchema(schema, sdkFields) {
    if (!schema.keys) schema.keys = {};
    for (const [key, widget] of Object.entries(sdkFields)) {
      if (schema.keys[key]) {
        schema.keys[key].widget = widget;
      } else {
        schema.keys[key] = { widget, count: 0 };
      }
    }
    return schema;
  }

  function tryLoadCache() {
    const meta = readCacheMeta();
    if (!meta) return null;
    if (Date.now() - meta.fetchedAt > CACHE_TTL) return null;
    return meta.schemas;
  }

  /** Cached schemas even if TTL expired (read-only; does not imply validity). */
  function peekCacheSchemas() {
    const meta = readCacheMeta();
    return meta ? meta.schemas : null;
  }

  function getSchemaCacheStatus() {
    const meta = readCacheMeta();
    const ttlMs = CACHE_TTL;
    if (!meta) {
      return {
        hasData: false,
        fetchedAt: null,
        ageMs: null,
        ttlMs,
        isStale: true,
        schemaKeyCount: 0
      };
    }
    const ageMs = Date.now() - meta.fetchedAt;
    const keys = Object.keys(meta.schemas).filter(function (k) {
      return k !== '_global';
    });
    return {
      hasData: true,
      fetchedAt: meta.fetchedAt,
      ageMs,
      ttlMs,
      isStale: ageMs > ttlMs,
      schemaKeyCount: keys.length
    };
  }

  function saveCache(schemas) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), schemas }));
    } catch (e) {
      console.warn('[schema] Cache save failed (localStorage full?):', e.message);
    }
  }

  async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    return res.text();
  }

  async function fetchParseAndSaveAllSchemas(onProgress) {
    const schemas = {};

    const vdataJobs = [
      { path: 'game/csgo/pak01_dir/scripts/weapons.vdata', schemaKey: 'type:CBasePlayerWeaponVData' },
      { path: 'game/csgo/pak01_dir/scripts/decalgroups.vdata', schemaKey: 'type:CDecalGroupData' },
      { path: 'game/csgo/pak01_dir/scripts/propdata.vdata', schemaKey: 'type:CPropData' },
      { path: 'game/csgo/pak01_dir/scripts/light_styles.vdata', schemaKey: 'type:CLightStyleData' },
      { path: 'game/csgo/pak01_dir/scripts/nav_hulls.vdata', schemaKey: 'type:CNavHullData' }
    ];

    for (let i = 0; i < vdataJobs.length; i++) {
      const job = vdataJobs[i];
      const path = job.path;
      const schemaKey = job.schemaKey;
      onProgress &&
        onProgress('Parsing ' + path.split('/').pop() + '…', Math.round((i / vdataJobs.length) * 60));
      try {
        const text = await fetchText(GT_RAW + '/' + path);
        schemas[schemaKey] = extractSchemaFromVdata(text);
      } catch (e) {
        console.warn('[schema] Failed to fetch ' + path + ':', e.message);
      }
    }

    const sdkClasses = ['CBasePlayerWeaponVData', 'CBasePlayerPawnVData', 'CCSPlayerController'];

    for (let i = 0; i < sdkClasses.length; i++) {
      const cls = sdkClasses[i];
      onProgress &&
        onProgress('Fetching SDK: ' + cls + '…', 60 + Math.round((i / sdkClasses.length) * 35));
      try {
        const url = SDK_RAW + '/client/' + cls + '.hpp';
        const text = await fetchText(url);
        const sdkFields = parseSDKHeader(text);
        const sk = 'type:' + cls;
        const base = schemas[sk] || { keys: {}, enums: {}, children: {} };
        schemas[sk] = mergeSDKIntoSchema(base, sdkFields);
      } catch {
        /* header missing */
      }
    }

    onProgress && onProgress('Done', 100);

    schemas._global = {
      keys: {
        generic_data_type: { type: 'string', widget: 'string' },
        _class: { type: 'string', widget: 'string' },
        _base: { type: 'string', widget: 'string' },
        _not_pickable: { type: 'int', widget: 'number-int' }
      },
      enums: {},
      children: {}
    };

    saveCache(schemas);
    return schemas;
  }

  /**
   * @param {object} [options]
   * @param {function(string, number): void} [options.onProgress] message, percent 0–100
   * @param {boolean} [options.forceRefresh] skip TTL cache and re-download everything
   */
  async function loadSchemasRuntime(options) {
    const opts = options || {};
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const forceRefresh = !!opts.forceRefresh;

    if (!forceRefresh) {
      const cached = tryLoadCache();
      if (cached) {
        onProgress && onProgress('Using cached schemas', 100);
        return cached;
      }
    }

    if (forceRefresh) {
      onProgress && onProgress('Re-downloading all schemas…', 0);
    } else if (readCacheMeta()) {
      onProgress && onProgress('Schema cache expired — updating from network…', 0);
    } else {
      onProgress && onProgress('Fetching CS2 schemas…', 0);
    }

    return fetchParseAndSaveAllSchemas(onProgress);
  }

  function invalidateCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }

  function getCacheAge() {
    const meta = readCacheMeta();
    if (!meta) return null;
    return Date.now() - meta.fetchedAt;
  }

  const api = {
    CACHE_TTL,
    loadSchemasRuntime,
    fetchParseAndSaveAllSchemas,
    invalidateCache,
    getCacheAge,
    getSchemaCacheStatus,
    peekCacheSchemas
  };

  if (typeof window !== 'undefined') window.VDataSchemaRuntime = api;
})();
