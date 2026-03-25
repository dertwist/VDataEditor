/* eslint-disable no-console */
'use strict'

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

function usageAndExit() {
  console.log('Usage: node scripts/build-kv3-addon.js --arch=<arch>')
  console.log('Example: node scripts/build-kv3-addon.js --arch=x64')
  process.exit(1)
}

function parseArgs() {
  const out = {}
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--arch=')) out.arch = a.slice('--arch='.length)
    else if (a === '--help' || a === '-h') usageAndExit()
  }
  return out
}

function findNodeGyp() {
  // node-gyp is already present transitively in package-lock (via electron-builder),
  // so we can use it without adding new dependencies.
  return path.join(__dirname, '..', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
}

function ensureElectronVersion() {
  const electronPkg = require('electron/package.json')
  if (!electronPkg || typeof electronPkg.version !== 'string') {
    throw new Error('Unable to resolve electron version from node_modules/electron/package.json')
  }
  return electronPkg.version
}

function main() {
  const args = parseArgs()
  const arch = args.arch || process.arch
  if (!arch || (arch !== 'x64' && arch !== 'arm64' && arch !== 'ia32')) usageAndExit()

  const nodeGyp = findNodeGyp()
  if (!fs.existsSync(nodeGyp)) throw new Error('node-gyp not found at ' + nodeGyp)

  const electronVersion = ensureElectronVersion()
  const addonDir = path.join(__dirname, '..', 'native', 'kv3-addon')
  const releaseDir = path.join(addonDir, 'build', 'Release')
  const builtNodePath = path.join(releaseDir, 'kv3addon.node')
  const archTaggedNodePath = path.join(releaseDir, `kv3addon-${arch}.node`)

  // Compile against Electron headers so N-API / runtime ABI expectations match Electron's Node.
  const distUrl = 'https://www.electronjs.org/headers'
  const res = spawnSync(
    process.execPath,
    [
      nodeGyp,
      'rebuild',
      `--directory=${addonDir}`,
      `--target=${electronVersion}`,
      `--arch=${arch}`,
      `--dist-url=${distUrl}`
    ],
    { stdio: 'inherit' }
  )
  if (res.status !== 0) process.exit(res.status || 1)

  if (!fs.existsSync(builtNodePath)) {
    throw new Error('Expected built addon at ' + builtNodePath)
  }

  // Rename/mirror into an arch-specific file so a universal macOS bundle can keep both.
  fs.copyFileSync(builtNodePath, archTaggedNodePath)
  console.log('Wrote: ' + path.relative(process.cwd(), archTaggedNodePath))
}

main()

