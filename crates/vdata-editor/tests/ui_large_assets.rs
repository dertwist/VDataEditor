//! Headless UI tests driving the complete application (menu bar, tiling
//! dock, property tree, text pane) against the large real-world assets in
//! `examples/`.
//!
//! Run with `cargo test -p vdata-editor --release -- --nocapture` to see
//! frame timings.

use std::path::{Path, PathBuf};
use std::time::Instant;

use egui_kittest::Harness;
use vdata_editor::App;
use vdata_editor::ui::tree::{TreeAction, apply_action};

fn examples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

fn harness_with_files(files: &[&str]) -> Harness<'static, App> {
    let mut app = App::new_for_test();
    for file in files {
        app.open_path(&examples_dir().join(file));
    }
    assert_eq!(app.docs.len(), files.len(), "all files should open");
    assert!(app.last_error.is_none(), "open error: {:?}", app.last_error);
    Harness::builder()
        .with_size(egui::Vec2::new(1560.0, 980.0))
        .build_ui_state(|ui, app: &mut App| app.run_frame(ui), app)
}

/// Average frame time over `frames` steps.
fn measure_frames(harness: &mut Harness<'_, App>, frames: usize) -> f64 {
    let start = Instant::now();
    for _ in 0..frames {
        harness.step();
    }
    start.elapsed().as_secs_f64() / frames as f64
}

#[test]
fn opens_abilities_vdata_and_stays_interactive() {
    let mut harness = harness_with_files(&["abilities.vdata"]);

    let first_frame = Instant::now();
    harness.step();
    let first = first_frame.elapsed();

    let avg = measure_frames(&mut harness, 20);
    println!(
        "abilities.vdata (7.3 MB): first frame {first:?}, avg frame {:.2} ms",
        avg * 1000.0
    );

    // Generous CI bounds; locally this is single-digit milliseconds.
    assert!(first.as_secs_f64() < 5.0, "first frame took {first:?}");
    assert!(avg < 0.25, "average frame took {:.1} ms", avg * 1000.0);

    let doc = &harness.state().docs[0];
    assert!(doc.model.len() > 150_000, "expected a large arena");
    assert!(
        doc.text_pane.is_virtualized(),
        "7 MB text must use the virtualized view"
    );
    assert!(
        doc.text_pane.line_ranges.len() > 100_000,
        "expected the full text to be indexed"
    );
}

#[test]
fn expand_all_on_200k_nodes_stays_interactive() {
    let mut harness = harness_with_files(&["abilities.vdata"]);
    harness.step();

    let t = Instant::now();
    harness.state_mut().docs[0].model.expand_all(true);
    harness.step();
    let expand_frame = t.elapsed();

    let rows = harness.state().docs[0].tree_view.flat.len();
    let avg = measure_frames(&mut harness, 20);
    println!(
        "expand-all: {rows} visible rows, expand+reflatten frame {expand_frame:?}, avg frame {:.2} ms",
        avg * 1000.0
    );
    assert!(rows > 150_000, "expand all should expose the whole tree");
    assert!(expand_frame.as_secs_f64() < 3.0);
    assert!(avg < 0.25, "average frame took {:.1} ms", avg * 1000.0);
}

#[test]
fn search_filters_the_big_tree() {
    let mut harness = harness_with_files(&["abilities.vdata"]);
    harness.step();

    let t = Instant::now();
    harness.state_mut().docs[0].tree_view.search = "citadel_ability_chrono".to_owned();
    harness.step();
    let search_frame = t.elapsed();

    let rows = harness.state().docs[0].tree_view.flat.len();
    println!("search over 7.3 MB: first filtered frame {search_frame:?}, {rows} matching rows");
    assert!(rows > 0, "search should find chrono abilities");
    assert!(
        rows < 10_000,
        "search should narrow the tree (got {rows} rows)"
    );
    assert!(search_frame.as_secs_f64() < 3.0);

    // Clearing restores the unfiltered view.
    harness.state_mut().docs[0].tree_view.search.clear();
    harness.step();
}

