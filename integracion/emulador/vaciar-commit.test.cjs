'use strict';
// Las escrituras que arma vaciar.cjs, contra el emulador de Firestore: los
// deletes con «exists» borran, el contador sólo cambia «next», y si un
// documento ya no está el commit entero se rechaza (no borra a medias).
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../puesta-en-marcha/vaciar-plan.cjs');

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const skip = EMU ? false : 'sin emulador de Firestore (node integracion/emulador/correr.cjs)';
const PROY = 'demo-loopa-vaciar';
const BASE = `http://${EMU}/v1/projects/${PROY}/databases/(default)/documents`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const nombre = (r) => `projects/${PROY}/databases/(default)/documents/${r}`;

async function poner(ruta, fields) {
  const [c, id] = [ruta.slice(0, ruta.lastIndexOf('/')), ruta.slice(ruta.lastIndexOf('/') + 1)];
  const r = await fetch(`${BASE}/${c}?documentId=${id}`, { method: 'POST', headers: H, body: JSON.stringify({ fields }) });
  assert.ok(r.ok, `sembrar ${ruta}: ${r.status}`);
}
const leer = async (ruta) => { const r = await fetch(`${BASE}/${ruta}`, { headers: H }); return r.status === 404 ? null : r.json(); };
const commit = (writes) => fetch(`${BASE}:commit`, { method: 'POST', headers: H, body: JSON.stringify({ writes }) });

test('vaciar: los commits borran, ajustan el contador y no borran a medias', { skip }, async () => {
  await fetch(`http://${EMU}/emulator/v1/projects/${PROY}/databases/(default)/documents`, { method: 'DELETE' });
  await poner('loopa_sales/s1', { n: { integerValue: '1001' } });
  await poner('frame_projects/t1', { title: { stringValue: 'Tarea' } });
  await poner('frame_projects/t1/activity/a1', { text: { stringValue: 'x' } });
  await poner('loopa_counters/sales', { next: { integerValue: '1007' }, migration: { mapValue: { fields: { hash: { stringValue: 'h' } } } } });

  const del = (r) => ({ delete: nombre(r), currentDocument: { exists: true } });
  // Un documento que ya no existe hace fallar el commit entero.
  const malo = await commit([del('loopa_sales/s1'), del('loopa_sales/fantasma')]);
  assert.equal(malo.ok, false);
  assert.ok(await leer('loopa_sales/s1'), 'no borró a medias');

  const ok = await commit([del('loopa_sales/s1'), del('frame_projects/t1'), del('frame_projects/t1/activity/a1')]);
  assert.ok(ok.ok, `commit: ${ok.status}`);
  assert.equal(await leer('loopa_sales/s1'), null);
  assert.equal(await leer('frame_projects/t1'), null);
  assert.equal(await leer('frame_projects/t1/activity/a1'), null);

  const cont = await commit([{ update: { name: nombre('loopa_counters/sales'), fields: { next: { integerValue: String(P.PRIMERA_VENTA) } } }, updateMask: { fieldPaths: ['next'] }, currentDocument: { exists: true } }]);
  assert.ok(cont.ok);
  const c = await leer('loopa_counters/sales');
  assert.equal(c.fields.next.integerValue, '1001');
  assert.equal(c.fields.migration.mapValue.fields.hash.stringValue, 'h', 'el resto del contador queda');
});
