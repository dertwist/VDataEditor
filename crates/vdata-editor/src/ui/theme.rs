//! Catppuccin-flavoured dark/light themes, matching the palette the
//! original editor used.

use egui::{Color32, CornerRadius, Visuals};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Theme {
    Dark,
    Light,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::Dark
    }
}

/// Colors used by widgets and the syntax highlighter.
pub struct Palette {
    pub key: Color32,
    pub string: Color32,
    pub number: Color32,
    pub keyword: Color32,
    pub comment: Color32,
    pub typed: Color32,
    pub punct: Color32,
    pub badge_object: Color32,
    pub badge_array: Color32,
    pub badge_string: Color32,
    pub badge_number: Color32,
    pub badge_bool: Color32,
    pub badge_typed: Color32,
    pub badge_comment: Color32,
    pub badge_null: Color32,
    pub subclass: Color32,
    pub dim: Color32,
}

// Catppuccin Mocha
pub const DARK_PALETTE: Palette = Palette {
    key: Color32::from_rgb(0x89, 0xb4, 0xfa),     // blue
    string: Color32::from_rgb(0xa6, 0xe3, 0xa1),  // green
    number: Color32::from_rgb(0xfa, 0xb3, 0x87),  // peach
    keyword: Color32::from_rgb(0xcb, 0xa6, 0xf7), // mauve
    comment: Color32::from_rgb(0x6c, 0x70, 0x86), // overlay0
    typed: Color32::from_rgb(0xf9, 0xe2, 0xaf),   // yellow
    punct: Color32::from_rgb(0x93, 0x99, 0xb2), // overlay2
    badge_object: Color32::from_rgb(0xcb, 0xa6, 0xf7),
    badge_array: Color32::from_rgb(0x89, 0xb4, 0xfa),
    badge_string: Color32::from_rgb(0xa6, 0xe3, 0xa1),
    badge_number: Color32::from_rgb(0xfa, 0xb3, 0x87),
    badge_bool: Color32::from_rgb(0xf3, 0x8b, 0xa8),
    badge_typed: Color32::from_rgb(0xf9, 0xe2, 0xaf),
    badge_comment: Color32::from_rgb(0x6c, 0x70, 0x86),
    badge_null: Color32::from_rgb(0x93, 0x9a, 0xb7),
    subclass: Color32::from_rgb(0x94, 0xe2, 0xd5), // teal
    dim: Color32::from_rgb(0x7f, 0x84, 0x9c),
};

// Catppuccin Latte
pub const LIGHT_PALETTE: Palette = Palette {
    key: Color32::from_rgb(0x1e, 0x66, 0xf5),
    string: Color32::from_rgb(0x40, 0xa0, 0x2b),
    number: Color32::from_rgb(0xfe, 0x64, 0x0b),
    keyword: Color32::from_rgb(0x88, 0x39, 0xef),
    comment: Color32::from_rgb(0x8c, 0x8f, 0xa1),
    typed: Color32::from_rgb(0xdf, 0x8e, 0x1d),
    punct: Color32::from_rgb(0x5c, 0x5f, 0x77),
    badge_object: Color32::from_rgb(0x88, 0x39, 0xef),
    badge_array: Color32::from_rgb(0x1e, 0x66, 0xf5),
    badge_string: Color32::from_rgb(0x40, 0xa0, 0x2b),
    badge_number: Color32::from_rgb(0xfe, 0x64, 0x0b),
    badge_bool: Color32::from_rgb(0xd2, 0x0f, 0x39),
    badge_typed: Color32::from_rgb(0xdf, 0x8e, 0x1d),
    badge_comment: Color32::from_rgb(0x8c, 0x8f, 0xa1),
    badge_null: Color32::from_rgb(0x6c, 0x6f, 0x85),
    subclass: Color32::from_rgb(0x17, 0x92, 0x99),
    dim: Color32::from_rgb(0x7c, 0x7f, 0x93),
};

pub fn palette(theme: Theme) -> &'static Palette {
    match theme {
        Theme::Dark => &DARK_PALETTE,
        Theme::Light => &LIGHT_PALETTE,
    }
}

pub fn apply_theme(ctx: &egui::Context, theme: Theme) {
    let mut visuals = match theme {
        Theme::Dark => Visuals::dark(),
        Theme::Light => Visuals::light(),
    };
    match theme {
        Theme::Dark => {
            visuals.panel_fill = Color32::from_rgb(0x1e, 0x1e, 0x2e); // base
            visuals.window_fill = Color32::from_rgb(0x18, 0x18, 0x25); // mantle
            visuals.extreme_bg_color = Color32::from_rgb(0x11, 0x11, 0x1b); // crust
            visuals.faint_bg_color = Color32::from_rgb(0x26, 0x26, 0x38);
            visuals.selection.bg_fill = Color32::from_rgb(0x45, 0x47, 0x5a);
            visuals.hyperlink_color = Color32::from_rgb(0x89, 0xb4, 0xfa);
        }
        Theme::Light => {
            visuals.panel_fill = Color32::from_rgb(0xef, 0xf1, 0xf5);
            visuals.window_fill = Color32::from_rgb(0xe6, 0xe9, 0xef);
        }
    }
    visuals.widgets.noninteractive.corner_radius = CornerRadius::same(3);
    visuals.widgets.inactive.corner_radius = CornerRadius::same(3);
    visuals.widgets.hovered.corner_radius = CornerRadius::same(3);
    visuals.widgets.active.corner_radius = CornerRadius::same(3);
    ctx.set_visuals(visuals);
}
