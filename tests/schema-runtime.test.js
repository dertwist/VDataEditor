import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));

function injectSchemaStack() {
  for (const rel of [
    '../src/schema/schema-cache.js',
    '../src/schema/schema-db.js',
    '../src/modes/runtime-schema-fetcher.js'
  ]) {
    const code = readFileSync(join(dir, rel), 'utf8');
    // eslint-disable-next-line no-eval
    eval(code);
  }
}

function storage() {
  const store = {};
  return {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k, v) {
      store[k] = String(v);
    }
  };
}

function tinySchemaPayload() {
  return {
    revision: 'test-rev',
    classes: [
      {
        name: 'CFoo',
        fields: [
          {
            name: 'm_Bar',
            type: { category: 'declared_enum', name: 'EMy', module: 'mod' }
          },
          { name: 'm_N', type: { category: 'builtin', name: 'float32' } }
        ],
        metadata: []
      }
    ],
    enums: [
      {
        name: 'EMy',
        module: 'mod',
        members: [
          { name: 'A', value: 0 },
          { name: 'B', value: 1 }
        ]
      }
    ]
  };
}

function syntheticLargePayload(nClasses, nFields) {
  const classes = [];
  for (let c = 0; c < nClasses; c++) {
    const fields = [];
    for (let f = 0; f < nFields; f++) {
      fields.push({
        name: 'm_Field' + f,
        type: { category: 'builtin', name: 'int32' }
      });
    }
    classes.push({ name: 'CStress' + c, fields, metadata: [] });
  }
  return { revision: 'stress', classes, enums: [] };
}

beforeEach(() => {
  globalThis.window = globalThis;
  globalThis.localStorage = storage();
  globalThis.dispatchEvent = vi.fn();
  delete globalThis.SchemaDB;
  delete globalThis.VDataSchemaRuntime;
  delete globalThis.VDataSchemaCache;
  delete globalThis.electronAPI;
  injectSchemaStack();
});

describe('schema runtime (SchemaDB + bucket build)', () => {
  it('builds buckets with lazy enumWidgetId after load', async () => {
    const payload = tinySchemaPayload();
    globalThis.localStorage.setItem('vdata_schema_bundle_game', 'deadlock');
    globalThis.electronAPI = {
      readSchemaBundle: vi.fn(() =>
        Promise.resolve({ ok: true, jsonText: JSON.stringify(payload) })
      )
    };

    const steps = [];
    const buckets = await globalThis.VDataSchemaRuntime.loadSchemasRuntime({
      onProgress(msg, pct) {
        steps.push({ msg, pct });
      }
    });

    expect(globalThis.SchemaDB.isLoaded()).toBe(true);
    expect(buckets['type:CFoo'].keys.m_Bar).toMatchObject({
      type: 'string',
      widget: 'string',
      enum: [],
      enumWidgetId: 'enum:mod::EMy'
    });
    expect(globalThis.SchemaDB.getEnumValuesForWidgetId('enum:mod::EMy')).toEqual(['A', 'B']);
    expect(steps.some((s) => s.pct === 100 && String(s.msg).includes('Schema'))).toBe(true);
  });

  it('infers enumWidgetId from SmartProp attribute custom editor metadata', async () => {
    const payload = {
      revision: 'test-rev',
      classes: [
        {
          name: 'CParent',
          fields: [
            {
              name: 'm_nPickMode',
              // SmartProp fields are declared_class types (attribute classes),
              // but the actual enum members are defined via MPropertyCustomEditor
              // on the attribute class itself.
              type: {
                category: 'declared_class',
                module: 'smartprops',
                name: 'CSmartPropAttributePickMode'
              }
            }
          ],
          metadata: []
        },
        {
          name: 'CSmartPropAttributePickMode',
          module: 'smartprops',
          fields: [],
          metadata: [
            {
              name: 'MPropertyCustomEditor',
              value: '"SmartPropAttributeEditor(enum:PickMode_t)"'
            }
          ]
        }
      ],
      enums: [
        {
          name: 'PickMode_t',
          module: 'smartprops',
          members: [
            { name: 'LARGEST_FIRST', value: 0 },
            { name: 'RANDOM', value: 1 },
            { name: 'ALL_IN_ORDER', value: 2 }
          ]
        }
      ]
    };

    globalThis.localStorage.setItem('vdata_schema_bundle_game', 'deadlock');
    globalThis.electronAPI = {
      readSchemaBundle: vi.fn(() =>
        Promise.resolve({ ok: true, jsonText: JSON.stringify(payload) })
      )
    };

    const buckets = await globalThis.VDataSchemaRuntime.loadSchemasRuntime();
    expect(buckets['type:CParent'].keys.m_nPickMode).toMatchObject({
      type: 'string',
      widget: 'string',
      enum: [],
      enumWidgetId: 'enum:PickMode_t'
    });
    expect(globalThis.SchemaDB.getEnumValuesForWidgetId('enum:PickMode_t')).toEqual([
      'LARGEST_FIRST',
      'RANDOM',
      'ALL_IN_ORDER'
    ]);
  });

  it('reports merge phase and reaches 100% for a large synthetic schema', async () => {
    const payload = syntheticLargePayload(320, 140);
    globalThis.localStorage.setItem('vdata_schema_bundle_game', 'deadlock');
    globalThis.electronAPI = {
      readSchemaBundle: vi.fn(() =>
        Promise.resolve({ ok: true, jsonText: JSON.stringify(payload) })
      )
    };

    const steps = [];
    await globalThis.VDataSchemaRuntime.loadSchemasRuntime({
      onProgress(msg, pct) {
        steps.push({ msg, pct });
      }
    });

    expect(steps.some((s) => String(s.msg).includes('Merging global'))).toBe(true);
    expect(steps.some((s) => s.pct >= 75)).toBe(true);
    expect(steps.some((s) => s.pct === 100)).toBe(true);
  }, 120000);

  it('memoizes KV3 defaults on class objects (parseClassDefaults)', () => {
    const payload = {
      revision: 'd',
      classes: [
        {
          name: 'CDefaults',
          fields: [{ name: 'x', type: { category: 'builtin', name: 'int32' } }],
          metadata: [{ name: 'MGetKV3ClassDefaults', value: '{"x":1}' }]
        }
      ],
      enums: []
    };
    globalThis.SchemaDB.applySchemaPayload(payload, 'cs2');
    const a = globalThis.SchemaDB.getFields('CDefaults');
    const b = globalThis.SchemaDB.getFields('CDefaults');
    expect(a[0].defaultValue).toBe(1);
    expect(b[0].defaultValue).toBe(1);
  });
});
