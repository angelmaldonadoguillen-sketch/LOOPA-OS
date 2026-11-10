'use strict';
// Punto B: el almacén REST de la migración, con un transporte simulado (sin red).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../puesta-en-marcha/almacen-rest.cjs');

const BASE = 'https://firestore.googleapis.com/v1/projects/frame-studio-3a18f/databases/(default)';
const EMU = 'http://127.0.0.1:8085/v1/projects/demo-x/databases/(default)';

test('valores: ida y vuelta sin perder tipos', () => {
  const d = { s: 'á', n: 1500, x: 1500.5, b: false, z: null, a: [1, 'dos', { tres: 3 }], m: { k: [] }, t: { __timestamp: '2026-11-10T00:00:00Z' }, u: undefined };
  const f = R.aCampos(d);
  assert.deepEqual(f.n, { integerValue: '1500' });
  assert.deepEqual(f.x, { doubleValue: 1500.5 });
  assert.equal('u' in f, false);
  const { u, ...sinU } = d;
  assert.deepEqual(R.deCampos(f), sinU);
  assert.throws(() => R.aValor(NaN), /no finito/);
  assert.throws(() => R.aValor(new Date()), /no plano/);
  assert.throws(() => R.aValor(() => 1), /no soportado/);
  assert.equal(R.rutaCampo('commercial'), 'commercial');
  assert.equal(R.rutaCampo('a-b'), '`a-b`');
});

test('permitidoAlmacen: sólo esta base, las colecciones de la migración y 3 POST', () => {
  assert.equal(R.permitidoAlmacen('GET', `${BASE}/documents/loopa_sales/S-1`, BASE), true);
  assert.equal(R.permitidoAlmacen('POST', `${BASE}/documents:batchGet`, BASE), true);
  assert.equal(R.permitidoAlmacen('GET', `${BASE}/documents/frame_clients/cli_1?transaction=abc`, BASE), false, 'en transacción se lee con batchGet');
  assert.equal(R.permitidoAlmacen('POST', `${BASE}/documents:commit`, BASE), true);
  assert.equal(R.permitidoAlmacen('POST', `${BASE}/documents:beginTransaction`, BASE), true);
  [
    ['GET', `${BASE}/documents/frame_projects/p1`],
    ['GET', `${BASE}/documents/frame_users/u1`],
    ['GET', `${BASE}/documents/loopa_sales`],
    ['GET', `${BASE}/documents/loopa_sales/S-1/sub/x`],
    ['GET', `${BASE}/documents/loopa_sales/..`],
    ['DELETE', `${BASE}/documents/loopa_sales/S-1`],
    ['PATCH', `${BASE}/documents/loopa_sales/S-1`],
    ['POST', `${BASE}/documents:runQuery`],
    ['POST', `${BASE}/documents:batchWrite`],
    ['GET', 'https://firestore.googleapis.com/v1/projects/otro/databases/(default)/documents/loopa_sales/S-1'],
  ].forEach(([m, u]) => assert.equal(R.permitidoAlmacen(m, u, BASE), false, `${m} ${u}`));
  assert.equal(R.baseValida(EMU), true);
  assert.equal(R.baseValida('http://127.0.0.1:8085/v1/projects/frame-studio-3a18f/databases/(default)'), false, 'el emulador sólo con demo-*');
  assert.equal(R.baseValida('http://evil.test/v1/projects/demo-x/databases/(default)'), false);
});

test('escrituraValida: crear si no existe o actualizar campos si existe; nada más', () => {
  const n = 'projects/frame-studio-3a18f/databases/(default)/documents/loopa_sales/S-1';
  assert.equal(R.escrituraValida({ update: { name: n, fields: {} }, currentDocument: { exists: false } }, BASE), true);
  assert.equal(R.escrituraValida({ update: { name: n, fields: {} }, updateMask: { fieldPaths: ['a'] }, currentDocument: { exists: true } }, BASE), true);
  [
    { update: { name: n, fields: {} } },
    { update: { name: n, fields: {} }, currentDocument: { exists: true } },
    { update: { name: n, fields: {} }, updateMask: { fieldPaths: [] }, currentDocument: { exists: true } },
    { delete: n },
    { update: { name: n, fields: {} }, currentDocument: { exists: false }, updateTransforms: [] },
    { update: { name: n.replace('loopa_sales', 'frame_projects'), fields: {} }, currentDocument: { exists: false } },
    { update: { name: n.replace('frame-studio-3a18f', 'otro'), fields: {} }, currentDocument: { exists: false } },
  ].forEach((w, i) => assert.equal(R.escrituraValida(w, BASE), false, `caso ${i}`));
});

function transporte(respuestas) {
  const llamadas = [];
  return {
    llamadas,
    pedir: async (metodo, url, cuerpo) => {
      llamadas.push({ metodo, url, cuerpo });
      const r = respuestas.shift();
      if (!r) throw new Error(`sin respuesta para ${metodo} ${url}`);
      return typeof r === 'function' ? r(metodo, url, cuerpo) : r;
    },
  };
}

