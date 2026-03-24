import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import KV3Format from '../format/kv3.js';
import KeyValueFormat from '../format/keyvalue.js';
import { expectSemanticKv3RoundTrip } from './kv3-semantic-equal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, '..', 'examples');

/**
 * Mirrors `parseDocumentContent` in `src/parse-utils.js` (that file is browser-global, not ESM).
 * Uses the same KV3 entry point so examples exercise `parseKV3Document` + filename header fallback.
 */
function parseDocumentContent(text, hintFileName) {
  const ext = fileExtension(hintFileName);
  if (ext === 'vmat' || ext === 'vmt') return { root: KeyValueFormat.keyValueToJSON(text), format: 'keyvalue' };
  if (ext === 'json') return { root: JSON.parse(text), format: 'json' };
  const parsed = KV3Format.parseKV3Document(text);
  return {
    root: parsed.root,
    format: 'kv3',
    kv3Header: parsed.header || KV3Format.detectKV3HeaderFromFileName(hintFileName)
  };
}

function fileExtension(name) {
  if (!name || typeof name !== 'string') return '';
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

const exampleNames = readdirSync(examplesDir)
  .filter((f) => !f.startsWith('.') && !f.endsWith('.md'))
  .sort();

/**
 * Round-trip: parse → jsonToKV3 → parse plus semantic tree compare is expensive on big models
 * (100KB+ .vmdl / .vsurf can take minutes). Default suite keeps examples under ~100KB only.
 * Parse-only: skip multi-MB dumps and anything above MAX_DEFAULT_PARSE_BYTES (mixgraph.vmix, etc.).
 *
 * Full coverage: `VDATA_FULL_EXAMPLES=1 npm test` (or run only tests/examples-corpus.test.js).
 */
const MAX_KV3_ROUNDTRIP_BYTES = 100_000;
const SKIP_ROUNDTRIP_NAME = /^(abilities|heroes|mixgraph)\./i;

/** Skip example round-trip for large compiled models; keep only tiny `1.vmdl` as smoke. */
function skipExampleRoundTripByName(name, size) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.vmdl') && lower !== '1.vmdl') return true;
  return size > MAX_KV3_ROUNDTRIP_BYTES;
}

/** Default parse budget: skip very large Valve dumps and anything above this size (e.g. mixgraph.vmix). */
const MAX_DEFAULT_PARSE_BYTES = 350_000;
const ALWAYS_SLOW_PARSE = /^(abilities|heroes)\.vdata$/i;

const runFullExampleParses = process.env.VDATA_FULL_EXAMPLES === '1';

describe('examples corpus', () => {
  it('includes every file under examples/', () => {
    expect(exampleNames.length).toBeGreaterThan(0);
  });

  for (const name of exampleNames) {
    const fullPath = join(examplesDir, name);
    const { size } = statSync(fullPath);

    const skipParse =
      !runFullExampleParses &&
      (ALWAYS_SLOW_PARSE.test(name) || size > MAX_DEFAULT_PARSE_BYTES);

    if (skipParse) {
      it.skip(`parses ${name} (slow/large: ${size} bytes — set VDATA_FULL_EXAMPLES=1 to run)`, () => {});
      continue;
    }

    const timeout = size > 200_000 ? 120_000 : 30_000;
    it(
      `parses ${name}`,
      { timeout },
      () => {
        const text = readFileSync(fullPath, 'utf8');
        const parsed = parseDocumentContent(text, name);
        const { root, format } = parsed;
        expect(format).toMatch(/^(kv3|json|keyvalue)$/);
        expect(root).toBeDefined();
        expect(root).not.toBe(null);
        expect(typeof root).toBe('object');
        if (format === 'kv3') {
          expect(typeof parsed.kv3Header).toBe('string');
          expect(parsed.kv3Header.length).toBeGreaterThan(0);
        }
      }
    );
  }
});

describe('examples corpus — comments.kv3 parse guard', () => {
  it(
    'parses comments.kv3 quickly (block comments regression)',
    { timeout: 5000 },
    () => {
      const file = join(examplesDir, 'comments.kv3');
      expect(existsSync(file), 'examples/comments.kv3 missing').toBe(true);
      const text = readFileSync(file, 'utf8');
      const parsed = KV3Format.parseKV3Document(text);
      expect(parsed.root).toBeDefined();
      expect(parsed.root.generic_data_type).toBe('CitadelAbilityVData');
    }
  );
});

describe('examples corpus KV3 round-trip (parse → serialize → parse)', () => {
  for (const name of exampleNames) {
    if (SKIP_ROUNDTRIP_NAME.test(name)) continue;
    const fullPath = join(examplesDir, name);
    const { size } = statSync(fullPath);
    if (!runFullExampleParses && skipExampleRoundTripByName(name, size)) continue;
    if (runFullExampleParses && size > 1_500_000) continue; /* abilities-scale: opt out even in "full" */
    const ext = fileExtension(name);
    if (ext === 'vmat' || ext === 'vmt' || ext === 'json') continue;

    const large = size > 60_000 || /soundstacks_csgo_core/i.test(name);
    it(
      `preserves all parsed values for ${name}`,
      { timeout: large ? 45_000 : 15_000 },
      () => {
        const text = readFileSync(fullPath, 'utf8');
        const doc = KV3Format.parseKV3Document(text);
        const serialized = KV3Format.jsonToKV3(doc.root, {
          header: doc.header || KV3Format.detectKV3HeaderFromFileName(name),
          fileName: name
        });
        const again = KV3Format.parseKV3Document(serialized);
        expectSemanticKv3RoundTrip(again.root, doc.root);
      }
    );
  }
});
