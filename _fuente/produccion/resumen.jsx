// ═══════════════════════════════════════════════════════════════
// LOOPA OS · Producción — resumen y rutina diaria (Fase 2, tanda 4)
//
// Los números salen de productionSummary (paridad con analytics.jsx de
// FRAME) y la rutina de las funciones routine* del núcleo (paridad con
// routine.jsx). Sin importes: Producción no copia montos (D8).
// ═══════════════════════════════════════════════════════════════

const prodMesCorto = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-HN', { month: 'short' }).replace('.', ''); };
const prodNombre = (equipo, id) => ((equipo || []).find(m => m.id === id) || {}).name || 'Sin asignar';

// Barra horizontal accesible: el número está en el texto, la barra es decorativa.
function ProdBarra({ label, valor, max, onAbrir }) {
  const pct = max > 0 ? Math.round((valor / max) * 100) : 0;
  return (
    <li className="pr-barra-fila">
      {onAbrir
        ? <button className="pr-barra-label pr-link" onClick={onAbrir} aria-label={`Abrir la ficha de ${label}`}>{label}</button>
        : <span className="pr-barra-label">{label}</span>}
      <span className="pr-barra-pista" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <span className="pr-barra-valor mono">{valor}</span>
    </li>
  );
}

function ProdBloque({ titulo, children }) {
  return (
    <section className="panel pr-bloque">
      <h3 className="pr-bloque-titulo">{titulo}</h3>
      {children}
    </section>
  );
}

