//! Renders real application screenshots headlessly via wgpu (software
//! rasterizer friendly). Ignored by default: run explicitly with
//! `cargo test -p vdata-editor --release --test screenshots -- --ignored`.
//!
//! Images are written to `target/ui-screenshots/`.

use std::path::{Path, PathBuf};

use egui_kittest::Harness;
use vdata_editor::App;

fn examples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

fn output_dir() -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/ui-screenshots");
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn shoot(name: &str, files: &[&str], prepare: impl FnOnce(&mut App)) {
    let mut app = App::new_for_test();
    for file in files {
        app.open_path(&examples_dir().join(file));
    }
    prepare(&mut app);
    let mut harness = Harness::builder()
        .with_size(egui::Vec2::new(1560.0, 980.0))
        .wgpu()
        .build_ui_state(|ui, app: &mut App| app.run_frame(ui), app);
    // Let text panes sync and layout settle.
    for _ in 0..8 {
        harness.step();
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    let image = harness.render().expect("wgpu render");
    let path = output_dir().join(format!("{name}.png"));
    image.save(&path).expect("save screenshot");
    println!("wrote {}", path.display());
}

#[test]
#[ignore = "requires a (software) GPU; run with --ignored to produce report screenshots"]
fn screenshot_abilities_overview() {
    shoot("01-abilities-overview", &["abilities.vdata"], |app| {
        let doc = &mut app.docs[0];
        // Expand a few levels so the tree shows structure.
        let root = doc.model.root();
        let children: Vec<_> = doc.model.children(root).to_vec();
        for child in children.into_iter().take(40) {
            doc.model.set_expanded(child, true);
        }
    });
}

#[test]
#[ignore = "requires a (software) GPU; run with --ignored to produce report screenshots"]
fn screenshot_search_filter() {
    shoot("02-search-filter", &["abilities.vdata"], |app| {
        app.docs[0].tree_view.search = "citadel_ability_chrono".to_owned();
    });
}

#[test]
#[ignore = "requires a (software) GPU; run with --ignored to produce report screenshots"]
fn screenshot_multiple_tabs_widgets() {
    shoot(
        "03-tabs-and-widgets",
        &["fit_on_line_example.vsmart", "heroes.vdata", "glove.vmat"],
        |app| {
            let doc = &mut app.docs[0];
            doc.model.expand_all(true);
        },
    );
}
