//! Conversion between [`KvValue`] and JSON for the text pane's JSON mode.
//!
//! Uses the same conventions as the original editor so JSON exported there
//! imports here unchanged: typed strings become `{"type": "...", "value":
//! "..."}` objects, subclass values become `{"type": "subclass", "value":
//! {...}}`, line comments become `{"__kv3LineComment": true, "text": "..."}`
//! (object-level comments under `__kv3_obj_comment_<n>` keys).

use kv3::KvValue;
use serde_json::{Map, Number, Value, json};

pub const LINE_COMMENT_FLAG: &str = "__kv3LineComment";
pub const OBJ_COMMENT_KEY_PREFIX: &str = "__kv3_obj_comment_";

pub fn kv_to_json(value: &KvValue) -> Value {
    match value {
        KvValue::Null => Value::Null,
        KvValue::Bool(b) => Value::Bool(*b),
        KvValue::Int(v) => Value::Number((*v).into()),
        KvValue::Double(v) => Number::from_f64(*v).map(Value::Number).unwrap_or(Value::Null),
        KvValue::String(s) => Value::String(s.clone()),
        KvValue::Typed { kind, value } => json!({ "type": kind, "value": value }),
        KvValue::Subclass(inner) => json!({ "type": "subclass", "value": kv_to_json(inner) }),
        KvValue::Comment(text) => json!({ LINE_COMMENT_FLAG: true, "text": text }),
        KvValue::Array(items) => Value::Array(items.iter().map(kv_to_json).collect()),
        KvValue::Object(entries) => {
            let mut map = Map::with_capacity(entries.len());
            let mut comment_seq = 0usize;
            for (key, value) in entries {
                if matches!(value, KvValue::Comment(_)) {
                    comment_seq += 1;
                    map.insert(format!("{OBJ_COMMENT_KEY_PREFIX}{comment_seq}"), kv_to_json(value));
                } else {
                    map.insert(key.clone(), kv_to_json(value));
                }
            }
            Value::Object(map)
        }
    }
}

pub fn json_to_kv(value: &Value) -> KvValue {
    match value {
        Value::Null => KvValue::Null,
        Value::Bool(b) => KvValue::Bool(*b),
        Value::Number(n) => {
            if let Some(v) = n.as_i64() {
                KvValue::Int(v)
            } else {
                KvValue::Double(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => KvValue::String(s.clone()),
        Value::Array(items) => KvValue::Array(items.iter().map(json_to_kv).collect()),
        Value::Object(map) => {
            // Comment node?
            if map.get(LINE_COMMENT_FLAG) == Some(&Value::Bool(true)) {
                if let Some(Value::String(text)) = map.get("text") {
                    if map.len() == 2 {
                        return KvValue::Comment(text.clone());
                    }
                }
            }
            // Typed node {type, value}?
            if map.len() == 2 {
                if let (Some(Value::String(kind)), Some(inner)) = (map.get("type"), map.get("value"))
                {
                    if kind == "subclass" {
                        return KvValue::Subclass(Box::new(json_to_kv(inner)));
                    }
                    if let Value::String(s) = inner {
                        return KvValue::Typed {
                            kind: kind.clone(),
                            value: s.clone(),
                        };
                    }
                }
            }
            KvValue::Object(
                map.iter()
                    .map(|(k, v)| {
                        let kv = json_to_kv(v);
                        if k.starts_with(OBJ_COMMENT_KEY_PREFIX) && matches!(kv, KvValue::Comment(_))
                        {
                            (String::new(), kv)
                        } else {
                            (k.clone(), kv)
                        }
                    })
                    .collect(),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_all_constructs() {
        let source = r#"{
            // a comment
            name = "x"
            count = 3
            ratio = 0.5
            on = true
            none = null
            model = resource_name:"models/a.vmdl"
            sub = subclass: { _class = "y" }
            list = [1, 2, // inline
                3]
        }"#;
        let kv = kv3::parse_value_text(source);
        let json = kv_to_json(&kv);
        let back = json_to_kv(&json);
        assert_eq!(kv, back);
    }
}