test('transacción: lee, crea, actualiza y confirma; 404 es «no existe»', async () => {
  const t = transporte([
    { status: 200, cuerpo: { transaction: 'T1' } },
    { status: 200, cuerpo: [{ missing: 'x' }] },
    { status: 200, cuerpo: [{ found: { fields: { n: { integerValue: '3' } } } }] },
    { status: 200, cuerpo: {} },
  ]);
  const s = new R.AlmacenRest({ base: BASE, pedir: t.pedir });
  const r = await s.transaction(async (tx) => {
    assert.equal(await tx.get('loopa_sales', 'S-1'), null);
    assert.deepEqual(await tx.get('loopa_counters', 'sales'), { n: 3 });
    tx.create('loopa_sales', 'S-1', { n: 1 });
    tx.update('loopa_counters', 'sales', { n: 4 });
    await assert.rejects(tx.get('loopa_sales', 'S-2'), /lecturas antes/);
    return 'ok';
  });
  assert.equal(r, 'ok');
  const commit = t.llamadas[3];
  assert.ok(commit.url.endsWith(':commit'));
  assert.equal(commit.cuerpo.transaction, 'T1');
  assert.deepEqual(commit.cuerpo.writes.map(w => w.currentDocument.exists), [false, true]);
  assert.deepEqual(commit.cuerpo.writes[1].updateMask, { fieldPaths: ['n'] });
  assert.ok(t.llamadas[1].url.endsWith(':batchGet'));
  assert.equal(t.llamadas[1].cuerpo.transaction, 'T1');
  assert.deepEqual(t.llamadas[1].cuerpo.documents, ['projects/frame-studio-3a18f/databases/(default)/documents/loopa_sales/S-1']);
  // Fuera de transacción, un GET común: 404 es «no existe».
  const t4 = transporte([{ status: 404, cuerpo: { error: { status: 'NOT_FOUND' } } }]);
  assert.equal(await new R.AlmacenRest({ base: BASE, pedir: t4.pedir }).get('loopa_sales', 'S-9'), null);
});

test('transacción: se repite ante contención y se deshace si fn falla', async () => {
  let veces = 0;
  const t = transporte([
    { status: 200, cuerpo: { transaction: 'A' } },
    { status: 409, cuerpo: { error: { status: 'ABORTED' } } },
    { status: 200, cuerpo: {} },
    { status: 200, cuerpo: { transaction: 'B' } },
    { status: 200, cuerpo: {} },
  ]);
  const s = new R.AlmacenRest({ base: BASE, pedir: t.pedir });
  await s.transaction(async (tx) => { veces += 1; tx.create('loopa_sales', 'S-1', { n: 1 }); });
  assert.equal(veces, 2);
  // Antes de repetir, la transacción fallida se cierra (no retiene documentos).
  assert.ok(t.llamadas[2].url.endsWith(':rollback'));
  assert.equal(t.llamadas[2].cuerpo.transaction, 'A');
  // ALREADY_EXISTS (también 409) no se repite: sube como already-exists.
  const t2 = transporte([{ status: 200, cuerpo: { transaction: 'C' } }, { status: 409, cuerpo: { error: { status: 'ALREADY_EXISTS' } } }, { status: 200, cuerpo: {} }]);
  await assert.rejects(new R.AlmacenRest({ base: BASE, pedir: t2.pedir }).transaction(async (tx) => { tx.create('loopa_sales', 'S-1', {}); }), e => e.code === 'already-exists');
  const t3 = transporte([{ status: 200, cuerpo: { transaction: 'D' } }, { status: 200, cuerpo: {} }]);
  await assert.rejects(new R.AlmacenRest({ base: BASE, pedir: t3.pedir }).transaction(async () => { throw new Error('boom'); }), /boom/);
  assert.ok(t3.llamadas[1].url.endsWith(':rollback'));
});

test('fuera de la migración no se lee ni se escribe', async () => {
  const s = new R.AlmacenRest({ base: BASE, pedir: async () => { throw new Error('no debía llamar'); } });
  await assert.rejects(s.get('frame_projects', 'p1'), /Fuera de la migración/);
  await assert.rejects(s.get('loopa_sales', '../x'), /Fuera de la migración/);
  assert.throws(() => new R.AlmacenRest({ base: 'https://evil.test/v1/projects/x/databases/(default)', pedir: () => {} }), /no válida/);
});

test('revisión: enteros enormes como double; beginTransaction se reintenta; sin red = reintentable', async () => {
  assert.deepEqual(R.aValor(2 ** 53 + 2), { doubleValue: 2 ** 53 + 2 });
  assert.deepEqual(R.aValor(1e21), { doubleValue: 1e21 });
  assert.deepEqual(R.aValor(42), { integerValue: '42' });
  const t = transporte([
    { status: 503, cuerpo: { error: { status: 'UNAVAILABLE' } } },
    { status: 200, cuerpo: { transaction: 'T2' } },
    { status: 200, cuerpo: {} },
  ]);
  await new R.AlmacenRest({ base: BASE, pedir: t.pedir }).transaction(async (tx) => { tx.create('loopa_sales', 'S-1', {}); });
  assert.deepEqual(t.llamadas.map(l => l.url.split(':').pop()), ['beginTransaction', 'beginTransaction', 'commit']);
  const { transporte: real } = require('../puesta-en-marcha/migrar.cjs');
  const sinRed = await real('x')('GET', 'http://127.0.0.1:1/nada');
  assert.equal(sinRed.status, 503, 'un fetch que falla es «unavailable»');
});
