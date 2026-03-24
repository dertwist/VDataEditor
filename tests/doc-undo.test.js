import { describe, it, expect } from 'vitest';

/**
 * Mirrors VDataDocument undo/redo + path-set restoration used by withDocUndo.
 */
class UndoTestDoc {
  constructor() {
    this.root = { k: 1 };
    this.format = 'kv3';
    this.undoStack = [];
    this.redoStack = [];
    this.expandedPaths = new Set(['openBranch']);
    this.collapsedPaths = new Set(['closedBranch']);
  }

  pushUndo(cmd) {
    this.undoStack.push({ ...cmd, time: cmd.time ?? Date.now() });
    this.redoStack.length = 0;
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this.redoStack.push(cmd);
    return cmd;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.redo();
    this.undoStack.push(cmd);
    return cmd;
  }
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function simulateWithDocUndoStructural(d, applyFn) {
  const prev = deepClone(d.root);
  const prevFormat = d.format;
  const prevEx = new Set(d.expandedPaths);
  const prevCol = new Set(d.collapsedPaths);
  applyFn();
  const next = deepClone(d.root);
  const nextFormat = d.format;
  const nextEx = new Set(d.expandedPaths);
  const nextCol = new Set(d.collapsedPaths);
  d.pushUndo({
    label: 'Test',
    undo: () => {
      d.format = prevFormat;
      d.root = deepClone(prev);
      d.expandedPaths = new Set(prevEx);
      d.collapsedPaths = new Set(prevCol);
    },
    redo: () => {
      d.format = nextFormat;
      d.root = deepClone(next);
      d.expandedPaths = new Set(nextEx);
      d.collapsedPaths = new Set(nextCol);
    }
  });
}

describe('document undo/redo with path sets', () => {
  it('redo restores root and expandedPaths/collapsedPaths after add-key undo', () => {
    const d = new UndoTestDoc();
    simulateWithDocUndoStructural(d, () => {
      d.root.added = 'x';
      d.expandedPaths.add('newNode');
      d.collapsedPaths.delete('closedBranch');
    });

    expect(d.root.added).toBe('x');
    expect(d.expandedPaths.has('newNode')).toBe(true);

    d.undo();
    expect(d.root.added).toBeUndefined();
    expect(d.expandedPaths.has('newNode')).toBe(false);
    expect(d.expandedPaths.has('openBranch')).toBe(true);
    expect(d.collapsedPaths.has('closedBranch')).toBe(true);

    d.redo();
    expect(d.root.added).toBe('x');
    expect(d.expandedPaths.has('newNode')).toBe(true);
    expect(d.collapsedPaths.has('closedBranch')).toBe(false);
  });
});
