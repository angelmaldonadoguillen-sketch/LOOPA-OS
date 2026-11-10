// ─────────────────────────────────────────────────────────────────
// PROJECT MODAL — Notion-style two-column panel
// ─────────────────────────────────────────────────────────────────

const { useState, useRef, useEffect, useMemo } = React;

// ── Avatar ──────────────────────────────────────────────────────
const Avatar = ({ user, size = 24, ring = false }) => {
  if (!user) return null;
  const ringClass = ring ? 'ring-2 ring-[var(--surface)]' : '';
  const avatarColor = resolveThemeColor(user.color);
  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.initials}
        className={`rounded-full object-cover flex-shrink-0 ${ringClass}`}
        style={{ width: size, height: size }}
        title={`${user.name} · ${user.role}`}
      />
    );
  }
  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold flex-shrink-0 ${ringClass}`}
      style={{
        width: size, height: size,
        background: avatarColor,
        color: 'var(--resource-on)',
        fontSize: Math.max(9, size * 0.4),
        letterSpacing: '0.02em',
      }}
      title={`${user.name} · ${user.role}`}
    >
      {user.initials}
    </div>
  );
};

const AvatarStack = ({ ids, size = 22, max = 4 }) => {
  const users = ids.map(getUser).filter(Boolean);
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((u, i) => (
        <div key={u.id} style={{ marginLeft: i === 0 ? 0 : -6 }}>
          <Avatar user={u} size={size} ring />
        </div>
      ))}
      {extra > 0 && (
        <div
          className="rounded-full flex items-center justify-center text-[10px] font-semibold ring-2 ring-[var(--surface)]"
          style={{ width: size, height: size, marginLeft: -6, background: 'var(--surface-3)', color: 'var(--text-dim)' }}
        >
          +{extra}
        </div>
      )}
    </div>
  );
};

// ── Pills ───────────────────────────────────────────────────────
const StatusPill = ({ status, size = 'sm', solid = false }) => {
  const s = getStatus(status);
  if (!s) return null;
  const px = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md ${px} font-medium`}
      style={{ background: solid ? s.color : colorAlpha(s.color, 13), color: solid ? 'var(--resource-on)' : s.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: solid ? 'currentColor' : s.color }}></span>
      {s.label}
    </span>
  );
};

// ── Type dropdown content (selector + creator) ─────────────────
const TYPE_PICKER_ICONS  = ['film','camera','mic','video','music','play','image','monitor','smartphone','briefcase','zap','megaphone','star','layers','globe','folder','archive','clock'];
const TYPE_PICKER_COLORS = ['var(--resource-violet)','var(--resource-blue)','var(--resource-teal)','var(--resource-coral)','var(--warn)','var(--resource-pink)','var(--resource-green)','var(--danger)','var(--resource-green)','var(--resource-orange)','var(--info)','var(--resource-neutral)'];

