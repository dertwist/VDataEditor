//! The property tree pane: a virtualized, editable view of the document.
//!
//! Only visible rows are laid out each frame (`ScrollArea::show_rows` over a
//! cached flattened row list), which keeps 200k+ node documents at
//! interactive frame rates. Edits are applied after rendering through
//! [`TreeAction`]s so the model is never mutated mid-traversal.

use egui::{Align, Color32, ComboBox, DragValue, Label, Layout, RichText, Sense, TextStyle, Vec2};
use kv3::KvValue;

use crate::doc::Document;
use crate::history::Cmd;
use crate::model::{DocModel, NodeId, Payload, Scalar};
use crate::schema::SchemaDb;

use super::theme::Palette;

pub const ROW_HEIGHT: f32 = 22.0;

/// Deferred edit produced by row widgets.
pub enum TreeAction {
    SetScalar {
        id: NodeId,
        new: Scalar,
        label: &'static str,
    },
    Rename {
        id: NodeId,
        new: String,
    },
    AddChild {
        parent: NodeId,
        key: String,
        value: KvValue,
    },
    Duplicate(NodeId),
    Delete(NodeId),
    CommentOut(NodeId),
    Uncomment(NodeId),
    Cast {
        id: NodeId,
        to: CastTarget,
    },
    ToggleSubclass(NodeId),
    MoveBy(NodeId, isize),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CastTarget {
    Str,
    Int,
    Double,
    Bool,
    Null,
    Object,
    Array,
    Resource,
    Soundevent,
    Panorama,
}

/// Case-insensitive ASCII substring search without allocating.
fn ci_contains(haystack: &str, needle_lower: &str) -> bool {
    if needle_lower.is_empty() {
        return true;
    }
    let h = haystack.as_bytes();
    let n = needle_lower.as_bytes();
    if n.len() > h.len() {
        return false;
    }
    'outer: for start in 0..=(h.len() - n.len()) {
        for (i, &nb) in n.iter().enumerate() {
            if h[start + i].to_ascii_lowercase() != nb {
                continue 'outer;
            }
        }
        return true;
    }
    false
}

fn scalar_matches(s: &Scalar, needle: &str) -> bool {
    match s {
        Scalar::Str(v) | Scalar::Comment(v) => ci_contains(v, needle),
        Scalar::Typed { value, .. } => ci_contains(value, needle),
        Scalar::Int(v) => ci_contains(&v.to_string(), needle),
        Scalar::Double(v) => ci_contains(&v.to_string(), needle),
        Scalar::Bool(v) => ci_contains(if *v { "true" } else { "false" }, needle),
        Scalar::Null => ci_contains("null", needle),
    }
}

/// Build the flattened list of visible rows.
pub fn flatten(model: &DocModel, search: &str) -> Vec<(NodeId, u16)> {
    let mut rows = Vec::with_capacity(256);
    if search.is_empty() {
        let mut stack: Vec<(NodeId, u16)> = vec![(model.root(), 0)];
        while let Some((id, depth)) = stack.pop() {
            rows.push((id, depth));
            let node = model.node(id);
            if node.expanded {
                let children = model.children(id);
                for &child in children.iter().rev() {
                    stack.push((child, depth + 1));
                }
            }
        }
        return rows;
    }

    // Filtered: keep nodes that match (key or value) plus all their ancestors,
    // with every ancestor force-expanded.
    let needle = search.to_lowercase();
    let mut keep = vec![false; model.len()];
    fn mark(model: &DocModel, id: NodeId, needle: &str, keep: &mut [bool]) -> bool {
        let node = model.node(id);
        let mut keep_this = ci_contains(&node.key, needle);
        if let Payload::Scalar(s) = &node.payload {
            keep_this |= scalar_matches(s, needle);
        }
        for &child in model.children(id) {
            keep_this |= mark(model, child, needle, keep);
        }
        keep[id as usize] = keep_this;
        keep_this
    }
    mark(model, model.root(), &needle, &mut keep);

    let mut stack: Vec<(NodeId, u16)> = vec![(model.root(), 0)];
    while let Some((id, depth)) = stack.pop() {
        if !keep[id as usize] {
            continue;
        }
        rows.push((id, depth));
        for &child in model.children(id).iter().rev() {
            stack.push((child, depth + 1));
        }
    }
    rows
}

