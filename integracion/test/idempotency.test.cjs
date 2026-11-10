'use strict';
// El worker contra un almacén con semántica de Firestore: exactamente una vez,
// concurrencia, fallos parciales, edición y cancelación.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../functions/production-plan');
const { MemoryStore } = require('../memory-store.cjs');
const { loadFixtures, buildSale, applyPatch } = require('../harness.cjs');

const fx = loadFixtures();
const { COLLECTIONS } = core;
const T0 = '2026-11-10T15:00:00.000Z';
const saleOf = (name) => buildSale(structuredClone(fx.scenarios.find(s => s.name === name).sale), fx.services);

async function emit(store, type, sale, at = T0) {
  // Como la app: guarda la venta con merge (conserva operations y el candado).
  store.merge(COLLECTIONS.sales, sale.id, { id: sale.id, n: sale.n, revision: sale.revision, status: sale.status });
  const event = core.createEvent(type, sale, at);
  await core.enqueueEvent(store, event, at);
  return event;
}
const run = (store, eventId, opts = {}) => core.processEvent(store, eventId, { context: fx.context, workerId: 'w1', now: () => T0, ...opts });
const tasksOf = (store, saleId) => store.list(COLLECTIONS.tasks).filter(t => t.sourceSaleId === saleId);
const assertNoDuplicates = (tasks) => assert.equal(new Set(tasks.map(t => t.idempotencyKey)).size, tasks.length, 'claves de idempotencia repetidas');

test('una venta confirmada genera trabajo exactamente una vez', async () => {
  const store = new MemoryStore();
  const sale = saleOf('plan-mensual');
  const event = await emit(store, 'sale.confirmed', sale);
  const first = await run(store, event.eventId);
  assert.equal(first.status, 'done');
  assert.equal(first.created.length, 4);

  const again = await run(store, event.eventId);
  assert.equal(again.status, 'already_done');
  const reEnqueued = await core.enqueueEvent(store, core.createEvent('sale.confirmed', sale, '2026-11-10T15:30:00.000Z'), T0);
  assert.equal(reEnqueued.enqueued, false, 'el mismo evento no se encola dos veces');

  const tasks = tasksOf(store, sale.id);
  assert.equal(tasks.length, 4);
  assertNoDuplicates(tasks);
  const ops = (await store.get(COLLECTIONS.sales, sale.id)).operations;
  assert.equal(ops.status, 'ready');
  assert.deepEqual(ops.taskIds, tasks.map(t => t.id).sort());
  assert.equal(ops.lastEventId, event.eventId);
  tasks.forEach(t => assert.equal(t.sourceEventId, event.eventId));
});

test('dos ejecuciones simultáneas no duplican (lease activo)', async () => {
  const store = new MemoryStore();
  const sale = saleOf('paquete-mismo-dia');
  const event = await emit(store, 'sale.confirmed', sale);
  const results = await Promise.all([run(store, event.eventId, { workerId: 'a' }), run(store, event.eventId, { workerId: 'b' })]);
  const statuses = results.map(r => r.status).sort();
  assert.deepEqual(statuses.filter(s => s === 'done').length, 1, JSON.stringify(statuses));
  assert.ok(statuses.some(s => s === 'busy' || s === 'already_done'));
  assert.equal(tasksOf(store, sale.id).length, 1);
});

test('dos ejecuciones simultáneas no duplican aunque el lease venza a mitad', async () => {
  const store = new MemoryStore();
  const sale = saleOf('plan-trimestral');
  const event = await emit(store, 'sale.confirmed', sale);
  // leaseMs negativo: el lease nace vencido, así que ambos workers procesan
  // a la vez y compiten tarjeta por tarjeta. Sólo la precondición los frena.
  const results = await Promise.all(['a', 'b', 'c'].map(w => run(store, event.eventId, { workerId: w, leaseMs: -1 })));
  const tasks = tasksOf(store, sale.id);
  assert.equal(tasks.length, 12);
  assertNoDuplicates(tasks);
  const createdTotal = results.reduce((n, r) => n + (r.created ? r.created.length : 0), 0);
  assert.equal(createdTotal, 12, 'cada tarjeta la creó exactamente un worker');
  assert.ok(results.every(r => ['done', 'lease_lost'].includes(r.status)), JSON.stringify(results.map(r => r.status)));
  assert.equal((await store.get(COLLECTIONS.events, event.eventId)).status, 'done');
});

