//! The raw-text pane.
//!
//! Small documents get a fully editable, syntax-highlighted editor with an
//! Apply (Ctrl+Enter) action that re-parses the text into the property tree
//! as one undoable step. Documents above [`EDITABLE_TEXT_LIMIT`] switch to a
//! virtualized read-only view (line-by-line rendering), since laying out
//! multiple megabytes of text per frame is what made the original editor
//! struggle. The pane resyncs from the model shortly after edits settle.

use std::time::Duration;

use egui::{Align, Layout, RichText, TextStyle};
use kv3::KvValue;

use crate::doc::{Document, FileFormat, TextFormat};
use crate::history::Cmd;
use crate::json_bridge;

use super::highlight;
use super::theme::Palette;

/// Debounce between the last model edit and a text-pane resync.
const SYNC_DEBOUNCE: Duration = Duration::from_millis(300);

fn serialize_for_pane(doc: &Document) -> String {
    match doc.text_pane.format {
        TextFormat::Native => doc.serialize(),
        TextFormat::Json => {
            serde_json::to_string_pretty(&json_bridge::kv_to_json(&doc.model.to_value()))
                .unwrap_or_default()
        }
    }
}

fn sync_if_due(doc: &mut Document, force: bool) {
    let pane_rev = doc.text_pane.synced_rev;
    if !force {
        if doc.text_pane.edited || pane_rev == Some(doc.model.rev) {
            return;
        }
        let settled = doc
            .last_edit
            .is_none_or(|t| t.elapsed() > SYNC_DEBOUNCE);
        if !settled {
            return;
        }
    }
    doc.text_pane.text = serialize_for_pane(doc);
    doc.text_pane.synced_rev = Some(doc.model.rev);
    doc.text_pane.edited = false;
    doc.text_pane.issues.clear();
    doc.text_pane.rebuild_line_index();
}

pub fn show(ui: &mut egui::Ui, doc: &mut Document, palette: &'static Palette) {
    sync_if_due(doc, doc.text_pane.synced_rev.is_none());

    let mut apply_requested = false;
    let mut resync_requested = false;

    // ---- Toolbar ----
    ui.horizontal(|ui| {
        ui.add_space(2.0);
        let native_label = doc.format.label();
        let mut format = doc.text_pane.format;
        if ui
            .selectable_label(format == TextFormat::Native, native_label)
            .clicked()
        {
            format = TextFormat::Native;
        }
        if ui
            .selectable_label(format == TextFormat::Json, "JSON")
            .clicked()
        {
            format = TextFormat::Json;
        }
        if format != doc.text_pane.format {
            doc.text_pane.format = format;
            resync_requested = true;
        }
        ui.separator();

        let virtualized = doc.text_pane.is_virtualized();
        if !virtualized {
            let apply = ui
                .add_enabled(doc.text_pane.edited, egui::Button::new("Apply"))
                .on_hover_text("Parse the text and replace the document (Ctrl+Enter)");
            apply_requested = apply.clicked();
            if doc.text_pane.edited && ui.button("Revert").on_hover_text("Discard text edits").clicked() {
                resync_requested = true;
            }
        } else {
            ui.label(
                RichText::new("read-only (large file)")
                    .color(palette.dim)
                    .small(),
            )
            .on_hover_text(
                "Documents over 512 KB render in a virtualized read-only view.\n\
                 Edit via the property tree; the text follows automatically.",
            );
            if ui.small_button("⟳").on_hover_text("Resync now").clicked() {
                resync_requested = true;
            }
        }

        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            let size = doc.text_pane.text.len();
            let label = if size >= 1024 * 1024 {
                format!("{:.2} MB", size as f64 / (1024.0 * 1024.0))
            } else {
                format!("{:.1} KB", size as f64 / 1024.0)
            };
            ui.label(RichText::new(label).color(palette.dim).small());
            if doc.text_pane.edited {
                ui.label(RichText::new("modified").color(ui.visuals().warn_fg_color).small());
            }
        });
    });

    // ---- Issues from the last Apply ----
    if !doc.text_pane.issues.is_empty() {
        let issues = doc.text_pane.issues.clone();
        ui.scope(|ui| {
            for issue in issues.iter().take(3) {
                ui.label(RichText::new(issue).color(ui.visuals().error_fg_color).small());
            }
            if issues.len() > 3 {
                ui.label(
                    RichText::new(format!("… and {} more", issues.len() - 3))
                        .color(ui.visuals().error_fg_color)
                        .small(),
                );
            }
        });
    }
    ui.separator();

    if apply_requested
        || (doc.text_pane.edited
            && ui.input_mut(|i| {
                i.consume_shortcut(&egui::KeyboardShortcut::new(
                    egui::Modifiers::CTRL,
                    egui::Key::Enter,
                ))
            }))
    {
        apply_text(doc);
    }
    if resync_requested {
        doc.text_pane.edited = false;
        sync_if_due(doc, true);
    }

    if doc.text_pane.is_virtualized() {
        virtualized_view(ui, doc, palette);
    } else {
        editable_view(ui, doc, palette);
    }
}

