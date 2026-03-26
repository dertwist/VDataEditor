import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));

function injectWidgetSettings() {
  const code =
    readFileSync(join(dir, '../src/settings/system-config.js'), 'utf8') +
    readFileSync(join(dir, '../src/settings/widget-config.js'), 'utf8');
  const fn = new Function(
    'globalThis',
    `
    var self = globalThis;
    var module = undefined;
    ${code}
  `
  );
  fn(globalThis);
}

beforeEach(() => {
  globalThis.localStorage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn()
  };
  injectWidgetSettings();
});

describe('VDataSettings.resolveWidgetType', () => {
  it('does not map m_vec* key to vec3 when value is an array (CUtlVector / JSON list)', () => {
    const { VDataSettings } = globalThis;
    expect(VDataSettings.resolveWidgetType('m_vecAbilityUpgrades', 'array')).toBe('array');
  });

  it('still maps m_vSpatial to vec3 for non-array inferred types', () => {
    const { VDataSettings } = globalThis;
    expect(VDataSettings.resolveWidgetType('m_vPos', 'vec3')).toBe('vec3');
  });
});
