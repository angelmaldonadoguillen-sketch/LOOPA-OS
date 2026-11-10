'use strict';
// Tanda 2.6 — el adaptador Firestore sin red: a quién acepta hablarle, cómo
// traduce errores y qué datos acepta (lo mismo que MemoryStore). Lo que hace
// contra Firestore se prueba en integracion/emulador (correr.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../functions/production-plan');
const { FirestoreStore, normalizeError } = require('../../functions/adapters/firestore-store');
const fsData = require('../../functions/adapters/firestore-data');
const { MemoryStore } = require('../memory-store.cjs');
const { loadFixtures, buildSale } = require('../harness.cjs');

// Un db mínimo con la forma de @google-cloud/firestore: _settings dice a
// dónde habla de verdad (servicePath/ssl) y projectId de qué proyecto.
function fakeDb(projectId, settings = { servicePath: '127.0.0.1', port: 8085, ssl: false }) {
  const calls = [];
  const ref = (col, id) => ({ col, id });
  return {
    get projectId() { if (projectId === undefined) throw new Error('INTERNAL ERROR: Client is not yet ready'); return projectId; },
    _settings: { ...settings },
    calls,
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    runTransaction: async (fn, opts) => {
      calls.push(['runTransaction', opts]);
      return fn({
        get: async (r) => { calls.push(['get', r.col, r.id]); return { exists: false }; },
        create: (r, d) => calls.push(['create', r.col, r.id, d]),
        update: (r, d) => calls.push(['update', r.col, r.id, d]),
      });
    },
  };
}
const rechaza = (fn) => assert.throws(fn, e => e.code === 'remote_not_allowed');

test('sólo el emulador local con un proyecto demo-*, mirando la configuración real del db', () => {
  assert.ok(new FirestoreStore(fakeDb('demo-loopa')));
  assert.ok(new FirestoreStore(fakeDb('demo-loopa', { servicePath: 'localhost', ssl: false })));
  rechaza(() => new FirestoreStore(fakeDb('tooned-os')));
  rechaza(() => new FirestoreStore(fakeDb('frame-studio-3a18f')));
  rechaza(() => new FirestoreStore(fakeDb('demo-')));
  rechaza(() => new FirestoreStore(fakeDb(undefined)));
  // (A/B) db creado sin emulador: va a googleapis aunque la variable exista después.
  rechaza(() => new FirestoreStore(fakeDb('demo-loopa', { servicePath: 'firestore.googleapis.com', ssl: true })));
  // (C) un "emulador" en otro host: los datos saldrían por la red en claro.
  rechaza(() => new FirestoreStore(fakeDb('demo-loopa', { servicePath: 'collector.example.com', ssl: false })));
  rechaza(() => new FirestoreStore(fakeDb('demo-loopa', { servicePath: '127.0.0.1', ssl: true })));
});

test('(D) cambiar el proyecto o el host después de construir el almacén lo bloquea', async () => {
  const db = fakeDb('demo-loopa');
  const store = new FirestoreStore(db);
  db._settings.servicePath = 'firestore.googleapis.com';
  db._settings.ssl = true;
  await assert.rejects(store.get('loopa_sales', 's1'), e => e.code === 'remote_not_allowed');
  await assert.rejects(store.transaction(async () => {}), e => e.code === 'remote_not_allowed');
  await assert.rejects(store.queryEquals('loopa_sales', 'n', 1), e => e.code === 'remote_not_allowed');
  await assert.rejects(store.hasDocuments('loopa_sales'), e => e.code === 'remote_not_allowed');
  // allowRemote (Fase 3, con aprobación) es la única puerta.
  assert.ok(new FirestoreStore(fakeDb('frame-studio-3a18f', { servicePath: 'firestore.googleapis.com', ssl: true }), { allowRemote: true }));
});

