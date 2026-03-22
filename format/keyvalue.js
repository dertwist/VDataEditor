// Valve KeyValues text format (VMT / VMAT / similar) — not KV3.
// Spec-style reference: https://developer.valvesoftware.com/wiki/Keyvalue
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KeyValueFormat = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function coerceScalar(s) {
    if (s === '' || s == null) return '';
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+/.test(s) || /^-?\d+[eE][+-]?\d+$/.test(s)) return parseFloat(s);
    return s;
  }

  class KeyValuesParser {
    constructor(text) {
      this.text = text;
      this.pos = 0;
    }

    skip() {
      const t = this.text;
      const n = t.length;
      while (this.pos < n) {
        const c = t[this.pos];
        if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
          this.pos++;
          continue;
        }
        if (c === '/' && this.pos + 1 < n && t[this.pos + 1] === '/') {
          while (this.pos < n && t[this.pos] !== '\n') this.pos++;
          continue;
        }
        break;
      }
    }

    peek() {
      this.skip();
      return this.pos < this.text.length ? this.text[this.pos] : '';
    }

    readQuotedString() {
      const t = this.text;
      const n = t.length;
      if (this.pos >= n || t[this.pos] !== '"') return '';
      this.pos++;
      let s = '';
      while (this.pos < n) {
        const c = t[this.pos++];
        if (c === '"') break;
        if (c === '\\' && this.pos < n) s += t[this.pos++];
        else s += c;
      }
      return s;
    }

    readKey() {
      this.skip();
      const t = this.text;
      const n = t.length;
      if (this.pos >= n) return '';
      if (t[this.pos] === '"') return this.readQuotedString();
      const start = this.pos;
      while (this.pos < n) {
        const c = t[this.pos];
        if (c <= ' ' || c === '{' || c === '}' || c === '"' || c === '/') break;
        this.pos++;
      }
      return t.slice(start, this.pos);
    }

    readLineValue() {
      this.skip();
      const t = this.text;
      const n = t.length;
      if (this.pos >= n) return '';
      if (t[this.pos] === '"') return this.readQuotedString();
      const start = this.pos;
      while (this.pos < n && t[this.pos] !== '\n' && t[this.pos] !== '\r') {
        this.pos++;
      }
      return t.slice(start, this.pos).trim();
    }

    parseObject() {
      const obj = {};
      const t = this.text;
      const n = t.length;
      while (true) {
        this.skip();
        if (this.pos >= n || t[this.pos] === '}') {
          if (t[this.pos] === '}') this.pos++;
          break;
        }
        const key = this.readKey();
        if (!key) {
          this.pos++;
          continue;
        }
        this.skip();
        if (this.pos < n && t[this.pos] === '{') {
          this.pos++;
          obj[key] = this.parseObject();
        } else {
          obj[key] = coerceScalar(this.readLineValue());
        }
      }
      return obj;
    }

    parseRoot() {
      const root = {};
      const t = this.text;
      const n = t.length;
      while (true) {
        this.skip();
        if (this.pos >= n) break;
        const key = this.readKey();
        if (!key) break;
        this.skip();
        if (this.pos < n && t[this.pos] === '{') {
          this.pos++;
          root[key] = this.parseObject();
        } else {
          root[key] = coerceScalar(this.readLineValue());
        }
      }
      return root;
    }
  }

  function keyValueToJSON(text) {
    const p = new KeyValuesParser(String(text));
    return p.parseRoot();
  }

  function needsKeyQuotes(key) {
    return !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key);
  }

  function escapeQuoted(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function formatKey(key) {
    return needsKeyQuotes(key) ? `"${escapeQuoted(key)}"` : key;
  }

  function formatScalarValue(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      return Number.isInteger(v) ? String(v) : String(v);
    }
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'string') {
      if (v === '') return '""';
      if (!/[\s"]/.test(v)) return v;
      return `"${escapeQuoted(v)}"`;
    }
    if (v === null || v === undefined) return '""';
    return `"${escapeQuoted(String(v))}"`;
  }

  function serializeObject(obj, depth) {
    const tab = '\t';
    const ind = tab.repeat(depth);
    let out = '';
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v === undefined) continue;
      const k = formatKey(key);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        out += `${ind}${k}\n${ind}{\n`;
        out += serializeObject(v, depth + 1);
        out += `${ind}}\n`;
      } else if (Array.isArray(v)) {
        out += `${ind}${k} "${escapeQuoted(JSON.stringify(v))}"\n`;
      } else {
        out += `${ind}${k} ${formatScalarValue(v)}\n`;
      }
    }
    return out;
  }

  function jsonToKeyValue(obj) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return serializeObject({ root: obj }, 0);
    }
    return serializeObject(obj, 0);
  }

  return {
    keyValueToJSON,
    jsonToKeyValue,
    KeyValuesParser
  };
});
