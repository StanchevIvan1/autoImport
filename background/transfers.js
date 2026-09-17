// Ownership for the existing popup -> worker -> content-script workflow.
// One serialized writer prevents overlapping captures, clears and transfers from
// resurrecting old state. A destination keeps its immutable vehicle snapshot.
const AutoImportTransfers = (() => {
  const KEY = 'importState';
  const OVERRIDES = 'vehicleOverrides';
  // Use the verified page identity, never a mutable tab or scrape ID.
  const vehicleKey = data => {
    const url = new URL(data.capture.sourceUrl);
    const lot = url.pathname.match(/^\/lot\/(\d+)/i);
    return lot ? 'copart:' + lot[1] : data.source + ':' + url.origin + url.pathname + url.search;
  };
  async function corrections(data) {
    const saved = await chrome.storage.local.get(OVERRIDES);
    return saved[OVERRIDES]?.[vehicleKey(data)] || {};
  }
  const LEGACY = ['__ai_phase2_pending', '__ai_pending_images'];
  const FORM_URL = 'https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=1';
  const MAX_AGE = 2 * 60 * 60 * 1000;
  let queue = Promise.resolve();
  const serial = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const canonical = value => { const url = new URL(value); url.hash = ''; return url.href; };
  const source = url => AutoImportVehicle.route(url)?.source || null;
  function mobile(url) {
    try { const u = new URL(url); return u.protocol === 'https:' && ['mobile.bg', 'www.mobile.bg'].includes(u.hostname) && u.pathname === '/pcgi/mobile.cgi'; }
    catch (_) { return false; }
  }
  const mobileHost = value => { try { const u = new URL(value); return u.protocol === 'https:' && ['mobile.bg', 'www.mobile.bg'].includes(u.hostname); } catch (_) { return false; } };
  const stopped = job => ['cancelled', 'detached', 'expired'].includes(job.phase);
  const popup = sender => !sender.tab && sender.url === chrome.runtime.getURL('popup/popup.html');
  function requirePopup(sender) { if (!popup(sender)) throw Error('Невалиден подател.'); }
  async function read() {
    const stored = await chrome.storage.local.get(KEY);
    const state = stored[KEY] || { sources: {}, requests: {}, transfers: {} };
    for (const [tab, job] of Object.entries(state.transfers)) {
      if (Date.now() - job.createdAt > MAX_AGE && !stopped(job)) { job.phase = 'expired'; job.error = 'Прехвърлянето е изтекло. Започни повторен опит.'; await write(state); }
    }
    return state;
  }
  async function write(state, extra = {}) { await chrome.storage.local.set({ [KEY]: state, ...extra }); }
  async function owned(state, sender, id) {
    if (!sender.tab || (sender.frameId != null && sender.frameId !== 0) || !mobile(sender.url || sender.tab.url)) throw Error('Невалидна страница за прехвърляне.');
    const tab = await chrome.tabs.get(sender.tab.id);
    if (!mobile(tab.url)) throw Error('Страницата е сменена.');
    const job = state.transfers[sender.tab.id];
    if (!job || !id || job.id !== id) throw Error('Прехвърлянето е изчистено или принадлежи на друга обява.');
    if (stopped(job)) throw Error(job.error || 'Прехвърлянето е отменено.');
    if (job.documentId && sender.documentId && job.documentId !== sender.documentId) throw Error('Страницата е презаредена.');
    return job;
  }
  function validate(data, expectedSource, url) {
    if (data?.schemaVersion === 1 && (!data.identity?.verified || data.identity.sourceId !== AutoImportVehicle.route(url)?.id)) throw Error('Не е потвърдено, че данните са за текущата обява. Презареди и извлечи отново.');
    if (!data || data.source !== expectedSource || canonical(data.lotUrl) !== url) throw Error('Обявата е сменена. Извлечи отново.');
    if (!String(data.make || '').trim() || !String(data.model || '').trim() || !/^\d{4}$/.test(String(data.year)) || Number(data.year) < 1900 || Number(data.year) > new Date().getFullYear() + 1) {
      throw Error('Липсват надеждни марка, модел или година. Изчакай обявата и извлечи отново.');
    }
    if (!Array.isArray(data.images)) data.images = [];
    data.images = [...new Set(data.images.filter(value => {
      try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch (_) { return false; }
    }))];
  }
  async function handle(msg, sender) {
    return serial(async () => {
      const state = await read();
      if (msg.action === 'LIST_TRANSFERS') {
        requirePopup(sender);
        return { success: true, transfers: Object.values(state.transfers) };
      }
      if (['CANCEL_JOB', 'RETRY_TRANSFER'].includes(msg.action)) {
        requirePopup(sender);
        const job = Object.values(state.transfers).find(j => j.id === msg.transferId);
        if (!job) throw Error('Прехвърлянето е изчистено.');
        if (msg.action === 'CANCEL_JOB') {
          job.phase = 'cancelled'; job.error = 'Отменено от потребителя.';
          await write(state);
          await chrome.tabs.sendMessage(job.destinationTabId, { action: 'CANCEL_TRANSFER', transferId: job.id }).catch(() => {});
          return { success: true, transfer: job };
        }
        const duplicate = Object.values(state.transfers).find(j => j.retryOf === job.id && !stopped(j));
        if (duplicate) return { success: true, transfer: duplicate, duplicate: true };
        const tab = await chrome.tabs.create({ url: FORM_URL, active: false });
        const retry = { id: crypto.randomUUID(), retryOf: job.id, destinationTabId: tab.id,
          data: structuredClone(job.data), settings: structuredClone(job.settings), imagePolicy: 'automatic-v1',
          phase: 'created', createdAt: Date.now(), n: 0 };
        job.phase = 'cancelled'; job.error = 'Заменено с повторен опит в нова форма.';
        if (state.transfers[tab.id]) state.transfers[state.transfers[tab.id].id] = state.transfers[tab.id];
        state.transfers[tab.id] = retry;
        await write(state);
        await chrome.tabs.sendMessage(job.destinationTabId, { action: 'CANCEL_TRANSFER', transferId: job.id }).catch(() => {});
        return { success: true, transfer: retry };
      }
      if (msg.action === 'BEGIN_SCRAPE') {
        requirePopup(sender);
        const tab = await chrome.tabs.get(msg.tabId);
        if (!source(tab.url)) throw Error('Отвори конкретна Copart/IAAI обява.');
        const request = { id: crypto.randomUUID(), url: canonical(tab.url) };
        state.requests[tab.id] = request;
        // A failed or cancelled new scrape must not expose the old capture.
        delete state.sources[tab.id];
        await write(state);
        return { success: true, requestId: request.id };
      }
      if (msg.action === 'SAVE_CAR_DATA') {
        const tabId = sender.tab?.id;
        const request = state.requests[tabId];
        if (!request || request.id !== msg.requestId || (sender.frameId != null && sender.frameId !== 0)) throw Error('Извличането е отменено.');
        const tab = await chrome.tabs.get(tabId);
        if (canonical(tab.url) !== request.url || canonical(sender.url || sender.tab.url) !== request.url) throw Error('Обявата е сменена. Извлечи отново.');
        const data = structuredClone(msg.data);
        validate(data, source(tab.url), request.url);
        data.capture = { id: request.id, sourceTabId: tabId, sourceUrl: request.url };
        data.overrides = await corrections(data);
        state.sources[tabId] = data;
        delete state.requests[tabId];
        await write(state, { carData: data });
        return { success: true, data };
      }
      if (msg.action === 'GET_CAR_DATA' || msg.action === 'GET_STATUS') {
        requirePopup(sender);
        let data = null;
        if (Number.isInteger(msg.sourceTabId)) {
          const tab = await chrome.tabs.get(msg.sourceTabId);
          const candidate = state.sources[tab.id];
          if (candidate?.capture.sourceUrl === canonical(tab.url)) data = candidate;
        } else {
          data = (await chrome.storage.local.get('carData')).carData || null;
          if (!data?.capture || state.sources[data.capture.sourceTabId]?.capture.id !== data.capture.id) data = null;
        }
        if (data) data.overrides = await corrections(data);
        return { success: true, data, hasData: !!data };
      }
      if (msg.action === 'SAVE_OVERRIDES') {
        requirePopup(sender);
        const data = Object.values(state.sources).find(d => d.capture.id === msg.captureId);
        if (!data) throw Error('Обявата е сменена или изчистена.');
        const tab = await chrome.tabs.get(data.capture.sourceTabId);
        if (canonical(tab.url) !== data.capture.sourceUrl) throw Error('Обявата е сменена. Извлечи отново.');
        if (!['horsepower', 'modification'].includes(msg.field)) throw Error('Невалидна корекция.');
        const value = String(msg.value ?? '').trim();
        if (msg.field === 'horsepower' && value && (!/^\d+$/.test(value) || Number(value) <= 0 || Number(value) > 10000)) throw Error('Въведи конски сили между 1 и 10000 или остави празно.');
        if (value.length > 200) throw Error('Корекцията е твърде дълга (до 200 знака).');
        const saved = (await chrome.storage.local.get(OVERRIDES))[OVERRIDES] || {};
        const key = vehicleKey(data);
        const fields = { ...(saved[key] || {}) };
        if (value) fields[msg.field] = value; else delete fields[msg.field];
        if (Object.keys(fields).length) saved[key] = fields; else delete saved[key];
        await chrome.storage.local.set({ [OVERRIDES]: saved });
        return { success: true };
      }
      if (msg.action === 'CLEAR_CAR_DATA') {
        requirePopup(sender);
        const tabs = Object.keys(state.transfers);
        await write({ sources: {}, requests: {}, transfers: {} });
        await chrome.storage.local.remove(['carData', OVERRIDES, ...LEGACY]);
        await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(Number(tab), { action: 'CANCEL_TRANSFER' })));
        return { success: true };
      }
      if (msg.action === 'START_TRANSFER') {
        requirePopup(sender);
        const data = Object.values(state.sources).find(d => d.capture.id === msg.captureId);
        if (!data) throw Error('Данните са сменени или изчистени. Извлечи отново.');
        const sourceTab = await chrome.tabs.get(data.capture.sourceTabId);
        if (canonical(sourceTab.url) !== data.capture.sourceUrl) throw Error('Изходната обява е сменена. Извлечи отново.');
        // Double clicks and reopening the popup reuse the same destination.
        const existing = Object.values(state.transfers).find(j => j.data.capture.id === data.capture.id && (!msg.tabId || j.destinationTabId === msg.tabId));
        if (existing) return { success: true, transfer: existing, duplicate: true };
        let tab;
        if (Number.isInteger(msg.tabId)) {
          tab = await chrome.tabs.get(msg.tabId);
          if (!mobile(tab.url) || new URL(tab.url).searchParams.get('pubtype') !== '1') throw Error('Отвори формата за нова обява.');
          if (state.transfers[tab.id] && !stopped(state.transfers[tab.id])) throw Error('Този таб принадлежи на друга обява. Започни от аукционния таб за нова обява.');
        } else {
          // Never choose an arbitrary existing form, which may contain another car.
          tab = await chrome.tabs.create({ url: FORM_URL, active: false });
        }
        const settings = { ...(msg.settings || {}) };
        delete settings.imagesReviewedCaptureId;
        Object.assign(settings, await corrections(data));
        const snapshot = structuredClone(data);
        // Keep images in the same immutable snapshot as the vehicle.
        const job = { id: crypto.randomUUID(), destinationTabId: tab.id, data: snapshot, settings, imagePolicy: 'automatic-v1', phase: 'created', createdAt: Date.now(), n: 0 };
        if (state.transfers[tab.id]) state.transfers[state.transfers[tab.id].id] = state.transfers[tab.id];
        state.transfers[tab.id] = job;
        await write(state);
        return { success: true, transfer: job };
      }
      if (msg.action === 'GET_TRANSFER') {
        if (!sender.tab || !mobile(sender.url || sender.tab.url)) return { success: true, transfer: null };
        const job = state.transfers[sender.tab.id];
        if (job) {
          if (stopped(job)) return { success: true, transfer: null };
          if (job.documentId && sender.documentId && job.documentId !== sender.documentId) {
            job.documentId = sender.documentId;
            if (['filling', 'resuming'].includes(job.phase)) {
              job.phase = 'failed'; job.error = 'Попълването е прекъснато. Използвай повторен опит в нова форма.';
            }
            await write(state);
          }
          await owned(state, sender, job.id);
          // Repair transfers created by the former unchecked-review gate, but
          // never borrow images from another capture (even in the same tab).
          if (!job.imagePolicy) {
            const capture = state.sources[job.data.capture?.sourceTabId];
            if (!job.data.images.length && capture?.capture.id === job.data.capture?.id && capture.capture.sourceUrl === job.data.capture.sourceUrl) {
              job.data.images = structuredClone(capture.images);
            }
            job.imagePolicy = 'automatic-v1';
            await write(state);
          }
        }
        return { success: true, transfer: job || null };
      }
      const job = await owned(state, sender, msg.transferId);
      if (msg.action === 'CHECK_TRANSFER') {
        if (job.phase === 'failed') throw Error(job.error || 'Прехвърлянето е спряно.');
        return { success: true, transfer: job };
      }
      if (msg.action === 'CLAIM_TRANSFER') {
        const next = msg.resume ? ['phase2', 'resuming'] : ['created', 'filling'];
        if (job.phase !== next[0]) throw Error('Прехвърлянето вече е започнато.');
        job.phase = next[1];
        job.documentId = sender.documentId;
      } else if (msg.action === 'SAVE_PHASE2') {
        if (job.phase !== 'filling') throw Error('Невалиден етап.');
        delete job.documentId;
        job.phase = 'phase2'; job.n = Number(msg.n) || 0;
        job.formIdentity = msg.formIdentity;
      } else if (msg.action === 'FORM_FILLED') {
        if (!['filling', 'resuming'].includes(job.phase)) throw Error('Невалиден етап.');
        delete job.documentId;
        job.phase = job.data.images.length ? 'images' : 'completed';
        job.result = { formFilled: true, imagesExpected: Math.min(17, job.data.images.length), imagesAssigned: 0, uploadConfirmed: false, warnings: Array.isArray(msg.warnings) ? msg.warnings.map(String) : [] };
        job.formIdentity = msg.formIdentity || job.formIdentity;
      } else if (msg.action === 'IMAGES_ASSIGNED') {
        if (!['images', 'imagesAssigned'].includes(job.phase)) throw Error('Невалиден етап за снимки.');
        job.result = { ...(job.result || {}), imagesAssigned: Number(msg.assigned) || 0, imagesFailed: Number(msg.failures) || 0, uploadConfirmed: false };
        job.phase = 'imagesAssigned'; // Kept until clear/close; assignment is not server upload confirmation.
      } else if (msg.action === 'TRANSFER_FAILED') {
        if (msg.onlyIfCreated && job.phase !== 'created') return { success: true, transfer: job };
        if (['imagesAssigned', 'completed'].includes(job.phase)) return { success: true, transfer: job };
        job.phase = 'failed'; job.error = String(msg.error || 'Неуспешно прехвърляне.');
      } else throw Error('Непозната операция.');
      await write(state);
      return { success: true, transfer: job };
    });
  }
  async function authorizeImage(msg, sender) {
    return serial(async () => {
      const job = await owned(await read(), sender, msg.transferId);
      if (!['images', 'imagesAssigned'].includes(job.phase) || !job.data.images.includes(msg.url)) throw Error('Снимката не принадлежи на това прехвърляне.');
    });
  }
  chrome.tabs.onRemoved.addListener(tabId => {
    serial(async () => {
      const state = await read();
      delete state.sources[tabId]; delete state.requests[tabId];
      if (state.transfers[tabId]) { state.transfers[tabId].phase = 'detached'; state.transfers[tabId].error = 'Табът е затворен. Данните са запазени за повторен опит.'; }
      await write(state);
    }).catch(console.error);
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (!change.url) return;
    serial(async () => {
      const state = await read();
      if (state.sources[tabId]?.capture.sourceUrl !== canonical(change.url)) delete state.sources[tabId];
      if (state.requests[tabId]?.url !== canonical(change.url)) delete state.requests[tabId];
      if (!mobileHost(change.url) && state.transfers[tabId]) { state.transfers[tabId].phase = 'detached'; state.transfers[tabId].error = 'Напусната е страницата на mobile.bg.'; }
      await write(state);
    }).catch(console.error);
  });
  chrome.runtime.onStartup.addListener(() => {
    serial(async () => {
      const state = await read();
      state.sources = {}; state.requests = {};
      for (const job of Object.values(state.transfers)) { job.phase = 'detached'; job.error = 'Браузърът е рестартиран. Използвай повторен опит.'; }
      await write(state);
      await chrome.storage.local.remove(['carData', ...LEGACY]);
    }).catch(console.error);
  });
  // Legacy pending values have no provable destination and must never auto-run.
  serial(() => chrome.storage.local.remove(LEGACY)).catch(console.error);
  return { handle, authorizeImage, mobile };
})();
