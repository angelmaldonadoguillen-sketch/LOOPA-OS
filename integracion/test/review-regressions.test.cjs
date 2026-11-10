'use strict';
// Regresiones de la revisión independiente de la Fase 0.1 (2026-11-09).
// Cada prueba reproduce un hallazgo y fija el comportamiento corregido.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../functions/production-plan');
const { MemoryStore } = require('../memory-store.cjs');
const { loadFixtures, buildSale, applyPatch } = require('../harness.cjs');

const fx = loadFixtures();
const { COLLECTIONS } = core;
const T0 = '2026-11-10T15:00:00.000Z';
const saleOf = (name) => buildSale(structuredClone(fx.scenarios.find(s => s.name === name).sale), fx.services);
const serviceById = (id) => fx.services.find(s => s.id === id);

async function emit(store, type, sale, at = T0) {
  store.merge(COLLECTIONS.sales, sale.id, { id: sale.id, n: sale.n, revision: sale.revision, status: sale.status });
  const event = core.createEvent(type, sale, at);
  await core.enqueueEvent(store, event, at);
  return event;
}
const run = (store, eventId, opts = {}) => core.processEvent(store, eventId, { context: fx.context, workerId: 'w1', now: () => T0, ...opts });
const tasksOf = (store, saleId) => store.list(COLLECTIONS.tasks).filter(t => t.sourceSaleId === saleId);
const assertEachUnitOnce = (tasks) => {
  const units = tasks.flatMap(t => t.sourceWorkItems.map(w => w.workItemKey));
  assert.equal(new Set(units).size, units.length, 'una unidad de trabajo quedó en dos tarjetas');
};

test('#1 una cancelación en plena creación no se pierde', async () => {
  const store = new MemoryStore();
  const sale = saleOf('plan-mensual');
  const confirm = await emit(store, 'sale.confirmed', sale);
  const cancelled = { ...sale, status: 'cancelled', revision: 2 };
  let cancelEvent;
  let calls = 0;
  const result = await run(store, confirm.eventId, {
    hooks: {
      beforeCreate: async () => {
        calls += 1;
        if (calls !== 2) return;
        cancelEvent = await emit(store, 'sale.cancelled', cancelled);
        const busy = await run(store, cancelEvent.eventId, { workerId: 'w2' });
        assert.equal(busy.status, 'sale_busy', 'dos eventos de la misma venta no corren en paralelo');
      },
    },
  });
  assert.equal(result.status, 'superseded', 'la confirmación se detiene al ver la cancelación');
  assert.equal(tasksOf(store, sale.id).length, 1, 'no se creó nada después de cancelar');

  const done = await run(store, cancelEvent.eventId, { workerId: 'w2' });
  assert.equal(done.status, 'done');
  const tasks = tasksOf(store, sale.id);
  assert.ok(tasks.every(t => t.sourceSaleStatus === 'cancelled'));
  const saleDoc = await store.get(COLLECTIONS.sales, sale.id);
  assert.equal(saleDoc.operations.status, 'cancelled_review');
  assert.equal(saleDoc.lock, null);
});

test('#2 revisiones fuera de orden no ponen una unidad en dos tarjetas', async () => {
  const store = new MemoryStore();
  const sale = saleOf('paquete-mismo-dia');
  const rev1 = await emit(store, 'sale.confirmed', sale);
  const rev2Sale = applyPatch({ ...sale, entrega: '2026-11-27' }, {});
  let rev2;
  const first = await run(store, rev1.eventId, {
    hooks: {
      beforeCreate: async () => {
        if (rev2) return;
        rev2 = await emit(store, 'sale.updated', rev2Sale);
        assert.equal((await run(store, rev2.eventId, { workerId: 'w2' })).status, 'sale_busy');
      },
    },
  });
  assert.equal(first.status, 'superseded');
  const second = await run(store, rev2.eventId, { workerId: 'w2' });
  assert.equal(second.status, 'done');
  const tasks = tasksOf(store, sale.id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].sessionDate, '2026-11-24');
  assertEachUnitOnce(tasks);
  assert.equal((await store.get(COLLECTIONS.sales, sale.id)).operations.lastEventId, rev2.eventId);
});

