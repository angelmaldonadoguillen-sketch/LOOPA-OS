'use strict';
// ─────────────────────────────────────────────────────────────────
// Repositorio de ventas del modelo unificado: un documento por venta en
// loopa_sales/{id}, en lugar del arreglo único de `loopa/ventas`.
//
// Resuelve los dos riesgos de integridad del esquema viejo:
//   · Correlativo: `n` sale de loopa_counters/sales en la MISMA transacción
//     que crea la venta. Dos personas vendiendo a la vez no repiten número.
//   · Pisadas: toda edición es update/merge con concurrencia optimista
//     (`version`). Nadie reescribe el documento entero, así que operations
//     y lock (del worker) nunca se pierden.
//
// Además:
//   · `revision` sube sólo cuando cambia algo que afecta a producción
//     (estado, fechas, cliente, líneas). Cobros y notas no la tocan y no
//     disparan resincronizaciones.
//   · Cada cambio de producción escribe su evento en el outbox en la misma
//     transacción (patrón outbox): o se guardan los dos, o ninguno.
//   · El evento lleva sólo la vista de producción: los importes y cobros no
//     viajan al outbox.
// ─────────────────────────────────────────────────────────────────

const { canonicalJson, isUuid, isStableId } = require('../production-plan/ids');
const { issue, hasErrors, errorsOnly, ContractError } = require('../production-plan/errors');
const { validateSale, createEvent, SCHEMA_VERSION } = require('../production-plan/contracts');
const { isValidYmd } = require('../production-plan/dates');
const { COLLECTIONS, outboxDoc } = require('../production-plan/executor');

const COUNTERS = 'loopa_counters';
const CLIENTS = 'frame_clients';
const PRODUCTION_FIELDS = ['status', 'fecha', 'entrega', 'client', 'lines'];
const EDITABLE = new Set([...PRODUCTION_FIELDS, 'commercial']);
const DRAFT_FIELDS = ['id', 'status', 'fecha', 'entrega', 'client', 'lines', 'commercial'];
// Transiciones válidas. Volver a borrador desde confirmada o cancelada no
// existe: dejaría trabajo en Producción sin ningún evento que lo explique.
const TRANSITIONS = {
  draft: ['draft', 'confirmed', 'cancelled'],
  confirmed: ['confirmed', 'cancelled'],
  cancelled: ['cancelled', 'confirmed'],
};
const PAYMENT_TOLERANCE = 0.5;
const SERVER_ONLY = new Set(['id', 'n', 'revision', 'version', 'operations', 'lock', 'migration', 'createdAt', 'createdBy', 'updatedBy']);

const repoError = (code, message, issues) => Object.assign(new Error(message), { code, issues });

// El contador es un documento "caliente": varias ventas a la vez compiten por
// él y una transacción puede agotar sus reintentos ('aborted'). Crear una
// venta es idempotente por su id, así que reintentar es seguro. Sólo se
// reintenta la contención; cualquier otro error sube tal cual.
// La espera es TIEMPO REAL con jitter completo (0..tope, tope 25 ms · 2^i,
// máx. 2 s): Firestore bloquea el documento mientras dura la transacción, y
// reintentar al instante sólo vuelve a chocar (visto en el emulador).
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function retryOnContention(fn, attempts = 8) {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      // 'aborted' (SDK web) o 10 / 'ABORTED' (gRPC del Admin SDK).
      const contention = !!err && (err.code === 'aborted' || err.code === 10 || err.code === 'ABORTED');
      if (!contention || i >= attempts) throw err;
      await sleep(Math.floor(Math.random() * Math.min(2000, 25 * 2 ** i)));
    }
  }
}

const productionView = (doc) => ({
  schemaVersion: SCHEMA_VERSION,
  id: doc.id,
  n: doc.n,
  revision: doc.revision,
  status: doc.status,
  fecha: doc.fecha,
  entrega: doc.entrega || '',
  client: doc.client,
  // Producción no necesita importes: precio y costo no viajan al outbox.
  lines: (doc.lines || []).map(({ snapshot, ...line }) => {
    const { precio, costo, ...rest } = snapshot || {};
    return { ...line, snapshot: rest };
  }),
});