fn ensure_flat(doc: &mut Document) {
    let model = &doc.model;
    let search_active = !doc.tree_view.search.is_empty();
    let key = (
        model.view_rev ^ if search_active { model.rev << 32 } else { 0 },
        model.structure_rev,
        doc.tree_view.search.clone(),
    );
    if doc.tree_view.flat_key.as_ref() != Some(&key) {
        doc.tree_view.flat = flatten(model, &doc.tree_view.search);
        doc.tree_view.flat_key = Some(key);
    }
}

/// Render the tree pane.
pub fn show(
    ui: &mut egui::Ui,
    doc: &mut Document,
    schema: Option<&SchemaDb>,
    palette: &'static Palette,
    focus_search: &mut bool,
) {
    let mut actions: Vec<TreeAction> = Vec::new();

    // ---- Toolbar ----
    ui.horizontal(|ui| {
        ui.add_space(2.0);
        let search =
            egui::TextEdit::singleline(&mut doc.tree_view.search).hint_text("Search… (Ctrl+F)");
        let resp = ui.add(search);
        if *focus_search {
            resp.request_focus();
            *focus_search = false;
        }
        if !doc.tree_view.search.is_empty() && ui.small_button("✕").clicked() {
            doc.tree_view.search.clear();
        }
        ui.separator();
        if ui.small_button("Expand all").clicked() {
            doc.model.expand_all(true);
        }
        if ui.small_button("Collapse").clicked() {
            doc.model.expand_all(false);
        }
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ensure_flat(doc);
            ui.label(
                RichText::new(format!("{} rows", doc.tree_view.flat.len()))
                    .color(palette.dim)
                    .small(),
            );
        });
    });
    ui.separator();

    ensure_flat(doc);
    let row_count = doc.tree_view.flat.len();
    let flat = std::mem::take(&mut doc.tree_view.flat);

    let mut scroll = egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .id_salt(("tree", doc.id));
    if let Some(row) = doc.tree_view.scroll_to_row.take() {
        scroll = scroll.vertical_scroll_offset(row as f32 * ROW_HEIGHT);
    }
    scroll.show_rows(ui, ROW_HEIGHT, row_count, |ui, range| {
        ui.set_min_width(ui.available_width());
        for index in range {
            let (id, depth) = flat[index];
            row_ui(ui, doc, schema, palette, id, depth, &mut actions);
        }
    });

    doc.tree_view.flat = flat;

    for action in actions {
        apply_action(doc, action);
    }
}

fn type_badge(model: &DocModel, id: NodeId, palette: &Palette) -> (&'static str, Color32) {
    match &model.node(id).payload {
        Payload::Object(_) => ("{}", palette.badge_object),
        Payload::Array(_) => ("[]", palette.badge_array),
        Payload::Scalar(Scalar::Str(_)) => ("ab", palette.badge_string),
        Payload::Scalar(Scalar::Int(_)) | Payload::Scalar(Scalar::Double(_)) => {
            ("#", palette.badge_number)
        }
        Payload::Scalar(Scalar::Bool(_)) => ("✓", palette.badge_bool),
        Payload::Scalar(Scalar::Typed { .. }) => ("::", palette.badge_typed),
        Payload::Scalar(Scalar::Comment(_)) => ("//", palette.badge_comment),
        Payload::Scalar(Scalar::Null) => ("∅", palette.badge_null),
    }
}

fn row_ui(
    ui: &mut egui::Ui,
    doc: &mut Document,
    schema: Option<&SchemaDb>,
    palette: &Palette,
    id: NodeId,
    depth: u16,
    actions: &mut Vec<TreeAction>,
) {
    let total_width = ui.available_width();
    let key_col = (total_width * 0.40).clamp(140.0, 460.0);

    ui.allocate_ui_with_layout(
        Vec2::new(total_width, ROW_HEIGHT),
        Layout::left_to_right(Align::Center),
        |ui| {
            ui.spacing_mut().item_spacing.x = 4.0;
            ui.add_space(4.0 + depth as f32 * 14.0);

            // Expand/collapse triangle.
            let is_container = doc.model.is_container(id);
            if is_container {
                let expanded = doc.model.node(id).expanded;
                let icon = if expanded { "⏷" } else { "⏵" };
                if ui
                    .add(Label::new(RichText::new(icon).color(palette.dim)).sense(Sense::click()))
                    .clicked()
                {
                    doc.model.set_expanded(id, !expanded);
                }
            } else {
                ui.add_space(12.0);
            }

            // Type badge.
            let (badge, color) = type_badge(&doc.model, id, palette);
            ui.label(RichText::new(badge).color(color).monospace().size(10.0));

            // Key / label, in a fixed-width column for value alignment.
            let used = ui.cursor().min.x - ui.max_rect().min.x;
            let key_width = (key_col - used).max(60.0);
            let renaming = matches!(doc.tree_view.renaming, Some((rid, _)) if rid == id);
            ui.allocate_ui_with_layout(
                Vec2::new(key_width, ROW_HEIGHT),
                Layout::left_to_right(Align::Center),
                |ui| {
                    if renaming {
                        rename_ui(ui, doc, id, actions);
                    } else {
                        key_ui(ui, doc, palette, id, is_container, actions);
                    }
                },
            );

            // Value widget.
            value_ui(ui, doc, schema, palette, id, actions);
        },
    );
}

