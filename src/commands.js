(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VDataCommands = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  const CMD = {
    SET_VALUE: 'set_value',
    RENAME_KEY: 'rename_key',
    ADD_NODE: 'add_node',
    REMOVE_NODE: 'remove_node',
    MOVE_NODE: 'move_node',
    BATCH: 'batch',
    SET_FORMAT: 'set_format',
    EXPAND_STATE: 'expand_state',
    /** Whole-root replacement (manual apply); keeps root references, no JSON clone. */
    DOC_REPLACE: 'doc_replace',
    /** Full document snapshot pair (heavy; rare structural edits like drag-reorder). */
    ROOT_STATE_PAIR: 'root_state_pair'
  };

  function commandIsStructural(cmd) {
    if (!cmd || !cmd.type) return false;
    switch (cmd.type) {
      case CMD.ADD_NODE:
      case CMD.REMOVE_NODE:
      case CMD.MOVE_NODE:
      case CMD.RENAME_KEY:
      case CMD.DOC_REPLACE:
      case CMD.ROOT_STATE_PAIR:
        return true;
      case CMD.BATCH:
        return Array.isArray(cmd.commands) && cmd.commands.some(commandIsStructural);
      default:
        return false;
    }
  }

  function getP() {
    return typeof VDataPathUtils !== 'undefined' ? VDataPathUtils : null;
  }

  function parentObject(doc, parentPath) {
    if (!parentPath) return doc.root;
    const P = getP();
    return P.getAtPath(doc.root, parentPath);
  }

  function renameKeyInObject(parentObj, oldKey, newKey) {
    if (!parentObj || typeof parentObj !== 'object' || Array.isArray(parentObj)) return;
    if (oldKey === newKey) return;
    if (!Object.prototype.hasOwnProperty.call(parentObj, oldKey)) return;
    if (Object.prototype.hasOwnProperty.call(parentObj, newKey)) return;
    const entries = Object.entries(parentObj);
    for (const [k] of entries) delete parentObj[k];
    for (const [k, v] of entries) {
      parentObj[k === oldKey ? newKey : k] = v;
    }
  }

  function addAtPath(doc, pathStr, value) {
    const P = getP();
    const segs = P.pathStrToSegments(pathStr);
    if (!segs.length) throw new Error('ADD_NODE: empty path');
    const { parent, key, isArrayIndex } = P.getParentAndKey(doc.root, segs);
    if (parent == null) throw new Error('ADD_NODE: invalid path');
    if (isArrayIndex) parent.splice(key, 0, value);
    else parent[key] = value;
  }

  function applyCommand(doc, cmd) {
    if (!doc || !cmd) return;
    const P = getP();
    if (!P) throw new Error('VDataPathUtils not loaded');

    switch (cmd.type) {
      case CMD.BATCH: {
        for (let i = 0; i < cmd.commands.length; i++) {
          applyCommand(doc, cmd.commands[i]);
        }
        break;
      }
      case CMD.SET_VALUE: {
        P.setAtPath(doc.root, cmd.pathStr, cmd.nextValue);
        break;
      }
      case CMD.SET_FORMAT: {
        doc.format = cmd.nextFormat;
        break;
      }
      case CMD.EXPAND_STATE: {
        doc.expandedPaths = new Set(cmd.expandedAfter);
        doc.collapsedPaths = new Set(cmd.collapsedAfter);
        break;
      }
      case CMD.RENAME_KEY: {
        const parent = parentObject(doc, cmd.parentPath || '');
        renameKeyInObject(parent, cmd.oldKey, cmd.newKey);
        doc.expandedPaths = new Set(cmd.expandedAfter);
        doc.collapsedPaths = new Set(cmd.collapsedAfter);
        if (typeof doc.structVersion === 'number') doc.structVersion++;
        break;
      }
      case CMD.REMOVE_NODE: {
        const removed = P.deleteAtPath(doc.root, cmd.pathStr);
        cmd.removed = removed;
        if (typeof doc.structVersion === 'number') doc.structVersion++;
        break;
      }
      case CMD.ADD_NODE: {
        addAtPath(doc, cmd.pathStr, cmd.value);
        if (typeof doc.structVersion === 'number') doc.structVersion++;
        break;
      }
      case CMD.MOVE_NODE: {
        const arr = P.getAtPath(doc.root, cmd.parentPath);
        P.moveInArray(arr, cmd.fromIndex, cmd.toIndex);
        if (typeof doc.structVersion === 'number') doc.structVersion++;
        break;
      }
      case CMD.DOC_REPLACE: {
        doc.root = cmd.rootAfter;
        doc.format = cmd.formatAfter;
        doc.expandedPaths = new Set(cmd.expandedAfter);
        doc.collapsedPaths = new Set(cmd.collapsedAfter);
        if (typeof doc.structVersion === 'number') doc.structVersion++;
        break;
      }
      case CMD.ROOT_STATE_PAIR: {
        doc.root = cmd.rootAfter;
        doc.format = cmd.formatAfter;
        doc.expandedPaths = new Set(cmd.expandedAfter);
        doc.collapsedPaths = new Set(cmd.collapsedAfter);
        if (typeof doc.structVersion === 'number') doc.structVersion++;
        break;
      }
      default:
        console.warn('applyCommand: unknown type', cmd.type);
    }
  }

  function invertCommand(cmd) {
    if (!cmd) return cmd;
    switch (cmd.type) {
      case CMD.BATCH:
        return {
          type: CMD.BATCH,
          commands: [...cmd.commands].reverse().map(invertCommand)
        };
      case CMD.SET_VALUE:
        return {
          type: CMD.SET_VALUE,
          pathStr: cmd.pathStr,
          prevValue: cmd.nextValue,
          nextValue: cmd.prevValue,
          relayout: !!cmd.relayout
        };
      case CMD.SET_FORMAT:
        return {
          type: CMD.SET_FORMAT,
          prevFormat: cmd.nextFormat,
          nextFormat: cmd.prevFormat
        };
      case CMD.EXPAND_STATE:
        return {
          type: CMD.EXPAND_STATE,
          expandedBefore: cmd.expandedAfter,
          collapsedBefore: cmd.collapsedAfter,
          expandedAfter: cmd.expandedBefore,
          collapsedAfter: cmd.collapsedBefore
        };
      case CMD.RENAME_KEY:
        return {
          type: CMD.RENAME_KEY,
          parentPath: cmd.parentPath,
          oldKey: cmd.newKey,
          newKey: cmd.oldKey,
          expandedAfter: [...(cmd.expandedBefore || [])],
          collapsedAfter: [...(cmd.collapsedBefore || [])],
          expandedBefore: [...(cmd.expandedAfter || [])],
          collapsedBefore: [...(cmd.collapsedAfter || [])]
        };
      case CMD.REMOVE_NODE:
        return {
          type: CMD.ADD_NODE,
          pathStr: cmd.pathStr,
          value: cmd.removed
        };
      case CMD.ADD_NODE:
        return {
          type: CMD.REMOVE_NODE,
          pathStr: cmd.pathStr
        };
      case CMD.MOVE_NODE:
        return {
          type: CMD.MOVE_NODE,
          parentPath: cmd.parentPath,
          fromIndex: cmd.toIndex,
          toIndex: cmd.fromIndex
        };
      case CMD.DOC_REPLACE:
        return {
          type: CMD.DOC_REPLACE,
          rootBefore: cmd.rootAfter,
          rootAfter: cmd.rootBefore,
          formatBefore: cmd.formatAfter,
          formatAfter: cmd.formatBefore,
          expandedBefore: cmd.expandedAfter,
          expandedAfter: cmd.expandedBefore,
          collapsedBefore: cmd.collapsedAfter,
          collapsedAfter: cmd.collapsedBefore
        };
      case CMD.ROOT_STATE_PAIR:
        return {
          type: CMD.ROOT_STATE_PAIR,
          rootBefore: cmd.rootAfter,
          rootAfter: cmd.rootBefore,
          formatBefore: cmd.formatAfter,
          formatAfter: cmd.formatBefore,
          expandedBefore: cmd.expandedAfter,
          expandedAfter: cmd.expandedBefore,
          collapsedBefore: cmd.collapsedAfter,
          collapsedAfter: cmd.collapsedBefore
        };
      default:
        return cmd;
    }
  }

  function setValueCommand(pathStr, prevValue, nextValue, relayout) {
    return { type: CMD.SET_VALUE, pathStr, prevValue, nextValue, relayout: !!relayout };
  }

  /** @returns {boolean} */
  function canCoalesceSetValue(prevTop, nextEntry, windowMs) {
    if (!prevTop || !prevTop.cmd || !nextEntry || !nextEntry.cmd) return false;
    const a = prevTop.cmd;
    const b = nextEntry.cmd;
    if (a.type !== CMD.SET_VALUE || b.type !== CMD.SET_VALUE) return false;
    if (a.relayout || b.relayout) return false;
    if (a.pathStr !== b.pathStr) return false;
    const dt = (nextEntry.time ?? Date.now()) - (prevTop.time ?? 0);
    return dt >= 0 && dt < windowMs;
  }

  return {
    CMD,
    applyCommand,
    invertCommand,
    commandIsStructural,
    setValueCommand,
    canCoalesceSetValue
  };
});
