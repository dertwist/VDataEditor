/**
 * Runtime dependency evaluation for property editor fields.
 * Exposes `window.VDataDependencyEngine`.
 *
 * This module is intentionally small and permissive: it only supports the
 * dependency/enumRef shapes that VDataEditor currently needs.
 */
(function () {
  'use strict';

  function _isObj(x) {
    return x && typeof x === 'object' && !Array.isArray(x);
  }

  function _toNum(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function _getValueAtSiblingKey(parentObj, key) {
    if (!parentObj || typeof parentObj !== 'object') return undefined;
    if (!key || typeof key !== 'string') return undefined;
    if (Object.prototype.hasOwnProperty.call(parentObj, key)) return parentObj[key];
    return undefined;
  }

  function _getValueByPropPath(liveRoot, pathStr) {
    if (!liveRoot || typeof liveRoot !== 'object') return undefined;
    if (typeof pathStr !== 'string' || !pathStr) return liveRoot;

    // Re-implement minimal getValueAtPath logic (avoid module import cycles).
    const parts = pathStr.split('/');
    let cur = liveRoot;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (cur == null) return undefined;
      const m = /^\[(\d+)\]$/.exec(part);
      if (m) cur = cur[parseInt(m[1], 10)];
      else cur = cur[part];
    }
    return cur;
  }

  function _resolveLeafKeyValue(key, parentObj, ctx) {
    // Most dependencies are sibling-scoped: `{ key: "m_nAbilityType", ... }`.
    const sibling = _getValueAtSiblingKey(parentObj, key);
    if (sibling !== undefined) return sibling;

    // Fallback: allow absolute-ish paths (e.g. "root/child/key" or "foo/bar").
    const liveRoot = ctx && (ctx.liveRoot || ctx.root || null);
    if (!liveRoot) return undefined;

    if (key.includes('/') || key.includes('[') || key.startsWith('root/')) {
      const normalized = key.startsWith('root/') ? key.slice('root/'.length) : key;
      return _getValueByPropPath(liveRoot, normalized);
    }

    // Final fallback: treat as root key.
    if (Object.prototype.hasOwnProperty.call(liveRoot, key)) return liveRoot[key];
    return undefined;
  }

  function evaluateLeafCondition(leaf, parentObj, ctx) {
    if (!leaf || typeof leaf !== 'object') return false;

    const key = typeof leaf.key === 'string' ? leaf.key : '';
    if (!key) return false;

    const v = _resolveLeafKeyValue(key, parentObj, ctx);

    // If no operators are supplied, treat as truthiness.
    const hasOp = Object.prototype.hasOwnProperty.call(leaf, 'eq') ||
      Object.prototype.hasOwnProperty.call(leaf, 'ne') ||
      Object.prototype.hasOwnProperty.call(leaf, 'in') ||
      Object.prototype.hasOwnProperty.call(leaf, 'lt') ||
      Object.prototype.hasOwnProperty.call(leaf, 'lte') ||
      Object.prototype.hasOwnProperty.call(leaf, 'gt') ||
      Object.prototype.hasOwnProperty.call(leaf, 'gte') ||
      Object.prototype.hasOwnProperty.call(leaf, 'regex');

    if (!hasOp) return !!v;

    const asStr = (x) => (x == null ? '' : String(x));

    if (Object.prototype.hasOwnProperty.call(leaf, 'eq')) {
      if (v === leaf.eq) return true;
      if (asStr(v) === asStr(leaf.eq)) return true;
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(leaf, 'ne')) {
      if (v !== leaf.ne) {
        // If types differ but string values match, treat as equal.
        if (asStr(v) === asStr(leaf.ne)) return false;
        return true;
      }
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(leaf, 'in')) {
      const list = Array.isArray(leaf.in) ? leaf.in : [];
      if (list.length === 0) return false;
      const sv = asStr(v);
      return list.some((item) => asStr(item) === sv);
    }
    if (Object.prototype.hasOwnProperty.call(leaf, 'lt')) {
      const n = _toNum(v);
      const cmp = _toNum(leaf.lt);
      if (!Number.isFinite(n) || !Number.isFinite(cmp)) return false;
      return n < cmp;
    }
    if (Object.prototype.hasOwnProperty.call(leaf, 'lte')) {
      const n = _toNum(v);
      const cmp = _toNum(leaf.lte);
      if (!Number.isFinite(n) || !Number.isFinite(cmp)) return false;
      return n <= cmp;
    }
    if (Object.prototype.hasOwnProperty.call(leaf, 'gt')) {
      const n = _toNum(v);
      const cmp = _toNum(leaf.gt);
      if (!Number.isFinite(n) || !Number.isFinite(cmp)) return false;
      return n > cmp;
    }
    if (Object.prototype.hasOwnProperty.call(leaf, 'gte')) {
      const n = _toNum(v);
      const cmp = _toNum(leaf.gte);
      if (!Number.isFinite(n) || !Number.isFinite(cmp)) return false;
      return n >= cmp;
    }
    if (Object.prototype.hasOwnProperty.call(leaf, 'regex')) {
      if (v == null) return false;
      const src = String(leaf.regex);
      try {
        const re = new RegExp(src);
        return re.test(String(v));
      } catch (_) {
        return false;
      }
    }

    return false;
  }

  function evaluateConditionExpr(expr, parentObj, ctx) {
    if (expr == null) return true;
    if (Array.isArray(expr)) {
      // Treat arrays as AND.
      for (let i = 0; i < expr.length; i++) {
        if (!evaluateConditionExpr(expr[i], parentObj, ctx)) return false;
      }
      return true;
    }

    if (typeof expr === 'object' && _isObj(expr)) {
      if (Array.isArray(expr.and)) {
        for (let i = 0; i < expr.and.length; i++) {
          if (!evaluateConditionExpr(expr.and[i], parentObj, ctx)) return false;
        }
        return true;
      }
      if (Array.isArray(expr.or)) {
        for (let i = 0; i < expr.or.length; i++) {
          if (evaluateConditionExpr(expr.or[i], parentObj, ctx)) return true;
        }
        return false;
      }
      if (expr.not != null) return !evaluateConditionExpr(expr.not, parentObj, ctx);

      // Otherwise interpret as a leaf condition.
      return evaluateLeafCondition(expr, parentObj, ctx);
    }

    return !!expr;
  }

  function evaluateDependency(depExpr, parentObj, ctx) {
    if (!depExpr || typeof depExpr !== 'object') return { visible: true, enabled: true };
    let visible = true;
    let enabled = true;
    if (depExpr.showIf != null) visible = evaluateConditionExpr(depExpr.showIf, parentObj, ctx);
    if (depExpr.enableIf != null) enabled = evaluateConditionExpr(depExpr.enableIf, parentObj, ctx);
    return { visible: !!visible, enabled: !!enabled };
  }

  function collectReferencedKeysFromExpr(expr, outSet) {
    if (expr == null) return;
    if (!outSet) outSet = new Set();

    if (Array.isArray(expr)) {
      for (let i = 0; i < expr.length; i++) collectReferencedKeysFromExpr(expr[i], outSet);
      return outSet;
    }

    if (typeof expr === 'object') {
      if (_isObj(expr)) {
        if (expr.key && typeof expr.key === 'string') outSet.add(expr.key);
        if (Array.isArray(expr.and)) {
          for (let i = 0; i < expr.and.length; i++) collectReferencedKeysFromExpr(expr.and[i], outSet);
        }
        if (Array.isArray(expr.or)) {
          for (let i = 0; i < expr.or.length; i++) collectReferencedKeysFromExpr(expr.or[i], outSet);
        }
        if (expr.not != null) collectReferencedKeysFromExpr(expr.not, outSet);
        // Leaf operators (eq/ne/in/etc) do not add keys.
        return outSet;
      }
    }
    return outSet;
  }

  function collectReferencedKeys(depExpr) {
    const out = new Set();
    if (depExpr && typeof depExpr === 'object') {
      if (depExpr.showIf != null) collectReferencedKeysFromExpr(depExpr.showIf, out);
      if (depExpr.enableIf != null) collectReferencedKeysFromExpr(depExpr.enableIf, out);
      if (depExpr.showIf == null && depExpr.enableIf == null) collectReferencedKeysFromExpr(depExpr, out);
    }
    return [...out];
  }

  function resolveDocSelector(enumRef, ctx) {
    const liveRoot = ctx && (ctx.liveRoot || ctx.root || null);
    if (!liveRoot || typeof liveRoot !== 'object') return [];
    if (typeof enumRef !== 'string') return [];

    // Supported pattern (minimal): @doc.<arrKey>[*].<leafKey>
    const m = /^@doc\.([A-Za-z0-9_]+)\[\*\]\.([A-Za-z0-9_]+)$/.exec(enumRef);
    if (m) {
      const arrKey = m[1];
      const leafKey = m[2];
      const arr = liveRoot[arrKey];
      if (!Array.isArray(arr)) return [];
      return arr
        .map((x) => (x && typeof x === 'object' ? x[leafKey] : undefined))
        .filter((x) => x != null && x !== '');
    }

    // Supported pattern: @doc.<path.to.value> (no wildcard)
    if (enumRef.startsWith('@doc.')) {
      const dotPath = enumRef.slice('@doc.'.length);
      const parts = dotPath.split('.');
      let cur = liveRoot;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (cur == null) return [];
        cur = cur[p];
      }
      if (Array.isArray(cur)) return cur.filter((x) => x != null && x !== '');
      if (cur == null) return [];
      return [cur].filter((x) => x != null && x !== '');
    }

    return [];
  }

  function resolveEnumValues(enumRef, ctx) {
    if (!enumRef || typeof enumRef !== 'string') return [];

    // doc selector enum.
    if (enumRef.startsWith('@doc.')) {
      return resolveDocSelector(enumRef, ctx).map((x) => String(x));
    }

    // SchemaDB widget enum.
    if (enumRef.startsWith('enum:') && window.SchemaDB && typeof window.SchemaDB.getEnumValuesForWidgetId === 'function') {
      const vals = window.SchemaDB.getEnumValuesForWidgetId(enumRef);
      return Array.isArray(vals) ? vals : [];
    }

    // Legacy / future: try treating it as an enum key in SchemaDB.
    if (window.SchemaDB && typeof window.SchemaDB.getEnumValuesForWidgetId === 'function') {
      const vals = window.SchemaDB.getEnumValuesForWidgetId('enum:' + enumRef);
      if (Array.isArray(vals) && vals.length) return vals;
    }

    return [];
  }

  /**
   * Convenience: pull dependency expr for a key from the suggestions layer.
   * This keeps the dependency engine decoupled from schema storage.
   */
  function getDependencyForKey(key, ctx) {
    try {
      const S = window && window.VDataSuggestions;
      if (!S || typeof S.getSchemaEntry !== 'function') return null;
      const entry = S.getSchemaEntry(key, ctx);
      if (!entry || typeof entry !== 'object') return null;
      const hasRules = entry.showIf != null || entry.enableIf != null;
      if (!hasRules) return null;
      return { showIf: entry.showIf || null, enableIf: entry.enableIf || null };
    } catch (_) {
      return null;
    }
  }

  window.VDataDependencyEngine = {
    evaluateDependency,
    collectReferencedKeys,
    resolveEnumValues,
    getDependencyForKey
  };
})();

