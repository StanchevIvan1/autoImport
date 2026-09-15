// popup.js v3.0 – с auth/лицензна система
document.addEventListener('DOMContentLoaded', async () => {

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

  // ── Main tab логика ──
  async function initMainTab() {
    document.getElementById('auth-wall')?.classList.add('hidden');
    document.getElementById('main-content')?.classList.remove('hidden');

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = activeTab?.url || '';
    const isCopart  = url.includes('copart.com/lot/');
    const isIAAI    = url.includes('iaai.com/VehicleDetail/') || url.includes('iaai.com/vehicles/');
    const isMobile  = url.includes('mobile.bg');
    const isAuction = isCopart || isIAAI;

    // Винаги чети свежи данни – store може да е остарял ако функцията се вика повторно
    const freshStore = await chrome.storage.local.get('carData');
    const carData = freshStore.carData || null;

    dot('page',
      isAuction ? 'green' : isMobile ? 'yellow' : '',
      isCopart  ? '✓ Copart обява – готова'
    : isIAAI    ? '✓ IAAI обява – готова'
    : isMobile  ? '✓ mobile.bg е отворен'
    :             'Отвори Copart или IAAI обява');

    if (carData) {
      const km = carData.odometerKm ? ` · ${carData.odometerKm.toLocaleString()} км` : '';
      dot('data', 'green', `✓ ${carData.year} ${carData.make} ${carData.model}${km}`);
      renderData(carData);
    } else {
      dot('data', '', 'Няма запазени данни');
    }

    const authNow = await checkAuth();
    dot('login',
      authNow.ok ? 'green' : 'yellow',
      authNow.ok ? `✓ ${authNow.plan} · Лицензът е активен` : 'Въведи лицензен ключ');

    const btnScrape = document.getElementById('btn-scrape');
    const btnFill   = document.getElementById('btn-fill');
    if (isAuction) {
      btnScrape.disabled = false;
      btnScrape.textContent = `📥 Извлечи от ${isCopart ? 'Copart' : 'IAAI'}`;
    }
    if (carData) btnFill.disabled = false;

    // ── Извличане ──
    btnScrape.addEventListener('click', async () => {
      btnScrape.disabled = true;
      btnScrape.innerHTML = '<span class="spinner"></span> Изчакай...';
      try {
        const file = isCopart ? 'content_scripts/copart_scraper.js' : 'content_scripts/iaai_scraper.js';
        let alive = false;
        try { alive = !!(await chrome.tabs.sendMessage(activeTab.id, { action: 'PING' }))?.active; } catch(_) {}
        if (!alive) {
          await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: [file] });
          await pause(800);
        }
        const r = await chrome.tabs.sendMessage(activeTab.id, { action: 'SCRAPE_NOW' });
        if (r?.success && r.data) {
          const d = r.data, km = d.odometerKm ? ` · ${d.odometerKm.toLocaleString()} км` : '';
          dot('data', 'green', `✓ ${d.year} ${d.make} ${d.model}${km}`);
          btnFill.disabled = false;
          renderData(d);
          btnScrape.style.background = 'linear-gradient(135deg,#059669,#0d9488)';
          btnScrape.textContent = '✅ Извлечено!';
          setTimeout(() => document.querySelector('[data-tab="data"]')?.click(), 600);
        } else {
          btnScrape.style.background = '';
          btnScrape.textContent = '❌ Неуспешно – презареди';
          btnScrape.disabled = false;
        }
      } catch(e) {
        btnScrape.textContent = '❌ Презареди страницата';
        btnScrape.disabled = false;
      }
    });

    // ── Попълни ──
    const MOBILE_FORM_URL = 'https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=1';

    btnFill.addEventListener('click', async () => {
      const auth = await checkAuth();
      if (!auth.ok) { document.querySelector('[data-tab="account"]')?.click(); return; }
      if (!carData) return;

      btnFill.disabled = true;
      btnFill.innerHTML = '<span class="spinner"></span> Отварям mobile.bg...';
      const settings = await getSettings();

      try {
        // Случай 1: вече сме на формата за добавяне на обява – попълни директно
        if (isMobile && url.includes('pubtype=1')) {
          await injectAndFill(activeTab.id, carData, settings);
          btnFill.innerHTML = '✅ Попълнено!';
          setTimeout(() => window.close(), 800);
          return;
        }

        // Случай 2: вече има отворен таб с формата за добавяне
        const formTabs = await chrome.tabs.query({ url: '*://*.mobile.bg/pcgi/mobile.cgi*' });
        const formTab  = formTabs.find(t => t.url.includes('pubtype=1'));
        if (formTab) {
          await chrome.tabs.update(formTab.id, { active: true });
          await chrome.windows.update(formTab.windowId, { focused: true });
          await pause(400);
          // Провери дали autoResume вече е в ход (има sessionStorage pending)
          const hasResume = await chrome.scripting.executeScript({
            target: { tabId: formTab.id },
            func: () => !!sessionStorage.getItem('__ai_phase2_pending'),
          });
          const resumePending = hasResume?.[0]?.result;
          if (!resumePending) {
            await injectAndFill(formTab.id, carData, settings);
          }
          btnFill.innerHTML = '✅ Попълването е стартирано!';
          setTimeout(() => window.close(), 800);
          return;
        }

        // Случай 3: отвори формата директно и изчакай да се зареди
        btnFill.innerHTML = '<span class="spinner"></span> Зареждам формата...';
        const newTab = await chrome.tabs.create({ url: MOBILE_FORM_URL, active: true });
        await chrome.windows.update(newTab.windowId, { focused: true });

        // Делегирай изпращането на START_FILL на background worker-а –
        // той живее независимо от popup-а и не спира когато popup-ът се затвори.
        chrome.runtime.sendMessage({
          action: 'FILL_WHEN_READY',
          tabId: newTab.id,
          data: carData,
          settings,
        });

        btnFill.innerHTML = '✅ Попълването ще започне автоматично!';
        setTimeout(() => window.close(), 600);

      } catch(e) {
        console.error('[Popup] btnFill грешка:', e);
        btnFill.disabled = false;
        btnFill.textContent = '❌ Грешка – опитай пак';
      }
    });

    document.getElementById('btn-open-mobile').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://www.mobile.bg' }); window.close();
    });
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
    await chrome.storage.local.remove('carData');
    dot('data', '', 'Няма запазени данни');
    document.getElementById('btn-fill').disabled = true;
    document.getElementById('no-data-msg')?.classList.remove('hidden');
    document.getElementById('data-preview')?.classList.add('hidden');
  };
  document.getElementById('btn-clear-data')?.addEventListener('click', doClear);
  document.getElementById('footer-clear')?.addEventListener('click', async () => {
    await chrome.storage.local.remove(['carData']);
    doClear();
  });

  // ── Helpers ──
  async function getSettings() {
    const r = await chrome.storage.local.get('userSettings');
    const base = r.userSettings || {};
    // Добави per-обява корекции от Data таба (имат приоритет над scraper данните)
    return {
      ...base,
      horsepower:   document.getElementById('d-horsepower')?.value.trim() || base.horsepower || '',
      modification: document.getElementById('d-modification')?.value.trim() || base.modification || '',
    };
  }

  async function injectAndFill(tabId, data, settings) {
    // Инжектирай скрипта (идемпотентно — ако вече е зареден, __ai_listener_registered го защитава)
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content_scripts/mobile_filler.js']
      });
    } catch(e) { /* вероятно вече е инжектиран */ }

    // Изчакай listener-ът да се регистрира чрез PING polling (до 5 сек)
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await pause(250);
      try {
        const pong = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
        if (pong?.active) { ready = true; break; }
      } catch(_) { /* още не е готов */ }
    }

    if (!ready) {
      // Последен опит без потвърждение
      await pause(500);
    }

    await chrome.tabs.sendMessage(tabId, { action: 'START_FILL', data, settings });
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
  function renderData(d) {
    document.getElementById('no-data-msg')?.classList.add('hidden');
    document.getElementById('data-preview')?.classList.remove('hidden');
    const badge = document.getElementById('source-badge');
    if (badge) badge.textContent = d.source === 'copart' ? '📡 Copart' : '📡 IAAI';
    const titleEl = document.getElementById('car-title');
    if (titleEl) titleEl.textContent = d.title || `${d.year} ${d.make} ${d.model}`.trim() || '–';
    const ir = document.getElementById('images-row');
    if (ir && d.images?.length) ir.innerHTML = d.images.slice(0, 6).map(u =>
      `<img src="${u}" class="img-thumb" onerror="this.style.display='none'">`).join('');
    const sp = document.getElementById('car-specs');
    if (sp) sp.innerHTML = [
      ['Пробег',    d.odometerKm ? `${d.odometerKm.toLocaleString()} км` : '–'],
      ['Двигател',  d.displacement ? `${d.displacement} сс` : d.engine || '–'],
      ['Гориво',    d.fuel || '–'],
      ['Трансмис.', d.transmission || '–'],
      ['Задвижв.',  d.drive || '–'],
      ['Тип',       d.bodyType || '–'],
      ['VIN',       d.vin ? d.vin.substring(0, 11) + '…' : '–'],
      ['Снимки',    `${d.images?.length || 0} бр.`],
      ['Щета',      d.primaryDamage || '–'],
      ['Цвят',      d.color || '–'],
    ].map(([l, v]) => `<div class="spec-item"><div class="spec-label">${l}</div><div class="spec-value">${v}</div></div>`).join('');

    // Попълни корекционните полета с извлечените стойности като начална точка
    // (потребителят може да ги редактира преди попълване)
    const hpEl  = document.getElementById('d-horsepower');
    const modEl = document.getElementById('d-modification');
    if (hpEl  && !hpEl.value  && d.horsepower)  hpEl.value  = d.horsepower;
    if (modEl && !modEl.value && d.series)       modEl.value = d.series;
  }
});
