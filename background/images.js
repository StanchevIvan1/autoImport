// Temporary binary transport only; persistent state contains URLs and outcomes.
const AutoImportImageFetch = (() => {
  const active = new Map();
  let running = 0;
  const waiting = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  function abortChanged(changes, area) {
    if (area !== 'local' || !changes.importState) return;
    const jobs = Object.values(changes.importState.newValue?.transfers || {});
    for (const task of active.values()) {
      if (!jobs.some(j => j.id === task.transferId && ['images','imagesAssigned'].includes(j.phase))) task.controller.abort();
    }
  }
  chrome.storage.onChanged.addListener(abortChanged);
  async function imageBlob(response) {
    if (!/^image\/(jpeg|png|gif|webp|avif|heic|heif)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw Object.assign(Error('Отговорът не е поддържано изображение.'), { code: 'invalid-content' });
    if (+response.headers.get('content-length') > AutoImportImages.MAX_BYTES) throw Object.assign(Error('Снимката надвишава 10 MB.'), { code: 'too-large' });
    const reader = response.body?.getReader();
    if (!reader) throw Object.assign(Error('Липсва съдържание на снимката.'), { code: 'invalid-content' });
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > AutoImportImages.MAX_BYTES) throw Object.assign(Error('Снимката надвишава 10 MB.'), { code: 'too-large' });
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const blob = new Blob(chunks, { type: response.headers.get('content-type').split(';')[0] });
    const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    const signature = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ||
      bytes[0] === 137 && ascii(1,4) === 'PNG' || /^GIF8[79]a$/.test(ascii(0,6)) ||
      ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP' || ascii(4,8) === 'ftyp' && /avif|heic|heix|mif1/.test(ascii(8,24));
    if (size < 12 || !signature) throw Object.assign(Error('Невалидно или празно изображение.'), { code: 'invalid-content' });
    if (typeof createImageBitmap === 'function') {
      let bitmap;
      try { bitmap = await createImageBitmap(blob); if (bitmap.width * bitmap.height > 40000000) throw Error('Снимката надвишава 40 мегапиксела.'); }
      catch (error) { throw Object.assign(Error('Снимката не може да се декодира: ' + error.message), { code: 'invalid-content' }); }
      finally { bitmap?.close(); }
    }
    return blob;
  }
  async function run(msg, sender, task) {
    if (waiting.length >= 32) throw Error('Твърде много чакащи снимки. Опитай отново.');
    if (running >= 2) await new Promise(resolve => waiting.push(resolve));
    else running++;
    try {
      await AutoImportTransfers.authorizeImage(msg, sender);
      if (!AutoImportImages.validUrl(msg.url)) {
        await AutoImportTransfers.handle({ action: 'IMAGE_STATE', transferId: msg.transferId, url: msg.url, state: 'failed', code: 'invalid-url', error: 'Невалиден адрес на снимка.' }, sender);
        throw Error('Невалиден адрес на снимка.');
      }
      for (let attempt = 1; attempt <= 3; attempt++) {
        await AutoImportTransfers.authorizeImage(msg, sender);
        if (task.controller.signal.aborted) throw Error('Прехвърлянето е отменено.');
        await AutoImportTransfers.handle({ action: 'IMAGE_STATE', transferId: msg.transferId, url: msg.url, state: 'fetching', attempt }, sender);
        try {
          const response = await fetch(msg.url, { credentials: 'omit', redirect: 'manual', signal: AbortSignal.any([task.controller.signal, AbortSignal.timeout(15000)]) });
          if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) throw Object.assign(Error('Адресът пренасочва. Извлечи отново актуален адрес на снимката.'), { code: 'redirect-unsupported' });
          if (!response.ok) throw Object.assign(Error(`Снимката е недостъпна (HTTP ${response.status}).`), { code: `http-${response.status}`, retryable: [408,425,429,500,502,503,504].includes(response.status) });
          const blob = await imageBlob(response);
          await AutoImportTransfers.authorizeImage(msg, sender);
          if (task.controller.signal.aborted) throw Error('Прехвърлянето е отменено.');
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.onerror = () => reject(Error('Неуспешно прочитане на снимката.')); reader.readAsDataURL(blob);
          });
          await AutoImportTransfers.handle({ action: 'IMAGE_STATE', transferId: msg.transferId, url: msg.url, state: 'fetched' }, sender);
          return { success: true, dataUrl, mimeType: blob.type };
        } catch (error) {
          if (task.controller.signal.aborted) throw error;
          const retryable = error.retryable === true || error.name === 'TimeoutError' || !error.code;
          if (retryable && attempt < 3) { await delay(500 * 2 ** (attempt - 1)); continue; }
          await AutoImportTransfers.handle({ action: 'IMAGE_STATE', transferId: msg.transferId, url: msg.url, state: 'failed', code: error.code || 'fetch-failed', error: error.message }, sender);
          throw error;
        }
      }
    } finally { const next = waiting.shift(); if (next) next(); else running--; }
  }
  async function fetchImage(msg, sender) {
    // Validate ownership before sharing a response with a duplicate requester.
    await AutoImportTransfers.authorizeImage(msg, sender);
    const key = `${msg.transferId}:${msg.url}`;
    if (active.has(key)) return active.get(key).promise;
    const task = { transferId: msg.transferId, controller: new AbortController() };
    task.promise = run(msg, sender, task).finally(() => active.delete(key));
    active.set(key, task);
    return task.promise;
  }
  return { fetchImage, imageBlob };
})();
