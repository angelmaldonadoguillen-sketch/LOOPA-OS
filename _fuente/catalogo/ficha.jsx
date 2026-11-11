// ═══════════════════════ FICHA DEL PRODUCTO ═══════════════════════
// Etapa «experiencia»: un producto se define una vez —qué incluye, cuándo
// cae cada entrega (patrón), el proceso que sigue y su utilidad— y queda
// listo para vender. La lógica (fechas, costos, qué falta) vive en
// functions/production-plan/ficha.js (LoopaFicha), la misma que usa el
// servidor: lo que se ve acá es lo que después genera Producción.

const FICHA_TONOS = ['#E8FF6B', '#7CC4FF', '#FF9F6B', '#C79BFF', '#6BF0C0', '#FF7AA8', '#F5D06B', '#9BE0FF'];
const fichaTono = (i) => FICHA_TONOS[i % FICHA_TONOS.length];
const fichaId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const PATRON_OPCIONES = [
  { id: 'repartido', label: 'Repartidas', ayuda: 'Parejas en todo el rango' },
  { id: 'semanal', label: 'Cada semana', ayuda: 'Los días que elijas' },
  { id: 'dia', label: 'Día fijo', ayuda: 'El día N del rango' },
  { id: 'final', label: 'Al final', ayuda: 'El último día' },
];
// Tipos de tarjeta de Producción por defecto (los mismos de FRAME); si el
// tablero tiene los suyos, la pantalla usa esos.
const TIPOS_TARJETA_BASE = [
  { id: 'reel', label: 'Reel' }, { id: 'photo', label: 'Fotografía' }, { id: 'corp', label: 'Video corporativo' },
  { id: 'campaign', label: 'Campaign' }, { id: 'bts', label: 'BTS' }, { id: 'podcast', label: 'Podcast' }, { id: 'other', label: 'Otro' },
];
// Los colores del tablero son variables de Producción (sólo existen dentro de
// .estudio): acá se usan equivalentes fijos.
const TONO_TIPO = { reel: '#C79BFF', photo: '#7CC4FF', corp: '#6BF0C0', campaign: '#FF9F6B', bts: '#F5D06B', podcast: '#FF7AA8' };
const tonoTipo = (t) => TONO_TIPO[t.id] || (t.color && !/var\(/.test(t.color) ? t.color : null);
const PASOS_SUGERIDOS = ['Brief', 'Producción', 'Edición', 'Revisión interna', 'Aprobación del cliente', 'Entregado'];
const fmtCorta = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return `${d} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][m - 1]}`; };

function fichaVacia() {
  return { version: 1, duracion: { cantidad: 1, unidad: 'meses' }, entregables: [], proceso: [], costosExtra: [] };
}

// ── Duración del paquete ──────────────────────────────────────────
function FichaDuracion({ duracion, onChange }) {
  const max = LoopaFicha.MAX_DURACION[duracion.unidad];
  return (
    <div className="ficha-duracion">
      <Qty value={duracion.cantidad} onChange={q => onChange({ ...duracion, cantidad: Math.max(1, Math.min(max, num(q) || 1)) })} />
      <div className="segmented">
        {[['dias', 'Días'], ['semanas', 'Semanas'], ['meses', 'Meses']].map(([u, l]) => (
          <button key={u} className={duracion.unidad === u ? 'on' : ''}
            onClick={() => onChange({ cantidad: Math.min(duracion.cantidad, LoopaFicha.MAX_DURACION[u]), unidad: u })}>{l}</button>
        ))}
      </div>
    </div>
  );
}

