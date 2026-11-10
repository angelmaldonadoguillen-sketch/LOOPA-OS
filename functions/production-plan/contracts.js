'use strict';
// ─────────────────────────────────────────────────────────────────
// Contratos del integrador LOOPA → FRAME (schemaVersion 1).
//
// Cada validate*() devuelve una lista de issues (ver errors.js) y nunca
// lanza por datos malos: el que llama decide si bloquear. assert*() lanza
// ContractError con todos los problemas juntos, no sólo el primero.
//
// Las formas están documentadas en integracion-loopa/ADR-0001.
// ─────────────────────────────────────────────────────────────────

const { isValidYmd, compareYmd } = require('./dates');
const { isUuid, isStableId, isTemplateId, ids } = require('./ids');
const { issue, ContractError, hasErrors } = require('./errors');

const SCHEMA_VERSION = 1;

const SALE_STATUSES = ['draft', 'confirmed', 'cancelled'];
const EVENT_TYPES = ['sale.confirmed', 'sale.updated', 'sale.cancelled', 'sale.resync_requested'];
const GROUPING_STRATEGIES = ['client_day_package', 'separate'];
const SESSION_ANCHORS = ['sale_date', 'delivery_date'];
const DEADLINE_ANCHORS = ['delivery_date', 'session_date'];
const QUANTITY_MODES = ['ignore', 'expand_checklist', 'repeat_schedule'];
const RECURRENCE_UNITS = ['day', 'week', 'month'];
const PRIORITIES = ['high', 'medium', 'low'];
const SERVICE_MODELS = ['plan', 'unitario', 'proyecto', 'especial'];
const PLACEHOLDERS = ['cliente', 'servicio', 'cantidad', 'unidad', 'ocurrencia', 'ocurrencias', 'venta', 'fecha'];

const LIMITS = Object.freeze({
  lines: 50,
  templates: 10,
  checklistPerTemplate: 30,
  occurrences: 60,
  expandedUnits: 50,
  packageChecklist: 120,
  tasksPerSale: 200,
  workItemsPerSale: 400,
  checklistItemsPerSale: 3000,
  saleBytes: 200 * 1024,
  tags: 10,
  offsetDays: 365,
  text: 200,
  label: 80,
});

const FRAME_TOKEN_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const GROUP_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v, max, min = 1) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

const placeholdersIn = (text) => [...String(text).matchAll(/\{([^{}]*)\}/g)].map(m => m[1]);
const checkPlaceholders = (text, path, out) => {
  placeholdersIn(text).forEach(name => {
    if (!PLACEHOLDERS.includes(name)) {
      out.push(issue('plan.placeholder.unknown', path, `Marcador {${name}} desconocido. Permitidos: ${PLACEHOLDERS.map(p => `{${p}}`).join(', ')}`));
    }
  });
};

