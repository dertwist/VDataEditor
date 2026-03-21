import { describe, it, expect } from 'vitest';
import { KV3Node, KV3Type } from '../src/model/kv3-node.js';

describe('KV3Node', () => {
  it('stores key and optional meta fields', () => {
    const n = new KV3Node('m_Foo', 1, {
      valueType: KV3Type.INT,
      typedPrefix: null,
      metaClass: 'C_OP_Test',
      metaBase: 'Base.Name'
    });
    expect(n.key).toBe('m_Foo');
    expect(n.value).toBe(1);
    expect(n.valueType).toBe(KV3Type.INT);
    expect(n.metaClass).toBe('C_OP_Test');
    expect(n.metaBase).toBe('Base.Name');
  });
});
