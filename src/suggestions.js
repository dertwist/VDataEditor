// Key suggestion engine for the Add Property dialog.
// Combines a static schema with a live scan of the current document.

const VDataSuggestions = (() => {
  'use strict';

  const SCHEMA = {
    vsmart: [
      { key: 'generic_data_type', type: 'string', hint: 'Root type, e.g. CSmartPropRoot' },
      { key: 'm_Children', type: 'array', hint: 'Child element list' },
      { key: 'm_Variables', type: 'array', hint: 'Variable definitions' },
      { key: 'm_Modifiers', type: 'array', hint: 'Modifier list' },
      { key: 'm_SelectionCriteria', type: 'array', hint: 'Selection criteria list' },
      { key: 'm_sElementName', type: 'string', hint: 'Element display name' },
      { key: 'm_nElementID', type: 'int', hint: 'Unique element ID' },
      { key: 'm_bEnabled', type: 'bool', hint: 'Enable/disable this element' },
      { key: 'm_flWeight', type: 'float', hint: 'Weight [0..1]' },
      { key: 'm_nVariableIndex', type: 'int', hint: 'Variable slot index' },
      { key: 'm_VariableType', type: 'string', hint: 'Variable type string' },
      { key: 'm_DefaultValue', type: 'string', hint: 'Default variable value' },
      { key: 'm_flMinValue', type: 'float', hint: 'Minimum clamp' },
      { key: 'm_flMaxValue', type: 'float', hint: 'Maximum clamp' },
      { key: 'm_vOffset', type: 'vec3', hint: 'Position offset XYZ' },
      { key: 'm_vScale', type: 'vec3', hint: 'Scale XYZ' },
      { key: 'm_angRotation', type: 'vec3', hint: 'Euler rotation' },
      { key: 'm_Color', type: 'color', hint: 'RGB color [0..255]' },
      { key: 'm_sModel', type: 'resource', hint: 'Model resource path' },
      { key: 'm_sParticle', type: 'resource', hint: 'Particle resource path' }
    ],

    CMapCameraNodes: [
      { key: 'generic_data_type', type: 'string' },
      { key: 'm_CameraNodes', type: 'array', hint: 'Array of camera node objects' },
      { key: 'm_nPriority', type: 'int', hint: 'Camera priority' },
      { key: 'm_flFOV', type: 'float', hint: 'Field of view (degrees)' },
      { key: 'm_vPosition', type: 'vec3', hint: 'World position' },
      { key: 'm_vTarget', type: 'vec3', hint: 'Look-at target' },
      { key: 'm_flNearClip', type: 'float', hint: 'Near clip plane' },
      { key: 'm_flFarClip', type: 'float', hint: 'Far clip plane' },
      { key: 'm_nId', type: 'int' },
      { key: 'm_sName', type: 'string' }
    ],

    vsurf: [
      { key: 'generic_data_type', type: 'string' },
      { key: 'm_SurfaceProperties', type: 'array' },
      { key: 'm_density', type: 'float', hint: 'Material density' },
      { key: 'm_elasticity', type: 'float', hint: '0=inelastic, 1=perfectly elastic' },
      { key: 'm_friction', type: 'float', hint: 'Friction coefficient' },
      { key: 'm_dampening', type: 'float' },
      { key: 'm_soundDustParticle', type: 'soundevent' },
      { key: 'm_impactHard', type: 'soundevent' },
      { key: 'm_impactSoft', type: 'soundevent' },
      { key: 'm_scrapeSmooth', type: 'soundevent' },
      { key: 'm_scrapeRough', type: 'soundevent' },
      { key: 'm_bulletImpact', type: 'soundevent' },
      { key: 'm_rolling', type: 'soundevent' },
      { key: 'm_strName', type: 'string', hint: 'Surface name string' },
      { key: 'm_nGameMaterial', type: 'int' }
    ],

    vsndstck: [
      { key: 'generic_data_type', type: 'string' },
      { key: 'm_SoundStacks', type: 'array' },
      { key: 'm_Sounds', type: 'array' },
      { key: 'm_Operators', type: 'array' },
      { key: 'm_sStackName', type: 'string' },
      { key: 'm_flVolume', type: 'float', hint: '0..1' },
      { key: 'm_flPitch', type: 'float', hint: 'Pitch multiplier' },
      { key: 'm_nSoundEventHash', type: 'int' },
      { key: 'm_sSoundEventName', type: 'soundevent' },
      { key: 'm_flFadeInTime', type: 'float' },
      { key: 'm_flFadeOutTime', type: 'float' },
      { key: 'm_flDelay', type: 'float' },
      { key: 'm_bLooping', type: 'bool' }
    ],

    vpulse: [
      { key: 'generic_data_type', type: 'string' },
      { key: 'm_Nodes', type: 'array' },
      { key: 'm_Connections', type: 'array' },
      { key: 'm_Variables', type: 'array' },
      { key: 'm_nNodeID', type: 'int' },
      { key: 'm_sNodeClass', type: 'string' },
      { key: 'm_sDescription', type: 'string' },
      { key: 'm_vPosition', type: 'vec2', hint: 'Graph editor node position' },
      { key: 'm_InputConnections', type: 'array' },
      { key: 'm_OutputConnections', type: 'array' },
      { key: 'm_sPortName', type: 'string' },
      { key: 'm_nSrcNodeID', type: 'int' },
      { key: 'm_nDstNodeID', type: 'int' }
    ],

    vdata: [
      { key: 'generic_data_type', type: 'string' },
      { key: 'm_DecalGroups', type: 'array' },
      { key: 'm_nDecalCount', type: 'int' },
      { key: 'm_DecalMaterials', type: 'array' },
      { key: 'm_Tags', type: 'array' },
      { key: 'm_sTag', type: 'string' },
      { key: 'm_nValue', type: 'int' },
      { key: 'm_sName', type: 'string' },
      { key: 'm_sDisplayName', type: 'string' }
    ],

    '*': [
      { key: 'generic_data_type', type: 'string', hint: 'Root KV3 type identifier' },
      { key: 'm_sName', type: 'string' },
      { key: 'm_bEnabled', type: 'bool' },
      { key: 'm_flWeight', type: 'float' },
      { key: 'm_vPosition', type: 'vec3' },
      { key: 'm_angRotation', type: 'vec3' },
      { key: 'm_vScale', type: 'vec3' },
      { key: 'm_Color', type: 'color' }
    ]
  };

  function _ext(fileName) {
    const m = /\.([a-z0-9]+)$/i.exec(fileName ?? '');
    return m ? m[1].toLowerCase() : '';
  }

  function _liveScan(root, maxDepth) {
    const depthLimit = maxDepth == null ? 4 : maxDepth;
    const seen = new Map();
    function walk(obj, depth) {
      if (depth > depthLimit || !obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) walk(item, depth + 1);
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (!seen.has(k)) {
          const t = Array.isArray(v)
            ? 'array'
            : v !== null && typeof v === 'object'
              ? 'object'
              : typeof v === 'boolean'
                ? 'bool'
                : typeof v === 'number'
                  ? Number.isInteger(v)
                    ? 'int'
                    : 'float'
                  : 'string';
          seen.set(k, t);
        }
        walk(v, depth + 1);
      }
    }
    walk(root, 0);
    return seen;
  }

  function getSuggestions(fileName, parentPath) {
    void parentPath;
    const ext = _ext(fileName);
    let staticList = SCHEMA[ext];
    if (!staticList || !staticList.length) {
      const root = typeof docManager !== 'undefined' ? docManager.activeDoc?.root : null;
      const rootType = root?.generic_data_type;
      if (rootType && SCHEMA[rootType] && SCHEMA[rootType].length) staticList = SCHEMA[rootType];
      else staticList = SCHEMA['*'] || [];
    }

    const liveMap = _liveScan(
      typeof docManager !== 'undefined' ? docManager.activeDoc?.root ?? {} : {},
      4
    );

    const result = staticList.slice();
    const staticKeys = new Set(staticList.map((s) => s.key));
    for (const [k, t] of liveMap) {
      if (!staticKeys.has(k)) result.push({ key: k, type: t, hint: 'Used in this document' });
    }

    return result;
  }

  return { getSuggestions };
})();

if (typeof window !== 'undefined') window.VDataSuggestions = VDataSuggestions;
