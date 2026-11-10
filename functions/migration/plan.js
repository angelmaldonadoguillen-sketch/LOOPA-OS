'use strict';
// ─────────────────────────────────────────────────────────────────
// Plan de migración: respaldo de LOOPA + clientes de FRAME → lista exacta de
// escrituras al modelo unificado (un documento por entidad).
//
// Puro y determinista: el mismo respaldo, los mismos clientes y las mismas
// decisiones producen el mismo plan, con la misma huella, en cualquier orden
// de entrada. No lee la hora.
//
// Colecciones destino (Firebase del sistema unificado):
//   loopa_sales/{saleId}           venta: contrato de producción + bloque comercial
//   loopa_services/{serviceId}     catálogo (executionPlan llega en Fase 3)
//   frame_clients/{clientId}       ficha única (crear o completar)
//   loopa_expenses/{expenseId}     gastos variables y fijos
//   loopa_config/main              configuración comercial
//   loopa_counters/sales           próximo correlativo visible
// ─────────────────────────────────────────────────────────────────

const { fingerprint, canonicalJson, ids, isStableId, sha256Hex } = require('../production-plan/ids');
const { issue, hasErrors } = require('../production-plan/errors');
const { validateSale, validateService, SERVICE_MODELS, SCHEMA_VERSION } = require('../production-plan/contracts');
const { legacySaleToContract, UNCATALOGUED_SERVICE_ID } = require('../production-plan/legacy-loopa');
const { isValidYmd } = require('../production-plan/dates');
const { readLoopaSource, sourceManifest } = require('./source');
const { proposeClientMerge, newClientDoc, linkPatch, phoneKeys, emailKey, nameKey } = require('./clients');
const { parseAmount } = require('./amounts');
const { validateCommercial } = require('../repositories/sales');

const MIGRATION_SOURCE = 'loopa-legacy/v1';
const COLLECTION_ORDER = ['frame_clients', 'loopa_services', 'loopa_sales', 'loopa_expenses', 'loopa_config', 'loopa_counters'];

// Datos que la app vieja aceptaba y que el contrato nuevo no: en una venta
// histórica (sin producción) se migran igual, marcados, en vez de bloquear.
const LEGACY_TOLERATED = new Set(['sale.entrega.before_sale', 'line.snapshot.precio', 'line.snapshot.costo', 'sale.lines.empty', 'sale.entrega']);

const round2 = (n) => Math.round(n * 100) / 100;
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const modeloDe = (s = {}) => (SERVICE_MODELS.includes(s.modelo) ? s.modelo : s.unidad === 'mes' ? 'plan' : s.unidad === 'pieza' ? 'unitario' : 'proyecto');

// Revisa cada importe con el parser estricto. Devuelve el número y anota el
// texto original cuando no era un número limpio.
function amountReader(where, out, raw) {
  const formatted = [];
  const read = (field, value, { allowNegative = false } = {}) => {
    const r = parseAmount(value);
    if (r.kind === 'invalid') {
      out.push(issue('legacy.amount.unparseable', `${where}.${field}`, `Importe ilegible (${JSON.stringify(String(value)).slice(0, 40)}): corregilo en LOOPA y volvé a exportar el respaldo`));
      return 0;
    }
    if (r.kind === 'thousands' || r.kind === 'plain' || r.kind === 'loose') { formatted.push(field); raw[field] = value; }
    if (r.value < 0 && !allowNegative) out.push(issue('legacy.amount.negative', `${where}.${field}`, 'Importe negativo: se conserva tal cual', 'warning'));
    return r.value;
  };
  read.done = () => {
    if (formatted.length) out.push(issue('legacy.amount.formatted', where, `Importes guardados como texto (${formatted.join(', ')}): se convirtieron y el original queda en legacyRaw`, 'warning'));
  };
  return read;
}

