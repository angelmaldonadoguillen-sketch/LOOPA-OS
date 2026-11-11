'use strict';
// ─────────────────────────────────────────────────────────────────
// Ejecutor idempotente de eventos de integración (outbox → Producción).
//
// Habla con un "puerto" de almacenamiento cuya forma calca la API de
// Firestore Admin, para que el worker real (Fase 3) sea un adaptador fino:
//
//   store.transaction(async tx => {
//     await tx.get(col, id)            → doc | null   (todas las lecturas antes de escribir)
//     tx.create(col, id, doc)          → falla al confirmar si ya existe
//     tx.update(col, id, patch)        → falla si no existe (merge superficial)
//   })
//   await store.get(col, id)
//   await store.queryEquals(col, field, value)
//
// Garantías (cada una con prueba en integracion/test):
//   · Idempotencia: el id de cada tarjeta se deriva de su clave y se crea en
//     una transacción con precondición. Reintentar o correr dos workers no duplica.
//   · Una venta a la vez: el claim toma un lease del evento Y un candado de la
//     venta. Dos eventos de la misma venta nunca se procesan en paralelo.
//   · Guardia de revisión: cada escritura relee la venta en la misma
//     transacción. Si la venta avanzó de revisión o se canceló, el evento se
//     detiene como 'superseded'. Así ninguna creación "llega tarde" después
//     de una cancelación o de una edición.
//   · Fallo parcial: el evento queda 'failed' con error saneado y espera
//     (backoff). El reintento recalcula el mismo plan y completa lo que falta.
//     Tras maxAttempts queda 'dead' y requiere acción humana.
//   · Nunca borra tarjetas. Nunca pisa una tarjeta con trabajo iniciado.
// ─────────────────────────────────────────────────────────────────

const crypto = require('node:crypto');
const { validateEvent } = require('./contracts');
const { planSale, diffPlan, taskContent, isPristine, workItemsOf, isFichaTask } = require('./planner');
const { hasErrors, sanitizeError, sanitizeText, errorsOnly } = require('./errors');

const COLLECTIONS = Object.freeze({
  events: 'loopa_integration_events',
  sales: 'loopa_sales',
  tasks: 'frame_projects',
});

const DEFAULTS = Object.freeze({
  leaseMs: 2 * 60 * 1000,
  maxAttempts: 5,
  // Espera antes del intento n+1 (el último valor se repite).
  backoffMs: [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000],
});

const TERMINAL = new Set(['done', 'rejected', 'superseded', 'dead']);
// Esperan a una persona: reprocesarlos solos no cambia nada y gastaría
// intentos hasta 'dead', borrando la diferencia que hay que revisar. Lo que
// los destraba es un evento nuevo (edición o resync explícito) o force.
const AWAITING_HUMAN = new Set(['needs_attention']);

const addMs = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const backoffFor = (attempts, list) => list[Math.min(Math.max(attempts - 1, 0), list.length - 1)];

// La venta dejó atrás a este evento: cambió de revisión o se canceló.
const supersedes = (sale, event) => !!sale && (
  (Number.isInteger(sale.revision) && sale.revision > event.saleRevision)
  || (sale.status === 'cancelled' && event.type !== 'sale.cancelled')
);

// operations siempre se escribe completo: ningún campo de un estado anterior
// queda colgado (pendingDiff de un resync viejo, lastError ya resuelto…).
const operationsDoc = ({ status, taskIds = [], lastEventId, lastSuccessAt = null, lastError = null, pendingDiff = null }, nowIso) => ({
  status, taskIds, lastEventId, lastSuccessAt, lastError, pendingDiff, updatedAt: nowIso,
});

const summarizeIssues = (issues) => errorsOnly(issues).slice(0, 20)
  .map(i => ({ code: i.code, path: sanitizeText(i.path), message: sanitizeText(i.message) }));

// Encola un evento (lo que hará la confirmación de venta, en la misma
// transacción que guarda la venta). El mismo eventId dos veces no crea dos.
// Documento del outbox. Lo usa también el repositorio de ventas para escribir
// venta y evento en la misma transacción.
const outboxDoc = (event, nowIso) => ({
  eventId: event.eventId,
  type: event.type,
  saleId: event.saleId,
  saleRevision: event.saleRevision,
  payload: event,
  status: 'pending',
  attempts: 0,
  leaseOwner: null,
  leaseUntil: null,
  nextAttemptAt: null,
  waitingFor: null,
  waitingUntil: null,
  createdAt: nowIso,
  lastError: null,
  result: null,
});

