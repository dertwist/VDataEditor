import { describe, it, expect } from 'vitest';
import { KV3Document } from '../src/model/kv3-document.js';

describe('KV3Document', () => {
  it('createSmartPropDefault exposes a mutable root', () => {
    const d = KV3Document.createSmartPropDefault();
    expect(d.getRoot().generic_data_type).toBe('CSmartPropRoot');
    d.setRoot({ generic_data_type: 'other', x: 1 });
    expect(d.getRoot().generic_data_type).toBe('other');
    expect(d.dirty).toBe(true);
  });
});