// ── Qué incluye ───────────────────────────────────────────────────
function FichaEntregables({ ficha, onChange, tipos }) {
  const lista = ficha.entregables;
  const opcionesTipo = (tipos && tipos.length ? tipos : TIPOS_TARJETA_BASE).map(t => (
    t.label && t.label !== t.id ? t : { ...t, label: (TIPOS_TARJETA_BASE.find(b => b.id === t.id) || t).label || t.id }));
  const upd = (id, patch) => onChange(lista.map(e => (e.id === id ? { ...e, ...patch } : e)));
  const updPatron = (e, patch) => upd(e.id, { patron: { ...e.patron, ...patch } });
  const add = () => onChange([...lista, { id: fichaId('e'), nombre: '', detalle: '', cantidad: 1, costo: 0, patron: { tipo: 'repartido' } }]);
  const del = (id) => onChange(lista.filter(e => e.id !== id));
  const cambiarTipo = (e, tipo) => upd(e.id, {
    patron: tipo === 'dia' ? { tipo, dia: 1 } : tipo === 'semanal' ? { tipo, dias: [1, 3, 5] } : { tipo },
  });
  const r = LoopaFicha.rango('2026-01-05', ficha.duracion);
  return (
    <div className="ficha-entregables">
      {lista.length === 0 && (
        <div className="ficha-vacio">
          <b>¿Qué recibe el cliente?</b>
          <span>Cada entregable se convierte en tarjetas de Producción, con su fecha en el calendario. Por ejemplo: <i>Post · 12 repartidas</i>, <i>Reel · lunes y jueves</i>, <i>Reporte · al final</i>.</span>
        </div>
      )}
      {lista.map((e, i) => {
        const n = LoopaFicha.fechasEntregable(LoopaFicha.normalizarFicha({ entregables: [e] }).entregables[0], r).length;
        return (
          <div className="ficha-ent" key={e.id} style={{ '--tono': fichaTono(i) }}>
            <div className="ficha-ent-top">
              <span className="ficha-ent-dot" />
              <input className="input ficha-ent-nombre" placeholder="Nombre del entregable (ej. Post, Reel, Sesión de fotos)" value={e.nombre}
                autoFocus={!e.nombre && i === lista.length - 1} onChange={ev => upd(e.id, { nombre: ev.target.value })} />
              <button className="icon-btn danger" onClick={() => del(e.id)} title="Quitar"><Icon name="x" size={12} /></button>
            </div>
            <input className="input mini ficha-ent-detalle" placeholder="Detalle (opcional): 30 fotos editadas, 1080×1350, copy incluido…" value={e.detalle}
              onChange={ev => upd(e.id, { detalle: ev.target.value })} />
            <div className="ficha-ent-tipo">
              <span className="mini-lbl" style={{ margin: 0 }}>Tarjeta</span>
              {opcionesTipo.map(t => {
                const sugerido = !e.tipo && LoopaFicha.tipoSugerido(e.nombre) === t.id;
                const on = e.tipo === t.id || sugerido;
                return (
                  <button key={t.id} className={`ficha-tipo ${on ? 'on' : ''}`} title={sugerido ? 'Sugerido por el nombre' : ''}
                    onClick={() => upd(e.id, { tipo: e.tipo === t.id ? '' : t.id })}>
                    <span className="ficha-tipo-dot" style={tonoTipo(t) ? { background: tonoTipo(t) } : undefined} />{t.label}{sugerido && <i> · auto</i>}
                  </button>
                );
              })}
            </div>
            <div className="ficha-ent-patron">
              <div className="ficha-patron-tipos">
                {PATRON_OPCIONES.map(p => (
                  <button key={p.id} className={`ficha-patron ${e.patron.tipo === p.id ? 'on' : ''}`} onClick={() => cambiarTipo(e, p.id)} title={p.ayuda}>{p.label}</button>
                ))}
              </div>
              <div className="ficha-patron-params">
                {e.patron.tipo !== 'semanal' && (
                  <label><span className="mini-lbl">{e.patron.tipo === 'repartido' ? 'Cuántas' : 'Entregas'}</span>
                    <Qty value={e.cantidad} onChange={q => upd(e.id, { cantidad: Math.max(1, Math.min(200, q)) })} /></label>
                )}
                {e.patron.tipo === 'dia' && (
                  <label><span className="mini-lbl">Día del rango</span>
                    <Qty value={e.patron.dia} onChange={q => updPatron(e, { dia: Math.max(1, Math.min(r.dias + 1, q)) })} /></label>
                )}
                {e.patron.tipo === 'semanal' && (
                  <div><span className="mini-lbl">Días</span>
                    <div className="ficha-dias">
                      {LoopaFicha.DIAS_SEMANA.map((d, k) => {
                        const on = (e.patron.dias || []).includes(k + 1);
                        return <button key={d} className={on ? 'on' : ''} onClick={() => updPatron(e, { dias: on ? e.patron.dias.filter(x => x !== k + 1) : [...(e.patron.dias || []), k + 1].sort() })}>{d}</button>;
                      })}
                    </div>
                  </div>
                )}
                <label><span className="mini-lbl">Costo c/u</span>
                  <input className="input mini mono" inputMode="decimal" value={e.costo === 0 ? '' : e.costo} placeholder="0"
                    onChange={ev => upd(e.id, { costo: ev.target.value.replace(/[^\d.]/g, '') })} /></label>
              </div>
              <div className="ficha-ent-resumen mono">{n} {n === 1 ? 'entrega' : 'entregas'} · {LoopaFicha.describirPatron(LoopaFicha.normalizarFicha({ entregables: [e] }).entregables[0])}</div>
            </div>
          </div>
        );
      })}
      <button className="ficha-add" onClick={add}><Icon name="plus" size={12} /> Agregar entregable</button>
    </div>
  );
}

