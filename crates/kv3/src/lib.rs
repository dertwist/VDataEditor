//! Parser and serializer for Valve Source 2 **KV3** text files
//! (`.vdata`, `.vsmart`, `.vpcf`, `.kv3`, `.vmdl`, …) plus the legacy
//! **KeyValues** format (`.vmat`, `.vmt`).
//!
//! Design goals, carried over from the JavaScript implementation this crate
//! replaces and verified by the same test corpus:
//!
//! * **Round-trip safety** — comments, typed strings (`resource_name:"…"`,
//!   `soundevent:"…"`, `panorama:"…"`), `subclass:` values, multi-line
//!   strings and the document header all survive parse → serialize.
//! * **Permissiveness** — parsing never fails; malformed input produces a
//!   best-effort tree plus [`ParseIssue`] diagnostics.
//! * **Speed** — byte-oriented scanning with minimal allocation; multi-MB
//!   game assets parse in tens of milliseconds.

mod keyvalues;
mod parse;
mod ser;
mod value;

pub use keyvalues::{parse_keyvalues, to_keyvalues_text};
pub use parse::{ParseIssue, ParseOutcome, line_col, parse_value_text, parse_value_with_issues};
pub use ser::{
    DEFAULT_KV3_HEADER, DEFAULT_STYLE, MODELDOC41_KV3_HEADER, MODELDOC41_STYLE, Style,
    detect_header_from_file_name, normalize_header, to_kv3_text,
};
pub use value::{KvValue, semantic_compare, semantic_eq, typed_kind};

/// A parsed KV3 document: header + style + value tree + diagnostics.
#[derive(Debug, Clone)]
pub struct Kv3Document {
    /// The `<!-- kv3 … -->` header found in the file, or empty.
    pub header: String,
    /// Formatting style detected from the header/body, reused when saving.
    pub style: Style,
    pub root: KvValue,
    pub issues: Vec<ParseIssue>,
}

impl Kv3Document {
    /// Parse a complete KV3 file (header optional).
    pub fn parse(text: &str) -> Self {
        let (header, body) = split_header(text);
        let style = Style::detect(&header, body);
        let outcome = parse_value_with_issues(body);
        Kv3Document {
            header,
            style,
            root: outcome.value,
            issues: outcome.issues,
        }
    }

    /// Serialize back to text, preserving the original header and style.
    /// `file_name` is only used to pick a default header when none was
    /// detected at parse time.
    pub fn to_text(&self, file_name: &str) -> String {
        let header = if self.header.is_empty() {
            detect_header_from_file_name(file_name).to_owned()
        } else {
            self.header.clone()
        };
        to_kv3_text(&self.root, &header, self.style)
    }
}

/// Serialize a value tree with default header/style selection, mirroring the
/// original `jsonToKV3(obj, { header, fileName })`.
pub fn to_kv3_text_with_options(
    root: &KvValue,
    header: Option<&str>,
    file_name: Option<&str>,
) -> String {
    let header = header
        .and_then(normalize_header)
        .unwrap_or_else(|| detect_header_from_file_name(file_name.unwrap_or("")).to_owned());
    let style = if header.contains("format:modeldoc41") {
        MODELDOC41_STYLE
    } else {
        DEFAULT_STYLE
    };
    to_kv3_text(root, &header, style)
}

/// Split an optional leading `<!-- … -->` comment off the document.
///
/// Mirrors the original implementation: the first leading HTML-style comment
/// is always removed from the body, but it is only *kept* as the document
/// header when it starts with `kv3`.
fn split_header(text: &str) -> (String, &str) {
    let trimmed_start = text.trim_start();
    if !trimmed_start.starts_with("<!--") {
        return (String::new(), text);
    }
    let Some(end) = trimmed_start.find("-->") else {
        return (String::new(), text);
    };
    let comment = &trimmed_start[..end + 3];
    let body = &trimmed_start[end + 3..];
    let inner = comment[4..].trim_start();
    let is_kv3 = inner.len() >= 3 && inner[..3].eq_ignore_ascii_case("kv3");
    let header = if is_kv3 {
        comment.trim().to_owned()
    } else {
        String::new()
    };
    (header, body)
}

/// Render a non-scalar value as a single-line string for contexts that only
/// accept scalars (legacy KeyValues output of arrays).
pub(crate) fn ser_debug_scalar(out: &mut String, v: &KvValue) {
    use std::fmt::Write;
    match v {
        KvValue::Null => out.push_str("null"),
        KvValue::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        KvValue::Int(n) => {
            let _ = write!(out, "{n}");
        }
        KvValue::Double(n) => {
            let _ = write!(out, "{n}");
        }
        KvValue::String(s) | KvValue::Typed { value: s, .. } | KvValue::Comment(s) => {
            let _ = write!(out, "{s:?}");
        }
        KvValue::Subclass(inner) => ser_debug_scalar(out, inner),
        KvValue::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                ser_debug_scalar(out, item);
            }
            out.push(']');
        }
        KvValue::Object(entries) => {
            out.push('{');
            let mut first = true;
            for (k, val) in entries {
                if matches!(val, KvValue::Comment(_)) {
                    continue;
                }
                if !first {
                    out.push(',');
                }
                first = false;
                let _ = write!(out, "{k:?}:");
                ser_debug_scalar(out, val);
            }
            out.push('}');
        }
    }
}