async function enqueueEvent(store, event, nowIso) {
  return store.transaction(async tx => {
    const existing = await tx.get(COLLECTIONS.events, event.eventId);
    if (existing) return { enqueued: false, status: existing.status };
    tx.create(COLLECTIONS.events, event.eventId, outboxDoc(event, nowIso));
    return { enqueued: true, status: 'pending' };
  });
}

async function claim(store, eventId, token, nowIso, opts) {
  return store.transaction(async tx => {
    const ev = await tx.get(COLLECTIONS.events, eventId);
    if (!ev) return { outcome: 'missing' };
    const sale = await tx.get(COLLECTIONS.sales, ev.saleId);
    if (TERMINAL.has(ev.status)) return { outcome: 'already_done', status: ev.status };
    if (AWAITING_HUMAN.has(ev.status) && !opts.force) return { outcome: 'awaiting_human', status: ev.status };
    // El SDK puede re-ejecutar esta función aunque el commit anterior haya
    // entrado (respuesta perdida: DEADLINE_EXCEEDED/UNAVAILABLE). Si el lease
    // ya es nuestro, el reclamo ya ocurrió: no es "busy" ni suma un intento.
    if (ev.status === 'processing' && ev.leaseOwner === token && sale && sale.lock && sale.lock.token === token) {
      return { outcome: 'claimed', doc: ev, attempts: ev.attempts || 1 };
    }
    if (ev.status === 'processing' && ev.leaseUntil && ev.leaseUntil > nowIso) return { outcome: 'busy' };
    if (ev.status === 'failed' && ev.nextAttemptAt && ev.nextAttemptAt > nowIso) return { outcome: 'backoff', nextAttemptAt: ev.nextAttemptAt };
    if (!sale) {
      tx.update(COLLECTIONS.events, eventId, { status: 'needs_attention', lastError: { code: 'sale_missing', message: 'La venta del evento no existe' } });
      return { outcome: 'needs_attention' };
    }
    if (supersedes(sale, ev)) {
      tx.update(COLLECTIONS.events, eventId, { status: 'superseded', leaseOwner: null, leaseUntil: null, finishedAt: nowIso });
      return { outcome: 'superseded' };
    }
    // Una venta a la vez: si otro evento de la misma venta tiene el candado
    // vigente, éste espera. Queda anotado cuándo vence ese candado para que
    // el barrido (dueEvents) o drainSale lo retomen.
    const lock = sale.lock;
    if (lock && lock.token !== token && lock.until > nowIso) {
      if (ev.waitingUntil !== lock.until) tx.update(COLLECTIONS.events, eventId, { waitingFor: lock.eventId, waitingUntil: lock.until });
      return { outcome: 'sale_busy', heldBy: lock.eventId };
    }
    if ((ev.attempts || 0) >= opts.maxAttempts) {
      const lastError = { code: 'dead_letter', message: `Sin éxito después de ${ev.attempts} intentos; requiere revisión` };
      tx.update(COLLECTIONS.events, eventId, { status: 'dead', lastError, leaseOwner: null, leaseUntil: null, finishedAt: nowIso });
      tx.update(COLLECTIONS.sales, ev.saleId, { operations: operationsDoc({ status: 'attention', taskIds: (sale.operations && sale.operations.taskIds) || [], lastEventId: eventId, lastError }, nowIso) });
      return { outcome: 'dead' };
    }
    const leaseUntil = addMs(nowIso, opts.leaseMs);
    tx.update(COLLECTIONS.events, eventId, {
      status: 'processing', leaseOwner: token, leaseUntil, attempts: (ev.attempts || 0) + 1, lastAttemptAt: nowIso, nextAttemptAt: null,
      waitingFor: null, waitingUntil: null,
    });
    tx.update(COLLECTIONS.sales, ev.saleId, { lock: { eventId, token, until: leaseUntil } });
    return { outcome: 'claimed', doc: ev, attempts: (ev.attempts || 0) + 1 };
  });
}