// ── Qué incluye un PAQUETE: ítems del catálogo ────────────────────
// Cada fila elige un ítem (su nombre, tipo, costo y proceso vienen de él) y
// dice cuántas veces y con qué patrón cae dentro del paquete.
function FichaItemsPaquete({ ficha, onChange, items }) {
  const lista = ficha.entregables;
  const porId = Object.fromEntries(items.map(s => [s.id, s]));
  const upd = (id, patch) => onChange(lista.map(e => (e.id === id ? { ...e, ...patch } : e)));
  const add = () => onChange([...lista, { id: fichaId('e'), itemId: '', cantidad: 1, patron: { tipo: 'repartido' } }]);
  const del = (id) => onChange(lista.filter(e => e.id !== id));
  const cambiarTipo = (e, tipo) => upd(e.id, { patron: tipo === 'dia' ? { tipo, dia: 1 } : tipo === 'semanal' ? { tipo, dias: [1, 3, 5] } : { tipo } });
  const r = LoopaFicha.rango('2026-01-05', ficha.duracion);
  if (!items.length) {
    return (
      <div className="ficha-vacio">
        <b>Primero creá los ítems</b>
        <span>Un paquete se arma con ítems del catálogo (Post, Reel, Logo…). Creálos en la pestaña <i>Ítems</i> y volvé.</span>
      </div>
    );
  }
  return (
    <div className="ficha-entregables">
      {lista.length === 0 && (
        <div className="ficha-vacio">
          <b>¿Qué ítems trae este paquete?</b>
          <span>Elegí cada ítem y cuántas veces cae en el rango. Su tipo de tarjeta, su costo y su proceso vienen del ítem.</span>
        </div>
      )}
      {lista.map((e, i) => {
        const s = porId[e.itemId];
        const it = s ? LoopaFicha.normalizarItem(s.item) : null;
        const n = e.itemId ? LoopaFicha.fechasEntregable(LoopaFicha.normalizarFicha({ entregables: [e] }).entregables[0], r).length : 0;
        return (
          <div className="ficha-ent" key={e.id} style={{ '--tono': fichaTono(i) }}>
            <div className="ficha-ent-top">
              <span className="ficha-ent-dot" />
              <select className="select ficha-ent-nombre" value={e.itemId || ''} onChange={ev => upd(e.id, { itemId: ev.target.value })}>
                <option value="">Elegí un ítem…</option>
                {items.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
              <button className="icon-btn danger" onClick={() => del(e.id)} title="Quitar"><Icon name="x" size={12} /></button>
            </div>
            {it && (
              <div className="ficha-item-info">
                <span>{(TIPOS_TARJETA_BASE.find(t => t.id === it.tipo) || {}).label || 'Otro'}</span>
                <span>Costo {L(it.costo)}</span>
                <span>{it.proceso.length} {it.proceso.length === 1 ? 'paso' : 'pasos'}: {it.proceso.map(p => p.texto).join(' › ')}</span>
              </div>
            )}
            <div className="ficha-ent-patron">
              <div className="ficha-patron-tipos">
                {PATRON_OPCIONES.map(p => (
                  <button key={p.id} className={`ficha-patron ${e.patron.tipo === p.id ? 'on' : ''}`} onClick={() => cambiarTipo(e, p.id)} title={p.ayuda}>{p.label}</button>
                ))}
              </div>
              <div className="ficha-patron-params">
                {e.patron.tipo !== 'semanal' && (
                  <label><span className="mini-lbl">{e.patron.tipo === 'repartido' ? 'Cuántas' : 'Entregas'}</span>
                    <Qty value={e.cantidad} onChange={q => upd(e.id, { cantidad: Math.max(1, Math.min(200, q)) })} /></label>
                )}
                {e.patron.tipo === 'dia' && (
                  <label><span className="mini-lbl">Día del rango</span>
                    <Qty value={e.patron.dia} onChange={q => upd(e.id, { patron: { ...e.patron, dia: Math.max(1, Math.min(r.dias + 1, q)) } })} /></label>
                )}
                {e.patron.tipo === 'semanal' && (
                  <div><span className="mini-lbl">Días</span>
                    <div className="ficha-dias">
                      {LoopaFicha.DIAS_SEMANA.map((d, k) => {
                        const on = (e.patron.dias || []).includes(k + 1);
                        return <button key={d} className={on ? 'on' : ''} onClick={() => upd(e.id, { patron: { ...e.patron, dias: on ? e.patron.dias.filter(x => x !== k + 1) : [...(e.patron.dias || []), k + 1].sort() } })}>{d}</button>;
                      })}
                    </div>
                  </div>
                )}
              </div>
              {e.itemId && <div className="ficha-ent-resumen mono">{n} {n === 1 ? 'entrega' : 'entregas'} · {LoopaFicha.describirPatron(LoopaFicha.normalizarFicha({ entregables: [e] }).entregables[0])}{it ? ` · ${L(it.costo * n)}` : ''}</div>}
            </div>
          </div>
        );
      })}
      <button className="ficha-add" onClick={add}><Icon name="plus" size={12} /> Agregar ítem</button>
    </div>
  );
}

// ── Línea de tiempo: cómo cae el paquete en el calendario ──────────
function FichaLinea({ ficha, inicio }) {
  const f = LoopaFicha.normalizarFicha(ficha);
  const cal = LoopaFicha.calendario(f, inicio);
  if (!cal.rango || !f.entregables.length) return null;
  const { rango } = cal;
  const pos = (ymd) => {
    const dias = (Date.parse(ymd) - Date.parse(rango.inicio)) / 864e5;
    return `${(dias / Math.max(rango.dias, 1)) * 100}%`;
  };
  return (
    <div className="ficha-linea">
      <div className="ficha-linea-head">
        <span className="mini-lbl" style={{ margin: 0 }}>Así cae en el calendario</span>
        <span className="mono">{fmtCorta(rango.inicio)} → {fmtCorta(rango.fin)} · {cal.entregas.length} {cal.entregas.length === 1 ? 'entrega' : 'entregas'}</span>
      </div>
      {f.entregables.map((e, i) => {
        const suyas = cal.entregas.filter(x => x.entregableId === e.id);
        return (
          <div className="ficha-linea-fila" key={e.id} style={{ '--tono': fichaTono(i) }}>
            <span className="ficha-linea-nombre">{e.nombre || 'Sin nombre'}</span>
            <div className="ficha-linea-pista">
              {suyas.map((x, k) => <span key={k} className="ficha-linea-punto" style={{ left: pos(x.fecha) }} title={`${e.nombre || 'Entrega'} ${x.n}/${x.total} · ${fmtCorta(x.fecha)}`} />)}
            </div>
          </div>
        );
      })}
      <div className="ficha-linea-eje mono"><span>Inicio</span><span>{LoopaFicha.describirDuracion(f.duracion)}</span><span>Fin</span></div>
    </div>
  );
}

// ── Proceso: el checklist de cada entrega ─────────────────────────
function FichaProceso({ proceso, onChange }) {
  const upd = (id, texto) => onChange(proceso.map(p => (p.id === id ? { ...p, texto } : p)));
  const add = (texto = '') => onChange([...proceso, { id: fichaId('p'), texto }]);
  const del = (id) => onChange(proceso.filter(p => p.id !== id));
  const mover = (i, d) => { const a = [...proceso]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };
  const sugeridos = PASOS_SUGERIDOS.filter(s => !proceso.some(p => norm(p.texto) === norm(s)));
  return (
    <div className="ficha-proceso">
      <div className="ficha-pasos">
        {proceso.map((p, i) => (
          <div className="ficha-paso" key={p.id}>
            <span className="ficha-paso-n mono">{pad2(i + 1)}</span>
            <input className="input" value={p.texto} placeholder="Paso del proceso" autoFocus={!p.texto && i === proceso.length - 1}
              onChange={e => upd(p.id, e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && p.texto.trim()) add(); }} />
            <div className="ficha-paso-acc">
              <button className="icon-btn" disabled={i === 0} onClick={() => mover(i, -1)} title="Subir">↑</button>
              <button className="icon-btn" disabled={i === proceso.length - 1} onClick={() => mover(i, 1)} title="Bajar">↓</button>
              <button className="icon-btn danger" onClick={() => del(p.id)} title="Quitar"><Icon name="x" size={12} /></button>
            </div>
          </div>
        ))}
      </div>
      <button className="ficha-add" onClick={() => add()}><Icon name="plus" size={12} /> Agregar paso</button>
      {sugeridos.length > 0 && (
        <div className="ficha-sugeridos">
          <span className="mini-lbl" style={{ margin: 0 }}>Sugeridos</span>
          {sugeridos.map(s => <button key={s} className="chipbtn" onClick={() => add(s)}>+ {s}</button>)}
        </div>
      )}
    </div>
  );
}

