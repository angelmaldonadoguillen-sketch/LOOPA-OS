'use strict';
// Fase 1 — repositorio de ventas: un documento por venta, correlativo
// transaccional, concurrencia optimista y outbox en la misma transacción.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const core = require('../../functions/production-plan');
const repo = require('../../functions/repositories/sales');
const { MemoryStore } = require('../memory-store.cjs');
const { loadFixtures, buildSale } = require('../harness.cjs');

const fx = loadFixtures();
const T = '2026-11-10T15:00:00.000Z';
const { COLLECTIONS } = core;

function freshStore(next = 1043) {
  const store = new MemoryStore();
  store.seed(repo.COUNTERS, 'sales', { next });
  // Fichas únicas de cliente que usan los fixtures.
  Object.entries(fx.context.clients).forEach(([id, c]) => store.seed('frame_clients', id, { id, ...c }));
  return store;
}

// Borrador de venta como lo armará Nueva venta: líneas congeladas del catálogo.
function draftOf(name, over = {}) {
  const sale = buildSale(structuredClone(fx.scenarios.find(s => s.name === name).sale), fx.services);
  const { n, revision, schemaVersion, ...rest } = sale;
  return {
    ...rest,
    id: crypto.randomUUID(),
    status: 'confirmed',
    commercial: { subtotal: 9000, descuento: 0, total: 9000, pay: 'bac', abonos: [], canal: 'WhatsApp', nota: '', contacto: { telefono: '', email: '' } },
    ...over,
  };
}
const events = (store) => store.list(COLLECTIONS.events);

test('veinte ventas simultáneas reciben correlativos únicos y consecutivos', async () => {
  const store = freshStore(1043);
  const results = await Promise.all(Array.from({ length: 20 }, () => repo.createSale(store, draftOf('plan-mensual'), { now: () => T })));
  const numbers = results.map(r => r.n).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 20 }, (_, i) => 1043 + i), 'sin huecos ni repetidos');
  assert.equal((await store.get(repo.COUNTERS, 'sales')).next, 1063);
  assert.equal(events(store).length, 20, 'cada venta confirmada encola su evento');
});

test('reintentar la misma venta no consume otro número ni duplica el evento', async () => {
  const store = freshStore();
  const draft = draftOf('plan-mensual');
  const a = await repo.createSale(store, draft, { now: () => T });
  const b = await repo.createSale(store, draft, { now: () => T });
  assert.equal(a.status, 'created');
  assert.equal(b.status, 'existing');
  assert.equal(b.sale.n, a.n);
  assert.equal((await store.get(repo.COUNTERS, 'sales')).next, a.n + 1);
  assert.equal(events(store).length, 1);
});

test('sin contador migrado no se vende (no se reinicia la numeración)', async () => {
  const store = freshStore();
  const empty = new MemoryStore();
  store.list('frame_clients').forEach(c => empty.seed('frame_clients', c.id, c));
  await assert.rejects(repo.createSale(empty, draftOf('plan-mensual')), err => err.code === 'counter_missing');
});

test('un borrador no genera producción; confirmarlo sí', async () => {
  const store = freshStore();
  const draft = draftOf('plan-mensual', { status: 'draft' });
  const created = await repo.createSale(store, draft, { now: () => T });
  assert.equal(created.eventId, null);
  const upd = await repo.updateSale(store, draft.id, { status: 'confirmed' }, { expectedVersion: 1, now: () => T });
  assert.equal(upd.revision, 2);
  assert.deepEqual(events(store).map(e => e.type), ['sale.confirmed']);
});

test('edición concurrente: el segundo en guardar recibe conflicto, no pisa', async () => {
  const store = freshStore();
  const draft = draftOf('paquete-mismo-dia');
  await repo.createSale(store, draft, { now: () => T });
  await repo.updateSale(store, draft.id, { entrega: '2026-11-22' }, { expectedVersion: 1, now: () => T });
  await assert.rejects(repo.updateSale(store, draft.id, { entrega: '2026-11-25' }, { expectedVersion: 1, now: () => T }), err => err.code === 'version_conflict');
  assert.equal((await store.get(COLLECTIONS.sales, draft.id)).entrega, '2026-11-22');
});

