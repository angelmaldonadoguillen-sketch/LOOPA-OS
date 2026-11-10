'use strict';
// ─────────────────────────────────────────────────────────────────
// Adaptador del esquema actual de LOOPA (colección `loopa`, documentos
// agregados) al contrato normalizado. Sólo lectura y sin efectos: sirve para
// el dry-run de migración (Fase 1) y para que la simulación use datos con la
// forma real.
//
// Identidad: las ventas viejas no tienen id. Se deriva uno determinista de
// `creado` (ISO de creación, único por venta y estable aunque el correlativo
// se haya renumerado al subir datos locales). Si falta, se usa una semilla
// débil (n|fecha|cliente|total) y se avisa. Las líneas toman id por
// posición: se congela en la migración y desde ahí ya es estable.
//
// Repetir la migración da exactamente el mismo resultado, en cualquier orden
// de entrada.
// ─────────────────────────────────────────────────────────────────

const { ids, canonicalJson } = require('./ids');
const { issue } = require('./errors');
const { SCHEMA_VERSION, SERVICE_MODELS } = require('./contracts');

const UNCATALOGUED_SERVICE_ID = 'SRV-SIN-CATALOGO';
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const modeloDe = (s = {}) => (SERVICE_MODELS.includes(s.modelo) ? s.modelo : s.unidad === 'mes' ? 'plan' : s.unidad === 'pieza' ? 'unitario' : 'proyecto');

function legacySaleToContract(v, { clientMap = {} } = {}) {
  const issues = [];
  const strong = typeof v.creado === 'string' && v.creado.length >= 10;
  const seed = strong ? `creado:${v.creado}` : `weak:${v.n}|${v.fecha}|${v.clienteId || v.cliente}|${v.total}`;
  const id = ids.legacySaleId(seed);
  if (!strong) issues.push(issue('legacy.sale.weak_identity', `ventas[n=${v.n}]`, 'La venta no tiene fecha de creación; su id se deriva de datos editables', 'warning'));
  const cancelled = v.estado === 'cancelado';
  const sale = {
    schemaVersion: SCHEMA_VERSION,
    id,
    n: v.n,
    revision: 1,
    status: cancelled ? 'cancelled' : 'confirmed',
    // El avance de producción de LOOPA queda como dato histórico; FRAME será
    // la fuente de ese estado para ventas nuevas.
    legacyProductionState: cancelled ? null : (v.estado || null),
    fecha: v.fecha,
    entrega: v.entrega || '',
    client: {
      // Id en la ficha única. Lo resuelve la fusión de clientes (Fase 1);
      // sin resolución explícita queda null y la venta no se puede escribir.
      clientId: (v.clienteId && clientMap[v.clienteId]) || null,
      legacyClientId: v.clienteId || '',
      nombre: v.cliente || '',
      empresa: v.empresa || '',
    },
    lines: (v.items || []).map((item, index) => ({
      lineId: ids.legacyLineId(id, index, item.tipoId),
      // Una línea sin tipo (datos locales muy viejos) se conserva con un
      // servicio marcador: la venta no se pierde y su snapshot sigue intacto.
      serviceId: item.tipoId || UNCATALOGUED_SERVICE_ID,
      quantity: num(item.q) || 1,
      snapshot: {
        nombre: item.nombre || '',
        modelo: modeloDe(item),
        categoria: item.categoria || '',
        unidad: item.unidad || '',
        alcance: item.descripcion || '',
        precio: num(item.precio),
        costo: num(item.costo),
        recomendado: item.recomendado === true,
        specialClientId: (item.clienteIdEspecial && clientMap[item.clienteIdEspecial]) || null,
      },
      // Las ventas anteriores a la integración no tienen plantilla congelada:
      // no generan trabajo retroactivo (ADR-0001, decisión D3).
      executionPlan: null,
      executionTemplateVersion: null,
    })),
    operations: { status: 'not_applicable', reason: 'legacy_pre_integration' },
  };
  (v.items || []).forEach((item, index) => {
    if (!item.tipoId) issues.push(issue('legacy.line.no_service', `ventas[n=${v.n}].items[${index}]`, `Línea sin tipoId: se conserva con el servicio marcador ${UNCATALOGUED_SERVICE_ID}`, 'warning'));
  });
  if (!v.clienteId) issues.push(issue('legacy.sale.no_client_id', `ventas[n=${v.n}]`, 'Venta sin clienteId'));
  else if (!clientMap[v.clienteId]) issues.push(issue('legacy.client.unmapped', `ventas[n=${v.n}]`, 'El cliente todavía no tiene ficha unificada: resolver en la fusión de clientes'));
  return { sale, issues };
}

function migrateLegacyLoopa(data, options = {}) {
  // Acepta la lista directa o el documento tal como está en Firestore ({ items }).
  const raw = data && data.ventas;
  const ventas = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
  const issues = [];
  const sales = [];
  const seenIds = new Map();
  ventas.forEach(v => {
    const res = legacySaleToContract(v, options);
    if (seenIds.has(res.sale.id)) {
      issues.push(issue('legacy.sale.id_collision', `ventas[n=${v.n}]`, `Dos ventas producen la misma identidad (también n=${seenIds.get(res.sale.id)})`));
      return;
    }
    seenIds.set(res.sale.id, v.n);
    sales.push(res.sale);
    issues.push(...res.issues);
  });
  sales.sort((a, b) => (a.id < b.id ? -1 : 1));
  issues.sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1));
  const counts = {
    ventas: ventas.length,
    migradas: sales.length,
    canceladas: sales.filter(s => s.status === 'cancelled').length,
    sinClienteUnificado: sales.filter(s => !s.client.clientId).length,
    errores: issues.filter(i => i.severity === 'error').length,
    advertencias: issues.filter(i => i.severity === 'warning').length,
  };
  return { sales, issues, counts };
}

module.exports = { legacySaleToContract, migrateLegacyLoopa, UNCATALOGUED_SERVICE_ID };