// Cierra el evento sólo si seguimos siendo dueños del lease. El estado de la
// venta se escribe sólo si este evento sigue siendo el vigente.
async function finish(store, event, token, nowIso, eventPatch, operations) {
  return store.transaction(async tx => {
    const ev = await tx.get(COLLECTIONS.events, event.eventId);
    const sale = await tx.get(COLLECTIONS.sales, event.saleId);
    if (!ev || ev.leaseOwner !== token) return { owned: false };
    tx.update(COLLECTIONS.events, event.eventId, { ...eventPatch, leaseOwner: null, leaseUntil: null, finishedAt: nowIso });
    if (sale) {
      const patch = {};
      const holdsLock = !!sale.lock && sale.lock.token === token;
      if (holdsLock) patch.lock = null;
      // Si el candado venció y otro evento lo tomó, ese evento es el que
      // informa el estado de la venta: éste no lo pisa.
      if (operations && holdsLock && !supersedes(sale, event)) patch.operations = operationsDoc(operations, nowIso);
      if (Object.keys(patch).length) tx.update(COLLECTIONS.sales, event.saleId, patch);
    }
    return { owned: true };
  });
}

// Toda escritura sobre tarjetas pasa por acá: relee la venta en la misma
// transacción y se niega si el evento quedó atrás.
async function guarded(store, event, taskId, fn) {
  return store.transaction(async tx => {
    const sale = await tx.get(COLLECTIONS.sales, event.saleId);
    const current = await tx.get(COLLECTIONS.tasks, taskId);
    if (supersedes(sale, event)) return 'superseded';
    return fn(tx, current);
  });
}

const createTask = (store, event, task) => guarded(store, event, task.id, (tx, current) => {
  if (current) return current.idempotencyKey === task.idempotencyKey ? 'existing' : 'foreign';
  tx.create(COLLECTIONS.tasks, task.id, task);
  return 'created';
});

// Actualiza el contenido generado de una tarjeta intacta. Vuelve a verificar
// todo dentro de la transacción: si alguien la tocó, o si la actualización le
// quitaría unidades de trabajo, no se toca.
const updatePristineTask = (store, event, planned) => guarded(store, event, planned.id, (tx, current) => {
  if (!current || current.idempotencyKey !== planned.idempotencyKey || !isPristine(current)) return 'conflict';
  const keep = new Set(workItemsOf(planned));
  if (!workItemsOf(current).every(k => keep.has(k))) return 'conflict';
  tx.update(COLLECTIONS.tasks, planned.id, {
    ...taskContent(planned),
    sourceEventId: planned.sourceEventId,
    sourceSaleStatus: planned.sourceSaleStatus,
    sourceLineIds: planned.sourceLineIds,
    sourceTemplateVersions: planned.sourceTemplateVersions,
    sourceWorkItems: planned.sourceWorkItems,
    integration: planned.integration,
  });
  return 'updated';
});

// Producto con ficha: la venta movió su inicio. Sólo cambian las fechas (y la
// huella del plan aplicado); estado, checklist, responsables, comentarios y
// todo el trabajo hecho quedan como están. Se reverifica en la transacción
// que siga siendo la misma entrega (mismas unidades de trabajo).
const rescheduleTask = (store, event, planned) => guarded(store, event, planned.id, (tx, current) => {
  if (!current || current.idempotencyKey !== planned.idempotencyKey || !isFichaTask(current)) return 'conflict';
  const a = workItemsOf(current).slice().sort().join('|');
  if (a !== workItemsOf(planned).slice().sort().join('|')) return 'conflict';
  const patch = {
    sessionDate: planned.sessionDate, deadline: planned.deadline, startDate: planned.startDate,
    sourceWorkItems: planned.sourceWorkItems, sourceEventId: planned.sourceEventId, sourceSaleStatus: planned.sourceSaleStatus,
    integration: { ...(current.integration || {}), generatedFingerprint: planned.integration.generatedFingerprint },
  };
  tx.update(COLLECTIONS.tasks, planned.id, patch);
  return 'rescheduled';
});

// Sólo el vínculo con la venta: nunca estado, fechas ni checklist.
const setSaleStatus = (store, event, taskId, status) => guarded(store, event, taskId, (tx, current) => {
  if (!current) return 'missing';
  if (current.sourceSaleStatus === status) return 'same';
  tx.update(COLLECTIONS.tasks, taskId, { sourceSaleStatus: status });
  return 'flagged';
});

/**
 * Procesa un evento ya encolado.
 * @param {object} opts { context, workerId, now, leaseMs, maxAttempts, backoffMs, hooks }
 */
