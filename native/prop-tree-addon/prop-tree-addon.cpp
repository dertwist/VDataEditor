#include <node_api.h>

#include <cctype>
#include <cstring>
#include <string>
#include <vector>

namespace {

static bool isLikelyArray(napi_env env, napi_value v) {
  bool isArr = false;
  napi_is_array(env, v, &isArr);
  return isArr;
}

static bool isLikelyObject(napi_env env, napi_value v) {
  napi_valuetype t;
  napi_typeof(env, v, &t);
  if (t != napi_object) return false;

  // JS null is object per typeof check.
  bool isNull = false;
  napi_is_null(env, v, &isNull);
  if (isNull) return false;

  return true;
}

static napi_value makeString(napi_env env, const char* s) {
  napi_value out = nullptr;
  napi_create_string_utf8(env, s, std::strlen(s), &out);
  return out;
}

static napi_value makeBoolean(napi_env env, bool b) {
  napi_value out = nullptr;
  napi_get_boolean(env, b, &out);
  return out;
}

static napi_value makeRow(napi_env env,
                           const std::string& key,
                           const std::string& propPath,
                           const std::string& kind,
                           bool isExpandable,
                           bool collapsedByDefault) {
  napi_value obj = nullptr;
  napi_create_object(env, &obj);

  napi_set_named_property(env, obj, "key", makeString(env, key.c_str()));
  napi_set_named_property(env, obj, "propPath", makeString(env, propPath.c_str()));
  napi_set_named_property(env, obj, "kind", makeString(env, kind.c_str()));
  napi_set_named_property(env, obj, "isExpandable", makeBoolean(env, isExpandable));
  napi_set_named_property(env, obj, "collapsedByDefault", makeBoolean(env, collapsedByDefault));
  return obj;
}

struct Options {
  bool collapsedDefaultDepth0 = true;
};

static Options readOptions(napi_env env, napi_value optionsVal) {
  Options opts;
  if (!optionsVal) return opts;
  napi_valuetype t;
  napi_typeof(env, optionsVal, &t);
  if (t != napi_object) return opts;

  napi_value v = nullptr;
  bool has = false;
  napi_has_named_property(env, optionsVal, "collapsedDefaultDepth0", &has);
  if (!has) return opts;
  napi_get_named_property(env, optionsVal, "collapsedDefaultDepth0", &v);
  if (v) {
    bool b = false;
    napi_get_value_bool(env, v, &b);
    opts.collapsedDefaultDepth0 = b;
  }
  return opts;
}

static napi_value BuildInitialPropTreePlan(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2] = {nullptr, nullptr};
  napi_status st = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (st != napi_ok || argc < 1) {
    napi_value err = nullptr;
    napi_create_string_utf8(env, "Expected root (and optional options)", 42, &err);
    return err;
  }

  napi_value root = args[0];
  napi_value optionsVal = argc >= 2 ? args[1] : nullptr;
  Options opts = readOptions(env, optionsVal);

  napi_value rowsArr = nullptr;
  napi_create_array(env, &rowsArr);

  if (!isLikelyObject(env, root)) {
    napi_value out = nullptr;
    napi_create_object(env, &out);
    napi_set_named_property(env, out, "rows", rowsArr);
    return out;
  }

  napi_value propNames = nullptr;
  st = napi_get_property_names(env, root, &propNames);
  if (st != napi_ok || propNames == nullptr) {
    napi_value out = nullptr;
    napi_create_object(env, &out);
    napi_set_named_property(env, out, "rows", rowsArr);
    return out;
  }

  uint32_t len = 0;
  napi_get_array_length(env, propNames, &len);

  for (uint32_t i = 0; i < len; i++) {
    napi_value nameVal = nullptr;
    napi_get_element(env, propNames, i, &nameVal);
    if (!nameVal) continue;

    // Property names from N-API should be strings for our use case.
    size_t nlen = 0;
    st = napi_get_value_string_utf8(env, nameVal, nullptr, 0, &nlen);
    if (st != napi_ok) continue;

    std::string key;
    key.resize(nlen + 1);
    st = napi_get_value_string_utf8(env, nameVal, key.data(), nlen + 1, &nlen);
    if (st != napi_ok) continue;
    key.resize(nlen);

    // Get value at root[key]
    napi_value v = nullptr;
    napi_get_named_property(env, root, key.c_str(), &v);

    bool isArr = isLikelyArray(env, v);
    bool isObj = isLikelyObject(env, v);

    std::string kind = "scalar";
    bool isExpandable = false;
    if (isArr) {
      kind = "array";
      isExpandable = true;
    } else if (isObj) {
      kind = "object";
      isExpandable = true;
    } else {
      // null is scalar-ish for our UI purposes.
      kind = "scalar";
    }

    bool collapsedByDefault = opts.collapsedDefaultDepth0 && isExpandable;
    std::string propPath = key; // depth 0 root children

    napi_value row = makeRow(env, key, propPath, kind, isExpandable, collapsedByDefault);
    napi_set_element(env, rowsArr, i, row);
  }

  napi_value out = nullptr;
  napi_create_object(env, &out);
  napi_set_named_property(env, out, "rows", rowsArr);
  return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn = nullptr;
  napi_create_function(env, "buildPropTreeInitialPlan", NAPI_AUTO_LENGTH, BuildInitialPropTreePlan, nullptr, &fn);
  napi_set_named_property(env, exports, "buildPropTreeInitialPlan", fn);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

