'use strict';
// ─────────────────────────────────────────────────────────────────
// Tanda 2.6 — el integrador, el repositorio de ventas y la migración contra
// el EMULADOR LOCAL de Firestore (nunca la nube: proyecto demo-*).
//
// Cada escenario corre dos veces, en MemoryStore y en el emulador, y se
// compara documento por documento: si el adaptador o la semántica de
// Firestore difieren de lo que suponen las pruebas en memoria, falla acá.
// Las carreras (correlativo, workers simultáneos) se prueban en el emulador
// por invariantes, porque el orden real no es determinista.
//
//   node integracion/emulador/correr.cjs          (levanta y apaga el emulador)
//
// Sin emulador la suite se saltea con aviso; REQUIRE_EMULATOR=1 la hace fallar.
// ─────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../functions/production-plan');
const repo = require('../../functions/repositories/sales');
const { buildMigrationPlan } = require('../../functions/migration/plan');
const { runMigration } = require('../../functions/migration/runner');
const server = require('../../functions/loopa-server');
const { FirestoreStore } = require('../../functions/adapters/firestore-store');
const { MemoryStore } = require('../memory-store.cjs');
const { loadFixtures, buildSale, applyPatch } = require('../harness.cjs');

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMU && process.env.REQUIRE_EMULATOR === '1') throw new Error('REQUIRE_EMULATOR=1 sin FIRESTORE_EMULATOR_HOST: correr node integracion/emulador/correr.cjs');
const skip = EMU ? false : 'sin emulador de Firestore (node integracion/emulador/correr.cjs)';

const fx = loadFixtures();
const { COLLECTIONS } = core;
const T0 = '2026-11-10T15:00:00.000Z';
const saleOf = (name) => buildSale(structuredClone(fx.scenarios.find(s => s.name === name).sale), fx.services);

// ── Entornos ──────────────────────────────────────────────────────
function memoryEnv() {
  const store = new MemoryStore();
  return {
    kind: 'memoria', store,
    seed: async (c, i, d) => store.seed(c, i, d),
    merge: async (c, i, p) => store.merge(c, i, p),
    list: async (c) => store.list(c),
    collections: async () => [...new Set([...store.docs.keys()].map(k => k.split('/')[0]))].sort(),
    close: async () => {},
  };
}

let seq = 0;
function emulatorEnv() {
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  // Un proyecto demo-* nuevo por escenario: aislado sin borrar nada.
  const projectId = `demo-loopa-${process.pid}-${++seq}`;
  const app = initializeApp({ projectId }, projectId);
  const db = getFirestore(app);
  const store = new FirestoreStore(db);
  return {
    kind: 'emulador', store, db,
    seed: (c, i, d) => db.collection(c).doc(i).set(d),
    // Igual que MemoryStore.merge: SUPERFICIAL (set con merge sería profundo).
    merge: async (c, i, p) => {
      const ref = db.collection(c).doc(i);
      const prev = await ref.get();
      await ref.set({ ...(prev.exists ? prev.data() : {}), ...p });
    },
    list: async (c) => (await db.collection(c).get()).docs.map(d => d.data()),
    collections: async () => (await db.listCollections()).map(c => c.id).sort(),
    close: () => deleteApp(app),
  };
}

