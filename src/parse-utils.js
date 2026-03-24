const { parseKV3Document, detectKV3HeaderFromFileName } = KV3Format;
const { keyValueToJSON } = KeyValueFormat;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function fileExtension(name) {
  if (!name || typeof name !== 'string') return '';
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

function pathBasename(p) {
  if (!p || typeof p !== 'string') return '';
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function parseDocumentContent(text, hintFileName) {
  const ext = fileExtension(hintFileName);
  if (ext === 'vmat' || ext === 'vmt') return { root: keyValueToJSON(text), format: 'keyvalue' };
  if (ext === 'json') return { root: JSON.parse(text), format: 'json' };
  const parsed = parseKV3Document(text);
  return {
    root: parsed.root,
    format: 'kv3',
    kv3Header: parsed.header || detectKV3HeaderFromFileName(hintFileName)
  };
}

const KV3_LIKE_EXT = new Set([
  'vdata',
  'vsmart',
  'vpcf',
  'kv3',
  'vsurf',
  'vsndstck',
  'vsndevts',
  'vpulse',
  'vmdl',
  'txt'
]);

function syncDocumentFormatFromFilename(doc, name) {
  const ext = fileExtension(name);
  if (ext === 'vmat' || ext === 'vmt') doc.format = 'keyvalue';
  else if (ext === 'json') doc.format = 'json';
  else {
    doc.format = 'kv3';
    if (!doc.kv3Header) doc.kv3Header = detectKV3HeaderFromFileName(name);
  }
}

/** Smart-prop roots expect these arrays; do not add them to arbitrary KeyValues trees (e.g. VMAT). */
function ensureSmartPropRootArrays(doc) {
  const root = doc.root;
  if (root && root.generic_data_type === 'CSmartPropRoot') {
    if (!root.m_Children) root.m_Children = [];
    if (!root.m_Variables) root.m_Variables = [];
  }
}
