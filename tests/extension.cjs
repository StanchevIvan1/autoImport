const vm = require('node:vm');
const { context, run, event, storage, element, select } = require('./harness.cjs');
const popupSender = { url: 'chrome-extension://test/popup/popup.html' };
const car = (id = '12345', changes = {}) => ({ source: 'copart', lotUrl: `https://www.copart.com/lot/${id}`, lotNumber: id, year: '2020', make: 'BMW', model: 'X5', images: [], ...changes });
function extension(initial = {}) {
  const store = storage(initial);
  const tabs = new Map();
  let nextId = 100;
  const chrome = { storage: store, runtime: { onMessage: event(), onStartup: event(), getURL: path => `chrome-extension://test/${path}` },
    tabs: { onRemoved: event(), onUpdated: event(),
      async get(id) { if (!tabs.has(id)) throw Error('Tab closed'); return structuredClone(tabs.get(id)); },
      async create(opts) { const tab = { id: nextId++, windowId: 1, status: 'complete', ...opts }; tabs.set(tab.id, tab); return structuredClone(tab); },
      async update(id, changes) { Object.assign(tabs.get(id), changes); return structuredClone(tabs.get(id)); },
      async sendMessage() { return { success: true }; } }, windows: { async update() {} }
  };
  const ctx = context({ chrome });
  run('background/transfers.js', ctx);
  const api = vm.runInContext('AutoImportTransfers', ctx);
  const send = (message, sender = popupSender) => api.handle(message, sender);
  const fromTab = id => ({ tab: { ...tabs.get(id) }, url: tabs.get(id).url, frameId: 0 });
  async function capture(id, data = car()) {
    tabs.set(id, { id, windowId: 1, status: 'complete', url: data.lotUrl });
    const ticket = await send({ action: 'BEGIN_SCRAPE', tabId: id });
    return (await send({ action: 'SAVE_CAR_DATA', requestId: ticket.requestId, data }, fromTab(id))).data;
  }
  async function start(data, settings = {}, tabId) {
    return (await send({ action: 'START_TRANSFER', captureId: data.capture.id, settings, ...(tabId == null ? {} : { tabId }) })).transfer;
  }
  return { chrome, store, tabs, ctx, api, send, fromTab, capture, start };
}
async function popup(ext, activeId, scrapeData) {
  const ids = new Map();
  const get = id => { if (!ids.has(id)) ids.set(id, element()); return ids.get(id); };
  let loaded;
  const sent = [];
  const chrome = { ...ext.chrome, tabs: { ...ext.chrome.tabs, query: async () => [await ext.chrome.tabs.get(activeId)],
    async sendMessage(id, msg) {
      if (msg.action === 'PING') return { active: true };
      if (msg.action === 'SCRAPE_NOW') return ext.send({ action: 'SAVE_CAR_DATA', requestId: msg.requestId, data: scrapeData }, ext.fromTab(id));
      return { success: true };
    }
  }, runtime: { ...ext.chrome.runtime, sendMessage(msg, cb) {
    sent.push(msg);
    const result = msg.type ? Promise.resolve({ ok: true, plan: 'Pro' }) : ext.send(msg).catch(error => ({ success: false, error: error.message }));
    if (cb) result.then(cb); else return result;
  } } };
  const ctx = context({ chrome,
    document: { addEventListener(_, fn) { loaded = fn; }, getElementById: get, querySelectorAll: () => [], querySelector: () => null },
    setTimeout() {}, close() {}
  });
  run('popup/popup.js', ctx);
  await loaded();
  return { ids, get, sent, ctx };
}
function form() {
  const fields = {};
  for (const name of ['f7','f9','f12','f16','f21','f22','f23','f30','f32']) fields[name] = element(name === 'f21' ? 'TEXTAREA' : 'INPUT');
  for (const [name, labels] of Object.entries({ f5: ['Choose','BMW','Toyota'], f6: ['Choose','X5','CAMRY'], f8: ['Choose','Бензинов'], f10: ['Choose','Автоматична'], f11: ['Choose','Джип','Кабрио'], f13: ['Choose','EUR'], f14: ['Choose','януари','февруари','март','април','май','юни','юли','август','септември','октомври','ноември','декември'], f15: ['Choose','2020'], f17: ['Choose','Черен'], f18: ['Choose','София','Варна'], f19: ['Choose','София','Варна'], f25: ['Choose','0'], f29: ['Choose','6'], f31: ['Choose','1'] })) fields[name] = select(labels);
  fields.f18.value = 'София';
  const ids = new Map();
  const boxes = ['Аларма','Кожен салон','4x4','Apple CarPlay'].map(value => element('INPUT', value));
  const document = { activeElement: null, listeners: {}, addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }, body: { appendChild(el) { if (el.id) ids.set(el.id, el); } },
    createElement: tag => element(tag.toUpperCase()), getElementById: id => ids.get(id) || null,
    querySelector(selector) { const name = selector.match(/^\[name="(.+)"\]$/)?.[1]; return name ? fields[name] || null : selector.startsWith('input[type="file"]') ? document.fileInput || null : null; },
    querySelectorAll: selector => selector === 'input[type="checkbox"]' ? boxes : []
  };
  return { document, fields, boxes, ids };
}
function filler(ext, job, page = form(), extra = {}) {
  const onMessage = event();
  const chrome = { ...ext.chrome, runtime: { ...ext.chrome.runtime, onMessage,
    async sendMessage(message) { try { return await ext.send(message, ext.fromTab(job.destinationTabId)); } catch (error) { return { success: false, error: error.message }; } }
  } };
  const ctx = context({ chrome, document: page.document, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {}, ...extra });
  run('content_scripts/mobile_filler.js', ctx, ['pickVal','pickModel','getExtras','buildDesc','autoUploadImages']);
  async function message(msg) { return new Promise(resolve => onMessage.listeners[0](msg, {}, resolve)); }
  return { ...page, ctx, message, onMessage };
}
async function settle() { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); }
module.exports = { extension, car, popup, form, filler, settle, popupSender };
