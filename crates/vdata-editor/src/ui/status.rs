//! Status bar: document stats, parse info, selection path, schema state.

use egui::{Align, Layout, RichText};

use crate::doc::Document;
use crate::schema::SchemaStore;

use super::theme::Palette;

pub fn status_bar(
    ui: &mut egui::Ui,
    doc: Option<&mut Document>,
    schema: &SchemaStore,
    palette: &'static Palette,
) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 10.0;
        let Some(doc) = doc else {
            ui.label(RichText::new("No document open — File ▸ Open… or drop a file here").color(palette.dim));
            return;
        };

        let path = doc
            .file_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| doc.file_name.clone());
        ui.label(RichText::new(path).color(palette.dim).small())
            .on_hover_text("Document path");

        ui.separator();
        ui.label(RichText::new(doc.format.label()).small());

        let stats = doc.stats();
        ui.separator();
        ui.label(
            RichText::new(format!(
                "{} props · {} objects · {} arrays",
                stats.properties, stats.objects, stats.arrays
            ))
            .small(),
        );

        if !doc.parse_issues.is_empty() {
            ui.separator();
            let warn = ui.label(
                RichText::new(format!("⚠ {} parse issues", doc.parse_issues.len()))
                    .color(ui.visuals().warn_fg_color)
                    .small(),
            );
            warn.on_hover_ui(|ui| {
                for issue in doc.parse_issues.iter().take(12) {
                    ui.label(issue);
                }
            });
        }

        if let Some(selected) = doc.tree_view.selected {
            ui.separator();
            ui.label(RichText::new(doc.model.path(selected)).color(palette.key).small());
        }

        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.label(
                RichText::new(format!("v{}", env!("CARGO_PKG_VERSION")))
                    .color(palette.dim)
                    .small(),
            );
            if let Some(db) = &schema.db {
                ui.separator();
                ui.label(
                    RichText::new(format!("schema: {} ({} classes)", db.game, db.class_count))
                        .color(palette.subclass)
                        .small(),
                );
            } else if let Some(loading) = &schema.loading {
                ui.separator();
                ui.spinner();
                ui.label(RichText::new(format!("loading {loading}…")).small());
            }
            ui.separator();
            ui.label(
                RichText::new(format!("parsed in {:.0?}", doc.parse_time))
                    .color(palette.dim)
                    .small(),
            );
            if doc.history.depth() > 0 {
                ui.separator();
                ui.label(
                    RichText::new(format!("{} edits", doc.history.depth()))
                        .color(palette.dim)
                        .small(),
                );
            }
        });
    });
}
