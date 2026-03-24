// Per-tab document: root JSON, format, file identity, undo stacks, property-tree UI state.
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
  }

  markDirty() {
    this.dirty = true;
  }

  /** Push a command { undo, redo, label, time } onto this document's stack. */
  pushUndo(cmd) {
    this.undoStack.push({ ...cmd, time: cmd.time ?? Date.now() });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this.redoStack.push(cmd);
    return cmd;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.redo();
    this.undoStack.push(cmd);
    return cmd;
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
