// Per-tab document: root JSON, format, file identity, undo stacks, property-tree UI state.
const MAX_UNDO_STEPS = 200;

function stripLargeCmdSnapshots(cmd) {
  if (!cmd || !cmd.type) return;
  if (cmd.type === 'remove_node') cmd.removed = undefined;
  if (cmd.type === 'doc_replace' || cmd.type === 'root_state_pair') {
    cmd.rootBefore = null;
    cmd.rootAfter = null;
  }
  if (cmd.type === 'batch' && Array.isArray(cmd.commands)) {
    for (let i = 0; i < cmd.commands.length; i++) stripLargeCmdSnapshots(cmd.commands[i]);
  }
}

class VDataDocument {
  constructor({ root = null, format = 'kv3', filePath = null, fileName = 'Untitled', kv3Header = '' } = {}) {
    this.root =
      root ??
      ({ generic_data_type: 'CSmartPropRoot', m_Children: [], m_Variables: [] });
    this.format = format;
    this.filePath = filePath;
    this.fileName = fileName;
    this.kv3Header = kv3Header;
    this.dirty = false;

    this.undoStack = [];
    this.redoStack = [];

    this.expandedPaths = new Set();
    this.collapsedPaths = new Set();

    this.nextElementId = 1;
    this.structVersion = 0;
  }

  markDirty() {
    this.dirty = true;
  }

  /** Push `{ cmd, label, time }` (typed command) onto this document's undo stack. */
  pushUndo(entry) {
    const VC = typeof VDataCommands !== 'undefined' ? VDataCommands : null;
    if (!VC || !entry || !entry.cmd) return;
    this.undoStack.push({
      cmd: entry.cmd,
      label: entry.label ?? 'Edit',
      time: entry.time ?? Date.now()
    });
    while (this.undoStack.length > MAX_UNDO_STEPS) {
      const dropped = this.undoStack.shift();
      stripLargeCmdSnapshots(dropped.cmd);
    }
    this.redoStack.length = 0;
  }

  /**
   * @returns {{ entry: { cmd: unknown, label: string, time: number }, appliedCmd: unknown } | null}
   */
  undo() {
    const VC = typeof VDataCommands !== 'undefined' ? VDataCommands : null;
    const entry = this.undoStack.pop();
    if (!entry || !VC) return null;
    const appliedCmd = VC.invertCommand(entry.cmd);
    VC.applyCommand(this, appliedCmd);
    this.redoStack.push(entry);
    this.dirty = true;
    return { entry, appliedCmd };
  }

  /**
   * @returns {{ entry: { cmd: unknown, label: string, time: number }, appliedCmd: unknown } | null}
   */
  redo() {
    const VC = typeof VDataCommands !== 'undefined' ? VDataCommands : null;
    const entry = this.redoStack.pop();
    if (!entry || !VC) return null;
    VC.applyCommand(this, entry.cmd);
    this.undoStack.push(entry);
    this.dirty = true;
    return { entry, appliedCmd: entry.cmd };
  }

  recalcElementIds() {
    this.nextElementId = 1;
    const self = this;
    function recalcMaxId(node) {
      if (!node) return;
      if (node.m_nElementID != null && node.m_nElementID >= self.nextElementId) {
        self.nextElementId = node.m_nElementID + 1;
      }
      if (node.m_Children) node.m_Children.forEach(recalcMaxId);
      if (node.m_Modifiers) node.m_Modifiers.forEach(recalcMaxId);
      if (node.m_SelectionCriteria) node.m_SelectionCriteria.forEach(recalcMaxId);
    }
    const root = this.root;
    if (root.m_Children) root.m_Children.forEach(recalcMaxId);
    if (root.m_Variables) root.m_Variables.forEach(recalcMaxId);
  }

  serialize() {
    if (this.format === 'json') return JSON.stringify(this.root, null, 2);
    if (this.format === 'keyvalue') return KeyValueFormat.jsonToKeyValue(this.root);
    return KV3Format.jsonToKV3(this.root, { fileName: this.fileName, header: this.kv3Header });
  }

  get title() {
    return (this.dirty ? '● ' : '') + this.fileName;
  }
}

if (typeof globalThis !== 'undefined') globalThis.VDataDocument = VDataDocument;