test('errores: gRPC se traduce sin detalles de conexión; los del dominio pasan intactos', () => {
  assert.equal(normalizeError({ code: 6, message: 'x' }).code, 'already-exists');
  assert.equal(normalizeError({ code: 10 }).code, 'aborted');
  assert.equal(normalizeError({ code: 'ABORTED' }).code, 'aborted');
  assert.equal(normalizeError({ code: 'firestore/not-found' }).code, 'not-found');
  const grpc = normalizeError({ code: 14, message: '14 UNAVAILABLE: No connection established. Last error: connect ECONNREFUSED 127.0.0.1:8085', metadata: { secret: 1 } });
  assert.equal(grpc.code, 'unavailable');
  assert.doesNotMatch(grpc.message, /127\.0\.0\.1|8085/);
  assert.equal(grpc.cause, undefined, 'no arrastra el error original');
  assert.doesNotMatch(normalizeError({ code: 14, message: 'connect to firestore.example.dev:443 failed' }).message, /example\.dev:443/);
  const dominio = Object.assign(new Error('x'), { code: 'counter_missing' });
  assert.equal(normalizeError(dominio), dominio, 'counter_missing no se convierte en counter-missing');
  const contrato = Object.assign(new Error('x'), { code: 'contract_invalid', issues: [] });
  assert.equal(normalizeError(contrato), contrato);
  assert.equal(normalizeError({ code: 'SOME_DOMAIN_CODE' }).code, 'SOME_DOMAIN_CODE', 'sólo nombres gRPC conocidos');
  const bug = new TypeError('x is not a function');
  assert.equal(normalizeError(bug), bug, 'un error de programación sube con su traza');
});

test('transacción: lecturas antes de escrituras, datos válidos y maxAttempts ≥ 1', async () => {
  const db = fakeDb('demo-loopa');
  const store = new FirestoreStore(db);
  await store.transaction(async tx => { await tx.get('loopa_sales', 's1'); tx.update('loopa_sales', 's1', { lock: null }); }, 3);
  assert.deepEqual(db.calls[0], ['runTransaction', { maxAttempts: 3 }]);
  await assert.rejects(store.transaction(async tx => { tx.create('a', 'b', {}); await tx.get('a', 'c'); }), e => e.code === 'invalid-argument');
  await assert.rejects(store.transaction(async tx => { tx.update('a', 'b', { x: undefined }); }), e => e.code === 'invalid-argument');
  await assert.rejects(store.transaction(async tx => { tx.update('a', 'b', { 'operations.status': 'x' }); }), e => e.code === 'invalid-argument');
  await assert.rejects(store.transaction(async tx => { tx.update('a', 'b', { 'a/b': 1 }); }), e => e.code === 'invalid-argument');
  await assert.rejects(store.transaction(async () => {}, 0), e => e.code === 'invalid-argument');
  await assert.rejects(store.get('a/b', 'c'), e => e.code === 'invalid-argument', 'ruta de documento, no de colección');
  await assert.rejects(store.get('a', 'b/c'), e => e.code === 'invalid-argument', 'un id con barra cambiaría la ruta');
  await assert.rejects(store.queryEquals('a/b', 'x', 1), e => e.code === 'invalid-argument');
  await assert.rejects(store.queryEquals('a', 'x.y', 1), e => e.code === 'invalid-argument', 'campo anidado: Firestore seguiría la ruta');
  await assert.rejects(store.queryEquals('a', 'x', { y: 1 }), e => e.code === 'invalid-argument', 'valor objeto: memoria nunca lo encontraría');
  await assert.rejects(store.hasDocuments('a/b'), e => e.code === 'invalid-argument');
});

// Lo que Firestore rechaza o convierte, rechazado igual en memoria y en el adaptador.
const MALOS = {
  'array anidado': { a: [[1]] },
  Map: { a: new Map() },
  Date: { a: new Date(0) },
  'instancia de clase': { a: new (class X {})() },
  // eslint-disable-next-line no-sparse-arrays
  'hueco en array': { a: [1, , 3] },
  'clave vacía anidada': { a: { '': 1 } },
  'clave reservada': { __x__: 1 },
  undefined: { a: { b: undefined } },
  bigint: { a: 1n },
  'documento > 1 MB': { a: 'x'.repeat(1000 * 1000 + 1) },
};