fn key_ui(
    ui: &mut egui::Ui,
    doc: &mut Document,
    palette: &Palette,
    id: NodeId,
    is_container: bool,
    actions: &mut Vec<TreeAction>,
) {
    let model = &doc.model;
    let node = model.node(id);
    let label = model.label(id);
    let selected = doc.tree_view.selected == Some(id);
    let is_array_item = node.key.is_empty() && id != model.root();
    let is_comment = matches!(node.payload, Payload::Scalar(Scalar::Comment(_)));

    let mut text = RichText::new(if label.is_empty() { "·".to_owned() } else { label });
    text = if is_comment {
        text.color(palette.comment)
    } else if is_array_item {
        text.color(palette.dim)
    } else {
        text.color(palette.key)
    };
    if selected {
        text = text.strong().background_color(ui.visuals().selection.bg_fill);
    }

    let resp = ui.add(Label::new(text).truncate().sense(Sense::click()));
    if resp.clicked() {
        doc.tree_view.selected = Some(id);
    }
    if resp.double_clicked() && !node.key.is_empty() {
        doc.tree_view.renaming = Some((id, node.key.clone()));
    }
    if node.subclass {
        ui.label(RichText::new("subclass").color(palette.subclass).small());
    }

    resp.context_menu(|ui| {
        context_menu_ui(ui, doc, id, is_container, actions);
    });
}

fn rename_ui(ui: &mut egui::Ui, doc: &mut Document, id: NodeId, actions: &mut Vec<TreeAction>) {
    let Some((_, buf)) = &mut doc.tree_view.renaming else {
        return;
    };
    let resp = ui.add(
        egui::TextEdit::singleline(buf)
            .desired_width(f32::INFINITY)
            .font(TextStyle::Monospace),
    );
    resp.request_focus();
    let commit = resp.lost_focus();
    if commit {
        let (_, new_key) = doc.tree_view.renaming.take().unwrap();
        let cancel = ui.input(|i| i.key_pressed(egui::Key::Escape));
        if !cancel && !new_key.is_empty() && new_key != doc.model.node(id).key {
            actions.push(TreeAction::Rename { id, new: new_key });
        }
    }
}