// ── Plantilla operativa (executionPlan) ───────────────────────────
function validateExecutionPlan(plan, path = 'executionPlan') {
  const out = [];
  if (!isPlainObject(plan)) return [issue('plan.missing', path, 'La plantilla operativa debe ser un objeto')];
  if (plan.schemaVersion !== SCHEMA_VERSION) out.push(issue('plan.schema_version', `${path}.schemaVersion`, `Versión de esquema no soportada (se espera ${SCHEMA_VERSION})`));
  if (typeof plan.enabled !== 'boolean') out.push(issue('plan.enabled.type', `${path}.enabled`, 'enabled debe ser true o false'));
  if (!isInt(plan.version, 1, 1e6)) out.push(issue('plan.version.invalid', `${path}.version`, 'La versión debe ser un entero ≥ 1'));
  if (plan.workspaceId !== null && plan.workspaceId !== undefined && !isStableId(plan.workspaceId)) {
    out.push(issue('plan.workspace.invalid', `${path}.workspaceId`, 'workspaceId debe ser un id válido o null (usa el tablero de producción por defecto)'));
  }
  const grouping = plan.grouping;
  if (!isPlainObject(grouping) || !GROUPING_STRATEGIES.includes(grouping.strategy)) {
    out.push(issue('plan.grouping.strategy', `${path}.grouping.strategy`, `Estrategia de agrupación inválida. Permitidas: ${GROUPING_STRATEGIES.join(', ')}`));
  } else if (typeof grouping.groupKey !== 'string' || !GROUP_KEY_RE.test(grouping.groupKey)) {
    out.push(issue('plan.grouping.key', `${path}.grouping.groupKey`, 'groupKey debe ser minúsculas, números, - o _ (máx. 40)'));
  }
  if (!Array.isArray(plan.templates)) {
    out.push(issue('plan.templates.type', `${path}.templates`, 'templates debe ser una lista'));
    return out;
  }
  if (plan.enabled === true && plan.templates.length === 0) out.push(issue('plan.templates.empty', `${path}.templates`, 'Una plantilla habilitada necesita al menos un bloque de trabajo'));
  if (plan.templates.length > LIMITS.templates) out.push(issue('plan.templates.too_many', `${path}.templates`, `Máximo ${LIMITS.templates} bloques por servicio`));

  const seen = new Set();
  plan.templates.forEach((t, i) => {
    const p = `${path}.templates[${i}]`;
    if (!isPlainObject(t)) { out.push(issue('plan.template.type', p, 'Cada bloque debe ser un objeto')); return; }
    if (!isTemplateId(t.templateId)) out.push(issue('plan.template.id', `${p}.templateId`, 'templateId debe ser estable: minúsculas, números, - o _ (máx. 40)'));
    else if (seen.has(t.templateId)) out.push(issue('plan.template.duplicate', `${p}.templateId`, `templateId repetido: ${t.templateId}`));
    else seen.add(t.templateId);
    if (!isText(t.label, LIMITS.label)) out.push(issue('plan.template.label', `${p}.label`, `label es obligatorio (máx. ${LIMITS.label})`));
    if (!isText(t.title, LIMITS.text)) out.push(issue('plan.template.title', `${p}.title`, `title es obligatorio (máx. ${LIMITS.text})`));
    else checkPlaceholders(t.title, `${p}.title`, out);
    if (typeof t.type !== 'string' || !FRAME_TOKEN_RE.test(t.type)) out.push(issue('plan.template.type_id', `${p}.type`, 'type debe ser un id de tipo de FRAME'));
    if (typeof t.initialStatus !== 'string' || !FRAME_TOKEN_RE.test(t.initialStatus)) out.push(issue('plan.template.status', `${p}.initialStatus`, 'initialStatus debe ser un id de columna de FRAME'));
    if (!PRIORITIES.includes(t.priority)) out.push(issue('plan.template.priority', `${p}.priority`, `priority debe ser ${PRIORITIES.join(', ')}`));
    if (!Array.isArray(t.tags) || t.tags.length > LIMITS.tags || !t.tags.every(tag => isText(tag, 40))) {
      out.push(issue('plan.template.tags', `${p}.tags`, `tags debe ser una lista de hasta ${LIMITS.tags} textos cortos`));
    }
    if (!QUANTITY_MODES.includes(t.quantityMode)) out.push(issue('plan.template.quantity_mode', `${p}.quantityMode`, `quantityMode debe ser ${QUANTITY_MODES.join(', ')}`));

    if (!Array.isArray(t.checklist) || t.checklist.length === 0 || t.checklist.length > LIMITS.checklistPerTemplate) {
      out.push(issue('plan.checklist.size', `${p}.checklist`, `El checklist necesita entre 1 y ${LIMITS.checklistPerTemplate} entregables`));
    } else {
      const itemIds = new Set();
      t.checklist.forEach((item, j) => {
        const ip = `${p}.checklist[${j}]`;
        if (!isPlainObject(item)) { out.push(issue('plan.checklist.item', ip, 'Cada entregable debe ser un objeto')); return; }
        if (!isTemplateId(item.itemId)) out.push(issue('plan.checklist.item_id', `${ip}.itemId`, 'itemId debe ser estable: minúsculas, números, - o _'));
        else if (itemIds.has(item.itemId)) out.push(issue('plan.checklist.duplicate', `${ip}.itemId`, `itemId repetido: ${item.itemId}`));
        else itemIds.add(item.itemId);
        if (!isText(item.text, LIMITS.text)) out.push(issue('plan.checklist.text', `${ip}.text`, `text es obligatorio (máx. ${LIMITS.text})`));
        else checkPlaceholders(item.text, `${ip}.text`, out);
        if (typeof item.perUnit !== 'boolean') out.push(issue('plan.checklist.per_unit', `${ip}.perUnit`, 'perUnit debe ser true o false'));
        else if (item.perUnit && t.quantityMode !== 'expand_checklist') {
          out.push(issue('plan.checklist.per_unit_mode', `${ip}.perUnit`, 'Un entregable por unidad requiere quantityMode "expand_checklist"'));
        }
      });
    }

    const s = t.schedule;
    if (!isPlainObject(s)) out.push(issue('plan.schedule.missing', `${p}.schedule`, 'schedule es obligatorio'));
    else {
      if (!SESSION_ANCHORS.includes(s.sessionAnchor)) out.push(issue('plan.schedule.session_anchor', `${p}.schedule.sessionAnchor`, `sessionAnchor debe ser ${SESSION_ANCHORS.join(' o ')}`));
      if (!isInt(s.sessionOffsetDays, -LIMITS.offsetDays, LIMITS.offsetDays)) out.push(issue('plan.schedule.session_offset', `${p}.schedule.sessionOffsetDays`, `sessionOffsetDays debe ser entero entre ±${LIMITS.offsetDays}`));
      if (!DEADLINE_ANCHORS.includes(s.deadlineAnchor)) out.push(issue('plan.schedule.deadline_anchor', `${p}.schedule.deadlineAnchor`, `deadlineAnchor debe ser ${DEADLINE_ANCHORS.join(' o ')}`));
      if (!isInt(s.deadlineOffsetDays, -LIMITS.offsetDays, LIMITS.offsetDays)) out.push(issue('plan.schedule.deadline_offset', `${p}.schedule.deadlineOffsetDays`, `deadlineOffsetDays debe ser entero entre ±${LIMITS.offsetDays}`));
    }

    if (t.recurrence !== null) {
      const r = t.recurrence;
      if (!isPlainObject(r)) out.push(issue('plan.recurrence.type', `${p}.recurrence`, 'recurrence debe ser null o un objeto'));
      else {
        if (!RECURRENCE_UNITS.includes(r.unit)) out.push(issue('plan.recurrence.unit', `${p}.recurrence.unit`, `unit debe ser ${RECURRENCE_UNITS.join(', ')}`));
        if (!isInt(r.interval, 1, 12)) out.push(issue('plan.recurrence.interval', `${p}.recurrence.interval`, 'interval debe ser entero entre 1 y 12'));
        if (!isInt(r.count, 1, LIMITS.occurrences)) out.push(issue('plan.recurrence.count', `${p}.recurrence.count`, `count debe ser entero entre 1 y ${LIMITS.occurrences}`));
      }
    } else if (t.quantityMode === 'repeat_schedule') {
      out.push(issue('plan.recurrence.required', `${p}.recurrence`, 'quantityMode "repeat_schedule" requiere una recurrencia'));
    }
  });
  return out;
}