test('cobros y notas no tocan la revisión de producción ni disparan eventos', async () => {
  const store = freshStore();
  const draft = draftOf('paquete-mismo-dia');
  await repo.createSale(store, draft, { now: () => T });
  const pay = { id: 'AB-1', fecha: '2026-11-10', monto: 4000, metodo: 'bac' };
  assert.equal((await repo.addPayment(store, draft.id, pay)).status, 'added');
  assert.equal((await repo.addPayment(store, draft.id, pay)).status, 'existing', 'idempotente por id');
  await assert.rejects(repo.addPayment(store, draft.id, { ...pay, monto: 1 }), err => err.code === 'payment_conflict');
  const sale = await store.get(COLLECTIONS.sales, draft.id);
  await repo.updateSale(store, draft.id, { commercial: { nota: 'Factura a nombre de la empresa' } }, { expectedVersion: sale.version, now: () => T });
  const after = await store.get(COLLECTIONS.sales, draft.id);
  assert.equal(after.revision, 1);
  assert.equal(after.commercial.abonos.length, 1);
  assert.equal(events(store).length, 1, 'sólo el evento de confirmación');
});

test('cambiar líneas o fechas sube la revisión y encola sale.updated; cancelar encola sale.cancelled', async () => {
  const store = freshStore();
  const draft = draftOf('editada-y-cancelada');
  await repo.createSale(store, draft, { now: () => T });
  const lines = draft.lines.map(l => ({ ...l, quantity: 4 }));
  const upd = await repo.updateSale(store, draft.id, { lines }, { expectedVersion: 1, now: () => T });
  assert.equal(upd.revision, 2);
  const cancel = await repo.updateSale(store, draft.id, { status: 'cancelled' }, { expectedVersion: upd.version, now: () => T });
  assert.equal(cancel.revision, 3);
  assert.deepEqual(events(store).map(e => [e.type, e.saleRevision]).sort(), [['sale.cancelled', 3], ['sale.confirmed', 1], ['sale.updated', 2]]);
  await assert.rejects(repo.updateSale(store, draft.id, { lines: draft.lines }, { expectedVersion: cancel.version }), err => err.code === 'sale_cancelled');
  await assert.rejects(repo.addPayment(store, draft.id, { id: 'AB-9', fecha: '2026-11-10', monto: 10, metodo: 'bac' }), err => err.code === 'sale_cancelled');
});

test('la app no puede tocar campos del servidor ni guardar datos inválidos', async () => {
  const store = freshStore();
  const draft = draftOf('paquete-mismo-dia');
  await repo.createSale(store, draft, { now: () => T });
  for (const field of ['operations', 'lock', 'n', 'revision', 'id', 'migration', 'cualquiera']) {
    await assert.rejects(repo.updateSale(store, draft.id, { [field]: null }, { expectedVersion: 1 }), err => err.code === 'field_not_editable', field);
  }
  await assert.rejects(repo.updateSale(store, draft.id, { fecha: '2026-02-30' }, { expectedVersion: 1 }), err => err.code === 'invalid' && err.issues.some(i => i.code === 'sale.fecha'));
  await assert.rejects(repo.createSale(store, { ...draftOf('paquete-mismo-dia'), id: 'no-uuid' }), err => err.code === 'sale.id');
});

test('editar la venta no borra el estado del worker (sin set() completo)', async () => {
  const store = freshStore();
  const draft = draftOf('paquete-mismo-dia');
  const created = await repo.createSale(store, draft, { now: () => T });
  await core.processEvent(store, created.eventId, { context: fx.context, now: () => T });
  const before = await store.get(COLLECTIONS.sales, draft.id);
  assert.equal(before.operations.status, 'ready');
  await repo.addPayment(store, draft.id, { id: 'AB-2', fecha: '2026-11-11', monto: 100, metodo: 'efectivo' });
  const after = await store.get(COLLECTIONS.sales, draft.id);
  assert.deepEqual(after.operations, before.operations);
});

test('de punta a punta: vender → outbox → worker → tarjeta en Producción', async () => {
  const store = freshStore();
  const draft = draftOf('paquete-mismo-dia');
  const created = await repo.createSale(store, draft, { now: () => T });
  const outbox = await store.get(COLLECTIONS.events, created.eventId);
  assert.equal(outbox.status, 'pending');
  assert.equal(outbox.payload.sale.commercial, undefined, 'los importes no viajan al outbox');
  const result = await core.processEvent(store, created.eventId, { context: fx.context, now: () => T });
  assert.equal(result.status, 'done');
  const tasks = store.list(COLLECTIONS.tasks).filter(t => t.sourceSaleId === draft.id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].sourceSaleNumber, created.n);
  assert.equal((await store.get(COLLECTIONS.sales, draft.id)).operations.status, 'ready');

  // Editar la entrega con trabajo intacto: el resync explícito lo acomoda.
  await repo.updateSale(store, draft.id, { entrega: '2026-11-21' }, { expectedVersion: 1, now: () => T });
  const drained = await core.drainSale(store, draft.id, { context: fx.context, now: () => T });
  assert.deepEqual(drained.map(r => r.status), ['needs_attention'], 'cambio de fecha: requiere decisión (relocated)');
});
