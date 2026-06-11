//! Menu bar and global keyboard shortcuts.

use egui::{Key, KeyboardShortcut, Modifiers};

use crate::app::AppAction;
use crate::doc::Document;
use crate::schema::{GAMES, SchemaStore};

use super::icons;
use super::theme::Theme;

/// Menu entry with the original editor's PNG icon and a right-aligned
/// shortcut, like the old `.menu-dropdown-item` rows.
fn icon_item(
    ui: &mut egui::Ui,
    icon: egui::ImageSource<'static>,
    label: &str,
    shortcut: &str,
    enabled: bool,
) -> bool {
    let mut button = egui::Button::image_and_text(icons::img(icon), label);
    if !shortcut.is_empty() {
        button = button.shortcut_text(shortcut);
    }
    let clicked = ui.add_enabled(enabled, button).clicked();
    if clicked {
        ui.close();
    }
    clicked
}

pub struct Shortcuts;

impl Shortcuts {
    pub const NEW: KeyboardShortcut = KeyboardShortcut::new(Modifiers::CTRL, Key::N);
    pub const OPEN: KeyboardShortcut = KeyboardShortcut::new(Modifiers::CTRL, Key::O);
    pub const SAVE: KeyboardShortcut = KeyboardShortcut::new(Modifiers::CTRL, Key::S);
    pub const SAVE_AS: KeyboardShortcut =
        KeyboardShortcut::new(Modifiers::CTRL.plus(Modifiers::SHIFT), Key::S);
    pub const CLOSE: KeyboardShortcut = KeyboardShortcut::new(Modifiers::CTRL, Key::W);
    pub const UNDO: KeyboardShortcut = KeyboardShortcut::new(Modifiers::CTRL, Key::Z);
    pub const REDO: KeyboardShortcut =
        KeyboardShortcut::new(Modifiers::CTRL.plus(Modifiers::SHIFT), Key::Z);
    pub const REDO_Y: KeyboardShortcut = KeyboardShortcut::new(Modifiers::CTRL, Key::Y);
    pub const FIND: KeyboardShortcut = KeyboardShortcut::new(Modifiers::CTRL, Key::F);
}

pub fn consume_shortcuts(ctx: &egui::Context, actions: &mut Vec<AppAction>) {
    // Don't steal Ctrl+Z etc. while a text field has focus — egui's TextEdit
    // has its own undo. Global shortcuts that never clash still work.
    let typing = ctx.egui_wants_keyboard_input();
    ctx.input_mut(|i| {
        if i.consume_shortcut(&Shortcuts::NEW) {
            actions.push(AppAction::NewDoc);
        }
        if i.consume_shortcut(&Shortcuts::OPEN) {
            actions.push(AppAction::OpenDialog);
        }
        if i.consume_shortcut(&Shortcuts::SAVE_AS) {
            actions.push(AppAction::SaveAs);
        }
        if i.consume_shortcut(&Shortcuts::SAVE) {
            actions.push(AppAction::Save);
        }
        if i.consume_shortcut(&Shortcuts::CLOSE) {
            actions.push(AppAction::CloseActive);
        }
        if i.consume_shortcut(&Shortcuts::FIND) {
            actions.push(AppAction::Find);
        }
        if !typing {
            if i.consume_shortcut(&Shortcuts::REDO) || i.consume_shortcut(&Shortcuts::REDO_Y) {
                actions.push(AppAction::Redo);
            }
            if i.consume_shortcut(&Shortcuts::UNDO) {
                actions.push(AppAction::Undo);
            }
        }
    });
}

