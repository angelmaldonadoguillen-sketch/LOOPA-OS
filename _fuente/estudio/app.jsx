// ─────────────────────────────────────────────────────────────────
// APP — Sidebar + Header + Filters + Active view + Modal
// ─────────────────────────────────────────────────────────────────

const { useReducer, useEffect, useState, useMemo, useRef } = React;

// ── Persistencia de navegación en localStorage ──────────────────
const _savedNav = (() => {
  try { return JSON.parse(localStorage.getItem('frame_nav') || '{}'); }
  catch { return {}; }
})();
// Vista fija: si hay una pinneada, se abre siempre en esa (anula el historial de nav)
const _pinnedView = localStorage.getItem('frame_pinned_view') || null;

// Último tablero abierto. Se valida contra la lista real de tableros del
// usuario antes de usarse: si le sacaron el acceso, este id ya no sirve.
const _savedWorkspaceId = localStorage.getItem('frame_workspace') || null;

const EMPTY_FILTERS = Object.freeze({
  status: [], type: [], assignee: [], priority: [], client: [],
  tags: [], startDate: [], deadline: [], progress: [], attributes: [],
});

const freshFilters = () => Object.fromEntries(
  Object.entries(EMPTY_FILTERS).map(([key, value]) => [key, [...value]])
);

// ── Initial state + reducer ─────────────────────────────────────
const initialState = {
  // ── Tableros ──
  // Un usuario aprobado puede pertenecer a varios: su tablero personal
  // (kind:'personal', él solo) y los de equipo (kind:'team', hasta 6).
  // activeWorkspaceId decide qué datos se cargan: TODO lo demás del estado
  // pertenece al tablero activo y se vacía al cambiar de uno a otro.
  workspaces: [],
  workspacesLoading: true,
  workspacesError: false,
  activeWorkspaceId: _savedWorkspaceId,
  // ── Proyectos ──
  projects: [],
  loading: true,
  // Arranca en null: antes traía 'u1' hardcodeado de los datos de prueba, así
  // que el listener de notificaciones se suscribía a la bandeja de un usuario
  // inexistente antes de que hubiera sesión — y fallaba con permission-denied.
  currentUserId: null,
  view: _pinnedView || _savedNav.view || 'kanban', // fija > historial > default
  pinnedView: _pinnedView,          // null | 'kanban' | 'calendar' | 'gallery' | 'list'
  search: '',
  filters: freshFilters(),
  openProjectId: null,
  showNewProject: false,
  sidebarFilter: _savedNav.sidebarFilter || 'all',
  // ── Clientes ──
  clients: [],
  clientsLoading: true,
  openClientId: null,
  // ── Equipo ──
  team: [],
  teamLoading: true,
  openMemberId: null,
  // ── Navegación ──
  section: _savedNav.section || 'projects', // 'projects' | 'clients' | 'team'
  // ── Notificaciones ──
  notifications: [],
  notifsLoading: true,
  // ── Columnas Kanban ──
  kanbanColumns: [],
  // ── Tipos personalizados ──
  customTypes: [],
  // ── Papelera ──
  trash: [],
  trashLoading: true,
  // ── Vista previa en tarjetas ──
  previewFields: {
    tipo: true, cliente: true, estado: true,
    prioridad: true, responsables: true,
    deadline: true, presupuesto: false,
    tags: false, progreso: true,
  },
  // ── Carry-over de proyectos ──
  carryOverProjects: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'set_view':       return { ...state, view: action.view };
    case 'set_search':     return { ...state, search: action.value };
    case 'set_user':       return { ...state, currentUserId: action.id };
    case 'open_project':   return { ...state, openProjectId: action.id };
    case 'close_project':  return { ...state, openProjectId: null };
    case 'update_project': return {
      ...state,
      projects: state.projects.map(p => p.id === action.project.id ? action.project : p),
    };
    case 'create_project': return {
      ...state,
      projects: [action.project, ...state.projects],
      openProjectId: action.project.id,
      showNewProject: false,
    };
    // Alta rápida inline (no abre el modal — la tarjeta aparece para rellenar en su lugar)
    case 'create_project_quiet': return {
      ...state,
      projects: [action.project, ...state.projects],
    };
    // ── Tableros ──
    case 'set_workspaces': {
      // error: la consulta fallo. Distinto de "no tiene tableros": sin esta
      // marca, el alta automatica creaba uno nuevo en cada recarga.

      // El id guardado en localStorage sólo vale si sigue siendo un tablero
      // al que el usuario pertenece: pueden haberlo sacado del equipo, o el
      // tablero pudo borrarse. Si no vale, cae al personal.
      const ids   = action.workspaces.map(w => w.id);
      const valid = state.activeWorkspaceId && ids.includes(state.activeWorkspaceId);
      const fallback = (action.workspaces.find(w => w.kind === 'personal') || action.workspaces[0] || null);
      return {
        ...state,
        workspaces: action.workspaces,
        workspacesLoading: false,
        workspacesError: !!action.error,
        activeWorkspaceId: valid ? state.activeWorkspaceId : (fallback ? fallback.id : null),
      };
    }
    case 'set_active_workspace': {
      if (action.id === state.activeWorkspaceId) return state;
      // Se vacían los datos del tablero anterior en el mismo dispatch: si no,
      // durante el instante que tardan los listeners nuevos en responder se
      // verían los proyectos del tablero del que uno viene.
      return {
        ...state,
        activeWorkspaceId: action.id,
        projects: [], loading: true,
        clients: [],  clientsLoading: true,
        trash: [],    trashLoading: true,
        kanbanColumns: [],
        // Los valores pertenecen al tablero anterior. Conservar un cliente,
        // tag o estado inexistente hacía que el tablero nuevo pareciera vacío.
        filters: freshFilters(), search: '', sidebarFilter: 'all',
        openProjectId: null, openClientId: null,
      };
    }
    case 'show_new':       return { ...state, showNewProject: true };
    case 'hide_new':       return { ...state, showNewProject: false };
    case 'toggle_filter': {
      const cur = state.filters[action.key];
      const next = cur.includes(action.value) ? cur.filter(x => x !== action.value) : [...cur, action.value];
      return { ...state, filters: { ...state.filters, [action.key]: next } };
    }
    case 'clear_filter':   return { ...state, filters: { ...state.filters, [action.key]: state.filters[action.key].filter(x => x !== action.value) } };
    // Vacía una clave entera. 'clear_filter' saca un valor suelto: sin
    // action.value no borra nada.
    case 'reset_filter':   return { ...state, filters: { ...state.filters, [action.key]: [] } };
    case 'clear_all_filters': return { ...state, filters: freshFilters(), search: '' };
    case 'set_projects':       return { ...state, projects: action.projects, loading: false };
    case 'delete_project':     return { ...state, projects: state.projects.filter(p => p.id !== action.id), openProjectId: state.openProjectId === action.id ? null : state.openProjectId };
    case 'set_sidebar_filter': return { ...state, sidebarFilter: action.filter, section: action.filter === 'trash' ? 'trash' : 'projects' };
    // ── Papelera ──
    case 'set_trash':          return { ...state, trash: action.trash, trashLoading: false };
    case 'remove_from_trash':  return { ...state, trash: state.trash.filter(t => t.id !== action.id) };
    case 'restore_project':    return { ...state, projects: [action.project, ...state.projects], trash: state.trash.filter(t => t.id !== action.project.id) };
    case 'restore_projects': {
      const restoredIds = new Set(action.projects.map(project => project.id));
      return {
        ...state,
        projects: [...action.projects, ...state.projects.filter(project => !restoredIds.has(project.id))],
        trash: state.trash.filter(item => !restoredIds.has(item.id)),
      };
    }
    case 'clear_trash': return { ...state, trash: [] };
    case 'duplicate_project':  return { ...state, projects: [action.project, ...state.projects] };
    // ── Clientes ──
    case 'set_clients':   return { ...state, clients: action.clients, clientsLoading: false };
    case 'create_client': return { ...state, clients: [action.client, ...state.clients], openClientId: action.client.id };
    case 'update_client': return { ...state, clients: state.clients.map(c => c.id === action.client.id ? action.client : c) };
    case 'delete_client': return { ...state, clients: state.clients.filter(c => c.id !== action.id), openClientId: state.openClientId === action.id ? null : state.openClientId };
    case 'open_client':   return { ...state, openClientId: action.id };
    case 'close_client':  return { ...state, openClientId: null };
    // ── Equipo ──
    case 'set_team':      return { ...state, team: action.team, teamLoading: false };
    case 'create_member': return { ...state, team: [action.member, ...state.team], openMemberId: action.member.id };
    case 'update_member': return { ...state, team: state.team.map(m => m.id === action.member.id ? action.member : m) };
    case 'delete_member': return { ...state, team: state.team.filter(m => m.id !== action.id), openMemberId: state.openMemberId === action.id ? null : state.openMemberId };
    case 'open_member':   return { ...state, openMemberId: action.id };
    case 'close_member':  return { ...state, openMemberId: null };
    // ── Navegación ──
    case 'set_section':   return { ...state, section: action.section };
    // ── Columnas Kanban ──
    case 'set_columns':    return { ...state, kanbanColumns: action.columns };
    case 'update_column':  return { ...state, kanbanColumns: state.kanbanColumns.map(c => c.id === action.column.id ? action.column : c) };
    case 'add_column':     return { ...state, kanbanColumns: [...state.kanbanColumns, action.column] };
    case 'delete_column':  return { ...state, kanbanColumns: state.kanbanColumns.filter(c => c.id !== action.id) };
    // ── Vista previa ──
    case 'set_preview_fields':    return { ...state, previewFields: action.fields };
    case 'toggle_preview_field':  return { ...state, previewFields: { ...state.previewFields, [action.key]: !state.previewFields[action.key] } };
    // ── Carry-over proyectos ──
    case 'set_carryover_projects': return { ...state, carryOverProjects: action.value };
    // ── Vista fija ──
    case 'set_pinned_view': return { ...state, pinnedView: action.view };
    // ── Tipos personalizados ──
    case 'set_custom_types':    return { ...state, customTypes: action.types };
    case 'add_custom_type':     return { ...state, customTypes: [...state.customTypes, action.typeObj] };
    case 'update_custom_type':  return { ...state, customTypes: state.customTypes.map(t => t.id === action.id ? { ...t, ...action.patch } : t) };
    case 'delete_custom_type':  return { ...state, customTypes: state.customTypes.filter(t => t.id !== action.id) };
    // ── Notificaciones ──
    case 'set_notifs':           return { ...state, notifications: action.notifications, notifsLoading: false };
    case 'mark_notif_read':      return { ...state, notifications: state.notifications.map(n => n.id === action.id ? { ...n, read: true } : n) };
    case 'mark_all_notifs_read': return { ...state, notifications: state.notifications.map(n => ({ ...n, read: true })) };
    case 'resolve_notif':        return { ...state, notifications: state.notifications.map(n => n.id === action.id ? { ...n, read: true, resolved: true, resolvedAction: action.action } : n) };
    default: return state;
  }
}

// ── Helper global para crear notificaciones ──────────────────────────────
window.pushNotif = (toUserId, data) => {
  if (!toUserId) return;
  const senderId = firebase.auth().currentUser?.uid;
  if (!senderId || !data?.workspaceId) return;
  const id = 'n' + Date.now() + Math.random().toString(36).slice(2, 6);
  return window.db
    .collection('frame_notifications')
    .doc(String(toUserId))
    .collection('items')
    .doc(id)
    .set({ id, ...data, senderId, read: false, createdAt: new Date().toISOString() })
    .catch(err => console.error('pushNotif error:', err));
};

// ── Avisos de error ─────────────────────────────────────────────
// Todas las escrituras terminaban en .catch(console.error). Como el dispatch
// optimista ya había pintado el cambio, la interfaz mostraba el trabajo como
// guardado aunque Firestore lo hubiera rechazado: se creía tener algo que en
// realidad se perdió al recargar.
//
// window.frameToast lo usan los handlers sin tener que pasar props por toda
// la app. Es el mismo criterio que window.db.
const ToastStack = () => {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    window.frameToast = (msg, kind = 'error') => {
      const id = Date.now() + Math.random();
      setToasts(t => [...t, { id, msg, kind }]);
      // Los errores se quedan más tiempo: hay que leerlos y decidir qué hacer.
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 7000 : 3500);
    };
    return () => { delete window.frameToast; };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-[9999] flex flex-col gap-2"
         style={{ transform: 'translateX(-50%)', maxWidth: 'min(92vw, 420px)' }}>
      {toasts.map(t => (
        <div key={t.id} className="flex items-start gap-2.5 px-4 py-3 rounded-xl anim-fade-in"
             style={{
               background: 'var(--surface-2)',
               boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.08), 0 12px 32px -8px rgba(0,0,0,.8)',
               borderLeft: `2px solid ${t.kind === 'error' ? 'var(--danger)' : 'var(--accent)'}`,
             }}>
          <Icon name={t.kind === 'error' ? 'alert' : 'check'} size={14}
                style={{ color: t.kind === 'error' ? 'var(--danger)' : 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
          <span className="text-[13px] leading-snug" style={{ color: 'var(--text)' }}>{t.msg}</span>
        </div>
      ))}
    </div>
  );
};

// Traduce el error de Firestore a algo accionable. "Missing or insufficient
// permissions" no le dice nada a nadie.
const explainWriteError = (err, que) => {
  if (err?.friendly) return err.friendly;
  const code = err?.code || '';
  if (code === 'permission-denied')  return `No tenés permiso para ${que}.`;
  if (code === 'unavailable')        return `Sin conexión. ${que} no se guardó — revisá tu internet.`;
  if (code === 'resource-exhausted') return `Se agotó la cuota de la base de datos. ${que} no se guardó.`;
  return `No se pudo guardar: ${que}. Recargá para ver el estado real.`;
};

// FRAME ⇄ LOOPA (fusión): sin loopa-fusion.js las escrituras que lo usan
// no se intentan (las reglas nuevas rechazarían la forma vieja): se avisa.
const fusionLista = () => {
  if (window.FrameLoopa) return true;
  console.error('[FRAME] Falta loopa-fusion.js');
  window.frameToast?.('Falta una parte de Producción. Recargá la página.');
  return false;
};

const notifyWriteError = (err, que) => {
  console.error('[FRAME]', que, err);
  if (window.frameToast) window.frameToast(explainWriteError(err, que));
};

// ── Invitaciones recibidas ──────────────────────────────────────
// Barra sobre el contenido, no una pantalla aparte: una invitación no debe
// interrumpir lo que la persona estaba haciendo en su propio tablero.
const InviteBanner = ({ invites, onAccept, onDecline }) => {
  if (!invites || invites.length === 0) return null;
  const inv = invites[0];
  return (
    <div
      className="flex items-center gap-3 px-5 py-2.5 border-b anim-fade-in"
      style={{ background: 'var(--accent-soft)', borderColor: 'var(--border)' }}
    >
      <Icon name="users" size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <div className="flex-1 min-w-0 text-[13px]">
        <span style={{ color: 'var(--text-dim)' }}>
          {inv.invitedByName || 'Alguien'} te invitó a{' '}
        </span>
        <strong style={{ color: 'var(--text)' }}>{inv.workspaceName || 'un tablero'}</strong>
        {invites.length > 1 && (
          <span style={{ color: 'var(--text-muted)' }}> · y {invites.length - 1} más</span>
        )}
      </div>
      <button
        onClick={() => onAccept(inv)}
        className="px-3 py-1.5 rounded-md text-[12px] font-semibold hover:brightness-110 transition"
        style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
      >
        Unirme
      </button>
      <button
        onClick={() => onDecline(inv)}
        className="px-2.5 py-1.5 rounded-md text-[12px]"
        style={{ color: 'var(--text-muted)' }}
      >
        Ahora no
      </button>
    </div>
  );
};