fn context_menu_ui(
    ui: &mut egui::Ui,
    doc: &mut Document,
    id: NodeId,
    is_container: bool,
    actions: &mut Vec<TreeAction>,
) {
    let model = &doc.model;
    let node = model.node(id);
    let in_object_parent = node
        .parent
        .is_some_and(|p| matches!(model.node(p).payload, Payload::Object(_)));
    let is_comment = matches!(node.payload, Payload::Scalar(Scalar::Comment(_)));
    let is_root = id == model.root();

    if is_container {
        ui.menu_button("Add child", |ui| {
            let into_object = matches!(node.payload, Payload::Object(_));
            for (label, value) in [
                ("String", KvValue::String(String::new())),
                ("Number", KvValue::Int(0)),
                ("Float", KvValue::Double(0.0)),
                ("Bool", KvValue::Bool(false)),
                ("Object", KvValue::object()),
                ("Array", KvValue::Array(vec![])),
                (
                    "Resource",
                    KvValue::Typed {
                        kind: kv3::typed_kind::RESOURCE_NAME.to_owned(),
                        value: String::new(),
                    },
                ),
                ("Comment", KvValue::Comment(String::from(" "))),
            ] {
                if ui.button(label).clicked() {
                    let key = if into_object && !matches!(value, KvValue::Comment(_)) {
                        unique_key(model, id, "new_key")
                    } else {
                        String::new()
                    };
                    actions.push(TreeAction::AddChild {
                        parent: id,
                        key,
                        value,
                    });
                    ui.close();
                }
            }
        });
    }

    if !is_root {
        if in_object_parent && !node.key.is_empty() && ui.button("Rename").clicked() {
            doc.tree_view.renaming = Some((id, node.key.clone()));
            ui.close();
        }
        if ui.button("Duplicate").clicked() {
            actions.push(TreeAction::Duplicate(id));
            ui.close();
        }
        if ui.button("Move up").clicked() {
            actions.push(TreeAction::MoveBy(id, -1));
            ui.close();
        }
        if ui.button("Move down").clicked() {
            actions.push(TreeAction::MoveBy(id, 1));
            ui.close();
        }
        ui.separator();
        if is_comment {
            if ui.button("Uncomment (parse)").clicked() {
                actions.push(TreeAction::Uncomment(id));
                ui.close();
            }
        } else if !is_container && ui.button("Comment out").clicked() {
            actions.push(TreeAction::CommentOut(id));
            ui.close();
        }
    }

    ui.menu_button("Cast to", |ui| {
        for (label, target) in [
            ("String", CastTarget::Str),
            ("Int", CastTarget::Int),
            ("Float", CastTarget::Double),
            ("Bool", CastTarget::Bool),
            ("Null", CastTarget::Null),
            ("Object", CastTarget::Object),
            ("Array", CastTarget::Array),
            ("resource_name:", CastTarget::Resource),
            ("soundevent:", CastTarget::Soundevent),
            ("panorama:", CastTarget::Panorama),
        ] {
            if ui.button(label).clicked() {
                actions.push(TreeAction::Cast { id, to: target });
                ui.close();
            }
        }
    });
    if ui
        .checkbox(&mut node.subclass.clone(), "subclass: prefix")
        .clicked()
    {
        actions.push(TreeAction::ToggleSubclass(id));
        ui.close();
    }

    if !is_root {
        ui.separator();
        if ui
            .button(RichText::new("Delete").color(ui.visuals().error_fg_color))
            .clicked()
        {
            actions.push(TreeAction::Delete(id));
            ui.close();
        }
    }
}

/// Editable text bound to a temp buffer; commits live, clears when unfocused.
fn editable_text(
    ui: &mut egui::Ui,
    salt: (&str, NodeId),
    current: &str,
    width: f32,
    color: Option<Color32>,
) -> Option<String> {
    let id = egui::Id::new(salt);
    let mut buf: String = ui
        .data(|d| d.get_temp(id))
        .unwrap_or_else(|| current.to_owned());
    let mut edit = egui::TextEdit::singleline(&mut buf)
        .desired_width(width)
        .font(TextStyle::Monospace);
    if let Some(c) = color {
        edit = edit.text_color(c);
    }
    let resp = ui.add(edit);
    let out = resp.changed().then(|| buf.clone());
    if resp.has_focus() {
        ui.data_mut(|d| d.insert_temp(id, buf));
    } else {
        ui.data_mut(|d| d.remove_temp::<String>(id));
    }
    out
}

fn value_ui(
    ui: &mut egui::Ui,
    doc: &mut Document,
    schema: Option<&SchemaDb>,
    palette: &Palette,
    id: NodeId,
    actions: &mut Vec<TreeAction>,
) {
    let payload = doc.model.node(id).payload.clone();
    match payload {
        Payload::Scalar(Scalar::Bool(b)) => {
            let mut v = b;
            if ui.checkbox(&mut v, "").changed() {
                actions.push(TreeAction::SetScalar {
                    id,
                    new: Scalar::Bool(v),
                    label: "Toggle value",
                });
            }
        }
        Payload::Scalar(Scalar::Int(i)) => {
            let mut v = i;
            if ui.add(DragValue::new(&mut v).speed(1)).changed() {
                actions.push(TreeAction::SetScalar {
                    id,
                    new: Scalar::Int(v),
                    label: "Edit number",
                });
            }
        }
        Payload::Scalar(Scalar::Double(d)) => {
            let mut v = d;
            let speed = (v.abs() * 0.01).clamp(0.01, 10.0);
            if ui.add(DragValue::new(&mut v).speed(speed)).changed() {
                actions.push(TreeAction::SetScalar {
                    id,
                    new: Scalar::Double(v),
                    label: "Edit number",
                });
            }
        }
        Payload::Scalar(Scalar::Str(s)) => {
            string_value_ui(ui, doc, schema, palette, id, &s, actions);
        }
        Payload::Scalar(Scalar::Typed { kind, value }) => {
            ui.label(RichText::new(format!("{kind}:")).color(palette.typed).small());
            let avail = ui.available_width() - 8.0;
            if let Some(new) = editable_text(ui, ("typed", id), &value, avail, None) {
                actions.push(TreeAction::SetScalar {
                    id,
                    new: Scalar::Typed { kind, value: new },
                    label: "Edit value",
                });
            }
        }
        Payload::Scalar(Scalar::Comment(text)) => {
            let avail = ui.available_width() - 8.0;
            if let Some(new) =
                editable_text(ui, ("comment", id), &text, avail, Some(palette.comment))
            {
                actions.push(TreeAction::SetScalar {
                    id,
                    new: Scalar::Comment(new.replace('\n', " ")),
                    label: "Edit comment",
                });
            }
        }
        Payload::Scalar(Scalar::Null) => {
            ui.label(RichText::new("null").color(palette.badge_null).italics());
        }
        Payload::Array(children) => {
            if !inline_vector_ui(ui, doc, palette, id, &children, actions) {
                container_summary_ui(ui, doc, palette, id, false);
            }
        }
        Payload::Object(_) => container_summary_ui(ui, doc, palette, id, true),
    }
}

