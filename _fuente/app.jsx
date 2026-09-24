// ═══════════════════════════════════════════════════════════════
// LOOPA OS — sistema de ventas de servicios digitales
// Misma base que TOONED OS (shell, estética, Firebase, diálogos),
// sin inventario: lo que se vende son TIPOS DE SERVICIO reutilizables.
// ═══════════════════════════════════════════════════════════════
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─── Formato ───────────────────────────────────────────────────
const L = (n) => `${window.__CUR || 'L'} ${Math.round(Number(n) || 0).toLocaleString('es-HN')}`;
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// Fecha local (no UTC): en Honduras toISOString() ya es "mañana" desde las 6 pm
const today = () => ymd(new Date());
const parseYmd = (s) => { const [y, m, d] = (s || '').split('-').map(Number); return new Date(y || 1970, (m || 1) - 1, d || 1); };
const fmtFecha = (s) => s ? parseYmd(s).toLocaleDateString('es-HN', { day: '2-digit', month: 'short' }) : '—';
const fmtFechaLarga = (s) => s ? parseYmd(s).toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const formatTs = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString('es-HN', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  } catch (e) { return iso.slice(0, 16); }
};
const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const norm = (s) => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const digits = (s) => (s || '').replace(/\D/g, '');
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };

// ─── Catálogos base (editables en Configuración) ───────────────
const ESTADOS = ['pendiente', 'en-proceso', 'revision', 'entregado', 'cancelado'];
const ESTADO_LABELS = {
  'pendiente':  'Pendiente',
  'en-proceso': 'En proceso',
  'revision':   'En revisión',
  'entregado':  'Entregado',
  'cancelado':  'Cancelado',
};
const PAGO_LABELS = { pagado: 'Pagado', anticipo: 'Anticipo', pendiente: 'Por cobrar', 'n/a': 'Anulada' };
const UNIDADES = ['proyecto', 'mes', 'pieza', 'hora', 'campaña', 'paquete'];
const CATEGORIAS_DEFAULT = ['Redes sociales', 'Diseño gráfico', 'Video / Reels', 'Pauta digital', 'Branding', 'Web', 'Fotografía', 'Otro'];
const CANALES_DEFAULT = ['WhatsApp', 'Instagram', 'Facebook', 'TikTok', 'Referido', 'Web', 'Otro'];
const PAY_CONFIG_DEFAULT = [
  { id: 'bac',       label: 'Transf. BAC',        comisionPct: 0 },
  { id: 'atlantida', label: 'Transf. Atlántida',  comisionPct: 0 },
  { id: 'ficohsa',   label: 'Transf. Ficohsa',    comisionPct: 0 },
  { id: 'efectivo',  label: 'Efectivo',           comisionPct: 0 },
  { id: 'tarjeta',   label: 'Tarjeta / link',     comisionPct: 4.5 },
  { id: 'paypal',    label: 'PayPal',             comisionPct: 5.4 },
];
const GASTO_CATS = ['Freelancer', 'Pauta propia', 'Software', 'Equipo', 'Oficina', 'Otro'];
const CONFIG_DEFAULT = { payConfig: PAY_CONFIG_DEFAULT, categorias: CATEGORIAS_DEFAULT, canales: CANALES_DEFAULT, moneda: 'L' };
const GASTOS_DEFAULT = { variables: [], fijos: [] };

// ─── Finanzas de una venta ─────────────────────────────────────
const ventaCosto    = (v) => (v.items || []).reduce((a, i) => a + num(i.costo) * num(i.q || 1), 0);
const ventaCobrado  = (v) => (v.abonos || []).reduce((a, x) => a + num(x.monto), 0);
const ventaSaldo    = (v) => v.estado === 'cancelado' ? 0 : Math.max(0, num(v.total) - ventaCobrado(v));
const ventaComision = (v, payConfig) => {
  const pm = (payConfig || []).find(m => m.id === v.pay);
  return pm && pm.comisionPct ? Math.round(num(v.total) * pm.comisionPct) / 100 : 0;
};
const ventaGanancia = (v, payConfig) => num(v.total) - ventaCosto(v) - ventaComision(v, payConfig);
const pagoEstado = (v) => {
  if (v.estado === 'cancelado') return 'n/a';
  const c = ventaCobrado(v);
  if (c >= num(v.total) - 0.5) return 'pagado';
  if (c > 0) return 'anticipo';
  return 'pendiente';
};
const esActiva = (v) => v.estado !== 'cancelado';
const entregaVencida = (v) => v.entrega && v.entrega < today() && !['entregado', 'cancelado'].includes(v.estado);

// ─── Períodos (Ventas + Métricas) ──────────────────────────────
function periodRange(period, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  const last = (yy, mm) => new Date(yy, mm + 1, 0).getDate();
  const mesLbl = (d) => d.toLocaleDateString('es-HN', { month: 'long', year: 'numeric' }).toUpperCase();
  if (period === 'hoy') { const t = ymd(now); return { start: t, end: t, months: 1 / 30, label: 'HOY' }; }
  if (period === 'semana') { const d = new Date(now); d.setDate(d.getDate() - 6); return { start: ymd(d), end: ymd(now), months: 7 / 30, label: 'ÚLTIMOS 7 DÍAS' }; }
  if (period === 'mes') return { start: ymd(new Date(y, m, 1)), end: ymd(new Date(y, m, last(y, m))), months: 1, label: mesLbl(now) };
  if (period === 'mes-ant') { const d = new Date(y, m - 1, 1); return { start: ymd(d), end: ymd(new Date(d.getFullYear(), d.getMonth(), last(d.getFullYear(), d.getMonth()))), months: 1, label: mesLbl(d) }; }
  if (period === '30d') { const d = new Date(now); d.setDate(d.getDate() - 29); return { start: ymd(d), end: ymd(now), months: 1, label: 'ÚLTIMOS 30 DÍAS' }; }
  if (period === 'trim') { const qs = Math.floor(m / 3) * 3; return { start: ymd(new Date(y, qs, 1)), end: ymd(new Date(y, qs + 2, last(y, qs + 2))), months: 3, label: `T${qs / 3 + 1} ${y}` }; }
  if (period === 'año') return { start: `${y}-01-01`, end: `${y}-12-31`, months: 12, label: String(y) };
  return { start: '0000-01-01', end: '9999-12-31', months: null, label: 'TODO' };
}
const inRange = (fecha, r) => fecha >= r.start && fecha <= r.end;
const fijoMensual = (fijos) => (fijos || []).filter(f => f.activo !== false).reduce((a, f) => a + num(f.monto), 0);
function gastosEnPeriodo(gastos, r, monthsTodo = 1) {
  const variables = (gastos.variables || []).filter(g => g.fecha && inRange(g.fecha, r)).reduce((a, g) => a + num(g.monto), 0);
  const fijos = fijoMensual(gastos.fijos) * (r.months == null ? monthsTodo : r.months);
  return { variables: Math.round(variables), fijos: Math.round(fijos), total: Math.round(variables + fijos) };
}

// ─── Descargas ─────────────────────────────────────────────────
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadCSV(name, headers, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n');
  downloadFile(name, csv, 'text/csv;charset=utf-8;');
}

// ─── Persistencia: Firebase si está configurado, si no este navegador ───
const DOC_KEYS = ['ventas', 'clientes', 'servicios', 'config', 'gastos'];
const Store = {
  async loadAll() {
    if (window.USE_FB) {
      const col = window.db.collection('loopa');
      const snaps = await Promise.all(DOC_KEYS.map(k => col.doc(k).get()));
      const out = {};
      DOC_KEYS.forEach((k, i) => { out[k] = snaps[i].exists ? snaps[i].data() : null; });
      return out;
    }
    const out = {};
    DOC_KEYS.forEach(k => {
      try { out[k] = JSON.parse(localStorage.getItem('loopa-' + k) || 'null'); } catch (e) { out[k] = null; }
    });
    return out;
  },
  save(k, data) {
    if (window.USE_FB) return window.db.collection('loopa').doc(k).set(data);
    try { localStorage.setItem('loopa-' + k, JSON.stringify(data)); return Promise.resolve(); }
    catch (e) { return Promise.reject(e); }
  },
};

// ─── Diálogos internos (reemplazan confirm/alert) ──────────────
const _dialogListeners = new Set();
function _emitDialog(state) { _dialogListeners.forEach(fn => fn(state)); }
function uiConfirm(opts = {}) {
  return new Promise(resolve => _emitDialog({
    kind: 'confirm', title: opts.title || '¿Confirmar acción?', message: opts.message || '',
    confirmLabel: opts.confirmLabel || 'Confirmar', cancelLabel: opts.cancelLabel || 'Cancelar',
    danger: opts.danger !== false, resolve,
  }));
}
function uiAlert(opts = {}) {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  return new Promise(resolve => _emitDialog({
    kind: 'alert', title: o.title || 'Aviso', message: o.message || '', confirmLabel: o.confirmLabel || 'Entendido', danger: false, resolve,
  }));
}

// ═══════════════════════ UI PRIMITIVES ═══════════════════════
function Icon({ name, size = 16 }) {
  const c = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'square', strokeLinejoin: 'miter' };
  switch (name) {
    case 'plus':     return <svg {...c}><path d="M12 5v14M5 12h14"/></svg>;
    case 'minus':    return <svg {...c}><path d="M5 12h14"/></svg>;
    case 'arrow-r':  return <svg {...c}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
    case 'arrow-l':  return <svg {...c}><path d="M19 12H5M11 6l-6 6 6 6"/></svg>;
    case 'check':    return <svg {...c}><path d="M5 12l5 5L20 7"/></svg>;
    case 'x':        return <svg {...c}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case 'list':     return <svg {...c}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>;
    case 'chart':    return <svg {...c}><path d="M3 3v18h18M7 14v4M12 9v9M17 5v13"/></svg>;
    case 'search':   return <svg {...c}><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>;
    case 'edit':     return <svg {...c}><path d="M11 4H4v16h16v-7M18 3l3 3-11 11H7v-3L18 3z"/></svg>;
    case 'dl':       return <svg {...c}><path d="M12 3v14M6 11l6 6 6-6M4 21h16"/></svg>;
    case 'ul':       return <svg {...c}><path d="M12 21V7M6 13l6-6 6 6M4 3h16"/></svg>;
    case 'settings': return <svg {...c}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2L5.1 6 3 9.3l2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2L10 21h4l.6-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></svg>;
    case 'down':     return <svg {...c}><path d="M6 9l6 6 6-6"/></svg>;
    case 'user':     return <svg {...c}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>;
    case 'trash':    return <svg {...c}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>;
    case 'money':    return <svg {...c}><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v6M18 9v6"/></svg>;
    case 'tag':      return <svg {...c}><path d="M3 3h8l10 10-8 8L3 11V3z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>;
    case 'copy':     return <svg {...c}><rect x="8" y="8" width="13" height="13"/><path d="M16 8V3H3v13h5"/></svg>;
    case 'bell':     return <svg {...c}><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4l2-2zM10 21h4"/></svg>;
    case 'archive':  return <svg {...c}><path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4"/></svg>;
    default: return null;
  }
}

function LoopaMark({ height = 30 }) {
  // Logo oficial (logo-loopa.svg), en el color del texto que lo rodea
  const L0 = window.LOOPA_SVG || { viewBox: '0 0 260.2 202.24', inner: '' };
  return (
    <svg viewBox={L0.viewBox} height={height} style={{ display: 'block', fill: 'currentColor' }} aria-label="LOOPA"
      dangerouslySetInnerHTML={{ __html: L0.inner }} />
  );
}

function EstadoBadge({ s }) {
  return <span className={`badge e-${s}`}><span className="pip" /> {ESTADO_LABELS[s] || s}</span>;
}
function PagoBadge({ v }) {
  const p = pagoEstado(v);
  const cls = p === 'pagado' ? 'paid' : p === 'anticipo' ? 'partial' : p === 'pendiente' ? 'pending' : '';
  return <span className={`pay ${cls}`}>{p === 'pagado' ? '●' : p === 'anticipo' ? '◐' : '○'} {PAGO_LABELS[p]}</span>;
}

function Qty({ value, onChange, min = 1 }) {
  const v = num(value);
  return (
    <div className="qty">
      <button type="button" onClick={() => onChange(Math.max(min, v - 1))}><Icon name="minus" size={11} /></button>
      <input value={value} inputMode="numeric" onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))} onBlur={() => onChange(Math.max(min, v || min))} />
      <button type="button" onClick={() => onChange(v + 1)}><Icon name="plus" size={11} /></button>
    </div>
  );
}

function Modal({ title, kicker, onClose, children, footer, width = 680 }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && !window.__dialogOpen) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: width }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            {kicker && <div className="page-kicker" style={{ marginBottom: 6 }}>{kicker}</div>}
            <div className="modal-title">{title}</div>
          </div>
          <button className="modal-x" onClick={onClose} title="Cerrar (Esc)"><Icon name="x" size={14} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Popover de opciones (cambio rápido de estado / cobro desde la tabla)
function PickMenu({ menu, options, onPick, onClose }) {
  useEffect(() => {
    if (!menu) return;
    const c = () => onClose();
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', c);
    window.addEventListener('keydown', k);
    window.addEventListener('scroll', c, true);
    return () => { window.removeEventListener('mousedown', c); window.removeEventListener('keydown', k); window.removeEventListener('scroll', c, true); };
  }, [menu]);
  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 240);
  const y = Math.min(menu.y, window.innerHeight - (options.length * 40 + 20));
  return (
    <div className="pick-menu" style={{ left: x, top: y }} onMouseDown={e => e.stopPropagation()}>
      {options.map(o => (
        <button key={o.id} className={`pick-opt ${menu.current === o.id ? 'on' : ''}`} onClick={() => onPick(o.id)}>
          {o.node || o.label}
          {menu.current === o.id && <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}><Icon name="check" size={12} /></span>}
        </button>
      ))}
    </div>
  );
}

function Empty({ icon, title, children }) {
  return (
    <div className="empty">
      <div className="empty-ico"><Icon name={icon} size={22} /></div>
      <div className="empty-t">{title}</div>
      {children && <div className="empty-d">{children}</div>}
    </div>
  );
}

