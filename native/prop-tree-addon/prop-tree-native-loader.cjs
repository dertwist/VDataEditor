/* eslint-disable no-console */
const path = require('node:path');

function getNativeCandidates() {
  const releaseDir = path.join(__dirname, 'build', 'Release');
  const candidates = [];

  const arch = process.arch || '';
  if (arch) candidates.push(path.join(releaseDir, `proptreeaddon-${arch}.node`));
  candidates.push(path.join(releaseDir, 'proptreeaddon.node'));
  return candidates;
}

function jsBuildInitialPropTreePlan(root, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const collapsedDefaultDepth0 = opts.collapsedDefaultDepth0 !== undefined ? !!opts.collapsedDefaultDepth0 : true;

  const rows = [];
  if (!root || typeof root !== 'object') return { rows };

  const entries = Array.isArray(root) ? root.entries() : Object.entries(root);
  let i = 0;
  for (const [key, value] of entries) {
    const isArr = Array.isArray(value);
    const isObj = !isArr && value !== null && typeof value === 'object';
    const isExpandable = isArr || isObj;
    const kind = isArr ? 'array' : isObj ? 'object' : 'scalar';
    rows.push({
      key: String(key),
      propPath: String(key),
      kind,
      isExpandable,
      collapsedByDefault: collapsedDefaultDepth0 && isExpandable
    });
    i++;
  }

  return { rows };
}

let nativeModule = null;
let nativeErr = null;

function tryLoadNative() {
  if (process.env.VDATA_DISABLE_NATIVE === '1') return false;
  const candidates = getNativeCandidates();
  for (const p of candidates) {
    try {
      // eslint-disable-next-line import/no-dynamic-require
      nativeModule = require(p);
      return true;
    } catch (e) {
      nativeErr = e;
    }
  }
  return false;
}

const nativeAvailable = tryLoadNative();

function isNativeAvailable() {
  return (
    !!nativeAvailable &&
    !!nativeModule &&
    typeof nativeModule.buildPropTreeInitialPlan === 'function'
  );
}

function buildPropTreeInitialPlan(root, options) {
  if (isNativeAvailable()) {
    try {
      return nativeModule.buildPropTreeInitialPlan(root, options);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[prop-tree-native-loader] native plan failed; falling back to JS:', e?.message || String(e));
    }
  }
  return jsBuildInitialPropTreePlan(root, options);
}

module.exports = {
  buildPropTreeInitialPlan,
  isNativeAvailable,
  _nativeError: nativeErr
};

