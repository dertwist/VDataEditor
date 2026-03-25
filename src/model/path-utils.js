// Path helpers aligned with prop-tree getValueAtPath: segments use `[n]` for array indices.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VDataPathUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  /** @param {string} pathStr */
  function pathStrToSegments(pathStr) {
    if (!pathStr) return [];
    return pathStr.split('/');
  }

  /** @param {string[]} segments */
  function segmentsToPathStr(segments) {
    if (!segments || !segments.length) return '';
    return segments.join('/');
  }

  /**
   * @param {unknown} rootObj
   * @param {string[]} segments
   */
  function getParentAndKey(rootObj, segments) {
    if (!segments.length) return { parent: null, key: null, isArrayIndex: false };
    let cur = rootObj;
    for (let i = 0; i < segments.length - 1; i++) {
      const part = segments[i];
      if (cur == null) return { parent: null, key: null, isArrayIndex: false };
      const m = /^\[(\d+)\]$/.exec(part);
      if (m) cur = cur[parseInt(m[1], 10)];
      else cur = cur[part];
    }
    const last = segments[segments.length - 1];
    const am = /^\[(\d+)\]$/.exec(last);
    if (am) return { parent: cur, key: parseInt(am[1], 10), isArrayIndex: true };
    return { parent: cur, key: last, isArrayIndex: false };
  }

  /**
   * @param {unknown} rootObj
   * @param {string} pathStr
   */
  function getAtPath(rootObj, pathStr) {
    if (!pathStr) return rootObj;
    const parts = pathStrToSegments(pathStr);
    let cur = rootObj;
    for (const part of parts) {
      if (cur == null) return undefined;
      const m = /^\[(\d+)\]$/.exec(part);
      if (m) cur = cur[parseInt(m[1], 10)];
      else cur = cur[part];
    }
    return cur;
  }

  /**
   * Set leaf at path. Mutates in place.
   * @param {unknown} rootObj
   * @param {string} pathStr
   * @param {unknown} value
   * @returns {unknown} previous value at leaf
   */
  function setAtPath(rootObj, pathStr, value) {
    const segs = pathStrToSegments(pathStr);
    if (!segs.length) {
      throw new Error('setAtPath: empty path');
    }
    const { parent, key, isArrayIndex } = getParentAndKey(rootObj, segs);
    if (parent == null) {
      throw new Error('setAtPath: invalid path');
    }
    if (isArrayIndex) {
      const prev = parent[key];
      parent[key] = value;
      return prev;
    }
    const prev = Object.prototype.hasOwnProperty.call(parent, key) ? parent[key] : undefined;
    parent[key] = value;
    return prev;
  }

  /**
   * Remove key or array element at path. Mutates in place.
   * @returns {unknown} removed value
   */
  function deleteAtPath(rootObj, pathStr) {
    const segs = pathStrToSegments(pathStr);
    if (!segs.length) throw new Error('deleteAtPath: empty path');
    const { parent, key, isArrayIndex } = getParentAndKey(rootObj, segs);
    if (parent == null) throw new Error('deleteAtPath: invalid path');
    if (isArrayIndex) {
      const prev = parent[key];
      parent.splice(key, 1);
      return prev;
    }
    const prev = parent[key];
    delete parent[key];
    return prev;
  }

  /**
   * @param {object|unknown[]} parent — container (object or array)
   * @param {string|null} key — object key, or null for array
   * @param {number|null} index — array index when parent is array
   * @param {unknown} value
   * @param {number} [arrayInsertAt] — for array parent, insert at index (splice)
   */
  function insertIntoParent(parent, key, index, value, arrayInsertAt) {
    if (Array.isArray(parent)) {
      const at = arrayInsertAt != null ? arrayInsertAt : index != null ? index : parent.length;
      parent.splice(at, 0, value);
      return at;
    }
    if (key == null || typeof key !== 'string') throw new Error('insertIntoParent: object needs string key');
    parent[key] = value;
    return key;
  }

  /**
   * Reorder array in-place.
   * @param {unknown[]} arr
   */
  function moveInArray(arr, fromIndex, toIndex) {
    if (!Array.isArray(arr)) throw new Error('moveInArray: not an array');
    if (fromIndex === toIndex) return;
    const [item] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, item);
  }

  /**
   * Path to parent directory string (parent of leaf path).
   * @param {string} pathStr
   */
  function parentPathStr(pathStr) {
    if (!pathStr) return '';
    const idx = pathStr.lastIndexOf('/');
    return idx < 0 ? '' : pathStr.slice(0, idx);
  }

  /** Last segment as object key string, or null if `[i]`. */
  function leafKeyFromPathStr(pathStr) {
    if (!pathStr) return null;
    const parent = parentPathStr(pathStr);
    const last = parent ? pathStr.slice(parent.length + 1) : pathStr;
    if (/^\[\d+\]$/.test(last)) return null;
    return last;
  }

  function pathStrEquals(a, b) {
    return a === b;
  }

  return {
    pathStrToSegments,
    segmentsToPathStr,
    getAtPath,
    setAtPath,
    deleteAtPath,
    getParentAndKey,
    insertIntoParent,
    moveInArray,
    parentPathStr,
    leafKeyFromPathStr,
    pathStrEquals
  };
});
