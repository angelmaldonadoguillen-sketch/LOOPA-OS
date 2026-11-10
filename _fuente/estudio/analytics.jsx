// ─────────────────────────────────────────────────────────────────
// ANALYTICS — Dashboard de métricas del estudio
// ─────────────────────────────────────────────────────────────────

const AnalyticsSection = ({ projects, clients, team, currentUserId }) => {

  // ── Datos base ───────────────────────────────────────────────
  // "Activa" significa trabajo pendiente. Antes sólo se quitaban archivadas,
  // así que una tarea entregada seguía sumando carga, presupuesto y vencidos.
  const reportable = projects.filter(p => p.status !== 'archived');
  const active     = reportable.filter(p => !isClosed(p));
  const delivered  = reportable.filter(p => isCompletionStatus(p.status));
  const urgent     = active.filter(needsAttention);

  const totalBudget  = active.reduce((sum, p) => sum + (p.budget || 0), 0);
  const deliveryRate = reportable.length
    ? Math.round((delivered.length / reportable.length) * 100)
    : 0;

  const now      = new Date(TODAY);
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // ── Estado de proyectos ──────────────────────────────────────
  // Usa los statuses reales del workflow (sin archived)
  const workflowStatuses = (window.FRAME_KANBAN_COLUMNS || []).length
    ? window.FRAME_KANBAN_COLUMNS
    : STATUSES.filter(s => s.id !== 'archived');
  const statusGroups = workflowStatuses.map(s => ({
    ...s,
    color: resolveThemeColor(s.color),
    count: reportable.filter(p => p.status === s.id).length,
  }));
  const totalStatus = statusGroups.reduce((sum, s) => sum + s.count, 0) || 1;

  // ── Tipos de producción ──────────────────────────────────────
  // Deriva de los proyectos reales → maneja tipos custom automáticamente
  const typeIds    = [...new Set(reportable.map(p => p.type).filter(Boolean))];
  const typeCounts = typeIds
    .map(id => ({ ...getType(id), count: reportable.filter(p => p.type === id).length }))
    .sort((a, b) => b.count - a.count);
  const maxType = Math.max(...typeCounts.map(t => t.count), 1);

  // ── Carga del equipo (solo miembros activos) ─────────────────
  const activeTeam = team.filter(m => !m.status || m.status === 'active');
  const workload   = activeTeam
    .map(m => ({
      ...m,
      displayColor: resolveThemeColor(m.color),
      count: active.filter(p => p.assignees.includes(m.id)).length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const maxWork = Math.max(...workload.map(w => w.count), 1);

  // ── Top clientes (con colores reales) ────────────────────────
  const clientMap = {};
  reportable.forEach(p => {
    if (!p.client) return;
    if (!clientMap[p.client]) clientMap[p.client] = { name: p.client, count: 0, budget: 0 };
    clientMap[p.client].count++;
    clientMap[p.client].budget += (p.budget || 0);
  });
  const topClients = Object.values(clientMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map(c => {
      const cl = (clients || []).find(x => x.name === c.name);
      const fallbackPalette = [
        'var(--resource-violet)', 'var(--resource-teal)', 'var(--resource-blue)',
        'var(--resource-coral)', 'var(--resource-green)', 'var(--resource-orange)',
      ];
      const seed = [...c.name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      return { ...c, color: resolveThemeColor(cl?.color || fallbackPalette[seed % fallbackPalette.length]) };
    });

  // ── Proyectos por mes — últimos 6 meses (por deadline) ───────
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(TODAY);
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('es', { month: 'short' });
    const list  = reportable.filter(p => (p.deadline || p.startDate || '').startsWith(key));
    months.push({ key, label, count: list.length, budget: list.reduce((s, p) => s + (p.budget || 0), 0) });
  }
  const maxMonthly = Math.max(...months.map(m => m.count), 1);

  // ── Favoritos ────────────────────────────────────────────────
  const favCount = reportable.filter(p => p.favorite).length;

  const fmtCurrency = (n) => {
    if (!n) return '$0';
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
    return `$${n}`;
  };

  // ── Próximos deadlines ───────────────────────────────────────
  const upcoming = active
    .filter(p => p.deadline)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 5);

  return (
    <main className="flex-1 flex flex-col overflow-hidden">

      {/* ── Page header ── */}
      <div className="border-b border-app px-4 md:px-6 py-4 flex items-center justify-between gap-3 flex-shrink-0" style={{ background: 'var(--surface)' }}>
        <div>
          <div className="font-display font-bold text-xl" style={{ letterSpacing: '-0.02em' }}>Producción</div>
          <div className="text-[12px] text-[var(--text-muted)] mt-0.5">
            {reportable.length} tareas · {activeTeam.length} integrantes activos · {clients.length} clientes
          </div>
        </div>
        <div
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px]"
          style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
        >
          <Icon name="clock" size={13} />
          {TODAY.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 space-y-5">

        {/* ── KPI cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
          <KpiCard
            icon="layers"
            label="Tareas activas"
            value={active.length}
            sub={`${reportable.length} en total · ${favCount} favorito${favCount !== 1 ? 's' : ''}`}
            color="var(--accent)"
          />
          <KpiCard
            icon="zap"
            label="Presupuesto activo"
            value={fmtCurrency(totalBudget)}
            sub={totalBudget > 0 ? 'en tareas activas' : 'sin presupuesto registrado'}
            color="var(--resource-teal)"
          />
          <KpiCard
            icon="check"
            label="Tasa de entrega"
            value={`${deliveryRate}%`}
            sub={`${delivered.length} completada${delivered.length !== 1 ? 's' : ''} de ${reportable.length}`}
            color="var(--resource-violet)"
          />
          <KpiCard
            icon="alert"
            label="Fechas límite urgentes"
            value={urgent.length}
            sub="vencidas o próximas a vencer"
            color="var(--danger)"
          />
        </div>

        {/* ── Row 2: Estado + Tipo ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Status breakdown */}
          <div className="surf-panel p-5">
            <div className="ui-section-label mb-4">
              Estado de tareas
            </div>
            <div className="space-y-3">
              {statusGroups.map(s => {
                const pct = Math.round((s.count / totalStatus) * 100);
                return (
                  <div key={s.id} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="w-2 h-2 rounded-full" style={{ background: s.color }}></span>
                        <span className="text-[var(--text-dim)]">{s.label}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[12px]">
                        <span className="font-mono text-[var(--text-muted)]">{pct}%</span>
                        <span className="font-mono font-semibold w-5 text-right">{s.count}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                      <div className="h-full rounded-full transition duration-700" style={{ width: `${pct}%`, background: s.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Type breakdown — real project types */}
          <div className="surf-panel p-5">
            <div className="ui-section-label mb-4">
              Por tipo de producción
            </div>
            {typeCounts.length === 0 ? (
              <div className="text-[12px] text-[var(--text-muted)] text-center py-6">Sin datos de tipo</div>
            ) : (
              <div className="space-y-3">
                {typeCounts.map(t => {
                  const pct = Math.round((t.count / maxType) * 100);
                  return (
                    <div key={t.id} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[12px]">
                          <Icon name={t.icon || 'film'} size={12} style={{ color: t.color }} />
                          <span className="text-[var(--text-dim)]">{t.label}</span>
                        </div>
                        <span className="font-mono font-semibold text-[12px]">{t.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                        <div className="h-full rounded-full transition duration-700" style={{ width: `${pct}%`, background: t.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Row 3: Proyectos por mes + Carga del equipo ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4">

          {/* Monthly project count bar chart */}
          <div className="surf-panel p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="ui-section-label">
                Tareas por mes — últimos 6 meses
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">por fecha límite</div>
            </div>
            <div className="flex items-end gap-3" style={{ height: 120 }}>
              {months.map(m => {
                const pct       = (m.count / maxMonthly) * 100;
                const isCurrent = m.key === monthKey;
                return (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-1 group" style={{ height: '100%' }}>
                    <div className="flex-1 flex flex-col justify-end w-full">
                      <div
                        className="text-[10px] font-mono text-center mb-1 transition-opacity opacity-0 group-hover:opacity-100"
                        style={{ color: isCurrent ? 'var(--accent)' : 'var(--text-muted)' }}
                      >
                        {m.count > 0 ? `${m.count} tareas` : '–'}
                      </div>
                      <div
                        className="w-full rounded-t-md transition duration-700"
                        style={{
                          height:    `${Math.max(pct, 3)}%`,
                          minHeight: 4,
                          background: isCurrent ? 'var(--accent)' : 'var(--surface-3)',
                        }}
                      />
                    </div>
                    <div
                      className="text-[10px] font-mono capitalize mt-1.5 flex-shrink-0"
                      style={{ color: isCurrent ? 'var(--accent)' : 'var(--text-muted)' }}
                    >
                      {m.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Team workload — active members only */}
          <div className="surf-panel p-5">
            <div className="ui-section-label mb-4">
              Carga del equipo
            </div>
            {workload.length === 0 ? (
              <div className="text-[12px] text-[var(--text-muted)] text-center py-6">Sin integrantes activos</div>
            ) : (
              <div className="space-y-3">
                {workload.map(m => {
                  const pct = Math.round((m.count / maxWork) * 100);
                  return (
                    <div key={m.id} className="flex items-center gap-3">
                      <Avatar user={m} size={28} />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] truncate">{(m.name || '').split(' ')[0]}</span>
                          <span className="text-[11px] font-mono text-[var(--text-muted)]">
                            {m.count} {m.count === 1 ? 'tarea' : 'tareas'}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                          <div
                            className="h-full rounded-full transition duration-700"
                            style={{ width: `${pct}%`, background: m.displayColor }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Row 4: Top clientes ── */}
        <div className="surf-panel p-5">
          <div className="ui-section-label mb-4">
            Top clientes por volumen
          </div>
          {topClients.length === 0 ? (
            <div className="text-[12px] text-[var(--text-muted)] py-6 text-center">Sin datos aún</div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {topClients.map((c, i) => {
                const color = c.color;
                const bg    = colorAlpha(color, 13);
                return (
                  <div key={c.name} className="flex items-center gap-4 py-3">
                    <span className="text-[11px] font-mono text-[var(--text-muted)] w-4 text-center">{i + 1}</span>
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[15px] flex-shrink-0"
                      style={{ background: bg, color, border: `1px solid ${colorAlpha(color, 27)}` }}
                    >
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate">{c.name}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {c.count} tarea{c.count !== 1 ? 's' : ''}
                      </div>
                    </div>
                    {c.budget > 0 && (
                      <div className="text-right">
                        <div className="text-[13px] font-mono font-semibold" style={{ color: 'var(--accent)' }}>
                          {fmtCurrency(c.budget)}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">presupuesto</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Row 5: Próximos deadlines ── */}
        <div className="surf-panel p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="ui-section-label">
              Próximas fechas límite
            </div>
            {urgent.length > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--danger-soft-2)', color: 'var(--danger)' }}>
                {urgent.length} urgente{urgent.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {upcoming.map(p => {
              const d        = daysUntil(p.deadline);
              const st       = getStatus(p.status);
              const t        = getType(p.type);
              const isUrgent = d >= 0 && d < 3;
              const isOver   = d < 0;
              return (
                <div key={p.id} className="flex items-center gap-3 py-2 border-b border-app last:border-0 min-w-0">
                  <div className="w-0.5 h-8 rounded-full flex-shrink-0" style={{ background: t.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] truncate font-medium">{p.title}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px]" style={{ color: t.color }}>{t.label}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">·</span>
                      <span className="text-[10px] text-[var(--text-muted)] truncate">{p.client}</span>
                    </div>
                  </div>
                  <AvatarStack ids={p.assignees} size={20} max={3} />
                  <div
                    className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md flex-shrink-0"
                    style={{
                      background: isOver   ? 'var(--danger-soft-2)'         : isUrgent ? 'var(--danger-soft-2)'        : 'var(--surface-2)',
                      color:      isOver   ? 'var(--danger)'           : isUrgent ? 'var(--danger)'           : 'var(--text-muted)',
                    }}
                  >
                    {isOver ? 'vencido' : d === 0 ? 'hoy' : `${d}d`}
                  </div>
                </div>
              );
            })}
            {upcoming.length === 0 && (
              <div className="text-[12px] text-[var(--text-muted)] py-4 text-center">Sin tareas activas con fecha límite</div>
            )}
          </div>
        </div>

      </div>
    </main>
  );
};

// ── KPI Card ─────────────────────────────────────────────────────
const KpiCard = ({ icon, label, value, sub, color }) => (
  <div className="surf p-4 flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <div className="ui-section-label">{label}</div>
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: colorAlpha(color, 13), color }}
      >
        <Icon name={icon} size={14} />
      </div>
    </div>
    <div className="font-display text-3xl font-bold leading-none" style={{ color, letterSpacing: '-0.03em' }}>
      {value}
    </div>
    <div className="text-[11px] text-[var(--text-muted)]">{sub}</div>
  </div>
);

Object.assign(window, { AnalyticsSection, KpiCard });
