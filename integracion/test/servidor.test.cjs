'use strict';
// Fase 3, tanda 3.1 — funciones del servidor (functions/loopa-server.js) en
// memoria: quién puede vender, la venta de punta a punta hasta las tarjetas,
// errores saneados, configuración faltante y el barrido.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../functions/production-plan');
const repo = require('../../functions/repositories/sales');
const server = require('../../functions/loopa-server');
const { MemoryStore } = require('../memory-store.cjs');
const { loadFixtures, buildSale } = require('../harness.cjs');

const fx = loadFixtures();
const { COLLECTIONS } = core;
const T = '2026-11-10T15:00:00.000Z';
const now = () => T;
const U = { uid: 'u-com' };

function seeded({ production = true } = {}) {
  // Sin reloj real: config_missing anota la hora con el now inyectado.
  const store = new MemoryStore();
  store.seed('frame_users', 'u-com', { status: 'active' });
  store.seed('frame_users', 'u-prod', { status: 'active' });
  store.seed('frame_users', 'u-pend', { status: 'pending' });
  store.seed('loopa_config', 'access', { commercialUids: ['u-com', 'u-pend'] });
  if (production) store.seed('loopa_config', 'production', { defaultWorkspaceId: fx.context.defaultWorkspaceId, allowedWorkspaceIds: fx.context.allowedWorkspaceIds });
  Object.entries(fx.context.workspaces).forEach(([id, w]) => store.seed('frame_workspaces', id, { name: w.name, memberIds: w.memberIds }));
  Object.entries(fx.context.clients).forEach(([id, c]) => store.seed('frame_clients', id, { id, ...c }));
  store.seed(repo.COUNTERS, 'sales', { next: 1043 });
  return store;
}
let seq = 0;
function draftOf(name, over = {}) {
  const sale = buildSale(structuredClone(fx.scenarios.find(s => s.name === name).sale), fx.services);
  const { n, revision, schemaVersion, ...rest } = sale;
  seq += 1;
  return {
    ...rest, id: `5a1e0000-0000-4000-8000-${String(seq).padStart(12, '0')}`, status: 'confirmed',
    commercial: { subtotal: 9000, descuento: 0, total: 9000, pay: 'bac', abonos: [], canal: 'WhatsApp', nota: '', contacto: { telefono: '', email: '' } },
    ...over,
  };
}
const kindOf = (p) => p.then(() => 'ok', e => (e instanceof server.ServerError ? `${e.kind}:${(e.details && e.details.code) || ''}` : `NO-SERVER-ERROR:${e.message}`));

test('sólo el equipo comercial APROBADO vende', async () => {
  const store = seeded();
  const d = { draft: draftOf('plan-mensual') };
  assert.equal(await kindOf(server.createSale(store, null, d, { now })), 'unauthenticated:');
  assert.equal(await kindOf(server.createSale(store, { uid: '' }, d, { now })), 'unauthenticated:');
  assert.equal(await kindOf(server.createSale(store, { uid: 'u-prod' }, d, { now })), 'permission-denied:', 'aprobado pero no comercial');
  assert.equal(await kindOf(server.createSale(store, { uid: 'u-pend' }, d, { now })), 'permission-denied:', 'en la lista pero pendiente');
  assert.equal(await kindOf(server.createSale(store, { uid: 'nadie' }, d, { now })), 'permission-denied:');
  assert.equal(store.list(COLLECTIONS.sales).length, 0, 'nada se escribió');
  for (const fn of [server.updateSale, server.addPayment]) {
    assert.equal(await kindOf(fn(store, { uid: 'u-prod' }, { saleId: 'x', patch: {}, abono: {} }, { now })), 'permission-denied:');
  }
});

