(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VDataSettings = Object.assign(root.VDataSettings || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const SYSTEM_CONFIG = {
    _version: 1,
    _description: 'VDataEditor system widget config. Do not edit — use user config to override.',
    rules: [
      { match: 'm_Color', type: 'color', comment: 'exact key' },
      { match: 'm_Background', type: 'color' },
      { match: 'm_vColorFade', type: 'color' },
      { match: '/[Cc]olor$/', type: 'color', comment: 'regex: ends with Color or color' },
      { match: '/[Cc]olour$/', type: 'color' },
      { match: '/[Pp]os$/', type: 'vec3' },
      { match: '/[Pp]osition$/', type: 'vec3' },
      { match: '/[Dd]ir$/', type: 'vec3' },
      { match: '/[Vv]ec3$/', type: 'vec3' },
      { match: '/[Oo]ffset$/', type: 'vec3' },
      { match: '/[Ss]cale$/', type: 'vec3' },
      { match: '/[Uu][Vv]$/', type: 'vec2' },
      { match: '/[Qq]uat$/', type: 'vec4' },
      { match: '/[Rr]otation$/', type: 'vec4' }
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
