const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extension, car, settle } = require('./extension.cjs');

test('existing empty transfer recovers only its original capture images', async () => {
  const e = extension();
  const a = await e.capture(1, car('12345', { images: ['https://cs.copart.com/a.jpg'] }));
  const job = await e.start(a);
  const stored = e.store.values.importState.transfers[job.destinationTabId];
  stored.data.images = []; delete stored.imagePolicy;
  const recovered = (await e.send({ action: 'GET_TRANSFER' }, e.fromTab(job.destinationTabId))).transfer;
  assert.deepEqual(Array.from(recovered.data.images), Array.from(a.images));
  // Re-read storage reference after the first migration wrote a fresh snapshot.
  const current = e.store.values.importState.transfers[job.destinationTabId];
  current.data.images = []; delete current.imagePolicy;
  await e.capture(1, car('67890', { images: ['https://cs.copart.com/b.jpg'] }));
  const isolated = (await e.send({ action: 'GET_TRANSFER' }, e.fromTab(job.destinationTabId))).transfer;
  assert.equal(isolated.data.images.length, 0);
});

test('multiple auction tabs read their own capture, not the last global vehicle', async () => {
  const e = extension(); const a = await e.capture(1); const b = await e.capture(2, car('67890', { make: 'Toyota', model: 'CAMRY' }));
  assert.equal((await e.send({ action: 'GET_CAR_DATA', sourceTabId: 1 })).data.capture.id, a.capture.id);
  assert.equal((await e.send({ action: 'GET_CAR_DATA', sourceTabId: 2 })).data.capture.id, b.capture.id);
});
test('A and B have immutable destination snapshots and cannot claim each other', async () => {
  const e = extension(); const a = await e.capture(1, car('12345', { images: ['https://cs.copart.com/a.jpg'] }));
  const ja = await e.start(a, { imagesReviewedCaptureId: a.capture.id });
  const b = await e.capture(1, car('67890')); const jb = await e.start(b);
  assert.notEqual(ja.destinationTabId, jb.destinationTabId);
  assert.equal((await e.send({ action: 'GET_TRANSFER' }, e.fromTab(ja.destinationTabId))).transfer.data.lotNumber, '12345');
  assert.equal(jb.data.images.length, 0);
  await assert.rejects(e.send({ action: 'CLAIM_TRANSFER', transferId: ja.id }, e.fromTab(jb.destinationTabId)), /друга обява/);
  await assert.rejects(e.start(b, {}, ja.destinationTabId), /друга обява/);
});
test('concurrent duplicate starts create one tab, duplicate claims cannot run twice', async () => {
  const e = extension(); const a = await e.capture(1);
  const [one, two] = await Promise.all([e.start(a), e.start(a)]);
  assert.equal(one.id, two.id); assert.equal(e.tabs.size, 2);
  const msg = { action: 'CLAIM_TRANSFER', transferId: one.id };
  const results = await Promise.allSettled([e.send(msg, e.fromTab(one.destinationTabId)), e.send(msg, e.fromTab(one.destinationTabId))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
test('clear invalidates late saves, pending form/images and destination ownership but preserves settings/auth', async () => {
  const e = extension({ auth: { token: 'saved' }, userSettings: { phone: '123' }, __ai_pending_images: ['old'], __ai_phase2_pending: { data: car() } });
  const a = await e.capture(1); const job = await e.start(a);
  const ticket = await e.send({ action: 'BEGIN_SCRAPE', tabId: 1 });
  await e.send({ action: 'CLEAR_CAR_DATA' });
  await assert.rejects(e.send({ action: 'SAVE_CAR_DATA', requestId: ticket.requestId, data: car() }, e.fromTab(1)), /отменено/);
  assert.equal((await e.send({ action: 'GET_TRANSFER' }, e.fromTab(job.destinationTabId))).transfer, null);
  assert.equal(e.store.values.carData, undefined); assert.equal(e.store.values.__ai_pending_images, undefined);
  assert.equal(e.store.values.auth.token, 'saved'); assert.equal(e.store.values.userSettings.phone, '123');
});
test('out of order scrapes and source navigation cannot save a stale vehicle', async () => {
  const e = extension(); await e.capture(1);
  const old = await e.send({ action: 'BEGIN_SCRAPE', tabId: 1 });
  const latest = await e.send({ action: 'BEGIN_SCRAPE', tabId: 1 });
  await assert.rejects(e.send({ action: 'SAVE_CAR_DATA', requestId: old.requestId, data: car() }, e.fromTab(1)), /отменено/);
  e.tabs.get(1).url = car('67890').lotUrl;
  await assert.rejects(e.send({ action: 'SAVE_CAR_DATA', requestId: latest.requestId, data: car() }, e.fromTab(1)), /сменена/);
});
test('missing identity does not replace a valid capture with a transferable empty vehicle', async () => {
  const e = extension(); await e.capture(1);
  const ticket = await e.send({ action: 'BEGIN_SCRAPE', tabId: 1 });
  await assert.rejects(e.send({ action: 'SAVE_CAR_DATA', requestId: ticket.requestId, data: car('12345', { model: '' }) }, e.fromTab(1)), /Липсват/);
  assert.equal((await e.send({ action: 'GET_CAR_DATA', sourceTabId: 1 })).data, null);
});
test('legacy unowned vehicle is not transferable; source-tab close cannot damage an independent destination', async () => {
  const e = extension({ carData: car() });
  assert.equal((await e.send({ action: 'GET_CAR_DATA' })).data, null);
  const a = await e.capture(1); const job = await e.start(a);
  e.chrome.tabs.onRemoved.listeners[0](1); await settle();
  assert.equal((await e.send({ action: 'GET_TRANSFER' }, e.fromTab(job.destinationTabId))).transfer.id, job.id);
  e.chrome.tabs.onRemoved.listeners[0](job.destinationTabId); await settle();
  assert.equal((await e.send({ action: 'GET_TRANSFER' }, e.fromTab(job.destinationTabId))).transfer, null);
});
test('image authorization is limited to the owning destination and source capture', async () => {
  const e = extension(); const a = await e.capture(1, car('12345', { images: ['https://cs.copart.com/a.jpg'] }));
  const unreviewed = await e.start(a); assert.equal(unreviewed.data.images.length, 1);
  await e.send({ action: 'CLEAR_CAR_DATA' });
  const fresh = await e.capture(1, car('12345', { images: ['https://cs.copart.com/a.jpg'] }));
  const job = await e.start(fresh, { imagesReviewedCaptureId: fresh.capture.id }); const sender = e.fromTab(job.destinationTabId);
  await e.send({ action: 'CLAIM_TRANSFER', transferId: job.id }, sender);
  await e.send({ action: 'FORM_FILLED', transferId: job.id }, sender);
  await e.api.authorizeImage({ transferId: job.id, url: job.data.images[0] }, sender);
  await assert.rejects(e.api.authorizeImage({ transferId: job.id, url: 'https://cs.copart.com/b.jpg' }, sender), /не принадлежи/);
  await e.send({ action: 'CLEAR_CAR_DATA' });
  await assert.rejects(e.api.authorizeImage({ transferId: job.id, url: job.data.images[0] }, sender));
});

test('navigation and browser startup retire tab-owned state without changing authentication', async () => {
  const e = extension({ auth: { token: 'saved' } }); const a = await e.capture(1); const job = await e.start(a);
  const url = 'https://www.mobile.bg/'; e.tabs.get(job.destinationTabId).url = url;
  e.chrome.tabs.onUpdated.listeners[0](job.destinationTabId, { url }); await settle();
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].id, job.id);
  e.chrome.runtime.onStartup.listeners[0](); await settle();
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].phase, 'detached'); assert.equal(e.store.values.auth.token, 'saved');
});

test('expired destination ownership cannot be used for an image or form update', async () => {
  const e = extension(); const a = await e.capture(1); const job = await e.start(a);
  e.store.values.importState.transfers[job.destinationTabId].createdAt = Date.now() - 3 * 60 * 60 * 1000;
  await assert.rejects(e.send({ action: 'CHECK_TRANSFER', transferId: job.id }, e.fromTab(job.destinationTabId)), /изтекло/);
});
