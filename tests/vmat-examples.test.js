import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import KeyValueFormat from '../format/keyvalue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, '..', 'examples');

const VMAT_EXAMPLES = ['glove.vmat', 'purple.vmat', 'gray_ground_3.vmat', 'sky_01.vmat'];

describe('example VMAT files (KeyValues)', () => {
  for (const name of VMAT_EXAMPLES) {
    it(
      `parses and round-trips ${name}`,
      { timeout: 60_000 },
      () => {
        const text = readFileSync(join(examplesDir, name), 'utf8');
        const tree = KeyValueFormat.keyValueToJSON(text);
        expect(tree).toBeDefined();
        expect(tree.Layer0).toBeDefined();
        expect(typeof tree.Layer0).toBe('object');
        const again = KeyValueFormat.keyValueToJSON(KeyValueFormat.jsonToKeyValue(tree));
        expect(again).toEqual(tree);
      }
    );
  }
});
