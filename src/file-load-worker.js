/**
 * Off-main-thread KV3 / KeyValues parse (mirrors parseDocumentContent in parse-utils.js).
 */
(function () {
  'use strict';

  self.importScripts('../format/kv3.js', '../format/keyvalue.js');

  function fileExtension(name) {
    if (!name || typeof name !== 'string') return '';
    var m = /\.([^.\\/]+)$/.exec(name);
    return m ? m[1].toLowerCase() : '';
  }

  function parseDocumentContent(text, hintFileName, formatOverride) {
    if (formatOverride === 'json') {
      return { root: JSON.parse(text), format: 'json' };
    }
    if (formatOverride === 'keyvalue') {
      return { root: self.KeyValueFormat.keyValueToJSON(text), format: 'keyvalue' };
    }
    if (formatOverride === 'kv3') {
      var parsedKv3 = self.KV3Format.parseKV3Document(text);
      return {
        root: parsedKv3.root,
        format: 'kv3',
        kv3Header: parsedKv3.header || self.KV3Format.detectKV3HeaderFromFileName(hintFileName)
      };
    }

    // Fallback: detect from file extension.
    var ext = fileExtension(hintFileName);
    if (ext === 'vmat' || ext === 'vmt') {
      return { root: self.KeyValueFormat.keyValueToJSON(text), format: 'keyvalue' };
    }
    if (ext === 'json') {
      return { root: JSON.parse(text), format: 'json' };
    }
    var parsed = self.KV3Format.parseKV3Document(text);
    return {
      root: parsed.root,
      format: 'kv3',
      kv3Header: parsed.header || self.KV3Format.detectKV3HeaderFromFileName(hintFileName)
    };
  }

  self.onmessage = function (event) {
    var id = event.data.id;
    var filePath = event.data.filePath;
    var text = event.data.text;
    var formatOverride = event.data.formatOverride;
    var t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
    try {
      var fileName = typeof filePath === 'string' ? filePath.split(/[/\\]/).pop() || '' : '';
      var parsed = parseDocumentContent(text, fileName, formatOverride);
      var parseMs = typeof performance !== 'undefined' && performance.now ? performance.now() - t0 : 0;
      self.postMessage({ ok: true, id: id, parsed: parsed, parseMs: parseMs });
    } catch (err) {
      self.postMessage({ ok: false, id: id, error: err && err.message ? err.message : String(err) });
    }
  };
})();
