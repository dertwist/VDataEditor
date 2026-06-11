//! Legacy Valve KeyValues text format (VMT / VMAT and similar) — not KV3.
//!
//! Reference: <https://developer.valvesoftware.com/wiki/Keyvalue>
//! Ported from the original `format/keyvalue.js`.

use crate::value::KvValue;

/// Parse a KeyValues document into an object tree.
///
/// Scalars are coerced like the original editor: pure integers to
/// [`KvValue::Int`], decimal/exponent numbers to [`KvValue::Double`],
/// everything else stays a string.
pub fn parse_keyvalues(text: &str) -> KvValue {
    let mut p = Kv1Parser {
        src: text.as_bytes(),
        pos: 0,
    };
    p.parse_root()
}

struct Kv1Parser<'a> {
    src: &'a [u8],
    pos: usize,
}

impl<'a> Kv1Parser<'a> {
    fn eof(&self) -> bool {
        self.pos >= self.src.len()
    }

    fn cur(&self) -> u8 {
        self.src.get(self.pos).copied().unwrap_or(0)
    }

    fn skip(&mut self) {
        while !self.eof() {
            match self.cur() {
                b' ' | b'\t' | b'\r' | b'\n' => self.pos += 1,
                b'/' if self.src.get(self.pos + 1) == Some(&b'/') => {
                    while !self.eof() && self.cur() != b'\n' {
                        self.pos += 1;
                    }
                }
                _ => break,
            }
        }
    }

    fn read_quoted(&mut self) -> String {
        if self.cur() != b'"' {
            return String::new();
        }
        self.pos += 1;
        let mut s = String::new();
        while !self.eof() {
            let c = self.cur();
            self.pos += 1;
            if c == b'"' {
                break;
            }
            if c == b'\\' && !self.eof() {
                s.push(self.cur() as char);
                self.pos += 1;
            } else if c < 0x80 {
                s.push(c as char);
            } else {
                // Re-decode multi-byte UTF-8.
                let start = self.pos - 1;
                let len = utf8_len(c).min(self.src.len() - start);
                if let Ok(chunk) = std::str::from_utf8(&self.src[start..start + len]) {
                    s.push_str(chunk);
                    self.pos = start + len;
                } else {
                    s.push('\u{FFFD}');
                }
            }
        }
        s
    }

    fn read_key(&mut self) -> String {
        self.skip();
        if self.eof() {
            return String::new();
        }
        if self.cur() == b'"' {
            return self.read_quoted();
        }
        let start = self.pos;
        while !self.eof() {
            let c = self.cur();
            if c <= b' ' || matches!(c, b'{' | b'}' | b'"' | b'/') {
                break;
            }
            self.pos += 1;
        }
        String::from_utf8_lossy(&self.src[start..self.pos]).into_owned()
    }

    fn read_line_value(&mut self) -> String {
        self.skip();
        if self.eof() {
            return String::new();
        }
        if self.cur() == b'"' {
            return self.read_quoted();
        }
        let start = self.pos;
        while !self.eof() && self.cur() != b'\n' && self.cur() != b'\r' {
            self.pos += 1;
        }
        String::from_utf8_lossy(&self.src[start..self.pos])
            .trim()
            .to_owned()
    }

    fn parse_object(&mut self) -> KvValue {
        let mut entries = Vec::new();
        loop {
            self.skip();
            if self.eof() {
                break;
            }
            if self.cur() == b'}' {
                self.pos += 1;
                break;
            }
            let key = self.read_key();
            if key.is_empty() {
                self.pos += 1;
                continue;
            }
            self.skip();
            if self.cur() == b'{' {
                self.pos += 1;
                entries.push((key, self.parse_object()));
            } else {
                entries.push((key, coerce_scalar(&self.read_line_value())));
            }
        }
        KvValue::Object(entries)
    }

    fn parse_root(&mut self) -> KvValue {
        let mut entries = Vec::new();
        loop {
            self.skip();
            if self.eof() {
                break;
            }
            let key = self.read_key();
            if key.is_empty() {
                break;
            }
            self.skip();
            if self.cur() == b'{' {
                self.pos += 1;
                entries.push((key, self.parse_object()));
            } else {
                entries.push((key, coerce_scalar(&self.read_line_value())));
            }
        }
        KvValue::Object(entries)
    }
}