// Validación comercial completa: importes de la venta, precio y costo de cada
// línea (la vista de producción no los lleva, así que se validan acá) y, si
// se pide, los cobros.
function validateCommercial(c, { lines = [], payments = true, path = 'commercial' } = {}) {
  const out = [];
  if (!c || typeof c !== 'object') return [issue('commercial.missing', path, 'Falta el bloque comercial')];
  ['subtotal', 'descuento', 'total'].forEach(k => {
    if (typeof c[k] !== 'number' || !Number.isFinite(c[k]) || c[k] < 0) out.push(issue(`commercial.${k}`, `${path}.${k}`, `${k} debe ser un número ≥ 0`));
  });
  if (!Array.isArray(c.abonos)) out.push(issue('commercial.abonos', `${path}.abonos`, 'abonos debe ser una lista'));
  else if (payments) c.abonos.forEach((a, i) => out.push(...validatePayment(a, `${path}.abonos[${i}]`)));
  (Array.isArray(lines) ? lines : []).forEach((line, i) => {
    ['precio', 'costo'].forEach(k => {
      const v = line && line.snapshot ? line.snapshot[k] : undefined;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) out.push(issue(`line.snapshot.${k}`, `lines[${i}].snapshot.${k}`, `${k} debe ser un número ≥ 0`));
    });
  });
  return out;
}

// Problemas que una venta MIGRADA ya traía (doc.legacyIssues). Editar otra
// cosa no debe quedar bloqueado por ellos; tocar el campo afectado sí exige
// corregirlo.
const LEGACY_FIELDS = {
  'sale.entrega.before_sale': ['entrega', 'fecha'],
  'sale.entrega': ['entrega'],
  'sale.lines.empty': ['lines'],
  'line.snapshot.precio': ['lines'],
  'line.snapshot.costo': ['lines'],
  'commercial.subtotal': ['commercial.subtotal'],
  'commercial.descuento': ['commercial.descuento'],
  'commercial.total': ['commercial.total'],
};
function untouchedLegacy(problem, legacyIssues, patch) {
  if (!Array.isArray(legacyIssues) || !legacyIssues.includes(problem.code)) return false;
  const fields = LEGACY_FIELDS[problem.code] || [];
  return fields.every(f => {
    if (f.startsWith('commercial.')) return !(patch.commercial && Object.hasOwn(patch.commercial, f.slice(11)));
    return !Object.hasOwn(patch, f);
  });
}

function validatePayment(a, path = 'abono') {
  const out = [];
  if (!a || !isStableId(a.id)) out.push(issue('payment.id', `${path}.id`, 'El cobro necesita un id estable'));
  if (!a || typeof a.monto !== 'number' || !(a.monto > 0)) out.push(issue('payment.monto', `${path}.monto`, 'El monto debe ser mayor que 0'));
  if (!a || !isValidYmd(a.fecha)) out.push(issue('payment.fecha', `${path}.fecha`, 'La fecha del cobro debe ser YYYY-MM-DD'));
  return out;
}

// Qué evento corresponde a un cambio de producción.
function eventTypeFor(before, after) {
  if (after.status === 'cancelled') return before && before.status === 'cancelled' ? null : 'sale.cancelled';
  if (after.status === 'confirmed') return !before || before.status !== 'confirmed' ? 'sale.confirmed' : 'sale.updated';
  return null; // borrador: todavía no hay producción
}

/**
 * Crea una venta. `draft.id` es un UUID generado por quien vende: reintentar
 * con el mismo id devuelve la venta existente y NO consume otro número.
 */