function saleDoc(v, clientMap, out) {
  const where = `ventas[n=${v.n}]`;
  const legacyRaw = {};
  const read = amountReader(where, out, legacyRaw);
  // Se validan los importes de las líneas con el parser estricto; la
  // conversión del adaptador coincide para todo valor que pase.
  (v.items || []).forEach((item, j) => { read(`items[${j}].precio`, item.precio); read(`items[${j}].costo`, item.costo); read(`items[${j}].q`, item.q); });
  const res = legacySaleToContract(v, { clientMap });
  out.push(...res.issues);
  const sale = res.sale;
  const seenAbono = new Set();
  const abonos = (Array.isArray(v.abonos) ? v.abonos : []).map((a, i) => {
    let id = isStableId(a.id) ? a.id : ids.legacyItemId('abono', `${sale.id}|${i}`);
    if (seenAbono.has(id)) id = ids.legacyItemId('abono', `${sale.id}|${i}|dup`);
    seenAbono.add(id);
    if (!isValidYmd(a.fecha)) out.push(issue('legacy.abono.fecha', `${where}.abonos[${i}]`, 'Cobro con fecha inválida', 'warning'));
    return { id, fecha: text(a.fecha), monto: read(`abonos[${i}].monto`, a.monto), metodo: text(a.metodo) };
  });
  const commercial = {
    subtotal: read('subtotal', v.subtotal),
    descuento: read('descuento', v.descuento),
    total: read('total', v.total),
    pay: text(v.pay),
    abonos,
    canal: text(v.canal),
    nota: text(v.nota),
    // Snapshot de contacto al momento de vender (la ficha puede cambiar).
    contacto: { telefono: text(v.telefono), email: text(v.email) },
  };
  read.done();
  const doc = {
    ...sale,
    commercial,
    estadoLog: Array.isArray(v.estadoLog) ? v.estadoLog.map(e => ({ estado: text(e.estado), ts: text(e.ts) })) : [],
    createdAt: text(v.creado) || null,
    // Campos del modelo nuevo: concurrencia optimista y estado del worker.
    version: 1,
    operations: { status: 'not_applicable', reason: 'legacy_pre_integration', taskIds: [], lastEventId: null, lastSuccessAt: null, lastError: null, pendingDiff: null, updatedAt: null },
    lock: null,
  };
  if (Object.keys(legacyRaw).length) doc.legacyRaw = legacyRaw;
  return doc;
}

function serviceDoc(s, clientMap, out) {
  const where = `servicios[${s.id}]`;
  const legacyRaw = {};
  const read = amountReader(where, out, legacyRaw);
  const modelo = modeloDe(s);
  const special = text(s.clienteIdEspecial);
  const specialClientId = special ? clientMap[special] || null : null;
  if (modelo === 'especial' && !specialClientId) {
    out.push(issue('legacy.service.special_unmapped', where, 'Acuerdo especial cuyo cliente no tiene ficha unificada'));
  }
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    id: s.id,
    nombre: text(s.nombre),
    categoria: text(s.categoria) || 'Otro',
    unidad: text(s.unidad) || 'proyecto',
    modelo,
    descripcion: text(s.descripcion),
    precio: read('precio', s.precio),
    costo: read('costo', s.costo),
    activo: s.activo !== false,
    recomendado: modelo === 'plan' && s.recomendado === true,
    specialClientId,
    createdAt: text(s.creado) || null,
    // La plantilla operativa versionada se agrega en la Fase 3; mientras
    // tanto el servicio vende igual y no genera producción.
    executionPlan: null,
  };
  read.done();
  if (Object.keys(legacyRaw).length) doc.legacyRaw = legacyRaw;
  return doc;
}