// ── Costos extra y utilidad ───────────────────────────────────────
function FichaCostosExtra({ costosExtra, onChange }) {
  const upd = (id, patch) => onChange(costosExtra.map(c => (c.id === id ? { ...c, ...patch } : c)));
  return (
    <div className="ficha-costos">
      {costosExtra.map(c => (
        <div className="ficha-costo" key={c.id}>
          <input className="input mini" placeholder="Concepto (pauta, licencia, transporte…)" value={c.concepto} onChange={e => upd(c.id, { concepto: e.target.value })} />
          <input className="input mini mono" inputMode="decimal" placeholder="0" value={c.monto === 0 ? '' : c.monto} onChange={e => upd(c.id, { monto: e.target.value.replace(/[^\d.]/g, '') })} />
          <button className="icon-btn danger" onClick={() => onChange(costosExtra.filter(x => x.id !== c.id))} title="Quitar"><Icon name="x" size={12} /></button>
        </div>
      ))}
      <button className="ficha-add" onClick={() => onChange([...costosExtra, { id: fichaId('c'), concepto: '', monto: 0 }])}><Icon name="plus" size={12} /> Agregar costo del paquete</button>
    </div>
  );
}

function FichaUtilidad({ ficha, precio }) {
  const f = LoopaFicha.normalizarFicha(ficha);
  const c = LoopaFicha.costos(f);
  const u = LoopaFicha.utilidad(f, precio);
  const m = u.margen;
  const tono = m == null ? '' : m >= 50 ? 'ok' : m >= 25 ? 'warn' : 'bad';
  return (
    <div className="ficha-utilidad">
      <div className="ficha-util-filas">
        <div><span>Precio</span><b className="mono">{L(precio)}</b></div>
        <div><span>Costo de las entregas</span><b className="mono">−{L(c.entregables)}</b></div>
        <div><span>Costos del paquete</span><b className="mono">−{L(c.extras)}</b></div>
      </div>
      <div className={`ficha-util-total ${tono}`}>
        <div><span>Utilidad</span><b className="mono">{L(u.utilidad)}</b></div>
        <div className="ficha-util-margen mono">{m == null ? '—' : `${m.toFixed(0)}%`}</div>
      </div>
      <div className="ficha-util-barra"><span className={tono} style={{ width: `${Math.max(0, Math.min(100, m || 0))}%` }} /></div>
      {f.entregables.some(e => e.patron.tipo === 'semanal') && <div className="field-help">Las entregas semanales se cuentan para un paquete típico; en cada venta se usan las fechas reales.</div>}
    </div>
  );
}