// actor: uid de quien vende (lo pone el servidor; queda en createdBy y en
// estadoLog). Sin actor (pruebas, migración) no se agregan esos campos.
async function createSale(store, draft, { now = () => new Date().toISOString(), actor } = {}) {
  if (!draft || !isUuid(draft.id)) throw repoError('sale.id', 'La venta necesita un UUID generado al empezar a vender');
  const extra = Object.keys(draft).filter(k => !DRAFT_FIELDS.includes(k));
  if (extra.length) throw repoError('field_not_editable', `Campos no permitidos al crear: ${extra.join(', ')}`);
  const probe = { schemaVersion: SCHEMA_VERSION, ...draft, n: 1, revision: 1 };
  const problems = [...validateSale(productionView(probe)), ...validateCommercial(draft.commercial, { lines: draft.lines })];
  if (!['draft', 'confirmed'].includes(draft.status)) problems.push(issue('sale.status.create', 'status', 'Una venta nace como borrador o confirmada'));
  if (hasErrors(problems)) throw new ContractError(problems, 'Venta inválida');

  const result = await retryOnContention(() => store.transaction(async tx => {
    const counter = await tx.get(COUNTERS, 'sales');
    const existing = await tx.get(COLLECTIONS.sales, draft.id);
    const client = await tx.get(CLIENTS, draft.client.clientId);
    if (existing) return { status: 'existing', sale: existing };
    if (!client) throw repoError('client_unknown', 'El cliente no existe en la ficha única');
    if (!counter || !Number.isInteger(counter.next)) throw repoError('counter_missing', 'Falta loopa_counters/sales: correr la migración antes de vender');
    const at = now();
    const doc = {
      ...draft,
      schemaVersion: SCHEMA_VERSION,
      entrega: draft.entrega || '',
      n: counter.next,
      revision: 1,
      version: 1,
      estadoLog: [{ estado: draft.status, ts: at, ...(actor ? { by: actor } : {}) }],
      createdAt: at,
      ...(actor ? { createdBy: actor } : {}),
      operations: { status: draft.status === 'confirmed' ? 'pending' : 'not_applicable', taskIds: [], lastEventId: null, lastSuccessAt: null, lastError: null, pendingDiff: null, updatedAt: at },
      lock: null,
    };
    tx.update(COUNTERS, 'sales', { next: counter.next + 1 });
    tx.create(COLLECTIONS.sales, doc.id, doc);
    const type = eventTypeFor(null, doc);
    let eventId = null;
    if (type) {
      const event = createEvent(type, productionView(doc), at);
      tx.create(COLLECTIONS.events, event.eventId, outboxDoc(event, at));
      eventId = event.eventId;
    }
    return { status: 'created', n: doc.n, eventId, sale: doc };
  }));
  // La ficha queda marcada como referenciada por ventas: las reglas no dejan
  // borrarla (su id no puede quedar libre para otro tablero). Va en su propia
  // transacción, chica e idempotente, y NO en la del correlativo: varias
  // ventas simultáneas del mismo cliente nuevo bloqueaban dos documentos
  // calientes a la vez (visto en el emulador). Corre también cuando la venta
  // ya existía, así reintentar la misma venta completa una marca fallida.
  await markClientWithSales(store, result.sale.client.clientId);
  return result;
}

async function markClientWithSales(store, clientId) {
  await retryOnContention(() => store.transaction(async tx => {
    const client = await tx.get(CLIENTS, clientId);
    if (client && client.hasSales !== true) tx.update(CLIENTS, clientId, { hasSales: true });
  }));
}

/**
 * Edita una venta con concurrencia optimista: `expectedVersion` es la versión
 * que la persona tenía en pantalla. Si alguien guardó antes, falla con
 * 'version_conflict' en lugar de pisar.
 */
