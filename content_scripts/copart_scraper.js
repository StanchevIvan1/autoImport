// copart_scraper.js v4.0 – максимално извличане на данни
(function () {
  'use strict';
  if (window.__copartScraperLoaded) return;
  window.__copartScraperLoaded = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const milesToKm = AutoImportVehicle.mileage;
  let vehicleRoot;
  const vehicleText = () => vehicleRoot?.innerText || vehicleRoot?.textContent || '';
  const nodes = selector => vehicleRoot?.querySelectorAll?.(selector) || [];

  // ── От __NEXT_DATA__ (Next.js JSON) ──
  function fromNextData() {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el) return null;
    try {
      const root = JSON.parse(el.textContent);
      const candidates = [];
      function search(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 12) return;
        const expected = AutoImportVehicle.route(window.location.href)?.id;
        const number = String(obj.lotNumberStr || obj.ln || obj.lotNumber || '');
        if (number && number === expected) candidates.push(obj);
        for (const v of Object.values(obj)) search(v, depth + 1);
      }
      search(root, 0);
      for (const keys of [['lcy','year','yr'],['mkn','make','mk'],['mdn','model','md']]) {
        const values = new Set(candidates.map(obj => keys.map(key => obj[key]).find(value => value != null && String(value).trim())).filter(value => value != null).map(value => String(value).trim().toLowerCase()));
        if (values.size > 1) throw Error('CONFLICT: Противоречиви данни за текущия lot. Презареди страницата.');
      }
      const lot = candidates.sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0];
      if (lot) { console.log('[AI] Next.js keys:', Object.keys(lot).slice(0,30).join(', ')); return lot; }
    } catch(e) { if (e.message.startsWith('CONFLICT:')) throw e; console.warn('[AI] Next.js parse:', e.message); }
    return null;
  }

  // ── Label/Value pairs от DOM ──
  function harvestPairs() {
    const map = {};
    nodes('tr').forEach(tr => {
      const tds = [...tr.querySelectorAll('td,th')];
      for (let i=0; i<tds.length-1; i++) {
        const k=tds[i].innerText.trim().replace(/:$/,'').toLowerCase();
        const v=tds[i+1].innerText.trim();
        if(k&&v&&k.length<50){map[k]=v;i++;}
      }
    });
    nodes('div,li').forEach(p=>{
      const ch=[...p.children].filter(c=>c.innerText?.trim());
      if(ch.length===2){
        const k=ch[0].innerText.trim().replace(/:$/,'').toLowerCase();
        const v=ch[1].innerText.trim();
        if(k&&v&&k.length<50&&!k.includes('\n'))map[k]=v;
      }
    });
    nodes('dl').forEach(dl=>{
      const dts=dl.querySelectorAll('dt'),dds=dl.querySelectorAll('dd');
      dts.forEach((dt,i)=>{if(dds[i])map[dt.innerText.trim().toLowerCase()]=dds[i].innerText.trim();});
    });
    return map;
  }

  // ── Regex scan на целия текст ──
  function fromText() {
    const t = vehicleText();
    const g = re => {
      const values = [...new Set([...t.matchAll(new RegExp(re.source, re.flags + 'g'))].map(m => m[1]?.trim()).filter(Boolean))];
      return values.length === 1 ? values[0] : '';
    };
    return {
      odometer:        g(/Odometer[:\s]+([0-9,]+\s*(?:mi|km)[^\n]*)/i),
      primaryDamage:   g(/Primary\s*Damage[:\s]+([^\n]+)/i),
      secondaryDamage: g(/Secondary\s*Damage[:\s]+([^\n]+)/i),
      engineType:      g(/Engine\s*[Tt]ype[:\s]+([^\n]+)/i),
      transmission:    g(/Transmission[:\s]+([^\n]+)/i),
      drivetrain:      g(/Drivetrain[:\s]+([^\n]+)/i),
      fuel:            g(/Fuel[:\s]+([^\n]+)/i),
      bodyStyle:       g(/Body\s*[Ss]tyle[:\s]+([^\n]+)/i),
      color:           g(/Color[:\s]+([^\n]+)/i),
      cylinders:       g(/Cylinders[:\s]+([0-9]+)/i),
      hasKey:          g(/Has\s*[Kk]ey[:\s]+([^\n]+)/i),
      estimatedValue:  g(/Estimated\s*Retail\s*Value[:\s]+([^\n]+)/i),
      highlights:      g(/Highlights[:\s]+([^\n]+)/i),
      titleCode:       g(/Title\s*[Cc]ode[:\s]+([^\n]+)/i),
      saleDate:        g(/Sale\s*[Dd]ate[:\s]+([^\n]+)/i),
      productionMonth: g(/(?:Mfg\s*Date|Date\s*of\s*Mfg|Month\s*of\s*Mfg)[:\s]+([^\n]+)/i),
      // Конски сили – Copart рядко показва, но проверяваме
      horsepower:      g(/(?:Horse\s*Power|HP|Horsepower)[:\s]+([0-9]+(?:\s*(?:hp|kw|к\.с\.))?)/i),
      // Допълнителни
      netWeight:       g(/Net\s*Weight[:\s]+([^\n]+)/i),
      vehicleType:     g(/Vehicle\s*Type[:\s]+([^\n]+)/i),
      condition:       g(/(?:Condition|Run\s*&?\s*Drive)[:\s]+([^\n]+)/i),
      titleState:      g(/Title\s*State[:\s]+([^\n]+)/i),
    };
  }

  // ── Снимки ──
  function extractImages(lot) {
    const urls = [];
    const expected = AutoImportVehicle.route(window.location.href)?.id;
    const resolve = value => AutoImportImages.resolveUrl(value, window.location.href);
    function collect(value, imageBranch = false, depth = 0) {
      if (depth > 10 || urls.length >= 100) return;
      if (typeof value === 'string') { const url = imageBranch && resolve(value); if (url) urls.push(url); return; }
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(item => collect(item, imageBranch, depth + 1)); return; }
      const owner = String(value.lotNumberStr || value.ln || value.lotNumber || '');
      if (owner && owner !== expected) return;
      for (const [key, item] of Object.entries(value)) {
        if (/recommend|related|similar|advert|logo|icon/i.test(key)) continue;
        collect(item, imageBranch || /image|photo|gallery|^imgs?$|^imgList$|^[ft]url$/i.test(key), depth + 1);
      }
    }
    collect(lot);
    // Gallery markup varies between layouts. Merge its images even when JSON
    // provides only the lead photo. Never search unscoped page images.
    const galleries = ['[class*="gallery" i]', '[id*="gallery" i]', '[class*="carousel" i]',
      '[class*="lot-image" i]', '[id*="lot-image" i]', '[class*="lotImages" i]',
      '.image-container', '.p-galleria', '.galleria', '.slick-slider'];
    nodes(galleries.map(selector => `${selector} img`).join(',')).forEach(img => {
      for (let parent = img; parent; parent = parent.parentElement) {
        if (/recommend|related|similar|advert|logo|icon/i.test(`${parent.id || ''} ${parent.className || ''}`)) return;
        const owner = parent.getAttribute?.('data-lot-number') || parent.getAttribute?.('data-lot');
        if (owner && String(owner) !== expected) return;
        const linked = AutoImportVehicle.route(resolve(parent.getAttribute?.('href')));
        if (linked && linked.id !== expected) return;
      }
      const url = [img.getAttribute('data-src'), img.getAttribute('data-lazy-src'),
        img.getAttribute('data-lazy'), img.currentSrc, img.src].map(resolve).find(Boolean);
      if (url) urls.push(url);
    });
    return AutoImportImages.unique(urls);
  }

  // ── Парсирай данни ──
  function parse(nd, pairs, text) {
    function g(...keys) {
      for (const source of [nd || {}, pairs, text]) {
        for (const k of keys) {
          const v = source[k] ?? source[k.toLowerCase()];
          if (v != null && String(v).trim() !== '') return String(v).trim();
        }
      }
      return '';
    }

    const h1 = document.querySelector('h1')?.innerText?.trim() || '';
    const title = g('lotDescription','ld','title') || h1;

    if (nd && h1 && /^\d{4}\s/.test(h1)) {
      const prefix = [g('lcy','year','yr'), g('mkn','make','mk'), g('mdn','model','md')].filter(Boolean).join(' ').toLowerCase();
      if (prefix && !h1.toLowerCase().startsWith(prefix)) throw Error('Заглавието и данните са за различни автомобили. Презареди страницата.');
    }
    let year = g('lcy','year','yr') || '';
    let make = g('mkn','make','mk') || '';
    let model = g('mdn','model','md') || '';

    if ((!year || !make || !model) && title) {
      const m = title.match(/^(\d{4})\s+(.+)$/);
      if (m) {
        year = year || m[1];
        const mm = m[2];
        const twoWord = ['ROLLS-ROYCE','LAND ROVER','ASTON MARTIN','ALFA ROMEO','MERCEDES-BENZ','GREAT WALL'];
        let found = false;
        for (const tw of twoWord) {
          if (mm.toUpperCase().startsWith(tw)) {
            make = tw.split('-').map(w=>w.charAt(0)+w.slice(1).toLowerCase()).join('-');
            model = mm.slice(tw.length).trim(); found = true; break;
          }
        }
        if (!found) { const p=mm.split(' '); make=p[0]; model=p.slice(1).join(' '); }
      }
    }

    // VIN
    let vin = g('fv','vin','VIN') || '';
    if (!vin) {
      const vinEl = document.querySelector('[class*="vin" i],[data-cy*="vin" i]');
      vin = vinEl?.innerText?.replace(/[^A-HJ-NPR-Z0-9*]/gi,'') || '';
      const vinFull = vehicleText().match(/VIN[:\s#]+([A-HJ-NPR-Z0-9]{17})/i)?.[1] || '';
      if (vinFull) vin = vinFull;
    }

    // Lot
    const lotUrl = window.location.href;
    const lotNumber = lotUrl.match(/lot[\/\-](\d+)/i)?.[1]
      || g('lotNumberStr','ln','lotNumber')
      || vehicleText().match(/Lot\s*(?:number|#|num)[:\s]+(\d+)/i)?.[1] || '';

    // Одометър
    const odomRaw = g('od','odometer','mileage') || text.odometer || '';
    let odomKm = milesToKm(odomRaw, g('odometerUnit','odometerUnits','odometerUom','odometer unit','odometer units'));
    const visibleOdometer = pairs['odometer'] || text.odometer || '';
    if (odomKm == null && /^[0-9, ]+$/.test(odomRaw) &&
        Number(odomRaw.replace(/[, ]/g, '')) === Number(visibleOdometer.match(/^[0-9, ]+/)?.[0].replace(/[, ]/g, ''))) {
      odomKm = milesToKm(visibleOdometer);
    }

    // Двигател
    const engineStr = g('egn','engineType','engine type','engine') || text.engineType || '';
    let displacement = '';
    const litM = engineStr.match(/(\d+\.?\d*)\s*[Ll]/);
    if (litM) displacement = String(Math.round(parseFloat(litM[1])*1000));

    // Конски сили – от Next.js или текст
    // Accept explicitly named horsepower fields; generic power may be in kW.
    const hpRaw = g('hp','horsepower') || text.horsepower || '';
    const horsepower = /^\d+(?:\s*(?:hp|к\.с\.))?$/i.test(hpRaw) ? hpRaw.match(/^\d+/)[0] : '';
    // Опитай да извлечем от engine string: "5.5L V8 SFI" → VIN decode би дал кс
    // Ако нямаме – ще оставим празно

    // Гориво
    const fuelRaw = (g('ft','fuel','fuelType') || text.fuel || '').toLowerCase();
    const fuel = fuelRaw.includes('hybrid') ? 'Хибриден'
               : fuelRaw.includes('diesel') ? 'Дизел'
               : fuelRaw.includes('electric') ? 'Електрически'
               : /gas|petrol|flex/.test(fuelRaw) ? 'Бензин'
               : '';


    // Трансмисия
    const transRaw = (g('tsmn','transmission') || text.transmission || '').toLowerCase();
    const transmission = transRaw.includes('auto') ? 'Автоматична'
                       : transRaw.includes('manual')||transRaw.includes('man') ? 'Механична'
                       : transRaw || '';

    // Задвижване
    const driveRaw = (g('drv','drivetrain','drive') || text.drivetrain || '').toLowerCase();
    const drive = driveRaw.includes('rear')||driveRaw.includes('rwd') ? 'Задно'
                : driveRaw.includes('front')||driveRaw.includes('fwd') ? 'Предно'
                : driveRaw.includes('4wd')||driveRaw.includes('awd')||driveRaw.includes('all') ? '4x4'
                : '';

    // Купе
    const bodyRaw = (g('bst','bodyStyle','body style','body') || text.bodyStyle || '').toLowerCase();
    const bodyType = bodyRaw.includes('coupe') ? 'Купе'
                   : bodyRaw.includes('sedan') ? 'Седан'
                   : bodyRaw.includes('suv')||bodyRaw.includes('util') ? 'SUV'
                   : bodyRaw.includes('wagon')||bodyRaw.includes('estate') ? 'Комби'
                   : bodyRaw.includes('hatch') ? 'Хечбек'
                   : bodyRaw.includes('convert')||bodyRaw.includes('cabriolet') ? 'Кабриолет'
                   : bodyRaw.includes('pickup')||bodyRaw.includes('truck') ? 'Пикап'
                   : bodyRaw.includes('van') ? 'Ван' : bodyRaw || '';

    // Цвят
    const colorMap = {
      white:'Бял',black:'Черен',silver:'Сребрист',gray:'Сив',grey:'Сив',
      red:'Червен',blue:'Син',green:'Зелен',brown:'Кафяв',beige:'Бежов',
      gold:'Златист',yellow:'Жълт',orange:'Оранжев',purple:'Лилав',
      maroon:'Бордо',pearl:'Перлен',champagne:'Шампанско',charcoal:'Графит',
      tan:'Бежов',ivory:'Бял',lavender:'Лилав',teal:'Зелен',
      'dark gray':'Тъмно сив','dark grey':'Тъмно сив',
      'light gray':'Светло сив','light grey':'Светло сив',
      'dark blue':'Тъмно син','dark green':'Тъмно зелен',
      'dark red':'Тъмно червен','light blue':'Светло син',
      'space gray':'Графит','midnight':'Черен','white pearl':'Перлен',
    };
    const colorEn = (g('clr','color','colour') || text.color || '').toLowerCase().trim();
    const colorBg = colorMap[colorEn] || colorEn;

    const primaryDamage   = g('dd','primaryDamage','primary damage')   || text.primaryDamage   || '';
    const secondaryDamage = g('sdd','secondaryDamage','secondary damage') || text.secondaryDamage || '';
    const cylinders       = g('cyl','cylinders') || text.cylinders || '';
    const hasKey          = g('hk','hasKey','has key') || text.hasKey || '';
    const highlights      = g('hlt','highlights') || text.highlights || '';
    const estimatedValue  = g('erb','estimatedValue','estimated retail value') || text.estimatedValue || '';
    const titleCode       = g('tc','titleCode','title code') || text.titleCode || '';
    const saleDate        = g('ad','saleDate','sale date') || text.saleDate || '';
    const location        = g('yn','location','yard') || pairs['location'] || '';
    const condition       = text.condition || '';
    const vehicleType     = text.vehicleType || '';

    // Серия/Модификация – от заглавието: "2017 ROLLS-ROYCE WRAITH BLACK BADGE" → "BLACK BADGE"
    // или от вградени Copart полета ако съществуват
    let series = g('series','trim','trimLevel') || '';
    if (!series && title && make && model) {
      // Извлечи частта след "ГОДИНА МАРКА МОДЕЛ" от заглавието
      const titleRest = title.replace(/^\d{4}\s+/,'').replace(new RegExp('^'+make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')+'\\s+','i'),'').replace(new RegExp('^'+model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')+'\\s*','i'),'').trim();
      if (titleRest && titleRest.length > 1) series = titleRest;
    }

    const expected = AutoImportVehicle.route(lotUrl)?.id;
    const visibleLot = vehicleText().match(/Lot\s*(?:number|#|num)[:\s]+(\d+)/i)?.[1];
    if (visibleLot && visibleLot !== expected) throw Error('Номерът на видимата обява не съвпада с адреса. Презареди страницата.');
    const identity = { sourceId: expected, verified: !!nd || visibleLot === expected };
    const images = extractImages(nd);

    return AutoImportVehicle.normalize({
      identity,
      raw: { color: g('clr','color','colour') || text.color || '', year, make, model, vin, engine: engineStr, power: hpRaw, fuel: g('ft','fuel','fuelType') || text.fuel || '', transmission: g('tsmn','transmission'), drive: g('drv','drivetrain','drive'), bodyType: g('bst','bodyStyle','body style','body'), odometer: odomRaw, odometerUnit: g('odometerUnit','odometerUnits','odometerUom','odometer unit','odometer units') || (odomKm != null ? visibleOdometer.match(/\b(mi(?:les)?|km)\b/i)?.[1] || '' : ''), sourceFields: { structured: nd, pairs, text } },
      source:'copart', lotNumber, lotUrl, title,
      year, make, model, vin,
      odometerRaw: odomRaw,
      odometerMiles: /\bmi(?:les)?\b/i.test(String(odomRaw)) ? Number(String(odomRaw).match(/[0-9,]+/)?.[0].replace(/,/g, '')) : null,
      odometerKm: odomKm,
      engine:engineStr, displacement, fuel, horsepower,
      transmission, drive, bodyType,
      color:colorBg, colorOriginal:colorEn,
      primaryDamage, secondaryDamage,
      cylinders, hasKey, highlights, series,
      estimatedValue, titleCode, saleDate, location,
      condition, vehicleType,
      productionMonth: text.productionMonth || '',
      images,
      scrapedAt: new Date().toISOString()
    });
  }

  async function scrape() {
    for (let i=0; i<16; i++) {
      await sleep(500);
      if (document.querySelector('h1')?.innerText?.trim()) break;
    }
    await sleep(500);
    vehicleRoot = AutoImportVehicle.scope(document);
    const nd    = fromNextData();
    const pairs = harvestPairs();
    const text  = fromText();
    const data  = parse(nd, pairs, text);
    console.log('[AI] Copart scraped:', JSON.stringify(data, null, 2));
    return data;
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
    if (msg.action === 'PING') sendResponse({ active: true, source: 'copart', ready: true });
  });

  console.log('[AutoImport] copart_scraper v4.0 зареден');
})();
