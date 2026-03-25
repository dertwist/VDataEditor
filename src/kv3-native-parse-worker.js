// worker_threads: off-main-thread KV3 native parsing
'use strict'

const { parentPort } = require('node:worker_threads')

const KV3Format = require('../format/kv3.js')
const nativeLoader = require('../native/kv3-addon/kv3-native-loader.cjs')

function parseKv3TextToDoc(text, hintFileName) {
  const parsedKv3 = nativeLoader.parseKv3Document(text)
  return {
    root: parsedKv3.root,
    format: 'kv3',
    kv3Header: parsedKv3.header || KV3Format.detectKV3HeaderFromFileName(hintFileName || '')
  }
}

parentPort.on('message', (msg) => {
  const id = msg && msg.id != null ? msg.id : null
  try {
    const text = msg && typeof msg.text === 'string' ? msg.text : ''
    const hintFileName = msg && typeof msg.hintFileName === 'string' ? msg.hintFileName : ''
    const parsed = parseKv3TextToDoc(text, hintFileName)
    parentPort.postMessage({ id, ok: true, parsed })
  } catch (e) {
    parentPort.postMessage({
      id,
      ok: false,
      error: e && e.message ? e.message : String(e)
    })
  }
})

