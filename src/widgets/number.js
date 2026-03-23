/** Scrub slider for int/float. Drag scrubs; Shift+click or double-click input edits text. opts.clamp01 clamps to [0,1]. */
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

  input.title = clamp01
    ? 'Drag to adjust (0..1). Shift+click to edit text.'
    : 'Drag to adjust. Shift+click to edit text.';
  input.setAttribute('aria-label', 'Slider value');
  input.autocomplete = 'off';

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
  let lastScrubVal = parseFloat(input.value) || 0;

  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // Normal drag (no Shift) scrubs the value.
    // Shift+click or double-click on the input lets the user edit the number as text.
    if (e.target === input && (e.shiftKey || e.detail === 2)) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof opts.onScrubStart === 'function') opts.onScrubStart();
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
      lastScrubVal = newVal;
      onChange(newVal);
    }
    function onUp() {
      if (typeof opts.onScrubEnd === 'function') opts.onScrubEnd(lastScrubVal);
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

  input.addEventListener('dblclick', (e) => {
    // Ensure text caret is visible/active immediately.
    e.stopPropagation();
    input.focus();
    input.select();
  });

  input.addEventListener('keydown', (e) => {
    // Basic keyboard accessibility: ArrowLeft/ArrowRight scrub values.
    // Shift is reserved for "text edit" mode, so we don't override caret movement.
    if (e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();

    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const startVal = parseFloat(input.value);
    const base = Number.isFinite(startVal) ? startVal : 0;
    const delta = dir * STEP;

    let newVal = base + delta;
    if (type === 'int') newVal = Math.round(newVal);
    else newVal = parseFloat(newVal.toFixed(6));
    if (clamp01) newVal = Math.max(0, Math.min(1, newVal));

    input.value = type === 'int' ? String(newVal) : newVal.toFixed(4);
    updateTrack(newVal);
    onChange(newVal);
  });

  return wrap;
}

function buildNumberWidget(container, value, type, onChange) {
  container.appendChild(buildSliderInput(value, type, onChange));
}
