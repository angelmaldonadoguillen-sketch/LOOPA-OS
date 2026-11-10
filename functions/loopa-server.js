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

// ── Líneas desde el catálogo ─────────────────────────────────────
// Del navegador sólo se aceptan { lineId, serviceId, quantity, precio,
// costo }. La descripción y la PLANTILLA DE PRODUCCIÓN (executionPlan) salen
// del catálogo (loopa_services), congeladas por buildSaleLine: nadie puede
// inventar desde la consola qué tarjetas genera una venta.
// Al editar, una línea que ya existía (mismo lineId y servicio) conserva su
// snapshot y su plantilla congelada: editar el catálogo sólo afecta ventas
// futuras; de la línea cambian sólo cantidad, precio y costo.
// descripcion: el alcance acordado con el cliente para esa línea (LOOPA lo
// deja editar). Producción lo ve como alcance; la plantilla no cambia.
const LINE_INPUT = new Set(['lineId', 'serviceId', 'quantity', 'precio', 'costo', 'descripcion']);
const UNCATALOGUED = 'SRV-SIN-CATALOGO';
const finiteOr = (v, fallback) => (v === undefined ? fallback : (typeof v === 'number' && Number.isFinite(v) ? v : NaN));
// clientId: el cliente de la venta. Un servicio de acuerdo especial sólo se
// vende a SU cliente (la pantalla ya lo filtra; el servidor lo exige).
async function linesFromCatalog(store, input, currentLines = [], clientId = null) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 50) throw new ServerError('invalid-argument', 'La venta necesita entre 1 y 50 líneas');
  const current = new Map((currentLines || []).map(l => [l.lineId, l]));
  const out = [];
  for (const l of input) {
    if (!isPlain(l) || Object.keys(l).some(k => !LINE_INPUT.has(k))) throw new ServerError('invalid-argument', 'Línea con campos no permitidos');
    requireId(l.lineId, 'el id de la línea');
    requireId(l.serviceId, 'el servicio de la línea');
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 1000) throw new ServerError('invalid-argument', 'La cantidad debe ser un entero entre 1 y 1000');
    if (l.descripcion !== undefined && typeof l.descripcion !== 'string') throw new ServerError('invalid-argument', 'Descripción inválida');
    const alcance = l.descripcion === undefined ? undefined : l.descripcion.trim().slice(0, 2000);
    const prev = current.get(l.lineId);
    if (prev && prev.serviceId === l.serviceId) {
      out.push({ ...prev, quantity: l.quantity, snapshot: { ...prev.snapshot, precio: finiteOr(l.precio, prev.snapshot.precio), costo: finiteOr(l.costo, prev.snapshot.costo), ...(alcance !== undefined ? { alcance } : {}) } });
      continue;
    }
    const svc = await store.get('loopa_services', l.serviceId);
    if (!svc || svc.activo === false || l.serviceId === UNCATALOGUED) throw Object.assign(new Error('El servicio no existe o está archivado'), { code: 'service_unknown' });
    if (svc.modelo === 'especial' && svc.specialClientId !== clientId) throw Object.assign(new Error('Ese acuerdo especial es de otro cliente'), { code: 'service_not_for_client' });
    const line = core.buildSaleLine(svc, { lineId: l.lineId, quantity: l.quantity, precio: finiteOr(l.precio, undefined), costo: finiteOr(l.costo, undefined) });
    out.push(alcance !== undefined ? { ...line, snapshot: { ...line.snapshot, alcance } } : line);
  }
  return out;
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
  service_unknown: 'failed-precondition', service_not_for_client: 'failed-precondition',
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

// El salto de versión que hizo la operación (también al reconocer un opId
// repetido): la app lo usa para encadenar sus cambios pendientes.
const saltoDe = (r) => {
  const to = r.to !== undefined ? r.to : r.version;
  return Number.isInteger(r.from) && Number.isInteger(to) ? { from: r.from, to } : {};
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
  const clientId = isPlain(data.draft.client) ? data.draft.client.clientId : null;
  const draft = { ...data.draft, lines: await linesFromCatalog(store, data.draft.lines, [], clientId) };
  const r = await repo.createSale(store, draft, { actor: uid, ...(now ? { now } : {}) });
  return { status: r.status, saleId: r.sale.id, n: r.sale.n, version: r.sale.version, eventId: r.eventId || null };
});

