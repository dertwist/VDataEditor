function buildEnumWidget(container, value, onChange, options) {
  const opts = options || {};
  const raw = Array.isArray(opts.enumValues) ? opts.enumValues : [];
  const values = raw.map((v) => String(v));
  const sel = document.createElement('select');
  sel.className = 'prop-input prop-enum-select';
  const cur = value == null ? '' : String(value);
  const seen = new Set();
  for (let i = 0; i < values.length; i++) {
    const s = values[i];
    if (seen.has(s)) continue;
    seen.add(s);
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  }
  if (!seen.has(cur) && cur !== '') {
    const opt = document.createElement('option');
    opt.value = cur;
    opt.textContent = cur + ' (not in schema)';
    sel.appendChild(opt);
  }
  sel.value = cur;
  sel.addEventListener('change', () => onChange(sel.value));
  container.appendChild(sel);
}