// ═══════════════════════ NUEVA VENTA ═══════════════════════
function NuevaVenta({ nextN, clientes, servicios, ventas, stats, config, onCreate, onCreateServicio, onUpdateServicio, prefill, onPrefillConsumed, onReset, onOpenVenta }) {
  const { payConfig, canales, categorias } = config;
  const [step, setStep] = useState(prefill?.items?.length ? 2 : 1);
  const [cliente, setCliente] = useState(() => prefill?.cliente || { id: null, nombre: '', empresa: '', telefono: '', email: '', canal: canales[0] || '' });
  const [items, setItems] = useState(() => (prefill?.items || []).map(i => ({ ...i, key: uid('LN') })));
  const [pay, setPay] = useState(() => prefill?.pay && payConfig.some(p => p.id === prefill.pay) ? prefill.pay : (payConfig[0]?.id || ''));
  const [cobro, setCobro] = useState('pagado');
  const [anticipo, setAnticipo] = useState('');
  const [descuento, setDescuento] = useState('');
  const [estado, setEstado] = useState('pendiente');
  const [fecha, setFecha] = useState(today());
  const [entrega, setEntrega] = useState('');
  const [nota, setNota] = useState(prefill?.nota || '');
  const [created, setCreated] = useState(null);

  useEffect(() => { if (prefill && onPrefillConsumed) onPrefillConsumed(); }, []);

  // Tocar un tipo que ya está en la venta suma 1 a la cantidad en vez de duplicar la línea
  const addItem = (s) => setItems(prev => prev.some(i => i.tipoId === s.id)
    ? prev.map(i => i.tipoId === s.id ? { ...i, q: num(i.q) + 1 } : i)
    : [...prev, {
        key: uid('LN'), tipoId: s.id, nombre: s.nombre, categoria: s.categoria, unidad: s.unidad,
        descripcion: s.descripcion || '', precio: String(num(s.precio)), costo: String(num(s.costo)), q: 1,
      }]);
  const updItem = (key, patch) => setItems(prev => prev.map(i => i.key === key ? { ...i, ...patch } : i));
  const delItem = (key) => setItems(prev => prev.filter(i => i.key !== key));

  const totals = useMemo(() => {
    const subtotal = items.reduce((a, i) => a + num(i.precio) * num(i.q), 0);
    const desc = Math.min(subtotal, Math.max(0, num(descuento)));
    const total = subtotal - desc;
    const costo = items.reduce((a, i) => a + num(i.costo) * num(i.q), 0);
    const pm = payConfig.find(m => m.id === pay);
    const comision = pm && pm.comisionPct ? Math.round(total * pm.comisionPct) / 100 : 0;
    const ganancia = total - costo - comision;
    const margen = total > 0 ? (ganancia / total) * 100 : 0;
    const cobrado = cobro === 'pagado' ? total : cobro === 'anticipo' ? Math.min(total, Math.max(0, num(anticipo))) : 0;
    return { subtotal, desc, total, costo, comision, ganancia, margen, cobrado, saldo: total - cobrado };
  }, [items, descuento, pay, payConfig, cobro, anticipo]);

  const canProceed = {
    1: cliente.nombre.trim().length > 0,
    2: items.length > 0 && items.every(i => num(i.q) > 0),
    3: !!pay && (cobro !== 'anticipo' || totals.cobrado > 0),
  };

  const confirm = () => {
    const venta = {
      n: nextN, fecha,
      cliente: cliente.nombre.trim(), empresa: (cliente.empresa || '').trim(),
      telefono: (cliente.telefono || '').trim(), email: (cliente.email || '').trim(), canal: cliente.canal,
      items: items.map(({ key, ...r }) => ({ ...r, precio: num(r.precio), costo: num(r.costo), q: num(r.q) || 1, descripcion: (r.descripcion || '').trim() })),
      subtotal: totals.subtotal, descuento: totals.desc, total: totals.total,
      pay, abonos: totals.cobrado > 0 ? [{ id: uid('AB'), fecha, monto: totals.cobrado, metodo: pay }] : [],
      estado, entrega, nota: nota.trim(), creado: new Date().toISOString(),
    };
    const saved = onCreate(venta, cliente);
    setCreated(saved || venta);
  };

  if (created) return <VentaCreada venta={created} payConfig={payConfig} onReset={onReset} onOpen={() => onOpenVenta(created.n)} />;

  const steps = [{ n: '01', t: 'Cliente' }, { n: '02', t: 'Servicios' }, { n: '03', t: 'Cobro' }];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Registro</div>
          <div className="page-title">Nueva venta</div>
          <div className="page-desc">Elegí el cliente, sumá servicios desde tus tipos guardados (o creá uno nuevo al vuelo) y registrá el cobro.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span className="chip">CORRELATIVO <span className="v mono">#{nextN}</span></span>
          <span className="chip">SERVICIOS <span className="v mono">{pad2(items.length)}</span></span>
          <span className="chip">TOTAL <span className="v mono">{L(totals.total)}</span></span>
        </div>
      </div>

      <div className="stepper">
        {steps.map((s, idx) => (
          <button key={s.n} className={`step ${step === idx + 1 ? 'active' : step > idx + 1 ? 'done' : ''}`}
            onClick={() => { if (idx + 1 < step || [1, 2, 3].slice(0, idx).every(k => canProceed[k])) setStep(idx + 1); }}>
            <div className="n mono">{step > idx + 1 ? '✓' : s.n}</div>
            <div className="t">{s.t}</div>
          </button>
        ))}
      </div>

      {step === 1 && <PasoCliente cliente={cliente} setCliente={setCliente} clientes={clientes} ventas={ventas} canales={canales} nota={nota} setNota={setNota} />}
      {step === 2 && (
        <PasoServicios servicios={servicios} stats={stats} categorias={categorias} items={items}
          addItem={addItem} updItem={updItem} delItem={delItem} totals={totals}
          onCreateServicio={onCreateServicio} onUpdateServicio={onUpdateServicio} />
      )}
      {step === 3 && (
        <PasoCobro payConfig={payConfig} pay={pay} setPay={setPay} cobro={cobro} setCobro={setCobro}
          anticipo={anticipo} setAnticipo={setAnticipo} descuento={descuento} setDescuento={setDescuento}
          estado={estado} setEstado={setEstado} fecha={fecha} setFecha={setFecha} entrega={entrega} setEntrega={setEntrega}
          totals={totals} items={items} cliente={cliente} nextN={nextN} canConfirm={canProceed[3]} onConfirm={confirm} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 10 }}>
        <button className="btn ghost" disabled={step === 1} onClick={() => setStep(s => s - 1)}>
          <Icon name="arrow-l" size={13} /> Volver
        </button>
        {step < 3 && (
          <button className="btn primary" disabled={!canProceed[step]} onClick={() => setStep(s => s + 1)}>
            Continuar <Icon name="arrow-r" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function PasoCliente({ cliente, setCliente, clientes, ventas, canales, nota, setNota }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const nq = norm(q);
  const matches = nq.length >= 2
    ? clientes.filter(c => norm(`${c.nombre} ${c.empresa} ${c.email}`).includes(nq) || (digits(q).length >= 3 && digits(c.telefono).includes(digits(q)))).slice(0, 6)
    : [];
  const compras = (id) => ventas.filter(v => v.clienteId === id && esActiva(v)).length;
  const apply = (c) => {
    setCliente({ id: c.id, nombre: c.nombre || '', empresa: c.empresa || '', telefono: c.telefono || '', email: c.email || '', canal: c.canal || cliente.canal });
    setQ(''); setOpen(false);
  };
  const set = (k) => (e) => setCliente(c => ({ ...c, [k]: e.target.value }));
  const recientes = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const v of ventas) { if (v.clienteId && !seen.has(v.clienteId)) { seen.add(v.clienteId); const c = clientes.find(x => x.id === v.clienteId); if (c) out.push(c); } if (out.length >= 6) break; }
    return out;
  }, [ventas, clientes]);

  return (
    <div className="panel crop">
      <div className="panel-head">
        <div className="panel-title">PASO 01 · <span className="dim">CLIENTE</span></div>
        {cliente.id && (
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, letterSpacing: '0.1em', color: 'var(--accent)' }}>
            ● CLIENTE EXISTENTE · {compras(cliente.id)} COMPRA{compras(cliente.id) === 1 ? '' : 'S'}
          </span>
        )}
      </div>
      <div className="panel-body">
        <div className="field" style={{ position: 'relative', marginBottom: 18 }}>
          <label>Buscar cliente guardado</label>
          <div className="search-big">
            <Icon name="search" size={15} />
            <input placeholder="Nombre, empresa, teléfono o email…" value={q}
              onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 160)}
              onChange={e => { setQ(e.target.value); setOpen(true); }} />
            {cliente.id && (
              <button className="btn sm ghost" onClick={() => setCliente({ id: null, nombre: '', empresa: '', telefono: '', email: '', canal: canales[0] || '' })}>
                <Icon name="plus" size={11} /> Cliente nuevo
              </button>
            )}
          </div>
          {open && matches.length > 0 && (
            <div className="dropdown">
              {matches.map(c => (
                <div key={c.id} className="dropdown-row" onMouseDown={() => apply(c)}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{c.nombre}{c.empresa && <span className="muted" style={{ fontWeight: 400 }}> · {c.empresa}</span>}</div>
                    <div className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>{[c.telefono, c.email].filter(Boolean).join(' · ') || 'Sin contacto'}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--accent)' }}>{compras(c.id)} compras</span>
                </div>
              ))}
            </div>
          )}
          {!cliente.id && !q && recientes.length > 0 && (
            <div className="chips" style={{ marginTop: 10 }}>
              <span className="mono dim" style={{ fontSize: 10, letterSpacing: '0.1em', alignSelf: 'center', marginRight: 4 }}>RECIENTES</span>
              {recientes.map(c => <button key={c.id} className="chipbtn" onClick={() => apply(c)}>{c.nombre}</button>)}
            </div>
          )}
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Nombre del cliente <span className="req">*</span></label>
            <input className="input" placeholder="Ej. Andrea Mejía" value={cliente.nombre} onChange={set('nombre')} />
          </div>
          <div className="field">
            <label>Empresa / marca</label>
            <input className="input" placeholder="Ej. Café Montaña" value={cliente.empresa} onChange={set('empresa')} />
          </div>
          <div className="field">
            <label>Teléfono / WhatsApp</label>
            <input className="input mono" placeholder="+504 9XXX-XXXX" value={cliente.telefono} onChange={set('telefono')} />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" placeholder="cliente@empresa.com" value={cliente.email} onChange={set('email')} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>¿Cómo llegó?</label>
            <div className="chips">
              {canales.map(ch => (
                <button key={ch} className={`chipbtn ${cliente.canal === ch ? 'on' : ''}`} onClick={() => setCliente(c => ({ ...c, canal: ch }))}>{ch}</button>
              ))}
            </div>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Nota de la venta <span className="dim">(opcional)</span></label>
            <textarea className="textarea" rows="2" placeholder="Brief, acuerdos, links de referencia…" value={nota} onChange={e => setNota(e.target.value)} style={{ resize: 'vertical' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PasoServicios({ servicios, stats, categorias, items, addItem, updItem, delItem, totals, onCreateServicio, onUpdateServicio }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [draft, setDraft] = useState(null);
  const searchRef = useRef(null);

  const activos = servicios.filter(s => s.activo !== false);
  const nq = norm(q);
  const list = activos
    .filter(s => (cat === 'all' || s.categoria === cat) && (!nq || norm(`${s.nombre} ${s.categoria} ${s.descripcion}`).includes(nq)))
    .sort((a, b) => (stats[b.id]?.q || 0) - (stats[a.id]?.q || 0) || a.nombre.localeCompare(b.nombre));
  const exact = nq ? servicios.find(s => norm(s.nombre) === nq) : null;
  const catsConServicios = categorias.filter(c => activos.some(s => s.categoria === c));
  const enCarrito = (id) => items.filter(i => i.tipoId === id).reduce((a, i) => a + num(i.q), 0);

  const startCreate = () => setDraft({
    nombre: q.trim(), categoria: cat !== 'all' ? cat : (categorias[0] || 'Otro'),
    unidad: 'proyecto', precio: '', costo: '', descripcion: '',
  });
  const saveDraft = () => {
    if (!draft.nombre.trim()) return;
    const s = onCreateServicio(draft);
    addItem(s); setDraft(null); setQ('');
    setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 50);
  };
  const onKey = (e) => {
    if (e.key !== 'Enter' || !nq) return;
    if (exact && exact.activo !== false) { addItem(exact); setQ(''); }
    else if (list.length === 1) { addItem(list[0]); setQ(''); }
    else if (!exact) startCreate();
  };

  return (
    <div className="nv-grid">
      {/* Catálogo de tipos */}
      <div className="panel crop">
        <div className="panel-head">
          <div className="panel-title">PASO 02 · <span className="dim">TIPOS DE SERVICIO</span></div>
          <span className="mono dim" style={{ marginLeft: 'auto', fontSize: 10, letterSpacing: '0.1em' }}>{activos.length} GUARDADOS</span>
        </div>
        <div className="panel-body">
          <div className="search-big" style={{ marginBottom: 12 }}>
            <Icon name="search" size={15} />
            <input ref={searchRef} autoFocus placeholder="Buscar un tipo… o escribir uno nuevo y Enter" value={q}
              onChange={e => { setQ(e.target.value); setDraft(null); }} onKeyDown={onKey} />
            {q && <button className="btn sm ghost" onClick={() => setQ('')}><Icon name="x" size={11} /></button>}
          </div>
          {catsConServicios.length > 1 && (
            <div className="chips" style={{ marginBottom: 16 }}>
              <button className={`chipbtn ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>Todos</button>
              {catsConServicios.map(c => <button key={c} className={`chipbtn ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
            </div>
          )}

          {draft ? (
            <NuevoTipoInline draft={draft} setDraft={setDraft} categorias={categorias} onSave={saveDraft} onCancel={() => setDraft(null)} />
          ) : (
            <div className="srv-grid">
              {nq && !exact && (
                <button className="srv-card new" onClick={startCreate}>
                  <div className="srv-cat">Nuevo tipo</div>
                  <div className="srv-name">+ Crear «{q.trim()}»</div>
                  <div className="srv-meta"><span className="dim">Queda guardado para la próxima</span></div>
                </button>
              )}
              {exact && exact.activo === false && (
                <button className="srv-card new" onClick={() => { onUpdateServicio(exact.id, { activo: true }); addItem(exact); setQ(''); }}>
                  <div className="srv-cat">Archivado</div>
                  <div className="srv-name">Reactivar «{exact.nombre}» y agregar</div>
                  <div className="srv-meta"><span>{L(exact.precio)}</span></div>
                </button>
              )}
              {list.map(s => {
                const st = stats[s.id]; const n = enCarrito(s.id);
                return (
                  <button key={s.id} className={`srv-card ${n ? 'on' : ''}`} onClick={() => addItem(s)} title={s.descripcion || s.nombre}>
                    {n > 0 && <span className="srv-in">{n}</span>}
                    <div className="srv-cat">{s.categoria}</div>
                    <div className="srv-name">{s.nombre}</div>
                    <div className="srv-meta">
                      <span>{L(s.precio)}<span className="dim"> / {s.unidad}</span></span>
                      {st?.q > 0 && <span className="dim">×{st.q}</span>}
                    </div>
                  </button>
                );
              })}
              {!nq && activos.length === 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <Empty icon="tag" title="Todavía no hay tipos de servicio">
                    Escribí arriba el nombre del primero —por ejemplo <b>Manejo de redes · plan mensual</b>— y presioná Enter.
                    Queda guardado y la próxima vez que lo vendas solo lo tocás.
                  </Empty>
                </div>
              )}
              {nq && list.length === 0 && exact && exact.activo !== false && null}
            </div>
          )}
        </div>
      </div>

      {/* Líneas de la venta */}
      <div className="panel crop sticky-panel">
        <div className="panel-head">
          <div className="panel-title">EN ESTA VENTA · <span className="dim">{items.length} LÍNEA{items.length === 1 ? '' : 'S'}</span></div>
        </div>
        <div className="panel-body">
          {items.length === 0 ? (
            <div className="mono dim" style={{ fontSize: 11, textAlign: 'center', padding: '28px 8px', lineHeight: 1.8 }}>
              Tocá un tipo de servicio para agregarlo.<br />Precio, cantidad y detalle se ajustan acá.
            </div>
          ) : items.map((i, idx) => {
            const base = servicios.find(s => s.id === i.tipoId);
            const precioCambio = base && num(i.precio) !== num(base.precio);
            return (
              <div className="ln" key={i.key}>
                <div className="ln-top">
                  <span className="mono dim" style={{ fontSize: 11, paddingTop: 2 }}>{pad2(idx + 1)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="srv-name">{i.nombre}</div>
                    <div className="mono dim" style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>{i.categoria} · por {i.unidad}</div>
                  </div>
                  <button className="icon-btn danger" onClick={() => delItem(i.key)} title="Quitar"><Icon name="x" size={12} /></button>
                </div>
                <textarea className="input mini" rows="1" style={{ marginTop: 10, resize: 'vertical' }}
                  placeholder="Detalle de esta venta (ej. 12 posts + 4 reels · octubre)"
                  value={i.descripcion} onChange={e => updItem(i.key, { descripcion: e.target.value })} />
                <div className="ln-grid">
                  <label><span className="mini-lbl">Precio</span><input className="input mini mono" inputMode="decimal" value={i.precio} onChange={e => updItem(i.key, { precio: e.target.value })} /></label>
                  <label><span className="mini-lbl">Cant.</span><Qty value={i.q} onChange={q => updItem(i.key, { q })} /></label>
                  <label><span className="mini-lbl">Costo</span><input className="input mini mono" inputMode="decimal" value={i.costo} onChange={e => updItem(i.key, { costo: e.target.value })} title="Lo que te cuesta a vos: freelancer, pauta, licencias…" /></label>
                </div>
                <div className="ln-foot">
                  {precioCambio && (
                    <button className="linkbtn" onClick={() => onUpdateServicio(base.id, { precio: num(i.precio) })}>
                      Guardar {L(i.precio)} como precio base
                    </button>
                  )}
                  <span className="mono" style={{ marginLeft: 'auto', fontWeight: 600 }}>{L(num(i.precio) * num(i.q))}</span>
                </div>
              </div>
            );
          })}
          {items.length > 0 && (
            <div className="summary-row big" style={{ fontSize: 22 }}>
              <span className="l">Subtotal</span><span className="r">{L(totals.subtotal)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NuevoTipoInline({ draft, setDraft, categorias, onSave, onCancel }) {
  const set = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.value }));
  return (
    <div className="create-box">
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--accent)', marginBottom: 14 }}>
        ▸ NUEVO TIPO DE SERVICIO · SE GUARDA PARA LAS PRÓXIMAS VENTAS
      </div>
      <div className="grid-2">
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Nombre <span className="req">*</span></label>
          <input className="input" autoFocus value={draft.nombre} onChange={set('nombre')} placeholder="Ej. Manejo de redes · plan mensual" onKeyDown={e => { if (e.key === 'Enter') onSave(); }} />
        </div>
        <div className="field">
          <label>Categoría</label>
          <input className="input" list="loopa-cats" value={draft.categoria} onChange={set('categoria')} placeholder="Elegí o escribí una nueva" />
          <datalist id="loopa-cats">{categorias.map(c => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="field">
          <label>Se cobra por</label>
          <select className="select" value={draft.unidad} onChange={set('unidad')}>
            {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Precio base</label>
          <input className="input mono" inputMode="decimal" value={draft.precio} onChange={set('precio')} placeholder="0" />
        </div>
        <div className="field">
          <label>Costo base <span className="dim">(freelance, pauta…)</span></label>
          <input className="input mono" inputMode="decimal" value={draft.costo} onChange={set('costo')} placeholder="0" />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Qué incluye <span className="dim">(se copia como detalle en cada venta)</span></label>
          <textarea className="textarea" rows="2" value={draft.descripcion} onChange={set('descripcion')} placeholder="Ej. 12 posts, 4 reels, calendario y reporte mensual" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn primary" disabled={!draft.nombre.trim()} onClick={onSave}><Icon name="plus" size={12} /> Crear y agregar</button>
      </div>
    </div>
  );
}

function PasoCobro({ payConfig, pay, setPay, cobro, setCobro, anticipo, setAnticipo, descuento, setDescuento, estado, setEstado, fecha, setFecha, entrega, setEntrega, totals, items, cliente, nextN, canConfirm, onConfirm }) {
  return (
    <div className="nv-grid">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">PASO 03 · <span className="dim">MÉTODO DE PAGO</span></div></div>
          <div className="panel-body">
            <div className="pay-options">
              {payConfig.map(m => (
                <div key={m.id} className={`pay-opt ${pay === m.id ? 'on' : ''}`} onClick={() => setPay(m.id)}>
                  <span className="radio" />
                  <div>
                    <div className="l">{m.label}</div>
                    <div className="s">{m.comisionPct ? `Comisión ${m.comisionPct}%` : 'Sin comisión'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">COBRO</div></div>
          <div className="panel-body">
            <div className="segmented" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
              <button className={cobro === 'pagado' ? 'on' : ''} onClick={() => setCobro('pagado')}>Pagado completo</button>
              <button className={cobro === 'anticipo' ? 'on' : ''} onClick={() => setCobro('anticipo')}>Anticipo</button>
              <button className={cobro === 'pendiente' ? 'on' : ''} onClick={() => setCobro('pendiente')}>Por cobrar</button>
            </div>
            <div className="grid-2">
              {cobro === 'anticipo' && (
                <div className="field">
                  <label>Monto del anticipo <span className="req">*</span></label>
                  <input className="input mono" inputMode="decimal" autoFocus value={anticipo} onChange={e => setAnticipo(e.target.value)} placeholder={String(Math.round(totals.total / 2))} />
                  <div className="chips">
                    {[30, 50, 70].map(p => <button key={p} className="chipbtn" onClick={() => setAnticipo(String(Math.round(totals.total * p / 100)))}>{p}%</button>)}
                  </div>
                </div>
              )}
              <div className="field">
                <label>Descuento</label>
                <input className="input mono" inputMode="decimal" value={descuento} onChange={e => setDescuento(e.target.value)} placeholder="0" />
              </div>
            </div>
          </div>
        </div>

        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">FECHAS Y ESTADO</div></div>
          <div className="panel-body">
            <div className="grid-2">
              <div className="field">
                <label>Fecha de venta</label>
                <input className="input mono" type="date" value={fecha} onChange={e => setFecha(e.target.value || today())} style={{ colorScheme: 'dark' }} />
              </div>
              <div className="field">
                <label>Fecha de entrega <span className="dim">(opcional)</span></label>
                <input className="input mono" type="date" value={entrega} min={fecha} onChange={e => setEntrega(e.target.value)} style={{ colorScheme: 'dark' }} />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Estado del trabajo</label>
                <div className="chips">
                  {ESTADOS.filter(s => s !== 'cancelado').map(s => (
                    <button key={s} className={`chipbtn ${estado === s ? 'on' : ''}`} onClick={() => setEstado(s)}>{ESTADO_LABELS[s]}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel crop sticky-panel">
        <div className="panel-head">
          <div className="panel-title">RESUMEN · <span className="dim">VENTA #{nextN}</span></div>
        </div>
        <div className="panel-body">
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{cliente.nombre}</div>
            {cliente.empresa && <div className="muted" style={{ fontSize: 12 }}>{cliente.empresa}</div>}
          </div>
          {items.map(i => (
            <div key={i.key} className="summary-row" style={{ gap: 12 }}>
              <span style={{ color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 13 }}>{i.nombre}{num(i.q) > 1 && <span className="dim"> ×{i.q}</span>}</span>
              <span className="r">{L(num(i.precio) * num(i.q))}</span>
            </div>
          ))}
          <hr className="divider" />
          {totals.desc > 0 && <div className="summary-row"><span className="l">Descuento</span><span className="r">−{L(totals.desc)}</span></div>}
          <div className="summary-row big"><span className="l">Total</span><span className="r">{L(totals.total)}</span></div>
          <div className="summary-row"><span className="l">Costos</span><span className="r">−{L(totals.costo)}</span></div>
          {totals.comision > 0 && <div className="summary-row"><span className="l">Comisión</span><span className="r">−{L(totals.comision)}</span></div>}
          <div className="summary-row positive"><span className="l">Ganancia</span><span className="r">{L(totals.ganancia)} · {totals.margen.toFixed(0)}%</span></div>
          <hr className="divider" />
          <div className="summary-row"><span className="l">Cobrado hoy</span><span className="r" style={{ color: 'var(--ok)' }}>{L(totals.cobrado)}</span></div>
          <div className="summary-row"><span className="l">Saldo</span><span className="r" style={{ color: totals.saldo > 0 ? 'var(--warn)' : 'var(--muted)' }}>{L(totals.saldo)}</span></div>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 16, padding: 14 }} disabled={!canConfirm} onClick={onConfirm}>
            <Icon name="check" size={13} /> Registrar venta #{nextN}
          </button>
        </div>
      </div>
    </div>
  );
}

function VentaCreada({ venta: v, onReset, onOpen }) {
  return (
    <div>
      <div className="order-hero">
        <div className="ord-stack">
          <div className="ord-label">✓ Venta registrada</div>
          <div className="ord-num">#{v.n}</div>
        </div>
        <div className="ord-meta">
          <div className="k">Cliente</div><div className="v">{v.cliente}{v.empresa ? ` · ${v.empresa}` : ''}</div>
          <div className="k">Total</div><div className="v">{L(v.total)}</div>
          <div className="k">Saldo</div><div className="v" style={{ color: ventaSaldo(v) > 0 ? 'var(--warn)' : 'var(--ok)' }}>{L(ventaSaldo(v))}</div>
        </div>
      </div>
      <div className="panel crop" style={{ marginTop: 20 }}>
        <div className="panel-body">
          {v.items.map((i, idx) => (
            <div key={idx} className="summary-row">
              <span style={{ color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                {i.nombre}{i.q > 1 && <span className="dim"> ×{i.q}</span>}
                {i.descripcion && <span className="dim" style={{ display: 'block', fontSize: 11 }}>{i.descripcion}</span>}
              </span>
              <span className="r">{L(i.precio * i.q)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={onReset}><Icon name="plus" size={12} /> Nueva venta</button>
        <button className="btn" onClick={onOpen}><Icon name="list" size={12} /> Ver en ventas</button>
      </div>
    </div>
  );
}

// ═══════════════════════ VENTAS ═══════════════════════
const FILTROS0 = { q: '', estado: 'all', pago: 'all', categoria: 'all', canal: 'all', fecha: 'all', desde: '', hasta: '' };

function Ventas({ ventas, config, onUpdate, onDelete, onDuplicate, onAbono, focusN, onFocusConsumed }) {
  const { payConfig, categorias, canales } = config;
  const [f, setF] = useState(FILTROS0);
  const [sort, setSort] = useState({ col: 'n', dir: 'desc' });
  const [openN, setOpenN] = useState(null);
  const [menu, setMenu] = useState(null); // { kind, n, x, y, current }

  useEffect(() => { if (focusN) { setOpenN(focusN); onFocusConsumed(); } }, [focusN]);

  const filtered = ventas.filter(v => {
    if (f.estado !== 'all' && v.estado !== f.estado) return false;
    if (f.pago !== 'all' && pagoEstado(v) !== f.pago) return false;
    if (f.canal !== 'all' && v.canal !== f.canal) return false;
    if (f.categoria !== 'all' && !(v.items || []).some(i => i.categoria === f.categoria)) return false;
    if (f.q) {
      const hay = norm(`${v.n} ${v.cliente} ${v.empresa} ${(v.items || []).map(i => `${i.nombre} ${i.descripcion}`).join(' ')}`);
      if (!hay.includes(norm(f.q))) return false;
    }
    if (f.fecha === 'rango') {
      if (f.desde && v.fecha < f.desde) return false;
      if (f.hasta && v.fecha > f.hasta) return false;
    } else if (f.fecha !== 'all' && !inRange(v.fecha, periodRange(f.fecha))) return false;
    return true;
  });

  const val = (v, col) => col === 'total' ? num(v.total) : col === 'saldo' ? ventaSaldo(v) : col === 'ganancia' ? ventaGanancia(v, payConfig)
    : col === 'fecha' ? v.fecha : col === 'entrega' ? (v.entrega || '9999') : col === 'cliente' ? norm(v.cliente) : col === 'estado' ? ESTADOS.indexOf(v.estado) : v.n;
  const sorted = [...filtered].sort((a, b) => {
    const va = val(a, sort.col), vb = val(b, sort.col);
    return (va < vb ? -1 : va > vb ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1);
  });
  const toggleSort = (col) => setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' });

  const act = filtered.filter(esActiva);
  const sum = {
    total: act.reduce((a, v) => a + num(v.total), 0),
    cobrado: act.reduce((a, v) => a + ventaCobrado(v), 0),
    saldo: act.reduce((a, v) => a + ventaSaldo(v), 0),
    ganancia: act.reduce((a, v) => a + ventaGanancia(v, payConfig), 0),
  };

  const exportCSV = () => {
    downloadCSV(`loopa-ventas-${today()}.csv`,
      ['Venta', 'Fecha', 'Cliente', 'Empresa', 'Teléfono', 'Email', 'Canal', 'Servicios', 'Categorías', 'Subtotal', 'Descuento', 'Total', 'Costos', 'Comisión', 'Ganancia', 'Cobrado', 'Saldo', 'Pago', 'Método', 'Estado', 'Entrega', 'Nota'],
      sorted.map(v => [
        v.n, v.fecha, v.cliente, v.empresa, v.telefono, v.email, v.canal,
        (v.items || []).map(i => `${i.nombre}${i.q > 1 ? ' ×' + i.q : ''}${i.descripcion ? ' (' + i.descripcion + ')' : ''}`).join(' | '),
        [...new Set((v.items || []).map(i => i.categoria))].join(' | '),
        v.subtotal ?? v.total, v.descuento || 0, v.total, ventaCosto(v), ventaComision(v, payConfig), ventaGanancia(v, payConfig),
        ventaCobrado(v), ventaSaldo(v), PAGO_LABELS[pagoEstado(v)], payConfig.find(p => p.id === v.pay)?.label || v.pay,
        ESTADO_LABELS[v.estado], v.entrega || '', v.nota || '',
      ]));
  };

  const hasFilters = JSON.stringify(f) !== JSON.stringify(FILTROS0);
  const SortIcon = ({ col }) => sort.col !== col ? null : <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--accent)' }}>{sort.dir === 'asc' ? '▲' : '▼'}</span>;
  const openMenu = (e, kind, v) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ kind, n: v.n, x: r.left, y: r.bottom + 4, current: kind === 'estado' ? v.estado : pagoEstado(v) });
  };
  const menuVenta = menu && ventas.find(v => v.n === menu.n);
  const pickPago = (id) => {
    const v = menuVenta; setMenu(null);
    if (!v) return;
    if (id === 'cobrar') onAbono(v.n, { id: uid('AB'), fecha: today(), monto: ventaSaldo(v), metodo: v.pay });
    if (id === 'abono') setOpenN(v.n);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Base de datos</div>
          <div className="page-title">Ventas</div>
          <div className="page-desc">{filtered.length} de {ventas.length} ventas · Total filtrado <span className="mono accent">{L(sum.total)}</span> · Por cobrar <span className="mono" style={{ color: 'var(--warn)' }}>{L(sum.saldo)}</span></div>
        </div>
        <button className="btn" onClick={exportCSV} disabled={!sorted.length}><Icon name="dl" size={12} /> Excel · {sorted.length}</button>
      </div>

      <div className="filterbar">
        <div className="filter-group">
          <Icon name="search" size={13} />
          <input className="fg-input" style={{ width: 200 }} placeholder="# venta, cliente, servicio…" value={f.q} onChange={e => setF(x => ({ ...x, q: e.target.value }))} />
        </div>
        <div className="filter-group">
          <span className="flabel">Estado</span>
          <select value={f.estado} onChange={e => setF(x => ({ ...x, estado: e.target.value }))}>
            <option value="all">Todos</option>
            {ESTADOS.map(s => <option key={s} value={s}>{ESTADO_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <span className="flabel">Cobro</span>
          <select value={f.pago} onChange={e => setF(x => ({ ...x, pago: e.target.value }))}>
            <option value="all">Todos</option>
            <option value="pagado">Pagado</option>
            <option value="anticipo">Anticipo</option>
            <option value="pendiente">Por cobrar</option>
          </select>
        </div>
        <div className="filter-group">
          <span className="flabel">Categoría</span>
          <select value={f.categoria} onChange={e => setF(x => ({ ...x, categoria: e.target.value }))}>
            <option value="all">Todas</option>
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <span className="flabel">Canal</span>
          <select value={f.canal} onChange={e => setF(x => ({ ...x, canal: e.target.value }))}>
            <option value="all">Todos</option>
            {canales.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <span className="flabel">Período</span>
          <select value={f.fecha} onChange={e => setF(x => ({ ...x, fecha: e.target.value }))}>
            <option value="all">Todo</option>
            <option value="hoy">Hoy</option>
            <option value="semana">Últimos 7 días</option>
            <option value="mes">Este mes</option>
            <option value="mes-ant">Mes anterior</option>
            <option value="trim">Trimestre</option>
            <option value="año">Este año</option>
            <option value="rango">Rango de fechas…</option>
          </select>
        </div>
        {f.fecha === 'rango' && (
          <div className="filter-group">
            <span className="flabel">Desde</span>
            <input type="date" className="fg-input" value={f.desde} max={f.hasta || undefined} onChange={e => setF(x => ({ ...x, desde: e.target.value }))} style={{ colorScheme: 'dark' }} />
            <span className="flabel" style={{ marginLeft: 8 }}>Hasta</span>
            <input type="date" className="fg-input" value={f.hasta} min={f.desde || undefined} onChange={e => setF(x => ({ ...x, hasta: e.target.value }))} style={{ colorScheme: 'dark' }} />
          </div>
        )}
        {hasFilters && <button className="btn sm ghost" onClick={() => setF(FILTROS0)}><Icon name="x" size={11} /> Limpiar</button>}
      </div>

      <div className="panel crop">
        {ventas.length === 0 ? (
          <Empty icon="list" title="Aún no hay ventas">Registrá la primera desde <b>Nueva venta</b>.</Empty>
        ) : (
          <div className="tbl-wrap" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  {[
                    { col: 'n', label: 'Venta' }, { col: 'cliente', label: 'Cliente' }, { col: null, label: 'Servicios' },
                    { col: 'total', label: 'Total', r: 1 }, { col: 'saldo', label: 'Saldo', r: 1 }, { col: 'ganancia', label: 'Ganancia', r: 1 },
                    { col: null, label: 'Cobro' }, { col: 'estado', label: 'Estado' }, { col: 'entrega', label: 'Entrega' }, { col: 'fecha', label: 'Fecha' }, { col: null, label: '' },
                  ].map((h, i) => (
                    <th key={i} style={{ textAlign: h.r ? 'right' : 'left', cursor: h.col ? 'pointer' : 'default' }} onClick={h.col ? () => toggleSort(h.col) : undefined}>
                      {h.label}{h.col && <SortIcon col={h.col} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(v => {
                  const cancel = v.estado === 'cancelado';
                  return (
                    <tr key={v.n} onClick={() => setOpenN(v.n)} style={{ opacity: cancel ? 0.5 : 1 }}>
                      <td className="order-n">#{v.n}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{v.cliente}</div>
                        {v.empresa && <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>{v.empresa.toUpperCase()}</div>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxWidth: 340 }}>
                          {(v.items || []).map((i, idx) => (
                            <span key={idx} className="srv-chip" title={i.descripcion || i.nombre}>{i.nombre}{i.q > 1 ? ` ×${i.q}` : ''}</span>
                          ))}
                        </div>
                      </td>
                      <td className="num" style={{ textDecoration: cancel ? 'line-through' : 'none' }}>{L(v.total)}</td>
                      <td className="num" style={{ color: ventaSaldo(v) > 0 ? 'var(--warn)' : 'var(--dim)' }}>{ventaSaldo(v) > 0 ? L(ventaSaldo(v)) : '—'}</td>
                      <td className="num" style={{ color: cancel ? 'var(--dim)' : 'var(--ok)', fontWeight: 600 }}>{cancel ? '—' : L(ventaGanancia(v, payConfig))}</td>
                      <td onClick={e => { if (!cancel && ventaSaldo(v) > 0) openMenu(e, 'pago', v); else e.stopPropagation(); }}>
                        <span style={{ cursor: !cancel && ventaSaldo(v) > 0 ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <PagoBadge v={v} />{!cancel && ventaSaldo(v) > 0 && <Icon name="down" size={10} />}
                        </span>
                      </td>
                      <td onClick={e => openMenu(e, 'estado', v)}>
                        <span style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <EstadoBadge s={v.estado} /><Icon name="down" size={10} />
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 11, color: entregaVencida(v) ? 'var(--danger)' : 'var(--muted)' }}>
                        {v.entrega ? fmtFecha(v.entrega) : '—'}{entregaVencida(v) && ' ⚠'}
                      </td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtFecha(v.fecha)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="icon-btn danger" title="Eliminar venta"
                          onClick={() => uiConfirm({ title: `Eliminar venta #${v.n}`, message: `Cliente: ${v.cliente}\nTotal: ${L(v.total)}\n\nSi solo se canceló, mejor cambiá el estado a «Cancelado» para conservar el registro.`, confirmLabel: 'Eliminar' }).then(ok => { if (ok) onDelete(v.n); })}>
                          <Icon name="x" size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr><td colSpan="11" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)', cursor: 'default' }} className="mono">Ninguna venta coincide con los filtros</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {ventas.length > 0 && (
          <div className="panel-footer" style={{ flexWrap: 'wrap' }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em' }}>{filtered.length} FILAS</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              <span className="muted">TOTAL <span style={{ color: 'var(--text)' }}>{L(sum.total)}</span></span>
              <span className="muted">COBRADO <span style={{ color: 'var(--ok)' }}>{L(sum.cobrado)}</span></span>
              <span className="muted">POR COBRAR <span style={{ color: 'var(--warn)' }}>{L(sum.saldo)}</span></span>
              <span className="muted">GANANCIA <span style={{ color: 'var(--text)' }}>{L(sum.ganancia)}</span></span>
            </div>
          </div>
        )}
      </div>

      <PickMenu
        menu={menu && menu.kind === 'estado' ? menu : null}
        options={ESTADOS.map(s => ({ id: s, node: <EstadoBadge s={s} /> }))}
        onPick={(s) => { onUpdate(menu.n, { estado: s }); setMenu(null); }}
        onClose={() => setMenu(null)} />
      <PickMenu
        menu={menu && menu.kind === 'pago' ? { ...menu, current: null } : null}
        options={[
          { id: 'cobrar', label: menuVenta ? `✓ Cobrar saldo completo · ${L(ventaSaldo(menuVenta))}` : 'Cobrar saldo' },
          { id: 'abono', label: '＋ Registrar abono parcial…' },
        ]}
        onPick={pickPago}
        onClose={() => setMenu(null)} />

      {openN && (() => {
        const v = ventas.find(x => x.n === openN);
        if (!v) return null;
        return (
          <VentaModal venta={v} config={config} onClose={() => setOpenN(null)}
            onUpdate={(patch) => onUpdate(v.n, patch)}
            onAbono={(ab) => onAbono(v.n, ab)}
            onDuplicate={() => { setOpenN(null); onDuplicate(v); }}
            onDelete={() => uiConfirm({ title: `Eliminar venta #${v.n}`, message: `Cliente: ${v.cliente}\nTotal: ${L(v.total)}`, confirmLabel: 'Eliminar' }).then(ok => { if (ok) { setOpenN(null); onDelete(v.n); } })} />
        );
      })()}
    </div>
  );
}

function VentaModal({ venta: v, config, onClose, onUpdate, onAbono, onDuplicate, onDelete }) {
  const { payConfig } = config;
  const saldo = ventaSaldo(v);
  const [ab, setAb] = useState({ monto: saldo > 0 ? String(saldo) : '', fecha: today(), metodo: v.pay });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [nota, setNota] = useState(v.nota || '');

  useEffect(() => { setAb(a => ({ ...a, monto: saldo > 0 ? String(saldo) : '' })); }, [saldo]);

  const startEdit = () => { setDraft({ items: v.items.map(i => ({ ...i, precio: String(i.precio), costo: String(i.costo), key: uid('LN') })), descuento: String(v.descuento || 0) }); setEditing(true); };
  const saveEdit = () => {
    const items = draft.items.map(({ key, ...i }) => ({ ...i, precio: num(i.precio), costo: num(i.costo), q: num(i.q) || 1 }));
    const subtotal = items.reduce((a, i) => a + i.precio * i.q, 0);
    const descuento = Math.min(subtotal, Math.max(0, num(draft.descuento)));
    onUpdate({ items, subtotal, descuento, total: subtotal - descuento });
    setEditing(false);
  };
  const updD = (key, patch) => setDraft(d => ({ ...d, items: d.items.map(i => i.key === key ? { ...i, ...patch } : i) }));

  const addAbono = () => {
    const m = num(ab.monto);
    if (m <= 0) return;
    onAbono({ id: uid('AB'), fecha: ab.fecha || today(), monto: m, metodo: ab.metodo });
  };
  const delAbono = (id) => uiConfirm({ title: 'Quitar este cobro', message: 'El saldo de la venta vuelve a subir.', confirmLabel: 'Quitar' })
    .then(ok => { if (ok) onUpdate({ abonos: (v.abonos || []).filter(a => a.id !== id) }); });

  const costo = ventaCosto(v), com = ventaComision(v, payConfig), gan = ventaGanancia(v, payConfig);

  return (
    <Modal kicker={`Venta · ${fmtFechaLarga(v.fecha)}`} title={<span>#{v.n} · {v.cliente}</span>} onClose={onClose} width={760}
      footer={<>
        <button className="btn sm ghost" style={{ color: 'var(--danger)', marginRight: 'auto' }} onClick={onDelete}><Icon name="trash" size={12} /> Eliminar</button>
        <button className="btn sm" onClick={onDuplicate} title="Crea una venta nueva con el mismo cliente y servicios"><Icon name="copy" size={12} /> Vender de nuevo</button>
        <button className="btn sm primary" onClick={onClose}>Listo</button>
      </>}>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="kv">
          <div className="k">Cliente</div>
          <div className="v">{v.cliente}{v.empresa && <span className="muted"> · {v.empresa}</span>}</div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>{[v.telefono, v.email, v.canal].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="kv">
          <div className="k">Estado del trabajo</div>
          <div className="chips" style={{ marginTop: 4 }}>
            {ESTADOS.map(s => <button key={s} className={`chipbtn ${v.estado === s ? 'on' : ''}`} onClick={() => onUpdate({ estado: s })}>{ESTADO_LABELS[s]}</button>)}
          </div>
        </div>
        <div className="field">
          <label>Fecha de venta</label>
          <input className="input mini mono" type="date" value={v.fecha} onChange={e => e.target.value && onUpdate({ fecha: e.target.value })} style={{ colorScheme: 'dark' }} />
        </div>
        <div className="field">
          <label>Entrega {entregaVencida(v) && <span style={{ color: 'var(--danger)' }}>· vencida</span>}</label>
          <input className="input mini mono" type="date" value={v.entrega || ''} onChange={e => onUpdate({ entrega: e.target.value })} style={{ colorScheme: 'dark' }} />
        </div>
      </div>

      <div className="sec-head">
        <span>Servicios</span>
        {!editing
          ? <button className="linkbtn" onClick={startEdit}><Icon name="edit" size={11} /> Editar</button>
          : <span style={{ display: 'flex', gap: 8 }}><button className="btn sm ghost" onClick={() => setEditing(false)}>Cancelar</button><button className="btn sm primary" onClick={saveEdit}>Guardar</button></span>}
      </div>
      {!editing ? (
        <div style={{ marginBottom: 20 }}>
          {v.items.map((i, idx) => (
            <div key={idx} className="summary-row" style={{ gap: 12, borderBottom: '1px solid var(--line)' }}>
              <span style={{ color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                <b style={{ fontWeight: 600 }}>{i.nombre}</b>{i.q > 1 && <span className="dim"> · {i.q} × {L(i.precio)}</span>}
                <span className="mono dim" style={{ fontSize: 9, letterSpacing: '0.1em', marginLeft: 8, textTransform: 'uppercase' }}>{i.categoria}</span>
                {i.descripcion && <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>{i.descripcion}</span>}
              </span>
              <span className="r" style={{ textAlign: 'right' }}>{L(i.precio * i.q)}{i.costo > 0 && <span className="dim" style={{ display: 'block', fontSize: 10 }}>costo {L(i.costo * i.q)}</span>}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          {draft.items.map(i => (
            <div className="ln" key={i.key}>
              <div className="ln-top">
                <div style={{ flex: 1 }} className="srv-name">{i.nombre}</div>
                {draft.items.length > 1 && <button className="icon-btn danger" onClick={() => setDraft(d => ({ ...d, items: d.items.filter(x => x.key !== i.key) }))}><Icon name="x" size={12} /></button>}
              </div>
              <textarea className="input mini" rows="1" style={{ marginTop: 8 }} value={i.descripcion} placeholder="Detalle" onChange={e => updD(i.key, { descripcion: e.target.value })} />
              <div className="ln-grid">
                <label><span className="mini-lbl">Precio</span><input className="input mini mono" value={i.precio} onChange={e => updD(i.key, { precio: e.target.value })} /></label>
                <label><span className="mini-lbl">Cant.</span><Qty value={i.q} onChange={q => updD(i.key, { q })} /></label>
                <label><span className="mini-lbl">Costo</span><input className="input mini mono" value={i.costo} onChange={e => updD(i.key, { costo: e.target.value })} /></label>
              </div>
            </div>
          ))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
            <span className="mini-lbl" style={{ margin: 0 }}>Descuento</span>
            <input className="input mini mono" style={{ width: 120 }} value={draft.descuento} onChange={e => setDraft(d => ({ ...d, descuento: e.target.value }))} />
          </label>
        </div>
      )}

      <div className="fin-strip">
        {[
          { l: 'Total', v: L(v.total) },
          { l: 'Costos', v: '−' + L(costo) },
          { l: 'Comisión', v: com > 0 ? '−' + L(com) : '—' },
          { l: 'Ganancia', v: L(gan), c: 'var(--ok)' },
          { l: 'Saldo', v: L(saldo), c: saldo > 0 ? 'var(--warn)' : 'var(--dim)' },
        ].map(x => (
          <div key={x.l}><div className="k">{x.l}</div><div className="v" style={{ color: x.c }}>{x.v}</div></div>
        ))}
      </div>
      {v.descuento > 0 && <div className="mono dim" style={{ fontSize: 10, marginTop: 6 }}>Incluye descuento de {L(v.descuento)} sobre {L(v.subtotal)}</div>}

      <div className="sec-head" style={{ marginTop: 22 }}>
        <span>Cobros · <PagoBadge v={v} /></span>
        <select className="select mini" style={{ width: 'auto' }} value={v.pay} onChange={e => onUpdate({ pay: e.target.value })} title="Método de pago principal (define la comisión)">
          {payConfig.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      {(v.abonos || []).length === 0 && <div className="mono dim" style={{ fontSize: 11, padding: '6px 0 10px' }}>Sin cobros registrados.</div>}
      {(v.abonos || []).map(a => (
        <div key={a.id} className="abono-row">
          <span className="mono">{fmtFechaLarga(a.fecha)}</span>
          <span className="muted">{payConfig.find(p => p.id === a.metodo)?.label || a.metodo}</span>
          <span className="mono" style={{ marginLeft: 'auto', color: 'var(--ok)', fontWeight: 600 }}>{L(a.monto)}</span>
          <button className="icon-btn danger" onClick={() => delAbono(a.id)} title="Quitar cobro"><Icon name="x" size={11} /></button>
        </div>
      ))}
      {saldo > 0 && v.estado !== 'cancelado' && (
        <div className="abono-add">
          <input className="input mini mono" style={{ width: 130 }} inputMode="decimal" value={ab.monto} onChange={e => setAb(a => ({ ...a, monto: e.target.value }))} placeholder="Monto" />
          <input className="input mini mono" type="date" style={{ width: 150, colorScheme: 'dark' }} value={ab.fecha} onChange={e => setAb(a => ({ ...a, fecha: e.target.value }))} />
          <select className="select mini" style={{ width: 'auto' }} value={ab.metodo} onChange={e => setAb(a => ({ ...a, metodo: e.target.value }))}>
            {payConfig.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button className="btn sm primary" onClick={addAbono} disabled={num(ab.monto) <= 0}><Icon name="plus" size={11} /> Registrar cobro</button>
        </div>
      )}

      <div className="field" style={{ marginTop: 22 }}>
        <label>Nota</label>
        <textarea className="textarea" rows="2" value={nota} onChange={e => setNota(e.target.value)} onBlur={() => { if (nota !== (v.nota || '')) onUpdate({ nota }); }} placeholder="Brief, acuerdos, links…" />
      </div>

      {(v.estadoLog || []).length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="mini-lbl">Historial</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {v.estadoLog.map((e, i) => (
              <span key={i} className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                {i > 0 && <span className="dim">→ </span>}{ESTADO_LABELS[e.estado] || e.estado} <span className="dim">{formatTs(e.ts)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ═══════════════════════ SERVICIOS (TIPOS) ═══════════════════════
function Servicios({ servicios, stats, config, onSave, onDelete, onVender }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [verArchivados, setVerArchivados] = useState(false);
  const [editing, setEditing] = useState(null); // servicio o {} nuevo
  const [sort, setSort] = useState({ col: 'q', dir: 'desc' });

  const list = servicios.filter(s =>
    (verArchivados || s.activo !== false) &&
    (cat === 'all' || s.categoria === cat) &&
    (!q || norm(`${s.nombre} ${s.categoria} ${s.descripcion}`).includes(norm(q))));
  const val = (s, col) => {
    const st = stats[s.id] || {};
    if (col === 'nombre') return norm(s.nombre);
    if (col === 'categoria') return norm(s.categoria);
    if (col === 'precio') return num(s.precio);
    if (col === 'margen') return num(s.precio) > 0 ? (num(s.precio) - num(s.costo)) / num(s.precio) : -1;
    if (col === 'ingresos') return st.ingresos || 0;
    if (col === 'ultima') return st.ultima || '';
    return st.q || 0;
  };
  const sorted = [...list].sort((a, b) => { const va = val(a, sort.col), vb = val(b, sort.col); return (va < vb ? -1 : va > vb ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1); });
  const toggleSort = (col) => setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'nombre' || col === 'categoria' ? 'asc' : 'desc' });
  const SortIcon = ({ col }) => sort.col !== col ? null : <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--accent)' }}>{sort.dir === 'asc' ? '▲' : '▼'}</span>;

  const activos = servicios.filter(s => s.activo !== false).length;
  const archivados = servicios.length - activos;
  const cats = config.categorias.filter(c => servicios.some(s => s.categoria === c));

  const remove = (s) => {
    const st = stats[s.id];
    if (st?.ventas > 0) {
      uiConfirm({ title: `Archivar «${s.nombre}»`, message: `Ya se vendió ${st.ventas} ${st.ventas === 1 ? 'vez' : 'veces'}, así que no se borra: se archiva para que no aparezca en Nueva venta. Las ventas pasadas quedan intactas.`, confirmLabel: 'Archivar', danger: false })
        .then(ok => { if (ok) { onSave({ ...s, activo: false }); setEditing(null); } });
    } else {
      uiConfirm({ title: `Eliminar «${s.nombre}»`, message: 'Nunca se vendió, así que se borra por completo.', confirmLabel: 'Eliminar' })
        .then(ok => { if (ok) { onDelete(s.id); setEditing(null); } });
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Catálogo</div>
          <div className="page-title">Tipos de servicio</div>
          <div className="page-desc">Lo que vende LOOPA. Cada tipo guarda nombre, precio y costo base; al vender solo lo elegís y ajustás el detalle. {activos} activos{archivados > 0 ? ` · ${archivados} archivados` : ''}.</div>
        </div>
        <button className="btn primary" onClick={() => setEditing({})}><Icon name="plus" size={12} /> Nuevo tipo</button>
      </div>

      <div className="filterbar">
        <div className="filter-group">
          <Icon name="search" size={13} />
          <input className="fg-input" style={{ width: 200 }} placeholder="Buscar tipo…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="filter-group">
          <span className="flabel">Categoría</span>
          <select value={cat} onChange={e => setCat(e.target.value)}>
            <option value="all">Todas</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {archivados > 0 && (
          <button className={`chipbtn ${verArchivados ? 'on' : ''}`} onClick={() => setVerArchivados(x => !x)}>
            <Icon name="archive" size={11} /> Ver archivados
          </button>
        )}
      </div>

      <div className="panel crop">
        {servicios.length === 0 ? (
          <Empty icon="tag" title="Tu catálogo está vacío">
            Creá tus tipos de servicio acá o directamente en <b>Nueva venta</b> escribiendo el nombre.
            <div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => setEditing({})}><Icon name="plus" size={12} /> Crear el primero</button></div>
          </Empty>
        ) : (
          <div className="tbl-wrap" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  {[
                    { col: 'nombre', label: 'Servicio' }, { col: 'categoria', label: 'Categoría' }, { col: null, label: 'Unidad' },
                    { col: 'precio', label: 'Precio base', r: 1 }, { col: null, label: 'Costo', r: 1 }, { col: 'margen', label: 'Margen', r: 1 },
                    { col: 'q', label: 'Vendidos', r: 1 }, { col: 'ingresos', label: 'Ingresos', r: 1 }, { col: 'ultima', label: 'Última venta' }, { col: null, label: '' },
                  ].map((h, i) => (
                    <th key={i} style={{ textAlign: h.r ? 'right' : 'left', cursor: h.col ? 'pointer' : 'default' }} onClick={h.col ? () => toggleSort(h.col) : undefined}>
                      {h.label}{h.col && <SortIcon col={h.col} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => {
                  const st = stats[s.id] || {};
                  const margen = num(s.precio) > 0 ? ((num(s.precio) - num(s.costo)) / num(s.precio)) * 100 : null;
                  return (
                    <tr key={s.id} onClick={() => setEditing(s)} style={{ opacity: s.activo === false ? 0.45 : 1 }}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{s.nombre}{s.activo === false && <span className="mono dim" style={{ fontSize: 9, marginLeft: 8, letterSpacing: '0.1em' }}>ARCHIVADO</span>}</div>
                        {s.descripcion && <div className="muted" style={{ fontSize: 11, maxWidth: 340, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.descripcion}</div>}
                      </td>
                      <td><span className="srv-chip">{s.categoria}</span></td>
                      <td className="mono muted" style={{ fontSize: 11 }}>{s.unidad}</td>
                      <td className="num">{L(s.precio)}</td>
                      <td className="num dim">{num(s.costo) > 0 ? L(s.costo) : '—'}</td>
                      <td className="num" style={{ color: margen == null ? 'var(--dim)' : margen >= 50 ? 'var(--ok)' : margen >= 25 ? 'var(--warn)' : 'var(--danger)' }}>{margen == null ? '—' : `${margen.toFixed(0)}%`}</td>
                      <td className="num">{st.q || 0}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{st.ingresos ? L(st.ingresos) : '—'}</td>
                      <td className="mono muted" style={{ fontSize: 11 }}>{st.ultima ? fmtFecha(st.ultima) : '—'}</td>
                      <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                        {s.activo !== false && <button className="btn sm ghost" onClick={() => onVender(s)} title="Nueva venta con este servicio"><Icon name="plus" size={11} /> Vender</button>}
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && <tr><td colSpan="10" className="mono" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)', cursor: 'default' }}>Ningún tipo coincide</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <ServicioForm servicio={editing} servicios={servicios} categorias={config.categorias} stats={stats}
          onClose={() => setEditing(null)}
          onSave={(s) => { onSave(s); setEditing(null); }}
          onRemove={editing.id ? () => remove(editing) : null} />
      )}
    </div>
  );
}

function ServicioForm({ servicio, servicios, categorias, stats, onClose, onSave, onRemove }) {
  const isNew = !servicio.id;
  const [d, setD] = useState(() => ({
    nombre: servicio.nombre || '', categoria: servicio.categoria || categorias[0] || 'Otro', unidad: servicio.unidad || 'proyecto',
    precio: servicio.precio != null ? String(servicio.precio) : '', costo: servicio.costo != null ? String(servicio.costo) : '',
    descripcion: servicio.descripcion || '', activo: servicio.activo !== false,
  }));
  const set = (k) => (e) => setD(x => ({ ...x, [k]: e.target.value }));
  const dup = servicios.find(s => s.id !== servicio.id && norm(s.nombre) === norm(d.nombre));
  const st = stats[servicio.id] || {};
  const margen = num(d.precio) > 0 ? ((num(d.precio) - num(d.costo)) / num(d.precio)) * 100 : null;
  const save = () => {
    if (!d.nombre.trim() || dup) return;
    onSave({ ...servicio, ...d, nombre: d.nombre.trim(), categoria: d.categoria.trim() || 'Otro', precio: num(d.precio), costo: num(d.costo), descripcion: d.descripcion.trim() });
  };
  return (
    <Modal kicker={isNew ? 'Nuevo tipo de servicio' : `Tipo · ${servicio.id}`} title={isNew ? 'Nuevo tipo' : servicio.nombre} onClose={onClose} width={620}
      footer={<>
        {onRemove && <button className="btn sm ghost" style={{ color: 'var(--danger)', marginRight: 'auto' }} onClick={onRemove}>
          <Icon name={st.ventas ? 'archive' : 'trash'} size={12} /> {st.ventas ? 'Archivar' : 'Eliminar'}
        </button>}
        <button className="btn sm ghost" onClick={onClose}>Cancelar</button>
        <button className="btn sm primary" onClick={save} disabled={!d.nombre.trim() || !!dup}>{isNew ? 'Crear tipo' : 'Guardar'}</button>
      </>}>
      {!isNew && st.q > 0 && (
        <div className="fin-strip" style={{ marginBottom: 18 }}>
          <div><div className="k">Vendido</div><div className="v">{st.q}×</div></div>
          <div><div className="k">En ventas</div><div className="v">{st.ventas}</div></div>
          <div><div className="k">Ingresos</div><div className="v">{L(st.ingresos)}</div></div>
          <div><div className="k">Precio prom.</div><div className="v">{L(st.ingresos / st.q)}</div></div>
          <div><div className="k">Última</div><div className="v">{fmtFecha(st.ultima)}</div></div>
        </div>
      )}
      <div className="grid-2">
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Nombre <span className="req">*</span> {dup && <span style={{ color: 'var(--danger)' }}>· ya existe un tipo con ese nombre</span>}</label>
          <input className="input" autoFocus value={d.nombre} onChange={set('nombre')} placeholder="Ej. Reel publicitario 30s" onKeyDown={e => { if (e.key === 'Enter') save(); }} />
        </div>
        <div className="field">
          <label>Categoría</label>
          <input className="input" list="loopa-cats-form" value={d.categoria} onChange={set('categoria')} />
          <datalist id="loopa-cats-form">{categorias.map(c => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="field">
          <label>Se cobra por</label>
          <select className="select" value={d.unidad} onChange={set('unidad')}>{UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}</select>
        </div>
        <div className="field">
          <label>Precio base</label>
          <input className="input mono" inputMode="decimal" value={d.precio} onChange={set('precio')} placeholder="0" />
        </div>
        <div className="field">
          <label>Costo base {margen != null && <span className="dim">· margen {margen.toFixed(0)}%</span>}</label>
          <input className="input mono" inputMode="decimal" value={d.costo} onChange={set('costo')} placeholder="0" />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Qué incluye</label>
          <textarea className="textarea" rows="3" value={d.descripcion} onChange={set('descripcion')} placeholder="Se copia como detalle cada vez que lo vendés (editable en la venta)" />
        </div>
        {!isNew && (
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Disponible en Nueva venta</label>
            <div className="segmented" style={{ alignSelf: 'flex-start' }}>
              <button className={d.activo ? 'on' : ''} onClick={() => setD(x => ({ ...x, activo: true }))}>Activo</button>
              <button className={!d.activo ? 'on' : ''} onClick={() => setD(x => ({ ...x, activo: false }))}>Archivado</button>
            </div>
          </div>
        )}
      </div>
      {!isNew && <div className="mono dim" style={{ fontSize: 10, marginTop: 14, lineHeight: 1.6 }}>Cambiar el precio base solo afecta ventas nuevas: las pasadas conservan lo que se cobró.</div>}
    </Modal>
  );
}

// ═══════════════════════ CLIENTES ═══════════════════════
function Clientes({ clientes, ventas, config, onSave, onDelete, onNuevaVenta, onOpenVenta }) {
  const [q, setQ] = useState('');
  const [soloSaldo, setSoloSaldo] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sort, setSort] = useState({ col: 'ultima', dir: 'desc' });

  const resumen = useMemo(() => {
    const m = {};
    ventas.forEach(v => {
      if (!v.clienteId) return;
      const r = m[v.clienteId] || (m[v.clienteId] = { ventas: 0, total: 0, saldo: 0, ultima: '' });
      if (!esActiva(v)) return;
      r.ventas++; r.total += num(v.total); r.saldo += ventaSaldo(v);
      if (v.fecha > r.ultima) r.ultima = v.fecha;
    });
    return m;
  }, [ventas]);

  const list = clientes.filter(c => (!soloSaldo || (resumen[c.id]?.saldo || 0) > 0) &&
    (!q || norm(`${c.nombre} ${c.empresa} ${c.email}`).includes(norm(q)) || (digits(q).length >= 3 && digits(c.telefono).includes(digits(q)))));
  const val = (c, col) => { const r = resumen[c.id] || {}; return col === 'nombre' ? norm(c.nombre) : col === 'ventas' ? r.ventas || 0 : col === 'total' ? r.total || 0 : col === 'saldo' ? r.saldo || 0 : r.ultima || c.creado || ''; };
  const sorted = [...list].sort((a, b) => { const va = val(a, sort.col), vb = val(b, sort.col); return (va < vb ? -1 : va > vb ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1); });
  const toggleSort = (col) => setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'nombre' ? 'asc' : 'desc' });
  const SortIcon = ({ col }) => sort.col !== col ? null : <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--accent)' }}>{sort.dir === 'asc' ? '▲' : '▼'}</span>;
  const saldoTotal = Object.values(resumen).reduce((a, r) => a + r.saldo, 0);

  const exportCSV = () => downloadCSV(`loopa-clientes-${today()}.csv`,
    ['Nombre', 'Empresa', 'Teléfono', 'Email', 'Canal', 'Ventas', 'Total comprado', 'Saldo pendiente', 'Última compra', 'Notas'],
    sorted.map(c => { const r = resumen[c.id] || {}; return [c.nombre, c.empresa, c.telefono, c.email, c.canal, r.ventas || 0, r.total || 0, r.saldo || 0, r.ultima || '', c.notas]; }));

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Cartera</div>
          <div className="page-title">Clientes</div>
          <div className="page-desc">{clientes.length} clientes · Saldo pendiente total <span className="mono" style={{ color: 'var(--warn)' }}>{L(saldoTotal)}</span>. Se crean solos al registrar una venta.</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={exportCSV} disabled={!sorted.length}><Icon name="dl" size={12} /> Excel</button>
          <button className="btn primary" onClick={() => setEditing({})}><Icon name="plus" size={12} /> Nuevo cliente</button>
        </div>
      </div>

      <div className="filterbar">
        <div className="filter-group">
          <Icon name="search" size={13} />
          <input className="fg-input" style={{ width: 220 }} placeholder="Nombre, empresa, teléfono…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <button className={`chipbtn ${soloSaldo ? 'on' : ''}`} onClick={() => setSoloSaldo(x => !x)}>Con saldo pendiente</button>
      </div>

      <div className="panel crop">
        {clientes.length === 0 ? (
          <Empty icon="user" title="Sin clientes todavía">Se agregan automáticamente con cada venta, o creálos a mano.</Empty>
        ) : (
          <div className="tbl-wrap" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('nombre')}>Cliente<SortIcon col="nombre" /></th>
                  <th>Contacto</th>
                  <th>Canal</th>
                  <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('ventas')}>Ventas<SortIcon col="ventas" /></th>
                  <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('total')}>Total<SortIcon col="total" /></th>
                  <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('saldo')}>Saldo<SortIcon col="saldo" /></th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('ultima')}>Última compra<SortIcon col="ultima" /></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(c => {
                  const r = resumen[c.id] || {};
                  return (
                    <tr key={c.id} onClick={() => setEditing(c)}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{c.nombre}</div>
                        {c.empresa && <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>{c.empresa.toUpperCase()}</div>}
                      </td>
                      <td className="mono muted" style={{ fontSize: 11 }}>{c.telefono || c.email || '—'}{c.telefono && c.email && <div className="dim">{c.email}</div>}</td>
                      <td className="mono muted" style={{ fontSize: 11 }}>{c.canal || '—'}</td>
                      <td className="num">{r.ventas || 0}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{r.total ? L(r.total) : '—'}</td>
                      <td className="num" style={{ color: r.saldo > 0 ? 'var(--warn)' : 'var(--dim)' }}>{r.saldo > 0 ? L(r.saldo) : '—'}</td>
                      <td className="mono muted" style={{ fontSize: 11 }}>{r.ultima ? fmtFecha(r.ultima) : '—'}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="btn sm ghost" onClick={() => onNuevaVenta(c)}><Icon name="plus" size={11} /> Venta</button>
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && <tr><td colSpan="8" className="mono" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)', cursor: 'default' }}>Ningún cliente coincide</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <ClienteModal cliente={editing} ventas={ventas} config={config} clientes={clientes}
          onClose={() => setEditing(null)}
          onSave={(c) => { onSave(c); if (!editing.id) setEditing(null); }}
          onDelete={() => { onDelete(editing.id); setEditing(null); }}
          onNuevaVenta={() => { setEditing(null); onNuevaVenta(editing); }}
          onOpenVenta={(n) => { setEditing(null); onOpenVenta(n); }} />
      )}
    </div>
  );
}

function ClienteModal({ cliente, ventas, config, clientes, onClose, onSave, onDelete, onNuevaVenta, onOpenVenta }) {
  const isNew = !cliente.id;
  const [d, setD] = useState(() => ({ nombre: '', empresa: '', telefono: '', email: '', canal: config.canales[0] || '', notas: '', ...cliente }));
  const [dirty, setDirty] = useState(false);
  const set = (k) => (e) => { setD(x => ({ ...x, [k]: e.target.value })); setDirty(true); };
  const hist = ventas.filter(v => v.clienteId === cliente.id).sort((a, b) => b.n - a.n);
  const act = hist.filter(esActiva);
  const total = act.reduce((a, v) => a + num(v.total), 0);
  const saldo = act.reduce((a, v) => a + ventaSaldo(v), 0);
  const dupTel = digits(d.telefono).length >= 7 && clientes.find(c => c.id !== cliente.id && digits(c.telefono) === digits(d.telefono));
  const save = () => { if (!d.nombre.trim()) return; onSave({ ...d, nombre: d.nombre.trim() }); setDirty(false); };
  const del = () => {
    if (hist.length) { uiAlert({ title: 'No se puede eliminar', message: `${d.nombre} tiene ${hist.length} venta(s) registradas. Eliminá o reasigná esas ventas primero.` }); return; }
    uiConfirm({ title: `Eliminar a ${d.nombre}`, confirmLabel: 'Eliminar' }).then(ok => { if (ok) onDelete(); });
  };
  const serviciosTop = useMemo(() => {
    const m = {};
    act.forEach(v => v.items.forEach(i => { m[i.nombre] = (m[i.nombre] || 0) + i.q; }));
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [hist]);

  return (
    <Modal kicker={isNew ? 'Nuevo cliente' : `Cliente desde ${fmtFechaLarga(cliente.creado)}`} title={isNew ? 'Nuevo cliente' : cliente.nombre} onClose={onClose} width={760}
      footer={<>
        {!isNew && <button className="btn sm ghost" style={{ color: 'var(--danger)', marginRight: 'auto' }} onClick={del}><Icon name="trash" size={12} /> Eliminar</button>}
        {!isNew && <button className="btn sm" onClick={onNuevaVenta}><Icon name="plus" size={12} /> Nueva venta</button>}
        <button className="btn sm primary" onClick={() => { if (dirty || isNew) save(); if (!isNew) onClose(); }} disabled={!d.nombre.trim()}>{isNew ? 'Crear cliente' : dirty ? 'Guardar y cerrar' : 'Listo'}</button>
      </>}>
      {!isNew && (
        <div className="fin-strip" style={{ marginBottom: 18 }}>
          <div><div className="k">Ventas</div><div className="v">{act.length}</div></div>
          <div><div className="k">Total comprado</div><div className="v">{L(total)}</div></div>
          <div><div className="k">Ticket prom.</div><div className="v">{act.length ? L(total / act.length) : '—'}</div></div>
          <div><div className="k">Saldo</div><div className="v" style={{ color: saldo > 0 ? 'var(--warn)' : 'var(--dim)' }}>{L(saldo)}</div></div>
        </div>
      )}
      <div className="grid-2">
        <div className="field"><label>Nombre <span className="req">*</span></label><input className="input" autoFocus={isNew} value={d.nombre} onChange={set('nombre')} /></div>
        <div className="field"><label>Empresa / marca</label><input className="input" value={d.empresa} onChange={set('empresa')} /></div>
        <div className="field"><label>Teléfono {dupTel && <span style={{ color: 'var(--warn)' }}>· igual a {dupTel.nombre}</span>}</label><input className="input mono" value={d.telefono} onChange={set('telefono')} /></div>
        <div className="field"><label>Email</label><input className="input" value={d.email} onChange={set('email')} /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Canal</label>
          <div className="chips">{config.canales.map(ch => <button key={ch} className={`chipbtn ${d.canal === ch ? 'on' : ''}`} onClick={() => { setD(x => ({ ...x, canal: ch })); setDirty(true); }}>{ch}</button>)}</div>
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>Notas</label><textarea className="textarea" rows="2" value={d.notas} onChange={set('notas')} placeholder="Preferencias, fechas de renovación, contacto de facturación…" /></div>
      </div>

      {!isNew && serviciosTop.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="mini-lbl">Lo que más compra</div>
          <div className="chips">{serviciosTop.map(([n, q]) => <span key={n} className="srv-chip">{n} ×{q}</span>)}</div>
        </div>
      )}

      {!isNew && (
        <div style={{ marginTop: 18 }}>
          <div className="mini-lbl">Historial · {hist.length} ventas</div>
          {hist.length === 0 ? <div className="mono dim" style={{ fontSize: 11 }}>Sin ventas.</div> : (
            <div className="panel" style={{ borderRadius: 10 }}>
              <table className="tbl">
                <tbody>
                  {hist.map(v => (
                    <tr key={v.n} onClick={() => onOpenVenta(v.n)} style={{ opacity: esActiva(v) ? 1 : 0.5 }}>
                      <td className="order-n">#{v.n}</td>
                      <td className="mono muted" style={{ fontSize: 11 }}>{fmtFecha(v.fecha)}</td>
                      <td style={{ fontSize: 12 }}>{v.items.map(i => i.nombre).join(', ')}</td>
                      <td className="num">{L(v.total)}</td>
                      <td><PagoBadge v={v} /></td>
                      <td><EstadoBadge s={v.estado} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ═══════════════════════ MÉTRICAS ═══════════════════════
function Metricas({ ventas, gastos, config }) {
  const { payConfig } = config;
  const [period, setPeriod] = useState('mes');
  const r = periodRange(period);
  const act = ventas.filter(esActiva);
  const enPeriodo = act.filter(v => inRange(v.fecha, r));

  const monthsTodo = useMemo(() => {
    if (!act.length) return 1;
    const first = act.reduce((a, v) => v.fecha < a ? v.fecha : a, act[0].fecha);
    const d = parseYmd(first), n = new Date();
    return Math.max(1, (n.getFullYear() - d.getFullYear()) * 12 + n.getMonth() - d.getMonth() + 1);
  }, [ventas]);

  const k = useMemo(() => {
    const venta = enPeriodo.reduce((a, v) => a + num(v.total), 0);
    const cobrado = enPeriodo.reduce((a, v) => a + ventaCobrado(v), 0);
    const porCobrar = enPeriodo.reduce((a, v) => a + ventaSaldo(v), 0);
    const costos = enPeriodo.reduce((a, v) => a + ventaCosto(v), 0);
    const comisiones = enPeriodo.reduce((a, v) => a + ventaComision(v, payConfig), 0);
    const g = gastosEnPeriodo(gastos, r, monthsTodo);
    const ganancia = venta - costos - comisiones - g.total;
    const clientesUnicos = new Set(enPeriodo.map(v => v.clienteId)).size;
    return { venta, cobrado, porCobrar, costos, comisiones, gastosVar: g.variables, gastosFijos: g.fijos, ganancia, margen: venta > 0 ? ganancia / venta * 100 : 0, n: enPeriodo.length, ticket: enPeriodo.length ? venta / enPeriodo.length : 0, clientesUnicos };
  }, [ventas, gastos, period, payConfig, monthsTodo]);

  // Cobrado real en el período (por fecha del cobro, no de la venta)
  const cajaPeriodo = useMemo(() => act.reduce((a, v) => a + (v.abonos || []).filter(x => inRange(x.fecha, r)).reduce((s, x) => s + num(x.monto), 0), 0), [ventas, period]);

  const meses = useMemo(() => {
    const now = new Date(); const out = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      const vs = act.filter(v => v.fecha.slice(0, 7) === key);
      out.push({ key, lbl: d.toLocaleDateString('es-HN', { month: 'short' }).replace('.', '').toUpperCase(), v: vs.reduce((a, v) => a + num(v.total), 0), n: vs.length, current: i === 0 });
    }
    return out;
  }, [ventas]);
  const maxMes = Math.max(1, ...meses.map(m => m.v));

  const topServicios = useMemo(() => {
    const m = {};
    enPeriodo.forEach(v => v.items.forEach(i => {
      const key = i.tipoId || i.nombre;
      const x = m[key] || (m[key] = { nombre: i.nombre, categoria: i.categoria, q: 0, ingresos: 0 });
      x.q += num(i.q); x.ingresos += num(i.precio) * num(i.q);
    }));
    return Object.values(m).sort((a, b) => b.ingresos - a.ingresos).slice(0, 6);
  }, [ventas, period]);

  const breakdown = (keyFn) => {
    const m = {};
    enPeriodo.forEach(v => keyFn(v).forEach(([key, val]) => { m[key] = (m[key] || 0) + val; }));
    const tot = Object.values(m).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(m).map(([key, v]) => ({ key, v, pct: Math.round(v / tot * 100) })).sort((a, b) => b.v - a.v);
  };
  const porCategoria = useMemo(() => breakdown(v => v.items.map(i => [i.categoria || 'Otro', num(i.precio) * num(i.q)])), [ventas, period]);
  const porCanal = useMemo(() => breakdown(v => [[v.canal || '—', num(v.total)]]), [ventas, period]);
  const topClientes = useMemo(() => {
    const m = {};
    enPeriodo.forEach(v => { const x = m[v.clienteId || v.cliente] || (m[v.clienteId || v.cliente] = { nombre: v.cliente, empresa: v.empresa, total: 0, n: 0 }); x.total += num(v.total); x.n++; });
    return Object.values(m).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [ventas, period]);

  const Rows = ({ data, empty }) => data.length === 0
    ? <div className="mono" style={{ padding: 24, color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>{empty}</div>
    : <div>{data.map((c, i) => (
        <div key={c.key} className="channel-row">
          <div className="ch" title={c.key}><span className="mono" style={{ color: 'var(--dim)', marginRight: 8 }}>{pad2(i + 1)}</span>{c.key}</div>
          <div className="trk"><span style={{ width: `${c.pct}%` }} /></div>
          <div className="v">{c.pct}% · {L(c.v)}</div>
        </div>
      ))}</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Rendimiento</div>
          <div className="page-title">Métricas</div>
          <div className="page-desc">{r.label} · {k.n} ventas · {k.clientesUnicos} clientes · ticket promedio {L(k.ticket)}. Las ventas canceladas no cuentan.</div>
        </div>
        <div className="segmented" style={{ flexWrap: 'wrap' }}>
          {[['mes', 'Mes'], ['mes-ant', 'Mes ant.'], ['trim', 'Trim.'], ['año', 'Año'], ['todo', 'Todo']].map(([id, l]) => (
            <button key={id} className={period === id ? 'on' : ''} onClick={() => setPeriod(id)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="label"><span className="idx">01</span>Venta</div><div className="value">{L(k.venta)}</div></div>
        <div className="kpi"><div className="label"><span className="idx">02</span>Cobrado</div><div className="value">{L(k.cobrado)}</div><div className="delta" style={{ color: 'var(--muted)' }}>Caja del período {L(cajaPeriodo)}</div></div>
        <div className="kpi"><div className="label"><span className="idx">03</span>Por cobrar</div><div className="value" style={{ color: k.porCobrar > 0 ? 'var(--warn)' : undefined }}>{L(k.porCobrar)}</div></div>
        <div className="kpi accent"><div className="label"><span className="idx" style={{ color: 'rgba(20,40,31,0.55)' }}>04</span>Ganancia neta</div><div className="value">{L(k.ganancia)}</div></div>
        <div className="kpi"><div className="label"><span className="idx">05</span>Margen</div><div className="value">{k.margen.toFixed(1)}<span className="unit">%</span></div></div>
      </div>

      <div className="panel crop" style={{ marginBottom: 20 }}>
        <div className="panel-head"><div className="panel-title">DESGLOSE DE GANANCIA · <span className="dim">{r.label}</span></div></div>
        <div className="desglose">
          {[
            { lbl: 'Venta', val: k.venta, color: 'var(--text)', op: '' },
            { lbl: 'Costos directos', val: k.costos, op: '−' },
            { lbl: 'Comisiones', val: k.comisiones, op: '−' },
            { lbl: 'Gastos variables', val: k.gastosVar, op: '−' },
            { lbl: 'Gastos fijos', val: k.gastosFijos, op: '−' },
          ].map((x, i) => (
            <React.Fragment key={x.lbl}>
              {i > 0 && <span className="op">{x.op}</span>}
              <div className="dg"><span className="dl">{x.lbl}</span><span style={{ color: x.color || 'var(--warn)' }}>{x.op}{L(x.val)}</span></div>
            </React.Fragment>
          ))}
          <span className="op">=</span>
          <div className="dg total" style={{ borderColor: k.ganancia >= 0 ? 'var(--ok)' : 'var(--danger)', background: k.ganancia >= 0 ? 'rgba(123,201,111,.08)' : 'rgba(230,57,70,.08)' }}>
            <span className="dl">Ganancia neta</span><span style={{ color: k.ganancia >= 0 ? 'var(--ok)' : 'var(--danger)', fontSize: 15 }}>{L(k.ganancia)}</span>
          </div>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="panel crop">
          <div className="panel-head">
            <div className="panel-title">VENTA POR MES · <span className="dim">ÚLTIMOS 6</span></div>
            <span className="chip" style={{ marginLeft: 'auto' }}>PROM <span className="v mono">{L(meses.reduce((a, m) => a + m.v, 0) / Math.max(1, meses.filter(m => m.v > 0).length))}</span></span>
          </div>
          <div className="panel-body">
            <div className="bar-chart">
              {meses.map(m => (
                <div key={m.key} className="bar-col" title={`${m.n} ventas · ${L(m.v)}`}>
                  <div className="bar-wrap">
                    <div className="v">{m.v > 0 ? (m.v >= 1000 ? (m.v / 1000).toFixed(1) + 'K' : Math.round(m.v)) : '—'}</div>
                    <div className={`bar${m.v <= 0 ? ' ghost' : ''}`} style={{ height: `${Math.max(2, (m.v / maxMes) * 90)}%`, opacity: m.current ? 1 : 0.75 }} />
                  </div>
                  <div className="lbl" style={{ color: m.current ? 'var(--text)' : undefined }}>{m.lbl}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">TOP SERVICIOS</div><span className="chip" style={{ marginLeft: 'auto' }}>{r.label}</span></div>
          {topServicios.length === 0
            ? <div className="mono" style={{ padding: 24, color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>Sin ventas en el período</div>
            : <div className="top-list">{topServicios.map((s, i) => (
                <div key={i} className="top-row" style={{ gridTemplateColumns: '32px 1fr auto' }}>
                  <div className="rank">{pad2(i + 1)}</div>
                  <div style={{ minWidth: 0 }}><div className="nm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nombre}</div><div className="snm">{s.categoria} · {s.q} UDS</div></div>
                  <div className="v">{L(s.ingresos)}</div>
                </div>
              ))}</div>}
        </div>
      </div>

      <div className="metrics-grid-3">
        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">POR CATEGORÍA</div></div>
          <Rows data={porCategoria} empty="Sin ventas en el período" />
        </div>
        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">POR CANAL</div></div>
          <Rows data={porCanal} empty="Sin ventas en el período" />
        </div>
        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">TOP CLIENTES</div></div>
          {topClientes.length === 0
            ? <div className="mono" style={{ padding: 24, color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>Sin ventas en el período</div>
            : <div className="top-list">{topClientes.map((c, i) => (
                <div key={i} className="top-row" style={{ gridTemplateColumns: '32px 1fr auto' }}>
                  <div className="rank">{pad2(i + 1)}</div>
                  <div style={{ minWidth: 0 }}><div className="nm">{c.nombre}</div><div className="snm">{c.empresa ? c.empresa + ' · ' : ''}{c.n} venta{c.n === 1 ? '' : 's'}</div></div>
                  <div className="v">{L(c.total)}</div>
                </div>
              ))}</div>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════ GASTOS ═══════════════════════
function Gastos({ gastos, setGastos }) {
  const [nv, setNv] = useState({ fecha: today(), concepto: '', categoria: GASTO_CATS[0], monto: '' });
  const [nf, setNf] = useState({ concepto: '', categoria: 'Software', monto: '' });
  const r = periodRange('mes');
  const mesVar = (gastos.variables || []).filter(g => inRange(g.fecha, r)).reduce((a, g) => a + num(g.monto), 0);
  const fijoM = fijoMensual(gastos.fijos);

  const addVar = () => {
    if (!nv.concepto.trim() || num(nv.monto) <= 0) return;
    setGastos(g => ({ ...g, variables: [{ id: uid('GV'), ...nv, concepto: nv.concepto.trim(), monto: num(nv.monto) }, ...(g.variables || [])] }));
    setNv(x => ({ ...x, concepto: '', monto: '' }));
  };
  const addFijo = () => {
    if (!nf.concepto.trim() || num(nf.monto) <= 0) return;
    setGastos(g => ({ ...g, fijos: [...(g.fijos || []), { id: uid('GF'), ...nf, concepto: nf.concepto.trim(), monto: num(nf.monto), activo: true }] }));
    setNf({ concepto: '', categoria: 'Software', monto: '' });
  };
  const delVar = (id) => setGastos(g => ({ ...g, variables: g.variables.filter(x => x.id !== id) }));
  const delFijo = (f) => uiConfirm({ title: `Quitar «${f.concepto}»`, message: 'Deja de restarse en Métricas.', confirmLabel: 'Quitar' }).then(ok => { if (ok) setGastos(g => ({ ...g, fijos: g.fijos.filter(x => x.id !== f.id) })); });
  const toggleFijo = (id) => setGastos(g => ({ ...g, fijos: g.fijos.map(x => x.id === id ? { ...x, activo: x.activo === false } : x) }));
  const vars = [...(gastos.variables || [])].sort((a, b) => b.fecha.localeCompare(a.fecha));

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Operación</div>
          <div className="page-title">Gastos</div>
          <div className="page-desc">Lo que cuesta mover LOOPA. Se resta en Métricas para llegar a la ganancia neta real. Este mes: variables <span className="mono">{L(mesVar)}</span> + fijos <span className="mono">{L(fijoM)}</span>.</div>
        </div>
      </div>

      <div className="metrics-grid-2">
        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">GASTOS VARIABLES · <span className="dim">CON FECHA</span></div></div>
          <div className="panel-body">
            <div className="gasto-form">
              <input className="input mini mono" type="date" value={nv.fecha} onChange={e => setNv(x => ({ ...x, fecha: e.target.value || today() }))} style={{ colorScheme: 'dark' }} />
              <input className="input mini" placeholder="Concepto (ej. Editor freelance)" value={nv.concepto} onChange={e => setNv(x => ({ ...x, concepto: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addVar()} />
              <select className="select mini" value={nv.categoria} onChange={e => setNv(x => ({ ...x, categoria: e.target.value }))}>{GASTO_CATS.map(c => <option key={c}>{c}</option>)}</select>
              <input className="input mini mono" placeholder="Monto" inputMode="decimal" value={nv.monto} onChange={e => setNv(x => ({ ...x, monto: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addVar()} />
              <button className="btn sm primary" onClick={addVar}><Icon name="plus" size={11} /></button>
            </div>
            {vars.length === 0 ? <div className="mono dim" style={{ fontSize: 11, textAlign: 'center', padding: 20 }}>Sin gastos variables</div> : vars.map(g => (
              <div key={g.id} className="abono-row">
                <span className="mono dim" style={{ width: 60 }}>{fmtFecha(g.fecha)}</span>
                <span style={{ flex: 1 }}>{g.concepto} <span className="srv-chip" style={{ marginLeft: 6 }}>{g.categoria}</span></span>
                <span className="mono" style={{ fontWeight: 600 }}>{L(g.monto)}</span>
                <button className="icon-btn danger" onClick={() => delVar(g.id)}><Icon name="x" size={11} /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">GASTOS FIJOS · <span className="dim">MENSUALES</span></div><span className="chip" style={{ marginLeft: 'auto' }}>MES <span className="v mono">{L(fijoM)}</span></span></div>
          <div className="panel-body">
            <div className="gasto-form" style={{ gridTemplateColumns: '1fr 130px 110px auto' }}>
              <input className="input mini" placeholder="Concepto (ej. Adobe CC)" value={nf.concepto} onChange={e => setNf(x => ({ ...x, concepto: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addFijo()} />
              <select className="select mini" value={nf.categoria} onChange={e => setNf(x => ({ ...x, categoria: e.target.value }))}>{GASTO_CATS.map(c => <option key={c}>{c}</option>)}</select>
              <input className="input mini mono" placeholder="Monto/mes" inputMode="decimal" value={nf.monto} onChange={e => setNf(x => ({ ...x, monto: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addFijo()} />
              <button className="btn sm primary" onClick={addFijo}><Icon name="plus" size={11} /></button>
            </div>
            {(gastos.fijos || []).length === 0 ? <div className="mono dim" style={{ fontSize: 11, textAlign: 'center', padding: 20 }}>Sin gastos fijos</div> : gastos.fijos.map(f => (
              <div key={f.id} className="abono-row" style={{ opacity: f.activo === false ? 0.45 : 1 }}>
                <span style={{ flex: 1 }}>{f.concepto} <span className="srv-chip" style={{ marginLeft: 6 }}>{f.categoria}</span></span>
                <button className="chipbtn" style={{ padding: '3px 9px' }} onClick={() => toggleFijo(f.id)}>{f.activo === false ? 'Pausado' : 'Activo'}</button>
                <span className="mono" style={{ fontWeight: 600, width: 90, textAlign: 'right' }}>{L(f.monto)}</span>
                <button className="icon-btn danger" onClick={() => delFijo(f)}><Icon name="x" size={11} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════ CONFIGURACIÓN ═══════════════════════
function Configuracion({ config, setConfig, allData, onImport, showToast }) {
  const [newCat, setNewCat] = useState('');
  const [newCanal, setNewCanal] = useState('');
  const fileRef = useRef(null);
  const upd = (patch) => setConfig(c => ({ ...c, ...patch }));
  const updPay = (id, patch) => upd({ payConfig: config.payConfig.map(p => p.id === id ? { ...p, ...patch } : p) });
  const addPay = () => upd({ payConfig: [...config.payConfig, { id: uid('PM').toLowerCase(), label: 'Nuevo método', comisionPct: 0 }] });
  const delPay = (p) => {
    if (config.payConfig.length <= 1) return;
    uiConfirm({ title: `Quitar «${p.label}»`, message: 'Las ventas que ya lo usan conservan el registro pero dejarán de calcular su comisión.', confirmLabel: 'Quitar' })
      .then(ok => { if (ok) upd({ payConfig: config.payConfig.filter(x => x.id !== p.id) }); });
  };
  const addTo = (key, val, reset) => { const v = val.trim(); if (!v || config[key].some(x => norm(x) === norm(v))) return; upd({ [key]: [...config[key], v] }); reset(''); };
  const delFrom = (key, v) => upd({ [key]: config[key].filter(x => x !== v) });

  const exportJSON = () => {
    downloadFile(`loopa-respaldo-${today()}.json`, JSON.stringify({ app: 'LOOPA OS', version: 1, exportado: new Date().toISOString(), ...allData }, null, 2), 'application/json');
    showToast('✓ Respaldo descargado');
  };
  const importJSON = (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!Array.isArray(d.ventas) || !Array.isArray(d.servicios)) throw new Error('formato');
        uiConfirm({ title: 'Restaurar respaldo', message: `Reemplaza TODO lo actual por el respaldo:\n${d.ventas.length} ventas · ${d.servicios.length} tipos · ${(d.clientes || []).length} clientes\n\nDescargá un respaldo actual antes si tenés dudas.`, confirmLabel: 'Reemplazar todo' })
          .then(ok => { if (ok) onImport(d); });
      } catch (err) { uiAlert({ title: 'Archivo no válido', message: 'No parece un respaldo de LOOPA OS.' }); }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Sistema</div>
          <div className="page-title">Configuración</div>
          <div className="page-desc">Métodos de pago y comisiones, categorías, canales y respaldos.</div>
        </div>
      </div>

      <div className="metrics-grid-2" style={{ marginBottom: 20 }}>
        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">MÉTODOS DE PAGO</div><button className="btn sm" style={{ marginLeft: 'auto' }} onClick={addPay}><Icon name="plus" size={11} /> Agregar</button></div>
          <div className="panel-body">
            {config.payConfig.map(p => (
              <div key={p.id} className="abono-row">
                <input className="input mini" value={p.label} onChange={e => updPay(p.id, { label: e.target.value })} style={{ flex: 1 }} />
                <span className="mini-lbl" style={{ margin: 0 }}>Comisión</span>
                <input className="input mini mono" style={{ width: 70, textAlign: 'right' }} inputMode="decimal" value={p.comisionPct} onChange={e => updPay(p.id, { comisionPct: e.target.value.replace(/[^\d.]/g, '') })} onBlur={e => updPay(p.id, { comisionPct: num(e.target.value) })} />
                <span className="mono dim">%</span>
                <button className="icon-btn danger" disabled={config.payConfig.length <= 1} onClick={() => delPay(p)}><Icon name="x" size={11} /></button>
              </div>
            ))}
            <div className="mono dim" style={{ fontSize: 10, marginTop: 10, lineHeight: 1.6 }}>La comisión se resta del total de cada venta al calcular la ganancia (ej. POS o PayPal).</div>
          </div>
        </div>

        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">GENERAL</div></div>
          <div className="panel-body">
            <div className="field" style={{ marginBottom: 18 }}>
              <label>Símbolo de moneda</label>
              <input className="input mono" style={{ width: 120 }} value={config.moneda} onChange={e => upd({ moneda: e.target.value.slice(0, 4) })} />
            </div>
            <div className="field">
              <label>Dónde se guardan los datos</label>
              <div className="mono" style={{ fontSize: 12, lineHeight: 1.7, color: window.USE_FB ? 'var(--ok)' : 'var(--warn)' }}>
                {window.USE_FB ? '● Nube (Firebase) · sincronizado entre dispositivos' : '● Modo local · solo en este navegador'}
              </div>
              {!window.USE_FB && <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>Para usarlo desde el celular y la compu con los mismos datos, conectá Firebase (instrucciones en <span className="mono">LEEME.md</span>). Mientras tanto, descargá respaldos seguido.</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="metrics-grid-2" style={{ marginBottom: 20 }}>
        {[['categorias', 'CATEGORÍAS DE SERVICIO', newCat, setNewCat], ['canales', 'CANALES DE VENTA', newCanal, setNewCanal]].map(([key, title, val, setVal]) => (
          <div key={key} className="panel crop">
            <div className="panel-head"><div className="panel-title">{title}</div></div>
            <div className="panel-body">
              <div className="chips" style={{ marginBottom: 14 }}>
                {config[key].map(c => (
                  <span key={c} className="tag-edit">{c}<button onClick={() => delFrom(key, c)} title="Quitar"><Icon name="x" size={10} /></button></span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input mini" placeholder="Agregar…" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTo(key, val, setVal)} />
                <button className="btn sm" onClick={() => addTo(key, val, setVal)}><Icon name="plus" size={11} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="panel crop">
        <div className="panel-head"><div className="panel-title">RESPALDO</div></div>
        <div className="panel-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn" onClick={exportJSON}><Icon name="dl" size={12} /> Descargar respaldo (.json)</button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}><Icon name="ul" size={12} /> Restaurar respaldo…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={importJSON} />
          <span className="mono dim" style={{ fontSize: 10 }}>{allData.ventas.length} ventas · {allData.servicios.length} tipos · {allData.clientes.length} clientes</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════ SHELL ═══════════════════════
const LOOPA_AUTH_ERRORS = {
  'auth/user-not-found': 'No existe una cuenta con ese email.',
  'auth/wrong-password': 'Contraseña incorrecta.',
  'auth/invalid-credential': 'Email o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Email o contraseña incorrectos.',
  'auth/invalid-email': 'El email no tiene un formato válido.',
  'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos.',
  'auth/network-request-failed': 'Sin conexión. Verificá tu internet.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada.',
  'auth/operation-not-allowed': 'Email/contraseña no está habilitado en Firebase.',
};

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [shake, setShake] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const tryLogin = async () => {
    if (!email.trim() || !password || submitting) return;
    setSubmitting(true); setErrorMsg('');
    try { await firebase.auth().signInWithEmailAndPassword(email.trim(), password); }
    catch (e) {
      setErrorMsg(LOOPA_AUTH_ERRORS[e.code] || `Error inesperado (${e.code || e.message})`);
      setPassword(''); setShake(true); setTimeout(() => setShake(false), 500); setSubmitting(false);
    }
  };
  const onKey = (e) => { if (e.key === 'Enter') tryLogin(); };
  return (
    <div className="login">
      <div style={{ width: 340, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6, color: 'var(--accent)' }}><LoopaMark height={120} /></div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: '0.22em', marginBottom: 44, textTransform: 'uppercase' }}>Acceso privado · misma cuenta que FRAME</div>
        <div className={shake ? 'shake' : ''} style={{ background: 'var(--card)', border: `1px solid ${errorMsg ? 'var(--danger)' : 'var(--line)'}`, borderRadius: 18, padding: '32px 28px' }}>
          <input className="input mono" type="email" autoFocus autoComplete="username" placeholder="email" value={email} onChange={e => { setEmail(e.target.value); setErrorMsg(''); }} onKeyDown={onKey} style={{ marginBottom: 10 }} />
          <input className="input mono" type="password" autoComplete="current-password" placeholder="contraseña" value={password} onChange={e => { setPassword(e.target.value); setErrorMsg(''); }} onKeyDown={onKey} />
          {errorMsg && <div className="mono" style={{ fontSize: 10, color: 'var(--danger)', marginTop: 10, lineHeight: 1.6 }}>{errorMsg}</div>}
          <button className="btn primary" onClick={tryLogin} disabled={submitting || !email.trim() || !password} style={{ width: '100%', justifyContent: 'center', padding: 14, marginTop: 20 }}>
            {submitting ? 'VERIFICANDO…' : 'ENTRAR AL SISTEMA'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DialogHost() {
  const [state, setState] = useState(null);
  const close = (result) => { if (state) state.resolve(result); setState(null); };
  useEffect(() => { const fn = (s) => setState(s); _dialogListeners.add(fn); return () => _dialogListeners.delete(fn); }, []);
  useEffect(() => {
    window.__dialogOpen = !!state;
    if (!state) return;
    const h = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(state.kind === 'confirm' ? false : true); }
      if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [state]);
  if (!state) return null;
  const accent = state.danger ? 'var(--danger)' : 'var(--accent)';
  return (
    <div className="modal-back" style={{ zIndex: 3000, alignItems: 'center' }} onMouseDown={() => close(state.kind === 'confirm' ? false : true)}>
      <div className="modal" style={{ maxWidth: 420 }} onMouseDown={e => e.stopPropagation()}>
        <div style={{ padding: '22px 22px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, background: state.danger ? 'rgba(230,57,70,.12)' : 'rgba(var(--accent-rgb),.14)', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{state.danger ? '⚠' : 'ℹ'}</span>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{state.title}</div>
          </div>
          {state.message && <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', paddingLeft: 40 }}>{state.message}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 22 }}>
          {state.kind === 'confirm' && <button className="btn sm" onClick={() => close(false)}>{state.cancelLabel}</button>}
          <button className="btn sm" autoFocus onClick={() => close(true)} style={{ background: accent, borderColor: accent, color: state.danger ? '#fff' : 'var(--on-accent)', fontWeight: 700 }}>{state.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function AlertBell({ ventas, onOpen }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const alerts = useMemo(() => {
    const a = [];
    ventas.filter(entregaVencida).forEach(v => a.push({ key: `ent|${v.n}|${v.entrega}`, n: v.n, tipo: 'entrega', label: `#${v.n} · ${v.cliente}`, right: `vence ${fmtFecha(v.entrega)}` }));
    ventas.filter(v => esActiva(v) && ventaSaldo(v) > 0).sort((x, y) => x.fecha.localeCompare(y.fecha)).forEach(v => a.push({ key: `sal|${v.n}|${ventaSaldo(v)}`, n: v.n, tipo: 'cobro', label: `#${v.n} · ${v.cliente}`, right: L(ventaSaldo(v)) }));
    return a;
  }, [ventas]);
  const [read, setRead] = useState(() => { try { return JSON.parse(localStorage.getItem('loopa-bell-read') || '[]'); } catch (e) { return []; } });
  useEffect(() => { try { localStorage.setItem('loopa-bell-read', JSON.stringify(read)); } catch (e) {} }, [read]);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const unread = alerts.filter(a => !read.includes(a.key)).length;
  const groups = [['entrega', '⚠ ENTREGAS VENCIDAS'], ['cobro', '○ POR COBRAR']];
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={`bell-btn${unread ? ' has-alerts' : ''}`} onClick={() => setOpen(o => !o)} title={unread ? `${unread} avisos sin leer` : 'Sin avisos nuevos'}>
        <Icon name="bell" size={14} />
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-dropdown">
          <div className="bell-dropdown-head">
            AVISOS
            {unread > 0 && <button className="linkbtn" style={{ marginLeft: 'auto' }} onClick={() => setRead(alerts.map(a => a.key))}>Marcar leídos</button>}
          </div>
          {alerts.length === 0 && <div className="bell-empty">✓ Nada pendiente</div>}
          {groups.map(([tipo, lbl]) => {
            const g = alerts.filter(a => a.tipo === tipo);
            if (!g.length) return null;
            return (
              <div key={tipo} className="bell-section">
                <div className="bell-section-label">{lbl}</div>
                {g.map(a => (
                  <div key={a.key} className="bell-item" style={{ opacity: read.includes(a.key) ? 0.45 : 1, cursor: 'pointer' }} onClick={() => { setRead(r => [...new Set([...r, a.key])]); setOpen(false); onOpen(a.n); }}>
                    <span className="bell-item-label">{a.label}</span>
                    <span className="bell-item-qty" style={{ color: tipo === 'entrega' ? 'var(--danger)' : 'var(--warn)' }}>{a.right}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function App({ onLogout }) {
  const [route, setRoute] = useState(() => { try { return localStorage.getItem('loopa-route') || 'nueva'; } catch (e) { return 'nueva'; } });
  const [ventas, setVentas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [servicios, setServicios] = useState([]);
  const [config, setConfig] = useState(CONFIG_DEFAULT);
  const [gastos, setGastos] = useState(GASTOS_DEFAULT);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const [ventaKey, setVentaKey] = useState(0);
  const [prefill, setPrefill] = useState(null);
  const [focusN, setFocusN] = useState(null);
  const [gSearch, setGSearch] = useState('');
  const [gOpen, setGOpen] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  window.__CUR = config.moneda || 'L';

  const showToast = (msg, tone = 'ok') => { setToast({ msg, tone }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 3000); };
  const showActionToast = (msg, label, fn) => { setToast({ msg, tone: 'info', action: { label, fn } }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 6500); };


  // ── Carga ──
  const load = useCallback(() => {
    setLoadError(null);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Tiempo de espera agotado (12 s) — revisá tu conexión')), 12000));
    Promise.race([Store.loadAll(), timeout]).then(d => {
      if (d.ventas?.items) setVentas(d.ventas.items);
      if (d.clientes?.items) setClientes(d.clientes.items);
      if (d.servicios?.items) setServicios(d.servicios.items);
      if (d.config) setConfig({ ...CONFIG_DEFAULT, ...d.config });
      if (d.gastos) setGastos({ ...GASTOS_DEFAULT, ...d.gastos });
      setReady(true);
    }).catch(e => {
      console.error('Carga:', e);
      let msg = e.message || 'Error desconocido';
      if (e.code === 'permission-denied') msg = 'Acceso denegado — tu cuenta no está activa en el equipo (la misma aprobación que en FRAME)';
      if (e.code === 'unavailable') msg = 'Firebase no disponible — sin conexión a internet';
      setLoadError(msg);
    });
  }, []);
  useEffect(() => { load(); }, []);

  // ── Guardado con debounce + flush al cerrar ──
  const pending = useRef({});
  const timers = useRef({});
  const skipFirst = useRef({ ventas: true, clientes: true, servicios: true, config: true, gastos: true });
  const writeNow = (k) => {
    const data = pending.current[k];
    if (data === undefined) return;
    pending.current[k] = undefined;
    clearTimeout(timers.current[k]);
    Store.save(k, data).then(() => setSaveError(false)).catch(e => { console.warn('Guardar', k, e); setSaveError(true); });
  };
  const queueSave = (k, data) => {
    if (skipFirst.current[k]) { skipFirst.current[k] = false; return; }
    pending.current[k] = data;
    clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(() => writeNow(k), window.USE_FB ? 1500 : 300);
  };
  useEffect(() => {
    const flush = () => DOC_KEYS.forEach(writeNow);
    const vis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('beforeunload', flush); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', vis); };
  }, []);
  useEffect(() => { if (ready) queueSave('ventas', { items: ventas }); }, [ventas, ready]);
  useEffect(() => { if (ready) queueSave('clientes', { items: clientes }); }, [clientes, ready]);
  useEffect(() => { if (ready) queueSave('servicios', { items: servicios }); }, [servicios, ready]);
  useEffect(() => { if (ready) queueSave('config', config); }, [config, ready]);
  useEffect(() => { if (ready) queueSave('gastos', gastos); }, [gastos, ready]);

  useEffect(() => { try { localStorage.setItem('loopa-route', route); } catch (e) {} }, [route]);
  // ── Derivados ──
  const nextN = Math.max(1000, ...ventas.map(v => v.n)) + 1;
  const stats = useMemo(() => {
    const m = {};
    ventas.filter(esActiva).forEach(v => {
      const seen = new Set();
      (v.items || []).forEach(i => {
        if (!i.tipoId) return;
        const s = m[i.tipoId] || (m[i.tipoId] = { q: 0, ingresos: 0, ventas: 0, ultima: '' });
        s.q += num(i.q); s.ingresos += num(i.precio) * num(i.q);
        if (!seen.has(i.tipoId)) { s.ventas++; seen.add(i.tipoId); }
        if (v.fecha > s.ultima) s.ultima = v.fecha;
      });
    });
    return m;
  }, [ventas]);
  const ticker = useMemo(() => {
    const r = periodRange('mes');
    const mes = ventas.filter(v => esActiva(v) && inRange(v.fecha, r));
    const venta = mes.reduce((a, v) => a + num(v.total), 0);
    const g = gastosEnPeriodo(gastos, r);
    const ganancia = mes.reduce((a, v) => a + ventaGanancia(v, config.payConfig), 0) - g.total;
    // Cobrado del mes = plata que entró este mes (por fecha del cobro), esté el trabajo en proceso o entregado
    const cobrado = ventas.filter(esActiva).reduce((a, v) => a + (v.abonos || []).filter(x => inRange(x.fecha, r)).reduce((s, x) => s + num(x.monto), 0), 0);
    const porCobrar = ventas.reduce((a, v) => a + ventaSaldo(v), 0);
    const enCurso = ventas.filter(v => ['pendiente', 'en-proceso', 'revision'].includes(v.estado)).length;
    const mesLbl = new Date().toLocaleDateString('es-HN', { month: 'short', year: '2-digit' }).toUpperCase().replace('.', '');
    return { venta, cobrado, ganancia, porCobrar, enCurso, mesLbl };
  }, [ventas, gastos, config]);

  // ── Acciones ──
  const handleCreate = (venta, cli) => {
    // Resolver cliente: el elegido, o uno existente con mismo teléfono / email / nombre
    let cid = cli.id && clientes.some(c => c.id === cli.id) ? cli.id : null;
    if (!cid) {
      const match = clientes.find(c =>
        (digits(cli.telefono).length >= 7 && digits(c.telefono) === digits(cli.telefono)) ||
        (cli.email && norm(c.email) === norm(cli.email)) ||
        (norm(c.nombre) === norm(cli.nombre) && norm(c.empresa) === norm(cli.empresa)));
      cid = match ? match.id : null;
    }
    const datos = { nombre: cli.nombre.trim(), empresa: (cli.empresa || '').trim(), telefono: (cli.telefono || '').trim(), email: (cli.email || '').trim(), canal: cli.canal };
    if (cid) {
      setClientes(prev => prev.map(c => c.id === cid ? { ...c, ...Object.fromEntries(Object.entries(datos).filter(([, v]) => v)) } : c));
    } else {
      cid = uid('CL');
      setClientes(prev => [{ id: cid, ...datos, notas: '', creado: today() }, ...prev]);
    }
    const saved = { ...venta, clienteId: cid, estadoLog: [{ estado: venta.estado, ts: new Date().toISOString() }] };
    setVentas(prev => [saved, ...prev]);
    showToast(`✓ Venta #${venta.n} registrada`);
    return saved;
  };
  const handleUpdate = (n, patch) => {
    setVentas(prev => prev.map(v => {
      if (v.n !== n) return v;
      const log = patch.estado && patch.estado !== v.estado ? { estadoLog: [...(v.estadoLog || []), { estado: patch.estado, ts: new Date().toISOString() }] } : {};
      return { ...v, ...patch, ...log };
    }));
  };
  const handleAbono = (n, ab) => {
    setVentas(prev => prev.map(v => v.n === n ? { ...v, abonos: [...(v.abonos || []), ab] } : v));
    showToast(`✓ Cobro de ${L(ab.monto)} registrado en #${n}`);
  };
  const handleDelete = (n) => {
    const v = ventas.find(x => x.n === n);
    if (!v) return;
    setVentas(prev => prev.filter(x => x.n !== n));
    showActionToast(`Venta #${n} eliminada`, 'Deshacer', () => setVentas(prev => prev.some(x => x.n === n) ? prev : [...prev, v].sort((a, b) => b.n - a.n)));
  };
  const addCategoria = (cat) => { if (cat && !config.categorias.some(c => norm(c) === norm(cat))) setConfig(c => ({ ...c, categorias: [...c.categorias, cat] })); };
  const handleCreateServicio = (d) => {
    const s = { id: uid('SRV'), nombre: d.nombre.trim(), categoria: (d.categoria || '').trim() || 'Otro', unidad: d.unidad || 'proyecto', precio: num(d.precio), costo: num(d.costo), descripcion: (d.descripcion || '').trim(), activo: true, creado: today() };
    setServicios(prev => [...prev, s]);
    addCategoria(s.categoria);
    showToast(`✓ Tipo «${s.nombre}» guardado`);
    return s;
  };
  const handleUpdateServicio = (id, patch) => {
    setServicios(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    if (patch.precio != null) showToast(`✓ Precio base actualizado a ${L(patch.precio)}`);
  };
  const handleSaveServicio = (s) => {
    if (s.id) { setServicios(prev => prev.map(x => x.id === s.id ? s : x)); addCategoria(s.categoria); showToast('✓ Tipo guardado'); }
    else handleCreateServicio(s);
  };
  const handleSaveCliente = (c) => {
    if (c.id) { setClientes(prev => prev.map(x => x.id === c.id ? c : x)); showToast('✓ Cliente guardado'); }
    else { setClientes(prev => [{ ...c, id: uid('CL'), creado: today() }, ...prev]); showToast('✓ Cliente creado'); }
  };
  const goNueva = (pf) => { setPrefill(pf || null); setVentaKey(k => k + 1); setRoute('nueva'); };
  const clientePrefill = (c) => ({ id: c.id, nombre: c.nombre || '', empresa: c.empresa || '', telefono: c.telefono || '', email: c.email || '', canal: c.canal || config.canales[0] });
  const handleDuplicate = (v) => {
    const c = clientes.find(x => x.id === v.clienteId) || { id: v.clienteId, nombre: v.cliente, empresa: v.empresa, telefono: v.telefono, email: v.email, canal: v.canal };
    // Usa el precio actual del tipo si existe (por si subió); si no, el de la venta original
    const items = v.items.map(i => { const s = servicios.find(x => x.id === i.tipoId); return { ...i, precio: String(i.precio), costo: String(s ? s.costo : i.costo) }; });
    goNueva({ cliente: clientePrefill(c), items, pay: v.pay });
  };
  const openVenta = (n) => { setFocusN(n); setRoute('ventas'); };
  const handleImport = (d) => {
    setVentas(d.ventas || []); setClientes(d.clientes || []); setServicios(d.servicios || []);
    setConfig({ ...CONFIG_DEFAULT, ...(d.config || {}) }); setGastos({ ...GASTOS_DEFAULT, ...(d.gastos || {}) });
    showToast('✓ Respaldo restaurado');
  };

  const modules = [
    { id: 'nueva',     label: 'Nueva Venta',   icon: 'plus' },
    { id: 'ventas',    label: 'Ventas',        icon: 'list' },
    { id: 'servicios', label: 'Servicios',     icon: 'tag' },
    { id: 'clientes',  label: 'Clientes',      icon: 'user' },
    { id: 'metricas',  label: 'Métricas',      icon: 'chart' },
    { id: 'gastos',    label: 'Gastos',        icon: 'money' },
    { id: 'config',    label: 'Configuración', icon: 'settings' },
  ];
  const current = modules.find(m => m.id === route) || modules[0];

  if (!ready) return (
    <div className="boot">
      <div style={{ color: 'var(--accent)' }}><LoopaMark height={110} /></div>
      {loadError ? (
        <>
          <div className="boot-err"><span style={{ color: 'var(--danger)', fontSize: 18 }}>✕</span><div><div className="mono" style={{ fontSize: 11, color: 'var(--danger)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>No se pudieron cargar los datos</div><div className="mono muted" style={{ fontSize: 12 }}>{loadError}</div></div></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" onClick={load}>↺ Reintentar</button>
            <button className="btn" onClick={() => window.location.reload()}>Recargar</button>
          </div>
        </>
      ) : (
        <>
          <div className="mono muted" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{window.USE_FB ? 'Conectando con Firebase…' : 'Cargando…'}</div>
          <div style={{ width: 180, height: 2, background: '#1A1A1A', overflow: 'hidden' }}><div className="loadbar" /></div>
        </>
      )}
    </div>
  );

  const gq = norm(gSearch);
  const gVentas = gq.length >= 2 ? ventas.filter(v => norm(`${v.n} ${v.cliente} ${v.empresa} ${v.items.map(i => i.nombre).join(' ')}`).includes(gq)).slice(0, 5) : [];
  const gClientes = gq.length >= 2 ? clientes.filter(c => norm(`${c.nombre} ${c.empresa} ${c.telefono}`).includes(gq)).slice(0, 4) : [];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand" onClick={() => goNueva(null)} title="Nueva venta" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
          <LoopaMark height={109} />
        </div>

        <div className="gsearch-wrap">
          <div className={`gsearch ${gOpen ? 'on' : ''}`}>
            <Icon name="search" size={12} />
            <input placeholder="Buscar venta, cliente…" value={gSearch}
              onFocus={() => setGOpen(true)} onBlur={() => setTimeout(() => setGOpen(false), 180)}
              onChange={e => { setGSearch(e.target.value); setGOpen(true); }} />
            {gSearch && <button onClick={() => setGSearch('')} className="dim">×</button>}
          </div>
          {gOpen && gq.length >= 2 && (
            <div className="dropdown" style={{ left: 12, right: 12 }}>
              {gVentas.length + gClientes.length === 0 && <div className="mono muted" style={{ padding: '12px', fontSize: 11 }}>Sin resultados</div>}
              {gVentas.length > 0 && <div className="dropdown-lbl">Ventas</div>}
              {gVentas.map(v => (
                <div key={v.n} className="dropdown-row" onMouseDown={() => { openVenta(v.n); setGSearch(''); }}>
                  <div><div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>#{v.n} <span className="muted" style={{ fontWeight: 400 }}>· {v.cliente}</span></div><div className="mono dim" style={{ fontSize: 10 }}>{fmtFecha(v.fecha)} · {L(v.total)}</div></div>
                </div>
              ))}
              {gClientes.length > 0 && <div className="dropdown-lbl">Clientes</div>}
              {gClientes.map(c => (
                <div key={c.id} className="dropdown-row" onMouseDown={() => { setRoute('clientes'); setGSearch(''); }}>
                  <div><div style={{ fontSize: 12, fontWeight: 500 }}>{c.nombre}</div><div className="mono dim" style={{ fontSize: 10 }}>{c.empresa || c.telefono}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <nav className="nav" style={{ marginTop: 8 }}>
          {modules.map(m => (
            <button key={m.id} className={`nav-item ${route === m.id ? 'active' : ''}`} onClick={() => m.id === 'nueva' && route === 'nueva' ? goNueva(null) : setRoute(m.id)} title={m.label}>
              <Icon name={m.icon} size={15} />
              <span>{m.label}</span>
              <span className="nav-mobile-label">{m.label.split(' ')[0]}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="main">
        <div className="ticker">
          <span className="item">● LOOPA OS</span>
          <span className="item">Próx. venta <span className="v">#{nextN}</span></span>
          <span className="item">{ticker.mesLbl} · Venta <span className="v">{L(ticker.venta)}</span></span>
          <span className="item">Cobrado <span className="v" style={{ color: ticker.cobrado > 0 ? 'var(--ok)' : 'var(--muted)' }}>{L(ticker.cobrado)}</span></span>
          <span className="item">Ganancia <span className="v" style={{ color: ticker.ganancia >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{L(ticker.ganancia)}</span></span>
          <span className="item">Por cobrar <span className="v" style={{ color: ticker.porCobrar > 0 ? 'var(--warn)' : 'var(--muted)' }}>{L(ticker.porCobrar)}</span></span>
          <span className="item">En curso <span className="v">{ticker.enCurso}</span></span>
          <span className="item">Tipos <span className="v">{servicios.filter(s => s.activo !== false).length}</span></span>
        </div>

        <div className="topbar">
          <div className="breadcrumb"><span className="cur">{current.label}</span></div>
          <div className="topbar-mobile-title">{current.label.toUpperCase()}</div>
          <div className="topbar-right">
            {saveError && <span className="chip" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} title="Los últimos cambios no se guardaron. Revisá la conexión.">● Error al guardar</span>}
            <span className="chip mob-hide">{new Date().toLocaleDateString('es-HN', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</span>
            <AlertBell ventas={ventas} onOpen={openVenta} />
            {onLogout && <button className="btn sm ghost" onClick={onLogout} title="Cerrar sesión" style={{ color: 'var(--muted)' }}>⏻</button>}
          </div>
        </div>

        <div className="content">
          {route === 'nueva' && (
            <NuevaVenta key={ventaKey} nextN={nextN} clientes={clientes} servicios={servicios} ventas={ventas} stats={stats} config={config}
              onCreate={handleCreate} onCreateServicio={handleCreateServicio} onUpdateServicio={handleUpdateServicio}
              prefill={prefill} onPrefillConsumed={() => setPrefill(null)} onReset={() => goNueva(null)} onOpenVenta={openVenta} />
          )}
          {route === 'ventas' && (
            <Ventas ventas={ventas} config={config} onUpdate={handleUpdate} onDelete={handleDelete} onAbono={handleAbono}
              onDuplicate={handleDuplicate} focusN={focusN} onFocusConsumed={() => setFocusN(null)} />
          )}
          {route === 'servicios' && (
            <Servicios servicios={servicios} stats={stats} config={config} onSave={handleSaveServicio}
              onDelete={(id) => setServicios(prev => prev.filter(s => s.id !== id))}
              onVender={(s) => goNueva({ items: [{ tipoId: s.id, nombre: s.nombre, categoria: s.categoria, unidad: s.unidad, descripcion: s.descripcion || '', precio: String(s.precio), costo: String(s.costo), q: 1 }] })} />
          )}
          {route === 'clientes' && (
            <Clientes clientes={clientes} ventas={ventas} config={config} onSave={handleSaveCliente}
              onDelete={(id) => setClientes(prev => prev.filter(c => c.id !== id))}
              onNuevaVenta={(c) => goNueva({ cliente: clientePrefill(c) })} onOpenVenta={openVenta} />
          )}
          {route === 'metricas' && <Metricas ventas={ventas} gastos={gastos} config={config} />}
          {route === 'gastos' && <Gastos gastos={gastos} setGastos={setGastos} />}
          {route === 'config' && (
            <Configuracion config={config} setConfig={setConfig} showToast={showToast} onImport={handleImport}
              allData={{ ventas, clientes, servicios, config, gastos }} />
          )}
        </div>
      </div>

      <DialogHost />

      {toast && (
        <div className={`toast t-${toast.tone}`}>
          <span style={{ flex: 1 }}>{toast.msg}</span>
          {toast.action && <button className="toast-act" onClick={() => { toast.action.fn(); setToast(null); }}>↺ {toast.action.label}</button>}
        </div>
      )}

    </div>
  );
}

function Root() {
  const [authUser, setAuthUser] = useState(null);
  const [checked, setChecked] = useState(!window.USE_FB);
  useEffect(() => {
    if (!window.USE_FB) return;
    return firebase.auth().onAuthStateChanged(u => { setAuthUser(u); setChecked(true); });
  }, []);
  if (!window.USE_FB) return <App onLogout={null} />;
  if (!checked) return <div className="boot"><div className="mono dim" style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase' }}>Verificando sesión…</div></div>;
  if (!authUser) return <LoginScreen />;
  return <App onLogout={() => firebase.auth().signOut()} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
