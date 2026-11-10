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
    workspace_forbidden: 'Tu cuenta no es miembro de un tablero de producción: pedile al admin que te agregue.',
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
      : tipo === 'permission-denied' ? 'Tu cuenta no tiene permiso para esto (¿está en el equipo comercial?).'
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
        if (detenida) break; // la pantalla que la creó ya no está (otra persona)
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
    let detenida = false;
    function procesar() {
      if (detenida) return Promise.resolve(resumen());
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

    // Al cerrar sesión o cambiar de persona: no se manda nada más desde esta
    // cola (lo pendiente queda guardado para cuando vuelva esa persona).
    const detener = () => { detenida = true; };

    return { encolar, procesar, reintentar, descartar, detener, estado: resumen, ocupada: () => !!corriendo, sesion, _estado: cargar };
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

  // ── Adaptador Firebase (tanda 3.4) ──────────────────────────────
  // Lee como el equipo comercial bajo las reglas (en borrador) y escribe
  // SÓLO llamando a las funciones del servidor. No importa el SDK: recibe
  // cuatro primitivas (las arma la app con el SDK compat, o las pruebas con
  // el modular), cada una devuelve objetos planos { id, ...datos }.
  //   leerDoc(col, id) → doc | null
  //   leerColeccion(col) → [doc]
  //   consultarIgual(col, campo, valor) → [doc]
  //   invocar(nombre, data) → resultado (lanza el HttpsError tal cual)
  //   escucharColeccion(col, alCambiar, alError) → dejar de escuchar (opcional)
  // Las fichas se piden por tablero de producción (las reglas dejan leer las
  // fichas de los tableros donde la persona es miembro).
  function adaptadorFirebase({ leerDoc, leerColeccion, consultarIgual, invocar, escucharColeccion }) {
    return {
      async leer() {
        const cfg = await leerDoc('loopa_config', 'production');
        const tableros = cfg && Array.isArray(cfg.allowedWorkspaceIds) ? [...new Set(cfg.allowedWorkspaceIds.filter(w => typeof w === 'string' && w))] : [];
        if (!tableros.length) throw Object.assign(new Error('Falta la configuración de producción (loopa_config/production)'), { code: 'failed-precondition', details: { code: 'config_missing' } });
        // Si la persona no es miembro de un tablero de producción, las reglas
        // rechazan esa consulta: se dice cuál, en vez de un «sin permiso» vago.
        const fichasDe = (w) => consultarIgual('frame_clients', 'workspaceId', w).catch((err) => {
          const t = normalizarError(err).tipo;
          if (t !== 'permission-denied') throw err;
          throw Object.assign(new Error(`No sos miembro del tablero de producción «${w}»`), { code: 'permission-denied', details: { code: 'workspace_forbidden' } });
        });
        const [sales, services, ...porTablero] = await Promise.all([
          leerColeccion('loopa_sales'),
          leerColeccion('loopa_services'),
          ...tableros.map(fichasDe),
        ]);
        // Una ficha no aparece dos veces aunque dos tableros la devolvieran.
        const vistos = new Set();
        const clients = porTablero.flat().filter(c => (vistos.has(c.id) ? false : vistos.add(c.id)));
        return { sales, services, clients };
      },
      async llamar(op) { return invocar(op.fn, op.data); },
      // Ventas en vivo: lo que hace el disparador (producción) y lo que
      // cambian otras personas aparece sin recargar.
      escucharVentas: typeof escucharColeccion === 'function' ? (alCambiar, alError) => escucharColeccion('loopa_sales', alCambiar, alError) : null,
    };
  }

  // ── Gastos y configuración comercial en FRAME (tanda 3.8) ──────────
  // En FRAME cada gasto es un documento (loopa_expenses/{id}, kind variable o
  // fixed) y la configuración es loopa_config/main. LOOPA los maneja como
  // siempre ({ variables, fijos } y un objeto de configuración); estas
  // funciones traducen y calculan qué escribir (sólo lo que cambió).
  const texto = (v, def = '') => (typeof v === 'string' ? v : v == null ? def : String(v));
  const monto = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  function docDeGasto(g, kind) {
    const base = { id: texto(g && g.id), kind };
    return kind === 'fixed'
      ? { ...base, concepto: texto(g.concepto), categoria: texto(g.categoria, 'Otro') || 'Otro', monto: monto(g.monto), activo: g.activo !== false, nota: texto(g.nota) }
      : { ...base, fecha: texto(g.fecha), concepto: texto(g.concepto), categoria: texto(g.categoria, 'Otro') || 'Otro', monto: monto(g.monto), nota: texto(g.nota) };
  }
  function gastosDeDocs(docs) {
    const variables = [];
    const fijos = [];
    (docs || []).forEach(d => {
      if (!d || typeof d.id !== 'string' || !d.id) return;
      const { kind, ...g } = docDeGasto(d, d.kind === 'fixed' ? 'fixed' : 'variable');
      if (d.kind === 'fixed') fijos.push(g);
      else if (d.kind === 'variable') variables.push(g);
    });
    variables.sort((a, b) => (b.fecha < a.fecha ? -1 : b.fecha > a.fecha ? 1 : a.id < b.id ? -1 : 1));
    fijos.sort((a, b) => (a.id < b.id ? -1 : 1));
    return { variables, fijos };
  }
  const mapaGastos = (g) => {
    const m = {};
    ((g && g.variables) || []).forEach(x => { if (x && x.id) m[x.id] = docDeGasto(x, 'variable'); });
    ((g && g.fijos) || []).forEach(x => { if (x && x.id) m[x.id] = docDeGasto(x, 'fixed'); });
    return m;
  };
  // servidor: lo último que se leyó de FRAME; local: lo que hay en pantalla.
  function cambiosGastos(servidor, local) {
    const s = mapaGastos(servidor);
    const l = mapaGastos(local);
    const escribir = Object.keys(l).filter(id => !s[id] || JSON.stringify(s[id]) !== JSON.stringify(l[id])).map(id => l[id]);
    const borrar = Object.keys(s).filter(id => !l[id]);
    return { escribir, borrar };
  }
  const CLAVES_CONFIG = ['payConfig', 'categorias', 'canales', 'gastoTipos', 'moneda'];
  function configDeDoc(doc) {
    const out = {};
    CLAVES_CONFIG.forEach(k => { if (doc && doc[k] !== undefined) out[k] = doc[k]; });
    return out;
  }
  // Sólo las claves comerciales que cambiaron (null si nada).
  function cambioConfig(servidor, local) {
    const p = {};
    CLAVES_CONFIG.forEach(k => {
      if (local && local[k] !== undefined && JSON.stringify(local[k]) !== JSON.stringify((servidor || {})[k])) p[k] = local[k];
    });
    return Object.keys(p).length ? p : null;
  }

  // De dónde salen los datos (tanda 3.7). Nunca cae a la app de siempre si
  // se pidió la fusión y no se puede: 'no-disponible' muestra un aviso.
  //   null           la app de siempre (colección «loopa» de tooned-os)
  //   'real'         FRAME (frame-studio-3a18f): ?datos=fusion&servidor=real,
  //                  o siempre después del corte (build con LOOPA_FUSION_REAL)
  //   'emulador'     emuladores de este equipo (?servidor=emulador)
  //   'local'        servidor local de pruebas (sólo ?datos=fusion)
  function modoDatos({ search = '', hostname = '', corte = false, conSdk = false } = {}) {
    const q = new URLSearchParams(search);
    if (q.get('datos') !== 'fusion' && corte !== true) return null;
    if (corte === true || q.get('servidor') === 'real') return conSdk ? 'real' : 'no-disponible';
    // local y emulador: sólo en este equipo.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return 'no-disponible';
    if (q.get('servidor') !== 'emulador') return 'local';
    return conSdk ? 'emulador' : 'no-disponible';
  }

  return { armarDatos, crearCola, normalizarError, adaptadorHttp, adaptadorFirebase, modoDatos, gastosDeDocs, cambiosGastos, configDeDoc, cambioConfig, CLAVE };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LoopaFuente;