const updateSale = asCall(async (store, auth, data, { now } = {}) => {
  const uid = await authorizeCommercial(store, auth);
  requirePlain(data, 'los datos');
  requireId(data.saleId, 'la venta');
  requirePlain(data.patch, 'el cambio');
  if (isPlain(data.patch.client)) await assertSellableClient(store, data.patch.client.clientId);
  let patch = data.patch;
  if (Object.prototype.hasOwnProperty.call(patch, 'lines')) {
    // Lectura fuera de la transacción: si la venta cambió entre medio,
    // expectedVersion lo detecta y la edición falla con version_conflict.
    const current = await store.get(COLLECTIONS.sales, data.saleId);
    const clientId = isPlain(patch.client) ? patch.client.clientId : (current && current.client ? current.client.clientId : null);
    patch = { ...patch, lines: await linesFromCatalog(store, patch.lines, current ? current.lines : [], clientId) };
  }
  const r = await repo.updateSale(store, data.saleId, patch, { expectedVersion: data.expectedVersion, actor: uid, opId: data.opId, ...(now ? { now } : {}) });
  return { status: r.status, saleId: data.saleId, version: r.version !== undefined ? r.version : r.sale.version, ...saltoDe(r), eventId: r.eventId || null };
});

const addPayment = asCall(async (store, auth, data) => {
  const uid = await authorizeCommercial(store, auth);
  requirePlain(data, 'los datos');
  requireId(data.saleId, 'la venta');
  requirePlain(data.abono, 'el cobro');
  const r = await repo.addPayment(store, data.saleId, data.abono, { actor: uid, opId: data.opId });
  return { status: r.status, saleId: data.saleId, version: r.version !== undefined ? r.version : null, ...saltoDe(r) };
});

const removePayment = asCall(async (store, auth, data, { now } = {}) => {
  const uid = await authorizeCommercial(store, auth);
  requirePlain(data, 'los datos');
  requireId(data.saleId, 'la venta');
  requireId(data.abonoId, 'el cobro');
  const r = await repo.removePayment(store, data.saleId, data.abonoId, { actor: uid, motivo: typeof data.motivo === 'string' ? data.motivo : '', opId: data.opId, ...(now ? { now } : {}) });
  return { status: r.status, saleId: data.saleId, version: r.version, ...saltoDe(r) };
});