// ── Servicio del catálogo LOOPA ───────────────────────────────────
// La descripción comercial (nombre, alcance, precio) y la plantilla operativa
// (executionPlan) son independientes. Un servicio sin plantilla vende igual,
// pero no genera trabajo (se informa como advertencia al vender).
function validateService(service, path = 'service') {
  const out = [];
  if (!isPlainObject(service)) return [issue('service.missing', path, 'El servicio debe ser un objeto')];
  if (!isStableId(service.id)) out.push(issue('service.id', `${path}.id`, 'El servicio necesita un id estable'));
  if (!isText(service.nombre, LIMITS.text)) out.push(issue('service.nombre', `${path}.nombre`, 'El servicio necesita nombre'));
  if (!SERVICE_MODELS.includes(service.modelo)) out.push(issue('service.modelo', `${path}.modelo`, `modelo debe ser ${SERVICE_MODELS.join(', ')}`));
  if (service.executionPlan !== undefined && service.executionPlan !== null) {
    out.push(...validateExecutionPlan(service.executionPlan, `${path}.executionPlan`));
  }
  return out;
}

// ── Venta y línea de venta ────────────────────────────────────────
function validateSaleLine(line, path, seenLineIds) {
  const out = [];
  if (!isPlainObject(line)) return [issue('line.type', path, 'Cada línea debe ser un objeto')];
  if (!isUuid(line.lineId) && !isStableId(line.lineId)) out.push(issue('line.id', `${path}.lineId`, 'La línea necesita un lineId estable (UUID)'));
  else if (seenLineIds.has(line.lineId)) out.push(issue('line.id.duplicate', `${path}.lineId`, 'lineId repetido dentro de la venta'));
  else seenLineIds.add(line.lineId);
  if (!isStableId(line.serviceId)) out.push(issue('line.service_id', `${path}.serviceId`, 'La línea necesita el serviceId del catálogo'));
  if (typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity <= 0 || line.quantity > 1000) {
    out.push(issue('line.quantity', `${path}.quantity`, 'quantity debe ser un número mayor que 0 y hasta 1000'));
  }
  const snap = line.snapshot;
  if (!isPlainObject(snap)) out.push(issue('line.snapshot.missing', `${path}.snapshot`, 'La línea debe conservar un snapshot del servicio vendido'));
  else {
    if (!isText(snap.nombre, LIMITS.text)) out.push(issue('line.snapshot.nombre', `${path}.snapshot.nombre`, 'El snapshot necesita nombre'));
    if (!SERVICE_MODELS.includes(snap.modelo)) out.push(issue('line.snapshot.modelo', `${path}.snapshot.modelo`, `modelo debe ser ${SERVICE_MODELS.join(', ')}`));
    // Precio y costo son opcionales para producción (el evento del outbox no
    // los lleva); si están, deben ser válidos.
    ['precio', 'costo'].forEach(k => {
      if (snap[k] !== undefined && (typeof snap[k] !== 'number' || !Number.isFinite(snap[k]) || snap[k] < 0)) out.push(issue(`line.snapshot.${k}`, `${path}.snapshot.${k}`, `${k} debe ser un número ≥ 0`));
    });
  }
  if (line.executionPlan === null || line.executionPlan === undefined) {
    if (line.executionTemplateVersion !== null && line.executionTemplateVersion !== undefined) {
      out.push(issue('line.template_version.orphan', `${path}.executionTemplateVersion`, 'Hay versión de plantilla pero no plantilla congelada'));
    }
  } else {
    out.push(...validateExecutionPlan(line.executionPlan, `${path}.executionPlan`));
    if (line.executionTemplateVersion !== line.executionPlan.version) {
      out.push(issue('line.template_version.mismatch', `${path}.executionTemplateVersion`, 'executionTemplateVersion no coincide con la versión congelada en la línea'));
    }
  }
  return out;
}

