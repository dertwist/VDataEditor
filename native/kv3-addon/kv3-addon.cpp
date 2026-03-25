#include <node_api.h>

#include <cctype>
#include <cerrno>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <string>

namespace {

static bool isWhitespace(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
}

static void trimInPlace(std::string& s) {
  size_t start = 0;
  while (start < s.size() && isWhitespace(s[start])) start++;
  size_t end = s.size();
  while (end > start && isWhitespace(s[end - 1])) end--;
  s = s.substr(start, end - start);
}

static bool startsWithInsensitiveKV3(const std::string& s, size_t pos) {
  // Expect: "<!--" then optional whitespace then "kv3" (case-insensitive for k/v)
  if (pos + 4 > s.size()) return false;
  if (s.compare(pos, 4, "<!--") != 0) return false;
  size_t j = pos + 4;
  while (j < s.size() && isWhitespace(s[j])) j++;
  if (j + 3 > s.size()) return false;
  char k = s[j + 0];
  char v = s[j + 1];
  char three = s[j + 2];
  auto lower = [](char ch) -> char { return (char)std::tolower((unsigned char)ch); };
  return lower(k) == 'k' && lower(v) == 'v' && three == '3';
}

class Kv3Parser {
 public:
  Kv3Parser(napi_env env, std::string input) : env_(env), text_(std::move(input)) {}

  napi_value parseKv3Document() {
    // Match JS format/kv3.js:
    //  - header match: /^\s*(<!--\s*kv3[\s\S]*?-->)\s*/i (captured + trimmed)
    //  - body remove: source.replace(/^\s*<!--.*?-->\s*/s,'')
    std::string header;
    std::string body;
    bool bodySet = false;

    size_t i = 0;
    while (i < text_.size() && isWhitespace(text_[i])) i++;

    if (i < text_.size() && text_.compare(i, 4, "<!--") == 0) {
      size_t commentEnd = text_.find("-->", i + 4);
      if (commentEnd != std::string::npos) {
        // Header extraction only if it's a kv3 header comment.
        if (startsWithInsensitiveKV3(text_, i)) {
          header = text_.substr(i, (commentEnd + 3) - i);
          trimInPlace(header);
        } else {
          header.clear();
        }
        // Remove the first html comment block regardless of its contents.
        body = text_.substr(commentEnd + 3);
        bodySet = true;
        // JS regex also strips whitespace after comment.
        size_t b = 0;
        while (b < body.size() && isWhitespace(body[b])) b++;
        if (b) body.erase(0, b);
      }
    }

    if (!bodySet) {
      body = text_;
    }

    Kv3Parser parser(env_, std::move(body));
    napi_value root = parser.parseValue();

    napi_value out = nullptr;
    napi_status st = napi_create_object(env_, &out);
    if (st != napi_ok) return nullptr;

    napi_value headerStr = nullptr;
    napi_create_string_utf8(env_, header.c_str(), header.size(), &headerStr);
    napi_set_named_property(env_, out, "header", headerStr);

    napi_set_named_property(env_, out, "root", root);
    return out;
  }

  napi_value parseValue() {
    skipWhitespace();
    if (pos_ >= text_.size()) {
      return parseLiteral();
    }
    char ch = text_[pos_];
    if (ch == '{') return parseObject();
    if (ch == '[') return parseArray();
    if (ch == '"') return parseString();

    if (text_.compare(pos_, 14, "resource_name:") == 0) {
      pos_ += 14;
      napi_value typed = createTypedAtom("resource_name", parseString());
      return typed;
    }
    if (text_.compare(pos_, 11, "soundevent:") == 0) {
      pos_ += 11;
      napi_value typed = createTypedAtom("soundevent", parseString());
      return typed;
    }
    if (text_.compare(pos_, 9, "panorama:") == 0) {
      pos_ += 9;
      napi_value typed = createTypedAtom("panorama", parseString());
      return typed;
    }

    return parseLiteral();
  }

 private:
  napi_env env_{};
  std::string text_;
  size_t pos_ = 0;
  int objectCommentSeq_ = 0;

