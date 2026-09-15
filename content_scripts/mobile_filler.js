// mobile_filler.js v12 – двуфазно попълване: mobile.bg прави form submit/reload
// при смяна на региона (document.pub.submit()), затова разделяме на две фази
// и продължаваме чрез запис за конкретния таб в background worker.
(function () {
  'use strict';

  if (window.__ai_filler_loaded) return;
  window.__ai_filler_loaded = true;
  let currentJob = null;
  let cancelled = false;
  let uploadBusy = false;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function call(action, fields = {}) {
    const result = await chrome.runtime.sendMessage({ action, transferId: currentJob?.id, ...fields });
    if (!result?.success) throw Error(result?.error || 'Няма отговор от разширението.');
    return result;
  }
  async function assertOwned() {
    if (cancelled || !currentJob) throw Error('Прехвърлянето е отменено.');
    await call('CHECK_TRANSFER');
    if (cancelled) throw Error('Прехвърлянето е отменено.');
  }
  async function sleep(ms) {
    await delay(ms);
    if (currentJob) await assertOwned();
  }
  function cancel() {
    cancelled = true;
    for (const id of ['__ai_imgs', '__ai_step2']) document.getElementById(id)?.remove();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.importState && currentJob) {
      const jobs = Object.values(changes.importState.newValue?.transfers || {});
      if (!jobs.some(job => job.id === currentJob.id)) cancel();
    }
  });
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  function setVal(el, val) {
    if (cancelled) throw Error('Прехвърлянето е отменено.');
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
    const matches = [...sel.options].filter(o => {
      const text = o.text.trim().toLowerCase();
      return o.value !== '' && text.length > 1 && (text.includes(t) || t.includes(text));
    });
    if (matches.length === 1) { setVal(sel, matches[0].value); return true; }
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
      return ot.length > 1 && [rawL, clean].some(value => value === ot || value.startsWith(ot + ' '));
    }).sort((a, b) => b.text.length - a.text.length);
    if (prefixes.length && (!prefixes[1] || prefixes[0].text.length > prefixes[1].text.length)) { setVal(sel, prefixes[0].value); return true; }
    const parts = clean.split(' ').filter(w => w.length > 1).slice(0, 2);
    if (parts.length >= 2) {
      const phrase = parts.join(' ');
      const matches = opts.filter(o => o.text.trim().toLowerCase().includes(phrase));
      if (matches.length === 1) { setVal(sel, matches[0].value); return true; }
    }
    return false;
  }

  const q = name => document.querySelector(`[name="${name}"]`);
  const formIdentity = () => ({ make: q('f5')?.value, model: q('f6')?.value, year: q('f15')?.value, vin: q('f32')?.value });
  function identityChanged() {
    return currentJob?.formIdentity && Object.entries(currentJob.formIdentity).some(([key, value]) => formIdentity()[key] !== value);
  }
  // Editing the vehicle after filling invalidates automatic images for that car.
  // Keep the user's edits; never silently attach the old vehicle's images.
  for (const event of ['input', 'change', 'click', 'submit']) document.addEventListener?.(event, () => {
    if (!cancelled && currentJob?.phase === 'images' && q('f5') && identityChanged()) {
      cancel();
      call('TRANSFER_FAILED', { error: 'Автомобилът е редактиран. Снимките са спрени; започни ново прехвърляне.' }).catch(() => {});
      ui('Автомобилът е редактиран. Автоматичните снимки са спрени.', 'warning');
    }
  }, true);

  function normalized(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function placeName(value) {
    return normalized(value).replace(/^(?:обл\.?|област|гр\.?|град|с\.?|село)\s+/, '');
  }
  function placeOption(select, value) {
    if (!select || !value) return null;
    const options = [...select.options].filter(o => o.value !== '');
    const exact = options.filter(o => o.value === value || normalized(o.text) === normalized(value));
    if (exact.length === 1) return exact[0];
    const matches = options.filter(o => placeName(o.text) === placeName(value));
    return matches.length === 1 ? matches[0] : null;
  }
  async function loadCities() {
    // Re-query each time: mobile.bg may replace the entire select after region changes.
    for (let i = 0; i < 24; i++) {
      const select = q('f19');
      if (select?.options.length > 1) return select;
      await sleep(250);
    }
    return q('f19');
  }
  async function rememberCities(select) {
    const region = q('f18');
    const chosen = [...(region?.options || [])].find(o => o.value === region.value);
    if (!chosen || !region.value || !select) return;
    const key = placeName(chosen.text);
    const cities = [...select.options].filter(o => o.value).map(o => ({ value: o.value, label: o.text.trim() }));
    if (cities.length) await chrome.storage.local.set({ ['mobileCities:' + key]: cities });
  }
  function setExtra(value, checked = true) {
    if (cancelled) throw Error('Прехвърлянето е отменено.');
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
    const label = cb => cb.labels?.[0]?.textContent || cb.parentElement?.textContent || '';
    let matches = boxes.filter(cb => normalized(cb.value) === normalized(value) || normalized(label(cb)) === normalized(value));
    if (!matches.length && value !== '4x4') matches = boxes.filter(cb => [cb.value, label(cb)].some(text => normalized(text).startsWith(normalized(value))));
    if (!matches.length) {
      const name = { '4x4':'f85', 'Аларма':'f115', 'Кожен салон':'f122', 'Нов внос':'f98' }[value];
      if (name) matches = boxes.filter(cb => cb.name === name);
    }
    if (matches.length !== 1) return false;
    const cb = matches[0];
    if (!!cb.checked !== checked) {
      cb.checked = checked;
      cb.dispatchEvent(new Event('input', { bubbles: true }));
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  const FUEL = { бензин:'Бензинов',бензинов:'Бензинов',petrol:'Бензинов',gas:'Бензинов',gasoline:'Бензинов',дизел:'Дизелов',дизелов:'Дизелов',diesel:'Дизелов',електрически:'Електрически',electric:'Електрически',ev:'Електрически',хибриден:'Хибриден',hybrid:'Хибриден',phev:'Plug-in хибрид',газ:'Газ',lpg:'Газ',cng:'Газ' };
  const TRANS = { автоматична:'Автоматична',автомат:'Автоматична',automatic:'Автоматична',ръчна:'Ръчна',механична:'Ръчна',manual:'Ръчна' };
  const BODY = { седан:'Седан',sedan:'Седан',хечбек:'Хечбек',hatchback:'Хечбек',комби:'Комби',wagon:'Комби',estate:'Комби',купе:'Купе',coupe:'Купе',кабриолет:'Кабрио',кабрио:'Кабрио',convertible:'Кабрио',ван:'Ван',van:'Ван',миниван:'Миниван',minivan:'Миниван',пикап:'Пикап',pickup:'Пикап',джип:'Джип',suv:'Джип',crossover:'Джип' };
  const COLOR = { white:'Бял',black:'Черен',silver:'Сребърен',gray:'Сив',grey:'Сив',red:'Червен',blue:'Син',green:'Зелен',brown:'Кафяв',beige:'Бежов',gold:'Златист',yellow:'Жълт',orange:'Оранжев',purple:'Виолетов',maroon:'Бордо',pearl:'Перла',champagne:'Кремав',charcoal:'Графит',tan:'Бежов',ivory:'Кремав',бял:'Бял',черен:'Черен',сребърен:'Сребърен',сив:'Сив',червен:'Червен',син:'Син',зелен:'Зелен',кафяв:'Кафяв',бежов:'Бежов',сребрист:'Сребърен' };
  const MONTHS = { january:'януари',february:'февруари',march:'март',april:'април',may:'май',june:'юни',july:'юли',august:'август',september:'септември',october:'октомври',november:'ноември',december:'декември',1:'януари',2:'февруари',3:'март',4:'април',5:'май',6:'юни',7:'юли',8:'август',9:'септември',10:'октомври',11:'ноември',12:'декември' };
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
        .replace(/\{пробег\}/gi, data.odometerKm != null ? data.odometerKm.toLocaleString() + ' км' : '')
        .replace(/\{гориво\}/gi, data.fuel || '')
        .replace(/\{трансмисия\}/gi, data.transmission || '')
        .replace(/\{задвижване\}/gi, data.drive || '')
        .replace(/\{цвят\}/gi, data.color || '')
        .replace(/\{вин\}/gi, data.vin || '')
        .replace(/\{vin\}/gi, data.vin || '')
        .replace(/\{лот\}/gi, data.lotNumber || data.stockNumber || '')
        .replace(/\{пазарна\}/gi, data.estimatedValue || '')
        .replace(/\{забележки\}/gi, data.highlights || '')
        .replace(/\{щета\}/gi, [data.primaryDamage, data.secondaryDamage].filter(Boolean).join('; '));
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
    if (data.odometerKm != null) L.push(`🛣️ Пробег: ${data.odometerKm.toLocaleString()} км`);
    if (data.color) L.push(`🎨 Цвят: ${data.color}`);
    L.push('');
    if (data.primaryDamage || data.secondaryDamage) L.push(`Щети по данни от аукциона: ${[data.primaryDamage, data.secondaryDamage].filter(Boolean).join('; ')}`);
    if (data.vin) L.push(`🔑 VIN: ${data.vin}`);
    L.push('');
    L.push('За повече информация и огледи – свържете се с нас!');
    return L.join('\n');
  }

  function getExtras(data) {
    const toCheck = [];
    const hl = (data.highlights || '').toLowerCase();
    const drive = (data.drive || '').toLowerCase();
    const is4x4 = /^(4x4|4wd|awd|all[ -]wheel(?: drive)?|four[ -]wheel(?: drive)?)$/.test(drive);

    {
      toCheck.push('Адаптивни предни светлини','Антиблокираща система','Въздушни възглавници - Задни','Въздушни възглавници - Предни','Въздушни възглавници - Странич','Ел. разпределяне на спирачното','Електронна програма за стабили','Контрол на налягането на гумит','Парктроник','Система ISOFIX','Система за динамична устойчиво','Система за защита от пробуксув','Система за контрол на дистанци','Система за контрол на спускане');
    }
    {
      toCheck.push('360 camera \\ Задна камера','Apple CarPlay \\ Android Auto','Auto Start Stop function','Bluetooth \\ handsfree система','DVD, TV','Head up display','USB, audio\\video, IN\\AUX извод','Адаптивно въздушно окачване','Блокаж на диференциала','Бързи \\ бавни скорости','Вентилация на седалките','Датчик за светлина','Ел. Огледала','Ел. Стъкла','Ел. регулиране на седалките','Климатик','Мултифункционален волан','Навигация','Печка','Подгряване на предното стъкло','Подгряване на седалките','Регулиране на волана','Сензор за дъжд','Серво усилвател на волана','Система за измиване на фаровет','Система за контрол на скоростт','Хладилна жабка');
    }
    toCheck.push('Аларма','Кожен салон','Нов внос');
    if (is4x4) toCheck.push('4x4');
    toCheck.push('Климатроник','LED фарове','Лети джанти','Металик');
    toCheck.push('Steptronic, Tiptronic');
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
      const f19 = await loadCities();
      await rememberCities(f19);
      const city = settings.city || 'София';
      const option = placeOption(f19, city);
      if (option) { setVal(f19, option.value); n++; }
      else ui('Населеното място не е намерено в избрания регион: ' + city, 'warning');
    } catch (e) { console.error('[AI] f19 грешка:', e); }

    try {
      if (settings.phone) { setVal(q('f22'), settings.phone); n++; }
      if (settings.email) { const f23 = q('f23'); if (f23 && !f23.value) setVal(f23, settings.email); }
      if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(data.vin || '')) { if (setVal(q('f32'), data.vin)) n++; }
    } catch (e) { console.error('[AI] phone/email/vin грешка:', e); }

    ui('📝 Попълвам описание...', 'loading');
    let descOk = false;
    try {
      const ta = q('f21');
      if (ta) { setVal(ta, buildDesc({ ...data, horsepower: settings.horsepower || data.horsepower }, settings.descTemplate || '')); n++; descOk = true; }
    } catch (e) { console.error('[AI] Описание грешка:', e); }

    ui((descOk ? '✅ Описание OK. ' : '❌ f21 НЕ Е НАМЕРЕНА! ') + 'Маркирам екстри...', descOk ? 'loading' : 'warning');
    await sleep(300);

    let cnt = 0;
    try {
      const extras = getExtras(data);
      for (const val of extras) {
        if (setExtra(val)) { cnt++; continue; }

      }
      setExtra('4x4', extras.includes('4x4'));
      if (cnt > 0) n++;
    } catch (e) { console.error('[AI] Checkboxes грешка:', e); }

    console.log('[AI-FILL] ФАЗА 2 ЗАВЪРШИ. n=', n, 'cnt=', cnt);
    await assertOwned();
    currentJob = (await call('FORM_FILLED', { formIdentity: formIdentity() })).transfer;
    ui(`Попълнени ${n} полета. Приложен е запазеният пресет за екстри. Провери стойностите и Евро категорията. Натисни ПРОДЪЛЖИ за снимките.`, 'done');
    showImgs(data.images || []);
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
    if (!f5) throw Error('Отиди на формата за нова обява в mobile.bg.');
    if (f5.value || q('f32')?.value || q('f21')?.value) {
      throw Error('Формата вече съдържа данни. Започни от аукционния таб в нова форма, за да не смесиш обяви.');
    }
    await assertOwned();

    let n = 0;

    if (data.make && pickVal(f5, data.make)) {
      n++;
      const f6 = q('f6');
      if (f6) for (let i = 0; i < 25; i++) { if (f6.options.length > 1) break; await sleep(200); }
    }
    if (!n) throw Error('Марката не е намерена. Провери обявата.');
    if (!data.model || !pickModel(q('f6'), data.model)) throw Error('Моделът липсва или е нееднозначен. Провери го ръчно.');
    n++;
    if (data.fuel && pickVal(q('f8'), FUEL[data.fuel.toLowerCase()] || data.fuel)) n++;
    // Condition and emissions require manual verification; do not infer them.
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
    if (data.transmission && pickVal(q('f10'), TRANS[data.transmission.toLowerCase()] || data.transmission)) n++;
    if (data.bodyType && pickVal(q('f11'), BODY[data.bodyType.toLowerCase()] || data.bodyType)) n++;
    if (data.displacement) { const f30=q('f30'); if (f30) { setVal(f30, data.displacement); n++; } }
    if (data.odometerKm != null) { setVal(q('f16'), String(data.odometerKm)); n++; }
    if (data.year && pickVal(q('f15'), data.year)) n++;

    {
      const f14 = q('f14');
      if (f14) {
        let mBG = null;
        if (data.productionMonth) {
          const k = String(data.productionMonth).toLowerCase().trim();
          mBG = MONTHS[k] || (/^0?[1-9]$|^1[0-2]$/.test(k) ? MONTHS[Number(k)] : null);
        }
        if (!data.productionMonth) {
          const months = Array.from({ length: 12 }, (_, i) => MONTHS[i + 1]);
          mBG = months[Math.floor(Math.random() * months.length)];
        }
        if (pickVal(f14, mBG)) n++;
      }
    }

    if (settings.price) {
      setVal(q('f12'), settings.price);
      if (settings.currency) pickVal(q('f13'), settings.currency);
      n++;
    }

    // Explicit user preset: sale price includes VAT, independently of a default price.
    if (pickVal(q('f31'), 'Цената е с включено ДДС') || pickVal(q('f31'), '1')) n++;

    if (data.color || data.colorOriginal) {
      const key = (data.colorOriginal || data.color || '').toLowerCase().trim();
      const bg = COLOR[key] || data.color || '';
      if (bg && pickVal(q('f17'), bg)) n++;
    }

    // Preserve the baseline region-triggered reload, with tab-owned progress.
    const region = settings.region || 'София';
    const f18el = q('f18');
    const regionOption = placeOption(f18el, region);
    if (region && f18el && regionOption?.value !== f18el.value) {
      await assertOwned();
      await call('SAVE_PHASE2', { n, formIdentity: formIdentity() });
      ui('Избирам регион. Попълването продължава след презареждане.', 'loading');
      if (!regionOption) throw Error('Регионът не е намерен. Избери го ръчно и започни в нова форма.');
      setVal(f18el, regionOption.value);
      return;
    }
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
    const resp = await chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_AS_BASE64', transferId: currentJob?.id, url });
    if (!resp || !resp.success) {
      throw new Error(resp?.error || 'Неуспешно изтегляне през background worker');
    }
    const res = await fetch(resp.dataUrl); // data: URL fetch е винаги разрешен, без CORS
    const blob = await res.blob();
    return new File([blob], filename, { type: resp.mimeType || blob.type || 'image/jpeg' });
  }

  // Автоматично инжектирай снимките в <input type="file"> чрез DataTransfer API
  async function autoUploadImages(images, statusEl) {
    if (uploadBusy) return false;
    uploadBusy = true;
    try {
      await assertOwned();
      const input = findFileInput();
      if (!input) throw Error('Отиди на стъпката за добавяне на снимки.');
      if (input.files?.length) throw Error('Вече има избрани снимки. Провери ги и ги премахни ръчно преди повторен опит.');
      const availableCount = images.length;
      images = images.slice(0, 17); // mobile.bg limit shown on the upload form.
      const dt = new DataTransfer();
      let failures = 0;
      for (let i = 0; i < images.length; i++) {
        await assertOwned();
        statusEl.textContent = `Обработвам снимка ${i + 1}/${images.length}...`;
        try { dt.items.add(await urlToFile(images[i], `car_${String(i + 1).padStart(2, '0')}.jpg`)); }
        catch (e) { failures++; console.warn('[AI] Image:', e.message); }
      }
      await assertOwned();
      if (!dt.files.length) throw Error('Снимките не се изтеглиха. Опитай отново или ги добави ръчно.');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      currentJob = (await call('IMAGES_ASSIGNED')).transfer;
      statusEl.textContent = `Предадени ${dt.files.length}/${images.length} снимки на формата${failures ? ` (${failures} неуспешни)` : ''}. Провери качването в mobile.bg.${availableCount > 17 ? ' Използвани са първите 17 снимки — лимитът на формата.' : ''}`;
      return true;
    } catch (e) {
      statusEl.textContent = e.message;
      return false;
    } finally { uploadBusy = false; }
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
        ${images.slice(0,9).map((u,i)=>`<div style="position:relative"><img src="${escapeHtml(u)}" style="width:100%;height:58px;object-fit:cover;border-radius:5px;border:2px solid rgba(99,102,241,.4)" onerror="this.style.opacity='.2'"><div style="position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,.65);color:#fff;font-size:9px;padding:1px 3px;border-radius:2px">${i+1}</div></div>`).join('')}
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
        if (cancelled) return;
        const a = document.createElement('a');
        a.href = url; a.download = `car_${String(i+1).padStart(2,'0')}.jpg`; a.target = '_blank';
        document.body.appendChild(a); a.click(); a.remove();
        if (i === images.length - 1) setTimeout(() => { this.disabled = false; this.textContent = `✅ ${images.length} снимки изтеглени`; }, 500);
      }, i * 500));
    });
    document.getElementById('__ai_cp').addEventListener('click', function () {
      if (cancelled) return;
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
    el.innerHTML = `<div style="display:flex;gap:10px;align-items:flex-start"><span style="font-size:20px;flex-shrink:0">${I[type]||'⏳'}</span><div style="flex:1"><b style="color:#fff;display:block;margin-bottom:2px">AutoImport BG</b><span style="color:#94a3b8;font-size:13px">${escapeHtml(msg)}</span></div><button onclick="document.getElementById('__ai_ui').remove()" style="background:none;border:none;color:#475569;cursor:pointer;font-size:22px;padding:0;flex-shrink:0;line-height:1">×</button></div>`;
    if (type === 'success') setTimeout(() => el?.remove(), 4000);
  }

  async function boot() {
    const result = await call('GET_TRANSFER');
    if (!result.transfer) {
      if (q('f18')) await rememberCities(await loadCities());
      return;
    }
    currentJob = result.transfer;
    if (currentJob.phase === 'phase2') {
      await sleep(1200);
      if (!q('f5')) return; // An unrelated page must not consume the job.
      if (!currentJob.formIdentity || identityChanged()) {
        throw Error('Автомобилът във формата е сменен. Автоматичното продължаване е спряно.');
      }
      const claimed = await call('CLAIM_TRANSFER', { resume: true });
      currentJob = claimed.transfer;
      await runPhase2(currentJob.data, currentJob.settings, currentJob.n);
    } else if (['images', 'imagesAssigned'].includes(currentJob.phase)) {
      for (let i = 0; i < 14 && !findFileInput(); i++) await sleep(300);
      if (!findFileInput()) return;
      showStep2Panel(currentJob.data.images);
      if (currentJob.phase === 'images' && currentJob.data.images.length) {
        await autoUploadImages(currentJob.data.images, {
          set textContent(value) { const el = document.getElementById('__ai_s2_status'); if (el) el.textContent = value; }
        });
      }
    }
  }

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
            <img src="${escapeHtml(u)}" style="width:100%;height:44px;object-fit:cover;border-radius:4px;border:1px solid rgba(255,255,255,.1)" onerror="this.style.opacity='.2'">
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
        this.style.background = 'linear-gradient(135deg,#1d4ed8,#4f46e5)';
        this.textContent = `Предадени на формата — провери снимките.`;
      } else {
        this.disabled = false;
        this.textContent = `🔄 Опитай отново (${images.length} снимки)`;
      }
    });

    document.getElementById('__ai_s2_dl').addEventListener('click', function () {
      this.disabled = true; this.textContent = '⏳ Изтеглям...';
      images.forEach((url, i) => setTimeout(() => {
        if (cancelled) return;
        const a = document.createElement('a');
        a.href = url; a.download = `car_${String(i+1).padStart(2,'0')}.jpg`;
        a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove();
        if (i === images.length - 1) setTimeout(() => {
          this.disabled = false; this.textContent = `✅ ${images.length} свалени`;
        }, 400);
      }, i * 400));
    });
  }

  async function fail(error) {
    if (currentJob && !cancelled) await call('TRANSFER_FAILED', { error: error.message }).catch(() => {});
    ui(error.message, 'error');
  }
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.action === 'CANCEL_TRANSFER') { cancel(); sendResponse({ success: true }); return; }
    if (msg.action === 'START_FILL') {
      if (cancelled || currentJob?.phase !== 'created' && currentJob) {
        sendResponse({ success: false, error: 'Прехвърлянето вече е започнато или отменено.' }); return;
      }
      startup.then(() => call('CLAIM_TRANSFER', { transferId: msg.transferId })).then(result => {
        currentJob = result.transfer;
        sendResponse({ success: true });
        fill(currentJob.data, currentJob.settings).catch(fail);
      }).catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    }
    if (msg.action === 'PING') sendResponse({ active: true });
  });
  const startup = boot().catch(fail);
})();