// ── TypeForm — formulario reutilizable para crear/editar tipos ──
const TypeForm = ({ initial = {}, onSubmit, onCancel, submitLabel = 'Crear' }) => {
  const [label, setLabel] = useState(initial.label || '');
  const [icon,  setIcon]  = useState(initial.icon  || 'film');
  const [color, setColor] = useState(initial.color || 'var(--resource-violet)');
  const labelRef = useRef(null);

  useEffect(() => { setTimeout(() => labelRef.current?.focus(), 0); }, []);

  const submit = () => {
    if (!label.trim()) return;
    onSubmit({ label: label.trim(), icon, color });
  };

  return (
    <div className="p-2 space-y-2.5" onClick={(e) => e.stopPropagation()}>
      <input
        ref={labelRef}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
        placeholder="Nombre del tipo…"
        className="w-full px-2.5 py-1.5 field text-[13px]"
       
      />
      <div>
        <div className="text-[10px] font-semibold tracking-[0.15em] uppercase mb-1.5" style={{ color: 'var(--text-muted)' }}>Ícono</div>
        <div className="grid grid-cols-6 gap-1">
          {TYPE_PICKER_ICONS.map(ic => (
            <button key={ic} onClick={() => setIcon(ic)}
              className="flex items-center justify-center rounded-md transition"
              style={{ width: 32, height: 32, background: icon === ic ? 'var(--accent-soft)' : 'var(--surface-3)', color: icon === ic ? 'var(--accent)' : 'var(--text-dim)', outline: icon === ic ? '1.5px solid var(--accent)' : 'none' }}
            >
              <Icon name={ic} size={14} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold tracking-[0.15em] uppercase mb-1.5" style={{ color: 'var(--text-muted)' }}>Color</div>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_PICKER_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} className="rounded-full transition"
              style={{ width: 20, height: 20, background: c, outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between pt-0.5">
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: colorAlpha(color, 13) }}>
          <Icon name={icon} size={12} style={{ color }} />
          <span className="text-[12px] font-medium" style={{ color }}>{label || 'Vista previa'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={onCancel} className="text-[11px] px-2 py-1 rounded hover:bg-[var(--surface-3)]" style={{ color: 'var(--text-muted)' }}>Cancelar</button>
          <button onClick={submit} disabled={!label.trim()} className="text-[11px] font-semibold px-2.5 py-1 rounded disabled:opacity-40" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const TypeDropdownContent = ({ allTypes, currentType, onSelect, onCreateCustomType, onUpdateCustomType, onDeleteCustomType }) => {
  // mode: null | 'create' | { edit: typeId }
  const [mode, setMode] = useState(null);
  const editing = mode && mode.edit ? allTypes.find(t => t.id === mode.edit) : null;

  if (mode === 'create') {
    return (
      <>
        <div className="px-2.5 py-1.5 text-[11px] font-semibold tracking-wider uppercase flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          <Icon name="plus" size={11} /> Nuevo tipo
        </div>
        <TypeForm
          onSubmit={(data) => { onCreateCustomType({ id: 'ct_' + Date.now() + Math.random().toString(36).slice(2, 5), ...data }); setMode(null); }}
          onCancel={() => setMode(null)}
          submitLabel="Crear"
        />
      </>
    );
  }

  if (editing) {
    return (
      <>
        <div className="px-2.5 py-1.5 text-[11px] font-semibold tracking-wider uppercase flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          <Icon name="edit" size={11} /> Editar tipo
        </div>
        <TypeForm
          initial={editing}
          onSubmit={(data) => { onUpdateCustomType(editing.id, data); setMode(null); }}
          onCancel={() => setMode(null)}
          submitLabel="Guardar"
        />
      </>
    );
  }

  return (
    <>
      {allTypes.map(t => (
        <div key={t.id} className="group flex items-center gap-0.5">
          <button
            onClick={() => onSelect(t.id)}
            className={`flex-1 text-left px-2.5 py-1.5 rounded-md text-[13px] flex items-center gap-2 transition-colors ${currentType === t.id ? 'bg-[var(--surface-3)]' : 'hover:bg-[var(--surface-3)]'}`}
          >
            <Icon name={t.icon} size={13} style={{ color: resolveThemeColor(t.color) }} />
            <span className="flex-1">{t.label}</span>
            {currentType === t.id && <Icon name="check" size={12} style={{ color: 'var(--accent)' }} />}
          </button>
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 mr-0.5 transition-opacity">
            <button
              onClick={() => setMode({ edit: t.id })}
              className="p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-muted)] hover:text-white"
              title="Editar"
            >
              <Icon name="edit" size={11} />
            </button>
            <button
              onClick={() => onDeleteCustomType(t.id)}
              className="p-1 rounded hover:bg-[var(--surface-3)] text-[var(--text-muted)] hover:text-[var(--danger)]"
              title="Eliminar"
            >
              <Icon name="trash" size={11} />
            </button>
          </div>
        </div>
      ))}

      <div className="my-1 mx-1 hair-t" />

      <button
        onClick={() => setMode('create')}
        className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] flex items-center gap-2 transition-colors hover:bg-[var(--surface-3)]"
        style={{ color: 'var(--text-muted)' }}
      >
        <Icon name="plus" size={12} /> Agregar tipo
      </button>
    </>
  );
};

const TypePill = ({ type, size = 'sm', solid = false }) => {
  const t = getType(type);
  if (!t) return null;
  const px = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md ${px} font-medium border max-w-full overflow-hidden`}
      style={{
        borderColor: solid ? t.color : colorAlpha(t.color, 27),
        color: solid ? 'var(--resource-on)' : t.color,
        background: solid ? t.color : colorAlpha(t.color, 7),
      }}>
      <Icon name={t.icon} size={11} style={{ flexShrink: 0 }} />
      <span className="truncate">{t.label}</span>
    </span>
  );
};

const PriorityBadge = ({ priority, solid = false }) => {
  const p = getPrio(priority);
  if (!p) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${solid ? 'px-2.5 py-1 rounded-md' : ''}`}
      style={{ background: solid ? p.color : 'transparent', color: solid ? 'var(--resource-on)' : p.color }}
    >
      <Icon name="flag" size={11} />
      {p.label}
    </span>
  );
};

// ── Property row (Notion-style) ─────────────────────────────────
// Etiqueta y valor lado a lado en los dos tamaños; lo que cambia es el ancho
// de la etiqueta. Los 140px del escritorio no entran en un teléfono, pero
// apilarlas duplicaba el alto de la lista y obligaba a scrollear de más. La
// más ancha ("Responsables") mide 101px, y ahí no cabía ningún valor al lado.
//
// En el teléfono cada propiedad es una unidad que fluye: etiqueta chica
// arriba, valor abajo, y el contenedor las acomoda de a dos por renglón
// bajando la que no entra. flex-1 con min-w las deja todas del mismo ancho en
// vez de dejar huecos según el largo del contenido.
const PropRow = ({ icon, label, children }) => (
  <div className="flex-1 min-w-[136px] flex flex-col gap-1
                  md:min-w-0 md:grid md:grid-cols-[140px_1fr] md:gap-3 md:items-start md:py-1.5">
    <div className="flex items-center gap-1.5 md:gap-2 text-[11px] md:text-[12px] text-[var(--text-muted)] md:pt-1 whitespace-nowrap">
      <Icon name={icon} size={13} />
      <span>{label}</span>
    </div>
    <div className="min-w-0">{children}</div>
  </div>
);

// ── Editable text ───────────────────────────────────────────────
const InlineEdit = ({ value, onChange, placeholder, className = '', multiline = false }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };

  if (editing) {
    return multiline ? (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        rows={3}
        className={`${className} w-full bg-[var(--surface-2)] rounded px-2 py-1.5 resize-none`}
      />
    ) : (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
        className={`${className} w-full bg-[var(--surface-2)] rounded px-2 py-1`}
      />
    );
  }
  return (
    <div
      onClick={() => setEditing(true)}
      className={`${className} cursor-text rounded px-2 py-1 -mx-2 hover:bg-[var(--surface-2)] transition-colors`}
    >
      {value || <span className="text-[var(--text-muted)]">{placeholder}</span>}
    </div>
  );
};

// ── Select dropdowns ────────────────────────────────────────────
const Dropdown = ({ trigger, children, align = 'left', width = 220 }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen(o => !o)}>{trigger}</div>
      {open && (
        <div
          className={`absolute z-50 mt-1 rounded-lg border anim-scale-in shadow-2xl ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ width, background: 'var(--surface-2)', borderColor: 'var(--border-2)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-1">{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>
        </div>
      )}
    </div>
  );
};

const MenuItem = ({ children, onClick, active }) => (
  <button
    onClick={onClick}
    className={`w-full text-left px-2.5 py-1.5 rounded-md text-[13px] flex items-center gap-2 transition-colors ${active ? 'bg-[var(--surface-3)]' : 'hover:bg-[var(--surface-3)]'}`}
  >
    {children}
  </button>
);

// ── Mention rendering ───────────────────────────────────────────
const renderWithMentions = (text) => {
  const parts = text.split(/(@[A-Za-zÀ-ÿ]+(?:\s[A-Za-zÀ-ÿ]+)?)/g);
  return parts.map((p, i) => {
    if (p.startsWith('@')) {
      return (
        <span key={i} className="rounded px-1 font-medium" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          {p}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
};

// ── Cover ───────────────────────────────────────────────────────
const Cover = ({ cover, height = 180, className = '' }) => {
  if (cover.type === 'image') {
    return (
      <div className={`relative overflow-hidden ${className}`} style={{ height }}>
        <img src={cover.value} alt="" className="w-full h-full object-cover" />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,.76) 0%, rgba(0,0,0,.24) 52%, rgba(0,0,0,.04) 100%)' }}
        ></div>
      </div>
    );
  }
  return <div className={className} style={{ height, background: cover.value }}></div>;
};

// El título vive encima de la portada, no encima de la superficie del tema.
// Para colores sólidos se elige el texto con mayor contraste WCAG; sobre una
// foto el degradado de Cover garantiza una base oscura y estable para blanco.
const coverTextColor = (cover) => {
  if (cover?.type === 'image') return '#ffffff';
  const value = typeof cover?.value === 'string' ? cover.value.trim() : '';
  if (value.startsWith('var(')) return 'var(--text)';
  const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return '#ffffff';
  const hex = match[1].length === 3
    ? match[1].split('').map(char => char + char).join('')
    : match[1];
  const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
  const luminance = (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#111113';
};

// ── Cover editor ────────────────────────────────────────────────
const COVER_PRESETS = [
  '#0a0a0b', '#0f1923', '#1a0a2e', '#0a1628', '#1f0a14',
  '#1a1200', '#0a2010', '#2a1000', '#111827', '#1a1016',
];

const CoverEditor = ({ cover, onChange, projectId, deliverables = [] }) => {
  // Las imágenes de ESTA tarea. Elegir la portada es elegir entre lo que ya se
  // subió acá — antes había que ir a la fila del recurso y volver, y con dos
  // imágenes no quedaba claro cuál estaba puesta.
  const imagenes = (deliverables || []).filter(item =>
    item.kind === 'photos' && /^https?:\/\//i.test(String(item.url || '')));
  const [open, setOpen]           = useState(false);
  const [pos, setPos]             = useState({ top: 0, right: 0 });
  const [urlVal, setUrlVal]       = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const btnRef   = useRef(null);
  const panelRef = useRef(null);
  const fileRef  = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!btnRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const openPanel = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    setOpen(v => !v);
  };

  const applyUrl = () => {
    if (!urlVal.trim()) return;
    if (!FrameAttachments.validateImageUrl(urlVal)) {
      window.frameToast?.('Ingresá una URL http o https válida.');
      return;
    }
    onChange({ type: 'image', value: urlVal.trim() });
    setUrlVal('');
    setOpen(false);
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const validation = FrameAttachments.validateImageFile(file);
    if (!validation.ok) { window.frameToast?.(validation.message); return; }
    if (!window.storage) { window.frameToast?.('Storage todavía no está disponible.'); return; }
    setUploading(true);
    setProgress(0);
    try {
      const name = FrameAttachments.safeFileName(file.name);
      const path = `frame-covers/${projectId || 'general'}/${Date.now()}_${name}`;
      const task = window.storage.ref(path).put(file, { contentType: file.type });
      const snapshot = await FrameAttachments.waitForUpload(task, { onProgress: setProgress });
      const url = await snapshot.ref.getDownloadURL();
      onChange({ type: 'image', value: url });
      setOpen(false);
    } catch (err) {
      console.error('[FRAME] Subir portada:', err);
      window.frameToast?.(FrameAttachments.storageErrorMessage(err));
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  // Panel rendered via portal → escapes overflow:hidden of the modal
  const panel = open && ReactDOM.createPortal(
    <div
      ref={panelRef}
      className="anim-scale-in"
      style={{
        position: 'fixed', top: pos.top, right: pos.right,
        width: 268, zIndex: 9999,
        background: 'var(--surface-2)',
        borderRadius: 14,
        border: '1px solid var(--border-2)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        padding: '16px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Archivos de esta tarea ── */}
      {imagenes.length > 0 && (
        <>
          <div className="ui-section-label mb-2">Usar archivo como portada</div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {imagenes.slice(0, 9).map(item => {
              const puesta = cover?.type === 'image' && cover.value === item.url;
              return (
                <button
                  key={item.id}
                  onClick={() => { onChange({ type: 'image', value: item.url }); setOpen(false); }}
                  title={item.name}
                  aria-label={'Usar ' + item.name + ' como portada'}
                  aria-pressed={puesta}
                  className="relative aspect-square rounded-lg overflow-hidden transition hover:scale-105"
                  style={{ boxShadow: puesta ? '0 0 0 2px var(--accent)' : '0 0 0 1px var(--border)' }}
                >
                  <img src={item.url} alt="" className="w-full h-full object-cover" />
                  {puesta && (
                    <span className="absolute inset-0 flex items-center justify-center"
                          style={{ background: 'rgba(0,0,0,.45)', color: 'var(--accent)' }}>
                      <Icon name="check" size={14} strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── Colores ── */}
      <div className="ui-section-label mb-3">Color de fondo</div>
      <div className="grid grid-cols-5 gap-2 mb-4">
        {COVER_PRESETS.map(c => (
          <button
            key={c}
            onClick={() => { onChange({ type: 'color', value: c }); setOpen(false); }}
            className="aspect-square rounded-lg border-2 transition hover:scale-105"
            style={{
              background: c,
              borderColor: cover.type === 'color' && cover.value === c ? 'var(--accent)' : 'var(--border)',
              minHeight: 36,
            }}
          />
        ))}
      </div>

      {/* ── Subir archivo ── */}
      <div className="ui-section-label mb-2">Subir imagen</div>
      {uploading ? (
        <div className="space-y-1.5 mb-3">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
            <div className="h-full transition duration-200" style={{ width: `${progress}%`, background: 'var(--accent)' }}></div>
          </div>
          <div className="text-[11px] text-center font-mono" style={{ color: 'var(--accent)' }}>{progress}% — subiendo…</div>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full mb-3 py-2 rounded-lg text-[12px] font-medium border border-dashed flex items-center justify-center gap-2 transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          style={{ borderColor: 'var(--border-2)', color: 'var(--text-dim)' }}
        >
          <Icon name="upload" size={13} />
          Elegir imagen
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      {/* ── URL manual ── */}
      <div className="ui-section-label mb-2">URL de imagen</div>
      <div className="flex gap-2">
        <input
          value={urlVal}
          onChange={(e) => setUrlVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyUrl(); }}
          placeholder="https://…"
          className="flex-1 px-2.5 py-1.5 field text-[12px]"
          style={{ background: 'var(--surface-3)', borderColor: 'var(--border-2)', color: 'var(--text)' }}
        />
        <button
          onClick={applyUrl}
          disabled={!urlVal.trim()}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
        >
          OK
        </button>
      </div>

      {cover.type === 'image' && (
        <button
          onClick={() => { onChange({ type: 'color', value: '#0a0a0b' }); setOpen(false); }}
          className="mt-3 w-full text-center text-[11px] text-[var(--text-muted)] hover:text-white border-t border-app pt-3"
        >
          Quitar imagen
        </button>
      )}
    </div>,
    capaEstudio()
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={openPanel}
        className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium"
        style={{ background: 'rgba(0,0,0,0.55)', color: 'white', backdropFilter: 'blur(6px)' }}
      >
        <Icon name="image" size={12} /> Portada
      </button>
      {panel}
    </>
  );
};

// ── PROJECT MODAL ───────────────────────────────────────────────
const ProjectModal = ({ project, onClose, onUpdate, onDelete, onSetWorkspaceVisibility, workspaces = [], activeWorkspaceId, onNavigate, projects = [], currentUserId, team = [], clients = [], onCreateClient, customTypes = [], kanbanColumns = [], onCreateCustomType, onUpdateCustomType, onDeleteCustomType, workspaceKind = 'personal', clientPortalToken = '' }) => {
  const collaborationEnabled = workspaceKind === 'team';
  // Lookup que prioriza el equipo real de Firestore sobre los datos seed
  const resolveUser = (id) => team.find(m => m.id === id) || getUser(id);
  // Cuando Firestore ya cargó los tipos (customTypes.length > 0) los usa directamente;
  // si aún está cargando, muestra los predefinidos como fallback
  const allTypes = customTypes.length > 0 ? customTypes : PROJECT_TYPES;
  const allStatuses = kanbanColumns.length > 0 ? kanbanColumns : STATUSES.filter(status => status.id !== 'archived');
  const [tab, setTab]                         = useState('overview'); // overview | comments
  const [newComment, setNewComment]           = useState('');
  const [comments, setComments]               = useState(() => project?.comments || []);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [activity, setActivity]               = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityOpen, setActivityOpen]       = useState(false);
  const [editingCheckId, setEditingCheckId]   = useState(null);
  const [editingCheckText, setEditingCheckText] = useState('');
  const editCheckRef = useRef(null);
  const [dragCheckId, setDragCheckId]     = useState(null); // ítem que se está arrastrando
  const [dragOverCheckId, setDragOverCheckId] = useState(null); // ítem sobre el que se suelta
  const [editingDvId, setEditingDvId]     = useState(null);
  const [editingDvData, setEditingDvData] = useState({});
  const editDvNameRef = useRef(null);
  const [confirmDel, setConfirmDel]       = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState(() =>
    project.workspaceIds?.length ? project.workspaceIds : [project.workspaceId]
  );
  // Una escritura pendiente (p. ej. renombrar) no debe hacer desaparecer el
  // selector. El guardado confirma existencia y miembros contra el servidor.
  const availableWorkspaces = workspaces;

  useEffect(() => {
    setSelectedWorkspaceIds(project.workspaceIds?.length ? project.workspaceIds : [project.workspaceId]);
  }, [project.id, JSON.stringify(project.workspaceIds || [])]);

  const toggleWorkspaceVisibility = (workspaceId) => {
    if (workspaceId === project.workspaceId) return;
    if (!selectedWorkspaceIds.includes(workspaceId) && selectedWorkspaceIds.length >= 5) {
      window.frameToast?.('Una tarea puede mostrarse en un máximo de 5 tableros.');
      return;
    }
    setSelectedWorkspaceIds(current => current.includes(workspaceId)
      ? current.filter(id => id !== workspaceId)
      : [...current, workspaceId]);
  };

  const saveWorkspaceVisibility = async () => {
    if (!onSetWorkspaceVisibility || savingVisibility) return;
    setSavingVisibility(true);
    try {
      await onSetWorkspaceVisibility(project, selectedWorkspaceIds);
      setVisibilityOpen(false);
    } catch {
      // El handler ya muestra el error; se mantiene abierto para reintentar.
    } finally {
      setSavingVisibility(false);
    }
  };

  // ── Listener de comentarios en tiempo real ────────────────────
  useEffect(() => {
    if (!collaborationEnabled) {
      setComments(project?.comments || []);
      setCommentsLoading(false);
      return;
    }
    if (!project?.id) return;
    const col = window.db
      .collection('frame_projects')
      .doc(project.id)
      .collection('comments');
    const unsub = col.orderBy('at', 'asc').onSnapshot((snap) => {
      // Compatibilidad no destructiva: los comentarios antiguos permanecen
      // en el array del documento y se combinan en memoria. No se copian a la
      // subcolección porque el cliente no puede acreditar la autoría ajena.
      const legacy = (project.comments || []).map(c => ({ ...c, _legacy: true }));
      const remote = snap.docs.map(d => ({ id: d.id, ...d.data(), _legacy: false }));
      const byId = new Map(legacy.map(c => [c.id, c]));
      remote.forEach(c => byId.set(c.id, c));
      setComments([...byId.values()].sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))));
      setCommentsLoading(false);
    }, (err) => {
      console.error('Comments listener error:', err);
      setComments(project.comments || []);
      setCommentsLoading(false);
    });
    return () => unsub();
  }, [project?.id, collaborationEnabled, project?.comments]);

  useEffect(() => {
    if (!project?.id) return;
    const col = window.db.collection('frame_projects').doc(project.id).collection('activity');
    const unsub = col.orderBy('at', 'desc').limit(30).onSnapshot((snap) => {
      setActivity(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setActivityLoading(false);
    }, (err) => {
      console.error('Activity listener error:', err);
      setActivity([]);
      setActivityLoading(false);
    });
    return () => unsub();
  }, [project?.id]);

  if (!project) return null;

  // ── Navegación entre proyectos ────────────────────────────────
  const navList   = projects.length > 0 ? projects : [];
  const navIdx    = navList.findIndex(p => p.id === project.id);
  const prevId    = navIdx > 0 ? navList[navIdx - 1].id : null;
  const nextId    = navIdx >= 0 && navIdx < navList.length - 1 ? navList[navIdx + 1].id : null;
  const navLabel  = navList.length > 0 ? `${navIdx + 1} / ${navList.length}` : null;

  // ── Teclado: Esc cierra, ← → navega ──────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
      if (typing) return;
      if (e.key === 'ArrowLeft'  && prevId && onNavigate) onNavigate(prevId);
      if (e.key === 'ArrowRight' && nextId && onNavigate) onNavigate(nextId);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, onNavigate, prevId, nextId]);

  // El debounce y el guardado por campos viven en handleUpdateProject
  // (app.jsx): ahí se sabe cuál era el estado anterior para calcular qué
  // cambió, y sirve para todas las vistas, no sólo para este modal.
  const upd = (patch) => onUpdate({ ...project, ...patch });
  const updField = (key) => (val) => upd({ [key]: val });

  const toggleAssignee = (uid) => {
    const has = project.assignees.includes(uid);
    upd({ assignees: has ? project.assignees.filter(x => x !== uid) : [...project.assignees, uid] });
  };

  const toggleCheck = (id) => {
    upd({ checklist: project.checklist.map(c => c.id === id ? { ...c, done: !c.done } : c) });
  };
  const addCheck = (text) => {
    if (!text.trim()) return;
    upd({ checklist: [...project.checklist, { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 5), text: text.trim(), done: false }] });
  };
  const removeCheck = (id) => upd({ checklist: project.checklist.filter(c => c.id !== id) });

  // ── Reordenar checklist (drag & drop) ─────────────────────────
  const reorderCheck = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const list = [...project.checklist];
    const fromIdx = list.findIndex(c => c.id === fromId);
    const toIdx   = list.findIndex(c => c.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = list.splice(fromIdx, 1); // saca el ítem arrastrado
    list.splice(toIdx, 0, moved);            // lo inserta en la posición destino
    upd({ checklist: list });
  };

  const startEditCheck = (c) => {
    setEditingCheckId(c.id);
    setEditingCheckText(c.text);
    setTimeout(() => { editCheckRef.current?.focus(); editCheckRef.current?.select(); }, 0);
  };
  const saveEditCheck = () => {
    if (!editingCheckId) return;
    const text = editingCheckText.trim();
    if (text) {
      upd({ checklist: project.checklist.map(c => c.id === editingCheckId ? { ...c, text } : c) });
    }
    setEditingCheckId(null);
    setEditingCheckText('');
  };
  const cancelEditCheck = () => { setEditingCheckId(null); setEditingCheckText(''); };

  const addComment = () => {
    if (!newComment.trim()) return;
    const comment = {
      id:     'cm' + Date.now() + Math.random().toString(36).slice(2, 5),
      userId: currentUserId,
      text:   newComment.trim(),
      // ISO completo, con la Z. Al recortar a 16 caracteres se perdía el huso:
      // el valor quedaba en UTC pero sin marcarlo, así que al releerlo con
      // new Date() se interpretaba como hora local y el comentario aparecía
      // 6 horas en el futuro (Honduras es UTC-6).
      at:     new Date().toISOString(),
    };
    // ── Detectar @menciones y notificar ──────────────────────
    if (window.pushNotif) {
      const mentionRe = /@([A-Za-zÀ-ÿ]+(?:\s[A-Za-zÀ-ÿ]+)?)/g;
      // Combinar USERS seed + equipo real de Firestore (sin duplicados)
      const allMembers = [...USERS];
      team.forEach(m => { if (!allMembers.find(u => u.id === m.id)) allMembers.push(m); });
      const mentioned = new Set();
      let m;
      while ((m = mentionRe.exec(comment.text)) !== null) {
        const fragment = m[1].toLowerCase();
        const u = allMembers.find(u => u.name && u.name.toLowerCase().startsWith(fragment));
        if (u && u.id !== currentUserId) mentioned.add(u.id);
      }
      const sender = resolveUser(currentUserId);
      const preview = comment.text.length > 80 ? comment.text.slice(0, 80) + '…' : comment.text;
      mentioned.forEach(uid => window.pushNotif(uid, {
        type: 'mention',
        body: `${sender?.name || 'Alguien'} te mencionó: "${preview}"`,
        projectId: project.id,
        projectTitle: project.title,
        workspaceId: activeWorkspaceId || project.workspaceId,
      }));
    }
    setNewComment('');
    window.db.collection('frame_projects').doc(project.id)
      .collection('comments').doc(comment.id).set(comment)
      .catch(err => {
        console.error('Error al enviar comentario:', err);
        setComments(prev => [...prev, comment]); // fallback optimista
      });
  };

  const deleteComment = (commentId) => {
    const comment = comments.find(c => c.id === commentId);
    setComments(prev => prev.filter(c => c.id !== commentId));
    if (comment?._legacy) {
      if (comment.userId === currentUserId) {
        upd({ comments: (project.comments || []).filter(c => c.id !== commentId) });
      }
      return;
    }
    window.db.collection('frame_projects').doc(project.id)
      .collection('comments').doc(commentId).delete()
      .catch(err => console.error('Error al eliminar comentario:', err));
  };

  const addTag = (text) => {
    if (!text.trim()) return;
    upd({ tags: [...new Set([...project.tags, text.trim()])] });
  };
  const removeTag = (t) => upd({ tags: project.tags.filter(x => x !== t) });

  const updateDeliverable = (id, patch) => upd({ deliverables: project.deliverables.map(dv => dv.id === id ? { ...dv, ...patch } : dv) });

  const startEditDv = (dv) => {
    setEditingDvId(dv.id);
    setEditingDvData({ name: dv.name, kind: dv.kind, url: dv.url || '' });
    setTimeout(() => { editDvNameRef.current?.focus(); editDvNameRef.current?.select(); }, 0);
  };
  const saveEditDv = () => {
    if (!editingDvId) return;
    const name = editingDvData.name?.trim();
    if (name) updateDeliverable(editingDvId, { name, kind: editingDvData.kind, url: editingDvData.url?.trim() || '' });
    setEditingDvId(null);
    setEditingDvData({});
  };
  const cancelEditDv = () => { setEditingDvId(null); setEditingDvData({}); };

  // Visible salvo que se diga lo contrario, igual que las tareas con
  // clientVisible. No se usa `status` para esto: ese campo venía en 'pending'
  // por defecto, así que todo lo subido hasta ahora arrancaría oculto — que
  // era justamente el problema. Sin el campo, se muestra.
  const toggleDeliverableVisible = (id) => {
    upd({ deliverables: project.deliverables.map(dv =>
      dv.id === id ? { ...dv, clientVisible: dv.clientVisible === false } : dv) });
  };
  const addDeliverable    = (dv)  => upd({ deliverables: [...project.deliverables, dv] });
  const removeDeliverable = (id)  => {
    const item = project.deliverables.find(dv => dv.id === id);
    if (item?.storagePath && window.storage) {
      window.storage.ref(item.storagePath).delete()
        .catch(() => window.frameToast?.('Se eliminó el entregable de la tarea, pero no se pudo borrar su archivo.'));
    }
    upd({ deliverables: project.deliverables.filter(dv => dv.id !== id) });
  };

  const addTimelineItem = (item) => upd({ timeline: [...project.timeline, item] });
  const toggleTimeline  = (id)   => upd({ timeline: project.timeline.map(t => t.id === id ? { ...t, status: t.status === 'done' ? 'pending' : 'done' } : t) });
  const removeTimeline  = (id)   => upd({ timeline: project.timeline.filter(t => t.id !== id) });

  const progress = progressOf(project);
  const days = daysUntil(project.deadline);
  const isUrgent = days >= 0 && days < 3 && !isClosed(project);

  return (
    <div className="fixed inset-0 z-50 backdrop flex items-stretch justify-end anim-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-[1200px] h-full surface border-l border-app overflow-hidden flex flex-col anim-slide-right"
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--surface)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-app">
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <Icon name="folder" size={13} />
            <span>{project.client}</span>
            <span>›</span>
            <span className="text-[var(--text-dim)]">Tarea</span>
            {/* Navegación posicional */}
            {navLabel && onNavigate && (
              <div className="flex items-center gap-0.5 ml-2">
                <button
                  onClick={() => prevId && onNavigate(prevId)}
                  disabled={!prevId}
                  className="p-1 rounded hover:bg-[var(--surface-2)] disabled:opacity-25 transition-colors"
                  title="Tarea anterior (←)"
                >
                  <Icon name="chevronLeft" size={13} />
                </button>
                <span className="text-[11px] font-mono px-1 select-none">{navLabel}</span>
                <button
                  onClick={() => nextId && onNavigate(nextId)}
                  disabled={!nextId}
                  className="p-1 rounded hover:bg-[var(--surface-2)] disabled:opacity-25 transition-colors"
                  title="Tarea siguiente (→)"
                >
                  <Icon name="chevronRight" size={13} />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isUrgent && (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md mr-2"
                style={{ background: 'var(--danger-soft-2)', color: 'var(--danger)' }}>
                <Icon name="alert" size={11} /> URGENTE
              </span>
            )}
            {onSetWorkspaceVisibility && availableWorkspaces.length > 1 && (
              <div className="relative">
                <button
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
                  title="Elegir en qué tableros aparece"
                  aria-label="Mostrar en tableros"
                  onClick={() => setVisibilityOpen(v => !v)}
                  disabled={savingVisibility}
                >
                  <Icon name="layers" size={15} />
                  <span className="hidden sm:inline text-[12px] font-medium">Tableros</span>
                </button>
                {visibilityOpen && (
                  <div className="absolute right-0 top-full mt-1 surf-float p-1.5 min-w-[270px] z-50 anim-scale-in">
                    <div className="px-2 py-1.5 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
                      Mostrar esta tarea en
                    </div>
                    {availableWorkspaces.map(w => {
                      const selected = selectedWorkspaceIds.includes(w.id);
                      const principal = w.id === project.workspaceId;
                      return (
                      <button
                        key={w.id}
                        onClick={() => toggleWorkspaceVisibility(w.id)}
                        disabled={savingVisibility || principal}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left hover:bg-[var(--surface-3)] disabled:opacity-50"
                      >
                        <span
                          className="w-4 h-4 rounded flex items-center justify-center border"
                          style={{ background: selected ? 'var(--accent)' : 'transparent', borderColor: selected ? 'var(--accent)' : 'var(--border-2)', color: 'var(--accent-on)' }}
                        >
                          {selected && <Icon name="check" size={10} />}
                        </span>
                        <span className="flex-1 text-[12px] font-medium truncate">{w.name}</span>
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{principal ? 'Principal' : (w.kind === 'team' ? 'Equipo' : 'Personal')}</span>
                      </button>
                    );})}
                    <button
                      onClick={saveWorkspaceVisibility}
                      disabled={savingVisibility}
                      className="w-full mt-1 px-3 py-2 rounded-md text-[12px] font-semibold disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
                    >
                      {savingVisibility ? 'Guardando…' : 'Guardar tableros'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* Delete button — two-step confirm */}
            {onDelete && (
              confirmDel ? (
                <div className="flex items-center gap-1 mr-1">
                  <span className="text-[12px] font-medium" style={{ color: 'var(--danger)' }}>¿Eliminar?</span>
                  <button
                    onClick={() => { onDelete(project.id); onClose(); }}
                    className="px-2.5 py-1 rounded-md text-[12px] font-semibold"
                    style={{ background: 'var(--danger-soft-2)', color: 'var(--danger)' }}
                  >
                    Sí
                  </button>
                  <button
                    onClick={() => setConfirmDel(false)}
                    className="px-2.5 py-1 rounded-md text-[12px]"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  className="p-2 rounded-md hover:bg-[var(--danger-soft)] text-[var(--text-dim)] hover:text-[var(--danger)] transition-colors"
                  title="Eliminar tarea"
                  onClick={() => setConfirmDel(true)}
                >
                  <Icon name="trash" size={15} />
                </button>
              )
            )}
            <button aria-label="Cerrar" className="p-2 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-dim)]" onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        {/* Cover */}
        <div className="relative">
          <Cover cover={project.cover} height={180} />
          <CoverEditor cover={project.cover} onChange={(cover) => upd({ cover })} projectId={project.id} deliverables={project.deliverables} />
          <div className="absolute bottom-4 left-6 right-6">
            <div className="flex items-center gap-2 mb-2">
              <TypePill type={project.type} size="md" solid />
              <StatusPill status={project.status} size="md" solid />
              <PriorityBadge priority={project.priority} solid />
            </div>
            <h1
              className="font-display text-3xl md:text-4xl font-bold balance"
              style={{
                letterSpacing: '-0.02em',
                color: coverTextColor(project.cover),
                textShadow: project.cover?.type === 'image' ? '0 1px 3px rgba(0,0,0,.72)' : 'none',
              }}
            >
              <InlineEdit value={project.title} onChange={updField('title')} className="!px-0 !py-0 hover:!bg-transparent" />
            </h1>
          </div>
        </div>

        {/* Body — dos columnas en escritorio, una sola que baja en el
            teléfono. La columna de propiedades medía 420px fijos: en una
            pantalla de 375 se salía entera, y con ella todo lo de adentro.
            Acá el que scrollea es el contenedor, no cada columna. */}
        <div className="flex-1 overflow-y-auto md:overflow-hidden md:grid md:grid-cols-[420px_1fr]">
          {/* Left: properties
              En el teléfono las propiedades fluyen: se acomodan de a dos por
              renglón y la que no entra baja sola. Una lista de siete filas de
              ancho completo desperdiciaba media pantalla en blanco a la
              derecha de "Reel" o "Alta". En escritorio sigue siendo una lista
              vertical, que con 420px de ancho se lee mejor así. */}
          <div className="border-b md:border-b-0 md:border-r border-app md:overflow-y-auto p-5
                          flex flex-wrap gap-x-5 gap-y-3 content-start
                          md:block md:space-y-1">
            <div className="ui-section-label basis-full mb-3">Propiedades</div>

            <PropRow icon="briefcase" label="Cliente">
              <ClientAutocomplete
                value={project.client}
                onChange={updField('client')}
                clients={clients}
                onCreateClient={onCreateClient}
              />
            </PropRow>

            <PropRow icon="film" label="Tipo">
              <Dropdown
                trigger={<button className="text-left -mx-2 px-2 py-1 rounded hover:bg-[var(--surface-2)] w-full"><TypePill type={project.type} /></button>}
                width={260}
              >
                {(close) => (
                  <TypeDropdownContent
                    allTypes={allTypes}
                    currentType={project.type}
                    onSelect={(id) => { upd({ type: id }); close(); }}
                    onCreateCustomType={onCreateCustomType}
                    onUpdateCustomType={onUpdateCustomType}
                    onDeleteCustomType={onDeleteCustomType}
                  />
                )}
              </Dropdown>
            </PropRow>

            <PropRow icon="dot" label="Estado">
              <Dropdown trigger={<button className="text-left -mx-2 px-2 py-1 rounded hover:bg-[var(--surface-2)] w-full"><StatusPill status={project.status} /></button>}>
                {(close) => allStatuses.map(s => (
                  <MenuItem key={s.id} onClick={() => {
                    if (collaborationEnabled && s.id !== project.status && window.pushNotif) {
                      const changer = resolveUser(currentUserId);
                      const newSt   = getStatus(s.id);
                      project.assignees.forEach(uid => {
                        if (uid !== currentUserId) {
                          window.pushNotif(uid, {
                            type: 'status',
                            body: `${changer?.name || 'Alguien'} cambió "${project.title}" → ${newSt?.label || s.id}`,
                            projectId: project.id,
                            projectTitle: project.title,
                            workspaceId: activeWorkspaceId || project.workspaceId,
                          });
                        }
                      });
                    }
                    upd({ status: s.id });
                    close();
                  }} active={project.status === s.id}>
                    <span className="w-2 h-2 rounded-full" style={{ background: resolveThemeColor(s.color) }}></span>
                    <span>{s.label}</span>
                  </MenuItem>
                ))}
              </Dropdown>
            </PropRow>

            <PropRow icon="flag" label="Prioridad">
              <Dropdown trigger={<button className="text-left -mx-2 px-2 py-1 rounded hover:bg-[var(--surface-2)] w-full"><PriorityBadge priority={project.priority} /></button>}>
                {(close) => PRIORITIES.map(p => (
                  <MenuItem key={p.id} onClick={() => { upd({ priority: p.id }); close(); }} active={project.priority === p.id}>
                    <Icon name="flag" size={11} style={{ color: p.color }} />
                    <span>{p.label}</span>
                  </MenuItem>
                ))}
              </Dropdown>
            </PropRow>

            {collaborationEnabled && <PropRow icon="users" label="Responsables">
              <Dropdown trigger={
                <button className="-mx-2 px-2 py-1 rounded hover:bg-[var(--surface-2)] w-full text-left">
                  {project.assignees.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <AvatarStack ids={project.assignees} size={22} />
                      <span className="text-[12px] text-[var(--text-dim)]">
                        {project.assignees.map(id => resolveUser(id)?.name.split(' ')[0]).join(', ')}
                      </span>
                    </div>
                  ) : <span className="text-[var(--text-muted)] text-sm">Sin asignar</span>}
                </button>
              } width={240}>
                {team.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">
                    Sin integrantes registrados
                  </div>
                ) : team.map(u => (
                  <MenuItem key={u.id} onClick={() => toggleAssignee(u.id)} active={project.assignees.includes(u.id)}>
                    <Avatar user={u} size={20} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] truncate">{u.name}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{u.role}</div>
                    </div>
                    {project.assignees.includes(u.id) && <Icon name="check" size={13} style={{ color: 'var(--accent)' }} />}
                  </MenuItem>
                ))}
              </Dropdown>
            </PropRow>}



            <PropRow icon="calendar" label="Fecha de entrega">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={project.deadline}
                  // Opcional: conserva el compromiso aunque la sesión cambie.
                  onChange={(e) => updField('deadline')(e.target.value)}
                  // Tarea de una venta de LOOPA: la entrega la fija la venta.
                  disabled={!!window.FrameLoopa?.isFromSale(project)}
                  title={window.FrameLoopa?.isFromSale(project) ? 'La entrega la fija la venta en LOOPA' : undefined}
                  className="text-sm hover:bg-[var(--surface-2)] rounded px-2 py-1 -mx-2 cursor-pointer"
                  style={{ colorScheme: 'var(--color-scheme)' }}
                />
                {isUrgent && <span className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>en {days}d</span>}
                {project.deadline && days < 0 && !isClosed(project) && <span className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>Atrasada {Math.abs(days)}d</span>}
              </div>
            </PropRow>

            {/* La sesión se gestiona desde el calendario; la entrega es el compromiso. */}

            {collaborationEnabled && <PropRow icon="zap" label="Presupuesto">
              <div className="flex items-center gap-1 text-sm">
                <span className="text-[var(--text-muted)]">{project.currency}</span>
                <InlineEdit
                  value={String(project.budget)}
                  // Math.max(0, …) porque un presupuesto negativo no significa
                  // nada y además ensuciaba los totales de Analytics.
                  onChange={(v) => updField('budget')(Math.max(0, parseInt(v, 10) || 0))}
                  className="font-mono tnum"
                />
              </div>
            </PropRow>}

            <PropRow icon="hash" label="Tags">
              <div className="flex flex-wrap gap-1.5 -mx-1">
                {project.tags.map(t => (
                  <span key={t} className="group flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-[var(--surface-2)] text-[var(--text-dim)]">
                    #{t}
                    <button className="opacity-0 group-hover:opacity-100" onClick={() => removeTag(t)}>
                      <Icon name="x" size={10} />
                    </button>
                  </span>
                ))}
                <TagAdd onAdd={addTag} />
              </div>
            </PropRow>

            {/* Progress mini */}
            {/* basis-full: el progreso no es una propiedad, es una sección
                aparte. Sin esto entraba en el flujo y se acomodaba al lado de
                Tags, partiendo la barra por la mitad del panel. */}
            <div className="basis-full mt-6 pt-4 border-t border-app">
              <div className="flex items-center justify-between mb-2">
                <div className="ui-section-label">Progreso</div>
                <div className="text-xs font-mono" style={{ color: 'var(--accent)' }}>{progress}%</div>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                <div className="h-full transition duration-500" style={{ width: progress + '%', background: 'var(--accent)' }}></div>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-2">
                {project.checklist.filter(c => c.done).length} de {project.checklist.length} tareas completadas
              </div>
            </div>
          </div>

          {/* Right: content */}
          <div className="md:overflow-y-auto min-w-0">
            {/* Tabs */}
            <div className="sticky top-0 z-10 surface border-b border-app px-6 flex items-center gap-1" style={{ background: 'var(--surface)' }}>
              {[
                {id:'overview',label:'Visión general',icon:'list'},
                ...(clientPortalToken
                  ? [{id:'comments',label:'Comentarios',icon:'message'}]
                  : collaborationEnabled
                    ? [{id:'comments',label:'Comentarios',icon:'message'}]
                    : []),
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-3 text-[13px] flex items-center gap-2 border-b-2 -mb-px transition-colors ${tab === t.id ? 'border-[var(--accent)] text-white' : 'border-transparent text-[var(--text-dim)] hover:text-white'}`}
                >
                  <Icon name={t.icon} size={13} />
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="p-6 space-y-8">
                {/* Brief */}
                <section>
                  <SectionTitle icon="edit">Brief / Descripción</SectionTitle>
                  <DescriptionEditor blocks={project.description} onChange={updField('description')} projectId={project.id} />
                </section>

                {/* Checklist */}
                <section>
                  <SectionTitle icon="check" right={`${project.checklist.filter(c => c.done).length}/${project.checklist.length}`}>
                    Checklist
                  </SectionTitle>
                  <div className="space-y-1">
                    {project.checklist.map(c => {
                      const isDragging = dragCheckId === c.id;
                      const isDragOver = dragOverCheckId === c.id && dragCheckId && dragCheckId !== c.id;
                      return (
                      <div
                        key={c.id}
                        onDragOver={(e) => { if (dragCheckId) { e.preventDefault(); setDragOverCheckId(c.id); } }}
                        onDrop={(e) => { e.preventDefault(); reorderCheck(dragCheckId, c.id); setDragCheckId(null); setDragOverCheckId(null); }}
                        className={`group flex items-center gap-1.5 py-1 px-2 -mx-2 rounded hover:bg-[var(--surface-2)] transition ${isDragging ? 'opacity-40' : ''}`}
                        style={isDragOver ? { boxShadow: 'inset 0 2px 0 var(--accent)' } : undefined}
                      >
                        {/* Handle de arrastre */}
                        <span
                          draggable
                          onDragStart={(e) => { setDragCheckId(c.id); e.dataTransfer.effectAllowed = 'move'; }}
                          onDragEnd={() => { setDragCheckId(null); setDragOverCheckId(null); }}
                          className="flex-shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text-dim)] transition-opacity -ml-1"
                          title="Arrastrar para reordenar"
                        >
                          <Icon name="drag" size={13} />
                        </span>
                        <span className={`check flex-shrink-0 ${c.done ? 'on' : ''}`} onClick={() => toggleCheck(c.id)}>
                          {c.done && <Icon name="check" size={11} strokeWidth={3} />}
                        </span>
                        {editingCheckId === c.id ? (
                          <input
                            ref={editCheckRef}
                            value={editingCheckText}
                            onChange={(e) => setEditingCheckText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); saveEditCheck(); }
                              if (e.key === 'Escape') cancelEditCheck();
                            }}
                            onBlur={saveEditCheck}
                            className="flex-1 text-[13px] bg-transparent outline-none border-b"
                            style={{ borderColor: 'var(--accent)', color: 'var(--text)' }}
                          />
                        ) : (
                          <span
                            onClick={() => startEditCheck(c)}
                            className={`flex-1 text-[13px] cursor-text ${c.done ? 'line-through text-[var(--text-muted)]' : ''}`}
                            title="Clic para editar"
                          >
                            {c.text}
                          </span>
                        )}
                        <button onClick={() => removeCheck(c.id)} className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] flex-shrink-0">
                          <Icon name="trash" size={13} />
                        </button>
                      </div>
                      );
                    })}
                    <ChecklistAdd onAdd={addCheck} />
                  </div>
                </section>

                {/* Recursos */}
                <section>
                  <SectionTitle icon="upload" right={project.deliverables.length ? `${project.deliverables.length}` : ''}>Recursos</SectionTitle>
                  <div className="space-y-1.5">
                    {project.deliverables.map(dv => (
                      <div key={dv.id} className="group field border-app surface-2 overflow-hidden">
                        {editingDvId === dv.id ? (
                          /* ── Modo edición ── */
                          <div className="p-2.5 space-y-2">
                            {/* Fila 1: nombre + tipo */}
                            <div className="flex items-center gap-2">
                              <Icon name={editingDvData.kind === 'video' ? 'film' : editingDvData.kind === 'photos' ? 'camera' : editingDvData.kind === 'file' ? 'paperclip' : 'mic'} size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                              <input
                                ref={editDvNameRef}
                                value={editingDvData.name}
                                onChange={(e) => setEditingDvData(d => ({ ...d, name: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEditDv(); } if (e.key === 'Escape') cancelEditDv(); }}
                                className="flex-1 text-[13px] bg-transparent outline-none border-b"
                                style={{ borderColor: 'var(--accent)', color: 'var(--text)' }}
                                placeholder="Nombre del entregable"
                              />
                              <select
                                value={editingDvData.kind}
                                onChange={(e) => setEditingDvData(d => ({ ...d, kind: e.target.value }))}
                                className="text-[11px] px-1.5 py-0.5 rounded border cursor-pointer"
                               
                              >
                                <option value="video">Video</option>
                                <option value="photos">Foto</option>
                                <option value="audio">Audio</option>
                              </select>
                            </div>
                            {/* Fila 2: URL */}
                            <div className="flex items-center gap-2">
                              <Icon name="link" size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                              <input
                                value={editingDvData.url}
                                onChange={(e) => setEditingDvData(d => ({ ...d, url: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEditDv(); } if (e.key === 'Escape') cancelEditDv(); }}
                                className="flex-1 text-[12px] bg-transparent outline-none border-b font-mono"
                                style={{ borderColor: 'var(--border-2)', color: 'var(--text-dim)' }}
                                placeholder="https://drive.google.com/…"
                              />
                            </div>
                            {/* Acciones */}
                            <div className="flex items-center justify-end gap-2 pt-0.5">
                              <button onClick={cancelEditDv} className="text-[11px] px-2 py-0.5 rounded" style={{ color: 'var(--text-muted)' }}>Cancelar</button>
                              <button onClick={saveEditDv} className="text-[11px] font-semibold px-2.5 py-0.5 rounded" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>Guardar</button>
                            </div>
                          </div>
                        ) : (
                          /* ── Modo normal ── */
                          <div className="flex items-center gap-3 py-2.5 px-3">
                            {dv.kind === 'photos' && dv.url ? (
                              <img src={dv.url} alt="" className="w-12 h-12 rounded-md object-cover border border-app flex-shrink-0" />
                            ) : (
                              <span className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-3)', color: 'var(--text-dim)' }}>
                                <Icon name={dv.kind === 'video' ? 'external' : dv.kind === 'file' ? 'paperclip' : 'mic'} size={15} />
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              <div
                                onClick={() => startEditDv(dv)}
                                className="text-[13px] cursor-text truncate hover:text-white transition-colors"
                                title="Clic para editar"
                              >{dv.name}</div>
                              <div className="text-[10px] mt-0.5 uppercase tracking-wide truncate" style={{ color: 'var(--text-muted)' }}>
                                {dv.kind === 'photos' ? 'Imagen' : dv.kind === 'file' ? (dv.name.split('.').pop() || 'Archivo') : 'Enlace externo'}
                              </div>
                            </div>
                            {dv.url && (
                              <a href={dv.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex-shrink-0 p-1.5 rounded-md hover:bg-[var(--surface-3)]" style={{ color: 'var(--text-dim)' }} title="Abrir recurso">
                                <Icon name="external" size={13} />
                              </a>
                            )}
                            {/* Interruptor para ocultarle uno al cliente. Va
                                encendido de entrada: lo que se sube es para
                                compartirlo, y esto es la excepción. */}
                            {(() => {
                              const visible = dv.clientVisible !== false;
                              return (
                                <button
                                  onClick={() => toggleDeliverableVisible(dv.id)}
                                  role="switch"
                                  aria-checked={visible}
                                  aria-label={visible ? 'Ocultar al cliente' : 'Mostrar al cliente'}
                                  title={visible ? 'El cliente lo ve' : 'Oculto para el cliente'}
                                  className="flex-shrink-0 relative rounded-full"
                                  style={{ width: 30, height: 17, background: visible ? 'var(--resource-teal)' : 'var(--surface-3)' }}
                                >
                                  <span className="absolute rounded-full"
                                        style={{ width: 13, height: 13, top: 2, left: visible ? 15 : 2,
                                                 background: visible ? 'var(--resource-on)' : 'var(--text-muted)' }} />
                                </button>
                              );
                            })()}
                            <button onClick={() => removeDeliverable(dv.id)} className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] transition-opacity flex-shrink-0">
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    <DeliverableAdd onAdd={addDeliverable} projectId={project.id} />
                  </div>
                </section>

                {/* Timeline */}
                <section>
                  <SectionTitle icon="clock">Timeline interno</SectionTitle>
                  <div className="relative pl-4">
                    {/* La línea va en x=10 porque los puntos, con -left-[11px]
                        dentro del pl-4, quedan centrados ahí. Estaba en x=5 y
                        los puntos se veían montados sobre ella en vez de
                        ensartados. */}
                    <div className="absolute left-[10px] top-1 bottom-1 w-px bg-[var(--border-2)]"></div>
                    {project.timeline.map((t, i) => (
                      <div key={t.id} className="group relative flex items-start gap-3 py-2">
                        <button
                          onClick={() => toggleTimeline(t.id)}
                          title={t.status === 'done' ? 'Marcar pendiente' : 'Marcar como hecho'}
                          className="absolute -left-[11px] top-3 w-2.5 h-2.5 rounded-full hover:scale-125 transition-transform"
                          style={{
                            background: t.status === 'done' ? 'var(--accent)' : 'var(--surface-3)',
                            boxShadow: '0 0 0 4px var(--surface)',
                          }}
                        ></button>
                        <div className="ml-3 flex-1 flex items-center justify-between">
                          <div>
                            <div className={`text-[13px] ${t.status === 'done' ? 'line-through text-[var(--text-dim)]' : ''}`}>{t.label}</div>
                            <div className="text-[11px] text-[var(--text-muted)] font-mono">{fmtDateLong(t.date)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {t.status === 'done' && <span className="text-[10px]" style={{ color: 'var(--accent)' }}>✓ HECHO</span>}
                            <button onClick={() => removeTimeline(t.id)} className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] transition-opacity">
                              <Icon name="trash" size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    <TimelineAdd onAdd={addTimelineItem} />
                  </div>
                </section>

                <section className="border-t border-app pt-4">
                  <button type="button" onClick={() => setActivityOpen(open => !open)} className="w-full flex items-center justify-between rounded-md px-2 py-2 -mx-2 hover:bg-[var(--surface-2)] transition-colors" aria-expanded={activityOpen}>
                    <span className="ui-section-label flex items-center gap-2"><Icon name="clock" size={14} /> Actividad</span>
                    <span className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] font-mono">
                      {activity.length ? `${activity.length} eventos` : ''}
                      <span className={`transition-transform ${activityOpen ? 'rotate-180' : ''}`}><Icon name="chevronDown" size={13} /></span>
                    </span>
                  </button>
                  {activityOpen && (activityLoading ? (
                    <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Cargando actividad…</div>
                  ) : activity.length === 0 ? (
                    <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Sin actividad</div>
                  ) : (
                    <div className="space-y-2">
                      {activity.map(item => (
                        <div key={item.id} className="flex gap-2 text-[12px]">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
                          <div>
                            <span className="font-medium">{item.actorName || 'Alguien'}</span>{' '}
                            <span style={{ color: 'var(--text-dim)' }}>{item.summary}</span>
                            <span className="ml-1.5 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{item.at ? new Date(item.at).toLocaleString('es-HN', { dateStyle: 'short', timeStyle: 'short' }) : ''}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
              </div>
            )}

            {tab === 'comments' && clientPortalToken && (
              <SharedClientComments portalToken={clientPortalToken} projectId={project.id} authorType="studio" authorName={resolveUser(currentUserId)?.name || 'Estudio'} authorAvatar={resolveUser(currentUserId)?.avatar || ''} />
            )}

            {tab === 'comments' && !clientPortalToken && collaborationEnabled && (
              <CommentsTab
                comments={comments}
                commentsLoading={commentsLoading}
                currentUserId={currentUserId}
                team={team}
                resolveUser={resolveUser}
                newComment={newComment}
                setNewComment={setNewComment}
                onSend={addComment}
                onDeleteComment={deleteComment}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SectionTitle = ({ icon, right, children }) => (
  <div className="flex items-center justify-between mb-3">
    <div className="ui-section-label flex items-center gap-2">
      <Icon name={icon} size={14} />
      {children}
    </div>
    {right && <span className="text-[11px] text-[var(--text-muted)] font-mono">{right}</span>}
  </div>
);

const TagAdd = ({ onAdd }) => {
  const [v, setV] = useState('');

  const flush = (raw) => {
    raw.split(/[,;\n]+/).map(t => t.trim()).filter(Boolean).forEach(t => onAdd(t));
  };

  return (
    <input
      value={v}
      onChange={(e) => {
        // Si el usuario escribió una coma, agregar el tag inmediatamente
        if (e.target.value.includes(',')) {
          flush(e.target.value);
          setV('');
        } else {
          setV(e.target.value);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { flush(v); setV(''); }
      }}
      onPaste={(e) => {
        e.preventDefault();
        flush(e.clipboardData.getData('text'));
        setV('');
      }}
      placeholder="+ tag"
      className="px-2 py-0.5 rounded-md text-[11px] bg-transparent border border-dashed border-[var(--border-2)] focus:border-[var(--accent)] hover:border-[var(--text-muted)]"
      style={{ width: 70 }}
    />
  );
};

const ChecklistAdd = ({ onAdd }) => {
  const [v, setV] = useState('');
  return (
    <div className="flex items-center gap-2.5 py-1 px-2 -mx-2">
      <span className="check"></span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { onAdd(v); setV(''); } }}
        placeholder="Agregar tarea…"
        className="flex-1 text-[13px]"
      />
    </div>
  );
};

// ── Deliverable add ─────────────────────────────────────────────
const DeliverableAdd = ({ onAdd, projectId }) => {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const imageRef = useRef(null);
  const documentRef = useRef(null);

  const submitLink = () => {
    const cleanUrl = linkUrl.trim();
    if (!FrameAttachments.validateImageUrl(cleanUrl)) {
      window.frameToast?.('Ingresá un enlace http o https válido.');
      return;
    }
    let fallbackName = 'Enlace compartido';
    try { fallbackName = new URL(cleanUrl).hostname.replace(/^www\./, ''); } catch (_) {}
    onAdd({ id: 'dv' + Date.now() + Math.random().toString(36).slice(2, 5), name: linkName.trim() || fallbackName, kind: 'video', status: 'ready', url: cleanUrl });
    setLinkName('');
    setLinkUrl('');
    setLinkOpen(false);
  };

  const uploadFile = async (event, expectedKind) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !projectId) return;
    const valid = expectedKind === 'photos'
      ? FrameAttachments.validateImageFile(file)
      : FrameAttachments.validateDeliverableFile(file);
    if (!valid.ok) { window.frameToast?.(valid.message); return; }
    if (expectedKind === 'file' && file.type.startsWith('image/')) {
      window.frameToast?.('Para imágenes usá la opción Adjuntar imagen.');
      return;
    }
    if (!window.storage) { window.frameToast?.('Storage todavía no está disponible.'); return; }
    setUploading(true);
    try {
      const storagePath = `frame-deliverables/${projectId}/${Date.now()}_${FrameAttachments.safeFileName(file.name)}`;
      const task = window.storage.ref(storagePath).put(file, { contentType: file.type });
      const snapshot = await FrameAttachments.waitForUpload(task, { timeoutMs: 60000 });
      const url = await snapshot.ref.getDownloadURL();
      onAdd({ id: 'dv' + Date.now() + Math.random().toString(36).slice(2, 5), name: file.name, kind: expectedKind, status: 'ready', url, storagePath, contentType: file.type, size: file.size });
      window.frameToast?.(expectedKind === 'photos' ? 'Imagen adjuntada.' : 'Archivo adjuntado.');
    } catch (err) {
      console.error('Deliverable upload:', err);
      window.frameToast?.(FrameAttachments.storageErrorMessage(err));
    } finally { setUploading(false); }
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={() => imageRef.current?.click()} disabled={uploading} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-md border border-dashed border-[var(--border-2)] text-[12px] font-medium hover:bg-[var(--surface-2)] hover:border-[var(--text-muted)] disabled:opacity-40"><Icon name="image" size={13} /> Imagen</button>
        <button type="button" onClick={() => documentRef.current?.click()} disabled={uploading} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-md border border-dashed border-[var(--border-2)] text-[12px] font-medium hover:bg-[var(--surface-2)] hover:border-[var(--text-muted)] disabled:opacity-40"><Icon name="paperclip" size={13} /> Archivo</button>
        <button type="button" onClick={() => setLinkOpen(open => !open)} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-md border border-dashed border-[var(--border-2)] text-[12px] font-medium hover:bg-[var(--surface-2)] hover:border-[var(--text-muted)]"><Icon name="link" size={13} /> Enlace</button>
      </div>
      <input ref={imageRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => uploadFile(event, 'photos')} disabled={uploading} />
      <input ref={documentRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" className="hidden" onChange={(event) => uploadFile(event, 'file')} disabled={uploading} />
      {uploading && <div className="text-[11px] text-center py-1" style={{ color: 'var(--accent)' }}>Subiendo archivo…</div>}

      {linkOpen && <div className="field p-3 anim-fade-in" style={{ background: 'var(--surface-2)' }}>
        <div className="grid sm:grid-cols-[minmax(120px,.6fr)_minmax(180px,1.4fr)_auto] gap-2">
          <input value={linkName} onChange={(event) => setLinkName(event.target.value)} placeholder="Nombre (opcional)" className="field min-w-0 px-2.5 py-2 text-[12px]" />
          <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitLink(); }} placeholder="https://drive.google.com/…" className="field min-w-0 px-2.5 py-2 text-[12px]" />
          <button onClick={submitLink} disabled={!linkUrl.trim()} className="px-3 py-2 text-[12px] font-semibold rounded-md disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>Agregar enlace</button>
        </div>
      </div>}
    </div>
  );
};

// ── Timeline add ────────────────────────────────────────────────
const TimelineAdd = ({ onAdd }) => {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(() => localISO(new Date(TODAY)));

  const submit = () => {
    if (!label.trim()) return;
    onAdd({ id: 'tl' + Date.now() + Math.random().toString(36).slice(2, 5), label: label.trim(), date, status: 'pending' });
    setLabel('');
    setOpen(false);
  };

  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="mt-2 ml-3 flex items-center gap-2 text-[12px] px-3 py-2 rounded-md border border-dashed border-[var(--border-2)] hover:bg-[var(--surface-2)]" style={{ color: 'var(--text-dim)' }}>
      <Icon name="plus" size={12} /> Agregar hito
    </button>
  );

  return (
    <div className="relative ml-3 mt-2 p-3 field" style={{ background: 'var(--surface-2)' }}>
      {/* El punto era un anillo punteado con el centro transparente y sin
          máscara, así que la línea vertical del timeline se veía pasar por
          dentro. Ahora lleva fondo propio y el mismo anillo del color del
          panel que usan los hitos ya creados: la línea se corta al llegar y
          el punto queda ensartado en ella, no atravesado. */}
      <div className="text-[11px] font-semibold mb-2">Nuevo hito interno</div>
      <div className="flex flex-wrap md:flex-nowrap items-center gap-2">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="Nuevo hito…"
        className="flex-1 min-w-0 basis-full md:basis-auto px-2.5 py-2 rounded-md text-[13px] border"
       
      />
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="px-2 py-2 rounded-md text-[12px] border cursor-pointer"
       
      />
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={() => { setOpen(false); setLabel(''); }} className="px-3 py-1.5 text-[12px] rounded-md" style={{ color: 'var(--text-muted)' }}>Cancelar</button>
        <button onClick={submit} disabled={!label.trim()} className="px-3 py-1.5 text-[12px] font-semibold rounded-md disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>Agregar hito</button>
      </div>
    </div>
  );
};

const DescriptionBlock = ({ blocks, onChange }) => {
  return (
    <div className="prose prose-invert max-w-none text-[15px] leading-relaxed text-[var(--text-dim)] space-y-2 pretty">
      {blocks.map((b, i) => {
        if (b.type === 'p') return <p key={i}>{b.text}</p>;
        if (b.type === 'b') return <p key={i} className="text-white font-semibold">{b.text}</p>;
        if (b.type === 'ul') return (
          <ul key={i} className="list-disc pl-5 space-y-1">
            {b.items.map((it, j) => <li key={j}>{it}</li>)}
          </ul>
        );
        return null;
      })}
    </div>
  );
};

// ── Description editor (click-to-edit) ─────────────────────────
// ── Convierte el formato de bloques antiguo → HTML ───────────────
const blocksToHTML = (blocks) => {
  if (!blocks || blocks.length === 0) return '';
  if (blocks[0]?.type === 'html') return blocks[0].content || '';
  return (blocks || []).map(b => {
    if (b.type === 'p') return `<p>${b.text || ''}</p>`;
    if (b.type === 'b') return `<p><strong>${b.text || ''}</strong></p>`;
    if (b.type === 'ul') return `<ul>${(b.items||[]).map(i=>`<li>${i}</li>`).join('')}</ul>`;
    if (b.type === 'ol') return `<ol>${(b.items||[]).map(i=>`<li>${i}</li>`).join('')}</ol>`;
    return '';
  }).join('');
};

// ── Comprime una imagen usando canvas → devuelve un Blob ─────────
const compressImg = (file, maxW = 1200, quality = 0.80) => new Promise(res => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const scale = Math.min(1, maxW / img.width);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob((blob) => res(blob), 'image/jpeg', quality);
  };
  img.onerror = () => { URL.revokeObjectURL(url); res(null); };
  img.src = url;
});

const DescriptionEditor = ({ blocks, onChange, projectId }) => {
  const editorRef   = useRef(null);
  const fileRef     = useRef(null);
  const imageMenuRef = useRef(null);
  const descriptionSaveTimerRef = useRef(null);
  const descriptionDirtyRef = useRef(false);
  const lastDescriptionHtmlRef = useRef(null);
  const uploadingRef = useRef(false); // evita guardar mientras sube imagen
  const [focused,   setFocused]   = useState(false);
  const [lightbox,  setLightbox]  = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageMenuPosition, setImageMenuPosition] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress,   setProgress]   = useState(0);

  // El documento abierto tambiÃ©n recibe los cambios que lleguen desde otra
  // sesiÃ³n. Si esta persona estÃ¡ escribiendo, no se pisa su borrador local.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || descriptionDirtyRef.current) return;
    const incoming = sanitizeDescHTML(blocksToHTML(blocks));
    if (editor.innerHTML !== incoming) editor.innerHTML = incoming;
    lastDescriptionHtmlRef.current = incoming;
  }, [blocks]);

  useEffect(() => () => {
    if (descriptionSaveTimerRef.current) clearTimeout(descriptionSaveTimerRef.current);
  }, []);

  // Guarda al perder foco (solo si no está subiendo imagen)
  const save = () => {
    if (uploadingRef.current) return;
    // Se limpia también al guardar, no sólo al pintar: pegar desde otra web
    // trae el HTML de origen entero, con scripts y manejadores incluidos.
    const html = sanitizeDescHTML(editorRef.current?.innerHTML || '').trim();
    const empty = html === '' || html === '<br>' || html === '<div><br></div>';
    const next = empty ? '' : html;
    if (next === lastDescriptionHtmlRef.current) {
      descriptionDirtyRef.current = false;
      return;
    }
    lastDescriptionHtmlRef.current = next;
    descriptionDirtyRef.current = false;
    onChange(empty ? [] : [{ type: 'html', content: html }]);
  };

  const scheduleSave = () => {
    descriptionDirtyRef.current = true;
    if (descriptionSaveTimerRef.current) clearTimeout(descriptionSaveTimerRef.current);
    descriptionSaveTimerRef.current = setTimeout(save, 500);
  };

  // Botones de toolbar: preventDefault para no perder foco del editor
  const exec = (cmd, val) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val ?? null);
  };

  const captureEditorRange = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editorRef.current?.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
  };

  const restoreEditorRange = (range) => {
    editorRef.current?.focus();
    if (!range) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const insertRemoteImages = (urls, savedRange) => {
    const safeUrls = (urls || []).map(FrameAttachments.normalizeRemoteImageUrl).filter(Boolean);
    if (safeUrls.length === 0) return;
    restoreEditorRange(savedRange);
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editorRef.current?.contains(range.commonAncestorContainer)) return;

    range.deleteContents();
    const fragment = document.createDocumentFragment();
    let lastNode = null;
    safeUrls.forEach(src => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'Imagen de referencia';
      img.referrerPolicy = 'no-referrer';
      img.loading = 'lazy';
      img.dataset.frameSize = 'lg';
      img.dataset.frameAlign = 'left';
      const br = document.createElement('br');
      fragment.append(img, br);
      lastNode = br;
    });
    range.insertNode(fragment);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    scheduleSave();
  };

  // Sube imagen a Firebase Storage (igual que cover) y la inserta en el cursor
  const uploadAndInsert = async (blob, savedRange = null) => {
    if (!blob) return;
    if (!window.storage) {
      window.frameToast?.('Las imágenes necesitan Storage habilitado en Firebase.');
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    setProgress(0);
    try {
      const path  = `frame-descriptions/${projectId || 'general'}/${Date.now()}.jpg`;
      const stRef = window.storage.ref(path);
      const task  = stRef.put(blob, { contentType: 'image/jpeg' });

      // Timeout obligatorio: si el bucket de Storage no está creado, la tarea
      // no falla — se queda esperando. Sin esto el editor mostraba "subiendo…"
      // para siempre y no había forma de saber que pasaba.
      const snapshot = await FrameAttachments.waitForUpload(task, { onProgress: setProgress });
      const src = await snapshot.ref.getDownloadURL();
      insertRemoteImages([src], savedRange);
    } catch (err) {
      console.error('[FRAME] Subir imagen:', err);
      window.frameToast?.(FrameAttachments.storageErrorMessage(err));
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      setProgress(0);
    }
  };

  // Intercepta imágenes pegadas desde el portapapeles
  const handlePaste = async (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const html = e.clipboardData?.getData('text/html') || '';
    const text = e.clipboardData?.getData('text/plain') || '';
    const source = FrameAttachments.classifyPasteSource({ items, html, text });
    const savedRange = captureEditorRange();

    if (source.kind === 'file') {
      e.preventDefault();
      const file = source.item.getAsFile();
      const validation = FrameAttachments.validateImageFile(file);
      if (!validation.ok) { window.frameToast?.(validation.message); return; }
      const compressed = await compressImg(file);
      if (!compressed) { window.frameToast?.('No se pudo procesar la imagen.'); return; }
      await uploadAndInsert(compressed, savedRange);
      return;
    }

    if (source.kind === 'html-images' || source.kind === 'text-image-url') {
      e.preventDefault();
      insertRemoteImages(source.urls, savedRange);
      window.frameToast?.('Imagen externa insertada. Seguirá disponible mientras el sitio de origen la mantenga pública.');
      return;
    }

    if (source.kind === 'html') {
      // Nunca se deja que HTML externo entre directo al contentEditable.
      e.preventDefault();
      restoreEditorRange(savedRange);
      document.execCommand('insertHTML', false, sanitizeDescHTML(source.html));
      return;
    }

    // Un enlace pegado se convierte en enlace. Pegado como texto plano queda
    // una URL larga cortando el párrafo al medio; así queda legible y se
    // puede abrir.
    const url = text.trim();
    if (/^https?:\/\/\S+$/i.test(url) && !/\s/.test(url)) {
      e.preventDefault();
      restoreEditorRange(savedRange);
      const safe = url.replace(/"/g, '&quot;');
      // Si había texto seleccionado, ese texto pasa a ser el enlace. Pegar
      // encima de una selección no debería borrar lo que se escribió.
      const picked = (savedRange?.toString() || '').trim();
      const label = escapeDescText(picked || shortenUrl(url));
      document.execCommand('insertHTML', false,
        `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>&nbsp;`);
      descriptionDirtyRef.current = true;
      save();
      return;
    }
    // Texto ordinario conserva el comportamiento nativo del navegador.
  };

  // Sube desde selector de archivo
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const validation = FrameAttachments.validateImageFile(file);
    if (!validation.ok) { window.frameToast?.(validation.message); return; }
    const compressed = await compressImg(file);
    if (!compressed) { window.frameToast?.('No se pudo procesar la imagen.'); return; }
    await uploadAndInsert(compressed);
  };

  // Click en imagen → lightbox
  const clearImageSelection = () => {
    editorRef.current?.querySelectorAll('img.frame-image-selected').forEach(img => img.classList.remove('frame-image-selected'));
  };

  const positionImageMenu = (img) => {
    if (!img?.isConnected) return;
    const rect = img.getBoundingClientRect();
    const viewportPadding = 12;
    const menuWidth = Math.min(240, window.innerWidth - viewportPadding * 2);
    const menuHeight = imageMenuRef.current?.offsetHeight || 108;
    const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding));
    const belowTop = rect.bottom + 8;
    const aboveTop = rect.top - menuHeight - 8;
    const showBelow = belowTop + menuHeight <= window.innerHeight - viewportPadding;
    setImageMenuPosition({
      left,
      top: Math.max(viewportPadding, Math.min(showBelow ? belowTop : aboveTop, window.innerHeight - menuHeight - viewportPadding)),
      width: menuWidth,
    });
  };

  useEffect(() => {
    if (!selectedImage) return undefined;
    const reposition = () => positionImageMenu(selectedImage);
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [selectedImage]);

  // La primera posiciÃ³n usa una estimaciÃ³n. Cuando la barra ya se renderizÃ³,
  // se recoloca con su altura real para no salirse en pantallas pequeÃ±as.
  useEffect(() => {
    if (!selectedImage || !imageMenuPosition) return undefined;
    const frame = window.requestAnimationFrame(() => positionImageMenu(selectedImage));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedImage, imageMenuPosition?.width]);

  const closeImageMenu = () => {
    clearImageSelection();
    setSelectedImage(null);
    setImageMenuPosition(null);
  };

  // Cada acción cierra el menú. Antes quedaba abierto y tapaba justo la
  // imagen que acababas de cambiar, así que no se veía el resultado de lo
  // que elegiste. Para hacer otro ajuste, clic en la imagen de nuevo.
  const updateSelectedImage = (attribute, value) => {
    if (!selectedImage || !editorRef.current?.contains(selectedImage)) return;
    selectedImage.setAttribute(attribute, value);
    descriptionDirtyRef.current = true;
    save();
    closeImageMenu();
  };

  const handleClick = (e) => {
    if (e.target.tagName === 'IMG') {
      e.preventDefault();
      clearImageSelection();
      e.target.classList.add('frame-image-selected');
      setSelectedImage(e.target);
      positionImageMenu(e.target);
      return;
    }

    // El navegador no abre enlaces dentro de un contentEditable: sin esto
    // el vínculo se ve azul pero no lleva a ningún lado.
    const link = e.target.closest?.('a[href]');
    if (link && editorRef.current?.contains(link)) {
      e.preventDefault();
      window.open(link.href, '_blank', 'noopener,noreferrer');
      return;
    }

    closeImageMenu();
  };

  // Botón de toolbar reutilizable
  const TB = ({ onMouseDown, title, children, className = '' }) => (
    <button
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(); }}
      title={title}
      className={`px-2 py-1 rounded text-[12px] font-medium select-none text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-3)] transition-colors ${className}`}
    >
      {children}
    </button>
  );

  return (
    <>
      <div
        className="rounded-lg border overflow-hidden transition"
        style={{ borderColor: focused ? 'var(--accent-border)' : 'var(--border-2)' }}
      >
        {/* ── Toolbar ── */}
        <div className="flex items-center gap-0.5 px-2 py-1 hair" style={{ background: 'var(--surface-3)' }}>
          <TB onMouseDown={() => exec('bold')}   title="Negrita (Ctrl+B)"><strong>B</strong></TB>
          <TB onMouseDown={() => exec('italic')} title="Cursiva (Ctrl+I)"><em style={{ fontStyle:'italic' }}>I</em></TB>
          <div className="w-px h-3.5 mx-1 flex-shrink-0" style={{ background: 'var(--border-2)' }} />
          <TB onMouseDown={() => exec('insertUnorderedList')} title="Lista de viñetas">
            <Icon name="list" size={12} />
          </TB>
          <TB onMouseDown={() => exec('insertOrderedList')} title="Lista numerada">
            <span className="font-mono text-[11px]">1.</span>
          </TB>
          <div className="w-px h-3.5 mx-1 flex-shrink-0" style={{ background: 'var(--border-2)' }} />
          {/* Upload imagen */}
          <label
            title="Insertar imagen o pegar un archivo, imagen web o URL con Ctrl+V"
            className={`px-2 py-1 rounded text-[12px] select-none cursor-pointer flex items-center gap-1 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : 'text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-3)]'}`}
          >
            <Icon name="camera" size={12} />
            {uploading && <span className="text-[10px] font-mono animate-pulse">{progress}%</span>}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
          </label>
        </div>

        {selectedImage && imageMenuPosition && ReactDOM.createPortal(
          <div
            ref={imageMenuRef}
            className="fixed z-[10000] flex flex-col items-stretch gap-0.5 rounded-lg border p-1.5 shadow-xl anim-fade-in"
            style={{
              left: imageMenuPosition.left,
              top: imageMenuPosition.top,
              width: imageMenuPosition.width,
              maxWidth: 'calc(100vw - 24px)',
              boxSizing: 'border-box',
              background: 'var(--surface-2)',
              borderColor: 'var(--border-2)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
            }}
          >
            <div className="flex flex-col items-stretch rounded-md border p-0.5" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-3)' }}>
              <TB className="w-full text-left" onMouseDown={() => updateSelectedImage('data-frame-size', 'sm')} title="Ancho pequeño">Pequeña</TB>
              <TB className="w-full text-left" onMouseDown={() => updateSelectedImage('data-frame-size', 'md')} title="Ancho mediano">Mediana</TB>
              <TB className="w-full text-left" onMouseDown={() => updateSelectedImage('data-frame-size', 'lg')} title="Ancho completo">Completa</TB>
            </div>
            <div className="h-px my-1" style={{ background: 'var(--border-2)' }} />
            <TB className="w-full text-left" onMouseDown={() => updateSelectedImage('data-frame-align', 'left')} title="Alinear a la izquierda">Alinear a la izquierda</TB>
            <TB className="w-full text-left" onMouseDown={() => updateSelectedImage('data-frame-align', 'center')} title="Centrar">Centrar</TB>
            <TB className="w-full text-left" onMouseDown={() => updateSelectedImage('data-frame-align', 'right')} title="Alinear a la derecha">Alinear a la derecha</TB>
            <div className="h-px my-1" style={{ background: 'var(--border-2)' }} />
            <TB className="w-full text-left" onMouseDown={() => { const src = selectedImage.src; closeImageMenu(); setLightbox(src); }} title="Abrir imagen a tamaño completo">Abrir imagen</TB>
            <TB className="w-full text-left" onMouseDown={closeImageMenu} title="Cerrar opciones">Cerrar</TB>
          </div>,
          capaEstudio()
        )}

        {/* ── Área editable ── */}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); save(); }}
          onInput={scheduleSave}
          onPaste={handlePaste}
          onClick={handleClick}
          data-placeholder="Escribí el brief…"
          className="desc-editor p-3 text-[15px] leading-relaxed"
          style={{ minHeight: 100, background: 'var(--surface-2)', color: 'var(--text)' }}
        />
      </div>

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center anim-fade-in"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 10, boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-5 right-5 p-2 rounded-full"
            style={{ background: 'rgba(255,255,255,0.12)', color: 'white' }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      )}
    </>
  );
};

