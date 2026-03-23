/** Scrub slider for int/float. Drag scrubs (movementX / pointer lock); double-click or focused click edits text. opts.clamp01 clamps to [0,1]. */
function buildSliderInput(value, type, onChange, opts) {
  opts = opts || {};
  const clamp01 = !!opts.clamp01;
  const isFloat = type === 'float' || clamp01;
  const STEP_BASE = type === 'int' ? 1 : 0.01;

  const wrap = document.createElement('div');
  wrap.className = 'slider-input-wrap' + (clamp01 ? ' float-slider-01' : '');

  const track = document.createElement('div');
  track.className = 'slider-track';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'prop-input slider-input';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Numeric value — drag to scrub, double-click to type');

  function fmt(v) {
    if (!isFloat) return String(Math.round(v));
    return parseFloat(Number(v).toFixed(6)).toString();
  }

  function updateDisplay(v) {
    input.value = fmt(v);
    if (clamp01) {
      track.style.width = Math.max(0, Math.min(1, Number(v))) * 100 + '%';
    } else {
      const nv = Number(v);
      const pct = Number.isFinite(nv) ? (Math.atan(Math.abs(nv) / 10) / (Math.PI / 2)) * 100 : 0;
      track.style.width = Math.min(100, pct) + '%';
    }
  }

  let _currentVal = isFloat
    ? typeof value === 'number'
      ? value
      : parseFloat(value) || 0
    : typeof value === 'number'
      ? Math.round(value)
      : parseInt(value, 10) || 0;
  updateDisplay(_currentVal);

  wrap.appendChild(track);
  wrap.appendChild(input);

  let _scrubbing = false;
  let _scrubAccum = 0;
  let _scrubBase = 0;
  let _tooltip = null;

  function _createTooltip(x, y) {
    _tooltip = document.createElement('div');
    _tooltip.className = 'slider-scrub-tooltip';
    _tooltip.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:9999',
      'background:var(--bg-surface,#1e1e2e)',
      'color:var(--text-primary,#cdd6f4)',
      'border:1px solid var(--border-subtle,#45475a)',
      'border-radius:4px',
      'padding:2px 8px',
      'font-size:11px',
      'font-family:var(--font-mono,monospace)',
      'white-space:nowrap',
      'box-shadow:0 2px 8px rgba(0,0,0,.4)',
      'transform:translate(-50%,-140%)'
    ].join(';');
    _tooltip.textContent = fmt(_currentVal);
    document.body.appendChild(_tooltip);
    _moveTooltip(x, y);
  }

  function _moveTooltip(x, y) {
    if (!_tooltip) return;
    _tooltip.style.left = x + 'px';
    _tooltip.style.top = y + 'px';
  }

  function _removeTooltip() {
    if (_tooltip) {
      _tooltip.remove();
      _tooltip = null;
    }
  }

  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.detail >= 2) {
      input.focus();
      input.select();
      return;
    }
    if (e.target === input && input === document.activeElement) return;

    e.preventDefault();
    e.stopPropagation();

    if (typeof opts.onScrubStart === 'function') opts.onScrubStart();

    _scrubbing = true;
    _scrubAccum = 0;
    _scrubBase = _currentVal;
    _createTooltip(e.clientX, e.clientY);

    const canLock = typeof wrap.requestPointerLock === 'function';
    if (canLock) {
      try {
        wrap.requestPointerLock();
      } catch (_) {}
    }

    let lastClientX = e.clientX;

    function onMove(e2) {
      let dx;
      if (document.pointerLockElement === wrap) {
        dx = typeof e2.movementX === 'number' ? e2.movementX : e2.clientX - lastClientX;
        if (typeof e2.movementX !== 'number') lastClientX = e2.clientX;
      } else {
        dx = e2.clientX - lastClientX;
        lastClientX = e2.clientX;
      }
      const speed = e2.ctrlKey ? 0.1 : e2.shiftKey ? 10 : 1;
      _scrubAccum += dx * STEP_BASE * speed;
      let nv = _scrubBase + _scrubAccum;
      if (!isFloat) nv = Math.round(nv);
      else nv = parseFloat(nv.toFixed(6));
      if (clamp01) nv = Math.max(0, Math.min(1, nv));
      _currentVal = nv;
      updateDisplay(nv);
      if (_tooltip) {
        _tooltip.textContent = fmt(nv);
        if (!canLock || document.pointerLockElement !== wrap) {
          _moveTooltip(e2.clientX, e2.clientY);
        } else {
          const r = wrap.getBoundingClientRect();
          _moveTooltip(r.left + r.width / 2, r.top);
        }
      }
      onChange(nv);
    }

    function onUp() {
      if (!_scrubbing) return;
      _scrubbing = false;
      if (canLock && document.pointerLockElement === wrap) {
        try {
          document.exitPointerLock();
        } catch (_) {}
      }
      document.body.style.cursor = '';
      _removeTooltip();
      if (typeof opts.onScrubEnd === 'function') opts.onScrubEnd(_currentVal);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.body.style.cursor = 'ew-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', () => updateDisplay(_currentVal));

  function commitText() {
    const raw = input.value.trim();
    const parsed = isFloat ? parseFloat(raw) : parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      updateDisplay(_currentVal);
      return;
    }
    let nv = parsed;
    if (clamp01) nv = Math.max(0, Math.min(1, nv));
    _currentVal = nv;
    updateDisplay(nv);
    onChange(nv);
  }

  input.addEventListener('change', commitText);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitText();
      input.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      updateDisplay(_currentVal);
      input.blur();
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      const step = e.shiftKey ? STEP_BASE * 10 : e.ctrlKey ? STEP_BASE * 0.1 : STEP_BASE;
      let nv = _currentVal + dir * step;
      if (!isFloat) nv = Math.round(nv);
      if (clamp01) nv = Math.max(0, Math.min(1, nv));
      _currentVal = nv;
      updateDisplay(nv);
      onChange(nv);
    }
  });

  return wrap;
}

function buildNumberWidget(container, value, type, onChange) {
  container.appendChild(buildSliderInput(value, type, onChange));
}
