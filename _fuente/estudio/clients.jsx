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
// Ventas, total, saldo e historial; empresa y canal (los guarda el servidor);
// «Nueva venta» y abrir una venta llevan a Ventas de LOOPA.
const ComercialFicha = ({ client, comercial, onClose }) => {
  const r = comercial.porCliente[client.id] || { ventas: 0, total: 0, saldo: 0, historial: [] };
  const d = comercial.datos[client.id] || { empresa: '', canal: '' };
  const dinero = comercial.dinero;
  const ticket = r.ventas ? r.total / r.ventas : 0;
  const guardar = (patch) => comercial.onGuardar(client.id, patch, client.name);
  return (
    <section className="surf p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 font-semibold text-[13px]"><Icon name="briefcase" size={14} /> Comercial</div>
        <button
          onClick={() => { onClose && onClose(); comercial.onNuevaVenta(client.id, client.name); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold hover:brightness-110 transition"
          style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
        >
          <Icon name="plus" size={12} strokeWidth={2.4} /> Nueva venta
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { k: 'Ventas', v: r.ventas },
          { k: 'Total comprado', v: r.total ? dinero(r.total) : '—' },
          { k: 'Ticket prom.', v: r.ventas ? dinero(ticket) : '—' },
          { k: 'Saldo', v: r.saldo > 0 ? dinero(r.saldo) : '—', color: r.saldo > 0 ? 'var(--warn)' : undefined },
        ].map(x => (
          <div key={x.k} className="rounded-lg p-2.5" style={{ background: 'var(--surface-2)' }}>
            <div className="text-[15px] font-semibold leading-tight truncate" style={{ color: x.color || 'var(--text)' }}>{x.v}</div>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em] mt-1">{x.k}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em] mb-1">Empresa / marca</div>
          <InlineEdit value={d.empresa} onChange={(v) => guardar({ empresa: v })} placeholder="Agregar empresa…" className="text-[13px]" />
        </div>
        <div>
          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em] mb-1">Canal</div>
          <div className="flex flex-wrap gap-1.5">
            {comercial.canales.map(ch => (
              <button key={ch} onClick={() => guardar({ canal: ch })}
                className="px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors"
                style={d.canal === ch ? { background: 'var(--accent)', color: 'var(--accent-on)' } : { background: 'var(--surface-2)', color: 'var(--text-dim)' }}>
                {ch}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em] mb-1.5">Historial · {r.historial.length} ventas</div>
      {r.historial.length === 0 ? (
        <div className="text-[12px] text-[var(--text-muted)]">Todavía no hay ventas.</div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          {r.historial.map(h => (
            <button key={h.clave} onClick={() => { onClose && onClose(); comercial.onAbrirVenta(h.clave); }}
              className="w-full flex items-center gap-3 px-3 py-2 text-left text-[12px] border-b border-app last:border-b-0 hover:bg-[var(--surface-3)] transition-colors"
              style={{ opacity: h.activa ? 1 : 0.5 }}>
              <span className="font-semibold tnum" style={{ minWidth: 44 }}>#{h.n}</span>
              <span className="text-[var(--text-muted)] tnum" style={{ minWidth: 70 }}>{comercial.fecha(h.fecha)}</span>
              <span className="flex-1 truncate text-[var(--text-dim)]">{h.servicios}</span>
              <span className="tnum">{dinero(h.total)}</span>
              <span className="text-[10px] uppercase tracking-[0.1em]" style={{ color: h.saldo > 0 ? 'var(--warn)' : 'var(--text-muted)', minWidth: 72, textAlign: 'right' }}>{h.saldo > 0 ? 'Debe ' + dinero(h.saldo) : h.estado}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

// ── Client detail panel ──────────────────────────────────────────
const ClientDetail = ({ client, projects, columns = [], onClose, onUpdate, onDelete, onSetPortal, onTogglePortalTask, comercial = null }) => {
  const [confirmDel, setConfirmDel] = useState(false);
  const [savingPortal, setSavingPortal] = useState(false);
  if (!client) return null;

  const cp = projects.filter(p => p.client.toLowerCase() === client.name.toLowerCase());
  const totalBudget = cp.reduce((s, p) => s + (p.budget || 0), 0);
  const inProgress  = cp.filter(p => !isClosed(p)).length;
  const clientColor = resolveThemeColor(client.color);
  const monthlyProgress = clientMonthlyProgress(projects, client.name);

  const upd        = (patch) => onUpdate({ ...client, ...patch });
  const addTag     = (t) => { if (!t.trim()) return; upd({ tags: [...new Set([...client.tags, t.trim()])] }); };
  const removeTag  = (t) => upd({ tags: client.tags.filter(x => x !== t) });

  // Status breakdown
  const byStatus = (columns.length ? columns : STATUSES.filter(s => s.id !== 'archived')).map(s => ({
    ...s,
    count: cp.filter(p => p.status === s.id).length,
  })).filter(s => s.count > 0);

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
          {/* Color strip */}
          <div className="h-1" style={{ background: clientColor }}></div>

          {/* Hero section */}
          <div className="p-6 border-b border-app">
            <div className="flex items-start gap-4 mb-5">
              <ClientAvatar client={client} size={58} />
              <div className="flex-1 min-w-0">
                <InlineEdit
                  value={client.name}
                  onChange={(v) => upd({ name: v })}
                  className="font-display font-bold text-[22px] leading-tight"
                />
                <div className="mt-1">
                  <InlineEdit
                    value={client.industry}
                    onChange={(v) => upd({ industry: v })}
                    placeholder="Industria…"
                    className="text-[13px] text-[var(--text-dim)]"
                  />
                </div>
              </div>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: cp.length,    label: 'Tareas',     color: clientColor },
                { value: inProgress,   label: 'En curso',   color: '#ededef' },
                { value: totalBudget > 0 ? fmtMoney(totalBudget) : '—', label: 'Budget total', color: '#ededef', mono: true },
              ].map(s => (
                <div
                  key={s.label}
                  className="rounded-lg p-3 text-center"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <div
                    className={`text-[22px] font-display font-bold leading-none mb-1 ${s.mono ? 'text-[17px] font-mono' : ''}`}
                    style={{ color: s.color, letterSpacing: '-0.03em' }}
                  >
                    {s.value}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em]">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Progreso del mes */}
            <div className="mt-4 rounded-lg p-3.5" style={{ background: 'var(--surface-2)' }}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <div className="text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: 'var(--text-muted)' }}>
                    Progreso del mes
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
                    {monthlyProgress.total > 0
                      ? `${monthlyProgress.completed} de ${monthlyProgress.total} tareas completadas`
                      : 'Sin tareas iniciadas este mes'}
                  </div>
                </div>
                <div className="text-[18px] font-display font-bold flex-shrink-0" style={{ color: monthlyProgress.total > 0 ? clientColor : 'var(--text-muted)' }}>
                  {monthlyProgress.percent}%
                </div>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: 'var(--surface-3)' }}
                role="progressbar"
                aria-label={`Progreso mensual de ${client.name}`}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={monthlyProgress.percent}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${monthlyProgress.percent}%`, background: clientColor }}
                />
              </div>
            </div>

            {/* Status breakdown */}
            {byStatus.length > 0 && (
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                {byStatus.map(s => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium"
                    style={{ background: colorAlpha(s.color, 9), color: s.color }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }}></span>
                    {s.label} · {s.count}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="p-6 space-y-6">
            {/* LOOPA (un solo sistema): lo comercial de la ficha, para quien vende. */}
            {comercial && <ComercialFicha client={client} comercial={comercial} onClose={onClose} />}

            {/* Portal externo: una proyección segura y controlada del trabajo. */}
            <section className="surf p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold text-[13px]"><Icon name="globe" size={14} /> Portal del cliente</div>
                  <div className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>Compartí avance, calendario y entregables sin mostrar la operación interna.</div>
                </div>
                <button
                  disabled={savingPortal}
                  onClick={async () => { setSavingPortal(true); try { await onSetPortal(client, !client.portalPublished); } finally { setSavingPortal(false); } }}
                  className="px-3 py-1.5 rounded-md text-[11px] font-semibold flex-shrink-0 disabled:opacity-50"
                  style={{ background: client.portalPublished ? 'var(--danger-soft)' : 'var(--accent)', color: client.portalPublished ? 'var(--danger)' : 'var(--accent-on)' }}
                >
                  {savingPortal ? 'Guardando…' : client.portalPublished ? 'Desactivar' : 'Publicar portal'}
                </button>
              </div>
              {client.portalPublished && client.portalToken && (
                <div className="mt-3 flex items-center gap-2 min-w-0">
                  <div className="field px-2.5 py-2 text-[11px] truncate flex-1 tnum" style={{ color: 'var(--text-muted)' }}>{clientPortalUrl(client.portalToken)}</div>
                  <button onClick={() => navigator.clipboard.writeText(clientPortalUrl(client.portalToken)).then(() => window.frameToast?.('Enlace del portal copiado.'))} className="p-2 rounded-md" style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }} title="Copiar enlace"><Icon name="copy" size={13} /></button>
                  <a href={clientPortalUrl(client.portalToken)} target="_blank" rel="noopener noreferrer" className="p-2 rounded-md" style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }} title="Abrir portal"><Icon name="external" size={13} /></a>
                </div>
              )}
            </section>
            {/* Contact */}
            <section>
              <div className="ui-section-label mb-3">Contacto</div>
              <div className="space-y-1 rounded-lg overflow-hidden border border-app divide-y divide-[var(--border)]">
                {[
                  { icon: 'users', label: 'Nombre',   key: 'name',  value: client.contact.name  },
                  { icon: 'at',    label: 'Email',    key: 'email', value: client.contact.email, mono: true },
                  { icon: 'mic',   label: 'Teléfono', key: 'phone', value: client.contact.phone, mono: true },
                ].map(row => (
                  <div key={row.key} className="grid grid-cols-[110px_1fr] items-center" style={{ background: 'var(--surface-2)' }}>
                    <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-[var(--text-muted)]">
                      <Icon name={row.icon} size={12} />
                      {row.label}
                    </div>
                    <div className="px-3 py-1">
                      <InlineEdit
                        value={row.value}
                        onChange={(v) => upd({ contact: { ...client.contact, [row.key]: v } })}
                        className={`text-[13px] ${row.mono ? 'font-mono' : ''}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Tags */}
            <section>
              <div className="ui-section-label mb-2">Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {client.tags.map(t => (
                  <span key={t} className="group flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-[var(--surface-2)] text-[var(--text-dim)]">
                    #{t}
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeTag(t)}>
                      <Icon name="x" size={10} />
                    </button>
                  </span>
                ))}
                <TagAdd onAdd={addTag} />
              </div>
            </section>

            {/* Notes */}
            <section>
              <div className="ui-section-label mb-2">Notas internas</div>
              <InlineEdit
                value={client.notes}
                onChange={(v) => upd({ notes: v })}
                placeholder="Preferencias, acuerdos, cosas a recordar…"
                multiline
                className="text-[13px] text-[var(--text-dim)] leading-relaxed"
              />
            </section>

            {/* Projects list */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="ui-section-label">
                  Tareas ({cp.length})
                </div>
              </div>
              {cp.length === 0 ? (
                <div
                  className="text-center py-8 rounded-lg text-[12px] text-[var(--text-muted)]"
                  style={{ background: 'var(--surface-2)' }}
                >
                  Sin tareas
                </div>
              ) : (
                <div className="space-y-2">
                  {cp.map(p => {
                    const st = getStatus(p.status);
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 p-3 rounded-lg border border-app"
                        style={{ background: 'var(--surface-2)' }}
                      >
                        <div className="w-1 h-9 rounded-full flex-shrink-0" style={{ background: st?.color || '#666' }}></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium truncate">{p.title}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <TypePill type={p.type} />
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">
                              fecha límite {fmtDate(p.deadline)}
                            </span>
                          </div>
                        </div>
                        <StatusPill status={p.status} />
                        <button
                          onClick={() => onTogglePortalTask(p, p.clientVisible === false)}
                          className="px-2 py-1 rounded-md text-[10px] font-semibold flex-shrink-0"
                          style={{ background: p.clientVisible !== false ? 'var(--accent)' : 'var(--surface-3)', color: p.clientVisible !== false ? 'var(--accent-on)' : 'var(--text-muted)' }}
                          title={p.clientVisible !== false ? 'Ocultar del portal' : 'Mostrar en el portal'}
                        >
                          {p.clientVisible !== false ? 'Visible' : 'Oculta'}
                        </button>
                      </div>
                    );
                  })}
                </div>
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
        const q = query.trim();
        if (q && q !== value) onChange(q);
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
const ClientsSection = ({ clients, projects, columns = [], onCreateClient, onUpdateClient, onDeleteClient, onSetClientPortal, onTogglePortalTask, openClientId, onOpenClient, onCloseClient, comercial = null }) => {
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
        <header className="border-b border-app px-5 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
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
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md surface-2 flex-1 max-w-sm min-w-0" style={{ minWidth: 160 }}>
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
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
                <Icon name="briefcase" size={22} className="text-[var(--text-muted)]" />
              </div>
              <div>
                <div className="text-[15px] font-medium mb-1">
                  {search ? `Sin resultados para "${search}"` : 'Sin clientes aún'}
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
