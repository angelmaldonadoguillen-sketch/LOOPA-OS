// ═══════════════════════════════════════════════════════════════
// LOOPA OS · Fuente de datos de la fusión (Fase 3, tanda 3.3)
//
// Lo que necesitan las pantallas para trabajar con el modelo nuevo:
//
//   armarDatos(docs)  documentos leídos (loopa_sales, frame_clients,
//                     loopa_services) → ventas, clientes y servicios con la
//                     forma de siempre (usa LoopaFusion).
//   crearCola(...)    cola PERSISTENTE de cambios: cada acción de la pantalla
//                     se guarda como una lista fija de operaciones y se manda
//                     al servidor en orden. Si algo falla (sin red, conflicto)
//                     la cola se detiene ahí, sobrevive a recargar la página y
//                     se reintenta con LAS MISMAS operaciones (mismos ids).
//
// Sin Firebase, sin DOM: el que llama inyecta `llamar` (la función del
// servidor) y `almacen` (localStorage o un objeto en pruebas). Se prueba con
// Node en integracion/test/fuente.test.cjs.
// ═══════════════════════════════════════════════════════════════

const LoopaFuente = (function () {
  const F = (typeof LoopaFusion !== 'undefined') ? LoopaFusion
    : (typeof require === 'function' ? require('./fusion.js') : null);

  // ── Lectura ────────────────────────────────────────────────────
  function armarDatos(docs) {
    const d = docs || {};
    const ventas = (d.sales || []).map(F.ventaDesdeDoc).filter(Boolean).sort((a, b) => b.n - a.n);
    const clientes = (d.clients || []).map(F.clienteDesdeDoc)
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
    const servicios = (d.services || []).filter(s => s.id !== F.UNCATALOGUED_SERVICE_ID).map(F.servicioDesdeDoc);
    return { ventas, clientes, servicios };
  }

  // ── Errores ────────────────────────────────────────────────────
  // Lo que devuelve `llamar` al fallar: un HttpsError de Firebase
  // ({ code: 'functions/aborted', message, details: { code } }), un error de
  // red (TypeError de fetch) u otro. Se reduce a { tipo, codigo, mensaje,
  // transitorio }: transitorio = vale la pena reintentar igual ('internal'
  // incluido: el SDK de Firebase reporta así algunos cortes de red; la
  // pantalla limita los reintentos automáticos y siempre deja descartar).
  const TRANSITORIOS = ['unavailable', 'deadline-exceeded', 'resource-exhausted', 'internal', 'red'];
  const RED = /failed to fetch|fetch failed|networkerror|network error|load failed|network request failed/i;
  const MENSAJES = {
    version_conflict: 'Otra persona cambió esta venta mientras tanto. Descartá este cambio y volvé a hacerlo sobre lo último.',
    client_unknown: 'La ficha del cliente no está en los tableros de producción.',
    service_unknown: 'Un servicio de la venta no está en el catálogo (o está inactivo).',
    service_not_for_client: 'Ese acuerdo especial es de otro cliente.',
    config_missing: 'Falta la configuración de producción en el servidor.',
    payment_conflict: 'Ya hay otro cobro con ese id.',
    payment_exceeds_total: 'El cobro supera el saldo de la venta.',
    sale_cancelled: 'La venta está cancelada: reactivala antes de cambiarla.',
    invalid_transition: 'Ese cambio de estado no está permitido.',
  };
  function normalizarError(err) {
    const e = err || {};
    let tipo = typeof e.code === 'string' ? e.code.replace(/^functions\//, '') : '';
    // Sólo un error de red es «red»; un TypeError de un error de programación no.
    if (!tipo && RED.test(String(e.message || ''))) tipo = 'red';
    if (!tipo) tipo = 'internal';
    const codigo = (e.details && typeof e.details.code === 'string') ? e.details.code : '';
    // 'aborted' es transitorio sólo por contención (código 'aborted'); un
    // version_conflict o un id repetido no se arreglan reintentando.
    const transitorio = TRANSITORIOS.includes(tipo) || (tipo === 'aborted' && codigo === 'aborted');
    const base = tipo === 'red' || tipo === 'unavailable' ? 'Sin conexión con el servidor. Se reintenta solo.'
      : tipo === 'permission-denied' ? 'Tu cuenta no tiene permiso para este cambio.'
      : tipo === 'unauthenticated' ? 'Tu sesión se cerró: volvé a iniciar sesión.'
      : '';
    const mensaje = MENSAJES[codigo] || base || String(e.message || 'Error del servidor').slice(0, 300);
    return { tipo, codigo, mensaje, transitorio };
  }

  // ── Cola persistente ───────────────────────────────────────────
  // El ALMACÉN es la fuente de verdad (no una copia en memoria): cada cambio
  // relee, modifica y escribe. Así dos pestañas comparten la misma cola sin
  // pisarse lo que encola la otra. Sólo una a la vez la ejecuta: `exclusivo`
  // (en el navegador, navigator.locks) envuelve cada corrida.
  const CLAVE = 'loopa-fusion-cola';
  const MAX_SALTOS = 500;
  const VIGENCIA_MS = 10 * 60 * 1000;
  // Operaciones que cambian la versión de una venta: llevan opId para que el
  // servidor reconozca un reintento (respuesta perdida) y no lo repita.
  const CON_OP_ID = ['loopaUpdateSale', 'loopaAddPayment', 'loopaRemovePayment'];
  const AVANZA = ['updated', 'added', 'removed', 'existing'];
  const vacio = () => ({ entradas: [], cadena: {}, seq: 0 });
  const azar = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
  const mutexLocal = () => { let cola = Promise.resolve(); return (fn) => { const r = cola.then(fn, fn); cola = r.catch(() => {}); return r; }; };

  // Cadena de versiones: cada cambio confirmado anota el salto «v → v'» que
  // hizo en la venta, con la SESIÓN (carga de página) que lo encoló. Una
  // operación encolada con la versión vieja sigue la cadena sólo por saltos
  // de su MISMA sesión: lo que esa pantalla ya mostraba (optimista) cuando se
  // armó. Un cambio de otra persona, de otra pestaña o de antes de recargar no
  // está en esa cadena y el servidor responde version_conflict, como debe.
  function crearCola({ llamar, almacen, clave = CLAVE, alCambiar, alConfirmar, alVaciarse, ahora = () => new Date().toISOString(), nuevoId = azar, exclusivo = mutexLocal(), sesion = `S-${azar()}` } = {}) {
    if (typeof llamar !== 'function') throw new Error('crearCola necesita llamar(op)');
    let memo = vacio();
    let sinPersistencia = !almacen;

    const valido = (p) => p && Array.isArray(p.entradas) && p.entradas.every(x => x && typeof x.id === 'string' && Array.isArray(x.ops));
    function cargar() {
      if (sinPersistencia) return memo;
      try {
        const raw = almacen.leer(clave);
        const p = raw ? JSON.parse(raw) : vacio();
        if (valido(p)) memo = { entradas: p.entradas, cadena: p.cadena && typeof p.cadena === 'object' ? p.cadena : {}, seq: Number.isInteger(p.seq) ? p.seq : 0 };
      } catch (e) { /* ilegible: se sigue con lo último conocido */ }
      return memo;
    }
    function podar(st) {
      // Saltos de sesiones sin nada pendiente ya no le sirven a nadie; pero
      // otra pestaña abierta (otra sesión) puede seguir usando los suyos un
      // rato aunque no tenga nada en la cola: se guardan VIGENCIA_MS.
      const vivas = new Set([sesion, ...st.entradas.map(x => x.sesion)]);
      const ahoraMs = Date.parse(ahora());
      const vigente = (x) => vivas.has(x.sesion) || (Number.isFinite(ahoraMs) && ahoraMs - Date.parse(x.ts) < VIGENCIA_MS);
      Object.keys(st.cadena).forEach(saleId => {
        const c = st.cadena[saleId];
        Object.keys(c).forEach(v => { if (!c[v] || typeof c[v] !== 'object' || !vigente(c[v])) delete c[v]; });
        if (!Object.keys(c).length) delete st.cadena[saleId];
      });
    }
    function mutar(fn) {
      const st = cargar();
      const r = fn(st);
      podar(st);
      memo = st;
      if (!sinPersistencia) {
        try { almacen.escribir(clave, JSON.stringify(st)); } catch (e) { sinPersistencia = true; }
      }
      return r;
    }
    const seguro = (f, ...a) => { try { if (f) f(...a); } catch (e) { /* la pantalla no frena la cola */ } };
    function resumen() {
      const st = cargar();
      const primera = st.entradas[0];
      return {
        pendientes: st.entradas.length,
        error: primera && primera.error ? { ...primera.error, etiqueta: primera.etiqueta, id: primera.id, intentos: primera.intentos || 0 } : null,
        etiquetas: st.entradas.map(x => x.etiqueta),
        sinPersistencia,
      };
    }
    const avisar = () => seguro(alCambiar, resumen());

    function anotarSalto(st, entrada, r) {
      if (!r || typeof r.saleId !== 'string' || !AVANZA.includes(r.status)) return;
      let from = r.from, to = r.to;
      if (!Number.isInteger(from) && r.status !== 'existing' && Number.isInteger(r.version)) { from = r.version - 1; to = r.version; }
      if (!Number.isInteger(from) || !Number.isInteger(to) || to === from) return;
      const c = st.cadena[r.saleId] || (st.cadena[r.saleId] = {});
      c[String(from)] = { to, sesion: entrada.sesion, ts: ahora() };
    }
    // La operación GUARDADA no cambia; sólo lo que se manda al servidor.
    function preparar(st, entrada, op) {
      const d = op.data || {};
      if (typeof d.saleId !== 'string' || !Number.isInteger(d.expectedVersion)) return op;
      const c = st.cadena[d.saleId] || {};
      let v = d.expectedVersion;
      for (let i = 0; i < MAX_SALTOS; i += 1) {
        const s = c[String(v)];
        if (!s || s.sesion !== entrada.sesion) break;
        v = s.to;
      }
      return v === d.expectedVersion ? op : { fn: op.fn, data: { ...d, expectedVersion: v } };
    }

    async function correr() {
      let hizo = false;
      for (;;) {
        const st = cargar();
        const e = st.entradas[0];
        if (!e || e.error) break;
        const i = e.progreso.hechas;
        let r;
        try {
          r = await llamar(preparar(st, e, e.ops[i]));
        } catch (err) {
          mutar(s => {
            const x = s.entradas.find(y => y.id === e.id);
            if (!x) return;
            x.intentos = (x.intentos || 0) + 1;
            x.error = { ...normalizarError(err), en: i, ts: ahora() };
          });
          avisar();
          break;
        }
        // El progreso se anota ANTES de la próxima llamada.
        const terminada = mutar(s => {
          const x = s.entradas.find(y => y.id === e.id);
          if (!x || x.progreso.hechas !== i) return null; // descartada o hecha por otra pestaña
          anotarSalto(s, x, r);
          x.progreso.resultados[i] = r === undefined ? null : r;
          x.progreso.hechas = i + 1;
          x.intentos = 0;
          if (x.progreso.hechas < x.ops.length) return null;
          s.entradas = s.entradas.filter(y => y.id !== x.id);
          return x;
        });
        if (terminada) {
          hizo = true;
          avisar();
          seguro(alConfirmar, terminada, terminada.progreso.resultados);
        }
      }
      return hizo;
    }

    let corriendo = null;
    let otraVez = false;
    function procesar() {
      if (corriendo) { otraVez = true; return corriendo; }
      corriendo = Promise.resolve(exclusivo(async () => {
        let hizo = false;
        do { otraVez = false; hizo = (await correr()) || hizo; } while (otraVez);
        return hizo;
      })).catch(() => false).then(hizo => {
        corriendo = null;
        if (hizo && !cargar().entradas.length) seguro(alVaciarse);
        return resumen();
      });
      return corriendo;
    }

    function encolar({ etiqueta, ops, id }) {
      if (!Array.isArray(ops) || !ops.length) throw new Error('Nada que guardar');
      const conId = ops.map(op => (CON_OP_ID.includes(op.fn) && op.data && !op.data.opId ? { fn: op.fn, data: { ...op.data, opId: `op-${nuevoId()}`.slice(0, 64) } } : op));
      const entradaId = id || `Q-${nuevoId()}`;
      mutar(st => {
        if (st.entradas.some(x => x.id === entradaId)) return; // ya encolada (doble clic)
        st.seq += 1;
        st.entradas.push({ id: entradaId, etiqueta: String(etiqueta || 'Cambio'), ops: conId, progreso: { hechas: 0, resultados: [] }, error: null, intentos: 0, sesion, orden: st.seq, creada: ahora() });
      });
      avisar();
      procesar();
      return entradaId;
    }

    // Reintentar la que falló: mismas operaciones, desde la que falló.
    function reintentar() {
      mutar(st => { if (st.entradas[0] && st.entradas[0].error) st.entradas[0].error = null; });
      avisar();
      return procesar();
    }

    // Descartar la que falló — sólo si es ESA (la que la persona vio): las que
    // ya se confirmaron de esa acción quedan hechas; la pantalla recarga.
    function descartar(id) {
      const e = mutar(st => {
        const x = st.entradas[0];
        if (!x || !x.error || (id !== undefined && x.id !== id)) return null;
        st.entradas.shift();
        return x;
      });
      if (!e) return null;
      avisar();
      procesar();
      return e;
    }

    return { encolar, procesar, reintentar, descartar, estado: resumen, ocupada: () => !!corriendo, sesion, _estado: cargar };
  }

  // ── Adaptador HTTP (servidor local de integracion/servidor-local) ──
  // Mismo contrato que una función onCall: { data } → { result } o
  // { error: { status, message, details } }. `fetchFn` se inyecta (el del
  // navegador, o el de Node en las pruebas).
  function adaptadorHttp(fetchFn, base = '') {
    const json = async (r) => { try { return await r.json(); } catch (e) { return null; } };
    return {
      async leer() {
        const r = await fetchFn(`${base}/api/datos`, { cache: 'no-store' });
        const b = await json(r);
        if (!r.ok || !b) throw Object.assign(new Error((b && b.error && b.error.message) || `HTTP ${r.status}`), { code: r.status >= 500 || !b ? 'unavailable' : 'internal' });
        return b;
      },
      async llamar(op) {
        const r = await fetchFn(`${base}/api/fn/${encodeURIComponent(op.fn)}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: op.data }),
        });
        const b = await json(r);
        if (r.ok && b && Object.prototype.hasOwnProperty.call(b, 'result')) return b.result;
        const e = (b && b.error) || {};
        throw Object.assign(new Error(e.message || `HTTP ${r.status}`), {
          code: typeof e.status === 'string' ? e.status : (r.status >= 500 || !b ? 'unavailable' : 'internal'),
          ...(e.details ? { details: e.details } : {}),
        });
      },
    };
  }

  return { armarDatos, crearCola, normalizarError, adaptadorHttp, CLAVE };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LoopaFuente;