const CHAT_EMOJI_GROUPS = [
  { id: 'recent', label: 'Frecuentes', glyph: '✨', emojis: ['👍','❤️','✨','🔥','👏','✅','👀','🙏','😊','🎉','💡','🚀','💯','🙌'] },
  { id: 'faces', label: 'Caras', glyph: '😊', emojis: ['😀','😃','😄','😁','😊','🙂','😉','😍','🥰','😘','😎','🤩','🥳','😂','🤣','🥹','😅','🤔','😮','😢','😭','😤','😴','🫠','🤯','🫡','🤗','🙃'] },
  { id: 'gestures', label: 'Gestos', glyph: '👋', emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤝','👏','🙌','🫶','🙏'] },
  { id: 'celebrate', label: 'Celebrar', glyph: '🎉', emojis: ['🎉','🎊','✨','⭐','🌟','💫','🔥','💥','🚀','🏆','🥇','🎯','💯','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💖','💝','🎁','🥂','🍾','🎈','🎵'] },
  { id: 'work', label: 'Trabajo', glyph: '✅', emojis: ['✅','☑️','✔️','❌','⚠️','🚩','📌','📍','📅','⏰','⏳','💡','📝','📎','📁','📤','📥','🔗','🔍','📊','📈','📉','💬','👀','🛠️','⚙️','🔒','🔓'] },
  { id: 'objects', label: 'Objetos', glyph: '💡', emojis: ['💡','📱','💻','⌨️','🖥️','📷','🎥','🎙️','🎧','🔊','🔔','📢','✏️','🖊️','🖌️','🎨','📦','✉️','📨','🗂️','🧩','🔑','🧠','🧭','🛒','💳','📣','🔋'] },
];

const ChatEmojiPicker = ({ id, onPick, onClose, className = '' }) => {
  const [category, setCategory] = useState(CHAT_EMOJI_GROUPS[0].id);
  const group = CHAT_EMOJI_GROUPS.find(item => item.id === category) || CHAT_EMOJI_GROUPS[0];
  return <div id={id} role="dialog" aria-label="Selector de emojis" className={`w-[286px] max-w-[calc(100vw-48px)] p-2.5 rounded-xl surf-float z-30 ${className}`}>
    <div className="flex items-center justify-between px-1 pb-2">
      <div><div className="text-[12px] font-semibold">Emojis</div><div className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{group.label}</div></div>
      <button type="button" onClick={onClose} aria-label="Cerrar selector de emojis" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--surface-3)]" style={{ color: 'var(--text-dim)' }}><Icon name="x" size={12} /></button>
    </div>
    <div role="tablist" aria-label="Categorías de emojis" className="grid grid-cols-6 gap-1 pb-2 border-b border-app">
      {CHAT_EMOJI_GROUPS.map(item => <button type="button" key={item.id} role="tab" aria-label={item.label} aria-selected={category === item.id} onClick={() => setCategory(item.id)} className="h-8 rounded-md text-[15px] flex items-center justify-center transition-colors" style={{ background: category === item.id ? 'var(--surface-3)' : 'transparent', opacity: category === item.id ? 1 : 0.62 }}>{item.glyph}</button>)}
    </div>
    <div role="tabpanel" aria-label={group.label} className="grid grid-cols-7 gap-0.5 pt-2 max-h-[188px] overflow-y-auto">
      {group.emojis.map((emoji, index) => <button type="button" key={`${emoji}-${index}`} onClick={() => onPick(emoji)} aria-label={`Insertar ${emoji}`} className="w-9 h-9 rounded-md flex items-center justify-center text-[18px] hover:bg-[var(--surface-3)] transition-colors">{emoji}</button>)}
    </div>
  </div>;
};

