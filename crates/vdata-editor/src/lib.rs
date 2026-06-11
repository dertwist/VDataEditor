//! VDataEditor — desktop editor for Source 2 KV3 files, built with
//! [`egui`] and [`egui_tiles`].
//!
//! The crate is a library + thin binary so integration tests (including the
//! large-asset UI benchmarks under `tests/`) can drive the full application
//! headlessly via [`app::App::ui`].

pub mod app;
pub mod doc;
pub mod history;
pub mod json_bridge;
pub mod model;
pub mod schema;
pub mod ui;

pub use app::App;
