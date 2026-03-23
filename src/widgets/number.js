/** Scrub slider for int/float (Shift+click input for plain edit). opts.clamp01 clamps to [0,1]. */
function buildSliderInput(value, type, onChange, opts) {
  opts = opts || {};
  const clamp01 = !!opts.clamp01;
  const wrap = document.createElement('div');
  wrap.className = 'slider-input-wrap' + (clamp01 ? ' float-slider-01' : '');

  const track = document.createElement('div');
  track.className = 'slider-track';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'prop-input slider-input';
  input.value =
    type === 'float' || clamp01
      ? String(Number(value).toFixed(4)).replace(/\.?0+$/, '')
      : String(value);

  function updateTrack(v) {
    let pct = 0;
    if (clamp01) {
      const n = Math.max(0, Math.min(1, Number(v)));
      pct = n * 100;
    } else {
      const nv = Number(v);
      if (!Number.isFinite(nv)) pct = 0;
      else pct = Math.min(100, (Math.abs(nv) / (Math.abs(nv) + 100)) * 100);
    }
    track.style.width = pct + '%';
  }
  updateTrack(parseFloat(input.value) || 0);

  wrap.appendChild(track);
  wrap.appendChild(input);

  const STEP = type === 'int' ? 1 : 0.01;

  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target === input && !e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startVal = parseFloat(input.value);
    const base = Number.isFinite(startVal) ? startVal : 0;

    function onMove(e2) {
      const dx = e2.clientX - startX;
      const delta = dx * STEP;
      let newVal = base + delta;
      if (type === 'int') newVal = Math.round(newVal);
      else newVal = parseFloat(newVal.toFixed(6));
      if (clamp01) newVal = Math.max(0, Math.min(1, newVal));
      input.value = type === 'int' ? String(newVal) : newVal.toFixed(4);
      updateTrack(newVal);
      onChange(newVal);
    }
    function onUp() {
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.body.style.cursor = 'ew-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  input.addEventListener('change', () => {
    const v = type === 'int' ? parseInt(input.value, 10) : parseFloat(input.value);
    if (!Number.isNaN(v)) {
      let nv = v;
      if (clamp01) nv = Math.max(0, Math.min(1, nv));
      updateTrack(nv);
      onChange(nv);
    }
  });

  return wrap;
}

function buildNumberWidget(container, value, type, onChange) {
  container.appendChild(buildSliderInput(value, type, onChange));
}
