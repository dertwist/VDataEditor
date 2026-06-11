//! Large-data-asset tests: the real multi-megabyte Valve files shipped in
//! `examples/`, plus a synthetic ~50 MB stress document.
//!
//! Run with `cargo test -p kv3 --release -- --nocapture` to see timings.

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use kv3::{KvValue, Kv3Document, semantic_eq};

fn examples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

fn mb(bytes: usize) -> f64 {
    bytes as f64 / (1024.0 * 1024.0)
}

fn time_round_trip(label: &str, source: &str) -> (Kv3Document, String) {
    let t0 = Instant::now();
    let doc = Kv3Document::parse(source);
    let parse_time = t0.elapsed();

    let nodes = doc.root.node_count();

    let t1 = Instant::now();
    let text = doc.to_text(label);
    let serialize_time = t1.elapsed();

    let t2 = Instant::now();
    let doc2 = Kv3Document::parse(&text);
    let reparse_time = t2.elapsed();

    semantic_eq(&doc.root, &doc2.root)
        .unwrap_or_else(|diff| panic!("{label}: round-trip data loss: {diff}"));
    assert!(doc.issues.is_empty(), "{label}: issues {:?}", doc.issues.first());

    println!(
        "{label}: {:.2} MB, {nodes} nodes | parse {:?} ({:.0} MB/s) | serialize {:?} | reparse {:?}",
        mb(source.len()),
        parse_time,
        mb(source.len()) / parse_time.as_secs_f64(),
        serialize_time,
        reparse_time,
    );
    (doc, text)
}

#[test]
fn abilities_vdata_7mb_round_trips_fast() {
    let source = fs::read_to_string(examples_dir().join("abilities.vdata")).unwrap();
    assert!(source.len() > 7_000_000, "expected the 7.3 MB asset");
    let (doc, _) = time_round_trip("abilities.vdata", &source);
    assert!(doc.root.node_count() > 100_000, "expected a large tree");

    // Generous CI bound — locally this parses in tens of milliseconds.
    let t = Instant::now();
    let _ = Kv3Document::parse(&source);
    assert!(
        t.elapsed().as_secs_f64() < 3.0,
        "parsing 7.3 MB took {:?}",
        t.elapsed()
    );
}

#[test]
fn heroes_vdata_2mb_round_trips() {
    let source = fs::read_to_string(examples_dir().join("heroes.vdata")).unwrap();
    assert!(source.len() > 2_000_000);
    time_round_trip("heroes.vdata", &source);
}

#[test]
fn mixgraph_vmix_round_trips() {
    let source = fs::read_to_string(examples_dir().join("mixgraph.vmix")).unwrap();
    time_round_trip("mixgraph.vmix", &source);
}

/// Build a synthetic document roughly `target_mb` megabytes in size with a
/// realistic mix of node types, nesting, comments and typed strings.
fn synthesize_document(target_mb: usize) -> String {
    let mut out = String::with_capacity(target_mb * 1024 * 1024 + 1024);
    out.push_str(kv3::DEFAULT_KV3_HEADER);
    out.push_str("\n{\n\tgeneric_data_type = \"SyntheticStressData\"\n");
    let mut i = 0usize;
    while out.len() < target_mb * 1024 * 1024 {
        let _ = write!(
            out,
            "\tentry_{i:06} = \n\t{{\n\
             \t\t// generated block {i}\n\
             \t\t_class = \"synthetic_class_{}\"\n\
             \t\tm_strName = \"Entity number {i} with some text payload\"\n\
             \t\tm_flValue = {}.25\n\
             \t\tm_nCount = {}\n\
             \t\tm_bEnabled = {}\n\
             \t\tm_vPosition = [{}.0, {}.5, -{}.125]\n\
             \t\tm_Model = resource_name:\"models/generated/entity_{i}.vmdl\"\n\
             \t\tm_Sound = soundevent:\"Synthetic.Entity.{i}\"\n\
             \t\tm_Modifier = subclass:\n\t\t{{\n\
             \t\t\t_class = \"modifier_synthetic\"\n\
             \t\t\tm_eDisplayLocation = \"MODIFIER_DISPLAY_HEALTHBAR\"\n\
             \t\t\tm_Tags = \n\t\t\t[\n\t\t\t\t\"tag_a\",\n\t\t\t\t\"tag_b\",\n\t\t\t\t// disabled: \"tag_c\",\n\t\t\t]\n\
             \t\t}}\n\
             \t}}\n",
            i % 100,
            i % 977,
            i % 31,
            if i % 2 == 0 { "true" } else { "false" },
            i % 13,
            i % 7,
            i % 5,
        );
        i += 1;
    }
    out.push('}');
    out
}

#[test]
fn synthetic_50mb_stress_round_trips() {
    let t = Instant::now();
    let source = synthesize_document(50);
    println!(
        "synthetic: generated {:.2} MB in {:?}",
        mb(source.len()),
        t.elapsed()
    );
    let (doc, _) = time_round_trip("synthetic-50MB", &source);
    assert!(doc.root.node_count() > 1_000_000, "expected >1M nodes");

    let t = Instant::now();
    let _ = Kv3Document::parse(&source);
    assert!(
        t.elapsed().as_secs_f64() < 20.0,
        "parsing 50 MB took {:?}",
        t.elapsed()
    );
}

/// Every value type survives a pass through the biggest real asset.
#[test]
fn abilities_vdata_content_integrity() {
    let source = fs::read_to_string(examples_dir().join("abilities.vdata")).unwrap();
    let doc = Kv3Document::parse(&source);

    assert_eq!(
        doc.root.get("generic_data_type").and_then(KvValue::as_str),
        Some("CitadelAbilityVData")
    );
    let KvValue::Array(includes) = doc.root.get("_include").unwrap() else {
        panic!("_include should be an array");
    };
    assert!(includes.len() > 30);
    assert!(matches!(
        &includes[0],
        KvValue::Typed { kind, value } if kind == "resource_name" && value.ends_with(".vdata_inc")
    ));

    // Tally the type mix so a parser regression that flattens types fails loudly.
    let mut counts = std::collections::BTreeMap::new();
    fn walk<'v>(v: &'v KvValue, counts: &mut std::collections::BTreeMap<&'v str, usize>) {
        *counts.entry(v.type_name()).or_default() += 1;
        match v {
            KvValue::Array(items) => items.iter().for_each(|i| walk(i, counts)),
            KvValue::Object(entries) => entries.iter().for_each(|(_, v)| walk(v, counts)),
            KvValue::Subclass(inner) => walk(inner, counts),
            _ => {}
        }
    }
    walk(&doc.root, &mut counts);
    println!("abilities.vdata node type mix: {counts:?}");
    for ty in ["object", "array", "string", "int", "double", "bool", "typed", "subclass"] {
        assert!(
            counts.get(ty).copied().unwrap_or(0) > 0,
            "expected at least one {ty} node"
        );
    }
}
