function typedResourceDisplay(value, kind) {
  if (value && typeof value === 'object' && value.type === kind && typeof value.value === 'string') return value.value;
  if (typeof value === 'string' && value.startsWith(kind + ':"')) {
    const inner = value.slice(kind.length + 2);
    if (inner.endsWith('"')) return inner.slice(0, -1).replace(/\\"/g, '"');
  }
  return typeof value === 'string' ? value : '';
}

function buildResourceWidget(container, value, prefix, onChange) {
  const raw = typedResourceDisplay(value, prefix);
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'prop-input';
  inp.value = raw;
  inp.addEventListener('change', () => {
    onChange({ type: prefix, value: inp.value });
  });

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'prop-resource-btn';
  btn.textContent = prefix === 'soundevent' ? '🔊' : '📁';
  btn.title = prefix === 'soundevent' ? 'Sound event' : 'Resource path';
  btn.addEventListener('click', async () => {
    if (!window.electronAPI?.pickResourceFile) return;
    const doc = typeof docManager !== 'undefined' ? docManager.activeDoc : null;
    const fp = doc?.filePath;
    const baseDir =
      typeof fp === 'string' && fp.length ? fp.replace(/[/\\][^/\\]+$/, '') : undefined;
    const filters =
      prefix === 'soundevent'
        ? [{ name: 'Sound', extensions: ['vsndevts', 'vsndstck', 'wav', 'mp3'] }]
        : [{ name: 'Models / particles / materials', extensions: ['vmdl', 'vpcf', 'vnmskel', 'vmat'] }];
    const rel = await window.electronAPI.pickResourceFile({
      defaultPath: baseDir,
      relativeTo: baseDir,
      filters
    });
    if (rel == null) return;
    inp.value = rel;
    onChange({ type: prefix, value: rel });
  });

  container.appendChild(inp);
  container.appendChild(btn);
