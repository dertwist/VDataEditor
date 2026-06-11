//! Permissive KV3 text parser.
//!
//! The parser never fails: like the editor it powers, it makes the best of
//! malformed input and records [`ParseIssue`]s instead of aborting, so a
//! half-typed document still produces an editable tree. It is byte-oriented
//! and only allocates for string contents, which keeps multi-megabyte Valve
//! assets in the tens-of-milliseconds range.

use crate::value::KvValue;

/// A non-fatal problem found while parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseIssue {
    /// Byte offset into the parsed body text.
    pub offset: usize,
    pub message: String,
}

/// Result of [`parse_value_with_issues`]: the tree plus any diagnostics.
#[derive(Debug, Clone)]
pub struct ParseOutcome {
    pub value: KvValue,
    pub issues: Vec<ParseIssue>,
}

/// Convert a byte offset into a 1-based `(line, column)` pair.
pub fn line_col(text: &str, offset: usize) -> (usize, usize) {
    let upto = &text.as_bytes()[..offset.min(text.len())];
    let line = 1 + upto.iter().filter(|&&b| b == b'\n').count();
    let col = 1 + upto.iter().rev().take_while(|&&b| b != b'\n').count();
    (line, col)
}

/// Parse a KV3 body (no `<!-- kv3 … -->` header) into a value tree.
pub fn parse_value_text(text: &str) -> KvValue {
    parse_value_with_issues(text).value
}

/// Parse a KV3 body, collecting diagnostics for malformed input.
pub fn parse_value_with_issues(text: &str) -> ParseOutcome {
    let mut p = Parser {
        src: text.as_bytes(),
        pos: 0,
        issues: Vec::new(),
    };
    let value = p.parse_value();
    p.skip_ws_and_comments();
    if p.pos < p.src.len() {
        p.issue("unexpected trailing content after document root");
    }
    ParseOutcome {
        value,
        issues: p.issues,
    }
}

struct Parser<'a> {
    src: &'a [u8],
    pos: usize,
    issues: Vec<ParseIssue>,
}

fn is_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\r' | b'\n' | 0x0b | 0x0c)
}

fn is_key_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'.'
}

fn is_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

impl<'a> Parser<'a> {
    fn issue(&mut self, message: &str) {
        // Cap diagnostics so pathological input can't balloon memory.
        if self.issues.len() < 64 {
            self.issues.push(ParseIssue {
                offset: self.pos,
                message: message.to_owned(),
            });
        }
    }

    fn at(&self, i: usize) -> u8 {
        self.src.get(i).copied().unwrap_or(0)
    }

    fn cur(&self) -> u8 {
        self.at(self.pos)
    }

    fn eof(&self) -> bool {
        self.pos >= self.src.len()
    }

    fn starts_with(&self, s: &[u8]) -> bool {
        self.src[self.pos.min(self.src.len())..].starts_with(s)
    }

    fn skip_ws(&mut self) {
        while !self.eof() && is_ws(self.cur()) {
            self.pos += 1;
        }
    }

    /// Skip whitespace plus any run of `//` and `/* */` comments.
    fn skip_ws_and_comments(&mut self) {
        loop {
            self.skip_ws();
            if self.starts_with(b"/*") {
                self.skip_block_comment();
            } else if self.starts_with(b"//") {
                while !self.eof() && self.cur() != b'\n' {
                    self.pos += 1;
                }
            } else {
                return;
            }
        }
    }

    fn skip_block_comment(&mut self) {
        debug_assert!(self.starts_with(b"/*"));
        self.pos += 2;
        while !self.eof() {
            if self.starts_with(b"*/") {
                self.pos += 2;
                return;
            }
            self.pos += 1;
        }
        self.issue("unterminated block comment");
    }