test('de punta a punta: vender → evento → tarjetas, igual que el planificador', async () => {
  const store = seeded();
  const draft = draftOf('plan-mensual');
  const r = await server.createSale(store, U, { draft }, { now });
  assert.deepEqual(Object.keys(r).sort(), ['eventId', 'n', 'saleId', 'status', 'version'], 'la respuesta no trae la venta completa');
  assert.equal(r.status, 'created');
  assert.equal(r.n, 1043);
  const done = await server.onEventCreated(store, r.eventId, { now });
  assert.equal(done.status, 'done');
  const tasks = store.list(COLLECTIONS.tasks).filter(t => t.sourceSaleId === draft.id);
  const sale = await store.get(COLLECTIONS.sales, draft.id);
  // El contexto que arma el servidor desde el proyecto produce lo mismo que
  // el planificador con el contexto de los fixtures (hoy = 10/11 en Tegucigalpa).
  const plan = core.planSale(repo.productionView(sale), { ...fx.context, today: '2026-11-10' }, { eventId: r.eventId });
  assert.deepEqual(tasks.map(t => t.id).sort(), plan.tasks.map(t => t.id).sort());
  assert.equal((await store.get('frame_clients', draft.client.clientId)).hasSales, true);
  // Repetir el mismo evento no duplica.
  assert.equal((await server.onEventCreated(store, r.eventId, { now })).status, 'already_done');
  assert.equal(store.list(COLLECTIONS.tasks).filter(t => t.sourceSaleId === draft.id).length, tasks.length);
});

test('el contexto usa la fecha local de Tegucigalpa, no la UTC', async () => {
  const store = seeded();
  // 03:00 UTC del 10 = 21:00 del 9 en Tegucigalpa.
  assert.equal((await server.loadContext(store, 'cli-demo-cafe-aurora', '2026-11-10T03:00:00.000Z')).today, '2026-11-09');
  const ctx = await server.loadContext(store, 'cli-demo-cafe-aurora', T);
  assert.deepEqual(Object.keys(ctx.clients), ['cli-demo-cafe-aurora'], 'sólo la ficha de la venta');
  assert.deepEqual(Object.keys(ctx.workspaces), fx.context.allowedWorkspaceIds, 'sólo tableros habilitados');
});

test('errores del dominio: código estable para la app, sin datos internos', async () => {
  const store = seeded();
  const draft = draftOf('paquete-mismo-dia');
  await server.createSale(store, U, { draft }, { now });
  assert.equal(await kindOf(server.updateSale(store, U, { saleId: draft.id, patch: { entrega: '2026-11-25' }, expectedVersion: 7 }, { now })), 'aborted:version_conflict');
  assert.equal(await kindOf(server.updateSale(store, U, { saleId: 'no-existe', patch: { entrega: '2026-11-25' }, expectedVersion: 1 }, { now })), 'not-found:not_found');
  assert.equal(await kindOf(server.updateSale(store, U, { saleId: draft.id, patch: { n: 1 }, expectedVersion: 1 }, { now })), 'invalid-argument:field_not_editable');
  assert.equal(await kindOf(server.createSale(store, U, { draft: draftOf('plan-mensual', { client: { clientId: 'no-existe', nombre: 'X', empresa: '' } }) }, { now })), 'failed-precondition:client_unknown');
  const malo = draftOf('plan-mensual', { lines: [] });
  const e = await server.createSale(store, U, { draft: malo }, { now }).catch(x => x);
  assert.equal(e.kind, 'invalid-argument');
  assert.ok(Array.isArray(e.details.issues) && e.details.issues.length > 0, 'trae los problemas de validación');
  assert.equal(await kindOf(server.createSale(store, U, { draft: 'x' }, { now })), 'invalid-argument:');
  assert.equal(await kindOf(server.updateSale(store, U, { saleId: 'a/b', patch: {} }, { now })), 'invalid-argument:');
  const pay = { id: 'AB-1', fecha: '2026-11-10', monto: 4000, metodo: 'bac' };
  assert.equal((await server.addPayment(store, U, { saleId: draft.id, abono: pay })).status, 'added');
  assert.equal(await kindOf(server.addPayment(store, U, { saleId: draft.id, abono: { ...pay, monto: 1 } })), 'failed-precondition:payment_conflict');
  // Un error inesperado no filtra su mensaje.
  const raro = server.toServerError(Object.assign(new Error('fallo con ana@example.com en 10.0.0.5'), { code: 'algo_raro' }));
  assert.deepEqual([raro.kind, raro.message, raro.details], ['internal', 'Error interno del servidor', { code: 'internal' }]);
});

