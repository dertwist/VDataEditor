//! Benchmark parse/serialize/reparse over files given on the command line.
//! Used for the JavaScript-vs-Rust comparison; mirrors /tmp/jsbench/bench.js.

use std::time::Instant;

use kv3::Kv3Document;

fn main() {
    for file in std::env::args().skip(1) {
        let text = std::fs::read_to_string(&file).unwrap();
        let mb = text.len() as f64 / 1048576.0;
        let (mut parse, mut serialize, mut reparse) = (f64::MAX, f64::MAX, f64::MAX);
        for _ in 0..3 {
            let t0 = Instant::now();
            let doc = Kv3Document::parse(&text);
            let t1 = Instant::now();
            let out = doc.to_text(&file);
            let t2 = Instant::now();
            let _ = Kv3Document::parse(&out);
            let t3 = Instant::now();
            parse = parse.min((t1 - t0).as_secs_f64() * 1000.0);
            serialize = serialize.min((t2 - t1).as_secs_f64() * 1000.0);
            reparse = reparse.min((t3 - t2).as_secs_f64() * 1000.0);
        }
        let name = file.rsplit('/').next().unwrap_or(&file);
        println!(
            "Rust {name:<24} {mb:>7.2} MB | parse {parse:>8.1} ms ({:>6.1} MB/s) | serialize {serialize:>8.1} ms | reparse {reparse:>8.1} ms",
            mb / (parse / 1000.0),
        );
    }
}
