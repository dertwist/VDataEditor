import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  // Load browser-style script into the test global scope.
  new Function('globalThis', readFileSync(join(dir, '../src/widgets/kv3-shape-utils.js'), 'utf8'))(
    globalThis
  );
});

describe('VDataKV3ShapeUtils', () => {
  let utils;
  beforeAll(() => {
    utils = globalThis.VDataKV3ShapeUtils;
  });

  it('isEnumLikeValue: accepts screaming snake case', () => {
    expect(utils.isEnumLikeValue('CURVE_TANGENT_SPLINE')).toBe(true);
    expect(utils.isEnumLikeValue('PARTICLE_BLEND_ADD')).toBe(true);
    expect(utils.isEnumLikeValue('FIELD_RADIUS')).toBe(true);
    expect(utils.isEnumLikeValue('PATTACH_WORLDORIGIN')).toBe(true);
    expect(utils.isEnumLikeValue('PATTACH_POINT1')).toBe(true);
    expect(utils.isEnumLikeValue('FIELD_RADIUS_1')).toBe(true);
  });

  it('isEnumLikeValue: rejects non-enums', () => {
    expect(utils.isEnumLikeValue('0')).toBe(false);
    expect(utils.isEnumLikeValue('hello world')).toBe(false);
    expect(utils.isEnumLikeValue('e_SWITCH_4wayRoll_ON/OFF')).toBe(false);
    expect(utils.isEnumLikeValue('SINGLEWORD')).toBe(false);
    expect(utils.isEnumLikeValue('')).toBe(false);
  });

  it('getVectorLabels: color/domain/uv/rotation rules', () => {
    expect(utils.getVectorLabels('m_color', 4)).toEqual(['R', 'G', 'B', 'A']);
    expect(utils.getVectorLabels('m_ColorTint', 3)).toEqual(['R', 'G', 'B']);

    expect(utils.getVectorLabels('m_vDomainMins', 2)).toEqual(['Min', 'Max']);
    expect(utils.getVectorLabels('m_vOrigin', 3)).toEqual(['X', 'Y', 'Z']);

    expect(utils.getVectorLabels('m_vAngles', 3)).toEqual(['Pitch', 'Yaw', 'Roll']);
    expect(utils.getVectorLabels('m_UVCoord', 2)).toEqual(['U', 'V']);
  });

  it('classifyNumericVectorArray: maps numeric arrays to widgets', () => {
    expect(utils.classifyNumericVectorArray('m_vDomainMins', [0, 0])).toBe('vec2');
    expect(utils.classifyNumericVectorArray('m_vOrigin', [0, 0, 0])).toBe('vec3');
    expect(utils.classifyNumericVectorArray('m_vOrigin', [0, 0, 0, 0])).toBe('vec4');

    expect(utils.classifyNumericVectorArray('m_color', [255, 0, 0, 255])).toBe('color');
    expect(utils.classifyNumericVectorArray('m_flValues', [0, 0, 0, 0])).toBe('vec4');

    expect(utils.classifyNumericVectorArray('m_flValues', [0, 0, 0, 0, 0])).toBe(null);
  });

  it('harvestEnumValues: harvests from scalar fields/arrays/structs', () => {
    const root = {
      m_nIncomingTangent: 'CURVE_TANGENT_SPLINE',
      m_flags: ['FIELD_RADIUS', 'FIELD_RADIUS', 'not_enum'],
      m_items: [
        { m_nField: 'CURVE_TANGENT_SPLINE', m_other: 'x' },
        { m_nField: 'PARTICLE_BLEND_ADD', m_other: 'y' }
      ]
    };

    expect(utils.harvestEnumValues(root, 'm_nIncomingTangent')).toEqual(['CURVE_TANGENT_SPLINE']);
    expect(utils.harvestEnumValues(root, 'm_flags')).toEqual(['FIELD_RADIUS']);
    expect(utils.harvestEnumValues(root, 'm_nField')).toEqual([
      'CURVE_TANGENT_SPLINE',
      'PARTICLE_BLEND_ADD'
    ]);
  });
});