test('sin configuración de producción el evento queda pendiente y el barrido lo retoma después', async () => {
  const store = seeded({ production: false });
  const draft = draftOf('paquete-mismo-dia');
  // Sin configuración ni siquiera se vende (no se sabe qué tableros valen).
  assert.equal(await kindOf(server.createSale(store, U, { draft }, { now })), 'failed-precondition:config_missing');
  // Con configuración se vende; si después se pierde con eventos en cola…
  store.seed('loopa_config', 'production', { defaultWorkspaceId: fx.context.defaultWorkspaceId, allowedWorkspaceIds: fx.context.allowedWorkspaceIds });
  const r = await server.createSale(store, U, { draft }, { now });
  store.seed('loopa_config', 'production', {});
  await assert.rejects(server.onEventCreated(store, r.eventId, { now }), e => e.code === 'config_missing');
  const ev = await store.get(COLLECTIONS.events, r.eventId);
  assert.equal(ev.status, 'pending', 'no se pierde ni se marca hecho');
  assert.equal(ev.lastError.code, 'config_missing', 'el motivo queda a la vista en el evento');
  const sinConfig = await server.sweep(store, { now });
  assert.equal(sinConfig.sales[0].error.code, 'config_missing', 'el barrido lo informa y sigue');
  store.seed('loopa_config', 'production', { defaultWorkspaceId: fx.context.defaultWorkspaceId, allowedWorkspaceIds: fx.context.allowedWorkspaceIds });
  const s = await server.sweep(store, { now });
  assert.equal(s.due, 1);
  assert.equal(s.sales[0].events[0].status, 'done');
  assert.ok(store.list(COLLECTIONS.tasks).some(t => t.sourceSaleId === draft.id));
});

test('el barrido retoma un evento fallido cumplida la espera, y sólo entonces', async () => {
  const store = seeded();
  const draft = draftOf('plan-mensual');
  const r = await server.createSale(store, U, { draft }, { now });
  store.injectFault({ op: 'tx-create', collection: COLLECTIONS.tasks, after: 1 });
  assert.equal((await server.onEventCreated(store, r.eventId, { now })).status, 'failed');
  assert.equal((await server.sweep(store, { now })).due, 0, 'todavía en espera');
  const later = () => '2026-11-10T15:05:00.000Z';
  const s = await server.sweep(store, { now: later });
  assert.equal(s.sales[0].events[0].status, 'done');
  assert.equal(store.list(COLLECTIONS.tasks).filter(t => t.sourceSaleId === draft.id).length, 4);
});

test('functions/index.js: codebase propio, sólo envoltorios, y firebase.json no toca a FRAME', () => {
  const root = path.join(__dirname, '..', '..');
  const idx = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
  ['loopaCreateSale', 'loopaUpdateSale', 'loopaAddPayment', 'loopaOnEventCreated', 'loopaSweepEvents'].forEach(n => assert.match(idx, new RegExp(`exports\\.${n} =`)));
  assert.equal((idx.match(/exports\.\w+ =/g) || []).length, 5, 'ninguna función de más (las de FRAME viven en su repo)');
  assert.match(idx, /document: 'loopa_integration_events\/\{eventId\}'/);
  assert.doesNotMatch(idx, /\.delete\(|recursiveDelete/);
  const fb = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  assert.deepEqual(fb.functions.map(f => f.codebase), ['loopa'], 'codebase separado: publicar no borra las funciones de FRAME');
  assert.equal(fb.firestore, undefined, 'las reglas no se publican desde acá por accidente');
  assert.equal(fs.existsSync(path.join(root, '.firebaserc')), false, 'sin proyecto por defecto: publicar exige elegirlo a mano');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'functions', 'package.json'), 'utf8'));
  Object.values(pkg.dependencies).forEach(v => assert.match(v, /^\d+\.\d+\.\d+$/, 'versiones fijas'));
});

// ── Revisión de la tanda 3.1 ──────────────────────────────────────

test('cambiar el cliente antes de procesar: cada evento usa SU cliente y la venta no queda trabada', async () => {
  const store = seeded();
  const draft = draftOf('paquete-mismo-dia', { client: { clientId: 'cli-demo-cafe-aurora', nombre: 'Café Aurora', empresa: '' } });
  const r = await server.createSale(store, U, { draft }, { now });
  // Antes de que corra el trigger del primer evento, se cambia el cliente.
  const upd = await server.updateSale(store, U, { saleId: draft.id, patch: { client: { clientId: 'cli-demo-ferreteria-norte', nombre: 'Ferretería Norte', empresa: '' } }, expectedVersion: 1 }, { now });
  const first = await server.onEventCreated(store, r.eventId, { now });
  assert.equal(first.status, 'superseded');
  assert.equal(first.drained, 1, 'la cola de la venta se vació');
  assert.equal((await store.get(COLLECTIONS.events, upd.eventId)).status, 'done', 'el evento nuevo se planificó con el cliente nuevo');
  const tasks = store.list(COLLECTIONS.tasks).filter(t => t.sourceSaleId === draft.id);
  assert.ok(tasks.length > 0 && tasks.every(t => t.clientId === 'cli-demo-ferreteria-norte'));
  assert.equal((await store.get(COLLECTIONS.sales, draft.id)).operations.status, 'ready');
});

