// worker_threads: off-main-thread initial prop-tree row plan computation
'use strict'

const { parentPort } = require('node:worker_threads')

const propTreeNativeLoader = require('../native/prop-tree-addon/prop-tree-native-loader.cjs')

parentPort.on('message', (msg) => {
  const id = msg && msg.id != null ? msg.id : null
  try {
    const root = msg && msg.root ? msg.root : null
    const options = msg && msg.options && typeof msg.options === 'object' ? msg.options : null
    const plan = propTreeNativeLoader.buildPropTreeInitialPlan(root, options)
    parentPort.postMessage({ id, ok: true, plan })
  } catch (e) {
    parentPort.postMessage({
      id,
      ok: false,
      error: e && e.message ? e.message : String(e)
    })
  }
})

