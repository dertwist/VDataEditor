//! KV3 text serializer.
//!
//! Output follows the conventions of the original editor: tab indentation,
//! `key = value` assignments, inline numeric arrays, and two style presets
//! (generic and `modeldoc41`). [`Style::detect`] additionally sniffs the
//! style actually used by an existing file so a load → save round trip stays
//! close to byte-identical for Valve-authored assets.

use crate::value::KvValue;

pub const DEFAULT_KV3_HEADER: &str = "<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->";
pub const MODELDOC41_KV3_HEADER: &str = "<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:modeldoc41:version{12fc9d44-453a-4ae4-b4d9-7e2ac0bbd4e0} -->";

/// Formatting knobs that differ between KV3 producers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Style {
    /// `key = \n{` (Valve style) instead of `key = {`.
    pub split_container_assignment: bool,
    /// Emit a comma after the last array element.
    pub trailing_array_commas: bool,
    /// Render empty arrays as `[  ]` instead of `[]`.
    pub spaced_empty_array: bool,
    /// Put the root `{` on its own line preceded by a blank line.
    pub root_leading_newline: bool,
}

pub const DEFAULT_STYLE: Style = Style {
    split_container_assignment: false,
    trailing_array_commas: false,
    spaced_empty_array: false,
    root_leading_newline: false,
};

pub const MODELDOC41_STYLE: Style = Style {
    split_container_assignment: true,
    trailing_array_commas: true,
    spaced_empty_array: true,
    root_leading_newline: false,
};

impl Default for Style {
    fn default() -> Self {
        DEFAULT_STYLE
    }
}

impl Style {
    /// Sniff the formatting style of an existing document body so that
    /// saving reproduces what the file already looked like.
    pub fn detect(header: &str, body: &str) -> Style {
        if header.contains("format:modeldoc41") {
            return MODELDOC41_STYLE;
        }
        let sample = &body[..body.len().min(64 * 1024)];
        let bytes = sample.as_bytes();
        let mut split = false;
        let mut trailing = false;
        for (i, &b) in bytes.iter().enumerate() {
            match b {
                b'=' | b',' => {
                    let mut j = i + 1;
                    let mut saw_newline = false;
                    while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\r' | b'\n') {
                        saw_newline |= bytes[j] == b'\n';
                        j += 1;
                    }
                    if j >= bytes.len() {
                        break;
                    }
                    if b == b'=' && saw_newline && matches!(bytes[j], b'{' | b'[') {
                        split = true;
                    }
                    if b == b',' && saw_newline && bytes[j] == b']' {
                        trailing = true;
                    }
                }
                _ => {}
            }
            if split && trailing {
                break;
            }
        }
        Style {
            split_container_assignment: split,
            trailing_array_commas: trailing,
            spaced_empty_array: sample.contains("[  ]"),
            root_leading_newline: false,
        }
    }
}

/// Pick a header based on the file name (`.vmdl` → modeldoc41).
pub fn detect_header_from_file_name(file_name: &str) -> &'static str {
    if file_name.to_ascii_lowercase().ends_with(".vmdl") {
        MODELDOC41_KV3_HEADER
    } else {
        DEFAULT_KV3_HEADER
    }
}

/// Normalize a user-supplied header: accept `<!-- kv3 … -->` verbatim or a
/// bare `kv3 …` line; anything else yields `None`.
pub fn normalize_header(header: &str) -> Option<String> {
    let trimmed = header.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("<!--") && trimmed.ends_with("-->") {
        return Some(trimmed.to_owned());
    }
    if trimmed.starts_with("kv3 ") {
        return Some(format!("<!-- {trimmed} -->"));
    }
    None
}

/// Serialize a full document: header line plus the value tree.
pub fn to_kv3_text(root: &KvValue, header: &str, style: Style) -> String {
    let mut out = String::with_capacity(4096);
    out.push_str(header);
    out.push('\n');
    write_value(&mut out, root, 0, style, "");
    out
}

fn escape_into(out: &mut String, s: &str) {
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            _ => out.push(ch),
        }
    }
}

fn write_quoted(out: &mut String, s: &str) {
    if s.contains('\n') && !s.contains("\"\"\"") {
        // Multi-line strings use the raw triple-quote form.
        out.push_str("\"\"\"");
        out.push_str(s);
        out.push_str("\"\"\"");
        return;
    }
    out.push('"');
    escape_into(out, s);
    out.push('"');
}

fn is_identifier_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    match bytes.first() {
        Some(b) if b.is_ascii_alphabetic() || *b == b'_' => {}
        _ => return false,
    }
    bytes[1..]
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.'))
}

fn write_key(out: &mut String, key: &str) {
    if is_identifier_key(key) {
        out.push_str(key);
    } else {
        out.push('"');
        escape_into(out, key);
        out.push('"');
    }
}