test('MemoryStore y el adaptador rechazan exactamente lo mismo', async () => {
  for (const [nombre, doc] of Object.entries(MALOS)) {
    const mem = new MemoryStore();
    const fire = new FirestoreStore(fakeDb('demo-loopa'));
    await assert.rejects(mem.create('c', 'id', doc), e => e.code === 'invalid-argument', `memoria: ${nombre}`);
    await assert.rejects(fire.create('c', 'id', doc), e => e.code === 'invalid-argument', `adaptador: ${nombre}`);
    await assert.rejects(mem.transaction(async tx => { tx.create('c', 'id2', doc); }), e => e.code === 'invalid-argument', `memoria tx: ${nombre}`);
  }
  for (const id of ['__x__', '.', '..', '', 'a/b']) {
    assert.throws(() => fsData.validateDocId(id), e => e.code === 'invalid-argument', JSON.stringify(id));
    await assert.rejects(new MemoryStore().get('c', id), e => e.code === 'invalid-argument');
  }
  // Valores que Firestore sí guarda tal cual.
  fsData.validateDocument({ a: null, b: -0, c: NaN, d: [1, 'x', { e: [2] }], f: { g: { h: true } } });
});

test('MemoryStore: crear y actualizar el mismo documento en una transacción vale (como Firestore)', async () => {
  const store = new MemoryStore();
  await store.transaction(async tx => { tx.create('c', 'x', { a: 1 }); tx.update('c', 'x', { b: 2 }); });
  assert.deepEqual(await store.get('c', 'x'), { a: 1, b: 2 });
  await assert.rejects(store.transaction(async tx => { tx.update('c', 'nuevo', { a: 1 }); tx.create('c', 'nuevo', { a: 1 }); }), e => e.code === 'not-found');
  await assert.rejects(store.transaction(async tx => { tx.create('c', 'y', { a: 1 }); tx.create('c', 'y', { a: 1 }); }), e => e.code === 'already-exists');
});

test('claim: si el SDK re-ejecuta un reclamo que ya entró, no queda "busy" esperando su propio lease', async () => {
  const fx = loadFixtures();
  const inner = new MemoryStore();
  // La primera transacción del worker (el reclamo) se confirma y el SDK la
  // vuelve a correr como si la respuesta se hubiera perdido.
  let rerun = true;
  const store = new Proxy(inner, {
    get(target, prop) {
      if (prop === 'transaction') {
        return async (fn, n) => {
          if (!rerun) return target.transaction(fn, n);
          rerun = false;
          await target.transaction(fn, n);
          return target.transaction(fn, n);
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const sale = buildSale(structuredClone(fx.scenarios.find(s => s.name === 'paquete-mismo-dia').sale), fx.services);
  const T = '2026-11-10T15:00:00.000Z';
  inner.merge(core.COLLECTIONS.sales, sale.id, { id: sale.id, n: sale.n, revision: sale.revision, status: sale.status });
  const ev = core.createEvent('sale.confirmed', sale, T);
  await core.enqueueEvent(inner, ev, T);
  rerun = true;
  const r = await core.processEvent(store, ev.eventId, { context: fx.context, workerId: 'w1', now: () => T });
  assert.equal(r.status, 'done', 'el reclamo repetido sigue siendo suyo');
  assert.equal((await inner.get(core.COLLECTIONS.events, ev.eventId)).attempts, 1, 'no suma un intento fantasma');
});

test('el adaptador no carga firebase-admin ni ofrece borrar', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'functions', 'adapters', 'firestore-store.js'), 'utf8');
  assert.doesNotMatch(src, /require\(['"]firebase/);
  assert.doesNotMatch(src, /\.delete\(|recursiveDelete|\.set\(/);
  assert.equal(typeof FirestoreStore.prototype.delete, 'undefined');
});