test('#3 mover sólo parte de un paquete no pierde unidades de trabajo', async () => {
  const store = new MemoryStore();
  const base = saleOf('plan-mensual');
  const reel = core.buildSaleLine(serviceById('SRV-DEMO-REEL'), { lineId: '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b', quantity: 1 });
  const sale = { ...base, entrega: '2026-11-15', lines: [...base.lines, reel] };
  await run(store, (await emit(store, 'sale.confirmed', sale)).eventId);
  const shared = tasksOf(store, sale.id).find(t => t.sessionDate === '2026-11-12');
  assert.equal(shared.sourceWorkItems.length, 2, 'sesión 1 y reel comparten el 12/11');

  const moved = applyPatch({ ...sale, entrega: '2026-11-20' }, {});
  const upd = await run(store, (await emit(store, 'sale.updated', moved)).eventId);
  assert.equal(upd.status, 'needs_attention');
  const resync = await run(store, (await emit(store, 'sale.resync_requested', moved)).eventId);
  assert.equal(resync.status, 'needs_attention');
  assert.deepEqual(resync.created, []);
  assert.deepEqual(resync.updated, []);
  const actions = resync.conflicts.map(c => c.action).sort();
  assert.deepEqual(actions, ['conflict_split', 'relocated']);
  const after = await store.get(COLLECTIONS.tasks, shared.id);
  assert.equal(after.sourceWorkItems.length, 2, 'la tarjeta compartida no perdió el reel');
  assertEachUnitOnce(tasksOf(store, sale.id));
  const relocated = resync.conflicts.find(c => c.action === 'relocated');
  assert.deepEqual(relocated.heldBy, [shared.id], 'heldBy apunta a quien realmente la tiene');
});

test('#4 una venta desmesurada se rechaza rápido y con error claro', () => {
  const plan = serviceById('SRV-DEMO-PLAN-SOCIAL');
  const lines = Array.from({ length: 50 }, (_, i) => core.buildSaleLine(plan, { lineId: `line-big-${i}`, quantity: 15 }));
  const sale = { ...saleOf('plan-mensual'), lines };
  const started = Date.now();
  const p = core.planSale(sale, fx.context);
  assert.ok(Date.now() - started < 1000, 'se decide sin expandir miles de ítems');
  assert.deepEqual(p.issues.filter(i => i.severity === 'error').map(i => i.code), ['sale.too_much_work']);

  const heavy = { ...saleOf('plan-mensual') };
  heavy.lines = heavy.lines.map(l => ({ ...l, snapshot: { ...l.snapshot, alcance: 'x'.repeat(250 * 1024) } }));
  assert.ok(core.validateSale(heavy).some(i => i.code === 'sale.too_large'));
});

test('#5 responsables o entregables cuentan como trabajo iniciado', async () => {
  const store = new MemoryStore();
  const sale = saleOf('editada-y-cancelada');
  await run(store, (await emit(store, 'sale.confirmed', sale)).eventId);
  const [task] = tasksOf(store, sale.id);
  store.seed(COLLECTIONS.tasks, task.id, { ...task, assignees: ['uid-demo-ana'] });
  const edited = applyPatch(sale, { lines: [{ lineId: sale.lines[0].lineId, quantity: 4 }] });
  await run(store, (await emit(store, 'sale.updated', edited)).eventId);
  const resync = await run(store, (await emit(store, 'sale.resync_requested', edited)).eventId);
  assert.deepEqual(resync.conflicts.map(c => c.action), ['conflict_started']);
  assert.equal((await store.get(COLLECTIONS.tasks, task.id)).checklist.length, task.checklist.length);
});

test('#6 reintentos acotados y fechas fuera de rango sin excepciones', async () => {
  const store = new MemoryStore();
  const sale = saleOf('plan-mensual');
  const event = await emit(store, 'sale.confirmed', sale);
  store.injectFault({ op: 'tx-create', collection: COLLECTIONS.tasks, times: 10 });
  const opts = { maxAttempts: 2, backoffMs: [0] };
  assert.equal((await run(store, event.eventId, opts)).status, 'failed');
  assert.equal((await run(store, event.eventId, opts)).status, 'failed');
  assert.equal((await run(store, event.eventId, opts)).status, 'dead');
  const ev = await store.get(COLLECTIONS.events, event.eventId);
  assert.equal(ev.status, 'dead');
  assert.equal((await store.get(COLLECTIONS.sales, sale.id)).operations.lastError.code, 'dead_letter');
  assert.equal((await run(store, event.eventId, opts)).status, 'already_done', 'dead es terminal');

  const far = { ...saleOf('plan-mensual'), fecha: '9999-12-30' };
  const p = core.planSale(far, fx.context);
  assert.equal(p.status, 'blocked');
  assert.ok(p.issues.some(i => i.code === 'work_item.date_out_of_range'));
});

test('#7 una edición sin conflictos completa lo que faltaba', async () => {
  const store = new MemoryStore();
  const sale = saleOf('plan-mensual');
  const confirm = await emit(store, 'sale.confirmed', sale);
  store.injectFault({ op: 'tx-create', collection: COLLECTIONS.tasks, after: 2 });
  assert.equal((await run(store, confirm.eventId)).status, 'failed');
  const edited = applyPatch(sale, {});
  const upd = await run(store, (await emit(store, 'sale.updated', edited)).eventId);
  assert.equal(upd.status, 'done');
  assert.equal(upd.created.length, 2);
  assert.equal(tasksOf(store, sale.id).length, 4);
  assert.equal((await run(store, confirm.eventId, { now: () => '2026-11-10T16:00:00.000Z' })).status, 'superseded');
});

