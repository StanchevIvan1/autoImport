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