test('confirmación y resincronización en carrera tampoco duplican', async () => {
  const store = new MemoryStore();
  const sale = saleOf('plan-mensual');
  const confirmed = await emit(store, 'sale.confirmed', sale);
  const resync = await emit(store, 'sale.resync_requested', sale);
  await Promise.all([run(store, confirmed.eventId, { workerId: 'a' }), run(store, resync.eventId, { workerId: 'b' })]);
  const tasks = tasksOf(store, sale.id);
  assert.equal(tasks.length, 4);
  assertNoDuplicates(tasks);
});

test('un fallo parcial queda visible y el reintento completa sin duplicar', async () => {
  const store = new MemoryStore();
  const sale = saleOf('plan-mensual');
  const event = await emit(store, 'sale.confirmed', sale);
  store.injectFault({ op: 'tx-create', collection: COLLECTIONS.tasks, after: 2, message: 'Deadline exceeded hablando con ops@example.com' });

  const failed = await run(store, event.eventId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'unavailable');
  assert.doesNotMatch(JSON.stringify(failed.error), /example\.com/);
  assert.equal(tasksOf(store, sale.id).length, 2, 'quedaron 2 de 4: fallo parcial real');
  const evDoc = await store.get(COLLECTIONS.events, event.eventId);
  assert.equal(evDoc.status, 'failed', 'nunca se presenta como éxito');
  assert.equal(evDoc.leaseOwner, null);
  assert.equal((await store.get(COLLECTIONS.sales, sale.id)).operations.status, 'attention');
  assert.equal((await store.get(COLLECTIONS.sales, sale.id)).lock, null, 'el candado de la venta se libera');
  assert.equal(evDoc.nextAttemptAt, '2026-11-10T15:00:30.000Z', 'espera antes de reintentar');
  assert.equal((await run(store, event.eventId, { workerId: 'w2' })).status, 'backoff');

  const retry = await run(store, event.eventId, { workerId: 'w2', now: () => '2026-11-10T15:01:00.000Z' });
  assert.equal(retry.status, 'done');
  assert.equal(retry.created.length, 2);
  assert.equal(retry.existing.length, 2);
  const tasks = tasksOf(store, sale.id);
  assert.equal(tasks.length, 4);
  assertNoDuplicates(tasks);
  assert.equal((await store.get(COLLECTIONS.events, event.eventId)).attempts, 2);
  assert.equal((await store.get(COLLECTIONS.sales, sale.id)).operations.status, 'ready');
});

test('un id ocupado por otro documento es conflicto, nunca se sobrescribe', async () => {
  const store = new MemoryStore();
  const sale = saleOf('paquete-mismo-dia');
  const [planned] = core.planSale(sale, fx.context).tasks;
  store.seed(COLLECTIONS.tasks, planned.id, { id: planned.id, title: 'Tarjeta manual', idempotencyKey: 'otra-cosa' });
  const event = await emit(store, 'sale.confirmed', sale);
  const result = await run(store, event.eventId);
  assert.equal(result.status, 'needs_attention', 'conflicto visible, no un fallo que se reintenta para siempre');
  assert.deepEqual(result.conflicts, [{ taskId: planned.id, action: 'foreign' }]);
  assert.equal((await store.get(COLLECTIONS.tasks, planned.id)).title, 'Tarjeta manual');
  assert.equal((await store.get(COLLECTIONS.sales, sale.id)).operations.taskIds.includes(planned.id), false);
});

