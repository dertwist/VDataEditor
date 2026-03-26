function parseBitmaskValue(s) {
  if (s == null || s === '') return new Set();
  return new Set(
    String(s)
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

function formatBitmaskValue(schemaOrder, selected) {
  const order = Array.isArray(schemaOrder) ? schemaOrder : [];
  const inOrder = [];
  const seen = new Set();
  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    if (selected.has(name) && !seen.has(name)) {
      seen.add(name);
      inOrder.push(name);
    }
  }
  const unknown = [];
  selected.forEach((name) => {
    if (!seen.has(name)) unknown.push(name);
  });
  unknown.sort();
  return inOrder.concat(unknown).join(' | ');
}

/**
 * @param {HTMLElement} container
 * @param {string|null|undefined} value
 * @param {(s: string) => void} onChange
 * @param {{ enumValues?: string[] }} options
 */
function buildBitmaskEnumWidget(container, value, onChange, options) {
  const opts = options || {};
  const raw = Array.isArray(opts.enumValues) ? opts.enumValues : [];
  const order = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const s = String(raw[i]);
    if (seen.has(s)) continue;
    seen.add(s);
    order.push(s);
  }

  let selected = parseBitmaskValue(value);
  const wrap = document.createElement('div');
  wrap.className = 'prop-bitmask-enum';

  const emit = () => {
    onChange(formatBitmaskValue(order, selected));
  };

  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    const row = document.createElement('label');
    row.className = 'prop-bitmask-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(name);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(name);
      else selected.delete(name);
      emit();
    });
    row.appendChild(cb);
    const span = document.createElement('span');
    span.textContent = name;
    row.appendChild(span);
    wrap.appendChild(row);
  }

  container.appendChild(wrap);
}
