#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

use vdata_editor::App;

fn load_icon() -> Option<egui::IconData> {
    let bytes = include_bytes!("../../../assets/images/appicon_tools.ico");
    let image = image::load_from_memory(bytes).ok()?.into_rgba8();
    let (width, height) = image.dimensions();
    Some(egui::IconData {
        rgba: image.into_raw(),
        width,
        height,
    })
}

fn main() -> eframe::Result {
    let files: Vec<PathBuf> = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .collect();

    let mut viewport = egui::ViewportBuilder::default()
        .with_inner_size([1440.0, 900.0])
        .with_min_inner_size([640.0, 400.0])
        .with_title("VDataEditor");
    if let Some(icon) = load_icon() {
        viewport = viewport.with_icon(icon);
    }

    eframe::run_native(
        "VDataEditor",
        eframe::NativeOptions {
            viewport,
            persist_window: true,
            ..Default::default()
        },
        Box::new(move |cc| Ok(Box::new(App::new(cc, files)))),
    )
}
