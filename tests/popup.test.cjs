const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extension, car, popup, settle } = require('./extension.cjs');

test('first scrape in an empty popup can immediately fill the fresh vehicle', async () => {
  const e = extension(); e.tabs.set(1, { id: 1, url: car().lotUrl });
  const p = await popup(e, 1, car());
  assert.equal(p.get('btn-fill').disabled, true);
  await p.get('btn-scrape').click(); await settle();
  assert.equal(p.get('btn-fill').disabled, false);
  await p.get('btn-fill').click();
  const job = Object.values(e.store.values.importState.transfers)[0];
  assert.equal(job.data.lotNumber, '12345');
  assert.equal(job.data.capture.sourceTabId, 1);
});
test('opening auction B never offers saved A; scraping B resets overrides and images', async () => {
  const e = extension(); await e.capture(1, car('12345', { horsepower: '300', series: 'Sport', images: ['https://cs.copart.com/a.jpg'] }));
  e.tabs.set(2, { id: 2, url: car('67890').lotUrl });
  const p = await popup(e, 2, car('67890'));
  assert.equal(p.get('btn-fill').disabled, true);
  p.get('d-horsepower').value = '999'; p.get('d-modification').value = 'old';
  await p.get('btn-scrape').click(); await settle();
  assert.equal(p.get('d-horsepower').value, ''); assert.equal(p.get('d-modification').value, '');
 assert.equal(p.get('images-row').innerHTML, '');
  await p.get('btn-fill').click();
  const job = Object.values(e.store.values.importState.transfers)[0];
  assert.equal(job.data.lotNumber, '67890'); assert.equal(job.settings.horsepower, ''); assert.equal(job.data.images.length, 0);
});
test('popup opened on A then rescraping same tab as B cannot transfer captured A', async () => {
  const e = extension(); await e.capture(1);
  const p = await popup(e, 1, car('67890', { model: 'CAMRY', make: 'Toyota' }));
  e.tabs.get(1).url = car('67890').lotUrl;
  await p.get('btn-scrape').click(); await settle(); await p.get('btn-fill').click();
  const job = Object.values(e.store.values.importState.transfers)[0];
  assert.equal(job.data.lotNumber, '67890');
});
test('clearing popup also resets review/overrides and prevents a stale click', async () => {
  const e = extension(); const a = await e.capture(1); await e.start(a);
  const p = await popup(e, 1); p.get('d-horsepower').value = '999';
  await p.get('footer-clear').click(); await settle(); await p.get('btn-fill').click();
  assert.equal(Object.keys(e.store.values.importState.transfers).length, 0);
  assert.equal(p.get('d-horsepower').value, ''); assert.equal(p.get('btn-fill').disabled, true);
});
test('popup preview escapes auction text and all reviewed image URLs', async () => {
  const e = extension(); await e.capture(1, car('12345', { primaryDamage: '<img src=x>', images: ['https://cs.copart.com/a.jpg?x="bad'] }));
  const p = await popup(e, 1);
  assert.match(p.get('car-specs').innerHTML, /&lt;img/);
  assert.doesNotMatch(p.get('images-row').innerHTML, /x="bad/);
});

async function edit(p, id, value) {
  p.get(id).value = value;
  await Promise.all(p.get(id).listeners.input.map(fn => fn()));
}
test('corrections survive popup reopen, a fresh capture and another tab of the same vehicle', async () => {
  const e = extension(); await e.capture(1);
  const p = await popup(e, 1);
  await edit(p, 'd-horsepower', '211'); await edit(p, 'd-modification', 'Sport');
  const reopened = await popup(e, 1);
  assert.equal(reopened.get('d-horsepower').value, '211');
  await e.capture(1); await e.capture(2);
  const other = await popup(e, 2);
  assert.equal(other.get('d-modification').value, 'Sport');
  await other.get('btn-fill').click();
  assert.equal(Object.values(e.store.values.importState.transfers)[0].settings.horsepower, '211');
  await e.capture(3, car('67890'));
  assert.equal((await popup(e, 3)).get('d-horsepower').value, '');
});
test('blank corrections restore extraction; invalid power blocks transfer', async () => {
  const e = extension(); await e.capture(1, car('12345', { horsepower: '300' }));
  const p = await popup(e, 1);
  await edit(p, 'd-horsepower', '0');
  await edit(p, 'd-modification', 'Sport');
  await p.get('btn-fill').click();
  assert.equal(Object.keys(e.store.values.importState.transfers).length, 0);
  await edit(p, 'd-horsepower', '211'); await edit(p, 'd-horsepower', '');
  const reopened = await popup(e, 1);
  assert.equal(reopened.get('d-horsepower').value, '');
  assert.equal(reopened.get('d-horsepower').placeholder, '300');
  await reopened.get('btn-fill').click();
  const job = Object.values(e.store.values.importState.transfers)[0];
  assert.equal(job.settings.horsepower, ''); assert.equal(job.data.horsepower, '300');
});
test('durable corrections survive startup; explicit clear rejects stale saves and removes corrections', async () => {
  const e = extension(); const a = await e.capture(1);
  const save = { action: 'SAVE_OVERRIDES', captureId: a.capture.id, field: 'horsepower', value: '211' };
  await e.send(save);
  for (const fn of e.chrome.runtime.onStartup.listeners) fn();
  await settle();
  const fresh = await e.capture(1);
  assert.equal(fresh.overrides.horsepower, '211');
  await assert.rejects(e.send(save));
  await e.send({ action: 'CLEAR_CAR_DATA' });
  await assert.rejects(e.send({ ...save, captureId: fresh.capture.id }));
  assert.equal((await e.capture(1)).overrides.horsepower, undefined);
});
test('saved corrections do not alter an existing immutable transfer', async () => {
  const e = extension(); const a = await e.capture(1);
  const job = await e.start(a);
  await e.send({ action: 'SAVE_OVERRIDES', captureId: a.capture.id, field: 'horsepower', value: '211' });
  assert.equal((await e.start(a)).settings.horsepower, undefined);
  assert.equal((await e.start(a)).id, job.id);
  const fresh = await e.capture(1);
  assert.equal((await e.start(fresh)).settings.horsepower, '211');
});
test('popup markup contains the autosave status used by the real UI', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../popup/popup.html'), 'utf8');
  assert.match(html, /id="correction-status"/);
});
