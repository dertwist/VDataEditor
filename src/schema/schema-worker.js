/**
 * Off-main-thread gzip decompress + JSON.parse for SchemaExplorer .json.gz bundles.
 * Loaded by schema-db.js (single shared Worker).
 */
(function () {
  'use strict';

  async function gunzipToString(buffer) {
    var t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
    var text;
    if (typeof DecompressionStream !== 'undefined') {
      var ds = new DecompressionStream('gzip');
      var writer = ds.writable.getWriter();
      var reader = ds.readable.getReader();
      writer.write(buffer);
      writer.close();
      var chunks = [];
      var totalLen = 0;
      while (true) {
        var rd = await reader.read();
        if (rd.done) break;
        chunks.push(rd.value);
        totalLen += rd.value.length;
      }
      var merged = new Uint8Array(totalLen);
      var offset = 0;
      for (var i = 0; i < chunks.length; i++) {
        merged.set(chunks[i], offset);
        offset += chunks[i].length;
      }
      text = new TextDecoder().decode(merged);
    } else {
      throw new Error('DecompressionStream not available in worker');
    }
    var decompressMs = typeof performance !== 'undefined' && performance.now ? performance.now() - t0 : 0;
    return { text: text, decompressMs: decompressMs };
  }

  self.onmessage = async function (event) {
    var id = event.data.id;
    var buffer = event.data.buffer;
    try {
      var g = await gunzipToString(buffer);
      var t1 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
      var schema = JSON.parse(g.text);
      var parseMs = typeof performance !== 'undefined' && performance.now ? performance.now() - t1 : 0;
      self.postMessage({
        ok: true,
        id: id,
        schema: schema,
        timing: { decompressMs: g.decompressMs, parseMs: parseMs }
      });
    } catch (err) {
      self.postMessage({
        ok: false,
        id: id,
        error: err && err.message ? err.message : String(err)
      });
    }
  };
})();
