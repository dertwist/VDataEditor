function buildVec3Widget(container, value, onChange) {
  const v = Array.isArray(value) ? [...value] : [0, 0, 0];
  ['X', 'Y', 'Z'].forEach((axis, i) => {
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge';
    lbl.textContent = axis;
    const wrap = buildSliderInput(v[i], 'float', (nv) => {
      v[i] = nv;
      onChange([...v]);
    });
    wrap.style.flex = '1';
    wrap.style.minWidth = '48px';
    container.appendChild(lbl);
    container.appendChild(wrap);
  });
}

function buildVec2Widget(container, value, onChange) {
  const v = Array.isArray(value) ? [...value] : [0, 0];
  ['X', 'Y'].forEach((axis, i) => {
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge';
    lbl.textContent = axis;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'prop-input';
    inp.style.width = '62px';
    inp.style.flex = 'none';
    inp.step = 'any';
    inp.value = String(v[i]);
    inp.addEventListener('change', () => {
      v[i] = parseFloat(inp.value) || 0;
      onChange([...v]);
    });
    container.appendChild(lbl);
    container.appendChild(inp);
  });
}

function buildVec4Widget(container, value, onChange) {
  const v = Array.isArray(value) ? [...value] : [0, 0, 0, 0];
  ['X', 'Y', 'Z', 'W'].forEach((axis, i) => {
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge';
    lbl.textContent = axis;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'prop-input';
    inp.style.width = '55px';
    inp.style.flex = 'none';
    inp.step = 'any';
    inp.value = String(v[i]);
    inp.addEventListener('change', () => {
      v[i] = parseFloat(inp.value) || 0;
      onChange([...v]);
    });
    container.appendChild(lbl);
    container.appendChild(inp);
  });