// Ids de gastos: el explícito si es único; si falta o está repetido, uno
// derivado SÓLO del contenido (más un ordinal entre gastos idénticos). Así
// no depende de la posición: la app vieja inserta los gastos nuevos al frente.
function expenseDocs(source, out) {
  const raw = [
    ...source.gastosVariables.map(g => ({ g, kind: 'variable' })),
    ...source.gastosFijos.map(g => ({ g, kind: 'fixed' })),
  ];
  const idCount = new Map();
  raw.forEach(({ g }) => { if (isStableId(g.id)) idCount.set(g.id, (idCount.get(g.id) || 0) + 1); });
  const contentSeen = new Map();
  const docs = raw.map(({ g, kind }) => {
    const where = `gastos.${kind === 'variable' ? 'variables' : 'fijos'}[${text(g.id) || text(g.concepto)}]`;
    const legacyRaw = {};
    const read = amountReader(where, out, legacyRaw);
    const monto = read('monto', g.monto);
    read.done();
    const base = kind === 'variable'
      ? { kind, fecha: text(g.fecha), concepto: text(g.concepto), categoria: text(g.categoria) || 'Otro', monto, nota: text(g.nota) }
      : { kind, concepto: text(g.concepto), categoria: text(g.categoria) || 'Otro', monto, activo: g.activo !== false, nota: text(g.nota) };
    let id = isStableId(g.id) && idCount.get(g.id) === 1 ? g.id : null;
    if (!id) {
      if (isStableId(g.id)) out.push(issue('legacy.expense.duplicate_id', where, `Id de gasto repetido (${g.id}): se le asigna uno derivado del contenido`, 'warning'));
      const seed = canonicalJson({ ...base, legacyId: isStableId(g.id) ? g.id : '' });
      const k = contentSeen.get(seed) || 0;
      contentSeen.set(seed, k + 1);
      id = ids.legacyItemId('gasto', `${sha256Hex(seed).slice(0, 32)}|${k}`);
    }
    const doc = { id, ...base, legacyId: isStableId(g.id) ? g.id : null };
    if (Object.keys(legacyRaw).length) doc.legacyRaw = legacyRaw;
    return doc;
  });
  return docs;
}

// Ventas cuyo cliente falta o ya no existe: se les arma una ficha a partir
// del snapshot de la venta, con id determinista (mismos datos → misma ficha).
// Pasa por la misma fusión que el resto y admite decisiones.
function orphanClients(source, out) {
  const known = new Set(source.clientes.map(c => c.id));
  const groups = new Map(); // id huérfano → índices de venta
  const reassigned = new Map(); // índice de venta → id de cliente huérfano
  source.ventas.forEach((v, i) => {
    if (v.clienteId && known.has(v.clienteId)) return;
    // Si la venta conserva el id del cliente borrado, ése agrupa todas sus
    // ventas (aunque el teléfono cambie entre una y otra). Si no hay id, se
    // agrupa por los datos de contacto.
    const seed = v.clienteId
      ? canonicalJson({ deletedClientId: String(v.clienteId) })
      : canonicalJson({ name: nameKey(v.cliente), phones: phoneKeys(v.telefono), email: emailKey(v.email) });
    const id = `CL-ORPHAN-${sha256Hex(seed).slice(0, 12)}`;
    if (known.has(id)) { out.push(issue('legacy.client.orphan_collision', `ventas[n=${v.n}]`, `El id ${id} ya existe en LOOPA`)); return; }
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(i);
    reassigned.set(i, id);
    out.push(issue('legacy.sale.orphan_client', `ventas[n=${v.n}]`, `El cliente de la venta ${v.clienteId ? 'ya no existe' : 'no estaba registrado'}: se arma la ficha ${id} con los datos de la venta`, 'warning'));
  });
  // La ficha se arma con una venta representativa elegida por un criterio
  // fijo (la más antigua), no por el orden del respaldo.
  const repKey = (v) => canonicalJson([text(v.creado), text(v.fecha), Number.isInteger(v.n) ? v.n : 0, text(v.cliente), text(v.telefono), text(v.email)]);
  const orphans = [...groups.entries()].map(([id, idx]) => {
    const v = idx.map(i => source.ventas[i]).sort((a, b) => (repKey(a) < repKey(b) ? -1 : repKey(a) > repKey(b) ? 1 : 0))[0];
    return { id, nombre: text(v.cliente) || 'Cliente sin nombre', empresa: text(v.empresa), telefono: text(v.telefono), email: text(v.email), canal: text(v.canal), notas: '', creado: '' };
  });
  return { orphans, reassigned };
}

const withMigration = (data, manifestTotal) => {
  const hash = fingerprint(data);
  return { data: { ...data, migration: { source: MIGRATION_SOURCE, sourceManifest: manifestTotal, hash } }, hash };
};

/**
 * @param {object} input { backup (respaldo crudo), frameClients (lista), decisions, workspaceId }
 */
