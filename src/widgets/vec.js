function buildVec3Widget(container, value, onChange, sliderOpts) {
  const v = Array.isArray(value) ? [...value] : [0, 0, 0];
  const wrapAll = document.createElement('div');
  wrapAll.className = 'vec-widget vec-widget-3d';
  ['X', 'Y', 'Z'].forEach((axis, i) => {
    const row = document.createElement('div');
    row.className = 'vec-axis-row vec3-axis-row';
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge vec-axis-label';
    lbl.textContent = axis;
    const wrap = buildSliderInput(v[i], 'float', (nv) => {
      v[i] = nv;
      onChange([...v]);
    }, sliderOpts);
    wrap.classList.add('vec-axis-control');
    row.appendChild(lbl);
    row.appendChild(wrap);
    wrapAll.appendChild(row);
  });
  container.appendChild(wrapAll);
}

function buildVec2Widget(container, value, onChange, sliderOpts) {
  const v = Array.isArray(value) ? [...value] : [0, 0];
  const wrapAll = document.createElement('div');
  wrapAll.className = 'vec-widget vec-widget-2d';
  ['X', 'Y'].forEach((axis, i) => {
    const row = document.createElement('div');
    row.className = 'vec-axis-row vec2-axis-row';
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge vec-axis-label';
    lbl.textContent = axis;
    const wrap = buildSliderInput(v[i], 'float', (nv) => {
      v[i] = nv;
      onChange([...v]);
    }, sliderOpts);
    wrap.classList.add('vec-axis-control');
    row.appendChild(lbl);
    row.appendChild(wrap);
    wrapAll.appendChild(row);
  });
  container.appendChild(wrapAll);
}

function buildVec4Widget(container, value, onChange, sliderOpts) {
  const v = Array.isArray(value) ? [...value] : [0, 0, 0, 0];
  const wrapAll = document.createElement('div');
  wrapAll.className = 'vec-widget vec-widget-4d';
  ['X', 'Y', 'Z', 'W'].forEach((axis, i) => {
    const row = document.createElement('div');
    row.className = 'vec-axis-row vec4-axis-row';
    const lbl = document.createElement('span');
    lbl.className = 'prop-type-badge vec-axis-label';
    lbl.textContent = axis;
    const wrap = buildSliderInput(v[i], 'float', (nv) => {
      v[i] = nv;
      onChange([...v]);
    }, sliderOpts);
    wrap.classList.add('vec-axis-control');
    row.appendChild(lbl);
    row.appendChild(wrap);
    wrapAll.appendChild(row);
  });
  container.appendChild(wrapAll);
}
