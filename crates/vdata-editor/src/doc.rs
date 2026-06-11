//! Open documents: parsing, saving, dirty state, per-document UI state.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use kv3::{KvValue, Kv3Document, Style};

use crate::history::History;
use crate::model::{DocModel, DocStats, NodeId};

pub type DocId = u64;

/// On-disk format of a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileFormat {
    Kv3,
    KeyValues,
    Json,
}

impl FileFormat {
    pub fn from_file_name(name: &str) -> FileFormat {
        match Path::new(name)
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
            .as_str()
        {
            "vmat" | "vmt" => FileFormat::KeyValues,
            "json" => FileFormat::Json,
            _ => FileFormat::Kv3,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            FileFormat::Kv3 => "KV3",
            FileFormat::KeyValues => "KeyValues",
            FileFormat::Json => "JSON",
        }
    }
}

/// Format shown in the text pane (independent of the on-disk format).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextFormat {
    /// The document's on-disk format (KV3 or KeyValues).
    Native,
    Json,
}

/// Above this many bytes the text pane switches to a virtualized read-only
/// view: egui's text editor lays out the entire buffer, which is too slow
/// for multi-megabyte assets.
pub const EDITABLE_TEXT_LIMIT: usize = 512 * 1024;

/// State of the raw-text pane for one document.
pub struct TextPane {
    pub format: TextFormat,
    pub text: String,
    /// Model revision `text` was generated from (`None` = never synced).
    pub synced_rev: Option<u64>,
    /// The user has typed in the pane and not applied yet.
    pub edited: bool,
    pub issues: Vec<String>,
    /// Byte ranges of each line, for the virtualized read-only view.
    pub line_ranges: Vec<(u32, u32)>,
    pub search: String,
}

impl Default for TextPane {
    fn default() -> Self {
        TextPane {
            format: TextFormat::Native,
            text: String::new(),
            synced_rev: None,
            edited: false,
            issues: Vec::new(),
            line_ranges: Vec::new(),
            search: String::new(),
        }
    }
}

impl TextPane {
    pub fn is_virtualized(&self) -> bool {
        self.text.len() > EDITABLE_TEXT_LIMIT
    }

    pub fn rebuild_line_index(&mut self) {
        self.line_ranges.clear();
        let mut start = 0u32;
        for (i, b) in self.text.bytes().enumerate() {
            if b == b'\n' {
                self.line_ranges.push((start, i as u32));
                start = i as u32 + 1;
            }
        }
        if (start as usize) <= self.text.len() {
            self.line_ranges.push((start, self.text.len() as u32));
        }
    }

    pub fn line(&self, index: usize) -> &str {
        let (start, end) = self.line_ranges[index];
        &self.text[start as usize..end as usize]
    }
}

/// Per-document property-tree view state.
#[derive(Default)]
pub struct TreeView {
    pub search: String,
    /// Cached flattened rows: `(node, depth)`.
    pub flat: Vec<(NodeId, u16)>,
    pub flat_key: Option<(u64, u64, String)>,
    /// Multi-selection (click / Ctrl+click / Shift+click).
    pub selected: std::collections::BTreeSet<NodeId>,
    /// Anchor row for Shift+click range selection.
    pub anchor: Option<NodeId>,
    /// Inline key rename in progress: node + edit buffer.
    pub renaming: Option<(NodeId, String)>,
    /// Row index to scroll to on the next frame.
    pub scroll_to_row: Option<usize>,
}

impl TreeView {
    pub fn select_only(&mut self, id: NodeId) {
        self.selected.clear();
        self.selected.insert(id);
        self.anchor = Some(id);
    }

    pub fn last_selected(&self) -> Option<NodeId> {
        self.anchor
            .filter(|id| self.selected.contains(id))
            .or_else(|| self.selected.iter().next_back().copied())
    }
}

pub struct Document {
    pub id: DocId,
    pub file_path: Option<PathBuf>,
    pub file_name: String,
    pub format: FileFormat,
    /// KV3 header detected at load (preserved on save).
    pub kv3_header: String,
    pub kv3_style: Style,
    pub model: DocModel,
    pub history: History,
    /// Model revision at the last save (dirty = rev differs).
    pub saved_rev: u64,
    pub text_pane: TextPane,
    pub tree_view: TreeView,
    pub parse_issues: Vec<String>,
    pub parse_time: Duration,
    /// Last time the model changed; used to debounce text-pane syncs.
    pub last_edit: Option<Instant>,
    stats_cache: Option<(u64, DocStats)>,
    /// Harvested enum-like string values per key (suggestion source).
    suggestions_cache: Option<(u64, std::collections::HashMap<String, Vec<String>>)>,
}