fn utf8_len(b: u8) -> usize {
    match b {
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF7 => 4,
        _ => 1,
    }
}

fn coerce_scalar(s: &str) -> KvValue {
    if s.is_empty() {
        return KvValue::String(String::new());
    }
    let body = s.strip_prefix('-').unwrap_or(s);
    if !body.is_empty() && body.bytes().all(|b| b.is_ascii_digit()) {
        if let Ok(v) = s.parse::<i64>() {
            return KvValue::Int(v);
        }
    }
    if looks_like_float(s) {
        if let Ok(v) = s.parse::<f64>() {
            return KvValue::Double(v);
        }
    }
    KvValue::String(s.to_owned())
}

/// `-?\d+\.\d+…` or `-?\d+[eE][+-]?\d+`, like the original coerceScalar.
fn looks_like_float(s: &str) -> bool {
    let b = s.strip_prefix('-').unwrap_or(s).as_bytes();
    let digits = b.iter().take_while(|c| c.is_ascii_digit()).count();
    if digits == 0 {
        return false;
    }
    match b.get(digits) {
        Some(b'.') => b.get(digits + 1).is_some_and(|c| c.is_ascii_digit()),
        Some(b'e') | Some(b'E') => {
            let rest = &b[digits + 1..];
            let rest = match rest.first() {
                Some(b'+') | Some(b'-') => &rest[1..],
                _ => rest,
            };
            !rest.is_empty() && rest.iter().all(|c| c.is_ascii_digit())
        }
        _ => false,
    }
}

/// Serialize an object tree to KeyValues text.
pub fn to_keyvalues_text(root: &KvValue) -> String {
    let mut out = String::with_capacity(1024);
    match root {
        KvValue::Object(entries) => write_object(&mut out, entries, 0),
        other => {
            let entries = vec![("root".to_owned(), other.clone())];
            write_object(&mut out, &entries, 0);
        }
    }
    out
}

fn write_object(out: &mut String, entries: &[(String, KvValue)], depth: usize) {
    for (key, value) in entries {
        if matches!(value, KvValue::Comment(_)) {
            continue;
        }
        for _ in 0..depth {
            out.push('\t');
        }
        write_key(out, key);
        match value {
            KvValue::Object(children) => {
                out.push('\n');
                for _ in 0..depth {
                    out.push('\t');
                }
                out.push_str("{\n");
                write_object(out, children, depth + 1);
                for _ in 0..depth {
                    out.push('\t');
                }
                out.push_str("}\n");
            }
            other => {
                out.push(' ');
                write_scalar(out, other);
                out.push('\n');
            }
        }
    }
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
        escape(out, key);
        out.push('"');
    }
}

fn escape(out: &mut String, s: &str) {
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            _ => out.push(ch),
        }
    }
}

fn write_scalar(out: &mut String, v: &KvValue) {
    use std::fmt::Write;
    match v {
        KvValue::Int(n) => {
            let _ = write!(out, "{n}");
        }
        KvValue::Double(n) => {
            let start = out.len();
            let _ = write!(out, "{n}");
            // Keep doubles recognizably doubles so the round trip is exact.
            if !out[start..].contains(['.', 'e', 'E']) {
                out.push_str(".0");
            }
        }
        KvValue::Bool(b) => out.push_str(if *b { "1" } else { "0" }),
        KvValue::Null => out.push_str("\"\""),
        KvValue::String(s) | KvValue::Typed { value: s, .. } => {
            if s.is_empty() {
                out.push_str("\"\"");
            } else if !s.bytes().any(|b| b.is_ascii_whitespace() || b == b'"') {
                out.push_str(s);
            } else {
                out.push('"');
                escape(out, s);
                out.push('"');
            }
        }
        // Arrays/subclass have no KeyValues representation; quote a debug
        // rendering like the original did with JSON.stringify.
        other => {
            out.push('"');
            let mut tmp = String::new();
            crate::ser_debug_scalar(&mut tmp, other);
            escape(out, &tmp);
            out.push('"');
        }
    }
}
