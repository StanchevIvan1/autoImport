const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extension, car, filler, form, settle } = require('./extension.cjs');
const { run, element, select } = require('./harness.cjs');

test('complete form path keeps working selectors and applies requested month and equipment defaults while preserving Euro and condition', async () => {
  const e = extension(); const a = await e.capture(1, car('12345', { odometerKm: 0, fuel: 'Бензин', transmission: 'Автоматична', bodyType: 'SUV', displacement: '3000', primaryDamage: 'FRONT END', vin: 'WBA12345678901234' }));
  const job = await e.start(a, { horsepower: '250', phone: '0881234567', city: 'София', descTemplate: '{мощност} {щета} {пробег}' });
  const f = filler(e, job); await settle();
  assert.equal((await f.message({ action: 'START_FILL', transferId: job.id })).success, true); await settle();
  assert.equal(f.fields.f5.value, 'BMW'); assert.equal(f.fields.f6.value, 'X5'); assert.equal(f.fields.f9.value, '250');
  assert.equal(f.fields.f16.value, '0'); assert.equal(f.fields.f30.value, '3000'); assert.equal(f.fields.f22.value, '0881234567');
  assert.notEqual(f.fields.f14.value, ''); assert.equal(f.fields.f29.value, ''); assert.equal(f.fields.f25.value, '');
  assert.equal(f.boxes.find(box => box.value === 'Аларма').checked, true); assert.match(f.fields.f21.value, /250 к.с. FRONT END 0 км/);
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].phase, 'images');
});
test('a populated destination is rejected before any vehicle field is overwritten', async () => {
  const e = extension(); const a = await e.capture(1); const job = await e.start(a); const page = form(); page.fields.f5.value = 'Toyota';
  const f = filler(e, job, page); await settle(); await f.message({ action: 'START_FILL', transferId: job.id }); await settle();
  assert.equal(f.fields.f5.value, 'Toyota'); assert.equal(f.fields.f6.value, '');
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].phase, 'failed');
});
test('region reload resumes only its own tab; reinjection does not consume the same phase twice', async () => {
  const e = extension(); const a = await e.capture(1); const job = await e.start(a, { region: 'София', city: 'София', phone: '123' });
  const initialPage = form(); initialPage.fields.f18.value = '';
  const first = filler(e, job, initialPage); await settle(); await first.message({ action: 'START_FILL', transferId: job.id }); await settle();
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].phase, 'phase2');
  const b = await e.capture(2, car('67890')); const other = await e.start(b); filler(e, other); await settle();
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].phase, 'phase2');
  const reloaded = filler(e, job, { ...form(), fields: first.fields, document: first.document, boxes: first.boxes, ids: first.ids });
  await settle(); run('content_scripts/mobile_filler.js', reloaded.ctx); await settle();
  assert.equal(reloaded.onMessage.listeners.length, 1);
  assert.equal(first.fields.f22.value, '123');
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].phase, 'images');
});
test('unknown city and ambiguous model are not replaced with first matching choices', async () => {
  const e = extension(); const a = await e.capture(1); const job = await e.start(a, { city: 'Missing City' });
  const f = filler(e, job); await settle(); await f.message({ action: 'START_FILL', transferId: job.id }); await settle();
  assert.equal(f.fields.f19.value, '');
  const model = select(['Choose','Grand Cherokee L','Grand Cherokee S']);
  assert.equal(f.ctx.testHooks.pickModel(model, 'Grand Cherokee Special'), false); assert.equal(model.value, '');
  const region = select(['Choose','София град','София област']);
  assert.equal(f.ctx.testHooks.pickVal(region, 'София'), false);
});
test('duplicate START_FILL and reinjection cannot run a second fill', async () => {
  const e = extension(); const a = await e.capture(1); const job = await e.start(a); const f = filler(e, job); await settle();
  await f.message({ action: 'START_FILL', transferId: job.id }); await settle();
  f.fields.f9.value = 'manual edit';
  const result = await f.message({ action: 'START_FILL', transferId: job.id });
  run('content_scripts/mobile_filler.js', f.ctx); await settle();
  assert.equal(result.success, false); assert.equal(f.fields.f9.value, 'manual edit'); assert.equal(f.onMessage.listeners.length, 1);
});
test('clearing during an image fetch prevents late assignment and leaves no pending images', async () => {
  const e = extension(); const a = await e.capture(1, car('12345', { images: ['https://cs.copart.com/a.jpg'] }));
  const job = await e.start(a, { imagesReviewedCaptureId: a.capture.id }); const sender = e.fromTab(job.destinationTabId);
  await e.send({ action: 'CLAIM_TRANSFER', transferId: job.id }, sender); await e.send({ action: 'FORM_FILLED', transferId: job.id }, sender);
  const page = form();
  const f = filler(e, job, page); await settle(); // no file input: prevent automatic upload
  page.document.fileInput = element(); page.document.fileInput.files = [];
  let finishFetch;
  const original = f.ctx.chrome.runtime.sendMessage;
  f.ctx.chrome.runtime.sendMessage = message => message.action === 'FETCH_IMAGE_AS_BASE64' ? new Promise(resolve => { finishFetch = resolve; }) : original(message);
  f.ctx.fetch = async () => ({ blob: async () => new Blob(['image'], { type: 'image/jpeg' }) });
  f.ctx.DataTransfer = class { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } };
  const upload = f.ctx.testHooks.autoUploadImages(job.data.images, element()); await settle();
  await e.send({ action: 'CLEAR_CAR_DATA' });
  finishFetch({ success: true, dataUrl: 'data:image/jpeg;base64,aQ==', mimeType: 'image/jpeg' });
  assert.equal(await upload, false); assert.equal(page.document.fileInput.files.length, 0);
  assert.equal(Object.keys(e.store.values.importState.transfers).length, 0);
});

