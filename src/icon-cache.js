/**
 * Programmatic type badges (VsmartEditor-style): filled circle + bold label.
 * Cache keys mirror IconCache: node_* vs property_* prefixes.
 */
(function () {
  'use strict';

  const NODE_STYLE = {
    element: { label: 'E', color: '#ffc86a' },
    filter: { label: 'F', color: '#FF646C' },
    operation: { label: 'O', color: '#5387DE' },
    'selection criteria': { label: 'CR', color: '#FF81ED' },
    other: { label: 'OT', color: '#B1DE75' }
  };

  const PROPERTY_STYLE = {
    float: { label: 'fl', color: '#87FFD0' },
    number: { label: 'n', color: '#5387DE' },
    string: { label: 's', color: '#FFD186' },
    bool: { label: 'b', color: '#FFBDBE' },
    vector: { label: 'v', color: '#7A75DE' },
    materialgroup: { label: 'm', color: '#1A75DE' },
    directionspace: { label: 'ds', color: '#3A75DE' },
    variablename: { label: 'vn', color: '#adde75' },
    displayname: { label: 'dn', color: '#75de7a' },
    defaultvalue: { label: 'def', color: '#de75de' }
  };

  const UNKNOWN_STYLE = { label: '?', color: '#CCCCCC' };

  /** @type {Map<string, string>} */
  const _htmlCache = new Map();

  function cacheGetOrSet(key, factory) {
    if (_htmlCache.has(key)) return _htmlCache.get(key);
    const html = factory();
    _htmlCache.set(key, html);
    return html;
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function makeBadgeHtml(styleKey, spec) {
    const len = spec.label.length;
    const fs = len >= 3 ? '5px' : len === 2 ? '6px' : '8px';
    return (
      '<span class="vsmart-icon-badge" role="img" aria-label="' +
      escapeAttr(styleKey) +
      '" data-label-len="' +
      len +
      '" style="--vsmart-badge-fill:' +
      spec.color +
      ';--vsmart-badge-font-size:' +
      fs +
      '"><span class="vsmart-icon-badge-text">' +
      spec.label +
      '</span></span>'
    );
  }

  const UNKNOWN_PROPERTY_CACHE_KEY = 'property_\u0000_fallback';

  function nodeBadgeHtml(nodeCategory) {
    const key = 'node_' + nodeCategory;
    return cacheGetOrSet(key, () => {
      const spec = NODE_STYLE[nodeCategory] || UNKNOWN_STYLE;
      return makeBadgeHtml(nodeCategory, spec);
    });
  }

  function propertyBadgeHtml(propertyCategory) {
    const key = 'property_' + propertyCategory;
    return cacheGetOrSet(key, () => {
      const spec = PROPERTY_STYLE[propertyCategory] || UNKNOWN_STYLE;
      return makeBadgeHtml(propertyCategory, spec);
    });
  }

  function smartPropNodeCategory(className) {
    if (typeof className !== 'string' || !className) return 'other';
    if (className.indexOf('CSmartPropSelectionCriteria') >= 0) return 'selection criteria';
    if (className.indexOf('CSmartPropOperation') >= 0) return 'operation';
    if (className.indexOf('CSmartPropFilter') >= 0) return 'filter';
    if (className.indexOf('CSmartPropElement') >= 0) return 'element';
    return 'other';
  }

  function variableClassToPropertyCategory(className) {
    if (typeof className !== 'string' || className.indexOf('CSmartPropVariable_') !== 0) return null;
    const tail = className.slice('CSmartPropVariable_'.length).toLowerCase();
    if (tail === 'int' || tail === 'uint' || tail === 'integer') return 'number';
    if (tail === 'float' || tail === 'double') return 'float';
    if (tail === 'bool') return 'bool';
    if (tail === 'string') return 'string';
    if (/vector|vec|quaternion|euler|angle/.test(tail)) return 'vector';
    if (tail === 'color') return 'vector';
    if (tail === 'resource' || tail.indexOf('resource') >= 0) return 'string';
    return null;
  }

  function propertyCategoryFromKeyName(key) {
    if (typeof key !== 'string') return null;
    const kl = key.toLowerCase();
    if (key.startsWith('m_v')) return 'vector';
    if (kl === 'm_svariablename' || kl === 'variablename' || kl.endsWith('_variablename')) return 'variablename';
    if (kl === 'm_sdisplayname' || kl === 'displayname' || kl.endsWith('_displayname')) return 'displayname';
    if (kl === 'm_defaultvalue' || kl === 'defaultvalue' || kl.endsWith('_defaultvalue')) return 'defaultvalue';
    if (kl.indexOf('materialgroup') >= 0) return 'materialgroup';
    if (kl.indexOf('directionspace') >= 0 || kl.indexOf('direction_space') >= 0) return 'directionspace';
    return null;
  }

  function widgetTypeToPropertyCategory(widgetType, key) {
    const fromKey = propertyCategoryFromKeyName(key);
    if (fromKey) return fromKey;
    switch (widgetType) {
      case 'float':
      case 'float_slider_01':
        return 'float';
      case 'int':
        return 'number';
      case 'string':
      case 'readonly_string':
        return 'string';
      case 'bool':
        return 'bool';
      case 'vec2':
      case 'vec3':
      case 'vec4':
      case 'color':
      case 'components':
        return 'vector';
      default:
        return null;
    }
  }

  function paintKeyColumnBadge(el, widgetType, value, keyName) {
    if (!el) return;
    let html;
    if (widgetType === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const cls = value._class;
      const varCat = typeof cls === 'string' ? variableClassToPropertyCategory(cls) : null;
      if (varCat) {
        html = propertyBadgeHtml(varCat);
      } else {
        const nk = typeof cls === 'string' ? smartPropNodeCategory(cls) : 'other';
        html = nodeBadgeHtml(nk);
      }
    } else if (widgetType === 'array') {
      html = nodeBadgeHtml('other');
    } else {
      const pk = widgetTypeToPropertyCategory(widgetType, keyName);
      html = pk ? propertyBadgeHtml(pk) : cacheGetOrSet(UNKNOWN_PROPERTY_CACHE_KEY, () => makeBadgeHtml('unknown', UNKNOWN_STYLE));
    }
    el.innerHTML = html;
    el.style.setProperty('--type-circle-fill', '');
    el.style.setProperty('--type-circle-border', '');
  }

  window.VsmartIconCache = {
    NODE_STYLE,
    PROPERTY_STYLE,
    nodeBadgeHtml,
    propertyBadgeHtml,
    smartPropNodeCategory,
    variableClassToPropertyCategory,
    paintKeyColumnBadge,
    _clearCacheForTests() {
      _htmlCache.clear();
    }
  };
})();
