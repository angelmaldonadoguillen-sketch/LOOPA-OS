// ─────────────────────────────────────────────────────────────────
// MÓVIL — Modo rápido
//
// No es la versión de escritorio achicada: es otro árbol de vistas para
// otro uso. Con el teléfono en la mano se agrega y se mira, no se
// administra.
//
// El cerebro NO se duplica. Este archivo no habla con Firestore ni tiene
// reducer: recibe el mismo `state` y los mismos handlers que <App>. Si
// tuviera su propia copia de las escrituras, en un mes una de las dos
// versiones tendría un arreglo que la otra no.
//
// Diferencias con el escritorio, todas a propósito:
//   · Una columna del kanban a la vez, no las cinco al lado.
//   · Sin clientes, sin equipo, sin analytics, sin galería, sin lista.
//   · El detalle de tarjeta y la rutina se traen recién cuando se piden
//     (ver cargarModulo): son las dos piezas más pesadas y en la mayoría
//     de las sesiones no se abren.
// ─────────────────────────────────────────────────────────────────

// ── Cuándo entra el modo móvil ───────────────────────────────────
// matchMedia y no CSS: acá no se reacomodan cajas, se renderiza otra
// aplicación. Una media query no puede quitar funciones.
const MOBILE_QUERY = '(max-width: 767px)';

const useIsMobile = () => {
  const [is, setIs] = React.useState(() => {
    try { return window.matchMedia(MOBILE_QUERY).matches; } catch { return false; }
  });
  React.useEffect(() => {
    let mq;
    try { mq = window.matchMedia(MOBILE_QUERY); } catch { return; }
    // Se relee la consulta en vez de confiar en e.matches: así el mismo
    // manejador sirve para los dos eventos.
    const on = () => setIs(mq.matches);
    // addListener es el nombre viejo; Safari lo necesitó hasta hace poco.
    if (mq.addEventListener) mq.addEventListener('change', on);
    else mq.addListener(on);
    // Y 'resize' además de 'change': no todos los entornos disparan el
    // segundo. Releer es barato y setIs con el mismo valor no re-renderiza.
    window.addEventListener('resize', on);
    on();
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on);
      else mq.removeListener(on);
      window.removeEventListener('resize', on);
    };
  }, []);
  return is;
};

// ── Carga a demanda ──────────────────────────────────────────────
// Sin empaquetador no hay import(). Se trae el .jsx, lo compila Babel en
// el navegador y se evalúa. Es lo mismo que hace index.html al arrancar,
// sólo que en el momento en que hace falta y no antes.
//
// modal.jsx pesa 94 KB y routine.jsx 31 KB. Cargarlos al abrir la app
// serían 125 KB que la mayoría de las veces no se usan, descargados y
// compilados con datos móviles antes de ver la primera tarjeta.
const _modulos = {};
const cargarModulo = (archivo, comprobar) => {
  if (typeof comprobar === 'function' && comprobar()) return Promise.resolve(true);
  if (_modulos[archivo]) return _modulos[archivo];
  _modulos[archivo] = fetch(archivo)
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(src => {
      const code = window.Babel.transform(src, { presets: ['react'] }).code;
      // new Function y no eval: el cuerpo corre en ámbito global, que es
      // donde viven el resto de los componentes de FRAME.
      new Function(code)();
      return true;
    })
    .catch(err => {
      // Se olvida el intento fallido: si fue un corte de señal, el
      // siguiente toque tiene que poder reintentar.
      delete _modulos[archivo];
      throw err;
    });
  return _modulos[archivo];
};

