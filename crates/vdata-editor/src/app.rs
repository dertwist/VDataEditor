//! Application shell: the egui_tiles dock, document lifecycle, menus,
//! dialogs and persistence.
//!
//! Layout model: the tile tree's root is a `Tabs` container with one tab per
//! document; each tab holds a horizontal split of the property-tree pane and
//! the raw-text pane. Because every pane is an `egui_tiles` tile, users can
//! drag panes into any arrangement (side-by-side documents, stacked text
//! views, …) and reset to the default layout from the View menu.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, channel};

use egui_tiles::{Container, Linear, LinearDir, SimplificationOptions, Tile, TileId, Tiles, Tree};

use crate::doc::{DocId, Document};
use crate::schema::SchemaStore;
use crate::ui;
use crate::ui::theme::{Palette, Theme, apply_theme, palette};

/// One dockable pane.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pane {
    Tree(DocId),
    Text(DocId),
}

impl Pane {
    pub fn doc_id(&self) -> DocId {
        match self {
            Pane::Tree(id) | Pane::Text(id) => *id,
        }
    }
}

pub enum AppAction {
    NewDoc,
    OpenDialog,
    OpenPath(PathBuf),
    Save,
    SaveAs,
    CloseActive,
    CloseTile(TileId),
    Undo,
    Redo,
    Find,
    ExpandAll(bool),
    ResetLayout,
    SetTheme(Theme),
    Zoom(f32),
    LoadSchema(String),
    UnloadSchema,
    ClearRecent,
    About,
    Quit,
}

