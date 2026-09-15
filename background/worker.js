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

  if (msg.action === 'SAVE_CAR_DATA') {
    chrome.storage.local.set({ carData: msg.data }, () => sendResponse({ success: true }));
    return true;
  }
  if (msg.action === 'GET_CAR_DATA') {
    chrome.storage.local.get('carData', r => sendResponse({ data: r.carData || null }));
    return true;
  }
  if (msg.action === 'CLEAR_CAR_DATA') {
    chrome.storage.local.remove('carData', () => sendResponse({ success: true }));
    return true;
  }
  if (msg.action === 'GET_STATUS') {
    chrome.storage.local.get('carData', r =>
      sendResponse({ hasData: !!r.carData, data: r.carData || null }));
    return true;
  }
  if (msg.action === 'OPEN_MOBILE_BG') {
    chrome.tabs.create({ url: 'https://www.mobile.bg' });
    sendResponse({ success: true });
    return true;
  }

  // Изчакай таба да се зареди и filler listener-ът да е готов, после изпрати START_FILL.
  // Използва се при отваряне на нов таб от popup-а – worker-ът не спира когато popup-ът се затвори.
  if (msg.action === 'FILL_WHEN_READY') {
    const { tabId, data, settings } = msg;
    (async () => {
      // 1. Изчакай страницата да завърши зареждане (до 15 сек)
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.url && tab.url.includes('login')) return; // не е логнат
          if (tab.status === 'complete' && tab.url && tab.url.includes('pubtype=1')) break;
        } catch(e) { return; } // табът е затворен
      }

      // 2. Инжектирай filler-а
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content_scripts/mobile_filler.js']
        });
      } catch(e) { /* вероятно вече е инжектиран от manifest */ }

      // 3. PING polling – изчакай listener-ът да се регистрира (до 5 сек)
      let ready = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 250));
        try {
          const pong = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
          if (pong?.active) { ready = true; break; }
        } catch(_) {}
      }

      // 4. Изпрати START_FILL
      try {
        await chrome.tabs.sendMessage(tabId, { action: 'START_FILL', data, settings });
      } catch(e) {
        console.error('[Worker] FILL_WHEN_READY: START_FILL неуспешен:', e.message);
      }
    })();
    sendResponse({ ok: true });
    return true;
  }


  // Изтегли снимка от auction CDN (Copart/IAAI) и я върни като base64.
  // Service worker контекстът има extension host_permissions и не е обвързан
  // от CORS политиката на mobile.bg страницата, за разлика от content script fetch().
  if (msg.action === 'FETCH_IMAGE_AS_BASE64') {
    (async () => {
      try {
        const res = await fetch(msg.url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const reader = new FileReader();
        const base64 = await new Promise((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        sendResponse({ success: true, dataUrl: base64, mimeType: blob.type || 'image/jpeg' });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});

// !! НЕ инжектираме автоматично при всяко зареждане на mobile.bg !!
// Само popup.js решава кога да се попълва (чрез INJECT_AND_FILL)
// Filler-ът сам прави autoStart при нужда (веднъж)
