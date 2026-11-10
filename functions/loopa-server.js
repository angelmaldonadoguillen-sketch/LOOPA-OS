'use strict';
// ─────────────────────────────────────────────────────────────────
// Fase 3, tanda 3.1 — lógica de las funciones del servidor de LOOPA.
//
// Sin dependencias de Firebase: recibe un almacén (MemoryStore en pruebas,
// FirestoreStore en el emulador o en producción) y devuelve resultados o
// lanza ServerError con un código. functions/index.js sólo envuelve esto con
// onCall / onDocumentCreated / onSchedule.
//
//   createSale / updateSale / addPayment   → sólo equipo comercial aprobado
//   onEventCreated(eventId)                → procesa el evento y su venta
//   sweep()                                → retoma eventos vencidos
//
// Mismas condiciones que las reglas en borrador (ADR-0003 §11): usuario
// aprobado en frame_users y uid en loopa_config/access.commercialUids.
// ─────────────────────────────────────────────────────────────────

const core = require('./production-plan');
const repo = require('./repositories/sales');
const { sanitizeError } = require('./production-plan/errors');
const { todayInTimeZone } = require('./production-plan/dates');

const { COLLECTIONS } = core;
const CONFIG = 'loopa_config';

class ServerError extends Error {
  // kind: el código de HttpsError ('unauthenticated', 'permission-denied',
  // 'invalid-argument', 'failed-precondition', 'not-found', 'aborted',
  // 'unavailable', 'internal'); details: { code, issues } saneado.
  constructor(kind, message, details) {
    super(message);
    this.kind = kind;
    this.details = details;
  }
}

// ── Autorización ─────────────────────────────────────────────────
async function authorizeCommercial(store, auth) {
  if (!auth || typeof auth.uid !== 'string' || !auth.uid) throw new ServerError('unauthenticated', 'Iniciá sesión para vender');
  const user = await store.get('frame_users', auth.uid);
  if (!user || user.status !== 'active') throw new ServerError('permission-denied', 'Tu cuenta no está aprobada');
  const access = await store.get(CONFIG, 'access');
  const uids = access && Array.isArray(access.commercialUids) ? access.commercialUids : [];
  if (!uids.includes(auth.uid)) throw new ServerError('permission-denied', 'Tu cuenta no está en el equipo comercial');
  return auth.uid;
}

async function productionConfig(store) {
  const cfg = await store.get(CONFIG, 'production');
  if (!cfg || typeof cfg.defaultWorkspaceId !== 'string' || !Array.isArray(cfg.allowedWorkspaceIds)) {
    throw Object.assign(new Error('Falta loopa_config/production (tableros de producción)'), { code: 'config_missing' });
  }
  return cfg;
}

// Sólo se vende a fichas de los tableros de producción habilitados. Una
// ficha que no existe y una de otro tablero dan el MISMO error: la respuesta
// no revela si un id existe en otra parte del proyecto.
async function assertSellableClient(store, clientId) {
  const cfg = await productionConfig(store);
  const c = typeof clientId === 'string' && clientId && !clientId.includes('/') ? await store.get('frame_clients', clientId) : null;
  if (!c || !cfg.allowedWorkspaceIds.includes(c.workspaceId)) {
    throw Object.assign(new Error('El cliente no existe en la ficha única'), { code: 'client_unknown' });
  }
}

// Errores del dominio → ServerError con un kind estable para la app.
const KIND = {
  contract_invalid: 'invalid-argument', invalid: 'invalid-argument', field_not_editable: 'invalid-argument',
  'sale.id': 'invalid-argument', expected_version: 'invalid-argument', use_add_payment: 'invalid-argument',
  production_invalid: 'invalid-argument',
  // Lo que el almacén rechaza (documento > 1 MB, id inválido…).
  'invalid-argument': 'invalid-argument',
  version_conflict: 'aborted', aborted: 'aborted', 'already-exists': 'aborted',
  not_found: 'not-found', client_unknown: 'failed-precondition', counter_missing: 'failed-precondition',
  config_missing: 'failed-precondition',
  invalid_transition: 'failed-precondition', sale_cancelled: 'failed-precondition',
  payment_conflict: 'failed-precondition', payment_exceeds_total: 'failed-precondition',
  // Transitorios: la app puede reintentar (crear es idempotente por UUID).
  unavailable: 'unavailable', 'deadline-exceeded': 'unavailable', 'resource-exhausted': 'unavailable',
};
function toServerError(err) {
  if (err instanceof ServerError) return err;
  const safe = sanitizeError(err);
  const kind = KIND[safe.code];
  if (!kind) return new ServerError('internal', 'Error interno del servidor', { code: 'internal' });
  return new ServerError(kind, safe.message, { code: safe.code, ...(safe.issues ? { issues: safe.issues } : {}) });
}
const asCall = (fn) => async (...args) => {
  try { return await fn(...args); } catch (err) { throw toServerError(err); }
};

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const requirePlain = (v, what) => { if (!isPlain(v)) throw new ServerError('invalid-argument', `Falta ${what}`); };
const requireId = (v, what) => { if (typeof v !== 'string' || !v || v.length > 128 || v.includes('/')) throw new ServerError('invalid-argument', `Falta ${what}`); };

