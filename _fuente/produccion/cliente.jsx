// ═══════════════════════════════════════════════════════════════
// LOOPA OS · Producción — ficha del cliente y portal (Fase 2, tanda 5)
//
// La parte de PRODUCCIÓN de la ficha única: su trabajo, qué tareas comparte
// y una vista previa EXACTA de lo que vería en su portal (buildPortalDocument,
// paridad con portal.jsx de FRAME). Publicar el portal de verdad (documento
// público + reglas) se conecta en la Fase 3; acá todo es en memoria.
//
// Las tareas del cliente se eligen por clientId; las viejas sin id, por nombre
// sólo si no hay otro cliente homónimo (clientTasks): un portal público nunca
// muestra trabajo de otro cliente.
// ═══════════════════════════════════════════════════════════════

function ProdLineaFases({ fases, indice }) {
  if (indice < 0) return null;
  return (
    <div className="pr-fases" aria-hidden="true">
      {fases.map((f, i) => <span key={`${f}-${i}`} className={i < indice ? 'hecha' : i === indice ? 'actual' : ''} />)}
    </div>
  );
}

function FichaClienteProduccion({ cliente, clientes, tareas, columnas, hoy, workspace, origen, onCerrar, onCambiarTarea, onEnlazarTarea, onPublicar, onAbrirTarea }) {
  const panel = useRef(null);
  const cerrarBtn = useRef(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const previo = document.activeElement;
    if (cerrarBtn.current) cerrarBtn.current.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCerrar(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const focos = [...panel.current.querySelectorAll('button, input, select, [href], [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled);
      if (!focos.length) return;
      const a = focos[0], z = focos[focos.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const destino = origen && document.contains(origen) ? origen : previo;
      if (destino && document.contains(destino)) destino.focus();
    };
  }, [onCerrar, origen]);

  const normalizadas = useMemo(() => tareas.map(t => LoopaProduccion.normalizeTask(t, hoy)), [tareas, hoy]);
  const propias = LoopaProduccion.clientTasks(cliente, normalizadas, clientes);
  const activas = propias.filter(t => !LoopaProduccion.isClosed(t, columnas) && t.status !== 'archived');
  // Archivado no es entregado: no se lista ni se cuenta.
  const cerradas = propias.filter(t => LoopaProduccion.isClosed(t, columnas) && t.status !== 'archived');
  const homonimos = LoopaProduccion.clientHomonyms(cliente, clientes).length;
  const sinFicha = homonimos > 0 ? LoopaProduccion.unlinkedNameMatches(cliente, normalizadas).filter(t => t.status !== 'archived') : [];
  const ventas = [...new Set(propias.map(t => t.sourceSaleNumber).filter(Boolean))].sort((a, b) => a - b)
    .map(n => ({ n, cancelada: propias.some(t => t.sourceSaleNumber === n && t.sourceSaleStatus === 'cancelled') }));
  // Vista previa: el documento tal como se publicaría (aunque todavía no lo esté).
  const vistaPrevia = LoopaProduccion.buildPortalDocument({ client: cliente, tasks: normalizadas, allClients: clientes, workspace, published: true, columns: columnas, now: hoy });
  const tituloId = `pr-cliente-${cliente.id}`;
  const cambiarVisible = (t) => {
    const r = onCambiarTarea(t.id, { clientVisible: !(t.clientVisible !== false) });
    setError(r && !r.ok ? r.error.message : null);
  };
  const enlazar = (t) => {
    const r = onEnlazarTarea(t.id);
    setError(r && !r.ok ? r.error.message : null);
  };

  const filaTarea = (t) => {
    const pct = LoopaProduccion.progressOf(t);
    const v = prodVence(t, hoy, columnas);
    return (
      <li key={t.id} className="pr-cli-tarea">
        <button className="pr-link-fila" data-id={t.id} onClick={(e) => onAbrirTarea(t, e.currentTarget)}>
          <span>{t.title}</span>
          <span className="pr-cli-meta">{prodEstadoLabel(t.status, columnas)} · {pct}%{v ? ` · ${v.txt}` : ''}{t.sourceSaleStatus === 'cancelled' ? ' · venta cancelada: no se publica' : ''}</span>
        </button>
        <label className="pr-check-label pr-cli-visible">
          <input type="checkbox" checked={t.clientVisible !== false} onChange={() => cambiarVisible(t)} aria-label={`Visible para el cliente: ${t.title}`} />
          <span>Visible para el cliente</span>
        </label>
      </li>
    );
  };

  return (
    <div className="pr-detalle-fondo" onMouseDown={onCerrar}>
      <aside ref={panel} className="pr-detalle pr-cliente" role="dialog" aria-modal="true" aria-labelledby={tituloId} onMouseDown={e => e.stopPropagation()}>
        <div className="pr-detalle-cab">
          <div>
            <div className="page-kicker">Cliente</div>
            <div className="pr-detalle-titulo" id={tituloId}>{cliente.name}</div>
          </div>
          <button ref={cerrarBtn} className="icon-btn" onClick={onCerrar} aria-label="Cerrar"><Icon name="x" size={14} /></button>
        </div>
        {error && <div className="pr-error" role="alert">{error}</div>}
        {homonimos > 0 && (
          <div className="pr-aviso-chico">Hay otro cliente con el mismo nombre. Las tareas viejas sin ficha asignada no se muestran ni se publican hasta enlazarlas, para no mezclar el trabajo de dos clientes.</div>
        )}
        {sinFicha.length > 0 && (
          <section className="pr-cli-seccion">
            <h3 className="pr-bloque-titulo">Sin ficha con este nombre</h3>
            <ul className="pr-lista">{sinFicha.map(t => (
              <li key={t.id} className="pr-cli-tarea">
                <span>{t.title}</span>
                <button className="btn" onClick={() => enlazar(t)} aria-label={`Enlazar «${t.title}» a esta ficha`}>Es de este cliente</button>
              </li>
            ))}</ul>
          </section>
        )}
        <dl className="pr-datos">
          <div><dt>Trabajo activo</dt><dd>{activas.length} {activas.length === 1 ? 'tarea' : 'tareas'}</dd></div>
          <div><dt>Entregado</dt><dd>{cerradas.length}</dd></div>
          <div><dt>Ventas con producción</dt><dd>{ventas.length ? ventas.map(v => `#${v.n}${v.cancelada ? ' (cancelada)' : ''}`).join(', ') : '—'}</dd></div>
        </dl>

        <section className="pr-cli-seccion">
          <h3 className="pr-bloque-titulo">En producción</h3>
          {activas.length === 0 && <div className="pr-col-vacia">Sin trabajo activo.</div>}
          <ul className="pr-lista">{activas.map(filaTarea)}</ul>
          {cerradas.length > 0 && (
            <>
              <h3 className="pr-bloque-titulo" style={{ marginTop: 10 }}>Entregado</h3>
              <ul className="pr-lista">{cerradas.map(filaTarea)}</ul>
            </>
          )}
        </section>

        <section className="pr-cli-seccion">
          <div className="pr-cli-portal-cab">
            <h3 className="pr-bloque-titulo">Portal del cliente</h3>
            <label className="pr-check-label">
              <input type="checkbox" checked={cliente.portalPublished === true} onChange={() => onPublicar(cliente.id, !(cliente.portalPublished === true))} />
              <span>{cliente.portalPublished === true ? 'Publicado' : 'Sin publicar'}</span>
            </label>
          </div>
          <div className="pr-ayuda">Así lo vería {cliente.name}: sólo tareas marcadas como visibles y de ventas vigentes, sin comentarios internos, responsables ni importes. {cliente.portalPublished === true ? '' : 'Mientras no se publique, el enlace no muestra nada.'}</div>
          <div className="pr-portal-vista" aria-label={`Vista previa del portal de ${cliente.name}`}>
            <div className="pr-portal-cab"><strong>{vistaPrevia.studioName}</strong><span className="dim"> · para {vistaPrevia.clientName}</span></div>
            {vistaPrevia.tasks.length === 0 && <div className="pr-col-vacia">Todavía no hay trabajo compartido.</div>}
            {vistaPrevia.tasks.map(t => (
              <div key={t.id} className="pr-portal-tarea">
                <div className="pr-portal-tit"><span>{t.title}</span><span className="pr-cli-meta">{t.type}</span></div>
                <ProdLineaFases fases={t.phases} indice={t.phaseIndex} />
                <div className="pr-cli-meta">{t.status} · {t.progress}%{t.deadline ? ` · entrega ${prodCorto(t.deadline)}` : ''}</div>
              </div>
            ))}
          </div>
        </section>
        <div className="pr-nota">Datos de ejemplo: publicar y cambiar la visibilidad no se guarda. El portal público real (documento, enlace y reglas) se conecta en la Fase 3; las ventas y cobros del cliente se suman a esta ficha con los datos migrados.</div>
      </aside>
    </div>
  );
}
