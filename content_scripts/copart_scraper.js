// copart_scraper.js v4.0 – максимално извличане на данни
(function () {
  'use strict';
  if (window.__copartScraperLoaded) return;
  window.__copartScraperLoaded = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function milesToKm(value, unit = '') {
    const raw = String(value).trim();
    // Unknown/not-actual readings are not a verified distance. Preserve zero.
    if (/unknown|not actual|exempt|inoperable|not available/i.test(raw)) return null;
    const match = raw.match(/^([0-9][0-9, ]*)(?:\s*(mi(?:les)?|km|kilomet(?:er|re)s?))?(?:\s|$)/i);
    if (!match) return null;
    const number = Number(match[1].replace(/[, ]/g, ''));
    const units = (match[2] || unit).toLowerCase().trim();
    if (!Number.isFinite(number)) return null;
    if (/^(km|kilomet(?:er|re)s?)$/.test(units)) return number;
    if (/^(mi|miles?)$/.test(units)) return Math.round(number * 1.60934);
    return null;
  }

  // ── От __NEXT_DATA__ (Next.js JSON) ──
  function fromNextData() {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el) return null;
    try {
      const root = JSON.parse(el.textContent);
      function search(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 12) return null;
        const expected = location.pathname?.match(/\/lot\/(\d+)/i)?.[1] || location.href.match(/\/lot\/(\d+)/i)?.[1];
        const number = String(obj.lotNumberStr || obj.ln || '');
        if (number && number === expected) return obj;
        for (const v of Object.values(obj)) { const r = search(v, depth+1); if (r) return r; }
        return null;
      }
      const lot = search(root, 0);
      if (lot) { console.log('[AI] Next.js keys:', Object.keys(lot).slice(0,30).join(', ')); return lot; }
    } catch(e) { console.warn('[AI] Next.js parse:', e.message); }
    return null;
  }

  // ── Label/Value pairs от DOM ──
  function harvestPairs() {
    const map = {};
    document.querySelectorAll('tr').forEach(tr => {
      const tds = [...tr.querySelectorAll('td,th')];
      for (let i=0; i<tds.length-1; i++) {
        const k=tds[i].innerText.trim().replace(/:$/,'').toLowerCase();
        const v=tds[i+1].innerText.trim();
        if(k&&v&&k.length<50){map[k]=v;i++;}
      }
    });
    document.querySelectorAll('div,li').forEach(p=>{
      const ch=[...p.children].filter(c=>c.innerText?.trim());
      if(ch.length===2){
        const k=ch[0].innerText.trim().replace(/:$/,'').toLowerCase();
        const v=ch[1].innerText.trim();
        if(k&&v&&k.length<50&&!k.includes('\n'))map[k]=v;
      }
    });
    document.querySelectorAll('dl').forEach(dl=>{
      const dts=dl.querySelectorAll('dt'),dds=dl.querySelectorAll('dd');
      dts.forEach((dt,i)=>{if(dds[i])map[dt.innerText.trim().toLowerCase()]=dds[i].innerText.trim();});
    });
    return map;
  }

  // ── Regex scan на целия текст ──
  function fromText() {
    const t = document.body.innerText;
    const g = re => t.match(re)?.[1]?.trim() || '';
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
  function extractImages() {
    const set = new Set();
    // От __NEXT_DATA__
    try {
      const nd = document.getElementById('__NEXT_DATA__');
      if (nd) {
        const re = /https?:\\?\/\\?\/[^\s"'\\]+\.(?:jpg|jpeg|png|webp)/gi;
        let m;
        while ((m = re.exec(nd.textContent)) !== null) {
          const url = m[0].replace(/\\u002F/g,'/').replace(/\\/g,'');
          const full = url.replace(/_thb\./i,'_ful.').replace(/_thumb\./i,'_full.').replace(/\/thb\//i,'/ful/').replace(/\/thumb\//i,'/full/').replace(/tn_/i,'');
          if (full.startsWith('http')) set.add(full);
        }
      }
    } catch(e) {}
    // От img тагове
    document.querySelectorAll('img[src],img[data-src]').forEach(img => {
      const src = img.getAttribute('data-src') || img.src || '';
      if (!src.match(/\.(jpg|jpeg|png|webp)/i) || !src.startsWith('http')) return;
      const full = src.replace(/_thb\./i,'_ful.').replace(/_thumb\./i,'_full.').replace(/tn_/i,'');
      set.add(full);
    });
    // От inline scripts
    document.querySelectorAll('script:not([src])').forEach(s => {
      const re = /https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp)/gi;
      let m;
      while ((m = re.exec(s.textContent)) !== null) {
        const url = m[0].replace(/\\u002F/g,'/').replace(/\\/g,'');
        if (url.includes('copart') || url.includes('auction')) set.add(url);
      }
    });
    return [...set].filter(u => u.startsWith('http')).slice(0, 40);
  }

  // ── Парсирай данни ──
  function parse(nd, pairs, text) {
    function g(...keys) {
      for (const k of keys) {
        const v = [nd?.[k], pairs[k.toLowerCase()], text[k]].find(value => value != null && String(value).trim() !== '');
        if (v != null) return String(v).trim();
      }
      return '';
    }

    const h1 = document.querySelector('h1')?.innerText?.trim() || '';
    const title = h1 || g('lotDescription','ld','title');

    let year = g('lcy','year','yr') || '';
    let make = g('mkn','make','mk') || '';
    let model = g('mdn','model','md') || '';

    if (!year && title) {
      const m = title.match(/^(\d{4})\s+(.+)$/);
      if (m) {
        year = m[1];
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
      const vinFull = document.body.innerText.match(/VIN[:\s#]+([A-HJ-NPR-Z0-9]{17})/i)?.[1] || '';
      if (vinFull) vin = vinFull;
    }

    // Lot
    const lotUrl = window.location.href;
    const lotNumber = lotUrl.match(/lot[\/\-](\d+)/i)?.[1]
      || g('lotNumberStr','ln','lotNumber')
      || document.body.innerText.match(/Lot\s*(?:number|#|num)[:\s]+(\d+)/i)?.[1] || '';

    // Одометър
    const odomRaw = g('od','odometer','mileage') || text.odometer || '';
    let odomKm = milesToKm(odomRaw, g('odometerUnit','odometerUnits','odometerUom'));
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
      const titleRest = title.replace(/^\d{4}\s+/,'').replace(new RegExp('^'+make+'\\s+','i'),'').replace(new RegExp('^'+model+'\\s*','i'),'').trim();
      if (titleRest && titleRest.length > 1) series = titleRest;
    }

    const images = extractImages();

    return {
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
    };
  }

  async function scrape() {
    for (let i=0; i<16; i++) {
      await sleep(500);
      if (document.querySelector('h1')?.innerText?.trim()) break;
    }
    await sleep(500);
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