// ── Ventas (onCall) ──────────────────────────────────────────────
// La respuesta no lleva el documento completo: sólo lo que la pantalla
// necesita para confirmar (número, versión, evento). El uid de quien actúa
// queda en la venta (createdBy, updatedBy, estadoLog[].by) y en el cobro
// (registradoPor): todas las escrituras son del servidor.
const createSale = asCall(async (store, auth, data, { now } = {}) => {
  const uid = await authorizeCommercial(store, auth);
  requirePlain(data, 'los datos');
  requirePlain(data.draft, 'la venta');
  if (isPlain(data.draft.client)) await assertSellableClient(store, data.draft.client.clientId);
  const r = await repo.createSale(store, data.draft, { actor: uid, ...(now ? { now } : {}) });
  return { status: r.status, saleId: r.sale.id, n: r.sale.n, version: r.sale.version, eventId: r.eventId || null };
});

const updateSale = asCall(async (store, auth, data, { now } = {}) => {
  const uid = await authorizeCommercial(store, auth);
  requirePlain(data, 'los datos');
  requireId(data.saleId, 'la venta');
  requirePlain(data.patch, 'el cambio');
  if (isPlain(data.patch.client)) await assertSellableClient(store, data.patch.client.clientId);
  const r = await repo.updateSale(store, data.saleId, data.patch, { expectedVersion: data.expectedVersion, actor: uid, ...(now ? { now } : {}) });
  return { status: r.status, saleId: data.saleId, version: r.version !== undefined ? r.version : r.sale.version, eventId: r.eventId || null };
});

const addPayment = asCall(async (store, auth, data) => {
  const uid = await authorizeCommercial(store, auth);
  requirePlain(data, 'los datos');
  requireId(data.saleId, 'la venta');
  requirePlain(data.abono, 'el cobro');
  const r = await repo.addPayment(store, data.saleId, data.abono, { actor: uid });
  return { status: r.status, saleId: data.saleId, version: r.version !== undefined ? r.version : null };
});

// ── Contexto del planificador ────────────────────────────────────
// Lo que una venta necesita para generar trabajo, leído del proyecto: los
// tableros habilitados (loopa_config/production) con sus miembros, columnas
// (config/kanban_columns) y tipos (config/project_types), y la ficha del
// cliente. "Hoy" es la fecha local de Tegucigalpa del instante `nowIso`.
async function loadContext(store, clientId, nowIso) {
  const cfg = await productionConfig(store);
  const workspaces = {};
  for (const id of cfg.allowedWorkspaceIds) {
    const ws = await store.get('frame_workspaces', id);
    if (!ws) continue;
    const w = { name: ws.name || id, memberIds: Array.isArray(ws.memberIds) ? ws.memberIds : [] };
    const cols = await store.get(`frame_workspaces/${id}/config`, 'kanban_columns');
    if (cols && Array.isArray(cols.columns)) w.statusIds = [...cols.columns.map(c => c && c.id).filter(Boolean), 'archived'];
    const types = await store.get(`frame_workspaces/${id}/config`, 'project_types');
    if (types && Array.isArray(types.types)) w.typeIds = types.types.map(t => t && t.id).filter(Boolean);
    workspaces[id] = w;
  }
  const clients = {};
  if (typeof clientId === 'string' && clientId && !clientId.includes('/')) {
    const c = await store.get('frame_clients', clientId);
    if (c) clients[clientId] = { name: c.name, workspaceId: c.workspaceId };
  }
  return {
    today: todayInTimeZone(new Date(nowIso)),
    defaultWorkspaceId: cfg.defaultWorkspaceId,
    allowedWorkspaceIds: cfg.allowedWorkspaceIds,
    workspaces,
    clients,
  };
}

