// mobile_filler.js v12 – двуфазно попълване: mobile.bg прави form submit/reload
// при смяна на региона (document.pub.submit()), затова разделяме на две фази
// и преживяваме презареждането чрез sessionStorage.
(function () {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const STORAGE_KEY = '__ai_phase2_pending';
  const IMAGES_KEY = '__ai_pending_images';

  function setVal(el, val) {
    if (!el) return false;
    const tag = el.tagName;
    const proto = tag === 'SELECT' ? HTMLSelectElement.prototype
                : tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, String(val)); else el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (document.activeElement === el) { try { el.blur(); } catch(_) {} }
    return true;
  }

  function pickVal(sel, value) {
    if (!sel || value == null || value === '') return false;
    const v = String(value).trim();
    for (const o of sel.options) if (o.value === v || o.text.trim() === v) { setVal(sel, o.value); return true; }
    const t = v.toLowerCase();
    for (const o of sel.options) if (o.text.trim().toLowerCase() === t) { setVal(sel, o.value); return true; }
    for (const o of sel.options) {
      const ot = o.text.trim().toLowerCase();
      if (ot.length > 1 && (ot.includes(t) || t.includes(ot))) { setVal(sel, o.value); return true; }
    }
    return false;
  }

  function pickModel(sel, raw) {
    if (!sel || !raw || sel.options.length <= 1) return false;
    const opts = [...sel.options].filter(o => o.value !== '');
    const rawL = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    for (const o of opts) if (o.text.trim().toLowerCase() === rawL) { setVal(sel, o.value); return true; }
    const clean = raw.replace(/\b(4matic|4x4|awd|rwd|fwd|xdrive|quattro|allroad|sportback|avant|hybrid|phev|e-tron|tdi|tfsi|tsi|cdi|jtd|dci|t5|t6|t8|sport|plus|premium|line|edition|package|select|limited|touring|base|luxury|executive|business|hse|svr)\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
    for (const o of opts) if (o.text.trim().toLowerCase() === clean) { setVal(sel, o.value); return true; }
    const prefixes = opts.filter(o => {
      const ot = o.text.trim().toLowerCase();
      return ot.length > 1 && (rawL.startsWith(ot) || clean.startsWith(ot));
    }).sort((a, b) => b.text.length - a.text.length);
    if (prefixes.length) { setVal(sel, prefixes[0].value); return true; }
    const parts = clean.split(' ').filter(w => w.length > 1).slice(0, 2);
    if (parts.length >= 2) {
      const phrase = parts.join(' ');
      for (const o of opts) if (o.text.trim().toLowerCase().includes(phrase)) { setVal(sel, o.value); return true; }
    }
    return false;
  }

  const q = name => document.querySelector(`[name="${name}"]`);

  function checkByExactValue(val) {
    const all = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of all) if (cb.value.trim() === val.trim()) {
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    }
    return false;
  }
  function checkByFuzzy(val) {
    const key = val.trim().toLowerCase().substring(0, 20);
    const all = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of all) {
      const cv = cb.value.trim().toLowerCase();
      if (cv.length > 3 && cv.startsWith(key.substring(0, Math.min(key.length, cv.length)))) {
        if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
        return true;
      }
    }
    return false;
  }
  function checkByName(name) {
    const cb = document.querySelector(`input[type="checkbox"][name="${name}"]`);
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    return false;
  }

  const FUEL = { бензин:'Бензинов',бензинов:'Бензинов',petrol:'Бензинов',gas:'Бензинов',gasoline:'Бензинов',дизел:'Дизелов',дизелов:'Дизелов',diesel:'Дизелов',електрически:'Електрически',electric:'Електрически',ev:'Електрически',хибриден:'Хибриден',hybrid:'Хибриден',phev:'Plug-in хибрид',газ:'Газ',lpg:'Газ',cng:'Газ' };
  const TRANS = { автоматична:'Автоматична',автомат:'Автоматична',automatic:'Автоматична',ръчна:'Ръчна',механична:'Ръчна',manual:'Ръчна' };
  const BODY = { седан:'Седан',sedan:'Седан',хечбек:'Хечбек',hatchback:'Хечбек',комби:'Комби',wagon:'Комби',estate:'Комби',купе:'Купе',coupe:'Купе',кабрио:'Кабрио',convertible:'Кабрио',ван:'Ван',van:'Ван',миниван:'Миниван',minivan:'Миниван',пикап:'Пикап',pickup:'Пикап',джип:'Джип',suv:'Джип',crossover:'Джип' };
  const COLOR = { white:'Бял',black:'Черен',silver:'Сребърен',gray:'Сив',grey:'Сив',red:'Червен',blue:'Син',green:'Зелен',brown:'Кафяв',beige:'Бежов',gold:'Златист',yellow:'Жълт',orange:'Оранжев',purple:'Виолетов',maroon:'Бордо',pearl:'Перла',champagne:'Кремав',charcoal:'Графит',tan:'Бежов',ivory:'Кремав',бял:'Бял',черен:'Черен',сребърен:'Сребърен',сив:'Сив',червен:'Червен',син:'Син',зелен:'Зелен',кафяв:'Кафяв',бежов:'Бежов',сребрист:'Сребърен' };
  const MONTHS = { january:'януари',february:'февруари',march:'март',april:'април',may:'май',june:'юни',july:'юли',august:'август',september:'септември',october:'октомври',november:'ноември',december:'декември',1:'януари',2:'февруари',3:'март',4:'април',5:'май',6:'юни',7:'юли',8:'август',9:'септември',10:'октомври',11:'ноември',12:'декември' };
  const ALL_MONTHS = ['януари','февруари','март','април','май','юни','юли','август','септември','октомври','ноември','декември'];

  function getEuro(year) {
    const y = parseInt(year) || 0;
    if (y >= 2015) return '6'; if (y >= 2011) return '5'; if (y >= 2006) return '4';
    if (y >= 2001) return '3'; if (y >= 1997) return '2'; return '1';
  }

  function buildDesc(data, template) {
    if (template && template.trim()) {
      return template
        .replace(/\{марка\}/gi, data.make || '')
        .replace(/\{модел\}/gi, data.model || '')
        .replace(/\{година\}/gi, data.year || '')
        .replace(/\{двигател\}/gi, data.engine || '')
        .replace(/\{кубатура\}/gi, data.displacement ? data.displacement + ' сс' : '')
        .replace(/\{мощност\}/gi, data.horsepower ? data.horsepower + ' к.с.' : '')
        .replace(/\{цилиндри\}/gi, data.cylinders || '')
        .replace(/\{пробег\}/gi, data.odometerKm ? data.odometerKm.toLocaleString() + ' км' : '')
        .replace(/\{гориво\}/gi, data.fuel || '')
        .replace(/\{трансмисия\}/gi, data.transmission || '')
        .replace(/\{задвижване\}/gi, data.drive || '')
        .replace(/\{цвят\}/gi, data.color || '')
        .replace(/\{вин\}/gi, data.vin || '')
        .replace(/\{vin\}/gi, data.vin || '')
        .replace(/\{лот\}/gi, data.lotNumber || data.stockNumber || '')
        .replace(/\{пазарна\}/gi, data.estimatedValue || '')
        .replace(/\{забележки\}/gi, data.highlights || '')
        .replace(/\{щета\}/gi, ''); // щетата никога не се пише в описанието
    }
    const L = [];
    L.push(`🚗 ${data.title || `${data.year} ${data.make} ${data.model}`.trim()}`);
    L.push('');
    if (data.engine || data.displacement || data.horsepower) {
      const e = [];
      if (data.displacement) e.push(`${data.displacement} сс`);
      if (data.engine) e.push(data.engine);
      if (data.horsepower) e.push(`${data.horsepower} к.с.`);
      if (data.cylinders) e.push(`${data.cylinders} цил.`);
      L.push(`🔧 Двигател: ${e.join(' | ')}`);
    }
    if (data.transmission) L.push(`⚙️ Скоростна кутия: ${data.transmission}`);
    if (data.drive) L.push(`🔩 Задвижване: ${data.drive}`);
    if (data.odometerKm) L.push(`🛣️ Пробег: ${data.odometerKm.toLocaleString()} км`);
    if (data.color) L.push(`🎨 Цвят: ${data.color}`);
    L.push('');
    if (data.vin) L.push(`🔑 VIN: ${data.vin}`);
    L.push('');
    L.push('За повече информация и огледи – свържете се с нас!');
    return L.join('\n');
  }

  function getExtras(data) {
    const toCheck = [];
    const make = (data.make || '').toLowerCase();
    const hl = (data.highlights || '').toLowerCase();
    const yr = parseInt(data.year) || 0;
    const isLux = /mercedes|bmw|audi|lexus|infiniti|cadillac|lincoln|rolls.royce|bentley|porsche|jaguar|land.rover|maserati|genesis|volvo|acura/.test(make);
    const drive = (data.drive || '').toLowerCase();
    const is4x4 = drive === '4x4' || /4wd|awd|all.wheel|4x4|4matic|quattro|xdrive/.test(drive + (data.title||'').toLowerCase() + (data.highlights||'').toLowerCase());

    if (yr >= 2000) {
      toCheck.push('Адаптивни предни светлини','Антиблокираща система','Въздушни възглавници - Задни','Въздушни възглавници - Предни','Въздушни възглавници - Странич','Ел. разпределяне на спирачното','Електронна програма за стабили','Контрол на налягането на гумит','Парктроник','Система ISOFIX','Система за динамична устойчиво','Система за защита от пробуксув','Система за контрол на дистанци','Система за контрол на спускане');
    }
    if (yr >= 2005) {
      toCheck.push('360 camera \\ Задна камера','Apple CarPlay \\ Android Auto','Auto Start Stop function','Bluetooth \\ handsfree система','DVD, TV','Head up display','USB, audio\\video, IN\\AUX извод','Адаптивно въздушно окачване','Блокаж на диференциала','Бързи \\ бавни скорости','Вентилация на седалките','Датчик за светлина','Ел. Огледала','Ел. Стъкла','Ел. регулиране на седалките','Климатик','Мултифункционален волан','Навигация','Печка','Подгряване на предното стъкло','Подгряване на седалките','Регулиране на волана','Сензор за дъжд','Серво усилвател на волана','Система за измиване на фаровет','Система за контрол на скоростт','Хладилна жабка');
    }
    toCheck.push('Аларма','Кожен салон','Нов внос');
    if (is4x4) toCheck.push('4x4');
    if (isLux) toCheck.push('Климатроник','LED фарове','Лети джанти','Металик');
    if (/mercedes|bmw/.test(make) && yr >= 2010) toCheck.push('Steptronic, Tiptronic');
    const bodyLow = (data.bodyType || '').toLowerCase();
    toCheck.push(['купе','кабрио'].some(b => bodyLow.includes(b)) ? '2(3) Врати' : '4(5) Врати');
    if (/sunroof|moonroof|panoram/.test(hl)) toCheck.push('Панорамен люк','Шибедах');
    if (/keyless|remote.start/.test(hl)) toCheck.push('Безключово палене ');
    if (/xenon|hid/.test(hl)) toCheck.push('Ксенонови фарове');
    if (/trailer|tow/.test(hl)) toCheck.push('Теглич');
    return [...new Set(toCheck)];
  }

  // ════════════════════════════════════════
  // ФАЗА 2: населено място + телефон + VIN + описание + checkboxes
  // Изпълнява се ИЛИ веднага след Фаза 1 (ако f18 вече има стойност и
  // не се налага презареждане), ИЛИ след auto-resume при ново зареждане
  // на страницата (когато mobile.bg е направил document.pub.submit()).
  // ════════════════════════════════════════
  async function runPhase2(data, settings, startN) {
    let n = startN;

    // Населено място
    try {
      const f19 = q('f19');
      if (f19) {
        for (let i = 0; i < 20; i++) { if (f19.options.length > 1) break; await sleep(250); }
        const city = settings.city || 'София';
        if (!pickVal(f19, city)) {
          const cityLow = city.toLowerCase();
          let matched = false;
          for (const o of f19.options) {
            if (o.text.toLowerCase().includes(cityLow)) { setVal(f19, o.value); matched = true; break; }
          }
          if (!matched) {
            const first = [...f19.options].find(o => o.value !== '');
            if (first) setVal(f19, first.value);
          }
        }
        n++;
      }
    } catch (e) { console.error('[AI] f19 грешка:', e); }

    try {
      if (settings.phone) { setVal(q('f22'), settings.phone); n++; }
      if (settings.email) { const f23 = q('f23'); if (f23 && !f23.value) setVal(f23, settings.email); }
      if (data.vin) { setVal(q('f32'), data.vin); n++; }
    } catch (e) { console.error('[AI] phone/email/vin грешка:', e); }

    ui('📝 Попълвам описание...', 'loading');
    let descOk = false;
    try {
      const ta = q('f21');
      if (ta) { setVal(ta, buildDesc(data, settings.descTemplate || '')); n++; descOk = true; }
    } catch (e) { console.error('[AI] Описание грешка:', e); }

    ui((descOk ? '✅ Описание OK. ' : '❌ f21 НЕ Е НАМЕРЕНА! ') + 'Маркирам екстри...', descOk ? 'loading' : 'warning');
    await sleep(300);

    let cnt = 0;
    try {
      const extras = getExtras(data);
      for (const val of extras) {
        if (checkByExactValue(val)) { cnt++; continue; }
        if (checkByFuzzy(val)) { cnt++; continue; }
        if (val === 'Нов внос') { checkByName('f98'); cnt++; }
        else if (val === '4x4') { checkByName('f85'); cnt++; }
        else if (val === 'Аларма') { checkByName('f115'); cnt++; }
        else if (val === 'Кожен салон') { checkByName('f122'); cnt++; }
      }
      if (cnt > 0) n++;
    } catch (e) { console.error('[AI] Checkboxes грешка:', e); }

    console.log('[AI-FILL] ФАЗА 2 ЗАВЪРШИ. n=', n, 'cnt=', cnt);
    ui(`✅ Попълнени ${n} полета, ${cnt} екстри! Натисни ПРОДЪЛЖИ → снимките ще се качат автоматично.`, 'done');
    showImgs(data.images || []);
    chrome.storage.local.remove(STORAGE_KEY);
    // Запази снимките отделно – ще ги ползваме автоматично на стъпка 2 (качване на снимки)
    try {
      if (data.images && data.images.length) {
        chrome.storage.local.set({ [IMAGES_KEY]: data.images });
      }
    } catch (e) { console.warn('[AI] Не успях да запазя снимките за стъпка 2:', e); }
  }

  // ════════════════════════════════════════
  // ФАЗА 1: марка → модел → ... → регион
  // ════════════════════════════════════════
  async function fill(data, settings) {
    settings = settings || {};
    console.log('[AI-FILL] fill() ЗАПОЧНА. make=', data?.make, 'model=', data?.model);
    ui('🚗 Попълвам обявата...', 'loading');
    await sleep(300);

    const f5 = q('f5');
    if (!f5) {
      console.error('[AI-FILL] f5 НЕ Е НАМЕРЕН – СПИРАМ ВЕДНАГА');
      ui('⚠️ Отиди на формата за публикуване в mobile.bg', 'warning');
      return;
    }

    let n = 0;

    if (data.make && pickVal(f5, data.make)) {
      n++;
      f5.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof f5.onchange === 'function') f5.onchange.call(f5);
      const f6 = q('f6');
      if (f6) for (let i = 0; i < 25; i++) { if (f6.options.length > 1) break; await sleep(200); }
    }
    if (data.model) { const f6 = q('f6'); if (f6 && f6.options.length > 1 && pickModel(f6, data.model)) n++; }
    if (data.fuel && pickVal(q('f8'), FUEL[data.fuel.toLowerCase()] || data.fuel)) n++;
    pickVal(q('f25'), '0'); n++; // Винаги "Употребяван" – не отбелязваме щета/повреда
    // f9: Конски сили – settings имат приоритет над извлечените данни
    {
      const hp = settings.horsepower || data.horsepower || '';
      if (hp) { const f9=q('f9'); if (f9) { setVal(f9, String(hp)); n++; } }
    }

    // f7: Модификация – settings имат приоритет над извлечените данни
    {
      const mod = settings.modification || data.series || '';
      if (mod) { const f7=q('f7'); if (f7) { setVal(f7, mod); n++; } }
    }
    if (data.year && pickVal(q('f29'), getEuro(data.year))) n++;
    if (data.transmission && pickVal(q('f10'), TRANS[data.transmission.toLowerCase()] || data.transmission)) n++;
    if (data.bodyType && pickVal(q('f11'), BODY[data.bodyType.toLowerCase()] || data.bodyType)) n++;
    if (data.displacement) { const f30=q('f30'); if (f30) { setVal(f30, data.displacement); n++; } }
    if (data.odometerKm) { setVal(q('f16'), String(data.odometerKm)); n++; }
    if (data.year && pickVal(q('f15'), data.year)) n++;

    {
      const f14 = q('f14');
      if (f14) {
        let mBG = null;
        if (data.productionMonth) {
          const k = String(data.productionMonth).toLowerCase().trim();
          mBG = MONTHS[k] || MONTHS[parseInt(k)];
        }
        if (!mBG) mBG = ALL_MONTHS[Math.floor(Math.random() * ALL_MONTHS.length)];
        if (pickVal(f14, mBG)) n++;
      }
    }

    if (settings.price) {
      setVal(q('f12'), settings.price);
      if (settings.currency) pickVal(q('f13'), settings.currency);
      pickVal(q('f31'), '1');
      n++;
    }

    if (data.color || data.colorOriginal) {
      const key = (data.colorOriginal || data.color || '').toLowerCase().trim();
      const bg = COLOR[key] || data.color || '';
      if (bg && pickVal(q('f17'), bg)) n++;
    }

    // ── РЕГИОН: mobile.bg прави document.pub.submit() (form POST + reload)
    // при ВСЯКА промяна на f18, независимо дали е реален клик или скрипт.
    // Затова: ако вече има стойност – не пипаме нищо, директно Фаза 2.
    // Ако е празно – запазваме всичко в sessionStorage, сменяме региона
    // (което ще доведе до reload), и продължаваме автоматично след зареждането.
    const region = settings.region || 'София';
    const f18el = q('f18');

    if (f18el && f18el.value) {
      // Регионът вече е избран – директно продължаваме без презареждане.
      await runPhase2(data, settings, n);
      return;
    }

    if (f18el && !f18el.value) {
      // Запази прогреса в chrome.storage.local (преживява page reload, sessionStorage не!)
      try {
        await chrome.storage.local.set({ [STORAGE_KEY]: { data, settings, n } });
      } catch (e) { console.error('[AI] storage save грешка:', e); }
      ui('🔄 Избирам регион (страницата ще се презареди автоматично)...', 'loading');
      pickVal(f18el, region);
      return;
    }

    // Ако f18 изобщо липсва (нестандартна страница) – пробвай директно Фаза 2.
    await runPhase2(data, settings, n);
  }

  // Намери file input за снимки на текущата страница (стъпка 2 на mobile.bg)
  function findFileInput() {
    return document.querySelector('input[type="file"][multiple]')
        || document.querySelector('input[type="file"]');
  }

  // Опитай да изтеглиш снимка като Blob и да я превърнеш във File обект
  async function urlToFile(url, filename) {
    // Директен fetch от content script удря CORS на повечето auction CDN-и
    // (vis.iaai.com, cs.copart.com), защото те не разрешават mobile.bg origin.
    // Затова искаме background worker-а (extension-privileged контекст) да го
    // изтегли вместо нас и да ни върне base64 данните.
    const resp = await chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_AS_BASE64', url });
    if (!resp || !resp.success) {
      throw new Error(resp?.error || 'Неуспешно изтегляне през background worker');
    }
    const res = await fetch(resp.dataUrl); // data: URL fetch е винаги разрешен, без CORS
    const blob = await res.blob();
    return new File([blob], filename, { type: resp.mimeType || blob.type || 'image/jpeg' });
  }

  // Автоматично инжектирай снимките в <input type="file"> чрез DataTransfer API
  async function autoUploadImages(images, statusEl) {
    const input = findFileInput();
    if (!input) {
      statusEl.textContent = '⚠️ Не намерих поле за качване на снимки на тази страница. Отиди на стъпка 2 ("Добавяне на снимки") и опитай пак.';
      return false;
    }

    const dt = new DataTransfer();
    let okCount = 0, failCount = 0;

    for (let i = 0; i < images.length; i++) {
      statusEl.textContent = `⏳ Обработвам снимка ${i + 1}/${images.length}...`;
      try {
        const file = await urlToFile(images[i], `car_${String(i + 1).padStart(2, '0')}.jpg`);
        dt.items.add(file);
        okCount++;
      } catch (e) {
        console.warn('[AI] Снимка не успя (CORS или мрежа):', images[i], e.message);
        failCount++;
      }
    }

    if (okCount === 0) {
      statusEl.textContent = '❌ Снимките не се качиха автоматично. Провери конзолата (F12) за детайли или използвай ръчно сваляне по-долу.';
      return false;
    }

    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));

    statusEl.textContent = failCount > 0
      ? `✅ Качени ${okCount} от ${images.length} снимки автоматично (${failCount} не успяха).`
      : `✅ Всички ${okCount} снимки са качени автоматично!`;
    return true;
  }

  function showImgs(images) {
    document.getElementById('__ai_imgs')?.remove();
    if (!images.length) return;
    const p = document.createElement('div');
    p.id = '__ai_imgs';
    p.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483646;background:#0f0f1a;color:#e2e8f0;padding:16px;border-radius:14px;font:13px/1.5 system-ui,sans-serif;width:340px;max-height:520px;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.85);border:1px solid rgba(255,255,255,.1)';
    p.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <b style="color:#fff">📷 Снимки (${images.length})</b>
        <button id="__ai_c" style="background:none;border:none;color:#475569;cursor:pointer;font-size:22px;line-height:1">×</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:12px">
        ${images.slice(0,9).map((u,i)=>`<div style="position:relative"><img src="${u}" style="width:100%;height:58px;object-fit:cover;border-radius:5px;border:2px solid rgba(99,102,241,.4)" onerror="this.style.opacity='.2'"><div style="position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,.65);color:#fff;font-size:9px;padding:1px 3px;border-radius:2px">${i+1}</div></div>`).join('')}
      </div>
      <button id="__ai_auto" style="width:100%;padding:10px;background:linear-gradient(135deg,#059669,#0d9488);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;margin-bottom:7px">🚀 Качи автоматично (отиди на стъпка 2 първо)</button>
      <div id="__ai_status" style="font-size:12px;color:#94a3b8;margin-bottom:8px;min-height:16px"></div>
      <button id="__ai_dl" style="width:100%;padding:10px;background:rgba(255,255,255,.06);color:#94a3b8;border:1px solid rgba(255,255,255,.1);border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:7px">⬇️ Или изтегли ръчно всички ${images.length}</button>
      <button id="__ai_cp" style="width:100%;padding:10px;background:rgba(255,255,255,.06);color:#94a3b8;border:1px solid rgba(255,255,255,.1);border-radius:8px;cursor:pointer;font-size:13px">📋 Копирай линковете</button>`;
    document.body.appendChild(p);
    document.getElementById('__ai_c').onclick = () => p.remove();

    const statusEl = document.getElementById('__ai_status');
    document.getElementById('__ai_auto').addEventListener('click', async function () {
      this.disabled = true;
      const orig = this.textContent;
      await autoUploadImages(images, statusEl);
      this.disabled = false;
      this.textContent = orig;
    });

    document.getElementById('__ai_dl').addEventListener('click', function () {
      this.disabled = true; this.textContent = '⏳ Изтеглям...';
      images.forEach((url, i) => setTimeout(() => {
        const a = document.createElement('a');
        a.href = url; a.download = `car_${String(i+1).padStart(2,'0')}.jpg`; a.target = '_blank';
        document.body.appendChild(a); a.click(); a.remove();
        if (i === images.length - 1) setTimeout(() => { this.disabled = false; this.textContent = `✅ ${images.length} снимки изтеглени`; }, 500);
      }, i * 500));
    });
    document.getElementById('__ai_cp').addEventListener('click', function () {
      navigator.clipboard.writeText(images.join('\n')).then(() => {
        this.textContent = '✅ Копирано!'; setTimeout(() => this.textContent = '📋 Копирай линковете', 2500);
      });
    });
  }

  function ui(msg, type) {
    const C = { loading:'#3b82f6', success:'#22c55e', error:'#ef4444', done:'#8b5cf6', warning:'#f59e0b' };
    const I = { loading:'⏳', success:'✅', error:'❌', done:'🎉', warning:'⚠️' };
    let el = document.getElementById('__ai_ui');
    if (!el) {
      el = document.createElement('div'); el.id = '__ai_ui';
      el.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#0f0f1a;color:#e2e8f0;padding:14px 18px;border-radius:12px;font:14px/1.5 system-ui,sans-serif;max-width:340px;min-width:260px;box-shadow:0 8px 32px rgba(0,0,0,.85);border:1px solid rgba(255,255,255,.1)';
      document.body.appendChild(el);
    }
    el.style.borderLeft = `4px solid ${C[type]||C.loading}`;
    el.innerHTML = `<div style="display:flex;gap:10px;align-items:flex-start"><span style="font-size:20px;flex-shrink:0">${I[type]||'⏳'}</span><div style="flex:1"><b style="color:#fff;display:block;margin-bottom:2px">AutoImport BG</b><span style="color:#94a3b8;font-size:13px">${msg}</span></div><button onclick="document.getElementById('__ai_ui').remove()" style="background:none;border:none;color:#475569;cursor:pointer;font-size:22px;padding:0;flex-shrink:0;line-height:1">×</button></div>`;
    if (type === 'success') setTimeout(() => el?.remove(), 4000);
  }

  // ════════════════════════════════════════
  // AUTO-RESUME: при ново зареждане на страницата (след презареждането,
  // причинено от document.pub.submit()), провери дали имаме недовършена
  // Фаза 2 в sessionStorage и я довърши автоматично.
  // ════════════════════════════════════════
  (async function autoResume() {
    let pending;
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY);
      pending = r[STORAGE_KEY] || null;
    } catch (e) { pending = null; }
    if (!pending) return;

    console.log('[AI-FILL] Открит недовършен прогрес след презареждане – продължавам Фаза 2 автоматично.');
    await sleep(1200); // изчакай новата страница да рендира напълно

    if (!q('f5')) {
      console.warn('[AI-FILL] autoResume: f5 липсва на новата страница, изчиствам прогреса.');
      chrome.storage.local.remove(STORAGE_KEY);
      return;
    }

    ui('🔄 Продължавам попълването след презареждане...', 'loading');
    await runPhase2(pending.data, pending.settings, pending.n);
  })();

  // ════════════════════════════════════════
  // СТЪПКА 2: плаващ бутон за снимки
  // Показва се на всяка страница с file input (стъпка 2 на mobile.bg).
  // Ако има IMAGES_KEY в sessionStorage – опитва автоматично качване.
  // Ако потребителят се върне обратно – бутонът е винаги видим за повторен опит.
  // ════════════════════════════════════════
  (async function handleStep2() {
    // Изчакай до 4 сек file input да се появи
    let input = null;
    for (let i = 0; i < 14; i++) {
      input = findFileInput();
      if (input) break;
      await sleep(300);
    }
    if (!input) return; // не сме на стъпка 2

    // Вземи снимките от sessionStorage (ако има)
    let images;
    try {
      const r = await chrome.storage.local.get(IMAGES_KEY);
      images = r[IMAGES_KEY] || null;
    } catch (e) { images = null; }

    // Покажи плаващия панел
    showStep2Panel(images || []);

    // Ако има чакащи снимки – опитай автоматично качване
    if (images && images.length) {
      const panel = document.getElementById('__ai_step2');
      const statusEl = panel?.querySelector('#__ai_s2_status');
      if (statusEl) statusEl.textContent = `⏳ Качвам ${images.length} снимки автоматично...`;

      const ok = await autoUploadImages(images, {
        set textContent(v) {
          const el = document.getElementById('__ai_s2_status');
          if (el) el.textContent = v;
        }
      });

      if (ok) chrome.storage.local.remove(IMAGES_KEY);
    }
  })();

  function showStep2Panel(images) {
    document.getElementById('__ai_step2')?.remove();

    const hasImages = images && images.length > 0;
    const panel = document.createElement('div');
    panel.id = '__ai_step2';
    panel.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483646;' +
      'background:#0f0f1a;color:#e2e8f0;padding:14px 16px;border-radius:14px;' +
      'font:13px/1.5 system-ui,sans-serif;width:320px;' +
      'box-shadow:0 8px 40px rgba(0,0,0,.85);border:1px solid rgba(99,102,241,.3)';

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <b style="color:#fff;font-size:13px">📷 AutoImport – Снимки${hasImages ? ` (${images.length})` : ''}</b>
        <button id="__ai_s2_close" style="background:none;border:none;color:#475569;cursor:pointer;font-size:20px;line-height:1;padding:0">×</button>
      </div>

      ${hasImages ? `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:10px">
        ${images.slice(0,8).map((u,i)=>`
          <div style="position:relative">
            <img src="${u}" style="width:100%;height:44px;object-fit:cover;border-radius:4px;border:1px solid rgba(255,255,255,.1)" onerror="this.style.opacity='.2'">
            <div style="position:absolute;bottom:1px;right:2px;background:rgba(0,0,0,.7);color:#fff;font-size:8px;padding:0 2px;border-radius:2px">${i+1}</div>
          </div>`).join('')}
      </div>` : `
      <div style="font-size:12px;color:#64748b;margin-bottom:10px">
        Няма запазени снимки за тази обява.
      </div>`}

      <div id="__ai_s2_status" style="font-size:12px;color:#94a3b8;min-height:16px;margin-bottom:8px">
        ${hasImages ? `⏳ Подготвям качването...` : ''}
      </div>

      ${hasImages ? `
      <button id="__ai_s2_upload" style="width:100%;padding:9px;background:linear-gradient(135deg,#059669,#0d9488);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;margin-bottom:6px">
        🚀 Качи ${images.length} снимки
      </button>
      <button id="__ai_s2_dl" style="width:100%;padding:8px;background:rgba(255,255,255,.06);color:#94a3b8;border:1px solid rgba(255,255,255,.1);border-radius:8px;cursor:pointer;font-size:12px">
        ⬇️ Свали всички ръчно
      </button>` : ''}`;

    document.body.appendChild(panel);

    document.getElementById('__ai_s2_close').onclick = () => panel.remove();

    if (!hasImages) return;

    const statusEl = document.getElementById('__ai_s2_status');

    document.getElementById('__ai_s2_upload').addEventListener('click', async function () {
      this.disabled = true;
      this.textContent = '⏳ Качвам...';
      const ok = await autoUploadImages(images, {
        set textContent(v) { if (statusEl) statusEl.textContent = v; }
      });
      if (ok) {
        chrome.storage.local.remove(IMAGES_KEY);
        this.style.background = 'linear-gradient(135deg,#1d4ed8,#4f46e5)';
        this.textContent = `✅ Качени! Натисни ПРОДЪЛЖИ.`;
      } else {
        this.disabled = false;
        this.textContent = `🔄 Опитай отново (${images.length} снимки)`;
      }
    });

    document.getElementById('__ai_s2_dl').addEventListener('click', function () {
      this.disabled = true; this.textContent = '⏳ Изтеглям...';
      images.forEach((url, i) => setTimeout(() => {
        const a = document.createElement('a');
        a.href = url; a.download = `car_${String(i+1).padStart(2,'0')}.jpg`;
        a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove();
        if (i === images.length - 1) setTimeout(() => {
          this.disabled = false; this.textContent = `✅ ${images.length} свалени`;
        }, 400);
      }, i * 400));
    });
  }

  // Единствен listener – директно изпълнение
  if (!window.__ai_listener_registered) {
    window.__ai_listener_registered = true;
    chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
      if (msg.action === 'START_FILL') {
        console.log('[AI-FILL] START_FILL получено.');
        fill(msg.data, msg.settings).catch(e => { console.error('[AI-FILL] FATAL:', e); ui('❌ ' + e.message, 'error'); });
        sendResponse({ success: true });
        return true;
      }
      if (msg.action === 'PING') { sendResponse({ active: true }); return true; }
    });
  }
})();
