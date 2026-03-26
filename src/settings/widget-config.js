(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VDataSettings = Object.assign(root.VDataSettings || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const USER_CONFIG_KEY = 'vdata_editor_widget_config_v1';

  let _userRules = [];

  function loadUserConfig() {
    try {
      const raw = localStorage.getItem(USER_CONFIG_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      _userRules = Array.isArray(p) ? p : Array.isArray(p.rules) ? p.rules : [];
    } catch (_) {
      _userRules = [];
    }
  }

  function saveUserConfig() {
    try {
      localStorage.setItem(USER_CONFIG_KEY, JSON.stringify(_userRules));
    } catch (_) {}
  }

  function resolveWidgetType(key, inferredType) {
    for (const rule of _userRules) {
      if (VDataSettings.matchesRule(key, rule)) return rule.type;
    }
    const sysType = VDataSettings.getSystemType(key);
    if (sysType) {
      // Shape-driven numeric vector classification (Pattern A) sometimes yields
      // vec2/vec4/color for `m_v*` keys. The system config has a broad `m_v* -> vec3`
      // rule, so prevent that override from clobbering inferred widget shape.
      if (
        sysType === 'vec3' &&
        (inferredType === 'vec2' || inferredType === 'vec4' || inferredType === 'color')
      ) {
        return inferredType;
      }
      // `m_vec*` / `m_v*` match `^m_v` but CUtlVector and other lists are JSON arrays.
      if (sysType === 'vec3' && inferredType === 'array') {
        return inferredType;
      }
      return sysType;
    }
    return inferredType;
  }

  function setUserRule(match, type) {
    const existing = _userRules.findIndex((r) => r.match === match);
    if (existing >= 0) _userRules[existing].type = type;
    else _userRules.push({ match, type });
    saveUserConfig();
  }

  function removeUserRule(match) {
    _userRules = _userRules.filter((r) => r.match !== match);
    saveUserConfig();
  }

  function getUserRules() {
    return [..._userRules];
  }

  function exportUserConfig() {
    return JSON.stringify({ _version: 1, rules: _userRules }, null, 2);
  }

  function importUserConfig(jsonStr) {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || !Array.isArray(parsed.rules)) throw new Error('Invalid config format');
    _userRules = parsed.rules.filter((r) => typeof r.match === 'string' && typeof r.type === 'string');
    saveUserConfig();
  }

  loadUserConfig();

  return {
    resolveWidgetType,
    setUserRule,
    removeUserRule,
    getUserRules,
    exportUserConfig,
    importUserConfig
  };
});
