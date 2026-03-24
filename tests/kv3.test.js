import { describe, it, expect } from 'vitest';
import KV3Format from '../format/kv3.js';

describe('KV3 format', () => {
  it('uses the default generic KV3 header', () => {
    const input = {
      generic_data_type: 'CSmartPropRoot',
      m_Children: [],
      m_Variables: []
    };

    const kv3 = KV3Format.jsonToKV3(input);
    expect(kv3.startsWith('<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->\n')).toBe(true);
  });

  it('uses modeldoc41 header for .vmdl output', () => {
    const input = { rootNode: { _class: 'RootNode' } };
    const kv3 = KV3Format.jsonToKV3(input, { fileName: 'test.vmdl' });
    expect(
      kv3.startsWith(
        '<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:modeldoc41:version{12fc9d44-453a-4ae4-b4d9-7e2ac0bbd4e0} -->\n'
      )
    ).toBe(true);
  });

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

  it('serializes heuristic resource paths and parses them as typed resource_name nodes', () => {
    const input = {
      model: 'models/props/test.vmdl',
      plain: 'hello'
    };

    const kv3 = KV3Format.jsonToKV3(input);

    expect(kv3).toContain('model = resource_name:"models/props/test.vmdl"');
    expect(kv3).toContain('plain = "hello"');

    const parsed = KV3Format.kv3ToJSON(kv3);
    expect(parsed.model).toEqual({ type: 'resource_name', value: 'models/props/test.vmdl' });
    expect(parsed.plain).toBe('hello');
  });

  it('round-trips explicit resource_name and soundevent typed values', () => {
    const obj = {
      model: { type: 'resource_name', value: 'weapons/foo.vmdl' },
      fire: { type: 'soundevent', value: 'c4.plant' }
    };

    const kv3 = KV3Format.jsonToKV3(obj);
    expect(kv3).toContain('model = resource_name:"weapons/foo.vmdl"');
    expect(kv3).toContain('fire = soundevent:"c4.plant"');

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

  it('quotes object keys in KV3 output when they are not identifier-like', () => {
    const obj = {
      plain_key: 1,
      'Dark (Thumbnail)': 'thumb',
      'Dark + Headlight': true
    };
    const kv3 = KV3Format.jsonToKV3(obj);
    expect(kv3).toContain('plain_key = 1');
    expect(kv3).toContain('"Dark (Thumbnail)" = "thumb"');
    expect(kv3).toContain('"Dark + Headlight" = true');
    expect(KV3Format.kv3ToJSON(kv3)).toEqual(obj);
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

  it('preserves detected KV3 header via parseKV3Document', () => {
    const text =
      '<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:modeldoc41:version{12fc9d44-453a-4ae4-b4d9-7e2ac0bbd4e0} -->\n' +
      '{ rootNode = { _class = "RootNode" } }';
    const parsed = KV3Format.parseKV3Document(text);
    expect(parsed.header).toContain('format:modeldoc41');
    expect(parsed.root).toEqual({ rootNode: { _class: 'RootNode' } });
  });

  it('serializes modeldoc41 with valve-like spacing and commas', () => {
    const obj = {
      rootNode: {
        _class: 'RootNode',
        children: [
          {
            _class: 'RenderMeshFile',
            import_scale: 1,
            import_filter: { exclude_by_default: false, exception_list: [] }
          }
        ]
      }
    };
    const kv3 = KV3Format.jsonToKV3(obj, { fileName: 'x.vmdl' });
    expect(kv3).toContain('\n\trootNode = \n\t{');
    expect(kv3).toContain('children = \n\t\t[');
    expect(kv3).toContain('import_scale = 1.0');
    expect(kv3).toContain('exception_list = [  ]');
    expect(kv3).toContain('\n\t\t\t},\n');
  });

  it('parses and preserves line comments inside arrays', () => {
    const text = `{
  list = [
    // enabled
    "a",
    //"b",
  ]
}`;
    const parsed = KV3Format.kv3ToJSON(text);
    expect(Array.isArray(parsed.list)).toBe(true);
    expect(parsed.list.length).toBe(3);
    expect(KV3Format.isKV3LineCommentNode(parsed.list[0])).toBe(true);
    expect(parsed.list[0].text).toContain(' enabled');
    expect(KV3Format.isKV3LineCommentNode(parsed.list[2])).toBe(true);

    const out = KV3Format.jsonToKV3(parsed);
    expect(out).toContain('// enabled');
    expect(out).toContain('//"b",');
  });
});