test('editing vehicle identity after fill invalidates automatic images while preserving user edits', async () => {
  const e = extension(); const a = await e.capture(1); const job = await e.start(a); const f = filler(e, job);
  await settle(); await f.message({ action: 'START_FILL', transferId: job.id }); await settle();
  f.fields.f6.value = 'CAMRY';
  for (const listener of f.document.listeners.change) listener();
  await settle();
  assert.equal(f.fields.f6.value, 'CAMRY');
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].phase, 'failed');
});

test('a changed model after region reload cannot receive phase-two data', async () => {
  const e = extension(); const a = await e.capture(1); const job = await e.start(a, { region: 'София', phone: '123' });
  const initialPage = form(); initialPage.fields.f18.value = '';
  const first = filler(e, job, initialPage); await settle(); await first.message({ action: 'START_FILL', transferId: job.id }); await settle();
  first.fields.f6.value = 'CAMRY';
  filler(e, job, first); await settle();
  assert.equal(first.fields.f22.value, '');
  assert.equal(e.store.values.importState.transfers[job.destinationTabId].phase, 'failed');
});

test('image assignment retains owned URLs on partial failure and cannot overwrite existing selections', async () => {
  const e = extension(); const a = await e.capture(1, car('12345', { images: ['https://cs.copart.com/a.jpg', 'https://cs.copart.com/b.jpg'] }));
  const job = await e.start(a, { imagesReviewedCaptureId: a.capture.id }); const sender = e.fromTab(job.destinationTabId);
  await e.send({ action: 'CLAIM_TRANSFER', transferId: job.id }, sender); await e.send({ action: 'FORM_FILLED', transferId: job.id }, sender);
  const page = form(); const f = filler(e, job, page); await settle();
  page.document.fileInput = element(); page.document.fileInput.files = [];
  const original = f.ctx.chrome.runtime.sendMessage;
  f.ctx.chrome.runtime.sendMessage = async message => message.action === 'FETCH_IMAGE_AS_BASE64' ?
    { success: message.url.endsWith('a.jpg'), dataUrl: 'data:image/jpeg;base64,aQ==', mimeType: 'image/jpeg' } : original(message);
  f.ctx.fetch = async () => ({ blob: async () => new Blob(['image'], { type: 'image/jpeg' }) });
  f.ctx.DataTransfer = class { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } };
  const status = element();
  const [first, duplicate] = await Promise.all([f.ctx.testHooks.autoUploadImages(job.data.images, status), f.ctx.testHooks.autoUploadImages(job.data.images, status)]);
  assert.equal(first, true); assert.equal(duplicate, false); assert.equal(page.document.fileInput.files.length, 1);
  assert.match(status.textContent, /1\/2/); assert.match(status.textContent, /Провери/);
  const saved = e.store.values.importState.transfers[job.destinationTabId];
  assert.equal(saved.phase, 'imagesAssigned'); assert.equal(saved.data.images.length, 2);
  assert.equal(await f.ctx.testHooks.autoUploadImages(job.data.images, status), false);
  assert.equal(page.document.fileInput.files.length, 1);
});
