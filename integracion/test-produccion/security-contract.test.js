const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.jsx', 'utf8');
const routine = fs.readFileSync('routine.jsx', 'utf8');
const modal = fs.readFileSync('modal.jsx', 'utf8');
const firestore = fs.readFileSync('firestore.rules.v2', 'utf8');
const storage = fs.readFileSync('storage.rules', 'utf8');
const firebase = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));

assert.doesNotMatch(app + routine, /collection\(['"]frame_config['"]\)/);
assert.match(routine, /frame_workspaces[\s\S]*daily_routine/);
assert.match(app, /includeMetadataChanges:\s*true/);
assert.match(app, /_hasPendingWrites/);
assert.match(firestore, /match \/config\/\{doc\}/);
assert.match(firestore, /'daily_routine'/);
assert.match(firestore, /match \/comments\/\{commentId\}/);
assert.match(firestore, /match \/activity\/\{activityId\}/);
assert.match(firestore, /allow update, delete: if false/);
assert.doesNotMatch(modal, /batch\.set\(col\.doc\(c\.id\), c\)/);
assert.match(modal, /_legacy:\s*true/);
assert.match(storage, /match \/frame-covers\/\{projectId\}\/\{fileName\}/);
assert.match(storage, /match \/frame-descriptions\/\{projectId\}\/\{fileName\}/);
assert.match(storage, /match \/frame-deliverables\/\{projectId\}\/\{fileName\}/);
assert.match(storage, /match \/frame-client-comments\/\{token\}\/\{projectId\}\/\{fileName\}/);
assert.match(storage, /function validDeliverable/);
assert.doesNotMatch(storage, /request\.resource\.contentType\.matches\('video\/\.\*'\)/);
assert.doesNotMatch(storage, /frame_users/);
assert.match(storage, /let projectDoc = firestore\.get[\s\S]*let workspaceDoc = firestore\.get/);
assert.match(firestore, /function hasProjectAccess\(data\)/);
assert.match(firestore, /match \/frame_portfolio_drafts\/\{uid\}/);
assert.match(firestore, /match \/frame_portfolios\/\{uid\}/);
assert.match(firestore, /allow get: if resource\.data\.published == true \|\| \(approved\(\) && myUid\(\) == uid\)/);
assert.match(firestore, /allow list: if false;[\s\S]*match \/chunks\/\{chunkId\}/);
assert.match(firestore, /data\.payload\.size\(\) <= 400000/);
assert.match(firestore, /allow create, update: if approved\(\) && myUid\(\) == uid && validChunk/);
assert.match(firestore, /match \/frame_portfolio_usage\/\{uid\}/);
assert.match(storage, /match \/frame-portfolios\/\{uid\}\/\{assetId\}/);
assert.match(storage, /reservation\(\)\.status == 'reserved'/);
assert.match(firestore, /data\.workspaceIds\.size\(\) <= 5/);
assert.match(firestore, /data\.viewerIds\.size\(\) <= 30/);
assert.match(firestore, /function selectedWorkspaceMembers\(data\)/);
assert.match(firestore, /data\.viewerIds\.toSet\(\) == selectedWorkspaceMembers\(data\)/);
assert.match(firestore, /request\.resource\.data\.workspaceId == resource\.data\.workspaceId/);
assert.match(storage, /request\.auth\.uid in projectDoc\.data\.viewerIds/);
assert.equal(firebase.storage.rules, 'storage.rules');

// El sanitizador recorre los hijos ANTES de desenvolver la etiqueta padre.
// Al revés, <foo><img onerror=…></foo> salía intacto: al desenvolver <foo>
// sus hijos quedaban fuera del arreglo que se estaba recorriendo.
const data = fs.readFileSync('data.jsx', 'utf8');
const walkBody = data.match(/const walk = \(node\) => \{[\s\S]*?DESC_ALLOWED_TAGS/)[0];
assert.match(walkBody, /walk\(el\);[\s\S]*if \(!DESC_ALLOWED_TAGS/);

// Todo enlace guardado sale con noopener: si no, la página de destino puede
// reescribir la pestaña de FRAME vía window.opener.
assert.match(data, /setAttribute\('rel', 'noopener noreferrer'\)/);
assert.match(data, /if \(!el\.getAttribute\('href'\)\) el\.replaceWith/);

// El texto visible del enlace viene del portapapeles.
assert.match(modal, /escapeDescText\(picked \|\| shortenUrl\(url\)\)/);

// Cada opción del menú de imagen cierra el menú.
assert.match(modal, /const closeImageMenu = \(\) => \{/);
assert.match(modal, /selectedImage\.setAttribute\(attribute, value\);[\s\S]*closeImageMenu\(\);/);

console.log('security-contract: 28 checks passed');
