// KV3 tree node type + class scaffold (property panel / tree UI will build on this).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VDataKV3 = Object.assign(root.VDataKV3 || {}, api);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const KV3Type = {
    STRING: 'string',
    BOOL: 'bool',
    INT: 'int',
    FLOAT: 'float',
    OBJECT: 'object',
    ARRAY: 'array',
    RESOURCE: 'resource',
    SOUNDEVENT: 'soundevent',
    ENUM_STRING: 'enum_string',
    CURVE: 'curve'
  };

  class KV3Node {
    constructor(key, value, options = {}) {
      this.key = key;
      this.value = value;
      this.parent = options.parent ?? null;
      this.valueType = options.valueType ?? KV3Type.OBJECT;
      this.typedPrefix = options.typedPrefix ?? null;
      this.metaClass = options.metaClass ?? null;
      this.metaBase = options.metaBase ?? null;
    }
  }

  return { KV3Type, KV3Node };
});