test('al soltar el candado, el evento que esperaba se procesa enseguida (no a los 7 minutos)', async () => {
  const store = seeded();
  const draft = draftOf('plan-mensual');
  const r = await server.createSale(store, U, { draft }, { now });
  const upd = await server.updateSale(store, U, { saleId: draft.id, patch: { entrega: '2026-12-01' }, expectedVersion: 1 }, { now });
  // Otro worker tiene el candado de la venta: el evento nuevo queda esperando.
  store.merge(COLLECTIONS.sales, draft.id, { lock: { eventId: r.eventId, token: 'otro:t', until: '2026-11-10T15:02:00.000Z' } });
  assert.equal((await server.onEventCreated(store, upd.eventId, { now })).status, 'sale_busy');
  assert.equal((await store.get(COLLECTIONS.events, upd.eventId)).waitingUntil, '2026-11-10T15:02:00.000Z');
  // El dueño del candado termina; su drenaje toma al que esperaba YA.
  store.merge(COLLECTIONS.sales, draft.id, { lock: null });
  const done = await server.onEventCreated(store, r.eventId, { now });
  assert.equal(done.drained, 1);
  assert.equal((await store.get(COLLECTIONS.events, upd.eventId)).status, 'done');
});

test('el barrido retoma un lease vencido', async () => {
  const store = seeded();
  const draft = draftOf('paquete-mismo-dia');
  const r = await server.createSale(store, U, { draft }, { now });
  store.merge(COLLECTIONS.events, r.eventId, { status: 'processing', leaseOwner: 'muerto:x', leaseUntil: '2026-11-10T14:00:00.000Z', attempts: 1 });
  const s = await server.sweep(store, { now });
  assert.equal(s.due, 1);
  assert.equal(s.sales[0].events[0].status, 'done');
});

test('"hoy" sale del instante inyectado (no del reloj real) y en Tegucigalpa', async () => {
  const store = seeded();
  assert.equal((await server.loadContext(store, null, '2027-03-05T12:00:00.000Z')).today, '2027-03-05');
  assert.equal((await server.loadContext(store, null, '2027-03-06T03:00:00.000Z')).today, '2027-03-05', '21:00 del 5 en Tegucigalpa');
});

test('el contexto trae columnas y tipos del tablero (config de FRAME)', async () => {
  const store = seeded();
  const ws = fx.context.defaultWorkspaceId;
  store.seed(`frame_workspaces/${ws}/config`, 'kanban_columns', { columns: [{ id: 'producing' }, { id: 'delivered' }] });
  store.seed(`frame_workspaces/${ws}/config`, 'project_types', { types: [{ id: 'reel' }, { id: 'photo' }] });
  const ctx = await server.loadContext(store, null, T);
  assert.deepEqual(ctx.workspaces[ws].statusIds, ['producing', 'delivered', 'archived']);
  assert.deepEqual(ctx.workspaces[ws].typeIds, ['reel', 'photo']);
  // Sin la columna inicial de la plantilla, el planificador lo frena con un motivo claro.
  const draft = draftOf('paquete-mismo-dia');
  const r = await server.createSale(store, U, { draft }, { now });
  const res = await server.onEventCreated(store, r.eventId, { now });
  assert.equal(res.status, 'needs_attention');
  assert.ok(res.issues.some(i => i.code === 'template.status.unknown'));
});

