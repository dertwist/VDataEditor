import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));

function injectModes() {
  const code = readFileSync(join(dir, '../src/modes/index.js'), 'utf8');
  const fn = new Function(
    'globalThis',
    `
    var self = globalThis;
    var window = globalThis;
    var module = undefined;
    var document = { getElementById: function () { return null; } };
    ${code}
  `
  );
  fn(globalThis);
}

beforeEach(() => {
  injectModes();
});

describe('VDataEditorModes.getSuggestionContext', () => {
  it('uses root._class when generic_data_type is absent', () => {
    const { VDataEditorModes } = globalThis;
    const ctx = VDataEditorModes.getSuggestionContext('foo.txt', { _class: 'CitadelAbilityVData' });
    expect(ctx.genericDataType).toBe('CitadelAbilityVData');
  });

  it('prefers generic_data_type over _class when both exist', () => {
    const { VDataEditorModes } = globalThis;
    const ctx = VDataEditorModes.getSuggestionContext('foo.txt', {
      generic_data_type: 'TypeA',
      _class: 'TypeB'
    });
    expect(ctx.genericDataType).toBe('TypeA');
  });
});
