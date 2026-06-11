//! Generate the synthetic stress document used by tests and benchmarks.
//! Usage: gen_synthetic <output-path> [size-mb]

use std::fmt::Write as _;

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("output path");
    let target_mb: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(50);

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
    std::fs::write(&path, out).unwrap();
    eprintln!("wrote {path} ({target_mb} MB)");
}