impl Document {
    pub fn new_untitled(id: DocId) -> Document {
        let root = KvValue::Object(vec![
            (
                "generic_data_type".to_owned(),
                KvValue::String("CSmartPropRoot".to_owned()),
            ),
            ("m_Children".to_owned(), KvValue::Array(vec![])),
            ("m_Variables".to_owned(), KvValue::Array(vec![])),
        ]);
        Document {
            id,
            file_path: None,
            file_name: format!("untitled-{id}.vsmart"),
            format: FileFormat::Kv3,
            kv3_header: String::new(),
            kv3_style: kv3::DEFAULT_STYLE,
            model: DocModel::from_value(&root),
            history: History::default(),
            saved_rev: 0,
            text_pane: TextPane::default(),
            tree_view: TreeView::default(),
            parse_issues: Vec::new(),
            parse_time: Duration::ZERO,
            last_edit: None,
            stats_cache: None,
            suggestions_cache: None,
        }
    }

    pub fn from_text(id: DocId, text: &str, file_name: String, file_path: Option<PathBuf>) -> Document {
        let format = FileFormat::from_file_name(&file_name);
        let started = Instant::now();
        let (root, header, style, issues) = match format {
            FileFormat::KeyValues => {
                (kv3::parse_keyvalues(text), String::new(), kv3::DEFAULT_STYLE, Vec::new())
            }
            FileFormat::Json => match serde_json::from_str::<serde_json::Value>(text) {
                Ok(value) => (
                    crate::json_bridge::json_to_kv(&value),
                    String::new(),
                    kv3::DEFAULT_STYLE,
                    Vec::new(),
                ),
                Err(err) => (
                    KvValue::object(),
                    String::new(),
                    kv3::DEFAULT_STYLE,
                    vec![format!("JSON parse error: {err}")],
                ),
            },
            FileFormat::Kv3 => {
                let doc = Kv3Document::parse(text);
                let issues = doc
                    .issues
                    .iter()
                    .map(|issue| {
                        let (line, col) = kv3::line_col(text, issue.offset);
                        format!("{}:{line}:{col}: {}", file_name, issue.message)
                    })
                    .collect();
                (doc.root, doc.header, doc.style, issues)
            }
        };
        let model = DocModel::from_value(&root);
        let parse_time = started.elapsed();
        Document {
            id,
            file_path,
            file_name,
            format,
            kv3_header: header,
            kv3_style: style,
            model,
            history: History::default(),
            saved_rev: 0,
            text_pane: TextPane::default(),
            tree_view: TreeView::default(),
            parse_issues: issues,
            parse_time,
            last_edit: None,
            stats_cache: None,
            suggestions_cache: None,
        }
    }

    pub fn open(id: DocId, path: &Path) -> std::io::Result<Document> {
        let text = std::fs::read_to_string(path)?;
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        Ok(Self::from_text(id, &text, file_name, Some(path.to_path_buf())))
    }

    pub fn dirty(&self) -> bool {
        self.model.rev != self.saved_rev
    }

    pub fn title(&self) -> String {
        if self.dirty() {
            format!("● {}", self.file_name)
        } else {
            self.file_name.clone()
        }
    }

    /// Serialize the document in its on-disk format.
    pub fn serialize(&self) -> String {
        let root = self.model.to_value();
        match self.format {
            FileFormat::Kv3 => {
                let header = if self.kv3_header.is_empty() {
                    kv3::detect_header_from_file_name(&self.file_name).to_owned()
                } else {
                    self.kv3_header.clone()
                };
                kv3::to_kv3_text(&root, &header, self.kv3_style)
            }
            FileFormat::KeyValues => kv3::to_keyvalues_text(&root),
            FileFormat::Json => {
                serde_json::to_string_pretty(&crate::json_bridge::kv_to_json(&root))
                    .unwrap_or_default()
            }
        }
    }

    pub fn save_to(&mut self, path: &Path) -> std::io::Result<()> {
        std::fs::write(path, self.serialize())?;
        self.file_path = Some(path.to_path_buf());
        self.file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        self.format = FileFormat::from_file_name(&self.file_name);
        self.saved_rev = self.model.rev;
        Ok(())
    }

