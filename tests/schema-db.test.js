import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));

function injectSchemaDb() {
  globalThis.window = globalThis;
  const code = readFileSync(join(dir, '../src/schema/schema-db.js'), 'utf8');
  // eslint-disable-next-line no-eval
  eval(code);
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
  injectSchemaDb();
});

describe('SchemaDB', () => {
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
