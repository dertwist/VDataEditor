(function (root) {
  const STORAGE_KEY = 'vdata_app_theme_v1';
  const VALID = new Set(['auto', 'dark', 'light']);

  let _pref = 'dark';
  let _mq;

  function getAppThemePreference() {
    return _pref;
  }

  function _effectiveTheme() {
    if (_pref === 'auto' && root.matchMedia) {
      return root.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return _pref === 'light' ? 'light' : 'dark';
  }

  function _applyResolved() {
    const eff = _effectiveTheme();
    document.documentElement.setAttribute('data-theme', eff);
    if (typeof syncManualEditorTheme === 'function') syncManualEditorTheme();
  }

  function setAppThemePreference(pref) {
    if (!VALID.has(pref)) return;
    _pref = pref;
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch (_) {}
    _applyResolved();
    refreshThemeMenuMarks();
  }

  function loadPreference() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s && VALID.has(s)) _pref = s;
    } catch (_) {}
  }

  function refreshThemeMenuMarks() {
    document.querySelectorAll('.menu-dropdown-item[data-theme-pref]').forEach((row) => {
      const v = row.getAttribute('data-theme-pref');
      const mark = row.querySelector('.menu-theme-mark');
      if (mark) mark.textContent = v === _pref ? '\u2713' : '';
    });
  }

  function initAppTheme() {
    loadPreference();
    _applyResolved();
    refreshThemeMenuMarks();
    if (root.matchMedia) {
      _mq = root.matchMedia('(prefers-color-scheme: dark)');
      _mq.addEventListener('change', () => {
        if (_pref === 'auto') _applyResolved();
      });
    }
  }

  root.initAppTheme = initAppTheme;
  root.setAppThemePreference = setAppThemePreference;
  root.getAppThemePreference = getAppThemePreference;
  root.refreshThemeMenuMarks = refreshThemeMenuMarks;
})(typeof window !== 'undefined' ? window : globalThis);