fn string_value_ui(
    ui: &mut egui::Ui,
    doc: &mut Document,
    schema: Option<&SchemaDb>,
    palette: &Palette,
    id: NodeId,
    current: &str,
    actions: &mut Vec<TreeAction>,
) {
    let key = doc.model.node(id).key.clone();

    // Schema enum members plus values harvested from the document itself.
    let mut suggestions: Vec<String> = Vec::new();
    if !key.is_empty() {
        if let Some(db) = schema {
            if let Some(values) = db.enum_values_for_field(&key) {
                suggestions.extend(values.iter().cloned());
            }
        }
        for value in doc.suggestions_for(&key) {
            if !suggestions.contains(&value) {
                suggestions.push(value);
            }
        }
    }

    let combo_width = if suggestions.is_empty() { 0.0 } else { 24.0 };
    let avail = (ui.available_width() - combo_width - 12.0).max(40.0);
    if let Some(new) = editable_text(ui, ("str", id), current, avail, Some(palette.string)) {
        actions.push(TreeAction::SetScalar {
            id,
            new: Scalar::Str(new),
            label: "Edit value",
        });
    }
    if !suggestions.is_empty() {
        ComboBox::from_id_salt(("enum", id))
            .selected_text("")
            .width(18.0)
            .height(320.0)
            .show_ui(ui, |ui| {
                for value in &suggestions {
                    if ui.selectable_label(current == value, value).clicked() {
                        actions.push(TreeAction::SetScalar {
                            id,
                            new: Scalar::Str(value.clone()),
                            label: "Pick enum value",
                        });
                    }
                }
            });
    }
}

/// Inline editors for short numeric arrays (vectors and colors).
/// Returns false when the array should render as a normal container row.
fn inline_vector_ui(
    ui: &mut egui::Ui,
    doc: &mut Document,
    palette: &Palette,
    id: NodeId,
    children: &[NodeId],
    actions: &mut Vec<TreeAction>,
) -> bool {
    if children.is_empty() || children.len() > 4 {
        return false;
    }
    let mut values: Vec<Scalar> = Vec::with_capacity(children.len());
    for &child in children {
        match &doc.model.node(child).payload {
            Payload::Scalar(s @ (Scalar::Int(_) | Scalar::Double(_))) => values.push(s.clone()),
            _ => return false,
        }
    }

    // Color swatch for [r, g, b] / [r, g, b, a] byte arrays under *color* keys.
    let key = &doc.model.node(id).key;
    let is_colorish = ci_contains(key, "color")
        && children.len() >= 3
        && values
            .iter()
            .all(|v| matches!(v, Scalar::Int(i) if (0..=255).contains(i)));
    if is_colorish {
        let byte = |s: &Scalar| match s {
            Scalar::Int(i) => *i as u8,
            _ => 0,
        };
        let mut color = [
            byte(&values[0]),
            byte(&values[1]),
            byte(&values[2]),
            values.get(3).map(&byte).unwrap_or(255),
        ];
        let mut srgba = Color32::from_rgba_unmultiplied(color[0], color[1], color[2], color[3]);
        if ui.color_edit_button_srgba(&mut srgba).changed() {
            color = [srgba.r(), srgba.g(), srgba.b(), srgba.a()];
            for (i, &child) in children.iter().enumerate().take(4) {
                if i < values.len() {
                    actions.push(TreeAction::SetScalar {
                        id: child,
                        new: Scalar::Int(color[i] as i64),
                        label: "Edit color",
                    });
                }
            }
        }
    }

    const AXES: [&str; 4] = ["x", "y", "z", "w"];
    for (i, &child) in children.iter().enumerate() {
        if !is_colorish {
            ui.label(RichText::new(AXES[i]).color(palette.dim).small());
        }
        match values[i] {
            Scalar::Int(v) => {
                let mut v = v;
                if ui.add(DragValue::new(&mut v).speed(1)).changed() {
                    actions.push(TreeAction::SetScalar {
                        id: child,
                        new: Scalar::Int(v),
                        label: "Edit vector",
                    });
                }
            }
            Scalar::Double(v) => {
                let mut v = v;
                let speed = (v.abs() * 0.01).clamp(0.01, 10.0);
                if ui.add(DragValue::new(&mut v).speed(speed)).changed() {
                    actions.push(TreeAction::SetScalar {
                        id: child,
                        new: Scalar::Double(v),
                        label: "Edit vector",
                    });
                }
            }
            _ => {}
        }
    }
    true
}