// ── Fichas de cliente desde LOOPA (onCall) ───────────────────────
// Los datos comerciales (teléfono, email, canal, notas) los escribe sólo el
// servidor (reglas: «commercial» es del servidor). Alta: una ficha nueva en
// el tablero de producción por defecto, con id que genera el navegador al
// empezar a vender (UUID): repetir la llamada no duplica. Edición: sólo de
// fichas de los tableros habilitados, y sólo su parte comercial (el nombre
// y la configuración de FRAME de la ficha no se tocan desde LOOPA).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const texto = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const COMMERCIAL_FIELDS = [['nombre', 'nombreLoopa', 200], ['empresa', 'empresa', 200], ['telefono', 'telefono', 40], ['email', 'email', 120], ['canal', 'canal', 60], ['notas', 'notas', 2000]];
const commercialFrom = (c) => Object.fromEntries(COMMERCIAL_FIELDS.map(([from, to, max]) => [to, texto(c[from], max)]));
// Al editar, sólo cambian los campos que vienen (vender sin cargar el email
// no borra el que la ficha ya tenía).
const commercialPatch = (c) => Object.fromEntries(COMMERCIAL_FIELDS.filter(([from]) => Object.prototype.hasOwnProperty.call(c, from)).map(([from, to, max]) => [to, texto(c[from], max)]));
const initialsOf = (name) => (String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase().slice(0, 4);

const saveClient = asCall(async (store, auth, data, { now = () => new Date().toISOString() } = {}) => {
  const uid = await authorizeCommercial(store, auth);
  requirePlain(data, 'los datos');
  requirePlain(data.client, 'el cliente');
  const c = data.client;
  requireId(c.id, 'el id del cliente');
  if (!texto(c.nombre)) throw new ServerError('invalid-argument', 'El cliente necesita nombre');
  const cfg = await productionConfig(store);
  return store.transaction(async tx => {
    const existing = await tx.get('frame_clients', c.id);
    const unknown = () => Object.assign(new Error('El cliente no existe en la ficha única'), { code: 'client_unknown' });
    if (existing) {
      if (!cfg.allowedWorkspaceIds.includes(existing.workspaceId)) throw unknown();
      const commercial = { ...(existing.commercial || {}), ...commercialPatch(c), creadoEnLoopa: (existing.commercial && existing.commercial.creadoEnLoopa) || '' };
      tx.update('frame_clients', c.id, { commercial, updatedBy: uid });
      return { status: 'updated', clientId: c.id };
    }
    // Sólo el alta exige UUID (los ids viejos ya existen). Un id viejo que no
    // existe da el mismo error que uno ajeno: no revela qué ids hay.
    if (!UUID.test(c.id)) throw unknown();
    const at = now();
    tx.create('frame_clients', c.id, {
      id: c.id, name: texto(c.nombre), workspaceId: cfg.defaultWorkspaceId,
      industry: 'Sin categoría', color: 'var(--resource-neutral)', initials: initialsOf(c.nombre),
      contact: { name: '—', email: texto(c.email, 120) || '—', phone: texto(c.telefono, 40) || '—' },
      tags: [], notes: '', portalToken: '', portalPublished: false,
      commercial: { ...commercialFrom(c), creadoEnLoopa: at.slice(0, 10) },
      createdBy: uid, createdAt: at,
    });
    return { status: 'created', clientId: c.id };
  });
});

// ── Catálogo desde LOOPA (onCall) ────────────────────────────────
// El equipo comercial edita la parte COMERCIAL del servicio. La plantilla de
// producción (executionPlan) no viaja desde LOOPA: se conserva la que tenga
// el servicio (la administra producción; editarla sólo afecta ventas
// futuras, porque cada venta la congela al venderse).
const SERVICE_MODELS = ['plan', 'unitario', 'proyecto', 'especial'];
const saveService = asCall(async (store, auth, data, { now = () => new Date().toISOString() } = {}) => {
  const uid = await authorizeCommercial(store, auth);
  requirePlain(data, 'los datos');
  requirePlain(data.service, 'el servicio');
  const s = data.service;
  requireId(s.id, 'el id del servicio');
  if (!/^SRV-[A-Za-z0-9_-]{1,60}$/.test(s.id) || s.id === UNCATALOGUED) throw new ServerError('invalid-argument', 'Id de servicio inválido');
  if (!texto(s.nombre)) throw new ServerError('invalid-argument', 'El servicio necesita nombre');
  if (!SERVICE_MODELS.includes(s.modelo)) throw new ServerError('invalid-argument', 'Modelo de servicio desconocido');
  const precio = Number(s.precio), costo = Number(s.costo);
  if (!Number.isFinite(precio) || precio < 0 || !Number.isFinite(costo) || costo < 0) throw new ServerError('invalid-argument', 'Precio y costo deben ser números ≥ 0');
  let specialClientId = null;
  if (s.modelo === 'especial') {
    await assertSellableClient(store, s.specialClientId);
    specialClientId = s.specialClientId;
  }
  return store.transaction(async tx => {
    const existing = await tx.get('loopa_services', s.id);
    const commercial = {
      nombre: texto(s.nombre), categoria: texto(s.categoria, 80) || 'Otro', unidad: texto(s.unidad, 40) || 'proyecto', modelo: s.modelo,
      descripcion: texto(s.descripcion, 2000), precio, costo, activo: s.activo !== false,
      recomendado: s.modelo === 'plan' && s.recomendado === true, specialClientId,
    };
    if (existing) {
      tx.update('loopa_services', s.id, { ...commercial, updatedBy: uid });
      return { status: 'updated', serviceId: s.id };
    }
    tx.create('loopa_services', s.id, { schemaVersion: core.SCHEMA_VERSION || 1, id: s.id, ...commercial, executionPlan: null, createdAt: now(), createdBy: uid });
    return { status: 'created', serviceId: s.id };
  });
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

module.exports = { ServerError, toServerError, authorizeCommercial, createSale, updateSale, addPayment, removePayment, saveClient, saveService, loadContext, onEventCreated, sweep };
