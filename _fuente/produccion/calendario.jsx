// ═══════════════════════════════════════════════════════════════
// LOOPA OS · Producción — calendario (Fase 2, tanda 1)
//
// Vista de SÓLO LECTURA del trabajo del equipo, con la identidad de LOOPA.
// La lógica (qué día va cada tarea, urgencias, progreso) sale del núcleo
// portado de FRAME (nucleo.js), verificado con pruebas de paridad.
//
// Bandera (se recuerda en este navegador):
//   ?produccion=demo   datos de ejemplo generados por el planificador
//   ?produccion=1      datos reales (se conectan en la Fase 3)
//   ?produccion=0      apaga el módulo (también off / false / no)
// Cualquier otro valor se ignora. Sin bandera, el módulo no aparece.
// ═══════════════════════════════════════════════════════════════

const PROD_FLAG = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get('produccion');
    if (q !== null) {
      const v = q.trim().toLowerCase();
      const on = v === 'demo' ? 'demo' : (v === '' || v === '1') ? '1' : null;
      const off = ['0', 'off', 'false', 'no'].includes(v);
      if (on) window.localStorage.setItem('loopa-flag-produccion', on);
      else if (off) window.localStorage.setItem('loopa-flag-produccion', '0');
    }
    const stored = window.localStorage.getItem('loopa-flag-produccion');
    return stored === 'demo' || stored === '1' ? stored : null;
  } catch (e) {
    return null;
  }
})();

const PROD_DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const prodCapital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const prodFecha = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const prodMesLabel = (y, m) => prodCapital(new Date(y, m, 1).toLocaleDateString('es-HN', { month: 'long', year: 'numeric' }));
const prodDiaLabel = (iso) => (LoopaProduccion.isDay(iso)
  ? prodCapital(prodFecha(iso).toLocaleDateString('es-HN', { weekday: 'long', day: 'numeric', month: 'long' }))
  : `Fecha inválida (${iso})`);
const prodCorto = (iso, conAnio = false) => (LoopaProduccion.isDay(iso)
  ? prodFecha(iso).toLocaleDateString('es-HN', conAnio ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: '2-digit', month: 'short' })
  : iso);
const prodSemanaLabel = (dias) => {
  const a = dias[0], b = dias[6];
  return a.slice(0, 4) === b.slice(0, 4)
    ? `${prodCorto(a)} – ${prodCorto(b)}, ${a.slice(0, 4)}`
    : `${prodCorto(a, true)} – ${prodCorto(b, true)}`;
};

function prodEstadoLabel(status, columnas) {
  const c = (columnas || []).find(x => x.id === status) || LoopaProduccion.STATUSES.find(x => x.id === status);
  return c ? c.label : status;
}

// Lo que muestra la tarjeta sobre la fecha límite (el compromiso).
function prodVence(t, hoy, columnas) {
  if (!t.deadline) return null;
  if (!LoopaProduccion.isDay(t.deadline)) return { txt: 'Entrega con fecha inválida', tono: 'alerta' };
  if (LoopaProduccion.isClosed(t, columnas)) return { txt: `Entrega ${prodCorto(t.deadline)}`, tono: 'ok' };
  const d = LoopaProduccion.daysUntil(t.deadline, hoy);
  if (d < 0) return { txt: `Vencida hace ${-d} d`, tono: 'alerta' };
  if (d === 0) return { txt: 'Entrega hoy', tono: 'alerta' };
  if (d <= LoopaProduccion.URGENT_DAYS) return { txt: `Entrega en ${d} d`, tono: 'aviso' };
  return { txt: `Entrega ${prodCorto(t.deadline)}`, tono: '' };
}

