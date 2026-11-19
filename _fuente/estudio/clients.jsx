// ─────────────────────────────────────────────────────────────────
// CLIENTS — directorio de clientes del estudio
// ─────────────────────────────────────────────────────────────────

// ── Seed data ───────────────────────────────────────────────────
const SEED_CLIENTS = [
  {
    id: 'cl1',
    name: 'Volcán Activewear',
    industry: 'Moda deportiva',
    color: 'var(--resource-coral)',
    initials: 'VA',
    contact: { name: 'Laura Vega', email: 'laura@volcan.com', phone: '+54 11 5555-0101' },
    tags: ['premium', 'recurrente'],
    notes: 'Cliente desde 2024. Prefiere entregas los viernes y al menos 2 rondas de revisión.',
    createdAt: d(-120),
  },
  {
    id: 'cl2',
    name: 'LUMEN Studio',
    industry: 'Arquitectura & Diseño',
    color: 'var(--resource-teal)',
    initials: 'LS',
    contact: { name: 'Andrés Mora', email: 'andres@lumenstudio.com', phone: '+54 11 5555-0202' },
    tags: ['corporativo', 'anual'],
    notes: 'Muy exigentes con el color y la iluminación. Siempre revisan en pantalla calibrada.',
    createdAt: d(-200),
  },
  {
    id: 'cl3',
    name: 'RIFF Records',
    industry: 'Música & Entretenimiento',
    color: 'var(--resource-violet)',
    initials: 'RR',
    contact: { name: 'Nicolás Palma', email: 'nico@riff.com', phone: '+54 11 5555-0303' },
    tags: ['música', 'high-profile'],
    notes: 'Sello independiente. Tareas de alto perfil creativo. Pago por adelantado.',
    createdAt: d(-80),
  },
  {
    id: 'cl4',
    name: 'Café Origen',
    industry: 'Gastronomía & Lifestyle',
    color: 'var(--warn)',
    initials: 'CO',
    contact: { name: 'Valentina Ríos', email: 'vale@cafeorigen.com', phone: '+54 11 5555-0404' },
    tags: ['social', 'mensual', 'recurrente'],
    notes: 'Contrato mensual de contenido. Entregar lunes antes del mediodía para programar la semana.',
    createdAt: d(-300),
  },
  {
    id: 'cl5',
    name: 'Atelier Sur',
    industry: 'Moda & Lujo',
    color: 'var(--resource-blue)',
    initials: 'AS',
    contact: { name: 'Camila Fuentes', email: 'camila@ateliersur.com', phone: '+54 11 5555-0505' },
    tags: ['lujo', 'fotografía'],
    notes: 'Marca de lujo. Estética minimalista, paleta neutra. No hacer retoques excesivos.',
    createdAt: d(-60),
  },
  {
    id: 'cl6',
    name: 'MoveOn',
    industry: 'Fitness & Wellness',
    color: 'var(--resource-pink)',
    initials: 'MO',
    contact: { name: 'Tomás Herrera', email: 'tomas@moveon.com', phone: '+54 11 5555-0606' },
    tags: ['fitness', 'nuevo'],
    notes: 'Cliente nuevo. Primera tarea en curso. Potencial de contrato anual si la entrega es conforme.',
    createdAt: d(-15),
  },
];

// ── Paleta de colores para clientes ─────────────────────────────
const CLIENT_COLORS = [
  'var(--resource-coral)', 'var(--resource-teal)', 'var(--resource-violet)', 'var(--warn)',
  'var(--resource-blue)', 'var(--resource-pink)', 'var(--resource-green)', 'var(--danger)',
];

// Progreso operativo mensual del cliente. La fecha de inicio es la misma que
// ubica la tarea en el calendario; una tarea archivada no forma parte del
// trabajo del mes y una columna marcada como final cuenta como completada.
const clientMonthlyProgress = (projects, clientName, today = TODAY) => {
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const normalizedName = String(clientName || '').trim().toLowerCase();
  const monthly = (projects || []).filter(project =>
    String(project.client || '').trim().toLowerCase() === normalizedName
    && project.status !== 'archived'
    && String(project.startDate || '').startsWith(monthKey)
  );
  const completed = monthly.filter(project => isCompletionStatus(project.status)).length;
  return {
    total: monthly.length,
    completed,
    percent: monthly.length ? Math.round((completed / monthly.length) * 100) : 0,
  };
};

// ── Client avatar ────────────────────────────────────────────────
const ClientAvatar = ({ client, size = 40 }) => {
  const color = resolveThemeColor(client.color);
  return (
    <div
      className="rounded-xl flex items-center justify-center font-display font-bold flex-shrink-0"
      style={{
        width: size, height: size,
        background: colorAlpha(color, 10),
        color,
        fontSize: Math.max(11, size * 0.33),
        letterSpacing: '-0.02em',
        border: `1.5px solid ${colorAlpha(color, 27)}`,
      }}
    >
      {client.initials}
    </div>
  );
};