    pub fn stats(&mut self) -> DocStats {
        match self.stats_cache {
            Some((rev, stats)) if rev == self.model.rev => stats,
            _ => {
                let stats = self.model.stats();
                self.stats_cache = Some((self.model.rev, stats));
                stats
            }
        }
    }

    /// Enum-like string values harvested from the document, grouped by key.
    /// Used to offer dropdown suggestions even without a schema.
    pub fn suggestions_for(&mut self, key: &str) -> Vec<String> {
        let rev = self.model.structure_rev;
        let rebuild = !matches!(&self.suggestions_cache, Some((r, _)) if *r == rev);
        if rebuild {
            self.suggestions_cache = Some((rev, harvest_suggestions(&self.model)));
        }
        self.suggestions_cache
            .as_ref()
            .and_then(|(_, map)| map.get(key))
            .cloned()
            .unwrap_or_default()
    }

    pub fn mark_edited(&mut self) {
        self.last_edit = Some(Instant::now());
    }
}

fn looks_like_enum_value(s: &str) -> bool {
    s.len() >= 2
        && s.len() <= 64
        && s.as_bytes()[0].is_ascii_uppercase()
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        && s.contains('_')
}

fn harvest_suggestions(model: &DocModel) -> std::collections::HashMap<String, Vec<String>> {
    use crate::model::{Payload, Scalar};
    let mut map: std::collections::HashMap<String, Vec<String>> = Default::default();
    let mut stack = vec![model.root()];
    while let Some(id) = stack.pop() {
        let node = model.node(id);
        match &node.payload {
            Payload::Object(c) | Payload::Array(c) => stack.extend_from_slice(c),
            Payload::Scalar(Scalar::Str(s)) if !node.key.is_empty() && looks_like_enum_value(s) => {
                let values = map.entry(node.key.clone()).or_default();
                if values.len() < 200 && !values.contains(s) {
                    values.push(s.clone());
                }
            }
            _ => {}
        }
    }
    for values in map.values_mut() {
        values.sort();
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dirty_tracking_follows_revisions() {
        let mut doc = Document::new_untitled(1);
        assert!(!doc.dirty());
        let root = doc.model.root();
        let child = doc.model.children(root)[0];
        let old = doc.model.node(child).payload.clone();
        doc.history.push(
            &mut doc.model,
            crate::history::Cmd::SetPayload {
                id: child,
                old,
                new: crate::model::Payload::Scalar(crate::model::Scalar::Str("X".into())),
            },
            "edit",
        );
        assert!(doc.dirty());
        doc.history.undo(&mut doc.model);
        // Undo restores content but the revision moved on; matching the
        // original editor, undo back to the saved state keeps dirty=true.
        assert!(doc.dirty());
    }

    #[test]
    fn format_detection() {
        assert_eq!(FileFormat::from_file_name("a.vmat"), FileFormat::KeyValues);
        assert_eq!(FileFormat::from_file_name("a.vmt"), FileFormat::KeyValues);
        assert_eq!(FileFormat::from_file_name("a.json"), FileFormat::Json);
        assert_eq!(FileFormat::from_file_name("a.vdata"), FileFormat::Kv3);
        assert_eq!(FileFormat::from_file_name("noext"), FileFormat::Kv3);
    }

    #[test]
    fn serializes_with_default_header() {
        let doc = Document::new_untitled(7);
        let text = doc.serialize();
        assert!(text.starts_with(kv3::DEFAULT_KV3_HEADER));
        assert!(text.contains("generic_data_type = \"CSmartPropRoot\""));
    }

    #[test]
    fn harvests_enum_like_suggestions() {
        let mut doc = Document::from_text(
            1,
            r#"{ a = { m_eMode = "MODE_FAST" } b = { m_eMode = "MODE_SLOW" } c = "lowercase" }"#,
            "x.vdata".into(),
            None,
        );
        assert_eq!(doc.suggestions_for("m_eMode"), vec!["MODE_FAST", "MODE_SLOW"]);
        assert!(doc.suggestions_for("c").is_empty());
    }

    #[test]
    fn text_pane_line_index() {
        let mut pane = TextPane::default();
        pane.text = "a\nbb\n\nccc".into();
        pane.rebuild_line_index();
        assert_eq!(pane.line_ranges.len(), 4);
        assert_eq!(pane.line(0), "a");
        assert_eq!(pane.line(1), "bb");
        assert_eq!(pane.line(2), "");
        assert_eq!(pane.line(3), "ccc");
    }
}
