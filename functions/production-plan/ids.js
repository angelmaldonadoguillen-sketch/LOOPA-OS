'use strict';
// ─────────────────────────────────────────────────────────────────
// Identidades deterministas.
//
// Toda salida del integrador (evento, unidad de trabajo, tarjeta, ítem de
// checklist) tiene un id que se DERIVA de identidades estables de origen:
// saleId (UUID), lineId (UUID), serviceId, templateId y número de
// ocurrencia. Nunca del correlativo visible `n`, ni de la hora, ni del azar.
//
// Por eso reintentar produce exactamente los mismos ids, y la escritura con
// precondición "crear si no existe" (Firestore create()) es la que impide
// duplicar: dos workers que calculan la misma tarjeta compiten por el mismo
// documento y sólo uno puede crearlo.
// ─────────────────────────────────────────────────────────────────

const crypto = require('node:crypto');

// Separador de unidades ASCII: no puede aparecer en ids validados.
const SEP = '\u001f';
const KEY_NAMESPACE = 'loopa-frame/v1';

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const keyOf = (kind, parts) => {
  parts.forEach((part, index) => {
    if (typeof part !== 'string' && !Number.isInteger(part)) {
      throw new TypeError(`Parte ${index} de la clave ${kind} debe ser texto o entero`);
    }
    if (String(part).includes(SEP)) throw new TypeError(`Parte ${index} de la clave ${kind} contiene un separador reservado`);
  });
  return [KEY_NAMESPACE, kind, ...parts.map(String)].join(SEP);
};

const hashId = (prefix, kind, parts, length = 32) => `${prefix}${sha256Hex(keyOf(kind, parts)).slice(0, length)}`;

// JSON con claves ordenadas: el mismo objeto siempre serializa igual.
const canonicalJson = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
};

const fingerprint = (value) => sha256Hex(canonicalJson(value)).slice(0, 32);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isUuid = (s) => typeof s === 'string' && UUID_RE.test(s);

// Ids de origen aceptados: UUID o ids existentes de LOOPA/FRAME (SRV-…, CL-…,
// p…). Sin '/', sin espacios, sin el separador, sin el patrón __x__ que
// Firestore reserva.
const STABLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const isStableId = (s) => typeof s === 'string' && STABLE_ID_RE.test(s) && !/^__.*__$/.test(s);

const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const isTemplateId = (s) => typeof s === 'string' && TEMPLATE_ID_RE.test(s);

const ids = {
  eventId: (type, saleId, saleRevision) => hashId('evt_', 'event', [type, saleId, saleRevision]),
  workItemKey: (saleId, lineId, templateId, occurrence) => hashId('wi_', 'work-item', [saleId, lineId, templateId, occurrence]),
  // Clave de idempotencia de la tarjeta. Incluye saleId: la agrupación es
  // dentro de una misma venta (ver ADR-0001, decisión D1).
  packageKey: (saleId, workspaceId, clientId, sessionDate, groupKey) =>
    hashId('pkg_', 'package', [saleId, workspaceId, clientId, sessionDate, groupKey]),
  separateKey: (workItemKey) => hashId('pkg_', 'separate', [workItemKey]),
  // El id del documento en frame_projects se deriva de la clave: así la
  // precondición de existencia es la garantía de idempotencia.
  taskDocId: (idempotencyKey) => hashId('loopa_', 'task-doc', [idempotencyKey], 28),
  checklistItemId: (workItemKey, itemId, unit) => hashId('ck_', 'checklist', [workItemKey, itemId, unit], 20),
  legacySaleId: (seed) => hashId('sale_legacy_', 'legacy-sale', [seed], 24),
  legacyLineId: (saleId, index, tipoId) => hashId('line_legacy_', 'legacy-line', [saleId, index, tipoId || ''], 24),
  // Migración (Fase 1): ficha única para clientes que sólo existían en LOOPA,
  // y ids para elementos viejos que no traían uno.
  unifiedClientId: (loopaClientId) => hashId('cli_', 'unified-client', [loopaClientId], 24),
  legacyItemId: (kind, seed) => hashId(`${kind}_legacy_`, `legacy-${kind}`, [seed], 20),
};

module.exports = {
  sha256Hex,
  canonicalJson,
  fingerprint,
  isUuid,
  isStableId,
  isTemplateId,
  ids,
};
