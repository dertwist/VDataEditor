//! Port of the original `tests/keyvalue.test.js` suite.

use kv3::{KvValue, parse_keyvalues, to_keyvalues_text};

const SAMPLE: &str = r#"// THIS FILE IS AUTO-GENERATED

Layer0
{
	shader "generic.vfx"
	F_TRANSLUCENT 1
	g_vColorTint "[1.000000 1.000000 1.000000 0.000000]"
	TextureColor "materials/radgen/radgen_tint.tga"
	Attributes
	{
		tools.toolsmaterial "1"
		mapbuilder.nodraw "1"
	}
	UnusedVariables
	{
		"g_flAlphaTestReference" "0.5"
		Texture2Color ""
	}
}
"#;

#[test]
fn parses_nested_blocks_comments_and_quoted_keys() {
    let o = parse_keyvalues(SAMPLE);
    let layer0 = o.get("Layer0").expect("Layer0");
    assert_eq!(layer0.get("shader").and_then(KvValue::as_str), Some("generic.vfx"));
    assert_eq!(layer0.get("F_TRANSLUCENT"), Some(&KvValue::Int(1)));
    assert_eq!(
        layer0.get("TextureColor").and_then(KvValue::as_str),
        Some("materials/radgen/radgen_tint.tga")
    );
    let attrs = layer0.get("Attributes").unwrap();
    assert_eq!(attrs.get("tools.toolsmaterial"), Some(&KvValue::Int(1)));
    let unused = layer0.get("UnusedVariables").unwrap();
    assert_eq!(
        unused.get("g_flAlphaTestReference"),
        Some(&KvValue::Double(0.5))
    );
    assert_eq!(
        unused.get("Texture2Color"),
        Some(&KvValue::String(String::new()))
    );
}

#[test]
fn round_trips_structure_and_scalar_coercion() {
    let o = parse_keyvalues(SAMPLE);
    let text = to_keyvalues_text(&o);
    let again = parse_keyvalues(&text);
    assert_eq!(o, again);
}
