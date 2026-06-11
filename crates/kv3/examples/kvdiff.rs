//! Debug helper: show the first difference in a KeyValues round trip.

use kv3::{KvValue, parse_keyvalues, to_keyvalues_text};

fn diff(a: &KvValue, b: &KvValue, path: &str) {
    match (a, b) {
        (KvValue::Object(xs), KvValue::Object(ys)) => {
            if xs.len() != ys.len() {
                println!("{path}: entry count {} vs {}", xs.len(), ys.len());
                let ka: Vec<_> = xs.iter().map(|(k, _)| k.as_str()).collect();
                let kb: Vec<_> = ys.iter().map(|(k, _)| k.as_str()).collect();
                println!("  a keys: {ka:?}\n  b keys: {kb:?}");
                return;
            }
            for ((ka, va), (kb, vb)) in xs.iter().zip(ys) {
                if ka != kb {
                    println!("{path}: key {ka:?} vs {kb:?}");
                    return;
                }
                diff(va, vb, &format!("{path}.{ka}"));
            }
        }
        _ if a != b => println!("{path}: {a:?} vs {b:?}"),
        _ => {}
    }
}

fn main() {
    let path = std::env::args().nth(1).unwrap();
    let source = std::fs::read_to_string(&path).unwrap();
    let tree = parse_keyvalues(&source);
    let text = to_keyvalues_text(&tree);
    let again = parse_keyvalues(&text);
    diff(&tree, &again, "$");
}
