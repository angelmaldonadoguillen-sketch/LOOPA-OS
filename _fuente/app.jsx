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
const MODELOS_SERVICIO = [
  { id: 'plan',     label: 'Plan mensual' },
  { id: 'unitario', label: 'Servicio unitario' },
  { id: 'proyecto', label: 'Proyecto' },
  { id: 'especial', label: 'Acuerdo especial' },
];
const modeloServicio = (s = {}) => s.modelo || (s.unidad === 'mes' ? 'plan' : s.unidad === 'pieza' ? 'unitario' : 'proyecto');
const modeloLabel = (s) => MODELOS_SERVICIO.find(m => m.id === modeloServicio(s))?.label || 'Proyecto';
const servicioDisponiblePara = (s, cliente) => modeloServicio(s) !== 'especial' || (!!cliente?.id && s.clienteIdEspecial === cliente.id);
const snapshotServicio = (s) => ({
  tipoId: s.id, nombre: s.nombre, categoria: s.categoria, unidad: s.unidad,
  descripcion: s.descripcion || '', modelo: modeloServicio(s), recomendado: s.recomendado === true,
  clienteIdEspecial: s.clienteIdEspecial || '', precio: String(num(s.precio)), costo: String(num(s.costo)), q: 1,
});
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
const CONFIG_DEFAULT = { payConfig: PAY_CONFIG_DEFAULT, categorias: CATEGORIAS_DEFAULT, canales: CANALES_DEFAULT, moneda: 'L', gastoTipos: GASTO_CATS };
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
// Cómo se identifica una venta en las pantallas: por su id (modelo de la
// fusión, donde dos ventas migradas pueden compartir el número visible) o,
// sin id, por su número (LOOPA de siempre).
const claveVenta = (v) => (v && v.id) || (v && v.n);
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
  if (period === 'trim') { const qs = Math.floor(m / 3) * 3; return { start: ymd(new Date(y, qs, 1)), end: ymd(new Date(y, qs + 2, last(y, qs + 2))), months: m - qs + 1, label: `T${qs / 3 + 1} ${y}` }; }
  if (period === 'año') return { start: `${y}-01-01`, end: `${y}-12-31`, months: m + 1, label: String(y) };
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

// ─── Datos de la fusión (Fase 3, tanda 3.3) ───
// ?datos=fusion → ventas, clientes y servicios vienen del modelo nuevo y se
// guardan SÓLO a través del servidor, con una cola persistente (se reintenta
// sola si se corta la red; ver _fuente/datos/fuente.js). Por ahora sólo con
// el servidor local de integracion/servidor-local (este equipo, 127.0.0.1):
// la conexión al proyecto real llega con la puesta en marcha (ADR-0004).
// Sin la bandera, LOOPA funciona exactamente como siempre.
const DATOS_FUSION = (() => {
  try {
    if (new URLSearchParams(window.location.search).get('datos') !== 'fusion') return null;
    if (['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)) return 'local';
    console.warn('?datos=fusion sólo funciona con el servidor local (127.0.0.1)');
    return null;
  } catch (e) { return null; }
})();
const FUSION_API = DATOS_FUSION ? LoopaFuente.adaptadorHttp((...a) => window.fetch(...a), '') : null;
const nuevoIdFusion = () => (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
const confirmarCancelar = (v) => ({
  title: `Cancelar venta #${v.n}`,
  message: `Cliente: ${v.cliente}\nTotal: ${L(v.total)}\n\nCon la ficha única las ventas no se borran: queda cancelada (se puede reactivar cambiando el estado) y su trabajo de producción se archiva.`,
  confirmLabel: 'Cancelar venta',
});
const numProx = (n) => (n ? `#${n}` : 'al guardar');
// Con la fusión cada cambio es una escritura: una fecha a medio escribir
// (año 0002) no se manda.
const fechaValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= '2000-01-01' && s <= '2100-12-31';
// El avance REAL de producción lo lleva el tablero; acá sólo se resume.
const produccionTexto = (p) => {
  const t = p.tareas === 1 ? '1 tarea' : `${p.tareas} tareas`;
  if (p.status === 'attention') return `Producción: necesita atención (p. ej. falta la fecha de entrega) · ${t}`;
  if (p.status === 'cancelled_review') return `Producción: venta cancelada · ${t} para revisar`;
  if (p.status === 'ready') return p.tareas ? `Producción: ${t} en el tablero` : 'Producción: sin tareas (sus servicios no tienen plantilla de producción)';
  if (p.status === 'resync_required') return `Producción: cambios de la venta por revisar en el tablero · ${t}`;
  return `Producción: en preparación · ${t}`;
};

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
    if (DATOS_FUSION) {
      try { localStorage.setItem('loopa-fusion-' + k, JSON.stringify(data)); return Promise.resolve(); }
      catch (e) { return Promise.reject(e); }
    }
    if (window.USE_FB) return window.db.collection('loopa').doc(k).set(data);
    try { localStorage.setItem('loopa-' + k, JSON.stringify(data)); return Promise.resolve(); }
    catch (e) { return Promise.reject(e); }
  },
};

// ─── Datos del modo local (localStorage) pendientes de subir a la nube ───
function readLocalData() {
  try {
    const get = (k) => JSON.parse(localStorage.getItem('loopa-' + k) || 'null');
    const d = { ventas: get('ventas')?.items || [], clientes: get('clientes')?.items || [], servicios: get('servicios')?.items || [], config: get('config'), gastos: get('gastos') };
    return d.ventas.length || d.clientes.length || d.servicios.length ? d : null;
  } catch (e) { return null; }
}
function archiveLocalData() {
  // No se borran: quedan como loopa-local-* por si hiciera falta recuperarlos
  DOC_KEYS.forEach(k => {
    try {
      const v = localStorage.getItem('loopa-' + k);
      if (v != null) { localStorage.setItem('loopa-local-' + k, v); localStorage.removeItem('loopa-' + k); }
    } catch (e) {}
  });
}
// Suma los datos locales a los de la nube sin duplicar:
// tipos por nombre, clientes por id/teléfono (últimos 8 dígitos)/email/nombre+empresa, ventas por fecha de creación.
function mergeLocalInto(cloud, local) {
  const servicios = [...(cloud.servicios?.items || [])];
  const clientes = [...(cloud.clientes?.items || [])];
  const ventas = [...(cloud.ventas?.items || [])];
  const added = { ventas: 0, servicios: 0, clientes: 0 };

  const tipoMap = {};
  local.servicios.forEach(s => {
    const same = servicios.find(x => x.id === s.id || norm(x.nombre) === norm(s.nombre));
    if (same) tipoMap[s.id] = same.id;
    else { servicios.push(s); tipoMap[s.id] = s.id; added.servicios++; }
  });

  const cliMap = {};
  local.clientes.forEach(c => {
    const same = clientes.find(x => x.id === c.id ||
      (digits(c.telefono).length >= 8 && digits(x.telefono).slice(-8) === digits(c.telefono).slice(-8)) ||
      (c.email && norm(x.email) === norm(c.email)) ||
      (norm(x.nombre) === norm(c.nombre) && norm(x.empresa) === norm(c.empresa)));
    if (same) cliMap[c.id] = same.id;
    else { clientes.push(c); cliMap[c.id] = c.id; added.clientes++; }
  });

  let maxN = Math.max(1000, ...ventas.map(v => v.n));
  [...local.ventas].sort((a, b) => a.n - b.n).forEach(v => {
    // ya estaba subida: el momento de creación es único aunque la venta se haya renumerado
    if (ventas.some(x => v.creado ? x.creado === v.creado : (x.n === v.n && x.fecha === v.fecha && x.total === v.total))) return;
    const n = ventas.some(x => x.n === v.n) ? ++maxN : v.n;
    maxN = Math.max(maxN, n);
    ventas.push({ ...v, n, clienteId: cliMap[v.clienteId] || v.clienteId, items: (v.items || []).map(i => ({ ...i, tipoId: tipoMap[i.tipoId] || i.tipoId })) });
    added.ventas++;
  });
  ventas.sort((a, b) => b.n - a.n);

  const cloudEmpty = !((cloud.ventas?.items || []).length || (cloud.servicios?.items || []).length || (cloud.clientes?.items || []).length);
  const config = { ...CONFIG_DEFAULT, ...(cloud.config || {}), ...(cloudEmpty && local.config ? local.config : {}) };
  const cg = { ...GASTOS_DEFAULT, ...(cloud.gastos || {}) }, lg = local.gastos || {};
  const byId = (a, b) => [...a, ...b.filter(x => !a.some(y => y.id === x.id))];
  const gastos = { variables: byId(cg.variables || [], lg.variables || []), fijos: byId(cg.fijos || [], lg.fijos || []) };
  return { ventas, clientes, servicios, config, gastos, added };
}

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
    case 'calendar': return <svg {...c}><rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>;
    default: return null;
  }
}