test('#8 re-confirmar después de cancelar limpia la marca', async () => {
  const store = new MemoryStore();
  const sale = saleOf('paquete-mismo-dia');
  await run(store, (await emit(store, 'sale.confirmed', sale)).eventId);
  const cancelled = { ...sale, status: 'cancelled', revision: 2 };
  await run(store, (await emit(store, 'sale.cancelled', cancelled)).eventId);
  const again = { ...sale, status: 'confirmed', revision: 3 };
  assert.equal((await run(store, (await emit(store, 'sale.confirmed', again)).eventId)).status, 'done');
  assert.ok(tasksOf(store, sale.id).every(t => t.sourceSaleStatus === 'confirmed'));
});

test('#9 los issues persistidos también se sanean', async () => {
  const store = new MemoryStore();
  const sale = saleOf('paquete-mismo-dia');
  const line = sale.lines[1];
  const plan = structuredClone(line.executionPlan);
  plan.templates[0].title = '{juan.perez@cliente.com token=abc123}';
  sale.lines[1] = { ...line, executionPlan: plan };
  // createEvent() ya lo rechazaría; se encola a mano, como lo haría un
  // productor viejo o con errores.
  store.merge(COLLECTIONS.sales, sale.id, { id: sale.id, n: sale.n, revision: sale.revision, status: sale.status });
  const event = { schemaVersion: 1, eventId: core.ids.eventId('sale.confirmed', sale.id, 1), type: 'sale.confirmed', saleId: sale.id, saleRevision: 1, occurredAt: T0, sale };
  await core.enqueueEvent(store, event, T0);
  assert.equal((await run(store, event.eventId)).status, 'rejected');
  const ev = await store.get(COLLECTIONS.events, event.eventId);
  assert.ok(ev.lastError && ev.lastError.issues.length > 0);
  assert.doesNotMatch(JSON.stringify(ev.lastError), /cliente\.com|abc123/);
});

test('#10 dos ejecuciones con el mismo workerId no comparten lease', async () => {
  const store = new MemoryStore();
  const sale = saleOf('plan-mensual');
  const event = await emit(store, 'sale.confirmed', sale);
  const results = await Promise.all([run(store, event.eventId, { workerId: 'fn' }), run(store, event.eventId, { workerId: 'fn' })]);
  assert.deepEqual(results.map(r => r.status).sort(), ['busy', 'done']);
  assert.equal(tasksOf(store, sale.id).length, 4);
});

test('#11 claves del prototipo no se confunden con clientes', () => {
  const sale = saleOf('paquete-mismo-dia');
  sale.client = { ...sale.client, clientId: 'constructor' };
  assert.deepEqual(core.planSale(sale, fx.context).issues.filter(i => i.severity === 'error').map(i => i.code), ['client.unknown']);
});

test('#13 un tablero con más de 30 miembros se rechaza antes de escribir', () => {
  const context = structuredClone(fx.context);
  context.workspaces['ws-loopa-produccion'].memberIds = Array.from({ length: 31 }, (_, i) => `uid-${i}`);
  const p = core.planSale(saleOf('paquete-mismo-dia'), context);
  assert.equal(p.status, 'blocked');
  assert.ok(p.issues.some(i => i.code === 'task.viewer_ids'));
});

test('#14 el almacén en memoria se comporta como Firestore', async () => {
  const store = new MemoryStore();
  await assert.rejects(store.create('x', 'a', { v: undefined }), err => err.code === 'invalid-argument');
  await assert.rejects(store.transaction(async tx => {
    tx.update('x', 'a', { v: 1 });
    await tx.get('x', 'b');
  }), /lecturas antes de las escrituras/);
});

test('#15 operations no arrastra campos de estados anteriores', async () => {
  const store = new MemoryStore();
  const sale = saleOf('editada-y-cancelada');
  await run(store, (await emit(store, 'sale.confirmed', sale)).eventId);
  const edited = applyPatch(sale, { lines: [{ lineId: sale.lines[0].lineId, quantity: 4 }] });
  await run(store, (await emit(store, 'sale.updated', edited)).eventId);
  assert.ok((await store.get(COLLECTIONS.sales, sale.id)).operations.pendingDiff);
  assert.equal((await run(store, (await emit(store, 'sale.resync_requested', edited)).eventId)).status, 'done');
  const ops = (await store.get(COLLECTIONS.sales, sale.id)).operations;
  assert.equal(ops.status, 'ready');
  assert.equal(ops.pendingDiff, null);
  assert.equal(ops.lastError, null);
});