fn container_summary_ui(
    ui: &mut egui::Ui,
    doc: &mut Document,
    palette: &Palette,
    id: NodeId,
    is_object: bool,
) {
    let count = doc.model.children(id).len();
    let summary = if is_object {
        format!("{{ {count} }}")
    } else {
        format!("[ {count} ]")
    };
    let resp = ui.add(
        Label::new(RichText::new(summary).color(palette.dim).monospace()).sense(Sense::click()),
    );
    if resp.clicked() {
        let expanded = doc.model.node(id).expanded;
        doc.model.set_expanded(id, !expanded);
    }
    // Show the _class of objects, a common orientation aid in Valve data.
    if is_object {
        let class = doc.model.children(id).iter().find_map(|&c| {
            let n = doc.model.node(c);
            if n.key == "_class" || n.key == "generic_data_type" {
                if let Payload::Scalar(Scalar::Str(s)) = &n.payload {
                    return Some(s.clone());
                }
            }
            None
        });
        if let Some(class) = class {
            ui.label(RichText::new(class).color(palette.subclass).small());
        }
    }
}

fn unique_key(model: &DocModel, parent: NodeId, base: &str) -> String {
    let existing: Vec<&str> = model
        .children(parent)
        .iter()
        .map(|&c| model.node(c).key.as_str())
        .collect();
    if !existing.contains(&base) {
        return base.to_owned();
    }
    for i in 2.. {
        let candidate = format!("{base}_{i}");
        if !existing.contains(&candidate.as_str()) {
            return candidate;
        }
    }
    unreachable!()
}

/// Serialize a scalar exactly as the KV3 serializer would, for comment-out.
fn scalar_to_inline_kv3(scalar: &Scalar) -> String {
    let value = crate::model::scalar_to_value(scalar);
    let text = kv3::to_kv3_text(&value, "", kv3::DEFAULT_STYLE);
    text.trim_start_matches('\n').trim().to_owned()
}

