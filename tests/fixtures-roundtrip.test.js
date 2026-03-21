import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import KV3Format from '../format/kv3.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFixture(name) {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

describe('KV3 fixture corpus round-trip', () => {
  const fixtures = [
    'propdata.kv3',
    'toolscenelightrigs.kv3',
    'weapons.kv3',
    'particle.vpcf',
    'light_styles.kv3'
  ];

  for (const name of fixtures) {
    it(`round-trips ${name}`, () => {
      const source = readFixture(name);
      const tree = KV3Format.kv3ToJSON(source);
      const serialized = KV3Format.jsonToKV3(tree);
      const reparsed = KV3Format.kv3ToJSON(serialized);
      expect(reparsed).toEqual(tree);
    });
  }
});