// ── Tarjeta ──────────────────────────────────────────────────────
// Más alta y con más aire que la de escritorio: el dedo necesita blanco
// alrededor, y en el teléfono se ven pocas a la vez.
const MobileCard = ({ project, onOpen, previewFields = {} }) => {
  const pf      = previewFields;
  const tipo    = getType(project.type);
  const estado  = getStatus(project.status);
  const counter = deliveryCounter(project);

  const hechos = (project.checklist || []).filter(i => i.done).length;
  const total  = (project.checklist || []).length;

  return (
    <button
      onClick={() => onOpen(project.id)}
      className="w-full text-left surf p-4 anim-fade-in"
      style={{ display: 'block' }}
    >
      {/* Cabecera: tipo y estado */}
      <div className="flex items-center gap-2 mb-2.5">
        {pf.tipo !== false && (
          <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: tipo.color }}>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tipo.color }} />
            {tipo.label}
          </span>
        )}
        {pf.estado !== false && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>· {estado.label}</span>
        )}
        {/* La cuenta regresiva sola ("2 d") no dice para cuándo. En el
            teléfono, donde se mira de paso, la fecha ahorra la cuenta
            mental. */}
        {/* Sin la comprobación, una tarjeta sin fecha —las que entran por la
            API REST pueden no traerla— mostraba "Invalid Date". */}
        <span className="ml-auto flex items-baseline gap-1.5 flex-shrink-0">
          {project.deadline && (
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {fmtDate(project.deadline)}
            </span>
          )}
          {project.deadline && (
            <span className="text-[11px] tnum font-semibold" style={{ color: counter.color }}>
              {counter.value}
            </span>
          )}
        </span>
      </div>

      {/* Título */}
      <div className="text-[15px] font-semibold leading-snug mb-1" style={{ letterSpacing: '-0.01em' }}>
        {project.title}
      </div>

      {/* Cliente */}
      {pf.cliente !== false && project.client && (
        <div className="text-[12px] mb-3" style={{ color: 'var(--text-muted)' }}>{project.client}</div>
      )}

      {/* Progreso del checklist */}
      {pf.progreso !== false && total > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] tracking-[0.14em] uppercase" style={{ color: 'var(--text-muted)' }}>Avance</span>
            <span className="text-[11px] tnum" style={{ color: 'var(--text-muted)' }}>{hechos}/{total}</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
            <div className="h-full rounded-full" style={{ width: (hechos / total * 100) + '%', background: 'var(--accent)' }} />
          </div>
        </div>
      )}

      {/* Responsables */}
      {pf.responsables !== false && (project.assignees || []).length > 0 && (
        <div className="flex items-center gap-1.5 mt-3">
          {project.assignees.slice(0, 4).map(id => {
            // Alguien que ya no está en el equipo cargado: se muestra «?» en
            // lugar de romper toda la pantalla.
            const u = getUser(id) || { color: 'var(--resource-neutral)', initials: '?' };
            return (
              <span key={id} className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                    style={{ background: u.color, color: 'var(--resource-on)' }}>
                {u.initials}
              </span>
            );
          })}
        </div>
      )}
    </button>
  );
};