fn editable_view(ui: &mut egui::Ui, doc: &mut Document, palette: &'static Palette) {
    let default_color = ui.visuals().text_color();
    let mut layouter = move |ui: &egui::Ui, buf: &dyn egui::TextBuffer, wrap_width: f32| {
        let job = highlight::highlight_document(buf.as_str(), palette, default_color, wrap_width);
        ui.painter().layout_job(job)
    };

    egui::ScrollArea::both()
        .auto_shrink([false, false])
        .id_salt(("text", doc.id))
        .show(ui, |ui| {
            let edit = egui::TextEdit::multiline(&mut doc.text_pane.text)
                .code_editor()
                .desired_width(f32::INFINITY)
                .desired_rows(30)
                .layouter(&mut layouter);
            if ui.add(edit).changed() {
                doc.text_pane.edited = true;
            }
        });
}

fn virtualized_view(ui: &mut egui::Ui, doc: &mut Document, palette: &'static Palette) {
    // Search within the text.
    let mut scroll_to: Option<usize> = None;
    ui.horizontal(|ui| {
        ui.add(
            egui::TextEdit::singleline(&mut doc.text_pane.search)
                .hint_text("Find in text…")
                .desired_width(220.0),
        );
        let go = ui.button("Find next");
        if go.clicked() && !doc.text_pane.search.is_empty() {
            let start: usize = ui
                .data(|d| d.get_temp(egui::Id::new(("text-find", doc.id))))
                .unwrap_or(0);
            let needle = doc.text_pane.search.to_lowercase();
            let n = doc.text_pane.line_ranges.len();
            for offset in 1..=n {
                let line_no = (start + offset) % n;
                if doc.text_pane.line(line_no).to_lowercase().contains(&needle) {
                    scroll_to = Some(line_no);
                    ui.data_mut(|d| {
                        d.insert_temp(egui::Id::new(("text-find", doc.id)), line_no)
                    });
                    break;
                }
            }
        }
    });

    let font_id = TextStyle::Monospace.resolve(ui.style());
    let row_height = ui.text_style_height(&TextStyle::Monospace) + 2.0;
    let total = doc.text_pane.line_ranges.len();
    let default_color = ui.visuals().text_color();
    let gutter_color = palette.dim;
    let digits = total.to_string().len();

    let mut scroll = egui::ScrollArea::both()
        .auto_shrink([false, false])
        .id_salt(("text-virt", doc.id));
    if let Some(line) = scroll_to {
        scroll = scroll.vertical_scroll_offset((line as f32 - 3.0).max(0.0) * row_height);
    }
    scroll.show_rows(ui, row_height, total, |ui, range| {
        ui.set_min_width(ui.available_width());
        for line_no in range {
            let line = doc.text_pane.line(line_no);
            let mut job = egui::text::LayoutJob::default();
            job.append(
                &format!("{:>digits$}  ", line_no + 1),
                0.0,
                egui::TextFormat {
                    font_id: font_id.clone(),
                    color: gutter_color,
                    ..Default::default()
                },
            );
            highlight::highlight_line(&mut job, line, palette, default_color);
            ui.add(egui::Label::new(job).extend());
        }
    });
}

/// Parse the pane text and replace the document root (single undo step).
pub fn apply_text(doc: &mut Document) {
    let text = doc.text_pane.text.clone();
    let (value, issues): (Option<KvValue>, Vec<String>) = match doc.text_pane.format {
        TextFormat::Json => match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(json) => (Some(json_bridge::json_to_kv(&json)), Vec::new()),
            Err(err) => (None, vec![format!("JSON: {err}")]),
        },
        TextFormat::Native => match doc.format {
            FileFormat::KeyValues => (Some(kv3::parse_keyvalues(&text)), Vec::new()),
            _ => {
                let parsed = kv3::Kv3Document::parse(&text);
                let issues = parsed
                    .issues
                    .iter()
                    .map(|issue| {
                        let (line, col) = kv3::line_col(&text, issue.offset);
                        format!("{line}:{col}: {}", issue.message)
                    })
                    .collect();
                if parsed.issues.is_empty() {
                    doc.kv3_header = parsed.header.clone();
                    doc.kv3_style = parsed.style;
                    (Some(parsed.root), issues)
                } else {
                    (None, issues)
                }
            }
        },
    };

    doc.text_pane.issues = issues;
    let Some(value) = value else { return };

    let old_root = doc.model.root();
    let new_root = doc.model.create_detached(&value, String::new());
    doc.history.push(
        &mut doc.model,
        Cmd::ReplaceRoot {
            old: old_root,
            new: new_root,
        },
        "Apply text",
    );
    doc.model.set_expanded(new_root, true);
    doc.tree_view.selected.clear();
    doc.tree_view.anchor = None;
    doc.text_pane.edited = false;
    doc.text_pane.synced_rev = Some(doc.model.rev);
    doc.text_pane.rebuild_line_index();
    doc.mark_edited();
}
