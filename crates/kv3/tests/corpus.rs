//! Round-trip the bundled fixtures and every file in `examples/` —
//! including the multi-megabyte Valve assets that the original JavaScript
//! suite had to skip for speed.

use std::fs;
use std::path::{Path, PathBuf};

use kv3::{KvValue, Kv3Document, parse_keyvalues, semantic_eq, to_keyvalues_text};

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn examples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

fn extension(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// parse → serialize → reparse: the two trees must be semantically equal and
/// the second serialization byte-identical to the first (idempotence).
fn assert_kv3_round_trip(path: &Path, source: &str) {
    let name = path.file_name().unwrap().to_string_lossy();
    let doc = Kv3Document::parse(source);
    assert!(
        doc.issues.is_empty(),
        "{name}: parse issues in pristine file: {:?}",
        &doc.issues[..doc.issues.len().min(3)]
    );

    let text1 = doc.to_text(&name);
    let doc2 = Kv3Document::parse(&text1);
    assert!(
        doc2.issues.is_empty(),
        "{name}: parse issues after serialize: {:?}",
        &doc2.issues[..doc2.issues.len().min(3)]
    );
    if let Err(diff) = semantic_eq(&doc.root, &doc2.root) {
        panic!("{name}: semantic round-trip mismatch: {diff}");
    }

    let text2 = doc2.to_text(&name);
    assert!(text1 == text2, "{name}: serializer not idempotent");
}

fn assert_keyvalues_round_trip(path: &Path, source: &str) {
    let name = path.file_name().unwrap().to_string_lossy();
    let tree = parse_keyvalues(source);
    let text = to_keyvalues_text(&tree);
    let again = parse_keyvalues(&text);
    assert!(tree == again, "{name}: KeyValues round trip changed the tree");
}

#[test]
fn fixtures_round_trip() {
    let mut checked = 0;
    for entry in fs::read_dir(fixture_dir()).unwrap() {
        let path = entry.unwrap().path();
        let source = fs::read_to_string(&path).unwrap();
        assert_kv3_round_trip(&path, &source);
        checked += 1;
    }
    assert!(checked >= 7, "expected the full fixture set, got {checked}");
}

#[test]
fn examples_round_trip() {
    let mut names: Vec<PathBuf> = fs::read_dir(examples_dir())
        .expect("examples/ directory present in repository root")
        .map(|e| e.unwrap().path())
        .filter(|p| p.is_file())
        .collect();
    names.sort();
    assert!(names.len() > 20, "expected the full example corpus");

    for path in names {
        let source = fs::read_to_string(&path).unwrap();
        match extension(&path).as_str() {
            "vmat" | "vmt" => assert_keyvalues_round_trip(&path, &source),
            "json" => {}
            _ => assert_kv3_round_trip(&path, &source),
        }
    }
}

#[test]
fn examples_preserve_headers() {
    for path in fs::read_dir(examples_dir()).unwrap() {
        let path = path.unwrap().path();
        if !matches!(extension(&path).as_str(), "vdata" | "kv3" | "vmdl" | "vpcf") {
            continue;
        }
        let source = fs::read_to_string(&path).unwrap();
        if !source.trim_start().starts_with("<!--") {
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let doc = Kv3Document::parse(&source);
        assert!(!doc.header.is_empty(), "{name}: header not detected");
        let out = doc.to_text(&name);
        let first_line = out.lines().next().unwrap_or_default();
        assert_eq!(first_line, doc.header, "{name}: header not preserved");
    }
}

/// Spot-check real content survives, not just structure.
#[test]
fn example_content_spot_checks() {
    let source = fs::read_to_string(examples_dir().join("comments.kv3")).unwrap();
    let doc = Kv3Document::parse(&source);
    assert_eq!(
        doc.root.get("generic_data_type").and_then(KvValue::as_str),
        Some("CitadelAbilityVData")
    );
    let stomp = doc.root.get("citadel_ability_tier2boss_stomp").unwrap();
    let props = stomp.get("m_mapAbilityProperties").unwrap();
    let cooldown = props.get("AbilityCooldown").unwrap();
    assert_eq!(cooldown.get("m_strValue").and_then(KvValue::as_str), Some("5.1"));
    let KvValue::Subclass(scale) = cooldown.get("m_subclassScaleFunction").unwrap() else {
        panic!("expected subclass scale function");
    };
    assert_eq!(
        scale.get("_class").and_then(KvValue::as_str),
        Some("scale_function_single_stat")
    );

    // Comment slots survive the round trip in file order.
    let KvValue::Object(entries) = &doc.root else {
        panic!()
    };
    let comments: Vec<_> = entries
        .iter()
        .filter(|(_, v)| matches!(v, KvValue::Comment(_)))
        .collect();
    assert!(!comments.is_empty(), "expected preserved comments");

    let vmat = fs::read_to_string(examples_dir().join("glove.vmat")).unwrap();
    let tree = parse_keyvalues(&vmat);
    let layer0 = tree.get("Layer0").expect("vmat Layer0 block");
    assert!(layer0.get("shader").is_some());
}
