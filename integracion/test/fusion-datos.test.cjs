'use strict';
// Fase 3, tanda 3.2 — el traductor del navegador (_fuente/datos/fusion.js):
// lectura con paridad contra functions/migration/compat.js, y cada acción de
// las pantallas de LOOPA ejecutada contra las funciones del servidor (en
// memoria) y leída de vuelta.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../../_fuente/datos/fusion.js');
const compat = require('../../functions/migration/compat');
const { buildMigrationPlan } = require('../../functions/migration/plan');
const core = require('../../functions/production-plan');
const repo = require('../../functions/repositories/sales');
const server = require('../../functions/loopa-server');
const { MemoryStore } = require('../memory-store.cjs');
const { loadFixtures } = require('../harness.cjs');

const fx = loadFixtures();
const { COLLECTIONS } = core;
const T = '2026-11-10T15:00:00.000Z';
const now = () => T;
const U = { uid: 'u-com' };
let seq = 0;
const nuevoId = () => `9e0a0000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

const FN = {
  loopaCreateSale: server.createSale, loopaUpdateSale: server.updateSale, loopaAddPayment: server.addPayment,
  loopaRemovePayment: server.removePayment, loopaSaveClient: server.saveClient, loopaSaveService: server.saveService,
};
async function ejecutar(store, ops) {
  const out = [];
  for (const op of [].concat(ops)) {
    assert.ok(FN[op.fn], `función desconocida ${op.fn}`);
    out.push(await FN[op.fn](store, U, op.data, { now }));
  }
  return out;
}

function seeded() {
  const store = new MemoryStore();
  store.seed('frame_users', 'u-com', { status: 'active' });
  store.seed('loopa_config', 'access', { commercialUids: ['u-com'] });
  store.seed('loopa_config', 'production', { defaultWorkspaceId: fx.context.defaultWorkspaceId, allowedWorkspaceIds: fx.context.allowedWorkspaceIds });
  Object.entries(fx.context.workspaces).forEach(([id, w]) => store.seed('frame_workspaces', id, { name: w.name, memberIds: w.memberIds }));
  Object.entries(fx.context.clients).forEach(([id, c]) => store.seed('frame_clients', id, { id, ...c }));
  store.seed(repo.COUNTERS, 'sales', { next: 1043 });
  fx.services.forEach(sv => store.seed('loopa_services', sv.id, sv));
  return store;
}
const leer = async (store, id) => F.ventaDesdeDoc(await store.get(COLLECTIONS.sales, id));

// Venta tal como la arma la pantalla «Nueva venta».
const ventaPantalla = () => {
  const sv = fx.services.find(s => s.id === 'SRV-DEMO-PLAN-SOCIAL');
  return {
    fecha: '2026-11-10', entrega: '2026-11-30', estado: 'pendiente', pay: 'bac', nota: 'Brief en el drive',
    items: [{ tipoId: sv.id, nombre: sv.nombre, q: 1, precio: '9,000', costo: String(sv.costo) }],
    subtotal: 9000, descuento: 500, total: 8500, abonos: [{ id: 'AB-1', fecha: '2026-11-10', monto: 4000, metodo: 'bac' }],
  };
};
const cliPantalla = { nombre: 'Panadería Sol', empresa: 'Sol S.A.', telefono: '9999-1234', email: 'hola@sol.hn', canal: 'WhatsApp' };

test('lectura: misma forma que el lector de la migración (paridad con compat.js)', () => {
  const FXM = path.join(__dirname, '..', 'fixtures', 'migration');
  const backupText = fs.readFileSync(path.join(FXM, 'loopa-backup.json'), 'utf8');
  const frame = JSON.parse(fs.readFileSync(path.join(FXM, 'frame-clients.json'), 'utf8'));
  const { decisions } = JSON.parse(fs.readFileSync(path.join(FXM, 'client-decisions.json'), 'utf8'));
  const plan = buildMigrationPlan({ backup: JSON.parse(backupText), frameClients: frame.clients, decisions, workspaceId: frame.workspaceId });
  const docs = (col) => plan.ops.filter(o => o.collection === col).map(o => o.data);
  const ventas = docs('loopa_sales');
  assert.ok(ventas.length > 3);
  ventas.forEach(d => {
    const mine = F.ventaDesdeDoc(d);
    const theirs = compat.toLegacyVenta(d);
    if (theirs === null) { assert.equal(mine, null); return; }
    const { version, produccion, ...resto } = mine;
    assert.deepEqual(resto, theirs, `venta ${d.n}`);
  });
  docs('frame_clients').filter(c => c.commercial).forEach(c => assert.deepEqual(F.clienteDesdeDoc(c), compat.toLegacyCliente(c)));
  docs('loopa_services').forEach(s => {
    const { generaProduccion, ...resto } = F.servicioDesdeDoc(s);
    assert.deepEqual(resto, compat.toLegacyServicio(s));
  });
});

test('nueva venta desde la pantalla: cliente nuevo + venta, número del servidor y vuelve igual', async () => {
  const store = seeded();
  const v = ventaPantalla();
  const { ventaId, clienteId, ops } = F.operacionesNuevaVenta(v, cliPantalla, null, nuevoId);
  assert.deepEqual(ops.map(o => o.fn), ['loopaSaveClient', 'loopaCreateSale']);
  assert.ok(!JSON.stringify(ops).includes('executionPlan'), 'el navegador no manda plantillas');
  const [cli, venta] = await ejecutar(store, ops);
  assert.equal(cli.status, 'created');
  assert.deepEqual([venta.status, venta.n], ['created', 1043]);
  const leida = await leer(store, ventaId);
  assert.equal(leida.clienteId, clienteId);
  assert.deepEqual([leida.cliente, leida.empresa, leida.telefono, leida.email, leida.canal], ['Panadería Sol', 'Sol S.A.', '9999-1234', 'hola@sol.hn', 'WhatsApp']);
  assert.deepEqual([leida.total, leida.descuento, leida.subtotal, leida.pay, leida.nota, leida.entrega, leida.estado], [8500, 500, 9000, 'bac', 'Brief en el drive', '2026-11-30', 'pendiente']);
  assert.deepEqual(leida.items.map(i => [i.tipoId, i.q, i.precio]), [['SRV-DEMO-PLAN-SOCIAL', 1, 9000]], 'el precio con coma se entiende');
  assert.deepEqual(leida.abonos, v.abonos);
  // Doble clic: las mismas operaciones no duplican nada.
  const again = await ejecutar(store, ops);
  assert.equal(again[1].status, 'existing');
  assert.equal(store.list(COLLECTIONS.sales).length, 1);
  assert.equal(store.list('frame_clients').filter(c => c.id === clienteId).length, 1);
});

test('vender a una ficha existente no borra sus datos con campos vacíos', async () => {
  const store = seeded();
  await ejecutar(store, F.operacionCliente({ id: 'cli-demo-cafe-aurora', nombre: 'Café Aurora', telefono: '2222-0000', email: 'cafe@aurora.hn' }));
  const { ops } = F.operacionesNuevaVenta(ventaPantalla(), { nombre: 'Café Aurora', empresa: '', telefono: '', email: '' }, 'cli-demo-cafe-aurora', nuevoId);
  await ejecutar(store, ops);
  const c = F.clienteDesdeDoc(await store.get('frame_clients', 'cli-demo-cafe-aurora'));
  assert.deepEqual([c.telefono, c.email], ['2222-0000', 'cafe@aurora.hn']);
});

test('cambios de la pantalla de ventas: avance, líneas, fecha, nota, pago, anular cobro, cancelar y reconfirmar', async () => {
  const store = seeded();
  const { ventaId, ops } = F.operacionesNuevaVenta(ventaPantalla(), cliPantalla, null, nuevoId);
  await ejecutar(store, ops);
  let v = await leer(store, ventaId);
  const eventos = () => store.list(COLLECTIONS.events).filter(e => e.saleId === ventaId).length;
  const e0 = eventos();

  await ejecutar(store, F.operacionesCambio(v, { estado: 'en-proceso' }, nuevoId));
  v = await leer(store, ventaId);
  assert.equal(v.estado, 'en-proceso');
  assert.equal(eventos(), e0, 'el avance comercial no genera producción');

  await ejecutar(store, F.operacionesCambio(v, { nota: 'Nuevo brief', pay: 'efectivo', entrega: '2026-12-05' }, nuevoId));
  v = await leer(store, ventaId);
  assert.deepEqual([v.nota, v.pay, v.entrega], ['Nuevo brief', 'efectivo', '2026-12-05']);
  assert.equal(eventos(), e0 + 1, 'cambiar la entrega sí avisa a producción');

  const items = [...v.items, { tipoId: 'SRV-DEMO-REEL', nombre: 'Reel', q: 2, precio: 1500, costo: 400 }];
  await ejecutar(store, F.operacionesCambio(v, { items, subtotal: 12000, descuento: 500, total: 11500 }, nuevoId));
  v = await leer(store, ventaId);
  assert.deepEqual(v.items.map(i => [i.tipoId, i.q]), [['SRV-DEMO-PLAN-SOCIAL', 1], ['SRV-DEMO-REEL', 2]]);
  assert.equal(v.total, 11500);

  await ejecutar(store, F.operacionCobro(v, { id: 'AB-2', fecha: '2026-11-11', monto: 1000, metodo: 'bac' }));
  v = await leer(store, ventaId);
  await ejecutar(store, F.operacionesCambio(v, { abonos: v.abonos.filter(a => a.id !== 'AB-1') }, nuevoId));
  v = await leer(store, ventaId);
  assert.deepEqual(v.abonos.map(a => a.id), ['AB-2'], 'anulado: deja de sumar');
  const doc = await store.get(COLLECTIONS.sales, ventaId);
  assert.deepEqual(doc.commercial.abonosAnulados.map(a => [a.id, a.anuladoPor]), [['AB-1', 'u-com']], 'pero queda registrado quién lo anuló');
  assert.equal(await server.addPayment(store, U, { saleId: ventaId, abono: { id: 'AB-1', fecha: '2026-11-12', monto: 10, metodo: 'bac' } }).then(() => 'ok', e => e.details.code), 'payment_conflict', 'un id anulado no se reutiliza');

  await ejecutar(store, F.operacionEliminar(v));
  v = await leer(store, ventaId);
  assert.equal(v.estado, 'cancelado', '«Eliminar» cancela (D16): nada se borra');
  assert.ok(await store.get(COLLECTIONS.sales, ventaId));

  await ejecutar(store, F.operacionesCambio(v, { estado: 'revision' }, nuevoId));
  v = await leer(store, ventaId);
  assert.equal(v.estado, 'revision', 'reconfirmar desde cancelado vuelve con su avance');
  assert.equal((await store.get(COLLECTIONS.sales, ventaId)).status, 'confirmed');
});

test('la versión protege contra pisar el trabajo de otra persona', async () => {
  const store = seeded();
  const { ventaId, ops } = F.operacionesNuevaVenta(ventaPantalla(), cliPantalla, null, nuevoId);
  await ejecutar(store, ops);
  const vieja = await leer(store, ventaId);
  await ejecutar(store, F.operacionesCambio(vieja, { nota: 'Otra persona' }, nuevoId));
  const e = await ejecutar(store, F.operacionesCambio(vieja, { nota: 'Pantalla vieja' }, nuevoId)).catch(x => x);
  assert.equal(e.details.code, 'version_conflict');
  assert.equal((await leer(store, ventaId)).nota, 'Otra persona');
});

test('lo que la fusión no soporta falla claro, sin escribir', () => {
  const v = { id: 'x', version: 1, estado: 'pendiente', abonos: [] };
  assert.throws(() => F.operacionesCambio(v, { clienteId: 'otro' }, nuevoId), /no soportado/);
  assert.throws(() => F.operacionesCambio(v, { estado: 'raro' }, nuevoId), /Estado desconocido/);
  assert.throws(() => F.operacionesCambio(v, { abonos: [{ id: 'AB-9', monto: 1 }] }, nuevoId), /«Cobrar»/);
  assert.throws(() => F.operacionesNuevaVenta({ items: [{ tipoId: '', q: 1 }] }, cliPantalla, null, nuevoId), /catálogo/);
  assert.throws(() => F.operacionesNuevaVenta({ items: [] }, cliPantalla, null, nuevoId), /no tiene servicios/);
});

test('servicios desde la pantalla: lo comercial viaja, la plantilla no', async () => {
  const store = seeded();
  const sv = F.servicioDesdeDoc(await store.get('loopa_services', 'SRV-DEMO-PLAN-SOCIAL'));
  assert.equal(sv.generaProduccion, true);
  const op = F.operacionServicio({ ...sv, precio: '9,500' });
  assert.ok(!('executionPlan' in op.data.service));
  await ejecutar(store, op);
  const doc = await store.get('loopa_services', 'SRV-DEMO-PLAN-SOCIAL');
  assert.equal(doc.precio, 9500);
  assert.deepEqual(doc.executionPlan, fx.services.find(s => s.id === 'SRV-DEMO-PLAN-SOCIAL').executionPlan);
});

test('el módulo es puro: sin Firebase, sin DOM, sin red', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '_fuente', 'datos', 'fusion.js'), 'utf8');
  assert.doesNotMatch(src, /firebase|window\.|document\.|fetch\(|localStorage|\.set\(|\.update\(/);
});

// ── Revisión de la tanda 3.2 ──────────────────────────────────────

test('D18 no se falsifica: anulados y autor de cobros los pone sólo el servidor', async () => {
  const store = seeded();
  const { ventaId, ops } = F.operacionesNuevaVenta(ventaPantalla(), cliPantalla, null, nuevoId);
  // La app intenta mandar un autor falso en el cobro inicial.
  ops[1].data.draft.commercial.abonos[0].registradoPor = 'u-boss';
  await ejecutar(store, ops);
  const doc = await store.get(COLLECTIONS.sales, ventaId);
  assert.equal(doc.commercial.abonos[0].registradoPor, 'u-com', 'el cobro de la venta nueva tiene autor real');
  const code = (p) => p.then(() => 'ok', e => e.details && e.details.code);
  assert.equal(await code(server.updateSale(store, U, { saleId: ventaId, patch: { commercial: { abonosAnulados: [] } }, expectedVersion: doc.version }, { now })), 'field_not_editable');
  assert.equal(await code(server.updateSale(store, U, { saleId: ventaId, patch: { commercial: { abonosAnulados: [{ id: 'X', anuladoPor: 'u-boss' }] } }, expectedVersion: doc.version }, { now })), 'field_not_editable');
  const otra = F.operacionesNuevaVenta(ventaPantalla(), cliPantalla, null, nuevoId);
  otra.ops[1].data.draft.commercial.abonosAnulados = [{ id: 'AB-9', anuladoPor: 'u-boss' }];
  assert.equal(await code(ejecutar(store, otra.ops)), 'field_not_editable');
  assert.equal(await code(server.addPayment(store, U, { saleId: ventaId, abono: { id: 'AB-7', fecha: '2026-11-10', monto: 1, metodo: 'bac', extra: 1 } })), 'contract_invalid', 'el cobro tiene forma fija');
});

test('una venta migrada con una línea fuera del catálogo se puede editar', async () => {
  const store = seeded();
  store.seed(COLLECTIONS.sales, 'sale_legacy_x', {
    schemaVersion: 1, id: 'sale_legacy_x', n: 900, revision: 1, version: 1, status: 'confirmed', legacyProductionState: 'en-proceso',
    fecha: '2026-10-01', entrega: '', client: { clientId: 'cli-demo-cafe-aurora', legacyClientId: 'CL-1', nombre: 'Café Aurora', empresa: '' },
    lines: [{ lineId: 'line_legacy_a', serviceId: 'SRV-SIN-CATALOGO', quantity: 1, snapshot: { nombre: 'Trabajo viejo', modelo: 'proyecto', categoria: '', unidad: '', alcance: '', precio: 1000, costo: 0, recomendado: false, specialClientId: null }, executionPlan: null, executionTemplateVersion: null }],
    operations: { status: 'not_applicable', reason: 'legacy_pre_integration' }, estadoLog: [],
    commercial: { subtotal: 1000, descuento: 0, total: 1000, pay: 'bac', abonos: [], canal: '', nota: '', contacto: { telefono: '', email: '' } },
  });
  let v = await leer(store, 'sale_legacy_x');
  assert.equal(v.items[0].tipoId, '');
  await ejecutar(store, F.operacionesCambio(v, { items: [{ ...v.items[0], q: 2, precio: 1200 }], subtotal: 2400, descuento: 0, total: 2400 }, nuevoId));
  v = await leer(store, 'sale_legacy_x');
  assert.deepEqual([v.items[0].q, v.items[0].precio, v.items[0].nombre, v.total], [2, 1200, 'Trabajo viejo', 2400]);
  // Pero no se agrega una línea NUEVA sin catálogo, ni se crea el servicio marcador.
  const sinTipo = [...v.items, { tipoId: '', q: 1, precio: 1 }];
  assert.throws(() => F.operacionesCambio(v, { items: sinTipo }, nuevoId), /catálogo/);
  // Y el servidor tampoco acepta una línea nueva con el servicio marcador.
  const marcador = [...v.items.map(i => ({ lineId: i.lineId, serviceId: 'SRV-SIN-CATALOGO', quantity: i.q, precio: i.precio })), { lineId: 'l-nueva', serviceId: 'SRV-SIN-CATALOGO', quantity: 1, precio: 1 }];
  await assert.rejects(server.updateSale(store, U, { saleId: 'sale_legacy_x', patch: { lines: marcador }, expectedVersion: (await store.get(COLLECTIONS.sales, 'sale_legacy_x')).version }, { now }), e => e.details && e.details.code === 'service_unknown');
  await assert.rejects(server.saveService(store, U, { service: { id: 'SRV-SIN-CATALOGO', nombre: 'X', modelo: 'unitario', precio: 1, costo: 0 } }, { now }), e => e.kind === 'invalid-argument');
});

test('el avance elegido al vender se guarda, y cada cambio de avance queda en el historial', async () => {
  const store = seeded();
  const { ventaId, ops } = F.operacionesNuevaVenta({ ...ventaPantalla(), estado: 'en-proceso' }, cliPantalla, null, nuevoId);
  await ejecutar(store, ops);
  let v = await leer(store, ventaId);
  assert.equal(v.estado, 'en-proceso');
  await ejecutar(store, F.operacionesCambio(v, { estado: 'entregado' }, nuevoId));
  v = await leer(store, ventaId);
  assert.deepEqual(v.estadoLog.map(e => e.estado), ['pendiente', 'entregado'], 'el cambio de avance queda registrado');
  await ejecutar(store, F.operacionEliminar(v));
  v = await leer(store, ventaId);
  await ejecutar(store, F.operacionesCambio(v, { estado: 'revision' }, nuevoId));
  v = await leer(store, ventaId);
  assert.deepEqual(v.estadoLog.map(e => e.estado).slice(-3), ['cancelado', 'pendiente', 'revision'], 'reconfirmar muestra el avance elegido al final');
  assert.equal(v.estadoLog[v.estadoLog.length - 1].by, 'u-com');
  assert.throws(() => F.operacionesNuevaVenta({ ...ventaPantalla(), estado: 'cancelado' }, cliPantalla, null, nuevoId), /no nace cancelada/);
});

test('la descripción por línea (alcance acordado) se guarda al vender y al editar', async () => {
  const store = seeded();
  const venta = ventaPantalla();
  venta.items[0].descripcion = 'Incluye 2 visitas extra';
  const { ventaId, ops } = F.operacionesNuevaVenta(venta, cliPantalla, null, nuevoId);
  await ejecutar(store, ops);
  let v = await leer(store, ventaId);
  assert.equal(v.items[0].descripcion, 'Incluye 2 visitas extra');
  await ejecutar(store, F.operacionesCambio(v, { items: [{ ...v.items[0], descripcion: 'EDITADA' }] }, nuevoId));
  v = await leer(store, ventaId);
  assert.equal(v.items[0].descripcion, 'EDITADA');
});

test('un acuerdo especial sólo se vende a su cliente', async () => {
  const store = seeded();
  store.seed('loopa_services', 'SRV-ESP-AURORA', { schemaVersion: 1, id: 'SRV-ESP-AURORA', nombre: 'Acuerdo Aurora', categoria: 'x', unidad: 'proyecto', modelo: 'especial', descripcion: '', precio: 100, costo: 0, activo: true, recomendado: false, specialClientId: 'cli-demo-cafe-aurora', executionPlan: null });
  const venta = { ...ventaPantalla(), items: [{ tipoId: 'SRV-ESP-AURORA', q: 1, precio: 100, costo: 0 }], subtotal: 100, descuento: 0, total: 100, abonos: [] };
  const ajena = F.operacionesNuevaVenta(venta, { nombre: 'Ferretería Norte' }, 'cli-demo-ferreteria-norte', nuevoId);
  await assert.rejects(ejecutar(store, ajena.ops), e => e.details && e.details.code === 'service_not_for_client');
  const propia = F.operacionesNuevaVenta(venta, { nombre: 'Café Aurora' }, 'cli-demo-cafe-aurora', nuevoId);
  assert.equal((await ejecutar(store, propia.ops))[1].status, 'created');
});

test('si una operación falla a mitad, reintentar retoma desde ahí (sin version_conflict ni ids nuevos)', async () => {
  const store = seeded();
  const { ventaId, ops } = F.operacionesNuevaVenta(ventaPantalla(), cliPantalla, null, nuevoId);
  await ejecutar(store, ops);
  const v = await leer(store, ventaId);
  const cambio = F.operacionesCambio(v, { nota: 'x', abonos: [] }, nuevoId);
  assert.deepEqual(cambio.map(o => o.fn), ['loopaUpdateSale', 'loopaRemovePayment']);
  let falla = true;
  const llamar = async (op) => {
    if (op.fn === 'loopaRemovePayment' && falla) { falla = false; throw Object.assign(new Error('sin red'), { kind: 'unavailable' }); }
    return FN[op.fn](store, U, op.data, { now });
  };
  const progreso = { hechas: 0 };
  await assert.rejects(F.ejecutarOperaciones(cambio, llamar, progreso), /sin red/);
  assert.equal(progreso.hechas, 1, 'la primera quedó confirmada');
  const r = await F.ejecutarOperaciones(cambio, llamar, progreso);
  assert.deepEqual(r.map(x => x.status), ['updated', 'removed']);
  const fin = await leer(store, ventaId);
  assert.deepEqual([fin.nota, fin.abonos.length], ['x', 0]);
});

// Mutaciones que la revisión vio sobrevivir.
test('cambiar el servicio de una línea existente toma el catálogo del servicio nuevo', async () => {
  const store = seeded();
  const { ventaId, ops } = F.operacionesNuevaVenta(ventaPantalla(), cliPantalla, null, nuevoId);
  await ejecutar(store, ops);
  const v = await leer(store, ventaId);
  await ejecutar(store, F.operacionesCambio(v, { items: [{ ...v.items[0], tipoId: 'SRV-DEMO-REEL', precio: 1500 }] }, nuevoId));
  const doc = await store.get(COLLECTIONS.sales, ventaId);
  const reel = fx.services.find(s => s.id === 'SRV-DEMO-REEL');
  assert.deepEqual([doc.lines[0].serviceId, doc.lines[0].snapshot.nombre, doc.lines[0].executionTemplateVersion], [reel.id, reel.nombre, reel.executionPlan ? reel.executionPlan.version : null]);
});

test('anular un cobro dos veces: la segunda es «existing» y la versión sube una sola vez', async () => {
  const store = seeded();
  const { ventaId, ops } = F.operacionesNuevaVenta(ventaPantalla(), cliPantalla, null, nuevoId);
  await ejecutar(store, ops);
  const v0 = (await store.get(COLLECTIONS.sales, ventaId)).version;
  const a = await server.removePayment(store, U, { saleId: ventaId, abonoId: 'AB-1' }, { now });
  const b = await server.removePayment(store, U, { saleId: ventaId, abonoId: 'AB-1' }, { now });
  assert.deepEqual([a.status, b.status], ['removed', 'existing']);
  assert.equal((await store.get(COLLECTIONS.sales, ventaId)).version, v0 + 1);
});

test('editar un cliente desde LOOPA no cambia el nombre de la ficha ni su fecha de alta en LOOPA', async () => {
  const store = seeded();
  const id = nuevoId();
  await server.saveClient(store, U, { client: { id, nombre: 'Original' } }, { now });
  const alta = (await store.get('frame_clients', id)).commercial.creadoEnLoopa;
  await server.saveClient(store, U, { client: { id, nombre: 'Otro nombre comercial' } }, { now: () => '2027-01-01T12:00:00.000Z' });
  const doc = await store.get('frame_clients', id);
  assert.deepEqual([doc.name, doc.commercial.nombreLoopa, doc.commercial.creadoEnLoopa], ['Original', 'Otro nombre comercial', alta]);
});