  void skipWhitespace() {
    // JS: skips whitespace, then recursively skips at most one block comment or one line comment at the current position.
    // We implement as a loop.
    for (;;) {
      while (pos_ < text_.size() && isWhitespace(text_[pos_])) pos_++;
      if (startsWithBlockComment()) {
        skipBlockComment();
        continue;
      }
      if (startsWithLineComment()) {
        // Skip until newline, keep newline for whitespace skipping.
        pos_ += 2;
        while (pos_ < text_.size() && text_[pos_] != '\n') pos_++;
        continue;
      }
      break;
    }
  }

  void skipWhitespaceNoComments() {
    while (pos_ < text_.size() && isWhitespace(text_[pos_])) pos_++;
  }

  bool startsWithLineComment() const {
    return pos_ + 1 < text_.size() && text_[pos_] == '/' && text_[pos_ + 1] == '/';
  }

  bool startsWithBlockComment() const {
    return pos_ + 1 < text_.size() && text_[pos_] == '/' && text_[pos_ + 1] == '*';
  }

  void skipBlockComment() {
    if (!startsWithBlockComment()) return;
    pos_ += 2; // /*
    while (pos_ < text_.size()) {
      if (text_[pos_] == '*' && pos_ + 1 < text_.size() && text_[pos_ + 1] == '/') {
        pos_ += 2;
        return;
      }
      pos_++;
    }
  }

  void consumeChar(char ch) {
    skipWhitespace();
    if (pos_ < text_.size() && text_[pos_] == ch) pos_++;
  }

  napi_value createLineCommentNode(const std::string& commentText) {
    napi_value obj = nullptr;
    napi_create_object(env_, &obj);
    napi_value flag = nullptr;
    napi_get_boolean(env_, true, &flag);
    napi_set_named_property(env_, obj, "__kv3LineComment", flag);
    napi_value t = nullptr;
    napi_create_string_utf8(env_, commentText.c_str(), commentText.size(), &t);
    napi_set_named_property(env_, obj, "text", t);
    return obj;
  }

  std::string parseLineCommentText() {
    // Assumes startsWithLineComment() == true
    pos_ += 2; // //
    size_t start = pos_;
    while (pos_ < text_.size() && text_[pos_] != '\n') pos_++;
    return text_.substr(start, pos_ - start);
  }

  napi_value parseObject() {
    consumeChar('{');
    napi_value obj = nullptr;
    napi_create_object(env_, &obj);

    for (;;) {
      skipWhitespaceNoComments();
      while (startsWithBlockComment()) {
        skipBlockComment();
        skipWhitespaceNoComments();
      }

      if (pos_ >= text_.size() || text_[pos_] == '}') break;

      if (startsWithLineComment()) {
        std::string ctext = parseLineCommentText();
        std::string key = "__kv3_obj_comment_";
        key += std::to_string(++objectCommentSeq_);
        napi_value v = createLineCommentNode(ctext);
        napi_value propKey = nullptr;
        napi_create_string_utf8(env_, key.c_str(), key.size(), &propKey);
        napi_set_property(env_, obj, propKey, v);
        continue;
      }

      std::string key = parseKeyString();

      if (key.empty() && pos_ < text_.size() && text_[pos_] == ',') {
        pos_++;
        continue;
      }

      skipWhitespace();
      consumeChar('=');
      napi_value v = parseValue();
      napi_value propKey = nullptr;
      napi_create_string_utf8(env_, key.c_str(), key.size(), &propKey);
      napi_set_property(env_, obj, propKey, v);
    }

    consumeChar('}');
    return obj;
  }

  napi_value parseArray() {
    consumeChar('[');
    napi_value arr = nullptr;
    napi_create_array(env_, &arr);
    uint32_t idx = 0;

    for (;;) {
      skipWhitespaceNoComments();
      while (startsWithBlockComment()) {
        skipBlockComment();
        skipWhitespaceNoComments();
      }

      if (pos_ >= text_.size() || text_[pos_] == ']') break;

      if (startsWithLineComment()) {
        std::string ctext = parseLineCommentText();
        napi_value v = createLineCommentNode(ctext);
        napi_set_element(env_, arr, idx++, v);
        continue;
      }

      napi_value v = parseValue();
      napi_set_element(env_, arr, idx++, v);

      skipWhitespaceNoComments();
      if (pos_ < text_.size() && text_[pos_] == ',') pos_++;
    }

    consumeChar(']');
    return arr;
  }

