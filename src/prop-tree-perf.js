/**
 * Optional performance helpers for the property tree (virtual scroll, debounced render).
 * Exposed as window.VDataPropTreePerf — opt-in from prop-tree.js later; does not replace buildPropertyTree yet.
 */
(function () {
  'use strict';

  var CHUNK_SIZE = 80;
  var ROW_HEIGHT_PX = 28;
  var OVERSCAN_ROWS = 10;
  var DEBOUNCE_MS = 40;

  function initPropTreeLazy(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML =
      '<div class="prop-tree-empty" style="padding:12px;opacity:.5;font-size:12px;">No document open</div>';
    container._vtInitialised = false;
    container._vtRows = [];
    container._vtScrollHandler = null;
  }

  function yieldToEventLoop() {
    return new Promise(function (resolve) {
      var ch = new MessageChannel();
      ch.port1.onmessage = resolve;
      ch.port2.postMessage(null);
    });
  }

  function appendRowsIncremental(parent, rows, createRow) {
    return (async function () {
      var i = 0;
      while (i < rows.length) {
        var frag = document.createDocumentFragment();
        var end = Math.min(i + CHUNK_SIZE, rows.length);
        for (; i < end; i++) {
          frag.appendChild(createRow(rows[i]));
        }
        parent.appendChild(frag);
        if (i < rows.length) await yieldToEventLoop();
      }
    })();
  }

  function computeVisibleSlice(container, allRows) {
    var scrollTop = container.scrollTop;
    var viewHeight = container.clientHeight;
    var startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
    var endIdx = Math.min(
      allRows.length,
      Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT_PX) + OVERSCAN_ROWS
    );
    return {
      start: startIdx,
      end: endIdx,
      paddingTop: startIdx * ROW_HEIGHT_PX,
      paddingBottom: (allRows.length - endIdx) * ROW_HEIGHT_PX
    };
  }

  function renderSlice(container, allRows, createRow) {
    var slice = computeVisibleSlice(container, allRows);
    container.style.paddingTop = slice.paddingTop + 'px';
    container.style.paddingBottom = slice.paddingBottom + 'px';
    var frag = document.createDocumentFragment();
    for (var i = slice.start; i < slice.end; i++) {
      frag.appendChild(createRow(allRows[i]));
    }
    container.replaceChildren(frag);
  }

  function renderTreeVirtual(containerId, allRows, createRow) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container._vtRows = allRows;
    container._vtCreateRow = createRow;
    renderSlice(container, allRows, createRow);
    if (!container._vtScrollHandler) {
      var ticking = false;
      container._vtScrollHandler = function () {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(function () {
            renderSlice(container, container._vtRows, container._vtCreateRow);
            ticking = false;
          });
        }
      };
      container.addEventListener('scroll', container._vtScrollHandler, { passive: true });
    }
    container._vtInitialised = true;
  }

  function updateTreeRows(containerId, newRows) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container._vtRows = newRows;
    renderSlice(container, newRows, container._vtCreateRow);
  }

  var _debounceTimers = new Map();

  function debouncedRender(renderFn, key, delay) {
    var k = key != null ? key : 'default';
    var d = delay != null ? delay : DEBOUNCE_MS;
    if (_debounceTimers.has(k)) clearTimeout(_debounceTimers.get(k));
    _debounceTimers.set(
      k,
      setTimeout(function () {
        _debounceTimers.delete(k);
        renderFn();
      }, d)
    );
  }

  function patchTreeNode(containerId, nodeId, newRows, createRow) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var esc =
      typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(nodeId)
        : String(nodeId).replace(/"/g, '\\"');
    var anchor = container.querySelector('[data-node-id="' + esc + '"]');
    if (!anchor) {
      updateTreeRows(containerId, newRows);
      return;
    }
    var next = anchor.nextSibling;
    var anchorDepth = parseInt(anchor.dataset.depth != null ? anchor.dataset.depth : '0', 10);
    while (next) {
      var nd = parseInt(next.dataset && next.dataset.depth != null ? next.dataset.depth : '0', 10);
      if (nd <= anchorDepth) break;
      var toRemove = next;
      next = next.nextSibling;
      toRemove.remove();
    }
    var anchorIdx = -1;
    for (var j = 0; j < newRows.length; j++) {
      if (newRows[j].id === nodeId) {
        anchorIdx = j;
        break;
      }
    }
    if (anchorIdx === -1) {
      updateTreeRows(containerId, newRows);
      return;
    }
    var frag = document.createDocumentFragment();
    for (var i = anchorIdx + 1; i < newRows.length; i++) {
      var row = newRows[i];
      if ((row.depth != null ? row.depth : 0) <= anchorDepth) break;
      frag.appendChild(createRow(row));
    }
    anchor.after(frag);
    container._vtRows = newRows;
  }

  function flattenTree(node, expandedIds, depth) {
    var d = depth != null ? depth : 0;
    var rows = [{ id: node.id, node: node, depth: d }];
    if (expandedIds.has(node.id) && Array.isArray(node.children)) {
      for (var c = 0; c < node.children.length; c++) {
        var sub = flattenTree(node.children[c], expandedIds, d + 1);
        for (var s = 0; s < sub.length; s++) rows.push(sub[s]);
      }
    }
    return rows;
  }

  if (typeof window !== 'undefined') {
    window.VDataPropTreePerf = {
      ROW_HEIGHT_PX: ROW_HEIGHT_PX,
      CHUNK_SIZE: CHUNK_SIZE,
      initPropTreeLazy: initPropTreeLazy,
      renderTreeVirtual: renderTreeVirtual,
      updateTreeRows: updateTreeRows,
      debouncedRender: debouncedRender,
      patchTreeNode: patchTreeNode,
      flattenTree: flattenTree,
      appendRowsIncremental: appendRowsIncremental
    };
  }
})();
