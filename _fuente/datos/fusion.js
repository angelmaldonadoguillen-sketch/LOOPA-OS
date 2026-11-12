// ═══════════════════════════════════════════════════════════════
// LOOPA OS · Datos de la fusión (Fase 3, tanda 3.2)
//
// Traductor PURO entre las pantallas de LOOPA (ventas, clientes y servicios
// con la forma vieja) y el modelo unificado de frame-studio-3a18f:
//
//   leer:     documentos (loopa_sales, frame_clients, loopa_services)
//             → la forma que ya usan las pantallas
//   escribir: lo que hace la pantalla (crear venta, cambiar estado, editar
//             líneas, cobrar, anular un cobro, «eliminar»)
//             → llamadas a las funciones del servidor
//
// Sin Firebase, sin DOM: se prueba con Node (integracion/test/fusion-datos).
// Nada se escribe directo en Firestore: todo pasa por el servidor.
// La lectura es la misma que functions/migration/compat.js (paridad probada).
// ═══════════════════════════════════════════════════════════════

const LoopaFusion = (function () {
  const UNCATALOGUED_SERVICE_ID = 'SRV-SIN-CATALOGO';
  const LEGACY_LOG = { confirmed: 'pendiente', cancelled: 'cancelado' };
  const AVANCE = ['pendiente', 'en-proceso', 'revision', 'entregado'];
  const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  const txt = (v) => (typeof v === 'string' ? v.trim() : '');

  // ── Lectura ────────────────────────────────────────────────────
  // Un borrador no existe en las pantallas viejas: null.
  function ventaDesdeDoc(doc) {
    if (!doc || doc.status === 'draft') return null;
    const c = doc.commercial || {};
    const estado = doc.status === 'cancelled' ? 'cancelado' : (doc.legacyProductionState || 'pendiente');
    return {
      id: doc.id,
      n: doc.n,
      // Para la concurrencia optimista al editar (expectedVersion).
      version: doc.version,
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
        // Producto con ficha (venta cerrada): su rango y su ficha congelada.
        ...(line.ficha ? { ficha: line.ficha, inicio: line.inicio || '', fin: line.fin || '' } : {}),
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
      // Avance real de producción (lo lleva FRAME): para mostrarlo al lado.
      produccion: doc.operations ? { status: doc.operations.status, tareas: (doc.operations.taskIds || []).length } : null,
    };
  }

  // Un solo sistema (Fase 4): nombre, teléfono, email y notas salen de la ficha
  // única (los que edita Producción); lo de `commercial` queda de respaldo
  // para fichas viejas. Empresa y canal son sólo comerciales.
  function clienteDesdeDoc(doc) {
    const k = doc.commercial || {};
    const c = doc.contact || {};
    const pick = (a, b) => (a && !/^[\s—–-]*$/.test(a) ? a : (b && !/^[\s—–-]*$/.test(b) ? b : ''));
    return {
      id: doc.id,
      nombre: pick(doc.name, k.nombreLoopa),
      empresa: k.empresa || '',
      telefono: pick(c.phone, k.telefono),
      email: pick(c.email, k.email),
      canal: k.canal || '',
      notas: pick(doc.notes, k.notas),
      creado: k.creadoEnLoopa || '',
    };
  }

  function servicioDesdeDoc(doc) {
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
      // Ficha del producto (qué incluye, patrón, proceso, costos): null en los viejos.
      ficha: doc.ficha || null,
      // Ítems y paquetes: qué es (ítem = la pieza) y los datos del ítem.
      ...(doc.clase ? { clase: doc.clase } : {}),
      ...(doc.item ? { item: doc.item } : {}),
      // ¿Genera producción al venderse? (tiene plantilla activa)
      generaProduccion: !!(doc.executionPlan && doc.executionPlan.enabled),
    };
  }

  // ── Escritura: qué funciones del servidor llamar ───────────────
  // Cada operación es { fn, data }; el que llama las ejecuta en orden.
  // Una línea migrada sin servicio del catálogo (tipoId vacío) conserva su
  // servicio marcador: se puede editar su cantidad o precio. Una línea NUEVA
  // siempre viene del catálogo.
  const lineaDesdeItem = (i, nuevoId) => ({
    lineId: i.lineId || nuevoId(),
    serviceId: i.tipoId || (i.lineId ? UNCATALOGUED_SERVICE_ID : ''),
    quantity: num(i.q),
    precio: num(i.precio),
    costo: num(i.costo),
    ...(typeof i.descripcion === 'string' && !i.ficha ? { descripcion: i.descripcion } : {}),
    // Producto con ficha: el servidor fija precio y costo; la venta elige el inicio.
    ...(i.inicio ? { inicio: i.inicio } : {}),
  });

  const clienteParaServidor = (cli, id) => ({
    id, nombre: txt(cli.nombre), empresa: txt(cli.empresa), telefono: txt(cli.telefono), email: txt(cli.email), canal: txt(cli.canal),
    ...(Object.prototype.hasOwnProperty.call(cli, 'notas') ? { notas: txt(cli.notas) } : {}),
  });
  // Al vender a una ficha existente sólo se completan los datos que se
  // cargaron (como hacía LOOPA): un campo vacío no borra el de la ficha.
  const soloCompletos = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => k === 'id' || k === 'nombre' || v !== ''));

  // Nueva venta. `cli` es lo que cargó la pantalla; `clienteId` el de una
  // ficha existente o null (entonces se crea una, con id nuevo). El número
  // de venta lo asigna el servidor (la pantalla muestra el que devuelve).
  function operacionesNuevaVenta(venta, cli, clienteId, nuevoId) {
    if (!venta.items || !venta.items.length) throw new Error('La venta no tiene servicios');
    if (venta.items.some(i => !i.tipoId)) throw new Error('Cada servicio debe venir del catálogo');
    const ventaId = venta.id || nuevoId();
    const cid = clienteId || nuevoId();
    const datosCliente = clienteParaServidor(cli, cid);
    const ops = [{ fn: 'loopaSaveClient', data: { client: clienteId ? soloCompletos(datosCliente) : datosCliente } }];
    ops.push({
      fn: 'loopaCreateSale',
      data: {
        draft: {
          id: ventaId,
          status: 'confirmed',
          // El avance elegido al vender (si no es «pendiente», el de siempre).
          ...(AVANCE.includes(venta.estado) && venta.estado !== 'pendiente' ? { legacyProductionState: venta.estado } : {}),
          fecha: venta.fecha,
          entrega: venta.entrega || '',
          client: { clientId: cid, nombre: txt(cli.nombre), empresa: txt(cli.empresa) },
          lines: venta.items.map(i => lineaDesdeItem(i, nuevoId)),
          commercial: {
            subtotal: num(venta.subtotal), descuento: num(venta.descuento), total: num(venta.total), pay: venta.pay || '',
            abonos: (venta.abonos || []).map(a => ({ id: a.id, fecha: a.fecha, monto: num(a.monto), metodo: a.metodo || '' })),
            canal: txt(cli.canal), nota: venta.nota || '',
            contacto: { telefono: txt(cli.telefono), email: txt(cli.email) },
          },
        },
      },
    });
    if (venta.estado === 'cancelado') throw new Error('Una venta nueva no nace cancelada');
    return { ventaId, clienteId: cid, ops };
  }

  // Un cambio de la pantalla de ventas (handleUpdate) → operaciones.
  // `venta` es la que tiene la pantalla (con id y version del documento).
  const PATCH_KEYS = new Set(['estado', 'items', 'subtotal', 'descuento', 'total', 'abonos', 'fecha', 'entrega', 'pay', 'nota']);
  function operacionesCambio(venta, patch, nuevoId) {
    const extra = Object.keys(patch).filter(k => !PATCH_KEYS.has(k));
    if (extra.length) throw new Error(`Cambio no soportado en la fusión: ${extra.join(', ')}`);
    const ops = [];
    const p = {};
    const commercial = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'estado')) {
      const s = patch.estado;
      if (s === 'cancelado') p.status = 'cancelled';
      else if (AVANCE.includes(s)) {
        if (venta.estado === 'cancelado') p.status = 'confirmed';
        p.legacyProductionState = s;
      } else throw new Error(`Estado desconocido: ${s}`);
    }
    if (patch.items) {
      if (patch.items.some(i => !i.tipoId && !i.lineId)) throw new Error('Cada servicio nuevo debe venir del catálogo');
      p.lines = patch.items.map(i => lineaDesdeItem(i, nuevoId));
    }
    ['subtotal', 'descuento', 'total'].forEach(k => { if (Object.prototype.hasOwnProperty.call(patch, k)) commercial[k] = num(patch[k]); });
    if (Object.prototype.hasOwnProperty.call(patch, 'pay')) commercial.pay = patch.pay || '';
    if (Object.prototype.hasOwnProperty.call(patch, 'nota')) commercial.nota = patch.nota || '';
    if (Object.prototype.hasOwnProperty.call(patch, 'fecha')) p.fecha = patch.fecha;
    if (Object.prototype.hasOwnProperty.call(patch, 'entrega')) p.entrega = patch.entrega || '';
    if (Object.keys(commercial).length) p.commercial = commercial;
    if (Object.keys(p).length) ops.push({ fn: 'loopaUpdateSale', data: { saleId: venta.id, patch: p, expectedVersion: venta.version } });
    // La pantalla «borra» un cobro filtrando la lista: en la fusión se anula.
    if (patch.abonos) {
      const quedan = new Set(patch.abonos.map(a => a.id));
      (venta.abonos || []).filter(a => !quedan.has(a.id)).forEach(a => ops.push({ fn: 'loopaRemovePayment', data: { saleId: venta.id, abonoId: a.id } }));
      const nuevos = patch.abonos.filter(a => !(venta.abonos || []).some(x => x.id === a.id));
      if (nuevos.length) throw new Error('Los cobros nuevos se registran con «Cobrar», no editando la lista');
    }
    return ops;
  }

  const operacionCobro = (venta, ab) => ({ fn: 'loopaAddPayment', data: { saleId: venta.id, abono: { id: ab.id, fecha: ab.fecha, monto: num(ab.monto), metodo: ab.metodo || '' } } });

  // «Eliminar venta» en la fusión es cancelarla (D16): nada se borra y su
  // trabajo de producción queda marcado, no desaparece.
  const operacionEliminar = (venta) => ({ fn: 'loopaUpdateSale', data: { saleId: venta.id, patch: { status: 'cancelled' }, expectedVersion: venta.version } });

  // aplicarCostosEnCurso: los costos nuevos también van a las ventas en curso
  // de ese producto (lo elige quien guarda; ver aplicarCostosAVentas).
  const operacionServicio = (s, { aplicarCostosEnCurso = false } = {}) => ({
    fn: 'loopaSaveService',
    data: { ...(aplicarCostosEnCurso ? { aplicarCostosEnCurso: true } : {}), service: { id: s.id, nombre: s.nombre, categoria: s.categoria, unidad: s.unidad, modelo: s.modelo, descripcion: s.descripcion || '', precio: num(s.precio), costo: num(s.costo), activo: s.activo !== false, recomendado: s.recomendado === true, ...(s.modelo === 'especial' ? { specialClientId: s.clienteIdEspecial || '' } : {}), ...(s.ficha ? { ficha: s.ficha } : {}), ...(s.clase ? { clase: s.clase } : {}), ...(s.item ? { item: s.item } : {}) } },
  });

  const operacionCliente = (c) => ({ fn: 'loopaSaveClient', data: { client: clienteParaServidor(c, c.id) } });

  // Ejecuta las operaciones EN ORDEN con `llamar(op)` (la función del servidor).
  // `progreso` recuerda cuántas ya se confirmaron: si una falla (sin red,
  // conflicto…), reintentar con LAS MISMAS operaciones y el MISMO progreso
  // retoma desde la que falló, sin repetir las anteriores ni generar ids
  // nuevos (repetir un updateSale ya hecho daría version_conflict).
  async function ejecutarOperaciones(ops, llamar, progreso = { hechas: 0, resultados: [] }) {
    if (!Array.isArray(progreso.resultados)) progreso.resultados = [];
    for (let i = progreso.hechas; i < ops.length; i += 1) {
      const r = await llamar(ops[i]);
      progreso.resultados[i] = r;
      progreso.hechas = i + 1;
    }
    return progreso.resultados;
  }

  return {
    UNCATALOGUED_SERVICE_ID, AVANCE, ejecutarOperaciones,
    ventaDesdeDoc, clienteDesdeDoc, servicioDesdeDoc,
    operacionesNuevaVenta, operacionesCambio, operacionCobro, operacionEliminar, operacionServicio, operacionCliente,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LoopaFusion;
