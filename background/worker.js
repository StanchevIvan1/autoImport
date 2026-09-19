importScripts('../shared/vehicle.js', '../shared/images.js', 'transfers.js', 'images.js');

// worker.js v5.2 – auth синхронизиран с реалния Node.js сървър
// ══════════════════════════════════════════════════════════
// СМЕНИ AUTH_SERVER с реалния URL на твоя сървър
// Примери: 'http://localhost:3000'  или  'https://api.autoimport.bg'
// ══════════════════════════════════════════════════════════
const AUTH_SERVER = 'http://localhost:3000';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дни локален кеш без re-verify

// Demo ключове – работят САМО ако сървърът не е достъпен (офлайн fallback)
const DEMO_KEYS = {
  'TEST-PRO':   { plan: 'Pro',   expiresAt: null },
  'TEST-BASIC': { plan: 'Basic', expiresAt: null },
};

// POST /auth/activate  →  { token, plan }
async function activateKey(key) {
  try {
    const res = await fetch(`${AUTH_SERVER}/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 401) return { ok: false, error: 'Невалиден ключ' };
    if (!res.ok)            return { ok: false, error: `Сървърна грешка (${res.status})` };
    const data = await res.json(); // { token, plan }
    if (!data.token) return { ok: false, error: 'Сървърът не върна токен' };
    return { ok: true, token: data.token, plan: data.plan || 'Pro' };
  } catch (e) {
    return null; // сървърът не е достъпен
  }
}

// GET /auth/verify  +  Authorization: Bearer {token}  →  { valid, plan }
async function verifyToken(token) {
  try {
    const res = await fetch(`${AUTH_SERVER}/auth/verify`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 401) return { ok: false, error: 'Сесията е изтекла' };
    if (!res.ok)            return { ok: false, error: `Сървърна грешка (${res.status})` };
    const data = await res.json(); // { valid, plan }
    return { ok: data.valid === true, plan: data.plan || 'Pro' };
  } catch (e) {
    return null; // сървърът не е достъпен
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── АКТИВИРАЙ ключ: key → сървър → token → съхрани локално ──
  if (msg.type === 'activate') {
    (async () => {
      const key = (msg.key || '').trim();
      if (!key) { sendResponse({ ok: false, error: 'Въведи ключ' }); return; }

      // 1. Опитай при сървъра
      let result = await activateKey(key);

      // 2. Ако сървърът не е достъпен → провери demo ключовете
      if (result === null) {
        const demo = DEMO_KEYS[key];
        if (demo) {
          // Demo режим: пази ключа директно (без server token)
          await chrome.storage.local.set({ auth: {
            key, token: null, plan: demo.plan,
            expiresAt: demo.expiresAt, verifiedAt: Date.now(), demo: true,
          }});
          sendResponse({ ok: true, plan: demo.plan, expiresAt: demo.expiresAt, key });
        } else {
          sendResponse({ ok: false, error: 'Сървърът не е достъпен. Провери URL-а в конфигурацията.' });
        }
        return;
      }

      // 3. Сървърът е върнал резултат
      if (!result.ok) {
        sendResponse({ ok: false, error: result.error || 'Невалиден ключ' });
        return;
      }

      // 4. Запази token-а локално
      await chrome.storage.local.set({ auth: {
        key, token: result.token, plan: result.plan,
        expiresAt: null, verifiedAt: Date.now(), demo: false,
      }});
      sendResponse({ ok: true, plan: result.plan, expiresAt: null, key });
    })();
    return true;
  }

  // ── ПРОВЕРИ валидност на текущия token ──
  if (msg.type === 'verify') {
    (async () => {
      const r = await chrome.storage.local.get('auth');
      const auth = r.auth;

      // Няма запазен auth
      if (!auth || (!auth.token && !auth.demo)) {
        sendResponse({ ok: false, error: 'Няма активен ключ' });
        return;
      }

      // Проверка за изтекъл абонамент (ако сървърът е върнал expiresAt)
      if (auth.expiresAt && Date.now() > new Date(auth.expiresAt).getTime()) {
        await chrome.storage.local.remove('auth');
        sendResponse({ ok: false, error: 'Абонаментът е изтекъл' });
        return;
      }

      const age = Date.now() - (auth.verifiedAt || 0);

      // Demo режим – нямаме server token, доверяваме се локално
      if (auth.demo) {
        sendResponse({ ok: true, plan: auth.plan, expiresAt: auth.expiresAt, key: auth.key });
        return;
      }

      // Ако token-ът е пресен (в TTL) – отговаряме веднага без заявка към сървъра
      if (age < TOKEN_TTL_MS) {
        sendResponse({ ok: true, plan: auth.plan, expiresAt: auth.expiresAt, key: auth.key });
        return;
      }

      // Token-ът е стар → re-verify при сървъра
      const result = await verifyToken(auth.token);

      if (result === null) {
        // Сървърът недостъпен → grace period 24ч след TTL
        const grace = 24 * 60 * 60 * 1000;
        if (age < TOKEN_TTL_MS + grace) {
          sendResponse({ ok: true, plan: auth.plan, expiresAt: auth.expiresAt, key: auth.key });
        } else {
          sendResponse({ ok: false, error: 'Не може да се провери. Провери интернет връзката.' });
        }
        return;
      }

      if (result.ok) {
        await chrome.storage.local.set({ auth: { ...auth, verifiedAt: Date.now(), plan: result.plan } });
        sendResponse({ ok: true, plan: result.plan, expiresAt: auth.expiresAt, key: auth.key });
      } else {
        await chrome.storage.local.remove('auth');
        sendResponse({ ok: false, error: result.error || 'Сесията е изтекла. Активирай ключа отново.' });
      }
    })();
    return true;
  }

  const transferActions = ['BEGIN_SCRAPE', 'SAVE_CAR_DATA', 'GET_CAR_DATA', 'GET_STATUS',
    'CLEAR_CAR_DATA', 'SAVE_OVERRIDES', 'START_TRANSFER', 'GET_TRANSFER', 'CHECK_TRANSFER', 'CLAIM_TRANSFER',
    'IMAGE_STATE', 'IMAGE_RETRY', 'LIST_TRANSFERS', 'CANCEL_JOB', 'RETRY_TRANSFER', 'SAVE_PHASE2', 'FORM_FILLED', 'IMAGES_ASSIGNED', 'TRANSFER_FAILED'];
  if (transferActions.includes(msg.action)) {
    AutoImportTransfers.handle(msg, sender).then(result => {
      if (['START_TRANSFER', 'RETRY_TRANSFER'].includes(msg.action) && result.success) {
        const job = result.transfer;
        if (job.phase === 'created') dispatchTransfer(job).catch(console.error);
        chrome.tabs.update(job.destinationTabId, { active: true }).then(tab =>
          chrome.windows.update(tab.windowId, { focused: true })).catch(console.error);
      }
      sendResponse(result);
    }).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Изтегли снимка от auction CDN (Copart/IAAI) и я върни като base64.
  // Service worker контекстът има extension host_permissions и не е обвързан
  // от CORS политиката на mobile.bg страницата, за разлика от content script fetch().
  if (msg.action === 'FETCH_IMAGE_AS_BASE64') {
    AutoImportImageFetch.fetchImage(msg, sender).then(sendResponse).catch(error => sendResponse({ success: false, error: error.message, code: error.code || 'fetch-failed' }));
    return true;
  }
});

// The worker owns dispatch before activating a tab can close the popup.
const dispatches = new Map();
function dispatchTransfer(job) {
  if (dispatches.has(job.id)) return dispatches.get(job.id);
  const pending = runDispatch(job).finally(() => dispatches.delete(job.id));
  dispatches.set(job.id, pending);
  return pending;
}
async function runDispatch(job) {
  const tabId = job.destinationTabId;
  const sender = { tab: { id: tabId }, url: 'https://www.mobile.bg/pcgi/mobile.cgi', frameId: 0 };
  try {
    let loaded = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const tab = await chrome.tabs.get(tabId);
      if (!AutoImportTransfers.mobile(tab.url)) return; // Wait for the same tab to return after login.
      if (tab.status === 'complete') { loaded = true; break; }
    }
    if (!loaded) throw Error('Формата не се зареди навреме.');
    const check = await AutoImportTransfers.handle({ action: 'CHECK_TRANSFER', transferId: job.id }, sender);
    if (check.transfer.phase !== 'created') return;
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await AutoImportTransfers.handle({ action: 'CHECK_TRANSFER', transferId: job.id }, sender);
      if (latest.transfer.phase !== 'created') return;
      const tab = await chrome.tabs.get(tabId);
      if (!AutoImportTransfers.mobile(tab.url)) return;
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['shared/images.js', 'content_scripts/mobile_filler.js'] });
        result = await chrome.tabs.sendMessage(tabId, { action: 'START_FILL', transferId: job.id });
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    if (!result?.success) {
      const latest = await AutoImportTransfers.handle({ action: 'CHECK_TRANSFER', transferId: job.id }, sender);
      if (latest.transfer.phase === 'created') throw Error(result?.error || 'Попълването не започна.');
    }
  } catch (error) {
    // A lost reply can mean the page already claimed the job or navigated.
    // Only a still-unclaimed job may be failed by the dispatcher.
    try {
      const result = await AutoImportTransfers.handle({ action: 'TRANSFER_FAILED', transferId: job.id, error: error.message, onlyIfCreated: true }, sender);
      if (result.transfer.phase === 'failed') console.error('[Worker] Transfer ' + job.id + ':', error.message);
    } catch (_) { /* Closed, cancelled, cleared or redirected: no dispatch failure to record. */ }
  }
}

// Event-driven dispatch survives worker suspension and login/region navigation.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'complete') return;
  (async () => {
    const saved = await chrome.storage.local.get('importState');
    const job = saved.importState?.transfers?.[tabId];
    if (job?.phase === 'created') await dispatchTransfer(job);
  })().catch(console.error);
});