// ── Industry badge ───────────────────────────────────────────────
const IndustryBadge = ({ industry, color }) => (
  <span
    className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium"
    style={{ background: colorAlpha(resolveThemeColor(color), 9), color: resolveThemeColor(color) }}
  >
    {industry}
  </span>
);

// ── Client card ──────────────────────────────────────────────────
const ClientCard = ({ client, projects, onClick, com = null, dinero = null }) => {
  const clientColor = resolveThemeColor(client.color);
  const cp = projects.filter(p => p.client.toLowerCase() === client.name.toLowerCase());
  const totalBudget = cp.reduce((s, p) => s + (p.budget || 0), 0);
  const active = cp.filter(p => !isClosed(p)).length;

  return (
    <div
      onClick={onClick}
      className="group surf surf-hover lift cursor-pointer overflow-hidden"
    >
      {/* La barra de color a todo el ancho se fue: el color del cliente ya
          está en su avatar, y repetirlo en una franja lo convertía en
          decoración. El color identifica, no adorna. */}
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <ClientAvatar client={client} size={44} />
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="font-semibold text-[15px] truncate mb-1" style={{ letterSpacing: '-0.01em' }}>
              {client.name}
            </div>
            {/* La empresa de LOOPA, si no es el nombre: «Osman Garrido» es KM Motos. */}
            {client.commercial?.empresa && client.commercial.empresa.trim().toLowerCase() !== client.name.trim().toLowerCase() && (
              <div className="text-[12px] text-[var(--text-muted)] truncate mb-1">{client.commercial.empresa}</div>
            )}
            <IndustryBadge industry={client.industry} color={clientColor} />
          </div>
          <Icon
            name="arrowUpRight"
            size={13}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-muted)] mt-0.5"
          />
        </div>

        {/* Contact */}
        <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] mb-3 truncate">
          <Icon name="users" size={11} />
          <span className="truncate">{client.contact.name}</span>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-app">
          <div>
            <div
              className="text-[22px] font-display font-bold leading-none mb-0.5"
              style={{ color: clientColor, letterSpacing: '-0.03em' }}
            >
              {cp.length}
            </div>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em]">Tareas</div>
          </div>
          {dinero ? (
            <>
              <div>
                <div className="text-[22px] font-display font-bold leading-none mb-0.5 text-white" style={{ letterSpacing: '-0.03em' }}>
                  {com ? com.ventas : 0}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em]">Ventas</div>
              </div>
              <div>
                <div className="text-[13px] font-semibold leading-none mb-0.5 truncate" style={{ color: com && com.saldo > 0 ? 'var(--warn)' : 'var(--text-muted)' }}>
                  {com && com.saldo > 0 ? dinero(com.saldo) : '—'}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em]">Saldo</div>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="text-[22px] font-display font-bold leading-none mb-0.5 text-white" style={{ letterSpacing: '-0.03em' }}>
                  {active}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em]">Activos</div>
              </div>
              <div>
                <div className="text-[13px] font-semibold font-mono text-white leading-none mb-0.5 truncate">
                  {totalBudget > 0 ? fmtMoney(totalBudget) : '—'}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em]">Budget</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Parte comercial de la ficha (LOOPA) ──────────────────────────
// Lo que compró, lo que debe y el historial. Sólo cifras que dicen algo:
// el ticket promedio aparece con dos ventas o más (con una es el total).
const ComercialFicha = ({ client, comercial, onClose }) => {
  const r = comercial.porCliente[client.id] || { ventas: 0, total: 0, saldo: 0, historial: [] };
  const dinero = comercial.dinero;
  const cifras = [
    { k: 'Total comprado', v: r.total ? dinero(r.total) : '—' },
    r.saldo > 0
      ? { k: 'Saldo pendiente', v: dinero(r.saldo), cls: 'debe' }
      : { k: 'Saldo', v: r.ventas ? 'Al día' : '—', cls: r.ventas ? 'ok' : '' },
    { k: r.ventas === 1 ? 'Venta' : 'Ventas', v: r.ventas },
  ];
  if (r.ventas > 1) cifras.push({ k: 'Ticket prom.', v: dinero(r.total / r.ventas) });
  return (
    <section className="fc-bloque">
      <div className="fc-bloque-cab">
        <div className="fc-titulo"><Icon name="briefcase" size={14} /> Comercial</div>
      </div>
      <div className="fc-cifras">
        {cifras.map(x => (
          <div key={x.k} className="fc-cifra">
            <b className={x.cls || undefined}>{x.v}</b>
            <span className="fc-etiqueta">{x.k}</span>
          </div>
        ))}
      </div>
      {r.historial.length === 0 ? (
        <div className="fc-vacio">Todavía no hay ventas.</div>
      ) : r.historial.map(h => (
        <button key={h.clave} onClick={() => { onClose && onClose(); comercial.onAbrirVenta(h.clave); }}
          className={h.activa ? 'fc-venta' : 'fc-venta inactiva'}>
          <span className="fc-venta-n tnum">#{h.n}</span>
          <span className="fc-venta-que">{h.servicios}<small className="tnum">{comercial.fecha(h.fecha)}</small></span>
          <span className="fc-venta-monto tnum">{dinero(h.total)}</span>
          <span className={h.saldo > 0 ? 'fc-venta-estado debe' : 'fc-venta-estado'}>{h.saldo > 0 ? 'Debe ' + dinero(h.saldo) : h.estado}</span>
        </button>
      ))}
    </section>
  );
};