enum DialogMsg {
    Opened(Vec<PathBuf>),
    SavedAs(DocId, PathBuf),
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct PersistedSettings {
    theme: Theme,
    recent: Vec<PathBuf>,
    schema_game: Option<String>,
}

pub struct App {
    pub docs: Vec<Document>,
    next_doc_id: DocId,
    pub tiles: Tree<Pane>,
    pub schema: SchemaStore,
    theme: Theme,
    recent: Vec<PathBuf>,
    actions: Vec<AppAction>,
    /// Tile whose close was requested while it contained dirty documents.
    confirm_close: Option<(TileId, Vec<DocId>)>,
    about_open: bool,
    dialog_rx: Option<Receiver<DialogMsg>>,
    focus_search: bool,
    pub last_error: Option<String>,
    active_doc: Option<DocId>,
    theme_applied: bool,
    window_title: String,
}

pub const FILE_FILTER: (&str, &[&str]) = (
    "Source 2 data",
    &[
        "vdata", "vsmart", "vpcf", "kv3", "vsurf", "vsndstck", "vsndevts", "vpulse", "vmdl",
        "vmix", "vrman", "vmat", "vmt", "json", "txt",
    ],
);

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>, files: Vec<PathBuf>) -> Self {
        let settings: PersistedSettings = cc
            .storage
            .and_then(|s| s.get_string("vdata-settings"))
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();

        let mut app = App {
            docs: Vec::new(),
            next_doc_id: 1,
            tiles: Tree::empty("vdata-tiles"),
            schema: SchemaStore::default(),
            theme: settings.theme,
            recent: settings.recent,
            actions: Vec::new(),
            confirm_close: None,
            about_open: false,
            dialog_rx: None,
            focus_search: false,
            last_error: None,
            active_doc: None,
            theme_applied: false,
            window_title: String::new(),
        };
        if let Some(game) = settings.schema_game {
            app.schema.request_load(&game);
        }
        for file in files {
            app.open_path(&file);
        }
        if app.docs.is_empty() {
            app.new_doc();
        }
        app
    }

    /// Headless constructor used by integration tests.
    pub fn new_for_test() -> Self {
        App {
            docs: Vec::new(),
            next_doc_id: 1,
            tiles: Tree::empty("vdata-tiles"),
            schema: SchemaStore::default(),
            theme: Theme::Dark,
            recent: Vec::new(),
            actions: Vec::new(),
            confirm_close: None,
            about_open: false,
            dialog_rx: None,
            focus_search: false,
            last_error: None,
            active_doc: None,
            theme_applied: false,
            window_title: String::new(),
        }
    }

    pub fn palette(&self) -> &'static Palette {
        palette(self.theme)
    }

    fn doc_mut(&mut self, id: DocId) -> Option<&mut Document> {
        self.docs.iter_mut().find(|d| d.id == id)
    }

    fn doc(&self, id: DocId) -> Option<&Document> {
        self.docs.iter().find(|d| d.id == id)
    }

    pub fn active_doc_id(&self) -> Option<DocId> {
        self.active_doc
            .filter(|id| self.doc(*id).is_some())
            .or_else(|| self.docs.first().map(|d| d.id))
    }

    // ---- Document lifecycle ----

    pub fn new_doc(&mut self) -> DocId {
        let id = self.next_doc_id;
        self.next_doc_id += 1;
        self.docs.push(Document::new_untitled(id));
        self.add_doc_tab(id);
        self.active_doc = Some(id);
        id
    }

    pub fn open_path(&mut self, path: &Path) {
        // Re-activate if already open.
        if let Some(doc) = self
            .docs
            .iter()
            .find(|d| d.file_path.as_deref() == Some(path))
        {
            let id = doc.id;
            self.activate_doc(id);
            return;
        }
        let id = self.next_doc_id;
        match Document::open(id, path) {
            Ok(doc) => {
                self.next_doc_id += 1;
                self.docs.push(doc);
                self.add_doc_tab(id);
                self.active_doc = Some(id);
                self.push_recent(path.to_path_buf());
            }
            Err(err) => {
                self.last_error = Some(format!("Could not open {}: {err}", path.display()));
            }
        }
    }

    fn push_recent(&mut self, path: PathBuf) {
        self.recent.retain(|p| p != &path);
        self.recent.insert(0, path);
        self.recent.truncate(12);
    }

    /// Insert the default tab (tree | text split) for a document.
    fn add_doc_tab(&mut self, doc_id: DocId) {
        let tree_pane = self.tiles.tiles.insert_pane(Pane::Tree(doc_id));
        let text_pane = self.tiles.tiles.insert_pane(Pane::Text(doc_id));
        let split = Linear::new_binary(LinearDir::Horizontal, [tree_pane, text_pane], 0.58);
        let tab = self
            .tiles
            .tiles
            .insert_new(Tile::Container(Container::Linear(split)));

        match self.tiles.root {
            Some(root_id) => {
                if let Some(Tile::Container(Container::Tabs(tabs))) =
                    self.tiles.tiles.get_mut(root_id)
                {
                    tabs.add_child(tab);
                    tabs.set_active(tab);
                } else {
                    // Root was rearranged into something else: wrap it.
                    let new_root = self.tiles.tiles.insert_new(Tile::Container(
                        Container::new_tabs(vec![root_id, tab]),
                    ));
                    self.tiles.root = Some(new_root);
                    if let Some(Tile::Container(Container::Tabs(tabs))) =
                        self.tiles.tiles.get_mut(new_root)
                    {
                        tabs.set_active(tab);
                    }
                }
            }
            None => {
                let root = self
                    .tiles
                    .tiles
                    .insert_new(Tile::Container(Container::new_tabs(vec![tab])));
                self.tiles.root = Some(root);
            }
        }
    }

    fn activate_doc(&mut self, doc_id: DocId) {
        self.active_doc = Some(doc_id);
        // Make the tab containing the doc's first pane active.
        let target = self.tiles.tiles.iter().find_map(|(tile_id, tile)| {
            matches!(tile, Tile::Pane(p) if p.doc_id() == doc_id).then_some(*tile_id)
        });
        if let Some(tile_id) = target {
            let _ = self.tiles.make_active(|id, _| id == tile_id);
        }
    }

    fn rebuild_layout(&mut self) {
        self.tiles = Tree::empty("vdata-tiles");
        let ids: Vec<DocId> = self.docs.iter().map(|d| d.id).collect();
        for id in ids {
            self.add_doc_tab(id);
        }
    }

    /// Document ids whose panes all live under `tile`.
    fn docs_fully_inside(&self, tile: TileId) -> Vec<DocId> {
        let mut inside: Vec<DocId> = Vec::new();
        let mut stack = vec![tile];
        while let Some(id) = stack.pop() {
            match self.tiles.tiles.get(id) {
                Some(Tile::Pane(pane)) => inside.push(pane.doc_id()),
                Some(Tile::Container(container)) => stack.extend(container.children().copied()),
                None => {}
            }
        }
        inside.sort_unstable();
        inside.dedup();
        // Exclude docs that still have panes elsewhere.
        inside.retain(|doc_id| {
            !self.tiles.tiles.iter().any(|(tid, t)| {
                matches!(t, Tile::Pane(p) if p.doc_id() == *doc_id)
                    && !tile_contains(&self.tiles.tiles, tile, *tid)
            })
        });
        inside
    }

    fn close_tile(&mut self, tile: TileId, force: bool) {
        let doc_ids = self.docs_fully_inside(tile);
        if !force {
            let dirty: Vec<DocId> = doc_ids
                .iter()
                .copied()
                .filter(|id| self.doc(*id).is_some_and(Document::dirty))
                .collect();
            if !dirty.is_empty() {
                self.confirm_close = Some((tile, dirty));
                return;
            }
        }
        self.tiles.remove_recursively(tile);
        self.docs.retain(|d| !doc_ids.contains(&d.id));
        if self
            .active_doc
            .is_some_and(|id| doc_ids.contains(&id))
        {
            self.active_doc = self.docs.first().map(|d| d.id);
        }
    }

    fn tile_of_active_doc(&self) -> Option<TileId> {
        let doc_id = self.active_doc_id()?;
        // Find the tab-level ancestor of the doc's panes: child of root tabs.
        let root = self.tiles.root()?;
        let pane_tile = self.tiles.tiles.iter().find_map(|(tile_id, tile)| {
            matches!(tile, Tile::Pane(p) if p.doc_id() == doc_id).then_some(*tile_id)
        })?;
        // Walk up until the parent is the root.
        let mut current = pane_tile;
        loop {
            let parent = self.tiles.tiles.parent_of(current)?;
            if parent == root {
                return Some(current);
            }
            current = parent;
        }
    }

    // ---- Dialogs (run on background threads to keep the UI responsive) ----

    fn spawn_open_dialog(&mut self) {
        if self.dialog_rx.is_some() {
            return;
        }
        let (tx, rx) = channel();
        self.dialog_rx = Some(rx);
        std::thread::spawn(move || {
            let files = rfd::FileDialog::new()
                .add_filter(FILE_FILTER.0, FILE_FILTER.1)
                .add_filter("All files", &["*"])
                .pick_files()
                .unwrap_or_default();
            let _ = tx.send(DialogMsg::Opened(files));
        });
    }

    fn spawn_save_dialog(&mut self, doc_id: DocId) {
        if self.dialog_rx.is_some() {
            return;
        }
        let Some(doc) = self.doc(doc_id) else { return };
        let file_name = doc.file_name.clone();
        let dir = doc
            .file_path
            .as_ref()
            .and_then(|p| p.parent().map(Path::to_path_buf));
        let (tx, rx) = channel();
        self.dialog_rx = Some(rx);
        std::thread::spawn(move || {
            let mut dialog = rfd::FileDialog::new()
                .set_file_name(&file_name)
                .add_filter(FILE_FILTER.0, FILE_FILTER.1);
            if let Some(dir) = dir {
                dialog = dialog.set_directory(dir);
            }
            if let Some(path) = dialog.save_file() {
                let _ = tx.send(DialogMsg::SavedAs(doc_id, path));
            } else {
                let _ = tx.send(DialogMsg::Opened(Vec::new()));
            }
        });
    }

    fn poll_dialogs(&mut self) {
        let Some(rx) = &self.dialog_rx else { return };
        match rx.try_recv() {
            Ok(DialogMsg::Opened(files)) => {
                self.dialog_rx = None;
                for file in files {
                    self.open_path(&file);
                }
            }
            Ok(DialogMsg::SavedAs(doc_id, path)) => {
                self.dialog_rx = None;
                self.save_doc_to(doc_id, &path);
            }
            Err(_) => {}
        }
    }

    fn save_doc_to(&mut self, doc_id: DocId, path: &Path) {
        if let Some(doc) = self.doc_mut(doc_id) {
            match doc.save_to(path) {
                Ok(()) => {
                    let path = path.to_path_buf();
                    self.push_recent(path);
                }
                Err(err) => {
                    self.last_error = Some(format!("Save failed: {err}"));
                }
            }
        }
    }

    fn save_active(&mut self) {
        let Some(id) = self.active_doc_id() else { return };
        let path = self.doc(id).and_then(|d| d.file_path.clone());
        match path {
            Some(path) => self.save_doc_to(id, &path),
            None => self.spawn_save_dialog(id),
        }
    }

    // ---- Action processing ----

    fn process_actions(&mut self, ctx: &egui::Context) {
        let actions = std::mem::take(&mut self.actions);
        for action in actions {
            match action {
                AppAction::NewDoc => {
                    self.new_doc();
                }
                AppAction::OpenDialog => self.spawn_open_dialog(),
                AppAction::OpenPath(path) => self.open_path(&path),
                AppAction::Save => self.save_active(),
                AppAction::SaveAs => {
                    if let Some(id) = self.active_doc_id() {
                        self.spawn_save_dialog(id);
                    }
                }
                AppAction::CloseActive => {
                    if let Some(tile) = self.tile_of_active_doc() {
                        self.close_tile(tile, false);
                    }
                }
                AppAction::CloseTile(tile) => self.close_tile(tile, false),
                AppAction::Undo => {
                    if let Some(doc) = self.active_doc_id().and_then(|id| self.doc_mut(id)) {
                        doc.history.undo(&mut doc.model);
                        doc.mark_edited();
                    }
                }
                AppAction::Redo => {
                    if let Some(doc) = self.active_doc_id().and_then(|id| self.doc_mut(id)) {
                        doc.history.redo(&mut doc.model);
                        doc.mark_edited();
                    }
                }
                AppAction::Find => self.focus_search = true,
                AppAction::ExpandAll(expanded) => {
                    if let Some(doc) = self.active_doc_id().and_then(|id| self.doc_mut(id)) {
                        doc.model.expand_all(expanded);
                    }
                }
                AppAction::ResetLayout => self.rebuild_layout(),
                AppAction::SetTheme(theme) => {
                    self.theme = theme;
                    apply_theme(ctx, theme);
                }
                AppAction::Zoom(delta) => {
                    let zoom = (ctx.zoom_factor() + delta).clamp(0.5, 2.5);
                    ctx.set_zoom_factor(zoom);
                }
                AppAction::LoadSchema(game) => self.schema.request_load(&game),
                AppAction::UnloadSchema => self.schema.unload(),
                AppAction::ClearRecent => self.recent.clear(),
                AppAction::About => self.about_open = true,
                AppAction::Quit => ctx.send_viewport_cmd(egui::ViewportCommand::Close),
            }
        }
    }

    fn confirm_close_modal(&mut self, ctx: &egui::Context) {
        let Some((tile, dirty)) = &self.confirm_close else {
            return;
        };
        let tile = *tile;
        let names: Vec<String> = dirty
            .iter()
            .filter_map(|id| self.doc(*id).map(|d| d.file_name.clone()))
            .collect();
        let savable = dirty
            .iter()
            .all(|id| self.doc(*id).is_some_and(|d| d.file_path.is_some()));

        let mut decided: Option<&'static str> = None;
        egui::Modal::new(egui::Id::new("confirm-close")).show(ctx, |ui| {
            ui.heading("Unsaved changes");
            ui.add_space(4.0);
            ui.label(format!(
                "{} has unsaved changes. Close anyway?",
                names.join(", ")
            ));
            ui.add_space(10.0);
            ui.horizontal(|ui| {
                if savable && ui.button("Save and close").clicked() {
                    decided = Some("save");
                }
                if ui
                    .button(egui::RichText::new("Discard").color(ui.visuals().error_fg_color))
                    .clicked()
                {
                    decided = Some("discard");
                }
                if ui.button("Cancel").clicked() {
                    decided = Some("cancel");
                }
            });
            if !savable {
                ui.label(
                    egui::RichText::new("(untitled documents: use Save As… first to keep them)")
                        .small(),
                );
            }
        });

        match decided {
            Some("save") => {
                let ids: Vec<DocId> = dirty.clone();
                for id in ids {
                    let path = self.doc(id).and_then(|d| d.file_path.clone());
                    if let Some(path) = path {
                        self.save_doc_to(id, &path);
                    }
                }
                self.confirm_close = None;
                self.close_tile(tile, true);
            }
            Some("discard") => {
                self.confirm_close = None;
                self.close_tile(tile, true);
            }
            Some("cancel") => self.confirm_close = None,
            _ => {}
        }
    }

    /// One full frame of UI; separated from the `eframe::App` impl so
    /// integration tests can drive it without a native window.
    pub fn run_frame(&mut self, ui: &mut egui::Ui) {
        let ctx = &ui.ctx().clone();
        if !self.theme_applied {
            apply_theme(ctx, self.theme);
            self.theme_applied = true;
        }
        if self.schema.poll() {
            ctx.request_repaint();
        }
        self.poll_dialogs();
        if self.dialog_rx.is_some() || self.schema.loading.is_some() {
            // Keep polling background threads even without input events.
            ctx.request_repaint_after(std::time::Duration::from_millis(100));
        }

        // Documents with pending text-pane syncs need a repaint to settle.
        if self
            .docs
            .iter()
            .any(|d| !d.text_pane.edited && d.text_pane.synced_rev != Some(d.model.rev))
        {
            ctx.request_repaint_after(std::time::Duration::from_millis(150));
        }

        // Reflect the active document (and its dirty state) in the title.
        let title = match self.active_doc_id().and_then(|id| self.doc(id)) {
            Some(doc) => format!("{} — VDataEditor", doc.title()),
            None => "VDataEditor".to_owned(),
        };
        if title != self.window_title {
            self.window_title = title.clone();
            ctx.send_viewport_cmd(egui::ViewportCommand::Title(title));
        }

        ui::menu::consume_shortcuts(ctx, &mut self.actions);

        // Dropped files.
        let dropped: Vec<PathBuf> = ctx.input(|i| {
            i.raw
                .dropped_files
                .iter()
                .filter_map(|f| f.path.clone())
                .collect()
        });
        for path in dropped {
            self.open_path(&path);
        }

        let palette = self.palette();

        let mut actions = std::mem::take(&mut self.actions);
        egui::Panel::top("menu").show_inside(ui, |ui| {
            let active = self.active_doc_id().and_then(|id| self.doc(id));
            ui::menu::menu_bar(ui, active, &self.recent, &self.schema, self.theme, &mut actions);
        });
        self.actions = actions;

        egui::Panel::bottom("status").show_inside(ui, |ui| {
            let schema = &self.schema;
            let active_id = self.active_doc_id();
            let doc = match active_id {
                Some(id) => self.docs.iter_mut().find(|d| d.id == id),
                None => None,
            };
            ui::status::status_bar(ui, doc, schema, palette);
        });

        // Error toast.
        if let Some(error) = self.last_error.clone() {
            egui::Panel::bottom("error").show_inside(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.colored_label(ui.visuals().error_fg_color, &error);
                    if ui.small_button("✕").clicked() {
                        self.last_error = None;
                    }
                });
            });
        }

        egui::CentralPanel::default().show_inside(ui, |ui| {
            if self.tiles.is_empty() {
                ui.centered_and_justified(|ui| {
                    ui.label("No documents open.\nFile ▸ New (Ctrl+N) or drop a file here.");
                });
            } else {
                let schema_db = self.schema.db.clone();
                let mut behavior = TilesBehavior {
                    docs: &mut self.docs,
                    schema: schema_db.as_deref(),
                    palette,
                    actions: &mut self.actions,
                    focus_search: &mut self.focus_search,
                    visible_docs: Vec::new(),
                };
                self.tiles.ui(&mut behavior, ui);
                let visible = behavior.visible_docs;
                if let Some(active) = self.active_doc {
                    if !visible.is_empty() && !visible.contains(&active) {
                        self.active_doc = visible.first().copied();
                    }
                } else {
                    self.active_doc = visible.first().copied();
                }
            }
        });

        self.confirm_close_modal(ctx);

        if self.about_open {
            let mut open = self.about_open;
            egui::Window::new("About VDataEditor")
                .open(&mut open)
                .collapsible(false)
                .resizable(false)
                .show(ctx, |ui| {
                    ui.label(format!("VDataEditor {}", env!("CARGO_PKG_VERSION")));
                    ui.label("Editor for Source 2 KV3 files (.vsmart, .vdata, .vpcf, .kv3).");
                    ui.label("Rust rewrite built with egui + egui_tiles.");
                    ui.hyperlink("https://github.com/dertwist/VDataEditor");
                });
            self.about_open = open;
        }

        self.process_actions(ctx);
    }

    fn persisted(&self) -> PersistedSettings {
        PersistedSettings {
            theme: self.theme,
            recent: self.recent.clone(),
            schema_game: self.schema.db.as_ref().map(|db| db.game.clone()),
        }
    }
}

