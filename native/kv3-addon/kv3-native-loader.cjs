/* eslint-disable no-console */
const path = require('node:path');

const KV3Format = require('../../format/kv3.js');

const releaseDir = path.join(__dirname, 'build', 'Release');

function getNativeCandidates() {
  // Support future multi-arch naming:
  // - kv3addon-${process.arch}.node (if we ever rename in a build step)
  // - kv3addon.node (default)
  const candidates = [];
  const arch = process.arch || '';
  if (arch) candidates.push(path.join(releaseDir, `kv3addon-${arch}.node`));
  candidates.push(path.join(releaseDir, 'kv3addon.node'));
  return candidates;
}

let nativeModule = null;
let nativeErr = null;

function tryLoadNative() {
  const candidates = getNativeCandidates();
  for (const p of candidates) {
    try {
      nativeModule = require(p);
      return true;
    } catch (e) {
      nativeErr = e;
    }
  }
  return false;
}

let nativeAvailable = tryLoadNative();

function isNativeAvailable() {
  return !!nativeAvailable && !!nativeModule && typeof nativeModule.parseKv3Document === 'function';
}

function parseKv3Document(text) {
  if (isNativeAvailable()) {
    try {
      return nativeModule.parseKv3Document(text);
    } catch (e) {
      // If the native parser itself errors, keep the app alive by falling back.
      // (This mirrors the "never crash" requirement.)
      // eslint-disable-next-line no-console
      console.warn('[kv3-native-loader] native parse failed; falling back to JS:', e?.message || String(e));
    }
  }
  return KV3Format.parseKV3Document(text);
}

module.exports = {
  parseKv3Document,
  isNativeAvailable,
  _nativeError: nativeErr
};

