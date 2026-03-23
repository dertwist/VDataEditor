function extIcon(fileName) {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const map = {
    vsmart: ICONS.braces,
    vdata: ICONS.fileCode,
    vpulse: ICONS.zap,
    vsndstck: ICONS.typeSound,
    vsurf: ICONS.grid2x2,
    json: ICONS.bracesCurly
  };
  return map[ext] ?? ICONS.fileCode ?? '';
}

function initTabBar() {
  const bar = document.getElementById('tabBar');
  if (!bar) return;

  function render() {
    bar.innerHTML = '';
    docManager.docs.forEach((doc, i) => {
      const tab = document.createElement('div');
      tab.className = 'tab' + (i === docManager.activeIdx ? ' tab-active' : '');
      tab.dataset.idx = String(i);

      const icon = document.createElement('span');
      icon.className = 'tab-icon';
      icon.innerHTML = extIcon(doc.fileName);

      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = doc.fileName;
      label.title = doc.filePath ?? doc.fileName;

      const dirty = document.createElement('span');
      dirty.className = 'tab-dirty';
      dirty.textContent = '●';
      dirty.style.display = doc.dirty ? '' : 'none';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.innerHTML = '✕';
      close.title = 'Close';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        docManager.closeDoc(i);
      });

      tab.appendChild(icon);
      tab.appendChild(label);
      tab.appendChild(dirty);
      tab.appendChild(close);

      tab.addEventListener('click', () => docManager.activateAt(i));
      tab.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        docManager.closeDoc(i);
      });

      bar.appendChild(tab);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'tab-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'New document';
    addBtn.addEventListener('click', () => {
      docManager.newDoc();
    });
    bar.appendChild(addBtn);
  }

  docManager.addEventListener('tabs-changed', render);
  docManager.addEventListener('active-changed', render);

  render();
}