test('cancelar una venta no borra ni modifica el trabajo', async () => {
  const store = new MemoryStore();
  let sale = saleOf('paquete-mismo-dia');
  await run(store, (await emit(store, 'sale.confirmed', sale)).eventId);
  const before = tasksOf(store, sale.id);

  sale = { ...sale, status: 'cancelled', revision: sale.revision + 1 };
  const result = await run(store, (await emit(store, 'sale.cancelled', sale)).eventId);
  assert.equal(result.status, 'done');
  const after = tasksOf(store, sale.id);
  assert.equal(after.length, before.length);
  after.forEach((task, i) => {
    assert.equal(task.sourceSaleStatus, 'cancelled', 'el vínculo queda marcado');
    assert.deepEqual(core.taskContent(task), core.taskContent(before[i]), 'estado, fechas y checklist intactos');
  });
  assert.equal(typeof store.delete, 'undefined', 'el almacén ni siquiera ofrece borrar');
  assert.equal((await store.get(COLLECTIONS.sales, sale.id)).operations.status, 'cancelled_review');
});

test('una confirmación pendiente no genera trabajo si la venta se canceló antes', async () => {
  const store = new MemoryStore();
  const sale = saleOf('paquete-mismo-dia');
  const pending = await emit(store, 'sale.confirmed', sale);
  await emit(store, 'sale.cancelled', { ...sale, status: 'cancelled', revision: 2 });
  const result = await run(store, pending.eventId);
  assert.equal(result.status, 'superseded');
  assert.equal(tasksOf(store, sale.id).length, 0);
});

test('editar una venta aún no procesada reemplaza al evento pendiente', async () => {
  const store = new MemoryStore();
  const sale = saleOf('editada-y-cancelada');
  const pending = await emit(store, 'sale.confirmed', sale);
  const edited = applyPatch(sale, { lines: [{ lineId: sale.lines[0].lineId, quantity: 4 }] });
  const update = await emit(store, 'sale.updated', edited);
  assert.equal((await run(store, pending.eventId)).status, 'superseded');
  const result = await run(store, update.eventId);
  assert.equal(result.status, 'done');
  const [task] = tasksOf(store, sale.id);
  assert.equal(task.checklist.length, 4 * 3 + 1, 'se generó con la cantidad editada');
});

test('editar una venta procesada no pisa el trabajo; el resync sólo actualiza lo intacto', async () => {
  const store = new MemoryStore();
  const sale = saleOf('fechas-distintas');
  await run(store, (await emit(store, 'sale.confirmed', sale)).eventId);
  const original = tasksOf(store, sale.id);
  const reelLine = sale.lines.find(l => l.serviceId === 'SRV-DEMO-REEL');
  const reelTask = original.find(t => t.sourceLineIds.includes(reelLine.lineId));

  // El equipo empieza el reel; el branding sigue intacto.
  store.seed(COLLECTIONS.tasks, reelTask.id, { ...reelTask, status: 'producing', checklist: reelTask.checklist.map((c, i) => ({ ...c, done: i === 0 })) });

  // A) Mismas fechas, 1 → 2 reels: la tarjeta iniciada queda en conflicto.
  const edited = applyPatch(sale, { lines: [{ lineId: reelLine.lineId, quantity: 2 }] });
  const upd = await run(store, (await emit(store, 'sale.updated', edited)).eventId);
  assert.equal(upd.status, 'needs_attention', 'muestra la diferencia, no escribe');
  assert.deepEqual(upd.diff.counts, { unchanged: 2, conflict_started: 1 });
  assert.equal((await store.get(COLLECTIONS.tasks, reelTask.id)).checklist[0].done, true);
  assert.equal((await store.get(COLLECTIONS.sales, sale.id)).operations.status, 'resync_required');

  const resync = await run(store, (await emit(store, 'sale.resync_requested', edited)).eventId);
  assert.equal(resync.status, 'needs_attention');
  assert.deepEqual(resync.conflicts.map(c => c.taskId), [reelTask.id], 'sólo la tarjeta iniciada queda en conflicto');
  const reelAfter = await store.get(COLLECTIONS.tasks, reelTask.id);
  assert.equal(reelAfter.status, 'producing');
  assert.equal(reelAfter.checklist.length, reelTask.checklist.length, 'la tarjeta iniciada no se tocó');

  // B) Cambia la entrega. El reel (agrupado por día) "querría" otra tarjeta:
  // su unidad ya existe, así que NO se crea una segunda tarjeta con el mismo
  // trabajo; se informa como reubicación para decisión humana. La propuesta
  // de branding (estrategia separate, id independiente del día) está intacta
  // y el resync explícito la actualiza en su lugar.
  const propuesta = original.find(t => t.sourceWorkItems[0].templateId === 'propuesta');
  const moved = applyPatch({ ...edited, entrega: '2026-12-18' }, {});
  const resync2 = await run(store, (await emit(store, 'sale.resync_requested', moved)).eventId);
  assert.equal(resync2.status, 'needs_attention');
  assert.equal(resync2.created.length, 0, 'ninguna unidad de trabajo se duplica');
  assert.deepEqual(resync2.conflicts.map(c => [c.action, c.heldBy]), [['relocated', [reelTask.id]]]);
  assert.deepEqual(resync2.updated, [propuesta.id]);
  const propuestaAfter = await store.get(COLLECTIONS.tasks, propuesta.id);
  assert.equal(propuestaAfter.sessionDate, '2026-12-11');
  assert.equal(propuestaAfter.deadline, '2026-12-18', 'el compromiso cambia sólo porque la venta cambió y alguien pidió resincronizar');

  const all = tasksOf(store, sale.id);
  assert.equal(all.length, original.length);
  assertNoDuplicates(all);
  const units = all.flatMap(t => t.sourceWorkItems.map(w => w.workItemKey));
  assert.equal(new Set(units).size, units.length, 'cada unidad de trabajo vive en una sola tarjeta');
  assert.ok(original.every(t => all.some(a => a.id === t.id)), 'ninguna tarjeta original desapareció');
});

