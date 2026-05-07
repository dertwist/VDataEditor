const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const APP_NAME = 'VDataEditor';
const ICON_PATH = 'assets/images/vdata_editor/appicon.ico';

function main() {
  const distPake = path.join(process.cwd(), 'dist-pake');
  
  if (fs.existsSync(distPake)) {
    fs.rmSync(distPake, { recursive: true, force: true });
  }
  fs.mkdirSync(distPake);

  const toCopy = [
    'assets',
    'src',
    'format',
    'vendor',
    'schemas',
    'icons.js',
    'style.css',
    'index.html',
    'editor.js',
    'performance-additions.css'
  ];

  console.log('Copying files to dist-pake...');
  for (const item of toCopy) {
    const src = path.join(process.cwd(), item);
    const dest = path.join(distPake, item);
    if (fs.existsSync(src)) {
      if (fs.lstatSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  }

  console.log('Running Pake...');
  const res = spawnSync(
    'npx',
    [
      '-y',
      'pake-cli',
      'index.html',
      '--use-local-file',
      '--name', APP_NAME,
      '--icon', ICON_PATH
    ],
    { 
      cwd: distPake, 
      stdio: 'inherit',
      shell: true 
    }
  );

  if (res.status !== 0) {
    process.exit(res.status || 1);
  }

  // Move the resulting installer back to the root
  const files = fs.readdirSync(distPake);
  const installer = files.find(f => f.endsWith('.exe') || f.endsWith('.msi'));
  if (installer) {
    const src = path.join(distPake, installer);
    const dest = path.join(process.cwd(), installer);
    fs.copyFileSync(src, dest);
    console.log(`Build successful: ${dest}`);
  }
}

main();
