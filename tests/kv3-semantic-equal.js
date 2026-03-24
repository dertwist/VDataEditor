/**
 * Compare two trees produced by KV3 parse / serialize so that tests catch real data loss
 * (e.g. truncated strings) but accept benign serializer normalizations.
 *
 * - Numeric -0 vs 0
 * - Plain string paths that serialize as resource_name:"…" (same heuristic as format/kv3.js)
 */

import KV3Format from '../format/kv3.js';

function normNum(n) {
  if (typeof n === 'number' && Object.is(n, -0)) return 0;
  return n;
}

function isResourceNameString(s) {
  return (
    typeof s === 'string' &&
    (s.endsWith('.vmdl') || s.endsWith('.vmat') || s.endsWith('.vsmart'))
  );
}

function isTypedScalarNode(v, typeTag) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.type !== typeTag || typeof v.value !== 'string')
    return false;
  const keys = Object.keys(v);
  return keys.length === 2 && keys.includes('type') && keys.includes('value');
}

function isResourceNameNode(v) {
  return isTypedScalarNode(v, 'resource_name');
}

function isSoundeventNode(v) {
  return isTypedScalarNode(v, 'soundevent');
}

function isPanoramaNode(v) {
  return isTypedScalarNode(v, 'panorama');
}

function isKV3LineCommentNode(value) {
  return KV3Format.isKV3LineCommentNode(value);
}

function leafSemEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof normNum(a) === 'number' && typeof normNum(b) === 'number') return normNum(a) === normNum(b);

  if (typeof a === 'string' && isResourceNameNode(b) && b.value === a && isResourceNameString(a)) return true;
  if (typeof b === 'string' && isResourceNameNode(a) && a.value === b && isResourceNameString(b)) return true;

  if (isSoundeventNode(a) && isSoundeventNode(b)) return a.value === b.value;
  if (isPanoramaNode(a) && isPanoramaNode(b)) return a.value === b.value;
  if (isResourceNameNode(a) && isResourceNameNode(b)) return a.value === b.value;

  return false;
}

/**
 * @param {*} a
 * @param {*} b
 * @param {string} path
 * @returns {{ ok: true } | { ok: false, path: string, a: *, b: * }}
 */
export function semanticKv3Compare(a, b, path = '$') {
  if (leafSemEqual(a, b)) return { ok: true };

  if (a === null || b === null) {
    if (a === b) return { ok: true };
    return { ok: false, path, a, b };
  }

  if (typeof a !== 'object' || typeof b !== 'object') {
    return { ok: false, path, a, b };
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return { ok: false, path, a, b };
  }

  if (isKV3LineCommentNode(a) || isKV3LineCommentNode(b)) {
    if (!isKV3LineCommentNode(a) || !isKV3LineCommentNode(b)) return { ok: false, path, a, b };
    return a.text === b.text ? { ok: true } : { ok: false, path, a, b };
  }

  if (Array.isArray(a)) {
    if (a.length !== b.length) return { ok: false, path: `${path}.length`, a: a.length, b: b.length };
    for (let i = 0; i < a.length; i++) {
      const r = semanticKv3Compare(a[i], b[i], `${path}[${i}]`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  const setB = new Set(keysB);
  if (keysA.length !== keysB.length) {
    return {
      ok: false,
      path: `${path}<keys>`,
      a: keysA.sort(),
      b: keysB.sort()
    };
  }
  for (const k of keysA) {
    if (!setB.has(k)) return { ok: false, path: `${path}<keys>`, a: keysA, b: keysB };
  }
  for (const k of keysA) {
    const r = semanticKv3Compare(a[k], b[k], `${path}.${k}`);
    if (!r.ok) return r;
  }

  return { ok: true };
}

export function expectSemanticKv3RoundTrip(actualRoot, expectedRoot) {
  const r = semanticKv3Compare(actualRoot, expectedRoot);
  if (r.ok) return;
  const detail = JSON.stringify({ path: r.path, expected: r.b, actual: r.a }, null, 2);
  throw new Error(`KV3 round-trip semantic mismatch at ${r.path}\n${detail}`);
}
