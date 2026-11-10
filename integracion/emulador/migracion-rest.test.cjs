'use strict';
// ─────────────────────────────────────────────────────────────────────
// Punto B: la migración por la API REST (migrar.cjs + almacen-rest.cjs)
// contra el emulador LOCAL de Firestore, comparada documento por documento
// con la misma corrida en memoria. Con un corte a mitad y su reanudación.
//
//   node integracion/emulador/correr.cjs integracion/emulador/migracion-rest.test.cjs
// ─────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMU && process.env.REQUIRE_EMULATOR === '1') throw new Error('REQUIRE_EMULATOR=1 sin FIRESTORE_EMULATOR_HOST');
const skip = EMU ? false : 'sin emulador de Firestore (node integracion/emulador/correr.cjs)';

const M = require('../puesta-en-marcha/migrar.cjs');
const { deCampos } = require('../puesta-en-marcha/almacen-rest.cjs');
const { MemoryStore } = require('../memory-store.cjs');
const { runMigration } = require('../../functions/migration/runner');

const FX = path.join(__dirname, '..', 'fixtures', 'migration');

function carpeta() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'loopa-migracion-'));
  fs.copyFileSync(path.join(FX, 'loopa-backup.json'), path.join(d, 'loopa-respaldo.json'));
  fs.copyFileSync(path.join(FX, 'frame-clients.json'), path.join(d, 'frame-clients.json'));
  // La copia archivada va APARTE (migrar.cjs rechaza la de la misma carpeta).
  const archivado = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loopa-copia-')), 'copia-archivada.json');
  fs.copyFileSync(path.join(FX, 'loopa-backup.json'), archivado);
  return { d, archivado };
}

test('migración por REST en el emulador = la misma corrida en memoria; se reanuda tras un corte', { skip }, async () => {
  const { d, archivado } = carpeta();
  const proyecto = `demo-loopa-mig-${Date.now()}`;
  const base = `http://${EMU}/v1/projects/${proyecto}/databases/(default)`;
  const frame = JSON.parse(fs.readFileSync(path.join(FX, 'frame-clients.json'), 'utf8'));
  const a = { respaldo: d, archivado, tablero: frame.workspaceId, decisiones: path.join(FX, 'client-decisions.json'), emulador: Number(EMU.split(':')[1]), escribir: false, huella: null };
  const directo = M.transporte('owner');
  const real = process.env.DEBUG_MIGRACION
    ? async (m, u, c) => { const t0 = Date.now(); const r = await directo(m, u, c); console.error(m, u.split('/documents')[1], r.status, `${Date.now() - t0}ms`); return r; }
    : directo;
  const log = process.env.DEBUG_MIGRACION ? (...x) => console.error(...x) : () => {};

  // 1. Sin --escribir: sólo lee (y siembra las fichas de FRAME del respaldo).
  const seco = await M.ejecutar(a, { pedir: real, base, log });
  assert.equal(seco.codigo, 0);
  assert.equal(seco.previo.counts.create + (seco.previo.counts.merge || 0), seco.plan.ops.length);

  // 2. Huella equivocada: no escribe.
  const mal = await M.ejecutar({ ...a, escribir: true, huella: 'otra' }, { pedir: real, base, log });
  assert.equal(mal.codigo, 3);

  // 3. Corte a mitad: el 6.º commit falla (sin red).
  let commits = 0;
  const conCorte = async (metodo, url, cuerpo) => {
    if (url.endsWith(':commit') && ++commits === 6) return { status: 503, cuerpo: { error: { status: 'UNAVAILABLE' } } };
    return real(metodo, url, cuerpo);
  };
  // UNAVAILABLE se reintenta dentro de la transacción: con un solo fallo,
  // la corrida igual termina. Forzamos que falle siempre a partir del 6.º.
  const caido = async (metodo, url, cuerpo) => {
    if (url.endsWith(':commit') && ++commits >= 6) return { status: 400, cuerpo: { error: { status: 'INVALID_ARGUMENT' } } };
    return real(metodo, url, cuerpo);
  };
  commits = 0;
  const uno = await M.ejecutar({ ...a, escribir: true, huella: seco.plan.fingerprint }, { pedir: conCorte, base, log });
  assert.equal(uno.codigo, 0, 'un corte de red suelto se reintenta solo');
  // Otra base, para probar la reanudación de verdad.
  const base2 = base.replace(proyecto, `${proyecto}-b`);
  commits = 0;
  await M.ejecutar(a, { pedir: real, base: base2, log });
  const cortada = await M.ejecutar({ ...a, escribir: true, huella: seco.plan.fingerprint }, { pedir: caido, base: base2, log });
  assert.notEqual(cortada.codigo, 0, 'la corrida quedó a medias');
  const retomada = await M.ejecutar({ ...a, escribir: true, huella: seco.plan.fingerprint }, { pedir: real, base: base2, log });
  assert.equal(retomada.codigo, 0, 'reanudada');
  const otra = await M.ejecutar({ ...a, escribir: true, huella: seco.plan.fingerprint }, { pedir: real, base: base2, log });
  assert.equal(otra.codigo, 0);
  assert.equal(otra.corrida.status, 'done');

  // 4. Igual a la corrida en memoria, documento por documento.
  const mem = new MemoryStore();
  frame.clients.forEach(c => mem.seed('frame_clients', c.id, c));
  const T = '2026-11-10T03:00:00.000Z';
  await runMigration(mem, seco.plan, { runId: 'mem', archivedBackupText: fs.readFileSync(archivado, 'utf8'), now: () => T });
  for (const b of [base, base2]) {
    for (const col of ['frame_clients', 'loopa_sales', 'loopa_services', 'loopa_expenses', 'loopa_config', 'loopa_counters']) {
      const r = await fetch(`${b}/documents/${col}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } });
      const docs = ((await r.json()).documents || []).map(x => ({ id: x.name.split('/').pop(), ...deCampos(x.fields || {}) }));
      const enMem = mem.list(col);
      assert.equal(docs.length, enMem.length, `${col}: cantidad`);
      const porId = Object.fromEntries(docs.map(x => [x.id, x]));
      enMem.forEach(m => {
        const id = m.id || Object.keys(porId).find(k => porId[k].migration && m.migration && porId[k].migration.hash === m.migration.hash);
        const e = porId[id];
        assert.ok(e, `${col}/${id} falta en el emulador`);
        const { id: _i, ...sinIdE } = e;
        const { id: _j, ...sinIdM } = m;
        // La fecha de la corrida (migration.at) es del reloj de cada corrida.
        const limpio = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'at' || k === 'migratedAt' ? undefined : v)));
        assert.deepEqual(limpio(sinIdE), limpio(sinIdM), `${col}/${id}`);
      });
    }
  }
  // Revisión: con un conflicto en el destino, --escribir no escribe nada.
  const ventas = await (await fetch(`${base2}/documents/loopa_sales?pageSize=1`, { headers: { Authorization: 'Bearer owner' } })).json();
  const nombre = ventas.documents[0].name;
  await fetch(`http://${EMU}/v1/${nombre}?updateMask.fieldPaths=migration`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { migration: { mapValue: { fields: { hash: { stringValue: 'otra' } } } } } }) });
  const conConflicto = await M.ejecutar({ ...a, escribir: true, huella: seco.plan.fingerprint }, { pedir: real, base: base2, log });
  assert.equal(conConflicto.codigo, 3, 'con conflictos no se escribe');
  assert.equal(conConflicto.corrida, undefined);
  fs.rmSync(d, { recursive: true, force: true });
});