// ── Agregado rápido ──────────────────────────────────────────────
// El motivo por el que existe la versión móvil. Pide lo mínimo: título y
// tipo. Todo lo demás sale por defecto — el estado es el de la columna
// donde estás parado, para que la tarjeta aparezca donde la creaste.
const QuickAddSheet = ({ tipos, statusId, onCreate, onClose }) => {
  const [titulo, setTitulo] = React.useState('');
  const [tipo, setTipo]     = React.useState(tipos[0]?.id || 'reel');
  const inputRef            = React.useRef(null);

  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const crear = () => {
    const t = titulo.trim();
    if (!t) return;
    onCreate({ title: t, type: tipo, status: statusId });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="surf-panel p-5 anim-fade-in" onClick={(e) => e.stopPropagation()}
           style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
        <input
          ref={inputRef}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); crear(); } }}
          placeholder="¿Qué hay que hacer?"
          className="field w-full px-3.5 py-3 text-[16px] mb-3"
        />

        {/* Tipo: pastillas y no un desplegable — un toque en vez de tres. */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {tipos.map(t => (
            <button
              key={t.id}
              onClick={() => setTipo(t.id)}
              className="px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors"
              style={{
                background: tipo === t.id ? t.color : 'var(--surface-3)',
                color:      tipo === t.id ? 'var(--resource-on)' : 'var(--text-dim)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onClose} className="px-4 py-3 rounded-xl text-[14px]" style={{ color: 'var(--text-muted)' }}>
            Cancelar
          </button>
          <button
            onClick={crear}
            disabled={!titulo.trim()}
            className="flex-1 py-3 rounded-xl text-[15px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
};

const MobileFiltersSheet = ({ state, dispatch, workspaces, activeWorkspaceId, onClose }) => {
  const activeWs = workspaces.find(w => w.id === activeWorkspaceId);
  const soloYo = activeWs?.kind === 'personal';
  const members = workspaceMembers(activeWs);
  const tags = [...new Set(state.projects.flatMap(p => p.tags || []).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map(tag => ({ id: tag, label: `#${tag}` }));
  const clients = [...new Set(state.projects.map(p => p.client).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map(client => ({ id: client, label: client }));
  const groups = [
    { key: 'status', label: 'Estado', options: state.kanbanColumns.length ? state.kanbanColumns : STATUSES },
    { key: 'type', label: 'Tipo', options: state.customTypes.length ? state.customTypes : PROJECT_TYPES },
    { key: 'priority', label: 'Prioridad', options: PRIORITIES },
    ...(!soloYo ? [{ key: 'assignee', label: 'Equipo', options: members.map(u => ({ id: u.id, label: u.name })) }] : []),
    { key: 'client', label: 'Cliente', options: clients },
    { key: 'tags', label: 'Tags', options: tags },
    { key: 'deadline', label: 'Fecha de entrega', options: [
      { id: 'overdue', label: 'Vencidas' }, { id: 'today', label: 'Vencen hoy' },
      { id: 'next_7_days', label: 'Próximos 7 días' }, { id: 'this_month', label: 'Este mes' },
    ] },
    { key: 'progress', label: 'Progreso', options: [
      { id: 'no_checklist', label: 'Sin checklist' }, { id: 'not_started', label: 'Sin iniciar' },
      { id: 'in_progress', label: 'En progreso' }, { id: 'complete', label: 'Checklist completo' },
    ] },
    { key: 'attributes', label: 'Características', options: [
      { id: 'favorite', label: 'Favoritas' }, { id: 'unassigned', label: 'Sin responsable' },
      { id: 'assigned', label: 'Con responsable' }, { id: 'has_deliverables', label: 'Con entregables' },
      { id: 'no_deliverables', label: 'Sin entregables' },
    ] },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="surf-panel anim-fade-in flex flex-col" onClick={(e) => e.stopPropagation()}
           style={{ maxHeight: '88vh', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-5 py-4 hair flex-shrink-0">
          <div>
            <div className="text-[16px] font-semibold">Filtrar tareas</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Combina campos para precisar resultados</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg" aria-label="Cerrar filtros"><Icon name="x" size={17} /></button>
        </div>
        <div className="overflow-y-auto px-4 py-2">
          {groups.map(group => (
            <div key={group.key} className="py-3 hair">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] tracking-[0.14em] uppercase" style={{ color: 'var(--text-muted)' }}>{group.label}</span>
                {(state.filters[group.key] || []).length > 0 && (
                  <button onClick={() => dispatch({ type: 'reset_filter', key: group.key })} className="text-[11px]" style={{ color: 'var(--accent)' }}>Limpiar</button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.options.length ? group.options.map(option => {
                  const selected = (state.filters[group.key] || []).includes(option.id);
                  return (
                    <button
                      key={option.id}
                      onClick={() => dispatch({ type: 'toggle_filter', key: group.key, value: option.id })}
                      className="px-3 py-1.5 rounded-full text-[12px] border transition-colors"
                      style={{
                        background: selected ? 'var(--accent)' : 'var(--surface-2)',
                        color: selected ? 'var(--accent-on)' : 'var(--text-dim)',
                        borderColor: selected ? 'var(--accent)' : 'var(--border)',
                      }}
                    >
                      {option.label}
                    </button>
                  );
                }) : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No hay opciones todavía</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 p-4 hair flex-shrink-0">
          <button onClick={() => dispatch({ type: 'clear_all_filters' })} className="px-4 py-3 rounded-xl text-[13px]" style={{ color: 'var(--text-muted)' }}>Limpiar todo</button>
          <button onClick={onClose} className="flex-1 py-3 rounded-xl text-[14px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>Ver resultados</button>
        </div>
      </div>
    </div>
  );
};

// ── Aplicación móvil ─────────────────────────────────────────────
const MobileApp = ({ state, dispatch, authUser, workspaces, activeWorkspaceId,
                     onQuickCreate, onSignOut, onRenameWorkspace, children }) => {
  const columnas = state.kanbanColumns.length > 0 ? state.kanbanColumns : STATUSES;
  const tipos    = (state.customTypes.length > 0 ? state.customTypes : PROJECT_TYPES).map(themed);

  const [colIndex, setColIndex] = React.useState(0);
  const [renamingWorkspace, setRenamingWorkspace] = React.useState(null);
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);
  const [quickAdd, setQuickAdd] = React.useState(false);
  const [rutina, setRutina]     = React.useState(false);
  const [perfil, setPerfil]     = React.useState(false);
  const [filtros, setFiltros]   = React.useState(false);
  const [cargando, setCargando] = React.useState(null);
  const [theme, setTheme]       = React.useState(() => document.documentElement.dataset.theme || 'dark');

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(window.setFrameTheme ? window.setFrameTheme(next) : next);
  };

  // Si cambian las columnas del tablero, el índice guardado puede quedar
  // apuntando a una que ya no existe.
  React.useEffect(() => {
    if (colIndex > columnas.length - 1) setColIndex(0);
  }, [columnas.length, colIndex]);

  const columna = columnas[colIndex] || columnas[0] || { id: 'briefing', label: 'Pendiente' };

  // Ordenadas por fecha de entrega, la más cercana arriba: es el orden en que
  // hay que atenderlas. Y es la misma fecha que muestra la tarjeta — ordenar
  // por otra dejaría las fechas salteadas y parecería que el orden está roto.
  //
  // Se comparan las cadenas directamente: localISO da AAAA-MM-DD, que ordena
  // igual como texto que como fecha. Sin fecha van al final, no adelante.
  const visibles = React.useMemo(
    () => applyFilters({ ...state, sidebarFilter: 'all' })
      .filter(p => p.status === columna.id)
      .sort((a, b) => (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31')),
    [state, columna.id]
  );
  const activeFilterCount = Object.values(state.filters).reduce((total, values) => total + values.length, 0);

  const me = state.team.find(m => m.id === state.currentUserId) || getUser(state.currentUserId);

  // ── Deslizar para cambiar de columna ──
  const touch = React.useRef(null);
  const onTouchStart = (e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    // Se exige que el gesto sea claramente horizontal: si no, cada scroll
    // con el pulgar un poco torcido cambiaría de columna.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    mover(dx < 0 ? 1 : -1);
  };
  // Cíclico: de la última se vuelve a la primera y al revés. Con tres o
  // cuatro columnas, toparse con una flecha muerta obliga a deshacer todo el
  // camino para ver la de al lado.
  //
  // El + columnas.length antes del resto es lo que hace que funcione hacia
  // atrás: en JavaScript -1 % 3 da -1, no 2.
  const mover = (paso) => {
    if (columnas.length <= 1) return;
    setColIndex(i => (i + paso + columnas.length) % columnas.length);
  };

  // ── Abrir el detalle: trae modal.jsx si todavía no está ──
  const abrirTarjeta = (id) => {
    setCargando('tarjeta');
    cargarModulo('modal.jsx', () => typeof ProjectModal !== 'undefined')
      .then(() => { setCargando(null); dispatch({ type: 'open_project', id }); })
      .catch(() => { setCargando(null); window.frameToast?.('No se pudo abrir la tarea. Revisá la conexión.'); });
  };

  const abrirRutina = () => {
    setCargando('rutina');
    cargarModulo('routine.jsx', () => typeof RoutineWidget !== 'undefined')
      .then(() => { setCargando(null); setRutina(true); })
      .catch(() => { setCargando(null); window.frameToast?.('No se pudo abrir la rutina. Revisá la conexión.'); });
  };

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <ToastStack />

      {/* ── Barra: tableros + rutina ── */}
      <div className="flex items-center gap-1 px-3 hair flex-shrink-0"
           style={{ paddingTop: 'calc(10px + env(safe-area-inset-top))', paddingBottom: 10, background: 'var(--surface)' }}>
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          {workspaces.map(w => (
            <button
              key={w.id}
              disabled={!!renamingWorkspace}
              onClick={() => dispatch({ type: 'set_active_workspace', id: w.id })}
              className="px-3 py-1.5 rounded-lg text-[13px] font-medium whitespace-nowrap flex-shrink-0 transition-colors"
              style={{
                background: w.id === activeWorkspaceId ? 'var(--surface-3)' : 'transparent',
                color:      w.id === activeWorkspaceId ? 'var(--text)'      : 'var(--text-muted)',
              }}
            >
              {w.name}
            </button>
          ))}
        </div>
        {activeWorkspace?.ownerId === authUser.uid && <button type="button" disabled={!!renamingWorkspace}
          onClick={() => setRenamingWorkspace(activeWorkspace)} title="Cambiar nombre del tablero" aria-label="Cambiar nombre del tablero"
          className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-md hover:bg-[var(--surface-3)] disabled:opacity-40"
          style={{ color: 'var(--text-muted)' }}><Icon name="edit" size={15} /></button>}
        <button
          onClick={abrirRutina}
          className="px-3 py-1.5 rounded-lg text-[13px] font-medium flex-shrink-0"
          style={{ color: 'var(--accent)' }}
        >
          Rutina
        </button>
      </div>

      {renamingWorkspace && <div className="flex-shrink-0 hair" style={{ background: 'var(--surface)' }}>
        <WorkspaceRenameForm key={renamingWorkspace.id} workspace={renamingWorkspace}
          onRename={onRenameWorkspace} onClose={() => setRenamingWorkspace(null)} />
      </div>}

      {/* Búsqueda y filtros comparten el mismo estado que escritorio. */}
      <div className="flex items-center gap-2 px-3 py-2 hair flex-shrink-0" style={{ background: 'var(--surface)' }}>
        <label className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-xl" style={{ background: 'var(--surface-2)' }}>
          <Icon name="search" size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            value={state.search}
            onChange={(e) => dispatch({ type: 'set_search', value: e.target.value })}
            placeholder="Buscar tareas…"
            className="flex-1 min-w-0 text-[14px]"
          />
          {state.search && <button onClick={() => dispatch({ type: 'set_search', value: '' })}><Icon name="x" size={13} /></button>}
        </label>
        <button
          onClick={() => setFiltros(true)}
          className="relative w-10 h-10 rounded-xl flex items-center justify-center border"
          style={{ background: activeFilterCount ? 'var(--accent)' : 'var(--surface-2)', color: activeFilterCount ? 'var(--accent-on)' : 'var(--text-dim)', borderColor: activeFilterCount ? 'var(--accent)' : 'var(--border)' }}
          aria-label="Abrir filtros"
        >
          <Icon name="filter" size={16} />
          {activeFilterCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: 'var(--text)', color: 'var(--bg)' }}>{activeFilterCount}</span>}
        </button>
      </div>

      {/* ── Columna actual ── */}
      <div className="flex items-center justify-center gap-4 px-3 py-2.5 flex-shrink-0" style={{ background: 'var(--surface)' }}>
        <button
          onClick={() => mover(-1)}
          disabled={columnas.length <= 1}
          className="p-2 rounded-lg disabled:opacity-25"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Columna anterior"
        >
          <Icon name="chevronLeft" size={16} />
        </button>

        <div className="text-center min-w-0">
          <div className="text-[13px] font-semibold tracking-[0.1em] uppercase truncate" style={{ color: 'var(--text)' }}>
            {columna.label}
          </div>
          <div className="flex items-center justify-center gap-1 mt-1.5">
            {columnas.map((c, i) => (
              <span key={c.id} className="rounded-full transition-all" style={{
                width: i === colIndex ? 14 : 5, height: 5,
                background: i === colIndex ? 'var(--accent)' : 'var(--surface-3)',
              }} />
            ))}
          </div>
        </div>

        <button
          onClick={() => mover(1)}
          disabled={columnas.length <= 1}
          className="p-2 rounded-lg disabled:opacity-25"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Columna siguiente"
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </div>

      {/* ── Tarjetas ── */}
      <div
        className="flex-1 overflow-y-auto px-3 pt-3 space-y-2.5"
        style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))', WebkitOverflowScrolling: 'touch' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {state.loading && (
          <div className="text-center py-16 text-[13px]" style={{ color: 'var(--text-muted)' }}>Cargando…</div>
        )}

        {!state.loading && visibles.length === 0 && (
          <div className="text-center py-20">
            <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Nada en {columna.label.toLowerCase()}</div>
          </div>
        )}

        {visibles.map(p => (
          <MobileCard key={p.id} project={p} onOpen={abrirTarjeta} previewFields={state.previewFields} />
        ))}
      </div>

      {/* ── Perfil y agregar ── */}
      <div className="fixed right-4 flex flex-col items-center gap-3"
           style={{ bottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
        {/* El mismo <Avatar> que en el escritorio, no una copia con otros
            estilos: así lleva tu color —y tu foto si la tenés— y no se
            desincroniza cuando uno de los dos cambie. */}
        <button
          onClick={() => setPerfil(true)}
          className="rounded-full flex-shrink-0"
          style={{ boxShadow: '0 4px 14px -4px rgba(0,0,0,.6)' }}
          aria-label="Perfil"
        >
          <Avatar user={me} size={40} />
        </button>
        <button
          onClick={() => setQuickAdd(true)}
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: 'var(--accent)', color: 'var(--accent-on)', boxShadow: '0 8px 24px -6px rgba(0,0,0,.6)' }}
          aria-label="Nueva tarea"
        >
          <Icon name="plus" size={24} strokeWidth={2.5} />
        </button>
      </div>

      {/* ── Capas ── */}
      {cargando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="surf-float px-5 py-3 text-[13px]">Abriendo…</div>
        </div>
      )}

      {quickAdd && (
        <QuickAddSheet
          tipos={tipos}
          statusId={columna.id}
          onCreate={onQuickCreate}
          onClose={() => setQuickAdd(false)}
        />
      )}

      {filtros && (
        <MobileFiltersSheet
          state={state}
          dispatch={dispatch}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onClose={() => setFiltros(false)}
        />
      )}

      {perfil && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,.5)' }} onClick={() => setPerfil(false)}>
          <div className="surf-panel p-5 anim-fade-in" onClick={(e) => e.stopPropagation()}
               style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
            <div className="text-[15px] font-semibold">{me.name}</div>
            {me.email && <div className="text-[12px] mb-4" style={{ color: 'var(--text-muted)' }}>{me.email}</div>}
            {/* LOOPA: un solo tema (oscuro) y sin portfolio (no pasó a LOOPA). */}
            <button
              onClick={onSignOut}
              className="w-full py-3 rounded-xl text-[14px] font-semibold"
              style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      )}

      {rutina && typeof RoutineWidget !== 'undefined' && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,.5)' }} onClick={() => setRutina(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxHeight: '80vh', overflowY: 'auto' }}>
            <RoutineWidget workspaceId={activeWorkspaceId} />
          </div>
        </div>
      )}

      {/* El modal de detalle lo sigue montando <App>: es el mismo de
          escritorio y usa los mismos handlers. */}
      {children}
    </div>
  );
};