async function processEvent(store, eventId, opts) {
  const { context, workerId = 'worker', now = () => new Date().toISOString(), hooks = {} } = opts;
  const cfg = { ...DEFAULTS, ...Object.fromEntries(['leaseMs', 'maxAttempts', 'backoffMs', 'force'].filter(k => opts[k] !== undefined).map(k => [k, opts[k]])) };
  // Un token por invocación: dos ejecuciones con el mismo workerId tampoco
  // comparten lease.
  const token = `${workerId}:${crypto.randomUUID()}`;
  const claimed = await claim(store, eventId, token, now(), cfg);
  if (claimed.outcome !== 'claimed') return { status: claimed.outcome };

  const event = claimed.doc.payload;
  const eventIssues = validateEvent(event);
  if (hasErrors(eventIssues)) {
    const issues = summarizeIssues(eventIssues);
    const safeEvent = { eventId, saleId: claimed.doc.saleId, saleRevision: claimed.doc.saleRevision, type: claimed.doc.type };
    await finish(store, safeEvent, token, now(), { status: 'rejected', lastError: { code: 'event_invalid', issues } }, null);
    return { status: 'rejected', issues };
  }

  const stop = async () => {
    await finish(store, event, token, now(), { status: 'superseded', lastError: null }, null);
    return { status: 'superseded' };
  };

  let linkedIds = [];
  try {
    const existing = await store.queryEquals(COLLECTIONS.tasks, 'sourceSaleId', event.saleId);
    linkedIds = existing.map(t => t.id).sort();

    if (event.type === 'sale.cancelled') {
      // Cancelar nunca borra ni cambia el trabajo: sólo marca el vínculo.
      // Archivar o cancelar tarjetas es una acción explícita y auditable aparte.
      for (const task of existing) {
        if ((await setSaleStatus(store, event, task.id, 'cancelled')) === 'superseded') return stop();
      }
      const fin = await finish(store, event, token, now(),
        { status: 'done', lastError: null, result: { action: 'cancel_flagged', taskIds: linkedIds } },
        { status: 'cancelled_review', taskIds: linkedIds, lastEventId: eventId });
      return { status: fin.owned ? 'done' : 'lease_lost', flagged: linkedIds };
    }

    const plan = planSale(event.sale, context, { eventId });
    if (plan.status === 'blocked') {
      const lastError = { code: 'plan_blocked', issues: summarizeIssues(plan.issues) };
      const fin = await finish(store, event, token, now(), { status: 'needs_attention', lastError, result: null },
        { status: 'attention', taskIds: linkedIds, lastEventId: eventId, lastError });
      return { status: fin.owned ? 'needs_attention' : 'lease_lost', issues: lastError.issues };
    }

    const diff = diffPlan(plan.tasks, existing);
    const plannedById = new Map(plan.tasks.map(t => [t.id, t]));
    const existingById = new Map(existing.map(t => [t.id, t]));
    // Una entrega de producto con ficha que sólo cambió de fecha (se movió el
    // inicio) se reprograma sola, aunque ya tenga trabajo: mover una fecha no
    // pisa nada. Cualquier otro cambio sigue esperando decisión humana.
    diff.entries = diff.entries.map(e => {
      if (!['update_pristine', 'conflict_started'].includes(e.action)) return e;
      const p = plannedById.get(e.taskId), x = existingById.get(e.taskId);
      const mismas = p && x && isFichaTask(p) && isFichaTask(x)
        && workItemsOf(p).slice().sort().join('|') === workItemsOf(x).slice().sort().join('|');
      return mismas ? { ...e, action: 'reschedule' } : e;
    });

    // Editar una venta ya procesada sólo escribe si es inocuo: crear lo que
    // falta sin tocar nada existente. Cualquier otro cambio espera una
    // resincronización explícita.
    if (event.type === 'sale.updated' && existing.length > 0) {
      const blocking = diff.entries.filter(e => !['unchanged', 'edited_same_plan', 'create', 'reschedule'].includes(e.action));
      if (blocking.length) {
        const lastError = { code: 'resync_required', message: 'La venta cambió después de generar producción' };
        const fin = await finish(store, event, token, now(), { status: 'needs_attention', lastError, result: { diff: diff.counts } },
          { status: 'resync_required', taskIds: linkedIds, lastEventId: eventId, lastError, pendingDiff: diff.counts });
        return { status: fin.owned ? 'needs_attention' : 'lease_lost', diff };
      }
    }

    const created = [];
    const kept = [];
    const updated = [];
    const conflicts = [];
    const rescheduled = [];
    for (const entry of diff.entries) {
      let result;
      if (entry.action === 'reschedule') {
        result = await rescheduleTask(store, event, plannedById.get(entry.taskId));
        if (result === 'rescheduled') rescheduled.push(entry.taskId);
        else if (result === 'conflict') conflicts.push({ taskId: entry.taskId, action: 'conflict_started' });
      } else if (entry.action === 'create') {
        if (hooks.beforeCreate) await hooks.beforeCreate(entry.taskId);
        result = await createTask(store, event, plannedById.get(entry.taskId));
        if (result === 'created') created.push(entry.taskId);
        else if (result === 'existing') kept.push(entry.taskId);
        else if (result === 'foreign') conflicts.push({ taskId: entry.taskId, action: 'foreign' });
      } else if (entry.action === 'unchanged' || entry.action === 'edited_same_plan') {
        kept.push(entry.taskId);
        // Una venta re-confirmada después de cancelarse limpia la marca.
        const prior = existingById.get(entry.taskId);
        if (prior && prior.sourceSaleStatus !== event.sale.status) result = await setSaleStatus(store, event, entry.taskId, event.sale.status);
      } else if (entry.action === 'update_pristine' && event.type === 'sale.resync_requested') {
        // FRAME guarda los comentarios nuevos en una subcolección: si hay
        // alguno, la tarjeta ya tiene trabajo y no se reescribe.
        const commented = await store.hasDocuments(`${COLLECTIONS.tasks}/${entry.taskId}/comments`);
        result = commented ? 'conflict' : await updatePristineTask(store, event, plannedById.get(entry.taskId));
        if (result === 'updated') updated.push(entry.taskId);
        else if (result === 'conflict') conflicts.push({ taskId: entry.taskId, action: 'conflict_started' });
      } else {
        conflicts.push(entry);
      }
      if (result === 'superseded') return stop();
    }

    const taskIds = [...new Set([...plan.tasks.map(t => t.id), ...linkedIds])]
      .filter(id => !conflicts.some(c => c.action === 'foreign' && c.taskId === id)).sort();
    const status = conflicts.length ? 'needs_attention' : 'done';
    const lastError = conflicts.length ? { code: 'conflicts', message: `${conflicts.length} tarjeta(s) requieren revisión` } : null;
    const fin = await finish(store, event, token, now(),
      { status, lastError, result: { created: created.length, kept: kept.length, updated: updated.length, rescheduled: rescheduled.length, conflicts } },
      { status: conflicts.length ? 'attention' : 'ready', taskIds, lastEventId: eventId, lastSuccessAt: conflicts.length ? null : now(), lastError });
    return { status: fin.owned ? status : 'lease_lost', created, existing: kept, updated, rescheduled, conflicts, plan };
  } catch (err) {
    const safe = sanitizeError(err);
    const nextAttemptAt = addMs(now(), backoffFor(claimed.attempts, cfg.backoffMs));
    await finish(store, event, token, now(), { status: 'failed', lastError: safe, nextAttemptAt },
      { status: 'attention', taskIds: linkedIds, lastEventId: eventId, lastError: safe });
    return { status: 'failed', error: safe, nextAttemptAt };
  }
}

