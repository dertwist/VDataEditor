import { describe, it, expect } from 'vitest';
import KeyValueFormat from '../format/keyvalue.js';

const sample = `// THIS FILE IS AUTO-GENERATED

Layer0
{
	shader "generic.vfx"
	F_TRANSLUCENT 1
	g_vColorTint "[1.000000 1.000000 1.000000 0.000000]"
	TextureColor "materials/radgen/radgen_tint.tga"
	Attributes
	{
		tools.toolsmaterial "1"
		mapbuilder.nodraw "1"
	}
	UnusedVariables
	{
		"g_flAlphaTestReference" "0.5"
		Texture2Color ""
	}
}
`;

describe('Valve KeyValues (.vmat-style)', () => {
  it('parses nested blocks, comments, and quoted keys', () => {
    const o = KeyValueFormat.keyValueToJSON(sample);
    expect(o.Layer0).toBeDefined();
    expect(o.Layer0.shader).toBe('generic.vfx');
    expect(o.Layer0.F_TRANSLUCENT).toBe(1);
    expect(o.Layer0.TextureColor).toBe('materials/radgen/radgen_tint.tga');
    expect(o.Layer0.Attributes['tools.toolsmaterial']).toBe(1);
    expect(o.Layer0.UnusedVariables['g_flAlphaTestReference']).toBe(0.5);
    expect(o.Layer0.UnusedVariables.Texture2Color).toBe('');
  });

  it('round-trips structure and scalar coercion', () => {
    const o = KeyValueFormat.keyValueToJSON(sample);
    const text = KeyValueFormat.jsonToKeyValue(o);
    const again = KeyValueFormat.keyValueToJSON(text);
    expect(again).toEqual(o);
  });
});
