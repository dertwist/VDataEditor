/** Paired numeric controls (range + manual input). Both stay synchronized. opts.clamp01 clamps to [0,1]. */
function buildSliderInput(value, type, onChange, opts) {
  opts = opts || {};
  const clamp01 = !!opts.clamp01;
  const isFloat = type === 'float' || clamp01;
  const step = type === 'int' ? 1 : 0.01;
  function parseNumeric(raw) {
    if (typeof raw === 'number') return raw;
    if (typeof raw !== 'string') return Number(raw);
    const s = raw.trim();
    if (!s) return NaN;
    const token = s.match(/[-+]?(?:\d+([.,]\d*)?|[.,]\d+)(?:[eE][-+]?\d+)?/);
    if (!token) return NaN;
    const normalized = token[0].replace(',', '.');
    return Number(normalized);
  }

  const initial = isFloat ? parseNumeric(value) : parseInt(parseNumeric(value), 10);
  let current = Number.isFinite(initial) ? initial : 0;
  if (!isFloat) current = Math.round(current);
  if (clamp01) current = Math.max(0, Math.min(1, current));

  const wrap = document.createElement('div');
  wrap.className = 'slider-input-wrap' + (clamp01 ? ' float-slider-01' : '');

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'slider-range';
  slider.step = String(step);
  slider.setAttribute('aria-label', 'Value slider');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'prop-input slider-input';
  input.setAttribute('inputmode', isFloat ? 'decimal' : 'numeric');
  input.setAttribute('aria-label', 'Numeric value');

  let scrubActive = false;
  function handleGlobalScrubEnd() {
    endScrub();
    window.removeEventListener('pointerup', handleGlobalScrubEnd, true);
    window.removeEventListener('mouseup', handleGlobalScrubEnd, true);
    window.removeEventListener('touchend', handleGlobalScrubEnd, true);
    window.removeEventListener('blur', handleGlobalScrubEnd, true);
  }

  function startScrub() {
    if (scrubActive) return;
    scrubActive = true;
    if (typeof opts.onScrubStart === 'function') opts.onScrubStart();
    window.addEventListener('pointerup', handleGlobalScrubEnd, true);
    window.addEventListener('mouseup', handleGlobalScrubEnd, true);
    window.addEventListener('touchend', handleGlobalScrubEnd, true);
    window.addEventListener('blur', handleGlobalScrubEnd, true);
  }
  function endScrub() {
    if (!scrubActive) return;
    scrubActive = false;
    if (typeof opts.onScrubEnd === 'function') opts.onScrubEnd(current);
  }

  function ensureSliderBounds(v) {
    if (clamp01) {
      slider.min = '0';
      slider.max = '1';
      return;
    }
    const abs = Math.max(1, Math.abs(Number(v) || 0));
    const span = Math.max(10, Math.ceil(abs * 1.25));
    slider.min = String(-span);
    slider.max = String(span);
  }

  function syncUi(v) {
    current = v;
    ensureSliderBounds(v);
    slider.value = String(v);
    input.value = isFloat ? parseFloat(Number(v).toFixed(6)).toString() : String(Math.round(v));
  }

  function normalize(v) {
    let nv = parseNumeric(v);
    if (!Number.isFinite(nv)) return null;
    if (!isFloat) nv = Math.round(nv);
    if (clamp01) nv = Math.max(0, Math.min(1, nv));
    return nv;
  }

  syncUi(current);
  wrap.appendChild(input);
  wrap.appendChild(slider);

  slider.addEventListener('pointerdown', startScrub);
  slider.addEventListener('mousedown', startScrub);
  slider.addEventListener('touchstart', startScrub, { passive: true });
  slider.addEventListener('change', endScrub);
  slider.addEventListener('pointerup', endScrub);
  slider.addEventListener('mouseup', endScrub);
  slider.addEventListener('touchend', endScrub, { passive: true });
  slider.addEventListener('input', () => {
    // Some platforms fire slider input without a reliable pointerdown.
    // Ensure scrub mode is active so undo batches the whole drag.
    if (!scrubActive) startScrub();
    const nv = normalize(slider.value);
    if (nv == null) return;
    syncUi(nv);
    onChange(nv);
  });

  function commitNumberInput() {
    const nv = normalize(input.value);
    if (nv == null) {
      syncUi(current);
      return;
    }
    syncUi(nv);
    onChange(nv);
  }

  input.addEventListener('input', () => {
    const nv = normalize(input.value);
    if (nv == null) return;
    syncUi(nv);
    onChange(nv);
  });
  input.addEventListener('change', commitNumberInput);
  input.addEventListener('blur', commitNumberInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitNumberInput();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      syncUi(current);
      input.blur();
    }
  });

  return wrap;
}

function buildNumberWidget(container, value, type, onChange) {
  container.appendChild(buildSliderInput(value, type, onChange));
}
