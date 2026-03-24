/** Paired numeric controls (range + manual input). Both stay synchronized. opts.clamp01 clamps to [0,1]. */
function buildSliderInput(value, type, onChange, opts) {
  opts = opts || {};
  const clamp01 = !!opts.clamp01;
  const isFloat = type === 'float' || clamp01;
  const step = type === 'int' ? 1 : 0.01;
  /** Without a cap, half = |v|*10+10 grows each time you scrub to the edge (1→20→210→…), so values explode. */
  const sliderHalfLimit = type === 'int' ? 10_000_000 : 1_000_000;
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
  /** Slider min/max are derived from this; updated only on manual text edits / init, not while scrubbing. */
  let rangeAnchor = current;

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

  function ensureSliderBounds() {
    if (clamp01) {
      slider.min = '0';
      slider.max = '1';
      return;
    }
    const av = Number.isFinite(rangeAnchor) ? rangeAnchor : 0;
    const mag = Math.abs(av);
    /** Symmetric window: e.g. value 1 → half-range 20 → [-20, 20], capped so scrubbing cannot blow up magnitude. */
    let half = Math.min(mag * 10 + 10, sliderHalfLimit);
    if (mag > half) half = sliderHalfLimit;
    let minB = -half;
    let maxB = half;
    if (type === 'int') {
      minB = Math.floor(minB);
      maxB = Math.ceil(maxB);
    }
    slider.min = String(minB);
    slider.max = String(maxB);
  }

  function syncUi(v, fromSlider) {
    const scrub = fromSlider === true;
    current = v;
    if (!scrub) {
      rangeAnchor = v;
    }
    ensureSliderBounds();
    let sv = v;
    if (clamp01) {
      sv = Math.max(0, Math.min(1, v));
    } else {
      const minN = Number(slider.min);
      const maxN = Number(slider.max);
      if (Number.isFinite(minN) && Number.isFinite(maxN)) {
        sv = Math.max(minN, Math.min(maxN, v));
      }
    }
    slider.value = String(sv);
    input.value = isFloat ? parseFloat(Number(v).toFixed(6)).toString() : String(Math.round(v));
  }

  function normalize(v) {
    let nv = parseNumeric(v);
    if (!Number.isFinite(nv)) return null;
    if (!isFloat) nv = Math.round(nv);
    if (clamp01) nv = Math.max(0, Math.min(1, nv));
    return nv;
  }

  syncUi(current, false);
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
    syncUi(nv, true);
    onChange(nv);
  });

  function commitNumberInput() {
    const nv = normalize(input.value);
    if (nv == null) {
      syncUi(current, false);
      return;
    }
    syncUi(nv, false);
    onChange(nv);
  }

  input.addEventListener('input', () => {
    const nv = normalize(input.value);
    if (nv == null) return;
    syncUi(nv, false);
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
      syncUi(current, false);
      input.blur();
    }
  });

  return wrap;
}

function buildNumberWidget(container, value, type, onChange) {
  container.appendChild(buildSliderInput(value, type, onChange));
}
