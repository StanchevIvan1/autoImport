const { test } = require('node:test');
const assert = require('node:assert/strict');
const { context, run, event, storage, select } = require('./harness.cjs');

function scraper(file, { title, hidden = {}, text = '', images = [] }) {
  const ctx = context({ location: { href: file.includes('copart') ? 'https://www.copart.com/lot/12345' : 'https://www.iaai.com/VehicleDetail/12345' },
    chrome: { runtime: { onMessage: event() } },
    document: { body: { innerText: text }, getElementById: id => hidden[id] || null,
      querySelector: sel => sel === 'h1' ? { innerText: title } : null,
      querySelectorAll: sel => sel.startsWith('img[') ? images : [] }
  });
  run(file, ctx, ['scrape']);
  return ctx.testHooks.scrape();
}
test('baseline Copart structured vehicle fields, mileage and displacement', async () => {
  const data = await scraper('content_scripts/copart_scraper.js', { title: '2020 BMW X5', hidden: {
    __NEXT_DATA__: { textContent: JSON.stringify({ props: { lot: { ln: 12345, lcy: 2020, mkn: 'BMW', mdn: 'X5', od: '10000 mi', egn: '3.0L 6', ft: 'GAS', tsmn: 'AUTOMATIC', drv: 'AWD', bst: 'SUV', clr: 'BLACK' } } }) }
  } });
  assert.equal(data.make, 'BMW'); assert.equal(data.model, 'X5'); assert.equal(data.odometerKm, 16093);
  assert.equal(data.displacement, '3000'); assert.equal(data.fuel, 'Бензин'); assert.equal(data.drive, '4x4');
});
test('baseline IAAI hidden title and text fallbacks', async () => {
  const data = await scraper('content_scripts/iaai_scraper.js', { title: '2019 Toyota Camry', hidden: {
    hdnVehicleMake: { value: 'TOYOTA' }, hdnVehicleYear: { value: '2019' }, hdnYearMakeModelSeries: { value: '2019 TOYOTA CAMRY' }
  }, text: 'Odometer:\n10,000 mi\nEngine:\n2.5L 203 hp\nTransmission:\nAutomatic\nColor:\nWhite' });
  assert.equal(data.make, 'Toyota'); assert.equal(data.model, 'CAMRY'); assert.equal(data.odometerKm, 16093);
  assert.equal(data.displacement, '2500'); assert.equal(data.horsepower, '203'); assert.equal(data.color, 'Бял');
});
test('baseline filler preserves exact selectors and common trim matching', () => {
  const ctx = context({ chrome: { storage: storage(), runtime: { onMessage: event(), sendMessage: async () => ({ success: true, transfer: null }) } },
    document: { querySelector: () => null }, HTMLSelectElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {} });
  run('content_scripts/mobile_filler.js', ctx, ['pickVal', 'pickModel', 'buildDesc']);
  const make = select(['Choose', 'BMW', 'Toyota']);
  assert.equal(ctx.testHooks.pickVal(make, 'bmw'), true); assert.equal(make.value, 'BMW');
  const model = select(['Choose', 'X3', 'X5']);
  assert.equal(ctx.testHooks.pickModel(model, 'X5 xDrive Premium'), true); assert.equal(model.value, 'X5');
  assert.match(ctx.testHooks.buildDesc({ make: 'BMW', model: 'X5', year: '2020' }, '{марка} {модел} {година}'), /^BMW X5 2020$/);
});

module.exports = { scraper };