// ── Selector de tablero ─────────────────────────────────────────
// Cambiar de tablero recarga todos los datos: el estado se vacía en el
// dispatch y los listeners se vuelven a suscribir con el workspaceId nuevo.
const WorkspaceRenameForm = ({ workspace, onRename, onClose }) => {
  const [name, setName] = React.useState(workspace.name || '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const savingRef = React.useRef(false);
  const submit = async (event) => {
    event.preventDefault();
    if (savingRef.current || !name.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onRename(workspace.id, name);
      onClose();
    } catch (err) {
      setError(err.message || 'No se pudo cambiar el nombre.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="p-3 space-y-2" aria-label="Cambiar nombre del tablero">
      <label className="block text-[12px] font-medium">
        Nombre del tablero
        <input autoFocus required maxLength={80} value={name} disabled={saving}
          onFocus={event => event.target.select()}
          onChange={event => { setName(event.target.value); setError(''); }}
          onKeyDown={event => { if (event.key === 'Escape' && !savingRef.current) { event.preventDefault(); onClose(); } }}
          className="block w-full min-w-0 mt-2 px-2.5 py-2 rounded-md text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          style={{ background: 'var(--surface-3)', color: 'var(--text)' }} />
      </label>
      {error && <p role="alert" className="text-[12px]" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving || !name.trim() || name.trim() === workspace.name}
          className="px-3 py-2 rounded-md text-[12px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>{saving ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" disabled={saving} onClick={onClose}
          className="px-3 py-2 rounded-md text-[12px] disabled:opacity-40" style={{ color: 'var(--text-dim)' }}>Cancelar</button>
      </div>
    </form>
  );
};

const WorkspaceSwitcher = ({ state, dispatch, onCreateTeam, onDeleteWorkspace, onRenameWorkspace, collapsed }) => {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target) && !renaming) { setOpen(false); setCreating(false); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, renaming]);

  const active = state.workspaces.find(w => w.id === state.activeWorkspaceId);
  const personal = state.workspaces.filter(w => w.kind === 'personal');
  const teams    = state.workspaces.filter(w => w.kind === 'team');

  const submit = () => {
    const t = name.trim();
    if (!t) return;
    onCreateTeam(t);
    setName(''); setCreating(false); setOpen(false);
  };

  const Row = ({ w, canDelete }) => {
    const isActive = w.id === state.activeWorkspaceId;
    const [confirm, setConfirm] = useState(false);
    const isOwner = w.ownerId === state.currentUserId;
    const empty   = (w.projectCount || 0) === 0;

    return (
      <div
        className="group flex items-center gap-1 pr-1 rounded-lg transition-colors"
        style={{ background: isActive ? 'var(--accent-soft)' : 'transparent' }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--surface-3)'; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
      >
        <button
          onClick={() => { dispatch({ type: 'set_active_workspace', id: w.id }); setOpen(false); }}
          className="flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 text-left"
        >
          <Icon name={w.kind === 'personal' ? 'user' : 'users'} size={13}
                style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
          <span className="flex-1 min-w-0 truncate text-[13px]" style={{ color: isActive ? 'var(--accent)' : 'var(--text)' }}>
            {w.name}
          </span>
          {w.kind === 'team' && (
            <span className="text-[10px] tnum flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
              {(w.memberIds || []).length}/6
            </span>
          )}
        </button>

        {isOwner && (
          <button type="button" onClick={() => { setRenaming(w); setCreating(false); }}
            title="Cambiar nombre" aria-label={'Cambiar nombre de ' + w.name}
            className="p-2 rounded-md flex-shrink-0 hover:bg-[var(--surface-3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            style={{ color: 'var(--text-muted)' }}><Icon name="edit" size={13} /></button>
        )}
        {/* Borrar: sólo el dueño, y nunca el último que queda — sin ningún
            tablero la app no tiene dónde poner nada. */}
        {isOwner && canDelete && (
          confirm ? (
            <span className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { onDeleteWorkspace(w); setConfirm(false); }}
                className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: 'var(--danger)', color: '#fff' }}>Borrar</button>
              <button onClick={() => setConfirm(false)}
                className="text-[11px] px-1 py-0.5 rounded" style={{ color: 'var(--text-muted)' }}>No</button>
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirm(true); }}
              className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              style={{ color: 'var(--text-muted)' }}
              title="Eliminar tablero"
            >
              <Icon name="trash" size={12} />
            </button>
          )
        )}
      </div>
    );
  };

  return (
    <div className={`${collapsed ? 'px-2' : 'px-3'} py-2.5 border-b border-app relative`} ref={ref}>
      <button
        onClick={() => { if (!renaming) setOpen(o => !o); }}
        title={collapsed ? (active ? active.name : 'Sin tablero') : undefined}
        className={`w-full flex items-center rounded-lg transition-colors ${collapsed ? 'justify-center py-2.5' : 'gap-2 px-2 py-2'}`}
        style={{ background: open ? 'var(--surface-3)' : 'var(--surface-2)' }}
      >
        <Icon name={active?.kind === 'team' ? 'users' : 'user'} size={collapsed ? 15 : 13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        {!collapsed && (
          <>
            <span className="flex-1 min-w-0 text-left truncate text-[13px] font-medium">
              {active ? active.name : 'Sin tablero'}
            </span>
            <Icon name="chevronDown" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </>
        )}
      </button>

      {open && (
        <div
          className={`absolute rounded-xl overflow-hidden z-50 anim-fade-in ${collapsed ? 'left-full ml-2 top-2 w-60' : 'left-3 right-3 mt-1.5'}`}
          style={{
            background: 'var(--surface-2)',
            boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.08), 0 16px 40px -12px rgba(0,0,0,.8)',
          }}
        >
          {renaming ? <WorkspaceRenameForm key={renaming.id} workspace={renaming} onRename={onRenameWorkspace} onClose={() => setRenaming(null)} /> : <>
          <div className="p-1.5 space-y-0.5">
            {personal.map(w => <Row key={w.id} w={w} canDelete={state.workspaces.length > 1} />)}

            {teams.length > 0 && (
              <>
                <div className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Equipos
                </div>
                {teams.map(w => <Row key={w.id} w={w} canDelete={state.workspaces.length > 1} />)}
              </>
            )}
          </div>

          <div className="p-1.5 hair-t">
            {creating ? (
              <div className="px-1 py-0.5">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')  { e.preventDefault(); submit(); }
                    if (e.key === 'Escape') { setCreating(false); setName(''); }
                  }}
                  placeholder="Nombre del equipo"
                  className="w-full px-2.5 py-2 rounded-lg text-[13px]"
                  style={{ background: 'var(--surface-3)', color: 'var(--text)' }}
                />
                <div className="flex items-center gap-1.5 mt-1.5 px-0.5">
                  <button onClick={submit} disabled={!name.trim()}
                    className="px-2.5 py-1 rounded-md text-[12px] font-semibold disabled:opacity-40"
                    style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>Crear</button>
                  <button onClick={() => { setCreating(false); setName(''); }}
                    className="px-2 py-1 rounded-md text-[12px]" style={{ color: 'var(--text-muted)' }}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-[13px] transition-colors"
                style={{ color: 'var(--text-dim)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon name="plus" size={13} style={{ flexShrink: 0 }} />
                Crear tablero de equipo
              </button>
            )}
          </div>
          </>}
        </div>
      )}
    </div>
  );
};

// ── Sidebar ─────────────────────────────────────────────────────
const SIDEBAR_KEY = 'frame_sidebar_collapsed';

const Sidebar = ({ state, dispatch, onSignOut, onCreateTeam, onDeleteWorkspace, onRenameWorkspace }) => {
  // Se recuerda plegada o abierta: si cada recarga la vuelve a abrir, el que
  // trabaja plegado tiene que cerrarla otra vez todos los días.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
  });
  const toggle = () => setCollapsed(c => {
    const next = !c;
    try { localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch {}
    return next;
  });

  const recentProjects = state.projects.slice(0, 5);
  const me = state.team.find(m => m.id === state.currentUserId) || getUser(state.currentUserId);

  const counts = {
    all:       state.projects.filter(p => p.status !== 'archived').length,
    favorites: state.projects.filter(p => p.favorite).length,
    mine:      state.projects.filter(p => p.assignees.includes(state.currentUserId) && p.status !== 'archived').length,
    urgent:    state.projects.filter(needsAttention).length,
    delivered: state.projects.filter(p => isCompletionStatus(p.status)).length,
    archived:  state.projects.filter(p => p.status === 'archived').length,
    trash:     state.trash.length,
  };
  const sf = state.sidebarFilter;
  const setFilter = (f) => dispatch({ type: 'set_sidebar_filter', filter: f });

  // Solicitudes de acceso esperando. Sólo el admin de plataforma las ve: es
  // el único que puede resolverlas, así que a nadie más le sirve el aviso.
  const iAmAdmin    = !!state.team.find(m => m.id === state.currentUserId)?.platformAdmin;
  const pendingCount = iAmAdmin ? state.team.filter(m => m.status === 'pending').length : 0;

  // Quiénes integran el tablero abierto (no la plataforma entera).
  const wsPeople = workspaceMembers(state.workspaces.find(w => w.id === state.activeWorkspaceId));
  const activeKind = state.workspaces.find(w => w.id === state.activeWorkspaceId)?.kind;

  return (
    <aside
      className="flex-shrink-0 border-r border-app flex flex-col"
      style={{ background: 'var(--surface)', width: collapsed ? 60 : 240, transition: 'width .18s var(--ease, ease)' }}
    >
      {/* Logo — click va a inicio */}
      <div className={`${collapsed ? 'px-2 py-4 flex-col gap-2' : 'px-4 py-5 gap-1'} border-b border-app flex items-center`}>
        <button
          onClick={() => {
            dispatch({ type: 'set_section', section: 'projects' });
            dispatch({ type: 'set_sidebar_filter', filter: 'all' });
            if (state.pinnedView) dispatch({ type: 'set_view', view: state.pinnedView });
          }}
          className={`flex items-center gap-2.5 min-w-0 text-left hover:opacity-80 transition-opacity ${collapsed ? '' : 'flex-1'}`}
          title="Ir al inicio"
        >
          {collapsed ? (
            <FrameMark size={26} className="flex-shrink-0" />
          ) : (
            /* whitespace-nowrap: "Studio Manager" con esa separación entre
               letras no entra en lo que sobra al lado del chevrón, y se
               partía en dos renglones desalineados. */
            <div className="min-w-0 leading-tight">
              <FrameLogo height={22} className="block" />
              <div className="text-[9px] tracking-[0.16em] text-[var(--text-muted)] uppercase whitespace-nowrap mt-1.5">Studio Manager</div>
            </div>
          )}
        </button>
        <button
          onClick={toggle}
          title={collapsed ? 'Desplegar menú' : 'Plegar menú'}
          className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-2)] transition-colors flex-shrink-0"
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={14} />
        </button>
      </div>

      {/* Tablero activo */}
      <WorkspaceSwitcher state={state} dispatch={dispatch} onCreateTeam={onCreateTeam} onDeleteWorkspace={onDeleteWorkspace} onRenameWorkspace={onRenameWorkspace} collapsed={collapsed} />

      {/* Usuario autenticado — cerrar sesión vive acá adentro */}
      <ProfileMenu me={me} collapsed={collapsed} onSignOut={onSignOut}
        onOpenSettings={() => dispatch({ type: 'set_section', section: 'settings' })} />

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto overflow-x-hidden ${collapsed ? 'px-2' : 'px-3'} py-3 space-y-0.5`}>
        {!collapsed && <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] px-2 py-1.5 select-none">Espacios</div>}
        <NavItem collapsed={collapsed} icon="layers"  label="Todas las tareas"    count={counts.all}                    active={sf === 'all'}       onClick={() => setFilter('all')} />
        <NavItem collapsed={collapsed} icon="star"    label="Favoritos"           count={counts.favorites || undefined} active={sf === 'favorites'} onClick={() => setFilter('favorites')} />
        <NavItem collapsed={collapsed} icon="users"   label="Asignados a mí"     count={counts.mine}                   active={sf === 'mine'}      onClick={() => setFilter('mine')} />
        {/* Rojo sólo cuando de verdad hay algo por vencer. Encendido siempre,
            el color no avisaba nada: era parte del decorado. */}
        <NavItem collapsed={collapsed} icon="alert"   label="Fechas límite urgentes" count={counts.urgent}              active={sf === 'urgent'}    accent={counts.urgent > 0} onClick={() => setFilter('urgent')} />
        <NavItem collapsed={collapsed} icon="check"   label="Completadas"        count={counts.delivered}              active={sf === 'delivered'} onClick={() => setFilter('delivered')} />
        <NavItem collapsed={collapsed} icon="trash"   label="Papelera"           count={counts.trash || undefined}     active={sf === 'trash'}     onClick={() => setFilter('trash')} />

        {collapsed
          ? <div className="my-2 mx-1 hair" />
          : <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] px-2 py-1.5 mt-4 select-none">Trabajo</div>}
        <NavItem collapsed={collapsed} icon="briefcase" label="Clientes"  active={state.section === 'clients'}   onClick={() => dispatch({ type: 'set_section', section: 'clients' })} />
        {/* "Equipo" sólo aparece en tableros de equipo: en el personal estás
            solo y la sección no tenía nada que mostrar.
            Las aprobaciones se mudaron a Ajustes — son permiso de plataforma,
            no pertenencia a un tablero, y mezclarlas obligaba a mostrar
            "Equipo" donde no correspondía. */}
        {activeKind === 'team' && (
          <NavItem collapsed={collapsed} icon="users"   label="Equipo"    active={state.section === 'team'}      onClick={() => dispatch({ type: 'set_section', section: 'team' })} />
        )}
        <NavItem collapsed={collapsed} icon="image" label="Mi portfolio" active={state.section === 'portfolio'} onClick={() => dispatch({ type: 'set_section', section: 'portfolio' })} />
        <NavItem collapsed={collapsed} icon="zap"       label="Analytics" active={state.section === 'analytics'} onClick={() => dispatch({ type: 'set_section', section: 'analytics' })} />
        <NavItem collapsed={collapsed} icon="settings"  label="Ajustes"   active={state.section === 'settings'}  onClick={() => dispatch({ type: 'set_section', section: 'settings' })} count={pendingCount || undefined} accent={pendingCount > 0} />

        {/* Recientes y el equipo en línea no caben en 60px sin volverse
            adivinanza: un punto de color no dice de qué tarea se trata. */}
        {!collapsed && (
          <div className="mt-5">
            <div className="flex items-center justify-between px-2 py-1.5">
              <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] select-none">Recientes</div>
              <Icon name="chevronDown" size={11} className="text-[var(--text-muted)]" />
            </div>
            <div className="space-y-0.5">
              {recentProjects.map(p => (
                <button
                  key={p.id}
                  onClick={() => dispatch({ type: 'open_project', id: p.id })}
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-[var(--text-dim)] hover:text-white hover:bg-[var(--surface-2)] transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: getType(p.type).color }}></span>
                  <span className="truncate">{p.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Team */}
      {!collapsed && (
        <div className="border-t border-app p-3">
          <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-2 px-1 select-none">Equipo en línea</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {wsPeople.slice(0, 5).map(u => (
              <div key={u.id} className="relative" title={u.name}>
                <Avatar user={u} size={26} />
                <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full ring-2 ring-[var(--surface)]" style={{ background: 'var(--resource-teal)' }}></span>
              </div>
            ))}
            {wsPeople.length === 0 && (
              <span className="text-[10px] text-[var(--text-muted)]">Sin integrantes</span>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};

// ── Perfil ──────────────────────────────────────────────────────
// Cerrar sesión estaba como un icono suelto al lado del nombre, a un clic
// de distancia y pegado a cosas que se tocan seguido.
const ProfileMenu = ({ me, collapsed, onSignOut, onOpenSettings }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc   = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const Item = ({ icon, label, danger, onClick }) => (
    <button
      onClick={() => { setOpen(false); onClick(); }}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors"
      style={{ color: danger ? 'var(--danger)' : 'var(--text)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'var(--danger-soft)' : 'var(--surface-3)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </button>
  );

  return (
    <div className={`${collapsed ? 'px-2' : 'px-3'} py-3 border-b border-app relative`} ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title={collapsed ? me.name : undefined}
        className={`w-full flex items-center rounded-lg transition-colors ${collapsed ? 'justify-center py-1' : 'gap-2.5 px-2 py-1.5'}`}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <Avatar user={me} size={32} />
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0 select-none text-left">
              <div className="text-[13px] font-semibold truncate">{me.name}</div>
              <div className="text-[10px] text-[var(--text-muted)] truncate">{me.role}</div>
            </div>
            <Icon name="chevronDown" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </>
        )}
      </button>

      {open && (
        <div
          className={`absolute rounded-xl overflow-hidden z-50 anim-fade-in ${collapsed ? 'left-full ml-2 top-2 w-56' : 'left-3 right-3 mt-1.5'}`}
          style={{
            background: 'var(--surface-2)',
            boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.08), 0 16px 40px -12px rgba(0,0,0,.8)',
          }}
        >
          <div className="px-3 py-2.5 hair">
            <div className="text-[13px] font-semibold truncate">{me.name}</div>
            {me.email && <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{me.email}</div>}
          </div>
          <div className="p-1.5 space-y-0.5">
            <Item icon="settings" label="Ajustes"       onClick={onOpenSettings} />
            <Item icon="logOut"   label="Cerrar sesión" danger onClick={onSignOut} />
          </div>
        </div>
      )}
    </div>
  );
};

const NavItem = ({ icon, label, count, active, accent, collapsed, onClick }) => (
  <button
    onClick={onClick}
    title={collapsed ? label : undefined}
    className={`w-full flex items-center rounded-md text-[13px] transition-colors group ${collapsed ? 'relative justify-center py-2' : 'gap-2.5 px-2 py-1.5'} ${active ? 'bg-[var(--surface-2)] text-white' : 'text-[var(--text-dim)] hover:text-white hover:bg-[var(--surface-2)]'}`}
  >
    <Icon name={icon} size={collapsed ? 16 : 14} style={{ color: accent ? 'var(--danger)' : undefined }} />
    {!collapsed && <span className="flex-1 text-left">{label}</span>}
    {!collapsed && count !== undefined && (
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${active ? 'bg-[var(--surface-3)] text-white' : 'text-[var(--text-muted)]'}`}>
        {count}
      </span>
    )}
    {/* Plegada no cabe el número, pero sí importa saber que hay algo urgente
        o esperando aprobación. */}
    {collapsed && accent && count > 0 && (
      <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--danger)' }} />
    )}
  </button>
);

