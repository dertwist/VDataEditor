// KV3 format utilities: serialize JSON-like objects to KV3 and parse KV3 back.
// Works both in browser (via global KV3Format) and in Node (via module.exports).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KV3Format = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_KV3_HEADER =
    '<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->';
  const MODELDOC41_KV3_HEADER =
    '<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:modeldoc41:version{12fc9d44-453a-4ae4-b4d9-7e2ac0bbd4e0} -->';
  const DEFAULT_STYLE = {
    splitContainerAssignment: false,
    trailingArrayCommas: false,
    spacedEmptyArray: false,
    rootLeadingNewline: false
  };
  const MODELDOC41_STYLE = {
    splitContainerAssignment: true,
    trailingArrayCommas: true,
    spacedEmptyArray: true,
    rootLeadingNewline: false
  };
  const KV3_LINE_COMMENT_FLAG = '__kv3LineComment';
  const KV3_OBJECT_COMMENT_KEY_PREFIX = '__kv3_obj_comment_';

  function createKV3LineComment(text) {
    return { [KV3_LINE_COMMENT_FLAG]: true, text: typeof text === 'string' ? text : '' };
  }

  function isKV3LineCommentNode(value) {
    return (
      !!value &&
      typeof value === 'object' &&
      value[KV3_LINE_COMMENT_FLAG] === true &&
      typeof value.text === 'string' &&
      Object.keys(value).every((k) => k === KV3_LINE_COMMENT_FLAG || k === 'text')
    );
  }

  function detectKV3HeaderFromFileName(fileName) {
    const name = typeof fileName === 'string' ? fileName.toLowerCase() : '';
    if (name.endsWith('.vmdl')) return MODELDOC41_KV3_HEADER;
    return DEFAULT_KV3_HEADER;
  }

  function normalizeKV3Header(header) {
    if (typeof header !== 'string') return '';
    const trimmed = header.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) return trimmed;
    if (trimmed.startsWith('kv3 ')) return `<!-- ${trimmed} -->`;
    return '';
  }

  function escapeKV3String(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /** Unquoted keys are only safe for identifier-like segments (incl. dotted names like dmg.bullets). */
  function kv3ObjectKey(key) {
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) return key;
    return `"${escapeKV3String(key)}"`;
  }

  function jsonToKV3(obj, options = {}) {
    const header =
      normalizeKV3Header(options.header) ||
      detectKV3HeaderFromFileName(options.fileName) ||
      DEFAULT_KV3_HEADER;
    const useModelDocStyle = header.includes('format:modeldoc41');
    const style = useModelDocStyle ? MODELDOC41_STYLE : DEFAULT_STYLE;
    return header + '\n' + serializeKV3Value(obj, 0, style, '');
  }

  function serializeKV3Value(val, depth, style, keyName) {
    const indent = '\t'.repeat(depth);
    const indent1 = '\t'.repeat(depth + 1);
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') {
      if (keyName === 'import_scale' && Number.isFinite(val) && Number.isInteger(val)) return val.toFixed(1);
      return String(val);
    }
    if (typeof val === 'string') {
      if (val.endsWith('.vmdl') || val.endsWith('.vsmart') || val.endsWith('.vmat'))
        return `resource_name:"${escapeKV3String(val)}"`;
      return `"${escapeKV3String(val)}"`;
    }
    if (Array.isArray(val)) {
      if (val.length === 0) return style.spacedEmptyArray ? '[  ]' : '[]';
      // Simple numeric array
      if (val.every((v) => typeof v === 'number')) return `[${val.join(', ')}]`;
      const parts = [];
      parts.push('\n' + indent + '[\n');
      val.forEach((item, i) => {
        if (isKV3LineCommentNode(item)) {
          parts.push(indent1 + '//' + item.text);
        } else {
          parts.push(indent1 + serializeKV3Value(item, depth + 1, style, '').trimStart());
          if (i < val.length - 1 || style.trailingArrayCommas) parts.push(',');
        }
        parts.push('\n');
      });
      parts.push(indent + ']');
      return parts.join('');
    }
    if (typeof val === 'object') {
      if (
        val.type === 'resource_name' &&
        typeof val.value === 'string' &&
        Object.keys(val).every((k) => k === 'type' || k === 'value')
      ) {
        return `resource_name:"${escapeKV3String(val.value)}"`;
      }
      if (
        val.type === 'soundevent' &&
        typeof val.value === 'string' &&
        Object.keys(val).every((k) => k === 'type' || k === 'value')
      ) {
        return `soundevent:"${escapeKV3String(val.value)}"`;
      }
      const keys = Object.keys(val);
      if (keys.length === 0) return '{}';
      const parts = [];
      if (depth === 0 && !style.rootLeadingNewline) parts.push('{\n');
      else parts.push('\n' + indent + '{\n');
      keys.forEach((key) => {
        const v = val[key];
        if (v === undefined) return;
        if (isKV3LineCommentNode(v) && key.startsWith(KV3_OBJECT_COMMENT_KEY_PREFIX)) {
          parts.push(indent1 + '//' + v.text + '\n');
          return;
        }
        const serialized = serializeKV3Value(v, depth + 1, style, key);
        const k = kv3ObjectKey(key);
        if (serialized.startsWith('\n')) {
          if (style.splitContainerAssignment) parts.push(indent1 + k + ' = ' + serialized + '\n');
          else parts.push(indent1 + k + ' = ' + serialized.trimStart() + '\n');
        } else {
          parts.push(indent1 + k + ' = ' + serialized + '\n');
        }
      });
      parts.push(indent + '}');
      return parts.join('');
    }
    return String(val);
  }

  function parseKV3Document(text) {
    const source = String(text ?? '');
    const match = source.match(/^\s*(<!--\s*kv3[\s\S]*?-->)\s*/i);
    const header = match ? match[1].trim() : '';
    const body = source.replace(/^\s*<!--.*?-->\s*/s, '');
    const parser = new KV3Parser(body);
    return { header, root: parser.parseValue() };
  }

  function kv3ToJSON(text) {
    return parseKV3Document(text).root;
  }

  class KV3Parser {
    constructor(text) {
      this.text = text;
      this.pos = 0;
      this.objectCommentSeq = 0;
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
    skipWhitespaceNoComments() {
      while (this.pos < this.text.length && /[\s]/.test(this.text[this.pos])) this.pos++;
    }
    startsWithLineComment() {
      return (
        this.pos < this.text.length - 1 &&
        this.text[this.pos] === '/' &&
        this.text[this.pos + 1] === '/'
      );
    }
    parseLineCommentNode() {
      this.pos += 2;
      const start = this.pos;
      while (this.pos < this.text.length && this.text[this.pos] !== '\n') this.pos++;
      return createKV3LineComment(this.text.slice(start, this.pos));
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
        return { type: 'resource_name', value: this.parseString() };
      }
      if (this.text.substring(this.pos, this.pos + 11) === 'soundevent:') {
        this.pos += 11;
        return { type: 'soundevent', value: this.parseString() };
      }
      return this.parseLiteral();
    }

    parseObject() {
      this.consume('{');
      const obj = {};
      while (true) {
        this.skipWhitespaceNoComments();
        if (this.pos >= this.text.length || this.text[this.pos] === '}') break;
        if (this.startsWithLineComment()) {
          obj[KV3_OBJECT_COMMENT_KEY_PREFIX + ++this.objectCommentSeq] = this.parseLineCommentNode();
          continue;
        }
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
        this.skipWhitespaceNoComments();
        if (this.pos >= this.text.length || this.text[this.pos] === ']') break;
        if (this.startsWithLineComment()) {
          arr.push(this.parseLineCommentNode());
          continue;
        }
        arr.push(this.parseValue());
        this.skipWhitespaceNoComments();
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
      if (this.pos < this.text.length && this.text[this.pos] === '"') {
        this.consume('"');
        let key = '';
        while (this.pos < this.text.length) {
          const c = this.text[this.pos];
          if (c === '"') {
            this.consume('"');
            return key;
          }
          if (c === '\\' && this.pos + 1 < this.text.length) {
            this.pos++;
            key += this.text[this.pos];
            this.pos++;
            continue;
          }
          key += c;
          this.pos++;
        }
        return key;
      }
      let key = '';
      while (this.pos < this.text.length && /[a-zA-Z0-9_.]/.test(this.text[this.pos])) {
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
    DEFAULT_KV3_HEADER,
    MODELDOC41_KV3_HEADER,
    DEFAULT_STYLE,
    MODELDOC41_STYLE,
    KV3_LINE_COMMENT_FLAG,
    KV3_OBJECT_COMMENT_KEY_PREFIX,
    createKV3LineComment,
    isKV3LineCommentNode,
    detectKV3HeaderFromFileName,
    normalizeKV3Header,
    jsonToKV3,
    parseKV3Document,
    kv3ToJSON,
    KV3Parser,
    serializeKV3Value
  };
});

