// Shared source contract. Existing flat fields remain compatible with fillers.
(function () {
  if (globalThis.AutoImportVehicle) return;
  const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
  function route(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:') return null;
      let match;
      if (/(^|\.)copart\.com$/.test(u.hostname) && (match = u.pathname.match(/^\/lot\/(\d+)(?:\/|$)/i))) return { source: 'copart', id: match[1] };
      if (/(^|\.)iaai\.com$/.test(u.hostname) && (match = u.pathname.match(/^\/(?:VehicleDetail|vehicles|vehicle|buy)\/(\d+)(?:[~\/]|$)/i))) return { source: 'iaai', id: match[1] };
    } catch (_) {}
    return null;
  }
  function mileage(value, unit = '') {
    const text = clean(value).replace(/\s*(?:\(\s*(?:actual|a)\s*\)|[-–:]?\s+actual)\s*$/i, '').trim();
    if (/unknown|not actual|exempt|inoperable|not available|discrepancy|broken/i.test(text)) return null;
    const m = text.match(/^(\d{1,3}(?:[, ]\d{3})+|\d+)(?:\.(\d+))?\s*(mi(?:les?)?|km|kilomet(?:er|re)s?)?(?:\s*\((?:actual|a)\))?$/i);
    if (!m) return null;
    const n = Number(m[1].replace(/[, ]/g, '') + (m[2] ? '.' + m[2] : ''));
    const u = (m[3] || clean(unit)).toLowerCase();
    if (m[3] && unit && !((/^mi/.test(u) && /^mi/i.test(unit)) || (/^k/.test(u) && /^k/i.test(unit)))) return null;
    if (!Number.isFinite(n)) return null;
    return /^mi(?:les?)?$/.test(u) ? Math.round(n * 1.609344) : /^(km|kilomet(?:er|re)s?)$/.test(u) ? Math.round(n) : null;
  }
  function fuel(value) {
    const t = clean(value).toLowerCase();
    if (/^(?:plug[ -]?in hybrid|phev|plug-in хибрид)$/.test(t)) return 'Plug-in хибрид';
    if (/^(?:hybrid|gas electric hybrid|gas\/electric|gasoline\/electric|хибриден)$/.test(t)) return 'Хибриден';
    if (/^(?:gas|gasoline|petrol|бензин|бензинов)$/.test(t)) return 'Бензин';
    if (/^(?:diesel|дизел|дизелов)$/.test(t)) return 'Дизел';
    if (/^(?:electric|electric vehicle|ev|електрически)$/.test(t)) return 'Електрически';
    if (/^(?:lpg|liquefied petroleum gas|газ)$/.test(t)) return 'Газ';
    if (/^(?:cng|natural gas|compressed natural gas|метан)$/.test(t)) return 'Метан';
    return '';
  }
  function normalize(data) {
    const d = { ...data, schemaVersion: 1, raw: { ...(data.raw || {}) }, fieldStatus: {} };
    const r = d.raw;
    const input = (key, fallback) => Object.hasOwn(r, key) ? r[key] : (r[key] = fallback ?? '');
    const set = (key, raw, value) => { d[key] = value; d.fieldStatus[key] = clean(raw) ? (value !== '' && value != null ? 'known' : 'manual-review') : 'unknown'; };
    for (const key of ['make','model','year','vin','engine','series','primaryDamage','secondaryDamage','productionMonth','color','cylinders']) input(key, data[key]);
    const name = value => /^(unknown|n\/?a|none|-)?$/i.test(clean(value)) ? '' : clean(value);
    set('make', r.make, name(r.make)); set('model', r.model, name(r.model));
    set('year', r.year, /^\d{4}$/.test(clean(r.year)) && +r.year >= 1900 && +r.year <= new Date().getFullYear() + 1 ? clean(r.year) : '');
    set('vin', r.vin, /^[A-HJ-NPR-Z0-9]{17}$/i.test(clean(r.vin).replace(/\s*\(OK\)$/i, '')) ? clean(r.vin).replace(/\s*\(OK\)$/i, '').toUpperCase() : '');
    const od = input('odometer', data.odometerRaw);
    const unit = input('odometerUnit', '');
    set('odometerKm', od, mileage(od, unit));
    d.odometerRaw = od;
    d.odometerMiles = d.odometerKm != null && /\bmi(?:les?)?\b/i.test(od + ' ' + unit) ? Number(clean(od).match(/^[\d, .]+/)?.[0].replace(/[, ]/g, '')) : null;
    set('fuel', input('fuel', data.fuel), fuel(r.fuel));
    const trans = clean(input('transmission', data.transmission)).toLowerCase();
    set('transmission', r.transmission, /^(automatic|auto|cvt|автоматична)$/.test(trans) ? 'Автоматична' : /^(manual|механична|ръчна)$/.test(trans) ? 'Механична' : '');
    const drive = clean(input('drive', data.drive)).toLowerCase();
    set('drive', r.drive, /^(awd|4wd|4x4|all[ -]wheel drive|four[ -]wheel drive)$/.test(drive) ? '4x4' : /^(rwd|rear[ -]wheel drive|задно)$/.test(drive) ? 'Задно' : /^(fwd|front[ -]wheel drive|предно)$/.test(drive) ? 'Предно' : '');
    const bodies = { coupe:'Купе', sedan:'Седан', suv:'SUV', 'sport utility':'SUV', 'sport utility vehicle':'SUV', wagon:'Комби', estate:'Комби', hatchback:'Хечбек', convertible:'Кабриолет', cabriolet:'Кабриолет', pickup:'Пикап', 'pickup truck':'Пикап', van:'Ван', minivan:'Миниван' };
    const body = clean(input('bodyType', data.bodyType));
    // Auction descriptions commonly include door counts: SEDAN 4D, 4 DOOR SEDAN.
    const bodyText = body.toLowerCase().replace(/\b(?:[2-5]\s*(?:doors?|dr|d))\b/g, '').replace(/[-,]/g, ' ').replace(/\s+/g, ' ').trim();
    const aliases = { 'sport utility vehicle': 'SUV', 'sport utility': 'SUV', 'station wagon': 'Комби', 'sports van': 'Ван', 'hatchback': 'Хечбек', 'convertible': 'Кабриолет', 'cabriolet': 'Кабриолет', 'minivan': 'Миниван', 'pickup': 'Пикап', 'sedan': 'Седан', 'coupe': 'Купе', 'wagon': 'Комби', 'estate': 'Комби', 'suv': 'SUV', 'crossover': 'SUV', 'van': 'Ван' };
    const categories = [...new Set(Object.entries(aliases).filter(([label]) => (' ' + bodyText + ' ').includes(' ' + label + ' ')).map(([, category]) => category))];
    set('bodyType', r.bodyType, bodies[bodyText] || (Object.values(bodies).includes(body) ? body : categories.length === 1 ? categories[0] : ''));

    const engine = clean(r.engine);
    d.engine = engine;
    const size = [...engine.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(L\b|lit(?:er|re)s?\b|cc\b|cm3\b|cm³)/gi)];
    const sizes = [...new Set(size.map(m => Math.round(Number(m[1].replace(',', '.')) * (/^l/i.test(m[2]) ? 1000 : 1))))];
    set('displacement', engine, sizes.length === 1 && sizes[0] > 0 && sizes[0] < 30000 ? String(sizes[0]) : '');
    const power = clean(input('power', data.horsepower));
    const pm = power.match(/^(\d+(?:\.\d+)?)\s*(hp|bhp|ps|к\.с\.|kw)?$/i);
    set('horsepower', power, pm && +pm[1] > 0 && +pm[1] <= 10000 ? String(Math.round(+pm[1] * (/^kw$/i.test(pm[2]) ? 1.359621617 : 1))) : '');
    const colors = { white:'Бял',black:'Черен',silver:'Сребрист',gray:'Сив',grey:'Сив',red:'Червен',blue:'Син',green:'Зелен',brown:'Кафяв',beige:'Бежов',gold:'Златист',yellow:'Жълт',orange:'Оранжев',purple:'Лилав',maroon:'Бордо',pearl:'Перлен',champagne:'Шампанско',charcoal:'Графит',tan:'Бежов',ivory:'Бял',lavender:'Лилав',teal:'Зелен','dark gray':'Тъмно сив','dark grey':'Тъмно сив','light gray':'Светло сив','light grey':'Светло сив','dark blue':'Тъмно син','dark green':'Тъмно зелен','dark red':'Тъмно червен','light blue':'Светло син','space gray':'Графит',midnight:'Черен','white pearl':'Перлен' };
    const color = clean(r.color).split('/')[0].toLowerCase().trim();
    set('color', r.color, colors[color] || (Object.values(colors).includes(clean(r.color)) ? clean(r.color) : ''));
    set('cylinders', r.cylinders, /^\d{1,2}$/.test(clean(r.cylinders)) && +r.cylinders > 0 && +r.cylinders <= 16 ? clean(r.cylinders) : '');
    d.units = { odometerKm: 'km', displacement: 'cm3', horsepower: /kw/i.test(power) ? 'PS (converted from kW)' : 'hp (source)' };
    d.review = Object.entries(d.fieldStatus).filter(([, status]) => status !== 'known').map(([field, status]) => ({ field, status }));
    return d;
  }
  // Keep the baseline selectors but remove unrelated listing cards before scanning.
  function scope(document) {
    const root = document.querySelector('main') || document.body;
    if (!root?.cloneNode) return root;
    const copy = root.cloneNode(true);
    copy.querySelectorAll('aside,nav,footer,[class*="recommend" i],[id*="recommend" i],[class*="related" i],[id*="related" i],[class*="similar" i],[id*="similar" i]').forEach(el => el.remove());
    return copy;
  }
  globalThis.AutoImportVehicle = { route, mileage, fuel, normalize, scope };
})();
