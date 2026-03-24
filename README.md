# VDataEditor

> Desktop editor for Source 2 KV3 files (`.vsmart`, `.vdata`, `.vpcf`, `.kv3`).

VDataEditor is a lightweight desktop tool for viewing, editing, and saving Source 2 data files with both raw text editing and structured property widgets. It is designed for fast iteration when working with Valve resource data and related KV3-based content.

[![GitHub release](https://img.shields.io/github/v/release/dertwist/VDataEditor?label=latest&style=flat-square)](https://github.com/dertwist/VDataEditor/releases/latest)
[![Build & Package](https://img.shields.io/github/actions/workflow/status/dertwist/VDataEditor/build.yml?branch=main&style=flat-square)](https://github.com/dertwist/VDataEditor/actions)

## Screenshot

![VDataEditor program screenshot](readme/screenshot.png)

## Download

| Platform | Stable release | Latest build |
|----------|---------------|---------------|
| 🪟 Windows | [**Download .exe**](https://github.com/dertwist/VDataEditor/releases/latest) | [Latest build ↗](https://github.com/dertwist/VDataEditor/releases/tag/latest-build) |

## Project documentation

### Architecture

VDataEditor follows the usual Electron split:

| Layer | Role |
|--------|------|
| **Main** (`main.js`) | Window lifecycle, native dialogs, filesystem read/write, recent-files list (stored under the app user data path), IPC handlers. File-open from OS (CLI on Windows, `open-file` on macOS) forwards paths to the renderer. |
| **Preload** (`preload.js`) | Exposes a small `window.electronAPI` surface via `contextBridge` (isolated context; the renderer does not use Node directly). |
| **Renderer** (`index.html`, `style.css`, `editor.js`, …) | All UI: menus, docks, text editing, and the property tree for structured KV3 data. |

`renderer.js` is the stock Electron placeholder. In **`index.html`**, scripts load in dependency order: `format/kv3.js` and `format/keyvalue.js`, then `src/model/` (`kv3-node.js`, `kv3-document.js`), `src/formats/registry.js`, `src/settings/`, `src/modes/index.js`, `icons.js`, `vendor/cm.js`, an inline icon bootstrap, and finally **`editor.js`** (main UI).

### Text editing

**CodeMirror 6** is not pulled from `node_modules` at runtime. Source lives in `src/cm-bundle.js` and is bundled to **`vendor/cm.js`** with esbuild (`npm run build:cm`). That step runs on **`npm install`** via `postinstall`. After changing editor dependencies or `src/cm-bundle.js`, rebuild the vendor file before testing.

### Data layer

- **`format/kv3.js`** and **`format/keyvalue.js`** — parse and serialize KV3 / KeyValues text. Round-trip behavior is covered by tests; changes here should keep fixtures and assertions in sync.
- **`src/model/kv3-document.js`**, **`src/model/kv3-node.js`** — document model helpers used by the UI.
- **`src/formats/registry.js`** — maps file extension plus document shape (`generic_data_type`, particle `_class`, etc.) to **widget profiles** (labels and dispatch for the property panel). Extend `PROFILES` when adding a new typed profile.
- **`src/modes/index.js`** — property editor **mode registry**: schema hints and custom widgets per file type (`vsmart`, particle types, etc.), exposed as `window.VDataEditorModes`. Loaded before `editor.js`.
- **`src/settings/`** — widget config and system config (`widget-config.js`, `system-config.js`).

### IPC surface (`electronAPI`)

The preload exposes: file read/save, save dialog, app version, recent files (get/clear/add, and `onRecentFilesUpdated`), `onOpenFile`, and window actions (quit, minimize, zoom, fullscreen). New main-process features should add a matching handler in `main.js` and a typed bridge in `preload.js`.

### Assets

- **`icons.js`** — inline SVG icons consumed by `index.html` for menus and toolbars.
- **`assets/images/`** — app icon, file-type and UI imagery referenced from HTML/CSS.

### Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Run the app with Electron. |
| `npm test` | Run **Vitest** tests under `tests/`. |
| `npm run build:cm` | Rebuild `vendor/cm.js` from `src/cm-bundle.js`. |
| `npm run build:win` | Package a Windows installer (see `package.json` `build` block). |

### File associations

Supported extensions for “open with” and CLI are defined in **`main.js`** (`OPEN_FILE_EXTENSIONS` / `OPEN_FILE_RE`) and should stay aligned with **`package.json`** `build.fileAssociations` so the packaged app and dev behavior match.

### Contributing

When you change parsing, serialization, or document structure, run **`npm test`** and update or add tests under `tests/`. Prefer edits that follow patterns and naming in the surrounding files.
