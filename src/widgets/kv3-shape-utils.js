(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  // Expose for browser scripts and for vitest "globalThis evaluation" tests.
  root.VDataKV3ShapeUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  const ENUM_RE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;

  function isEnumLikeValue(value) {
    if (typeof value !== 'string') return false;
    if (!value || value.length < 3) return false;
    return ENUM_RE.test(value);
  }

  function isColorKey(key) {
    if (typeof key !== 'string') return false;
    const k = key.toLowerCase();
    return k.includes('color') || k.includes('colour') || k.includes('tint');
  }

  function isColorVectorNumbers(arr) {
    if (!Array.isArray(arr)) return false;
    if (arr.length !== 3 && arr.length !== 4) return false;
    return arr.every(
      (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 255
    );
  }

  function isColorVector(key, arr) {
    return isColorKey(key) && isColorVectorNumbers(arr);
  }

  function getVectorLabels(key, count) {
    const k = String(key || '').toLowerCase();

    if (k.includes('color') || k.includes('tint') || k.includes('colour')) {
      if (count === 4) return ['R', 'G', 'B', 'A'];
      if (count === 3) return ['R', 'G', 'B'];
      if (count === 2) return ['R', 'G'];
      return ['R', 'G', 'B', 'A'].slice(0, count);
    }

    if ((k.includes('domain') || k.includes('range') || k.includes('bounds')) && count === 2) {
      return ['Min', 'Max'];
    }

    if ((k.includes('uv') || k.includes('texcoord') || k.includes('scroll')) && count === 2) {
      return ['U', 'V'];
    }

    if ((k.includes('rotation') || k.includes('angle')) && count === 3) {
      return ['Pitch', 'Yaw', 'Roll'];
    }

    const defaults = {
      2: ['X', 'Y'],
      3: ['X', 'Y', 'Z'],
      4: ['X', 'Y', 'Z', 'W']
    };

    if (defaults[count]) return defaults[count];
    return Array.from({ length: count }, (_, i) => `C${i}`);
  }

  /**
   * Return widget type for inline numeric vectors (Pattern A).
   * Returns null when this doesn't look like a 2-4 numeric vector.
   */
  function classifyNumericVectorArray(key, arr) {
    if (!Array.isArray(arr)) return null;
    if (arr.length < 2 || arr.length > 4) return null;
    if (!arr.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;

    if (isColorVector(key, arr)) return 'color';

    if (arr.length === 2) return 'vec2';
    if (arr.length === 3) return 'vec3';
    if (arr.length === 4) return 'vec4';

    return null;
  }

  /**
   * Harvest unique enum-like string values for a given KV3 key.
   * Works for both:
   * - scalar fields: `m_nIncomingTangent = "CURVE_..."`
   * - arrays: `m_flags = ["FLAG_A", "FLAG_B"]`
   * - struct arrays: `m_items = [{ m_field = "ENUM_A" }, ...]`
   */
  function harvestEnumValues(root, key) {
    const targetKey = String(key || '');
    if (!targetKey) return [];

    const out = new Set();

    function walk(node) {
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) walk(node[i]);
        return;
      }

      if (!node || typeof node !== 'object') return;

      for (const [k, v] of Object.entries(node)) {
        if (k === targetKey) {
          if (typeof v === 'string' && isEnumLikeValue(v)) out.add(v);
          else if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++) {
              const el = v[i];
              if (typeof el === 'string' && isEnumLikeValue(el)) out.add(el);
            }
          }
        }
        walk(v);
      }
    }

    walk(root);

    return [...out].sort();
  }

  return {
    isEnumLikeValue,
    getVectorLabels,
    classifyNumericVectorArray,
    harvestEnumValues,
    isColorVector
  };
});

