// Maps file extension + document shape to a widget profile id (property panel dispatch).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VDataFormats = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const PROFILES = {
    'generic/*': { id: 'generic/*', label: 'Generic KV3' },
    'generic/CSmartPropRoot': { id: 'generic/CSmartPropRoot', label: 'Smart Prop' },
    'generic/light_styles': { id: 'generic/light_styles', label: 'Light styles' },
    'generic/CToolSceneLightRig': { id: 'generic/CToolSceneLightRig', label: 'Tool scene light rig' },
    'generic/prop_data': { id: 'generic/prop_data', label: 'Prop data' },
    'generic/CBasePlayerWeaponVData': { id: 'generic/CBasePlayerWeaponVData', label: 'Weapon VData' },
    'vpcf54/CParticleSystemDefinition': { id: 'vpcf54/CParticleSystemDefinition', label: 'Particle system' },
    'vpcf54/*': { id: 'vpcf54/*', label: 'Particle (vpcf)' }
  };

  function normalizeExt(extension) {
    if (!extension) return '';
    const s = String(extension);
    return s.replace(/^\./, '').toLowerCase();
  }

  function getFormatProfileKey(doc, extension) {
    const ext = normalizeExt(extension);
    if (ext === 'vpcf') {
      const cls = doc && doc._class;
      if (typeof cls === 'string' && cls.length) return `vpcf54/${cls}`;
      return 'vpcf54/*';
    }
    const gdt = doc && doc.generic_data_type;
    if (typeof gdt === 'string' && gdt.length) return `generic/${gdt}`;
    return 'generic/*';
  }

  function getProfile(doc, extension) {
    const key = getFormatProfileKey(doc, extension);
    return PROFILES[key] || (extIsVpcf(extension) ? PROFILES['vpcf54/*'] : PROFILES['generic/*']);
  }

  function extIsVpcf(extension) {
    return normalizeExt(extension) === 'vpcf';
  }

  return { getFormatProfileKey, getProfile, PROFILES };
});
