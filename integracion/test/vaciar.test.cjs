'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../puesta-en-marcha/vaciar-plan.cjs');

const D = P.DOCS, O = P.DOCS_ORIGEN;
const estado = () => ({
  docs: {
    loopa_sales: [`${D}/loopa_sales/s1`], frame_clients: [`${D}/frame_clients/c1`], frame_client_portals: [`${D}/frame_client_portals/tk1`],
    frame_projects: [`${D}/frame_projects/t1`, `${D}/frame_projects/t2`], frame_trash: [], loopa_integration_events: [],
  },
  subdocs: [`${D}/frame_projects/t1/activity/a1`, `${D}/frame_client_portals/tk1/comments/m1`],
  notificaciones: [{ name: `${D}/frame_notifications/u1/items/n1`, projectId: 't1' }, { name: `${D}/frame_notifications/u1/items/n2`, projectId: null }, { name: `${D}/frame_notifications/u1/items/n3`, projectId: 'otra' }],
  storage: [{ name: 'frame-covers/t1/a.jpg', generation: 123 }],
  gastos: [`${D}/loopa_expenses/GV-1`],
  origen: [`${O}/loopa/ventas`, `${O}/loopa/clientes`],
  contador: { name: `${D}/loopa_counters/sales`, next: 1007 },
});

test('vaciar: el plan borra ventas, clientes, portales, tareas, sus subcolecciones y sus avisos', () => {
  const plan = P.armarPlan(estado());
  assert.deepEqual(P.resumenPlan(plan), {
    loopa_sales: 1, frame_clients: 1, frame_client_portals: 1, 'frame_client_portals/*/comments': 1,
    frame_projects: 2, 'frame_projects/*/activity': 1, 'frame_notifications/*/items': 1,
    'archivos de Storage': 1, 'próxima venta': '#1007 → #1001',
  });
  // El aviso sin tarea o de una tarea que no se borra, queda.
  assert.ok(!plan.borrar.some(n => /items\/n[23]$/.test(n)));
  // Gastos y la copia vieja, sólo si se piden.
  assert.ok(!plan.borrar.some(n => n.includes('loopa_expenses')) && plan.origen.length === 0);
  const todo = P.armarPlan(estado(), { gastos: true, copiaVieja: true });
  assert.ok(todo.borrar.includes(`${D}/loopa_expenses/GV-1`));
  assert.equal(todo.origen.length, 2);
});

test('vaciar: nada fuera de lo previsto entra al plan', () => {
  const e = estado(); e.subdocs.push('projects/otro/databases/(default)/documents/x/y');
  assert.throws(() => P.armarPlan(e), /fuera del proyecto/);
  const s = estado(); s.storage.push({ name: 'frame-portfolios/u1/a', generation: 1 });
  assert.throws(() => P.armarPlan(s), /fuera de las carpetas/);
  const o = estado(); o.origen.push(`${O}/otra/cosa`);
  assert.throws(() => P.armarPlan(o, { copiaVieja: true }), /fuera de loopa/);
  const c = estado(); c.contador = null;
  assert.throws(() => P.armarPlan(c), /falta loopa_counters/);
});

test('vaciar: la huella cambia si cambia cualquier cosa', () => {
  const a = P.huella(P.armarPlan(estado()));
  assert.equal(a, P.huella(P.armarPlan(estado())));
  const e = estado(); e.docs.loopa_sales.push(`${D}/loopa_sales/s2`);
  assert.notEqual(a, P.huella(P.armarPlan(e)));
  const g = estado(); g.storage[0].generation = 124;
  assert.notEqual(a, P.huella(P.armarPlan(g)));
  assert.notEqual(a, P.huella(P.armarPlan(estado(), { gastos: true })));
});

test('vaciar: la red sólo deja commits y DELETE de archivos del plan, misma versión', () => {
  const plan = P.armarPlan(estado());
  assert.ok(P.permitidoVaciar('POST', `https://firestore.googleapis.com/v1/${D}:commit`, plan));
  assert.ok(P.permitidoVaciar('POST', `https://firestore.googleapis.com/v1/${O}:commit`, plan));
  assert.ok(!P.permitidoVaciar('POST', 'https://firestore.googleapis.com/v1/projects/otro/databases/(default)/documents:commit', plan));
  assert.ok(!P.permitidoVaciar('DELETE', `https://firestore.googleapis.com/v1/${D}/loopa_sales/s1`, plan));
  const st = `https://storage.googleapis.com/storage/v1/b/${P.BUCKET}/o/`;
  assert.ok(P.permitidoVaciar('DELETE', `${st}${encodeURIComponent('frame-covers/t1/a.jpg')}?ifGenerationMatch=123`, plan));
  assert.ok(!P.permitidoVaciar('DELETE', `${st}${encodeURIComponent('frame-covers/t1/a.jpg')}?ifGenerationMatch=999`, plan));
  assert.ok(!P.permitidoVaciar('DELETE', `${st}${encodeURIComponent('frame-covers/t1/a.jpg')}`, plan));
  assert.ok(!P.permitidoVaciar('DELETE', `${st}${encodeURIComponent('frame-portfolios/u1/x')}?ifGenerationMatch=1`, plan));
  assert.ok(!P.permitidoVaciar('GET', `${st}x`, plan));
});

test('vaciar: un commit sólo lleva deletes del plan (con exists) y el contador a 1001', () => {
  const plan = P.armarPlan(estado());
  const del = (n) => ({ delete: n, currentDocument: { exists: true } });
  assert.ok(P.escriturasValidas([del(`${D}/loopa_sales/s1`)], plan));
  assert.ok(!P.escriturasValidas([{ delete: `${D}/loopa_sales/s1` }], plan), 'sin exists, no');
  assert.ok(!P.escriturasValidas([del(`${D}/frame_users/u1`)], plan), 'fuera del plan, no');
  const cont = { update: { name: `${D}/loopa_counters/sales`, fields: { next: { integerValue: '1001' } } }, updateMask: { fieldPaths: ['next'] }, currentDocument: { exists: true } };
  assert.ok(P.escriturasValidas([cont], plan));
  assert.ok(!P.escriturasValidas([{ ...cont, updateMask: undefined }], plan), 'sin máscara pisaría el documento');
  assert.ok(!P.escriturasValidas([{ ...cont, update: { ...cont.update, fields: { next: { integerValue: '1' } } } }], plan));
});

test('vaciar.cjs: prueba en seco por defecto; borrar exige --escribir y la huella', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'puesta-en-marcha', 'vaciar.cjs'), 'utf8');
  assert.match(src, /if \(!ESCRIBIR\) \{ console\.log\('Prueba en seco: no se borró nada\.'\); return; \}/);
  assert.match(src, /if \(HUELLA !== h\) throw new Error/);
  assert.ok(src.indexOf('if (HUELLA !== h)') < src.indexOf('await commit('), 'la huella se revisa antes de borrar');
  assert.match(src, /if \(!P\.escriturasValidas\(writes, plan\)\) throw/);
  assert.doesNotMatch(src, /console\.log\([^)]*tk\b/, 'el token no se imprime');
});