test('resync de una venta sin cambios es inocuo y respeta reprogramaciones', async () => {
  const store = new MemoryStore();
  const sale = saleOf('plan-mensual');
  await run(store, (await emit(store, 'sale.confirmed', sale)).eventId);
  const [first] = tasksOf(store, sale.id).sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : 1));
  // FRAME reprograma (arrastre o carry-over): sólo cambia sessionDate.
  store.seed(COLLECTIONS.tasks, first.id, { ...first, sessionDate: '2026-11-14' });

  const resync = await run(store, (await emit(store, 'sale.resync_requested', sale)).eventId);
  assert.equal(resync.status, 'done');
  assert.equal(resync.created.length, 0);
  assert.equal(resync.updated.length, 0);
  const after = await store.get(COLLECTIONS.tasks, first.id);
  assert.equal(after.sessionDate, '2026-11-14', 'la reprogramación del equipo se respeta');
  assert.equal(after.deadline, first.deadline, 'la fecha límite nunca se movió');
});

test('resync explícito actualiza una tarjeta intacta cuando el plan cambió', async () => {
  const store = new MemoryStore();
  const sale = saleOf('editada-y-cancelada');
  await run(store, (await emit(store, 'sale.confirmed', sale)).eventId);
  const edited = applyPatch(sale, { lines: [{ lineId: sale.lines[0].lineId, quantity: 4 }] });
  assert.equal((await run(store, (await emit(store, 'sale.updated', edited)).eventId)).status, 'needs_attention');
  const resync = await run(store, (await emit(store, 'sale.resync_requested', edited)).eventId);
  assert.equal(resync.status, 'done');
  assert.equal(resync.updated.length, 1);
  const [task] = tasksOf(store, sale.id);
  assert.equal(task.checklist.length, 13);
  assert.equal(core.contentFingerprint(task), task.integration.generatedFingerprint, 'la huella se renueva');
});

test('un evento inválido se rechaza con errores legibles', async () => {
  const store = new MemoryStore();
  const sale = saleOf('paquete-mismo-dia');
  const event = await emit(store, 'sale.confirmed', sale);
  // Se corrompe el payload guardado (p. ej. escrito por una versión vieja).
  const stored = await store.get(COLLECTIONS.events, event.eventId);
  store.seed(COLLECTIONS.events, event.eventId, { ...stored, payload: { ...event, sale: { ...sale, lines: [] } } });
  const result = await run(store, event.eventId);
  assert.equal(result.status, 'rejected');
  assert.ok(result.issues.some(i => i.code === 'sale.lines.empty'));
  assert.equal(tasksOf(store, sale.id).length, 0);
});
