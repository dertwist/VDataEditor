import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const loaderPath = '../native/prop-tree-addon/prop-tree-native-loader.cjs';

function jsReferenceBuildInitialPlan(root, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const collapsedDefaultDepth0 = opts.collapsedDefaultDepth0 !== undefined ? !!opts.collapsedDefaultDepth0 : true;

  const rows = [];
  if (!root || typeof root !== 'object') return { rows };

  const entries = Array.isArray(root) ? root.entries() : Object.entries(root);
  for (const [key, value] of entries) {
    const isArr = Array.isArray(value);
    const isObj = !isArr && value !== null && typeof value === 'object';
    const isExpandable = isArr || isObj;
    rows.push({
      key: String(key),
      propPath: String(key),
      kind: isArr ? 'array' : isObj ? 'object' : 'scalar',
      isExpandable: !!isExpandable,
      collapsedByDefault: collapsedDefaultDepth0 && isExpandable
    });
  }
  return { rows };
}

function loadLoaderWithNativeDisabled() {
  const full = require.resolve(loaderPath);
  delete require.cache[full];
  process.env.VDATA_DISABLE_NATIVE = '1';
  // eslint-disable-next-line import/no-dynamic-require
  const mod = require(loaderPath);
  delete process.env.VDATA_DISABLE_NATIVE;
  return mod;
}

describe('prop-tree initial plan (native + fallback)', () => {
  it('produces stable row plan shape (JS reference contract)', () => {
    const root = {
      a: 1,
      b: { c: 2 },
      d: [1, 2],
      e: null,
      f: {},
      g: [{ x: 1 }]
    };

    const ref = jsReferenceBuildInitialPlan(root, { collapsedDefaultDepth0: true });
    expect(ref.rows.length).toBe(6);

    // Spot-check some rows.
    const byKey = Object.fromEntries(ref.rows.map((r) => [r.key, r]));
    expect(byKey.a.kind).toBe('scalar');
    expect(byKey.b.kind).toBe('object');
    expect(byKey.d.kind).toBe('array');
    expect(byKey.f.kind).toBe('object');
  });

  it('native plan matches JS reference when native is available', () => {
    const native = require(loaderPath);
    const nativeAvailable = !!native.isNativeAvailable?.();
    if (!nativeAvailable) return;

    const root = {
      a: 1,
      b: { c: 2 },
      d: [1, 2],
      e: null,
      f: {},
      g: [{ x: 1 }]
    };

    const ref = jsReferenceBuildInitialPlan(root, { collapsedDefaultDepth0: true });
    const got = native.buildPropTreeInitialPlan(root, { collapsedDefaultDepth0: true });

    expect(got).toEqual(ref);
  });

  it('JS fallback works when native is disabled (no crashes)', () => {
    const nativeDisabled = loadLoaderWithNativeDisabled();
    expect(nativeDisabled.isNativeAvailable?.()).toBe(false);

    const root = {
      a: 1,
      b: { c: 2 },
      d: [1, 2]
    };

    const got = nativeDisabled.buildPropTreeInitialPlan(root, { collapsedDefaultDepth0: true });
    const ref = jsReferenceBuildInitialPlan(root, { collapsedDefaultDepth0: true });
    expect(got).toEqual(ref);
  });

  it('perf smoke: 20k keys plan stays reasonably fast (opt-in)', () => {
    if (process.env.VDATA_PROP_TREE_PERF_TESTS !== '1') return;

    const root = {};
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      root['k' + i] = { x: i };
    }

    const loader = require(loaderPath);
    const t0 = Date.now();
    const plan = loader.buildPropTreeInitialPlan(root, { collapsedDefaultDepth0: true });
    const dt = Date.now() - t0;

    expect(plan).toBeDefined();
    expect(Array.isArray(plan.rows)).toBe(true);
    expect(plan.rows.length).toBe(N);

    // Keep the threshold generous to avoid flakiness on shared CI runners.
    expect(dt).toBeLessThan(2000);
  });
});

