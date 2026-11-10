// FRAME ⇄ LOOPA (fusión, tanda 3.6): lo que FRAME respeta de las ventas.
//   node loopa-fusion.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const L = require('./loopa-fusion.js');

const venta = {
  id: 'loopa_abc', title: 'Café Aurora · Reels', client: 'Café Aurora', clientId: 'c1', status: 'producing',
  workspaceId: 'ws1', workspaceIds: ['ws1', 'ws2'], viewerIds: ['u1', 'u2'], deadline: '2026-11-20',
  sourceSystem: 'loopa', sourceSaleId: 's1', sourceSaleNumber: 1042, sourceSaleStatus: 'confirmed', sourceLineIds: ['l1'],
  sourceEventId: 'e1', sourceTemplateVersions: { t: 1 }, sourceWorkItems: [], idempotencyKey: 'k', integration: { v: 1 },
};
const manual = { id: 'p1', title: 'Sesión', clientId: 'c1', status: 'briefing', workspaceId: 'ws1' };

// Los 10 campos de procedencia, iguales a provenanceKeys() de las reglas.
assert.equal(L.PROVENANCE_KEYS.length, 10);
assert.equal(L.isFromSale(venta), true);
assert.equal(L.isFromSale(manual), false);
assert.equal(L.isFromSale(null), false);
const limpia = L.withoutProvenance(venta);
L.PROVENANCE_KEYS.forEach(k => assert.equal(Object.prototype.hasOwnProperty.call(limpia, k), false, k));
assert.equal(venta.sourceSystem, 'loopa', 'no muta el original');

// Duplicar: copia manual, en el tablero actual; la ficha sólo si es de ese tablero.
const c1 = L.duplicateOf(venta, { newId: 'p9', wsId: 'ws1', viewerIds: ['u1'], now: '2026-11-10T00:00:00Z', clientIdsInTarget: ['c1'] });
assert.equal(c1.id, 'p9');
assert.equal(c1.title, 'Café Aurora · Reels (copia)');
assert.equal(L.isFromSale(c1), false);
assert.deepEqual([c1.workspaceId, c1.workspaceIds, c1.viewerIds, c1.clientId], ['ws1', ['ws1'], ['u1'], 'c1']);
const c2 = L.duplicateOf(venta, { newId: 'p8', wsId: 'ws2', viewerIds: ['u2'], now: 'x', clientIdsInTarget: ['c7'] });
assert.equal(Object.prototype.hasOwnProperty.call(c2, 'clientId'), false, 'en otro tablero, sin ficha ajena');
assert.deepEqual(L.duplicateOf({ ...venta, tags: ['reels', 'loopa'] }, { newId: 'p7', wsId: 'ws1', viewerIds: [], now: 'x', clientIdsInTarget: [] }).tags, ['reels'], 'la copia manual no se presenta como venta');

// Restaurar: nunca una tarea de venta; sin ficha si la ficha ya no sirve.
assert.equal(L.restorableFromTrash(venta, { originId: 'ws1', clientOk: true }).ok, false);
assert.equal(L.restorableFromTrash({ ...manual, id: 'loopa_x' }, { originId: 'ws1', clientOk: true }).ok, false, 'ids loopa_* son del servidor');
const r1 = L.restorableFromTrash(manual, { originId: 'ws1', clientOk: true });
assert.deepEqual([r1.ok, r1.project.clientId, r1.project.workspaceId], [true, 'c1', 'ws1']);
const r2 = L.restorableFromTrash(manual, { originId: 'ws1', clientOk: false });
assert.equal(Object.prototype.hasOwnProperty.call(r2.project, 'clientId'), false, 'ficha borrada: vuelve sin ficha');
const r3 = L.restorableFromTrash({ ...manual, clientId: '' }, { originId: 'ws1', clientOk: false });
assert.equal(Object.prototype.hasOwnProperty.call(r3.project, 'clientId'), false, 'un clientId vacío tampoco se recrea');

// Fichas con ventas de LOOPA.
assert.equal(L.clientHasSales({ commercial: {} }), true);
assert.equal(L.clientHasSales({ legacyLoopaIds: ['CL-1'] }), true);
assert.equal(L.clientHasSales({ hasSales: true }), true);
// Como la regla: alcanza con que la clave exista, aunque esté vacía.
assert.equal(L.clientHasSales({ legacyLoopaIds: [] }), true);
assert.equal(L.clientHasSales({ hasSales: false }), true);
assert.equal(L.clientHasSales({ commercial: null }), true);
assert.equal(L.clientHasSales({ name: 'x' }), false);

