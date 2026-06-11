//! The original editor's Valve Source 2-style PNG icons, embedded from
//! `assets/images/` (same files `icons.js` used).

use egui::ImageSource;

macro_rules! icon {
    ($name:ident, $path:literal) => {
        pub const $name: ImageSource<'static> =
            egui::include_image!(concat!("../../../../assets/images/", $path));
    };
}

// Tree arrows (valve_style/, with hover variants like the CSS used).
icon!(ARROW_CLOSED, "valve_style/arrow_closed.png");
icon!(ARROW_CLOSED_HOVER, "valve_style/arrow_closed_hover.png");
icon!(ARROW_OPEN, "valve_style/arrow_open.png");
icon!(ARROW_OPEN_HOVER, "valve_style/arrow_open_hover.png");
icon!(ARROW_UP, "valve_style/arrow_up.png");
icon!(ARROW_DOWN, "valve_style/arrow_down.png");

// Toolbar / context menu (common/).
icon!(ADD, "common/add.png");
icon!(CANCEL, "common/cancel_sm.png");
icon!(COLLAPSE_ALL, "common/collapse_all.png");
icon!(COPY, "common/copy.png");
icon!(DELETE, "common/delete.png");
icon!(DUPLICATE, "common/duplicate.png");
icon!(EDIT_PENCIL, "common/edit_pencil.png");
icon!(EXPAND_ALL, "common/expand_all.png");
icon!(FILTER, "common/generic_filter_and.png");
icon!(IMPORT, "common/import.png");
icon!(NEW, "common/new.png");
icon!(REDO, "common/redo.png");
icon!(REFRESH, "common/refresh.png");
icon!(SAVE, "common/save.png");
icon!(SAVE_ALL, "common/save_all.png");
icon!(UNDO, "common/undo.png");

/// Standard small icon size used across menus and toolbars (matches the
/// 14-15 px icons of the original UI).
pub const SIZE: f32 = 14.0;

/// An icon `Image` pre-sized for menu/toolbar use.
pub fn img(source: ImageSource<'static>) -> egui::Image<'static> {
    egui::Image::new(source).fit_to_exact_size(egui::Vec2::splat(SIZE))
}
