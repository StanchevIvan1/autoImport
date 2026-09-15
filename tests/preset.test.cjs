const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extension, car, filler, form, settle, popup } = require('./extension.cjs');
const { element, select } = require('./harness.cjs');

async function filled(data = {}, settings = {}, page = form()) {
  const e = extension(); const a = await e.capture(1, car('12345', data)); const job = await e.start(a, settings);
  const f = filler(e, job, page); await settle(); await f.message({ action: 'START_FILL', transferId: job.id }); await settle();
  return { e, f, job };
}
test('VAT uses the visible included-VAT label even when its value differs from the baseline', async () => {
  const page = form(); page.fields.f31 = select(['Choose', 'Цената е без ДДС', 'Цената е с включено ДДС']);
  page.fields.f31.options[2].value = 'included';
  const { f } = await filled({}, {}, page); assert.equal(f.fields.f31.value, 'included');
});
test('explicit production month wins; missing month selects a real month', async () => {
  assert.equal((await filled({ productionMonth: '03' })).f.fields.f14.value, 'март');
  const { f } = await filled(); assert.ok(f.fields.f14.options.some(o => o.value && o.value === f.fields.f14.value));
});
test('fixed preset works for an older car and 4x4 is cleared for rear drive', async () => {
  const page = form(); page.boxes.find(b => b.value === '4x4').checked = true;
  const { f } = await filled({ year: '1999', drive: 'Задно' }, {}, page);
  assert.equal(f.boxes.find(b => b.value === 'Аларма').checked, true);
  assert.equal(f.boxes.find(b => b.value === 'Кожен салон').checked, true);
  assert.equal(f.boxes.find(b => b.value === '4x4').checked, false);
  assert.equal((await filled({ drive: '4x4' })).f.boxes.find(b => b.value === '4x4').checked, true);
});
test('preset matches a truncated value and visible checkbox label', async () => {
  const page = form();
  const cb = element('INPUT', 'numeric-id'); cb.labels = [{ textContent: 'Електронна програма за стабилизиране' }]; page.boxes.push(cb);
  await filled({}, {}, page); assert.equal(cb.checked, true);
});
test('city list maps prefixed city exactly and populates popup suggestions', async () => {
  const page = form(); page.fields.f19 = select(['Choose', 'гр. София', 'гр. Нови Искър']);
  page.fields.f19.options[1].value = 'city-68134';
  const { e, f } = await filled({}, { city: 'София' }, page);
  assert.equal(f.fields.f19.value, 'city-68134');
  assert.equal(e.store.values['mobileCities:софия'].length, 2);
  const p = await popup(e, 1); assert.match(p.get('s-city-options').innerHTML, /гр. Нови Искър/);
});
test('city select replaced during loading is re-read rather than using a detached element', async () => {
  const page = form(); page.fields.f19 = select(['Choose']);
  const e = extension(); const a = await e.capture(1); const job = await e.start(a, { city: 'София' });
  const f = filler(e, job, page, { setTimeout(fn) {
    if (page.fields.f19.options.length === 1) page.fields.f19 = select(['Choose', 'гр. София']);
    queueMicrotask(fn);
  } });
  await settle(); await f.message({ action: 'START_FILL', transferId: job.id }); await settle();
  assert.equal(page.fields.f19.value, 'гр. София');
});
