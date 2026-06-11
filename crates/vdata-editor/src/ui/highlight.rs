//! Minimal KV3/JSON syntax highlighting for the text pane.
//!
//! Line-based scanner producing [`LayoutJob`] sections; whole-document jobs
//! are memoized in egui's frame cache so retyping only re-tokenizes once.

use egui::text::{LayoutJob, TextFormat};
use egui::{Color32, FontId};

use super::theme::Palette;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum Lang {
    Kv3,
    Json,
}

const FONT_SIZE: f32 = 12.0;

fn font() -> FontId {
    FontId::monospace(FONT_SIZE)
}

fn fmt(color: Color32) -> TextFormat {
    TextFormat {
        font_id: font(),
        color,
        ..Default::default()
    }
}

/// Highlight one line (no multi-line state: KV3 block comments spanning
/// lines render as plain text, which is acceptable for an overview pane).
pub fn highlight_line(job: &mut LayoutJob, line: &str, palette: &Palette, default_color: Color32) {
    let bytes = line.as_bytes();
    let mut i = 0;
    let mut plain_start = 0;
    let flush_plain = |job: &mut LayoutJob, from: usize, to: usize| {
        if from < to {
            job.append(&line[from..to], 0.0, fmt(default_color));
        }
    };
    while i < bytes.len() {
        let b = bytes[i];
        // Comments to end of line.
        if b == b'/' && bytes.get(i + 1) == Some(&b'/') {
            flush_plain(job, plain_start, i);
            job.append(&line[i..], 0.0, fmt(palette.comment));
            return;
        }
        // Strings.
        if b == b'"' {
            flush_plain(job, plain_start, i);
            let start = i;
            i += 1;
            while i < bytes.len() {
                if bytes[i] == b'\\' {
                    i += 2;
                    continue;
                }
                if bytes[i] == b'"' {
                    i += 1;
                    break;
                }
                i += 1;
            }
            let end = i.min(bytes.len());
            job.append(&line[start..end], 0.0, fmt(palette.string));
            plain_start = end;
            continue;
        }
        // Numbers.
        if b.is_ascii_digit()
            || (b == b'-' && bytes.get(i + 1).is_some_and(|c| c.is_ascii_digit()))
        {
            let prev_ident = i > 0 && (bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_');
            if !prev_ident {
                flush_plain(job, plain_start, i);
                let start = i;
                while i < bytes.len()
                    && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b'.' | b'-' | b'+'))
                {
                    i += 1;
                }
                job.append(&line[start..i], 0.0, fmt(palette.number));
                plain_start = i;
                continue;
            }
        }
        // Identifiers: keys, keywords, typed prefixes.
        if b.is_ascii_alphabetic() || b == b'_' {
            flush_plain(job, plain_start, i);
            let start = i;
            while i < bytes.len()
                && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b'_' | b'.'))
            {
                i += 1;
            }
            let word = &line[start..i];
            let color = match word {
                "true" | "false" | "null" => palette.keyword,
                _ if bytes.get(i) == Some(&b':') => palette.typed,
                _ => {
                    // Key if followed by optional spaces then '='.
                    let mut j = i;
                    while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
                        j += 1;
                    }
                    if bytes.get(j) == Some(&b'=') {
                        palette.key
                    } else {
                        default_color
                    }
                }
            };
            job.append(word, 0.0, fmt(color));
            plain_start = i;
            continue;
        }
        i += 1;
    }
    flush_plain(job, plain_start, bytes.len());
}

/// Highlight a whole document (used by the editable text pane).
pub fn highlight_document(
    text: &str,
    palette: &Palette,
    default_color: Color32,
    wrap_width: f32,
) -> LayoutJob {
    let mut job = LayoutJob::default();
    job.wrap.max_width = wrap_width;
    let mut first = true;
    for line in text.split('\n') {
        if !first {
            job.append("\n", 0.0, fmt(default_color));
        }
        first = false;
        highlight_line(&mut job, line, palette, default_color);
    }
    job
}