// ── Formulario de un ÍTEM (la pieza) ──────────────────────────────
function ItemForm({ servicio, servicios, categorias, tiposTarjeta, onClose, onSave, onRemove }) {
  const isNew = !servicio.id;
  const it0 = LoopaFicha.normalizarItem(servicio.item);
  const [d, setD] = useState(() => ({
    nombre: servicio.nombre || '', categoria: servicio.categoria || categorias[0] || 'Otro',
    precio: servicio.precio != null ? String(servicio.precio) : '', costo: it0.costo ? String(it0.costo) : '',
    dias: it0.dias, tipo: it0.tipo, detalle: it0.detalle, proceso: it0.proceso, activo: servicio.activo !== false,
  }));
  const set = (k) => (e) => setD(x => ({ ...x, [k]: e.target.value }));
  const dup = servicios.find(s => s.id !== servicio.id && norm(s.nombre) === norm(d.nombre));
  const valido = !!d.nombre.trim() && !dup;
  const tipos = (tiposTarjeta && tiposTarjeta.length ? tiposTarjeta : TIPOS_TARJETA_BASE).map(t => (
    t.label && t.label !== t.id ? t : { ...t, label: (TIPOS_TARJETA_BASE.find(b => b.id === t.id) || t).label || t.id }));
  const sugerido = !d.tipo ? LoopaFicha.tipoSugerido(d.nombre) : '';
  const item = { tipo: d.tipo || sugerido, detalle: d.detalle, dias: d.dias, costo: num(d.costo), proceso: d.proceso };
  const ficha = LoopaFicha.fichaDeItem(servicio.id || 'nuevo', d.nombre, item);
  const borrador = { nombre: d.nombre, precio: num(d.precio), ficha };
  const u = LoopaFicha.utilidad(ficha, num(d.precio));
  const save = () => {
    if (!valido) return;
    onSave({
      ...servicio, clase: 'item', nombre: d.nombre.trim(), categoria: d.categoria.trim() || 'Otro', precio: num(d.precio), costo: num(d.costo),
      descripcion: d.detalle.trim(), modelo: 'unitario', unidad: 'pieza', recomendado: false, clienteIdEspecial: '', activo: d.activo,
      item: LoopaFicha.normalizarItem(item), ficha,
    });
  };
  return (
    <Modal kicker={isNew ? 'Catálogo · nuevo ítem' : `Catálogo · ítem ${servicio.id}`} title={isNew ? 'Nuevo ítem' : servicio.nombre} onClose={onClose} width={760}
      footer={<>
        {onRemove && <button className="btn sm ghost" style={{ color: 'var(--danger)', marginRight: 'auto' }} onClick={onRemove}><Icon name="archive" size={12} /> Archivar</button>}
        <button className="btn sm ghost" onClick={onClose}>Cancelar</button>
        <button className="btn sm primary" onClick={save} disabled={!valido}>{isNew ? 'Crear ítem' : 'Guardar cambios'}</button>
      </>}>
      <div className="service-form-lead">
        <div>
          <div className="service-badges"><span className="service-model unitario">Ítem</span><FichaEstado servicio={borrador} /></div>
          <div className="service-form-copy">La pieza con la que se arman los paquetes. También se vende suelta: empieza el día que elijas y se entrega cuando terminan sus días de producción.</div>
        </div>
      </div>
      <div className="service-form-stage">
        <div className="grid-2">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Nombre <span className="req">*</span> {dup && <span style={{ color: 'var(--danger)' }}>· ya existe con ese nombre</span>}</label>
            <input className="input" autoFocus value={d.nombre} onChange={set('nombre')} placeholder="Ej. Reel, Post, Logotipo, Sesión de fotos" />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Tipo de tarjeta</label>
            <div className="ficha-ent-tipo" style={{ marginTop: 0 }}>
              {tipos.map(t => {
                const on = (d.tipo || sugerido) === t.id;
                return (
                  <button key={t.id} className={`ficha-tipo ${on ? 'on' : ''}`} onClick={() => setD(x => ({ ...x, tipo: x.tipo === t.id ? '' : t.id }))}>
                    <span className="ficha-tipo-dot" style={tonoTipo(t) ? { background: tonoTipo(t) } : undefined} />{t.label}{on && !d.tipo && <i> · auto</i>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="field">
            <label>Precio si se vende suelto</label>
            <input className="input mono" inputMode="decimal" value={d.precio} onChange={set('precio')} placeholder="0" />
          </div>
          <div className="field">
            <label>Costo <span className="dim">(lo que te cuesta producirlo)</span></label>
            <input className="input mono" inputMode="decimal" value={d.costo} onChange={set('costo')} placeholder="0" />
          </div>
          <div className="field">
            <label>Días de producción</label>
            <Qty value={d.dias} onChange={q => setD(x => ({ ...x, dias: Math.max(1, Math.min(365, num(q) || 1)) }))} />
            <div className="field-help">Vendido suelto, se entrega {d.dias} {d.dias === 1 ? 'día' : 'días'} después del inicio.</div>
          </div>
          <div className="field">
            <label>Categoría</label>
            <input className="input" list="loopa-cats-item" value={d.categoria} onChange={set('categoria')} />
            <datalist id="loopa-cats-item">{categorias.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Detalle <span className="dim">(opcional)</span></label>
            <input className="input" value={d.detalle} onChange={set('detalle')} placeholder="Ej. 30 segundos, vertical 9:16, con música y subtítulos" />
          </div>
        </div>
      </div>
      <div className="service-form-stage" style={{ marginTop: 14 }}>
        <div className="service-stage-head"><span>✓</span><div><b>Proceso</b><small>Los pasos que sigue cada vez que se produce. Llegan como checklist a su tarjeta, sola o dentro de un paquete.</small></div></div>
        <FichaProceso proceso={d.proceso} onChange={proceso => setD(x => ({ ...x, proceso }))} />
      </div>
      <div className="service-finance-preview">
        <div><span>Precio suelto</span><b>{L(num(d.precio))}</b></div>
        <div><span>Costo</span><b>{L(u.costo)}</b></div>
        <div><span>Margen</span><b className={u.margen != null && u.margen < 25 ? 'low' : ''}>{u.margen == null ? '—' : `${u.margen.toFixed(0)}%`}</b></div>
      </div>
    </Modal>
  );
}

// ── Estado: ¿se puede vender? ─────────────────────────────────────
function FichaEstado({ servicio, compacto = false }) {
  const falta = LoopaFicha.faltantes(servicio);
  if (!falta.length) return <span className="ficha-estado ok"><Icon name="check" size={11} /> Lista para vender</span>;
  return <span className="ficha-estado falta" title={`Falta: ${falta.join(', ')}`}>{compacto ? 'Incompleta' : `Falta: ${falta.join(', ')}`}</span>;
}
