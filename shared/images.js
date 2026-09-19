(function () {
  if (globalThis.AutoImportImages) return;
  const LIMIT = 17, MAX_BYTES = 10 * 1024 * 1024;
  function validUrl(value) {
    if (typeof value !== 'string' || value.length > 8192 || value !== value.trim()) return false;
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && /(^|\.)(copart\.com|iaai\.com)$/.test(u.hostname);
    } catch (_) { return false; }
  }
  const unique = urls => [...new Set(urls.filter(validUrl))].slice(0, 100);
  function resolveUrl(value, base) {
    if (typeof value !== 'string' || !value || value !== value.trim()) return '';
    if (validUrl(value)) return value; // Keep signed absolute URLs byte-for-byte.
    if (!/^(?:\/|\.\/|\.\.\/)/.test(value)) return '';
    try { const url = new URL(value, base).href; return validUrl(url) ? url : ''; } catch (_) { return ''; }
  }
  function ensure(job) {
    if (!job.imageItems) job.imageItems = job.data.images.slice(0, 100).map((url, index) => ({
      id: `${job.id}:${index}`, url, index, state: index >= LIMIT ? 'excluded' : job.phase === 'imagesAssigned' ? 'unconfirmed' : 'pending', attempts: 0,
      filename: `autoimport_${job.id}_${String(index + 1).padStart(2, '0')}.jpg`
    }));
    return job.imageItems;
  }
  function summary(items) {
    const count = state => items.filter(item => item.state === state).length;
    const uploaded = count('uploaded'), failed = count('failed'), cancelled = count('cancelled'), excluded = count('excluded');
    return { expected: items.length, uploaded, failed, cancelled, excluded,
      unconfirmed: count('unconfirmed') + count('uploading'),
      outcome: !items.length ? 'no-images' : uploaded === items.length ? 'complete' : uploaded && (failed || cancelled || excluded) ? 'partial' : failed && failed + excluded === items.length ? 'failed' : cancelled === items.length ? 'cancelled' : 'pending' };
  }
  globalThis.AutoImportImages = { LIMIT, MAX_BYTES, validUrl, resolveUrl, unique, ensure, summary };
})();
