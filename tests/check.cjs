const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { root } = require('./harness.cjs');
function visit(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.') || item.name === 'node_modules') continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory()) visit(file);
    else if (/\.(?:js|cjs)$/.test(file)) execFileSync(process.execPath, ['--check', file]);
  }
}
visit(root);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap(s => s.js), ...Object.values(manifest.icons)]) {
  if (!fs.existsSync(path.join(root, file))) throw Error(`Missing manifest resource: ${file}`);
}
console.log('All JavaScript syntax and manifest resources OK');