// Editar una ficha: sólo lo de FRAME que cambió; lo del servidor, nunca.
const prev = { id: 'c1', name: 'Café', tags: ['a'], notes: 'n', commercial: { telefono: '1' }, hasSales: true, createdAt: 'x', updatedBy: 'srv' };
const next = { id: 'c1', name: 'Café Aurora', tags: ['a'], commercial: { telefono: 'VIEJO' }, hasSales: false, createdAt: 'y' };
assert.deepEqual(L.clientUpdatePatch(prev, next), { name: 'Café Aurora' });
assert.deepEqual(L.clientRemovedKeys(prev, next), ['notes'], 'lo que la pantalla quitó (no las claves del servidor)');
assert.deepEqual(L.clientUpdatePatch(prev, prev), {});

// app.jsx usa todo esto donde corresponde.
const app = fs.readFileSync('app.jsx', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
// LOOPA (Fase 4): loopa-fusion.js va dentro del ámbito de Producción, antes que app.jsx.
assert.ok(html.indexOf('// ── estudio: loopa-fusion.js') > 0 && html.indexOf('// ── estudio: loopa-fusion.js') < html.indexOf('// ── estudio: app.jsx'));
assert.match(app, /if \(window\.FrameLoopa\.isFromSale\(project\)\) \{[\s\S]{0,200}status: 'archived'/, 'una tarea de venta se archiva');
assert.match(app, /const batch = window\.db\.batch\(\);[\s\S]{0,300}batch\.set\(window\.db\.collection\('frame_trash'\)[\s\S]{0,400}batch\.delete\(col\.doc\(id\)\);[\s\S]{0,200}await batch\.commit\(\);/, 'papelera y borrado en un lote');
assert.doesNotMatch(app, /await window\.db\.collection\('frame_trash'\)\.doc\(id\)\.set\(trashItem\)/, 'nunca la papelera por separado');
assert.match(app, /window\.FrameLoopa\.restorableFromTrash\(trashed/);
assert.match(app, /const copy   = window\.FrameLoopa\.duplicateOf\(original/);
assert.match(app, /if \(window\.FrameLoopa\.clientHasSales\(client\)\)/);
assert.match(app, /window\.FrameLoopa\.clientUpdatePatch\(prev, next\)/);
assert.doesNotMatch(app, /frame_clients'\)\.doc\(client\.id\)\.set\(stampWs\(updated\)\)/, 'el portal no reescribe la ficha entera');

// Revisión 3.6: sin loopa-fusion.js no se escribe a medias.
assert.match(app, /const fusionLista = \(\) => \{/);
assert.ok((app.match(/fusionLista\(\)/g) || []).length >= 5, 'cada camino que usa FrameLoopa pasa antes por fusionLista()');
assert.match(app, /\.update\(\{ favorite: updated\.favorite \}\)/, 'favorito: sólo el campo');
assert.match(app, /state\.projects\.some\(p => p\.id === trashed\.id\)/, 'una copia vieja no pisa una tarea viva');
assert.match(app, /delete\(\)\s*\.then\(\(\) => \{\s*if \(!client\?\.portalToken\) return;/, 'el portal se apaga después del borrado');
assert.match(fs.readFileSync('views.jsx', 'utf8'), /disabled=\{!!window\.FrameLoopa\?\.isFromSale\(project\)\}/, 'entrega de venta: sólo lectura (tarjeta)');
assert.match(fs.readFileSync('modal.jsx', 'utf8'), /disabled=\{!!window\.FrameLoopa\?\.isFromSale\(project\)\}/, 'entrega de venta: sólo lectura (detalle)');

// Punto A: las reglas de este repo son las de la fusión (generadas desde
// LOOPA-OS con reglas-para-frame.cjs). Un deploy de reglas desde acá no
// revierte lo que protege las ventas.
const rules = fs.readFileSync('firestore.rules.v2', 'utf8');
assert.doesNotMatch(rules, /NO PUBLICAR/);
assert.match(rules, /function provenanceKeys\(\)/);
L.PROVENANCE_KEYS.forEach(k => assert.ok(rules.includes(`'${k}'`), `regla sin ${k}`));
assert.match(rules, /match \/loopa_sales\/\{saleId\}/);
assert.match(rules, /match \/loopa_config\/\{doc\}/);

// Fase 4: FRAME ya no existe como programa; Producción es parte de LOOPA.

console.log('loopa-fusion: ok');
