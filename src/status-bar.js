const STATUS_STATES = {
  saved: { icon: '✓', cls: 'status-saved', flash: true },
  created: { icon: '+', cls: 'status-created', flash: false },
  edited: { icon: '●', cls: 'status-edited', flash: false },
  error: { icon: '✕', cls: 'status-error', flash: false },
  info: { icon: '', cls: '', flash: false }
};

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

function updateStatusBar() {
  const d = docManager.activeDoc;
  if (!d || !d.root) {
    setStatus('No document', 'info');
    return;
  }
  const elCount = countNodes(d.root.m_Children);
  const varCount = (d.root.m_Variables && d.root.m_Variables.length) || 0;
  setStatus(`Elements: ${elCount} | Variables: ${varCount}`, 'info');
}

function countNodes(arr) {
  let c = 0;
  if (!arr) return 0;
  arr.forEach((n) => {
    c++;
    if (n.m_Children) c += countNodes(n.m_Children);
    if (n.m_Modifiers) c += n.m_Modifiers.length;
    if (n.m_SelectionCriteria) c += n.m_SelectionCriteria.length;
  });
  return c;
}