// Foto completa del almacén (colecciones de primer nivel), con los tokens de
// lease (aleatorios) reemplazados.
async function dump(env) {
  const out = {};
  for (const c of await env.collections()) out[c] = await env.list(c);
  return JSON.parse(JSON.stringify(out).replace(/"(w1|w2|a|b|c|worker):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/g, '"$1:<token>"'));
}

// Corre el escenario en memoria y en el emulador; los resultados y el estado
// final deben ser idénticos.
async function bothStores(scenario) {
  const results = {};
  for (const make of [memoryEnv, emulatorEnv]) {
    const env = make();
    try {
      const outcome = await scenario(env);
      results[env.kind] = { outcome, state: await dump(env) };
    } finally { await env.close(); }
  }
  assert.deepEqual(results.emulador.outcome, results.memoria.outcome, 'mismos resultados');
  assert.deepEqual(results.emulador.state, results.memoria.state, 'mismo estado final, documento por documento');
  return results.emulador;
}

async function emit(env, type, sale, at = T0) {
  await env.merge(COLLECTIONS.sales, sale.id, { id: sale.id, n: sale.n, revision: sale.revision, status: sale.status });
  const event = core.createEvent(type, sale, at);
  await core.enqueueEvent(env.store, event, at);
  return event;
}
const run = (env, eventId, opts = {}) => core.processEvent(env.store, eventId, { context: fx.context, workerId: 'w1', now: () => T0, ...opts });
const pick = (r) => ({ status: r.status, created: (r.created || []).length, existing: (r.existing || []).length, conflicts: r.conflicts || [], diff: r.diff ? r.diff.counts : null });

// ── Escenarios con comparación exacta ─────────────────────────────

test('emulador ≡ memoria: confirmar genera una vez; reprocesar y reencolar no duplican', { skip }, async () => {
  const { state } = await bothStores(async (env) => {
    const sale = saleOf('plan-mensual');
    const ev = await emit(env, 'sale.confirmed', sale);
    const a = await run(env, ev.eventId);
    const b = await run(env, ev.eventId);
    const again = await core.enqueueEvent(env.store, core.createEvent('sale.confirmed', sale, '2026-11-10T15:30:00.000Z'), T0);
    return [pick(a), pick(b), again.enqueued];
  });
  assert.equal(state[COLLECTIONS.tasks].length, 4);
});

test('emulador ≡ memoria: editar una venta con trabajo iniciado y resincronizar', { skip }, async () => {
  await bothStores(async (env) => {
    const sale = saleOf('fechas-distintas');
    await run(env, (await emit(env, 'sale.confirmed', sale)).eventId);
    const tareas = (await env.list(COLLECTIONS.tasks)).filter(t => t.sourceSaleId === sale.id);
    const reelLine = sale.lines.find(l => l.serviceId === 'SRV-DEMO-REEL');
    const reel = tareas.find(t => t.sourceLineIds.includes(reelLine.lineId));
    await env.seed(COLLECTIONS.tasks, reel.id, { ...reel, status: 'producing', checklist: reel.checklist.map((c, i) => ({ ...c, done: i === 0 })) });
    const edited = applyPatch(sale, { lines: [{ lineId: reelLine.lineId, quantity: 2 }] });
    const upd = await run(env, (await emit(env, 'sale.updated', edited)).eventId);
    const resync = await run(env, (await emit(env, 'sale.resync_requested', edited)).eventId);
    return [pick(upd), pick(resync)];
  });
});

test('emulador ≡ memoria: cancelar no borra; una confirmación pendiente queda reemplazada', { skip }, async () => {
  await bothStores(async (env) => {
    let sale = saleOf('paquete-mismo-dia');
    const done = await run(env, (await emit(env, 'sale.confirmed', sale)).eventId);
    sale = { ...sale, status: 'cancelled', revision: sale.revision + 1 };
    const cancel = await run(env, (await emit(env, 'sale.cancelled', sale)).eventId);
    const otra = saleOf('editada-y-cancelada');
    const pendiente = await emit(env, 'sale.confirmed', otra);
    await emit(env, 'sale.cancelled', { ...otra, status: 'cancelled', revision: otra.revision + 1 });
    const sup = await run(env, pendiente.eventId);
    return [pick(done), pick(cancel), pick(sup)];
  });
});

test('emulador ≡ memoria: un id ocupado por otro documento es conflicto y no se pisa', { skip }, async () => {
  await bothStores(async (env) => {
    const sale = saleOf('paquete-mismo-dia');
    const [planned] = core.planSale(sale, fx.context).tasks;
    await env.seed(COLLECTIONS.tasks, planned.id, { id: planned.id, title: 'Tarjeta manual', idempotencyKey: 'otra-cosa' });
    return pick(await run(env, (await emit(env, 'sale.confirmed', sale)).eventId));
  });
});

async function seedRepo(env, next = 1043) {
  await env.seed(repo.COUNTERS, 'sales', { next });
  for (const [id, c] of Object.entries(fx.context.clients)) await env.seed('frame_clients', id, { id, ...c });
}
function draftOf(name, id, over = {}) {
  const sale = buildSale(structuredClone(fx.scenarios.find(s => s.name === name).sale), fx.services);
  const { n, revision, schemaVersion, ...rest } = sale;
  return {
    ...rest, id, status: 'confirmed',
    commercial: { subtotal: 9000, descuento: 0, total: 9000, pay: 'bac', abonos: [], canal: 'WhatsApp', nota: '', contacto: { telefono: '', email: '' } },
    ...over,
  };
}
const code = (p) => p.then(() => 'ok', e => e.code || 'sin-codigo');

test('emulador ≡ memoria: repositorio de ventas (alta, versión, cobros) y su producción', { skip }, async () => {
  await bothStores(async (env) => {
    await seedRepo(env);
    const ids = ['0f8b1d1e-5c2a-4f7e-9a51-000000000001', '0f8b1d1e-5c2a-4f7e-9a51-000000000002', '0f8b1d1e-5c2a-4f7e-9a51-000000000003'];
    const out = [];
    const a = await repo.createSale(env.store, draftOf('plan-mensual', ids[0]), { now: () => T0 });
    const a2 = await repo.createSale(env.store, draftOf('plan-mensual', ids[0]), { now: () => T0 });
    const b = await repo.createSale(env.store, draftOf('paquete-mismo-dia', ids[1], { status: 'draft' }), { now: () => T0 });
    out.push([a.status, a.n, a2.status, b.status, b.eventId]);
    out.push(await code(repo.updateSale(env.store, ids[1], { status: 'confirmed' }, { expectedVersion: 1, now: () => T0 })));
    out.push(await code(repo.updateSale(env.store, ids[1], { entrega: '2026-11-25' }, { expectedVersion: 1, now: () => T0 })));
    const pay = { id: 'AB-1', fecha: '2026-11-10', monto: 4000, metodo: 'bac' };
    out.push((await repo.addPayment(env.store, ids[0], pay)).status, (await repo.addPayment(env.store, ids[0], pay)).status);
    out.push(await code(repo.addPayment(env.store, ids[0], { ...pay, monto: 1 })));
    out.push(await code(repo.createSale(env.store, draftOf('plan-mensual', ids[2], { client: { clientId: 'cli-no-existe', nombre: 'X', empresa: '' } }), { now: () => T0 })));
    // Los eventos que dejó el repositorio se procesan en orden de id.
    for (const ev of (await env.list(COLLECTIONS.events)).filter(e => e.status === 'pending')) out.push(pick(await run(env, ev.eventId)));
    return out;
  });
});

test('emulador ≡ memoria: funciones del servidor (vender, procesar, cobrar, barrer)', { skip }, async () => {
  const { state } = await bothStores(async (env) => {
    await seedRepo(env);
    await env.seed('frame_users', 'u-com', { status: 'active' });
    await env.seed('loopa_config', 'access', { commercialUids: ['u-com'] });
    await env.seed('loopa_config', 'production', { defaultWorkspaceId: fx.context.defaultWorkspaceId, allowedWorkspaceIds: fx.context.allowedWorkspaceIds });
    for (const [id, w] of Object.entries(fx.context.workspaces)) await env.seed('frame_workspaces', id, { name: w.name, memberIds: w.memberIds });
    const U = { uid: 'u-com' };
    const opts = { now: () => T0 };
    const id = '7c0de000-0000-4000-8000-000000000001';
    const kind = (p) => p.then(r => r.status, e => `${e.kind}:${(e.details && e.details.code) || ''}`);
    const out = [];
    out.push(await kind(server.createSale(env.store, { uid: 'nadie' }, { draft: draftOf('plan-mensual', id) }, opts)));
    const r = await server.createSale(env.store, U, { draft: draftOf('plan-mensual', id) }, opts);
    out.push([r.status, r.n]);
    out.push((await server.onEventCreated(env.store, r.eventId, opts)).status);
    out.push(await kind(server.updateSale(env.store, U, { saleId: id, patch: { entrega: '2026-12-01' }, expectedVersion: 9 }, opts)));
    const upd = await server.updateSale(env.store, U, { saleId: id, patch: { entrega: '2026-12-01' }, expectedVersion: 1 }, opts);
    out.push([upd.status, upd.version]);
    out.push((await server.addPayment(env.store, U, { saleId: id, abono: { id: 'AB-1', fecha: '2026-11-10', monto: 1000, metodo: 'bac' } })).status);
    const s = await server.sweep(env.store, opts);
    out.push(s.due);
    return out;
  });
  assert.ok(state.frame_projects.length > 0, 'la venta generó tarjetas en el emulador');
  assert.equal(state.frame_clients.find(c => c.id === fx.scenarios.find(x => x.name === 'plan-mensual').sale.client.clientId).hasSales, true);
});

test('emulador ≡ memoria: migración completa, repetible y sin pisar nada', { skip }, async () => {
  const FX = path.join(__dirname, '..', 'fixtures', 'migration');
  const backupText = fs.readFileSync(path.join(FX, 'loopa-backup.json'), 'utf8');
  const frame = JSON.parse(fs.readFileSync(path.join(FX, 'frame-clients.json'), 'utf8'));
  const { decisions } = JSON.parse(fs.readFileSync(path.join(FX, 'client-decisions.json'), 'utf8'));
  const plan = buildMigrationPlan({ backup: JSON.parse(backupText), frameClients: frame.clients, decisions, workspaceId: frame.workspaceId });
  const opts = (runId) => ({ runId, archivedBackupText: backupText, now: () => '2026-11-10T03:00:00.000Z', checkpointEvery: 4 });
  const { state } = await bothStores(async (env) => {
    for (const c of frame.clients) await env.seed('frame_clients', c.id, c);
    const first = await runMigration(env.store, plan, opts('mig-a'));
    const again = await runMigration(env.store, plan, opts('mig-b'));
    const strip = (r) => ({ status: r.status, counts: r.counts, conflicts: r.conflicts });
    return [strip(first), strip(again)];
  });
  assert.ok(state.loopa_sales.length > 0 && state.loopa_migrations.length === 2);
});

// ── Carreras reales (invariantes) ─────────────────────────────────

test('emulador: veinte ventas simultáneas reciben correlativos únicos y consecutivos', { skip }, async () => {
  const env = emulatorEnv();
  try {
    await seedRepo(env, 2001);
    const ids = Array.from({ length: 20 }, (_, i) => `1b2c3d4e-0000-4000-8000-${String(i).padStart(12, '0')}`);
    // Todas a la vez contra el mismo contador. Bajo mucha contención alguna
    // puede agotar sus reintentos ('aborted'): eso es aceptable SIEMPRE que no
    // deje huecos ni repetidos, y que reintentarla (idempotente por id) la
    // complete con el número siguiente.
    const settled = await Promise.allSettled(ids.map(id => repo.createSale(env.store, draftOf('plan-mensual', id), { now: () => T0 })));
    settled.filter(s => s.status === 'rejected').forEach(s => assert.equal(s.reason.code, 'aborted', 'sólo puede fallar por contención'));
    const ok = settled.filter(s => s.status === 'fulfilled').map(s => s.value.n).sort((x, y) => x - y);
    assert.deepEqual(ok, Array.from({ length: ok.length }, (_, i) => 2001 + i), 'las que entraron no dejan huecos');
    assert.equal((await env.store.get(repo.COUNTERS, 'sales')).next, 2001 + ok.length);
    const results = [];
    for (const [i, s] of settled.entries()) {
      results.push(s.status === 'fulfilled' ? s.value : await repo.createSale(env.store, draftOf('plan-mensual', ids[i]), { now: () => T0 }));
    }
    assert.deepEqual(results.map(r => r.n).sort((x, y) => x - y), Array.from({ length: 20 }, (_, i) => 2001 + i));
    assert.equal((await env.store.get(repo.COUNTERS, 'sales')).next, 2021);
    assert.equal((await env.list(COLLECTIONS.events)).length, 20);
  } finally { await env.close(); }
});

test('emulador: tres workers con el lease vencido no duplican tarjetas', { skip }, async () => {
  const env = emulatorEnv();
  try {
    const sale = saleOf('plan-trimestral');
    const ev = await emit(env, 'sale.confirmed', sale);
    const results = await Promise.all(['a', 'b', 'c'].map(w => run(env, ev.eventId, { workerId: w, leaseMs: -1 })));
    const tasks = (await env.list(COLLECTIONS.tasks)).filter(t => t.sourceSaleId === sale.id);
    assert.equal(tasks.length, 12);
    assert.equal(new Set(tasks.map(t => t.idempotencyKey)).size, 12);
    assert.equal(results.reduce((n, r) => n + (r.created ? r.created.length : 0), 0), 12, 'cada tarjeta la creó un solo worker');
    assert.equal((await env.store.get(COLLECTIONS.events, ev.eventId)).status, 'done');
  } finally { await env.close(); }
});

test('emulador: el adaptador traduce los errores de Firestore', { skip }, async () => {
  const env = emulatorEnv();
  try {
    await env.store.create('loopa_probe', 'x', { a: 1 });
    await assert.rejects(env.store.create('loopa_probe', 'x', { a: 2 }), e => e.code === 'already-exists');
    await assert.rejects(env.store.transaction(async tx => { tx.update('loopa_probe', 'no-existe', { a: 1 }); }), e => e.code === 'not-found');
    await assert.rejects(env.store.transaction(async tx => { tx.create('loopa_probe', 'x', { a: 3 }); }), e => e.code === 'already-exists');
    await assert.rejects(env.store.create('loopa_probe', 'y', { a: undefined }), e => e.code === 'invalid-argument');
    await assert.rejects(env.store.transaction(async tx => { tx.update('loopa_probe', 'x', { 'a.b': 1 }); }), e => e.code === 'invalid-argument', 'una clave con punto no es un merge superficial');
    assert.deepEqual(await env.store.get('loopa_probe', 'x'), { a: 1 }, 'nada se pisó');
    assert.equal(await env.store.hasDocuments('loopa_probe'), true);
    assert.equal(await env.store.hasDocuments('loopa_probe/x/comments'), false);
    await env.seed('loopa_probe/x/comments', 'c1', { text: 'hola' });
    assert.equal(await env.store.hasDocuments('loopa_probe/x/comments'), true, 'subcolección con documentos');
  } finally { await env.close(); }
});

// functions/index.js con las librerías reales de Firebase (instaladas sólo en
// integracion/emulador): carga, exporta las 5 funciones y el envoltorio
// convierte los errores en HttpsError. Corre en un proceso aparte con
// NODE_PATH y apuntando al emulador (proyecto demo-*).
test('functions/index.js carga con firebase-functions y responde errores como HttpsError', { skip }, () => {
  const { spawnSync } = require('node:child_process');
  const root = path.join(__dirname, '..', '..');
  const code = `
    const f = require(${JSON.stringify(path.join(root, 'functions', 'index.js'))});
    (async () => {
      const out = { exports: Object.keys(f).sort() };
      try { await f.loopaCreateSale.run({ auth: null, data: {} }); out.unauth = 'ok?'; } catch (e) { out.unauth = [e.constructor.name, e.code, e.message]; }
      try { await f.loopaUpdateSale.run({ auth: { uid: 'nadie' }, data: {} }); out.denied = 'ok?'; } catch (e) { out.denied = [e.constructor.name, e.code]; }
      console.log(JSON.stringify(out));
    })();`;
  const r = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: path.join(__dirname, 'node_modules'), GCLOUD_PROJECT: 'demo-loopa-fn', GOOGLE_APPLICATION_CREDENTIALS: '' },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out.exports, ['loopaAddPayment', 'loopaCreateSale', 'loopaOnEventCreated', 'loopaSweepEvents', 'loopaUpdateSale']);
  assert.deepEqual(out.unauth, ['HttpsError', 'unauthenticated', 'Iniciá sesión para vender']);
  assert.deepEqual(out.denied, ['HttpsError', 'permission-denied']);
});
