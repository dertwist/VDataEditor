import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import KV3Format from '../format/kv3.js';
import KeyValueFormat from '../format/keyvalue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, '..', 'examples');

/** Mirrors `parseDocumentContent` in `src/parse-utils.js` (that file is browser-global, not ESM). */
function parseDocumentContent(text, hintFileName) {
  const ext = fileExtension(hintFileName);
  if (ext === 'vmat' || ext === 'vmt') return { root: KeyValueFormat.keyValueToJSON(text), format: 'keyvalue' };
  if (ext === 'json') return { root: JSON.parse(text), format: 'json' };
  return { root: KV3Format.kv3ToJSON(text), format: 'kv3' };
}

function fileExtension(name) {
  if (!name || typeof name !== 'string') return '';
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

const exampleNames = readdirSync(examplesDir)
  .filter((f) => !f.startsWith('.') && !f.endsWith('.md'))
  .sort();

describe('examples corpus', () => {
  it('includes every file under examples/', () => {
    expect(exampleNames.length).toBeGreaterThan(0);
  });

  for (const name of exampleNames) {
    const large = name.includes('mixgraph');
    it(
      `parses ${name}`,
      { timeout: large ? 120_000 : 30_000 },
      () => {
        const text = readFileSync(join(examplesDir, name), 'utf8');
        const { root, format } = parseDocumentContent(text, name);
        expect(format).toMatch(/^(kv3|json|keyvalue)$/);
        expect(root).toBeDefined();
        expect(root).not.toBe(null);
        expect(typeof root).toBe('object');
      }
    );
  }
});
