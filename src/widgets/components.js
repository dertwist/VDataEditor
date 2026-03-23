function buildComponentsWidget(arr, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'components-widget';
  const labels = ['X', 'Y', 'Z'];
  const axes = ['x', 'y', 'z'];
  const list = Array.isArray(arr) && arr.length === 3 ? arr : [0, 0, 0];

  list.forEach((item, i) => {
    const isExpr =
      item !== null && typeof item === 'object' && !Array.isArray(item) && Object.prototype.hasOwnProperty.call(item, 'm_Expression');

    const cell = document.createElement('div');
    cell.className = 'components-cell';

    const lbl = document.createElement('span');
    lbl.className = 'components-label components-label-' + axes[i];
    lbl.textContent = labels[i];

    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'btn btn-sm btn-icon components-mode-btn';
    modeBtn.title = isExpr ? 'Expression — click for literal' : 'Literal — click for expression';
    modeBtn.innerHTML = isExpr ? ICONS.bracesCurly : ICONS.typeFloat;
    modeBtn.setAttribute('data-mode', isExpr ? 'expr' : 'literal');

    let inputEl;
    if (isExpr) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'prop-input components-expr-input';
      inp.value = item.m_Expression ?? '';
      inp.placeholder = 'expression…';
      inp.addEventListener('change', () => {
        const newArr = [...list];
        newArr[i] = { m_Expression: inp.value };
        onChange(newArr);
      });
      inputEl = inp;
    } else {
      const num = typeof item === 'number' ? item : parseFloat(item) || 0;
      inputEl = buildSliderInput(num, 'float', (v) => {
        const newArr = [...list];
        newArr[i] = v;
        onChange(newArr);
      });
    }

    modeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newArr = [...list];
      if (modeBtn.getAttribute('data-mode') === 'literal') {
        newArr[i] = { m_Expression: '' };
      } else {
        newArr[i] = 0;
      }
      onChange(newArr);
    });

    cell.appendChild(lbl);
    cell.appendChild(modeBtn);
    cell.appendChild(inputEl);
    wrap.appendChild(cell);
  });

  return wrap;
}