pub fn apply_action(doc: &mut Document, action: TreeAction) {
    let model = &mut doc.model;
    match action {
        TreeAction::SetScalar { id, new, label } => {
            let old = model.node(id).payload.clone();
            let new = Payload::Scalar(new);
            if old != new {
                doc.history.push(model, Cmd::SetPayload { id, old, new }, label);
                doc.mark_edited();
            }
        }
        TreeAction::Rename { id, new } => {
            let old = model.node(id).key.clone();
            if old != new {
                doc.history
                    .push(model, Cmd::Rename { id, old, new }, "Rename key");
                doc.mark_edited();
            }
        }
        TreeAction::AddChild { parent, key, value } => {
            let id = model.create_detached(&value, key);
            let index = model.children(parent).len();
            doc.history
                .push(model, Cmd::Insert { parent, index, id }, "Add property");
            model.set_expanded(parent, true);
            doc.tree_view.selected = Some(id);
            doc.mark_edited();
        }
        TreeAction::Duplicate(id) => {
            let Some((parent, index)) = model.index_in_parent(id) else {
                return;
            };
            let value = model.subtree_to_value(id);
            let key = if model.node(id).key.is_empty() {
                String::new()
            } else {
                unique_key(model, parent, &model.node(id).key.clone())
            };
            let copy = model.create_detached(&value, key);
            doc.history.push(
                model,
                Cmd::Insert {
                    parent,
                    index: index + 1,
                    id: copy,
                },
                "Duplicate",
            );
            doc.tree_view.selected = Some(copy);
            doc.mark_edited();
        }
        TreeAction::Delete(id) => {
            let Some((parent, index)) = model.index_in_parent(id) else {
                return;
            };
            doc.history
                .push(model, Cmd::Remove { parent, index, id }, "Delete");
            if doc.tree_view.selected == Some(id) {
                doc.tree_view.selected = None;
            }
            doc.mark_edited();
        }
        TreeAction::CommentOut(id) => {
            let node = model.node(id);
            let Payload::Scalar(scalar) = &node.payload else {
                return;
            };
            let inline = scalar_to_inline_kv3(scalar);
            let text = if node.key.is_empty() {
                format!(" {inline}")
            } else {
                format!(" {} = {inline}", node.key)
            };
            let old = node.payload.clone();
            let old_key = node.key.clone();
            doc.history.push(
                model,
                Cmd::Batch(vec![
                    Cmd::Rename {
                        id,
                        old: old_key,
                        new: String::new(),
                    },
                    Cmd::SetPayload {
                        id,
                        old,
                        new: Payload::Scalar(Scalar::Comment(text)),
                    },
                ]),
                "Comment out",
            );
            doc.mark_edited();
        }
        TreeAction::Uncomment(id) => {
            let Payload::Scalar(Scalar::Comment(text)) = &model.node(id).payload else {
                return;
            };
            // Re-parse the comment text as either `key = value` or `value`.
            let wrapped = format!("{{ {} }}", text.trim());
            let parsed = kv3::parse_value_text(&wrapped);
            let KvValue::Object(mut entries) = parsed else {
                return;
            };
            let Some((key, value)) = entries.pop() else {
                return;
            };
            if matches!(value, KvValue::Comment(_)) {
                return;
            }
            let in_object = model
                .node(id)
                .parent
                .is_some_and(|p| matches!(model.node(p).payload, Payload::Object(_)));
            let old = model.node(id).payload.clone();
            let new_id = model.create_detached(&value, String::new());
            let new_payload = model.node(new_id).payload.clone();
            let subclass = model.node(new_id).subclass;
            let mut cmds = vec![Cmd::SetPayload {
                id,
                old,
                new: new_payload,
            }];
            if subclass != model.node(id).subclass {
                cmds.push(Cmd::SetSubclass {
                    id,
                    old: model.node(id).subclass,
                    new: subclass,
                });
            }
            if in_object && !key.is_empty() {
                cmds.push(Cmd::Rename {
                    id,
                    old: model.node(id).key.clone(),
                    new: key,
                });
            }
            doc.history.push(model, Cmd::Batch(cmds), "Uncomment");
            doc.mark_edited();
        }
        TreeAction::Cast { id, to } => {
            let old = model.node(id).payload.clone();
            let new = cast_payload(&old, to);
            if old != new {
                doc.history
                    .push(model, Cmd::SetPayload { id, old, new }, "Cast type");
                doc.mark_edited();
            }
        }
        TreeAction::ToggleSubclass(id) => {
            let old = model.node(id).subclass;
            doc.history.push(
                model,
                Cmd::SetSubclass {
                    id,
                    old,
                    new: !old,
                },
                "Toggle subclass",
            );
            doc.mark_edited();
        }
        TreeAction::MoveBy(id, delta) => {
            let Some((parent, index)) = model.index_in_parent(id) else {
                return;
            };
            let len = model.children(parent).len();
            let to = index as isize + delta;
            if to < 0 || to as usize >= len {
                return;
            }
            doc.history.push(
                model,
                Cmd::Move {
                    parent,
                    from: index,
                    to: to as usize,
                },
                "Move",
            );
            doc.mark_edited();
        }
    }
}

fn scalar_as_string(s: &Scalar) -> String {
    match s {
        Scalar::Str(v) | Scalar::Comment(v) => v.clone(),
        Scalar::Typed { value, .. } => value.clone(),
        Scalar::Int(v) => v.to_string(),
        Scalar::Double(v) => v.to_string(),
        Scalar::Bool(v) => v.to_string(),
        Scalar::Null => String::new(),
    }
}