    fn consume(&mut self, ch: u8) -> bool {
        self.skip_ws_and_comments();
        if self.cur() == ch {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    /// Read the text of a `// …` comment (cursor on the first `/`).
    fn parse_line_comment(&mut self) -> KvValue {
        self.pos += 2;
        let start = self.pos;
        while !self.eof() && self.cur() != b'\n' {
            self.pos += 1;
        }
        KvValue::Comment(String::from_utf8_lossy(&self.src[start..self.pos]).into_owned())
    }

    fn parse_value(&mut self) -> KvValue {
        self.skip_ws_and_comments();
        match self.cur() {
            b'{' => self.parse_object(),
            b'[' => self.parse_array(),
            b'"' => KvValue::String(self.parse_string()),
            c if is_ident_start(c) => self.parse_flagged_or_literal(),
            _ => self.parse_literal(),
        }
    }

    /// `subclass:`, `resource_name:"…"`-style flags, or a bare literal.
    fn parse_flagged_or_literal(&mut self) -> KvValue {
        let start = self.pos;
        let mut end = self.pos;
        while is_ident_byte(self.at(end)) {
            end += 1;
        }
        if self.at(end) == b':' {
            let ident = &self.src[start..end];
            if ident == b"subclass" {
                self.pos = end + 1;
                return KvValue::Subclass(Box::new(self.parse_value()));
            }
            if self.at(end + 1) == b'"' {
                let kind = String::from_utf8_lossy(ident).into_owned();
                self.pos = end + 1;
                let value = self.parse_string();
                return KvValue::Typed { kind, value };
            }
        }
        self.parse_literal()
    }

    fn parse_object(&mut self) -> KvValue {
        self.consume(b'{');
        let mut entries: Vec<(String, KvValue)> = Vec::new();
        loop {
            self.skip_ws();
            while self.starts_with(b"/*") {
                self.skip_block_comment();
                self.skip_ws();
            }
            if self.eof() {
                self.issue("unterminated object: missing '}'");
                break;
            }
            if self.cur() == b'}' {
                break;
            }
            if self.starts_with(b"//") {
                let comment = self.parse_line_comment();
                entries.push((String::new(), comment));
                continue;
            }
            let before = self.pos;
            let key = self.parse_key();
            if key.is_empty() && self.cur() == b',' {
                self.pos += 1;
                continue;
            }
            if !self.consume(b'=') {
                self.issue("expected '=' after object key");
            }
            let value = self.parse_value();
            if self.pos == before {
                // Malformed input that produced no progress: skip one byte so
                // the loop always terminates.
                self.issue("skipping unexpected character in object");
                self.pos += 1;
            } else {
                entries.push((key, value));
            }
        }
        self.consume(b'}');
        KvValue::Object(entries)
    }

    fn parse_array(&mut self) -> KvValue {
        self.consume(b'[');
        let mut items = Vec::new();
        loop {
            self.skip_ws();
            while self.starts_with(b"/*") {
                self.skip_block_comment();
                self.skip_ws();
            }
            if self.eof() {
                self.issue("unterminated array: missing ']'");
                break;
            }
            if self.cur() == b']' {
                break;
            }
            if self.starts_with(b"//") {
                items.push(self.parse_line_comment());
                continue;
            }
            let before = self.pos;
            items.push(self.parse_value());
            self.skip_ws();
            if self.cur() == b',' {
                self.pos += 1;
            }
            if self.pos == before {
                self.issue("skipping unexpected character in array");
                self.pos += 1;
                items.pop();
            }
        }
        self.consume(b']');
        KvValue::Array(items)
    }

    /// Quoted string, with `"""raw multi-line"""` support.
    fn parse_string(&mut self) -> String {
        self.skip_ws_and_comments();
        if self.starts_with(b"\"\"\"") {
            return self.parse_multiline_string();
        }
        if self.cur() == b'"' {
            self.pos += 1;
        }
        let mut out = String::new();
        let start = self.pos;
        let mut plain = true;
        while !self.eof() && self.cur() != b'"' {
            if self.cur() == b'\\' {
                if plain {
                    out.push_str(&String::from_utf8_lossy(&self.src[start..self.pos]));
                    plain = false;
                }
                self.pos += 1;
                if self.eof() {
                    break;
                }
                // Like the original editor, `\x` collapses to `x`; only `\\`
                // and `\"` are meaningful escapes when serializing.
                let b = self.cur();
                if b < 0x80 {
                    out.push(b as char);
                    self.pos += 1;
                } else {
                    let (ch, len) = next_char(&self.src[self.pos..]);
                    out.push(ch);
                    self.pos += len;
                }
            } else if plain {
                self.pos += 1;
            } else {
                let (ch, len) = next_char(&self.src[self.pos..]);
                out.push(ch);
                self.pos += len;
            }
        }
        if self.eof() {
            self.issue("unterminated string");
        }
        let result = if plain {
            String::from_utf8_lossy(&self.src[start..self.pos]).into_owned()
        } else {
            out
        };
        self.consume(b'"');
        result
    }

    fn parse_multiline_string(&mut self) -> String {
        self.pos += 3;
        let start = self.pos;
        while !self.eof() && !self.starts_with(b"\"\"\"") {
            self.pos += 1;
        }
        let raw = String::from_utf8_lossy(&self.src[start..self.pos]).into_owned();
        if self.starts_with(b"\"\"\"") {
            self.pos += 3;
        } else {
            self.issue("unterminated multi-line string");
        }
        raw
    }

    fn parse_key(&mut self) -> String {
        self.skip_ws_and_comments();
        if self.cur() == b'"' {
            return self.parse_string();
        }
        let start = self.pos;
        while !self.eof() && is_key_byte(self.cur()) {
            self.pos += 1;
        }
        String::from_utf8_lossy(&self.src[start..self.pos]).into_owned()
    }

    fn parse_literal(&mut self) -> KvValue {
        self.skip_ws_and_comments();
        let start = self.pos;
        while !self.eof() && !is_ws(self.cur()) && !matches!(self.cur(), b',' | b'}' | b']' | b'=')
        {
            self.pos += 1;
        }
        let lit = String::from_utf8_lossy(&self.src[start..self.pos]).into_owned();
        match lit.as_str() {
            "true" => return KvValue::Bool(true),
            "false" => return KvValue::Bool(false),
            "null" => return KvValue::Null,
            _ => {}
        }
        parse_number(&lit).unwrap_or(KvValue::String(lit))
    }
}

/// Decode the next UTF-8 scalar from `bytes` (must be non-empty).
fn next_char(bytes: &[u8]) -> (char, usize) {
    let b = bytes[0];
    if b < 0x80 {
        return (b as char, 1);
    }
    let len = match b {
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF7 => 4,
        _ => 1,
    }
    .min(bytes.len());
    match std::str::from_utf8(&bytes[..len]) {
        Ok(s) => (s.chars().next().unwrap_or('\u{FFFD}'), len),
        Err(_) => ('\u{FFFD}', 1),
    }
}

/// Parse a numeric literal: decimal ints, `0x…` hex ints, floats.
fn parse_number(lit: &str) -> Option<KvValue> {
    if lit.is_empty() {
        return None;
    }
    let (sign, digits) = match lit.as_bytes()[0] {
        b'-' => (-1i64, &lit[1..]),
        b'+' => (1, &lit[1..]),
        _ => (1, lit),
    };
    if digits.is_empty() {
        return None;
    }
    if let Some(hex) = digits.strip_prefix("0x").or_else(|| digits.strip_prefix("0X")) {
        if !hex.is_empty() && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return i64::from_str_radix(hex, 16).ok().map(|v| KvValue::Int(sign * v));
        }
        return None;
    }
    if digits.bytes().all(|b| b.is_ascii_digit()) {
        return match digits.parse::<i64>() {
            Ok(v) => Some(KvValue::Int(sign * v)),
            // Out of i64 range: keep the magnitude as a double.
            Err(_) => digits
                .parse::<f64>()
                .ok()
                .map(|v| KvValue::Double(sign as f64 * v)),
        };
    }
    // Floats: require the literal to look numeric (digits plus . e E + -) so
    // bare words never coerce, then defer to the standard parser.
    if !lit
        .bytes()
        .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'+' | b'-'))
    {
        return None;
    }
    if !lit.bytes().any(|b| b.is_ascii_digit()) {
        return None;
    }
    lit.parse::<f64>().ok().map(KvValue::Double)
}
