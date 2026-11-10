'use strict';
// ─────────────────────────────────────────────────────────────────
// Lectura compatible: documentos del modelo unificado → la forma que usa hoy
// la interfaz de LOOPA (ventas/clientes/servicios del esquema viejo).
//
// Sirve para la transición de la Fase 2: las pantallas existentes (métricas,
// listados, cobros) pueden leer del modelo nuevo sin reescribirse de golpe.
// Es sólo lectura: nunca se escribe en la forma vieja.
// ─────────────────────────────────────────────────────────────────

const { UNCATALOGUED_SERVICE_ID } = require('../production-plan/legacy-loopa');

// Estados del modelo nuevo → vocabulario que entiende la interfaz vieja.
const LEGACY_LOG = { confirmed: 'pendiente', cancelled: 'cancelado' };

// Un borrador no existe en la interfaz vieja (no tenía borradores): devuelve
// null para que no cuente como venta activa en métricas.
function toLegacyVenta(doc) {
  if (doc.status === 'draft') return null;
  const c = doc.commercial || {};
  const estado = doc.status === 'cancelled' ? 'cancelado' : (doc.legacyProductionState || 'pendiente');
  const venta = {
    id: doc.id,
    n: doc.n,
    fecha: doc.fecha,
    cliente: doc.client.nombre,
    empresa: doc.client.empresa || '',
    telefono: (c.contacto && c.contacto.telefono) || '',
    email: (c.contacto && c.contacto.email) || '',
    canal: c.canal || '',
    clienteId: doc.client.clientId,
    items: doc.lines.map(line => ({
      lineId: line.lineId,
      tipoId: line.serviceId === UNCATALOGUED_SERVICE_ID ? '' : line.serviceId,
      nombre: line.snapshot.nombre,
      categoria: line.snapshot.categoria || '',
      unidad: line.snapshot.unidad || '',
      descripcion: line.snapshot.alcance || '',
      modelo: line.snapshot.modelo,
      precio: line.snapshot.precio,
      costo: line.snapshot.costo,
      recomendado: line.snapshot.recomendado === true,
      clienteIdEspecial: line.snapshot.specialClientId || '',
      q: line.quantity,
    })),
    subtotal: c.subtotal || 0,
    descuento: c.descuento || 0,
    total: c.total || 0,
    pay: c.pay || '',
    abonos: (c.abonos || []).map(a => ({ id: a.id, fecha: a.fecha, monto: a.monto, metodo: a.metodo })),
    estado,
    entrega: doc.entrega || '',
    nota: c.nota || '',
    creado: doc.createdAt || '',
    estadoLog: (doc.estadoLog || [])
      .filter(e => e.estado !== 'draft')
      .map(e => ({ ...e, estado: LEGACY_LOG[e.estado] || e.estado })),
  };
  return venta;
}

function toLegacyCliente(doc) {
  const k = doc.commercial || {};
  const pick = (a, b) => (a && !/^[\s—–-]*$/.test(a) ? a : b || '');
  return {
    id: doc.id,
    // Las pantallas viejas siguen mostrando el nombre con que LOOPA conocía
    // al cliente; la ficha única conserva el suyo en `name`.
    nombre: k.nombreLoopa || doc.name,
    empresa: k.empresa || '',
    telefono: pick(k.telefono, doc.contact && doc.contact.phone !== '—' ? doc.contact.phone : ''),
    email: pick(k.email, doc.contact && doc.contact.email !== '—' ? doc.contact.email : ''),
    canal: k.canal || '',
    notas: k.notas || '',
    creado: k.creadoEnLoopa || '',
  };
}

function toLegacyServicio(doc) {
  return {
    id: doc.id,
    nombre: doc.nombre,
    categoria: doc.categoria,
    unidad: doc.unidad,
    precio: doc.precio,
    costo: doc.costo,
    descripcion: doc.descripcion,
    activo: doc.activo,
    creado: doc.createdAt || '',
    modelo: doc.modelo,
    recomendado: doc.recomendado,
    clienteIdEspecial: doc.specialClientId || '',
  };
}

module.exports = { toLegacyVenta, toLegacyCliente, toLegacyServicio };
