/**
 * Property editor mode registry — schema hints per file type.
 * Loaded before editor.js; exposes window.VDataEditorModes.
 */
(function () {
  const MODES = {};

  function registerMode(id, def) {
    MODES[id] = {
      id,
      label: def.label || id,
      extensions: def.extensions || [],
      resolveWidget:
        typeof def.resolveWidget === 'function'
          ? def.resolveWidget
          : function () {
              return null;
            },
      rowClass: typeof def.rowClass === 'function' ? def.rowClass : function () { return ''; }
    };
  }

  registerMode('generic', {
    label: 'Generic',
    extensions: [],
    resolveWidget: function () {
      return null;
    },
    rowClass: function () {
      return '';
    }
  });

  registerMode('vsmart', {
    label: 'Smart Prop',
    extensions: ['vsmart'],
    resolveWidget: function (key, value) {
      if (key === 'm_Components' && Array.isArray(value) && value.length === 3) return 'components';
      if (key === 'm_sModelName' || key === 'm_sSmartProp') return 'resource';
      if (key === '_class') return 'readonly_string';
      if (key === 'm_bEnabled') return 'bool';
      if (key === 'm_flProbability') return 'float_slider_01';
      return null;
    },
    rowClass: function (key, value) {
      if (key === '_class') return 'vsmart-class-row';
      if (key === 'm_bEnabled' && value === false) return 'vsmart-disabled-row';
      return '';
    }
  });

  registerMode('vsndstck', {
    label: 'Sound stack',
    extensions: ['vsndstck'],
    resolveWidget: function () {
      return null;
    }
  });

  registerMode('vpulse', {
    label: 'Pulse',
    extensions: ['vpulse'],
    resolveWidget: function () {
      return null;
    }
  });

  registerMode('vsurf', {
    label: 'Surface',
    extensions: ['vsurf'],
    resolveWidget: function () {
      return null;
    }
  });

  window.VDataEditorModes = {
    registerMode: registerMode,
    getModeForFile: function (filename) {
      const ext = (filename || '').split('.').pop().toLowerCase();
      const found = Object.values(MODES).find(function (m) {
        return m.extensions && m.extensions.indexOf(ext) !== -1;
      });
      return found || MODES.generic;
    },
    getModeById: function (id) {
      return MODES[id] || MODES.generic;
    },
    listModes: function () {
      return Object.keys(MODES)
        .filter(function (k) {
          return k !== 'generic';
        })
        .map(function (k) {
          return MODES[k];
        });
    }
  };
})();
