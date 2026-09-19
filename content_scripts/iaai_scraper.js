// iaai_scraper.js v6.0 – базиран на реална диагностика на VehicleDetail страница
(function () {
  'use strict';
  if (window.__iaaiScraperLoaded) return;
  window.__iaaiScraperLoaded = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const milesToKm = AutoImportVehicle.mileage;
  let vehicleRoot;
  const vehicleText = () => vehicleRoot?.innerText || vehicleRoot?.textContent || '';
  const nodes = selector => vehicleRoot?.querySelectorAll?.(selector) || [];

  // ── Метод 1: Потвърдени реални hidden input id-та от диагностика ──
  function fromHiddenInputs() {
    const map = {};
    const ids = {
      hdnVehicleMake: 'make',
      hdnVehicleYear: 'year',
      hdnYearMakeModelSeries: 'fullTitle',
      hdnRequestedItemID: 'itemId',
      hdnImageHostURL: 'imageHost',
    };
    for (const [id, key] of Object.entries(ids)) {
      const el = document.getElementById(id);
      if (el?.value?.trim()) map[key] = el.value.trim();
    }
    // hdnStockNo2_* има динамичен суфикс с lot ID – намери го по prefix match
    if (!map.stockNoAlt) {
      const el = [...document.querySelectorAll('input[type=hidden]')]
        .find(i => i.id === 'hdnStockNo2_' + (map.itemId || AutoImportVehicle.route(location.href)?.id));
      if (el?.value?.trim()) map.stockNoAlt = el.value.trim();
    }
    console.log('[AI] IAAI hidden inputs:', map);
    return map;
  }

  // ── Метод 2: "VEHICLE INFORMATION" блок – label:value двойки по ред ──
  function fromVehicleInfoBlock() {
    const map = {};
    const header = [...nodes('*')].find(el =>
      el.children.length === 0 && el.innerText?.trim() === 'VEHICLE INFORMATION'
    );
    if (!header) return map;
    let container = header.closest('div, section, table') || header.parentElement;
    if (container?.parentElement) container = container.parentElement;
    const text = container?.innerText || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].endsWith(':')) {
        const key = lines[i].replace(/:$/, '').toLowerCase();
        const val = lines[i + 1];
        if (val && !val.endsWith(':')) map[key] = val;
      }
    }
    return map;
  }

  // ── Метод 3: "VEHICLE DESCRIPTION" блок – съдържа Engine/Trans/Drivetrain/Color/Body ──
  function fromVehicleDescriptionBlock() {
    const map = {};
    const header = [...nodes('*')].find(el =>
      el.children.length === 0 && el.innerText?.trim() === 'VEHICLE DESCRIPTION'
    );
    if (!header) return map;
    let container = header.closest('div, section, table') || header.parentElement;
    if (container?.parentElement) container = container.parentElement;
    const text = container?.innerText || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].endsWith(':')) {
        const key = lines[i].replace(/:$/, '').toLowerCase();
        const val = lines[i + 1];
        if (val && !val.endsWith(':')) map[key] = val;
      }
    }
    console.log('[AI] IAAI VEHICLE DESCRIPTION:', map);
    return map;
  }

  // ── Метод 4: Regex scan на целия видим текст (fallback) ──
  function fromText() {
    const t = vehicleText();
    const g = re => {
      const values = [...new Set([...t.matchAll(new RegExp(re.source, re.flags + 'g'))].map(m => m[1]?.trim()).filter(Boolean))];
      return values.length === 1 ? values[0] : '';
    };
    return {
      odometer:        g(/Odometer[:\s]*\n?([0-9,]+\s*(?:mi|km)[^\n]*)/i),
      primaryDamage:   g(/Primary\s*Damage[:\s]*\n?([^\n]+)/i),
      secondaryDamage: g(/Secondary\s*Damage[:\s]*\n?([^\n]+)/i),
      engine:          g(/Engine[:\s]*\n?([^\n]+)/i),
      transmission:    g(/Transmission[:\s]*\n?([^\n]+)/i),
      drivetrain:      g(/Drive(?:train|line)?[:\s]*\n?([^\n]+)/i),
      fuel:            g(/Fuel(?:\s*Type)?[:\s]*\n?([^\n]+)/i),
      bodyStyle:       g(/Body\s*Style[:\s]*\n?([^\n]+)/i),
      color:           g(/Color[:\s]*\n?([^\n]+)/i),
      cylinders:       g(/Cylinders?[:\s]*\n?([0-9]+)/i),
      vin:             g(/VIN\s*\(Status\)[:\s]*\n?([A-HJ-NPR-Z0-9*]{11,17})/i),
      stockNum:        g(/Stock\s*#[:\s]*\n?([0-9]+)/i),
      titleCode:       g(/Title\/Sale\s*Doc[:\s]*\n?([^\n]+)/i),
      hasKey:          g(/Key[:\s]*\n?([^\n]+)/i),
      condition:       g(/Start\s*Code[:\s]*\n?([^\n]+)/i),
      location:        g(/Selling\s*Branch[:\s]*\n?([^\n]+)/i),
    };
  }

  // ── Снимки – реален IAAI "resizer" URL формат, потвърден от диагностика:
  // https://vis.iaai.com/resizer?imageKeys={lotId}~SID~{sid}~S0~I{n}~RW{w}~H{h}~TH0&width=X&height=Y
  // Всяка снимка (I1, I2, ...) се среща в страницата в няколко резолюции –
  // дедуплицираме по номера I{n} и взимаме версията с най-голяма заявена резолюция.
  function extractImages(itemId) {
    const byIndex = new Map(); // n -> { url, width }

    function processImg(img) {
      const candidates = [img.getAttribute('data-src'), img.getAttribute('data-lazy-src'), img.currentSrc, img.src];
      for (const value of candidates) {
        const src = AutoImportImages.resolveUrl(value, window.location.href);
        if (src) processSource(img, src);
      }
    }
    function processSource(img, src) {

      // Изключи известния видео placeholder и други не-снимкови ресурси
      if (src.includes('thumbnail-engine-video')) return;
      const altText = (img.alt || '').toLowerCase();
      if (altText.includes('video') || altText.includes('not attached to car')) return;

      // Разпознай IAAI resizer формат
      const m = src.match(/imageKeys=([^&]+)/);
      if (!m) {
        // Не е resizer URL – пропусни (вероятно UI/декоративен елемент)
        return;
      }
      let keyParam;
      try { keyParam = decodeURIComponent(m[1]); } catch (_) { return; }
      if (!itemId || keyParam.split('~')[0] !== itemId) return;
      const idxMatch = keyParam.match(/~I(\d+)~/);
      if (!idxMatch) return;
      const idx = parseInt(idxMatch[1]);

      // Keep the largest available variant without modifying signed parameters.
      const bigUrl = src; // Preserve signed query parameters byte-for-byte.

      const widthMatch = src.match(/width=(\d+)/);
      const w = widthMatch ? parseInt(widthMatch[1]) : 0;

      const existing = byIndex.get(idx);
      if (!existing || w > existing.width) {
        byIndex.set(idx, { url: bigUrl, width: w });
      }
    }

    document.querySelectorAll('img[src],img[data-src],img[data-lazy-src]').forEach(processImg);

    // Подреди по номер на снимката (I1, I2, ...) за логичен ред
    const images = [...byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v.url);

    console.log('[AI] IAAI снимки извлечени (уникални по index):', images.length);
    return AutoImportImages.unique(images);
  }

  // ── Главна функция ──
  async function scrape() {
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (document.querySelector('h1')?.innerText?.trim() ||
          document.getElementById('hdnYearMakeModelSeries')?.value) break;
    }
    await sleep(800);

    vehicleRoot = AutoImportVehicle.scope(document);
    const hidden = fromHiddenInputs();
    const expected = AutoImportVehicle.route(window.location.href)?.id;
    if (hidden.itemId && hidden.itemId !== expected) throw Error('IAAI показва друг автомобил. Презареди страницата.');
    const identity = { sourceId: expected, verified: !!hidden.itemId && hidden.itemId === expected };
    const info   = fromVehicleInfoBlock();
    const desc   = fromVehicleDescriptionBlock();
    const text   = fromText();

    function g(...keys) {
      for (const k of keys) {
        const v = hidden[k] || info[k.toLowerCase()] || desc[k.toLowerCase()] || text[k];
        if (v && String(v).trim()) return String(v).trim();
      }
      return '';
    }

    // ── Заглавие ──
    const h1 = document.querySelector('h1')?.innerText?.trim() || '';
    if (hidden.fullTitle && h1 && /^\d{4}\s/.test(h1) && h1.toLowerCase() !== hidden.fullTitle.toLowerCase()) throw Error('Заглавието и скритите данни на IAAI не съвпадат. Презареди страницата.');
    const title = hidden.fullTitle || h1 || '';
    const lotUrl = window.location.href;

    // ── Stock number ──
    const urlStock = lotUrl.match(/VehicleDetail\/(\d+)/i)?.[1] || '';
    const stockNum = info['stock #'] || hidden.stockNoAlt || text.stockNum || urlStock;

    // ── Год/Марка/Модел – директно от hidden полета, най-надеждно ──
    let year  = hidden.year || '';
    let make  = hidden.make ? (hidden.make.charAt(0) + hidden.make.slice(1).toLowerCase()) : '';
    let model = '';

    const fullTitleSrc = hidden.fullTitle || title;
    if (fullTitleSrc) {
      const m = fullTitleSrc.match(/^(\d{4})\s+(.+)$/);
      if (m) {
        year = year || m[1];
        let rest = m[2];
        if (make && rest.toUpperCase().startsWith(make.toUpperCase())) {
          model = rest.slice(make.length).trim();
        } else {
          const multi = ['LAND ROVER', 'ALFA ROMEO', 'ASTON MARTIN', 'ROLLS-ROYCE', 'MERCEDES-BENZ'].find(value => rest.toUpperCase().startsWith(value + ' '));
          if (!make && multi) { make = multi; rest = rest.slice(multi.length).trim(); model = rest; }
          const parts = rest.split(' ');
          if (!make) make = parts[0];
          if (!model) model = parts.slice(1).join(' ');
        }
      }
    }

    // ── VIN ──
    let vin = info['vin (status)'] || text.vin || '';
    vin = vin.replace(/\s*\(.*?\)\s*/g, '').trim(); // махни "(OK)" суфикс

    // ── Одометър ──
    const odomRaw = info['odometer'] || text.odometer || '';
    const odomKm  = milesToKm(odomRaw);

    // ── Двигател (от VEHICLE DESCRIPTION блока) ──
    const engineStr = desc['engine'] || text.engine || '';
    const litM = engineStr.match(/(\d+\.?\d*)\s*[Ll]/);
    const displacement = litM ? String(Math.round(parseFloat(litM[1]) * 1000)) : '';
    const horsepower = engineStr.match(/(\d+(?:\.\d+)?\s*(?:hp|kw|ps))\b/i)?.[1] || '';

    // ── Гориво ──
    const fuelSrc = desc['fuel'] || desc['fuel type'] || text.fuel || '';
    const fuelRaw = fuelSrc.toLowerCase();
    const fuel = fuelRaw.includes('hybrid') ? 'Хибриден'
               : fuelRaw.includes('diesel') ? 'Дизел'
               : fuelRaw.includes('electric') ? 'Електрически'
               : /gas|petrol|flex/.test(fuelRaw) ? 'Бензин' : '';


    // ── Трансмисия ──
    const transRaw = (desc['transmission'] || text.transmission || '').toLowerCase();
    const transmission = transRaw.includes('auto') ? 'Автоматична'
                       : transRaw.includes('manual') ? 'Механична'
                       : transRaw || '';

    // ── Задвижване ── (реален label на IAAI: "Drive Line Type")
    const driveRaw = (desc['drive line type'] || desc['drivetrain'] || desc['drive line'] || text.drivetrain || '').toLowerCase();
    const drive = driveRaw.includes('rear') || driveRaw.includes('rwd') ? 'Задно'
                : driveRaw.includes('front') || driveRaw.includes('fwd') ? 'Предно'
                : driveRaw.includes('4wd') || driveRaw.includes('awd') || driveRaw.includes('all wheel') || driveRaw.includes('all-wheel') || driveRaw.includes('4x4') ? '4x4' : '';

    // ── Тип купе ──
    const bodyRaw = (desc['body style'] || text.bodyStyle || '').toLowerCase();
    const bodyType = bodyRaw.includes('coupe') ? 'Купе'
                   : bodyRaw.includes('sedan') ? 'Седан'
                   : bodyRaw.includes('suv') || bodyRaw.includes('sport utility') || bodyRaw.includes('util') ? 'SUV'
                   : bodyRaw.includes('wagon') ? 'Комби'
                   : bodyRaw.includes('hatch') ? 'Хечбек'
                   : bodyRaw.includes('convert') ? 'Кабриолет'
                   : bodyRaw.includes('pickup') || bodyRaw.includes('truck') ? 'Пикап'
                   : bodyRaw.includes('van') ? 'Ван' : bodyRaw || '';

    // ── Цвят ──
    const colorMap = {
      white:'Бял',black:'Черен',silver:'Сребрист',gray:'Сив',grey:'Сив',
      red:'Червен',blue:'Син',green:'Зелен',brown:'Кафяв',beige:'Бежов',
      gold:'Златист',yellow:'Жълт',orange:'Оранжев',purple:'Лилав',maroon:'Бордо',
      tan:'Бежов',ivory:'Бял',charcoal:'Графит',pearl:'Перлен',champagne:'Шампанско',
      'dark gray':'Тъмно сив','dark grey':'Тъмно сив','black/silver':'Черен',
    };
    const colorEn = (desc['color'] || desc['exterior/interior'] || text.color || '').toLowerCase().split('/')[0].trim();
    const colorBg = colorMap[colorEn] || colorEn;

    // ── Щета ──
    const primaryDamage   = info['primary damage']   || text.primaryDamage   || '';
    const secondaryDamage = info['secondary damage'] || text.secondaryDamage || '';
    const cylinders       = desc['cylinders'] || text.cylinders || '';
    const hasKey           = info['key'] || text.hasKey || '';
    const titleCode        = info['title/sale doc'] || text.titleCode || '';
    const condition        = info['start code'] || text.condition || '';
    const location          = info['selling branch'] || text.location || '';

    const images = extractImages(hidden.itemId || expected);

    // ── Серия/Модификация (от VEHICLE DESCRIPTION: Series поле) ──
    const series = desc['series'] || desc['trim'] || desc['trim level'] || '';

    console.log('[AI] IAAI scraped:', { title, year, make, model, series, vin, odomKm, engineStr, fuel, transmission, drive, bodyType, colorBg, primaryDamage, images: images.length });

    return AutoImportVehicle.normalize({
      identity,
      raw: { color: desc['color'] || desc['exterior/interior'] || text.color || '', year, make, model, vin: info['vin (status)'] || text.vin || '', engine: engineStr, power: horsepower, fuel: fuelSrc, transmission: desc['transmission'] || text.transmission || '', drive: desc['drive line type'] || desc['drivetrain'] || desc['drive line'] || text.drivetrain || '', bodyType: desc['body style'] || text.bodyStyle || '', odometer: odomRaw, odometerUnit: '', sourceFields: { hidden, info, desc, text } },
      source: 'iaai',
      lotNumber: stockNum, stockNumber: stockNum, lotUrl, title,
      year, make, model, vin,
      odometerRaw: odomRaw,
      odometerMiles: /\bmi(?:les)?\b/i.test(String(odomRaw)) ? Number(String(odomRaw).match(/[0-9,]+/)?.[0].replace(/,/g, '')) : null,
      odometerKm: odomKm,
      engine: engineStr, displacement, fuel, horsepower,
      transmission, drive, bodyType,
      color: colorBg, colorOriginal: colorEn,
      primaryDamage, secondaryDamage,
      cylinders, hasKey, series,
      titleCode, condition, location,
      productionMonth: '',
      images,
      scrapedAt: new Date().toISOString()
    });
  }

  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.action === 'SCRAPE_NOW') {
      const startUrl = location.href;
      scrape().then(async data => {
        if (location.href !== startUrl) throw Error('Обявата е сменена по време на извличането.');
        const saved = await chrome.runtime.sendMessage({ action: 'SAVE_CAR_DATA', requestId: msg.requestId, data });
        if (!saved?.success) throw Error(saved?.error || 'Данните не са запазени.');
        sendResponse({ success: true, data: saved.data });
      }).catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (msg.action === 'PING') sendResponse({ active: true, source: 'iaai', ready: true });
  });

  console.log('[AutoImport] IAAI scraper v6.0 зареден на:', location.href);
})();
