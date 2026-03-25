(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VDataSettings = Object.assign(root.VDataSettings || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const SYSTEM_CONFIG = {
    _version: 1,
    _description: 'VDataEditor system widget config. Do not edit — use user config to override.',
    rules: [
      { match: 'm_name', type: 'string', comment: 'exact key' },
      { match: 'generic_data_type_value', type: 'string', comment: 'exact key' },

      // Exclusions / overrides: keep color-like keys as `color` even if they also match `m_v*`.
      { match: 'm_vColorFade', type: 'color', comment: 'exact key' },
      { match: '/[Cc]olor|[Cc]olour/', type: 'color', comment: 'regex: Color/Colour in key' },

      // Prefix-based type mapping.
      { match: '/^m_b/', type: 'bool' },
      { match: '/^m_n/', type: 'int' },
      { match: '/^m_fl/', type: 'float' },
      { match: '/^m_s/', type: 'string' },
      { match: '/^m_v/', type: 'vec3' }
    ]
  };

  function matchesRule(key, rule) {
    const m = rule.match;
    if (typeof m !== 'string') return false;
    if (m.startsWith('/') && m.endsWith('/')) {
      try {
        return new RegExp(m.slice(1, -1)).test(key);
      } catch (_) {
        return false;
      }
    }
    return key === m;
  }

  function getSystemType(key) {
    for (const rule of SYSTEM_CONFIG.rules) {
      if (matchesRule(key, rule)) return rule.type;
    }
    return null;
  }

  return { SYSTEM_CONFIG, getSystemType, matchesRule };
});
