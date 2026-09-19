// popup.js v3.0 – с auth/лицензна система
document.addEventListener('DOMContentLoaded', async () => {

  let displayedCaptureId = null;
  let refreshData = null;
  let fillBusy = false;
  let pendingCorrections = Promise.resolve();
  let correctionError = null;
  const correctionErrors = {};
  const correctionVersions = {};
  function saveCorrection(field, value) {
    const captureId = displayedCaptureId;
    const version = correctionVersions[field] = (correctionVersions[field] || 0) + 1;
    const status = document.getElementById('correction-status');
    status.textContent = 'Записване…';
    // Send immediately: closing the popup must not cancel a debounce timer.
    const saving = request({ action: 'SAVE_OVERRIDES', captureId, field, value });
    pendingCorrections = saving.then(() => {
      if (captureId !== displayedCaptureId || version !== correctionVersions[field]) return;
      delete correctionErrors[field];
      correctionError = Object.values(correctionErrors)[0] || null;
      status.textContent = correctionError ? 'Не е запазено: ' + correctionError.message : '✓ Запазено за тази обява';
    }, error => {
      if (captureId !== displayedCaptureId || version !== correctionVersions[field]) return;
      correctionErrors[field] = error;
      correctionError = error;
      status.textContent = 'Не е запазено: ' + error.message;
    });
    return pendingCorrections;
  }
  for (const [id, field] of [['d-horsepower', 'horsepower'], ['d-modification', 'modification']]) {
    document.getElementById(id).addEventListener('input', () => saveCorrection(field, document.getElementById(id).value));
  }

  async function refreshTransfers() {
    const { transfers } = await request({ action: 'LIST_TRANSFERS' });
    const list = document.getElementById('transfer-list');
    list.innerHTML = '';
    const labels = { created: 'Изчаква формата / вход в mobile.bg', filling: 'Попълване', phase2: 'Изчаква презареждане', resuming: 'Довършване', images: 'Изчаква стъпката за снимки', imagesAssigned: 'Снимките са предадени — провери качването', completed: 'Данните са попълнени (без снимки)', failed: 'Нужен е повторен опит', cancelled: 'Отменено', detached: 'Прекъснато', expired: 'Изтекло' };
    if (!transfers.length) {
      const empty = document.createElement('p'); empty.className = 'transfer-empty';
      empty.textContent = 'Все още няма започнати прехвърляния.'; list.appendChild(empty);
    }
    for (const job of [...transfers].sort((a, b) => b.createdAt - a.createdAt)) {
      const row = document.createElement('div'); row.className = 'transfer-card';
      const text = document.createElement('p');
      text.textContent = `${job.data.year} ${job.data.make} ${job.data.model} · ${labels[job.phase] || job.phase}${job.error ? ': ' + job.error : ''}${job.result ? ` · Снимки: ${job.result.imagesAssigned}/${job.result.imagesExpected}${job.result.warnings?.length ? ' · Провери: ' + job.result.warnings.join('; ') : ''}` : ''}`;
      row.appendChild(text);
      if (job.imageResult) {
        const detail = document.createElement('p');
        detail.textContent = `Снимки: ${job.imageResult.uploaded}/${job.imageResult.expected} потвърдени; ${job.imageResult.failed} неуспешни; ${job.imageResult.unconfirmed} непотвърдени; ${job.imageResult.excluded || 0} извън лимита на формата.`;
        row.appendChild(detail);
        for (const item of job.imageItems || []) if (item.error) {
          const error = document.createElement('p'); error.textContent = `Снимка ${item.index + 1}: ${item.error}`; row.appendChild(error);
        }
      }
      for (const [label, action] of [['Повторен опит в нова форма', 'RETRY_TRANSFER'], ['Откажи', 'CANCEL_JOB']]) {
        const button = document.createElement('button'); button.textContent = label;
        button.className = action === 'CANCEL_JOB' ? 'btn btn-danger' : 'btn btn-secondary';
        button.onclick = async () => {
          button.disabled = true;
          try { await request({ action, transferId: job.id }); await refreshTransfers(); }
          catch (error) { text.textContent = error.message; button.disabled = false; }
        };
        row.appendChild(button);
      }
      list.appendChild(row);
    }
  }
  await refreshTransfers();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.importState) refreshTransfers().catch(console.error);
  });

  // ── Tabs ──
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('tab-' + t.dataset.tab)?.classList.add('active');
  }));

  // Бутон "Въведи ключ" от auth wall
  document.getElementById('btn-go-account')?.addEventListener('click', () => {
    document.querySelector('[data-tab="account"]')?.click();
  });

  // ── Зареди storage веднъж – преди всичко останало ──
  const store = await chrome.storage.local.get(['userSettings', 'carData']);
  const us = store.userSettings || {};

  // ── Провери auth при зареждане ──
  const authResult = await checkAuth();
  updateAuthUI(authResult);

  if (!authResult.ok) {
    document.getElementById('auth-wall')?.classList.remove('hidden');
    document.getElementById('main-content')?.classList.add('hidden');
  } else {
    await initMainTab();
  }

  // ── Зареди настройки в UI ──
  if (us.phone)        document.getElementById('s-phone').value = us.phone;
  if (us.city)         document.getElementById('s-city').value  = us.city;
  if (us.region)       { const el = document.getElementById('s-region'); if (el) el.value = us.region; }
  if (us.price)        document.getElementById('s-price').value = us.price;
  if (us.currency)     document.getElementById('s-currency').value = us.currency;
  if (us.email)        document.getElementById('mb-username').value = us.email;
  if (us.descTemplate) { const dt = document.getElementById('s-desc-template'); if (dt) dt.value = us.descTemplate; }

  async function refreshCities() {
    const region = (document.getElementById('s-region').value || 'София').toLowerCase().replace(/^(?:обл\.?|област)\s*/, '').trim();
    const key = 'mobileCities:' + region;
    const saved = await chrome.storage.local.get(key);
    document.getElementById('s-city-options').innerHTML = (saved[key] || []).map(city => `<option value="${escapeHtml(city.label)}"></option>`).join('');
  }
  document.getElementById('s-region').addEventListener('change', () => refreshCities().catch(console.error));
  chrome.storage.onChanged.addListener(changes => {
    if (Object.keys(changes).some(key => key.startsWith('mobileCities:'))) refreshCities().catch(console.error);
  });
  await refreshCities();

  // ── Main tab логика ──
  async function initMainTab() {
    document.getElementById('auth-wall')?.classList.add('hidden');
    document.getElementById('main-content')?.classList.remove('hidden');

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = activeTab?.url || '';
    const page = new URL(url || 'https://invalid.local');
    const sourceRoute = AutoImportVehicle.route(url);
    const isCopart = sourceRoute?.source === 'copart';
    const isIAAI = sourceRoute?.source === 'iaai';
    const isMobile = page.protocol === 'https:' && ['mobile.bg', 'www.mobile.bg'].includes(page.hostname);
    const isAuction = isCopart || isIAAI;

    // Винаги чети свежи данни – store може да е остарял ако функцията се вика повторно
    const readData = () => request({ action: 'GET_CAR_DATA', ...(isAuction ? { sourceTabId: activeTab.id } : {}) });
    let carData = (await readData()).data || null;

    dot('page',
      isAuction ? 'green' : isMobile ? 'yellow' : '',
      isCopart  ? '✓ Copart обява – готова'
    : isIAAI    ? '✓ IAAI обява – готова'
    : isMobile  ? '✓ mobile.bg е отворен'
    :             'Отвори Copart или IAAI обява');

    if (carData) {
      const km = carData.odometerKm != null ? ` · ${carData.odometerKm.toLocaleString()} км` : '';
      dot('data', 'green', `✓ ${carData.year} ${carData.make} ${carData.model}${km}`);
      renderData(carData);
    } else {
      resetPreview();
    }

    const authNow = await checkAuth();
    dot('login',
      authNow.ok ? 'green' : 'yellow',
      authNow.ok ? `✓ ${authNow.plan} · Лицензът е активен` : 'Въведи лицензен ключ');

    const btnScrape = document.getElementById('btn-scrape');
    const btnFill   = document.getElementById('btn-fill');
    btnScrape.disabled = !isAuction;
    btnFill.disabled = !carData;
    if (isAuction) {
      btnScrape.disabled = false;
      btnScrape.textContent = `📥 Извлечи от ${isCopart ? 'Copart' : 'IAAI'}`;
    }
    refreshData = async () => {
      carData = (await readData()).data || null;
      if (carData) renderData(carData); else resetPreview();
      btnFill.disabled = fillBusy || !carData;
    };

    // ── Извличане ──
    btnScrape.onclick = async () => {
      btnScrape.disabled = true;
      btnScrape.innerHTML = '<span class="spinner"></span> Изчакай...';
      try {
        const ticket = await request({ action: 'BEGIN_SCRAPE', tabId: activeTab.id });
        carData = null; resetPreview(); btnFill.disabled = true;
        const file = isCopart ? 'content_scripts/copart_scraper.js' : 'content_scripts/iaai_scraper.js';
        let alive = false;
        try { alive = !!(await chrome.tabs.sendMessage(activeTab.id, { action: 'PING' }))?.active; } catch(_) {}
        if (!alive) {
          await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['shared/images.js', 'shared/vehicle.js', file] });
          await pause(800);
        }
        const r = await chrome.tabs.sendMessage(activeTab.id, { action: 'SCRAPE_NOW', requestId: ticket.requestId });
        if (r?.success && r.data) {
          carData = r.data;
          const d = carData, km = d.odometerKm != null ? ` · ${d.odometerKm.toLocaleString()} км` : '';
          dot('data', 'green', `✓ ${d.year} ${d.make} ${d.model}${km}`);
          btnFill.disabled = false;
          renderData(d);
          btnScrape.style.background = 'linear-gradient(135deg,#059669,#0d9488)';
          btnScrape.textContent = '✅ Извлечено!';
          setTimeout(() => document.querySelector('[data-tab="data"]')?.click(), 600);
        } else {
          dot('data', 'yellow', r?.error || 'Неуспешно извличане.');
          btnScrape.style.background = '';
          btnScrape.textContent = '❌ Неуспешно – презареди';
          btnScrape.disabled = false;
        }
      } catch(e) {
        dot('data', 'yellow', e.message);
        btnScrape.textContent = '❌ Презареди страницата';
        btnScrape.disabled = false;
      }
    };

    // ── Попълни ──
    btnFill.onclick = async () => {
      if (fillBusy) return;
      fillBusy = true;
      btnFill.disabled = true;
      const expectedId = displayedCaptureId;
      try {
        const auth = await checkAuth();
        if (!auth.ok) { document.querySelector('[data-tab="account"]')?.click(); return; }
        const fresh = (await readData()).data;
        if (!fresh || fresh.capture.id !== expectedId) {
          await refreshData();
          throw Error('Данните са сменени. Провери показаната обява и опитай отново.');
        }
        await pendingCorrections;
        if (correctionError) throw correctionError;
        const settings = await getSettings();
        if (settings.horsepower && (!/^\d+$/.test(settings.horsepower) || Number(settings.horsepower) <= 0 || Number(settings.horsepower) > 10000)) throw Error('Въведи валидни конски сили или остави празно.');
        const result = await request({ action: 'START_TRANSFER', captureId: expectedId, settings,
          ...(isMobile && page.pathname === '/pcgi/mobile.cgi' && page.searchParams.get('pubtype') === '1' ? { tabId: activeTab.id } : {}) });
        if (result.transfer.phase === 'failed') throw Error(result.transfer.error);
        btnFill.textContent = result.duplicate ? 'ℹ️ Това прехвърляне вече е започнато' : '✅ Попълването е стартирано';
        setTimeout(() => window.close(), 600);
      } catch (e) {
        dot('data', 'yellow', e.message);
        btnFill.textContent = '❌ Грешка – опитай пак';
      } finally {
        fillBusy = false;
        btnFill.disabled = !carData;
      }
    };

    document.getElementById('btn-open-mobile').onclick = () => {
      chrome.tabs.create({ url: 'https://www.mobile.bg' }); window.close();
    };
  }

  // ── Auth функции ──
  async function checkAuth() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'verify' }, res => {
        if (chrome.runtime.lastError || !res) resolve({ ok: false });
        else resolve(res);
      });
    });
  }

  function updateAuthUI(auth) {
    const badge = document.getElementById('header-auth-badge');
    const activeDiv   = document.getElementById('auth-active');
    const inactiveDiv = document.getElementById('auth-inactive');

    if (auth.ok) {
      // Header badge
      badge.textContent = `✓ ${auth.plan || 'Pro'}`;
      badge.className = 'auth-badge active';

      // Акаунт таб – активен панел
      activeDiv?.classList.remove('hidden');
      inactiveDiv?.classList.add('hidden');

      // Детайли
      const planEl = document.getElementById('auth-plan-name');
      if (planEl) { planEl.childNodes[0].textContent = auth.plan || 'Pro'; }
      const labelEl = document.getElementById('auth-plan-label');
      if (labelEl) labelEl.textContent = 'план';
      const expiresEl = document.getElementById('auth-expires-text');
      if (expiresEl) {
        expiresEl.textContent = auth.expiresAt
          ? `Валиден до: ${new Date(auth.expiresAt).toLocaleDateString('bg-BG')}`
          : 'Валидност: неограничена';
      }
      const keyEl = document.getElementById('auth-key-display');
      if (keyEl && auth.key) {
        // Показвай само началото и края на ключа
        const k = auth.key;
        keyEl.textContent = k.length > 16 ? k.substring(0, 10) + '••••••' + k.slice(-4) : k;
      }
    } else {
      badge.textContent = '⛔ Неактивен';
      badge.className = 'auth-badge inactive';
      activeDiv?.classList.add('hidden');
      inactiveDiv?.classList.remove('hidden');
    }
  }

  // ── Акаунт таб – активиране ──
  document.getElementById('btn-activate')?.addEventListener('click', async () => {
    const key = document.getElementById('key-input')?.value.trim();
    if (!key) { setAuthStatus('Въведи ключ първо', 'err'); return; }
    setAuthStatus('Активиране...', 'muted');
    chrome.runtime.sendMessage({ type: 'activate', key }, async (res) => {
      if (res?.ok) {
        setAuthStatus(`✅ Успех! План: ${res.plan}`, 'ok');
        updateAuthUI(res);
        // Покажи main content ако беше скрит
        document.getElementById('auth-wall')?.classList.add('hidden');
        document.getElementById('main-content')?.classList.remove('hidden');
        await initMainTab();
      } else {
        setAuthStatus(`❌ ${res?.error || res?.status || 'Невалиден ключ'}`, 'err');
      }
    });
  });

  // ── Акаунт таб – провери ──
  document.getElementById('btn-verify')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'verify' }, (res) => {
      const msgEl = document.getElementById('auth-success-msg');
      if (res?.ok) {
        if (msgEl) { msgEl.textContent = `✅ Лицензът е валиден. План: ${res.plan}`; msgEl.className = 'alert alert-success'; }
        updateAuthUI(res);
      } else {
        if (msgEl) { msgEl.textContent = `⚠️ Ключът е изтекъл или невалиден.`; msgEl.className = 'alert alert-warning'; }
        updateAuthUI({ ok: false });
      }
    });
  });

  // ── Акаунт таб – деактивирай ──
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    chrome.storage.local.remove('auth', () => {
      updateAuthUI({ ok: false });
      document.getElementById('auth-wall')?.classList.remove('hidden');
      document.getElementById('main-content')?.classList.add('hidden');
    });
  });

  function setAuthStatus(text, cls) {
    const el = document.getElementById('auth-status-msg');
    if (!el) return;
    el.textContent = text;
    el.style.color = cls === 'ok' ? '#4ade80' : cls === 'err' ? '#fca5a5' : '#64748b';
  }

  // ── Enter клавиш за ключа ──
  document.getElementById('key-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-activate')?.click();
  });

  // ── Запази настройки ──
  document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
    const settings = {
      phone:        document.getElementById('s-phone').value.trim(),
      city:         document.getElementById('s-city').value.trim(),
      region:       (document.getElementById('s-region') || {}).value || '',
      price:        document.getElementById('s-price').value.trim(),
      currency:     document.getElementById('s-currency').value,
      email:        document.getElementById('mb-username').value.trim(),
      descTemplate: (document.getElementById('s-desc-template') || {}).value || '',
    };
    await chrome.storage.local.set({ userSettings: settings });
    dot('login', 'green', settings.phone ? `✓ ${settings.phone} · ${settings.city}` : 'Попълни телефон');
    flash('btn-save-settings', '✅ Запазено!', '💾 Запази настройките');
  });

  // ── Изчисти ──
  const doClear = async () => {
    try {
      await request({ action: 'CLEAR_CAR_DATA' });
      resetPreview();
      await refreshData?.();
    } catch (e) { dot('data', 'yellow', e.message); }
  };
  document.getElementById('btn-clear-data')?.addEventListener('click', doClear);
  document.getElementById('footer-clear')?.addEventListener('click', doClear);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.importState) refreshData?.().catch(e => dot('data', 'yellow', e.message));
  });

  function resetPreview() {
    displayedCaptureId = null;
    correctionError = null;
    for (const key of Object.keys(correctionErrors)) delete correctionErrors[key];
    dot('data', '', 'Няма запазени данни за тази обява');
    document.getElementById('btn-fill').disabled = true;
    document.getElementById('no-data-msg')?.classList.remove('hidden');
    document.getElementById('data-preview')?.classList.add('hidden');
    document.getElementById('images-row').innerHTML = '';
    document.getElementById('d-horsepower').value = '';
    document.getElementById('d-modification').value = '';
  }
  async function request(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.success) throw Error(response?.error || 'Няма отговор от разширението.');
    return response;
  }
  // ── Helpers ──
  async function getSettings() {
    const r = await chrome.storage.local.get('userSettings');
    const base = r.userSettings || {};
    // Добави per-обява корекции от Data таба (имат приоритет над scraper данните)
    return {
      ...base,
      horsepower:   document.getElementById('d-horsepower')?.value.trim() || '',
      modification: document.getElementById('d-modification')?.value.trim() || '',
    };
  }

  function dot(id, cls, text) {
    const d = document.getElementById('dot-' + id), t = document.getElementById('text-' + id);
    if (d) d.className = 'status-dot' + (cls ? ' ' + cls : '');
    if (t) t.textContent = text;
  }
  function pause(ms) { return new Promise(r => setTimeout(r, ms)); }
  function flash(id, tmp, orig) {
    const b = document.getElementById(id); if (!b) return;
    b.textContent = tmp; setTimeout(() => b.textContent = orig, 2000);
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function renderData(d) {
    if (displayedCaptureId !== d.capture?.id) {
      document.getElementById('d-horsepower').value = d.overrides?.horsepower || '';
      document.getElementById('d-horsepower').placeholder = d.horsepower || 'напр. 211';
      document.getElementById('d-modification').value = d.overrides?.modification || '';
      document.getElementById('d-modification').placeholder = d.series || 'S-Line, AMG...';
      correctionError = null;
      for (const key of Object.keys(correctionErrors)) delete correctionErrors[key];
      document.getElementById('correction-status').textContent = Object.keys(d.overrides || {}).length ? '✓ Запазено за тази обява' : 'Промените се запазват автоматично';
    }
    displayedCaptureId = d.capture?.id || null;
    document.getElementById('no-data-msg')?.classList.add('hidden');
    document.getElementById('data-preview')?.classList.remove('hidden');
    const badge = document.getElementById('source-badge');
    if (badge) badge.textContent = d.source === 'copart' ? '📡 Copart' : '📡 IAAI';
    const titleEl = document.getElementById('car-title');
    if (titleEl) titleEl.textContent = d.title || `${d.year} ${d.make} ${d.model}`.trim() || '–';
    const review = document.getElementById('vehicle-review');
    if (review) {
      const labels = { vin: 'VIN', year: 'Година', make: 'Марка', model: 'Модел', odometerKm: 'Пробег', fuel: 'Гориво', transmission: 'Скорости', drive: 'Задвижване', bodyType: 'Купе', displacement: 'Кубатура', horsepower: 'Мощност' };
      const keys = { odometerKm: 'odometer', displacement: 'engine', horsepower: 'power' };
      review.textContent = (d.review || []).map(item => `${labels[item.field] || item.field}: ${d.raw?.[keys[item.field] || item.field] || 'липсва'} — провери ръчно`).join(' · ');
    }
    const ir = document.getElementById('images-row');
    if (ir) ir.innerHTML = (d.images || []).map(u =>
      `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(u)}" class="img-thumb"></a>`).join('');
    const sp = document.getElementById('car-specs');
    if (sp) sp.innerHTML = [
      ['Пробег',    d.odometerKm != null ? `${d.odometerKm.toLocaleString()} км` : '–'],
      ['Двигател',  d.displacement ? `${d.displacement} сс` : d.engine || '–'],
      ['Гориво',    d.fuel || '–'],
      ['Трансмис.', d.transmission || '–'],
      ['Задвижв.',  d.drive || '–'],
      ['Тип',       d.bodyType || '–'],
      ['VIN',       d.vin ? d.vin.substring(0, 11) + '…' : '–'],
      ['Снимки',    `${d.images?.length || 0} бр.`],
      ['Щета',      d.primaryDamage || '–'],
      ['Цвят',      d.color || '–'],
    ].map(([l, v]) => `<div class="spec-item"><div class="spec-label">${l}</div><div class="spec-value">${escapeHtml(v)}</div></div>`).join('');

  }
});
