// ─────────────────────────────────────────────────────────────────
// VIEWS — Calendar, Kanban, Gallery, List
// ─────────────────────────────────────────────────────────────────

// ── Project mini card (used in calendar + kanban) ──────────────
// ── Contador de entrega ──────────────────────────────────────────
// El dato que más decide el día del estudio. Antes estaba enterrado abajo
// en gris junto a un icono de calendario; ahora es lo segundo que ve el ojo
// y es el único lugar de la tarjeta donde el color grita. Devuelve también
// el tono, así que urgencia y color salen siempre del mismo cálculo y no
// pueden desincronizarse (antes había badges URG/VENC con su propia lógica).
const CardEditingContext = React.createContext(null);

// Un mismo editor para tarjetas y filas; nunca modifica la sesión al editar entrega.
const CardQuickFields = ({ project, previewFields = {} }) => {
  const ctx = React.useContext(CardEditingContext);
  if (!ctx) return null;
  const set = (key, value) => ctx.update(project.id, { [key]: value });
  const choices = (items, current) => items.some(x => x.id === current) ? items : [{ id: current, label: current }, ...items];
  const stop = e => e.stopPropagation();
  return <div className="frame-quick-fields" onClick={stop} onPointerDown={stop} onKeyDown={stop} draggable={false} onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}>
    {previewFields.deadline !== false && <label>Entrega
      <input aria-label="Fecha de entrega" type="date" value={project.deadline || ''} onChange={e => set('deadline', e.target.value)}
        disabled={!!window.FrameLoopa?.isFromSale(project)} title={window.FrameLoopa?.isFromSale(project) ? 'La entrega la fija la venta en LOOPA' : undefined} />
      {!project.deadline && <span>Sin fecha</span>}
    </label>}
    <div className="frame-quick-pair">
      {previewFields.estado !== false && <label>Estado<select aria-label="Estado" value={project.status} onChange={e => set('status', e.target.value)}>{choices(ctx.columns, project.status).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>}
      {previewFields.prioridad !== false && <label>Prioridad<select aria-label="Prioridad" value={project.priority} onChange={e => set('priority', e.target.value)}>{PRIORITIES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>}
    </div>
    {previewFields.progreso !== false && <details><summary>Checklist · {(project.checklist || []).filter(x => x.done).length} de {(project.checklist || []).length}</summary>
      {!project.checklist?.length && <span>Sin pendientes definidos. Agregalos en el detalle.</span>}
      {(project.checklist || []).map((item, index) => <label key={item.id || index} className="frame-quick-check"><input type="checkbox" checked={!!item.done} onChange={e => set('checklist', project.checklist.map((x, i) => i === index ? { ...x, done: e.target.checked } : x))} />{item.text}</label>)}
    </details>}
    {previewFields.tags && project.tags?.length > 0 && <div>{project.tags.slice(0, 2).map(t => '#' + t).join(' ')}{project.tags.length > 2 ? ' +' + (project.tags.length - 2) : ''}</div>}
    <details><summary>Editar campos</summary>
      <label>Título<input aria-label="Título" key={project.id + project.title} defaultValue={project.title} onBlur={e => { const title = e.target.value.trim(); if (title) set('title', title); else e.target.value = project.title; }} /></label>
      <label>Cliente<input aria-label="Cliente" key={project.id + project.client} defaultValue={project.client || ''} onBlur={e => set('client', e.target.value.trim())} /></label>
      <label>Tipo<select aria-label="Tipo" value={project.type} onChange={e => set('type', e.target.value)}>{choices(ctx.types, project.type).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      <label>Tags (separados por coma)<input aria-label="Tags" key={JSON.stringify(project.tags)} defaultValue={(project.tags || []).join(', ')} onBlur={e => set('tags', [...new Set(e.target.value.split(',').map(x => x.trim()).filter(Boolean))])} /></label>
      {ctx.shared && <fieldset><legend>Responsables</legend>{ctx.members.map(member => <label key={member.id} className="frame-quick-check"><input type="checkbox" checked={(project.assignees || []).includes(member.id)} onChange={e => set('assignees', e.target.checked ? [...(project.assignees || []), member.id] : project.assignees.filter(id => id !== member.id))} />{member.name}</label>)}</fieldset>}
    </details>
    {!!project.deliverables?.length && <span>{project.deliverables.length} recursos · abrir detalle</span>}
  </div>;
};

const deliveryCounter = (project) => {
  if (isClosed(project)) {
    return { value: '✓', label: project.status === 'archived' ? 'Archivada' : getStatus(project.status).label, color: 'var(--text-muted)' };
  }
  const d = daysUntil(project.deadline);
  if (!project.deadline || !Number.isFinite(d)) return { value: '—', label: 'Sin fecha', color: 'var(--text-muted)' };
  if (d < 0)  return { value: '+' + Math.abs(d), label: 'Vencido',    color: 'var(--danger)' };
  if (d === 0) return { value: 'Hoy',            label: 'Entrega',    color: 'var(--accent)' };
  if (d <= 3)  return { value: d + ' d',         label: 'Restantes',  color: 'var(--warn)' };
  return         { value: d + ' d',              label: 'Restantes',  color: 'var(--text-muted)' };
};

// ── Movimiento de tarjetas ──────────────────────────────────────
// Al cambiar de columna, de día o de orden, el navegador vuelve a dibujar la
// tarjeta directamente en su lugar nuevo: aparece y desaparece, y hay que
// buscarla con la vista. Acá se anota dónde estaba cada tarjeta antes del
// repintado y se la anima desde ahí hasta donde quedó (técnica FLIP), así se
// ve el viaje. La recién llegada entra con un leve ascenso y la que se acaba
// de mover deja un destello para no perderle el rastro.
//
// Se anima con la API del navegador y no con CSS porque el punto de partida
// solo se conoce en el momento: no hay clase que lo pueda describir.
const CARD_MOVE = { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' };
const frameStillMode = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Destello al llegar: dice cuál es la tarjeta que se acaba de mover sin
// empujar a las vecinas, porque el contorno no ocupa lugar.
const cardLanded = card => card.animate([{ outlineColor: 'var(--accent)' }, { outlineColor: 'transparent' }], { duration: 700, easing: 'ease-out' });

// Dónde está la tarjeta dentro de la página, en medidas de maquetado. No se
// usa getBoundingClientRect porque esa cuenta desde la ventana: si entre un
// repintado y otro se movió el scroll, todas las tarjetas parecerían haber
// viajado. offsetLeft/offsetTop no se enteran del scroll.
const cardSpot = card => {
  let x = 0, y = 0, node = card;
  while (node) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent; }
  return { x, y, width: card.offsetWidth, height: card.offsetHeight, parent: card.parentElement };
};

// Viaje entre columnas o entre días: la columna recorta lo que se sale de su
// área, así que la tarjeta no puede viajar por dentro. Vuela una copia por
// encima de todo y la original espera escondida hasta que aterriza.
const flyCard = (card, dx, dy) => {
  const here = card.getBoundingClientRect();
  const clone = card.cloneNode(true);
  clone.removeAttribute('data-card-id');
  clone.setAttribute('data-card-flight', '');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.cssText = `position:fixed;left:${here.left + dx}px;top:${here.top + dy}px;width:${here.width}px;height:${here.height}px;margin:0;z-index:70;pointer-events:none;transform-origin:top left;`;
  capaEstudio().appendChild(clone);
  card.style.visibility = 'hidden';
  const trip = clone.animate([
    { transform: 'translate(0,0)' },
    { transform: `translate(${-dx}px, ${-dy}px)` },
  ], { duration: 380, easing: CARD_MOVE.easing });
  const land = () => { clone.remove(); card.style.visibility = ''; cardLanded(card); };
  trip.finished.then(land, land);
};

const useCardMotion = (ref) => {
  const previous = React.useRef(new Map());
  const anotar = () => {
    const root = ref.current;
    const cards = root ? Array.from(root.querySelectorAll('[data-card-id]')) : [];
    return new Map(cards.map(card => [card.dataset.cardId, cardSpot(card)]));
  };
  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const current = anotar();
    const known = previous.current.size > 0;
    if (known && !frameStillMode() && typeof Element.prototype.animate === 'function') {
      root.querySelectorAll('[data-card-id]').forEach(card => {
        const was = previous.current.get(card.dataset.cardId), now = current.get(card.dataset.cardId);
        if (!was) {
          card.animate([{ opacity: 0, transform: 'translateY(10px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: CARD_MOVE.easing });
          return;
        }
        const dx = was.x - now.x, dy = was.y - now.y;
        // Menos de 2px no es un movimiento. Si además cambió de tamaño, la
        // medida anterior es de otra maquetación (la ventana cambió de ancho,
        // o los estilos llegaron tarde) y animarla se vería como un salto.
        if (Math.hypot(dx, dy) < 2) return;
        if (Math.abs(was.width - now.width) > 24 || Math.abs(was.height - now.height) > 24) return;
        if (was.parent !== now.parent) { flyCard(card, dx, dy); return; }
        card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], CARD_MOVE);
      });
    }
    previous.current = current;
  });
  // Si cambia el tamaño del tablero, lo anotado deja de servir: se vuelve a
  // medir sin animar, para no arrastrar posiciones de la maquetación anterior.
  React.useEffect(() => {
    const root = ref.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { previous.current = anotar(); });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
};

const ProjectCardMini = ({ project, onClick, draggable, onDragStart, onDragEnd, dragging, compact, onDelete, onDuplicate, onToggleFavorite, previewFields = {} }) => {
  const editing = React.useContext(CardEditingContext);
  const pf = editing && !editing.shared ? { ...previewFields, responsables: false, presupuesto: false } : previewFields;
  const t = getType(project.type);
  const origen = boardOrigin(project);
  const progress = progressOf(project);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const counter = deliveryCounter(project);

  const done  = (project.checklist || []).filter(c => c.done).length;
  const total = (project.checklist || []).length;

  const hasBudget = pf.presupuesto && project.budget > 0;
  const showCounter = pf.deadline !== false;
  const hasActions = onToggleFavorite || onDuplicate || onDelete;

  // Metadatos en una sola línea separada por puntos, en vez de cuatro
  // renglones apilados. Es lo que hace que la tarjeta se lea de un vistazo.
  const meta = [];
  if (pf.cliente !== false && project.client) meta.push(project.client);
  if (hasBudget) meta.push(`${currencyLabel(project.currency)} ${project.budget.toLocaleString()}`);

  return (
    <div
      data-card-id={project.id}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group lift cursor-pointer relative select-none ${dragging ? 'dragging' : ''}`}
      style={{
        background: 'var(--surface-2)',
        borderRadius: 'var(--r-md)',
        padding: compact ? '10px 11px' : '12px 13px',
        // Filo superior iluminado: en tema oscuro la profundidad se hace con
        // luz, no con sombra. Es lo que hace que se sienta material.
        boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.06)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">

          {/* Tipo: un punto del color + la palabra. El color pasa a ser
              identificador, no decoración a todo el ancho. */}
          {(pf.tipo !== false || pf.estado !== false) && (
            <div className="flex items-center gap-1.5 mb-1" style={{ color: 'var(--text-muted)' }}>
              <span className="rounded-full flex-shrink-0" style={{ width: 5, height: 5, background: t.color }} />
              {pf.tipo !== false && <span className="text-[11px] font-medium truncate">{t.label}</span>}
              {pf.estado !== false && (
                <>
                  <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>·</span>
                  <span className="text-[11px] truncate">{getStatus(project.status).label}</span>
                </>
              )}
              {project.favorite && (
                <Icon name="star" size={9} fill="currentColor" style={{ color: 'var(--warn)', flexShrink: 0 }} />
              )}
            </div>
          )}

          <div className="text-[13px] font-semibold leading-snug balance" style={{ letterSpacing: '-0.012em', color: 'var(--text)' }}>
            {project.title}
          </div>

          {(meta.length > 0 || pf.responsables !== false || origen) && (
            <div className="flex items-center gap-1.5 mt-1 text-[12px] min-w-0" style={{ color: 'var(--text-muted)' }}>
              {origen && (
                <span className="text-[10px] px-1.5 rounded flex-shrink-0 truncate" title={'Esta tarjeta vive en ' + origen}
                  style={{ background: 'var(--surface-3)', color: 'var(--text-dim)', maxWidth: '55%' }}>{origen}</span>
              )}
              {meta.map((m, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span style={{ color: 'var(--text-faint)' }}>·</span>}
                  <span className="truncate tnum">{m}</span>
                </React.Fragment>
              ))}
              {pf.responsables !== false && project.assignees?.length > 0 && (
                <>
                  {meta.length > 0 && <span style={{ color: 'var(--text-faint)' }}>·</span>}
                  <AvatarStack ids={project.assignees} size={16} max={3} />
                </>
              )}
            </div>
          )}
        </div>

        {/* Firma: el contador */}
        {showCounter && (
          <div className="text-right flex-shrink-0 tnum" style={{ lineHeight: 1 }}>
            <div className="text-[15px] font-semibold" style={{ color: counter.color, letterSpacing: '-0.02em' }}>
              {counter.value}
            </div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>{counter.label}</div>
          </div>
        )}
      </div>

      {/* Pie: progreso corto a la izquierda, acciones a la derecha en hover.
          A todo el ancho la barra se leía como un subrayado divisorio. */}
      {(pf.progreso !== false || hasActions) && (
        <div className="flex items-center gap-2 mt-2.5" style={{ minHeight: 18 }}>
          {pf.progreso !== false && total > 0 && (
            <>
              <div className="rounded-full overflow-hidden flex-shrink-0" style={{ width: 54, height: 3, background: 'rgba(255,255,255,.09)' }}>
                <div className="h-full rounded-full" style={{ width: progress + '%', background: progress >= 100 ? 'var(--accent)' : 'var(--text-faint)' }} />
              </div>
              <span className="text-[10px] tnum" style={{ color: 'var(--text-faint)' }}>{done}/{total}</span>
            </>
          )}

          {hasActions && (
            <div className="ml-auto flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              {confirmDel ? (
                <>
                  <span className="text-[11px] font-medium mr-1" style={{ color: 'var(--danger)' }}>¿Eliminar?</span>
                  <button onClick={() => onDelete(project.id)}
                    className="text-[11px] font-semibold px-2 py-0.5 rounded"
                    style={{ background: 'var(--danger)', color: '#fff' }}>Sí</button>
                  <button onClick={() => setConfirmDel(false)}
                    className="text-[11px] px-2 py-0.5 rounded"
                    style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}>No</button>
                </>
              ) : (
                <>
                  {onToggleFavorite && (
                    <button onClick={() => onToggleFavorite(project.id)}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: project.favorite ? 'var(--warn)' : 'var(--text-muted)' }}
                      title={project.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}>
                      <Icon name="star" size={12} fill={project.favorite ? 'currentColor' : 'none'} />
                    </button>
                  )}
                  {onDuplicate && (
                    <button onClick={() => onDuplicate(project.id)}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--accent)]"
                      style={{ color: 'var(--text-muted)' }} title="Duplicar">
                      <Icon name="copy" size={12} />
                    </button>
                  )}
                  {onDelete && (
                    <button onClick={() => setConfirmDel(true)}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--danger)]"
                      style={{ color: 'var(--text-muted)' }} title="Eliminar">
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Column color presets ─────────────────────────────────────────
const COL_COLORS = [
  'var(--resource-neutral)','var(--warn)','var(--resource-blue)','var(--resource-violet)','var(--resource-teal)',
  'var(--resource-coral)','var(--resource-pink)','var(--resource-green)','var(--danger)','var(--resource-green)',
  'var(--resource-orange)','var(--resource-pink)','var(--resource-violet)','var(--info)','var(--resource-blue)',
];

// ── Column settings menu (rendered via portal to escape overflow clipping) ──
const ColMenuBtn = ({ col, projectCount, onUpdate, onDelete }) => {
  const [open, setOpen]   = useState(false);
  const [pos, setPos]     = useState({ top: 0, right: 0 });
  const [label, setLabel] = useState(col.label);
  const [wipLimit, setWipLimit] = useState(col.wipLimit || '');
  const btnRef  = useRef(null);
  const panelRef = useRef(null);

  // sync label when col changes (e.g. after save)
  useEffect(() => { setLabel(col.label); setWipLimit(col.wipLimit || ''); }, [col.label, col.wipLimit, col.isDone, col.requiresChecklist]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!btnRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    setOpen(v => !v);
  };

  const commitLabel = () => {
    const t = label.trim();
    if (t && t !== col.label) onUpdate({ ...col, label: t });
  };

  const panel = open && ReactDOM.createPortal(
    <div
      ref={panelRef}
      className="anim-scale-in"
      style={{
        position: 'fixed', top: pos.top, right: pos.right,
        width: 240, zIndex: 9999,
        background: 'var(--surface-2)', borderRadius: 12,
        border: '1px solid var(--border-2)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        padding: '12px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Nombre */}
      <div className="mb-3">
        <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Nombre</div>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => { if (e.key === 'Enter') { commitLabel(); e.target.blur(); } }}
          className="w-full px-2.5 py-1.5 field text-[13px]"
         
        />
      </div>

      {/* Comportamiento: el nombre y el color son presentación; estas
          propiedades deciden cómo participa la columna en la dinámica. */}
      <div className="mb-3 space-y-1.5">
        <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Comportamiento</div>
        <button
          onClick={() => onUpdate({ ...col, isDone: !col.isDone })}
          className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-md text-left hover:bg-[var(--surface-3)]"
        >
          <span className="text-[12px]">Cuenta como completada</span>
          <span className="w-8 h-[18px] rounded-full p-0.5 flex-shrink-0 transition-colors" style={{ background: col.isDone ? 'var(--accent)' : 'var(--surface-3)' }}>
            <span className="block w-3.5 h-3.5 rounded-full transition-transform" style={{ background: col.isDone ? 'var(--accent-on)' : 'var(--text-muted)', transform: col.isDone ? 'translateX(14px)' : 'translateX(0)' }} />
          </span>
        </button>
        <button
          onClick={() => onUpdate({ ...col, requiresChecklist: !col.requiresChecklist })}
          className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-md text-left hover:bg-[var(--surface-3)]"
        >
          <span className="text-[12px] leading-tight">Exigir checklist al 100% para entrar</span>
          <span className="w-8 h-[18px] rounded-full p-0.5 flex-shrink-0 transition-colors" style={{ background: col.requiresChecklist ? 'var(--accent)' : 'var(--surface-3)' }}>
            <span className="block w-3.5 h-3.5 rounded-full transition-transform" style={{ background: col.requiresChecklist ? 'var(--accent-on)' : 'var(--text-muted)', transform: col.requiresChecklist ? 'translateX(14px)' : 'translateX(0)' }} />
          </span>
        </button>
      </div>

      <div className="mb-3">
        <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Límite en curso</div>
        <input
          type="number"
          min="1"
          value={wipLimit}
          onChange={(e) => setWipLimit(e.target.value)}
          onBlur={() => {
            const next = Math.max(0, Number.parseInt(wipLimit, 10) || 0);
            if (next !== (col.wipLimit || 0)) onUpdate({ ...col, wipLimit: next || undefined });
          }}
          placeholder="Sin límite"
          className="w-full px-2.5 py-1.5 field text-[13px]"
         
        />
      </div>

      {/* Color */}
      <div className="mb-3">
        <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Color</div>
        <div className="grid grid-cols-5 gap-1.5">
          {COL_COLORS.map(c => (
            <button
              key={c}
              onClick={() => onUpdate({ ...col, color: c })}
              className="w-8 h-8 rounded-md transition hover:scale-110"
              style={{
                background: c,
                boxShadow: col.color === c ? `0 0 0 2px var(--surface-2), 0 0 0 3.5px ${c}` : 'none',
              }}
            />
          ))}
        </div>
      </div>

      {/* Eliminar */}
      <div className="border-t border-app pt-2">
        <button
          onClick={() => { if (projectCount === 0) { onDelete(col.id); setOpen(false); } }}
          disabled={projectCount > 0}
          title={projectCount > 0 ? `Mové las ${projectCount} tareas antes de eliminar` : ''}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] transition-colors disabled:opacity-35 hover:bg-[var(--danger-soft)]"
          style={{ color: 'var(--danger)' }}
        >
          <Icon name="trash" size={13} />
          {projectCount > 0
            ? `${projectCount} tarea${projectCount > 1 ? 's' : ''} — no se puede eliminar`
            : 'Eliminar columna'}
        </button>
      </div>
    </div>,
    capaEstudio()
  );

  return (
    <>
      <button aria-label="Opciones de la columna"
        ref={btnRef}
        onClick={openMenu}
        className={`p-1 rounded transition-colors ${open ? 'bg-[var(--surface-3)] text-white' : 'text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-2)]'}`}
      >
        <Icon name="more" size={14} />
      </button>
      {panel}
    </>
  );
};

// ── Quick-add inline card ───────────────────────────────────────
// Botón "+" que se transforma en una tarjeta vacía con input de título.
// Hereda contexto (estado de columna / fecha del día) según dónde se monta.
// variant: 'full' = botón ancho con texto · 'mini' = solo ícono "+" (celdas chicas)
const QuickAddCard = ({ onCreate, context = {}, variant = 'full', label = 'Nueva tarea' }) => {
  const [active, setActive] = React.useState(false);
  const [title, setTitle]   = React.useState('');
  const inputRef = React.useRef(null);

  React.useEffect(() => { if (active) inputRef.current?.focus(); }, [active]);

  const submit = () => {
    const t = title.trim();
    if (!t) { setActive(false); setTitle(''); return; }
    onCreate && onCreate({ title: t, ...context });
    setTitle('');
    // Se mantiene abierto para carga rápida de varias tarjetas seguidas
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // ── Estado activo: tarjeta con input (compartido por ambos variants) ──
  if (active) {
    return (
      <div className="rounded-lg border p-2 anim-scale-in select-none" style={{ background: 'var(--surface-2)', borderColor: 'var(--accent)' }}>
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter')  { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { setActive(false); setTitle(''); }
          }}
          onBlur={() => { if (!title.trim()) { setActive(false); setTitle(''); } }}
          placeholder="Título de la tarea…"
          className="w-full bg-transparent outline-none text-[13px]"
          style={{ color: 'var(--text)' }}
        />
        <div className="flex items-center gap-1.5 mt-2">
          <button onMouseDown={(e) => e.preventDefault()} onClick={submit} disabled={!title.trim()}
            className="px-2 py-1 rounded text-[11px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>
            Crear
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => { setActive(false); setTitle(''); }}
            className="px-1.5 py-1 rounded text-[var(--text-muted)] hover:text-white" style={{ background: 'var(--surface-3)' }}>
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>
    );
  }

  // ── Variant mini: solo "+" discreto (aparece en hover) ──
  if (variant === 'mini') {
    return (
      <button onClick={() => setActive(true)}
        className="w-full flex items-center justify-center py-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors opacity-0 group-hover:opacity-100"
        title={label}>
        <Icon name="plus" size={13} />
      </button>
    );
  }

  // ── Variant full: botón ancho con borde punteado ──
  return (
    <button onClick={() => setActive(true)}
      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium border border-dashed transition-colors text-[var(--text-muted)] hover:text-white hover:border-[var(--text-muted)]"
      style={{ borderColor: 'var(--border-2)' }}>
      <Icon name="plus" size={13} />
      {label}
    </button>
  );
};

// ── KANBAN VIEW ─────────────────────────────────────────────────
const CARD_LIMIT = 5; // tarjetas visibles por defecto en cada columna

const KanbanView = ({ projects, allProjects = projects, onOpenProject, onUpdateProject, onDeleteProject, onDuplicateProject, onToggleFavorite, onQuickCreate, columns, onUpdateColumn, onDeleteColumn, onAddColumn, onReorderColumns, previewFields = {} }) => {
  const [draggingId,    setDraggingId]    = useState(null);   // card drag
  const [draggingColId, setDraggingColId] = useState(null);   // column drag
  const [dragOverCol,   setDragOverCol]   = useState(null);
  const [addingCol,     setAddingCol]     = useState(false);
  const [newColLabel,   setNewColLabel]   = useState('');
  const [expandedCols,  setExpandedCols]  = useState({});     // colId → true cuando está expandida
  // Ref to throttle dragOver: only call setState when the hovered column actually changes
  const lastOverRef = useRef(null);
  const boardScrollRef = useRef(null);

  // Los trackpads envían el gesto lateral como wheel.deltaX. Las columnas
  // tienen su propio overflow vertical y algunos navegadores consumen ahí el
  // evento antes de desplazar el contenedor exterior. El listener no pasivo
  // mueve sólo gestos claramente horizontales (o Shift + rueda), por lo que
  // el scroll vertical de las tarjetas permanece intacto.
  useEffect(() => {
    const board = boardScrollRef.current;
    if (!board) return;
    const onWheel = (event) => {
      const horizontalGesture = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.75;
      if (!horizontalGesture && !event.shiftKey) return;
      const rawDelta = horizontalGesture ? event.deltaX : event.deltaY;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? board.clientWidth : 1;
      const before = board.scrollLeft;
      board.scrollLeft += rawDelta * scale;
      if (board.scrollLeft !== before) event.preventDefault();
    };
    board.addEventListener('wheel', onWheel, { passive: false });
    return () => board.removeEventListener('wheel', onWheel);
  }, []);

  const toggleExpand = (colId) =>
    setExpandedCols(prev => ({ ...prev, [colId]: !prev[colId] }));

  const baseCols = (columns && columns.length > 0)
    ? columns.map(themed)
    : STATUSES.filter(s => s.id !== 'archived').map(themed);

  const reorder = (arr, fromId, toId) => {
    const a = [...arr];
    const fi = a.findIndex(c => c.id === fromId);
    const ti = a.findIndex(c => c.id === toId);
    if (fi < 0 || ti < 0) return a;
    a.splice(ti, 0, a.splice(fi, 1)[0]);
    return a;
  };

  // Throttled dragOver — only update state when entering a different column
  const handleDragOver = (e, colId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (lastOverRef.current !== colId) {
      lastOverRef.current = colId;
      setDragOverCol(colId);
    }
  };

  const resetDrag = () => {
    setDraggingId(null);
    setDraggingColId(null);
    setDragOverCol(null);
    lastOverRef.current = null;
  };

  // Card drop → change status
  const onCardDrop = (statusId) => (e) => {
    e.preventDefault();
    if (!draggingId) return;
    const p = projects.find(x => x.id === draggingId);
    const target = baseCols.find(c => c.id === statusId);
    if (p && !columnAccepts(target, p)) {
      window.frameToast?.(`${target.label} es una columna de ${target.fromBoard}: sólo recibe tarjetas de ese tablero.`);
      return resetDrag();
    }
    const atLimit = target?.wipLimit && allProjects.filter(x => x.status === statusId).length >= target.wipLimit;
    if (p && p.status !== statusId && atLimit) {
      window.frameToast?.(`Límite de ${target.wipLimit} tareas alcanzado en ${target.label}. Terminá o mové una antes.`);
    } else if (p && p.status !== statusId) onUpdateProject({ ...p, status: statusId });
    resetDrag();
  };

  // Column drop → commit reorder
  const onColDrop = (e, targetId) => {
    e.preventDefault();
    if (draggingColId && draggingColId !== targetId && onReorderColumns) {
      onReorderColumns(reorder(baseCols, draggingColId, targetId));
    }
    resetDrag();
  };

  const submitNewCol = () => {
    const lbl = newColLabel.trim();
    if (!lbl) return;
    const id    = 'col_' + Date.now() + Math.random().toString(36).slice(2, 5);
    const color = COL_COLORS[baseCols.length % COL_COLORS.length];
    onAddColumn({ id, label: lbl, color });
    setNewColLabel('');
    setAddingCol(false);
  };

  useCardMotion(boardScrollRef);
  return (
    <div
      ref={boardScrollRef}
      className="h-full overflow-x-auto p-4"
      style={{ overflowY: 'visible', overscrollBehaviorX: 'contain' }}
    >
      <div className="flex gap-3 h-full" style={{ minWidth: 'fit-content' }}>

        {baseCols.map(s => {
          const items           = projects.filter(p => p.status === s.id);
          const totalItems      = allProjects.filter(p => p.status === s.id);
          const isCardOver      = dragOverCol === s.id && !!draggingId && !draggingColId;
          const isColOver       = dragOverCol === s.id && !!draggingColId && draggingColId !== s.id;
          const isBeingDragged  = draggingColId === s.id;

          const isExpanded   = !!expandedCols[s.id];
          const visibleItems = isExpanded ? items : items.slice(0, CARD_LIMIT);
          const hiddenCount  = Math.max(0, items.length - CARD_LIMIT);

          return (
            <div
              key={s.id}
              className="flex flex-col w-[280px] flex-shrink-0 rounded-xl border transition"
              style={{
                background: isCardOver ? 'var(--accent-soft-weak)' : 'var(--surface)',
                borderColor: isColOver ? 'var(--accent)' : isCardOver ? colorAlpha(s.color, 53) : 'var(--border)',
                boxShadow: isColOver ? '0 0 0 2px var(--accent)' : 'none',
                opacity: isBeingDragged ? 0.4 : 1,
                height: '100%',
              }}
              onDragOver={(e) => handleDragOver(e, s.id)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  if (lastOverRef.current === s.id) {
                    lastOverRef.current = null;
                    setDragOverCol(null);
                  }
                }
              }}
              onDrop={(e) => draggingColId ? onColDrop(e, s.id) : onCardDrop(s.id)(e)}
            >
              {/* Column header — draggable to reorder */}
              <div
                className="flex items-center justify-between px-3 py-3 border-b border-app flex-shrink-0 select-none"
                draggable={!!onReorderColumns && !s.fromBoard}
                style={{ cursor: onReorderColumns && !s.fromBoard ? 'grab' : 'default' }}
                onDragStart={(e) => {
                  e.stopPropagation();
                  setTimeout(() => setDraggingColId(s.id), 0);
                  setDraggingId(null);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', s.id);
                }}
                onDragEnd={resetDrag}
              >
                <div className="flex items-center gap-2">
                  {onReorderColumns && !s.fromBoard && (
                    <Icon name="drag" size={12} className="text-[var(--text-muted)] opacity-40 flex-shrink-0" />
                  )}
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }}></span>
                  <span className="text-[12px] font-semibold">{s.label}</span>
                  <span className="text-[11px] font-mono px-1.5 rounded" style={{ background: 'var(--surface-2)', color: s.wipLimit && items.length >= s.wipLimit ? 'var(--warn)' : 'var(--text-muted)' }}>
                    {items.length}{items.length !== totalItems.length ? ` de ${totalItems.length}` : ''}{s.wipLimit ? `/${s.wipLimit}` : ''}
                  </span>
                </div>
                {/* La columna viene de otro tablero: se muestra para que sus
                    tarjetas no desaparezcan, pero renombrarla o borrarla es
                    cosa de ese tablero, no de este. */}
                {s.fromBoard && (
                  <span className="text-[10px] px-1.5 rounded flex-shrink-0 truncate" title={'Columna de ' + s.fromBoard}
                    style={{ background: 'var(--surface-2)', color: 'var(--text-dim)', maxWidth: 110 }}>{s.fromBoard}</span>
                )}
                {onUpdateColumn && !s.fromBoard && (
                  <ColMenuBtn
                    col={s}
                    projectCount={totalItems.length}
                    onUpdate={onUpdateColumn}
                    onDelete={onDeleteColumn}
                  />
                )}
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {visibleItems.map(p => (
                  <ProjectCardMini
                    key={p.id}
                    project={p}
                    onClick={() => onOpenProject(p.id)}
                    draggable
                    onDragStart={() => { setDraggingId(p.id); setDraggingColId(null); }}
                    onDragEnd={resetDrag}
                    dragging={draggingId === p.id}
                    onDelete={onDeleteProject}
                    onDuplicate={onDuplicateProject}
                    onToggleFavorite={onToggleFavorite}
                    previewFields={previewFields}
                  />
                ))}

                {items.length === 0 && (
                  <div className="text-center py-10 px-4 border border-dashed rounded-lg" style={{ borderColor: 'var(--border-2)' }}>
                    <div className="text-[var(--text-muted)] text-[11px]">Sin tareas en {s.label.toLowerCase()}</div>
                  </div>
                )}

                {/* Ver más / Ver menos */}
                {hiddenCount > 0 && !isExpanded && (
                  <button
                    onClick={() => toggleExpand(s.id)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-colors hover:bg-[var(--surface-2)] hover:text-white"
                    style={{ color: 'var(--text-muted)', border: '1px dashed var(--border-2)' }}
                  >
                    <Icon name="chevronDown" size={12} />
                    Ver {hiddenCount} más
                  </button>
                )}
                {isExpanded && items.length > CARD_LIMIT && (
                  <button
                    onClick={() => toggleExpand(s.id)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-colors hover:bg-[var(--surface-2)] hover:text-white"
                    style={{ color: 'var(--text-muted)', border: '1px dashed var(--border-2)' }}
                  >
                    <Icon name="chevronDown" size={12} style={{ transform: 'rotate(180deg)' }} />
                    Ver menos
                  </button>
                )}

                {/* Alta rápida: crea una tarjeta vacía en esta columna */}
                {onQuickCreate && (
                  <QuickAddCard
                    onCreate={onQuickCreate}
                    context={{ status: s.id }}
                    label="Nueva tarea"
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* ── Agregar columna ── */}
        {onAddColumn && (
          <div className="flex-shrink-0 w-[220px] pt-0.5">
            {addingCol ? (
              <div className="surf-panel p-3 space-y-2">
                <input
                  autoFocus
                  value={newColLabel}
                  onChange={(e) => setNewColLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitNewCol();
                    if (e.key === 'Escape') { setAddingCol(false); setNewColLabel(''); }
                  }}
                  placeholder="Nombre de la columna…"
                  className="w-full px-2.5 py-1.5 field text-[13px]"
                 
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={submitNewCol}
                    disabled={!newColLabel.trim()}
                    className="flex-1 py-1.5 rounded-md text-[12px] font-semibold disabled:opacity-40"
                    style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
                  >Crear</button>
                  <button
                    onClick={() => { setAddingCol(false); setNewColLabel(''); }}
                    className="px-2.5 py-1.5 rounded-md text-[var(--text-muted)] hover:text-white"
                    style={{ background: 'var(--surface-2)' }}
                  ><Icon name="x" size={13} /></button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingCol(true)}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[13px] border border-dashed text-[var(--text-dim)] hover:text-white hover:border-[var(--text-muted)] transition-colors"
                style={{ borderColor: 'var(--border-2)' }}
              >
                <Icon name="plus" size={14} />
                Agregar columna
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

// localISO vive en data.jsx, que carga antes que este archivo, para que
// esté disponible en toda la app y no solo en las vistas.

// ── CALENDAR VIEW ───────────────────────────────────────────────
const CalendarView = ({ projects, onOpenProject, onDeleteProject, onDuplicateProject, onUpdateProject, onToggleFavorite, onQuickCreate, previewFields = {} }) => {
  const [refDate, setRefDate] = useState(new Date(TODAY));
  const [mode, setMode] = useState('month'); // month | week | day
  const [dragging, setDragging]       = useState(null); // { id, kind }
  const [dragOverDate, setDragOverDate] = useState(null);
  const lastOverRef = useRef(null);
  const monthGridRef = useRef(null);
  useCardMotion(monthGridRef);

  const year = refDate.getFullYear();
  const month = refDate.getMonth();

  // Build month grid
  const monthGrid = useMemo(() => {
    const first = new Date(year, month, 1);
    const startDay = (first.getDay() + 6) % 7; // Mon-first
    const startDate = new Date(year, month, 1 - startDay);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const dt = new Date(startDate);
      dt.setDate(startDate.getDate() + i);
      cells.push(dt);
    }
    return cells;
  }, [year, month]);

  // Una tarea, un día — y ese día es el de INICIO.
  //
  // La fecha límite no ubica nada: es un dato de la tarea, como el cliente o
  // el presupuesto, y alimenta el contador de entrega. El calendario responde
  // "qué arranca hoy", no "qué vence hoy".
  //
  // Antes se mapeaba a dos fechas a la vez, así que una tarea con fechas
  // distintas aparecía dos veces, y arrastrarla movía sólo una: la tarjeta se
  // partía en dos, una en cada día.
  const projectsByDate = useMemo(() => {
    const map = {};
    projects.forEach(p => {
      const date = p.sessionDate || p.startDate || p.deadline;
      if (!date) return;
      if (!map[date]) map[date] = [];
      if (!map[date].some(x => x.id === p.id)) map[date].push(p);
    });
    return map;
  }, [projects]);

  const isSameDay = (a, b) => a.toDateString() === b.toDateString();
  const todayDt = new Date(TODAY);

  // Etiqueta del header según el modo
  const monthLabel = (() => {
    if (mode === 'month') {
      return refDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    }
    if (mode === 'week') {
      const weekStart = new Date(refDate);
      const dow = (refDate.getDay() + 6) % 7; // lunes = 0
      weekStart.setDate(refDate.getDate() - dow);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
      const sameYear  = weekStart.getFullYear() === weekEnd.getFullYear();
      const startStr  = weekStart.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
      const endStr    = weekEnd.toLocaleDateString('es-ES',
        sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }
      );
      return `${startStr} – ${endStr}${sameYear ? ', ' + weekStart.getFullYear() : ''}`;
    }
    // day
    return refDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  })();

  // Navegación consciente del modo
  const goPrev = () => {
    const d = new Date(refDate);
    if (mode === 'week')  d.setDate(d.getDate() - 7);
    else if (mode === 'day') d.setDate(d.getDate() - 1);
    else return setRefDate(new Date(year, month - 1, 1));
    setRefDate(d);
  };
  const goNext = () => {
    const d = new Date(refDate);
    if (mode === 'week')  d.setDate(d.getDate() + 7);
    else if (mode === 'day') d.setDate(d.getDate() + 1);
    else return setRefDate(new Date(year, month + 1, 1));
    setRefDate(d);
  };
  const goToday = () => setRefDate(new Date(TODAY));

  // ── Drag handlers ─────────────────────────────────────────────
  const handleDragStart = (e, p) => {
    setDragging({ id: p.id });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', p.id); // needed for Firefox
  };
  const handleDragEnd = () => { setDragging(null); setDragOverDate(null); lastOverRef.current = null; };
  const handleDragOver = (e, iso) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (lastOverRef.current !== iso) { lastOverRef.current = iso; setDragOverDate(iso); }
  };
  const handleDrop = (e, iso) => {
    e.preventDefault();
    if (!dragging) return;
    const project = projects.find(p => p.id === dragging.id);
    if (!project) return;
    const currentDate = project.sessionDate || project.startDate;
    if (currentDate === iso) { setDragging(null); setDragOverDate(null); return; }
    // Arrastrar reagenda el arranque y deja la fecha límite intacta: es un
    // compromiso con el cliente, no algo que cambie por reordenar la semana.
    // (Salvo en una tarjeta de venta día por día: ver workDatePatch.)
    onUpdateProject && onUpdateProject({ ...project, ...window.FrameLoopa.workDatePatch(project, iso) });
    setDragging(null); setDragOverDate(null); lastOverRef.current = null;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-app">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl font-semibold capitalize" style={{ letterSpacing: '-0.01em' }}>
            {monthLabel}
          </h2>
          <div className="flex items-center gap-0.5 ml-2">
            <button aria-label="Anterior" onClick={goPrev} className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-dim)]">
              <Icon name="chevronLeft" size={14} />
            </button>
            <button onClick={goToday} className="px-2.5 py-1 rounded text-[11px] font-medium hover:bg-[var(--surface-2)] text-[var(--text-dim)]">
              Hoy
            </button>
            <button aria-label="Siguiente" onClick={goNext} className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-dim)]">
              <Icon name="chevronRight" size={14} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-md surface-2">
          {['month', 'week', 'day'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium capitalize transition-colors ${mode === m ? 'bg-[var(--surface-3)] text-white' : 'text-[var(--text-dim)] hover:text-white'}`}
            >
              {m === 'month' ? 'Mes' : m === 'week' ? 'Semana' : 'Día'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'month' && (
        <div className="flex-1 flex flex-col overflow-y-auto">
          <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-app" style={{ background: 'var(--surface)' }}>
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
              <div key={d} className="px-3 py-2 text-[10px] font-semibold tracking-[0.18em] uppercase text-[var(--text-muted)]">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7" ref={monthGridRef}>
            {monthGrid.map((dt, i) => {
              const inMonth = dt.getMonth() === month;
              const iso = localISO(dt);
              const items = projectsByDate[iso] || [];
              const isToday = isSameDay(dt, todayDt);
              const isDragOver = dragOverDate === iso;
              return (
                <div
                  key={i}
                  className={`group relative border-r border-b p-1.5 min-h-[110px] transition-colors ${inMonth ? '' : 'opacity-40'}`}
                  style={{
                    background: isDragOver
                      ? 'var(--accent-soft-weak)'
                      : isToday ? 'var(--accent-soft)' : 'transparent',
                    borderColor: isDragOver ? 'var(--accent-border)' : 'var(--border)',
                  }}
                  onDragOver={(e) => handleDragOver(e, iso)}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setDragOverDate(null); lastOverRef.current = null; } }}
                  onDrop={(e) => handleDrop(e, iso)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[11px] font-mono ${isToday ? 'font-bold' : 'text-[var(--text-muted)]'}`} style={{ color: isToday ? 'var(--accent)' : undefined }}>
                      {dt.getDate()}
                    </span>
                    {isToday && <span className="text-[10px] font-bold tracking-wider" style={{ color: 'var(--accent)' }}>HOY</span>}
                    {isDragOver && <span className="text-[10px] font-bold tracking-wider" style={{ color: 'var(--accent)' }}>SOLTAR</span>}
                  </div>
                  <div className="space-y-1.5">
                    {items.map(p => (
                      <WeekCard
                        key={p.id}
                        project={p}
                        calendarDate={iso}
                        onClick={() => !dragging && onOpenProject(p.id)}
                        draggable
                        onDragStart={(e) => handleDragStart(e, p)}
                        onDragEnd={handleDragEnd}
                        dragging={dragging?.id === p.id}
                        onDelete={onDeleteProject}
                        onDuplicate={onDuplicateProject}
                        onToggleFavorite={onToggleFavorite}
                        previewFields={previewFields}
                      />
                    ))}
                    {/* Alta rápida en este día */}
                    {onQuickCreate && (
                      <QuickAddCard
                        onCreate={onQuickCreate}
                        context={{ sessionDate: iso }}
                        variant="mini"
                        label="Nueva tarea para este día"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'week' && (
        <WeekView refDate={refDate} projectsByDate={projectsByDate} onOpenProject={onOpenProject} onDeleteProject={onDeleteProject} onDuplicateProject={onDuplicateProject} onUpdateProject={onUpdateProject} onToggleFavorite={onToggleFavorite} onQuickCreate={onQuickCreate} previewFields={previewFields} />
      )}
      {mode === 'day' && (
        <DayView refDate={refDate} projectsByDate={projectsByDate} onOpenProject={onOpenProject} onDeleteProject={onDeleteProject} onDuplicateProject={onDuplicateProject} onToggleFavorite={onToggleFavorite} onQuickCreate={onQuickCreate} previewFields={previewFields} />
      )}
    </div>
  );
};

// ── Tarjeta vertical estilo Notion para vista semanal ────────────
// Cada property en su propia fila → el título puede wrappear libremente
// y la tarjeta se adapta a cualquier ancho de columna sin aplastar nada.
const WeekCard = ({ project, calendarDate, onClick, draggable, onDragStart, onDragEnd, dragging, onToggleFavorite, onDelete, onDuplicate, previewFields = {} }) => {
  const editing = React.useContext(CardEditingContext);
  const pf = editing && !editing.shared ? { ...previewFields, responsables: false, presupuesto: false } : previewFields;
  const [confirmDel, setConfirmDel] = React.useState(false);
  const t        = getType(project.type);
  const st       = getStatus(project.status);
  const days     = daysUntil(project.deadline);
  const urgent = isUrgent(project);
  const isOver   = days < 0 && !isClosed(project);
  const progress = progressOf(project);
  const hasTags  = pf.tags && project.tags?.length > 0;
  // En el calendario la fecha visible debe ser la misma que ubica la tarjeta.
  // Mostrar deadline acá hacía parecer que el arrastre no había guardado.
  const displayedDate = calendarDate || project.sessionDate || project.startDate || project.deadline;

  return (
    <div
      data-card-id={project.id}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`frame-fluid-card group cursor-pointer surf surf-hover overflow-hidden select-none lift ${dragging ? 'dragging' : ''}`}
    >
      <div className="p-2.5 flex flex-col gap-1.5">

        {/* Fila tipo + urgencia + botones de acción */}
        <div className="frame-card-head flex items-start justify-between gap-1 min-w-0">
          <div className="frame-card-badges flex items-center gap-1 min-w-0">
            {pf.tipo !== false && <TypePill type={project.type} />}
            {pf.prioridad !== false && urgent && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--danger)', color: 'var(--danger-on)' }}>URG</span>
            )}
            {pf.prioridad !== false && isOver && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--danger-soft-2)', color: 'var(--danger)' }}>VENC</span>
            )}
          </div>

          {/* Botones — visibles en hover */}
          <div className="frame-card-actions flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {!confirmDel ? (
              <>
                {onToggleFavorite && (
                  <button
                    onClick={() => onToggleFavorite(project.id)}
                    className={`p-1 rounded transition ${project.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    style={{ color: project.favorite ? 'var(--warn)' : 'var(--text-muted)' }}
                    title={project.favorite ? 'Quitar favorito' : 'Favorito'}
                  >
                    <Icon name="star" size={11} fill={project.favorite ? 'currentColor' : 'none'} />
                  </button>
                )}
                {onDuplicate && (
                  <button
                    onClick={() => onDuplicate(project.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] transition"
                    title="Duplicar"
                  >
                    <Icon name="copy" size={11} />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => setConfirmDel(true)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition"
                    title="Eliminar"
                  >
                    <Icon name="trash" size={11} />
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>¿Eliminar?</span>
                <button onClick={() => onDelete(project.id)} className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--danger)', color: 'var(--danger-on)' }}>Sí</button>
                <button onClick={() => setConfirmDel(false)} className="text-[10px] font-medium px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-white" style={{ background: 'var(--surface-3)' }}>No</button>
              </div>
            )}
          </div>

        </div>

        {/* Título — wrappea libremente */}
        <div className="frame-card-title font-display font-semibold text-[13px] leading-snug pretty min-w-0" style={{ color: 'var(--text)' }}>
          {project.title}
        </div>

        {/* Cliente */}
        {pf.cliente !== false && project.client && (
          <div className="text-[11px] truncate min-w-0" style={{ color: 'var(--text-muted)' }}>{project.client}</div>
        )}

        {/* Estado */}
        {pf.estado !== false && (
          <div><StatusPill status={project.status} size="sm" /></div>
        )}

        {/* Tags */}
        {hasTags && (
          <div className="flex flex-wrap gap-1">
            {project.tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>#{tag}</span>
            ))}
          </div>
        )}

        {/* Barra de progreso */}
        {pf.progreso !== false && (
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
              <div className="h-full rounded-full" style={{ width: progress + '%', background: t.color, transition: 'width 400ms' }} />
            </div>
            <span className="text-[10px] font-mono flex-shrink-0" style={{ color: t.color }}>{progress}%</span>
          </div>
        )}

        {/* Responsables + fecha de inicio del calendario — fila final */}
        {(pf.responsables !== false || pf.deadline !== false) && (
          <div className="flex items-center justify-between gap-1 mt-0.5">
            {pf.responsables !== false ? <AvatarStack ids={project.assignees} size={16} max={3} /> : <span />}
            {pf.deadline !== false && displayedDate && (
              <div className="flex items-center gap-0.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }} title="Sesión de trabajo (no cambia la entrega)">
                <Icon name="calendar" size={9} />
                {fmtDate(displayedDate)}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

const WeekView = ({ refDate, projectsByDate, onOpenProject, onDeleteProject, onDuplicateProject, onUpdateProject, onToggleFavorite, onQuickCreate, previewFields = {} }) => {
  const [dragging, setDragging]         = React.useState(null); // { id, kind }
  const [dragOverDate, setDragOverDate] = React.useState(null);
  const lastOverRef                     = React.useRef(null);
  const weekGridRef                     = React.useRef(null);
  useCardMotion(weekGridRef);

  const start = new Date(refDate);
  const day   = (start.getDay() + 6) % 7; // Monday-first offset
  start.setDate(start.getDate() - day);
  const days = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    return dt;
  });
  const todayISO = localISO(new Date(TODAY));

  // ── Drag handlers ───────────────────────────────────────────────
  const handleDragStart = (e, p) => {
    setDragging({ id: p.id });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', p.id);
  };
  const handleDragEnd = () => {
    setDragging(null); setDragOverDate(null); lastOverRef.current = null;
  };
  const handleDragOver = (e, iso) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (lastOverRef.current !== iso) { lastOverRef.current = iso; setDragOverDate(iso); }
  };
  const handleDrop = (e, iso) => {
    e.preventDefault();
    if (!dragging) return;
    // El proyecto puede estar en cualquier dia del mapa.
    let found = null;
    Object.values(projectsByDate).forEach(items => {
      const match = items.find(p => p.id === dragging.id);
      if (match) found = match;
    });
    if (!found) return;
    const currentDate = found.sessionDate || found.startDate;
    if (currentDate === iso) { setDragging(null); setDragOverDate(null); return; }
    // Sólo la fecha de inicio: la límite es un dato, no una posición
    // (salvo en una tarjeta de venta día por día: ver workDatePatch).
    const cleanProject = found;
    onUpdateProject && onUpdateProject({ ...cleanProject, ...window.FrameLoopa.workDatePatch(cleanProject, iso) });
    setDragging(null); setDragOverDate(null); lastOverRef.current = null;
  };
  return (
    // overflow-x-auto: scroll horizontal cuando las 7 columnas no caben
    // Cada columna tiene min-width 190px para que las tarjetas no se aplasten
    <div className="flex-1 overflow-x-auto overflow-y-hidden" ref={weekGridRef}>
      <div className="flex h-full" style={{ minWidth: 'calc(7 * 160px)' }}>
        {days.map((dt, i) => {
          const iso        = localISO(dt);
          const items      = projectsByDate[iso] || [];
          // Se comparan cadenas y no fechas: isSameDay vive dentro de
          // CalendarView y desde acá no se ve.
          const isToday    = iso === todayISO;
          const isDragOver = dragOverDate === iso;
          return (
            <div
              key={i}
              className="border-r border-app overflow-y-auto transition-colors flex-shrink-0"
              style={{
                width: 'calc(100% / 7)',
                minWidth: 160,
                background:   isDragOver ? 'var(--accent-soft-weak)' : isToday ? 'var(--accent-soft)' : 'transparent',
                borderColor:  isDragOver ? 'var(--accent-border)'  : 'var(--border)',
              }}
              onDragOver={(e)  => handleDragOver(e, iso)}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setDragOverDate(null); lastOverRef.current = null; } }}
              onDrop={(e)      => handleDrop(e, iso)}
            >
              {/* Day header */}
              <div className="sticky top-0 px-3 py-2 border-b border-app flex items-baseline gap-2 select-none" style={{ background: 'var(--surface)' }}>
                <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)]">
                  {dt.toLocaleDateString('es-ES', { weekday: 'short' })}
                </span>
                <span className="text-lg font-display font-bold" style={{ color: isToday ? 'var(--accent)' : 'var(--text-dim)' }}>
                  {dt.getDate()}
                </span>
                {items.length > 0 && (
                  <span className="ml-auto text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{items.length}</span>
                )}
                {isDragOver && (
                  <span className="ml-auto text-[10px] font-bold tracking-wider" style={{ color: 'var(--accent)' }}>SOLTAR</span>
                )}
              </div>

              {/* WeekCard: layout vertical estilo Notion */}
              <div className="group p-2 space-y-2">
                {items.length === 0 && (
                  <div className="text-[10px] text-center py-6" style={{ color: isDragOver ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {isDragOver ? '↓' : '—'}
                  </div>
                )}
                {items.map(p => (
                  <WeekCard
                    key={p.id}
                    project={p}
                    calendarDate={iso}
                    onClick={() => !dragging && onOpenProject(p.id)}
                    draggable
                    onDragStart={(e) => handleDragStart(e, p)}
                    onDragEnd={handleDragEnd}
                    dragging={dragging?.id === p.id}
                    onToggleFavorite={onToggleFavorite}
                    onDelete={onDeleteProject}
                    onDuplicate={onDuplicateProject}
                    previewFields={previewFields}
                  />
                ))}
                {/* Alta rápida en este día */}
                {onQuickCreate && (
                  <QuickAddCard
                    onCreate={onQuickCreate}
                    context={{ sessionDate: iso }}
                    variant="mini"
                    label="Nueva tarea para este día"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DayView = ({ refDate, projectsByDate, onOpenProject, onDeleteProject, onDuplicateProject, onToggleFavorite, onQuickCreate, previewFields = {} }) => {
  const iso = localISO(refDate);
  const items = projectsByDate[iso] || [];
  const dayListRef = React.useRef(null);
  useCardMotion(dayListRef);
  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-3xl mx-auto w-full" ref={dayListRef}>
      <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-2">
        {refDate.toLocaleDateString('es-ES', { weekday: 'long' })}
      </div>
      <h2 className="font-display text-5xl font-bold mb-8" style={{ letterSpacing: '-0.03em' }}>
        {refDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}
      </h2>
      <div className="space-y-3">
        {items.length === 0 && (
          <div className="text-center py-20 border border-dashed rounded-xl" style={{ borderColor: 'var(--border-2)' }}>
            <div className="text-[var(--text-muted)] text-sm">Día libre — no hay tareas programadas</div>
          </div>
        )}
        {items.map(p => (
          <ProjectCardMini key={p.id} project={p} onClick={() => onOpenProject(p.id)} onDelete={onDeleteProject} onDuplicate={onDuplicateProject} onToggleFavorite={onToggleFavorite} previewFields={previewFields} />
        ))}
        {/* Alta rápida en este día */}
        {onQuickCreate && (
          <QuickAddCard
            onCreate={onQuickCreate}
            context={{ sessionDate: iso }}
            label="Nueva tarea para este día"
          />
        )}
      </div>
    </div>
  );
};

// ── GALLERY VIEW ────────────────────────────────────────────────
const GalleryView = ({ projects, onOpenProject, onDeleteProject, onDuplicateProject, onToggleFavorite, onQuickCreate, previewFields = {} }) => {
  const gridRef = React.useRef(null);
  useCardMotion(gridRef);
  if (projects.length === 0 && !onQuickCreate) return <EmptyState />;
  return (
    <div className="h-full overflow-y-auto p-6" ref={gridRef}>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {projects.map(p => <GalleryCard key={p.id} project={p} onClick={() => onOpenProject(p.id)} onDelete={onDeleteProject} onDuplicate={onDuplicateProject} onToggleFavorite={onToggleFavorite} previewFields={previewFields} />)}
        {/* Alta rápida: tarjeta vacía al final de la grilla */}
        {onQuickCreate && (
          <GalleryAddCard onCreate={onQuickCreate} />
        )}
      </div>
    </div>
  );
};

// ── Tarjeta de alta rápida para la galería (mantiene el aspect-ratio del grid) ──
const GalleryAddCard = ({ onCreate }) => {
  const [active, setActive] = React.useState(false);
  const [title, setTitle]   = React.useState('');
  const inputRef = React.useRef(null);

  React.useEffect(() => { if (active) inputRef.current?.focus(); }, [active]);

  const submit = () => {
    const t = title.trim();
    if (!t) { setActive(false); setTitle(''); return; }
    onCreate({ title: t });
    setTitle('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div
      onClick={() => !active && setActive(true)}
      className="rounded-xl border border-dashed flex flex-col items-center justify-center aspect-[4/3] transition-colors select-none cursor-pointer hover:border-[var(--text-muted)]"
      style={{ borderColor: active ? 'var(--accent)' : 'var(--border-2)', background: 'var(--surface)' }}
    >
      {active ? (
        <div className="w-full px-4" onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter')  { e.preventDefault(); submit(); }
              if (e.key === 'Escape') { setActive(false); setTitle(''); }
            }}
            onBlur={() => { if (!title.trim()) { setActive(false); setTitle(''); } }}
            placeholder="Título de la tarea…"
            className="w-full bg-transparent outline-none text-center text-[15px] border-b pb-1.5"
            style={{ color: 'var(--text)', borderColor: 'var(--accent)' }}
          />
          <div className="flex items-center justify-center gap-1.5 mt-3">
            <button onMouseDown={(e) => e.preventDefault()} onClick={submit} disabled={!title.trim()}
              className="px-3 py-1 rounded text-[11px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>
              Crear
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => { setActive(false); setTitle(''); }}
              className="px-2 py-1 rounded text-[var(--text-muted)] hover:text-white" style={{ background: 'var(--surface-3)' }}>
              <Icon name="x" size={12} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-[var(--text-muted)]">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
            <Icon name="plus" size={18} />
          </div>
          <span className="text-[12px] font-medium">Agregar tarea</span>
        </div>
      )}
    </div>
  );
};

const GalleryCard = ({ project, onClick, onDelete, onDuplicate, onToggleFavorite, previewFields = {} }) => {
  const editing = React.useContext(CardEditingContext);
  const pf = editing && !editing.shared ? { ...previewFields, responsables: false, presupuesto: false } : previewFields;
  const t = getType(project.type);
  const origen = boardOrigin(project);
  const progress = progressOf(project);
  const counter  = deliveryCounter(project);
  const [confirmDel, setConfirmDel] = React.useState(false);

  const done  = (project.checklist || []).filter(c => c.done).length;
  const total = (project.checklist || []).length;

  // Misma línea de metadatos que la tarjeta del tablero.
  const meta = [];
  if (pf.presupuesto && project.budget > 0) {
    meta.push(`${currencyLabel(project.currency)} ${project.budget.toLocaleString()}`);
  }

  return (
    <div
      data-card-id={project.id}
      onClick={onClick}
      className="group lift surf surf-hover cursor-pointer overflow-hidden select-none"
    >
      <div className="relative aspect-[4/3] overflow-hidden" style={{ background: project.cover.type === 'color' ? project.cover.value : 'var(--surface-3)' }}>
        {project.cover.type === 'image' && (
          <img src={project.cover.value} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent"></div>
        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
          {pf.tipo !== false && <TypePill type={project.type} />}
          <div className="flex items-center gap-1.5 ml-auto">
            {/* Sin badge URGENTE: el contador de entrega, abajo, ya dice
                cuánto falta y con cuánta urgencia. Dos avisos del mismo hecho
                compiten entre sí y pueden desincronizarse. */}
            {onToggleFavorite && !confirmDel && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(project.id); }}
                className={`p-1.5 rounded-md transition ${project.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                style={{ background: 'rgba(0,0,0,0.55)', color: project.favorite ? 'var(--warn)' : 'white', backdropFilter: 'blur(4px)' }}
                title={project.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
              >
                <Icon name="star" size={12} fill={project.favorite ? 'currentColor' : 'none'} />
              </button>
            )}
            {!confirmDel && onDuplicate && (
              <button onClick={(e) => { e.stopPropagation(); onDuplicate(project.id); }}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md transition"
                style={{ background: 'rgba(0,0,0,0.55)', color: 'white', backdropFilter: 'blur(4px)' }}
                title="Duplicar">
                <Icon name="copy" size={12} />
              </button>
            )}
            {onDelete && !confirmDel && (
              <button onClick={(e) => { e.stopPropagation(); setConfirmDel(true); }}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md transition"
                style={{ background: 'rgba(0,0,0,0.55)', color: 'white', backdropFilter: 'blur(4px)' }}
                title="Eliminar">
                <Icon name="trash" size={12} />
              </button>
            )}
            {onDelete && confirmDel && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} onClick={(e) => e.stopPropagation()}>
                <span className="text-[10px] font-semibold text-white">¿Eliminar?</span>
                <button onClick={(e) => { e.stopPropagation(); onDelete(project.id); }} className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'var(--danger)', color: 'var(--danger-on)' }}>Sí</button>
                <button onClick={(e) => { e.stopPropagation(); setConfirmDel(false); }} className="text-[10px] text-white/60 hover:text-white px-1">No</button>
              </div>
            )}
          </div>
        </div>
        {pf.estado !== false && (
          <div className="absolute bottom-3 left-3 right-3">
            <StatusPill status={project.status} />
          </div>
        )}
      </div>
      {/* Cuerpo con el mismo lenguaje que la tarjeta del tablero: metadatos en
          una línea, contador de entrega a la derecha, progreso apagado. Antes
          apilaba cliente, monto, tags, avatares y fecha en cinco renglones. */}
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {(pf.cliente !== false && project.client) || origen ? (
              <div className="flex items-center gap-2 mb-1 min-w-0" style={{ color: 'var(--text-muted)' }}>
                {pf.cliente !== false && project.client && (
                  <span className="text-[11px] uppercase tracking-wider truncate">{project.client}</span>
                )}
                {origen && (
                  <span className="text-[10px] px-1.5 rounded flex-shrink-0 ml-auto truncate" title={'Esta tarjeta vive en ' + origen}
                    style={{ background: 'var(--surface-3)', color: 'var(--text-dim)', maxWidth: '55%' }}>{origen}</span>
                )}
              </div>
            ) : null}
            <h3 className="font-semibold text-[15px] leading-snug balance" style={{ letterSpacing: '-0.012em' }}>
              {project.title}
            </h3>

            {(meta.length > 0 || (pf.responsables !== false && project.assignees?.length > 0)) && (
              <div className="flex items-center gap-1.5 mt-1.5 text-[12px] min-w-0" style={{ color: 'var(--text-muted)' }}>
                {meta.map((m, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span style={{ color: 'var(--text-faint)' }}>·</span>}
                    <span className="truncate tnum">{m}</span>
                  </React.Fragment>
                ))}
                {pf.responsables !== false && project.assignees?.length > 0 && (
                  <>
                    {meta.length > 0 && <span style={{ color: 'var(--text-faint)' }}>·</span>}
                    <AvatarStack ids={project.assignees} size={16} max={3} />
                  </>
                )}
              </div>
            )}
          </div>

          {pf.deadline !== false && (
            <div className="text-right flex-shrink-0 tnum" style={{ lineHeight: 1 }}>
              <div className="text-[15px] font-semibold" style={{ color: counter.color, letterSpacing: '-0.02em' }}>
                {counter.value}
              </div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>{counter.label}</div>
            </div>
          )}
        </div>

        {pf.progreso !== false && total > 0 && (
          <div className="flex items-center gap-2 mt-2.5">
            <div className="rounded-full overflow-hidden flex-shrink-0" style={{ width: 54, height: 3, background: 'rgba(255,255,255,.09)' }}>
              <div className="h-full rounded-full" style={{ width: progress + '%', background: progress >= 100 ? 'var(--accent)' : 'var(--text-faint)' }} />
            </div>
            <span className="text-[10px] tnum" style={{ color: 'var(--text-faint)' }}>{done}/{total}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ── LIST VIEW ───────────────────────────────────────────────────
const ListRow = ({ p, onOpenProject, onDeleteProject, onDuplicateProject, onToggleFavorite }) => {
  const t = getType(p.type);
  const progress = progressOf(p);
  const counter  = deliveryCounter(p);
  const [confirmDel, setConfirmDel] = React.useState(false);

  const done  = (p.checklist || []).filter(c => c.done).length;
  const total = (p.checklist || []).length;

  return (
    <tr
      key={p.id}
      data-card-id={p.id}
      onClick={() => onOpenProject(p.id)}
      className="group cursor-pointer border-b border-app hover:bg-[var(--surface-2)] transition-colors select-none"
    >
      <td className="px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-8 rounded-full" style={{ background: t.color }}></div>
          <div className="min-w-0">
            <div className="font-medium truncate">{p.title}</div>
            <div className="text-[11px] text-[var(--text-muted)] font-mono">
              {p.tags.slice(0, 2).map(tag => '#' + tag).join(' ')}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-[var(--text-dim)]">{p.client}</td>
      <td className="px-3 py-3"><TypePill type={p.type} /></td>
      <td className="px-3 py-3"><StatusPill status={p.status} /></td>
      <td className="px-3 py-3"><AvatarStack ids={p.assignees} size={20} max={3} /></td>
      {/* La fecha con dos badges al lado (URG / VENC) decía tres veces lo
          mismo. Queda el contador solo, con el mismo formato que las tarjetas:
          una columna de números alineados que se lee de un vistazo. */}
      <td className="px-3 py-3 text-[13px] tnum whitespace-nowrap">
        <span className="font-semibold" style={{ color: counter.color, letterSpacing: '-0.02em' }}>
          {counter.value}
        </span>
        <span className="text-[11px] ml-1.5" style={{ color: 'var(--text-faint)' }}>{counter.label}</span>
      </td>
      <td className="px-3 py-3"><PriorityBadge priority={p.priority} /></td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-full overflow-hidden flex-shrink-0" style={{ width: 54, height: 3, background: 'rgba(255,255,255,.09)' }}>
            <div className="h-full rounded-full" style={{ width: progress + '%', background: progress >= 100 ? 'var(--accent)' : 'var(--text-faint)' }}></div>
          </div>
          <span className="text-[10px] tnum w-9 text-right" style={{ color: 'var(--text-faint)' }}>{done}/{total}</span>
        </div>
      </td>
      {/* Acciones */}
      <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
        {!confirmDel && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center justify-end gap-1 transition">
            {onToggleFavorite && (
              <button
                onClick={() => onToggleFavorite(p.id)}
                className="p-1.5 rounded-md transition-colors"
                style={{ color: p.favorite ? 'var(--warn)' : 'var(--text-muted)' }}
                title={p.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
              >
                <Icon name="star" size={13} fill={p.favorite ? 'currentColor' : 'none'} />
              </button>
            )}
            {onDuplicateProject && (
              <button
                onClick={() => onDuplicateProject(p.id)}
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors"
                title="Duplicar"
              >
                <Icon name="copy" size={13} />
              </button>
            )}
            {onDeleteProject && (
              <button
                onClick={() => setConfirmDel(true)}
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-colors"
                title="Eliminar"
              >
                <Icon name="trash" size={13} />
              </button>
            )}
          </div>
        )}
        {onDeleteProject && confirmDel && (
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>¿Eliminar?</span>
            <button
              onClick={() => onDeleteProject(p.id)}
              className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{ background: 'var(--danger)', color: 'var(--danger-on)' }}
            >Sí</button>
            <button
              onClick={() => setConfirmDel(false)}
              className="text-[10px] text-[var(--text-muted)] hover:text-white px-1.5 py-0.5 rounded"
              style={{ background: 'var(--surface-3)' }}
            >No</button>
          </div>
        )}
      </td>
    </tr>
  );
};

const ListView = ({ projects, onOpenProject, onDeleteProject, onDuplicateProject, onToggleFavorite }) => {
  const tableRef = React.useRef(null);
  useCardMotion(tableRef);
  if (projects.length === 0) return <EmptyState />;
  return (
    <div className="h-full overflow-auto" ref={tableRef}>
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 z-10 surface" style={{ background: 'var(--surface)' }}>
          <tr className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)]">
            <th className="text-left px-5 py-3 font-semibold border-b border-app w-[34%]">Tarea</th>
            <th className="text-left px-3 py-3 font-semibold border-b border-app">Cliente</th>
            <th className="text-left px-3 py-3 font-semibold border-b border-app">Tipo</th>
            <th className="text-left px-3 py-3 font-semibold border-b border-app">Estado</th>
            <th className="text-left px-3 py-3 font-semibold border-b border-app">Equipo</th>
            <th className="text-left px-3 py-3 font-semibold border-b border-app">Entrega</th>
            <th className="text-left px-3 py-3 font-semibold border-b border-app">Prio</th>
            <th className="text-left px-3 py-3 font-semibold border-b border-app w-[110px]">Progreso</th>
            <th className="text-left px-3 py-3 font-semibold border-b border-app w-[80px]"></th>
          </tr>
        </thead>
        <tbody>
          {projects.map(p => (
            <ListRow key={p.id} p={p} onOpenProject={onOpenProject} onDeleteProject={onDeleteProject} onDuplicateProject={onDuplicateProject} onToggleFavorite={onToggleFavorite} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── EMPTY STATE ─────────────────────────────────────────────────
const EmptyState = ({ message = 'No hay tareas que coincidan con tus filtros' }) => (
  <div className="h-full flex items-center justify-center p-10">
    <div className="text-center max-w-sm">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'var(--surface-2)' }}>
        <Icon name="inbox" size={26} className="text-[var(--text-muted)]" />
      </div>
      <div className="font-display text-lg font-semibold mb-1">Sin resultados</div>
      <div className="text-[13px] text-[var(--text-muted)] pretty">{message}</div>
    </div>
  </div>
);

// ── TRASH SECTION ────────────────────────────────────────────────
const TrashSection = ({ trash, onRestore, onPermanentDelete, onRestoreAll, onPermanentDeleteAll }) => {
  const [confirmId, setConfirmId] = React.useState(null); // permanent-delete confirm
  const [confirmEmpty, setConfirmEmpty] = React.useState(false);
  const [bulkAction, setBulkAction] = React.useState(null);

  const deletedAgo = (iso) => {
    const ms = Date.now() - new Date(iso).getTime();
    const d  = Math.floor(ms / 86400000);
    const h  = Math.floor((ms % 86400000) / 3600000);
    if (d > 0) return `hace ${d}d`;
    if (h > 0) return `hace ${h}h`;
    return 'hace un momento';
  };

  const daysLeft = (iso) => {
    const remaining = TRASH_RETENTION_MS - (Date.now() - new Date(iso).getTime());
    return Math.max(0, Math.ceil(remaining / 86400000));
  };

  // sort: most recently deleted first
  const sorted = [...trash].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-app flex items-center gap-3 flex-wrap estudio-cabecera">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center estudio-titulo" style={{ background: 'var(--surface-3)' }}>
          <Icon name="trash" size={15} className="text-[var(--text-muted)]" />
        </div>
        <div className="estudio-titulo">
          <h2 className="font-display font-bold text-[17px]" style={{ letterSpacing: '-0.01em' }}>Papelera de reciclaje</h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Las tareas se eliminan permanentemente a los <strong className="text-[var(--text-dim)]">{TRASH_RETENTION_DAYS} días</strong>
          </p>
        </div>
        {trash.length > 0 && <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            {trash.length} {trash.length === 1 ? 'tarea' : 'tareas'}
          </span>
          <button
            disabled={!!bulkAction}
            onClick={async () => { setBulkAction('restore'); await onRestoreAll(); setBulkAction(null); }}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            {bulkAction === 'restore' ? 'Restaurando…' : 'Restaurar todo'}
          </button>
          {confirmEmpty ? <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--danger)' }}>¿Vaciar definitivamente?</span>
            <button
              disabled={!!bulkAction}
              onClick={async () => { setBulkAction('empty'); await onPermanentDeleteAll(); setBulkAction(null); setConfirmEmpty(false); }}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-50"
              style={{ background: 'var(--danger)', color: '#fff' }}
            >Sí, vaciar</button>
            <button onClick={() => setConfirmEmpty(false)} className="px-2 py-1.5 text-[11px] text-[var(--text-muted)]">Cancelar</button>
          </div> : <button
            disabled={!!bulkAction}
            onClick={() => setConfirmEmpty(true)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border disabled:opacity-50"
            style={{ color: 'var(--danger)', borderColor: 'var(--danger-soft-2)' }}
          >Vaciar papelera</button>}
        </div>}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 pb-20">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
              <Icon name="trash" size={28} className="text-[var(--text-muted)]" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-[15px] mb-1">Papelera vacía</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-w-2xl">
            {sorted.map(item => {
              const t   = getType(item.type);
              const dl  = daysLeft(item.deletedAt);
              const pct = progressOf(item);
              const purgeSoon = dl <= 1;
              const isConfirming = confirmId === item.id;

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border transition"
                  style={{
                    background: 'var(--surface)',
                    borderColor: purgeSoon ? 'var(--danger-soft-2)' : 'var(--border)',
                  }}
                >
                  {/* Color strip */}
                  <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: t.color }}></div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="font-semibold text-[13px] truncate">{item.title}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {item.client && (
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{item.client}</span>
                      )}
                      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>·</span>
                      <span className="text-[11px] flex items-center gap-1 font-medium" style={{ color: t.color }}>
                        <Icon name={t.icon} size={10} />{t.label}
                      </span>
                      {pct > 0 && (
                        <>
                          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>·</span>
                          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{pct}%</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Time indicator */}
                  <div className="flex-shrink-0 text-right mr-1 min-w-[80px]">
                    <div
                      className="text-[11px] font-semibold"
                      style={{ color: purgeSoon ? 'var(--danger)' : 'var(--text-dim)' }}
                    >
                      {dl === 0 ? 'Expira hoy' : `${dl}d restantes`}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {deletedAgo(item.deletedAt)}
                    </div>
                    {/* Progress bar for time remaining */}
                    <div className="mt-1 h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)', width: 64 }}>
                      <div
                        className="h-full rounded-full transition"
                        style={{
                          width: `${(dl / TRASH_RETENTION_DAYS) * 100}%`,
                          background: purgeSoon ? 'var(--danger)' : 'var(--text-muted)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {isConfirming ? (
                      <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-soft-2)' }}>
                        <span className="text-[12px] font-semibold mr-1" style={{ color: 'var(--danger)' }}>¿Eliminar para siempre?</span>
                        <button
                          onClick={() => { onPermanentDelete(item.id); setConfirmId(null); }}
                          className="px-2.5 py-1 rounded-md text-[12px] font-bold transition-colors hover:brightness-110"
                          style={{ background: 'var(--danger)', color: 'var(--danger-on)' }}
                        >
                          Sí
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="px-2.5 py-1 rounded-md text-[12px] transition-colors hover:text-white"
                          style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => onRestore(item)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors hover:opacity-90"
                          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                          title="Restaurar tarea"
                        >
                          <Icon name="arrowUpRight" size={12} />
                          Restaurar
                        </button>
                        <button
                          onClick={() => setConfirmId(item.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                          style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                          title="Eliminar permanentemente"
                        >
                          <Icon name="trash" size={12} />
                          Eliminar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
};

Object.assign(window, {
  KanbanView, CalendarView, GalleryView, ListView, EmptyState, ProjectCardMini, GalleryCard, TrashSection,
});
