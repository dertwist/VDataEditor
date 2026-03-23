// ===== VDataEditor – ICON LIBRARY =====
// Valve Source 2–style PNGs from assets/images/common/ and assets/images/valve_style/
// All icons use class="icon" / "icon icon-png" for CSS targeting.

(function () {
  var COMMON = 'assets/images/common/';
  var VALVE = 'assets/images/valve_style/';
  var PROPEDITOR = 'assets/images/propertyeditor/';
  var MODELDOC = 'assets/images/modeldoc_editor/';

  function img(path, size) {
    var s = size || 14;
    return '<img class="icon icon-png" src="' + path + '" width="' + s + '" height="' + s + '" alt="" aria-hidden="true">';
  }

  window.ICONS = {

    // ── Element type icons ──────────────────────────────────────────────────

    folder: img(COMMON + 'folder.png'),
    box: img(COMMON + 'model_config_icon.png'),
    sparkles: img(COMMON + 'smart_prop_component.png'),
    route: img(COMMON + 'curve_tangent_spline.png'),
    circleDot: img(COMMON + 'icon_type_generic.png'),
    grid2x2: img(COMMON + 'tileset.png'),
    shuffle: img(COMMON + 'repeat_multiple.png'),
    ruler: img(COMMON + 'align.png'),
    refreshCw: img(COMMON + 'refresh.png'),
    wave: img(COMMON + 'curve_tangent_sine.png'),
    package: img(COMMON + 'reference_asset.png'),
    zap: img(COMMON + 'electronics.png'),
    playCircle: img(COMMON + 'control_play.png'),
    gitCommit: img(COMMON + 'parentchild_child_mid.png'),
    layoutGrid: img(COMMON + 'tileset_overlay.png'),

    // ── Tree section headers ──────────────────────────────────────────────────

    layers: img(COMMON + 'multi_files.png'),
    braces: img(COMMON + 'bind_command_list.png'),
    tag: img(COMMON + 'generic_filter_name_part.png'),
    sliders: img(COMMON + 'setting_med.png'),
    filter: img(COMMON + 'generic_filter_and.png'),

    // ── Toggle / chevron arrows (valve_style pixel UI) ───────────────────────

    chevronRight: img(VALVE + 'arrow_closed.png'),
    chevronDown: img(VALVE + 'arrow_open.png'),
    chevronUp: img(VALVE + 'arrow_up.png'),

    // ── Context menu / action icons ─────────────────────────────────────────

    plus: img(COMMON + 'add.png'),
    plusSquare: img(COMMON + 'add_node.png'),
    tagPlus: img(COMMON + 'tag_add.png'),
    copy: img(COMMON + 'copy.png'),
    scissors: img(COMMON + 'cut.png'),
    clipboard: img(COMMON + 'paste.png'),
    duplicate: img(COMMON + 'duplicate.png'),
    pencil: img(COMMON + 'edit_pencil.png'),
    arrowUp: img(VALVE + 'arrow_up.png'),
    arrowDown: img(VALVE + 'arrow_down.png'),
    trash: img(COMMON + 'delete.png'),
    x: img(COMMON + 'cancel_sm.png'),
    wrench: img(COMMON + 'tools_options.png'),
    target: img(COMMON + 'bind_command_target.png'),

    // ── Panel toolbar buttons ───────────────────────────────────────────────

    collapseAll: img(COMMON + 'collapse_all.png'),
    expandAll: img(COMMON + 'expand_all.png'),
    undock: img(VALVE + 'dock_float_button.png'),
    dock: img(COMMON + 'arrow_left.png'),

    // ── Undo history icons ──────────────────────────────────────────────────

    playSolid: img(COMMON + 'control_play_sm.png'),
    rotateCw: img(COMMON + 'redo.png'),
    rotateCcw: img(COMMON + 'undo.png'),

    // ── Menu item icons ─────────────────────────────────────────────────────

    save: img(COMMON + 'save.png'),
    saveAs: img(COMMON + 'save_all.png'),
    filePlus: img(COMMON + 'new.png'),
    fileImport: img(COMMON + 'import.png'),
    fileExport: img(COMMON + 'browse.png'),
    power: img(COMMON + 'shutdown_sm.png'),
    undo: img(COMMON + 'undo.png'),
    redo: img(COMMON + 'redo.png'),
    nodeAdd: img(COMMON + 'add_editor_node.png'),
    variableAdd: img(PROPEDITOR + 'item_add.png'),
    windowMinimize: img(COMMON + 'subtract_sm.png'),
    windowMaximize: img(COMMON + 'zoom_in.png'),
    fullscreen: img(COMMON + 'global.png'),
    info: img(COMMON + 'icon_info.png'),
    bracesCurly: img(COMMON + 'document_sm.png'),
    fileCode: img(COMMON + 'document.png'),

    // ── Property type icons ─────────────────────────────────────────────────

    typeString: img(COMMON + 'document_sm.png'),
    typeInt: img(COMMON + 'sort_default.png'),
    typeFloat: img(COMMON + 'curve_tangent_linear.png'),
    typeBool: img(COMMON + 'check.png'),
    typeColor: img(COMMON + 'color_wheel_sm.png'),
    typeObject: img(COMMON + 'document.png'),
    typeArray: img(MODELDOC + 'outliner_icon_anim_constraint_list.png'),
    typeVec2: img(COMMON + 'sub_object_reference.png'),
    typeVec3: img(COMMON + 'model_config_icon.png'),
    typeVec4: img(COMMON + 'tile_asset.png'),
    typeResource: img(COMMON + 'reference_asset.png'),
    typeSound: img(COMMON + 'tools_muted.png'),
    typeNull: img(COMMON + 'obsolete.png'),
    typeUnknown: img(COMMON + 'icon_question.png')
  };
}());
