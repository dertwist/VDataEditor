import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import KV3Format from '../format/kv3.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const native = require('../native/kv3-addon/kv3-native-loader.cjs');

function readFixture(name) {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

const allowSkip = process.env.VDATA_NATIVE_TESTS_SKIP === '1' || process.env.VDATA_ALLOW_NATIVE_SKIP === '1';
const nativeAvailable = !!native.isNativeAvailable?.();

describe('KV3 native addon', () => {
  it('native loader should be available (CI expectation)', () => {
    if (!nativeAvailable) {
      if (allowSkip) return;
      throw new Error(
        'Native KV3 addon is not available. Build it (see CI/build scripts) or set VDATA_NATIVE_TESTS_SKIP=1 to skip.'
      );
    }
    expect(nativeAvailable).toBe(true);
  });

  it('parses typed panorama/resource/soundevent atoms like JS', () => {
    if (!nativeAvailable) return;
    const text =
      '{ model = resource_name:"models/props/test.vmdl" fire = soundevent:"c4.plant" img = panorama:"file://{images}/hud/abilities/weapon_damage.psd" }';

    const js = KV3Format.parseKV3Document(text);
    const n = native.parseKv3Document(text);

    expect(n.header).toBe(js.header);
    expect(n.root).toEqual(js.root);
  });

  it('preserves line comments inside arrays exactly (shape + text)', () => {
    if (!nativeAvailable) return;
    const text = `{
  list = [
    // enabled
    "a",
    //"b",
  ]
}`;

    const js = KV3Format.parseKV3Document(text);
    const n = native.parseKv3Document(text);

    expect(n.root).toEqual(js.root);
    expect(Array.isArray(n.root.list)).toBe(true);
    expect(KV3Format.isKV3LineCommentNode(n.root.list[0])).toBe(true);
    expect(KV3Format.isKV3LineCommentNode(n.root.list[2])).toBe(true);
    expect(n.root.list[0].text).toContain(' enabled');
  });

  it('preserves object-level line comments as __kv3_obj_comment_N keys', () => {
    if (!nativeAvailable) return;
    const text = `{
  // head
  a = 1
  // middle
  b = 2
}`;

    const js = KV3Format.parseKV3Document(text);
    const n = native.parseKv3Document(text);

    expect(n.root).toEqual(js.root);
    const commentKeys = Object.keys(n.root).filter((k) => k.startsWith(KV3Format.KV3_OBJECT_COMMENT_KEY_PREFIX));
    expect(commentKeys.length).toBe(2);
  });

  it('matches JS parser output across fixture corpus', () => {
    if (!nativeAvailable) return;
    const fixtures = [
      'propdata.kv3',
      'toolscenelightrigs.kv3',
      'weapons.kv3',
      'particle.vpcf',
      'light_styles.kv3',
      'panorama_typed.kv3',
      'block_comment.kv3'
    ];

    for (const f of fixtures) {
      const text = readFixture(f);
      const js = KV3Format.parseKV3Document(text);
      const n = native.parseKv3Document(text);
      expect(n.header).toBe(js.header);
      expect(n.root).toEqual(js.root);
    }
  });
});