function RutinaDiaria({ doc, hoy, equipo, onCambiar }) {
  const [nuevo, setNuevo] = useState('');
  const [editando, setEditando] = useState(null); // { id, texto }
  // Tras renombrar, cancelar o quitar, el foco vuelve a un lugar útil (la
  // fila, la siguiente o el campo para agregar), nunca al <body>.
  const lista = useRef(null);
  const [foco, setFoco] = useState(null); // { id, que: 'renombrar' | 'check' | 'agregar' }
  useEffect(() => {
    if (!foco || !lista.current) return;
    const raiz = lista.current;
    const fila = foco.id ? raiz.querySelector(`[data-id="${CSS.escape(foco.id)}"]`) : null;
    const destino = foco.que === 'agregar' || !fila
      ? raiz.querySelector('input[aria-label="Nueva tarea de rutina"]')
      : fila.querySelector(foco.que === 'renombrar' ? 'button[data-accion="renombrar"]' : 'input[type=checkbox]');
    if (destino) destino.focus();
    setFoco(null);
  }, [foco, doc]);
  const activos = (equipo || []).filter(m => !m.status || m.status === 'active');
  const st = LoopaProduccion.routineStats(doc, hoy);
  const recientes = doc.history.slice(0, 7);
  const agregar = (e) => {
    e.preventDefault();
    if (!nuevo.trim()) return;
    onCambiar(d => LoopaProduccion.routineAddTask(d, nuevo, `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`));
    setNuevo('');
  };
  const guardarNombre = () => {
    if (!editando) return;
    onCambiar(d => LoopaProduccion.routineRenameTask(d, editando.id, editando.texto));
    setFoco({ id: editando.id, que: 'renombrar' });
    setEditando(null);
  };
  const quitar = (t) => {
    const i = doc.tasks.findIndex(x => x.id === t.id);
    const siguiente = doc.tasks[i + 1] || doc.tasks[i - 1];
    onCambiar(d => LoopaProduccion.routineDeleteTask(d, t.id));
    setFoco(siguiente ? { id: siguiente.id, que: 'check' } : { que: 'agregar' });
  };
  return (
    <ProdBloque titulo="Rutina del día">
      <div ref={lista} className="pr-rutina-cuerpo">
      <div className="pr-rutina-cab">
        <span className="mono">{st.completed}/{st.total} · {st.pct}%</span>
        {st.streak > 0 && <span className="pr-racha">{st.streak} {st.streak === 1 ? 'día perfecto' : 'días perfectos seguidos'}</span>}
      </div>
      <div className="pr-card-avance" aria-hidden="true"><span style={{ width: `${st.pct}%` }} /></div>
      {st.total === 0 && <div className="pr-col-vacia">Sin tareas de rutina. Agregá las que el equipo repite cada día.</div>}
      <ul className="pr-rutina">
        {doc.tasks.map(t => {
          const hecho = !!doc.today.checks[t.id];
          // Como FRAME: la deuda sólo se muestra con el arrastre encendido.
          const deuda = doc.config.carryOver ? (doc.today.debt[t.id] || 0) : 0;
          const asignadoFuera = t.assignee && !activos.some(m => m.id === t.assignee);
          return (
            <li key={t.id} data-id={t.id} className={hecho ? 'hecho' : ''}>
              {editando && editando.id === t.id
                ? <input className="pr-campo" autoFocus value={editando.texto} aria-label="Nombre de la tarea de rutina" maxLength={200}
                    onChange={e => setEditando({ ...editando, texto: e.target.value })}
                    onBlur={guardarNombre}
                    onKeyDown={e => { if (e.key === 'Enter') guardarNombre(); if (e.key === 'Escape') { e.stopPropagation(); setFoco({ id: t.id, que: 'renombrar' }); setEditando(null); } }} />
                : <label className="pr-check-label">
                    <input type="checkbox" checked={hecho} onChange={() => onCambiar(d => LoopaProduccion.routineToggle(d, t.id))} />
                    <span>{t.text}</span>
                  </label>}
              <span className="pr-rutina-meta">
                {deuda > 0 && !hecho && <span className="pr-vence aviso">{deuda === 1 ? 'pendiente de ayer' : `pendiente hace ${deuda} días`}</span>}
                <select className="pr-campo pr-campo-chico" value={t.assignee || ''} aria-label={`Responsable de «${t.text}»`}
                  onChange={e => onCambiar(d => LoopaProduccion.routineAssignTask(d, t.id, e.target.value))}>
                  <option value="">Sin asignar</option>
                  {activos.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  {asignadoFuera && <option value={t.assignee}>{prodNombre(equipo, t.assignee) === 'Sin asignar' ? 'Persona desconocida' : prodNombre(equipo, t.assignee)} (inactivo)</option>}
                </select>
                <button className="icon-btn" data-accion="renombrar" onClick={() => setEditando({ id: t.id, texto: t.text })} aria-label={`Renombrar «${t.text}»`}><Icon name="edit" size={11} /></button>
                <button className="icon-btn" onClick={() => quitar(t)} aria-label={`Quitar «${t.text}»`}><Icon name="trash" size={11} /></button>
              </span>
            </li>
          );
        })}
      </ul>
      <form className="pr-agregar" onSubmit={agregar}>
        <input className="pr-campo" value={nuevo} onChange={e => setNuevo(e.target.value)} placeholder="Nueva tarea de rutina…" aria-label="Nueva tarea de rutina" maxLength={200} />
        <button className="btn sm" type="submit" disabled={!nuevo.trim()}>Agregar</button>
      </form>
      <label className="pr-check-label pr-rutina-opcion">
        <input type="checkbox" checked={!!doc.config.carryOver} onChange={() => onCambiar(d => LoopaProduccion.routineSetCarryOver(d, !d.config.carryOver))} />
        <span>Arrastrar lo que quede sin hacer al día siguiente</span>
      </label>
      {recientes.length > 0 && (
        <div className="pr-historial">
          <div className="pr-checklist-cab"><span>Últimos días</span></div>
          <ul>
            {recientes.map(h => (
              <li key={h.date} className={h.total > 0 && h.completed === h.total ? 'perfecto' : ''}>
                <span>{prodCorto(h.date)}</span><span className="mono">{h.completed}/{h.total}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </ProdBloque>
  );
}

function ProduccionResumen({ tareas, columnas, hoy, equipo, rutina, onCambiarRutina, onAbrir, clientes = [], onAbrirCliente }) {
  const normalizadas = useMemo(() => tareas.map(t => LoopaProduccion.normalizeTask(t, hoy)), [tareas, hoy]);
  const r = useMemo(() => LoopaProduccion.productionSummary(normalizadas, columnas, equipo, hoy), [normalizadas, columnas, equipo, hoy]);
  const maxEstado = Math.max(1, ...r.statusGroups.map(s => s.count));
  const maxTipo = Math.max(1, ...r.typeCounts.map(t => t.count));
  const maxCarga = Math.max(1, ...r.workload.map(w => w.count));
  const maxCliente = Math.max(1, ...r.topClients.map(c => c.count));
  const maxMes = Math.max(1, ...r.months.map(m => m.count));
  const kpis = [
    { label: 'Activas', valor: r.active },
    { label: 'Entregadas', valor: r.delivered, sub: `${r.deliveryRate}% del total` },
    { label: 'Requieren atención', valor: r.urgent, tono: r.urgent > 0 ? 'alerta' : '' },
    { label: 'Total sin archivar', valor: r.reportable },
  ];
  return (
    <div className="pr-resumen">
      <div className="pr-kpis">
        {kpis.map(k => (
          <div key={k.label} className="panel pr-kpi">
            <div className="pr-kpi-label">{k.label}</div>
            <div className={`pr-kpi-valor ${k.tono || ''}`}>{k.valor}</div>
            {k.sub && <div className="pr-kpi-sub">{k.sub}</div>}
          </div>
        ))}
      </div>
      <div className="pr-resumen-grilla">
        <RutinaDiaria doc={rutina} hoy={hoy} equipo={equipo} onCambiar={onCambiarRutina} />
        <ProdBloque titulo="Próximas entregas">
          {r.upcoming.length === 0 && <div className="pr-col-vacia">Sin entregas pendientes.</div>}
          <ul className="pr-lista">
            {r.upcoming.map(t => {
              const v = prodVence(t, hoy, columnas);
              return (
                <li key={t.id}>
                  <button className="pr-link-fila" data-id={t.id} onClick={(e) => onAbrir(t, e.currentTarget)}>
                    <span><strong>{t.client || 'Sin cliente'}</strong> · {t.title}</span>
                    {v && <span className={`pr-vence ${v.tono}`}>{v.txt}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </ProdBloque>
        <ProdBloque titulo="Por estado">
          <ul className="pr-barras">{r.statusGroups.map(s => <ProdBarra key={s.id} label={s.label} valor={s.count} max={maxEstado} />)}</ul>
        </ProdBloque>
        <ProdBloque titulo="Carga del equipo (tareas activas)">
          {r.workload.length === 0 && <div className="pr-col-vacia">Sin integrantes activos.</div>}
          <ul className="pr-barras">{r.workload.map(w => <ProdBarra key={w.id} label={w.name || prodNombre(equipo, w.id)} valor={w.count} max={maxCarga} />)}</ul>
        </ProdBloque>
        <ProdBloque titulo="Por tipo">
          <ul className="pr-barras">{r.typeCounts.map(t => <ProdBarra key={t.id} label={t.label} valor={t.count} max={maxTipo} />)}</ul>
        </ProdBloque>
        <ProdBloque titulo="Clientes con más trabajo">
          {/* Dos fichas con el mismo nombre se distinguen con el final de su id. */}
          <ul className="pr-barras">{r.topClients.map(c => {
            const repetido = r.topClients.filter(x => x.name === c.name).length > 1;
            const label = repetido ? `${c.name} (${String(c.key).slice(-4)})` : c.name;
            const ficha = clientes.find(x => x.id === c.key);
            return <ProdBarra key={c.key} label={label} valor={c.count} max={maxCliente}
              onAbrir={ficha && onAbrirCliente ? () => onAbrirCliente(ficha.id) : null} />;
          })}</ul>
        </ProdBloque>
        <ProdBloque titulo="Tareas por mes de entrega">
          <ul className="pr-barras">{r.months.map(m => <ProdBarra key={m.key} label={prodMesCorto(m.key)} valor={m.count} max={maxMes} />)}</ul>
        </ProdBloque>
      </div>
    </div>
  );
}
