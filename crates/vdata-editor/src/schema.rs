//! Game schema support: enum members and widget hints per field name.
//!
//! The `schemas/` directory ships class/enum dumps for CS2, Dota 2 and
//! Deadlock (the same JSON bundles the original editor used). They are
//! large (8–29 MB), so they are parsed on a background thread and swapped
//! in when ready.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::{Receiver, Sender, channel};

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WidgetHint {
    Vec2,
    Vec3,
    Vec4,
    Color,
    Resource,
}

/// Loaded schema: lookup tables keyed by field name.
#[derive(Default)]
pub struct SchemaDb {
    pub game: String,
    /// enum name -> member names (file order).
    pub enums: HashMap<String, Arc<Vec<String>>>,
    /// field name -> enum name.
    pub field_enums: HashMap<String, String>,
    /// field name -> widget hint (vectors, colors, resources).
    pub field_widgets: HashMap<String, WidgetHint>,
    pub class_count: usize,
}

impl SchemaDb {
    pub fn enum_values_for_field(&self, field: &str) -> Option<&Arc<Vec<String>>> {
        self.enums.get(self.field_enums.get(field)?)
    }
}

#[derive(Deserialize)]
struct SchemaFile {
    #[serde(default)]
    classes: Vec<SchemaClass>,
    #[serde(default)]
    enums: Vec<SchemaEnum>,
}

#[derive(Deserialize)]
struct SchemaClass {
    #[serde(default)]
    fields: Vec<SchemaField>,
}

#[derive(Deserialize)]
struct SchemaField {
    name: String,
    #[serde(rename = "type")]
    ty: Option<SchemaType>,
}

#[derive(Deserialize)]
struct SchemaType {
    #[serde(default)]
    category: String,
    #[serde(default)]
    name: String,
    inner: Option<Box<SchemaType>>,
}

#[derive(Deserialize)]
struct SchemaEnum {
    #[serde(default)]
    name: String,
    #[serde(default)]
    members: Vec<SchemaEnumMember>,
}

#[derive(Deserialize)]
struct SchemaEnumMember {
    #[serde(default)]
    name: String,
}

fn resolve_type(ty: &SchemaType) -> Option<Resolved> {
    match ty.category.as_str() {
        "declared_enum" => Some(Resolved::Enum(ty.name.clone())),
        "atomic" => match ty.name.as_str() {
            "Vector" | "QAngle" => Some(Resolved::Widget(WidgetHint::Vec3)),
            "Vector2D" => Some(Resolved::Widget(WidgetHint::Vec2)),
            "Vector4D" | "Quaternion" => Some(Resolved::Widget(WidgetHint::Vec4)),
            "Color" => Some(Resolved::Widget(WidgetHint::Color)),
            "CStrongHandle" | "CStrongHandleCopyable" | "CWeakHandle" => {
                Some(Resolved::Widget(WidgetHint::Resource))
            }
            _ => ty.inner.as_deref().and_then(resolve_type),
        },
        "ptr" | "fixed_array" => ty.inner.as_deref().and_then(resolve_type),
        _ => None,
    }
}

enum Resolved {
    Enum(String),
    Widget(WidgetHint),
}

fn build_db(game: &str, file: SchemaFile) -> SchemaDb {
    let mut db = SchemaDb {
        game: game.to_owned(),
        class_count: file.classes.len(),
        ..Default::default()
    };
    for e in file.enums {
        if e.name.is_empty() {
            continue;
        }
        let members: Vec<String> = e.members.into_iter().map(|m| m.name).collect();
        db.enums.insert(e.name, Arc::new(members));
    }
    for class in file.classes {
        for field in class.fields {
            let Some(ty) = &field.ty else { continue };
            match resolve_type(ty) {
                Some(Resolved::Enum(name)) => {
                    db.field_enums.entry(field.name).or_insert(name);
                }
                Some(Resolved::Widget(hint)) => {
                    db.field_widgets.entry(field.name).or_insert(hint);
                }
                None => {}
            }
        }
    }
    db
}

/// Background schema loader.
pub struct SchemaStore {
    pub db: Option<Arc<SchemaDb>>,
    pub loading: Option<String>,
    pub error: Option<String>,
    rx: Option<Receiver<Result<SchemaDb, String>>>,
}

impl Default for SchemaStore {
    fn default() -> Self {
        SchemaStore {
            db: None,
            loading: None,
            error: None,
            rx: None,
        }
    }
}

pub const GAMES: &[&str] = &["cs2", "dota2", "deadlock"];

/// Locate the `schemas/` directory next to the executable or in the
/// repository when running via `cargo run`.
pub fn schema_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("schemas"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("schemas"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas"));
    candidates.into_iter().find(|p| p.is_dir())
}

impl SchemaStore {
    pub fn request_load(&mut self, game: &str) {
        if self.loading.is_some() {
            return;
        }
        let Some(dir) = schema_dir() else {
            self.error = Some("schemas/ directory not found".to_owned());
            return;
        };
        let path = dir.join(format!("{game}.json"));
        let game = game.to_owned();
        let (tx, rx): (Sender<Result<SchemaDb, String>>, _) = channel();
        self.loading = Some(game.clone());
        self.error = None;
        self.rx = Some(rx);
        std::thread::spawn(move || {
            let result = std::fs::read_to_string(&path)
                .map_err(|e| format!("{}: {e}", path.display()))
                .and_then(|text| {
                    serde_json::from_str::<SchemaFile>(&text)
                        .map_err(|e| format!("{}: {e}", path.display()))
                })
                .map(|file| build_db(&game, file));
            let _ = tx.send(result);
        });
    }

    pub fn unload(&mut self) {
        self.db = None;
        self.error = None;
    }

    /// Poll the loader thread; returns true when a load just finished.
    pub fn poll(&mut self) -> bool {
        let Some(rx) = &self.rx else { return false };
        match rx.try_recv() {
            Ok(Ok(db)) => {
                self.db = Some(Arc::new(db));
                self.loading = None;
                self.rx = None;
                true
            }
            Ok(Err(err)) => {
                self.error = Some(err);
                self.loading = None;
                self.rx = None;
                true
            }
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_cs2_schema_and_resolves_fields() {
        let Some(dir) = schema_dir() else {
            panic!("schemas/ directory should exist in the repository");
        };
        let text = std::fs::read_to_string(dir.join("cs2.json")).unwrap();
        let file: SchemaFile = serde_json::from_str(&text).unwrap();
        let db = build_db("cs2", file);
        assert!(db.class_count > 1000, "expected thousands of classes");
        assert!(db.enums.len() > 100, "expected hundreds of enums");
        assert!(!db.field_enums.is_empty());
        assert!(!db.field_widgets.is_empty());

        // A known enum field from the original schema-db tests.
        let found = db
            .field_enums
            .iter()
            .any(|(field, _)| field.starts_with("m_e"));
        assert!(found, "expected m_e* enum fields");
    }
}
