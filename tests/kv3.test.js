import { describe, it, expect } from 'vitest';
import KV3Format from '../format/kv3.js';

describe('KV3 format', () => {
  it('round trips a simple object', () => {
    const input = {
      generic_data_type: 'CSmartPropRoot',
      m_Children: [],
      m_Variables: []
    };

    const kv3 = KV3Format.jsonToKV3(input);
    const parsed = KV3Format.kv3ToJSON(kv3);

    expect(parsed.generic_data_type).toBe('CSmartPropRoot');
    expect(parsed.m_Children).toEqual([]);
    expect(parsed.m_Variables).toEqual([]);
  });

  it('treats header as optional', () => {
    const body = '{ generic_data_type = "CSmartPropRoot" }';
    const withHeader =
      '<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} -->\n' +
      body;

    const parsed1 = KV3Format.kv3ToJSON(withHeader);
    const parsed2 = KV3Format.kv3ToJSON(body);

    expect(parsed1.generic_data_type).toBe('CSmartPropRoot');
    expect(parsed2.generic_data_type).toBe('CSmartPropRoot');
  });

  it('handles resource_name strings', () => {
    const obj = {
      model: 'models/props/test.vmdl',
      plain: 'hello'
    };

    const kv3 = KV3Format.jsonToKV3(obj);

    expect(kv3).toContain('model = resource_name:"models/props/test.vmdl"');
    expect(kv3).toContain('plain = "hello"');

    const parsed = KV3Format.kv3ToJSON(kv3);
    expect(parsed).toEqual(obj);
  });

  it('serializes numeric arrays inline', () => {
    const obj = {
      position: [1, 2, 3]
    };
    const kv3 = KV3Format.jsonToKV3(obj);
    expect(kv3).toContain('position = [1, 2, 3]');

    const parsed = KV3Format.kv3ToJSON(kv3);
    expect(parsed.position).toEqual([1, 2, 3]);
  });

  it('handles comments and whitespace', () => {
    const text = `
<!-- kv3 encoding:text -->
{
  // single line comment
  enabled = true
  count = 42 // trailing comment
}
`;
    const parsed = KV3Format.kv3ToJSON(text);
    expect(parsed.enabled).toBe(true);
    expect(parsed.count).toBe(42);
  });
});