const CommentsTab = ({ comments, commentsLoading, currentUserId, team = [], resolveUser, newComment, setNewComment, onSend, onDeleteComment }) => {
  const resolve = resolveUser || ((id) => team.find(m => m.id === id) || getUser(id));
  const me = resolve(currentUserId);
  const [showMentions, setShowMentions] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const inputRef = useRef(null);

  const insertMention = (user) => {
    setNewComment(c => c + (c.endsWith('@') ? user.name + ' ' : '@' + user.name + ' '));
    setShowMentions(false);
    inputRef.current?.focus();
  };

  return (
    <div className="p-5 md:p-7 flex flex-col h-full min-h-[360px]">
      <div className="flex-1 space-y-5 overflow-y-auto pr-1" aria-live="polite">
        {commentsLoading && (
          <div className="flex justify-center items-center min-h-[180px]">
            <div className="flex gap-1.5">
              {[0,1,2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent)', animationDelay: `${i * 200}ms`, opacity: 0.6 }}></div>
              ))}
            </div>
          </div>
        )}
        {!commentsLoading && comments.length === 0 && (
          <div className="min-h-[180px] flex flex-col items-center justify-center text-center px-6">
            <Icon name="message" size={20} style={{ color: 'var(--text-muted)' }} />
            <div className="text-[13px] font-medium mt-3">Sin comentarios todavía</div>
          </div>
        )}
        {comments.map(c => {
          const u = resolve(c.userId);
          const isOwn = c.userId === currentUserId;
          return (
            <div key={c.id} className="group flex gap-3">
              <Avatar user={u} size={32} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[13px] font-semibold">{u?.name}</span>
                  <span className="text-[11px] text-[var(--text-muted)]">{u?.role}</span>
                  <span className="text-[11px] text-[var(--text-muted)]">·</span>
                  <span className="text-[11px] text-[var(--text-muted)]">{relativeTime(c.at)}</span>
                  {isOwn && onDeleteComment && (
                    <button
                      type="button"
                      onClick={() => onDeleteComment(c.id)}
                      aria-label="Eliminar comentario"
                      className="ml-auto w-7 h-7 flex items-center justify-center rounded-md md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-2)] transition"
                      title="Eliminar comentario"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
                <div className="text-[15px] leading-relaxed pretty">{renderWithMentions(c.text)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 mt-6 pt-4 border-t border-app" style={{ background: 'var(--surface)' }}>
        <div className="flex gap-3 items-start">
          <div className="mt-1"><Avatar user={me} size={32} /></div>
          <div className="relative flex-1 min-w-0 composer rounded-xl border border-app focus-within:border-[var(--border-2)] transition-colors" style={{ background: 'var(--surface-2)' }}>
            <div className="relative">
              <textarea
                ref={inputRef}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === '@') setShowMentions(true);
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); }
                  if (e.key === 'Escape') setEmojiOpen(false);
                }}
                placeholder="Agregar un comentario…"
                rows={1}
                className="w-full px-3 pt-3 pb-1 text-[13px] leading-5 resize-none bg-transparent min-h-[48px] max-h-[120px]"
              />
              {showMentions && (
                <div className="absolute bottom-full mb-2 left-0 surface-2 border border-app rounded-lg shadow-2xl p-1 z-10" style={{ minWidth: 200 }}>
                  <div className="text-[10px] font-semibold tracking-wider text-[var(--text-muted)] px-2 py-1">EQUIPO</div>
                  {USERS.map(u => (
                    <MenuItem key={u.id} onClick={() => insertMention(u)}>
                      <Avatar user={u} size={20} />
                      <span className="text-[12px]">{u.name}</span>
                    </MenuItem>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setShowMentions(s => !s)} aria-label="Mencionar a alguien" aria-pressed={showMentions} className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--surface-3)]" style={{ color: 'var(--text-dim)' }}><Icon name="at" size={16} /></button>
                <button type="button" onClick={() => setEmojiOpen(open => !open)} aria-label="Agregar emoji" aria-expanded={emojiOpen} aria-controls="team-emoji-picker" className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--surface-3)]" style={{ color: 'var(--text-dim)' }}><Icon name="emoji" size={17} /></button>
              </div>
              <button
                type="button"
                onClick={onSend}
                disabled={!newComment.trim()}
                aria-label="Enviar comentario"
                className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--surface-3)] transition disabled:opacity-25"
                style={{ color: 'var(--text-dim)' }}
              >
                <Icon name="arrowUp" size={17} strokeWidth={1.9} />
              </button>
            </div>
            {emojiOpen && <ChatEmojiPicker id="team-emoji-picker" onClose={() => setEmojiOpen(false)} onPick={emoji => { setNewComment(value => value + emoji); setEmojiOpen(false); inputRef.current?.focus(); }} className="absolute left-0 bottom-full mb-2" />}
          </div>
        </div>
      </div>
    </div>
  );
};

