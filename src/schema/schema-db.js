/**
 * Runtime schema from ValveResourceFormat/SchemaExplorer (JSON or gzipped JSON from GitHub).
 * @global SchemaDB
 */
(function () {
  'use strict';

  const SCHEMA_URLS = {
    cs2: 'https://raw.githubusercontent.com/ValveResourceFormat/SchemaExplorer/main/schemas/cs2.json.gz',
    dota2: 'https://raw.githubusercontent.com/ValveResourceFormat/SchemaExplorer/main/schemas/dota2.json.gz',
    deadlock: 'https://raw.githubusercontent.com/ValveResourceFormat/SchemaExplorer/main/schemas/deadlock.json.gz'
  };

  const META_KEY = 'vdata_schema_meta';

  /** Intrinsic / declared_class names → editor widget id */
  const INTRINSIC_WIDGET = new Map([
    ['Vector', 'vec3'],
    ['Color', 'color'],
    ['Vector2D', 'vec2'],
    ['Vector4D', 'vec4'],
    ['QAngle', 'vec3'],
    ['Quaternion', 'vec4'],
    ['QuaternionAligned', 'vec4'],
    ['CStrongHandle', 'resource'],
    ['CStrongHandleCopyable', 'resource']
  ]);

  let _loaded = false;
  let _game = null;
  let _revisionInfo = null;
  let _raw = null;
  /** @type {Map<string, object>} */
  let _classesByName = new Map();
  /** @type {Map<string, object>} enum key → enum object */
  let _enumByKey = new Map();

  function _builtinWidget(name) {
    if (name === 'float32' || name === 'float64') return 'float';
    if (
      /^(int|uint)(8|16|32|64)$/.test(name) ||
      /^(u?int(8|16|32|64))$/.test(name) ||
      name === 'int8' ||
      name === 'int16' ||
      name === 'int32' ||
      name === 'int64'
    )
      return 'int';
    if (name === 'bool') return 'bool';
    if (name === 'char') return 'string';
    return null;
  }

  function _atomicWidget(t) {
    const n = t.name;
    if (!n) return null;
    if (['Vector', 'QAngle', 'RadianEuler', 'DegreeEuler', 'VectorWS'].includes(n)) return 'vec3';
    if (n === 'Vector2D') return 'vec2';
    if (n === 'Vector4D' || n === 'Quaternion' || n === 'QuaternionAligned') return 'vec4';
    if (n === 'Color') return 'color';
    if (n === 'CStrongHandle' || n === 'CStrongHandleCopyable') return 'resource';
    if (n === 'CUtlVector' || n === 'C_NetworkUtlVectorBase' || n === 'C_UtlVectorEmbeddedNetworkVar') return 'array';
    if (n === 'CUtlString' || n === 'CUtlSymbolLarge' || n === 'char*') return 'string';
    if (n === 'CResourceNameTyped' || n === 'CWeakHandle' || /ResourceName|StrongHandle|Handle/i.test(n)) return 'resource';
    if (n === 'CEntityHandle' || n === 'EHANDLE') return 'int';
    if (/QAngle|Euler/i.test(n)) return 'vec3';
    if (/Quaternion/i.test(n)) return 'vec4';
    if (INTRINSIC_WIDGET.has(n)) return INTRINSIC_WIDGET.get(n);
    return null;
  }

  /**
   * @param {object} type
   * @returns {string|null}
   */
  function typeToWidget(type) {
    if (!type || typeof type !== 'object') return null;
    const cat = type.category;
    const name = type.name;

    if (cat === 'builtin') return _builtinWidget(name);

    if (cat === 'atomic') {
      const w = _atomicWidget(type);
      if (w) return w;
      if (type.inner) return typeToWidget(type.inner);
      return null;
    }

    if (cat === 'declared_enum') {
      const mod = type.module || '';
      return mod ? 'enum:' + mod + '::' + name : 'enum:' + name;
    }

    if (cat === 'declared_class') {
      if (INTRINSIC_WIDGET.has(name)) return INTRINSIC_WIDGET.get(name);
      if (/Vector2D/i.test(name)) return 'vec2';
      if (/Vector4D|Quaternion/i.test(name)) return 'vec4';
      if (/Vector|QAngle|Euler|Angles/i.test(name)) return 'vec3';
      if (/Color/i.test(name)) return 'color';
      if (/ResourceName|StrongHandle|WeakHandle|Sound/i.test(name)) return 'resource';
      return 'object';
    }

    if ((cat === 'pointer' || cat === 'ptr') && type.inner) return typeToWidget(type.inner);

    if (cat === 'fixed_array' || cat === 'array') return 'array';

    if (cat === 'bitfield') return 'int';

    if (cat === 'generic') {
      if (type.inner) return typeToWidget(type.inner);
      if (name && /Vector|UtlVector|CUtlVector/i.test(name)) return 'array';
    }

    return null;
  }

  function parseClassDefaults(classObj) {
    const meta = classObj.metadata && classObj.metadata.find(function (m) { return m.name === 'MGetKV3ClassDefaults'; });
    if (!meta || typeof meta.value !== 'string') return {};
    try {
      return JSON.parse(meta.value);
    } catch (_) {
      return {};
    }
  }

  function buildIndexes(data) {
    _classesByName = new Map();
    _enumByKey = new Map();
    const classes = data.classes || [];
    for (let i = 0; i < classes.length; i++) {
      const c = classes[i];
      if (c && typeof c.name === 'string') _classesByName.set(c.name, c);
    }
    const enums = data.enums || [];
    for (let j = 0; j < enums.length; j++) {
      const e = enums[j];
      if (!e || typeof e.name !== 'string') continue;
      const mod = e.module || '';
      const fullKey = mod + '::' + e.name;
      _enumByKey.set(fullKey, e);
      if (!_enumByKey.has(e.name)) _enumByKey.set(e.name, e);
    }
  }

  function readCachedMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function writeCachedMeta(info) {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(info));
    } catch (_) {}
  }

  async function gunzipToJson(arrayBuffer) {
    const ds = new DecompressionStream('gzip');
    const blob = new Blob([arrayBuffer]).stream().pipeThrough(ds);
    const text = await new Response(blob).text();
    return JSON.parse(text);
  }

  /**
   * Apply parsed SchemaExplorer JSON (same shape as remote .json.gz).
   */
  function applySchemaPayload(data, game) {
    const g = game === 'dota2' || game === 'deadlock' ? game : 'cs2';
    _raw = data;
    buildIndexes(data);

    _revisionInfo = {
      revision: data.revision,
      versionDate: data.version_date || '',
      versionTime: data.version_time || '',
      game: g
    };

    writeCachedMeta({
      revision: _revisionInfo.revision,
      versionDate: _revisionInfo.versionDate,
      versionTime: _revisionInfo.versionTime,
      game: g,
      loadedAt: new Date().toISOString()
    });

    _loaded = true;

    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('vdata-schema-loaded', { detail: { game: g } }));
    }

    return _revisionInfo;
  }

  async function loadFromNetwork(game, forceRefresh) {
    const g = game === 'dota2' || game === 'deadlock' ? game : 'cs2';
    const url = SCHEMA_URLS[g];
    if (!url) throw new Error('Unknown game: ' + game);

    const res = await fetch(url, { cache: forceRefresh ? 'no-cache' : 'default' });
    if (!res.ok) throw new Error('Schema fetch failed: ' + res.status);

    const buf = await res.arrayBuffer();
    const data = await gunzipToJson(buf);

    return applySchemaPayload(data, g);
  }

  async function load(game, options) {
    const g = game === 'dota2' || game === 'deadlock' ? game : 'cs2';
    const opts = options && typeof options === 'object' ? options : {};
    const forceRemote = !!opts.forceRemote;

    _loaded = false;
    _game = g;
    _revisionInfo = null;
    _raw = null;

    if (
      !forceRemote &&
      typeof window !== 'undefined' &&
      window.electronAPI &&
      typeof window.electronAPI.readSchemaBundle === 'function'
    ) {
      try {
        const result = await window.electronAPI.readSchemaBundle(g);
        if (result && result.ok === true && result.data && typeof result.data === 'object') {
          return applySchemaPayload(result.data, g);
        }
        if (result && result.ok === false) {
          console.warn('[schema-db] local schemas/' + g + '.json:', result.error, result.path);
        }
      } catch (e) {
        console.warn('[schema-db] readSchemaBundle failed, falling back to network', e);
      }
    }

    try {
      return await loadFromNetwork(g, true);
    } catch (e) {
      console.warn('[schema-db] network gzip failed, trying relative schemas/' + g + '.json', e);
    }

    const rel = 'schemas/' + g + '.json';
    const res2 = await fetch(rel, { cache: 'no-cache' });
    if (!res2.ok) throw new Error('Schema load failed: no bundle, network, or ' + rel);
    const data = await res2.json();
    return applySchemaPayload(data, g);
  }

  function isLoaded() {
    return _loaded;
  }

  function getRevision() {
    return _revisionInfo ? Object.assign({}, _revisionInfo) : null;
  }

  function hasClass(name) {
    return typeof name === 'string' && !!name && _classesByName.has(name);
  }

  function getFields(className) {
    if (!className || !_classesByName.has(className)) return [];
    const cls = _classesByName.get(className);
    const defaults = parseClassDefaults(cls);
    const fields = cls.fields || [];
    const out = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f || typeof f.name !== 'string') continue;
      const w = typeToWidget(f.type);
      const dv = Object.prototype.hasOwnProperty.call(defaults, f.name) ? defaults[f.name] : null;
      out.push({ name: f.name, type: w, defaultValue: dv, rawType: f.type || null, metadata: f.metadata || [] });
    }
    return out;
  }

  function getFieldType(className, fieldName) {
    if (!className || !fieldName || !_classesByName.has(className)) return null;
    const cls = _classesByName.get(className);
    const fields = cls.fields || [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f && f.name === fieldName) return f.type || null;
    }
    return null;
  }

  /**
   * @param {string} widgetId e.g. enum:module::EnumName
   * @returns {string[]}
   */
  function getEnumValuesForWidgetId(widgetId) {
    if (!widgetId || typeof widgetId !== 'string' || widgetId.indexOf('enum:') !== 0) return [];
    const rest = widgetId.slice('enum:'.length);
    const en = _enumByKey.get(rest) || _enumByKey.get(rest.split('::').pop());
    if (!en || !Array.isArray(en.members)) return [];
    const members = en.members.slice().sort(function (a, b) {
      return (a.value || 0) - (b.value || 0);
    });
    return members.map(function (m) { return m.name; });
  }

  function listClassNames() {
    return Array.from(_classesByName.keys());
  }

  function getRaw() {
    return _raw;
  }

  const api = {
    load: load,
    applySchemaPayload: applySchemaPayload,
    typeToWidget: typeToWidget,
    isLoaded: isLoaded,
    getRevision: getRevision,
    hasClass: hasClass,
    getFields: getFields,
    getFieldType: getFieldType,
    getEnumValuesForWidgetId: getEnumValuesForWidgetId,
    listClassNames: listClassNames,
    getRaw: getRaw,
    readCachedMeta: readCachedMeta
  };

  if (typeof window !== 'undefined') window.SchemaDB = api;
})();