// Logo oficial. Compacto (logo-loopa.svg) en el menú; "largo" (logo-loopa-largo.svg,
// loop extendido) en acceso y carga. Toma el color del texto que lo rodea.
function LoopaMark({ height = 30, largo = false }) {
  const L0 = (largo ? window.LOOPA_SVG_LARGO : window.LOOPA_SVG) || { viewBox: largo ? '0 0 487.99 31.12' : '0 0 201.77 31.12', inner: '' };
  return (
    <svg viewBox={L0.viewBox} height={height} style={{ display: 'block', fill: 'currentColor', maxWidth: '100%' }} aria-label="LOOPA"
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
    : [...prev, { key: uid('LN'), ...snapshotServicio(s) }]);
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

  const enviando = useRef(false);
  const confirm = () => {
    if (enviando.current) return;
    enviando.current = true;
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
    if (saved === false) { enviando.current = false; return; } // no se pudo encolar: el aviso ya salió
    setCreated(saved || venta);
  };

  // Con la fusión el número lo da el servidor: se muestra la venta guardada
  // (por id) en cuanto llega; mientras tanto, «guardando».
  const creadaVista = created && created.id ? (ventas.find(v => v.id === created.id) || created) : created;
  if (created) return <VentaCreada venta={creadaVista} payConfig={payConfig} onReset={onReset} onOpen={() => onOpenVenta(claveVenta(created))} />;

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
          <span className="chip">CORRELATIVO <span className="v mono">{numProx(nextN)}</span></span>
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
        <PasoServicios cliente={cliente} servicios={servicios} stats={stats} categorias={categorias} items={items}
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
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 'var(--fs-s)', letterSpacing: '0.1em', color: 'var(--accent)' }}>
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
                    <div style={{ fontWeight: 500 }}>{c.nombre}{c.empresa && <span className="muted" style={{ fontWeight: 400 }}> · {c.empresa}</span>}</div>
                    <div className="mono dim" style={{ fontSize: 'var(--fs-s)', marginTop: 2 }}>{[c.telefono, c.email].filter(Boolean).join(' · ') || 'Sin contacto'}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 'var(--fs-s)', color: 'var(--accent)' }}>{compras(c.id)} compras</span>
                </div>
              ))}
            </div>
          )}
          {!cliente.id && !q && recientes.length > 0 && (
            <div className="chips" style={{ marginTop: 10 }}>
              <span className="mono dim" style={{ fontSize: 'var(--fs-s)', letterSpacing: '0.1em', alignSelf: 'center', marginRight: 4 }}>RECIENTES</span>
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

function PasoServicios({ cliente, servicios, stats, categorias, items, addItem, updItem, delItem, totals, onCreateServicio, onUpdateServicio }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [draft, setDraft] = useState(null);
  const searchRef = useRef(null);

  const activos = servicios.filter(s => s.activo !== false && servicioDisponiblePara(s, cliente));
  const nq = norm(q);
  const list = activos
    .filter(s => (cat === 'all' || s.categoria === cat) && (!nq || norm(`${s.nombre} ${s.categoria} ${s.descripcion}`).includes(nq)))
    .sort((a, b) => (stats[b.id]?.q || 0) - (stats[a.id]?.q || 0) || a.nombre.localeCompare(b.nombre));
  const exact = nq ? servicios.find(s => norm(s.nombre) === nq && servicioDisponiblePara(s, cliente)) : null;
  const catsConServicios = categorias.filter(c => activos.some(s => s.categoria === c));
  const enCarrito = (id) => items.filter(i => i.tipoId === id).reduce((a, i) => a + num(i.q), 0);

  const startCreate = () => setDraft({
    nombre: q.trim(), categoria: cat !== 'all' ? cat : (categorias[0] || 'Otro'),
    unidad: 'proyecto', precio: '', costo: '', descripcion: '', modelo: 'proyecto', recomendado: false, clienteIdEspecial: '',
  });
  const saveDraft = () => {
    if (!draft.nombre.trim()) return;
    const s = onCreateServicio(draft);
    if (!s) return; // no se pudo guardar (el aviso ya salió)
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
          <span className="mono dim" style={{ marginLeft: 'auto', fontSize: 'var(--fs-s)', letterSpacing: '0.1em' }}>{activos.length} GUARDADOS</span>
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
                    <div className="service-badges">
                      <span className={`service-model ${modeloServicio(s)}`}>{modeloLabel(s)}</span>
                      {s.recomendado === true && <span className="service-recommended">Recomendado</span>}
                    </div>
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
            <div className="mono dim" style={{ fontSize: 'var(--fs-s)', textAlign: 'center', padding: '28px 8px', lineHeight: 1.8 }}>
              Tocá un tipo de servicio para agregarlo.<br />Precio, cantidad y detalle se ajustan acá.
            </div>
          ) : items.map((i, idx) => {
            const base = servicios.find(s => s.id === i.tipoId);
            const precioCambio = base && num(i.precio) !== num(base.precio);
            return (
              <div className="ln" key={i.key}>
                <div className="ln-top">
                  <span className="mono dim" style={{ fontSize: 'var(--fs-s)', paddingTop: 2 }}>{pad2(idx + 1)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="srv-name">{i.nombre}</div>
                    <div className="mono dim" style={{ fontSize: 'var(--fs-s)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>{i.categoria} · {modeloLabel(i)} · por {i.unidad}</div>
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
                  <span className="mono" style={{ marginLeft: 'auto', fontWeight: 500 }}>{L(num(i.precio) * num(i.q))}</span>
                </div>
              </div>
            );
          })}
          {items.length > 0 && (
            <div className="summary-row big" style={{ fontSize: 'var(--fs-l)' }}>
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
      <div className="mono" style={{ fontSize: 'var(--fs-s)', letterSpacing: '0.14em', color: 'var(--accent)', marginBottom: 14 }}>
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
                {DATOS_FUSION && !entrega && <div className="dim" style={{ fontSize: 'var(--fs-s)', marginTop: 6 }}>Sin fecha de entrega, el trabajo que se programa desde esa fecha queda esperando en Producción.</div>}
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
          <div className="panel-title">RESUMEN · <span className="dim">VENTA {numProx(nextN)}</span></div>
        </div>
        <div className="panel-body">
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'var(--fs-m)' }}>{cliente.nombre}</div>
            {cliente.empresa && <div className="muted" style={{ fontSize: 'var(--fs-s)' }}>{cliente.empresa}</div>}
          </div>
          {items.map(i => (
            <div key={i.key} className="summary-row" style={{ gap: 12 }}>
              <span style={{ color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 'var(--fs-m)' }}>{i.nombre}{num(i.q) > 1 && <span className="dim"> ×{i.q}</span>}</span>
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
            <Icon name="check" size={13} /> Registrar venta{nextN ? ` #${nextN}` : ''}
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
          <div className="ord-label">{v.n ? '✓ Venta registrada' : 'Guardando venta…'}</div>
          <div className="ord-num">{v.n ? `#${v.n}` : '—'}</div>
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
              <span style={{ color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 'var(--fs-m)' }}>
                {i.nombre}{i.q > 1 && <span className="dim"> ×{i.q}</span>}
                {i.descripcion && <span className="dim" style={{ display: 'block', fontSize: 'var(--fs-s)' }}>{i.descripcion}</span>}
              </span>
              <span className="r">{L(i.precio * i.q)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={onReset}><Icon name="plus" size={12} /> Nueva venta</button>
        <button className="btn" onClick={onOpen} disabled={!v.n}><Icon name="list" size={12} /> Ver en ventas</button>
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
  const SortIcon = ({ col }) => sort.col !== col ? null : <span style={{ marginLeft: 4, fontSize: 'var(--fs-s)', color: 'var(--accent)' }}>{sort.dir === 'asc' ? '▲' : '▼'}</span>;
  const openMenu = (e, kind, v) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ kind, k: claveVenta(v), x: r.left, y: r.bottom + 4, current: kind === 'estado' ? v.estado : pagoEstado(v) });
  };
  const menuVenta = menu && ventas.find(v => claveVenta(v) === menu.k);
  const pickPago = (id) => {
    const v = menuVenta; setMenu(null);
    if (!v) return;
    if (id === 'cobrar') onAbono(claveVenta(v), { id: uid('AB'), fecha: today(), monto: ventaSaldo(v), metodo: v.pay });
    if (id === 'abono') setOpenN(claveVenta(v));
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
                    <tr key={claveVenta(v)} onClick={() => setOpenN(claveVenta(v))} style={{ opacity: cancel ? 0.5 : 1 }}>
                      <td className="order-n">#{v.n}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{v.cliente}</div>
                        {v.empresa && <div className="mono" style={{ fontSize: 'var(--fs-s)', color: 'var(--muted)', letterSpacing: '0.06em' }}>{v.empresa.toUpperCase()}</div>}
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
                      <td className="num" style={{ color: cancel ? 'var(--dim)' : 'var(--ok)', fontWeight: 500 }}>{cancel ? '—' : L(ventaGanancia(v, payConfig))}</td>
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
                      <td className="mono" style={{ fontSize: 'var(--fs-s)', color: entregaVencida(v) ? 'var(--danger)' : 'var(--muted)' }}>
                        {v.entrega ? fmtFecha(v.entrega) : '—'}{entregaVencida(v) && ' ⚠'}
                      </td>
                      <td className="mono" style={{ fontSize: 'var(--fs-s)', color: 'var(--muted)' }}>{fmtFecha(v.fecha)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="icon-btn danger" title="Eliminar venta"
                          onClick={() => uiConfirm(DATOS_FUSION ? confirmarCancelar(v) : { title: `Eliminar venta #${v.n}`, message: `Cliente: ${v.cliente}\nTotal: ${L(v.total)}\n\nSi solo se canceló, mejor cambiá el estado a «Cancelado» para conservar el registro.`, confirmLabel: 'Eliminar' }).then(ok => { if (ok) onDelete(claveVenta(v)); })}>
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
            <div className="mono" style={{ fontSize: 'var(--fs-s)', color: 'var(--muted)', letterSpacing: '0.08em' }}>{filtered.length} FILAS</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-s)' }}>
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
        onPick={(s) => { onUpdate(menu.k, { estado: s }); setMenu(null); }}
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
        const v = ventas.find(x => claveVenta(x) === openN);
        if (!v) return null;
        return (
          <VentaModal venta={v} config={config} onClose={() => setOpenN(null)}
            onUpdate={(patch) => onUpdate(claveVenta(v), patch)}
            onAbono={(ab) => onAbono(claveVenta(v), ab)}
            onDuplicate={() => { setOpenN(null); onDuplicate(v); }}
            onDelete={() => uiConfirm(DATOS_FUSION ? confirmarCancelar(v) : { title: `Eliminar venta #${v.n}`, message: `Cliente: ${v.cliente}\nTotal: ${L(v.total)}`, confirmLabel: 'Eliminar' }).then(ok => { if (ok) { setOpenN(null); onDelete(claveVenta(v)); } })} />
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
          <div className="mono dim" style={{ fontSize: 'var(--fs-s)', marginTop: 2 }}>{[v.telefono, v.email, v.canal].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="kv">
          <div className="k">Estado del trabajo</div>
          <div className="chips" style={{ marginTop: 4 }}>
            {ESTADOS.map(s => <button key={s} className={`chipbtn ${v.estado === s ? 'on' : ''}`} onClick={() => onUpdate({ estado: s })}>{ESTADO_LABELS[s]}</button>)}
          </div>
          {v.produccion && <div className="mono dim" style={{ fontSize: 'var(--fs-s)', marginTop: 6 }}>{produccionTexto(v.produccion)}</div>}
        </div>
        <div className="field">
          <label>Fecha de venta</label>
          <input className="input mini mono" type="date" value={v.fecha} onChange={e => e.target.value && (!DATOS_FUSION || fechaValida(e.target.value)) && onUpdate({ fecha: e.target.value })} style={{ colorScheme: 'dark' }} />
        </div>
        <div className="field">
          <label>Entrega {entregaVencida(v) && <span style={{ color: 'var(--danger)' }}>· vencida</span>}</label>
          <input className="input mini mono" type="date" value={v.entrega || ''} onChange={e => (!DATOS_FUSION || !e.target.value || fechaValida(e.target.value)) && onUpdate({ entrega: e.target.value })} style={{ colorScheme: 'dark' }} />
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
              <span style={{ color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 'var(--fs-m)' }}>
                <b style={{ fontWeight: 500 }}>{i.nombre}</b>{i.q > 1 && <span className="dim"> · {i.q} × {L(i.precio)}</span>}
                <span className="mono dim" style={{ fontSize: 'var(--fs-s)', letterSpacing: '0.1em', marginLeft: 8, textTransform: 'uppercase' }}>{i.categoria}</span>
                {i.descripcion && <span className="muted" style={{ display: 'block', fontSize: 'var(--fs-s)', marginTop: 2 }}>{i.descripcion}</span>}
              </span>
              <span className="r" style={{ textAlign: 'right' }}>{L(i.precio * i.q)}{i.costo > 0 && <span className="dim" style={{ display: 'block', fontSize: 'var(--fs-s)' }}>costo {L(i.costo * i.q)}</span>}</span>
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
      {v.descuento > 0 && <div className="mono dim" style={{ fontSize: 'var(--fs-s)', marginTop: 6 }}>Incluye descuento de {L(v.descuento)} sobre {L(v.subtotal)}</div>}

      <div className="sec-head" style={{ marginTop: 22 }}>
        <span>Cobros · <PagoBadge v={v} /></span>
        <select className="select mini" style={{ width: 'auto' }} value={v.pay} onChange={e => onUpdate({ pay: e.target.value })} title="Método de pago principal (define la comisión)">
          {payConfig.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      {(v.abonos || []).length === 0 && <div className="mono dim" style={{ fontSize: 'var(--fs-s)', padding: '6px 0 10px' }}>Sin cobros registrados.</div>}
      {(v.abonos || []).map(a => (
        <div key={a.id} className="abono-row">
          <span className="mono">{fmtFechaLarga(a.fecha)}</span>
          <span className="muted">{payConfig.find(p => p.id === a.metodo)?.label || a.metodo}</span>
          <span className="mono" style={{ marginLeft: 'auto', color: 'var(--ok)', fontWeight: 500 }}>{L(a.monto)}</span>
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
              <span key={i} className="mono" style={{ fontSize: 'var(--fs-s)', color: 'var(--muted)' }}>
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
function Servicios({ servicios, clientes, stats, config, onSave, onDelete, onVender }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [modelo, setModelo] = useState('all');
  const [verArchivados, setVerArchivados] = useState(false);
  const [editing, setEditing] = useState(null); // servicio o {} nuevo
  const [sort, setSort] = useState({ col: 'q', dir: 'desc' });

  const list = servicios.filter(s =>
    (verArchivados || s.activo !== false) &&
    (cat === 'all' || s.categoria === cat) &&
    (modelo === 'all' || modeloServicio(s) === modelo) &&
    (!q || norm(`${s.nombre} ${s.categoria} ${s.descripcion} ${modeloLabel(s)} ${clientes.find(c => c.id === s.clienteIdEspecial)?.nombre || ''}`).includes(norm(q))));
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
  const SortIcon = ({ col }) => sort.col !== col ? null : <span style={{ marginLeft: 4, fontSize: 'var(--fs-s)', color: 'var(--accent)' }}>{sort.dir === 'asc' ? '▲' : '▼'}</span>;

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
        <div className="filter-group">
          <span className="flabel">Modelo</span>
          <select value={modelo} onChange={e => setModelo(e.target.value)}>
            <option value="all">Todos</option>
            {MODELOS_SERVICIO.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
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
                    { col: 'nombre', label: 'Servicio' }, { col: null, label: 'Modelo' }, { col: 'categoria', label: 'Categoría' }, { col: null, label: 'Unidad' },
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
                        <div style={{ fontWeight: 500 }}>{s.nombre}{s.activo === false && <span className="mono dim" style={{ fontSize: 'var(--fs-s)', marginLeft: 8, letterSpacing: '0.1em' }}>ARCHIVADO</span>}</div>
                        {s.descripcion && <div className="muted" style={{ fontSize: 'var(--fs-s)', maxWidth: 340, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.descripcion}</div>}
                      </td>
                      <td className="service-model-cell">
                        <div className="service-badges">
                          <span className={`service-model ${modeloServicio(s)}`}>{modeloLabel(s)}</span>
                          {s.recomendado === true && <span className="service-recommended">Recomendado</span>}
                          {modeloServicio(s) === 'especial' && <span className="service-special-client">{clientes.find(c => c.id === s.clienteIdEspecial)?.nombre || 'Cliente sin asignar'}</span>}
                        </div>
                      </td>
                      <td><span className="srv-chip">{s.categoria}</span></td>
                      <td className="mono muted" style={{ fontSize: 'var(--fs-s)' }}>{s.unidad}</td>
                      <td className="num">{L(s.precio)}</td>
                      <td className="num dim">{num(s.costo) > 0 ? L(s.costo) : '—'}</td>
                      <td className="num" style={{ color: margen == null ? 'var(--dim)' : margen >= 50 ? 'var(--ok)' : margen >= 25 ? 'var(--warn)' : 'var(--danger)' }}>{margen == null ? '—' : `${margen.toFixed(0)}%`}</td>
                      <td className="num">{st.q || 0}</td>
                      <td className="num" style={{ fontWeight: 500 }}>{st.ingresos ? L(st.ingresos) : '—'}</td>
                      <td className="mono muted" style={{ fontSize: 'var(--fs-s)' }}>{st.ultima ? fmtFecha(st.ultima) : '—'}</td>
                      <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                        {s.activo !== false && <button className="btn sm ghost" onClick={() => onVender(s)} title="Nueva venta con este servicio"><Icon name="plus" size={11} /> Vender</button>}
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && <tr><td colSpan="11" className="mono" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)', cursor: 'default' }}>Ningún tipo coincide</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <ServicioForm servicio={editing} servicios={servicios} clientes={clientes} categorias={config.categorias} stats={stats}
          onClose={() => setEditing(null)}
          onSave={(s) => { onSave(s); setEditing(null); }}
          onRemove={editing.id ? () => remove(editing) : null} />
      )}
    </div>
  );
}

function ServicioForm({ servicio, servicios, clientes, categorias, stats, onClose, onSave, onRemove }) {
  const isNew = !servicio.id;
  const [paso, setPaso] = useState(1);
  const [d, setD] = useState(() => ({
    nombre: servicio.nombre || '', categoria: servicio.categoria || categorias[0] || 'Otro', unidad: servicio.unidad || 'proyecto',
    precio: servicio.precio != null ? String(servicio.precio) : '', costo: servicio.costo != null ? String(servicio.costo) : '',
    descripcion: servicio.descripcion || '', activo: servicio.activo !== false,
    modelo: modeloServicio(servicio), recomendado: servicio.recomendado === true, clienteIdEspecial: servicio.clienteIdEspecial || '',
  }));
  const set = (k) => (e) => setD(x => ({ ...x, [k]: e.target.value }));
  const dup = servicios.find(s => s.id !== servicio.id && norm(s.nombre) === norm(d.nombre));
  const st = stats[servicio.id] || {};
  const margen = num(d.precio) > 0 ? ((num(d.precio) - num(d.costo)) / num(d.precio)) * 100 : null;
  const ofertaValida = !!d.nombre.trim() && !dup;
  const alcanceValido = d.modelo !== 'especial' || !!d.clienteIdEspecial;
  const steps = [{ n: '01', t: 'Oferta' }, { n: '02', t: 'Alcance' }, { n: '03', t: 'Finanzas' }];
  const puedeAbrir = (n) => n <= paso || (n === 2 && ofertaValida) || (n === 3 && ofertaValida && alcanceValido);
  const save = () => {
    if (!d.nombre.trim() || dup || (d.modelo === 'especial' && !d.clienteIdEspecial)) return;
    onSave({
      ...servicio, ...d,
      nombre: d.nombre.trim(), categoria: d.categoria.trim() || 'Otro', precio: num(d.precio), costo: num(d.costo), descripcion: d.descripcion.trim(),
      recomendado: d.modelo === 'plan' && d.recomendado === true,
      clienteIdEspecial: d.modelo === 'especial' ? d.clienteIdEspecial : '',
    });
  };
  return (
    <Modal kicker={isNew ? 'Catálogo · nueva plantilla' : `Catálogo · ${servicio.id}`} title={isNew ? 'Nuevo servicio' : servicio.nombre} onClose={onClose} width={760}
      footer={<>
        {onRemove && <button className="btn sm ghost" style={{ color: 'var(--danger)', marginRight: 'auto' }} onClick={onRemove}>
          <Icon name={st.ventas ? 'archive' : 'trash'} size={12} /> {st.ventas ? 'Archivar' : 'Eliminar'}
        </button>}
        <button className="btn sm ghost" onClick={onClose}>Cancelar</button>
        {paso > 1 && <button className="btn sm ghost" onClick={() => setPaso(p => p - 1)}><Icon name="arrow-l" size={12} /> Volver</button>}
        {paso < 3
          ? <button className="btn sm primary" disabled={paso === 1 ? !ofertaValida : !alcanceValido} onClick={() => setPaso(p => p + 1)}>Continuar <Icon name="arrow-r" size={12} /></button>
          : <button className="btn sm primary" onClick={save} disabled={!ofertaValida || !alcanceValido}>{isNew ? 'Crear servicio' : 'Guardar cambios'}</button>}
      </>}>
      <div className="service-form-lead">
        <div>
          <div className="service-badges">
            <span className={`service-model ${d.modelo}`}>{MODELOS_SERVICIO.find(m => m.id === d.modelo)?.label}</span>
            {d.recomendado && <span className="service-recommended">Recomendado</span>}
          </div>
          <div className="service-form-copy">Esta plantilla define cómo se presenta el servicio en el catálogo y qué información pasa a Nueva venta.</div>
        </div>
        {!isNew && <span className={`service-availability ${d.activo ? 'active' : 'archived'}`}>{d.activo ? 'Disponible' : 'Archivado'}</span>}
      </div>
      {!isNew && st.q > 0 && (
        <div className="fin-strip" style={{ marginBottom: 18 }}>
          <div><div className="k">Vendido</div><div className="v">{st.q}×</div></div>
          <div><div className="k">En ventas</div><div className="v">{st.ventas}</div></div>
          <div><div className="k">Ingresos</div><div className="v">{L(st.ingresos)}</div></div>
          <div><div className="k">Precio prom.</div><div className="v">{L(st.ingresos / st.q)}</div></div>
          <div><div className="k">Última</div><div className="v">{fmtFecha(st.ultima)}</div></div>
        </div>
      )}
      <div className="stepper service-form-stepper">
        {steps.map((s, idx) => (
          <button key={s.n} className={`step ${paso === idx + 1 ? 'active' : paso > idx + 1 ? 'done' : ''}`} disabled={!puedeAbrir(idx + 1)} onClick={() => setPaso(idx + 1)}>
            <div className="n mono">{paso > idx + 1 ? '✓' : s.n}</div>
            <div className="t">{s.t}</div>
          </button>
        ))}
      </div>
      {paso === 1 && (
        <div className="service-form-stage">
          <div className="service-stage-head"><span>01</span><div><b>Definición de la oferta</b><small>Lo que el equipo seleccionará en Nueva venta.</small></div></div>
          <div className="grid-2">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Nombre <span className="req">*</span> {dup && <span style={{ color: 'var(--danger)' }}>· ya existe un servicio con ese nombre</span>}</label>
              <input className="input" autoFocus value={d.nombre} onChange={set('nombre')} placeholder="Ej. Plan Impulso" />
            </div>
            <div className="field">
              <label>Modelo comercial</label>
              <select className="select" value={d.modelo} onChange={e => setD(x => ({
                ...x, modelo: e.target.value,
                unidad: e.target.value === 'plan' ? 'mes' : e.target.value === 'unitario' ? 'pieza' : x.unidad,
                recomendado: e.target.value === 'plan' ? x.recomendado : false,
                clienteIdEspecial: e.target.value === 'especial' ? x.clienteIdEspecial : '',
              }))}>{MODELOS_SERVICIO.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            </div>
            <div className="field">
              <label>Categoría</label>
              <input className="input" list="loopa-cats-form" value={d.categoria} onChange={set('categoria')} />
              <datalist id="loopa-cats-form">{categorias.map(c => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="field">
              <label>Unidad de cobro</label>
              <select className="select" value={d.unidad} onChange={set('unidad')}>{UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}</select>
            </div>
            {d.modelo === 'plan' && (
              <div className="field">
                <label>Presentación comercial</label>
                <div className="segmented" style={{ alignSelf: 'flex-start' }}>
                  <button className={d.recomendado ? '' : 'on'} onClick={() => setD(x => ({ ...x, recomendado: false }))}>Normal</button>
                  <button className={d.recomendado ? 'on' : ''} onClick={() => setD(x => ({ ...x, recomendado: true }))}>Recomendado</button>
                </div>
              </div>
            )}
            {d.modelo === 'especial' && (
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Cliente del acuerdo <span className="req">*</span></label>
                <select className="select" value={d.clienteIdEspecial} onChange={set('clienteIdEspecial')}>
                  <option value="">Elegir cliente…</option>
                  {[...clientes].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')).map(c => <option key={c.id} value={c.id}>{c.nombre}{c.empresa ? ` · ${c.empresa}` : ''}</option>)}
                </select>
                <div className="field-help">Solo aparecerá en Nueva venta cuando este cliente esté seleccionado.</div>
              </div>
            )}
          </div>
        </div>
      )}
      {paso === 2 && (
        <div className="service-form-stage">
          <div className="service-stage-head"><span>02</span><div><b>Alcance reutilizable</b><small>La base que se copia a cada venta y luego puede ajustarse.</small></div></div>
          <div className="field">
            <label>Qué incluye</label>
            <textarea className="textarea service-scope" rows="8" autoFocus value={d.descripcion} onChange={set('descripcion')} placeholder="Entregables, frecuencia, límites, seguimiento y exclusiones principales…" />
            <div className="field-help">Escribí el alcance comercial, no el proceso interno. Esta información aparecerá como detalle editable de la venta.</div>
          </div>
        </div>
      )}
      {paso === 3 && (
        <div className="service-form-stage">
          <div className="service-stage-head"><span>03</span><div><b>Finanzas y disponibilidad</b><small>Valores base para cotizar sin alterar ventas históricas.</small></div></div>
          <div className="grid-2">
            <div className="field">
              <label>Precio base</label>
              <input className="input mono" autoFocus inputMode="decimal" value={d.precio} onChange={set('precio')} placeholder="0" />
            </div>
            <div className="field">
              <label>Costo base</label>
              <input className="input mono" inputMode="decimal" value={d.costo} onChange={set('costo')} placeholder="0" />
            </div>
          </div>
          <div className="service-finance-preview">
            <div><span>Precio</span><b>{L(d.precio)}</b></div>
            <div><span>Costo</span><b>{L(d.costo)}</b></div>
            <div><span>Margen estimado</span><b className={margen != null && margen < 25 ? 'low' : ''}>{margen == null ? '—' : `${margen.toFixed(0)}%`}</b></div>
          </div>
          {!isNew && (
            <div className="field" style={{ marginTop: 18 }}>
              <label>Disponibilidad en Nueva venta</label>
              <div className="segmented" style={{ alignSelf: 'flex-start' }}>
                <button className={d.activo ? 'on' : ''} onClick={() => setD(x => ({ ...x, activo: true }))}>Disponible</button>
                <button className={!d.activo ? 'on' : ''} onClick={() => setD(x => ({ ...x, activo: false }))}>Archivado</button>
              </div>
            </div>
          )}
          {!isNew && <div className="service-history-note">Los cambios aplican a ventas nuevas. Las ventas anteriores conservan nombre, alcance y precio registrados.</div>}
        </div>
      )}
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
  const SortIcon = ({ col }) => sort.col !== col ? null : <span style={{ marginLeft: 4, fontSize: 'var(--fs-s)', color: 'var(--accent)' }}>{sort.dir === 'asc' ? '▲' : '▼'}</span>;
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
                        <div style={{ fontWeight: 500 }}>{c.nombre}</div>
                        {c.empresa && <div className="mono" style={{ fontSize: 'var(--fs-s)', color: 'var(--muted)', letterSpacing: '0.06em' }}>{c.empresa.toUpperCase()}</div>}
                      </td>
                      <td className="mono muted" style={{ fontSize: 'var(--fs-s)' }}>{c.telefono || c.email || '—'}{c.telefono && c.email && <div className="dim">{c.email}</div>}</td>
                      <td className="mono muted" style={{ fontSize: 'var(--fs-s)' }}>{c.canal || '—'}</td>
                      <td className="num">{r.ventas || 0}</td>
                      <td className="num" style={{ fontWeight: 500 }}>{r.total ? L(r.total) : '—'}</td>
                      <td className="num" style={{ color: r.saldo > 0 ? 'var(--warn)' : 'var(--dim)' }}>{r.saldo > 0 ? L(r.saldo) : '—'}</td>
                      <td className="mono muted" style={{ fontSize: 'var(--fs-s)' }}>{r.ultima ? fmtFecha(r.ultima) : '—'}</td>
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
          {hist.length === 0 ? <div className="mono dim" style={{ fontSize: 'var(--fs-s)' }}>Sin ventas.</div> : (
            <div className="panel" style={{ borderRadius: 10 }}>
              <table className="tbl">
                <tbody>
                  {hist.map(v => (
                    <tr key={claveVenta(v)} onClick={() => onOpenVenta(claveVenta(v))} style={{ opacity: esActiva(v) ? 1 : 0.5 }}>
                      <td className="order-n">#{v.n}</td>
                      <td className="mono muted" style={{ fontSize: 'var(--fs-s)' }}>{fmtFecha(v.fecha)}</td>
                      <td style={{ fontSize: 'var(--fs-s)' }}>{v.items.map(i => i.nombre).join(', ')}</td>
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
    ? <div className="mono" style={{ padding: 24, color: 'var(--muted)', fontSize: 'var(--fs-s)', textAlign: 'center' }}>{empty}</div>
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
        <div className="kpi accent"><div className="label"><span className="idx" style={{ color: 'rgba(18,18,17,0.5)' }}>04</span>Ganancia neta</div><div className="value">{L(k.ganancia)}</div></div>
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
            <span className="dl">Ganancia neta</span><span style={{ color: k.ganancia >= 0 ? 'var(--ok)' : 'var(--danger)', fontSize: 'var(--fs-m)' }}>{L(k.ganancia)}</span>
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
            ? <div className="mono" style={{ padding: 24, color: 'var(--muted)', fontSize: 'var(--fs-s)', textAlign: 'center' }}>Sin ventas en el período</div>
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
            ? <div className="mono" style={{ padding: 24, color: 'var(--muted)', fontSize: 'var(--fs-s)', textAlign: 'center' }}>Sin ventas en el período</div>
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
// Tipos de gasto: config.gastoTipos (editables). Se suman los que ya usan los gastos
// guardados, así ningún gasto queda con un tipo "huérfano".
function tiposDeGasto(config, gastos) {
  const usados = [...(gastos.variables || []), ...(gastos.fijos || [])].map(g => g.categoria).filter(Boolean);
  return [...new Set([...(config.gastoTipos || GASTO_CATS), ...usados])];
}

// Selector de tipo con opción para crear uno nuevo en el momento
function TipoGastoSelect({ value, tipos, onChange, onCreate }) {
  const [nuevo, setNuevo] = useState(false);
  const [txt, setTxt] = useState('');
  const crear = () => { const t = onCreate(txt); if (t) onChange(t); setNuevo(false); setTxt(''); };
  if (nuevo) return (
    <input className="input mini" autoFocus placeholder="Nombre del tipo nuevo" value={txt}
      onChange={e => setTxt(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); crear(); } if (e.key === 'Escape') { setNuevo(false); setTxt(''); } }}
      onBlur={() => { if (txt.trim()) crear(); else setNuevo(false); }} />
  );
  return (
    <select className="select mini" value={value} onChange={e => e.target.value === '__nuevo__' ? setNuevo(true) : onChange(e.target.value)}>
      {tipos.map(t => <option key={t} value={t}>{t}</option>)}
      <option value="__nuevo__">＋ Nuevo tipo…</option>
    </select>
  );
}

function GastoModal({ gasto, fijo, tipos, onCreateTipo, onSave, onDelete, onClose }) {
  const [d, setD] = useState(() => ({ ...gasto, monto: String(gasto.monto ?? ''), nota: gasto.nota || '' }));
  const set = (k) => (e) => setD(x => ({ ...x, [k]: e.target.value }));
  const valido = d.concepto.trim() && num(d.monto) > 0;
  const guardar = () => { if (valido) onSave({ ...d, concepto: d.concepto.trim(), monto: num(d.monto), nota: d.nota.trim() }); };
  return (
    <Modal kicker={fijo ? 'Gasto fijo mensual' : 'Gasto variable'} title={gasto.concepto || 'Gasto'} onClose={onClose} width={520}
      footer={<>
        <button className="btn sm ghost" style={{ color: 'var(--danger)', marginRight: 'auto' }}
          onClick={() => uiConfirm({ title: `Eliminar «${gasto.concepto}»`, message: 'Deja de restarse en Métricas.', confirmLabel: 'Eliminar' }).then(ok => { if (ok) onDelete(); })}>
          <Icon name="trash" size={12} /> Eliminar
        </button>
        <button className="btn sm ghost" onClick={onClose}>Cancelar</button>
        <button className="btn sm primary" disabled={!valido} onClick={guardar}>Guardar</button>
      </>}>
      <div className="grid-2">
        {!fijo && (
          <div className="field">
            <label>Fecha</label>
            <input className="input mono" type="date" value={d.fecha} onChange={e => setD(x => ({ ...x, fecha: e.target.value || x.fecha }))} style={{ colorScheme: 'dark' }} />
          </div>
        )}
        <div className="field">
          <label>{fijo ? 'Monto por mes' : 'Monto'}</label>
          <input className="input mono" inputMode="decimal" value={d.monto} onChange={set('monto')} onKeyDown={e => e.key === 'Enter' && guardar()} />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Concepto</label>
          <input className="input" autoFocus value={d.concepto} onChange={set('concepto')} onKeyDown={e => e.key === 'Enter' && guardar()} />
        </div>
        <div className="field">
          <label>Tipo</label>
          <TipoGastoSelect value={d.categoria} tipos={tipos} onChange={t => setD(x => ({ ...x, categoria: t }))} onCreate={onCreateTipo} />
        </div>
        {fijo && (
          <div className="field">
            <label>Estado</label>
            <div className="segmented" style={{ alignSelf: 'flex-start' }}>
              <button className={d.activo !== false ? 'on' : ''} onClick={() => setD(x => ({ ...x, activo: true }))}>Activo</button>
              <button className={d.activo === false ? 'on' : ''} onClick={() => setD(x => ({ ...x, activo: false }))}>Pausado</button>
            </div>
          </div>
        )}
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Nota <span className="dim">(opcional: nº de factura, proveedor…)</span></label>
          <textarea className="textarea" rows="2" value={d.nota} onChange={set('nota')} />
        </div>
      </div>
    </Modal>
  );
}

function Gastos({ gastos, setGastos, config, setConfig }) {
  const tipos = tiposDeGasto(config, gastos);
  const [nv, setNv] = useState({ fecha: today(), concepto: '', categoria: tipos[0] || 'Otro', monto: '' });
  const [nf, setNf] = useState({ concepto: '', categoria: tipos.includes('Software') ? 'Software' : tipos[0] || 'Otro', monto: '' });
  const [periodo, setPeriodo] = useState('mes');
  const [editando, setEditando] = useState(null);   // { fijo: bool, gasto }
  const [verTipos, setVerTipos] = useState(false);
  const [renombrando, setRenombrando] = useState(null); // { de, a }

  // ── Tipos ──
  const crearTipo = (t) => {
    const v = (t || '').trim();
    if (!v) return null;
    const ya = tipos.find(x => norm(x) === norm(v));
    if (ya) return ya;
    setConfig(c => ({ ...c, gastoTipos: [...tiposDeGasto(c, gastos), v] }));
    return v;
  };
  const usosDe = (t) => [...(gastos.variables || []), ...(gastos.fijos || [])].filter(g => g.categoria === t).length;
  const renombrarTipo = (de, a) => {
    const nuevo = (a || '').trim();
    setRenombrando(null);
    if (!nuevo || nuevo === de) return;
    if (tipos.some(x => x !== de && norm(x) === norm(nuevo))) { uiAlert({ title: 'Ese tipo ya existe', message: `Ya hay un tipo llamado «${nuevo}».` }); return; }
    setConfig(c => ({ ...c, gastoTipos: tiposDeGasto(c, gastos).map(x => x === de ? nuevo : x) }));
    const cambiar = (lista) => (lista || []).map(g => g.categoria === de ? { ...g, categoria: nuevo } : g);
    setGastos(g => ({ ...g, variables: cambiar(g.variables), fijos: cambiar(g.fijos) }));
  };
  const borrarTipo = (t) => {
    const n = usosDe(t);
    if (n) { uiAlert({ title: 'No se puede eliminar', message: `«${t}» lo ${n === 1 ? 'usa 1 gasto' : `usan ${n} gastos`}. Renombralo o cambiale el tipo a ${n === 1 ? 'ese gasto' : 'esos gastos'} primero.` }); return; }
    setConfig(c => ({ ...c, gastoTipos: tiposDeGasto(c, gastos).filter(x => x !== t) }));
  };

  // ── Alta / edición / baja ──
  const addVar = () => {
    if (!nv.concepto.trim() || num(nv.monto) <= 0) return;
    setGastos(g => ({ ...g, variables: [{ id: uid('GV'), ...nv, concepto: nv.concepto.trim(), monto: num(nv.monto) }, ...(g.variables || [])] }));
    setNv(x => ({ ...x, concepto: '', monto: '' }));
  };
  const addFijo = () => {
    if (!nf.concepto.trim() || num(nf.monto) <= 0) return;
    setGastos(g => ({ ...g, fijos: [...(g.fijos || []), { id: uid('GF'), ...nf, concepto: nf.concepto.trim(), monto: num(nf.monto), activo: true }] }));
    setNf(x => ({ ...x, concepto: '', monto: '' }));
  };
  const guardarEdicion = (gasto) => {
    const key = editando.fijo ? 'fijos' : 'variables';
    setGastos(g => ({ ...g, [key]: (g[key] || []).map(x => x.id === gasto.id ? gasto : x) }));
    setEditando(null);
  };
  const borrarEdicion = () => {
    const key = editando.fijo ? 'fijos' : 'variables', id = editando.gasto.id;
    setGastos(g => ({ ...g, [key]: (g[key] || []).filter(x => x.id !== id) }));
    setEditando(null);
  };
  const toggleFijo = (id) => setGastos(g => ({ ...g, fijos: g.fijos.map(x => x.id === id ? { ...x, activo: x.activo === false } : x) }));

  // ── Período, totales y desglose por tipo ──
  const r = periodRange(periodo);
  const vars = [...(gastos.variables || [])].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const varsPeriodo = vars.filter(g => inRange(g.fecha, r));
  const primera = vars.length ? vars[vars.length - 1].fecha : today();
  const now = new Date();
  const mesesTodo = Math.max(1, (now.getFullYear() - parseYmd(primera).getFullYear()) * 12 + now.getMonth() - parseYmd(primera).getMonth() + 1);
  const meses = r.months == null ? mesesTodo : r.months;
  const fijoM = fijoMensual(gastos.fijos);
  const totalVar = varsPeriodo.reduce((a, g) => a + num(g.monto), 0);
  const porTipo = useMemo(() => {
    const m = {};
    varsPeriodo.forEach(g => { m[g.categoria || 'Otro'] = (m[g.categoria || 'Otro'] || 0) + num(g.monto); });
    (gastos.fijos || []).filter(f => f.activo !== false).forEach(f => { m[f.categoria || 'Otro'] = (m[f.categoria || 'Otro'] || 0) + num(f.monto) * meses; });
    const tot = Object.values(m).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(m).map(([key, v]) => ({ key, v, pct: Math.round(v / tot * 100) })).sort((a, b) => b.v - a.v);
  }, [gastos, periodo]);
  const totalPeriodo = totalVar + fijoM * meses;
  const PERIODOS = [['mes', 'Este mes'], ['mes-ant', 'Mes anterior'], ['año', 'Este año'], ['todo', 'Todo']];

  const exportar = () => downloadCSV(`loopa-gastos-${periodo}-${today()}.csv`,
    ['Fecha', 'Concepto', 'Tipo', 'Monto', 'Clase', 'Nota'],
    [
      ...varsPeriodo.map(g => [g.fecha, g.concepto, g.categoria, num(g.monto), 'Variable', g.nota || '']),
      ...(gastos.fijos || []).filter(f => f.activo !== false).map(f => ['', f.concepto, f.categoria, num(f.monto) * meses, `Fijo (${L(f.monto)}/mes × ${meses} ${meses === 1 ? 'mes' : 'meses'})`, f.nota || '']),
    ]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Operación</div>
          <div className="page-title">Gastos</div>
          <div className="page-desc">Lo que cuesta mover LOOPA; se resta en Métricas para llegar a la ganancia neta. Tocá cualquier gasto para editarlo.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className={`btn${verTipos ? ' primary' : ''}`} onClick={() => setVerTipos(v => !v)}><Icon name="tag" size={12} /> Tipos de gasto · {tipos.length}</button>
          <button className="btn" onClick={exportar}><Icon name="dl" size={12} /> Excel</button>
        </div>
      </div>

      {verTipos && (
        <div className="panel crop" style={{ marginBottom: 20 }}>
          <div className="panel-head"><div className="panel-title">TIPOS DE GASTO</div>
            <span className="mono dim" style={{ marginLeft: 'auto', fontSize: 'var(--fs-s)' }}>Tocá un tipo para renombrarlo</span></div>
          <div className="panel-body">
            <div className="chips" style={{ marginBottom: 14 }}>
              {tipos.map(t => renombrando?.de === t ? (
                <input key={t} className="input mini" style={{ width: 170 }} autoFocus value={renombrando.a}
                  onChange={e => setRenombrando({ de: t, a: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') renombrarTipo(t, renombrando.a); if (e.key === 'Escape') setRenombrando(null); }}
                  onBlur={() => renombrarTipo(t, renombrando.a)} />
              ) : (
                <span key={t} className="tag-edit">
                  <span style={{ cursor: 'pointer' }} onClick={() => setRenombrando({ de: t, a: t })} title="Renombrar">{t}</span>
                  <span className="mono dim" style={{ fontSize: 'var(--fs-s)', marginLeft: 6 }}>{usosDe(t)}</span>
                  <button onClick={() => borrarTipo(t)} title="Eliminar tipo"><Icon name="x" size={10} /></button>
                </span>
              ))}
            </div>
            <NuevoTipoGasto onCreate={crearTipo} />
          </div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="kpi"><div className="label">Variables · {r.label.toLowerCase()}</div><div className="value">{L(totalVar)}</div></div>
        <div className="kpi"><div className="label">Fijos · {meses} {meses === 1 ? 'mes' : 'meses'}</div><div className="value">{L(fijoM * meses)}</div><div className="delta" style={{ color: 'var(--muted)' }}>{L(fijoM)} por mes</div></div>
        <div className="kpi accent"><div className="label">Total del período</div><div className="value">{L(totalPeriodo)}</div></div>
      </div>

      <div className="metrics-grid-2">
        <div className="panel crop">
          <div className="panel-head" style={{ flexWrap: 'wrap' }}>
            <div className="panel-title">GASTOS VARIABLES · <span className="dim">CON FECHA</span></div>
            <div className="segmented" style={{ marginLeft: 'auto' }}>
              {PERIODOS.map(([id, l]) => <button key={id} className={periodo === id ? 'on' : ''} onClick={() => setPeriodo(id)}>{l}</button>)}
            </div>
          </div>
          <div className="panel-body">
            <div className="gasto-form">
              <input className="input mini mono" type="date" value={nv.fecha} onChange={e => setNv(x => ({ ...x, fecha: e.target.value || today() }))} style={{ colorScheme: 'dark' }} />
              <input className="input mini" placeholder="Concepto (ej. Editor freelance)" value={nv.concepto} onChange={e => setNv(x => ({ ...x, concepto: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addVar()} />
              <TipoGastoSelect value={nv.categoria} tipos={tipos} onChange={t => setNv(x => ({ ...x, categoria: t }))} onCreate={crearTipo} />
              <input className="input mini mono" placeholder="Monto" inputMode="decimal" value={nv.monto} onChange={e => setNv(x => ({ ...x, monto: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addVar()} />
              <button className="btn sm primary" onClick={addVar} title="Agregar gasto"><Icon name="plus" size={11} /></button>
            </div>
            {varsPeriodo.length === 0
              ? <div className="mono dim" style={{ fontSize: 'var(--fs-s)', textAlign: 'center', padding: 20 }}>{vars.length ? 'Sin gastos variables en este período' : 'Sin gastos variables'}</div>
              : varsPeriodo.map(g => (
                <div key={g.id} className="abono-row gasto-row" onClick={() => setEditando({ fijo: false, gasto: g })} title={g.nota || 'Editar gasto'}>
                  <span className="mono dim" style={{ width: 60 }}>{fmtFecha(g.fecha)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{g.concepto} <span className="srv-chip" style={{ marginLeft: 6 }}>{g.categoria}</span>{g.nota && <span className="dim" style={{ marginLeft: 6 }}>· {g.nota}</span>}</span>
                  <span className="mono" style={{ fontWeight: 500 }}>{L(g.monto)}</span>
                  <span className="gasto-edit"><Icon name="edit" size={12} /></span>
                </div>
              ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="panel crop">
            <div className="panel-head"><div className="panel-title">GASTOS FIJOS · <span className="dim">MENSUALES</span></div><span className="chip" style={{ marginLeft: 'auto' }}>MES <span className="v mono">{L(fijoM)}</span></span></div>
            <div className="panel-body">
              <div className="gasto-form" style={{ gridTemplateColumns: '1fr 140px 110px auto' }}>
                <input className="input mini" placeholder="Concepto (ej. Adobe CC)" value={nf.concepto} onChange={e => setNf(x => ({ ...x, concepto: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addFijo()} />
                <TipoGastoSelect value={nf.categoria} tipos={tipos} onChange={t => setNf(x => ({ ...x, categoria: t }))} onCreate={crearTipo} />
                <input className="input mini mono" placeholder="Monto/mes" inputMode="decimal" value={nf.monto} onChange={e => setNf(x => ({ ...x, monto: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addFijo()} />
                <button className="btn sm primary" onClick={addFijo} title="Agregar gasto fijo"><Icon name="plus" size={11} /></button>
              </div>
              {(gastos.fijos || []).length === 0 ? <div className="mono dim" style={{ fontSize: 'var(--fs-s)', textAlign: 'center', padding: 20 }}>Sin gastos fijos</div> : gastos.fijos.map(f => (
                <div key={f.id} className="abono-row gasto-row" style={{ opacity: f.activo === false ? 0.45 : 1 }} onClick={() => setEditando({ fijo: true, gasto: f })} title={f.nota || 'Editar gasto'}>
                  <span style={{ flex: 1, minWidth: 0 }}>{f.concepto} <span className="srv-chip" style={{ marginLeft: 6 }}>{f.categoria}</span></span>
                  <button className="chipbtn" style={{ padding: '3px 9px' }} onClick={e => { e.stopPropagation(); toggleFijo(f.id); }}>{f.activo === false ? 'Pausado' : 'Activo'}</button>
                  <span className="mono" style={{ fontWeight: 500, width: 90, textAlign: 'right' }}>{L(f.monto)}</span>
                  <span className="gasto-edit"><Icon name="edit" size={12} /></span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel crop">
            <div className="panel-head"><div className="panel-title">POR TIPO · <span className="dim">{r.label}</span></div></div>
            {porTipo.length === 0
              ? <div className="mono" style={{ padding: 24, color: 'var(--muted)', fontSize: 'var(--fs-s)', textAlign: 'center' }}>Sin gastos en el período</div>
              : <div>{porTipo.map(c => (
                  <div key={c.key} className="channel-row">
                    <div className="ch" title={c.key}>{c.key}</div>
                    <div className="trk"><span style={{ width: `${c.pct}%` }} /></div>
                    <div className="v">{c.pct}% · {L(c.v)}</div>
                  </div>
                ))}</div>}
          </div>
        </div>
      </div>

      {editando && (
        <GastoModal gasto={editando.gasto} fijo={editando.fijo} tipos={tipos} onCreateTipo={crearTipo}
          onSave={guardarEdicion} onDelete={borrarEdicion} onClose={() => setEditando(null)} />
      )}
    </div>
  );
}

function NuevoTipoGasto({ onCreate }) {
  const [v, setV] = useState('');
  const crear = () => { if (onCreate(v)) setV(''); };
  return (
    <div style={{ display: 'flex', gap: 8, maxWidth: 360 }}>
      <input className="input mini" placeholder="Nuevo tipo (ej. Transporte, Impuestos…)" value={v} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === 'Enter' && crear()} />
      <button className="btn sm" onClick={crear}><Icon name="plus" size={11} /> Agregar</button>
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
            <div className="mono dim" style={{ fontSize: 'var(--fs-s)', marginTop: 10, lineHeight: 1.6 }}>La comisión se resta del total de cada venta al calcular la ganancia (ej. POS o PayPal).</div>
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
              <div className="mono" style={{ fontSize: 'var(--fs-s)', lineHeight: 1.7, color: window.USE_FB ? 'var(--ok)' : 'var(--warn)' }}>
                {DATOS_FUSION ? '● Fusión · ventas, clientes y servicios en el servidor local; configuración y gastos sólo en este navegador' : window.USE_FB ? '● Nube (Firebase) · sincronizado entre dispositivos' : '● Modo local · solo en este navegador'}
              </div>
              {!window.USE_FB && <div className="muted" style={{ fontSize: 'var(--fs-s)', lineHeight: 1.6 }}>Para usarlo desde el celular y la compu con los mismos datos, conectá Firebase (instrucciones en <span className="mono">LEEME.md</span>). Mientras tanto, descargá respaldos seguido.</div>}
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
          <span className="mono dim" style={{ fontSize: 'var(--fs-s)' }}>{allData.ventas.length} ventas · {allData.servicios.length} tipos · {allData.clientes.length} clientes</span>
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
      <div style={{ width: 380, maxWidth: '100%', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22, color: 'var(--accent)' }}><LoopaMark height={21} largo /></div>
        <div className="mono" style={{ fontSize: 'var(--fs-s)', color: 'var(--dim)', letterSpacing: '0.22em', marginBottom: 44, textTransform: 'uppercase' }}>Acceso privado · misma cuenta que FRAME</div>
        <div className={shake ? 'shake' : ''} style={{ background: 'var(--card)', border: `1px solid ${errorMsg ? 'var(--danger)' : 'var(--line)'}`, borderRadius: 18, padding: '32px 28px' }}>
          <input className="input mono" type="email" autoFocus autoComplete="username" placeholder="email" value={email} onChange={e => { setEmail(e.target.value); setErrorMsg(''); }} onKeyDown={onKey} style={{ marginBottom: 10 }} />
          <input className="input mono" type="password" autoComplete="current-password" placeholder="contraseña" value={password} onChange={e => { setPassword(e.target.value); setErrorMsg(''); }} onKeyDown={onKey} />
          {errorMsg && <div className="mono" style={{ fontSize: 'var(--fs-s)', color: 'var(--danger)', marginTop: 10, lineHeight: 1.6 }}>{errorMsg}</div>}
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
            <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, background: state.danger ? 'rgba(230,57,70,.12)' : 'rgba(var(--accent-rgb),.14)', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-m)' }}>{state.danger ? '⚠' : 'ℹ'}</span>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'var(--fs-m)' }}>{state.title}</div>
          </div>
          {state.message && <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-m)', lineHeight: 1.6, whiteSpace: 'pre-wrap', paddingLeft: 40 }}>{state.message}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 22 }}>
          {state.kind === 'confirm' && <button className="btn sm" onClick={() => close(false)}>{state.cancelLabel}</button>}
          <button className="btn sm" autoFocus onClick={() => close(true)} style={{ background: accent, borderColor: accent, color: state.danger ? '#fff' : 'var(--on-accent)', fontWeight: 500 }}>{state.confirmLabel}</button>
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
    ventas.filter(entregaVencida).forEach(v => a.push({ key: `ent|${v.n}|${v.entrega}`, n: claveVenta(v), tipo: 'entrega', label: `#${v.n} · ${v.cliente}`, right: `vence ${fmtFecha(v.entrega)}` }));
    ventas.filter(v => esActiva(v) && ventaSaldo(v) > 0).sort((x, y) => x.fecha.localeCompare(y.fecha)).forEach(v => a.push({ key: `sal|${v.n}|${ventaSaldo(v)}`, n: claveVenta(v), tipo: 'cobro', label: `#${v.n} · ${v.cliente}`, right: L(ventaSaldo(v)) }));
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

// ── Filtro de período de la barra superior (desplegable) ──
// El menú se posiciona "fixed" para que la barra (overflow: hidden) no lo recorte.
function tickerPeriodOptions() {
  const now = new Date();
  return [
    { id: 'mes', label: now.toLocaleDateString('es-HN', { month: 'short', year: '2-digit' }).toUpperCase().replace('.', ''), hint: 'Este mes' },
    { id: 'año', label: String(now.getFullYear()), hint: 'Este año' },
    { id: 'todo', label: 'Acumulado', hint: 'Desde el inicio' },
  ];
}
function PeriodFilter({ value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  const options = tickerPeriodOptions();
  const current = options.find(o => o.id === value) || options[0];
  React.useEffect(() => {
    if (!open) return;
    const outside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', esc);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('keydown', esc); window.removeEventListener('resize', close); };
  }, [open]);
  const toggle = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 6 });
    setOpen(o => !o);
  };
  return (
    <span ref={ref} className="period-filter">
      <button className={`period-btn${open ? ' open' : ''}`} onClick={toggle} aria-haspopup="listbox" aria-expanded={open}>
        <span className="period-lbl">Período</span>
        <span className="period-val">{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && pos && (
        <div className="period-menu" role="listbox" style={{ left: pos.left, top: pos.top }}>
          {options.map(o => (
            <button key={o.id} role="option" aria-selected={o.id === value} className={`period-opt${o.id === value ? ' on' : ''}`}
              onClick={() => { onChange(o.id); setOpen(false); }}>
              <span>{o.label}</span><span className="period-hint">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function App({ onLogout }) {
  const [route, setRoute] = useState(() => {
    try {
      const r = localStorage.getItem('loopa-route') || 'nueva';
      // Sin la bandera, Producción no existe: no se vuelve a una pantalla vacía.
      return r === 'produccion' && !PROD_FLAG ? 'nueva' : r;
    } catch (e) { return 'nueva'; }
  });
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
  const [colaEstado, setColaEstado] = useState({ pendientes: 0, error: null, etiquetas: [] });
  const cola = useRef(null);
  const recargarRef = useRef(() => {});
  const confirmadoRef = useRef(() => {});
  if (DATOS_FUSION && !cola.current) {
    const almacen = { leer: (k) => localStorage.getItem(k), escribir: (k, v) => localStorage.setItem(k, v) };
    cola.current = LoopaFuente.crearCola({
      llamar: FUSION_API.llamar, almacen, nuevoId: nuevoIdFusion,
      // Una sola pestaña ejecuta la cola a la vez (las demás esperan el candado).
      exclusivo: window.navigator && window.navigator.locks ? (fn) => window.navigator.locks.request('loopa-fusion-cola', fn) : undefined,
      alCambiar: (e) => setColaEstado(e),
      alConfirmar: (e, res) => confirmadoRef.current(e, res),
      alVaciarse: () => recargarRef.current(),
    });
  }

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  window.__CUR = config.moneda || 'L';

  const showToast = (msg, tone = 'ok') => { setToast({ msg, tone }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 3000); };
  const showActionToast = (msg, label, fn) => { setToast({ msg, tone: 'info', action: { label, fn } }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 6500); };


  // Datos que quedaron en este navegador de cuando LOOPA funcionaba en modo local:
  // se ofrecen para subir a la nube (una vez; después se archivan como loopa-local-*).
  const offerLocalUpload = (cloud) => {
    if (!window.USE_FB) return;
    const local = readLocalData();
    if (!local) return;
    const nv = local.ventas.length, ns = local.servicios.length, nc = local.clientes.length;
    const cloudEmpty = !((cloud.ventas?.items || []).length || (cloud.servicios?.items || []).length || (cloud.clientes?.items || []).length);
    uiConfirm({
      title: 'Datos guardados en este equipo',
      message: `Este navegador tiene datos de cuando LOOPA funcionaba sin nube:\n${nv} ventas · ${ns} tipos de servicio · ${nc} clientes\n\n` +
        (cloudEmpty ? '¿Subirlos a la nube para verlos en todos los equipos?' : 'La nube ya tiene datos: se van a sumar sin duplicar (tipos y clientes iguales se unen; si un número de venta ya existe, se le asigna uno nuevo).'),
      confirmLabel: 'Subir a la nube', cancelLabel: 'Ahora no', danger: false,
    }).then(ok => {
      if (!ok) return;
      const m = mergeLocalInto(cloud, local);
      setVentas(m.ventas); setClientes(m.clientes); setServicios(m.servicios); setConfig(m.config); setGastos(m.gastos);
      archiveLocalData();
      showToast(`✓ Subido a la nube: ${m.added.ventas} ventas · ${m.added.servicios} tipos · ${m.added.clientes} clientes`);
    });
  };

  // ── Carga ──
  const load = useCallback(() => {
    setLoadError(null);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Tiempo de espera agotado (12 s) — revisá tu conexión')), 12000));
    if (DATOS_FUSION) {
      Promise.race([FUSION_API.leer(), timeout]).then(docs => {
        const d = LoopaFuente.armarDatos(docs);
        setVentas(d.ventas); setClientes(d.clientes); setServicios(d.servicios);
        const local = (k) => { try { return JSON.parse(localStorage.getItem('loopa-fusion-' + k) || 'null'); } catch (e) { return null; } };
        if (local('config')) setConfig({ ...CONFIG_DEFAULT, ...local('config') });
        if (local('gastos')) setGastos({ ...GASTOS_DEFAULT, ...local('gastos') });
        setReady(true);
        setColaEstado(cola.current.estado());
        cola.current.procesar(); // retoma lo que quedó sin guardar
      }).catch(e => { console.error('Carga (fusión):', e); setLoadError(LoopaFuente.normalizarError(e).mensaje); });
      return;
    }
    Promise.race([Store.loadAll(), timeout]).then(d => {
      if (d.ventas?.items) setVentas(d.ventas.items);
      if (d.clientes?.items) setClientes(d.clientes.items);
      if (d.servicios?.items) setServicios(d.servicios.items);
      if (d.config) setConfig({ ...CONFIG_DEFAULT, ...d.config });
      if (d.gastos) setGastos({ ...GASTOS_DEFAULT, ...d.gastos });
      setReady(true);
      setTimeout(() => offerLocalUpload(d), 400);
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
  useEffect(() => { if (ready && !DATOS_FUSION) queueSave('ventas', { items: ventas }); }, [ventas, ready]);
  useEffect(() => { if (ready && !DATOS_FUSION) queueSave('clientes', { items: clientes }); }, [clientes, ready]);
  useEffect(() => { if (ready && !DATOS_FUSION) queueSave('servicios', { items: servicios }); }, [servicios, ready]);
  useEffect(() => { if (ready) queueSave('config', config); }, [config, ready]);
  useEffect(() => { if (ready) queueSave('gastos', gastos); }, [gastos, ready]);

  useEffect(() => { try { localStorage.setItem('loopa-route', route); } catch (e) {} }, [route]);
  // ── Derivados ──
  // Con la fusión el número lo asigna el servidor al guardar.
  const nextN = DATOS_FUSION ? null : Math.max(1000, ...ventas.map(v => v.n)) + 1;
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
  // Período de la barra superior: siempre arranca en el mes actual
  const [tickerPeriod, setTickerPeriod] = useState('mes');
  const ticker = useMemo(() => {
    const now = new Date();
    const r = periodRange(tickerPeriod, now);
    // Gastos fijos: meses transcurridos (no el año entero por adelantado)
    const firstDate = [...ventas.map(v => v.fecha), ...(gastos.variables || []).map(g => g.fecha)].filter(Boolean).sort()[0];
    const monthsSince = firstDate ? Math.max(1, (now.getFullYear() - parseYmd(firstDate).getFullYear()) * 12 + now.getMonth() - parseYmd(firstDate).getMonth() + 1) : 1;
    const g = gastosEnPeriodo(gastos, tickerPeriod === 'año' ? { ...r, months: now.getMonth() + 1 } : r, monthsSince);
    const enPeriodo = ventas.filter(v => esActiva(v) && inRange(v.fecha, r));
    const venta = enPeriodo.reduce((a, v) => a + num(v.total), 0);
    const ganancia = enPeriodo.reduce((a, v) => a + ventaGanancia(v, config.payConfig), 0) - g.total;
    // Cobrado = plata que entró en el período (por fecha del cobro), esté el trabajo en proceso o entregado
    const cobrado = ventas.filter(esActiva).reduce((a, v) => a + (v.abonos || []).filter(x => inRange(x.fecha, r)).reduce((s, x) => s + num(x.monto), 0), 0);
    const porCobrar = ventas.reduce((a, v) => a + ventaSaldo(v), 0);
    const enCurso = ventas.filter(v => ['pendiente', 'en-proceso', 'revision'].includes(v.estado)).length;
    const label = tickerPeriod === 'todo' ? 'ACUMULADO' : tickerPeriod === 'año' ? String(now.getFullYear())
      : now.toLocaleDateString('es-HN', { month: 'short', year: '2-digit' }).toUpperCase().replace('.', '');
    return { venta, cobrado, ganancia, porCobrar, enCurso, label };
  }, [ventas, gastos, config, tickerPeriod]);

  // ── Fusión: recarga, confirmaciones, reintentos ──
  const lectura = useRef(0);
  const recargar = () => {
    const mia = ++lectura.current;
    FUSION_API.leer().then(docs => {
      // Una lectura vieja (empezó antes de otra, o antes de un cambio nuevo)
      // no pisa la pantalla; con cambios pendientes se espera a la cola.
      if (mia !== lectura.current || cola.current.estado().pendientes) return;
      const d = LoopaFuente.armarDatos(docs);
      setVentas(d.ventas); setClientes(d.clientes); setServicios(d.servicios);
    }).catch(e => console.warn('Recargar (fusión):', e));
  };
  recargarRef.current = recargar;
  const creadas = useRef({});
  confirmadoRef.current = (e, res) => {
    const r = (res || []).find(x => x && x.n && x.saleId);
    if (!r) return;
    const base = creadas.current[r.saleId];
    delete creadas.current[r.saleId];
    if (base) setVentas(prev => (prev.some(x => x.id === r.saleId) ? prev : [{ ...base, n: r.n, version: r.version }, ...prev]));
    showToast(`✓ Venta #${r.n} registrada`);
  };
  const encolar = (etiqueta, ops, id) => {
    if (!ops.length) return true;
    lectura.current += 1; // una lectura en vuelo ya no refleja este cambio
    try { cola.current.encolar({ etiqueta, ops, id }); return true; }
    catch (e) { showToast(e.message, 'err'); return false; }
  };
  useEffect(() => {
    if (!DATOS_FUSION) return;
    const online = () => cola.current.reintentar();
    // Otra pestaña cambió la cola: refrescar el aviso y seguir.
    const otra = (ev) => { if (ev.key === LoopaFuente.CLAVE) { setColaEstado(cola.current.estado()); cola.current.procesar(); } };
    window.addEventListener('online', online);
    window.addEventListener('storage', otra);
    return () => { window.removeEventListener('online', online); window.removeEventListener('storage', otra); };
  }, []);
  useEffect(() => {
    // Sin red / servidor ocupado: se reintenta solo cada 15 s, hasta 5 veces
    // seguidas; después, sólo con «Reintentar» (o se descarta).
    if (!DATOS_FUSION || !colaEstado.error || !colaEstado.error.transitorio || colaEstado.error.intentos >= 5) return;
    const t = setTimeout(() => cola.current.reintentar(), 15000);
    return () => clearTimeout(t);
  }, [colaEstado]);
  const descartarCambio = () => { const id = colaEstado.error && colaEstado.error.id; return uiConfirm({
    title: 'Descartar este cambio',
    message: `«${colaEstado.error && colaEstado.error.etiqueta}» no se guardó: ${colaEstado.error && colaEstado.error.mensaje}\n\nSe descarta y la pantalla vuelve a mostrar lo que tiene el servidor.`,
    confirmLabel: 'Descartar',
  }).then(ok => { if (ok && cola.current.descartar(id) && !cola.current.estado().pendientes) recargar(); }); };
  const ventaPorClave = (k) => ventas.find(x => claveVenta(x) === k);

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
    if (DATOS_FUSION) {
      let armado;
      try { armado = LoopaFusion.operacionesNuevaVenta(venta, { ...cli, ...datos }, cid, nuevoIdFusion); }
      catch (e) { showToast(e.message, 'err'); return false; }
      if (!encolar(`Venta nueva · ${datos.nombre}`, armado.ops, `V-${armado.ventaId}`)) return false;
      if (cid) setClientes(prev => prev.map(c => (c.id === cid ? { ...c, ...Object.fromEntries(Object.entries(datos).filter(([, v]) => v)) } : c)));
      else setClientes(prev => [{ id: armado.clienteId, ...datos, notas: '', creado: today() }, ...prev]);
      const lineas = armado.ops[armado.ops.length - 1].data.draft.lines;
      const enPantalla = { ...venta, id: armado.ventaId, n: null, clienteId: armado.clienteId, items: venta.items.map((i, k) => ({ ...i, lineId: lineas[k].lineId })), estadoLog: [] };
      creadas.current[armado.ventaId] = enPantalla;
      showToast('Guardando venta…', 'info');
      return enPantalla;
    }
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
    if (DATOS_FUSION) {
      const v = ventaPorClave(n);
      if (!v) return;
      // Las líneas nuevas reciben su id una sola vez (el mismo en la cola y en pantalla).
      if (patch.items) patch = { ...patch, items: patch.items.map(i => (i.lineId || !i.tipoId ? i : { ...i, lineId: nuevoIdFusion() })) };
      let ops;
      try { ops = LoopaFusion.operacionesCambio(v, patch, nuevoIdFusion); }
      catch (e) { showToast(e.message, 'err'); return; }
      if (!encolar(`Venta #${v.n}`, ops)) return;
    }
    setVentas(prev => prev.map(v => {
      if (claveVenta(v) !== n) return v;
      const log = patch.estado && patch.estado !== v.estado ? { estadoLog: [...(v.estadoLog || []), { estado: patch.estado, ts: new Date().toISOString() }] } : {};
      return { ...v, ...patch, ...log };
    }));
  };
  const handleAbono = (n, ab) => {
    const actual = ventaPorClave(n);
    if (DATOS_FUSION && (!actual || !encolar(`Cobro · venta #${actual.n}`, [LoopaFusion.operacionCobro(actual, ab)]))) return;
    setVentas(prev => prev.map(v => claveVenta(v) === n ? { ...v, abonos: [...(v.abonos || []), ab] } : v));
    showToast(`✓ Cobro de ${L(ab.monto)} registrado en #${actual ? actual.n : n}`);
  };
  const handleDelete = (n) => {
    const v = ventaPorClave(n);
    if (!v) return;
    if (DATOS_FUSION) {
      // D16: «eliminar» es cancelar; deshacer la reactiva con su avance anterior.
      if (v.estado === 'cancelado') { showToast(`La venta #${v.n} ya está cancelada`, 'info'); return; }
      if (!encolar(`Cancelar venta #${v.n}`, [LoopaFusion.operacionEliminar(v)])) return;
      setVentas(prev => prev.map(x => claveVenta(x) === n ? { ...x, estado: 'cancelado' } : x));
      showActionToast(`Venta #${v.n} cancelada`, 'Deshacer', () => {
        const ops = LoopaFusion.operacionesCambio({ ...v, estado: 'cancelado' }, { estado: v.estado }, nuevoIdFusion);
        if (encolar(`Reactivar venta #${v.n}`, ops)) setVentas(prev => prev.map(x => claveVenta(x) === n ? { ...x, estado: v.estado } : x));
      });
      return;
    }
    setVentas(prev => prev.filter(x => claveVenta(x) !== n));
    showActionToast(`Venta #${v.n} eliminada`, 'Deshacer', () => setVentas(prev => prev.some(x => claveVenta(x) === n) ? prev : [...prev, v].sort((a, b) => b.n - a.n)));
  };
  const addCategoria = (cat) => { if (cat && !config.categorias.some(c => norm(c) === norm(cat))) setConfig(c => ({ ...c, categorias: [...c.categorias, cat] })); };
  const handleCreateServicio = (d) => {
    const s = {
      id: uid('SRV'), nombre: d.nombre.trim(), categoria: (d.categoria || '').trim() || 'Otro', unidad: d.unidad || 'proyecto',
      precio: num(d.precio), costo: num(d.costo), descripcion: (d.descripcion || '').trim(), activo: true, creado: today(),
      modelo: d.modelo || (d.unidad === 'mes' ? 'plan' : d.unidad === 'pieza' ? 'unitario' : 'proyecto'),
      recomendado: d.modelo === 'plan' && d.recomendado === true,
      clienteIdEspecial: d.modelo === 'especial' ? (d.clienteIdEspecial || '') : '',
    };
    // Con la fusión se guarda en el catálogo ANTES que la venta que lo usa (la cola va en orden).
    if (DATOS_FUSION && !encolar(`Servicio «${s.nombre}»`, [LoopaFusion.operacionServicio(s)])) return null;
    setServicios(prev => [...prev, s]);
    addCategoria(s.categoria);
    showToast(`✓ Tipo «${s.nombre}» guardado`);
    return s;
  };
  const handleUpdateServicio = (id, patch) => {
    if (DATOS_FUSION) {
      const s = servicios.find(x => x.id === id);
      if (!s || !encolar(`Servicio «${s.nombre}»`, [LoopaFusion.operacionServicio({ ...s, ...patch })])) return;
    }
    setServicios(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    if (patch.precio != null) showToast(`✓ Precio base actualizado a ${L(patch.precio)}`);
  };
  const handleSaveServicio = (s) => {
    if (s.id) {
      if (DATOS_FUSION && !encolar(`Servicio «${s.nombre}»`, [LoopaFusion.operacionServicio(s)])) return;
      setServicios(prev => prev.map(x => x.id === s.id ? s : x)); addCategoria(s.categoria); showToast('✓ Tipo guardado');
    }
    else handleCreateServicio(s);
  };
  const handleSaveCliente = (c) => {
    if (DATOS_FUSION) {
      const cc = c.id ? c : { ...c, id: nuevoIdFusion(), creado: today() };
      if (!encolar(`Cliente «${(cc.nombre || '').trim()}»`, [LoopaFusion.operacionCliente(cc)])) return;
      setClientes(prev => (c.id ? prev.map(x => x.id === c.id ? cc : x) : [cc, ...prev]));
      showToast(c.id ? '✓ Cliente guardado' : '✓ Cliente creado');
      return;
    }
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
  const openVenta = (k) => {
    const porNumero = ventas.filter(x => x.n === k);
    const v = ventas.find(x => claveVenta(x) === k) || (porNumero.length === 1 ? porNumero[0] : null);
    setFocusN(v ? claveVenta(v) : k); setRoute('ventas');
  };
  const handleImport = (d) => {
    if (DATOS_FUSION) { showToast('Restaurar un respaldo no está disponible con los datos de la fusión', 'err'); return; }
    setVentas(d.ventas || []); setClientes(d.clientes || []); setServicios(d.servicios || []);
    setConfig({ ...CONFIG_DEFAULT, ...(d.config || {}) }); setGastos({ ...GASTOS_DEFAULT, ...(d.gastos || {}) });
    showToast('✓ Respaldo restaurado');
  };

  const modules = [
    { id: 'nueva',     label: 'Nueva Venta',   icon: 'plus' },
    { id: 'ventas',    label: 'Ventas',        icon: 'list' },
    { id: 'servicios', label: 'Servicios',     icon: 'tag' },
    { id: 'clientes',  label: 'Clientes',      icon: 'user' },
    ...(PROD_FLAG ? [{ id: 'produccion', label: 'Producción', icon: 'calendar' }] : []),
    { id: 'metricas',  label: 'Métricas',      icon: 'chart' },
    { id: 'gastos',    label: 'Gastos',        icon: 'money' },
    { id: 'config',    label: 'Configuración', icon: 'settings' },
  ];
  const current = modules.find(m => m.id === route) || modules[0];

  if (!ready) return (
    <div className="boot">
      <div style={{ color: 'var(--accent)' }}><LoopaMark height={20} largo /></div>
      {loadError ? (
        <>
          <div className="boot-err"><span style={{ color: 'var(--danger)', fontSize: 'var(--fs-m)' }}>✕</span><div><div className="mono" style={{ fontSize: 'var(--fs-s)', color: 'var(--danger)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>No se pudieron cargar los datos</div><div className="mono muted" style={{ fontSize: 'var(--fs-s)' }}>{loadError}</div></div></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" onClick={load}>↺ Reintentar</button>
            <button className="btn" onClick={() => window.location.reload()}>Recargar</button>
          </div>
        </>
      ) : (
        <>
          <div className="mono muted" style={{ fontSize: 'var(--fs-s)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>{window.USE_FB && !DATOS_FUSION ? 'Conectando con Firebase…' : 'Cargando…'}</div>
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
          <LoopaMark height={26} />
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
              {gVentas.length + gClientes.length === 0 && <div className="mono muted" style={{ padding: '12px', fontSize: 'var(--fs-s)' }}>Sin resultados</div>}
              {gVentas.length > 0 && <div className="dropdown-lbl">Ventas</div>}
              {gVentas.map(v => (
                <div key={claveVenta(v)} className="dropdown-row" onMouseDown={() => { openVenta(claveVenta(v)); setGSearch(''); }}>
                  <div><div className="mono" style={{ fontSize: 'var(--fs-s)', fontWeight: 500 }}>#{v.n} <span className="muted" style={{ fontWeight: 400 }}>· {v.cliente}</span></div><div className="mono dim" style={{ fontSize: 'var(--fs-s)' }}>{fmtFecha(v.fecha)} · {L(v.total)}</div></div>
                </div>
              ))}
              {gClientes.length > 0 && <div className="dropdown-lbl">Clientes</div>}
              {gClientes.map(c => (
                <div key={c.id} className="dropdown-row" onMouseDown={() => { setRoute('clientes'); setGSearch(''); }}>
                  <div><div style={{ fontSize: 'var(--fs-s)', fontWeight: 500 }}>{c.nombre}</div><div className="mono dim" style={{ fontSize: 'var(--fs-s)' }}>{c.empresa || c.telefono}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {PROD_FLAG ? <NavAgrupada modules={modules} route={route} onGo={(id) => (id === 'nueva' && route === 'nueva' ? goNueva(null) : setRoute(id))} /> : (
        <nav className="nav" style={{ marginTop: 8 }}>
          {modules.map(m => (
            <button key={m.id} className={`nav-item ${route === m.id ? 'active' : ''}`} onClick={() => m.id === 'nueva' && route === 'nueva' ? goNueva(null) : setRoute(m.id)} title={m.label}>
              <Icon name={m.icon} size={15} />
              <span>{m.label}</span>
              <span className="nav-mobile-label">{m.label.split(' ')[0]}</span>
            </button>
          ))}
        </nav>
        )}
      </aside>

      <div className="main">
        <div className="ticker">
          <span className="item">● LOOPA OS</span>
          <span className="item">Próx. venta <span className="v">{numProx(nextN)}</span></span>
          <span className="item"><PeriodFilter value={tickerPeriod} onChange={setTickerPeriod} /></span>
          <span className="item">Venta <span className="v">{L(ticker.venta)}</span></span>
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
            {DATOS_FUSION && <ColaAviso estado={colaEstado} onReintentar={() => cola.current.reintentar()} onDescartar={descartarCambio} />}
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
            <Servicios servicios={servicios} clientes={clientes} stats={stats} config={config} onSave={handleSaveServicio}
              onDelete={(id) => {
                if (!DATOS_FUSION) { setServicios(prev => prev.filter(s => s.id !== id)); return; }
                // En el catálogo nada se borra (hay ventas que lo usan): se desactiva.
                const s = servicios.find(x => x.id === id);
                if (!s || !encolar(`Desactivar «${s.nombre}»`, [LoopaFusion.operacionServicio({ ...s, activo: false })])) return;
                setServicios(prev => prev.map(x => (x.id === id ? { ...x, activo: false } : x)));
                showToast(`«${s.nombre}» quedó inactivo (con la ficha única los servicios no se borran)`, 'info');
              }}
              onVender={(s) => {
                const specialClient = modeloServicio(s) === 'especial' ? clientes.find(c => c.id === s.clienteIdEspecial) : null;
                goNueva({ cliente: specialClient ? clientePrefill(specialClient) : undefined, items: [snapshotServicio(s)] });
              }} />
          )}
          {route === 'clientes' && (
            <Clientes clientes={clientes} ventas={ventas} config={config} onSave={handleSaveCliente}
              onDelete={(id) => {
                if (!DATOS_FUSION) { setClientes(prev => prev.filter(c => c.id !== id)); return; }
                showToast('Con la ficha única los clientes no se borran desde LOOPA', 'err');
              }}
              onNuevaVenta={(c) => goNueva({ cliente: clientePrefill(c) })} onOpenVenta={openVenta} />
          )}
          {route === 'produccion' && PROD_FLAG && <ProduccionModulo modo={PROD_FLAG} onAbrirVenta={openVenta} />}
          {route === 'metricas' && <Metricas ventas={ventas} gastos={gastos} config={config} />}
          {route === 'gastos' && <Gastos gastos={gastos} setGastos={setGastos} config={config} setConfig={setConfig} />}
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

// Estado de la cola de la fusión en la barra superior.
function ColaAviso({ estado, onReintentar, onDescartar }) {
  const e = estado.error;
  if (e) return (
    <span className="chip" role="alert" style={{ color: e.transitorio ? 'var(--warn)' : 'var(--danger)', borderColor: 'currentColor', gap: 8, display: 'inline-flex', alignItems: 'center' }} title={`${e.etiqueta}: ${e.mensaje}`}>
      ● {e.transitorio ? `Sin guardar (${estado.pendientes})` : 'No se guardó'}
      <button className="linkbtn" onClick={onReintentar}>Reintentar</button>
      <button className="linkbtn" onClick={onDescartar}>Descartar…</button>
    </span>
  );
  if (estado.sinPersistencia) return <span className="chip" style={{ color: 'var(--warn)', borderColor: 'currentColor' }} title="El navegador no deja guardar la cola (sin espacio o modo privado): si cerrás la página, los cambios sin enviar se pierden.">● Cola sin respaldo{estado.pendientes ? ` · ${estado.pendientes}` : ''}</span>;
  if (estado.pendientes) return <span className="chip" title={estado.etiquetas.join('\n')}>● Guardando {estado.pendientes}…</span>;
  return <span className="chip mob-hide" title="Datos de la fusión: servidor local de este equipo" style={{ color: 'var(--ok)' }}>● Fusión · local</span>;
}

function Root() {
  const [authUser, setAuthUser] = useState(null);
  const [checked, setChecked] = useState(!window.USE_FB || !!DATOS_FUSION);
  useEffect(() => {
    if (!window.USE_FB || DATOS_FUSION) return;
    return firebase.auth().onAuthStateChanged(u => { setAuthUser(u); setChecked(true); });
  }, []);
  if (!window.USE_FB || DATOS_FUSION) return <App onLogout={null} />;
  if (!checked) return <div className="boot"><div className="mono dim" style={{ fontSize: 'var(--fs-s)', letterSpacing: '0.22em', textTransform: 'uppercase' }}>Verificando sesión…</div></div>;
  if (!authUser) return <LoginScreen />;
  return <App onLogout={() => firebase.auth().signOut()} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