#[test]
fn edits_undo_and_text_sync_on_large_doc() {
    let mut harness = harness_with_files(&["heroes.vdata"]);
    harness.step();

    // Force the text pane to sync, then edit a node and check dirty state.
    let app = harness.state_mut();
    let doc = &mut app.docs[0];
    let before_rev = doc.model.rev;
    assert!(!doc.dirty());

    // Find some scalar to edit.
    let root = doc.model.root();
    let target = doc
        .model
        .children(root)
        .iter()
        .copied()
        .find(|&id| {
            matches!(
                doc.model.node(id).payload,
                vdata_editor::model::Payload::Scalar(_)
            )
        })
        .or_else(|| doc.model.children(root).first().copied())
        .unwrap();
    apply_action(
        doc,
        TreeAction::SetScalar {
            id: target,
            new: vdata_editor::model::Scalar::Str("EDITED_BY_TEST".into()),
            label: "test edit",
        },
    );
    assert!(doc.dirty());
    assert!(doc.model.rev > before_rev);

    // Step past the sync debounce: the text pane must pick up the edit.
    let t = Instant::now();
    while harness.state().docs[0].text_pane.synced_rev != Some(harness.state().docs[0].model.rev)
    {
        assert!(t.elapsed().as_secs_f64() < 10.0, "text pane never synced");
        std::thread::sleep(std::time::Duration::from_millis(60));
        harness.step();
    }
    assert!(
        harness.state().docs[0]
            .text_pane
            .text
            .contains("EDITED_BY_TEST")
    );

    // Undo through the same path the menu uses.
    let doc = &mut harness.state_mut().docs[0];
    doc.history.undo(&mut doc.model);
    let serialized = doc.serialize();
    assert!(!serialized.contains("EDITED_BY_TEST"));
}

#[test]
fn multiple_documents_open_as_tabs() {
    let mut harness = harness_with_files(&[
        "abilities.vdata",
        "heroes.vdata",
        "fit_on_line_example.vsmart",
        "glove.vmat",
    ]);
    harness.step();
    let avg = measure_frames(&mut harness, 10);
    println!(
        "4 documents (incl. 7.3 MB + 2.3 MB): avg frame {:.2} ms",
        avg * 1000.0
    );

    let app = harness.state();
    assert_eq!(app.docs.len(), 4);
    // Root must be a tabs container with one tab per document.
    let root = app.tiles.root().expect("tile tree has a root");
    match app.tiles.tiles.get(root) {
        Some(egui_tiles::Tile::Container(egui_tiles::Container::Tabs(tabs))) => {
            assert_eq!(tabs.children.len(), 4);
        }
        other => panic!("expected root tabs container, got {other:?}"),
    }
    assert!(avg < 0.25, "average frame took {:.1} ms", avg * 1000.0);
}

#[test]
fn save_round_trip_preserves_large_asset() {
    let dir = std::env::temp_dir().join("vdata-editor-test-save");
    std::fs::create_dir_all(&dir).unwrap();
    let out_path = dir.join("abilities-roundtrip.vdata");

    let mut harness = harness_with_files(&["abilities.vdata"]);
    harness.step();

    let doc = &mut harness.state_mut().docs[0];
    doc.save_to(&out_path).unwrap();
    assert!(!doc.dirty());

    let original = std::fs::read_to_string(examples_dir().join("abilities.vdata")).unwrap();
    let saved = std::fs::read_to_string(&out_path).unwrap();
    let a = kv3::Kv3Document::parse(&original);
    let b = kv3::Kv3Document::parse(&saved);
    kv3::semantic_eq(&a.root, &b.root).expect("saved file must be semantically identical");
    assert_eq!(a.header, b.header, "header preserved through UI save");
    std::fs::remove_file(&out_path).ok();
}
