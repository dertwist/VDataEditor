/**
 * Tabulator custom editor for property key rename — schema suggestions (VDataSuggestions).
 */
(function () {
  'use strict';

  function parentPathFromRowPath(p) {
    if (!p) return '';
    const idx = p.lastIndexOf('/');
    return idx < 0 ? '' : p.slice(0, idx);
  }

  function getValueAtPath(root, pathStr) {
    if (!pathStr) return root;
    const parts = pathStr.split('/');
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (cur == null) return undefined;
      const m = /^\[(\d+)\]$/.exec(part);
      if (m) cur = cur[parseInt(m[1], 10)];
      else cur = cur[part];
    }
    return cur;
  }

  function siblingKeysForPropPath(propPath) {
    const d = typeof docManager !== 'undefined' ? docManager.activeDoc : null;
    const root = d && d.root;
    if (!root) return [];
    const pp = parentPathFromRowPath(propPath);
    const parent = pp ? getValueAtPath(root, pp) : root;
    if (Array.isArray(parent)) {
      const out = [];
      for (let i = 0; i < parent.length; i++) out.push('[' + i + ']');
      return out;
    }
    if (parent && typeof parent === 'object') return Object.keys(parent);
    return [];
  }

  function buildKeySuggestionContext(propPath) {
    const d = typeof docManager !== 'undefined' ? docManager.activeDoc : null;
    let base = { modeId: 'generic', fileExt: '', genericDataType: '' };
    if (d && window.VDataEditorModes && typeof window.VDataEditorModes.getSuggestionContext === 'function') {
      base = window.VDataEditorModes.getSuggestionContext(d.fileName || '', d.root);
    } else if (d) {
      const fn = d.fileName || '';
      const m = /\.([a-z0-9]+)$/i.exec(fn);
      base = {
        modeId: 'generic',
        fileExt: m ? m[1].toLowerCase() : '',
        genericDataType: d.root && d.root.generic_data_type ? d.root.generic_data_type : ''
      };
    }
    const pp = parentPathFromRowPath(propPath);
    const parentKey = pp ? pp.slice(pp.lastIndexOf('/') + 1) : '';
    return Object.assign({}, base, {
      parentKey: parentKey,
      siblingKeys: siblingKeysForPropPath(propPath)
    });
  }

  function keyEditor(cell, onRendered, success, cancel) {
    const currentKey = cell.getValue();
    const rowData = cell.getRow().getData();
    const propPath = rowData.propPath || '';

    const wrap = document.createElement('div');
    wrap.className = 'pt-key-editor';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentKey;
    input.className = 'pt-key-input';
    wrap.appendChild(input);

    const dropdown = document.createElement('ul');
    dropdown.className = 'pt-suggestions';
    wrap.appendChild(dropdown);

    const ctx = buildKeySuggestionContext(propPath);

    function refreshSuggestions(filter) {
      const allKeys =
        window.VDataSuggestions && typeof window.VDataSuggestions.getSuggestedKeys === 'function'
          ? window.VDataSuggestions.getSuggestedKeys(ctx)
          : [];
      const f = (filter || '').toLowerCase();
      const filtered = f ? allKeys.filter(function (k) { return k.toLowerCase().indexOf(f) >= 0; }) : allKeys;

      dropdown.innerHTML = '';
      const show = filtered.slice(0, 30);
      dropdown.style.display = show.length ? 'block' : 'none';

      for (let i = 0; i < show.length; i++) {
        const k = show[i];
        const li = document.createElement('li');
        li.className = 'pt-suggestion-item';
        li.setAttribute('tabindex', '-1');
        const sk = document.createElement('span');
        sk.className = 'pt-sug-key';
        sk.textContent = k;
        li.appendChild(sk);
        if (window.VDataSuggestions && typeof window.VDataSuggestions.getWidgetType === 'function') {
          const def = window.VDataSuggestions.getWidgetType(k, ctx);
          if (def) {
            const st = document.createElement('span');
            st.className = 'pt-sug-type';
            st.textContent = def;
            li.appendChild(st);
          }
        }
        li.addEventListener('mousedown', function (e) {
          e.preventDefault();
          success(k);
        });
        dropdown.appendChild(li);
      }
    }

    let blurTimer = null;
    function clearBlurTimer() {
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
    }

    onRendered(function () {
      input.focus();
      input.select();
      refreshSuggestions('');
    });

    input.addEventListener('input', function () {
      refreshSuggestions(input.value);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearBlurTimer();
        success(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearBlurTimer();
        cancel();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const first = dropdown.querySelector('.pt-suggestion-item');
        if (first) first.focus();
      }
    });

    dropdown.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [].slice.call(dropdown.querySelectorAll('.pt-suggestion-item'));
        const ix = items.indexOf(document.activeElement);
        if (ix < 0) return;
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? Math.min(ix + 1, items.length - 1) : Math.max(ix - 1, 0);
        items[next].focus();
      } else if (e.key === 'Enter') {
        const el = document.activeElement;
        if (el && el.classList.contains('pt-suggestion-item')) {
          e.preventDefault();
          success(el.querySelector('.pt-sug-key').textContent);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });

    input.addEventListener('blur', function () {
      blurTimer = setTimeout(function () {
        cancel();
      }, 120);
    });

    wrap.addEventListener('mousedown', function () {
      clearBlurTimer();
    });

    return wrap;
  }

  if (typeof window !== 'undefined') window.VDataKeyEditor = { keyEditor: keyEditor };
})();
