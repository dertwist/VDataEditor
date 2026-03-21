import { describe, it, expect } from 'vitest';
import formats from '../src/formats/registry.js';

describe('format registry', () => {
  it('resolves CSmartPropRoot profile from generic_data_type', () => {
    const doc = { generic_data_type: 'CSmartPropRoot' };
    expect(formats.getFormatProfileKey(doc, 'vsmart')).toBe('generic/CSmartPropRoot');
    expect(formats.getProfile(doc, 'vsmart').id).toBe('generic/CSmartPropRoot');
  });

  it('resolves vpcf by _class', () => {
    const doc = { _class: 'CParticleSystemDefinition' };
    expect(formats.getFormatProfileKey(doc, 'vpcf')).toBe('vpcf54/CParticleSystemDefinition');
    expect(formats.getProfile(doc, 'vpcf').id).toBe('vpcf54/CParticleSystemDefinition');
  });

  it('falls back for unknown generic_data_type', () => {
    const doc = { generic_data_type: 'UnknownThing' };
    expect(formats.getFormatProfileKey(doc, 'vdata')).toBe('generic/UnknownThing');
    expect(formats.getProfile(doc, 'vdata').id).toBe('generic/*');
  });
});