const clientOfEvent = (ev) => {
  const sale = ev && ev.payload && ev.payload.sale; // contracts.createEvent: { …, sale }
  return sale && sale.client ? sale.client.clientId : null;
};

// Sin configuración no se puede planificar: el evento sigue pendiente (no se
// pierde), con el motivo a la vista en lastError, y el barrido lo retoma.
async function noteConfigMissing(store, eventId, nowIso) {
  await store.transaction(async tx => {
    const ev = await tx.get(COLLECTIONS.events, eventId);
    if (ev && ev.status === 'pending' && !(ev.lastError && ev.lastError.code === 'config_missing')) {
      tx.update(COLLECTIONS.events, eventId, { lastError: { code: 'config_missing', message: 'Falta loopa_config/production', at: nowIso } });
    }
  });
}

// Procesa UN evento con el contexto de SU venta: si se cambió el cliente, el
// evento nuevo trae el cliente nuevo (no se reutiliza el del primero).
async function processWithOwnContext(store, ev, now, workerId) {
  let context;
  try {
    context = await loadContext(store, clientOfEvent(ev), now());
  } catch (err) {
    if (err.code === 'config_missing') await noteConfigMissing(store, ev.eventId, now());
    throw err;
  }
  return core.processEvent(store, ev.eventId, { context, workerId, now });
}

// Los eventos de una venta en orden de revisión. Después de terminar un
// evento (releasedLock) los pendientes que esperaban SU candado se toman ya:
// claim() vuelve a mirar el candado, así que ignorar waitingUntil es seguro.
async function drainSale(store, saleId, now, workerId, { releasedLock = false } = {}) {
  const nowIso = now();
  const events = (await store.queryEquals(COLLECTIONS.events, 'saleId', saleId))
    .filter(e => core.isDue(e, nowIso) || (releasedLock && e.status === 'pending'))
    .sort((a, b) => a.saleRevision - b.saleRevision || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const results = [];
  for (const e of events) results.push({ eventId: e.eventId, ...(await processWithOwnContext(store, e, now, workerId)) });
  return results;
}

// ── Worker del outbox ────────────────────────────────────────────
async function onEventCreated(store, eventId, { now = () => new Date().toISOString(), workerId = 'fn-event' } = {}) {
  const ev = await store.get(COLLECTIONS.events, eventId);
  if (!ev) return { status: 'missing' };
  const first = await processWithOwnContext(store, ev, now, workerId);
  const rest = await drainSale(store, ev.saleId, now, workerId, { releasedLock: true });
  return { eventId, ...first, drained: rest.length };
}

// Barrido programado: pendientes que esperaban, fallidos cumplida la espera
// y leases vencidos. Primero las ventas con el evento más viejo, hasta
// `limit` ventas por pasada; cada evento con su propio contexto.
async function sweep(store, { now = () => new Date().toISOString(), workerId = 'fn-sweep', limit = 50 } = {}) {
  const nowIso = now();
  const due = [];
  for (const status of ['pending', 'failed', 'processing']) {
    const evs = await store.queryEquals(COLLECTIONS.events, 'status', status);
    evs.filter(e => core.isDue(e, nowIso)).forEach(e => due.push(e));
  }
  const oldest = new Map();
  due.forEach(e => { const t = e.createdAt || ''; if (!oldest.has(e.saleId) || t < oldest.get(e.saleId)) oldest.set(e.saleId, t); });
  const sales = [...oldest.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : (a[0] < b[0] ? -1 : 1))).slice(0, limit).map(([id]) => id);
  const results = [];
  for (const saleId of sales) {
    try {
      results.push({ saleId, events: await drainSale(store, saleId, now, workerId) });
    } catch (err) {
      const e = toServerError(err);
      results.push({ saleId, error: { code: (e.details && e.details.code) || e.kind, message: e.message } });
    }
  }
  return { due: due.length, sales: results };
}

module.exports = { ServerError, toServerError, authorizeCommercial, createSale, updateSale, addPayment, loadContext, onEventCreated, sweep };
