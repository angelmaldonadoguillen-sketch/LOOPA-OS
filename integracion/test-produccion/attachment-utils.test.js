const assert = require('node:assert/strict');
const A = require('./attachment-utils.js');

assert.equal(A.validateImageFile({ type: 'image/png', size: 42 }).ok, true);
assert.match(A.validateImageFile({ type: 'application/pdf', size: 42 }).message, /JPG/);
assert.match(A.validateImageFile({ type: 'image/jpeg', size: A.MAX_IMAGE_BYTES + 1 }).message, /10 MB/);
assert.equal(A.validateDeliverableFile({ type: 'application/pdf', size: 42 }).ok, true);
assert.equal(A.validateDeliverableFile({ type: 'application/zip', size: 42 }).ok, true);
assert.equal(A.validateDeliverableFile({ type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 42 }).ok, true);
assert.match(A.validateDeliverableFile({ type: 'video/mp4', size: 42 }).message, /enlace/);
assert.match(A.validateDeliverableFile({ type: 'audio/mpeg', size: 42 }).message, /enlace/);
assert.equal(A.validateImageUrl('https://example.com/a.png'), true);
assert.equal(A.validateImageUrl('javascript:alert(1)'), false);
assert.equal(A.normalizeRemoteImageUrl('https://img.example/a.jpg'), 'https://img.example/a.jpg');
assert.equal(A.normalizeRemoteImageUrl('https://img.example/a.svg'), null);
assert.equal(A.normalizeRemoteImageUrl('data:image/png;base64,abc'), null);
assert.deepEqual(
  A.extractImageUrlsFromHtml('<script>x</script><img onerror="x" src="https://img.example/a.jpg?x=1&amp;y=2"><img src="javascript:x">'),
  ['https://img.example/a.jpg?x=1&y=2']
);
assert.equal(A.classifyPasteSource({ items: [{ type: 'image/png' }], html: '<img src="https://x/a.jpg">' }).kind, 'file');
assert.equal(A.classifyPasteSource({ html: '<div><img src="https://x/a.webp" onload="x"></div>' }).kind, 'html-images');
assert.equal(A.classifyPasteSource({ text: 'https://x/a.gif?size=2' }).kind, 'text-image-url');
assert.equal(A.classifyPasteSource({ text: 'https://i.pinimg.com/originals/ab/cd/ef' }).kind, 'text-image-url');
assert.equal(A.classifyPasteSource({ text: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc' }).kind, 'text-image-url');
assert.equal(A.classifyPasteSource({ text: 'https://example.com/article' }).kind, 'text');
assert.equal(A.classifyPasteSource({ html: '<b>texto</b>' }).kind, 'html');
assert.equal(A.safeFileName('../../Mi foto ñ.png'), '..-..-Mi-foto-n.png');

async function run() {
  let progress = 0;
  const successfulTask = {
    snapshot: { ref: 'ok' },
    on(_event, next, _error, complete) {
      next({ bytesTransferred: 5, totalBytes: 10 });
      complete();
    }
  };
  const snapshot = await A.waitForUpload(successfulTask, { onProgress: p => { progress = p; }, timeoutMs: 50 });
  assert.equal(progress, 50);
  assert.equal(snapshot.ref, 'ok');

  let canceled = false;
  const stalledTask = { on() {}, cancel() { canceled = true; } };
  await assert.rejects(A.waitForUpload(stalledTask, { timeoutMs: 5 }), err => err.code === 'storage/timeout');
  assert.equal(canceled, true);
  console.log('attachment-utils: 22 checks passed');
}

run().catch(err => { console.error(err); process.exitCode = 1; });
