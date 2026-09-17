const { test } = require('node:test');
const assert = require('node:assert/strict');
const { context, run, select } = require('./harness.cjs');
const { scraper } = require('./baseline.test.cjs');
const { extension, filler, settle, form } = require('./extension.cjs');
const ctx = context(); run('shared/vehicle.js', ctx);
const V = ctx.AutoImportVehicle;
const base = { source: 'copart', lotUrl: 'https://www.copart.com/lot/12345', year: '2020', make: 'BMW', model: 'X5', images: [] };

test('normalized model preserves raw units and rejects ambiguous readings', () => {
  for (const [raw, unit, expected] of [['10,000 mi','',16093], ['10000','km',10000], ['0','mi',0], ['10.5 mi','',17], ['1,23 mi','',null], ['10000','',null], ['100 km','mi',null], ['100 mi (NOT ACTUAL)','',null], ['100 mi 200 km','',null]]) {
    const d = V.normalize({ ...base, raw: { odometer: raw, odometerUnit: unit } });
    assert.equal(d.odometerKm, expected, raw); assert.equal(d.raw.odometer, raw); assert.equal(d.raw.odometerUnit, unit);
  }
});
test('fuel categories cannot confuse natural gas, LPG, hybrid, electricity and flex fuel', () => {
  for (const [raw, expected] of [['GAS','Бензин'], ['natural gas','Метан'], ['LPG','Газ'], ['Gas Electric Hybrid','Хибриден'], ['PHEV','Plug-in хибрид'], ['electric','Електрически'], ['diesel','Дизел'], ['flex fuel',''], ['gas/diesel',''], ['hydrogen','']]) {
    const d = V.normalize({ ...base, raw: { fuel: raw } });
    assert.equal(d.fuel, expected); assert.equal(d.raw.fuel, raw);
    if (!expected) assert.equal(d.fieldStatus.fuel, 'manual-review');
  }
});
test('VIN, engine, power, body and transmission normalize without invented defaults', () => {
  const d = V.normalize({ ...base, raw: { vin: '1HGCM82633A004352', engine: '1998 cc', power: '150 kW', transmission: 'CVT', bodyType: 'minivan', drive: '4x4' } });
  assert.equal(d.vin, '1HGCM82633A004352'); assert.equal(d.displacement, '1998'); assert.equal(d.horsepower, '204'); assert.equal(d.transmission, 'Автоматична'); assert.equal(d.bodyType, 'Миниван');
  const unknown = V.normalize({ ...base, raw: { year: '20', vin: '1HGCM82633A00****', engine: '2.0L / 3.0L', power: '150/200 hp', transmission: 'automated manual', bodyType: 'special truck' } });
  for (const field of ['year','vin','displacement','horsepower','transmission','bodyType']) assert.equal(unknown[field], '', field);
  assert.equal(unknown.raw.vin, '1HGCM82633A00****');
});
test('Copart current structured lot wins over recommendations and preserves raw fields', async () => {
  const data = await scraper('content_scripts/copart_scraper.js', { title: '2020 BMW X5', hidden: { __NEXT_DATA__: { textContent: JSON.stringify({ recommended: { ln: 999, mkn: 'Ford', mdn: 'Mustang' }, current: { ln:12345,lcy:2020,mkn:'BMW',mdn:'X5',od:10000,odometerUnit:'km',ft:'CNG',egn:'3.0L',hp:'150 kW' } }) } } });
  assert.equal(data.identity.verified, true); assert.equal(data.make,'BMW'); assert.equal(data.raw.fuel,'CNG'); assert.equal(data.odometerKm,10000); assert.equal(data.fuel,'Метан');
});
test('IAAI stale item ID and contradictory title are rejected', async () => {
  await assert.rejects(scraper('content_scripts/iaai_scraper.js', { title:'2020 BMW X5',hidden:{hdnRequestedItemID:{value:'999'}} }), /друг автомобил/);
  await assert.rejects(scraper('content_scripts/iaai_scraper.js', { title:'2020 BMW X5',hidden:{hdnYearMakeModelSeries:{value:'2019 TOYOTA CAMRY'}} }), /не съвпадат/);
});
test('unverified page identity is retained for review but cannot be transferred', async () => {
  const data = await scraper('content_scripts/copart_scraper.js', { title:'2020 BMW X5' });
  assert.equal(data.identity.verified,false);
  await assert.rejects(extension().capture(1,data), /Не е потвърдено/);
});
test('source route contract includes existing item routes and excludes search/kar/unsupported hosts', () => {
  for (const path of ['VehicleDetail/12345~US','vehicles/12345','vehicle/12345','buy/12345']) assert.equal(V.route('https://www.iaai.com/'+path).id,'12345');
  for (const url of ['https://www.iaai.com/Search','https://www.iaai.com/buy/something','https://kar.bg/','https://copart.com.evil.test/lot/12345','https://www.copart.co.uk/lot/12345']) assert.equal(V.route(url),null);
});
test('destination rejects duplicate options, substring guesses and site-rejected selections', () => {
  const e = extension(); const f = filler(e, { destinationTabId: 100 });
  assert.equal(f.ctx.testHooks.pickVal(select(['Choose','Plug-in хибрид']), 'Хибрид'), false);
  assert.equal(f.ctx.testHooks.pickVal(select(['Choose','BMW','BMW']), 'BMW'), false);
  const rejected = select(['Choose','BMW']); rejected.dispatchEvent = () => { rejected.value = ''; };
  assert.equal(f.ctx.testHooks.pickVal(rejected,'BMW'),false);
});
for (const source of ['copart','iaai']) test(source + ' extraction to owned transfer to mobile form', async () => {
  const hidden = source === 'copart' ? { __NEXT_DATA__: { textContent: JSON.stringify({lot:{ln:12345,lcy:2020,mkn:'BMW',mdn:'X5',ft:'GAS',egn:'3.0L',od:'10000 mi',tsmn:'AUTOMATIC'}}) } } : {hdnRequestedItemID:{value:'12345'},hdnVehicleMake:{value:'BMW'},hdnVehicleYear:{value:'2020'},hdnYearMakeModelSeries:{value:'2020 BMW X5'}};
  const data = await scraper(`content_scripts/${source}_scraper.js`, {title:'2020 BMW X5',hidden,text:'Odometer: 10000 mi\nEngine: 3.0L\nFuel: GAS\nTransmission: Automatic'});
  const e = extension(); const saved = await e.capture(1,data); const j = await e.start(saved);
  const f = filler(e,j); await settle(); await f.message({action:'START_FILL',transferId:j.id}); await settle();
  assert.equal(f.fields.f5.value,'BMW'); assert.equal(f.fields.f6.value,'X5'); assert.equal(f.fields.f16.value,'16093'); assert.equal(f.fields.f30.value,'3000'); assert.equal(f.fields.f8.value,'Бензинов');
  assert.equal(e.store.values.importState.transfers[j.destinationTabId].phase,'completed');
});
test('IAAI preserves an engine value ending immediately after litres', async () => {
  const data = await scraper('content_scripts/iaai_scraper.js', {title:'2020 BMW X5',text:'Engine: 3.0L\nFuel: CNG'});
  assert.equal(data.raw.engine,'3.0L'); assert.equal(data.displacement,'3000'); assert.equal(data.fuel,'Метан');
});
test('Copart visible conflicting lot and conflicting title stop extraction', async () => {
  const hidden = {__NEXT_DATA__:{textContent:JSON.stringify({lot:{ln:12345,lcy:2020,mkn:'BMW',mdn:'X5'}})}};
  await assert.rejects(scraper('content_scripts/copart_scraper.js',{hidden,title:'2020 BMW X5',text:'Lot number: 99999'}),/не съвпада/);
  await assert.rejects(scraper('content_scripts/copart_scraper.js',{hidden,title:'2019 Toyota Camry'}),/различни автомобили/);
});
test('IAAI two-word make is preserved when the make hidden field is missing', async () => {
  const d = await scraper('content_scripts/iaai_scraper.js',{title:'2020 LAND ROVER DISCOVERY'});
  assert.equal(d.make,'LAND ROVER'); assert.equal(d.model,'DISCOVERY');
});
test('unknown names, color and cylinder counts stay manual rather than inventing facts', () => {
  const d = V.normalize({...base, raw:{make:'UNKNOWN',model:'N/A',color:'Invisible',cylinders:'99'}});
  for (const field of ['make','model','color','cylinders']) assert.equal(d[field],'');
  assert.equal(d.raw.color,'Invisible');
});
test('destination late mutation is caught before a successful result', async () => {
  const e = extension(); const j = await e.start(await e.capture(1)); const page = form();
  page.fields.f15.dispatchEvent = () => { page.fields.f6.value = 'CAMRY'; };
  const f = filler(e,j,page); await settle(); await f.message({action:'START_FILL',transferId:j.id}); await settle();
  assert.equal(e.store.values.importState.transfers[j.destinationTabId].phase,'failed');
});
test('conflicting duplicate structured current lots cannot be merged', async () => {
  const hidden = {__NEXT_DATA__:{textContent:JSON.stringify({old:{ln:12345,lcy:2020,mkn:'Ford',mdn:'Mustang'},current:{ln:12345,lcy:2020,mkn:'BMW',mdn:'X5'}})}};
  await assert.rejects(scraper('content_scripts/copart_scraper.js',{hidden,title:'2020 BMW X5'}),/Противоречиви/);
});
test('review panel and popup scripts are included in the actual markup', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname,'../popup/popup.html'),'utf8');
  assert.match(html,/id="vehicle-review"/); assert.ok(html.indexOf('../shared/vehicle.js') < html.indexOf('src="popup.js"'));
});
test('missing optional destination field is retained as a warning', async () => {
  const e = extension(); const j = await e.start(await e.capture(1, {...base,fuel:'Бензин'})); const page = form(); delete page.fields.f8;
  const f = filler(e,j,page); await settle(); await f.message({action:'START_FILL',transferId:j.id}); await settle();
  assert.match(e.store.values.importState.transfers[j.destinationTabId].result.warnings.join(' '),/Липсва избор/);
});
test('scoped text removes recommended content before fallback scanning', () => {
  let removed = false;
  const copy = { get textContent() { return removed ? 'Fuel: GAS' : 'Fuel: GAS\nFuel: DIESEL'; }, querySelectorAll(selector) { assert.match(selector,/recommend/); return [{remove() { removed = true; }}]; } };
  const result = V.scope({querySelector:()=>null,body:{cloneNode:()=>copy}});
  assert.equal(result.textContent,'Fuel: GAS');
});
test('IAAI image keys exclude another lot and tolerate malformed encoding', async () => {
  const image = key => ({src:'https://vis.iaai.com/resizer?imageKeys='+key+'&width=100&height=100',getAttribute(){return '';}});
  const d = await scraper('content_scripts/iaai_scraper.js',{title:'2020 BMW X5',hidden:{hdnRequestedItemID:{value:'12345'}},images:[image('999~SID~1~I1~RW100'),image('%ZZ'),image('12345~SID~1~I1~RW100')]});
  assert.equal(d.images.length,1); assert.match(d.images[0],/12345~/);
});