// Tareas que cuentan para el mes: las que empiezan este mes (igual que
// clientMonthlyProgress), sin archivadas.
const tareasDelMes = (cp, today = TODAY) => {
  const mes = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  return cp.filter(p => p.status !== 'archived' && String(p.startDate || '').startsWith(mes));
};
const hoyISO = () => localISO(new Date(TODAY));
const nombreMes = () => new Date(TODAY).toLocaleDateString('es-ES', { month: 'long' });

// ── Client detail panel ──────────────────────────────────────────
const ClientDetail = ({ client, projects, columns = [], onClose, onUpdate, onDelete, onSetPortal, onTogglePortalTask, comercial = null }) => {
  const [confirmDel, setConfirmDel] = useState(false);
  const [savingPortal, setSavingPortal] = useState(false);
  const [filtro, setFiltro] = useState('pendientes');
  const [verTodas, setVerTodas] = useState(false);
  if (!client) return null;

  const cp = projects.filter(p => p.client.toLowerCase() === client.name.toLowerCase());
  const clientColor = resolveThemeColor(client.color);
  const hoy = hoyISO();
  const vencida = (p) => !isClosed(p) && p.deadline && p.deadline < hoy;

  const upd        = (patch) => onUpdate({ ...client, ...patch });
  const addTags    = (list) => upd({ tags: [...new Set([...client.tags, ...list])] });
  const removeTag  = (t) => upd({ tags: client.tags.filter(x => x !== t) });

  // Este mes: una sola barra partida por estado (lo entregado a la izquierda).
  const delMes = tareasDelMes(cp);
  const base = delMes.length ? delMes : cp.filter(p => p.status !== 'archived');
  const estados = (columns.length ? columns : STATUSES.filter(s => s.id !== 'archived'))
    .map(s => ({ ...s, count: base.filter(p => p.status === s.id).length }))
    .filter(s => s.count > 0);
  const tramos = [...estados.filter(s => isCompletionStatus(s.id)), ...estados.filter(s => !isCompletionStatus(s.id)).reverse()];
  const hechas = base.filter(p => isCompletionStatus(p.status)).length;
  const pct = base.length ? Math.round((hechas / base.length) * 100) : 0;
  const vencidas = cp.filter(vencida).length;

  // Lo comercial de la ficha (empresa, canal) lo guarda el servidor.
  const datosCom = comercial ? (comercial.datos[client.id] || { empresa: '', canal: '' }) : null;
  const guardarCom = (patch) => comercial.onGuardar(client.id, patch, client.name);
  const empresa = datosCom && datosCom.empresa && datosCom.empresa.trim().toLowerCase() !== client.name.trim().toLowerCase() ? datosCom.empresa : '';

  // Tareas: pendientes primero, por fecha de entrega.
  const pendientes = cp.filter(p => !isClosed(p)).sort((a, b) => String(a.deadline || '9').localeCompare(String(b.deadline || '9')));
  const entregadas = cp.filter(p => p.status !== 'archived' && isCompletionStatus(p.status)).sort((a, b) => String(b.deadline || '').localeCompare(String(a.deadline || '')));
  const lista = filtro === 'pendientes' ? pendientes : filtro === 'entregadas' ? entregadas : [...pendientes, ...entregadas];
  const LIMITE = 8;
  // «Christian Padilla · Historias 6/12» → «Historias 6/12»: el cliente ya es el título del panel.
  const prefijo = client.name.trim().toLowerCase() + ' ·';
  const sinCliente = (t) => (String(t || '').toLowerCase().startsWith(prefijo) ? String(t).slice(prefijo.length).trim() : t);
  const visibles = verTodas ? lista : lista.slice(0, LIMITE);

  const filaDato = (icono, etiqueta, contenido, arriba = false) => (
    <div className={arriba ? 'fc-fila arriba' : 'fc-fila'}>
      <span className="fc-etiqueta"><Icon name={icono} size={12} /> {etiqueta}</span>
      <div className="min-w-0">{contenido}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 backdrop flex items-stretch justify-end anim-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-[600px] h-full flex flex-col anim-slide-right border-l border-app overflow-hidden"
        style={{ background: 'var(--surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-app flex-shrink-0">
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <Icon name="briefcase" size={13} />
            <span>Clientes</span>
            <span>›</span>
            <span className="text-[var(--text-dim)]">{client.name}</span>
          </div>
          <button aria-label="Cerrar" onClick={onClose} className="p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-dim)]">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Quién es y qué se puede hacer */}
          <div className="fc-cabecera" style={{ boxShadow: `inset 0 3px 0 ${clientColor}` }}>
            <ClientAvatar client={client} size={56} />
            <div className="fc-cabecera-texto">
              <InlineEdit
                value={client.name}
                onChange={(v) => upd({ name: v })}
                className="font-display font-bold text-[22px] leading-tight"
              />
              <div className="fc-sub">
                {empresa && <><span>{empresa}</span><span className="fc-sep">·</span></>}
                <InlineEdit value={client.industry} onChange={(v) => upd({ industry: v })} placeholder="Industria…" className="text-[13px] text-[var(--text-dim)]" />
                {datosCom && datosCom.canal && <><span className="fc-sep">·</span><span>Llegó por {datosCom.canal}</span></>}
              </div>
              {comercial && (
                <div className="fc-acciones">
                  <button className="fc-boton primario" onClick={() => { onClose && onClose(); comercial.onNuevaVenta(client.id, client.name); }}>
                    <Icon name="plus" size={12} strokeWidth={2.4} /> Nueva venta
                  </button>
                  {comercial.onResultados && (
                    <button className="fc-boton" data-test="ficha-resultados" onClick={() => { onClose && onClose(); comercial.onResultados(client.id); }}>
                      <Icon name="megaphone" size={12} /> Resultados
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="fc-cuerpo">
            {/* Cómo va el mes: una cifra, una barra, una leyenda */}
            <section className="fc-bloque">
              <div className="fc-bloque-cab">
                <div className="fc-titulo"><Icon name="calendar" size={14} /> {delMes.length ? <>Este mes <span className="fc-nota">· {nombreMes()}</span></> : 'Tareas'}</div>
                <span className="fc-mes-pct">{pct}%</span>
              </div>
              {base.length === 0 ? (
                <div className="fc-vacio">Sin tareas todavía.</div>
              ) : (
                <>
                  <div className="fc-mes-cifra">
                    <div><b className="tnum">{hechas}</b> <span>de {base.length} entregadas</span></div>
                  </div>
                  <div className="fc-barra" role="progressbar" aria-label={`Avance de ${client.name}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}>
                    {tramos.map(s => (
                      <span key={s.id} title={`${s.label}: ${s.count}`} style={{ flexGrow: s.count, background: s.color }} />
                    ))}
                  </div>
                  <div className="fc-leyenda">
                    {tramos.map(s => (
                      <span key={s.id}><i style={{ background: s.color }} />{s.label} <b className="tnum">{s.count}</b></span>
                    ))}
                    {vencidas > 0 && (
                      <button className="fc-alerta" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 12 }}
                        onClick={() => { setFiltro('pendientes'); setVerTodas(false); }}>
                        <Icon name="alert" size={12} /> {vencidas} vencida{vencidas > 1 ? 's' : ''}
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>

            {/* LOOPA (un solo sistema): lo comercial de la ficha, para quien vende. */}
            {comercial && <ComercialFicha client={client} comercial={comercial} onClose={onClose} />}

            {/* Datos del cliente */}
            <section className="fc-bloque">
              <div className="fc-bloque-cab">
                <div className="fc-titulo"><Icon name="user" size={14} /> Datos</div>
              </div>
              <div className="fc-filas">
                {datosCom && filaDato('briefcase', 'Empresa',
                  <InlineEdit value={datosCom.empresa} onChange={(v) => guardarCom({ empresa: v })} placeholder="Agregar empresa…" className="text-[13px]" />)}
                {datosCom && filaDato('link', 'Canal',
                  <div className="fc-canales">
                    {comercial.canales.map(ch => (
                      <button key={ch} onClick={() => guardarCom({ canal: ch })} className={datosCom.canal === ch ? 'fc-canal on' : 'fc-canal'}>{ch}</button>
                    ))}
                  </div>)}
                {[
                  { icon: 'users', label: 'Contacto', key: 'name',  value: client.contact.name, ph: 'Nombre del contacto…' },
                  { icon: 'at',    label: 'Email',    key: 'email', value: client.contact.email, ph: 'email@cliente.com', mono: true },
                  { icon: 'mic',   label: 'Teléfono', key: 'phone', value: client.contact.phone, ph: 'Teléfono…', mono: true },
                ].map(row => (
                  <React.Fragment key={row.key}>
                    {filaDato(row.icon, row.label,
                      <InlineEdit
                        value={row.value === '—' ? '' : row.value}
                        onChange={(v) => upd({ contact: { ...client.contact, [row.key]: v || '—' } })}
                        placeholder={row.ph}
                        className={row.mono ? 'text-[13px] font-mono' : 'text-[13px]'}
                      />)}
                  </React.Fragment>
                ))}
                {filaDato('hash', 'Etiquetas',
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {client.tags.map(t => (
                      <span key={t} className="group flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-[var(--surface-3)] text-[var(--text-dim)]">
                        #{t}
                        <button className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeTag(t)}>
                          <Icon name="x" size={10} />
                        </button>
                      </span>
                    ))}
                    <TagAdd onAdd={addTags} />
                  </div>)}
                {filaDato('edit', 'Notas',
                  <InlineEdit value={client.notes} onChange={(v) => upd({ notes: v })} placeholder="Preferencias, acuerdos, cosas a recordar…" multiline className="text-[13px] text-[var(--text-dim)] leading-relaxed" />, true)}
                {/* Portal externo: una proyección segura y controlada del trabajo. */}
                {filaDato('globe', 'Portal',
                  <div>
                    <div className="fc-portal">
                      <span className={client.portalPublished ? 'fc-portal-estado on' : 'fc-portal-estado'}>
                        {client.portalPublished ? 'Publicado: el cliente ve avance y entregables' : 'Sin publicar'}
                      </span>
                      <button
                        disabled={savingPortal}
                        onClick={async () => { setSavingPortal(true); try { await onSetPortal(client, !client.portalPublished); } finally { setSavingPortal(false); } }}
                        className="fc-boton"
                        style={client.portalPublished ? { color: 'var(--danger)' } : undefined}
                      >
                        {savingPortal ? 'Guardando…' : client.portalPublished ? 'Desactivar' : 'Publicar portal'}
                      </button>
                    </div>
                    {client.portalPublished && client.portalToken && (
                      <div className="fc-portal-enlace">
                        <div className="field px-2.5 py-2 text-[11px] truncate flex-1 tnum" style={{ color: 'var(--text-muted)' }}>{clientPortalUrl(client.portalToken)}</div>
                        <button onClick={() => navigator.clipboard.writeText(clientPortalUrl(client.portalToken)).then(() => window.frameToast?.('Enlace del portal copiado.'))} className="p-2 rounded-md" style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }} title="Copiar enlace"><Icon name="copy" size={13} /></button>
                        <a href={clientPortalUrl(client.portalToken)} target="_blank" rel="noopener noreferrer" className="p-2 rounded-md" style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }} title="Abrir portal"><Icon name="external" size={13} /></a>
                      </div>
                    )}
                  </div>, true)}
              </div>
            </section>

            {/* Tareas: pendientes primero, con filtro */}
            <section className="fc-bloque">
              <div className="fc-bloque-cab" style={{ flexWrap: 'wrap' }}>
                <div className="fc-titulo"><Icon name="list" size={14} /> Tareas</div>
                <div className="fc-filtros">
                  {[['pendientes', 'Pendientes', pendientes.length], ['entregadas', 'Entregadas', entregadas.length], ['todas', 'Todas', pendientes.length + entregadas.length]].map(([id, label, n]) => (
                    <button key={id} className={filtro === id ? 'fc-filtro on' : 'fc-filtro'} onClick={() => { setFiltro(id); setVerTodas(false); }}>
                      {label}<b className="tnum">{n}</b>
                    </button>
                  ))}
                </div>
              </div>
              {lista.length === 0 ? (
                <div className="fc-vacio">{filtro === 'pendientes' ? 'No hay tareas pendientes.' : 'Nada por acá.'}</div>
              ) : (
                <>
                  <div className="fc-tareas">
                    {visibles.map(p => {
                      const st = getStatus(p.status);
                      const tarde = vencida(p);
                      const visible = p.clientVisible !== false;
                      return (
                        <div key={p.id} className="fc-tarea">
                          <span className="fc-tarea-punto" style={{ background: st?.color || '#666' }} title={st?.label} />
                          <div className="fc-tarea-texto">
                            <div className="fc-tarea-titulo" title={p.title}>{sinCliente(p.title)}</div>
                            <div className={tarde ? 'fc-tarea-meta tarde' : 'fc-tarea-meta'}>
                              {st?.label}{p.deadline ? ` · ${tarde ? 'venció' : 'entrega'} ${fmtDate(p.deadline)}` : ''}
                            </div>
                          </div>
                          <button
                            onClick={() => onTogglePortalTask(p, !visible)}
                            className={visible ? 'fc-visible' : 'fc-visible oculta'}
                            title={visible ? 'Se ve en el portal. Click para ocultar.' : 'Oculta del portal. Click para mostrar.'}
                          >
                            <Icon name="globe" size={10} /> {visible ? 'En portal' : 'Oculta'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {lista.length > LIMITE && (
                    <button className="fc-mas" onClick={() => setVerTodas(v => !v)}>
                      {verTodas ? 'Ver menos' : `Ver las ${lista.length - LIMITE} restantes`}
                    </button>
                  )}
                </>
              )}
            </section>

            {/* ── Danger zone: eliminar cliente ── */}
            {onDelete && (
              <section className="pt-2">
                {!confirmDel ? (
                  <button
                    onClick={() => setConfirmDel(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] transition-colors"
                    style={{ color: 'var(--danger)', border: '1px dashed var(--danger-soft-2)' }}
                  >
                    <Icon name="trash" size={13} />
                    Eliminar cliente
                  </button>
                ) : (
                  <div className="rounded-lg p-4 border" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-2)' }}>
                    <div className="text-[13px] font-semibold mb-1" style={{ color: 'var(--danger)' }}>
                      ¿Eliminar "{client.name}"?
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mb-3">
                      {cp.length > 0
                        ? `Este cliente tiene ${cp.length} tarea${cp.length > 1 ? 's' : ''} vinculada${cp.length > 1 ? 's' : ''}. Las tareas conservarán el nombre, pero el cliente se eliminará del directorio.`
                        : 'Esta acción no se puede deshacer.'}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { onDelete(client.id); onClose(); }}
                        className="flex-1 py-1.5 rounded-md text-[13px] font-semibold"
                        style={{ background: 'var(--danger)', color: 'var(--danger-on)' }}
                      >
                        Sí, eliminar
                      </button>
                      <button
                        onClick={() => setConfirmDel(false)}
                        className="flex-1 py-1.5 rounded-md text-[13px] text-[var(--text-muted)] hover:text-white transition-colors"
                        style={{ background: 'var(--surface-3)' }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── New client modal ─────────────────────────────────────────────
const NewClientModal = ({ onCreate, onClose }) => {
  const [name, setName]               = useState('');
  const [industry, setIndustry]       = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail]             = useState('');
  const [color, setColor]             = useState(CLIENT_COLORS[0]);

  const initials = name.trim()
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

  const submit = () => {
    if (!name.trim()) return;
    onCreate({
      id: 'cl' + Date.now() + Math.random().toString(36).slice(2, 5),
      name: name.trim(),
      industry: industry.trim() || 'Sin categoría',
      color,
      initials,
      contact: {
        name:  contactName.trim() || '—',
        email: email.trim()       || '—',
        phone: '—',
      },
      tags: [],
      notes: '',
      createdAt: localISO(new Date()),
    });
  };

  return (
    <div className="fixed inset-0 z-50 backdrop flex items-center justify-center p-6 anim-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-md surf-panel anim-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-app">
          <div>
            <div className="font-display text-lg font-semibold" style={{ letterSpacing: '-0.01em' }}>Nuevo cliente</div>
            <div className="text-[11px] text-[var(--text-muted)]">Agregá un cliente al directorio del estudio</div>
          </div>
          <button aria-label="Cerrar" onClick={onClose} className="p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-dim)]">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Avatar preview + color picker */}
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center font-display font-bold text-lg flex-shrink-0 transition"
              style={{ background: colorAlpha(color, 10), color, border: `2px solid ${colorAlpha(color, 33)}`, letterSpacing: '-0.02em' }}
            >
              {initials}
            </div>
            <div className="flex gap-2 flex-wrap">
              {CLIENT_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-5 h-5 rounded-full border-2 transition hover:scale-110"
                  style={{ background: c, borderColor: color === c ? 'white' : 'transparent' }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">
              Nombre del cliente *
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="Ej: Volcán Activewear"
              className="w-full px-3 py-2.5 rounded-md text-[15px] surface-2 border border-app focus:border-[var(--accent)]/60"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Industria</label>
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Ej: Moda deportiva"
              className="w-full px-3 py-2.5 rounded-md text-[13px] surface-2 border border-app"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Contacto</label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Nombre completo"
                className="w-full px-3 py-2.5 rounded-md text-[13px] surface-2 border border-app"
              />
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@cliente.com"
                className="w-full px-3 py-2.5 rounded-md text-[13px] surface-2 border border-app"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-app">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[13px] hover:bg-[var(--surface-2)] text-[var(--text-dim)]">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="px-3 py-1.5 rounded-md text-[13px] font-semibold disabled:opacity-40 transition hover:brightness-110"
            style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
          >
            Crear cliente
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Client autocomplete (portal-based, used in ProjectModal) ────
const ClientAutocomplete = ({ value, onChange, clients = [], onCreateClient, fieldMode = false, placeholder = 'Buscar o escribir cliente…' }) => {
  const [query,  setQuery]  = useState(value || '');
  const [open,   setOpen]   = useState(false);
  const [pos,    setPos]    = useState({ top: 0, left: 0, width: 220 });
  const wrapRef  = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  // Sync display when value changes externally (but not while editing)
  useEffect(() => { if (!open) setQuery(value || ''); }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) {
        setOpen(false);
        // Vacío también vale: así se le quita el cliente a una tarea.
        const q = query.trim();
        if (q !== (value || '')) onChange(q);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, query, value]);

  const openDropdown = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 230) });
    setQuery(value || '');
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const filtered    = clients.filter(c => !query || c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 7);
  const exactMatch  = clients.find(c => c.name.toLowerCase() === (query || '').toLowerCase());
  const showCreate  = query.trim() && !exactMatch && onCreateClient;
  const matched     = clients.find(c => c.name.toLowerCase() === (value || '').toLowerCase());

  const select = (name) => { setQuery(name); onChange(name); setOpen(false); };

  const createAndSelect = () => {
    const q = query.trim();
    if (!q) return;
    const words    = q.split(/\s+/);
    const initials = words.map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
    const color    = CLIENT_COLORS[clients.length % CLIENT_COLORS.length];
    if (onCreateClient) onCreateClient({ id: 'cl' + Date.now() + Math.random().toString(36).slice(2, 5), name: q, industry: 'Sin categoría', color, initials, contact: { name: '—', email: '—', phone: '—' }, tags: [], notes: '', createdAt: localISO(new Date()) });
    onChange(q);
    setOpen(false);
  };

  const panel = open && ReactDOM.createPortal(
    <div
      ref={panelRef}
      className="anim-scale-in"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999,
        background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border-2)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)', overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}
      onClick={(e) => e.stopPropagation()}
    >
      {filtered.length === 0 && !showCreate && (
        <div className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">Sin resultados</div>
      )}
      {filtered.map(c => (
        <button key={c.id} onClick={() => select(c.name)}
          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[var(--surface-3)] transition-colors text-left"
        >
          <div className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0"
            style={{ background: colorAlpha(resolveThemeColor(c.color), 13), color: resolveThemeColor(c.color), border: `1px solid ${colorAlpha(resolveThemeColor(c.color), 27)}` }}>
            {c.initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium truncate">{c.name}</div>
            <div className="text-[10px] text-[var(--text-muted)] truncate">{c.industry}</div>
          </div>
          {value === c.name && <Icon name="check" size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
        </button>
      ))}
      {showCreate && (
        <div className={filtered.length > 0 ? 'border-t border-app' : ''}>
          <button onClick={createAndSelect}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-[var(--surface-3)] transition-colors text-left"
          >
            <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accent-soft)' }}>
              <Icon name="plus" size={11} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <div className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>Crear cliente</div>
              <div className="text-[10px] text-[var(--text-muted)]">"{query.trim()}"</div>
            </div>
          </button>
        </div>
      )}
    </div>,
    capaEstudio()
  );

  // ── fieldMode = styled like a form input (NewProjectModal)
  // ── default  = compact inline (PropRow inside ProjectModal)
  const wrapCls = fieldMode
    ? 'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md border cursor-pointer transition-colors'
    : 'flex items-center gap-2 px-2 py-1 -mx-2 rounded hover:bg-[var(--surface-2)] cursor-pointer transition-colors';
  const wrapStyle = fieldMode
    ? { background: 'var(--surface-2)', borderColor: open ? 'var(--accent-border)' : 'var(--border)' }
    : {};

  return (
    <>
      <div ref={wrapRef} onClick={openDropdown} className={wrapCls} style={wrapStyle}>
        {matched && !open && (
          <div className="w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
            style={{ background: colorAlpha(resolveThemeColor(matched.color), 13), color: resolveThemeColor(matched.color), border: `1px solid ${colorAlpha(resolveThemeColor(matched.color), 27)}` }}>
            {matched.initials.slice(0, 1)}
          </div>
        )}
        {open ? (
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { if (filtered.length > 0) select(filtered[0].name); else if (showCreate) createAndSelect(); else { onChange(query.trim()); setOpen(false); } }
              if (e.key === 'Escape') setOpen(false);
            }}
            className={`flex-1 bg-transparent outline-none ${fieldMode ? 'text-[13px]' : 'text-sm'}`}
            placeholder={placeholder}
            style={{ minWidth: 0 }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={`truncate ${fieldMode ? 'text-[13px]' : 'text-sm'}`}>
            {value || <span className="text-[var(--text-muted)]">{fieldMode ? placeholder : 'Sin cliente'}</span>}
          </span>
        )}
        {fieldMode && !open && (
          <Icon name="chevronDown" size={12} className="ml-auto flex-shrink-0 text-[var(--text-muted)]" />
        )}
      </div>
      {panel}
    </>
  );
};

// ── Clients section (main) ───────────────────────────────────────
const ClientsSection = ({ clients, projects, columns = [], onCreateClient, onUpdateClient, onDeleteClient, onSetClientPortal, onTogglePortalTask, openClientId, onOpenClient, onCloseClient, comercial = null, tableroVentas = null, onIrATablero }) => {
  const [search, setSearch]   = useState('');
  const [showNew, setShowNew] = useState(false);
  const [conSaldo, setConSaldo] = useState(false);
  const com = (id) => (comercial && comercial.porCliente[id]) || null;
  const saldoTotal = comercial ? clients.reduce((a, c) => a + ((com(c.id) || {}).saldo || 0), 0) : 0;

  const openClient = openClientId ? clients.find(c => c.id === openClientId) : null;

  const filtered = clients.filter(c => {
    if (conSaldo && !((com(c.id) || {}).saldo > 0)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const extra = [c.contact && c.contact.email, c.contact && c.contact.phone, comercial && comercial.datos[c.id] && comercial.datos[c.id].empresa].filter(Boolean).join(' ').toLowerCase();
    return c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q) || extra.includes(q);
  });

  const handleCreate = async (client) => {
    await onCreateClient(client);
    setShowNew(false);
  };

  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Section header */}
        <header className="border-b border-app px-5 py-3 flex flex-wrap items-center gap-3 estudio-cabecera">
          <div className="flex items-center gap-2 estudio-titulo">
            <Icon name="briefcase" size={15} className="text-[var(--text-muted)]" />
            <span className="font-display font-bold text-[15px]" style={{ letterSpacing: '-0.02em' }}>
              Clientes
            </span>
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
            >
              {clients.length}
            </span>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md surface-2 flex-1 max-w-sm min-w-0 estudio-buscador" style={{ minWidth: 160 }}>
            <Icon name="search" size={13} className="text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={comercial ? 'Buscar por nombre, empresa, email o teléfono…' : 'Buscar clientes o industria…'}
              className="flex-1 text-[13px]"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-[var(--text-muted)] hover:text-white">
                <Icon name="x" size={12} />
              </button>
            )}
          </div>

          {comercial && (
            <button onClick={() => setConSaldo(v => !v)}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors whitespace-nowrap"
              style={conSaldo ? { background: 'var(--warn-soft-2)', color: 'var(--warn)' } : { background: 'var(--surface-2)', color: 'var(--text-dim)' }}>
              Con saldo{saldoTotal > 0 ? ' · ' + comercial.dinero(saldoTotal) : ''}
            </button>
          )}

          <div className="flex-1" />

          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold hover:brightness-110 transition"
            style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
          >
            <Icon name="plus" size={13} strokeWidth={2.4} />
            Nuevo cliente
          </button>
        </header>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Las fichas de las ventas viven en el tablero de Producción: desde
              otro tablero no se ven, y parecía que vender no creaba el cliente. */}
          {tableroVentas && (
            <div className="clientes-otro-tablero">
              <Icon name="briefcase" size={14} />
              <span>Los clientes de tus ventas están en el tablero <b>{tableroVentas.nombre}</b>. Acá ves sólo los de este tablero.</span>
              <button onClick={() => onIrATablero && onIrATablero(tableroVentas.id)}>Ver {tableroVentas.nombre}</button>
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
                <Icon name="briefcase" size={22} className="text-[var(--text-muted)]" />
              </div>
              <div>
                <div className="text-[15px] font-medium mb-1">
                  {search ? `Sin resultados para "${search}"` : tableroVentas ? 'Este tablero no tiene clientes' : 'Sin clientes aún'}
                </div>
              </div>
              {!search && (
                <button
                  onClick={() => setShowNew(true)}
                  className="text-[13px] font-semibold px-4 py-2 rounded-lg transition hover:brightness-110"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  + Agregar cliente
                </button>
              )}
            </div>
          ) : (
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(255px, 1fr))' }}
            >
              {filtered.map(c => (
                <ClientCard
                  key={c.id}
                  client={c}
                  projects={projects}
                  onClick={() => onOpenClient(c.id)}
                  com={com(c.id)}
                  dinero={comercial ? comercial.dinero : null}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {openClient && (
        <ClientDetail
          client={openClient}
          projects={projects}
          columns={columns}
          onClose={onCloseClient}
          onUpdate={onUpdateClient}
          onDelete={onDeleteClient}
          onSetPortal={onSetClientPortal}
          onTogglePortalTask={onTogglePortalTask}
          comercial={comercial}
        />
      )}

      {/* New client modal */}
      {showNew && (
        <NewClientModal
          onCreate={handleCreate}
          onClose={() => setShowNew(false)}
        />
      )}
    </>
  );
};

Object.assign(window, { ClientsSection, ClientAutocomplete, SEED_CLIENTS, clientMonthlyProgress });