// ── Notification Panel ──────────────────────────────────────────
const NotificationPanel = ({ notifications, team = [], onMarkRead, onMarkAllRead, onOpenProject, onApproveUser, onRejectUser }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const unread = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const timeAgo = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `hace ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `hace ${hrs}h`;
    return `hace ${Math.floor(hrs / 24)}d`;
  };

  const notifIcon = (type) => {
    if (type === 'mention')          return 'at';
    if (type === 'comment')          return 'message';
    if (type === 'status')           return 'zap';
    if (type === 'approval_request') return 'users';
    return 'bell';
  };

  const notifColor = (type, read) => {
    if (type === 'approval_request') return { bg: read ? 'var(--surface-3)' : 'var(--accent-soft)', fg: 'var(--resource-blue)' };
    return { bg: read ? 'var(--surface-3)' : 'var(--accent-soft)', fg: read ? 'var(--text-muted)' : 'var(--accent)' };
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`p-2 rounded-md transition-colors relative ${open ? 'bg-[var(--surface-2)] text-white' : 'text-[var(--text-dim)] hover:text-white hover:bg-[var(--surface-2)]'}`}
      >
        <Icon name="bell" size={15} />
        {unread > 0 && (
          <span
            className="absolute top-0.5 right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full text-[10px] font-bold flex items-center justify-center"
            style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 surf-float overflow-hidden anim-scale-in z-50"
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-app">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[13px]">Notificaciones</span>
              {unread > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>{unread}</span>
              )}
            </div>
            {unread > 0 && (
              <button onClick={onMarkAllRead} className="text-[11px] text-[var(--text-muted)] hover:text-white transition-colors">
                Marcar todo leído
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Icon name="bell" size={22} className="mx-auto mb-2 text-[var(--text-muted)]" />
                <div className="text-[12px] text-[var(--text-muted)]">Sin notificaciones</div>
              </div>
            ) : (
              notifications.slice(0, 25).map(n => {
                const nc = notifColor(n.type, n.read);

                // ── Solicitud de acceso ──────────────────────────
                if (n.type === 'approval_request') {
                  const reqUser  = team.find(m => m.id === n.userId);
                  const isPending = !n.resolved && (!reqUser || reqUser.status === 'pending');
                  const wasApproved = n.resolvedAction === 'approved' || reqUser?.status === 'active';
                  return (
                    <div
                      key={n.id}
                      className={`px-4 py-3 border-b border-app ${!n.read ? 'bg-[var(--accent-soft)]' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ background: nc.bg, color: nc.fg }}>
                          <Icon name="users" size={13} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] leading-snug font-medium">{n.body}</div>
                          <div className="text-[11px] mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>{n.userEmail}</div>
                          <div className="text-[10px] mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>{timeAgo(n.createdAt)}</div>
                          {isPending ? (
                            <div className="flex gap-1.5 mt-2.5">
                              <button
                                onClick={() => { onApproveUser && onApproveUser(n.userId, n.id); }}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-bold transition hover:brightness-110"
                                style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
                              >
                                <Icon name="check" size={11} strokeWidth={2.5} />
                                Aprobar
                              </button>
                              <button
                                onClick={() => { onRejectUser && onRejectUser(n.userId, n.id); }}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                                style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}
                              >
                                Rechazar
                              </button>
                            </div>
                          ) : (
                            <div className="mt-1.5 text-[11px] font-semibold flex items-center gap-1"
                              style={{ color: wasApproved ? 'var(--accent)' : 'var(--danger)' }}>
                              <Icon name={wasApproved ? 'check' : 'x'} size={11} strokeWidth={2.5} />
                              {wasApproved ? 'Acceso aprobado' : 'Acceso denegado'}
                            </div>
                          )}
                        </div>
                        {!n.read && (
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2.5" style={{ background: 'var(--accent)' }}></span>
                        )}
                      </div>
                    </div>
                  );
                }

                // ── Notificación regular ─────────────────────────
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      onMarkRead(n.id);
                      if (n.projectId) { onOpenProject(n.projectId); setOpen(false); }
                    }}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-app hover:bg-[var(--surface-2)] transition-colors last:border-b-0 ${!n.read ? 'bg-[var(--accent-soft)]' : ''}`}
                  >
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: nc.bg, color: nc.fg }}>
                      <Icon name={notifIcon(n.type)} size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] leading-snug">{n.body}</div>
                      {n.projectTitle && (
                        <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">{n.projectTitle}</div>
                      )}
                      <div className="text-[10px] text-[var(--text-muted)] mt-1 font-mono">{timeAgo(n.createdAt)}</div>
                    </div>
                    {!n.read && (
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2.5" style={{ background: 'var(--accent)' }}></span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Header ──────────────────────────────────────────────────────
const Header = ({ columns = [], state, dispatch, filteredCount, notifications, onMarkRead, onMarkAllRead, onOpenProject, onApproveUser, onRejectUser, onPinView }) => {
  // Se calcula acá y no se recibe de App: el filtro por responsable tiene que
  // ofrecer a los miembros del tablero abierto, no a los de la plataforma.
  const activeWs  = state.workspaces.find(w => w.id === state.activeWorkspaceId);
  const wsMembers = workspaceMembers(activeWs);

  // En el tablero personal sos el único integrante: filtrar "por equipo" es
  // elegirte a vos mismo, o sea no filtrar nada.
  const soloYo = activeWs?.kind === 'personal';

  // Si venías de un tablero de equipo con alguien filtrado, ese filtro
  // seguiría aplicándose sin desplegable donde verlo ni sacarlo.
  useEffect(() => {
    if (soloYo && state.filters.assignee.length) {
      dispatch({ type: 'reset_filter', key: 'assignee' });
    }
  }, [soloYo, state.filters.assignee.length]);
  const me = getUser(state.currentUserId);
  const tagOptions = [...new Set((state.projects || []).flatMap(p => p.tags || []).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map(tag => ({ id: tag, label: `#${tag}`, color: 'var(--resource-blue)' }));
  const startDateOptions = [
    { id: 'today', label: 'Hoy' },
    { id: 'this_week', label: 'Esta semana' },
    { id: 'this_month', label: 'Este mes' },
    { id: 'no_date', label: 'Sin fecha' },
  ];
  const deadlineOptions = [
    { id: 'overdue', label: 'Vencidas' },
    { id: 'today', label: 'Vencen hoy' },
    { id: 'next_7_days', label: 'Próximos 7 días' },
    { id: 'this_month', label: 'Este mes' },
    { id: 'no_date', label: 'Sin fecha límite' },
  ];
  const progressOptions = [
    { id: 'no_checklist', label: 'Sin checklist' },
    { id: 'not_started', label: 'Sin iniciar' },
    { id: 'in_progress', label: 'En progreso' },
    { id: 'complete', label: 'Checklist completo' },
  ];
  const attributeOptions = [
    { id: 'favorite', label: 'Favoritas' },
    { id: 'unassigned', label: 'Sin responsable' },
    { id: 'assigned', label: 'Con responsable' },
    { id: 'has_deliverables', label: 'Con entregables' },
    { id: 'no_deliverables', label: 'Sin entregables' },
  ];
  const advancedLabels = {
    startDate: Object.fromEntries(startDateOptions.map(o => [o.id, `Inicio: ${o.label}`])),
    deadline: Object.fromEntries(deadlineOptions.map(o => [o.id, o.label])),
    progress: Object.fromEntries(progressOptions.map(o => [o.id, o.label])),
    attributes: Object.fromEntries(attributeOptions.map(o => [o.id, o.label])),
  };
  const activeFilters = [
    ...state.filters.status.map(v => ({ key: 'status', value: v, label: getStatus(v).label, color: getStatus(v).color })),
    ...state.filters.type.map(v => ({ key: 'type', value: v, label: getType(v).label, color: getType(v).color })),
    ...state.filters.assignee.map(v => ({ key: 'assignee', value: v, label: getUser(v)?.name ?? v, color: getUser(v)?.color ?? '#9A9AA3' })),
    ...state.filters.priority.map(v => ({ key: 'priority', value: v, label: getPrio(v).label, color: getPrio(v).color })),
    ...(state.filters.client || []).map(v => { const cl = (state.clients || []).find(c => c.name === v); return { key: 'client', value: v, label: v, color: cl?.color || '#9A9AA3' }; }),
    ...(state.filters.tags || []).map(v => ({ key: 'tags', value: v, label: `#${v}`, color: 'var(--resource-blue)' })),
    ...['startDate', 'deadline', 'progress', 'attributes'].flatMap(key =>
      (state.filters[key] || []).map(value => ({
        key, value, label: advancedLabels[key][value] || value, color: 'var(--resource-neutral)',
      }))
    ),
  ];

  return (
    <header className="border-b border-app">
      {/* Top row */}
      <div className="flex items-center gap-3 px-5 py-3">
        {/* View switcher */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-md surface-2">
          {[
            { id: 'kanban',   icon: 'kanban',   label: 'Tablero' },
            { id: 'calendar', icon: 'calendar', label: 'Calendario' },
            { id: 'gallery',  icon: 'grid',     label: 'Galería' },
            { id: 'list',     icon: 'list',     label: 'Lista' },
          ].map(v => {
            const isPinned = state.pinnedView === v.id;
            return (
              <div key={v.id} className="relative group">
                {/* Botón de vista */}
                <button
                  onClick={() => dispatch({ type: 'set_view', view: v.id })}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[12px] font-medium transition select-none ${state.view === v.id ? 'bg-[var(--surface-3)] text-white' : 'text-[var(--text-dim)] hover:text-white'}`}
                >
                  <Icon name={v.icon} size={13} />
                  <span>{v.label}</span>
                  {/* Dot indicador cuando está fijada */}
                  {isPinned && (
                    <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
                  )}
                </button>
                {/* Pin button — aparece al hover, siempre visible si está fijada */}
                <button
                  onClick={(e) => { e.stopPropagation(); onPinView && onPinView(v.id); }}
                  className={`absolute -top-1.5 -right-1 w-[18px] h-[18px] rounded-full flex items-center justify-center transition ${isPinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  style={{
                    background: isPinned ? 'var(--accent)' : 'var(--surface-3)',
                    color:      isPinned ? 'var(--accent-on)' : 'var(--text-muted)',
                    border:     `1px solid ${isPinned ? 'transparent' : 'var(--border)'}`,
                    boxShadow:  '0 1px 6px rgba(0,0,0,0.4)',
                    zIndex: 10,
                  }}
                  title={isPinned ? 'Quitar vista fija' : 'Fijar como vista principal'}
                >
                  <Icon name="pin" size={9} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md surface-2 flex-1 max-w-md">
          <Icon name="search" size={13} className="text-[var(--text-muted)]" />
          <input
            value={state.search}
            onChange={(e) => dispatch({ type: 'set_search', value: e.target.value })}
            placeholder="Buscar tareas, clientes…"
            className="flex-1 text-[13px]"
          />
          {state.search && (
            <button onClick={() => dispatch({ type: 'set_search', value: '' })} className="text-[var(--text-muted)] hover:text-white">
              <Icon name="x" size={12} />
            </button>
          )}
        </div>

        {/* Atajos en escritorio; el panel Más filtros contiene el juego
            completo y queda disponible también en pantallas pequeñas. */}
        <div className="hidden xl:flex items-center gap-1">
          <FilterDropdown label="Estado"    icon="dot"       filterKey="status"   options={columns.length > 0 ? columns : STATUSES} state={state} dispatch={dispatch} />
          <FilterDropdown label="Tipo"      icon="film"      filterKey="type"     options={state.customTypes.length > 0 ? state.customTypes : PROJECT_TYPES} state={state} dispatch={dispatch} />
          <FilterDropdown label="Prioridad" icon="flag"      filterKey="priority" options={PRIORITIES} state={state} dispatch={dispatch} />
          {!soloYo && <FilterDropdown label="Equipo" icon="users" filterKey="assignee" options={(wsMembers || []).map(u => ({ id: u.id, label: u.name, color: u.color }))} state={state} dispatch={dispatch} />}
          <FilterDropdown label="Cliente" icon="briefcase" filterKey="client" options={[...new Map((state.projects || []).filter(p => p.client).map(p => { const cl = (state.clients || []).find(c => c.name === p.client); return [p.client, { id: p.client, label: p.client, color: cl?.color || '#9A9AA3' }]; })).values()]} state={state} dispatch={dispatch} />
        </div>
        <MoreFiltersDropdown
          state={state}
          dispatch={dispatch}
          groups={[
            { key: 'status', label: 'Estado', options: columns.length > 0 ? columns : STATUSES },
            { key: 'type', label: 'Tipo', options: state.customTypes.length > 0 ? state.customTypes : PROJECT_TYPES },
            { key: 'priority', label: 'Prioridad', options: PRIORITIES },
            ...(!soloYo ? [{ key: 'assignee', label: 'Equipo', options: (wsMembers || []).map(u => ({ id: u.id, label: u.name, color: u.color })) }] : []),
            { key: 'client', label: 'Cliente', options: [...new Map((state.projects || []).filter(p => p.client).map(p => { const cl = (state.clients || []).find(c => c.name === p.client); return [p.client, { id: p.client, label: p.client, color: cl?.color || '#9A9AA3' }]; })).values()] },
            { key: 'tags', label: 'Tags', options: tagOptions },

            { key: 'deadline', label: 'Fecha de entrega', options: deadlineOptions },
            { key: 'progress', label: 'Progreso', options: progressOptions },
            { key: 'attributes', label: 'Características', options: attributeOptions },
          ]}
        />

        <div className="flex-1"></div>

        <NotificationPanel
          notifications={notifications}
          team={state.team}
          onMarkRead={onMarkRead}
          onMarkAllRead={onMarkAllRead}
          onOpenProject={onOpenProject}
          onApproveUser={onApproveUser}
          onRejectUser={onRejectUser}
        />

        <button
          onClick={() => dispatch({ type: 'show_new' })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-semibold transition hover:brightness-110"
          style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
        >
          <Icon name="plus" size={13} strokeWidth={2.4} />
          Nueva tarea
        </button>
      </div>

      {/* Filter chips row */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 px-5 py-2 border-t border-app flex-wrap">
          <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)]">Filtros activos</span>
          {activeFilters.map((f, i) => (
            <button
              key={i}
              onClick={() => dispatch({ type: 'clear_filter', key: f.key, value: f.value })}
              className="group flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium hover:brightness-125 transition"
              style={{ background: colorAlpha(f.color, 13), color: f.color }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: f.color }}></span>
              {f.label}
              <Icon name="x" size={10} className="opacity-60 group-hover:opacity-100" />
            </button>
          ))}
          <button
            onClick={() => dispatch({ type: 'clear_all_filters' })}
            className="text-[11px] text-[var(--text-muted)] hover:text-white px-1"
          >
            Limpiar todo
          </button>
          <span className="ml-auto text-[10px] text-[var(--text-muted)] font-mono">{filteredCount} resultado{filteredCount !== 1 ? 's' : ''}</span>
        </div>
      )}
    </header>
  );
};

const FilterDropdown = ({ label, icon, filterKey, options, state, dispatch }) => {
  const active = state.filters[filterKey];
  const isActive = active.length > 0;
  return (
    <Dropdown
      width={220}
      trigger={
        <button className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors border ${isActive ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/40' : 'text-[var(--text-dim)] hover:text-white border-transparent hover:bg-[var(--surface-2)]'}`}>
          <Icon name={icon} size={12} />
          <span>{label}</span>
          {isActive && (
            <span className="text-[10px] font-mono px-1 rounded" style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>
              {active.length}
            </span>
          )}
        </button>
      }
    >
      <div className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] px-2 py-1.5">Filtrar por {label.toLowerCase()}</div>
      {options.map(o => {
        const id = o.id;
        const isOn = active.includes(id);
        const color = resolveThemeColor(o.color);
        return (
          <MenuItem key={id} onClick={() => dispatch({ type: 'toggle_filter', key: filterKey, value: id })} active={isOn}>
            <span className={`check ${isOn ? 'on' : ''}`}>
              {isOn && <Icon name="check" size={10} strokeWidth={3} />}
            </span>
            <span className="w-2 h-2 rounded-full" style={{ background: color }}></span>
            <span className="text-[12px]">{o.label}</span>
          </MenuItem>
        );
      })}
    </Dropdown>
  );
};

const MoreFiltersDropdown = ({ state, dispatch, groups }) => {
  const activeCount = groups.reduce((total, group) => total + (state.filters[group.key] || []).length, 0);
  return (
    <Dropdown
      width={310}
      align="right"
      trigger={
        <button className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors border ${activeCount ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/40' : 'text-[var(--text-dim)] hover:text-white border-transparent hover:bg-[var(--surface-2)]'}`}>
          <Icon name="filter" size={12} />
          <span>Más filtros</span>
          {activeCount > 0 && (
            <span className="text-[10px] font-mono px-1 rounded" style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>{activeCount}</span>
          )}
        </button>
      }
    >
      <div className="max-h-[65vh] overflow-y-auto px-1 pb-1">
        {groups.map(group => (
          <div key={group.key} className="py-1.5 border-b border-app last:border-b-0">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[10px] tracking-[0.16em] uppercase text-[var(--text-muted)]">{group.label}</span>
              {(state.filters[group.key] || []).length > 0 && (
                <button onClick={() => dispatch({ type: 'reset_filter', key: group.key })} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]">Limpiar</button>
              )}
            </div>
            {group.options.length > 0 ? group.options.map(option => {
              const isOn = (state.filters[group.key] || []).includes(option.id);
              return (
                <MenuItem key={option.id} onClick={() => dispatch({ type: 'toggle_filter', key: group.key, value: option.id })} active={isOn}>
                  <span className={`check ${isOn ? 'on' : ''}`}>{isOn && <Icon name="check" size={10} strokeWidth={3} />}</span>
                  {option.color && <span className="w-2 h-2 rounded-full" style={{ background: resolveThemeColor(option.color) }} />}
                  <span className="text-[12px]">{option.label}</span>
                </MenuItem>
              );
            }) : <div className="px-2 py-1.5 text-[11px] text-[var(--text-muted)]">No hay opciones todavía</div>}
          </div>
        ))}
      </div>
    </Dropdown>
  );
};

// ── Filtering ───────────────────────────────────────────────────
const dateFilterMatches = (iso, values, kind, closed = false) => {
  if (!values.length) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = localISO(today);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const monthStart = `${todayISO.slice(0, 7)}-01`;
  const monthEnd = localISO(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const nextSeven = new Date(today);
  nextSeven.setDate(today.getDate() + 7);

  return values.some(value => {
    if (value === 'no_date') return !iso;
    if (!iso) return false;
    if (value === 'today') return iso === todayISO;
    if (value === 'this_week') return iso >= localISO(weekStart) && iso <= localISO(weekEnd);
    if (value === 'this_month') return iso >= monthStart && iso <= monthEnd;
    if (kind === 'deadline' && value === 'overdue') return !closed && iso < todayISO;
    if (kind === 'deadline' && value === 'next_7_days') return iso >= todayISO && iso <= localISO(nextSeven);
    return false;
  });
};

const progressFilterMatches = (project, values) => {
  if (!values.length) return true;
  const checklist = project.checklist || [];
  const done = checklist.filter(item => item.done).length;
  return values.some(value => (
    (value === 'no_checklist' && checklist.length === 0) ||
    (value === 'not_started' && checklist.length > 0 && done === 0) ||
    (value === 'in_progress' && done > 0 && done < checklist.length) ||
    (value === 'complete' && checklist.length > 0 && done === checklist.length)
  ));
};

const attributeFilterMatches = (project, values) => {
  if (!values.length) return true;
  return values.some(value => (
    (value === 'favorite' && project.favorite) ||
    (value === 'unassigned' && !(project.assignees || []).length) ||
    (value === 'assigned' && (project.assignees || []).length > 0) ||
    (value === 'has_deliverables' && (project.deliverables || []).length > 0) ||
    (value === 'no_deliverables' && !(project.deliverables || []).length)
  ));
};

const applyFilters = (state) => {
  const q = state.search.trim().toLowerCase();
  return state.projects.filter(p => {
    // ── Sidebar filter ──
    if (state.sidebarFilter === 'favorites' && !p.favorite) return false;
    if (state.sidebarFilter === 'mine' && !p.assignees.includes(state.currentUserId)) return false;
    if (state.sidebarFilter === 'urgent' && !needsAttention(p)) return false;
    if (state.sidebarFilter === 'delivered' && !isCompletionStatus(p.status)) return false;
    if (state.sidebarFilter === 'archived'  && p.status !== 'archived')  return false;
    // En vista 'all' ocultar archivados salvo que se filtren explícitamente por estado
    if (state.sidebarFilter === 'all' && p.status === 'archived' && !state.filters.status.includes('archived')) return false;
    // ── Búsqueda ──
    const searchable = [p.title, p.client, ...(p.tags || []), JSON.stringify(p.description || []), JSON.stringify(p.checklist || []), JSON.stringify(p.deliverables || [])]
      .join(' ').toLowerCase();
    if (q && !searchable.includes(q)) return false;
    // ── Filtros de cabecera ──
    if (state.filters.status.length   && !state.filters.status.includes(p.status))                              return false;
    if (state.filters.type.length     && !state.filters.type.includes(p.type))                                  return false;
    if (state.filters.priority.length && !state.filters.priority.includes(p.priority))                          return false;
    if (state.filters.assignee.length && !p.assignees.some(a => state.filters.assignee.includes(a)))            return false;
    if (state.filters.client.length   && !state.filters.client.includes(p.client))                              return false;
    if (state.filters.tags.length     && !state.filters.tags.some(tag => (p.tags || []).includes(tag)))          return false;
    const closed = isClosed(p);

    // Dentro del campo se mantiene la lógica O: una entregada no coincide con
    // "Vencidas", pero sí con "Este mes" cuando ambos están seleccionados.
    if (!dateFilterMatches(p.deadline, state.filters.deadline, 'deadline', closed))                              return false;
    if (!progressFilterMatches(p, state.filters.progress))                                                       return false;
    if (!attributeFilterMatches(p, state.filters.attributes))                                                   return false;
    return true;
  });
};

// ── Stats bar (kanban) ──────────────────────────────────────────
const StatusStatsBar = ({ projects, columns = [] }) => {
  const statuses = columns.length ? columns : STATUSES.filter(s => s.id !== 'archived');
  return (
    <div className="flex items-center gap-1 px-5 py-2 border-b border-app overflow-x-auto" style={{ background: 'var(--surface)' }}>
      {statuses.map(s => {
        const n = projects.filter(p => p.status === s.id).length;
        return (
          <div key={s.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: colorAlpha(resolveThemeColor(s.color), 8) }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: resolveThemeColor(s.color) }}></span>
            <span className="text-[11px]" style={{ color: resolveThemeColor(s.color) }}>{s.label}</span>
            <span className="text-[11px] font-mono font-semibold" style={{ color: resolveThemeColor(s.color) }}>{n}</span>
          </div>
        );
      })}
    </div>
  );
};

// ── New project quick form ──────────────────────────────────────
const NewProjectModal = ({ onCreate, onClose, clients = [], onCreateClient, customTypes = [], columns = [] }) => {
  const availableTypes = customTypes.length ? customTypes : PROJECT_TYPES;
  const initialStatus = columns[0]?.id || 'briefing';
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [type, setType] = useState(availableTypes[0]?.id || 'other');
  const [priority, setPriority] = useState('medium');
  const [deadline, setDeadline] = useState('');

  const submit = () => {
    if (!title.trim() || !client.trim()) return;
    const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 5);
    onCreate({
      id,
      title: title.trim(),
      client: client.trim(),
      type,
      status: initialStatus,
      priority,
      assignees: [],
      startDate: localISO(new Date(TODAY)),
      deadline,
      sessionDate: deadline || localISO(new Date()),
      budget: 0,
      currency: 'USD',
      tags: [],
      cover: { type: 'color', value: '#1a1a1f' },
      description: [{ type: 'p', text: 'Briefing inicial — añadí el contexto de la tarea acá.' }],
      checklist: [],
      deliverables: [],
      timeline: [],
      comments: [],
    });
  };

  return (
    <div className="fixed inset-0 z-50 backdrop flex items-center justify-center p-6 anim-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-lg surf-panel anim-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-app">
          <div>
            <div className="font-display text-lg font-semibold" style={{ letterSpacing: '-0.01em' }}>Nueva tarea</div>
            <div className="text-[11px] text-[var(--text-muted)]">Creá una tarea en blanco — completá los detalles después</div>
          </div>
          <button aria-label="Cerrar" onClick={onClose} className="p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-dim)]">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Título de la tarea</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Campaña verano 2026 — Marca X"
              className="w-full px-3 py-2.5 rounded-md text-[15px] surface-2 border border-app focus:border-[var(--accent)]/60"
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Cliente</label>
            <ClientAutocomplete
              value={client}
              onChange={setClient}
              clients={clients}
              onCreateClient={onCreateClient}
              fieldMode={true}
              placeholder="Ej: Volcán Activewear"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Tipo</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2.5 rounded-md text-[13px] surface-2 border border-app appearance-none cursor-pointer"
                style={{ colorScheme: 'var(--color-scheme)' }}
              >
                {availableTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Prioridad</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full px-3 py-2.5 rounded-md text-[13px] surface-2 border border-app appearance-none cursor-pointer"
                style={{ colorScheme: 'var(--color-scheme)' }}
              >
                {PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-1.5">Fecha de entrega</label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-3 py-2.5 rounded-md text-[13px] surface-2 border border-app cursor-pointer"
              style={{ colorScheme: 'var(--color-scheme)' }}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-app">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[13px] hover:bg-[var(--surface-2)] text-[var(--text-dim)]">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || !client.trim()}
            className="px-3 py-1.5 rounded-md text-[13px] font-semibold disabled:opacity-40 transition"
            style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
          >
            Crear tarea
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Pantalla: esperando aprobación ──────────────────────────────
const PendingApprovalScreen = ({ member, onSignOut }) => (
  <div className="h-screen flex flex-col items-center justify-center gap-6 px-6" style={{ background: 'var(--bg)', position: 'relative', zIndex: 1 }}>
    <FrameMark size={44} />
    <div className="flex gap-1.5">
      {[0, 1, 2].map(i => (
        <div key={i} className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--text-muted)', animationDelay: `${i * 200}ms` }}></div>
      ))}
    </div>
    <div className="text-center max-w-sm">
      <h2 className="font-display text-[22px] font-bold mb-2" style={{ letterSpacing: '-0.02em' }}>Esperando aprobación</h2>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Tu solicitud fue recibida. Un miembro del estudio revisará tu acceso y te dará ingreso en breve.
      </p>
    </div>
    {member && (
      <div className="surf-panel px-5 py-3 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-[13px] flex-shrink-0"
          style={{ background: colorAlpha(member.color, 10), color: member.color, border: `1.5px solid ${colorAlpha(member.color, 27)}` }}
        >
          {member.avatar
            ? <img src={member.avatar} alt={member.initials} className="w-9 h-9 rounded-full object-cover" />
            : member.initials}
        </div>
        <div>
          <div className="text-[13px] font-semibold">{member.name}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{member.email}</div>
        </div>
        <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--warn-soft-2)', color: 'var(--warn)' }}>
          Pendiente
        </span>
      </div>
    )}
    <button onClick={onSignOut} className="flex items-center gap-1.5 text-[12px] transition-colors hover:text-white" style={{ color: 'var(--text-muted)' }}>
      <Icon name="logOut" size={13} />
      Cerrar sesión
    </button>
  </div>
);

// ── Pantalla: acceso denegado ────────────────────────────────────
const RejectedScreen = ({ member, onSignOut }) => (
  <div className="h-screen flex flex-col items-center justify-center gap-6 px-6" style={{ background: 'var(--bg)', position: 'relative', zIndex: 1 }}>
    <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'var(--danger-soft)', border: '1.5px solid var(--danger-soft-2)' }}>
      <Icon name="x" size={24} style={{ color: 'var(--danger)' }} />
    </div>
    <div className="text-center max-w-sm">
      <h2 className="font-display text-[22px] font-bold mb-2" style={{ letterSpacing: '-0.02em', color: 'var(--danger)' }}>Acceso denegado</h2>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Tu solicitud fue rechazada. Contactá al administrador del estudio para más información.
      </p>
    </div>
    {member && (
      <div className="rounded-xl border px-5 py-3 flex items-center gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--danger-soft-2)' }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-[13px] flex-shrink-0"
          style={{ background: colorAlpha(member.color, 10), color: member.color, border: `1.5px solid ${colorAlpha(member.color, 27)}` }}>
          {member.initials}
        </div>
        <div>
          <div className="text-[13px] font-semibold">{member.name}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{member.email}</div>
        </div>
      </div>
    )}
    <button onClick={onSignOut}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors hover:text-white"
      style={{ background: 'var(--surface)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
      <Icon name="logOut" size={13} />
      Cerrar sesión
    </button>
  </div>
);

// ── Loading screen ───────────────────────────────────────────────
// LOOPA (un solo sistema): carga dentro del área de contenido, sin marca propia.
const LoadingScreen = () => (
  <div className="h-full flex items-center justify-center flex-col gap-4" style={{ background: 'var(--bg)', minHeight: 240 }}>
    <div className="text-[12px] text-[var(--text-muted)] tracking-[0.18em] uppercase">Cargando producción…</div>
    <div className="flex gap-1.5">
      {[0,1,2].map(i => (
        <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent)', animationDelay: `${i * 200}ms`, opacity: 0.6 }}></div>
      ))}
    </div>
  </div>
);

