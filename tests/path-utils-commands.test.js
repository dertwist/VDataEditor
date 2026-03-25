import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  const pu = readFileSync(join(dir, '../src/model/path-utils.js'), 'utf8');
  const cmd = readFileSync(join(dir, '../src/commands.js'), 'utf8');
  new Function('globalThis', pu)(globalThis);
  new Function('globalThis', cmd)(globalThis);
});

describe('VDataPathUtils', () => {
  it('getAtPath and setAtPath', () => {
    const P = globalThis.VDataPathUtils;
    const root = { a: { b: 3 } };
    expect(P.getAtPath(root, 'a/b')).toBe(3);
    const prev = P.setAtPath(root, 'a/b', 9);
    expect(prev).toBe(3);
    expect(P.getAtPath(root, 'a/b')).toBe(9);
  });

  it('array segments', () => {
    const P = globalThis.VDataPathUtils;
    const root = { items: [{ x: 1 }, { x: 2 }] };
    expect(P.getAtPath(root, 'items/[1]/x')).toBe(2);
    P.setAtPath(root, 'items/[0]/x', 7);
    expect(root.items[0].x).toBe(7);
  });

  it('deleteAtPath', () => {
    const P = globalThis.VDataPathUtils;
    const root = { a: { b: 1, c: 2 } };
    const r = P.deleteAtPath(root, 'a/b');
    expect(r).toBe(1);
    expect(root.a.c).toBe(2);
    expect('b' in root.a).toBe(false);
  });
});

describe('VDataCommands', () => {
  function makeDoc(root) {
    return {
      root,
      format: 'kv3',
      expandedPaths: new Set(),
      collapsedPaths: new Set(),
      structVersion: 0,
      recalcElementIds() {}
    };
  }

  it('SET_VALUE apply and invert', () => {
    const VC = globalThis.VDataCommands;
    const doc = makeDoc({ k: 1 });
    const cmd = VC.setValueCommand('k', 1, 2);
    VC.applyCommand(doc, cmd);
    expect(doc.root.k).toBe(2);
    const inv = VC.invertCommand(cmd);
    VC.applyCommand(doc, inv);
    expect(doc.root.k).toBe(1);
  });

  it('BATCH invert order', () => {
    const VC = globalThis.VDataCommands;
    const doc = makeDoc({ a: 1, b: 2 });
    const batch = {
      type: VC.CMD.BATCH,
      commands: [VC.setValueCommand('a', 1, 10), VC.setValueCommand('b', 2, 20)]
    };
    VC.applyCommand(doc, batch);
    expect(doc.root).toEqual({ a: 10, b: 20 });
    const inv = VC.invertCommand(batch);
    VC.applyCommand(doc, inv);
    expect(doc.root).toEqual({ a: 1, b: 2 });
  });

  it('canCoalesceSetValue respects path and relayout', () => {
    const VC = globalThis.VDataCommands;
    const top = { cmd: VC.setValueCommand('p', 0, 1), time: 1000 };
    const next = { cmd: VC.setValueCommand('p', 1, 2), time: 1200 };
    expect(VC.canCoalesceSetValue(top, next, 500)).toBe(true);
    const otherPath = { cmd: VC.setValueCommand('q', 0, 1), time: 1200 };
    expect(VC.canCoalesceSetValue(top, otherPath, 500)).toBe(false);
    const rel = { cmd: VC.setValueCommand('p', 0, 1, true), time: 1200 };
    expect(VC.canCoalesceSetValue(top, rel, 500)).toBe(false);
  });
});