// Número de venta: enlace a la venta real, o texto en los datos de ejemplo
// (sus números son ficticios y podrían coincidir con una venta real).
function ProdVenta({ venta, enlazar, onAbrirVenta, conEstado }) {
  if (!venta) return null;
  return (
    <>
      {enlazar
        ? <button className="pr-link" onClick={() => onAbrirVenta(venta.n)}>#{venta.n}</button>
        : <span className="pr-venta">#{venta.n} · venta de ejemplo</span>}
      {conEstado && venta.cancelled && <span className="pr-venta cancelada" style={{ marginLeft: 8 }}>Venta cancelada · revisar</span>}
    </>
  );
}

function ProdTarjeta({ t, hoy, columnas, onAbrir, compacta }) {
  const pct = LoopaProduccion.progressOf(t);
  const vence = prodVence(t, hoy, columnas);
  const venta = LoopaProduccion.saleLinkOf(t);
  const cerrada = LoopaProduccion.isClosed(t, columnas);
  return (
    <button data-id={t.id} className={`pr-card ${cerrada ? 'cerrada' : ''} ${compacta ? 'compacta' : ''}`} onClick={(e) => onAbrir(t, e.currentTarget)}
      aria-label={`${t.client || 'Sin cliente'}: ${t.title}${vence ? `, ${vence.txt}` : ''}`}>
      <span className="pr-card-cliente">{t.client || 'Sin cliente'}</span>
      {!compacta && <span className="pr-card-titulo">{t.title}</span>}
      {t.checklist.length > 0 && (
        <span className="pr-card-avance" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      )}
      <span className="pr-card-pie">
        {vence && <span className={`pr-vence ${vence.tono}`}>{vence.txt}</span>}
        {venta && <span className={`pr-venta ${venta.cancelled ? 'cancelada' : ''}`}>#{venta.n}</span>}
      </span>
    </button>
  );
}


// Ficha lateral modal: el foco entra al abrir, queda atrapado adentro y
// vuelve a la tarjeta al cerrar (Escape, botón o clic afuera). Con
// `onCambiar` es editable; cada cambio pasa por las reglas del núcleo
// (applyTaskPatch) y un rechazo se muestra acá, sin tocar la tarea.
function ProdDetalle({ t, hoy, columnas, origen, onCerrar, onAbrirVenta, enlazarVentas, onCambiar, onAbrirCliente }) {
  const pct = LoopaProduccion.progressOf(t);
  const venta = LoopaProduccion.saleLinkOf(t);
  const vence = prodVence(t, hoy, columnas);
  const editable = typeof onCambiar === 'function';
  const deVenta = t.sourceSystem === 'loopa';
  const [error, setError] = useState(null);
  const [nuevo, setNuevo] = useState('');
  const panel = useRef(null);
  const cerrarBtn = useRef(null);
  useEffect(() => {
    if (cerrarBtn.current) cerrarBtn.current.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCerrar(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const focos = [...panel.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled);
      if (!focos.length) return;
      const primero = focos[0], ultimo = focos[focos.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      // Si la tarjeta se volvió a montar (cambió de columna o de día), se
      // busca por id para devolverle el foco.
      if (origen && document.contains(origen)) origen.focus();
      else {
        const nueva = document.querySelector(`.pr-card[data-id="${CSS.escape(t.id)}"]`);
        if (nueva) nueva.focus();
      }
    };
  }, [onCerrar, origen]);

  const cambiar = (patch) => {
    const r = onCambiar(patch);
    setError(r && !r.ok ? r.error.message : null);
    return r;
  };
  const agregar = () => {
    if (!nuevo.trim()) return;
    const r = cambiar(LoopaProduccion.addChecklistItem(t, nuevo, `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`));
    if (r && r.ok) setNuevo('');
  };
  const cols = LoopaProduccion.boardColumns(columnas, [t]);
  const tituloId = `pr-detalle-${t.id}`;

  return (
    <div className="pr-detalle-fondo" onMouseDown={onCerrar}>
      <aside ref={panel} className="pr-detalle" role="dialog" aria-modal="true" aria-labelledby={tituloId} onMouseDown={e => e.stopPropagation()}>
        <div className="pr-detalle-cab">
          <div>
            <div className="page-kicker">{t.client || 'Sin cliente'}</div>
            <div className="pr-detalle-titulo" id={tituloId}>{t.title}</div>
          </div>
          <button ref={cerrarBtn} className="icon-btn" onClick={onCerrar} aria-label="Cerrar"><Icon name="x" size={14} /></button>
        </div>
        {error && <div className="pr-error" role="alert">{error}</div>}
        <dl className="pr-datos">
          <div><dt>Estado</dt><dd>
            {editable
              ? <select className="pr-campo" value={t.status} onChange={e => cambiar({ status: e.target.value })} aria-label="Estado">
                  {cols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              : prodEstadoLabel(t.status, columnas)}
          </dd></div>
          {editable && (
            <div><dt>Prioridad</dt><dd>
              <select className="pr-campo" value={t.priority} onChange={e => cambiar({ priority: e.target.value })} aria-label="Prioridad">
                {LoopaProduccion.PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </dd></div>
          )}
          <div><dt>Día de trabajo</dt><dd>
            {editable
              ? <input className="pr-campo" type="date" value={LoopaProduccion.calendarDateOf(t)} onChange={e => e.target.value && cambiar({ sessionDate: e.target.value })} aria-label="Día de trabajo" style={{ colorScheme: 'dark' }} />
              : prodDiaLabel(LoopaProduccion.calendarDateOf(t))}
          </dd></div>
          <div><dt>Entrega</dt><dd className={vence ? vence.tono : ''}>
            {editable && !deVenta
              ? <input className="pr-campo" type="date" value={t.deadline || ''} onChange={e => cambiar({ deadline: e.target.value })} aria-label="Entrega" style={{ colorScheme: 'dark' }} />
              : (t.deadline ? `${prodDiaLabel(t.deadline)}${vence && vence.tono ? ` · ${vence.txt}` : ''}` : '—')}
            {editable && deVenta && <div className="pr-ayuda">La fija la venta: reprogramar mueve el día de trabajo, no la entrega.</div>}
          </dd></div>
          {t.clientId && onAbrirCliente && (
            <div><dt>Cliente</dt><dd><button className="pr-link" onClick={() => onAbrirCliente(t.clientId)}>Ver ficha de {t.client || 'cliente'}</button></dd></div>
          )}
          {venta && (
            <div><dt>Venta</dt><dd>
              <ProdVenta venta={venta} enlazar={enlazarVentas} onAbrirVenta={onAbrirVenta} conEstado />
            </dd></div>
          )}
        </dl>
        {(t.checklist.length > 0 || editable) && (
          <div className="pr-checklist">
            <div className="pr-checklist-cab"><span>Entregables</span><span className="mono">{pct}%</span></div>
            <ul>
              {t.checklist.map(c => (
                <li key={c.id} className={c.done ? 'hecho' : ''}>
                  {editable
                    ? <label className="pr-check-label">
                        <input type="checkbox" checked={c.done} onChange={() => cambiar(LoopaProduccion.toggleChecklistItem(t, c.id))} />
                        <span>{c.text}</span>
                      </label>
                    : <>
                        <span className="pr-check" aria-hidden="true">{c.done ? <Icon name="check" size={11} /> : null}</span>
                        <span>{c.text}{c.done ? <span className="pr-sr"> (hecho)</span> : null}</span>
                      </>}
                </li>
              ))}
            </ul>
            {editable && (
              <form className="pr-agregar" onSubmit={e => { e.preventDefault(); agregar(); }}>
                <input className="pr-campo" value={nuevo} onChange={e => setNuevo(e.target.value)} placeholder="Agregar entregable…" aria-label="Nuevo entregable" maxLength={200} />
                <button className="btn sm" type="submit" disabled={!nuevo.trim()}>Agregar</button>
              </form>
            )}
          </div>
        )}
        <div className="pr-nota">{editable
          ? 'Datos de ejemplo: los cambios se aplican con las reglas reales, pero no se guardan (se pierden al recargar). La conexión con los datos del equipo llega en la Fase 3.'
          : 'Vista de sólo lectura.'}</div>
      </aside>
    </div>
  );
}

function ProduccionCalendario({ tareas, columnas, hoy, onAbrir }) {
  // Una sola fecha de referencia para mes y semana (como FRAME): cambiar de
  // vista no salta a otro período.
  const [ancla, setAncla] = useState(hoy);
  const [modo, setModo] = useState('mes');
  const normalizadas = useMemo(() => tareas.map(t => LoopaProduccion.normalizeTask(t, hoy)), [tareas, hoy]);
  const porDia = useMemo(() => LoopaProduccion.tasksByDate(normalizadas), [normalizadas]);
  const ay = Number(ancla.slice(0, 4)), am = Number(ancla.slice(5, 7)) - 1;
  const dias = modo === 'mes' ? LoopaProduccion.monthGrid(ay, am) : LoopaProduccion.weekOf(ancla);
  const mesActual = ancla.slice(0, 7);
  const visibles = dias.filter(iso => modo === 'semana' || iso.startsWith(mesActual)).reduce((n, iso) => n + (porDia[iso] || []).length, 0);
  const atencion = normalizadas.filter(t => LoopaProduccion.needsAttention(t, hoy, columnas)).length;

  // Siempre desde el valor vigente (actualización funcional): dos clics
  // seguidos avanzan dos períodos aunque React no haya vuelto a dibujar.
  const mover = (k) => {
    if (modo === 'mes') {
      setAncla(a => {
        const d = new Date(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1 + k, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      });
    } else setAncla(a => LoopaProduccion.addDays(a, 7 * k));
  };
  const titulo = modo === 'mes' ? prodMesLabel(ay, am) : prodSemanaLabel(dias);

  return (
    <div className="pr">
      <div className="pr-barra">
        <div className="pr-nav">
          <button className="icon-btn" onClick={() => mover(-1)} aria-label={modo === 'mes' ? 'Mes anterior' : 'Semana anterior'}><Icon name="arrow-l" size={13} /></button>
          <div className="pr-titulo" aria-live="polite">{titulo}</div>
          <button className="icon-btn" onClick={() => mover(1)} aria-label={modo === 'mes' ? 'Mes siguiente' : 'Semana siguiente'}><Icon name="arrow-r" size={13} /></button>
          <button className="btn sm" onClick={() => setAncla(hoy)}>Hoy</button>
        </div>
        <div className="pr-nav">
          {atencion > 0 && <span className="pr-vence alerta">{atencion} con entrega próxima o vencida</span>}
          <div className="pr-modos" role="group" aria-label="Período del calendario">
            <button aria-pressed={modo === 'mes'} className={modo === 'mes' ? 'on' : ''} onClick={() => setModo('mes')}>Mes</button>
            <button aria-pressed={modo === 'semana'} className={modo === 'semana' ? 'on' : ''} onClick={() => setModo('semana')}>Semana</button>
          </div>
        </div>
      </div>
      {visibles === 0 && <div className="pr-vacio">Sin trabajo programado en este {modo === 'mes' ? 'mes' : 'período'}.</div>}
      <div className={`pr-grilla ${modo}`}>
        {PROD_DIAS.map(d => <div key={d} className="pr-dow" aria-hidden="true">{d}</div>)}
        {dias.map(iso => {
          const lista = porDia[iso] || [];
          const fuera = modo === 'mes' && !iso.startsWith(mesActual);
          return (
            <div key={iso} className={`pr-dia ${fuera ? 'fuera' : ''} ${iso === hoy ? 'hoy' : ''} ${lista.length ? 'con' : ''}`}>
              <div className="pr-dia-num"><span className="pr-dia-larga">{prodDiaLabel(iso)}</span><span className="pr-dia-corta">{Number(iso.slice(8))}</span></div>
              {lista.map(t => <ProdTarjeta key={t.id} t={t} hoy={hoy} columnas={columnas} onAbrir={onAbrir} compacta={modo === 'mes' && lista.length > 2} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Fuente de datos de ejemplo EN MEMORIA: aplica las reglas reales del núcleo
// pero no persiste nada. Mismo contrato que tendrá la fuente real (Fase 3):
// tareas + cambiar(id, patch) → { ok, error }.
function useFuenteDemo(datos) {
  const [tareas, setTareas] = useState(() => (datos ? datos.tareas : []));
  useEffect(() => { setTareas(datos ? datos.tareas : []); }, [datos]);
  const ref = useRef(tareas);
  ref.current = tareas;
  const cambiar = useCallback((id, patch) => {
    const actual = ref.current.find(t => t.id === id);
    if (!actual) return { ok: false, error: { code: 'not_found', message: 'La tarea ya no existe' } };
    const r = LoopaProduccion.applyTaskPatch(LoopaProduccion.normalizeTask(actual, datos.hoy), patch, datos.columnas);
    if (r.ok) {
      const next = ref.current.map(t => (t.id === id ? r.task : t));
      ref.current = next;
      setTareas(next);
    }
    return r;
  }, [datos]);
  // Enlazar una tarea vieja a su ficha de cliente (resolver homónimos).
  const enlazar = useCallback((id, cliente, clientes) => {
    const actual = ref.current.find(t => t.id === id);
    if (!actual) return { ok: false, error: { code: 'not_found', message: 'La tarea ya no existe' } };
    const r = LoopaProduccion.linkTaskToClient(LoopaProduccion.normalizeTask(actual, datos.hoy), cliente, clientes);
    if (r.ok) {
      const next = ref.current.map(t => (t.id === id ? r.task : t));
      ref.current = next;
      setTareas(next);
    }
    return r;
  }, [datos]);
  return { tareas, cambiar, enlazar };
}

// Módulo completo: decide de dónde salen los datos y qué vista se muestra.
function ProduccionModulo({ modo, onAbrirVenta }) {
  const [estado, setEstado] = useState({ cargando: modo === 'demo', datos: null, error: null });
  const [vista, setVista] = useState(() => {
    try { const v = localStorage.getItem('loopa-produccion-vista'); return ['tablero', 'resumen'].includes(v) ? v : 'calendario'; } catch (e) { return 'calendario'; }
  });
  // Rutina de ejemplo en memoria: al cargar se aplica el cambio de día del
  // núcleo (historial + deuda), igual que FRAME al abrir el tablero.
  const [rutina, setRutina] = useState(null);
  // Fichas de cliente de ejemplo (portal publicado o no) y la que está abierta.
  const [clientes, setClientes] = useState([]);
  const [clienteAbierto, setClienteAbierto] = useState(null);
  const [abierta, setAbierta] = useState(null); // { id, el }
  const [aviso, setAviso] = useState(null);
  useEffect(() => {
    if (modo !== 'demo') return undefined;
    let vivo = true;
    fetch(window.LOOPA_DEMO_URL || 'integracion/preview/produccion-demo.json', { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(datos => { if (vivo) setEstado({ cargando: false, datos, error: null }); })
      .catch(err => { if (vivo) setEstado({ cargando: false, datos: null, error: err.message || 'sin datos' }); });
    return () => { vivo = false; };
  }, [modo]);
  useEffect(() => { try { localStorage.setItem('loopa-produccion-vista', vista); } catch (e) { /* sólo preferencia de vista */ } }, [vista]);
  const fuente = useFuenteDemo(estado.datos);
  useEffect(() => {
    if (estado.datos) {
      setRutina(LoopaProduccion.routineRollover(estado.datos.rutina || {}, estado.datos.hoy).doc);
      setClientes(estado.datos.clientes || []);
    }
  }, [estado.datos]);
  const datos = estado.datos;
  const abrir = useCallback((t, el) => { setAviso(null); setAbierta({ id: t.id, el }); }, []);
  // Todo cambio pasa por acá: uno exitoso limpia el aviso de la página.
  const cambiar = useCallback((id, patch) => {
    const r = fuente.cambiar(id, patch);
    if (r.ok) setAviso(null);
    return r;
  }, [fuente.cambiar]);
  const elegirVista = (v) => { setAviso(null); setVista(v); };
  const cerrar = useCallback(() => setAbierta(null), []);
  const tareaAbierta = abierta && datos ? fuente.tareas.find(t => t.id === abierta.id) : null;
  const fichaAbierta = clienteAbierto ? clientes.find(c => c.id === clienteAbierto) : null;
  // Un solo panel a la vez: abrir la ficha cierra la tarea y viceversa.
  // El foco vuelve a quien abrió la ficha: la fila del resumen o, si se
  // llegó desde una tarea, la tarjeta de esa tarea (no un botón de un panel
  // que ya se desmontó).
  const abiertaRef = useRef(null);
  abiertaRef.current = abierta;
  const origenFicha = useRef(null);
  const abrirCliente = useCallback((id) => {
    const a = abiertaRef.current;
    origenFicha.current = a && a.el && document.contains(a.el) ? a.el : document.activeElement;
    setAbierta(null);
    setClienteAbierto(id);
  }, []);
  const cerrarCliente = useCallback(() => setClienteAbierto(null), []);
  const mover = (t, status) => {
    const r = cambiar(t.id, { status });
    if (!r.ok) setAviso(r.error.message);
    return r;
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Producción</div>
          <div className="page-title">{{ tablero: 'Tablero', resumen: 'Resumen' }[vista] || 'Calendario'}</div>
          <div className="page-desc">{{
            tablero: 'El trabajo por etapa. Mové las tarjetas con las flechas o desde la ficha; pasar a Entregado exige el checklist completo.',
            resumen: 'Cómo viene el trabajo del equipo y la rutina de hoy. Sin importes: lo comercial vive en Ventas y Métricas.',
          }[vista] || 'Una tarjeta por cliente y día, con los entregables de lo vendido. El día ubica el trabajo; la entrega es el compromiso con el cliente.'}</div>
        </div>
        {datos && (
          <div className="pr-modos" role="group" aria-label="Vista de producción">
            <button aria-pressed={vista === 'calendario'} className={vista === 'calendario' ? 'on' : ''} onClick={() => elegirVista('calendario')}>Calendario</button>
            <button aria-pressed={vista === 'tablero'} className={vista === 'tablero' ? 'on' : ''} onClick={() => elegirVista('tablero')}>Tablero</button>
            <button aria-pressed={vista === 'resumen'} className={vista === 'resumen' ? 'on' : ''} onClick={() => elegirVista('resumen')}>Resumen</button>
          </div>
        )}
      </div>
      {modo !== 'demo' && (
        <div className="panel pr-aviso">Producción todavía no está conectada a los datos del equipo: se conecta en la Fase 3. Para ver el módulo con datos de ejemplo, abrí LOOPA con <span className="mono">?produccion=demo</span>.</div>
      )}
      {modo === 'demo' && estado.cargando && <div className="panel pr-aviso">Cargando datos de ejemplo…</div>}
      {modo === 'demo' && estado.error && <div className="panel pr-aviso">No se pudieron cargar los datos de ejemplo ({estado.error}). Generalos con <span className="mono">node integracion/preview/generar-demo.cjs</span>.</div>}
      {datos && (
        <>
          <div className="pr-demo">Datos de ejemplo generados por el planificador desde ventas ficticias · hoy = {datos.hoy} · los cambios no se guardan</div>
          {aviso && <div className="pr-error" role="alert">{aviso}</div>}
          {vista === 'calendario' && <ProduccionCalendario tareas={fuente.tareas} columnas={datos.columnas} hoy={datos.hoy} onAbrir={abrir} />}
          {vista === 'tablero' && <ProduccionTablero tareas={fuente.tareas} columnas={datos.columnas} hoy={datos.hoy} onAbrir={abrir} onMover={mover} />}
          {vista === 'resumen' && rutina && (
            <ProduccionResumen tareas={fuente.tareas} columnas={datos.columnas} hoy={datos.hoy} equipo={datos.equipo || []} clientes={clientes} onAbrirCliente={abrirCliente}
              rutina={rutina} onCambiarRutina={(fn) => setRutina(d => fn(d))} onAbrir={abrir} />
          )}
          {tareaAbierta && (
            <ProdDetalle t={LoopaProduccion.normalizeTask(tareaAbierta, datos.hoy)} origen={abierta.el} hoy={datos.hoy} columnas={datos.columnas}
              enlazarVentas={false} onCerrar={cerrar} onAbrirVenta={(n) => { setAbierta(null); onAbrirVenta(n); }}
              onCambiar={(patch) => cambiar(tareaAbierta.id, patch)}
              onAbrirCliente={clientes.some(c => c.id === tareaAbierta.clientId) ? abrirCliente : null} />
          )}
          {fichaAbierta && (
            <FichaClienteProduccion cliente={fichaAbierta} clientes={clientes} tareas={fuente.tareas} columnas={datos.columnas} hoy={datos.hoy}
              workspace={datos.workspace} onCerrar={cerrarCliente} origen={origenFicha.current}
              onCambiarTarea={cambiar}
              onEnlazarTarea={(id) => fuente.enlazar(id, fichaAbierta, clientes)}
              onPublicar={(id, on) => setClientes(cs => cs.map(c => (c.id === id ? { ...c, portalPublished: on } : c)))}
              onAbrirTarea={(t) => { setClienteAbierto(null); abrir(t, origenFicha.current); }} />
          )}
        </>
      )}
    </div>
  );
}
