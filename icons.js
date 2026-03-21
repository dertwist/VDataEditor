// ===== SMARTPROP EDITOR – SVG ICON LIBRARY =====
// Lucide-style icons (24x24 viewBox, stroke-based, currentColor)
// All icons use class="icon" for CSS targeting.

(function () {
  function ic(paths, size) {
    var s = size || 14;
    return '<svg class="icon" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }

  window.ICONS = {

    // ── Element type icons ──────────────────────────────────────────────────

    // Group – folder
    folder: ic('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),

    // Model – 3-D cube
    box: ic('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),

    // SmartProp – sparkle / star
    sparkles: ic('<path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>'),

    // PlaceOnPath – route / spline
    route: ic('<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>'),

    // PlaceInSphere – circle with centre dot
    circleDot: ic('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>'),

    // PlaceMultiple – four squares grid
    grid2x2: ic('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'),

    // PickOne – shuffle / random
    shuffle: ic('<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>'),

    // FitOnLine – ruler
    ruler: ic('<rect x="2" y="8" width="20" height="8" rx="1"/><line x1="6" y1="8" x2="6" y2="14"/><line x1="10" y1="8" x2="10" y2="12"/><line x1="14" y1="8" x2="14" y2="12"/><line x1="18" y1="8" x2="18" y2="14"/>'),

    // ModifyState – refresh CW arrow
    refreshCw: ic('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),

    // BendDeformer – wave / bend
    wave: ic('<path d="M2 12c1.5-4 3.5-4 5 0s3.5 4 5 0 3.5-4 5 0" fill="none"/>'),

    // ModelEntity – package with tag line
    package: ic('<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),

    // PropPhysics – lightning bolt
    zap: ic('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),

    // PropDynamic – play circle
    playCircle: ic('<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>'),

    // MidpointDeformer – git commit dot on line
    gitCommit: ic('<circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>'),

    // Layout2DGrid – 3×3 grid
    layoutGrid: ic('<rect x="3" y="3" width="5" height="5"/><rect x="10" y="3" width="5" height="5"/><rect x="17" y="3" width="5" height="5"/><rect x="3" y="10" width="5" height="5"/><rect x="10" y="10" width="5" height="5"/><rect x="17" y="10" width="5" height="5"/><rect x="3" y="17" width="5" height="5"/><rect x="10" y="17" width="5" height="5"/><rect x="17" y="17" width="5" height="5"/>'),

    // ── Tree section headers ────────────────────────────────────────────────

    // Children section – stacked layers
    layers: ic('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),

    // Variables section – curly braces
    braces: ic('<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>'),

    // Variable row – hash / number sign (universal "variable name" symbol)
    tag: ic('<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>'),

    // Modifiers section – horizontal sliders
    sliders: ic('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),

    // Criteria section – funnel filter
    filter: ic('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>'),

    // ── Toggle / chevron arrows ─────────────────────────────────────────────

    chevronRight: ic('<polyline points="9 18 15 12 9 6"/>'),
    chevronDown:  ic('<polyline points="6 9 12 15 18 9"/>'),
    chevronUp:    ic('<polyline points="18 15 12 9 6 15"/>'),

    // ── Context menu / action icons ─────────────────────────────────────────

    // Add / plus
    plus: ic('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),

    // Add inside square – add element button
    plusSquare: ic('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>'),

    // Add variable – plus with tag
    tagPlus: ic('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/><line x1="19" y1="3" x2="19" y2="9"/><line x1="16" y1="6" x2="22" y2="6"/>'),

    // Copy (Ctrl+C)
    copy: ic('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),

    // Cut (Ctrl+X)
    scissors: ic('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>'),

    // Paste (Ctrl+V)
    clipboard: ic('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>'),

    // Duplicate (Ctrl+D) – copy with +
    duplicate: ic('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="15.5" y1="3" x2="15.5" y2="9"/><line x1="12.5" y1="6" x2="18.5" y2="6"/>'),

    // Rename / edit – pencil
    pencil: ic('<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>'),

    // Move up
    arrowUp: ic('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'),

    // Move down
    arrowDown: ic('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'),

    // Delete – trash
    trash: ic('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),

    // Small × close / delete button
    x: ic('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),

    // Modifier – wrench / tool
    wrench: ic('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),

    // Selection Criteria – target / bullseye
    target: ic('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),

    // ── Panel toolbar buttons ───────────────────────────────────────────────

    // Collapse all
    collapseAll: ic('<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>'),

    // Expand all
    expandAll: ic('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'),

    // Undock panel – pop out to floating window
    undock: ic('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),

    // Dock / re-dock panel back
    dock: ic('<path d="M9 11l-4 4 4 4m-4-4h11a4 4 0 0 0 0-8h-1"/>'),

    // ── Undo history icons ──────────────────────────────────────────────────

    // Current state – filled play
    playSolid: ic('<polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/>'),

    // Redo state
    rotateCw: ic('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),

    // Undo state
    rotateCcw: ic('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'),

    // ── Menu item icons ─────────────────────────────────────────────────────

    // File > Save (floppy disk)
    save: ic('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),

    // File > Save As (floppy with arrow)
    saveAs: ic('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/><path d="M22 10l-4 4-4-4M18 14V4"/>'),

    // File > New
    filePlus: ic('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>'),

    // File > Import (upload arrow)
    fileImport: ic('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="17 15 12 20 7 15"/><line x1="12" y1="10" x2="12" y2="20"/>'),

    // File > Export (download arrow)
    fileExport: ic('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="7 13 12 8 17 13"/><line x1="12" y1="8" x2="12" y2="18"/>'),

    // File > Quit – power button
    power: ic('<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>'),

    // Edit > Undo (menu)
    undo: ic('<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>'),

    // Edit > Redo (menu)
    redo: ic('<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>'),

    // Edit > Add Element
    nodeAdd: ic('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>'),

    // Edit > Add Variable
    variableAdd: ic('<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/><line x1="9" y1="12" x2="15" y2="12"/>'),

    // Window > Minimize
    windowMinimize: ic('<line x1="5" y1="12" x2="19" y2="12"/>'),

    // Window > Zoom / Maximize
    windowMaximize: ic('<polyline points="8 3 3 3 3 8"/><polyline points="21 8 21 3 16 3"/><polyline points="3 16 3 21 8 21"/><polyline points="16 21 21 21 21 16"/>'),

    // Window > Full Screen
    fullscreen: ic('<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>'),

    // Help > About
    info: ic('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),

    // JSON { } brackets
    bracesCurly: ic('<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>'),

    // KV3 / code file
    fileCode: ic('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="10 17 8 15 10 13"/><polyline points="14 13 16 15 14 17"/>'),
  };
}());