test('auction mileage status suffix converts automatically and body descriptions map to categories', async () => {
  for (const text of ['179,297 mi Actual', '179,297 mi (ACTUAL)', '179,297 mi - Actual']) assert.equal(V.mileage(text), Math.round(179297*1.609344));
  assert.equal(V.mileage('179,297 km Actual'),179297);
  assert.equal(V.mileage('179,297 mi NOT ACTUAL'),null);
  for (const [raw,expected] of [['SEDAN 4D','Седан'],['4 Door Sedan','Седан'],['SPORT UTILITY 4D','SUV'],['COUPE 2D','Купе'],['Station Wagon','Комби'],['Sedan / Coupe','']]) assert.equal(V.normalize({...base,raw:{bodyType:raw}}).bodyType,expected);
  const data = V.normalize({...base,raw:{odometer:'179,297 mi Actual',bodyType:'SEDAN 4D'}});
  const e = extension(); const saved = await e.capture(1,{...data,identity:{verified:true,sourceId:'12345'}});
  const j = await e.start(saved); const page = form(); page.fields.f11 = select(['Choose','Седан','Купе','Джип']);
  const f = filler(e,j,page); await settle(); await f.message({action:'START_FILL',transferId:j.id}); await settle();
  assert.equal(f.fields.f16.value,String(Math.round(179297*1.609344))); assert.equal(f.fields.f11.value,'Седан');
});