  std::string parseKeyString() {
    skipWhitespace();
    if (pos_ < text_.size() && text_[pos_] == '"') {
      consumeChar('"');
      std::string key;
      while (pos_ < text_.size()) {
        char c = text_[pos_];
        if (c == '"') {
          consumeChar('"');
          return key;
        }
        if (c == '\\' && pos_ + 1 < text_.size()) {
          pos_++; // skip '\'
          key.push_back(text_[pos_]);
          pos_++;
          continue;
        }
        key.push_back(c);
        pos_++;
      }
      return key;
    }

    std::string key;
    while (pos_ < text_.size()) {
      char c = text_[pos_];
      bool ok =
          (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.';
      if (!ok) break;
      key.push_back(c);
      pos_++;
    }
    return key;
  }

  napi_value parseString() {
    consumeChar('"');
    std::string out;
    while (pos_ < text_.size() && text_[pos_] != '"') {
      if (text_[pos_] == '\\') {
        pos_++;
        if (pos_ < text_.size()) {
          out.push_back(text_[pos_]);
          pos_++;
        }
        continue;
      }
      out.push_back(text_[pos_]);
      pos_++;
    }
    consumeChar('"');

    napi_value s = nullptr;
    napi_create_string_utf8(env_, out.c_str(), out.size(), &s);
    return s;
  }

  napi_value parseLiteral() {
    skipWhitespace();
    std::string lit;
    while (pos_ < text_.size()) {
      char c = text_[pos_];
      if (isWhitespace(c) || c == ',' || c == '}' || c == ']' || c == '=') break;
      lit.push_back(c);
      pos_++;
    }

    if (lit == "true") {
      napi_value b = nullptr;
      napi_get_boolean(env_, true, &b);
      return b;
    }
    if (lit == "false") {
      napi_value b = nullptr;
      napi_get_boolean(env_, false, &b);
      return b;
    }
    if (lit == "null") {
      napi_value n = nullptr;
      napi_get_null(env_, &n);
      return n;
    }
    if (lit.empty()) {
      napi_value s = nullptr;
      napi_create_string_utf8(env_, lit.c_str(), 0, &s);
      return s;
    }

    // Match JS's Number(lit) behavior closely enough for KV3 literals.
    // We accept only full-consumption conversions; otherwise return the original string.
    char* endPtr = nullptr;
    const char* cstr = lit.c_str();
    errno = 0;
    double num = std::strtod(cstr, &endPtr);
    bool ok = endPtr != nullptr && endPtr == cstr + lit.size() && errno == 0 && !std::isnan(num);
    if (ok) {
      napi_value n = nullptr;
      napi_create_double(env_, num, &n);
      return n;
    }

    napi_value s = nullptr;
    napi_create_string_utf8(env_, lit.c_str(), lit.size(), &s);
    return s;
  }

  napi_value createTypedAtom(const char* type, napi_value val) {
    napi_value obj = nullptr;
    napi_create_object(env_, &obj);

    napi_value typeStr = nullptr;
    napi_create_string_utf8(env_, type, std::strlen(type), &typeStr);
    napi_set_named_property(env_, obj, "type", typeStr);
    napi_set_named_property(env_, obj, "value", val);
    return obj;
  }
};

napi_value ParseKv3DocumentWrapped(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_status st = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (st != napi_ok || argc < 1) {
    napi_value err = nullptr;
    napi_create_string_utf8(env, "Expected one string argument", 33, &err);
    return err;
  }

  size_t strLen = 0;
  st = napi_get_value_string_utf8(env, args[0], nullptr, 0, &strLen);
  if (st != napi_ok) return nullptr;

  // napi_get_value_string_utf8 writes a terminating '\0' when the buffer is large enough.
  // Use +1 capacity and then resize back to the actual length.
  std::string input;
  input.resize(strLen + 1);
  st = napi_get_value_string_utf8(env, args[0], input.data(), strLen + 1, &strLen);
  if (st != napi_ok) return nullptr;
  input.resize(strLen);

  Kv3Parser parser(env, std::move(input));
  return parser.parseKv3Document();
}

} // namespace

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn = nullptr;
  napi_create_function(env, "parseKv3Document", NAPI_AUTO_LENGTH, ParseKv3DocumentWrapped, nullptr, &fn);
  napi_set_named_property(env, exports, "parseKv3Document", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

