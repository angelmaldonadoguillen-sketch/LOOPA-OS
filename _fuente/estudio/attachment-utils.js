(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FrameAttachments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const MAX_DELIVERABLE_BYTES = 25 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  const ALLOWED_DOCUMENT_TYPES = new Set([
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed',
  ]);

  const validateImageFile = (file) => {
    if (!file) return { ok: false, message: 'No se seleccionó ningún archivo.' };
    if (!ALLOWED_IMAGE_TYPES.has(String(file.type || '').toLowerCase())) {
      return { ok: false, message: 'Usá una imagen JPG, PNG, WebP o GIF.' };
    }
    if (!Number.isFinite(file.size) || file.size <= 0) {
      return { ok: false, message: 'La imagen está vacía o no se puede leer.' };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, message: 'La imagen supera el límite de 10 MB.' };
    }
    return { ok: true };
  };

  const validateDeliverableFile = (file) => {
    if (!file) return { ok: false, message: 'No se seleccionó ningún archivo.' };
    const type = String(file.type || '').toLowerCase();
    const allowed = ALLOWED_IMAGE_TYPES.has(type) || ALLOWED_DOCUMENT_TYPES.has(type);
    if (!allowed) return { ok: false, message: 'Adjuntá una imagen, PDF, documento de Office, TXT, CSV o ZIP. Para video y audio usá un enlace.' };
    if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, message: 'El archivo está vacío o no se puede leer.' };
    if (file.size > MAX_DELIVERABLE_BYTES) return { ok: false, message: 'El archivo supera el límite de 25 MB.' };
    return { ok: true };
  };

  const validateImageUrl = (value) => {
    try {
      const url = new URL(String(value || '').trim());
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch (_) { return false; }
  };

  const normalizeRemoteImageUrl = (value) => {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      // SVG remoto no se admite: puede contener contenido activo y no forma
      // parte de los formatos raster aceptados por las cargas locales.
      if (/\.svg(?:z)?$/i.test(url.pathname)) return null;
      url.username = '';
      url.password = '';
      return url.href;
    } catch (_) { return null; }
  };

  const safeCodePoint = (raw, radix) => {
    const point = parseInt(raw, radix);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  };

  const decodeHtmlEntities = (value) => String(value || '')
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(n, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(n, 16))
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');

  const extractImageUrlsFromHtml = (html) => {
    const urls = [];
    const seen = new Set();
    const re = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
    let match;
    while ((match = re.exec(String(html || ''))) !== null && urls.length < 10) {
      const normalized = normalizeRemoteImageUrl(decodeHtmlEntities(match[1] || match[2] || match[3] || ''));
      if (normalized && !seen.has(normalized)) { seen.add(normalized); urls.push(normalized); }
    }
    return urls;
  };

  const looksLikeImageUrl = (value) => {
    const normalized = normalizeRemoteImageUrl(value);
    if (!normalized) return false;
    const url = new URL(normalized);
    if (/\.(?:jpe?g|png|webp|gif|avif)(?:$|[?#])/i.test(normalized)) return true;
    if (/^(?:i\.pinimg\.com|images\.unsplash\.com|encrypted-tbn\d*\.gstatic\.com)$/i.test(url.hostname)) return true;
    if (/(?:^|\.)googleusercontent\.com$/i.test(url.hostname)) return true;
    return /^(?:jpe?g|png|webp|gif|avif)$/i.test(url.searchParams.get('format') || url.searchParams.get('fm') || '');
  };

  const classifyPasteSource = ({ items = [], html = '', text = '' } = {}) => {
    const imageItem = [...items].find(item => String(item?.type || '').toLowerCase().startsWith('image/'));
    if (imageItem) return { kind: 'file', item: imageItem };
    if (html) {
      const urls = extractImageUrlsFromHtml(html);
      return urls.length ? { kind: 'html-images', urls } : { kind: 'html', html };
    }
    const trimmed = String(text || '').trim();
    const url = normalizeRemoteImageUrl(trimmed);
    if (url && looksLikeImageUrl(url)) return { kind: 'text-image-url', urls: [url] };
    return { kind: 'text' };
  };

  const safeFileName = (name) => String(name || 'image')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';

  const storageErrorMessage = (err) => {
    const code = err && err.code || '';
    if (code === 'storage/timeout' || code === 'storage/unknown' || code === 'storage/retry-limit-exceeded')
      return 'Storage no respondió. Verificá que el bucket esté listo y probá de nuevo.';
    if (code === 'storage/unauthorized') return 'No tenés permiso para subir imágenes.';
    if (code === 'storage/quota-exceeded') return 'Se agotó el espacio de Storage.';
    if (code === 'storage/canceled') return 'La carga fue cancelada.';
    return 'No se pudo subir la imagen. Probá de nuevo.';
  };

  const waitForUpload = (task, options) => {
    const opts = options || {};
    const timeoutMs = opts.timeoutMs || 30000;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        if (typeof task.cancel === 'function') task.cancel();
        finish(reject, Object.assign(new Error('Upload timeout'), { code: 'storage/timeout' }));
      }, timeoutMs);
      task.on('state_changed', (snap) => {
        const total = snap && snap.totalBytes || 0;
        if (opts.onProgress && total > 0) opts.onProgress(Math.round((snap.bytesTransferred / total) * 100));
      }, (err) => finish(reject, err), () => finish(resolve, task.snapshot));
    });
  };

  return {
    MAX_IMAGE_BYTES, MAX_DELIVERABLE_BYTES, validateImageFile, validateDeliverableFile, validateImageUrl, normalizeRemoteImageUrl,
    extractImageUrlsFromHtml, looksLikeImageUrl, classifyPasteSource, safeFileName, storageErrorMessage, waitForUpload,
  };
});
