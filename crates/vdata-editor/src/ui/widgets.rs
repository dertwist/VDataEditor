//! Property widgets ported from the original `src/widgets/` implementations.
//!
//! The defining widget of the old editor is the paired **slider + input**
//! (`number.js` `buildSliderInput`): a numeric text field next to a range
//! slider whose bounds derive from a *range anchor* — `half = |anchor|·10+10`,
//! capped (10 000 000 for ints, 1 000 000 for floats). The anchor is frozen
//! while scrubbing so dragging to the edge cannot blow the range up, and
//! re-anchors on manual edits, external changes (undo), or scrub release.

use egui::{DragValue, Slider};

/// Cap on the symmetric slider half-range, same constants as `number.js`.
const INT_HALF_LIMIT: f64 = 10_000_000.0;
const FLOAT_HALF_LIMIT: f64 = 1_000_000.0;

#[derive(Clone, Copy, PartialEq)]
struct SliderAnchor {
    anchor: f64,
    last_seen: f64,
}

/// Symmetric slider window for a given anchor value.
pub fn slider_bounds(anchor: f64, is_int: bool) -> (f64, f64) {
    let cap = if is_int { INT_HALF_LIMIT } else { FLOAT_HALF_LIMIT };
    let mag = if anchor.is_finite() { anchor.abs() } else { 0.0 };
    let mut half = (mag * 10.0 + 10.0).min(cap);
    if mag > half {
        half = cap;
    }
    if is_int {
        (-half.floor(), half.ceil())
    } else {
        (-half, half)
    }
}

/// Paired numeric input + adaptive-range slider. Returns the new value when
/// either control changed it this frame.
pub fn slider_input(ui: &mut egui::Ui, salt: (&str, u32), current: f64, is_int: bool) -> Option<f64> {
    let id = egui::Id::new(("slider-input", salt));
    let mut state: SliderAnchor = ui
        .data(|d| d.get_temp(id))
        .unwrap_or(SliderAnchor {
            anchor: current,
            last_seen: current,
        });

    // External change (undo/redo, text-pane apply): re-anchor, like the old
    // widget's __vdeSetValueFromModel hook.
    if state.last_seen != current {
        state.anchor = current;
    }

    let mut value = current;
    let mut changed = false;

    // Manual input: commits like a DragValue (type + Enter / drag), and
    // re-anchors the slider window.
    let drag = if is_int {
        DragValue::new(&mut value).speed(1)
    } else {
        DragValue::new(&mut value).speed(0.01).max_decimals(6)
    };
    if ui.add_sized([56.0, 18.0], drag).changed() {
        if is_int {
            value = value.round();
        }
        state.anchor = value;
        changed = true;
    }

    // Range slider over the anchored window; the window is frozen during the
    // drag so scrubbing to the edge can't grow it.
    let (min_b, max_b) = slider_bounds(state.anchor, is_int);
    let slider_width = (ui.available_width() - 8.0).max(40.0);
    let mut slider_value = value.clamp(min_b, max_b);
    ui.spacing_mut().slider_width = slider_width;
    let slider = if is_int {
        Slider::new(&mut slider_value, min_b..=max_b)
            .show_value(false)
            .step_by(1.0)
    } else {
        Slider::new(&mut slider_value, min_b..=max_b).show_value(false)
    };
    let resp = ui.add(slider);
    if resp.changed() {
        value = if is_int { slider_value.round() } else { slider_value };
        changed = true;
    }
    if resp.drag_stopped() {
        // Re-anchor on release so the next scrub gets a window around the
        // new value (the old widget kept the stale anchor until a manual
        // edit, which its own comments called out as confusing).
        state.anchor = value;
    }

    state.last_seen = if changed { value } else { current };
    ui.data_mut(|d| d.insert_temp(id, state));

    changed.then_some(value)
}

/// File-dialog filters per typed-string kind, same lists as `resource.js`.
pub fn resource_filters(kind: &str) -> (&'static str, &'static [&'static str]) {
    match kind {
        "soundevent" => ("Sound", &["vsndevts", "vsndstck", "wav", "mp3"]),
        "panorama" => (
            "Images / layouts",
            &["png", "jpg", "jpeg", "psd", "svg", "vgui", "xml"],
        ),
        _ => (
            "Models / particles / materials",
            &["vmdl", "vpcf", "vnmskel", "vmat"],
        ),
    }
}

/// Browse-button glyph per kind (`🔊` for sound events, `📁` otherwise).
pub fn resource_button_glyph(kind: &str) -> &'static str {
    if kind == "soundevent" { "🔊" } else { "📁" }
}

/// Make a picked path doc-relative when possible and forward-slashed,
/// mirroring the `relativeTo: baseDir` behaviour of the Electron picker.
pub fn relativize_path(picked: &std::path::Path, base_dir: Option<&std::path::Path>) -> String {
    let path = base_dir
        .and_then(|base| picked.strip_prefix(base).ok())
        .unwrap_or(picked);
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_follow_the_original_formula() {
        // value 1 → half-range 20 → [-20, 20] (the example from number.js)
        assert_eq!(slider_bounds(1.0, false), (-20.0, 20.0));
        assert_eq!(slider_bounds(0.0, false), (-10.0, 10.0));
        assert_eq!(slider_bounds(-5.0, true), (-60.0, 60.0));
        // Caps: 10M for ints, 1M for floats.
        assert_eq!(slider_bounds(5e7, true), (-INT_HALF_LIMIT, INT_HALF_LIMIT));
        assert_eq!(
            slider_bounds(5e6, false),
            (-FLOAT_HALF_LIMIT, FLOAT_HALF_LIMIT)
        );
    }

    #[test]
    fn filters_match_resource_js() {
        assert_eq!(resource_filters("soundevent").1, &["vsndevts", "vsndstck", "wav", "mp3"]);
        assert_eq!(resource_filters("panorama").0, "Images / layouts");
        assert_eq!(resource_filters("resource_name").1[0], "vmdl");
        assert_eq!(resource_button_glyph("soundevent"), "🔊");
        assert_eq!(resource_button_glyph("resource_name"), "📁");
    }

    #[test]
    fn relativize_strips_doc_dir_and_normalizes_slashes() {
        let base = std::path::Path::new("/game/scripts");
        let picked = std::path::Path::new("/game/scripts/models/a.vmdl");
        assert_eq!(relativize_path(picked, Some(base)), "models/a.vmdl");
        let outside = std::path::Path::new("/elsewhere/b.vmdl");
        assert_eq!(relativize_path(outside, Some(base)), "/elsewhere/b.vmdl");
        assert_eq!(relativize_path(outside, None), "/elsewhere/b.vmdl");
    }
}
