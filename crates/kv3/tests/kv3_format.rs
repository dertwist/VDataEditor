//! Port of the original `tests/kv3.test.js` suite.

use kv3::{
    DEFAULT_KV3_HEADER, KvValue, Kv3Document, MODELDOC41_KV3_HEADER, parse_value_text,
    to_kv3_text_with_options,
};

fn obj(entries: Vec<(&str, KvValue)>) -> KvValue {
    KvValue::Object(entries.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
}

fn s(v: &str) -> KvValue {
    KvValue::String(v.to_owned())
}

fn typed(kind: &str, value: &str) -> KvValue {
    KvValue::Typed {
        kind: kind.to_owned(),
        value: value.to_owned(),
    }
}

#[test]
fn uses_the_default_generic_kv3_header() {
    let input = obj(vec![
        ("generic_data_type", s("CSmartPropRoot")),
        ("m_Children", KvValue::Array(vec![])),
        ("m_Variables", KvValue::Array(vec![])),
    ]);
    let text = to_kv3_text_with_options(&input, None, None);
    assert!(text.starts_with(&format!("{DEFAULT_KV3_HEADER}\n")));
}

#[test]
fn uses_modeldoc41_header_for_vmdl_output() {
    let input = obj(vec![("rootNode", obj(vec![("_class", s("RootNode"))]))]);
    let text = to_kv3_text_with_options(&input, None, Some("test.vmdl"));
    assert!(text.starts_with(&format!("{MODELDOC41_KV3_HEADER}\n")));
}

#[test]
fn round_trips_a_simple_object() {
    let input = obj(vec![
        ("generic_data_type", s("CSmartPropRoot")),
        ("m_Children", KvValue::Array(vec![])),
        ("m_Variables", KvValue::Array(vec![])),
    ]);
    let text = to_kv3_text_with_options(&input, None, None);
    let parsed = Kv3Document::parse(&text);
    assert_eq!(parsed.root.get("generic_data_type"), Some(&s("CSmartPropRoot")));
    assert_eq!(parsed.root.get("m_Children"), Some(&KvValue::Array(vec![])));
    assert_eq!(parsed.root.get("m_Variables"), Some(&KvValue::Array(vec![])));
}

#[test]
fn treats_header_as_optional() {
    let body = "{ generic_data_type = \"CSmartPropRoot\" }";
    let with_header = format!(
        "<!-- kv3 encoding:text:version{{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d}} -->\n{body}"
    );
    for text in [with_header.as_str(), body] {
        let doc = Kv3Document::parse(text);
        assert_eq!(doc.root.get("generic_data_type"), Some(&s("CSmartPropRoot")));
        assert!(doc.issues.is_empty(), "issues: {:?}", doc.issues);
    }
}

#[test]
fn serializes_heuristic_resource_paths_as_typed_resource_name() {
    let input = obj(vec![
        ("model", s("models/props/test.vmdl")),
        ("plain", s("hello")),
    ]);
    let text = to_kv3_text_with_options(&input, None, None);
    assert!(text.contains("model = resource_name:\"models/props/test.vmdl\""));
    assert!(text.contains("plain = \"hello\""));

    let parsed = Kv3Document::parse(&text).root;
    assert_eq!(
        parsed.get("model"),
        Some(&typed("resource_name", "models/props/test.vmdl"))
    );
    assert_eq!(parsed.get("plain"), Some(&s("hello")));
}

#[test]
fn round_trips_explicit_resource_name_and_soundevent() {
    let input = obj(vec![
        ("model", typed("resource_name", "weapons/foo.vmdl")),
        ("fire", typed("soundevent", "c4.plant")),
    ]);
    let text = to_kv3_text_with_options(&input, None, None);
    assert!(text.contains("model = resource_name:\"weapons/foo.vmdl\""));
    assert!(text.contains("fire = soundevent:\"c4.plant\""));
    assert_eq!(Kv3Document::parse(&text).root, input);
}

#[test]
fn parses_panorama_paths_with_tokens() {
    let text =
        r#"{ m_strAbilityImage = panorama:"file://{images}/hud/abilities/weapon_damage.psd" }"#;
    let parsed = parse_value_text(text);
    assert_eq!(
        parsed.get("m_strAbilityImage"),
        Some(&typed("panorama", "file://{images}/hud/abilities/weapon_damage.psd"))
    );
}

#[test]
fn round_trips_panorama_typed_values() {
    let input = obj(vec![(
        "m_strAbilityImage",
        typed("panorama", "file://{images}/hud/abilities/weapon_damage.psd"),
    )]);
    let text = to_kv3_text_with_options(&input, None, None);
    assert!(text.contains(
        "m_strAbilityImage = panorama:\"file://{images}/hud/abilities/weapon_damage.psd\""
    ));
    assert_eq!(Kv3Document::parse(&text).root, input);
}

#[test]
fn round_trips_subclass_typed_objects() {
    let text = r#"<!-- kv3 encoding:text -->
{
  m_BuffModifier = subclass:
  {
    _class = "modifier_unicorn_luminousstrike_buff"
    m_BuffParticle = resource_name:"particles/abilities/unicorn/unicorn_flux_buff.vpcf"
    m_strBuffReceivedSound = soundevent:"Unicorn.Luminous.Flux.Buff"
    m_eHudDisplayLocation = "DISPLAY_HUD_NONE"
  }
}"#;
    let parsed = Kv3Document::parse(text).root;
    let KvValue::Subclass(inner) = parsed.get("m_BuffModifier").unwrap() else {
        panic!("expected subclass, got {:?}", parsed.get("m_BuffModifier"));
    };
    assert_eq!(
        inner.get("_class"),
        Some(&s("modifier_unicorn_luminousstrike_buff"))
    );
    assert_eq!(
        inner.get("m_BuffParticle"),
        Some(&typed(
            "resource_name",
            "particles/abilities/unicorn/unicorn_flux_buff.vpcf"
        ))
    );
    assert_eq!(
        inner.get("m_strBuffReceivedSound"),
        Some(&typed("soundevent", "Unicorn.Luminous.Flux.Buff"))
    );
    assert_eq!(inner.get("m_eHudDisplayLocation"), Some(&s("DISPLAY_HUD_NONE")));

    let out = to_kv3_text_with_options(&parsed, None, None);
    assert!(out.contains("m_BuffModifier = subclass:"));
    assert!(out.contains(
        "m_BuffParticle = resource_name:\"particles/abilities/unicorn/unicorn_flux_buff.vpcf\""
    ));
    assert_eq!(Kv3Document::parse(&out).root, parsed);
}

#[test]
fn serializes_numeric_arrays_inline() {
    let input = obj(vec![(
        "position",
        KvValue::Array(vec![KvValue::Int(1), KvValue::Int(2), KvValue::Int(3)]),
    )]);
    let text = to_kv3_text_with_options(&input, None, None);
    assert!(text.contains("position = [1, 2, 3]"));
    assert_eq!(Kv3Document::parse(&text).root, input);
}

#[test]
fn quotes_non_identifier_object_keys() {
    let input = obj(vec![
        ("plain_key", KvValue::Int(1)),
        ("Dark (Thumbnail)", s("thumb")),
        ("Dark + Headlight", KvValue::Bool(true)),
    ]);
    let text = to_kv3_text_with_options(&input, None, None);
    assert!(text.contains("plain_key = 1"));
    assert!(text.contains("\"Dark (Thumbnail)\" = \"thumb\""));
    assert!(text.contains("\"Dark + Headlight\" = true"));
    assert_eq!(Kv3Document::parse(&text).root, input);
}

#[test]
fn handles_comments_and_whitespace() {
    let text = "\n<!-- kv3 encoding:text -->\n{\n  // single line comment\n  enabled = true\n  count = 42 // trailing comment\n}\n";
    let parsed = Kv3Document::parse(text).root;
    assert_eq!(parsed.get("enabled"), Some(&KvValue::Bool(true)));
    assert_eq!(parsed.get("count"), Some(&KvValue::Int(42)));
}

#[test]
fn preserves_detected_header() {
    let text = format!("{MODELDOC41_KV3_HEADER}\n{{ rootNode = {{ _class = \"RootNode\" }} }}");
    let doc = Kv3Document::parse(&text);
    assert!(doc.header.contains("format:modeldoc41"));
    assert_eq!(
        doc.root,
        obj(vec![("rootNode", obj(vec![("_class", s("RootNode"))]))])
    );
}

#[test]
fn serializes_modeldoc41_with_valve_spacing_and_commas() {
    let input = obj(vec![(
        "rootNode",
        obj(vec![
            ("_class", s("RootNode")),
            (
                "children",
                KvValue::Array(vec![obj(vec![
                    ("_class", s("RenderMeshFile")),
                    ("import_scale", KvValue::Int(1)),
                    (
                        "import_filter",
                        obj(vec![
                            ("exclude_by_default", KvValue::Bool(false)),
                            ("exception_list", KvValue::Array(vec![])),
                        ]),
                    ),
                ])]),
            ),
        ]),
    )]);
    let text = to_kv3_text_with_options(&input, None, Some("x.vmdl"));
    assert!(text.contains("\n\trootNode = \n\t{"), "got:\n{text}");
    assert!(text.contains("children = \n\t\t["), "got:\n{text}");
    assert!(text.contains("import_scale = 1.0"));
    assert!(text.contains("exception_list = [  ]"));
    assert!(text.contains("\n\t\t\t},\n"));
}

#[test]
fn parses_and_preserves_line_comments_inside_arrays() {
    let text = "{\n  list = [\n    // enabled\n    \"a\",\n    //\"b\",\n  ]\n}";
    let parsed = parse_value_text(text);
    let KvValue::Array(items) = parsed.get("list").unwrap() else {
        panic!("expected array");
    };
    assert_eq!(items.len(), 3);
    assert_eq!(items[0], KvValue::Comment(" enabled".to_owned()));
    assert_eq!(items[1], s("a"));
    assert_eq!(items[2], KvValue::Comment("\"b\",".to_owned()));

    let out = to_kv3_text_with_options(&parsed, None, None);
    assert!(out.contains("// enabled"));
    assert!(out.contains("//\"b\","));
}

#[test]
fn preserves_object_level_comments_between_keys() {
    let text = "{\n  // head\n  a = 1\n  // middle\n  b = 2\n}";
    let parsed = parse_value_text(text);
    let KvValue::Object(entries) = &parsed else {
        panic!("expected object");
    };
    assert_eq!(entries.len(), 4);
    assert_eq!(entries[0].1, KvValue::Comment(" head".to_owned()));
    assert_eq!(entries[2].1, KvValue::Comment(" middle".to_owned()));
    assert_eq!(parsed.get("a"), Some(&KvValue::Int(1)));
    assert_eq!(parsed.get("b"), Some(&KvValue::Int(2)));

    let out = to_kv3_text_with_options(&parsed, None, None);
    assert!(out.contains("// head"));
    assert!(out.contains("// middle"));
}

#[test]
fn skips_block_comments_with_commas_and_colons() {
    let text = "<!-- kv3 encoding:text -->\n{\n  a = 1\n  /*\n   foo , bar\n   x: y, z\n  */\n  b = 2\n}";
    let parsed = Kv3Document::parse(text).root;
    assert_eq!(parsed.get("a"), Some(&KvValue::Int(1)));
    assert_eq!(parsed.get("b"), Some(&KvValue::Int(2)));
}

#[test]
fn skips_block_comments_inside_nested_objects() {
    let text = r#"<!-- kv3 encoding:text -->
{
  outer = {
    _class = "modifier_base"
    /*
      prose, with commas: and colons
      TestValue2
    */
    m_strParticleEffect = resource_name:"particles/test.vpcf"
    m_strConfig = "normal"
  }
}"#;
    let parsed = Kv3Document::parse(text).root;
    let outer = parsed.get("outer").unwrap();
    assert_eq!(outer.get("_class"), Some(&s("modifier_base")));
    assert_eq!(
        outer.get("m_strParticleEffect"),
        Some(&typed("resource_name", "particles/test.vpcf"))
    );
    assert_eq!(outer.get("m_strConfig"), Some(&s("normal")));
}

#[test]
fn skips_block_comments_between_array_elements() {
    let text = "{\n  list = [\n    \"a\"\n    /* , junk */\n    \"b\"\n  ]\n}";
    let parsed = parse_value_text(text);
    assert_eq!(
        parsed.get("list"),
        Some(&KvValue::Array(vec![s("a"), s("b")]))
    );
}

// ---- Behaviors beyond the original test suite ----

#[test]
fn distinguishes_int_and_double_on_round_trip() {
    let text = "{ a = 1\n b = 1.0\n c = -0.25\n d = 1e-5 }";
    let parsed = parse_value_text(text);
    assert_eq!(parsed.get("a"), Some(&KvValue::Int(1)));
    assert_eq!(parsed.get("b"), Some(&KvValue::Double(1.0)));
    assert_eq!(parsed.get("c"), Some(&KvValue::Double(-0.25)));
    assert_eq!(parsed.get("d"), Some(&KvValue::Double(1e-5)));

    let out = to_kv3_text_with_options(&parsed, None, None);
    assert!(out.contains("a = 1\n"));
    assert!(out.contains("b = 1.0\n"), "got:\n{out}");
    assert!(out.contains("c = -0.25\n"));
}

#[test]
fn parses_hex_integers() {
    let parsed = parse_value_text("{ flags = 0x1F }");
    assert_eq!(parsed.get("flags"), Some(&KvValue::Int(31)));
}

#[test]
fn round_trips_multiline_strings() {
    let text = "{\n\tdescription = \"\"\"line one\nline two\"\"\"\n}";
    let parsed = parse_value_text(text);
    assert_eq!(parsed.get("description"), Some(&s("line one\nline two")));
    let out = to_kv3_text_with_options(&parsed, None, None);
    assert!(out.contains("\"\"\"line one\nline two\"\"\""), "got:\n{out}");
    assert_eq!(Kv3Document::parse(&out).root, parsed);
}

#[test]
fn preserves_unknown_typed_flags() {
    let text = "{ tex = resource:\"materials/foo.vtex\" }";
    let parsed = parse_value_text(text);
    assert_eq!(parsed.get("tex"), Some(&typed("resource", "materials/foo.vtex")));
    let out = to_kv3_text_with_options(&parsed, None, None);
    assert!(out.contains("tex = resource:\"materials/foo.vtex\""));
}

#[test]
fn detects_valve_split_assignment_style() {
    let text = "<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->\n{\n\tlist = \n\t[\n\t\t\"a\",\n\t]\n}";
    let doc = Kv3Document::parse(text);
    assert!(doc.style.split_container_assignment);
    assert!(doc.style.trailing_array_commas);
    let out = doc.to_text("file.vdata");
    assert_eq!(out, text, "style-preserving round trip should be byte-identical");
}

#[test]
fn reports_issues_for_malformed_input_without_panicking() {
    for bad in [
        "{ a = \"unterminated",
        "{ a = 1",
        "[1, 2",
        "{ a 1 }",
        "/* never closed",
        "{ a = 1 } trailing garbage",
    ] {
        let doc = Kv3Document::parse(bad);
        assert!(
            !doc.issues.is_empty(),
            "expected issues for {bad:?}, got tree {:?}",
            doc.root
        );
    }
}

#[test]
fn empty_and_whitespace_documents_parse() {
    for text in ["", "   \n\t  ", "<!-- kv3 encoding:text -->"] {
        let _ = Kv3Document::parse(text);
    }
}
