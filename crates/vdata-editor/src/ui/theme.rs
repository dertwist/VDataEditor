//! Theme ported from the original editor's `style.css` CSS variables
//! (dark `:root` block and `html[data-theme="light"]` block), including the
//! per-type value colors (`--color-float`, `--color-int`, `--color-string`,
//! …).

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
    /// `--text-secondary`: ordinary property keys.
    pub key: Color32,
    /// `--text-primary`: object/container keys (`.prop-row.is-object`).
    pub key_object: Color32,
    /// `--color-string`.
    pub string: Color32,
    /// `--color-int`.
    pub num_int: Color32,
    /// `--color-float` (also vectors).
    pub num_float: Color32,
    /// true/false/null literals in text (`--mauve`).
    pub keyword: Color32,
    /// `--text-muted`: comments.
    pub comment: Color32,
    /// `--yellow`: typed-string flags (resource_name:, soundevent:, …).
    pub typed: Color32,
    /// `--mauve`: subclass badge and `_class` annotations.
    pub subclass: Color32,
    /// `--accent`.
    pub accent: Color32,
    /// `--text-muted`: secondary chrome text.
    pub dim: Color32,
    /// `--color-color`: color-swatch values.
    pub color_value: Color32,
    pub badge_object: Color32,
    pub badge_array: Color32,
    pub badge_string: Color32,
    pub badge_number: Color32,
    pub badge_bool: Color32,
    pub badge_typed: Color32,
    pub badge_comment: Color32,
    pub badge_null: Color32,
}

// style.css `:root` (dark)
pub const DARK_PALETTE: Palette = Palette {
    key: Color32::from_rgb(0x9D, 0x9D, 0x9D),        // --text-secondary
    key_object: Color32::from_rgb(0xE3, 0xE3, 0xE3), // --text-primary
    string: Color32::from_rgb(0xFF, 0xD1, 0x99),     // --color-string
    num_int: Color32::from_rgb(0x6C, 0x87, 0xFF),    // --color-int
    num_float: Color32::from_rgb(0xB5, 0xFF, 0xEF),  // --color-float
    keyword: Color32::from_rgb(0xCB, 0xA6, 0xF7),    // --mauve
    comment: Color32::from_rgb(0x6D, 0x6D, 0x6D),    // --text-muted
    typed: Color32::from_rgb(0xF9, 0xE2, 0xAF),      // --yellow
    subclass: Color32::from_rgb(0xCB, 0xA6, 0xF7),   // --mauve
    accent: Color32::from_rgb(0xA8, 0xBE, 0xD1),     // --accent
    dim: Color32::from_rgb(0x6D, 0x6D, 0x6D),        // --text-muted
    color_value: Color32::from_rgb(0xF5, 0xC2, 0xE7), // --color-color
    badge_object: Color32::from_rgb(0xCB, 0xA6, 0xF7),
    badge_array: Color32::from_rgb(0x6C, 0x87, 0xFF),
    badge_string: Color32::from_rgb(0xFF, 0xD1, 0x99),
    badge_number: Color32::from_rgb(0xB5, 0xFF, 0xEF),
    badge_bool: Color32::from_rgb(0xE3, 0xE3, 0xE3),
    badge_typed: Color32::from_rgb(0xF9, 0xE2, 0xAF),
    badge_comment: Color32::from_rgb(0x6D, 0x6D, 0x6D),
    badge_null: Color32::from_rgb(0x9D, 0x9D, 0x9D),
};

