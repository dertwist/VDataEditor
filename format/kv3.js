// KV3 format utilities: serialize JSON-like objects to KV3 and parse KV3 back.
// Works both in browser (via global KV3Format) and in Node (via module.exports).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KV3Format = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function jsonToKV3(obj) {
    const header =
      '<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:vrfunknown:version{5ab656f0-06de-478a-804e-489e82994fb5} -->';
    return header + '\n' + serializeKV3Value(obj, 0);
  }

  function serializeKV3Value(val, depth) {
    const indent = '\t'.repeat(depth);
    const indent1 = '\t'.repeat(depth + 1);
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'string') {
      if (val.endsWith('.vmdl') || val.endsWith('.vsmart') || val.endsWith('.vmat'))
        return `resource_name:"${val}"`;
      return `"${val}"`;
    }
    if (Array.isArray(val)) {
      if (val.length === 0) return '[]';
      // Simple numeric array
      if (val.every((v) => typeof v === 'number')) return `[${val.join(', ')}]`;
      let s = '\n' + indent + '[\n';
      val.forEach((item, i) => {
        s += indent1 + serializeKV3Value(item, depth + 1).trimStart();
        if (i < val.length - 1) s += ',';
        s += '\n';
      });
      s += indent + ']';
      return s;
    }
    if (typeof val === 'object') {
      const keys = Object.keys(val);
      if (keys.length === 0) return '{}';
      let s = '\n' + indent + '{\n';
      keys.forEach((key) => {
        const v = val[key];
        if (v === undefined) return;
        const serialized = serializeKV3Value(v, depth + 1);
        if (serialized.startsWith('\n')) {
          s += indent1 + key + ' = ' + serialized.trimStart() + '\n';
        } else {
          s += indent1 + key + ' = ' + serialized + '\n';
        }
      });
      s += indent + '}';
      return s;
    }
    return String(val);
  }

  function kv3ToJSON(text) {
    // Strip header line (allowing leading whitespace/newlines) if present
    text = text.replace(/^\s*<!--.*?-->\s*/s, '');
    const parser = new KV3Parser(text);
    return parser.parseValue();
  }

  class KV3Parser {
    constructor(text) {
      this.text = text;
      this.pos = 0;
    }
    skipWhitespace() {
      while (this.pos < this.text.length && /[\s]/.test(this.text[this.pos])) this.pos++;
      // Skip // comments
      if (
        this.pos < this.text.length - 1 &&
        this.text[this.pos] === '/' &&
        this.text[this.pos + 1] === '/'
      ) {
        while (this.pos < this.text.length && this.text[this.pos] !== '\n') this.pos++;
        this.skipWhitespace();
      }
    }
    peek() {
      this.skipWhitespace();
      return this.text[this.pos];
    }
    consume(ch) {
      this.skipWhitespace();
      if (this.text[this.pos] === ch) this.pos++;
    }

    parseValue() {
      this.skipWhitespace();
      const ch = this.text[this.pos];
      if (ch === '{') return this.parseObject();
      if (ch === '[') return this.parseArray();
      if (ch === '"') return this.parseString();
      // resource_name:"..."
      if (this.text.substring(this.pos, this.pos + 14) === 'resource_name:') {
        this.pos += 14;
        return this.parseString();
      }
      return this.parseLiteral();
    }

    parseObject() {
      this.consume('{');
      const obj = {};
      while (true) {
        this.skipWhitespace();
        if (this.pos >= this.text.length || this.text[this.pos] === '}') break;
        const key = this.parseKey();
        this.skipWhitespace();
        this.consume('=');
        obj[key] = this.parseValue();
      }
      this.consume('}');
      return obj;
    }

    parseArray() {
      this.consume('[');
      const arr = [];
      while (true) {
        this.skipWhitespace();
        if (this.pos >= this.text.length || this.text[this.pos] === ']') break;
        arr.push(this.parseValue());
        this.skipWhitespace();
        if (this.text[this.pos] === ',') this.pos++;
      }
      this.consume(']');
      return arr;
    }

    parseString() {
      this.consume('"');
      let s = '';
      while (this.pos < this.text.length && this.text[this.pos] !== '"') {
        if (this.text[this.pos] === '\\') {
          this.pos++;
          s += this.text[this.pos];
        } else s += this.text[this.pos];
        this.pos++;
      }
      this.consume('"');
      return s;
    }

    parseKey() {
      this.skipWhitespace();
      let key = '';
      while (this.pos < this.text.length && /[a-zA-Z0-9_]/.test(this.text[this.pos])) {
        key += this.text[this.pos];
        this.pos++;
      }
      return key;
    }

    parseLiteral() {
      this.skipWhitespace();
      let lit = '';
      while (
        this.pos < this.text.length &&
        !/[\s\n\r,}\]=]/.test(this.text[this.pos])
      ) {
        lit += this.text[this.pos];
        this.pos++;
      }
      if (lit === 'true') return true;
      if (lit === 'false') return false;
      if (lit === 'null') return null;
      const num = Number(lit);
      if (!isNaN(num) && lit !== '') return num;
      return lit;
    }
  }

  return {
    jsonToKV3,
    kv3ToJSON,
    KV3Parser,
    serializeKV3Value
  };
});