test('sólo se vende a fichas de los tableros habilitados; ajena o inexistente dan el mismo error', async () => {
  const store = seeded();
  const ajena = draftOf('paquete-mismo-dia', { client: { clientId: 'cli-demo-cliente-ajeno', nombre: 'X', empresa: '' } });
  assert.equal(await kindOf(server.createSale(store, U, { draft: ajena }, { now })), 'failed-precondition:client_unknown');
  assert.equal(await kindOf(server.createSale(store, U, { draft: draftOf('paquete-mismo-dia', { client: { clientId: 'no-existe', nombre: 'X', empresa: '' } }) }, { now })), 'failed-precondition:client_unknown');
  assert.equal(store.list(COLLECTIONS.sales).length, 0);
  assert.equal((await store.get('frame_clients', 'cli-demo-cliente-ajeno')).hasSales, undefined, 'la ficha ajena no queda marcada');
  const ok = draftOf('paquete-mismo-dia');
  await server.createSale(store, U, { draft: ok }, { now });
  assert.equal(await kindOf(server.updateSale(store, U, { saleId: ok.id, patch: { client: { clientId: 'cli-demo-cliente-ajeno', nombre: 'X', empresa: '' } }, expectedVersion: 1 }, { now })), 'failed-precondition:client_unknown');
});

test('auditoría: quién vendió, quién cambió el estado y quién cobró (y no se falsifica)', async () => {
  const store = seeded();
  const draft = draftOf('paquete-mismo-dia', { status: 'draft' });
  await server.createSale(store, U, { draft }, { now });
  let sale = await store.get(COLLECTIONS.sales, draft.id);
  assert.equal(sale.createdBy, 'u-com');
  assert.equal(sale.estadoLog[0].by, 'u-com');
  await server.updateSale(store, U, { saleId: draft.id, patch: { status: 'confirmed' }, expectedVersion: 1 }, { now });
  sale = await store.get(COLLECTIONS.sales, draft.id);
  assert.deepEqual([sale.updatedBy, sale.estadoLog[1].by], ['u-com', 'u-com']);
  assert.equal(await kindOf(server.updateSale(store, U, { saleId: draft.id, patch: { createdBy: 'otro' }, expectedVersion: 2 }, { now })), 'invalid-argument:field_not_editable');
  const pay = { id: 'AB-1', fecha: '2026-11-10', monto: 1000, metodo: 'bac', registradoPor: 'falso' };
  assert.equal((await server.addPayment(store, U, { saleId: draft.id, abono: pay })).status, 'added');
  assert.equal((await store.get(COLLECTIONS.sales, draft.id)).commercial.abonos[0].registradoPor, 'u-com', 'lo pone el servidor');
  const { registradoPor, ...sinQuien } = pay;
  assert.equal((await server.addPayment(store, U, { saleId: draft.id, abono: sinQuien })).status, 'existing', 'reintentar sigue siendo idempotente');
  assert.equal(await kindOf(server.addPayment(store, U, { saleId: draft.id, abono: { id: 'AB-2', fecha: '2026-11-10', monto: 99999, metodo: 'bac' } })), 'failed-precondition:payment_exceeds_total');
});

test('todas las acciones rechazan igual a quien no puede vender', async () => {
  const store = seeded();
  const draft = draftOf('paquete-mismo-dia');
  await server.createSale(store, U, { draft }, { now });
  const args = { saleId: draft.id, patch: { entrega: '2026-12-01' }, expectedVersion: 1, abono: { id: 'AB-1', fecha: '2026-11-10', monto: 1, metodo: 'bac' } };
  for (const fn of [server.updateSale, server.addPayment]) {
    assert.equal(await kindOf(fn(store, null, args, { now })), 'unauthenticated:');
    assert.equal(await kindOf(fn(store, { uid: 'u-pend' }, args, { now })), 'permission-denied:');
    assert.equal(await kindOf(fn(store, { uid: 'nadie' }, args, { now })), 'permission-denied:');
    assert.equal(await kindOf(fn(store, { uid: 'u-prod' }, args, { now })), 'permission-denied:');
  }
  assert.equal((await store.get(COLLECTIONS.sales, draft.id)).version, 1, 'nada cambió');
});

test('errores transitorios: la app sabe que puede reintentar', () => {
  for (const code of ['unavailable', 'deadline-exceeded', 'resource-exhausted']) {
    assert.equal(server.toServerError(Object.assign(new Error('x'), { code })).kind, 'unavailable', code);
  }
  assert.equal(server.toServerError(Object.assign(new Error('demasiado grande'), { code: 'invalid-argument' })).kind, 'invalid-argument');
});
