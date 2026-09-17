const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extension, car, filler, form, settle } = require('./extension.cjs');

test('login redirect keeps the job; CGI login page does not claim or fill', async () => {
  const e = extension(); const a = await e.capture(1); const j = await e.start(a);
  e.tabs.get(j.destinationTabId).url = 'https://www.mobile.bg/login';
  e.chrome.tabs.onUpdated.listeners[0](j.destinationTabId, { url: e.tabs.get(j.destinationTabId).url }); await settle();
  assert.equal(e.store.values.importState.transfers[j.destinationTabId].id, j.id);
  e.tabs.get(j.destinationTabId).url = 'https://www.mobile.bg/pcgi/mobile.cgi?login=1';
  const page = form(); delete page.fields.f5;
  const f = filler(e, j, page); await settle();
  assert.equal((await f.message({ action: 'START_FILL', transferId: j.id })).waiting, true);
  assert.equal(e.store.values.importState.transfers[j.destinationTabId].phase, 'created');
});
test('document reload detects interrupted filling; retry keeps snapshot after source changes', async () => {
  const e = extension(); const a = await e.capture(1); const j = await e.start(a, { phone: '123' });
  const sender = { ...e.fromTab(j.destinationTabId), documentId: 'old' };
  await e.send({ action: 'CLAIM_TRANSFER', transferId: j.id }, sender);
  const reloaded = await e.send({ action: 'GET_TRANSFER' }, { ...sender, documentId: 'new' });
  assert.equal(reloaded.transfer.phase, 'failed');
  await e.capture(1, car('67890'));
  const [r1, r2] = await Promise.all([1, 2].map(() => e.send({ action: 'RETRY_TRANSFER', transferId: j.id })));
  assert.equal(r1.transfer.id, r2.transfer.id);
  assert.notEqual(r1.transfer.destinationTabId, j.destinationTabId);
  assert.equal(r1.transfer.data.lotNumber, '12345');
  assert.equal(r1.transfer.settings.phone, '123');
  await assert.rejects(e.send({ action: 'FORM_FILLED', transferId: j.id }, sender));
});
test('cancellation is persisted before acknowledgement and rejects late results', async () => {
  const e = extension(); const j = await e.start(await e.capture(1));
  await e.send({ action: 'CANCEL_JOB', transferId: j.id });
  assert.equal(e.store.values.importState.transfers[j.destinationTabId].phase, 'cancelled');
  await assert.rejects(e.send({ action: 'CLAIM_TRANSFER', transferId: j.id }, e.fromTab(j.destinationTabId)));
  await assert.rejects(e.send({ action: 'TRANSFER_FAILED', transferId: j.id }, e.fromTab(j.destinationTabId)));
});
test('final image result counts assignments without claiming server upload', async () => {
  const e = extension(); const j = await e.start(await e.capture(1, car('12345', { images: ['https://cs.copart.com/a.jpg', 'https://cs.copart.com/b.jpg'] })));
  const sender = e.fromTab(j.destinationTabId);
  await e.send({ action: 'CLAIM_TRANSFER', transferId: j.id }, sender);
  await e.send({ action: 'FORM_FILLED', transferId: j.id }, sender);
  const r = await e.send({ action: 'IMAGES_ASSIGNED', transferId: j.id, assigned: 1, failures: 1 }, sender);
  assert.equal(r.transfer.result.imagesAssigned, 1); assert.equal(r.transfer.result.imagesFailed, 1);
  assert.equal(r.transfer.result.uploadConfirmed, false);
  await e.send({ action: 'TRANSFER_FAILED', transferId: j.id, error: 'late dispatch' }, sender);
  assert.equal(e.store.values.importState.transfers[j.destinationTabId].phase, 'imagesAssigned');
});

test('old document cannot finish after a reload has reported interruption', async () => {
  const e = extension(); const j = await e.start(await e.capture(1));
  const old = { ...e.fromTab(j.destinationTabId), documentId: 'old' };
  await e.send({ action: 'CLAIM_TRANSFER', transferId: j.id }, old);
  await e.send({ action: 'GET_TRANSFER' }, { ...old, documentId: 'new' });
  await assert.rejects(e.send({ action: 'FORM_FILLED', transferId: j.id }, old), /презаредена/);
});
test('retry remains available after browser restart without granting old tab ownership', async () => {
  const e = extension(); const j = await e.start(await e.capture(1));
  e.chrome.runtime.onStartup.listeners[0](); await settle();
  assert.equal((await e.send({ action: 'GET_TRANSFER' }, e.fromTab(j.destinationTabId))).transfer, null);
  const r = await e.send({ action: 'RETRY_TRANSFER', transferId: j.id });
  assert.equal(r.transfer.data.capture.id, j.data.capture.id);
  assert.equal(r.transfer.phase, 'created');
});
test('form warnings survive completion and popup results', async () => {
  const e = extension(); const j = await e.start(await e.capture(1), { city: 'Unknown City' });
  const f = filler(e, j); await settle(); await f.message({ action: 'START_FILL', transferId: j.id }); await settle();
  const list = await e.send({ action: 'LIST_TRANSFERS' });
  assert.match(list.transfers[0].result.warnings.join(' '), /Unknown City/);
});