// ── Segunda ronda de revisión ─────────────────────────────────────

test('R2-N1 un evento que recibió sale_busy se retoma con drainSale', async () => {
  const store = new MemoryStore();
  const sale = saleOf('plan-mensual');
  const confirm = await emit(store, 'sale.confirmed', sale);
  let cancelEvent;
  await run(store, confirm.eventId, {
    hooks: {
      beforeCreate: async () => {
        if (cancelEvent) return;
        cancelEvent = await emit(store, 'sale.cancelled', { ...sale, status: 'cancelled', revision: 2 });
        assert.equal((await run(store, cancelEvent.eventId, { workerId: 'w2' })).status, 'sale_busy');
      },
    },
  });
  const waiting = await store.get(COLLECTIONS.events, cancelEvent.eventId);
  assert.equal(waiting.status, 'pending');
  assert.ok(waiting.waitingUntil, 'queda anotado hasta cuándo esperar');
  assert.equal(core.isDue(waiting, T0), false, 'antes de vencer el candado no le toca');
  // Al terminar el worker anterior, drainSale retoma lo pendiente en orden.
  const drained = await core.drainSale(store, sale.id, { context: fx.context, now: () => waiting.waitingUntil });
  assert.deepEqual(drained.map(r => r.status), ['done']);
  assert.equal((await store.get(COLLECTIONS.sales, sale.id)).operations.status, 'cancelled_review');
});

test('R2-N2 reprocesar un evento en revisión no lo agota ni borra la diferencia', async () => {
  const store = new MemoryStore();
  const sale = saleOf('editada-y-cancelada');
  await run(store, (await emit(store, 'sale.confirmed', sale)).eventId);
  const [task] = tasksOf(store, sale.id);
  store.seed(COLLECTIONS.tasks, task.id, { ...task, status: 'producing' });
  const edited = applyPatch(sale, { lines: [{ lineId: sale.lines[0].lineId, quantity: 4 }] });
  const upd = await emit(store, 'sale.updated', edited);
  assert.equal((await run(store, upd.eventId)).status, 'needs_attention');
  for (let i = 0; i < 7; i += 1) assert.equal((await run(store, upd.eventId)).status, 'awaiting_human');
  const ev = await store.get(COLLECTIONS.events, upd.eventId);
  assert.equal(ev.status, 'needs_attention');
  assert.equal(ev.attempts, 1);
  const ops = (await store.get(COLLECTIONS.sales, sale.id)).operations;
  assert.equal(ops.status, 'resync_required');
  assert.ok(ops.pendingDiff);
});

test('R2-N4 comentarios en la subcolección cuentan como trabajo iniciado', async () => {
  const store = new MemoryStore();
  const sale = saleOf('editada-y-cancelada');
  await run(store, (await emit(store, 'sale.confirmed', sale)).eventId);
  const [task] = tasksOf(store, sale.id);
  store.seed(`${COLLECTIONS.tasks}/${task.id}/comments`, 'c1', { id: 'c1', text: 'ojo con el audio', userId: 'uid-demo-ana' });
  assert.equal(tasksOf(store, sale.id).length, 1, 'el comentario no se cuela como tarjeta');
  const edited = applyPatch(sale, { lines: [{ lineId: sale.lines[0].lineId, quantity: 4 }] });
  await run(store, (await emit(store, 'sale.updated', edited)).eventId);
  const resync = await run(store, (await emit(store, 'sale.resync_requested', edited)).eventId);
  assert.deepEqual(resync.conflicts.map(c => c.action), ['conflict_started']);
  assert.equal((await store.get(COLLECTIONS.tasks, task.id)).checklist.length, task.checklist.length);
});

test('R2-N5/N6 sólo quien tiene el candado escribe el estado de la venta', async () => {
  const store = new MemoryStore();
  const sale = saleOf('plan-mensual');
  const confirm = await emit(store, 'sale.confirmed', sale);
  const resync = await emit(store, 'sale.resync_requested', sale);
  let other;
  // El lease del primero vence a mitad; el resync toma el candado y termina.
  const first = await run(store, confirm.eventId, {
    leaseMs: -1,
    hooks: {
      beforeCreate: async () => {
        if (other) return;
        other = await run(store, resync.eventId, { workerId: 'w2' });
      },
    },
  });
  assert.equal(other.status, 'done');
  assert.equal(first.status, 'done', 'su trabajo es válido (precondición), pero…');
  const ops = (await store.get(COLLECTIONS.sales, sale.id)).operations;
  assert.equal(ops.lastEventId, resync.eventId, '…no pisa el estado que escribió el dueño del candado');
  assert.equal(tasksOf(store, sale.id).length, 4);
});