// style.css `html[data-theme="light"]`
pub const LIGHT_PALETTE: Palette = Palette {
    key: Color32::from_rgb(0x5A, 0x5A, 0x64),        // --text-secondary
    key_object: Color32::from_rgb(0x1C, 0x1C, 0x20), // --text-primary
    string: Color32::from_rgb(0xBC, 0x6C, 0x25),     // --peach
    num_int: Color32::from_rgb(0x1E, 0x40, 0xAF),
    num_float: Color32::from_rgb(0x0F, 0x76, 0x6E),
    keyword: Color32::from_rgb(0x5A, 0x18, 0x9A),    // --mauve
    comment: Color32::from_rgb(0x88, 0x88, 0x94),    // --text-muted
    typed: Color32::from_rgb(0xCA, 0x67, 0x02),      // --yellow
    subclass: Color32::from_rgb(0x5A, 0x18, 0x9A),   // --mauve
    accent: Color32::from_rgb(0x3D, 0x5A, 0x80),     // --accent
    dim: Color32::from_rgb(0x88, 0x88, 0x94),
    color_value: Color32::from_rgb(0xA0, 0x36, 0x7A),
    badge_object: Color32::from_rgb(0x5A, 0x18, 0x9A),
    badge_array: Color32::from_rgb(0x1E, 0x40, 0xAF),
    badge_string: Color32::from_rgb(0xBC, 0x6C, 0x25),
    badge_number: Color32::from_rgb(0x0F, 0x76, 0x6E),
    badge_bool: Color32::from_rgb(0x1C, 0x1C, 0x20),
    badge_typed: Color32::from_rgb(0xCA, 0x67, 0x02),
    badge_comment: Color32::from_rgb(0x88, 0x88, 0x94),
    badge_null: Color32::from_rgb(0x5A, 0x5A, 0x64),
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
            let bg_primary = Color32::from_rgb(0x15, 0x15, 0x15);
            let bg_secondary = Color32::from_rgb(0x1C, 0x1C, 0x1C);
            let bg_surface = Color32::from_rgb(0x1D, 0x1D, 0x1F);
            let bg_hover = Color32::from_rgb(0x41, 0x49, 0x56);
            let border = Color32::from_rgb(0x36, 0x36, 0x39);
            let text_primary = Color32::from_rgb(0xE3, 0xE3, 0xE3);
            let text_secondary = Color32::from_rgb(0x9D, 0x9D, 0x9D);
            let accent = Color32::from_rgb(0xA8, 0xBE, 0xD1);

            visuals.panel_fill = bg_primary;
            visuals.window_fill = bg_secondary;
            visuals.extreme_bg_color = bg_surface;
            visuals.faint_bg_color = Color32::from_rgba_premultiplied(255, 255, 255, 5);
            visuals.selection.bg_fill = bg_hover;
            visuals.selection.stroke = egui::Stroke::new(1.0, accent);
            visuals.hyperlink_color = accent;
            visuals.warn_fg_color = Color32::from_rgb(0xF9, 0xE2, 0xAF); // --yellow
            visuals.error_fg_color = Color32::from_rgb(0xF3, 0x8B, 0xA8); // --red

            visuals.widgets.noninteractive.fg_stroke.color = text_primary;
            visuals.widgets.noninteractive.bg_stroke.color = border;
            visuals.widgets.inactive.bg_fill = bg_surface;
            visuals.widgets.inactive.weak_bg_fill = bg_surface;
            visuals.widgets.inactive.fg_stroke.color = text_secondary;
            visuals.widgets.hovered.bg_fill = bg_hover;
            visuals.widgets.hovered.weak_bg_fill = bg_hover;
            visuals.widgets.hovered.fg_stroke.color = text_primary;
            visuals.widgets.active.bg_fill = bg_hover;
            visuals.widgets.active.weak_bg_fill = bg_hover;
            visuals.widgets.active.fg_stroke.color = text_primary;
            visuals.widgets.open.bg_fill = bg_hover;
            visuals.widgets.open.weak_bg_fill = bg_secondary;
        }
        Theme::Light => {
            let bg_primary = Color32::from_rgb(0xEC, 0xEC, 0xF0);
            let bg_secondary = Color32::from_rgb(0xE2, 0xE2, 0xE8);
            let bg_surface = Color32::WHITE;
            let bg_hover = Color32::from_rgb(0xCF, 0xD4, 0xDC);
            let bg_selected = Color32::from_rgb(0xC2, 0xC8, 0xD4);
            let border = Color32::from_rgb(0xC4, 0xC4, 0xCC);
            let text_primary = Color32::from_rgb(0x1C, 0x1C, 0x20);
            let text_secondary = Color32::from_rgb(0x5A, 0x5A, 0x64);
            let accent = Color32::from_rgb(0x3D, 0x5A, 0x80);

            visuals.panel_fill = bg_primary;
            visuals.window_fill = bg_secondary;
            visuals.extreme_bg_color = bg_surface;
            visuals.selection.bg_fill = bg_selected;
            visuals.selection.stroke = egui::Stroke::new(1.0, accent);
            visuals.hyperlink_color = accent;
            visuals.warn_fg_color = Color32::from_rgb(0xCA, 0x67, 0x02);
            visuals.error_fg_color = Color32::from_rgb(0x9D, 0x02, 0x08);

            visuals.widgets.noninteractive.fg_stroke.color = text_primary;
            visuals.widgets.noninteractive.bg_stroke.color = border;
            visuals.widgets.inactive.bg_fill = bg_surface;
            visuals.widgets.inactive.weak_bg_fill = bg_secondary;
            visuals.widgets.inactive.fg_stroke.color = text_secondary;
            visuals.widgets.hovered.bg_fill = bg_hover;
            visuals.widgets.hovered.weak_bg_fill = bg_hover;
            visuals.widgets.hovered.fg_stroke.color = text_primary;
            visuals.widgets.active.bg_fill = bg_selected;
            visuals.widgets.active.weak_bg_fill = bg_selected;
            visuals.widgets.active.fg_stroke.color = text_primary;
        }
    }
    // --radius: 6px / --radius-sm: 4px
    visuals.widgets.noninteractive.corner_radius = CornerRadius::same(4);
    visuals.widgets.inactive.corner_radius = CornerRadius::same(4);
    visuals.widgets.hovered.corner_radius = CornerRadius::same(4);
    visuals.widgets.active.corner_radius = CornerRadius::same(4);
    visuals.window_corner_radius = CornerRadius::same(6);
    ctx.set_visuals(visuals);
}
