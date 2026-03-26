import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));

function injectSchemaDeps() {
  globalThis.window = globalThis;
  for (const rel of ['../src/performance-monitor.js', '../src/schema/schema-cache.js', '../src/schema/schema-db.js']) {
    const code = readFileSync(join(dir, rel), 'utf8');
    // eslint-disable-next-line no-eval
    eval(code);
  }
}

beforeEach(() => {
  globalThis.dispatchEvent = vi.fn();
  const store = {};
  globalThis.localStorage = {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k, v) {
      store[k] = String(v);
    }
  };
  delete globalThis.electronAPI;
  delete globalThis.SchemaDB;
  delete globalThis.VDataPerf;
  delete globalThis.VDataSchemaCache;
  injectSchemaDeps();
});

describe('SchemaDB', () => {
  it('typeToWidget maps CBitVecEnum to bitmaskEnum and CUtlVector to array', () => {
    const { SchemaDB } = globalThis;
    const bitVec = {
      category: 'atomic',
      name: 'CBitVecEnum',
      inner: { category: 'declared_enum', module: 'client', name: 'EMyFlags_t' }
    };
    const utlVec = {
      category: 'atomic',
      name: 'CUtlVector',
      inner: { category: 'declared_class', module: 'client', name: 'SomeStruct_t' }
    };
    expect(SchemaDB.typeToWidget(bitVec)).toBe('bitmaskEnum:client::EMyFlags_t');
    expect(SchemaDB.typeToWidget(utlVec)).toBe('array');
  });

  it('getEnumValuesForWidgetId resolves bitmaskEnum ids', () => {
    const { SchemaDB } = globalThis;
    SchemaDB.applySchemaPayload(
      {
        classes: [
          {
            name: 'BitMaskHost',
            fields: [
              {
                name: 'm_Flags',
                type: {
                  category: 'atomic',
                  name: 'CBitVecEnum',
                  inner: { category: 'declared_enum', module: 'test', name: 'EFlags_t' }
                }
              }
            ],
            metadata: []
          }
        ],
        enums: [
          {
            name: 'EFlags_t',
            module: 'test',
            members: [
              { name: 'FLAG_B', value: 2 },
              { name: 'FLAG_A', value: 1 }
            ]
          }
        ]
      },
      'cs2'
    );
    expect(SchemaDB.getEnumValuesForWidgetId('bitmaskEnum:test::EFlags_t')).toEqual(['FLAG_A', 'FLAG_B']);
    expect(SchemaDB.getEnumValuesForWidgetId('enum:test::EFlags_t')).toEqual(['FLAG_A', 'FLAG_B']);
  });

  it('applySchemaPayload rejects missing classes array', () => {
    const { SchemaDB } = globalThis;
    expect(() => SchemaDB.applySchemaPayload({ enums: [] }, 'cs2')).toThrow(/classes/);
  });

  it('failed load leaves empty class list (no stale game)', async () => {
    const { SchemaDB } = globalThis;
    SchemaDB.applySchemaPayload(
      { classes: [{ name: 'Stale', fields: [], metadata: [] }], enums: [] },
      'cs2'
    );
    expect(SchemaDB.listClassNames()).toContain('Stale');

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) })
      )
    );

    await expect(SchemaDB.load('deadlock', { forceRemote: true })).rejects.toThrow();

    expect(SchemaDB.isLoaded()).toBe(false);
    expect(SchemaDB.listClassNames().length).toBe(0);
  });
});