// ── Settings section ────────────────────────────────────────────
const PREVIEW_FIELD_LABELS = [
  { key: 'tipo',         label: 'Tipo',          icon: 'film'     },
  { key: 'cliente',      label: 'Cliente',        icon: 'briefcase'},
  { key: 'estado',       label: 'Estado',         icon: 'dot'      },
  { key: 'prioridad',    label: 'Prioridad',      icon: 'flag'     },
  { key: 'responsables', label: 'Responsables',   icon: 'users'    },
  { key: 'deadline',     label: 'Fecha de entrega',   icon: 'calendar' },
  { key: 'presupuesto',  label: 'Presupuesto',    icon: 'zap'      },
  { key: 'tags',         label: 'Tags',           icon: 'hash'     },
  { key: 'progreso',     label: 'Progreso',       icon: 'layers'   },
];

const SettingsSection = ({ previewFields, onToggle, carryOverProjects, onToggleCarryOverProjects, pendingUsers = [], onApproveUser, onRejectUser, workspaceId }) => {
  const [carryOver, setCarryOver] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(window.setFrameTheme ? window.setFrameTheme(next) : next);
  };

  useEffect(() => {
    if (!workspaceId) return;
    setCarryOver(false);
    const ref = window.db.collection('frame_workspaces').doc(workspaceId).collection('config').doc('daily_routine');
    const unsub = ref.onSnapshot(snap => {
      setCarryOver(snap.exists ? (snap.data()?.config?.carryOver || false) : false);
    }, (err) => {
      console.error('[FRAME] CarryOver load:', err);
      window.frameToast?.('No se pudo cargar la configuración de arrastre de esta rutina.');
    });
    return () => unsub();
  }, [workspaceId]);

  const toggleCarryOver = () => {
    const next = !carryOver;
    setCarryOver(next);
    const patch = { config: { carryOver: next } };
    if (!next) patch.today = { debt: {} };
    window.db.collection('frame_workspaces').doc(workspaceId).collection('config').doc('daily_routine')
      .set(patch, { merge: true })
      .catch(err => {
        setCarryOver(!next);
        notifyWriteError(err, 'el arrastre de la rutina');
      });
  };

  const ToggleRow = ({ active, onClick, icon, label, description }) => (
    <button
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition text-left w-full"
      style={{
        background:  active ? 'var(--accent-soft)'    : 'var(--surface-2)',
        borderColor: active ? 'var(--accent-border)' : 'var(--border)',
      }}
    >
      <div
        className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition"
        style={{
          background: active ? 'var(--accent)'    : 'var(--surface-3)',
          border:     active ? 'none'              : '1.5px solid var(--border-2)',
        }}
      >
        {active && <Icon name="check" size={10} strokeWidth={3} style={{ color: 'var(--accent-on)' }} />}
      </div>
      <Icon name={icon} size={13} style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium" style={{ color: active ? 'var(--text)' : 'var(--text-dim)' }}>
          {label}
        </div>
        {description && (
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</div>
        )}
      </div>
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1" style={{ letterSpacing: '-0.02em' }}>Tablero y aprobaciones</h1>
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Lo que se ve en las tarjetas, el arrastre de tareas y quién entra al equipo</p>
        </div>

        {/* LOOPA tiene un solo tema (oscuro): el selector de apariencia no pasó. */}

        {/* Solicitudes de acceso — permiso de PLATAFORMA, no de tablero.
            Vivían en la sección Equipo, lo que obligaba a mostrarla incluso en
            un tablero personal donde no hay equipo que ver. */}
        {pendingUsers.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-[13px] font-semibold">Solicitudes de acceso</h2>
              <span className="text-[10px] tnum px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--warn-soft-2)', color: 'var(--warn)' }}>
                {pendingUsers.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {pendingUsers.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                     style={{ background: 'var(--surface-2)', boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.06)' }}>
                  <Avatar user={u} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold truncate">{u.name || 'Sin nombre'}</div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{u.email} · {u.role}</div>
                  </div>
                  <button onClick={() => onApproveUser(u.id)}
                    className="px-3 py-1.5 rounded-md text-[12px] font-semibold hover:brightness-110 transition"
                    style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>Aprobar</button>
                  <button onClick={() => onRejectUser(u.id)}
                    className="px-3 py-1.5 rounded-md text-[12px] font-medium"
                    style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}>Rechazar</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Campos visibles */}
        <div className="surf-panel p-5">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="layers" size={15} style={{ color: 'var(--accent)' }} />
            <h2 className="font-display font-semibold text-[17px]">Campos visibles</h2>
          </div>
          <div className="grid grid-cols-1 gap-1 mt-4">
            {PREVIEW_FIELD_LABELS.map(({ key, label, icon }) => (
              <ToggleRow
                key={key}
                active={previewFields[key]}
                onClick={() => onToggle(key)}
                icon={icon}
                label={label}
              />
            ))}
          </div>
        </div>

        {/* Rutina diaria */}
        <div className="surf-panel p-5">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="sun" size={15} style={{ color: 'var(--accent)' }} />
            <h2 className="font-display font-semibold text-[17px]">Rutina diaria</h2>
          </div>
          <div className="mt-3"><ToggleRow
            active={carryOver}
            onClick={toggleCarryOver}
            icon="alert"
            label="Mantener pendientes de rutina para mañana"
          /></div>
        </div>

        {/* Proyectos */}
        <div className="surf-panel p-5">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="layers" size={15} style={{ color: 'var(--accent)' }} />
            <h2 className="font-display font-semibold text-[17px]">Tareas</h2>
          </div>
          <div className="mt-3"><ToggleRow
            active={carryOverProjects}
            onClick={onToggleCarryOverProjects}
            icon="alert"
            label="Arrastrar tareas incompletas al siguiente día"
            description="La fecha límite se conserva."
          /></div>
        </div>

      </div>
    </div>
  );
};

// ── Producción de LOOPA (antes FRAME): un solo sistema ───────────
// Lo maneja el menú de LOOPA: `seccion` (projects | clients | team |
// analytics | settings | trash) y `filtro` (all | favorites | mine | urgent
// | delivered). El selector de tablero se dibuja en la barra de LOOPA
// (`barra`, un nodo del DOM). No tiene pantalla de ingreso ni menú propio.
// `comercial` (sólo para quien vende): ventas, saldo y acciones de LOOPA por
// ficha, para la pantalla única de Clientes.
const App = ({ seccion = 'projects', filtro = 'all', barra = null, comercial = null } = {}) => {
  const [state, dispatch]         = useReducer(reducer, initialState);
  const [authUser, setAuthUser]   = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const filtered    = useMemo(() => applyFilters(state), [state]);
  const openProject = state.openProjectId ? state.projects.find(p => p.id === state.openProjectId) : null;

  // El menú de LOOPA elige qué se ve.
  useEffect(() => {
    if (seccion === 'projects' || seccion === 'trash') dispatch({ type: 'set_sidebar_filter', filter: seccion === 'trash' ? 'trash' : filtro });
    else dispatch({ type: 'set_section', section: seccion });
  }, [seccion, filtro]);

  // ── Persistir navegación en localStorage ───────────────────
  useEffect(() => {
    try {
      localStorage.setItem('frame_nav', JSON.stringify({
        section:       state.section,
        sidebarFilter: state.sidebarFilter,
        view:          state.view,
      }));
    } catch {}
  }, [state.section, state.sidebarFilter, state.view]);

  // ── Firestore sync ──────────────────────────────────────────
  // IMPORTANTE: todas las suscripciones esperan a que haya sesión.
  // Un onSnapshot que arranca sin auth falla con permission-denied y el
  // listener queda muerto para siempre (no se reconecta al loguearse).
  // ── Tableros del usuario ────────────────────────────────────
  // array-contains sobre memberIds: Firestore devuelve sólo los tableros
  // donde el uid figura, así que el aislamiento no depende de filtrar en el
  // cliente. Las reglas lo respaldan por si alguien consulta a mano.
  useEffect(() => {
    if (!authUser) return;
    const unsub = window.db.collection('frame_workspaces')
      .where('memberIds', 'array-contains', authUser.uid)
      .onSnapshot({ includeMetadataChanges: true }, (snap) => {
        const workspaces = snap.docs.map(d => ({
          ...d.data(),
          id: d.id,
          _hasPendingWrites: d.metadata.hasPendingWrites,
        }));
        dispatch({ type: 'set_workspaces', workspaces });
      }, (err) => {
        console.error('[FRAME] Workspaces:', err);
        dispatch({ type: 'set_workspaces', workspaces: [], error: true });
      });
    return () => unsub();
  }, [authUser?.uid]);

  // Recordar el tablero abierto entre sesiones
  useEffect(() => {
    if (state.activeWorkspaceId) localStorage.setItem('frame_workspace', state.activeWorkspaceId);
  }, [state.activeWorkspaceId]);

  // ── Alta del tablero personal ───────────────────────────────
  // Un usuario aprobado sin ningún tablero no vería absolutamente nada, así
  // que al entrar por primera vez se le crea el suyo. Se hace acá y no al
  // aprobarlo porque el admin no puede escribir tableros ajenos: las reglas
  // sólo dejan crear un tablero donde uno mismo es el dueño y único miembro.
  const creatingWsRef = useRef(false);
  // El aviso de "no se pudieron cargar las tareas compartidas" se muestra una
  // sola vez por sesión y sólo ante un fallo real de conexión: un
  // permission-denied es lo esperado mientras las reglas por viewerIds no estén
  // publicadas, y el tablero ya carga por workspaceId, así que no se alarma.
  const sharedWarnRef = useRef(false);
  useEffect(() => {
    if (!authUser || state.workspacesLoading) return;
    if (state.workspaces.length > 0) return;
    if (creatingWsRef.current) return;           // evita duplicar si el efecto se re-dispara

    // Sólo si la consulta REALMENTE devolvió vacío. Si falló —como pasaba
    // cuando las reglas estaban mal— el error handler también dejaba la lista
    // en cero, y esto lo leía como "no tiene ningún tablero" y creaba uno.
    // Cada recarga durante ese rato generaba otro duplicado.
    if (state.workspacesError) return;

    // Sólo si ya está aprobado; si sigue pendiente ve la pantalla de espera.
    const me = state.team.find(m => m.id === authUser.uid);
    if (!me || me.status !== 'active') return;

    creatingWsRef.current = true;
    const id = 'ws' + Date.now() + Math.random().toString(36).slice(2, 5);
    window.db.collection('frame_workspaces').doc(id).set({
      id,
      name:      'Mi tablero',
      kind:      'personal',
      ownerId:   authUser.uid,
      memberIds: [authUser.uid],
      roles:     { [authUser.uid]: 'owner' },
      members:   { [authUser.uid]: memberCard(me) },
      createdAt: new Date().toISOString(),
    }).catch(err => {
      creatingWsRef.current = false;
      console.error('[FRAME] Alta de tablero personal:', err);
    });
  }, [authUser?.uid, state.workspacesLoading, state.workspaces.length, state.team.length]);

  const wsId = state.activeWorkspaceId;

  // ── Miembros del tablero activo ─────────────────────────────
  // state.team es la lista de PLATAFORMA: para el admin son todos los
  // registrados de todos los tableros, y para el resto es sólo él mismo.
  // Usarla como "equipo" mostraba cosas distintas según quién mirara, y
  // dejaba asignar proyectos a gente que ni estaba en el tablero.
  // Lo que se ve y se asigna sale de acá: los miembros del tablero abierto.
  const activeWs = state.workspaces.find(w => w.id === wsId) || null;
  const activeWsReady = !!activeWs && !activeWs._hasPendingWrites;
  // El tablero personal es la bandeja del usuario: junta las tarjetas de
  // todos sus tableros. Las tarjetas no se copian ni cambian de dueño; cada
  // una sigue viviendo en el suyo y se edita ahí.
  const inbox = activeWs?.kind === 'personal';
  const myBoardIds = state.workspaces.map(w => w.id).filter(Boolean);
  const myBoardKey = myBoardIds.join('|');
  const wsMembers = useMemo(() => workspaceMembers(activeWs), [activeWs]);

  // getUser() y AvatarStack lo leen para resolver los avatares de los
  // responsables de cada proyecto.
  useEffect(() => { window.__liveTeam = wsMembers; }, [wsMembers]);

  const iAmAdmin = !!state.team.find(m => m.id === state.currentUserId)?.platformAdmin;

  // ── Mantener al día mi copia dentro del tablero ─────────────
  // El tablero guarda una copia de los datos de presentación de cada miembro
  // (ver memberCard). Toda copia se desactualiza: si alguien cambia su nombre
  // o su avatar, el tablero seguiría mostrando los viejos. Y los tableros
  // creados antes de que existiera ese campo directamente no lo tienen, con
  // lo cual el miembro aparece como "?" sin nombre.
  //
  // Cada quien reescribe SU propia tarjeta cuando detecta que quedó distinta.
  // Sólo la propia: las reglas no dejan tocar la de otro, y además nadie
  // conoce el perfil ajeno para poder actualizarlo.
  // Un intento por tablero y versión de la ficha: si las reglas lo rechazan,
  // no se reintenta en cada render.
  const fichaIntentada = useRef({});
  useEffect(() => {
    if (!authUser || !activeWs) return;
    const me = state.team.find(m => m.id === authUser.uid);
    if (!me) return;

    const mine    = (activeWs.members || {})[authUser.uid];
    const fresh   = memberCard(me);
    const changed = !mine || ['name', 'initials', 'color', 'avatar', 'role', 'email']
      .some(k => mine[k] !== fresh[k]);
    if (!changed) return;
    const clave = `${activeWs.id}|${JSON.stringify(fresh)}`;
    if (fichaIntentada.current[clave]) return;
    fichaIntentada.current[clave] = true;

    window.db.collection('frame_workspaces').doc(activeWs.id)
      .update({ [`members.${authUser.uid}`]: fresh })
      .catch(err => console.error('[Producción] Sincronizar mi ficha del tablero:', err));
  }, [authUser?.uid, activeWs?.id, activeWs?.members, state.team]);

  // ── Invitaciones dirigidas a mí ─────────────────────────────
  // Se filtran por email porque al invitar sólo se conoce el email, no el
  // uid: la persona puede ni siquiera tener cuenta todavía.
  const [myInvites, setMyInvites] = useState([]);
  useEffect(() => {
    const email = (authUser?.email || '').toLowerCase();
    if (!email) { setMyInvites([]); return; }
    const unsub = window.db.collection('frame_invites')
      .where('email', '==', email)
      .onSnapshot(
        (snap) => setMyInvites(snap.docs.map(d => ({ ...d.data(), id: d.id }))),
        (err) => { console.error('[FRAME] Invitaciones:', err); setMyInvites([]); }
      );
    return () => unsub();
  }, [authUser?.email]);

  const inviteId = (workspaceId, email) => `${workspaceId}__${email.trim().toLowerCase()}`;

  // ── Invitar a un tablero de equipo ──────────────────────────
  const handleInvite = (email) => {
    const clean = (email || '').trim().toLowerCase();
    if (!clean || !activeWs || activeWs.kind !== 'team') return;
    if ((activeWs.memberIds || []).length >= 6) return;

    const id = inviteId(activeWs.id, clean);
    return window.db.collection('frame_invites').doc(id).set({
      id,
      email:         clean,
      workspaceId:   activeWs.id,
      // Copiado a propósito: el invitado no puede leer el tablero todavía.
      workspaceName: activeWs.name,
      invitedBy:     authUser.uid,
      invitedByName: state.team.find(m => m.id === authUser.uid)?.name || '',
      createdAt:     new Date().toISOString(),
    }).catch(err => { console.error('[FRAME] Invitar:', err); throw err; });
  };

  // ── Aceptar una invitación ──────────────────────────────────
  // Se escribe sin leer el tablero primero: no se puede, todavía no es
  // miembro. arrayUnion y la ruta con punto permiten actualizar a ciegas.
  const handleAcceptInvite = async (invite) => {
    if (!authUser) return;
    const me = state.team.find(m => m.id === authUser.uid);
    try {
      await window.db.collection('frame_workspaces').doc(invite.workspaceId).update({
        memberIds: firebase.firestore.FieldValue.arrayUnion(authUser.uid),
        [`members.${authUser.uid}`]: memberCard(me),
        [`roles.${authUser.uid}`]:   'member',
      });
      // La invitación se borra recién después de entrar: si se borrara antes
      // y la escritura fallara, quedaría afuera y sin forma de reintentar.
      await window.db.collection('frame_invites').doc(invite.id).delete();
      dispatch({ type: 'set_active_workspace', id: invite.workspaceId });
    } catch (err) {
      console.error('[FRAME] Aceptar invitación:', err);
    }
  };

  const handleDeclineInvite = (invite) =>
    window.db.collection('frame_invites').doc(invite.id).delete()
      .catch(err => console.error('[FRAME] Rechazar invitación:', err));

  // ── Cambiar nombre sin alterar tareas ni miembros ────────────
  const handleRenameWorkspace = async (workspaceId, proposedName) => {
    const workspace = state.workspaces.find(w => w.id === workspaceId);
    if (!authUser || !workspace || workspace.ownerId !== authUser.uid || !(workspace.memberIds || []).includes(authUser.uid)) {
      throw new Error('Solo el propietario puede cambiar el nombre.');
    }
    const name = String(proposedName || '').trim();
    if (!name || name.length > 80) throw new Error('Usá un nombre de 1 a 80 caracteres.');
    if (name === workspace.name) return;
    if (navigator.onLine === false) throw new Error('Sin conexión. Intentá guardar cuando vuelvas a conectarte.');
    try {
      await window.db.collection('frame_workspaces').doc(workspaceId).update({ name });
    } catch (err) {
      console.error('[FRAME] Cambiar nombre del tablero:', err);
      throw new Error('No se pudo cambiar el nombre. Intentá de nuevo.');
    }
  };

  // No borra las tareas ni los clientes que tuviera el tablero.
  const handleDeleteWorkspace = (ws) => {
    if (!ws || state.workspaces.length <= 1) return;
    if (state.activeWorkspaceId === ws.id) {
      const next = state.workspaces.find(w => w.id !== ws.id);
      if (next) dispatch({ type: 'set_active_workspace', id: next.id });
    }
    window.db.collection('frame_workspaces').doc(ws.id).delete()
      .catch(err => notifyWriteError(err, 'la eliminacion del tablero'));
  };

  // Invitaciones enviadas desde el tablero abierto, para que el dueño vea a
  // quién le falta responder y pueda cancelar.
  const [sentInvites, setSentInvites] = useState([]);
  useEffect(() => {
    if (!wsId || activeWs?.kind !== 'team') { setSentInvites([]); return; }
    const unsub = window.db.collection('frame_invites')
      .where('workspaceId', '==', wsId)
      .onSnapshot(
        (snap) => setSentInvites(snap.docs.map(d => ({ ...d.data(), id: d.id }))),
        (err) => { console.error('[FRAME] Invitaciones enviadas:', err); setSentInvites([]); }
      );
    return () => unsub();
  }, [wsId, activeWs?.kind]);

  useEffect(() => {
    if (!authUser || !wsId) return;
    const legacy = new Map();
    const shared = new Map();
    let legacyReady = false;
    let sharedReady = false;

    const publish = () => {
      if (!legacyReady && !sharedReady) return;
      const merged = new Map(legacy);
      shared.forEach((project, id) => {
        if (inbox || (project.workspaceIds || []).includes(wsId)) merged.set(id, project);
      });
      dispatch({ type: 'set_projects', projects: [...merged.values()] });
    };

    // Documentos anteriores: siguen entrando por workspaceId y no se migran
    // hasta que el usuario elige compartirlos con otro tablero. En la bandeja
    // se piden los de todos los tableros propios, porque esos documentos no
    // tienen viewerIds y no entran por la consulta compartida.
    const legacyIds = inbox ? myBoardIds.slice(0, 10) : [wsId];
    const legacyQuery = legacyIds.length > 1
      ? window.db.collection('frame_projects').where('workspaceId', 'in', legacyIds)
      : window.db.collection('frame_projects').where('workspaceId', '==', legacyIds[0] || wsId);
    const unsubLegacy = legacyQuery
      .onSnapshot((snap) => {
        legacy.clear();
        snap.docs.forEach(d => legacy.set(d.id, normalizeProject({ ...d.data(), id: d.id })));
        legacyReady = true;
        publish();
      }, (err) => {
        console.error('[FRAME] Tareas del tablero:', err);
        legacyReady = true;
        publish();
      });

    // Las tareas modernas se consultan por usuario autorizado y se filtran
    // localmente por el tablero activo. Una sola tarea puede aparecer en
    // varios tableros sin crear copias divergentes.
    const unsubShared = window.db.collection('frame_projects')
      .where('viewerIds', 'array-contains', authUser.uid)
      .onSnapshot((snap) => {
        shared.clear();
        snap.docs.forEach(d => shared.set(d.id, normalizeProject({ ...d.data(), id: d.id })));
        sharedReady = true;
        publish();
      }, (err) => {
        console.error('[FRAME] Tareas compartidas:', err);
        // El tablero ya se pintó con las consultas por workspaceId; las
        // compartidas son un extra. Un permission-denied es lo normal mientras
        // las reglas nuevas (viewerIds) no estén publicadas: se degrada en
        // silencio, sin tocar lo que ya se ve. Sólo un fallo de conexión real
        // merece aviso, y una vez.
        if (err?.code !== 'permission-denied' && !sharedWarnRef.current) {
          sharedWarnRef.current = true;
          window.frameToast?.('No se pudieron cargar las tareas compartidas. Revisá la conexión.');
        }
        sharedReady = true;
        publish();
      });

    return () => { unsubLegacy(); unsubShared(); };
  }, [authUser?.uid, wsId, inbox, myBoardKey]);

  // Quién es quién, para que una tarjeta de otro tablero pueda decir de dónde
  // viene sin que haya que arrastrar el dato por media docena de componentes.
  useEffect(() => {
    window.__frameBoards = {
      activeId: wsId,
      names: Object.fromEntries(state.workspaces.map(w => [w.id, w.name || 'Tablero'])),
    };
  }, [wsId, state.workspaces]);

  // Columnas de los otros tableros: sólo se leen para poder mostrar sus
  // tarjetas en la bandeja con el estado que de verdad tienen.
  const [foreignColumns, setForeignColumns] = useState({});
  useEffect(() => {
    if (!authUser || !inbox) { setForeignColumns({}); return; }
    const otros = myBoardIds.filter(id => id !== wsId);
    if (!otros.length) { setForeignColumns({}); return; }
    const unsubs = otros.map(id => window.db.collection('frame_workspaces').doc(id)
      .collection('config').doc('kanban_columns')
      .onSnapshot(
        snap => setForeignColumns(prev => ({ ...prev, [id]: snap.exists ? (snap.data().columns || []) : [] })),
        () => setForeignColumns(prev => ({ ...prev, [id]: [] }))
      ));
    return () => unsubs.forEach(unsub => unsub());
  }, [authUser?.uid, inbox, wsId, myBoardKey]);

  // El portal guarda una proyección deliberadamente pequeña. Se regenera
  // cuando cambian tareas o clientes, sin abrir nunca frame_projects al
  // visitante externo.
  useEffect(() => {
    if (!authUser || !activeWsReady) return;
    state.clients.filter(client => client.portalPublished && client.portalToken).forEach(client => {
      // Las tarjetas de otros tableros que trae la bandeja no salen al
      // portal: el cliente ve el tablero al que pertenece, nada más.
      const document = buildClientPortalDocument(client, boardProjects(state.projects, wsId, false), activeWs, true, state.kanbanColumns);
      window.db.collection('frame_client_portals').doc(client.portalToken).set(document)
        .catch(err => console.error('[FRAME] Sincronizar portal:', err));
    });
  }, [authUser?.uid, activeWsReady, activeWs?.name, activeWs?.members, state.clients, state.projects]);

  // Una referencia mínima en el tablero permite que un miembro recién
  // incorporado descubra las tareas compartidas y se agregue a su ACL. No se
  // copia contenido y la regla sólo permite añadir el uid propio.
  const sharedTaskSignature = state.workspaces
    .map(w => `${w.id}:${(w.sharedTaskIds || []).join(',')}`)
    .join('|');
  useEffect(() => {
    if (!authUser?.uid || state.workspacesLoading) return;
    const taskIds = [...new Set(state.workspaces.flatMap(w => w.sharedTaskIds || []))];
    taskIds.forEach(projectId => {
      window.db.collection('frame_projects').doc(projectId)
        .update({ viewerIds: firebase.firestore.FieldValue.arrayUnion(authUser.uid) })
        .catch(err => {
          // Una referencia obsoleta o una tarea eliminada no debe bloquear el
          // resto del tablero; se limpia cuando el dueño vuelva a guardar.
          if (err?.code !== 'permission-denied' && err?.code !== 'not-found') {
            console.error('[FRAME] Acceso a tarea compartida:', err);
          }
        });
    });
  }, [authUser?.uid, state.workspacesLoading, sharedTaskSignature]);

  // ── Firestore: equipo ───────────────────────────────────────
  useEffect(() => {
    if (!authUser) return;

    // Las reglas permiten leer el propio perfil, y la colección completa sólo
    // al admin de plataforma. Firestore evalúa las consultas de lista contra
    // la regla ENTERA: no filtra los documentos que sí podrías ver, rechaza
    // la consulta completa. Por eso una consulta a toda la colección le
    // fallaría a cualquiera que no sea admin y lo dejaría sin poder saber
    // siquiera su propio estado de aprobación.
    //
    // Se escucha siempre el documento propio, que es lo que decide el gate,
    // y la colección completa sólo si el perfil dice platformAdmin.
    const own = window.db.collection('frame_users').doc(authUser.uid);
    let unsubAll = null;

    const unsubOwn = own.onSnapshot((doc) => {
      const me = doc.exists ? normalizeMember({ ...doc.data(), id: doc.id }) : null;

      if (me?.platformAdmin && !unsubAll) {
        unsubAll = window.db.collection('frame_users').onSnapshot((snap) => {
          const team = snap.docs.map(d => normalizeMember({ ...d.data(), id: d.id }));
          dispatch({ type: 'set_team', team });
        }, (err) => console.error('[FRAME] Equipo (admin):', err));
      }

      // Sin ser admin, el "equipo" es por ahora uno mismo. Los compañeros de
      // tablero saldrán del propio documento del tablero, que ya guarda quién
      // lo integra — así no hace falta abrir la lectura de perfiles ajenos.
      if (!me?.platformAdmin) {
        const team = me ? [me] : [];
        dispatch({ type: 'set_team', team });
      }
    }, (err) => {
      console.error('Firestore team error:', err);
      dispatch({ type: 'set_team', team: [] });
    });

    return () => { unsubOwn(); if (unsubAll) unsubAll(); };
  }, [authUser?.uid]);

  // ── Firestore: clientes ─────────────────────────────────────
  useEffect(() => {
    if (!authUser || !wsId) return;
    const col = window.db.collection('frame_clients').where('workspaceId', '==', wsId);
    const unsub = col.onSnapshot((snap) => {
      const clients = snap.docs.map(doc => normalizeClient({ ...doc.data(), id: doc.id }));
      dispatch({ type: 'set_clients', clients });
    }, (err) => {
      console.error('Firestore clients error:', err);
      dispatch({ type: 'set_clients', clients: [] });
    });
    return () => unsub();
  }, [authUser?.uid, wsId]);

  // ── Firebase Auth: sesión ───────────────────────────────────
  useEffect(() => {
    const unsub = firebase.auth().onAuthStateChanged((user) => {
      setAuthUser(user);
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  // ── currentUserId = uid de la sesión ────────────────────────
  // El id del documento en frame_users ES el uid de Firebase Auth, así que
  // sale directo de la sesión. Antes se buscaba al miembro por email dentro
  // del equipo ya cargado, lo que ataba la identidad a que la lista hubiera
  // llegado y fallaba si el email difería en mayúsculas o espacios.
  useEffect(() => {
    const uid = authUser?.uid || null;
    if (uid !== state.currentUserId) dispatch({ type: 'set_user', id: uid });
  }, [authUser?.uid]);

  // ── Firestore: display settings (vista previa + carry-over) ───
  useEffect(() => {
    if (!authUser || !wsId) return;
    const ref = window.db.collection('frame_workspaces').doc(wsId).collection('config').doc('display_settings');
    const unsub = ref.onSnapshot((snap) => {
      if (!snap.exists) return;
      const data = snap.data();
      if (data.previewFields)               dispatch({ type: 'set_preview_fields',    fields: data.previewFields });
      if (data.carryOverProjects !== undefined) dispatch({ type: 'set_carryover_projects', value: data.carryOverProjects });
      // Sincronizar vista fija desde Firestore (cross-device)
      if ('pinnedView' in data) {
        const pv = data.pinnedView || null;
        dispatch({ type: 'set_pinned_view', view: pv });
        if (pv) localStorage.setItem('frame_pinned_view', pv);
        else    localStorage.removeItem('frame_pinned_view');
      }
    }, (err) => console.error('Display settings error:', err));
    return () => unsub();
  }, [authUser?.uid, wsId]);

  const handleTogglePreviewField = (key) => {
    const next = { ...state.previewFields, [key]: !state.previewFields[key] };
    dispatch({ type: 'set_preview_fields', fields: next });
    window.db.collection('frame_workspaces').doc(wsId).collection('config').doc('display_settings')
      .set({ previewFields: next }, { merge: true })
      .catch(err => console.error('Error guardando display settings:', err));
  };

  const handlePinView = (view) => {
    const next = state.pinnedView === view ? null : view; // toggle: misma → quitar
    dispatch({ type: 'set_pinned_view', view: next });
    dispatch({ type: 'set_view',        view: next || view }); // ir a la vista al pinear
    if (next) localStorage.setItem('frame_pinned_view', next);
    else      localStorage.removeItem('frame_pinned_view');
    window.db.collection('frame_workspaces').doc(wsId).collection('config').doc('display_settings')
      .set({ pinnedView: next }, { merge: true })
      .catch(err => console.error('[FRAME] PinView:', err));
  };

  const handleToggleCarryOverProjects = () => {
    const next = !state.carryOverProjects;
    dispatch({ type: 'set_carryover_projects', value: next });
    window.db.collection('frame_workspaces').doc(wsId).collection('config').doc('display_settings')
      .set({ carryOverProjects: next }, { merge: true })
      .catch(err => console.error('[FRAME] CarryOver projects toggle:', err));
  };

  // ── Carry-over de proyectos con checklist pendiente ───────────
  useEffect(() => {
    if (!state.carryOverProjects || state.loading || state.projects.length === 0) return;

    const today = localISO(new Date());
    const storageKey = `frame_carryover_${wsId}_${today}`;
    if (localStorage.getItem(storageKey)) return; // Ya corrió hoy
    // "pending" evita ejecuciones paralelas, pero se borra si Firestore
    // falla para que la automatización pueda reintentarse ese mismo día.
    localStorage.setItem(storageKey, 'pending');

    const toUpdate = state.projects.filter(p => {
      // Solo con checklist parcial (tiene ítems y al menos uno sin completar)
      if (!p.checklist?.length || progressOf(p) >= 100) return false;
      // No archivar ni entregados
      if (isClosed(p)) return false;
      // La fecha de sesión o deadline tiene que ser pasada
      const refDate = p.sessionDate || p.startDate || p.deadline;
      return refDate && refDate < today;
    });

    if (toUpdate.length === 0) {
      localStorage.setItem(storageKey, 'done');
      return;
    }

    const batch = window.db.batch();
    toUpdate.forEach(p => {
      // La fecha límite es un compromiso; sólo se mueve la próxima fecha de trabajo.
      const updated = { ...p, sessionDate: today };
      dispatch({ type: 'update_project', project: updated });
      batch.update(window.db.collection('frame_projects').doc(p.id), { sessionDate: today });
    });
    batch.commit()
      .then(() => {
        localStorage.setItem(storageKey, 'done');
        console.log(`[FRAME] CarryOver: ${toUpdate.length} proyecto(s) movido(s) a hoy`);
      })
      .catch(err => {
        localStorage.removeItem(storageKey);
        console.error('[FRAME] CarryOver batch error:', err);
      });
  }, [state.carryOverProjects, state.loading, state.projects.length, wsId]);

  // ── Firestore: columnas Kanban ─────────────────────────────
  useEffect(() => {
    if (!authUser || !wsId) return;
    const ref = window.db.collection('frame_workspaces').doc(wsId).collection('config').doc('kanban_columns');
    const unsub = ref.onSnapshot((snap) => {
      if (!snap.exists) {
        // Primera vez: sembrar con columnas por defecto
        const defaults = STATUSES
          .filter(s => s.id !== 'archived')
          .map(s => ({ id: s.id, label: s.label, color: s.color, isDone: !!s.isDone, requiresChecklist: !!s.requiresChecklist }));
        window.FRAME_KANBAN_COLUMNS = defaults;
        ref.set({ columns: defaults });
        dispatch({ type: 'set_columns', columns: defaults });
      } else {
        const columns = (snap.data().columns || []).map(column => ({
          ...column,
          isDone: typeof column.isDone === 'boolean' ? column.isDone : column.id === 'delivered',
          requiresChecklist: typeof column.requiresChecklist === 'boolean' ? column.requiresChecklist : column.id === 'delivered',
        }));
        window.FRAME_KANBAN_COLUMNS = columns;
        dispatch({ type: 'set_columns', columns });
      }
    }, (err) => {
      console.error('Kanban columns error:', err);
      const defaults = STATUSES.filter(s => s.id !== 'archived').map(s => ({ id: s.id, label: s.label, color: s.color, isDone: !!s.isDone, requiresChecklist: !!s.requiresChecklist }));
      window.FRAME_KANBAN_COLUMNS = defaults;
      dispatch({ type: 'set_columns', columns: defaults });
    });
    return () => unsub();
  }, [authUser?.uid, wsId]);

  // ── Firestore: tipos de proyecto ──────────────────────────────
  useEffect(() => {
    if (!authUser || !wsId) return;
    const ref = window.db.collection('frame_workspaces').doc(wsId).collection('config').doc('project_types');
    const unsub = ref.onSnapshot((snap) => {
      if (!snap.exists) {
        // Primera vez: sembrar con los tipos predefinidos para que sean editables
        ref.set({ types: PROJECT_TYPES });
      } else {
        const types = snap.data().types || [];
        window.FRAME_CUSTOM_TYPES = types;
        dispatch({ type: 'set_custom_types', types });
      }
    }, (err) => {
      console.error('Custom types error:', err);
      window.FRAME_CUSTOM_TYPES = PROJECT_TYPES;
      dispatch({ type: 'set_custom_types', types: PROJECT_TYPES });
    });
    return () => unsub();
  }, [authUser?.uid, wsId]);

  const saveTypes = (types) =>
    window.db.collection('frame_workspaces').doc(wsId).collection('config').doc('project_types').set({ types })
      .catch(err => console.error('Error al guardar tipos:', err));

  // ── Firestore: papelera de reciclaje ──────────────────────────
  useEffect(() => {
    if (!authUser || !wsId) return;
    const col = window.db.collection('frame_trash').where('workspaceId', '==', wsId);
    const unsub = col.onSnapshot(async (snap) => {
      const now = Date.now();
      // Respaldo en cliente. La función programada hace la purga aunque nadie
      // abra FRAME; este paso mantiene el comportamiento si aún no se desplegó.
      const expired = snap.docs.filter(d => {
        const deletedAt = d.data().deletedAt;
        return deletedAt && (now - new Date(deletedAt).getTime()) > TRASH_RETENTION_MS;
      });
      if (expired.length > 0) {
        await Promise.all(expired.map(d => d.ref.delete()));
      }
      const remaining = snap.docs
        .filter(d => {
          const deletedAt = d.data().deletedAt;
          return deletedAt && (now - new Date(deletedAt).getTime()) <= TRASH_RETENTION_MS;
        })
        .map(d => normalizeProject({ ...d.data(), id: d.id }));
      dispatch({ type: 'set_trash', trash: remaining });
    }, (err) => {
      console.error('Trash listener error:', err);
      dispatch({ type: 'set_trash', trash: [] });
    });
    return () => unsub();
  }, [authUser?.uid, wsId]);

  const handleCreateCustomType = (typeObj) => {
    // Actualizar global ANTES del dispatch para que getType() lea datos correctos en el siguiente render
    window.FRAME_CUSTOM_TYPES = [...(window.FRAME_CUSTOM_TYPES || []), typeObj];
    dispatch({ type: 'add_custom_type', typeObj });
    window.db.collection('frame_workspaces').doc(wsId).collection('config').doc('project_types').get()
      .then(snap => {
        const existing = snap.exists ? (snap.data().types || []) : PROJECT_TYPES;
        return saveTypes([...existing, typeObj]);
      })
      .catch(err => console.error('Error al crear tipo:', err));
  };
  const handleUpdateCustomType = (id, patch) => {
    // Sincronizar global antes del dispatch (optimistic sync)
    window.FRAME_CUSTOM_TYPES = (window.FRAME_CUSTOM_TYPES || []).map(t => t.id === id ? { ...t, ...patch } : t);
    dispatch({ type: 'update_custom_type', id, patch });
    window.db.collection('frame_workspaces').doc(wsId).collection('config').doc('project_types').get()
      .then(snap => {
        const existing = snap.exists ? (snap.data().types || []) : PROJECT_TYPES;
        return saveTypes(existing.map(t => t.id === id ? { ...t, ...patch } : t));
      })
      .catch(err => console.error('Error al editar tipo:', err));
  };
  const handleDeleteCustomType = (id) => {
    if (state.projects.some(project => project.type === id)) {
      window.frameToast?.('Mové las tareas de este tipo antes de eliminarlo.');
      return;
    }
    window.FRAME_CUSTOM_TYPES = (window.FRAME_CUSTOM_TYPES || []).filter(t => t.id !== id);
    dispatch({ type: 'delete_custom_type', id });
    window.db.collection('frame_workspaces').doc(wsId).collection('config').doc('project_types').get()
      .then(snap => {
        const existing = snap.exists ? (snap.data().types || []) : PROJECT_TYPES;
        return saveTypes(existing.filter(t => t.id !== id));
      })
      .catch(err => console.error('Error al eliminar tipo:', err));
  };

  const saveColumns = (cols) => {
    window.db.collection('frame_workspaces').doc(wsId).collection('config').doc('kanban_columns').set({ columns: cols })
      .catch(err => console.error('Error guardando columnas:', err));
  };

  const handleUpdateColumn = (col) => {
    const updated = state.kanbanColumns.map(c => c.id === col.id ? col : c);
    window.FRAME_KANBAN_COLUMNS = updated;
    dispatch({ type: 'update_column', column: col });
    saveColumns(updated);
  };
  const handleAddColumn = (col) => {
    const updated = [...state.kanbanColumns, col];
    window.FRAME_KANBAN_COLUMNS = updated;
    dispatch({ type: 'add_column', column: col });
    saveColumns(updated);
  };
  const handleDeleteColumn = (id) => {
    const updated = state.kanbanColumns.filter(c => c.id !== id);
    window.FRAME_KANBAN_COLUMNS = updated;
    dispatch({ type: 'delete_column', id });
    saveColumns(updated);
  };
  const handleReorderColumns = (newOrder) => {
    // Las columnas que vienen de otro tablero se ven pero no son de acá: no
    // se guardan nunca en la configuración propia.
    const propias = newOrder.filter(column => !column.fromBoard);
    window.FRAME_KANBAN_COLUMNS = propias;
    dispatch({ type: 'set_columns', columns: propias });
    saveColumns(propias);
  };

  // Lo que se dibuja: las columnas propias más las de las tarjetas que la
  // bandeja trae de otros tableros. getStatus lee el global, así que también
  // se actualiza ahí; si no, una tarjeta ajena saldría con el nombre de otra
  // columna, que es peor que no salir.
  const boardCols = useMemo(
    () => boardColumns(state.kanbanColumns, state.projects, foreignColumns, window.__frameBoards?.names || {}),
    [state.kanbanColumns, state.projects, foreignColumns]
  );
  useEffect(() => { window.FRAME_KANBAN_COLUMNS = boardCols; }, [boardCols]);

  // ── Firestore: notificaciones en tiempo real ────────────────
  useEffect(() => {
    if (!state.currentUserId) return;
    const col = window.db
      .collection('frame_notifications')
      .doc(String(state.currentUserId))
      .collection('items');
    const unsub = col.orderBy('createdAt', 'desc').limit(50).onSnapshot((snap) => {
      const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      dispatch({ type: 'set_notifs', notifications: notifs });
    }, (err) => {
      console.error('Notifications listener error:', err);
      dispatch({ type: 'set_notifs', notifications: [] });
    });
    return () => unsub();
  }, [state.currentUserId]);

  // ── Notificaciones: handlers ────────────────────────────────
  const handleMarkRead = (id) => {
    dispatch({ type: 'mark_notif_read', id });
    window.db
      .collection('frame_notifications')
      .doc(String(state.currentUserId))
      .collection('items')
      .doc(id)
      .update({ read: true })
      .catch(err => console.error('Error al marcar notificación:', err));
  };

  const handleMarkAllRead = () => {
    const unread = state.notifications.filter(n => !n.read);
    if (unread.length === 0) return;
    dispatch({ type: 'mark_all_notifs_read' });
    const batch = window.db.batch();
    unread.forEach(n => {
      const ref = window.db
        .collection('frame_notifications')
        .doc(String(state.currentUserId))
        .collection('items')
        .doc(n.id);
      batch.update(ref, { read: true });
    });
    batch.commit().catch(err => console.error('Error al marcar todas leídas:', err));
  };

  // ── Escrituras a Firestore ──────────────────────────────────
  const handleDeleteProject = async (id) => {
    // 1. Grab full project data before removing from UI
    const project = state.projects.find(p => p.id === id);
    if (project && project.workspaceId !== wsId) {
      window.frameToast?.('Sólo el tablero principal puede eliminar esta tarea.');
      return;
    }
    if (!fusionLista()) return;
    // Una tarea generada por una venta de LOOPA no se borra (las reglas lo
    // impiden): se archiva, y su trabajo queda como historial de la venta.
    if (window.FrameLoopa.isFromSale(project)) {
      if (project.status !== 'archived') handleUpdateProject({ ...project, status: 'archived' });
      window.frameToast?.('Las tareas de una venta de LOOPA no se eliminan: quedó archivada.');
      return;
    }
    // 2. Optimistic UI removal
    dispatch({ type: 'delete_project', id });
    const col = window.db.collection('frame_projects');
    try {
      // 3 y 4. Papelera y borrado en UN lote: si el borrado falla, no queda
      // una copia fantasma en la papelera que al restaurarla pisaría la viva.
      const batch = window.db.batch();
      if (project) {
        const trashItem = { ...project, deletedAt: new Date().toISOString() };
        batch.set(window.db.collection('frame_trash').doc(id), trashItem);
      }
      const snap = await col.doc(id).get();
      if (snap.exists) {
        batch.delete(col.doc(id));
      } else {
        const q = await col.where('id', '==', id).get();
        q.docs.forEach(d => batch.delete(d.ref));
      }
      await batch.commit();
      console.log('[FRAME] Proyecto movido a papelera:', id);
      await Promise.all((project?.workspaceIds || [project?.workspaceId]).filter(Boolean).map(workspaceId =>
        window.db.collection('frame_workspaces').doc(workspaceId).update({
          sharedTaskIds: firebase.firestore.FieldValue.arrayRemove(id),
        }).catch(err => console.error('[FRAME] Limpiar referencia de tarea:', err))
      ));
    } catch (err) {
      notifyWriteError(err, 'la eliminación de la tarea');
    }
  };

  // ¿La ficha existe y es del tablero? (si no, las reglas rechazan recrear la
  // tarea con ese clientId). Con el estado, que escucha las fichas del
  // tablero: un corte de red no deja una tarea sin ficha para siempre.
  const clientOkFor = (clientId, workspaceId) => typeof clientId === 'string' && !!clientId
    && state.clients.some(c => c.id === clientId && (c.workspaceId || wsId) === workspaceId);

  const restoreTrashItem = async (item) => {
    const { deletedAt, ...trashed } = item;
    const originId = trashed.workspaceId || wsId;
    if (!window.FrameLoopa) throw Object.assign(new Error('Falta loopa-fusion.js'), { friendly: 'Falta un archivo de FRAME (loopa-fusion.js). Recargá la página.' });
    const check = window.FrameLoopa.restorableFromTrash(trashed, { originId, clientOk: clientOkFor(trashed.clientId, originId) });
    if (!check.ok) throw Object.assign(new Error(check.reason), { code: 'loopa-sale', friendly: check.reason });
    // 5. Una copia vieja de la papelera no pisa una tarea que sigue viva.
    if (state.projects.some(p => p.id === trashed.id)) {
      const viva = 'Esta tarea sigue en el tablero: la copia de la papelera es vieja y no se restaura.';
      throw Object.assign(new Error(viva), { code: 'live-task', friendly: viva });
    }
    const storedProject = check.project;
    const originWorkspace = state.workspaces.find(workspace => workspace.id === originId);
    const primaryViewerIds = [...new Set((originWorkspace?.memberIds || []).filter(Boolean))];
    if (!originWorkspace || primaryViewerIds.length === 0) {
      throw new Error('No se pudo reconstruir el acceso del tablero principal.');
    }

    // La papelera también contiene documentos anteriores a workspaceIds y
    // viewerIds. normalizeProject les agrega esos campos para poder pintarlos,
    // pero viewerIds queda vacío y las reglas rechazan recrear la tarea. La
    // restauración nace primero con la ACL exacta del tablero principal: es
    // una creación válida y garantiza que la tarea vuelva aunque compartirla
    // de nuevo falle después.
    const primaryProject = {
      ...storedProject,
      workspaceId: originId,
      workspaceIds: [originId],
      viewerIds: primaryViewerIds,
    };
    const batch = window.db.batch();
    const projectRef = window.db.collection('frame_projects').doc(primaryProject.id);
    batch.set(projectRef, primaryProject);
    batch.delete(window.db.collection('frame_trash').doc(item.id));
    await batch.commit();

    const rememberedIds = [...new Set((storedProject.workspaceIds || [originId]).filter(Boolean))];
    const availableIds = [
      originId,
      ...rememberedIds.filter(id => id !== originId && state.workspaces.some(workspace => workspace.id === id)),
    ];
    if (availableIds.length === 1) return { project: primaryProject, sharingFailed: false };

    const availableWorkspaces = availableIds
      .map(id => state.workspaces.find(workspace => workspace.id === id))
      .filter(Boolean);
    const viewerIds = [...new Set(availableWorkspaces.flatMap(workspace => workspace.memberIds || []).filter(Boolean))];
    try {
      // Segunda fase atómica: recupera la ACL compartida y las referencias de
      // cada tablero. Si falla, la primera fase ya dejó la tarea a salvo en
      // su tablero principal.
      const shareBatch = window.db.batch();
      shareBatch.update(projectRef, { workspaceIds: availableIds, viewerIds });
      availableIds.forEach(workspaceId => {
        shareBatch.update(window.db.collection('frame_workspaces').doc(workspaceId), {
          sharedTaskIds: firebase.firestore.FieldValue.arrayUnion(primaryProject.id),
        });
      });
      await shareBatch.commit();
      return {
        project: { ...primaryProject, workspaceIds: availableIds, viewerIds },
        sharingFailed: false,
      };
    } catch (err) {
      console.error('[FRAME] Restaurar referencias compartidas:', err);
      return { project: primaryProject, sharingFailed: true };
    }
  };

  const handleRestoreProject = async (item) => {
    try {
      const { project, sharingFailed } = await restoreTrashItem(item);
      dispatch({ type: 'restore_project', project });
      window.frameToast?.(sharingFailed
        ? 'Tarea restaurada en su tablero principal.'
        : 'Tarea restaurada.');
    } catch (err) {
      notifyWriteError(err, 'la restauración de la tarea');
    }
  };

  const handlePermanentDelete = async (id) => {
    try {
      await window.db.collection('frame_trash').doc(id).delete();
      dispatch({ type: 'remove_from_trash', id });
      window.frameToast?.('Tarea eliminada permanentemente.');
    } catch (err) {
      notifyWriteError(err, 'la eliminación permanente');
    }
  };

  const handleRestoreAllTrash = async () => {
    const restored = [];
    let failed = 0;
    let sharingFailed = 0;
    let motivo = '';
    for (const item of state.trash) {
      try {
        const result = await restoreTrashItem(item);
        restored.push(result.project);
        if (result.sharingFailed) sharingFailed += 1;
      }
      catch (err) { failed += 1; motivo = motivo || err.friendly || ''; console.error('[FRAME] Restaurar todo:', item.id, err); }
    }
    if (restored.length) dispatch({ type: 'restore_projects', projects: restored });
    if (failed) window.frameToast?.(`${restored.length} restauradas; ${failed} no se pudieron restaurar.${motivo ? ` ${motivo}` : ''}`);
    else if (sharingFailed) window.frameToast?.(`${restored.length} restauradas; ${sharingFailed} quedaron sólo en su tablero principal.`);
    else window.frameToast?.(`${restored.length} ${restored.length === 1 ? 'tarea restaurada' : 'tareas restauradas'}.`);
  };

  const handlePermanentDeleteAll = async () => {
    const results = await Promise.allSettled(state.trash.map(item =>
      window.db.collection('frame_trash').doc(item.id).delete()
    ));
    const deletedIds = state.trash.filter((_, index) => results[index].status === 'fulfilled').map(item => item.id);
    const failed = results.length - deletedIds.length;
    if (!failed) dispatch({ type: 'clear_trash' });
    else deletedIds.forEach(id => dispatch({ type: 'remove_from_trash', id }));
    if (failed) window.frameToast?.(`${deletedIds.length} eliminadas; ${failed} no se pudieron eliminar.`);
    else window.frameToast?.('Papelera vaciada permanentemente.');
    if (failed) {
      const firstError = results.find(result => result.status === 'rejected')?.reason;
      console.error('[FRAME] Vaciar papelera:', firstError);
    }
  };

  const handleDuplicateProject = (id) => {
    const original = state.projects.find(p => p.id === id);
    if (!original || !fusionLista()) return;
    const newId  = 'p' + Date.now() + Math.random().toString(36).slice(2, 5);
    // La copia nace independiente dentro del tablero actual; no hereda la
    // visibilidad múltiple ni la ACL de la tarea original. Es una tarea
    // MANUAL: sin la procedencia de una venta de LOOPA, y sin ficha si la
    // ficha no es de este tablero (las reglas rechazarían ambas cosas).
    const copy   = window.FrameLoopa.duplicateOf(original, {
      newId, wsId,
      viewerIds: [...new Set(activeWs?.memberIds || [state.currentUserId])],
      now: new Date().toISOString(),
      clientIdsInTarget: state.clients.filter(c => (c.workspaceId || wsId) === wsId).map(c => c.id),
    });
    dispatch({ type: 'duplicate_project', project: copy });
    window.db.collection('frame_projects').doc(newId).set(stampWs(copy))
      .catch(err => notifyWriteError(err, 'la copia de la tarea'));
  };

  // ── Mostrar una misma tarea en varios tableros ──────────────
  // No se crean copias: workspaceId conserva el tablero principal y
  // workspaceIds decide dónde aparece. viewerIds es la ACL materializada que
  // Firestore y Storage pueden comprobar sin consultas dinámicas inseguras.
  const handleSetProjectWorkspaces = async (project, requestedIds) => {
    try {
      const originId = project.workspaceId || wsId;
      if (originId !== wsId) throw new Error('Sólo el tablero principal puede cambiar la visibilidad.');

      const available = state.workspaces;
      const availableIds = new Set(available.map(w => w.id));
      const workspaceIds = [...new Set([originId, ...(requestedIds || [])])];
      if (workspaceIds.length > 5 || workspaceIds.some(id => !availableIds.has(id))) {
        throw new Error('Elegí hasta 5 tableros a los que tengas acceso.');
      }
      // Confirmar miembros en el servidor: el estado local puede estar desfasado
      // tras una invitación, y la ACL debe coincidir con los miembros actuales.
      const selected = await Promise.all(workspaceIds.map(async id => {
        const snap = await window.db.collection('frame_workspaces').doc(id).get({ source: 'server' });
        if (!snap.exists || !(snap.data().memberIds || []).includes(state.currentUserId)) {
          throw new Error('Ya no tenés acceso a uno de los tableros seleccionados.');
        }
        return { ...snap.data(), id };
      }));
      const viewerIds = [...new Set(selected.flatMap(w => w.memberIds || []))];
      const refBatch = window.db.batch();

      // El tipo personalizado se copia como configuración visual, no como
      // tarea. El documento y todos sus campos siguen siendo únicos.
      const sourceType = state.customTypes.find(t => t.id === project.type);
      const sourceStatus = state.kanbanColumns.find(column => column.id === project.status);
      if (sourceType) {
        await Promise.all(selected.filter(w => w.id !== originId).map(async (workspace) => {
          const ref = window.db.collection('frame_workspaces').doc(workspace.id).collection('config').doc('project_types');
          const snap = await ref.get();
          const types = snap.exists ? (snap.data()?.types || []) : PROJECT_TYPES;
          if (!types.some(t => t.id === sourceType.id)) refBatch.set(ref, { types: [...types, sourceType] }, { merge: true });
        }));
      }
      // Una tarea compartida debe tener una columna donde aparecer. Se copia
      // sólo si falta; nunca se reemplaza la configuración del tablero destino.
      if (sourceStatus) {
        await Promise.all(selected.filter(w => w.id !== originId).map(async (workspace) => {
          const ref = window.db.collection('frame_workspaces').doc(workspace.id).collection('config').doc('kanban_columns');
          const snap = await ref.get();
          const columns = snap.exists
            ? (snap.data()?.columns || [])
            : STATUSES.filter(status => status.id !== 'archived').map(status => ({
                id: status.id,
                label: status.label,
                color: status.color,
                isDone: !!status.isDone,
                requiresChecklist: !!status.requiresChecklist,
              }));
          if (!columns.some(column => column.id === sourceStatus.id)) {
            refBatch.set(ref, { columns: [...columns, sourceStatus] }, { merge: true });
          }
        }));
      }

      // La tarea, su configuración y las referencias se guardan juntas.
      // Si un permiso falla, no queda compartida sólo a medias.
      refBatch.update(window.db.collection('frame_projects').doc(project.id), { workspaceIds, viewerIds });

      const previousIds = new Set(project.workspaceIds?.length ? project.workspaceIds : [originId]);
      const selectedIds = new Set(workspaceIds);
      available.forEach(workspace => {
        if (!selectedIds.has(workspace.id) && !previousIds.has(workspace.id)) return;
        refBatch.update(window.db.collection('frame_workspaces').doc(workspace.id), {
          sharedTaskIds: selectedIds.has(workspace.id)
            ? firebase.firestore.FieldValue.arrayUnion(project.id)
            : firebase.firestore.FieldValue.arrayRemove(project.id),
        });
      });
      await refBatch.commit();

      const actor = state.team.find(m => m.id === state.currentUserId);
      const names = selected.map(w => w.name).join(', ');
      const event = {
        id: 'a' + Date.now() + Math.random().toString(36).slice(2, 6),
        actorId: state.currentUserId,
        actorName: actor?.name || 'Alguien',
        summary: `actualizó los tableros visibles: ${names}`,
        at: new Date().toISOString(),
      };
      window.db.collection('frame_projects').doc(project.id).collection('activity').doc(event.id).set(event)
        .catch(err => console.error('Task visibility activity:', err));

      window.frameToast?.(`Tarea visible en ${workspaceIds.length} ${workspaceIds.length === 1 ? 'tablero' : 'tableros'}.`);
    } catch (err) {
      if (err?.code) notifyWriteError(err, 'los tableros visibles de la tarea');
      else window.frameToast?.(err.message || 'No se pudieron guardar los tableros.');
      throw err;
    }
  };

  // Todo lo que se crea nace sellado con el tablero activo. Sin esto el
  // documento no aparece en ninguna consulta (todas filtran por workspaceId)
  // y las reglas lo rechazan.
  const stampWs = (obj) => ({
    ...obj,
    startDate: obj.startDate || localISO(new Date(TODAY)),
    workspaceId: obj.workspaceId || wsId,
    workspaceIds: Array.isArray(obj.workspaceIds) && obj.workspaceIds.length
      ? [...new Set(obj.workspaceIds)]
      : [obj.workspaceId || wsId],
    viewerIds: Array.isArray(obj.viewerIds) && obj.viewerIds.length
      ? [...new Set(obj.viewerIds)]
      : [...new Set(activeWs?.memberIds || [state.currentUserId])],
  });

  // ── Crear tablero de equipo ─────────────────────────────────
  // Nace con el creador como único miembro; el resto entra por invitación.
  // Las reglas exigen exactamente eso (memberIds == [uid] en el alta), así
  // que no se puede fabricar un tablero metiendo gente adentro de una.
  const handleCreateTeamWorkspace = (name) => {
    if (!authUser || !name?.trim()) return;
    const me = state.team.find(m => m.id === authUser.uid);
    const id = 'ws' + Date.now() + Math.random().toString(36).slice(2, 5);
    const workspace = {
      id,
      name:      name.trim(),
      kind:      'team',
      ownerId:   authUser.uid,
      memberIds: [authUser.uid],
      roles:     { [authUser.uid]: 'owner' },
      members:   { [authUser.uid]: memberCard(me) },
      createdAt: new Date().toISOString(),
    };
    window.db.collection('frame_workspaces').doc(id).set(workspace)
      .then(() => dispatch({ type: 'set_active_workspace', id }))
      .catch(err => notifyWriteError(err, 'el tablero de equipo'));
  };

  // ── Guardado de proyectos ───────────────────────────────────
  // .set(objetoEntero) REEMPLAZABA el documento: dos personas editando la
  // misma tarjeta se pisaban aunque tocaran campos distintos. Se manda
  // .update() con lo que cambio.

  const activitySummary = (before, after) => {
    if (before.status !== after.status) return `cambió el estado a ${getStatus(after.status)?.label || after.status}`;
    if (before.startDate !== after.startDate) return 'reprogramó la fecha de inicio';
    if (before.deadline !== after.deadline) return 'cambió la fecha límite';
    if (before.sessionDate !== after.sessionDate) return 'reprogramó la próxima fecha de trabajo';
    if (JSON.stringify(before.assignees) !== JSON.stringify(after.assignees)) return 'actualizó los responsables';
    if (JSON.stringify(before.checklist) !== JSON.stringify(after.checklist)) return 'actualizó el checklist';
    if (JSON.stringify(before.deliverables) !== JSON.stringify(after.deliverables)) return 'actualizó los entregables';
    if (JSON.stringify(before.description) !== JSON.stringify(after.description)) return 'actualizó el brief';
    if (before.cover?.value !== after.cover?.value) return 'actualizó la portada';
    return null;
  };

  const handleUpdateProject = (project) => {
    const prev = state.projects.find(p => p.id === project.id);
    // La restricción pertenece a la columna de destino, no a un id fijo.
    if (prev && requiresChecklistForStatus(project.status) && prev.status !== project.status
      && project.checklist?.length && progressOf(project) < 100) {
      window.frameToast?.(`Completá el checklist antes de mover la tarea a ${getStatus(project.status).label}.`);
      return;
    }
    dispatch({ type: 'update_project', project }); // optimista: la UI ya lo refleja

    // Sólo los campos que realmente cambiaron respecto de lo que había.
    const patch = {};
    Object.keys(project).forEach(k => {
      if (JSON.stringify(project[k]) !== JSON.stringify(prev?.[k])) patch[k] = project[k];
    });
    if (!prev) { // alta: no hay con qué comparar, va entero
      window.db.collection('frame_projects').doc(project.id).set(stampWs(project))
        .catch(err => notifyWriteError(err, 'la tarea'));
      return;
    }
    if (Object.keys(patch).length === 0) return;

    const summary = activitySummary(prev, project);
    if (summary) {
      const actor = state.team.find(m => m.id === state.currentUserId);
      const event = {
        id: 'a' + Date.now() + Math.random().toString(36).slice(2, 6),
        actorId: state.currentUserId,
        actorName: actor?.name || 'Alguien',
        summary,
        at: new Date().toISOString(),
      };
      window.db.collection('frame_projects').doc(project.id).collection('activity').doc(event.id).set(event)
        .catch(err => console.error('Task activity:', err));
    }

    // Se escribe YA, sin agrupar. Hubo un debounce de 700 ms acá para reducir
    // escrituras, y rompía la app: durante esa ventana Firestore no tiene nada
    // pendiente, así que cualquier snapshot que llegara reemplazaba el estado
    // con el del servidor —todavía sin el cambio— y la edición se deshacía
    // sola. Cambiar una fecha o arrastrar una tarjeta parecía no funcionar.
    //
    // Tampoco hacía falta: InlineEdit ya guarda al perder el foco, así que
    // escribir no generaba una escritura por tecla. Lo que sí se conserva es
    // mandar sólo los campos que cambiaron.
    window.db.collection('frame_projects').doc(project.id).update(patch)
      .catch(err => notifyWriteError(err, 'la tarea'));
  };

  const handleCreateProject = (project) => {
    // Optimistic: dispatch first → snapshot replaces array (no duplicate)
    const p = stampWs(project);
    dispatch({ type: 'create_project', project: p });
    window.db.collection('frame_projects').doc(p.id).set(p)
      .catch(err => console.error('Error al crear proyecto:', err));
  };

  // ── Alta rápida inline desde tablero / calendario / galería ──────
  // Crea una tarjeta "vacía" con el título tipeado, heredando el contexto
  // donde se pulsó el "+" (estado de columna, fecha del día). No abre el modal.
  const handleQuickCreate = (opts = {}) => {
    const { title, status, startDate, sessionDate, deadline, type } = opts;
    const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 5);

    // La creación permanece interna; el calendario elige solo la sesión.
    const start = localISO(new Date());
    const dl = deadline ?? '';

    const project = {
      id,
      title:      (title && title.trim()) || 'Nueva tarea',
      client:     '',
      type:       type   || 'reel',
      status:     status || (state.kanbanColumns[0] && state.kanbanColumns[0].id) || 'briefing',
      priority:   'medium',
      assignees:  [],
      startDate:  start,
      deadline:   dl,
      sessionDate: sessionDate || startDate || dl || start,
      budget:     0,
      currency:   'USD',
      tags:       [],
      cover:      { type: 'color', value: '#1a1a1f' },
      description: [{ type: 'p', text: '' }],
      checklist:   [],
      deliverables: [],
      timeline:    [],
      comments:    [],
    };
    dispatch({ type: 'create_project_quiet', project });
    window.db.collection('frame_projects').doc(id).set(stampWs(project))
      .catch(err => notifyWriteError(err, 'la tarea nueva'));
  };

  const handleToggleFavorite = (id) => {
    const project = state.projects.find(p => p.id === id);
    if (!project) return;
    const updated = { ...project, favorite: !project.favorite };
    dispatch({ type: 'update_project', project: updated });
    // Sólo el campo: un set() completo con una copia vieja revertiría lo que
    // escribe el servidor (procedencia de una venta) y las reglas lo rechazan.
    window.db.collection('frame_projects').doc(id).update({ favorite: updated.favorite })
      .catch(err => notifyWriteError(err, 'el favorito'));
  };

  const handleDeleteMember = (id) => {
    dispatch({ type: 'delete_member', id });
    window.db.collection('frame_users').doc(id).delete()
      .catch(err => console.error('Error al eliminar integrante:', err));
  };

  // ── Aprobación de nuevos usuarios ──────────────────────────────
  const handleApproveUser = (userId, notifId) => {
    const member = state.team.find(m => m.id === userId);
    if (member) dispatch({ type: 'update_member', member: { ...member, status: 'active' } });
    window.db.collection('frame_users').doc(userId).update({ status: 'active' })
      .catch(err => notifyWriteError(err, 'la aprobacion'));
    if (notifId) {
      dispatch({ type: 'resolve_notif', id: notifId, action: 'approved' });
      window.db.collection('frame_notifications')
        .doc(state.currentUserId).collection('items').doc(notifId)
        .update({ read: true, resolved: true, resolvedAction: 'approved' })
        .catch(err => console.error('[FRAME] Error al resolver notif:', err));
    }
  };

  const handleRejectUser = (userId, notifId) => {
    const member = state.team.find(m => m.id === userId);
    if (member) dispatch({ type: 'update_member', member: { ...member, status: 'rejected' } });
    window.db.collection('frame_users').doc(userId).update({ status: 'rejected' })
      .catch(err => notifyWriteError(err, 'el rechazo'));
    if (notifId) {
      dispatch({ type: 'resolve_notif', id: notifId, action: 'rejected' });
      window.db.collection('frame_notifications')
        .doc(state.currentUserId).collection('items').doc(notifId)
        .update({ read: true, resolved: true, resolvedAction: 'rejected' })
        .catch(err => console.error('[FRAME] Error al resolver notif:', err));
    }
  };

  const handleUpdateMember = (member) => {
    dispatch({ type: 'update_member', member });
    window.db.collection('frame_users').doc(member.id).set(member)
      .catch(err => console.error('Error al guardar integrante:', err));
  };

  const handleDeleteClient = (id) => {
    const client = state.clients.find(item => item.id === id);
    if (!fusionLista()) return;
    if (window.FrameLoopa.clientHasSales(client)) {
      window.frameToast?.('Esta ficha tiene ventas en LOOPA: no se elimina.');
      return;
    }
    dispatch({ type: 'delete_client', id });
    window.db.collection('frame_clients').doc(id).delete()
      .then(() => {
        if (!client?.portalToken) return;
        return window.db.collection('frame_client_portals').doc(client.portalToken)
          .set(buildClientPortalDocument(client, [], activeWs, false))
          .catch(err => console.error('[FRAME] Desactivar portal eliminado:', err));
      })
      .catch(err => notifyWriteError(err, 'la eliminación del cliente'));
  };

  const handleUpdateClient = (client) => {
    if (!fusionLista()) return;
    const prev = state.clients.find(item => item.id === client.id);
    dispatch({ type: 'update_client', client });
    // Con update y sólo lo que cambió: lo comercial que escribe LOOPA en la
    // ficha queda intacto aunque esta copia esté desactualizada.
    const write = prev
      ? (() => {
        const next = stampWs(client);
        const patch = window.FrameLoopa.clientUpdatePatch(prev, next);
        window.FrameLoopa.clientRemovedKeys(prev, next).forEach(k => { patch[k] = firebase.firestore.FieldValue.delete(); });
        return Object.keys(patch).length ? window.db.collection('frame_clients').doc(client.id).update(patch) : Promise.resolve();
      })()
      // Sin copia en pantalla: merge, para no borrar lo que la ficha ya tenga.
      : window.db.collection('frame_clients').doc(client.id).set(stampWs(client), { merge: true });
    write.catch(err => notifyWriteError(err, 'el cliente'));
  };

  const handleCreateClient = (client) => {
    dispatch({ type: 'create_client', client });
    window.db.collection('frame_clients').doc(client.id).set(stampWs(client))
      .catch(err => console.error('Error al crear cliente:', err));
  };

  const handleSetClientPortal = async (client, published) => {
    if (!fusionLista()) throw new Error('Falta loopa-fusion.js');
    const portalToken = client.portalToken || createClientPortalToken();
    const updated = { ...client, portalToken, portalPublished: published === true };
    try {
      const portalPatch = window.FrameLoopa.clientUpdatePatch(client, stampWs(updated));
      if (Object.keys(portalPatch).length) await window.db.collection('frame_clients').doc(client.id).update(portalPatch);
      await window.db.collection('frame_client_portals').doc(portalToken)
        .set(buildClientPortalDocument({ ...updated, workspaceId: wsId }, boardProjects(state.projects, wsId, false), activeWs, published, state.kanbanColumns));
      dispatch({ type: 'update_client', client: updated });
      window.frameToast?.(published ? 'Portal del cliente publicado.' : 'Portal del cliente desactivado.');
      return updated;
    } catch (err) {
      notifyWriteError(err, 'el portal del cliente');
      throw err;
    }
  };

  const handleToggleClientPortalTask = (project, visible) => {
    handleUpdateProject({ ...project, clientVisible: visible === true });
  };

  // Va acá arriba y no junto al return: es un hook, y después de la primera
  // salida temprana ya no se puede llamar.
  const isMobile = useIsMobile();

  // El orden importa: los listeners de Firestore ahora solo corren con sesión
  // activa, así que teamLoading/loading siguen en true mientras no haya login.
  // Hay que descartar el caso "sin sesión" ANTES de mirar los flags de carga,
  // o la pantalla de login nunca llegaría a renderizarse.
  // El orden de estos chequeos es la lógica de arranque de la app. Cada uno
  // descarta un estado antes de que el siguiente pueda asumir nada.
  if (!authChecked) return <LoadingScreen />;
  // El ingreso es el de LOOPA: acá nunca se llega sin sesión.
  if (!authUser)    return <LoadingScreen />;
  if (state.teamLoading) return <LoadingScreen />;

  // El documento de perfil se busca por uid, que es el id del documento.
  // Antes se buscaba por email dentro del equipo cargado: si esa lista venía
  // vacía —por ejemplo porque las reglas rechazaron la consulta— el usuario
  // no aparecía como pendiente ni como rechazado, se colaba hasta el chequeo
  // de carga y quedaba en la pantalla de "Conectando con Firebase" para
  // siempre. Un perfil ausente ahora se trata explícitamente como pendiente.
  const _me = state.team.find(m => m.id === authUser.uid);
  if (!_me || _me.status === 'pending') {
    return <PendingApprovalScreen member={_me || { name: authUser.displayName || authUser.email }} onSignOut={() => firebase.auth().signOut()} />;
  }
  if (_me.status === 'rejected') {
    return <RejectedScreen member={_me} onSignOut={() => firebase.auth().signOut()} />;
  }

  // Aprobado pero todavía sin tablero: el alta del tablero personal está en
  // curso. Es un instante, pero sin este chequeo la app llegaría a las vistas
  // con activeWorkspaceId en null y no cargaría nada.
  if (state.workspacesLoading || !state.activeWorkspaceId) return <LoadingScreen />;

  if (state.loading) return <LoadingScreen />;

  // El detalle es el mismo en los dos tamaños, con los mismos handlers. Se
  // arma una sola vez y se le pasa a la vista que corresponda: si se
  // duplicara, cada arreglo habría que hacerlo dos veces.
  const modalDetalle = openProject && (
    <ProjectModal
      key={openProject.id}
      project={openProject}
      projects={filtered}
      onNavigate={(id) => dispatch({ type: 'open_project', id })}
      currentUserId={state.currentUserId}
      team={workspaceMembers(state.workspaces.find(w => w.id === state.activeWorkspaceId))}
      clients={state.clients}
      onCreateClient={handleCreateClient}
      onClose={() => dispatch({ type: 'close_project' })}
      onUpdate={handleUpdateProject}
      onDelete={openProject.workspaceId === wsId && !window.FrameLoopa?.isFromSale(openProject) ? handleDeleteProject : undefined}
      onSetWorkspaceVisibility={openProject.workspaceId === wsId ? handleSetProjectWorkspaces : undefined}
      workspaces={state.workspaces}
      activeWorkspaceId={wsId}
      customTypes={state.customTypes}
      kanbanColumns={boardCols}
      onCreateCustomType={handleCreateCustomType}
      onUpdateCustomType={handleUpdateCustomType}
      onDeleteCustomType={handleDeleteCustomType}
      workspaceKind={activeWs?.kind || 'personal'}
      clientPortalToken={state.clients.find(client => client.name.toLowerCase() === String(openProject.client || '').toLowerCase())?.portalToken || ''}
    />
  );

  // En el teléfono FRAME es otra cosa: modo rápido, agregar y mirar. No es
  // esta misma pantalla angosta — es otro árbol de vistas sobre el mismo
  // estado y los mismos handlers.
  // El portfolio no pasó a LOOPA (se decide antes de retirar FRAME).
  // El selector de tablero vive en la barra de LOOPA.
  const selectorTablero = barra && ReactDOM.createPortal(
    <div className="estudio estudio-barra">
      <WorkspaceSwitcher state={state} dispatch={dispatch} onCreateTeam={handleCreateTeamWorkspace} onDeleteWorkspace={handleDeleteWorkspace} onRenameWorkspace={handleRenameWorkspace} collapsed={false} />
    </div>,
    barra,
  );
  // En el teléfono, el tablero es la vista rápida; Clientes, Equipo, análisis,
  // ajustes y papelera usan su pantalla (el menú de LOOPA las elige).
  if (isMobile && state.section === 'projects') {
    return (
      <MobileApp
        state={state}
        dispatch={dispatch}
        authUser={authUser}
        workspaces={state.workspaces}
        activeWorkspaceId={state.activeWorkspaceId}
        onQuickCreate={handleQuickCreate}
        onRenameWorkspace={handleRenameWorkspace}
        onSignOut={() => firebase.auth().signOut()}
      >
        {modalDetalle}
      </MobileApp>
    );
  }

  return (
    <div className="h-full flex" style={{ background: 'var(--bg)', position: 'relative', zIndex: 1 }}>
      <ToastStack />
      {selectorTablero}

      {/* El banner va dentro de la columna de contenido y no sobre toda la
          pantalla: avisa sin tapar ni interrumpir lo que se estaba haciendo. */}
      <div className="flex-1 flex flex-col min-w-0">
      <InviteBanner invites={myInvites} onAccept={handleAcceptInvite} onDecline={handleDeclineInvite} />

      {state.section === 'clients' ? (
        <ClientsSection
          clients={state.clients}
          projects={state.projects}
          columns={boardCols}
          comercial={comercial}
          onCreateClient={handleCreateClient}
          onUpdateClient={handleUpdateClient}
          onDeleteClient={handleDeleteClient}
          onSetClientPortal={handleSetClientPortal}
          onTogglePortalTask={handleToggleClientPortalTask}
          openClientId={state.openClientId}
          onOpenClient={(id) => dispatch({ type: 'open_client', id })}
          onCloseClient={() => dispatch({ type: 'close_client' })}
        />
      ) : state.section === 'team' ? (
        <TeamSection
          team={wsMembers}
          workspaceName={activeWs?.name}
          canInvite={activeWs?.kind === 'team' && activeWs?.ownerId === authUser?.uid}
          onInvite={handleInvite}
          sentInvites={sentInvites}
          onCancelInvite={handleDeclineInvite}
          projects={state.projects}
          onApproveUser={handleApproveUser}
          onRejectUser={handleRejectUser}
          onUpdateMember={handleUpdateMember}
          onDeleteMember={handleDeleteMember}
          openMemberId={state.openMemberId}
          onOpenMember={(id) => dispatch({ type: 'open_member', id })}
          onCloseMember={() => dispatch({ type: 'close_member' })}
          currentUserId={state.currentUserId}
        />
      ) : state.section === 'analytics' ? (
        <AnalyticsSection
          projects={state.projects}
          clients={state.clients}
          team={state.team}
          currentUserId={state.currentUserId}
        />
      ) : state.section === 'settings' ? (
        <SettingsSection
          pendingUsers={iAmAdmin ? state.team.filter(m => m.status === 'pending') : []}
          onApproveUser={handleApproveUser}
          onRejectUser={handleRejectUser}
          previewFields={state.previewFields}
          onToggle={handleTogglePreviewField}
          carryOverProjects={state.carryOverProjects}
          onToggleCarryOverProjects={handleToggleCarryOverProjects}
          workspaceId={activeWsReady ? wsId : null}
        />
      ) : state.section === 'trash' ? (
        <TrashSection
          trash={state.trash}
          onRestore={handleRestoreProject}
          onPermanentDelete={handlePermanentDelete}
          onRestoreAll={handleRestoreAllTrash}
          onPermanentDeleteAll={handlePermanentDeleteAll}
        />
      ) : (
        <main className="flex-1 flex flex-col overflow-hidden">
          <Header
            columns={boardCols}
            state={state}
            dispatch={dispatch}
            filteredCount={filtered.length}
            notifications={state.notifications}
            onMarkRead={handleMarkRead}
            onMarkAllRead={handleMarkAllRead}
            onOpenProject={(id) => dispatch({ type: 'open_project', id })}
            onApproveUser={handleApproveUser}
            onRejectUser={handleRejectUser}
            onPinView={handlePinView}
          />
          {state.view === 'kanban' && <StatusStatsBar projects={filtered} columns={boardCols} />}

          <div className="flex-1 overflow-hidden">
            {filtered.length === 0 && state.view !== 'kanban' && state.view !== 'calendar' && state.view !== 'gallery' ? (
              <EmptyState />
            ) : (
              <CardEditingContext.Provider value={{ columns: boardCols, types: state.customTypes.length ? state.customTypes : PROJECT_TYPES, members: workspaceMembers(state.workspaces.find(w => w.id === wsId)), shared: state.workspaces.find(w => w.id === wsId)?.kind === 'team', update: (id, patch) => { const current = state.projects.find(p => p.id === id); if (current) handleUpdateProject({ ...current, ...patch }); } }}>
                {state.view === 'kanban'   && <KanbanView
                  projects={filtered}
                  allProjects={state.projects}
                  onOpenProject={(id) => dispatch({ type: 'open_project', id })}
                  onUpdateProject={handleUpdateProject}
                  onDeleteProject={handleDeleteProject}
                  onDuplicateProject={handleDuplicateProject}
                  onToggleFavorite={handleToggleFavorite}
                  onQuickCreate={handleQuickCreate}
                  columns={boardCols}
                  onUpdateColumn={handleUpdateColumn}
                  onAddColumn={handleAddColumn}
                  onDeleteColumn={handleDeleteColumn}
                  onReorderColumns={handleReorderColumns}
                  previewFields={state.previewFields}
                />}
                {state.view === 'calendar' && <CalendarView projects={filtered} onOpenProject={(id) => dispatch({ type: 'open_project', id })} onDeleteProject={handleDeleteProject} onDuplicateProject={handleDuplicateProject} onToggleFavorite={handleToggleFavorite} onUpdateProject={handleUpdateProject} onQuickCreate={handleQuickCreate} previewFields={state.previewFields} />}
                {state.view === 'gallery'  && <GalleryView  projects={filtered} onOpenProject={(id) => dispatch({ type: 'open_project', id })} onDeleteProject={handleDeleteProject} onDuplicateProject={handleDuplicateProject} onToggleFavorite={handleToggleFavorite} onQuickCreate={handleQuickCreate} previewFields={state.previewFields} />}
                {state.view === 'list'     && <ListView     projects={filtered} onOpenProject={(id) => dispatch({ type: 'open_project', id })} onDeleteProject={handleDeleteProject} onDuplicateProject={handleDuplicateProject} onToggleFavorite={handleToggleFavorite} />}
              </CardEditingContext.Provider>
            )}
          </div>
        </main>
      )}
      </div>

      {modalDetalle}

      {state.showNewProject && (
        <NewProjectModal
          onCreate={handleCreateProject}
          onClose={() => dispatch({ type: 'hide_new' })}
          clients={state.clients}
          onCreateClient={handleCreateClient}
          customTypes={state.customTypes}
          columns={state.kanbanColumns}
        />
      )}

      {/* Widget flotante de rutina diaria */}
      <RoutineWidget workspaceId={activeWsReady ? wsId : null} />
    </div>
  );
};

// En LOOPA no hay raíz propia: LOOPA monta <App> (como EstudioApp) dentro de
// su área de contenido, y el portal del cliente (?portal=) en su lugar.
