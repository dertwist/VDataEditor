/**
 * Runtime schema hints from Counter-Strike 2 data in
 * https://github.com/SteamTracking/GameTracking-CS2
 *
 * Discovers `.vdata` files by recursively crawling selected repo directories via the GitHub Contents API,
 * then fetches each file from `download_url` (or raw.githubusercontent.com), parses KV3, and merges into schema buckets.
 */
(function () {
  'use strict';

  const CACHE_KEY = 'vdata_schema_cache';
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  const GT_REPO = 'SteamTracking/GameTracking-CS2';
  const GT_BRANCH = 'master';
  const GT_API = 'https://api.github.com/repos/' + GT_REPO + '/contents';
  const GT_RAW = 'https://raw.githubusercontent.com/' + GT_REPO + '/' + GT_BRANCH;
  const SDK_RAW = 'https://raw.githubusercontent.com/neverlosecc/source2sdk/main/cs2';

  const GITHUB_FETCH_INIT = {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  };

  const CRAWL_ROOTS = [
    'game/csgo/pak01_dir/scripts',
    'game/csgo/pak01_dir/entities',
    'game/csgo/pak01_dir/data',
    'game/csgo/pak01_dir/cfg'
  ];

  const SKIP_DIRS = new Set([
    'game/csgo/pak01_dir/maps',
    'game/csgo/pak01_dir/sounds',
    'game/csgo/pak01_dir/materials',
    'game/csgo/pak01_dir/models',
    'game/csgo/pak01_dir/panorama'
  ]);

  const KNOWN_TYPE_MAP = {
    weapons: 'type:CBasePlayerWeaponVData',
    decalgroups: 'type:CDecalGroupData',
    propdata: 'type:CPropData',
    light_styles: 'type:CLightStyleData',
    light_style_event_types: 'type:CLightStyleEventTypes',
    nav_hulls: 'type:CNavHullData',
    nav_hulls_presets: 'type:CNavHullPresetsData',
    navlinks: 'type:CNavLinkData',
    precipitation: 'type:CPrecipitationData',
    survival_config: 'type:CSurvivalConfig',
    inventory_image_data: 'type:CInventoryImageData',
    game_asset_tags: 'type:CGameAssetTagData',
    anim_preview_archetypes: 'type:CAnimPreviewData'
  };

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

  function pathToSchemaKey(filePath) {
    const base = filePath.split('/').pop().replace(/\.vdata$/i, '');
    return KNOWN_TYPE_MAP[base] || 'path:' + base;
  }

  function dirIsSkipped(dirPath) {
    if (SKIP_DIRS.has(dirPath)) return true;
    for (const prefix of SKIP_DIRS) {
      if (dirPath === prefix || dirPath.startsWith(prefix + '/')) return true;
    }
    return false;
  }

  async function crawlVdataFiles(onProgress) {
    const found = [];
    let apiCalls = 0;

    async function crawlDir(dirPath) {
      if (dirIsSkipped(dirPath)) return;

      const apiUrl = GT_API + '/' + dirPath + '?ref=' + encodeURIComponent(GT_BRANCH);
      let entries;
      try {
        apiCalls++;
        const res = await fetch(apiUrl, GITHUB_FETCH_INIT);
        if (!res.ok) return;
        entries = await res.json();
      } catch {
        return;
      }

      if (!Array.isArray(entries)) return;

      const subdirs = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry || !entry.type) continue;
        if (entry.type === 'file' && entry.name && entry.name.endsWith('.vdata')) {
          found.push({
            path: entry.path,
            rawUrl: entry.download_url || GT_RAW + '/' + entry.path,
            schemaKey: pathToSchemaKey(entry.path)
          });
        } else if (entry.type === 'dir' && entry.path) {
          subdirs.push(entry.path);
        }
      }

      for (let j = 0; j < subdirs.length; j++) {
        await crawlDir(subdirs[j]);
      }
    }

    onProgress && onProgress('Discovering vdata files…', 2);
    for (let r = 0; r < CRAWL_ROOTS.length; r++) {
      await crawlDir(CRAWL_ROOTS[r]);
    }

    found.sort(function (a, b) {
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
    onProgress && onProgress('Found ' + found.length + ' vdata files (' + apiCalls + ' API calls)', 8);
    return found;
  }

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

  function mergeSchemas(base, incoming) {
    const out = base;
    if (!out.keys) out.keys = {};
    if (!out.children) out.children = {};
    if (!incoming) return out;

    for (const [key, def] of Object.entries(incoming.keys || {})) {
      if (!out.keys[key]) {
        out.keys[key] = def;
      } else {
        out.keys[key].count = (out.keys[key].count ?? 0) + (def.count ?? 1);
        const prevLen = out.keys[key].enum?.length ?? 0;
        const nextLen = def.enum?.length ?? 0;
        if (nextLen > prevLen) {
          out.keys[key].enum = def.enum;
          out.keys[key].widget = 'select';
        }
      }
    }

    for (const [ck, cs] of Object.entries(incoming.children || {})) {
      out.children[ck] = out.children[ck] ? mergeSchemas(out.children[ck], cs) : cs;
    }
    return out;
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

    const vdataFiles = await crawlVdataFiles(onProgress);
    const total = vdataFiles.length;
    const BATCH = 6;
    let filesHandled = 0;

    if (total === 0) {
      onProgress && onProgress('Parsed 0/0 files (no vdata discovered)', 80);
    } else {
      for (let i = 0; i < vdataFiles.length; i += BATCH) {
        const batch = vdataFiles.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async function (job) {
            const label = job.path.split('/').pop();
            try {
              const text = await fetchText(job.rawUrl);
              const schema = extractSchemaFromVdata(text);
              if (schemas[job.schemaKey]) {
                schemas[job.schemaKey] = mergeSchemas(schemas[job.schemaKey], schema);
              } else {
                schemas[job.schemaKey] = schema;
              }
            } catch (e) {
              console.warn('[schema] Failed ' + label + ':', e.message);
              filesHandled++;
              const skipPct = 8 + Math.round((filesHandled / total) * 72);
              onProgress && onProgress('Skipped ' + label + ': ' + e.message, skipPct);
              return;
            }
            filesHandled++;
          })
        );
        const pct = 8 + Math.round((filesHandled / total) * 72);
        onProgress && onProgress('Parsed ' + filesHandled + '/' + total + ' files…', pct);
      }
    }

    const sdkClasses = [
      'CBasePlayerWeaponVData',
      'CBasePlayerPawnVData',
      'CCSPlayerController',
      'CDecalGroupData',
      'CPropData',
      'CLightStyleData'
    ];
    const nSdk = sdkClasses.length;

    for (let i = 0; i < nSdk; i++) {
      const cls = sdkClasses[i];
      onProgress && onProgress('SDK: ' + cls + '…', 80 + Math.round((i / nSdk) * 15));
      try {
        const url = SDK_RAW + '/client/' + cls + '.hpp';
        const text = await fetchText(url);
        const sdkFields = parseSDKHeader(text);
        const sk = 'type:' + cls;
        schemas[sk] = mergeSDKIntoSchema(schemas[sk] || { keys: {}, enums: {}, children: {} }, sdkFields);
      } catch {
        /* header missing */
      }
    }

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

    onProgress && onProgress('Saving…', 98);
    saveCache(schemas);
    const bucketCount = Object.keys(schemas).length;
    onProgress && onProgress('Done — ' + bucketCount + ' schemas from ' + total + ' vdata files', 100);
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
    GT_REPO,
    GT_BRANCH,
    GT_HTML: 'https://github.com/' + GT_REPO,
    loadSchemasRuntime,
    fetchParseAndSaveAllSchemas,
    crawlVdataFiles,
    invalidateCache,
    getCacheAge,
    getSchemaCacheStatus,
    peekCacheSchemas
  };

  if (typeof window !== 'undefined') window.VDataSchemaRuntime = api;
})();