#[allow(clippy::too_many_arguments)]
pub fn menu_bar(
    ui: &mut egui::Ui,
    active_doc: Option<&Document>,
    recent: &[std::path::PathBuf],
    schema: &SchemaStore,
    theme: Theme,
    actions: &mut Vec<AppAction>,
) {
    egui::MenuBar::new().ui(ui, |ui| {
        ui.menu_button("File", |ui| {
            if icon_item(ui, icons::NEW, "New", "Ctrl+N", true) {
                actions.push(AppAction::NewDoc);
            }
            if icon_item(ui, icons::IMPORT, "Open…", "Ctrl+O", true) {
                actions.push(AppAction::OpenDialog);
            }
            ui.menu_button("Open Recent", |ui| {
                if recent.is_empty() {
                    ui.label("(empty)");
                }
                for path in recent {
                    if ui.button(path.display().to_string()).clicked() {
                        actions.push(AppAction::OpenPath(path.clone()));
                        ui.close();
                    }
                }
                if !recent.is_empty() {
                    ui.separator();
                    if ui.button("Clear list").clicked() {
                        actions.push(AppAction::ClearRecent);
                        ui.close();
                    }
                }
            });
            ui.separator();
            let has_doc = active_doc.is_some();
            if icon_item(ui, icons::SAVE, "Save", "Ctrl+S", has_doc) {
                actions.push(AppAction::Save);
            }
            if icon_item(ui, icons::SAVE_ALL, "Save As…", "Ctrl+Shift+S", has_doc) {
                actions.push(AppAction::SaveAs);
            }
            ui.separator();
            if ui.button("File associations…").clicked() {
                actions.push(AppAction::ShowAssocDialog);
                ui.close();
            }
            ui.separator();
            if icon_item(ui, icons::CANCEL, "Close Tab", "Ctrl+W", has_doc) {
                actions.push(AppAction::CloseActive);
            }
            if ui.button("Quit").clicked() {
                actions.push(AppAction::Quit);
                ui.close();
            }
        });

        ui.menu_button("Edit", |ui| {
            let (undo_label, can_undo, redo_label, can_redo) = match active_doc {
                Some(doc) => (
                    doc.history
                        .undo_label()
                        .map(|l| format!("Undo {l}"))
                        .unwrap_or_else(|| "Undo".into()),
                    doc.history.can_undo(),
                    doc.history
                        .redo_label()
                        .map(|l| format!("Redo {l}"))
                        .unwrap_or_else(|| "Redo".into()),
                    doc.history.can_redo(),
                ),
                None => ("Undo".into(), false, "Redo".into(), false),
            };
            if icon_item(ui, icons::UNDO, &undo_label, "Ctrl+Z", can_undo) {
                actions.push(AppAction::Undo);
            }
            if icon_item(ui, icons::REDO, &redo_label, "Ctrl+Shift+Z", can_redo) {
                actions.push(AppAction::Redo);
            }
            ui.separator();
            if icon_item(ui, icons::FILTER, "Find", "Ctrl+F", true) {
                actions.push(AppAction::Find);
            }
            ui.separator();
            if icon_item(ui, icons::EXPAND_ALL, "Expand All", "", true) {
                actions.push(AppAction::ExpandAll(true));
            }
            if icon_item(ui, icons::COLLAPSE_ALL, "Collapse All", "", true) {
                actions.push(AppAction::ExpandAll(false));
            }
        });

        ui.menu_button("View", |ui| {
            if icon_item(ui, icons::REFRESH, "Reset Layout", "", true) {
                actions.push(AppAction::ResetLayout);
            }
            ui.separator();
            if ui
                .selectable_label(theme == Theme::Dark, "Dark theme")
                .clicked()
            {
                actions.push(AppAction::SetTheme(Theme::Dark));
                ui.close();
            }
            if ui
                .selectable_label(theme == Theme::Light, "Light theme")
                .clicked()
            {
                actions.push(AppAction::SetTheme(Theme::Light));
                ui.close();
            }
            ui.separator();
            if ui.button("Zoom In\tCtrl+\u{2b}").clicked() {
                actions.push(AppAction::Zoom(0.1));
                ui.close();
            }
            if ui.button("Zoom Out").clicked() {
                actions.push(AppAction::Zoom(-0.1));
                ui.close();
            }
        });

        ui.menu_button("Schema", |ui| {
            let current = schema.db.as_ref().map(|db| db.game.clone());
            if ui
                .selectable_label(current.is_none(), "None")
                .clicked()
            {
                actions.push(AppAction::UnloadSchema);
                ui.close();
            }
            for game in GAMES {
                let label = match *game {
                    "cs2" => "Counter-Strike 2",
                    "dota2" => "Dota 2",
                    "deadlock" => "Deadlock",
                    other => other,
                };
                if ui
                    .selectable_label(current.as_deref() == Some(*game), label)
                    .clicked()
                {
                    actions.push(AppAction::LoadSchema(game.to_string()));
                    ui.close();
                }
            }
            if let Some(loading) = &schema.loading {
                ui.separator();
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label(format!("loading {loading}…"));
                });
            }
            if let Some(err) = &schema.error {
                ui.separator();
                ui.colored_label(ui.visuals().error_fg_color, err);
            }
        });

        ui.menu_button("Help", |ui| {
            if ui.button("About VDataEditor").clicked() {
                actions.push(AppAction::About);
                ui.close();
            }
            ui.hyperlink_to("GitHub", "https://github.com/dertwist/VDataEditor");
        });
    });
}