function validateSale(sale, path = 'sale') {
  const out = [];
  if (!isPlainObject(sale)) return [issue('sale.missing', path, 'La venta debe ser un objeto')];
  if (sale.schemaVersion !== SCHEMA_VERSION) out.push(issue('sale.schema_version', `${path}.schemaVersion`, `Versión de esquema no soportada (se espera ${SCHEMA_VERSION})`));
  if (!isUuid(sale.id) && !isStableId(sale.id)) out.push(issue('sale.id', `${path}.id`, 'La venta necesita un id estable (UUID), independiente del correlativo'));
  else if (/^#?\d+$/.test(sale.id)) out.push(issue('sale.id.is_correlative', `${path}.id`, 'El id de la venta no puede ser el correlativo visible: usá un UUID'));
  if (!isInt(sale.n, 1, 1e9)) out.push(issue('sale.n', `${path}.n`, 'El correlativo visible n debe ser un entero positivo'));
  if (!isInt(sale.revision, 1, 1e9)) out.push(issue('sale.revision', `${path}.revision`, 'revision debe ser un entero ≥ 1'));
  if (!SALE_STATUSES.includes(sale.status)) out.push(issue('sale.status', `${path}.status`, `status debe ser ${SALE_STATUSES.join(', ')}`));
  if (!isValidYmd(sale.fecha)) out.push(issue('sale.fecha', `${path}.fecha`, 'fecha debe ser YYYY-MM-DD real'));
  if (sale.entrega !== '' && sale.entrega !== null && sale.entrega !== undefined) {
    if (!isValidYmd(sale.entrega)) out.push(issue('sale.entrega', `${path}.entrega`, 'entrega debe ser YYYY-MM-DD real o vacía'));
    else if (isValidYmd(sale.fecha) && compareYmd(sale.entrega, sale.fecha) < 0) out.push(issue('sale.entrega.before_sale', `${path}.entrega`, 'La entrega no puede ser anterior a la fecha de venta'));
  }
  const c = sale.client;
  if (!isPlainObject(c)) out.push(issue('sale.client.missing', `${path}.client`, 'La venta necesita el cliente'));
  else {
    // Ficha única de cliente (fusión LOOPA OS): la venta apunta al cliente
    // unificado por id estable. Nunca por nombre.
    if (!isStableId(c.clientId)) out.push(issue('sale.client.id', `${path}.client.clientId`, 'La venta necesita el id estable del cliente'));
    if (!isText(c.nombre, LIMITS.text)) out.push(issue('sale.client.nombre', `${path}.client.nombre`, 'El cliente necesita nombre'));
  }
  // El evento lleva la venta completa y Firestore limita un documento a 1 MiB.
  let bytes = 0;
  try { bytes = Buffer.byteLength(JSON.stringify(sale), 'utf8'); } catch (e) { bytes = Infinity; }
  if (bytes > LIMITS.saleBytes) out.push(issue('sale.too_large', path, `La venta ocupa ${Math.round(bytes / 1024)} KB (máximo ${LIMITS.saleBytes / 1024} KB)`));
  if (!Array.isArray(sale.lines) || sale.lines.length === 0) out.push(issue('sale.lines.empty', `${path}.lines`, 'La venta necesita al menos una línea'));
  else if (sale.lines.length > LIMITS.lines) out.push(issue('sale.lines.too_many', `${path}.lines`, `Máximo ${LIMITS.lines} líneas por venta`));
  else {
    const seen = new Set();
    sale.lines.forEach((line, i) => out.push(...validateSaleLine(line, `${path}.lines[${i}]`, seen)));
  }
  return out;
}

// ── Evento de integración (outbox) ────────────────────────────────
// Lleva la venta completa: el worker no depende de releer un documento que
// pudo cambiar después. El eventId se deriva de (tipo, venta, revisión): un
// doble clic en "Confirmar" produce el MISMO evento, no dos.
function validateEvent(event, path = 'event') {
  const out = [];
  if (!isPlainObject(event)) return [issue('event.missing', path, 'El evento debe ser un objeto')];
  if (event.schemaVersion !== SCHEMA_VERSION) out.push(issue('event.schema_version', `${path}.schemaVersion`, `Versión de esquema no soportada (se espera ${SCHEMA_VERSION})`));
  if (!EVENT_TYPES.includes(event.type)) out.push(issue('event.type', `${path}.type`, `type debe ser ${EVENT_TYPES.join(', ')}`));
  if (typeof event.occurredAt !== 'string' || !ISO_INSTANT_RE.test(event.occurredAt)) out.push(issue('event.occurred_at', `${path}.occurredAt`, 'occurredAt debe ser un instante ISO 8601'));
  const saleIssues = validateSale(event.sale, `${path}.sale`);
  out.push(...saleIssues);
  if (isPlainObject(event.sale)) {
    if (event.saleId !== event.sale.id) out.push(issue('event.sale_id.mismatch', `${path}.saleId`, 'saleId no coincide con la venta incluida'));
    if (event.saleRevision !== event.sale.revision) out.push(issue('event.revision.mismatch', `${path}.saleRevision`, 'saleRevision no coincide con la venta incluida'));
  }
  if (EVENT_TYPES.includes(event.type) && typeof event.saleId === 'string' && Number.isInteger(event.saleRevision)) {
    if (event.eventId !== ids.eventId(event.type, event.saleId, event.saleRevision)) {
      out.push(issue('event.id.not_derived', `${path}.eventId`, 'eventId debe derivarse de (type, saleId, saleRevision)'));
    }
  }
  if (event.type === 'sale.confirmed' && isPlainObject(event.sale) && event.sale.status !== 'confirmed') {
    out.push(issue('event.sale_not_confirmed', `${path}.sale.status`, 'Un evento sale.confirmed requiere la venta confirmada'));
  }
  if (event.type === 'sale.cancelled' && isPlainObject(event.sale) && event.sale.status !== 'cancelled') {
    out.push(issue('event.sale_not_cancelled', `${path}.sale.status`, 'Un evento sale.cancelled requiere la venta cancelada'));
  }
  return out;
}

const createEvent = (type, sale, occurredAt) => {
  const event = {
    schemaVersion: SCHEMA_VERSION,
    eventId: ids.eventId(type, sale.id, sale.revision),
    type,
    saleId: sale.id,
    saleRevision: sale.revision,
    occurredAt,
    sale,
  };
  const problems = validateEvent(event);
  if (hasErrors(problems)) throw new ContractError(problems, 'Evento inválido');
  return event;
};

// ── Tarea FRAME generada ──────────────────────────────────────────
const PROVENANCE_FIELDS = ['sourceSystem', 'sourceSaleId', 'sourceSaleNumber', 'sourceLineIds', 'sourceEventId',
  'sourceTemplateVersions', 'sourceWorkItems', 'idempotencyKey', 'integration'];

function validateGeneratedTask(task, path = 'task') {
  const out = [];
  if (!isPlainObject(task)) return [issue('task.missing', path, 'La tarea debe ser un objeto')];
  PROVENANCE_FIELDS.forEach(k => { if (task[k] === undefined) out.push(issue('task.provenance.missing', `${path}.${k}`, `Falta el campo de procedencia ${k}`)); });
  if (task.sourceSystem !== 'loopa') out.push(issue('task.source_system', `${path}.sourceSystem`, 'sourceSystem debe ser "loopa"'));
  if (typeof task.idempotencyKey === 'string' && task.id !== ids.taskDocId(task.idempotencyKey)) out.push(issue('task.id.not_derived', `${path}.id`, 'El id debe derivarse de la clave de idempotencia'));
  if (!isText(task.title, LIMITS.text)) out.push(issue('task.title', `${path}.title`, 'title es obligatorio'));
  if (!isStableId(task.workspaceId)) out.push(issue('task.workspace', `${path}.workspaceId`, 'workspaceId inválido'));
  if (!Array.isArray(task.workspaceIds) || task.workspaceIds.length !== 1 || task.workspaceIds[0] !== task.workspaceId) {
    out.push(issue('task.workspace_ids', `${path}.workspaceIds`, 'workspaceIds debe ser [workspaceId]'));
  }
  if (!Array.isArray(task.viewerIds) || task.viewerIds.length === 0 || task.viewerIds.length > 30) out.push(issue('task.viewer_ids', `${path}.viewerIds`, 'viewerIds debe tener entre 1 y 30 miembros'));
  if (!isStableId(task.clientId)) out.push(issue('task.client_id', `${path}.clientId`, 'La tarea debe enlazar el cliente de FRAME por id'));
  if (!isText(task.client, LIMITS.text)) out.push(issue('task.client', `${path}.client`, 'client (nombre visible) es obligatorio'));
  ['sessionDate', 'deadline', 'startDate'].forEach(k => { if (!isValidYmd(task[k])) out.push(issue(`task.${k}`, `${path}.${k}`, `${k} debe ser YYYY-MM-DD`)); });
  if (!Array.isArray(task.checklist) || task.checklist.length === 0 || task.checklist.length > LIMITS.packageChecklist) {
    out.push(issue('task.checklist.size', `${path}.checklist`, `El checklist debe tener entre 1 y ${LIMITS.packageChecklist} ítems`));
  } else {
    const seen = new Set();
    task.checklist.forEach((item, i) => {
      if (!item || typeof item.id !== 'string' || seen.has(item.id)) out.push(issue('task.checklist.id', `${path}.checklist[${i}].id`, 'Ids de checklist ausentes o repetidos'));
      else seen.add(item.id);
      if (item && item.done !== false) out.push(issue('task.checklist.done', `${path}.checklist[${i}].done`, 'Un ítem generado nace sin completar'));
    });
  }
  return out;
}

const assertValid = (issues, label) => { if (hasErrors(issues)) throw new ContractError(issues, label); };

module.exports = {
  SCHEMA_VERSION,
  SALE_STATUSES,
  EVENT_TYPES,
  GROUPING_STRATEGIES,
  SESSION_ANCHORS,
  DEADLINE_ANCHORS,
  QUANTITY_MODES,
  RECURRENCE_UNITS,
  PRIORITIES,
  SERVICE_MODELS,
  PLACEHOLDERS,
  PROVENANCE_FIELDS,
  LIMITS,
  validateExecutionPlan,
  validateService,
  validateSale,
  validateEvent,
  validateGeneratedTask,
  createEvent,
  assertValid,
};
