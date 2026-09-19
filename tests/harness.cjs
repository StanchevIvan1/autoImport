const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

function event() {
  const listeners = [];
  return { listeners, addListener(fn) { listeners.push(fn); }, removeListener(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
}
function storage(initial = {}) {
  const values = structuredClone(initial);
  const onChanged = event();
  return { values, onChanged, local: {
    async get(keys) { return structuredClone(keys == null ? values : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, values[k]]))); },
    async set(data, cb) { const changes = {}; for (const [k, v] of Object.entries(data)) { changes[k] = { oldValue: values[k], newValue: structuredClone(v) }; values[k] = structuredClone(v); } for (const fn of onChanged.listeners) fn(changes, 'local'); cb?.(); },
    async remove(keys, cb) { const changes = {}; for (const k of Array.isArray(keys) ? keys : [keys]) { changes[k] = { oldValue: values[k] }; delete values[k]; } for (const fn of onChanged.listeners) fn(changes, 'local'); cb?.(); }
  } };
}
function element(tagName = 'INPUT', value = '') {
  return { tagName, value, textContent: '', innerHTML: '', innerText: '', style: {}, dataset: {}, children: [], childNodes: [{ textContent: '' }], options: [], disabled: false,
    classList: { add() {}, remove() {} }, listeners: {},
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    async click() { for (const fn of this.listeners.click || []) await fn.call(this); await this.onclick?.(); },
    dispatchEvent() {}, appendChild(el) { this.children.push(el); }, remove() {}, blur() {},
    getAttribute(name) { return this[name] || ''; }, querySelector() { return null; }
  };
}
function context(extra = {}) {
  const sandbox = { console: { log() {}, warn() {}, error() {} }, URL, Date, Math, JSON, Map, Set, Promise, AbortSignal, AbortController, Uint8Array, structuredClone, Blob, File, crypto: require('node:crypto').webcrypto,
    setTimeout(fn) { queueMicrotask(fn); return 1; }, clearTimeout() {},
    Event: class { constructor(type) { this.type = type; } },
    ...extra };
  sandbox.window ||= sandbox;
  return vm.createContext(sandbox);
}
function run(file, ctx, expose = []) {
  if (file !== 'shared/images.js' && !ctx.AutoImportImages) run('shared/images.js', ctx);
  if (file !== 'shared/vehicle.js' && file !== 'shared/images.js' && !ctx.AutoImportVehicle) run('shared/vehicle.js', ctx);
  let source = fs.readFileSync(path.join(root, file), 'utf8');
  if (expose.length) source = source.replace(/\}\)\(\);\s*$/, `globalThis.testHooks = { ${expose.join(',')} };\n})();`);
  vm.runInContext(source, ctx, { filename: file });
}
function select(labels) { const el = element('SELECT'); el.options = labels.map((text, i) => ({ text, value: i ? text : '' })); return el; }
module.exports = { root, event, storage, element, context, run, select };
