const { test } = require('node:test');
const assert = require('node:assert/strict');
const { context, run, event } = require('./harness.cjs');
function load(name, { nd, text = '', title = '2020 BMW X5' } = {}) {
  const ctx = context({ location: { href: `https://www.${name}.com/${name === 'copart' ? 'lot' : 'VehicleDetail'}/12345` },
    chrome: { runtime: { onMessage: event() } }, document: { body: { innerText: text },
      getElementById: id => id === '__NEXT_DATA__' && nd ? { textContent: JSON.stringify(nd) } : null,
      querySelector: selector => selector === 'h1' ? { innerText: title } : null, querySelectorAll: () => [] } });
  run(`content_scripts/${name}_scraper.js`, ctx, ['scrape', 'milesToKm']);
  return ctx;
}
for (const name of ['copart', 'iaai']) {
  test(`${name}: explicit miles/km and zero work; ambiguous readings stay unknown`, () => {
    const { milesToKm } = load(name).testHooks;
    assert.equal(milesToKm('10,000 mi'), 16093); assert.equal(milesToKm('10,000 km'), 10000);
    assert.equal(milesToKm('0 mi'), 0); assert.equal(milesToKm('unknown'), null);
    assert.equal(milesToKm('10,000 mi (NOT ACTUAL)'), null); assert.equal(milesToKm('10000'), null);
    assert.equal(milesToKm(10000, 'mi'), 16093);
  });
  test(`${name}: unknown engine fuel stays blank and gas/electric hybrids stay hybrid`, async () => {
    const unknown = await load(name, { text: 'Engine:\n3.0L 6 Cylinder' }).testHooks.scrape();
    assert.equal(unknown.fuel, '');
    const hybrid = await load(name, { text: 'Fuel:\nGas Electric Hybrid' }).testHooks.scrape();
    assert.equal(hybrid.fuel, 'Хибриден');
  });
}
test('Copart picks the current lot from structured data, not an earlier recommended car', async () => {
  const data = await load('copart', { nd: { recommended: { ln: 99999, mkn: 'Toyota', mdn: 'CAMRY' }, current: { ln: 12345, lcy: 2020, mkn: 'BMW', mdn: 'X5' } } }).testHooks.scrape();
  assert.equal(data.make, 'BMW'); assert.equal(data.model, 'X5');
});
test('scraper propagates failed save instead of reporting false extraction success', async () => {
  const ctx = load('copart');
  ctx.chrome.runtime.sendMessage = async () => ({ success: false, error: 'Cancelled capture' });
  const response = await new Promise(resolve => ctx.chrome.runtime.onMessage.listeners[0]({ action: 'SCRAPE_NOW', requestId: 'old' }, {}, resolve));
  assert.equal(response.success, false); assert.equal(response.error, 'Cancelled capture');
});

test('Copart numeric JSON mileage can use matching visible units; explicit kW is converted to horsepower', async () => {
  const nd = { lot: { ln: 12345, lcy: 2020, mkn: 'BMW', mdn: 'X5', od: 10000 } };
  const data = await load('copart', { nd, text: 'Odometer: 10,000 mi\nHorsepower: 150 kw' }).testHooks.scrape();
  assert.equal(data.odometerKm, 16093); assert.equal(data.horsepower, '204'); assert.equal(data.raw.power, '150 kw');
  const other = await load('copart', { nd, text: 'Odometer: 20,000 mi' }).testHooks.scrape();
  assert.equal(other.odometerKm, null);
  nd.lot.od = 0; nd.lot.odometerUnit = 'mi';
  assert.equal((await load('copart', { nd }).testHooks.scrape()).odometerKm, 0);
});
