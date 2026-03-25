import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  new Function('globalThis', readFileSync(join(dir, '../src/model/path-utils.js'), 'utf8'))(globalThis);
  new Function('globalThis', readFileSync(join(dir, '../src/commands.js'), 'utf8'))(globalThis);
  new Function('globalThis', readFileSync(join(dir, '../src/document.js'), 'utf8'))(globalThis);
});

describe('VDataDocument typed undo/redo with path sets', () => {
  it('undo/redo restore root and expandedPaths/collapsedPaths via ROOT_STATE_PAIR', () => {
    const VC = globalThis.VDataCommands;
    const CMD = VC.CMD;
    const d = new globalThis.VDataDocument({
      root: { k: 1 },
      format: 'kv3'
    });
    d.expandedPaths = new Set(['openBranch']);
    d.collapsedPaths = new Set(['closedBranch']);

    const root0 = JSON.parse(JSON.stringify(d.root));
    const ex0 = [...d.expandedPaths];
    const col0 = [...d.collapsedPaths];

    d.root = { ...d.root, added: 'x' };
    d.expandedPaths.add('newNode');
    d.collapsedPaths.delete('closedBranch');

    const root1 = JSON.parse(JSON.stringify(d.root));
    const ex1 = [...d.expandedPaths];
    const col1 = [...d.collapsedPaths];

    const cmd = {
      type: CMD.ROOT_STATE_PAIR,
      rootBefore: root0,
      rootAfter: root1,
      formatBefore: 'kv3',
      formatAfter: 'kv3',
      expandedBefore: ex0,
      expandedAfter: ex1,
      collapsedBefore: col0,
      collapsedAfter: col1
    };

    d.pushUndo({ cmd, label: 'Test', time: Date.now() });

    const rUndo = d.undo();
    expect(rUndo).not.toBeNull();
    expect(d.root).toEqual({ k: 1 });
    expect(d.expandedPaths.has('newNode')).toBe(false);
    expect(d.expandedPaths.has('openBranch')).toBe(true);
    expect(d.collapsedPaths.has('closedBranch')).toBe(true);

    const rRedo = d.redo();
    expect(rRedo).not.toBeNull();
    expect(d.root).toEqual({ k: 1, added: 'x' });
    expect(d.expandedPaths.has('newNode')).toBe(true);
    expect(d.collapsedPaths.has('closedBranch')).toBe(false);
  });

  it('SET_VALUE push + undo round trip', () => {
    const VC = globalThis.VDataCommands;
    const d = new globalThis.VDataDocument({ root: { n: 5 } });
    const cmd = VC.setValueCommand('n', 5, 42);
    VC.applyCommand(d, cmd);
    d.pushUndo({ cmd, label: 'Edit', time: Date.now() });
    expect(d.root.n).toBe(42);
    d.undo();
    expect(d.root.n).toBe(5);
    d.redo();
    expect(d.root.n).toBe(42);
  });
});