const SharedClientComments = ({ portalToken, projectId, authorType, authorName = '', authorAvatar = '', studioAvatar = '', clientInitials = '', clientColor = '' }) => {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [editingId, setEditingId] = useState('');
  const [editingText, setEditingText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const imageRef = useRef(null);
  const listRef = useRef(null);
  const composerRef = useRef(null);
  const initialsFor = value => String(value || '?').trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();

  // Sólo el propio comentario lleva foto. Antes todo comentario del estudio
  // usaba studioAvatar —la foto del dueño del tablero—, así que si escribía
  // otra persona del equipo el cliente veía su nombre con la cara de otro.
  // Las iniciales del autor siempre son correctas.
  const avatarFor = comment =>
    (comment.authorType === authorType && comment.authorName === authorName && authorAvatar) ? authorAvatar : '';
  const clientAvatarStyle = { background: resolveThemeColor(clientColor || 'var(--resource-blue)'), color: 'var(--resource-on)' };

  // Un comentario es un registro, no un mensaje. "hace 2 h" sirve mientras
  // mirás; a los tres días no dice nada y este hilo es la prueba de lo que se
  // acordó. Va la fecha, y la hora al lado.
  const selloDeTiempo = (iso) => {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return '';
    const hoy = new Date(TODAY);
    const mismoAno = dt.getFullYear() === hoy.getFullYear();
    const fecha = dt.toLocaleDateString('es-ES', mismoAno
      ? { day: '2-digit', month: 'short' }
      : { day: '2-digit', month: 'short', year: 'numeric' });
    const hora = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return `${fecha}, ${hora}`;
  };

  useEffect(() => {
    if (!portalToken || !projectId) return;
    setLoading(true);
    const unsub = window.db.collection('frame_client_portals').doc(portalToken).collection('comments')
      .onSnapshot(snap => {
        setComments(snap.docs.map(doc => doc.data()).filter(item => item.projectId === projectId).sort((a, b) => String(a.at).localeCompare(String(b.at))));
        setLoading(false);
      }, () => { setComments([]); setLoading(false); });
    return () => unsub();
  }, [portalToken, projectId]);

  // Baja al final sólo cuando llega un comentario nuevo con el hilo ya
  // abierto. Al abrir se lee desde donde empieza, como cualquier registro;
  // saltar al fondo es comportamiento de chat y deja al que entra sin saber
  // dónde está parado.
  const vistos = useRef(null);
  useEffect(() => {
    if (loading || !listRef.current) return;
    if (vistos.current !== null && comments.length > vistos.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    vistos.current = comments.length;
  }, [comments.length, loading]);

  const uploadImage = async (file) => {
    if (!file || uploading) return;
    const valid = FrameAttachments.validateImageFile(file);
    if (!valid.ok) { window.frameToast?.(valid.message); return; }
    if (!window.storage) { window.frameToast?.('Storage todavía no está disponible.'); return; }
    setUploading(true);
    try {
      const safeName = FrameAttachments.safeFileName(file.name || 'imagen.jpg');
      const storagePath = `frame-client-comments/${portalToken}/${projectId}/${Date.now()}_${safeName}`;
      const task = window.storage.ref(storagePath).put(file, { contentType: file.type });
      const snapshot = await FrameAttachments.waitForUpload(task, { timeoutMs: 60000 });
      const url = await snapshot.ref.getDownloadURL();
      setAttachment({ url, name: (file.name || 'Imagen').slice(0, 200) });
    } catch (error) {
      console.error('Shared chat image upload:', error);
      window.frameToast?.(FrameAttachments.storageErrorMessage(error));
    } finally { setUploading(false); }
  };

  const onPaste = (event) => {
    const imageFile = [...(event.clipboardData?.items || [])]
      .find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    if (!imageFile) return;
    event.preventDefault();
    uploadImage(imageFile);
  };

  const send = async () => {
    const cleanText = text.trim();
    const cleanName = (authorName || (authorType === 'client' ? 'Cliente' : 'Estudio')).trim().slice(0, 80);
    if ((!cleanText && !attachment) || !cleanName || sending || uploading) return;
    setSending(true);
    const id = 'pc' + Date.now() + Math.random().toString(36).slice(2, 8);
    try {
      const comment = { id, projectId, authorType, authorName: cleanName, text: cleanText.slice(0, 2000), at: new Date().toISOString() };
      if (attachment) {
        comment.attachmentUrl = attachment.url;
        comment.attachmentName = attachment.name;
      }
      await window.db.collection('frame_client_portals').doc(portalToken).collection('comments').doc(id).set(comment);
      setText('');
      setAttachment(null);
     
      if (composerRef.current) composerRef.current.style.height = '';
    } catch { window.frameToast?.('No se pudo enviar el comentario. Revisá la conexión.'); }
    finally { setSending(false); }
  };

  const saveEdit = async (commentId) => {
    const cleanText = editingText.trim().slice(0, 2000);
    if (!cleanText) return;
    try {
      await window.db.collection('frame_client_portals').doc(portalToken).collection('comments').doc(commentId)
        .update({ text: cleanText, editedAt: new Date().toISOString() });
      setEditingId('');
      setEditingText('');
    } catch { window.frameToast?.('No se pudo editar el comentario.'); }
  };

  const deleteComment = async (commentId) => {
    try {
      await window.db.collection('frame_client_portals').doc(portalToken).collection('comments').doc(commentId).delete();
      setConfirmDeleteId('');
    } catch { window.frameToast?.('No se pudo eliminar el comentario.'); }
  };

  const composerAvatar = authorType === 'studio' ? authorAvatar : '';

  return <section className={`flex flex-col max-w-[900px] ${authorType === 'client' ? 'min-h-[280px] pt-1' : 'min-h-[420px] p-5 md:p-7'}`}>
    <div ref={listRef} className="flex-1 min-h-0 space-y-5 overflow-y-auto pr-1 md:pr-2" aria-live="polite">
      {loading && <div className="min-h-[160px] flex items-center justify-center"><div className="flex gap-1.5">{[0,1,2].map(index => <span key={index} className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--text-muted)', animationDelay: `${index * 160}ms` }} />)}</div></div>}
      {!loading && comments.length === 0 && <div className="min-h-[160px] flex flex-col items-center justify-center text-center px-6"><Icon name="message" size={20} style={{ color: 'var(--text-muted)' }} /><div className="text-[13px] font-medium mt-3">Sin comentarios todavía</div></div>}
      {!loading && comments.map(comment => <article key={comment.id} className="flex gap-3 group rounded-lg py-1">
        {avatarFor(comment) ? <img src={avatarFor(comment)} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" /> : <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0" style={comment.authorType === 'client' ? clientAvatarStyle : { background: 'var(--surface-3)', color: '#fff' }}>{comment.authorType === 'client' ? (clientInitials || initialsFor(comment.authorName)) : initialsFor(comment.authorName)}</div>}
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[12px] font-semibold">{comment.authorName}</span>
              {/* Quién es cada uno, dicho. En un registro entre dos partes no
                  alcanza con el nombre: el cliente no tiene por qué saber que
                  "Rocío" es del estudio. */}
              <span className="text-[9px] px-1.5 py-0.5 rounded tracking-wide uppercase"
                    style={comment.authorType === 'studio'
                      ? { background: 'var(--surface-3)', color: 'var(--text-dim)' }
                      : { background: 'var(--accent-soft)', color: 'var(--text-dim)' }}>
                {comment.authorType === 'studio' ? 'Estudio' : 'Cliente'}
              </span>
              <span className="text-[10px] tnum" title={new Date(comment.at).toLocaleString('es-ES')} style={{ color: 'var(--text-muted)' }}>{selloDeTiempo(comment.at)}{comment.editedAt ? ' · editado' : ''}</span>
            </div>
            {/* Editar y borrar, sólo lo que escribió el estudio. Antes el
                botón de eliminar aparecía también sobre los comentarios del
                cliente: la parte que rinde cuentas podía borrar lo que dijo
                la otra. En una herramienta que se vende como garantía, eso
                vacía la garantía. Lo que dice el cliente queda. */}
            {authorType === 'studio' && comment.authorType === 'studio' && <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              {comment.authorType === 'studio' && comment.text && <button type="button" onClick={() => { setEditingId(comment.id); setEditingText(comment.text); setConfirmDeleteId(''); }} aria-label="Editar comentario" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--surface-2)]" title="Editar comentario"><Icon name="edit" size={13} /></button>}
              {confirmDeleteId === comment.id ? <><button type="button" onClick={() => deleteComment(comment.id)} className="px-2 h-7 rounded-md text-[10px] hover:bg-[var(--surface-2)]" style={{ color: 'var(--danger)' }}>Eliminar</button><button type="button" onClick={() => setConfirmDeleteId('')} className="px-2 h-7 rounded-md text-[10px] hover:bg-[var(--surface-2)]" style={{ color: 'var(--text-muted)' }}>Cancelar</button></> : <button type="button" onClick={() => { setConfirmDeleteId(comment.id); setEditingId(''); }} aria-label="Eliminar comentario" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--surface-2)]" title="Eliminar comentario"><Icon name="trash" size={13} /></button>}
            </div>}
          </div>
          {editingId === comment.id ? <div className="mt-2 rounded-lg border border-app overflow-hidden" style={{ background: 'var(--surface-2)' }}><textarea autoFocus value={editingText} onChange={event => setEditingText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); saveEdit(comment.id); } if (event.key === 'Escape') setEditingId(''); }} maxLength={2000} rows={2} className="w-full px-3 py-2 text-[13px] bg-transparent resize-none" /><div className="flex justify-end gap-1 p-1.5 border-t border-app"><button type="button" onClick={() => setEditingId('')} className="text-[10px] px-2 h-7 rounded-md hover:bg-[var(--surface-3)]" style={{ color: 'var(--text-muted)' }}>Cancelar</button><button type="button" onClick={() => saveEdit(comment.id)} disabled={!editingText.trim()} className="text-[10px] px-2.5 h-7 rounded-md disabled:opacity-40" style={{ background: 'var(--text)', color: 'var(--bg)' }}>Guardar</button></div></div> : comment.text && <div className="text-[13px] leading-5 pretty whitespace-pre-wrap mt-0.5">{comment.text}</div>}
          {comment.attachmentUrl && <a href={comment.attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 max-w-full group/image"><img src={comment.attachmentUrl} alt={comment.attachmentName || 'Imagen adjunta'} className="max-w-full w-auto max-h-72 rounded-xl object-cover border border-app transition-opacity group-hover/image:opacity-90" /><span className="block mt-1 text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{comment.attachmentName}</span></a>}
        </div>
      </article>)}
    </div>

    <div className="mt-auto pt-4 border-t border-app">
      {attachment && <div className="mb-3 ml-0 sm:ml-11 inline-flex max-w-full items-center gap-2 p-2 rounded-xl border border-app" style={{ background: 'var(--surface-2)' }}><img src={attachment.url} alt="Vista previa" className="w-14 h-14 rounded-lg object-cover" /><span className="max-w-[180px] truncate text-[11px]">{attachment.name}</span><button type="button" onClick={() => setAttachment(null)} aria-label="Quitar imagen" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--surface-3)]"><Icon name="x" size={12} /></button></div>}
      <div className="relative flex gap-3 items-start">
        {composerAvatar ? <img src={composerAvatar} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-1" /> : <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0 mt-1" style={authorType === 'client' ? clientAvatarStyle : { background: 'var(--surface-3)', color: '#fff' }}>{authorType === 'client' ? (clientInitials || initialsFor(authorName)) : initialsFor(authorName)}</div>}
        <div className="flex-1 min-w-0 composer rounded-xl border border-app focus-within:border-[var(--border-2)] transition-colors" style={{ background: 'var(--surface-2)' }}>
          {/* Enter hace un salto de línea, no envía. Un comentario se piensa
              antes de mandarlo: con Enter enviando, un párrafo de tres
              renglones salía como tres comentarios sueltos y quedaba así en
              el registro. Se envía con el botón, a propósito. */}
          <textarea ref={composerRef} value={text} onChange={event => setText(event.target.value)} onInput={event => { event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`; }} onPaste={onPaste} maxLength={2000} rows={2} className="w-full px-3 pt-3 pb-1 text-[13px] leading-5 resize-none bg-transparent min-h-[68px] max-h-[160px]" placeholder="Escribí un comentario…" />
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => imageRef.current?.click()} disabled={uploading || !!attachment} title="Adjuntar imagen" aria-label="Adjuntar imagen" className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--surface-3)] disabled:opacity-40" style={{ color: 'var(--text-dim)' }}><Icon name="paperclip" size={15} /></button>
              {uploading && <span className="text-[10px] ml-1" style={{ color: 'var(--accent)' }}>Subiendo…</span>}
            </div>
            {/* Botón con palabra y no una flecha: es la única forma de enviar
                desde que Enter hace salto de línea, así que tiene que verse. */}
            <button type="button" onClick={send} disabled={(!text.trim() && !attachment) || sending || uploading} className="px-3.5 h-8 rounded-md text-[12px] font-semibold disabled:opacity-30 transition-opacity" style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>
              {sending ? 'Publicando…' : 'Comentar'}
            </button>
          </div>
          <input ref={imageRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; uploadImage(file); }} />
        </div>
      </div>
    </div>
  </section>;
};

Object.assign(window, {
  Avatar, AvatarStack, StatusPill, TypePill, PriorityBadge, Cover,
  ProjectModal, Dropdown, MenuItem, renderWithMentions,
  InlineEdit, TagAdd, SharedClientComments,
});
