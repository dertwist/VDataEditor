const STATUS_STATES = {
  saved: { icon: '✓', cls: 'status-saved', flash: true },
  created: { icon: '+', cls: 'status-created', flash: false },
  edited: { icon: '●', cls: 'status-edited', flash: false },
  error: { icon: '✕', cls: 'status-error', flash: false },
  info: { icon: '', cls: '', flash: false }
};

/** Thin progress row for long-running tasks (e.g. schema download). */
function setSchemaProgress(visible, percent, label) {
  const wrap = document.getElementById('schemaProgressWrap');
  const bar = document.getElementById('schemaProgressBar');
  const lbl = document.getElementById('schemaProgressLabel');
  if (!wrap || !bar) return;
  const show = !!visible;
  wrap.hidden = !show;
  wrap.classList.toggle('schema-progress-wrap--active', show);
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  bar.style.width = p + '%';
  if (lbl) lbl.textContent = label != null ? String(label) : '';
  if (!show) bar.style.width = '0%';
}

function setStatus(msg, state = 'info') {
  const bar = document.getElementById('statusBar');
  if (!bar) return;

  const icon = document.getElementById('statusIcon');
  const msgEl = document.getElementById('statusMsg');

  bar.classList.remove('status-saved', 'status-created', 'status-edited', 'status-error', 'status-flash');

  const s = STATUS_STATES[state] ?? STATUS_STATES.info;
  if (s.cls) bar.classList.add(s.cls);
  if (icon) icon.textContent = s.icon;
  if (msgEl) msgEl.textContent = msg;

  if (s.flash) {
    void bar.offsetWidth;
    bar.classList.add('status-flash');
  }
}

/**
 * Wait until status text has had a chance to paint (double rAF + microtask).
 * Use after setStatus() before long synchronous work (e.g. parsing a large file).
 */
function flushStatusToDom() {
  return new Promise(function (resolve) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        queueMicrotask(resolve);
      });
    });
  });
}
if (typeof window !== 'undefined') {
  window.flushStatusToDom = flushStatusToDom;
}

function updateStatusBar() {
  const d = docManager.activeDoc;
  if (!d || !d.root) {
    setStatus('No document', 'info');
    return;
  }
  const stats = collectDocStats(d.root);
  const bytes = computeDocSizeBytes(d);
  setStatus(
    `Properties: ${stats.properties} | Sets: ${stats.sets} | Objects: ${stats.objects} | Size: ${formatBytes(bytes)}`,
    'info'
  );
}

function collectDocStats(root) {
  const seen = new WeakSet();
  const stats = { properties: 0, sets: 0, objects: 0 };

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      stats.sets++;
      for (let i = 0; i < node.length; i++) walk(node[i]);
      return;
    }

    stats.objects++;
    const keys = Object.keys(node);
    stats.properties += keys.length;
    for (let i = 0; i < keys.length; i++) walk(node[keys[i]]);
  }

  walk(root);
  return stats;
}

function computeDocSizeBytes(doc) {
  try {
    const serialized = typeof doc.serialize === 'function' ? doc.serialize() : JSON.stringify(doc.root || {});
    return new TextEncoder().encode(serialized || '').length;
  } catch (_) {
    return 0;
  }
}

function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(2) + ' MB';
}
