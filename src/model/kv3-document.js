// Root document wrapper: parsed KV3 body, dirty flag, SmartProp default factory.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VDataKV3 = Object.assign(root.VDataKV3 || {}, api);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  class KV3Document {
    constructor(root) {
      this._root = root;
      this.dirty = false;
    }

    getRoot() {
      return this._root;
    }

    setRoot(next) {
      this._root = next;
      this.dirty = true;
    }
  }

  KV3Document.createSmartPropDefault = function () {
    return new KV3Document({
      generic_data_type: 'CSmartPropRoot',
      m_Children: [],
      m_Variables: []
    });
  };

  return { KV3Document };
});
