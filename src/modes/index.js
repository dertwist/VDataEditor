/**
 * Property editor mode registry: widget hints per file kind + shared context for key suggestions.
 * Runtime schema data (GitHub fetch) and VDataSuggestions merge on top of mode + generic_data_type.
 * Loaded before editor.js; exposes window.VDataEditorModes.
 */
(function () {
  const MODES = {};

  function extFromFileName(filename) {
    const m = /\.([a-z0-9]+)$/i.exec(filename || '');
    return m ? m[1].toLowerCase() : '';
  }

  function registerMode(id, def) {
    MODES[id] = {
      id,
      label: def.label || id,
      extensions: def.extensions || [],
      /**
       * When the mode dropdown is not "Auto", use this for runtime `type:…` suggestions.
       * `undefined` = use the document root's generic_data_type.
       * `''` = do not apply any type slice (extension / static mode keys only).
       */
      schemaTypeForSuggestions: def.schemaTypeForSuggestions,
      /** Merged into VDataSuggestions like a runtime chunk: { keys: {}, children: {}, enums: {} } */
      suggestionSchema: def.suggestionSchema || null,
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
    schemaTypeForSuggestions: '',
    suggestionSchema: {
      keys: {
        generic_data_type: { type: 'string', widget: 'string' },
        _class: { type: 'string', widget: 'string' },
        m_sElementName: { type: 'string', widget: 'string' },
        m_nElementID: { type: 'int', widget: 'number-int' },
        m_bEnabled: { type: 'bool', widget: 'checkbox' },
        m_flWeight: { type: 'float', widget: 'number-float' },
        m_sModelName: { type: 'string', widget: 'resource' },
        m_sSmartProp: { type: 'string', widget: 'resource' },
        m_Components: { type: 'string', widget: 'string' },
        m_Variables: { type: 'string', widget: 'string' },
        m_Modifiers: { type: 'string', widget: 'string' }
      },
      children: {},
      enums: {}
    },
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
    schemaTypeForSuggestions: '',
    suggestionSchema: {
      keys: {
        generic_data_type: { type: 'string', widget: 'string' },
        m_name: { type: 'string', widget: 'string' },
        m_stack: { type: 'string', widget: 'string' },
        m_sounds: { type: 'string', widget: 'string' },
        m_volume: { type: 'float', widget: 'number-float' },
        m_pitch: { type: 'float', widget: 'number-float' }
      },
      children: {},
      enums: {}
    },
    resolveWidget: function () {
      return null;
    }
  });

  registerMode('vpulse', {
    label: 'Pulse',
    extensions: ['vpulse'],
    schemaTypeForSuggestions: '',
    suggestionSchema: {
      keys: {
        generic_data_type: { type: 'string', widget: 'string' },
        m_Nodes: { type: 'string', widget: 'string' },
        m_Connections: { type: 'string', widget: 'string' },
        m_Variables: { type: 'string', widget: 'string' },
        m_nNodeID: { type: 'int', widget: 'number-int' },
        m_sNodeClass: { type: 'string', widget: 'string' }
      },
      children: {},
      enums: {}
    },
    resolveWidget: function () {
      return null;
    }
  });

  registerMode('vsurf', {
    label: 'Surface',
    extensions: ['vsurf'],
    schemaTypeForSuggestions: '',
    suggestionSchema: {
      keys: {
        generic_data_type: { type: 'string', widget: 'string' },
        surfaceproperties: { type: 'string', widget: 'string' },
        base: { type: 'string', widget: 'string' },
        density: { type: 'float', widget: 'number-float' },
        elasticity: { type: 'float', widget: 'number-float' },
        friction: { type: 'float', widget: 'number-float' },
        dampening: { type: 'float', widget: 'number-float' },
        gamematerial: { type: 'string', widget: 'string' }
      },
      children: {},
      enums: {}
    },
    resolveWidget: function () {
      return null;
    }
  });

  function getModeForFile(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const found = Object.values(MODES).find(function (m) {
      return m.extensions && m.extensions.indexOf(ext) !== -1;
    });
    return found || MODES.generic;
  }

  function getModeById(id) {
    return MODES[id] || MODES.generic;
  }

  function isEditorModeAuto() {
    const sel = typeof document !== 'undefined' ? document.getElementById('editorModeSelect') : null;
    return !sel || sel.value === 'auto';
  }

  /** Respects Property editor mode dropdown (auto = infer from active tab filename). */
  function resolveActiveEditorMode() {
    const sel = typeof document !== 'undefined' ? document.getElementById('editorModeSelect') : null;
    const v = sel ? sel.value : 'auto';
    const fn =
      typeof docManager !== 'undefined' && docManager.activeDoc
        ? docManager.activeDoc.fileName || 'Untitled'
        : 'Untitled';
    if (!v || v === 'auto') return getModeForFile(fn);
    return getModeById(v);
  }

  /**
   * Register one mode per `type:Name` chunk from the runtime schema cache (dropdown + suggestion driver).
   */
  function applyRuntimeSchemaTypes(schemas) {
    if (!schemas || typeof schemas !== 'object') return;
    const keys = Object.keys(schemas);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === '_global') continue;
      if (k.indexOf('type:') !== 0) continue;
      const typeName = k.slice('type:'.length);
      if (!typeName) continue;
      const mid = 'schema:' + typeName;
      if (MODES[mid]) continue;
      registerMode(mid, {
        label: typeName + ' (schema)',
        extensions: [],
        schemaTypeForSuggestions: typeName,
        resolveWidget: function () {
          return null;
        },
        rowClass: function () {
          return '';
        }
      });
    }
  }

  /**
   * Context for VDataSuggestions: mode id, extension bucket, generic_data_type for `type:` slice.
   * Manual (non-Auto) mode: uses mode.schemaTypeForSuggestions when set (including ''); else document root.
   * @param {string} fileName
   * @param {object} [root]
   * @param {object} [mode] optional mode object; default = resolveActiveEditorMode()
   */
  function getSuggestionContext(fileName, root, mode) {
    const m = mode || resolveActiveEditorMode();
    const extFromName = extFromFileName(fileName);
    const fileExt = m.extensions && m.extensions.length ? m.extensions[0] : extFromName;
    let genericDataType = (root && root.generic_data_type) || '';
    if (!isEditorModeAuto()) {
      if (m.schemaTypeForSuggestions !== undefined) {
        genericDataType = m.schemaTypeForSuggestions || '';
      }
    }
    return {
      modeId: m.id,
      fileExt: fileExt || '',
      genericDataType: genericDataType
    };
  }

  window.VDataEditorModes = {
    registerMode: registerMode,
    getModeForFile: getModeForFile,
    getModeById: getModeById,
    isEditorModeAuto: isEditorModeAuto,
    resolveActiveEditorMode: resolveActiveEditorMode,
    getSuggestionContext: getSuggestionContext,
    applyRuntimeSchemaTypes: applyRuntimeSchemaTypes,
    listModes: function () {
      const ids = Object.keys(MODES).filter(function (k) {
        return k !== 'generic';
      });
      ids.sort(function (a, b) {
        const sa = a.indexOf('schema:') === 0;
        const sb = b.indexOf('schema:') === 0;
        if (sa !== sb) return sa ? 1 : -1;
        return a.localeCompare(b);
      });
      return ids.map(function (k) {
        return MODES[k];
      });
    }
  };
})();
