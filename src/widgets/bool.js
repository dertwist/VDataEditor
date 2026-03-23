function buildBoolWidget(container, value, onChange) {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'prop-input-bool';
  cb.checked = !!value;
  cb.addEventListener('change', () => onChange(cb.checked));
  container.appendChild(cb);
}
