//! The KV3 value model.
//!
//! A parsed KV3 document is a tree of [`KvValue`]s. The model mirrors what the
//! text format can express, including constructs that plain JSON cannot:
//! typed/flagged strings (`resource_name:"…"`), `subclass:` values, and line
//! comments that occupy a slot inside an object or array so they survive a
//! round trip through parse → edit → serialize.

/// A single KV3 value.
#[derive(Debug, Clone, PartialEq)]
pub enum KvValue {
    Null,
    Bool(bool),
    /// Integer literal (`42`, `-7`, `0x1F`).
    Int(i64),
    /// Floating point literal (`1.0`, `0.25`, `1e-5`). Kept distinct from
    /// [`KvValue::Int`] so `1.0` does not collapse to `1` on save.
    Double(f64),
    String(String),
    /// A flagged string such as `resource_name:"path"`, `soundevent:"name"`,
    /// `panorama:"file://…"` or `resource:"path"`. The flag is kept verbatim
    /// so unknown flags round-trip unchanged.
    Typed { kind: String, value: String },
    /// A `subclass:` prefixed value (almost always an object).
    Subclass(Box<KvValue>),
    /// A `// line comment` that occupies an element slot in an array, or an
    /// entry slot in an object (where it is stored under an empty key).
    Comment(String),
    Array(Vec<KvValue>),
    /// Object entries in file order. Keys are not deduplicated; comment
    /// entries use an empty key with a [`KvValue::Comment`] value.
    Object(Vec<(String, KvValue)>),
}

/// Well-known flag names for [`KvValue::Typed`].
pub mod typed_kind {
    pub const RESOURCE_NAME: &str = "resource_name";
    pub const RESOURCE: &str = "resource";
    pub const SOUNDEVENT: &str = "soundevent";
    pub const PANORAMA: &str = "panorama";
}

impl KvValue {
    pub fn object() -> Self {
        KvValue::Object(Vec::new())
    }

    pub fn is_container(&self) -> bool {
        matches!(self, KvValue::Array(_) | KvValue::Object(_))
            || matches!(self, KvValue::Subclass(inner) if inner.is_container())
    }

    pub fn type_name(&self) -> &'static str {
        match self {
            KvValue::Null => "null",
            KvValue::Bool(_) => "bool",
            KvValue::Int(_) => "int",
            KvValue::Double(_) => "double",
            KvValue::String(_) => "string",
            KvValue::Typed { .. } => "typed",
            KvValue::Subclass(_) => "subclass",
            KvValue::Comment(_) => "comment",
            KvValue::Array(_) => "array",
            KvValue::Object(_) => "object",
        }
    }

    /// Object field lookup (first match, comments skipped).
    pub fn get(&self, key: &str) -> Option<&KvValue> {
        match self {
            KvValue::Object(entries) => entries
                .iter()
                .find(|(k, v)| k == key && !matches!(v, KvValue::Comment(_)))
                .map(|(_, v)| v),
            KvValue::Subclass(inner) => inner.get(key),
            _ => None,
        }
    }

    /// String content for plain and typed strings.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            KvValue::String(s) => Some(s),
            KvValue::Typed { value, .. } => Some(value),
            _ => None,
        }
    }

    /// Number of nodes in this subtree, including `self` and comments.
    pub fn node_count(&self) -> usize {
        match self {
            KvValue::Array(items) => 1 + items.iter().map(KvValue::node_count).sum::<usize>(),
            KvValue::Object(entries) => {
                1 + entries.iter().map(|(_, v)| v.node_count()).sum::<usize>()
            }
            KvValue::Subclass(inner) => 1 + inner.node_count(),
            _ => 1,
        }
    }
}

impl Default for KvValue {
    fn default() -> Self {
        KvValue::Null
    }
}

fn heuristic_resource_string(s: &str) -> bool {
    s.ends_with(".vmdl") || s.ends_with(".vsmart") || s.ends_with(".vmat")
}

fn num_eq(a: f64, b: f64) -> bool {
    // -0 == 0, NaN == NaN (so a failed round trip of NaN is not reported).
    (a == b) || (a.is_nan() && b.is_nan())
}

/// Semantic equality between two trees: catches real data loss while
/// accepting benign serializer normalizations, mirroring
/// `tests/kv3-semantic-equal.js` from the original JavaScript code base:
///
/// - `-0` equals `0`, `Int(n)` equals `Double(n)` when exact,
/// - a plain string that the serializer upgrades to `resource_name:"…"`
///   (paths ending in `.vmdl` / `.vsmart` / `.vmat`) equals that typed value.
///
/// On mismatch returns the path of the first differing node.
pub fn semantic_compare(a: &KvValue, b: &KvValue, path: &str) -> Result<(), String> {
    use KvValue::*;
    let fail = |what: &str| Err(format!("{path}: {what} ({a:?} vs {b:?})"));
    match (a, b) {
        (Null, Null) => Ok(()),
        (Bool(x), Bool(y)) if x == y => Ok(()),
        (Int(x), Int(y)) if x == y => Ok(()),
        (Double(x), Double(y)) if num_eq(*x, *y) => Ok(()),
        (Int(x), Double(y)) | (Double(y), Int(x)) if num_eq(*x as f64, *y) => Ok(()),
        (String(x), String(y)) if x == y => Ok(()),
        (Comment(x), Comment(y)) if x == y => Ok(()),
        (Typed { kind: ka, value: va }, Typed { kind: kb, value: vb }) => {
            if ka == kb && va == vb {
                Ok(())
            } else {
                fail("typed value mismatch")
            }
        }
        (String(s), Typed { kind, value }) | (Typed { kind, value }, String(s))
            if kind == typed_kind::RESOURCE_NAME && s == value && heuristic_resource_string(s) =>
        {
            Ok(())
        }
        (Subclass(x), Subclass(y)) => semantic_compare(x, y, &format!("{path}<subclass>")),
        (Array(xs), Array(ys)) => {
            if xs.len() != ys.len() {
                return fail("array length mismatch");
            }
            for (i, (x, y)) in xs.iter().zip(ys).enumerate() {
                semantic_compare(x, y, &format!("{path}[{i}]"))?;
            }
            Ok(())
        }
        (Object(xs), Object(ys)) => {
            if xs.len() != ys.len() {
                return fail("object entry count mismatch");
            }
            for ((ka, va), (kb, vb)) in xs.iter().zip(ys) {
                if ka != kb {
                    return fail("object key mismatch");
                }
                semantic_compare(va, vb, &format!("{path}.{ka}"))?;
            }
            Ok(())
        }
        _ => fail("type mismatch"),
    }
}

/// Convenience wrapper: `Ok(())` when the trees are semantically equal.
pub fn semantic_eq(a: &KvValue, b: &KvValue) -> Result<(), String> {
    semantic_compare(a, b, "$")
}