async function updateSale(store, saleId, patch, { expectedVersion, now = () => new Date().toISOString(), actor } = {}) {
  const keys = Object.keys(patch || {});
  const forbidden = keys.filter(k => SERVER_ONLY.has(k) || !EDITABLE.has(k));
  if (forbidden.length) throw repoError('field_not_editable', `Campos no editables: ${forbidden.join(', ')}`);
  if (!Number.isInteger(expectedVersion)) throw repoError('expected_version', 'Falta la versión esperada de la venta');
  if (patch.commercial && Object.hasOwn(patch.commercial, 'abonos')) throw repoError('use_add_payment', 'Los cobros se registran con addPayment, no editando la venta');

  return store.transaction(async tx => {
    const current = await tx.get(COLLECTIONS.sales, saleId);
    if (!current) throw repoError('not_found', 'La venta no existe');
    const clientChanged = !!patch.client && patch.client.clientId !== current.client.clientId;
    const newClient = clientChanged ? await tx.get(CLIENTS, patch.client.clientId) : null;
    if (current.version !== expectedVersion) throw repoError('version_conflict', 'Otra persona guardó esta venta; recargá antes de editar');
    if (clientChanged && !newClient) throw repoError('client_unknown', 'El cliente no existe en la ficha única');
    // El bloque comercial se edita por partes: lo que no viene se conserva.
    const next = { ...current, ...patch, ...(patch.commercial ? { commercial: { ...current.commercial, ...patch.commercial } } : {}) };
    if (!(TRANSITIONS[current.status] || []).includes(next.status)) {
      throw repoError('invalid_transition', `No se puede pasar de ${current.status} a ${next.status}`);
    }
    const productionChanged = PRODUCTION_FIELDS.some(k => canonicalJson(current[k]) !== canonicalJson(next[k]));
    const commercialChanged = canonicalJson(current.commercial) !== canonicalJson(next.commercial);
    if (!productionChanged && !commercialChanged) return { status: 'unchanged', sale: current };
    // Una venta cancelada sólo admite re-confirmarse: no se editan sus
    // líneas o fechas mientras siga cancelada (aunque el patch repita el estado).
    if (current.status === 'cancelled' && next.status === 'cancelled' && productionChanged) {
      throw repoError('sale_cancelled', 'Una venta cancelada se re-confirma antes de editar su producción');
    }
    if (productionChanged) next.revision = current.revision + 1;
    next.version = current.version + 1;
    // Los cobros no cambian acá (addPayment), así que no se revalidan.
    const problems = [...validateSale(productionView(next)), ...validateCommercial(next.commercial, { lines: next.lines, payments: false })]
      .filter(p => !untouchedLegacy(p, current.legacyIssues, patch));
    if (hasErrors(problems)) throw repoError('invalid', 'La venta editada no es válida', errorsOnly(problems));

    const at = now();
    const update = { version: next.version };
    keys.forEach(k => { update[k] = next[k]; });
    if (productionChanged) update.revision = next.revision;
    if (patch.status && patch.status !== current.status) update.estadoLog = [...(current.estadoLog || []), { estado: patch.status, ts: at, ...(actor ? { by: actor } : {}) }];
    if (actor) update.updatedBy = actor;
    tx.update(COLLECTIONS.sales, saleId, update);
    if (clientChanged && newClient.hasSales !== true) tx.update(CLIENTS, patch.client.clientId, { hasSales: true });

    let type = productionChanged ? eventTypeFor(current, next) : null;
    // Cancelar una venta que nunca pasó por Producción (histórica o borrador)
    // no tiene nada que avisar: no hay tarjetas que marcar.
    if (type === 'sale.cancelled' && current.operations && current.operations.status === 'not_applicable') type = null;
    let eventId = null;
    if (type) {
      let event;
      try {
        event = createEvent(type, productionView(next), at);
      } catch (err) {
        // Una venta migrada puede arrastrar problemas viejos (entrega anterior
        // a la venta, sin líneas…). Antes de mandarla a Producción hay que
        // corregirlos: se informa cuáles, no se encola un evento inválido.
        if (err && err.name === 'ContractError') throw repoError('production_invalid', 'Corregí la venta antes de enviarla a Producción', errorsOnly(err.issues));
        throw err;
      }
      tx.create(COLLECTIONS.events, event.eventId, outboxDoc(event, at));
      eventId = event.eventId;
    }
    return { status: 'updated', revision: next.revision, version: next.version, eventId };
  });
}

/**
 * Registra un cobro. Es idempotente por id del cobro y no necesita versión:
 * agregar cobros es conmutativo. No toca la revisión de producción.
 */
// actor: uid de quien cobra; queda en el cobro como registradoPor. Un
// registradoPor que mande la app se ignora (lo pone sólo el servidor) y no
// cuenta para la idempotencia: reintentar el mismo cobro sigue siendo 'existing'.
async function addPayment(store, saleId, abonoIn, { allowOverpayment = false, actor } = {}) {
  const { registradoPor: _ignorado, ...abono } = abonoIn || {};
  const problems = validatePayment(abono);
  if (hasErrors(problems)) throw new ContractError(problems, 'Cobro inválido');
  return store.transaction(async tx => {
    const current = await tx.get(COLLECTIONS.sales, saleId);
    if (!current) throw repoError('not_found', 'La venta no existe');
    if (current.status === 'cancelled') throw repoError('sale_cancelled', 'No se registran cobros en una venta cancelada');
    const abonos = current.commercial.abonos || [];
    const same = abonos.find(a => a.id === abono.id);
    if (same) {
      const { registradoPor: _quien, ...sameSinQuien } = same;
      if (canonicalJson(sameSinQuien) === canonicalJson(abono)) return { status: 'existing' };
      throw repoError('payment_conflict', 'Ya existe otro cobro con ese id');
    }
    const paid = abonos.reduce((a, x) => a + x.monto, 0) + abono.monto;
    if (!allowOverpayment && paid > current.commercial.total + PAYMENT_TOLERANCE) {
      throw repoError('payment_exceeds_total', `El cobro deja la venta pagada de más (${paid} sobre ${current.commercial.total})`);
    }
    const guardado = actor ? { ...abono, registradoPor: actor } : abono;
    tx.update(COLLECTIONS.sales, saleId, { commercial: { ...current.commercial, abonos: [...abonos, guardado] }, version: current.version + 1 });
    return { status: 'added', version: current.version + 1 };
  });
}

module.exports = { createSale, updateSale, addPayment, productionView, validateCommercial, PRODUCTION_FIELDS, COUNTERS, TRANSITIONS };
