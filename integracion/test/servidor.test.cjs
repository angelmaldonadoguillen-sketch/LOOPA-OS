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
  fx.services.forEach(sv => store.seed('loopa_services', sv.id, sv));
  return store;
}
let seq = 0;
function draftOf(name, over = {}) {
  const sale = buildSale(structuredClone(fx.scenarios.find(s => s.name === name).sale), fx.services);
  const { n, revision, schemaVersion, ...rest } = sale;
  seq += 1;
  return {
    ...rest, id: `5a1e0000-0000-4000-8000-${String(seq).padStart(12, '0')}`, status: 'confirmed',
    // Lo que manda el navegador: sin snapshot ni plantilla (el servidor los
    // toma del catálogo).
    lines: rest.lines.map(l => ({ lineId: l.lineId, serviceId: l.serviceId, quantity: l.quantity, precio: l.snapshot.precio })),
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

test('venta cerrada con ficha: precio de la ficha, rango desde el inicio y una tarjeta por entrega', async () => {
  const store = seeded();
  const ficha = {
    duracion: { cantidad: 1, unidad: 'meses' },
    entregables: [
      { id: 'posts', nombre: 'Post', detalle: 'Copy incluido', cantidad: 4, costo: 100, patron: { tipo: 'repartido' } },
      { id: 'sesion', nombre: 'Sesión de fotos', cantidad: 1, costo: 1500, patron: { tipo: 'dia', dia: 3 } },
      { id: 'rep', nombre: 'Reporte', cantidad: 1, costo: 0, patron: { tipo: 'final' } },
    ],
    proceso: [{ id: 'p1', texto: 'Brief' }, { id: 'p2', texto: 'Producción' }, { id: 'p3', texto: 'Aprobación' }],
    costosExtra: [],
  };
  await server.saveService(store, U, { service: { id: 'SRV-FICHA-1', nombre: 'Plan con ficha', modelo: 'plan', precio: 8000, ficha } }, { now });
  const draft = draftOf('plan-mensual');
  // El navegador manda un precio y un costo inventados: no cuentan.
  draft.lines = [{ lineId: 'l-ficha-1', serviceId: 'SRV-FICHA-1', quantity: 3, precio: 1, costo: 0, inicio: '2026-11-16' }];
  draft.commercial = { ...draft.commercial, subtotal: 8000, total: 8000 };
  const r = await server.createSale(store, U, { draft }, { now });
  const sale = await store.get(COLLECTIONS.sales, draft.id);
  const line = sale.lines[0];
  assert.deepEqual([line.quantity, line.snapshot.precio, line.snapshot.costo, line.inicio, line.fin], [1, 8000, 4 * 100 + 1500, '2026-11-16', '2026-12-16']);
  assert.equal(line.executionPlan, null);
  await server.onEventCreated(store, r.eventId, { now });
  const tasks = store.list(COLLECTIONS.tasks).filter(t => t.sourceSaleId === draft.id).sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : 1));
  assert.equal(tasks.length, 4 + 1 + 1, 'una tarjeta por entrega');
  assert.deepEqual(tasks.map(t => t.sessionDate), ['2026-11-18', '2026-11-19', '2026-11-27', '2026-12-04', '2026-12-12', '2026-12-16'], 'posts en los días 3, 11, 18 y 26 del rango; sesión el 3.º; reporte al final');
  const sesion = tasks.find(t => t.title.includes('Sesión de fotos'));
  assert.equal(sesion.sessionDate, '2026-11-18', 'el día 3 del rango');
  assert.equal(sesion.deadline, '2026-11-18');
  assert.equal(sesion.startDate, '2026-11-16');
  assert.deepEqual(sesion.checklist.map(c => [c.text, c.done]), [['Brief', false], ['Producción', false], ['Aprobación', false]]);
  assert.ok(tasks.some(t => /Post 2\/4$/.test(t.title)), 'las repetidas llevan n/total');
  assert.equal(tasks.find(t => t.title.includes('Reporte')).sessionDate, '2026-12-16', 'al final del rango');
  assert.ok(tasks.find(t => /Post 1\/4$/.test(t.title)).description.some(b => b.text === 'Copy incluido'), 'el detalle llega a la tarjeta');
  // Sin fecha de inicio no se vende; un producto incompleto tampoco.
  const d2 = draftOf('plan-mensual'); d2.lines = [{ lineId: 'l-2', serviceId: 'SRV-FICHA-1', quantity: 1 }];
  assert.equal(await kindOf(server.createSale(store, U, { draft: d2 }, { now })), 'invalid-argument:');
  await server.saveService(store, U, { service: { id: 'SRV-FICHA-2', nombre: 'Sin proceso', modelo: 'plan', precio: 1, ficha: { ...ficha, proceso: [] } } }, { now });
  const d3 = draftOf('plan-mensual'); d3.lines = [{ lineId: 'l-3', serviceId: 'SRV-FICHA-2', quantity: 1, inicio: '2026-11-16' }];
  assert.equal(await kindOf(server.createSale(store, U, { draft: d3 }, { now })), 'failed-precondition:service_not_ready');
  // Mover el inicio de una línea ya vendida recalcula el fin; el precio queda.
  const moved = await server.updateSale(store, U, { saleId: draft.id, patch: { lines: [{ lineId: 'l-ficha-1', serviceId: 'SRV-FICHA-1', quantity: 1, precio: 5, inicio: '2026-12-01' }] }, expectedVersion: sale.version }, { now });
  assert.equal(moved.status, 'updated');
  const l2 = (await store.get(COLLECTIONS.sales, draft.id)).lines[0];
  assert.deepEqual([l2.inicio, l2.fin, l2.snapshot.precio], ['2026-12-01', '2027-01-01', 8000]);
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
  const base = draftOf('plan-mensual');
  // Fecha imposible: la valida el contrato y vuelve con sus problemas.
  const malo = { ...base, fecha: '2026-13-45' };
  assert.equal(await kindOf(server.createSale(store, U, { draft: { ...base, lines: base.lines.map(l => ({ ...l, quantity: 0 })) } }, { now })), 'invalid-argument:', 'cantidad 0');
  assert.equal(await kindOf(server.createSale(store, U, { draft: { ...base, lines: base.lines.map(l => ({ ...l, quantity: 1.5 })) } }, { now })), 'invalid-argument:', 'cantidad no entera');
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
  ['loopaCreateSale', 'loopaUpdateSale', 'loopaAddPayment', 'loopaRemovePayment', 'loopaSaveClient', 'loopaSaveService', 'loopaOnEventCreated', 'loopaSweepEvents'].forEach(n => assert.match(idx, new RegExp(`exports\\.${n} =`)));
  assert.equal((idx.match(/exports\.\w+ =/g) || []).length, 8, 'ninguna función de más (las de FRAME viven en su repo)');
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

// ── Tanda 3.2: las líneas salen del catálogo ──────────────────────

test('nadie inventa la plantilla de producción: las líneas se arman del catálogo', async () => {
  const store = seeded();
  const draft = draftOf('paquete-mismo-dia');
  const falsa = { ...draft, lines: draft.lines.map(l => ({ ...l, executionPlan: { enabled: true, version: 99, templates: [] } })) };
  assert.equal(await kindOf(server.createSale(store, U, { draft: falsa }, { now })), 'invalid-argument:', 'campos no permitidos en la línea');
  const conSnapshot = { ...draft, lines: draft.lines.map(l => ({ ...l, snapshot: { nombre: 'X' } })) };
  assert.equal(await kindOf(server.createSale(store, U, { draft: conSnapshot }, { now })), 'invalid-argument:');
  assert.equal(await kindOf(server.createSale(store, U, { draft: { ...draft, lines: [{ lineId: 'l1', serviceId: 'SRV-NO-EXISTE', quantity: 1 }] } }, { now })), 'failed-precondition:service_unknown');
  const svc = fx.services[0];
  store.seed('loopa_services', svc.id, { ...svc, activo: false });
  assert.equal(await kindOf(server.createSale(store, U, { draft: { ...draft, lines: [{ lineId: 'l1', serviceId: svc.id, quantity: 1 }] } }, { now })), 'failed-precondition:service_unknown', 'archivado no se vende');
  assert.equal(await kindOf(server.createSale(store, U, { draft: { ...draft, lines: [] } }, { now })), 'invalid-argument:');
  assert.equal(store.list(COLLECTIONS.sales).length, 0);
  // La venta válida guarda la plantilla del CATÁLOGO, con su versión.
  await server.createSale(store, U, { draft }, { now });
  const sale = await store.get(COLLECTIONS.sales, draft.id);
  sale.lines.forEach(l => {
    const cat = fx.services.find(sv => sv.id === l.serviceId);
    assert.deepEqual(l.executionPlan, cat.executionPlan || null);
    assert.equal(l.snapshot.nombre, cat.nombre);
  });
});

test('editar una venta: las líneas existentes conservan su plantilla congelada; las nuevas toman la vigente', async () => {
  const store = seeded();
  const draft = draftOf('fechas-distintas');
  await server.createSale(store, U, { draft }, { now });
  const before = await store.get(COLLECTIONS.sales, draft.id);
  // El catálogo cambia después de vender.
  const conPlan = fx.services.filter(sv => sv.executionPlan);
  conPlan.forEach(sv => store.seed('loopa_services', sv.id, { ...sv, nombre: `${sv.nombre} (nuevo)`, executionPlan: { ...sv.executionPlan, version: sv.executionPlan.version + 1 } }));
  const first = before.lines[0];
  const nueva = { lineId: 'l-nueva', serviceId: conPlan[0].id, quantity: 1 };
  const lines = [...before.lines.map(l => ({ lineId: l.lineId, serviceId: l.serviceId, quantity: l.quantity + (l.lineId === first.lineId ? 1 : 0), precio: l.snapshot.precio })), nueva];
  const upd = await server.updateSale(store, U, { saleId: draft.id, patch: { lines }, expectedVersion: before.version }, { now });
  assert.equal(upd.status, 'updated');
  const after = await store.get(COLLECTIONS.sales, draft.id);
  const viejo = after.lines.find(l => l.lineId === first.lineId);
  assert.equal(viejo.quantity, first.quantity + 1);
  assert.deepEqual([viejo.snapshot.nombre, viejo.executionTemplateVersion], [first.snapshot.nombre, first.executionTemplateVersion], 'conserva lo que se vendió');
  const agregada = after.lines.find(l => l.lineId === 'l-nueva');
  assert.equal(agregada.executionTemplateVersion, conPlan[0].executionPlan.version + 1, 'la línea nueva toma la plantilla vigente');
});

// ── Tanda 3.2: clientes, servicios y avance desde LOOPA ───────────

test('cliente nuevo desde LOOPA: lo crea el servidor, en el tablero por defecto, una sola vez', async () => {
  const store = seeded();
  const id = '0c11e000-0000-4000-8000-000000000001';
  const datos = { id, nombre: '  Panadería Sol  ', empresa: 'Sol S.A.', telefono: '9999-1234', email: 'hola@sol.hn', canal: 'WhatsApp' };
  assert.deepEqual(await server.saveClient(store, U, { client: datos }, { now }), { status: 'created', clientId: id });
  const doc = await store.get('frame_clients', id);
  assert.equal(doc.workspaceId, fx.context.defaultWorkspaceId);
  assert.equal(doc.name, 'Panadería Sol');
  assert.deepEqual([doc.commercial.telefono, doc.commercial.email, doc.createdBy], ['9999-1234', 'hola@sol.hn', 'u-com']);
  // Repetir (doble clic) no duplica: actualiza lo comercial.
  assert.equal((await server.saveClient(store, U, { client: { ...datos, telefono: '8888-0000' } }, { now })).status, 'updated');
  assert.equal((await store.get('frame_clients', id)).commercial.telefono, '8888-0000');
  assert.equal((await store.get('frame_clients', id)).name, 'Panadería Sol', 'el nombre de la ficha no cambia desde LOOPA');
  // Y se le puede vender enseguida.
  const draft = draftOf('paquete-mismo-dia', { client: { clientId: id, nombre: 'Panadería Sol', empresa: 'Sol S.A.' } });
  assert.equal((await server.createSale(store, U, { draft }, { now })).status, 'created');
});

test('clientes: ajenos, sin nombre o con id no-UUID se rechazan; sólo comerciales', async () => {
  const store = seeded();
  assert.equal(await kindOf(server.saveClient(store, U, { client: { id: 'cli-demo-cliente-ajeno', nombre: 'X' } }, { now })), 'failed-precondition:client_unknown');
  assert.equal(await kindOf(server.saveClient(store, U, { client: { id: 'CL-123', nombre: 'Nuevo' } }, { now })), 'failed-precondition:client_unknown', 'alta exige UUID; mismo error que una ajena (no revela ids)');
  assert.equal(await kindOf(server.saveClient(store, U, { client: { id: '0c11e000-0000-4000-8000-000000000002', nombre: '  ' } }, { now })), 'invalid-argument:');
  assert.equal(await kindOf(server.saveClient(store, { uid: 'u-prod' }, { client: { id: '0c11e000-0000-4000-8000-000000000003', nombre: 'X' } }, { now })), 'permission-denied:');
  // Una ficha migrada (id viejo) sí se edita.
  assert.equal((await server.saveClient(store, U, { client: { id: 'cli-demo-cafe-aurora', nombre: 'Café Aurora', telefono: '2222-0000' } }, { now })).status, 'updated');
});

test('servicios desde LOOPA: lo comercial sí, la plantilla de producción no', async () => {
  const store = seeded();
  const conPlan = fx.services.find(sv => sv.executionPlan);
  const r = await server.saveService(store, U, { service: { ...conPlan, nombre: 'Renombrado', precio: 123, executionPlan: { enabled: true, version: 999, templates: [] } } }, { now });
  assert.equal(r.status, 'updated');
  const doc = await store.get('loopa_services', conPlan.id);
  assert.deepEqual([doc.nombre, doc.precio, doc.updatedBy], ['Renombrado', 123, 'u-com']);
  assert.deepEqual(doc.executionPlan, conPlan.executionPlan, 'la plantilla no viaja desde LOOPA');
  const nuevo = await server.saveService(store, U, { service: { id: 'SRV-NUEVO-1', nombre: 'Fotos producto', modelo: 'unitario', precio: 50, costo: 10 } }, { now });
  assert.equal(nuevo.status, 'created');
  assert.equal((await store.get('loopa_services', 'SRV-NUEVO-1')).executionPlan, null, 'nace sin plantilla: vende, no genera producción');
  assert.equal(await kindOf(server.saveService(store, U, { service: { id: 'otra/cosa', nombre: 'X', modelo: 'unitario', precio: 1, costo: 0 } }, { now })), 'invalid-argument:');
  assert.equal(await kindOf(server.saveService(store, U, { service: { id: 'SRV-X', nombre: 'X', modelo: 'raro', precio: 1, costo: 0 } }, { now })), 'invalid-argument:');
  assert.equal(await kindOf(server.saveService(store, U, { service: { id: 'SRV-X', nombre: 'X', modelo: 'unitario', precio: -1, costo: 0 } }, { now })), 'invalid-argument:');
  assert.equal(await kindOf(server.saveService(store, U, { service: { id: 'SRV-X', nombre: 'X', modelo: 'especial', precio: 1, costo: 0, specialClientId: 'cli-demo-cliente-ajeno' } }, { now })), 'failed-precondition:client_unknown');
  assert.equal(await kindOf(server.saveService(store, { uid: 'u-prod' }, { service: { id: 'SRV-X', nombre: 'X', modelo: 'unitario', precio: 1, costo: 0 } }, { now })), 'permission-denied:');
});

test('ficha del producto: se guarda normalizada y el costo sale de ella', async () => {
  const store = seeded();
  const ficha = {
    duracion: { cantidad: 1, unidad: 'meses' },
    entregables: [{ id: 'posts', nombre: 'Post', cantidad: 12, costo: 100, patron: { tipo: 'repartido' } }, { nombre: 'Sesión', costo: 1500, patron: { tipo: 'dia', dia: 3 }, hack: true }],
    proceso: [{ texto: 'Idea' }, { texto: '' }],
    costosExtra: [{ concepto: 'Pauta', monto: 2000 }],
    executionPlan: { enabled: true },
  };
  await server.saveService(store, U, { service: { id: 'SRV-PLAN-1', nombre: 'Plan redes', modelo: 'plan', precio: 10000, costo: 1, ficha } }, { now });
  const doc = await store.get('loopa_services', 'SRV-PLAN-1');
  assert.equal(doc.costo, 12 * 100 + 1500 + 2000, 'el costo escrito a mano no cuenta');
  assert.equal(doc.ficha.entregables[1].hack, undefined);
  assert.equal(doc.ficha.entregables[1].id, 'e2');
  assert.deepEqual(doc.ficha.proceso, [{ id: 'p1', texto: 'Idea' }]);
  assert.equal(doc.ficha.executionPlan, undefined);
  assert.equal(doc.executionPlan, null, 'la plantilla sigue sin viajar desde LOOPA');
  // Sin ficha, el costo es el de siempre (servicios viejos).
  await server.saveService(store, U, { service: { id: 'SRV-PLAN-1', nombre: 'Plan redes', modelo: 'plan', precio: 10000, costo: 50 } }, { now });
  const d2 = await store.get('loopa_services', 'SRV-PLAN-1');
  assert.equal(d2.costo, 50);
  assert.ok(d2.ficha, 'guardar sin ficha no la borra');
});

test('avance comercial (D17): se guarda, no genera eventos y sólo con valores conocidos', async () => {
  const store = seeded();
  const draft = draftOf('paquete-mismo-dia');
  await server.createSale(store, U, { draft }, { now });
  const eventos = () => store.list(COLLECTIONS.events).length;
  const antes = eventos();
  const r = await server.updateSale(store, U, { saleId: draft.id, patch: { legacyProductionState: 'en-proceso' }, expectedVersion: 1 }, { now });
  assert.deepEqual([r.status, r.eventId], ['updated', null]);
  assert.equal(eventos(), antes, 'no toca producción');
  const sale = await store.get(COLLECTIONS.sales, draft.id);
  assert.deepEqual([sale.legacyProductionState, sale.revision], ['en-proceso', 1]);
  assert.equal(await kindOf(server.updateSale(store, U, { saleId: draft.id, patch: { legacyProductionState: 'cancelado' }, expectedVersion: 2 }, { now })), 'invalid-argument:invalid', 'cancelar es cambiar el estado de la venta, no el avance');
});

test('al crear, el avance sólo acepta valores conocidos', async () => {
  const store = seeded();
  for (const malo of ['cancelado', 'listo', 7]) {
    assert.equal(await kindOf(server.createSale(store, U, { draft: draftOf('paquete-mismo-dia', { legacyProductionState: malo }) }, { now })), 'invalid-argument:invalid', String(malo));
  }
  const ok = draftOf('paquete-mismo-dia', { legacyProductionState: 'revision' });
  await server.createSale(store, U, { draft: ok }, { now });
  assert.equal((await store.get(COLLECTIONS.sales, ok.id)).legacyProductionState, 'revision');
});