fn write_int(out: &mut String, v: i64, key_name: &str) {
    use std::fmt::Write;
    let _ = write!(out, "{v}");
    if key_name == "import_scale" {
        out.push_str(".0");
    }
}

fn write_double(out: &mut String, v: f64) {
    use std::fmt::Write;
    if !v.is_finite() {
        // KV3 text has no inf/nan literal; degrade gracefully.
        out.push_str(if v.is_nan() { "0.0" } else if v > 0.0 { "1e308" } else { "-1e308" });
        return;
    }
    let start = out.len();
    let _ = write!(out, "{v}");
    // Keep doubles recognizably doubles ("1.0", not "1").
    if !out[start..].contains(['.', 'e', 'E']) {
        out.push_str(".0");
    }
}

fn push_indent(out: &mut String, depth: usize) {
    for _ in 0..depth {
        out.push('\t');
    }
}

fn is_numeric(v: &KvValue) -> bool {
    matches!(v, KvValue::Int(_) | KvValue::Double(_))
}

/// Serialize one value. Containers may start with `\n` so the caller can
/// apply the style's container-assignment rule, mirroring the original
/// serializer's behavior.
fn write_value(out: &mut String, val: &KvValue, depth: usize, style: Style, key_name: &str) {
    match val {
        KvValue::Null => out.push_str("null"),
        KvValue::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        KvValue::Int(v) => write_int(out, *v, key_name),
        KvValue::Double(v) => write_double(out, *v),
        KvValue::String(s) => {
            if s.ends_with(".vmdl") || s.ends_with(".vsmart") || s.ends_with(".vmat") {
                // Heuristic kept from the original editor: resource paths
                // serialize with an explicit resource_name flag.
                out.push_str("resource_name:");
            }
            write_quoted(out, s);
        }
        KvValue::Typed { kind, value } => {
            out.push_str(kind);
            out.push(':');
            write_quoted(out, value);
        }
        KvValue::Subclass(inner) => {
            out.push_str("subclass:");
            let start = out.len();
            write_value(out, inner, depth + 1, style, "");
            if !out[start..].starts_with('\n') {
                out.insert(start, '\n');
            }
        }
        KvValue::Comment(text) => {
            out.push_str("//");
            out.push_str(text);
        }
        KvValue::Array(items) => write_array(out, items, depth, style),
        KvValue::Object(entries) => write_object(out, entries, depth, style),
    }
}

fn write_array(out: &mut String, items: &[KvValue], depth: usize, style: Style) {
    if items.is_empty() {
        out.push_str(if style.spaced_empty_array { "[  ]" } else { "[]" });
        return;
    }
    if items.iter().all(is_numeric) {
        out.push('[');
        for (i, item) in items.iter().enumerate() {
            if i > 0 {
                out.push_str(", ");
            }
            write_value(out, item, depth, style, "");
        }
        out.push(']');
        return;
    }
    out.push('\n');
    push_indent(out, depth);
    out.push_str("[\n");
    let last = items.len() - 1;
    for (i, item) in items.iter().enumerate() {
        push_indent(out, depth + 1);
        if let KvValue::Comment(text) = item {
            out.push_str("//");
            out.push_str(text);
        } else {
            let start = out.len();
            write_value(out, item, depth + 1, style, "");
            trim_leading_ws_at(out, start);
            if i < last || style.trailing_array_commas {
                out.push(',');
            }
        }
        out.push('\n');
    }
    push_indent(out, depth);
    out.push(']');
}

fn write_object(out: &mut String, entries: &[(String, KvValue)], depth: usize, style: Style) {
    if entries.is_empty() {
        out.push_str("{}");
        return;
    }
    if depth == 0 && !style.root_leading_newline {
        out.push_str("{\n");
    } else {
        out.push('\n');
        push_indent(out, depth);
        out.push_str("{\n");
    }
    for (key, value) in entries {
        push_indent(out, depth + 1);
        if let KvValue::Comment(text) = value {
            out.push_str("//");
            out.push_str(text);
            out.push('\n');
            continue;
        }
        write_key(out, key);
        out.push_str(" = ");
        let start = out.len();
        write_value(out, value, depth + 1, style, key);
        if out[start..].starts_with('\n') && !style.split_container_assignment {
            trim_leading_ws_at(out, start);
        }
        out.push('\n');
    }
    push_indent(out, depth);
    out.push('}');
}

/// Remove leading whitespace from `out[start..]` in place.
fn trim_leading_ws_at(out: &mut String, start: usize) {
    let ws_len = out[start..].len() - out[start..].trim_start().len();
    if ws_len > 0 {
        out.drain(start..start + ws_len);
    }
}
