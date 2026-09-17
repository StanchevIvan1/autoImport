const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extension, car, filler, settle, popupSender } = require('./extension.cjs');
const { context, run } = require('./harness.cjs');

test('real worker message routing hands off to filler before the popup closes', async () => {
  const e = extension(); const data = await e.capture(1);
  const ctx = context({ chrome: e.chrome });
  ctx.importScripts = (...files) => files.forEach(file => run(`background/${file}`, ctx));
  run('background/worker.js', ctx);
  const handler = e.chrome.runtime.onMessage.listeners[0];
  const route = (msg, sender = popupSender) => new Promise(resolve => handler(msg, sender, resolve));
  e.send = route;
  const pages = new Map();
  e.chrome.scripting = { async executeScript({ target }) {
    const job = e.store.values.importState.transfers[target.tabId];
    pages.set(target.tabId, filler(e, job));
  } };
  e.chrome.tabs.sendMessage = (id, message) => pages.get(id).message(message);
  const result = await route({ action: 'START_TRANSFER', captureId: data.capture.id, settings: { phone: '555' } });
  assert.equal(result.success, true);
  await settle();
  const page = pages.get(result.transfer.destinationTabId);
  assert.equal(page.fields.f5.value, 'BMW'); assert.equal(page.fields.f6.value, 'X5'); assert.equal(page.fields.f22.value, '555');
  assert.equal(e.store.values.importState.transfers[result.transfer.destinationTabId].phase, 'completed');
  const repeated = await route({ action: 'START_TRANSFER', captureId: data.capture.id });
  assert.equal(repeated.duplicate, true); assert.equal(pages.size, 1);
});

test('worker returns storage failure without false save success and remains usable', async () => {
  const e = extension(); await e.capture(1);
  const ctx = context({ chrome: e.chrome }); ctx.importScripts = (...files) => files.forEach(file => run(`background/${file}`, ctx)); run('background/worker.js', ctx);
  const route = msg => new Promise(resolve => e.chrome.runtime.onMessage.listeners[0](msg, popupSender, resolve));
  const original = e.store.local.set;
  e.store.local.set = async () => { throw Error('Storage unavailable'); };
  assert.equal((await route({ action: 'BEGIN_SCRAPE', tabId: 1 })).success, false);
  e.store.local.set = original;
  assert.equal((await route({ action: 'BEGIN_SCRAPE', tabId: 1 })).success, true);
});

function dispatchFixture(e) {
  const ctx = context({ chrome: e.chrome });
  ctx.importScripts = (...files) => files.forEach(file => run(`background/${file}`, ctx));
  run('background/worker.js', ctx);
  return ctx;
}
test('concurrent dispatches share one injection and one start', async () => {
  const e = extension(); const job = await e.start(await e.capture(1));
  let injections = 0, starts = 0;
  e.chrome.scripting = { async executeScript() { injections++; } };
  e.chrome.tabs.sendMessage = async () => { starts++; return { success: true }; };
  const ctx = dispatchFixture(e);
  await Promise.all([ctx.dispatchTransfer(job), ctx.dispatchTransfer(job)]);
  assert.equal(injections, 1); assert.equal(starts, 1);
});
test('lost acknowledgement after claim does not fail a running transfer', async () => {
  const e = extension(); const job = await e.start(await e.capture(1));
  e.chrome.scripting = { async executeScript() {} };
  const ctx = dispatchFixture(e);
  e.chrome.tabs.sendMessage = async () => {
    await e.send({ action: 'CLAIM_TRANSFER', transferId: job.id }, e.fromTab(job.destinationTabId));
    throw Error('The message port closed before a response was received.');
  };
  await ctx.dispatchTransfer(job);
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].phase, 'filling');
});
test('temporary missing receiver retries; permanent failure remains visible', async () => {
  const e = extension(); const job = await e.start(await e.capture(1));
  e.chrome.scripting = { async executeScript() {} };
  let attempts = 0;
  e.chrome.tabs.sendMessage = async () => { if (++attempts < 2) throw Error('Receiving end does not exist.'); return { success: true }; };
  const ctx = dispatchFixture(e);
  await ctx.dispatchTransfer(job);
  assert.equal(attempts, 2);
  e.chrome.tabs.sendMessage = async () => { throw Error('Permanent injection failure'); };
  await ctx.dispatchTransfer(job);
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].phase, 'failed');
  assert.match(e.store.values.importState.transfers[job.destinationTabId].error, /Permanent/);
});