function buildMigrationPlan({ backup, frameClients = [], decisions = {}, workspaceId }) {
  const issues = [];
  const { source, issues: sourceIssues } = readLoopaSource(backup);
  issues.push(...sourceIssues);
  if (!source) return { status: 'blocked', issues, ops: [], counts: {}, manifest: null, clientReport: null, reconciliation: null, fingerprint: null };
  if (!isStableId(workspaceId)) issues.push(issue('migration.workspace', 'workspaceId', 'Falta el tablero de producción de destino'));
  const manifest = sourceManifest(source);

  // Ids de cliente repetidos en LOOPA: no se sabe a cuál apunta cada venta.
  const clientIdCount = new Map();
  source.clientes.forEach(c => clientIdCount.set(c.id, (clientIdCount.get(c.id) || 0) + 1));
  clientIdCount.forEach((n, id) => { if (n > 1) issues.push(issue('legacy.client.duplicate_id', `clientes[${id}]`, `El id de cliente ${id} aparece ${n} veces: corregilo en LOOPA antes de migrar`)); });

  const { orphans, reassigned } = orphanClients(source, issues);
  const allClients = [...source.clientes.filter(c => clientIdCount.get(c.id) === 1), ...orphans];
  const ventas = source.ventas.map((v, i) => (reassigned.has(i) ? { ...v, clienteId: reassigned.get(i) } : v));

  const merge = proposeClientMerge(allClients, frameClients, { decisions, workspaceId });
  issues.push(...merge.issues);
  const clientMap = merge.clientMap;

  const ops = [];
  const add = (op, collection, id, data) => {
    const { data: full, hash } = withMigration(data, manifest.total);
    ops.push({ op, collection, id, data: full, hash });
  };

  const loopaById = new Map(allClients.map(c => [c.id, c]));
  merge.proposals.forEach(p => {
    if (!p.unifiedId) return;
    const c = loopaById.get(p.loopaClientId);
    if (p.final === 'new') add('create', 'frame_clients', p.unifiedId, newClientDoc(c, p.unifiedId, workspaceId));
    else add('merge', 'frame_clients', p.unifiedId, { ...linkPatch(c), workspaceId });
  });

  const serviceIds = new Set();
  source.servicios.forEach((s, i) => {
    const doc = serviceDoc(s, clientMap, issues);
    issues.push(...validateService(doc, `servicios[${i}]`));
    if (serviceIds.has(doc.id)) { issues.push(issue('legacy.service.duplicate_id', `servicios[${i}]`, `Id de servicio repetido: ${doc.id}`)); return; }
    serviceIds.add(doc.id);
    add('create', 'loopa_services', doc.id, doc);
  });

  const saleIds = new Map();
  const numbers = new Map();
  ventas.forEach((v, saleIndex) => {
    const doc = saleDoc(v, clientMap, issues);
    if (saleIds.has(doc.id)) { issues.push(issue('legacy.sale.id_collision', `ventas[n=${v.n}]`, `Misma identidad que la venta n=${saleIds.get(doc.id)}`)); return; }
    saleIds.set(doc.id, v.n);
    if (numbers.has(doc.n)) issues.push(issue('legacy.sale.duplicate_number', `ventas[n=${v.n}]`, 'Dos ventas comparten el correlativo visible: la interfaz nueva las distingue por id', 'warning'));
    numbers.set(doc.n, doc.id);
    const contract = validateSale(doc, `ventas[n=${v.n}]`)
      // La falta de cliente ya está informada por la fusión (client.unresolved).
      .filter(x => x.code !== 'sale.client.id' || doc.client.clientId !== null);
    // Lo comercial que el repositorio exigiría al editarla (importes, precios,
    // cobros): en una venta histórica se registra para no bloquear ediciones
    // que no lo toquen.
    const commercialProblems = validateCommercial(doc.commercial, { lines: doc.lines, path: `ventas[n=${v.n}].commercial` })
      .filter(x => !contract.some(c => c.code === x.code));
    const tolerated = [...contract, ...commercialProblems].filter(x => x.severity === 'error'
      && (LEGACY_TOLERATED.has(x.code) || x.code.startsWith('commercial.') || x.code.startsWith('payment.')));
    issues.push(...contract.filter(x => !tolerated.includes(x)));
    tolerated.forEach(x => issues.push({ ...x, severity: 'warning', message: `${x.message} (venta histórica: se migra marcada)` }));
    if (tolerated.length) doc.legacyIssues = [...new Set(tolerated.map(x => x.code))].sort();
    // La ficha huérfana no borra el rastro del cliente original.
    const original = source.ventas[saleIndex].clienteId;
    doc.client.legacyClientId = typeof original === 'string' ? original : '';
    if (reassigned.has(saleIndex)) doc.client.orphanClientId = reassigned.get(saleIndex);
    doc.lines.forEach((line, j) => {
      if (line.serviceId && line.serviceId !== UNCATALOGUED_SERVICE_ID && !serviceIds.has(line.serviceId)) {
        issues.push(issue('legacy.line.service_missing', `ventas[n=${v.n}].items[${j}]`, 'El servicio vendido ya no existe en el catálogo; la venta conserva su snapshot', 'warning'));
      }
    });
    add('create', 'loopa_sales', doc.id, doc);
  });

  expenseDocs(source, issues).forEach(g => add('create', 'loopa_expenses', g.id, g));
  const cfg = source.config;
  add('create', 'loopa_config', 'main', {
    payConfig: Array.isArray(cfg.payConfig) ? cfg.payConfig : [],
    categorias: Array.isArray(cfg.categorias) ? cfg.categorias : [],
    canales: Array.isArray(cfg.canales) ? cfg.canales : [],
    gastoTipos: Array.isArray(cfg.gastoTipos) ? cfg.gastoTipos : [],
    moneda: text(cfg.moneda) || 'L',
  });
  const maxN = Math.max(1000, ...source.ventas.map(v => (Number.isInteger(v.n) ? v.n : 0)));
  add('create', 'loopa_counters', 'sales', { next: maxN + 1 });

  // Ninguna escritura repetida: cada documento destino aparece una vez.
  const opKeys = new Map();
  ops.forEach(o => { const k = `${o.collection}/${o.id}`; opKeys.set(k, (opKeys.get(k) || 0) + 1); });
  opKeys.forEach((n, k) => { if (n > 1) issues.push(issue('migration.duplicate_op', k, `El documento ${k} se escribiría ${n} veces`)); });

  // ── Conciliación: lo que entra tiene que ser lo que sale. El origen se
  // calcula con el parser estricto, independiente de la conversión. ────────
  const salesOut = ops.filter(o => o.collection === 'loopa_sales').map(o => o.data);
  const strict = (v) => parseAmount(v).value;
  const sum = (list, f) => round2(list.reduce((a, x) => a + f(x), 0));
  const reconciliation = {
    ventas: { origen: source.ventas.length, destino: salesOut.length },
    clientes: { origen: allClients.length, destino: merge.proposals.filter(p => p.unifiedId).length },
    servicios: { origen: source.servicios.length, destino: ops.filter(o => o.collection === 'loopa_services').length },
    gastos: { origen: source.gastosVariables.length + source.gastosFijos.length, destino: ops.filter(o => o.collection === 'loopa_expenses').length },
    total: { origen: sum(source.ventas, v => strict(v.total)), destino: sum(salesOut, s => s.commercial.total) },
    cobrado: { origen: sum(source.ventas, v => (v.abonos || []).reduce((a, x) => a + strict(x.monto), 0)), destino: sum(salesOut, s => s.commercial.abonos.reduce((a, x) => a + x.monto, 0)) },
    lineas: { origen: source.ventas.reduce((a, v) => a + (v.items || []).length, 0), destino: salesOut.reduce((a, s) => a + s.lines.length, 0) },
  };
  Object.entries(reconciliation).forEach(([k, r]) => {
    const same = Number.isNaN(r.origen) ? false : r.origen === r.destino;
    if (!same) issues.push(issue('migration.reconciliation', `conciliacion.${k}`, `No cuadra ${k}: origen ${r.origen}, destino ${r.destino}`));
  });

  const order = (o) => COLLECTION_ORDER.indexOf(o.collection);
  ops.sort((a, b) => order(a) - order(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const counts = {};
  ops.forEach(o => { const k = `${o.collection}:${o.op}`; counts[k] = (counts[k] || 0) + 1; });
  issues.sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1));
  return {
    status: hasErrors(issues) ? 'blocked' : 'ready',
    manifest,
    clientReport: { counts: merge.counts, proposals: merge.proposals },
    reconciliation,
    counts,
    issues,
    ops,
    fingerprint: fingerprint({ manifest: manifest.total, ops: ops.map(o => [o.op, o.collection, o.id, o.hash]) }),
  };
}

module.exports = { buildMigrationPlan, MIGRATION_SOURCE, COLLECTION_ORDER, LEGACY_TOLERATED };