fn tile_contains(tiles: &Tiles<Pane>, ancestor: TileId, needle: TileId) -> bool {
    if ancestor == needle {
        return true;
    }
    let mut stack = vec![ancestor];
    while let Some(id) = stack.pop() {
        if id == needle {
            return true;
        }
        if let Some(Tile::Container(container)) = tiles.get(id) {
            stack.extend(container.children().copied());
        }
    }
    false
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.run_frame(ui);
    }

    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        if let Ok(json) = serde_json::to_string(&self.persisted()) {
            storage.set_string("vdata-settings", json);
        }
    }
}

// ---- egui_tiles behavior ----

struct TilesBehavior<'a> {
    docs: &'a mut Vec<Document>,
    schema: Option<&'a crate::schema::SchemaDb>,
    palette: &'static Palette,
    actions: &'a mut Vec<AppAction>,
    focus_search: &'a mut bool,
    visible_docs: Vec<DocId>,
}

impl TilesBehavior<'_> {
    fn doc_title(&self, doc_id: DocId) -> String {
        self.docs
            .iter()
            .find(|d| d.id == doc_id)
            .map(Document::title)
            .unwrap_or_else(|| "(closed)".to_owned())
    }
}

impl egui_tiles::Behavior<Pane> for TilesBehavior<'_> {
    fn pane_ui(
        &mut self,
        ui: &mut egui::Ui,
        _tile_id: TileId,
        pane: &mut Pane,
    ) -> egui_tiles::UiResponse {
        let doc_id = pane.doc_id();
        if !self.visible_docs.contains(&doc_id) {
            self.visible_docs.push(doc_id);
        }
        let Some(doc) = self.docs.iter_mut().find(|d| d.id == doc_id) else {
            ui.centered_and_justified(|ui| {
                ui.label("Document closed");
            });
            return egui_tiles::UiResponse::None;
        };
        egui::Frame::new()
            .inner_margin(egui::Margin::symmetric(4, 4))
            .show(ui, |ui| match pane {
                Pane::Tree(_) => {
                    ui::tree::show(ui, doc, self.schema, self.palette, self.focus_search);
                }
                Pane::Text(_) => {
                    ui::text::show(ui, doc, self.palette);
                }
            });
        egui_tiles::UiResponse::None
    }

    fn tab_title_for_pane(&mut self, pane: &Pane) -> egui::WidgetText {
        let title = self.doc_title(pane.doc_id());
        match pane {
            Pane::Tree(_) => format!("🌳 {title}").into(),
            Pane::Text(_) => format!("📄 {title}").into(),
        }
    }

    fn tab_title_for_tile(&mut self, tiles: &Tiles<Pane>, tile_id: TileId) -> egui::WidgetText {
        match tiles.get(tile_id) {
            Some(Tile::Pane(pane)) => self.tab_title_for_pane(pane),
            Some(Tile::Container(container)) => {
                // A document tab: title from the first pane inside.
                let mut stack: Vec<TileId> = container.children().copied().collect();
                while let Some(id) = stack.pop() {
                    match tiles.get(id) {
                        Some(Tile::Pane(pane)) => {
                            return self.doc_title(pane.doc_id()).into();
                        }
                        Some(Tile::Container(c)) => stack.extend(c.children().copied()),
                        None => {}
                    }
                }
                format!("{:?}", container.kind()).into()
            }
            None => "—".into(),
        }
    }

    fn is_tab_closable(&self, _tiles: &Tiles<Pane>, _tile_id: TileId) -> bool {
        true
    }

    fn on_tab_close(&mut self, _tiles: &mut Tiles<Pane>, tile_id: TileId) -> bool {
        // Closing may need a confirmation dialog; route through the action
        // queue and keep the tile until the app decides.
        self.actions.push(AppAction::CloseTile(tile_id));
        false
    }

    fn top_bar_right_ui(
        &mut self,
        _tiles: &Tiles<Pane>,
        ui: &mut egui::Ui,
        _tile_id: TileId,
        _tabs: &egui_tiles::Tabs,
        _scroll_offset: &mut f32,
    ) {
        if ui.button("➕").on_hover_text("New document (Ctrl+N)").clicked() {
            self.actions.push(AppAction::NewDoc);
        }
    }

    fn simplification_options(&self) -> SimplificationOptions {
        SimplificationOptions {
            prune_empty_tabs: true,
            prune_empty_containers: true,
            prune_single_child_tabs: false,
            prune_single_child_containers: true,
            all_panes_must_have_tabs: false,
            join_nested_linear_containers: true,
        }
    }

    fn gap_width(&self, _style: &egui::Style) -> f32 {
        2.0
    }
}