// Procesa en orden de revisión todos los eventos pendientes de una venta.
// Lo llama el worker al terminar un evento (para no dejar esperando a los que
// recibieron 'sale_busy') y el barrido programado.
async function drainSale(store, saleId, opts) {
  const now = opts.now || (() => new Date().toISOString());
  const events = (await store.queryEquals(COLLECTIONS.events, 'saleId', saleId))
    .filter(e => isDue(e, now()))
    .sort((a, b) => a.saleRevision - b.saleRevision || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const results = [];
  for (const e of events) results.push({ eventId: e.eventId, ...(await processEvent(store, e.eventId, opts)) });
  return results;
}

// ¿Le toca a este evento? Es la condición del barrido programado (Fase 3):
// pendientes, fallidos cumplida la espera y leases vencidos.
function isDue(ev, nowIso) {
  if (ev.status === 'pending') return !ev.waitingUntil || ev.waitingUntil <= nowIso;
  if (ev.status === 'failed') return !ev.nextAttemptAt || ev.nextAttemptAt <= nowIso;
  if (ev.status === 'processing') return !!ev.leaseUntil && ev.leaseUntil <= nowIso;
  return false;
}

module.exports = { COLLECTIONS, DEFAULTS, outboxDoc, enqueueEvent, processEvent, drainSale, isDue };