fn cast_payload(old: &Payload, to: CastTarget) -> Payload {
    let text = match old {
        Payload::Scalar(s) => scalar_as_string(s),
        _ => String::new(),
    };
    match to {
        CastTarget::Str => Payload::Scalar(Scalar::Str(text)),
        CastTarget::Int => Payload::Scalar(Scalar::Int(
            text.trim().parse().unwrap_or_else(|_| {
                text.trim().parse::<f64>().map(|f| f as i64).unwrap_or(0)
            }),
        )),
        CastTarget::Double => Payload::Scalar(Scalar::Double(text.trim().parse().unwrap_or(0.0))),
        CastTarget::Bool => Payload::Scalar(Scalar::Bool(matches!(
            text.trim().to_ascii_lowercase().as_str(),
            "true" | "1" | "yes"
        ))),
        CastTarget::Null => Payload::Scalar(Scalar::Null),
        CastTarget::Object => match old {
            Payload::Object(c) => Payload::Object(c.clone()),
            Payload::Array(c) => Payload::Object(c.clone()),
            _ => Payload::Object(vec![]),
        },
        CastTarget::Array => match old {
            Payload::Array(c) => Payload::Array(c.clone()),
            Payload::Object(c) => Payload::Array(c.clone()),
            _ => Payload::Array(vec![]),
        },
        CastTarget::Resource => Payload::Scalar(Scalar::Typed {
            kind: kv3::typed_kind::RESOURCE_NAME.to_owned(),
            value: text,
        }),
        CastTarget::Soundevent => Payload::Scalar(Scalar::Typed {
            kind: kv3::typed_kind::SOUNDEVENT.to_owned(),
            value: text,
        }),
        CastTarget::Panorama => Payload::Scalar(Scalar::Typed {
            kind: kv3::typed_kind::PANORAMA.to_owned(),
            value: text,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ci_contains_works() {
        assert!(ci_contains("HelloWorld", "oworl"));
        assert!(ci_contains("abc", ""));
        assert!(!ci_contains("abc", "abcd"));
        assert!(ci_contains("M_strValue", "m_str"));
    }

    #[test]
    fn flatten_respects_expansion() {
        let mut doc = Document::from_text(
            1,
            "{ a = { b = 1 c = 2 } d = [1, 2, 3] }",
            "t.vdata".into(),
            None,
        );
        // Small doc: depth-1 pre-expanded → root, a, b, c, d, three items.
        assert_eq!(flatten(&doc.model, "").len(), 8);
        let root = doc.model.root();
        let a = doc.model.children(root)[0];
        doc.model.set_expanded(a, false);
        assert_eq!(flatten(&doc.model, "").len(), 6);
    }

    #[test]
    fn flatten_search_keeps_matches_and_ancestors() {
        let doc = Document::from_text(
            1,
            "{ alpha = { target_key = 1 other = 2 } beta = { x = 3 } }",
            "t.vdata".into(),
            None,
        );
        let rows = flatten(&doc.model, "target");
        // root, alpha, target_key
        assert_eq!(rows.len(), 3);
        let rows = flatten(&doc.model, "3");
        // root, beta, x (value match)
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn comment_out_and_uncomment_round_trip() {
        let mut doc = Document::from_text(1, "{ a = 5 }", "t.vdata".into(), None);
        let before = doc.model.to_value();
        let a = doc.model.children(doc.model.root())[0];
        apply_action(&mut doc, TreeAction::CommentOut(a));
        match &doc.model.node(a).payload {
            Payload::Scalar(Scalar::Comment(text)) => assert_eq!(text, " a = 5"),
            other => panic!("expected comment, got {other:?}"),
        }
        apply_action(&mut doc, TreeAction::Uncomment(a));
        assert_eq!(doc.model.to_value(), before);
        // Undo twice restores the comment then the original.
        doc.history.undo(&mut doc.model);
        assert!(matches!(
            &doc.model.node(a).payload,
            Payload::Scalar(Scalar::Comment(_))
        ));
        doc.history.undo(&mut doc.model);
        assert_eq!(doc.model.to_value(), before);
    }

    #[test]
    fn cast_conversions() {
        let p = Payload::Scalar(Scalar::Str("42".into()));
        assert_eq!(
            cast_payload(&p, CastTarget::Int),
            Payload::Scalar(Scalar::Int(42))
        );
        let p = Payload::Scalar(Scalar::Int(7));
        assert_eq!(
            cast_payload(&p, CastTarget::Str),
            Payload::Scalar(Scalar::Str("7".into()))
        );
        let p = Payload::Scalar(Scalar::Str("true".into()));
        assert_eq!(
            cast_payload(&p, CastTarget::Bool),
            Payload::Scalar(Scalar::Bool(true))
        );
    }

    #[test]
    fn unique_key_suffixes() {
        let doc = Document::from_text(1, "{ a = 1 a_2 = 2 }", "t.vdata".into(), None);
        let root = doc.model.root();
        assert_eq!(unique_key(&doc.model, root, "b"), "b");
        assert_eq!(unique_key(&doc.model, root, "a"), "a_3");
    }
}
