// ═══════════════════════ MURO DE LA TAREA ═══════════════════════
// Un lienzo por tarea para pensar el trabajo: notas, guiones, imágenes,
// enlaces, listas y paletas que se mueven y se conectan entre sí. No genera
// nada; ayuda a llegar a ideas mejor trabajadas. La lógica pura vive en
// muro-modelo.js. Cada nodo y conexión es un documento propio: dos personas
// pueden trabajar a la vez y cada cambio sólo toca lo que cambió.

const muroColeccion = (projectId) => window.db.collection('frame_projects').doc(projectId).collection('muro');

// La ficha lo escucha para mostrar el resumen; el lienzo usa los mismos datos.
const useMuro = (projectId) => {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!projectId || !window.db) return undefined;
    return muroColeccion(projectId).onSnapshot(
      (snap) => { setError(false); setDocs(snap.docs.map(d => ({ ...d.data(), id: d.id }))); },
      (err) => { console.error('Muro:', err); setError(true); }
    );
  }, [projectId]);
  const leido = useMemo(() => window.MuroModelo.leer(docs || []), [docs]);
  return { cargado: docs !== null, error, ...leido };
};

const MURO_TIPOS = [
  { tipo: 'nota', icon: 'edit', label: 'Nota' },
  { tipo: 'guion', icon: 'film', label: 'Guion' },
  { tipo: 'imagen', icon: 'image', label: 'Imagen' },
  { tipo: 'enlace', icon: 'link', label: 'Enlace' },
  { tipo: 'lista', icon: 'check', label: 'Lista' },
  { tipo: 'paleta', icon: 'palette', label: 'Paleta' },
];
const muroIcono = (tipo) => (MURO_TIPOS.find(t => t.tipo === tipo) || MURO_TIPOS[0]).icon;

// Sigue un arrastre aunque el puntero salga del elemento donde empezó.
const muroArrastre = (inicio, mover, soltar) => {
  const id = inicio.pointerId;
  const alMover = (e) => { if (e.pointerId === id) mover(e); };
  const alSoltar = (e) => {
    if (e.pointerId !== id) return;
    window.removeEventListener('pointermove', alMover);
    window.removeEventListener('pointerup', alSoltar);
    window.removeEventListener('pointercancel', alSoltar);
    soltar(e);
  };
  window.addEventListener('pointermove', alMover);
  window.addEventListener('pointerup', alSoltar);
  window.addEventListener('pointercancel', alSoltar);
};

// Texto editable: la pantalla responde al instante y se guarda en pausas, al
// salir del campo o al cerrar. Lo que llega de otra persona no pisa lo que se
// está escribiendo.
function useMuroBorrador(valor, guardar, espera = 500) {
  const [borrador, setBorrador] = useState(valor);
  const foco = useRef(false);
  const timer = useRef(null);
  const actual = useRef(valor);
  const ultimo = useRef(valor);
  const fn = useRef(guardar);
  fn.current = guardar;
  const volcar = useRef(() => {
    clearTimeout(timer.current);
    timer.current = null;
    if (actual.current !== ultimo.current) { ultimo.current = actual.current; fn.current(actual.current); }
  }).current;
  useEffect(() => {
    ultimo.current = valor;
    if (!foco.current && !timer.current) { actual.current = valor; setBorrador(valor); }
  }, [valor]);
  useEffect(() => () => volcar(), []);
  const poner = (v) => {
    actual.current = v;
    setBorrador(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(volcar, espera);
  };
  return { value: borrador, poner, onChange: (e) => poner(e.target.value), onFocus: () => { foco.current = true; }, onBlur: () => { foco.current = false; volcar(); } };
}

const MuroTexto = ({ valor, guardar, placeholder, ancho, maxLength = window.MuroModelo.LIM.texto }) => {
  const { poner, ...campo } = useMuroBorrador(valor, guardar);
  const ref = useRef(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [campo.value, ancho]);
  return <textarea ref={ref} rows={1} className="muro-texto" placeholder={placeholder} maxLength={maxLength} {...campo} />;
};

const MuroCampo = ({ valor, guardar, placeholder, maxLength = 200, className = '' }) => {
  const { poner, ...campo } = useMuroBorrador(valor, guardar);
  return <input type="text" className={`muro-campo ${className}`} placeholder={placeholder} maxLength={maxLength} {...campo} />;
};

const MuroNota = ({ nodo, api }) => (
  <MuroTexto valor={nodo.datos.texto} ancho={nodo.w} placeholder="Escribí una idea…" guardar={(texto) => api.datos(nodo.id, () => ({ texto }))} />
);

const MuroGuion = ({ nodo, api }) => {
  const LIM = window.MuroModelo.LIM;
  const cambiar = (id, campo) => (v) => api.datos(nodo.id, d => ({ escenas: d.escenas.map(e => (e.id === id ? { ...e, [campo]: v } : e)) }));
  return (
    <div className="muro-guion">
      <div className="muro-escena muro-escena-cab"><span>Tiempo</span><span>En pantalla</span><span>Voz o texto</span><span /></div>
      {nodo.datos.escenas.map(e => (
        <div key={e.id} className="muro-escena">
          <MuroCampo valor={e.tiempo} placeholder="0–5 s" maxLength={20} guardar={cambiar(e.id, 'tiempo')} />
          <MuroTexto valor={e.visual} ancho={nodo.w} maxLength={LIM.celda} placeholder="Qué se ve" guardar={cambiar(e.id, 'visual')} />
          <MuroTexto valor={e.audio} ancho={nodo.w} maxLength={LIM.celda} placeholder="Qué se dice" guardar={cambiar(e.id, 'audio')} />
          <button type="button" className="muro-x" title="Quitar escena" aria-label="Quitar escena" onClick={() => api.datos(nodo.id, d => ({ escenas: d.escenas.filter(x => x.id !== e.id) }))}><Icon name="x" size={11} /></button>
        </div>
      ))}
      {nodo.datos.escenas.length < LIM.escenas && (
        <button type="button" className="muro-agregar" onClick={() => api.datos(nodo.id, d => ({ escenas: [...d.escenas, { id: window.MuroModelo.nuevoId('e'), tiempo: '', visual: '', audio: '' }] }))}><Icon name="plus" size={11} /> Escena</button>
      )}
    </div>
  );
};

const MuroImagen = ({ nodo, api, subiendo }) => {
  const [url, setUrl] = useState('');
  const usarUrl = () => {
    const limpia = window.MuroModelo.urlSegura(url);
    if (!limpia) { api.aviso('Ingresá un enlace http o https válido.'); return; }
    api.datos(nodo.id, () => ({ url: limpia, storagePath: '' }));
    setUrl('');
  };
  if (nodo.datos.url) {
    return <img className="muro-foto" src={nodo.datos.url} alt={nodo.titulo} draggable={false} referrerPolicy="no-referrer" onDoubleClick={() => api.verImagen(nodo.datos.url)} />;
  }
  if (subiendo) return <div className="muro-vacio-img">Subiendo imagen…</div>;
  return (
    <div className="muro-vacio-img">
      <label className="muro-boton">
        <Icon name="upload" size={13} /> Subir imagen
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) api.subir(nodo.id, f); }} />
      </label>
      <input type="text" className="muro-campo" value={url} placeholder="o pegá el enlace de una imagen" onChange={(e) => setUrl(e.target.value)} onBlur={() => { if (url.trim()) usarUrl(); }} onKeyDown={(e) => { if (e.key === 'Enter') usarUrl(); }} />
    </div>
  );
};

const MuroEnlace = ({ nodo, api }) => {
  const info = window.MuroModelo.infoEnlace(nodo.datos.url);
  const [editando, setEditando] = useState(!info.url);
  const [url, setUrl] = useState(info.url);
  const [sinMiniatura, setSinMiniatura] = useState(false);
  useEffect(() => { setUrl(info.url); setSinMiniatura(false); if (!info.url) setEditando(true); }, [info.url]);
  const guardar = () => {
    const limpia = window.MuroModelo.urlSegura(url);
    if (!limpia) { if (url.trim()) api.aviso('Ingresá un enlace http o https válido.'); return; }
    api.datos(nodo.id, () => ({ url: limpia }));
    if (nodo.titulo === window.MuroModelo.TITULOS.enlace) api.actualizar(nodo.id, { titulo: window.MuroModelo.infoEnlace(limpia).host });
    setEditando(false);
  };
  if (editando) {
    return (
      <div className="muro-enlace-editar">
        <input type="text" className="muro-campo" value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} onBlur={guardar} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      </div>
    );
  }
  return (
    <div>
      {info.miniatura && !sinMiniatura && <img className="muro-foto" src={info.miniatura} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setSinMiniatura(true)} />}
      <div className="muro-enlace">
        <div className="muro-enlace-info"><div className="muro-enlace-host">{info.host}</div><div className="muro-enlace-url">{info.url}</div></div>
        <button type="button" className="muro-x" title="Cambiar enlace" aria-label="Cambiar enlace" onClick={() => setEditando(true)}><Icon name="edit" size={12} /></button>
        <a className="muro-boton" href={info.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={12} /> Abrir</a>
      </div>
    </div>
  );
};

const MuroLista = ({ nodo, api }) => {
  const LIM = window.MuroModelo.LIM;
  const ref = useRef(null);
  const enfocar = useRef(null);
  useEffect(() => {
    if (!enfocar.current || !ref.current) return;
    const el = ref.current.querySelector(`[data-fila="${enfocar.current}"] input[type="text"]`);
    if (el) { el.focus(); enfocar.current = null; }
  }, [nodo.datos.filas.length]);
  const agregar = () => {
    const id = window.MuroModelo.nuevoId('f');
    enfocar.current = id;
    api.datos(nodo.id, d => (d.filas.length >= LIM.filas ? {} : { filas: [...d.filas, { id, texto: '', hecho: false }] }));
  };
  const cambiar = (id, patch) => api.datos(nodo.id, d => ({ filas: d.filas.map(f => (f.id === id ? { ...f, ...patch } : f)) }));
  return (
    <div className="muro-lista" ref={ref}>
      {nodo.datos.filas.map(f => (
        <div key={f.id} className={`muro-fila ${f.hecho ? 'hecho' : ''}`} data-fila={f.id} onKeyDown={(e) => { if (e.key === 'Enter' && e.target.type === 'text') { e.preventDefault(); e.target.blur(); agregar(); } }}>
          <input type="checkbox" checked={f.hecho} aria-label="Marcar como hecho" onChange={(e) => cambiar(f.id, { hecho: e.target.checked })} />
          <MuroCampo valor={f.texto} placeholder="Algo por hacer" maxLength={LIM.celda} guardar={(texto) => cambiar(f.id, { texto })} />
          <button type="button" className="muro-x" title="Quitar" aria-label="Quitar" onClick={() => api.datos(nodo.id, d => ({ filas: d.filas.filter(x => x.id !== f.id) }))}><Icon name="x" size={11} /></button>
        </div>
      ))}
      <button type="button" className="muro-agregar" onClick={agregar}><Icon name="plus" size={11} /> Ítem</button>
    </div>
  );
};

const MuroPaleta = ({ nodo, api }) => {
  const LIM = window.MuroModelo.LIM;
  const valor = JSON.stringify(nodo.datos.colores);
  const b = useMuroBorrador(valor, (v) => api.datos(nodo.id, () => ({ colores: JSON.parse(v) })), 250);
  const colores = JSON.parse(b.value);
  const poner = (lista) => b.poner(JSON.stringify(lista));
  return (
    <div className="muro-paleta">
      {colores.map((c, i) => (
        <div key={i} className="muro-color">
          <label className="muro-muestra" style={{ background: c }} title="Cambiar color">
            <input type="color" value={c} aria-label={`Color ${c}`} onChange={(e) => poner(colores.map((x, j) => (j === i ? e.target.value : x)))} />
          </label>
          <span>{c.toUpperCase()}</span>
          <button type="button" className="muro-x" title="Quitar color" aria-label="Quitar color" onClick={() => poner(colores.filter((_, j) => j !== i))}><Icon name="x" size={10} /></button>
        </div>
      ))}
      {colores.length < LIM.colores && (
        <button type="button" className="muro-color-mas" title="Agregar color" aria-label="Agregar color" onClick={() => poner([...colores, '#808080'])}><Icon name="plus" size={14} /></button>
      )}
    </div>
  );
};

const MURO_CUERPOS = { nota: MuroNota, guion: MuroGuion, imagen: MuroImagen, enlace: MuroEnlace, lista: MuroLista, paleta: MuroPaleta };

const MuroNodo = React.memo(function MuroNodo({ nodo, dx, dy, sel, solo, nuevo, subiendo, api }) {
  const raiz = useRef(null);
  const [renombrar, setRenombrar] = useState(false);
  const [ancho, setAncho] = useState(null);
  useEffect(() => {
    if (!nuevo || !raiz.current) return;
    const campo = raiz.current.querySelector('.muro-carta textarea') || raiz.current.querySelector('.muro-carta input[type="text"]');
    if (campo) campo.focus();
    api.nuevoListo();
  }, [nuevo]);
  const Cuerpo = MURO_CUERPOS[nodo.tipo];
  const w = ancho === null ? nodo.w : ancho;
  const tinta = nodo.tipo === 'nota' ? nodo.datos.color : '';
  const terminarNombre = (v) => { setRenombrar(false); const t = v.trim(); if (t && t !== nodo.titulo) api.actualizar(nodo.id, { titulo: t }); };
  const redimensionar = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const z = api.zoom();
    const x0 = e.clientX;
    const LIM = window.MuroModelo.LIM;
    let final = nodo.w;
    muroArrastre(e, (ev) => {
      final = Math.round(Math.min(LIM.anchoMax, Math.max(LIM.anchoMin, nodo.w + (ev.clientX - x0) / z)));
      setAncho(final);
    }, () => { setAncho(null); if (final !== nodo.w) api.actualizar(nodo.id, { w: final }); });
  };
  return (
    <div ref={raiz} data-id={nodo.id} className={`muro-nodo muro-t-${nodo.tipo} ${sel ? 'sel' : ''}`} style={{ transform: `translate(${nodo.x + dx}px, ${nodo.y + dy}px)`, width: w }} onPointerDown={(e) => api.bajarEnNodo(e, nodo.id)}>
      <div className="muro-etiqueta">
        <Icon name={muroIcono(nodo.tipo)} size={12} />
        {renombrar
          ? <input autoFocus className="muro-renombrar" defaultValue={nodo.titulo} maxLength={window.MuroModelo.LIM.titulo} onBlur={(e) => terminarNombre(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = nodo.titulo; e.currentTarget.blur(); } }} />
          : <span onDoubleClick={() => setRenombrar(true)} title="Doble clic para renombrar">{nodo.titulo}</span>}
      </div>
      {solo && (
        <div className="muro-acciones">
          {nodo.tipo === 'nota' && window.MuroModelo.COLORES_NOTA.map(c => (
            <button key={c || 'base'} type="button" className={`muro-tinta ${nodo.datos.color === c ? 'on' : ''}`} style={{ background: c || 'var(--surface-3)' }} title="Color de la nota" aria-label={`Color ${c || 'neutro'}`} onClick={() => api.datos(nodo.id, () => ({ color: c }))} />
          ))}
          <button type="button" title="Renombrar" aria-label="Renombrar" onClick={() => setRenombrar(true)}><Icon name="edit" size={12} /></button>
          <button type="button" title="Duplicar (Ctrl+D)" aria-label="Duplicar" onClick={() => api.duplicar([nodo.id])}><Icon name="copy" size={12} /></button>
          <button type="button" title="Eliminar (Supr)" aria-label="Eliminar" onClick={() => api.eliminar([nodo.id])}><Icon name="trash" size={12} /></button>
        </div>
      )}
      <div className="muro-carta" style={tinta ? { '--tinta': tinta } : undefined} data-tinta={tinta ? '1' : undefined}>
        <Cuerpo nodo={{ ...nodo, w }} api={api} subiendo={subiendo} />
      </div>
      <span className="muro-puerto izq" title="Arrastrá para conectar" onPointerDown={(e) => api.conectarDesde(e, nodo.id)} />
      <span className="muro-puerto der" title="Arrastrá para conectar" onPointerDown={(e) => api.conectarDesde(e, nodo.id)} />
      <span className="muro-ancho" title="Cambiar ancho" onPointerDown={redimensionar} />
    </div>
  );
}, (a, b) => a.dx === b.dx && a.dy === b.dy && a.sel === b.sel && a.solo === b.solo && a.nuevo === b.nuevo && a.subiendo === b.subiendo && JSON.stringify(a.nodo) === JSON.stringify(b.nodo));

const MURO_NO_ARRASTRA = 'input,textarea,button,a,select,label,.muro-puerto,.muro-ancho';

const MuroEspacio = ({ project, muro, onClose }) => {
  const M = window.MuroModelo;
  const col = useMemo(() => muroColeccion(project.id), [project.id]);
  const claveVista = `loopa-muro-vista-${project.id}`;
  const vistaGuardada = useRef((() => {
    try {
      const v = JSON.parse(localStorage.getItem(claveVista));
      return v && [v.x, v.y, v.z].every(Number.isFinite) ? v : null;
    } catch (e) { return null; }
  })());

  // Lo local responde en el acto; lo que llega de Firestore lo reemplaza.
  const [local, setLocal] = useState(muro.indice);
  const indiceRef = useRef(muro.indice);
  useEffect(() => { indiceRef.current = muro.indice; setLocal(muro.indice); }, [muro.indice]);
  const leido = useMemo(() => M.leer(Object.values(local)), [local]);
  const leidoRef = useRef(leido);
  leidoRef.current = leido;

  const [vista, setVista] = useState(vistaGuardada.current || { x: 120, y: 100, z: 1 });
  const vistaRef = useRef(vista);
  const [sel, setSel] = useState([]);
  const selRef = useRef(sel);
  const [linea, setLinea] = useState(null);
  const lineaRef = useRef(null);
  lineaRef.current = linea;
  const [mov, setMov] = useState(null);
  const [temp, setTemp] = useState(null);
  const [marco, setMarco] = useState(null);
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);
  menuRef.current = menu;
  const [nuevo, setNuevo] = useState(null);
  const [subiendo, setSubiendo] = useState({});
  const [foto, setFoto] = useState(null);
  const fotoRef = useRef(null);
  fotoRef.current = foto;
  const [guardando, setGuardando] = useState(0);
  const [mensaje, setMensaje] = useState('');
  const timerMensaje = useRef(null);
  const [, setHistorialTick] = useState(0);
  const lienzo = useRef(null);
  const atras = useRef([]);
  const adelante = useRef([]);
  const timerVista = useRef(null);
  const ajustePendiente = useRef(!vistaGuardada.current);
  const api = useRef({}).current;

  const ponerVista = (v) => {
    vistaRef.current = v;
    setVista(v);
    clearTimeout(timerVista.current);
    timerVista.current = setTimeout(() => { try { localStorage.setItem(claveVista, JSON.stringify(v)); } catch (e) {} }, 300);
  };
  const seleccionar = (ids) => { selRef.current = ids; setSel(ids); if (ids.length) setLinea(null); };
  const nodosAhora = () => Object.values(indiceRef.current).filter(x => x.clase === 'nodo');
  const leidoAhora = () => M.leer(Object.values(indiceRef.current));
  const aviso = (m) => {
    setMensaje(m);
    clearTimeout(timerMensaje.current);
    timerMensaje.current = setTimeout(() => setMensaje(''), 3800);
  };

  const escribir = (cambios) => {
    indiceRef.current = M.aplicarCambios(indiceRef.current, cambios);
    setLocal(indiceRef.current);
    const lote = window.db.batch();
    Object.keys(cambios).forEach(id => { if (cambios[id]) lote.set(col.doc(id), cambios[id]); else lote.delete(col.doc(id)); });
    setGuardando(n => n + 1);
    lote.commit()
      .catch(err => { console.error('Muro:', err); aviso('No se pudo guardar el muro. Revisá la conexión.'); })
      .finally(() => setGuardando(n => n - 1));
  };
  const aplicar = (cambios) => {
    if (!Object.keys(cambios).length) return;
    atras.current.push(M.inverso(indiceRef.current, cambios));
    if (atras.current.length > 100) atras.current.shift();
    adelante.current = [];
    setHistorialTick(t => t + 1);
    escribir(cambios);
  };
  const deshacer = () => {
    const c = atras.current.pop();
    if (!c) return;
    adelante.current.push(M.inverso(indiceRef.current, c));
    setHistorialTick(t => t + 1);
    escribir(c);
  };
  const rehacer = () => {
    const c = adelante.current.pop();
    if (!c) return;
    atras.current.push(M.inverso(indiceRef.current, c));
    setHistorialTick(t => t + 1);
    escribir(c);
  };

  const actualizar = (id, patch) => {
    const n = indiceRef.current[id];
    if (!n) return;
    const sig = M.normalizarNodo({ ...n, ...patch, datos: { ...n.datos, ...(patch.datos || {}) } });
    if (sig && JSON.stringify(sig) !== JSON.stringify(n)) aplicar({ [id]: sig });
  };
  const eliminar = (ids) => {
    if (!ids.length) return;
    aplicar(M.cambiosDeBorrar(leidoAhora(), ids));
    seleccionar([]);
  };
  const duplicar = (ids) => {
    if (!ids.length) return;
    const l = leidoAhora();
    if (l.nodos.length + l.conexiones.length + ids.length * 2 > M.LIM.items) { aviso('Este muro llegó a su límite.'); return; }
    const { cambios, nuevos } = M.cambiosDeDuplicar(l, ids);
    aplicar(cambios);
    seleccionar(nuevos);
  };
  const crear = (tipo, wx, wy, op = {}) => {
    const l = leidoAhora();
    if (l.nodos.length + l.conexiones.length >= M.LIM.items) { aviso('Este muro llegó a su límite.'); return null; }
    // Lo que se pide en un punto va ahí; lo demás busca un lugar sin tapar nada.
    const p = op.exacto ? { x: Math.round(wx), y: Math.round(wy) } : M.lugarLibre(l.nodos.map(n => ({ x: n.x, y: n.y, w: n.w, h: altoDe(n.id) })), wx, wy, M.ANCHOS[tipo], 180, zonaVisible());
    const n = M.crearNodo(tipo, p.x, p.y, op.datos);
    const c = { [n.id]: n };
    if (op.desde) {
      const k = M.conectar({ ...indiceRef.current, [n.id]: n }, op.desde, n.id);
      if (k) c[k.id] = k;
    }
    aplicar(c);
    seleccionar([n.id]);
    if (op.enfocar !== false && tipo !== 'imagen' && tipo !== 'paleta') setNuevo(n.id);
    return n.id;
  };
  // Lo que se ve del muro, sin la barra de herramientas.
  const zonaVisible = () => {
    const r = lienzo.current.getBoundingClientRect();
    const a = M.aMundo(vistaRef.current, r.width > 640 ? 92 : 12, 44);
    const b = M.aMundo(vistaRef.current, r.width - 12, r.height - (r.width > 640 ? 60 : 130));
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  };
  const centro = () => {
    const r = lienzo.current.getBoundingClientRect();
    return M.aMundo(vistaRef.current, r.width / 2, r.height / 2);
  };
  const agregar = (tipo) => { const c = centro(); crear(tipo, c.x - M.ANCHOS[tipo] / 2, c.y - 90); };

  const subir = async (id, file) => {
    const valido = FrameAttachments.validateImageFile(file);
    if (!valido.ok) { aviso(valido.message); return; }
    if (!window.storage) { aviso('Storage todavía no está disponible.'); return; }
    setSubiendo(s => ({ ...s, [id]: true }));
    try {
      const blob = (await compressImg(file, 1600, 0.85)) || file;
      const storagePath = `frame-deliverables/${project.id}/muro_${Date.now()}_${FrameAttachments.safeFileName(file.name || 'imagen.jpg')}`;
      const task = window.storage.ref(storagePath).put(blob, { contentType: blob.type || file.type || 'image/jpeg' });
      const snap = await FrameAttachments.waitForUpload(task, { timeoutMs: 60000 });
      const url = await snap.ref.getDownloadURL();
      actualizar(id, { datos: { url, storagePath } });
    } catch (err) {
      console.error('Muro · subir imagen:', err);
      aviso(FrameAttachments.storageErrorMessage(err));
    } finally {
      setSubiendo(s => { const o = { ...s }; delete o[id]; return o; });
    }
  };
  const crearImagenes = (files, wx, wy) => {
    files.slice(0, 12).forEach((f, i) => {
      const id = crear('imagen', wx + i * 32, wy + i * 32, { enfocar: false });
      if (id) subir(id, f);
    });
  };

  const altoDe = (id) => {
    const el = lienzo.current?.querySelector(`.muro-nodo[data-id="${id}"]`);
    return el ? el.offsetHeight : 160;
  };
  const encuadrar = () => {
    if (!lienzo.current) return;
    const r = lienzo.current.getBoundingClientRect();
    ponerVista(M.encuadre(leidoRef.current.nodos.map(n => ({ x: n.x, y: n.y, w: n.w, h: altoDe(n.id) })), r.width, r.height));
  };
  // El menú siempre entra completo en la pantalla.
  const menuDentro = (p) => {
    const r = lienzo.current.getBoundingClientRect();
    return { sx: Math.max(8, Math.min(p.sx, r.width - 182)), sy: Math.max(8, Math.min(p.sy, r.height - 256)) };
  };
  const puntoDe = (e) => {
    const r = lienzo.current.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const zoomCentro = (factor) => {
    const r = lienzo.current.getBoundingClientRect();
    ponerVista(M.zoomEn(vistaRef.current, factor, r.width / 2, r.height / 2));
  };

  // Mover: arrastra lo seleccionado. Sólo se escribe al soltar.
  const bajarEnNodo = (e, id) => {
    if (e.button !== 0) return;
    setMenu(null);
    if (e.shiftKey) {
      seleccionar(selRef.current.includes(id) ? selRef.current.filter(x => x !== id) : [...selRef.current, id]);
      if (selRef.current.length === 0) return;
    } else if (!selRef.current.includes(id)) {
      seleccionar([id]);
    }
    if (e.target.closest(MURO_NO_ARRASTRA)) return;
    const ids = selRef.current.includes(id) ? selRef.current : [id];
    const z = vistaRef.current.z;
    const x0 = e.clientX; const y0 = e.clientY;
    let dx = 0; let dy = 0; let movio = false;
    muroArrastre(e, (ev) => {
      dx = Math.round((ev.clientX - x0) / z);
      dy = Math.round((ev.clientY - y0) / z);
      if (!movio && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      movio = true;
      setMov({ ids, dx, dy });
    }, () => {
      if (movio && (dx || dy)) {
        const cambios = {};
        ids.forEach(i => { const n = indiceRef.current[i]; if (n) cambios[i] = { ...n, x: n.x + dx, y: n.y + dy }; });
        aplicar(cambios);
      } else if (!movio && !e.shiftKey && selRef.current.length > 1) {
        seleccionar([id]);
      }
      setMov(null);
    });
  };

  // Conectar: del punto de una tarjeta hasta otra. Soltando en vacío, se elige
  // qué crear ahí, ya conectado.
  const conectarDesde = (e, desde) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    setMenu(null);
    const inicio = puntoDe(e);
    const m0 = M.aMundo(vistaRef.current, inicio.sx, inicio.sy);
    setTemp({ desde, x: m0.x, y: m0.y });
    muroArrastre(e, (ev) => {
      const p = puntoDe(ev);
      const m = M.aMundo(vistaRef.current, p.sx, p.sy);
      setTemp({ desde, x: m.x, y: m.y });
    }, (ev) => {
      setTemp(null);
      const debajo = document.elementFromPoint(ev.clientX, ev.clientY);
      const nodo = debajo && debajo.closest('.muro-nodo');
      if (nodo) {
        if (nodo.dataset.id === desde) return;
        const k = M.conectar(indiceRef.current, desde, nodo.dataset.id);
        if (k) aplicar({ [k.id]: k });
        return;
      }
      if (!debajo || debajo.closest('.muro-flotante') || !lienzo.current.contains(debajo)) return;
      const p = puntoDe(ev);
      if (Math.hypot(p.sx - inicio.sx, p.sy - inicio.sy) < 12) return;
      const m = M.aMundo(vistaRef.current, p.sx, p.sy);
      setMenu({ ...menuDentro(p), wx: m.x, wy: m.y - M.PUERTO_Y, desde });
    });
  };

  // Fondo: arrastrar mueve el muro; con Shift, selecciona varias.
  const bajarEnFondo = (e) => {
    if (e.target.closest('.muro-nodo,.muro-flotante')) return;
    setMenu(null);
    if (e.button === 2) return;
    if (e.button === 1) e.preventDefault();
    setLinea(null);
    if (e.shiftKey && e.button === 0) {
      const a = puntoDe(e);
      muroArrastre(e, (ev) => {
        const b = puntoDe(ev);
        setMarco({ x: Math.min(a.sx, b.sx), y: Math.min(a.sy, b.sy), w: Math.abs(a.sx - b.sx), h: Math.abs(a.sy - b.sy) });
      }, (ev) => {
        const b = puntoDe(ev);
        const v = vistaRef.current;
        const p1 = M.aMundo(v, Math.min(a.sx, b.sx), Math.min(a.sy, b.sy));
        const p2 = M.aMundo(v, Math.max(a.sx, b.sx), Math.max(a.sy, b.sy));
        seleccionar(leidoRef.current.nodos.filter(n => n.x < p2.x && n.x + n.w > p1.x && n.y < p2.y && n.y + altoDe(n.id) > p1.y).map(n => n.id));
        setMarco(null);
      });
      return;
    }
    const x0 = e.clientX; const y0 = e.clientY;
    const v0 = vistaRef.current;
    let movio = false;
    muroArrastre(e, (ev) => {
      if (!movio && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      movio = true;
      ponerVista({ ...v0, x: v0.x + ev.clientX - x0, y: v0.y + ev.clientY - y0 });
    }, () => { if (!movio) seleccionar([]); });
  };

  const abrirMenuEn = (e) => {
    if (e.target.closest('.muro-nodo,.muro-flotante')) return;
    const p = puntoDe(e);
    const m = M.aMundo(vistaRef.current, p.sx, p.sy);
    setMenu({ ...menuDentro(p), wx: m.x, wy: m.y });
  };

  Object.assign(api, {
    actualizar, eliminar, duplicar, bajarEnNodo, conectarDesde, subir, aviso,
    datos: (id, fn) => { const n = indiceRef.current[id]; if (n) actualizar(id, { datos: fn(n.datos) }); },
    zoom: () => vistaRef.current.z,
    verImagen: setFoto,
    nuevoListo: () => setNuevo(null),
    atajos: { deshacer, rehacer, eliminar, duplicar, seleccionar },
    pegar: { crear, crearImagenes, centro },
  });

  // El brief que tenía la tarea aparece en el muro la primera vez.
  useEffect(() => {
    const items = M.briefANodos(project.description);
    if (!items.length) return;
    col.doc('meta').get().then((snap) => {
      if (snap.exists) return;
      const lote = window.db.batch();
      items.forEach(it => lote.set(col.doc(it.id), it));
      ajustePendiente.current = true;
      return lote.commit();
    }).catch(err => console.error('Muro · brief:', err));
  }, [col]);

  React.useLayoutEffect(() => {
    if (ajustePendiente.current && leido.nodos.length) { ajustePendiente.current = false; encuadrar(); }
  }, [leido.nodos.length]);

  useEffect(() => {
    const el = lienzo.current;
    const rueda = (e) => {
      if (e.target.closest && e.target.closest('.muro-flotante')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      ponerVista(M.zoomEn(vistaRef.current, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener('wheel', rueda, { passive: false });
    return () => el.removeEventListener('wheel', rueda);
  }, []);

  useEffect(() => {
    const enCampo = (t) => !!(t && t.closest && t.closest('input,textarea'));
    const tecla = (e) => {
      const a = api.atajos;
      if (e.key === 'Escape') {
        if (fotoRef.current) { setFoto(null); return; }
        if (menuRef.current) { setMenu(null); return; }
        if (enCampo(e.target)) { e.target.blur(); return; }
        if (selRef.current.length || lineaRef.current) { a.seleccionar([]); setLinea(null); return; }
        onClose();
        return;
      }
      if (enCampo(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selRef.current.length) a.eliminar(selRef.current);
        else if (lineaRef.current) { const id = lineaRef.current; setLinea(null); aplicar({ [id]: null }); }
      } else if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) a.rehacer(); else a.deshacer(); }
      else if (mod && k === 'y') { e.preventDefault(); a.rehacer(); }
      else if (mod && k === 'd') { e.preventDefault(); a.duplicar(selRef.current); }
      else if (mod && k === 'a') { e.preventDefault(); a.seleccionar(leidoRef.current.nodos.map(n => n.id)); }
    };
    const pegado = (e) => {
      if (enCampo(e.target)) return;
      const { crear: nuevoNodo, crearImagenes: imagenes, centro: medio } = api.pegar;
      const c = medio();
      const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); imagenes(files, c.x - 140, c.y - 90); return; }
      const d = M.dePegado(e.clipboardData?.getData('text/plain'));
      if (d) { e.preventDefault(); nuevoNodo(d.tipo, c.x - M.ANCHOS[d.tipo] / 2, c.y - 90, { datos: d.datos, enfocar: false }); }
    };
    window.addEventListener('keydown', tecla);
    window.addEventListener('paste', pegado);
    return () => { window.removeEventListener('keydown', tecla); window.removeEventListener('paste', pegado); };
  }, []);

  useEffect(() => () => { clearTimeout(timerVista.current); clearTimeout(timerMensaje.current); }, []);

  const conDesplazamiento = (n) => (mov && mov.ids.includes(n.id) ? { ...n, x: n.x + mov.dx, y: n.y + mov.dy } : n);
  const lineaSel = linea && leido.indice[linea];
  const solo = sel.length === 1 ? sel[0] : null;
  let rutaTemp = '';
  if (temp && leido.indice[temp.desde]) {
    const p = M.puntos(conDesplazamiento(leido.indice[temp.desde]), { x: temp.x, y: temp.y - M.PUERTO_Y, w: 0 });
    rutaTemp = M.curva(p);
  }
  const paso = 26 * Math.max(0.5, vista.z);

  return ReactDOM.createPortal(
    <div className="muro" role="dialog" aria-modal="true" aria-label={`Muro de ${project.title}`}>
      <header className="muro-cabecera">
        <button type="button" className="muro-volver" onClick={onClose}><Icon name="chevronLeft" size={14} /> Volver a la tarea</button>
        <div className="muro-nombre">
          <strong>Muro</strong>
          <span>{[project.title, project.client].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="muro-estado" aria-live="polite">{muro.error ? 'Sin acceso al muro' : guardando > 0 ? 'Guardando…' : muro.cargado ? 'Guardado' : 'Cargando…'}</div>
      </header>

      <div ref={lienzo} className="muro-lienzo" style={{ backgroundSize: `${paso}px ${paso}px`, backgroundPosition: `${vista.x}px ${vista.y}px` }}
        onPointerDown={bajarEnFondo} onDoubleClick={abrirMenuEn}
        onDragOver={(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); }}
        onDrop={(e) => {
          const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
          if (!files.length) return;
          e.preventDefault();
          const p = puntoDe(e);
          const m = M.aMundo(vistaRef.current, p.sx, p.sy);
          crearImagenes(files, m.x, m.y);
        }}>
        <div className="muro-mundo" style={{ transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.z})` }}>
          <svg className="muro-lineas" aria-hidden="true">
            {leido.conexiones.map(k => {
              const A = conDesplazamiento(leido.indice[k.a]);
              const B = conDesplazamiento(leido.indice[k.b]);
              const d = M.ruta(A, B).d;
              return (
                <g key={k.id} className={linea === k.id ? 'sel' : ''}>
                  <path className="muro-linea" d={d} />
                  <path className="muro-linea-zona" d={d} onPointerDown={(e) => { e.stopPropagation(); seleccionar([]); setLinea(k.id); setMenu(null); }} />
                </g>
              );
            })}
            {rutaTemp && <path className="muro-linea temp" d={rutaTemp} />}
          </svg>
          {leido.nodos.map(n => (
            <MuroNodo key={n.id} nodo={n} api={api}
              dx={mov && mov.ids.includes(n.id) ? mov.dx : 0} dy={mov && mov.ids.includes(n.id) ? mov.dy : 0}
              sel={sel.includes(n.id)} solo={solo === n.id && !mov} nuevo={nuevo === n.id} subiendo={!!subiendo[n.id]} />
          ))}
          {lineaSel && (() => {
            const r = M.ruta(conDesplazamiento(leido.indice[lineaSel.a]), conDesplazamiento(leido.indice[lineaSel.b]));
            return (
              <button type="button" className="muro-quitar-linea muro-flotante" style={{ left: r.mx, top: r.my, transform: `translate(-50%, -50%) scale(${1 / vista.z})` }} title="Quitar conexión" aria-label="Quitar conexión"
                onClick={() => { setLinea(null); aplicar({ [lineaSel.id]: null }); }}><Icon name="x" size={12} /></button>
            );
          })()}
        </div>

        {marco && <div className="muro-marco" style={{ left: marco.x, top: marco.y, width: marco.w, height: marco.h }} />}

        {muro.cargado && !leido.nodos.length && !muro.error && (
          <div className="muro-bienvenida">
            <strong>Este muro está vacío</strong>
            <p>Agregá una nota, un guion, una imagen o un enlace y conectá las ideas arrastrando desde el punto de cada tarjeta.</p>
            <p className="muro-pista">También podés pegar con Ctrl+V o soltar imágenes acá.</p>
          </div>
        )}
        {muro.error && <div className="muro-bienvenida"><strong>No se pudo abrir el muro</strong><p>Revisá tu conexión y volvé a intentar.</p></div>}

        <nav className="muro-barra muro-flotante" aria-label="Agregar al muro">
          {MURO_TIPOS.map(t => (
            <button key={t.tipo} type="button" title={`Agregar ${t.label.toLowerCase()}`} onClick={() => agregar(t.tipo)}><Icon name={t.icon} size={16} /><span>{t.label}</span></button>
          ))}
        </nav>

        <div className="muro-zoom muro-flotante">
          <button type="button" title="Deshacer (Ctrl+Z)" aria-label="Deshacer" disabled={!atras.current.length} onClick={deshacer}><Icon name="undo" size={14} /></button>
          <button type="button" title="Rehacer (Ctrl+Y)" aria-label="Rehacer" disabled={!adelante.current.length} onClick={rehacer}><Icon name="redo" size={14} /></button>
          <i />
          <button type="button" title="Alejar" aria-label="Alejar" onClick={() => zoomCentro(1 / 1.25)}><Icon name="minus" size={14} /></button>
          <button type="button" className="muro-pct" title="Volver a 100 %" onClick={() => zoomCentro(1 / vistaRef.current.z)}>{Math.round(vista.z * 100)}%</button>
          <button type="button" title="Acercar" aria-label="Acercar" onClick={() => zoomCentro(1.25)}><Icon name="plus" size={14} /></button>
          <button type="button" title="Ver todo el muro" aria-label="Ver todo el muro" onClick={encuadrar}><Icon name="fit" size={14} /></button>
        </div>

        {menu && (
          <div className="muro-menu muro-flotante" style={{ left: menu.sx, top: menu.sy }} role="menu">
            <div className="muro-menu-t">{menu.desde ? 'Crear y conectar' : 'Agregar aquí'}</div>
            {MURO_TIPOS.map(t => (
              <button key={t.tipo} type="button" role="menuitem" onClick={() => { crear(t.tipo, menu.wx, menu.wy, { desde: menu.desde, exacto: true }); setMenu(null); }}><Icon name={t.icon} size={13} /> {t.label}</button>
            ))}
          </div>
        )}
      </div>

      {mensaje && <div className="muro-aviso" role="status">{mensaje}</div>}

      {foto && (
        <div className="muro-foto-grande" onClick={() => setFoto(null)}>
          <img src={foto} alt="" referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>,
    capaEstudio()
  );
};

// Dibujo chico del muro para el botón de la ficha.
const MuroMiniatura = ({ nodos, conexiones, indice }) => {
  if (!nodos.length) {
    return (
      <svg className="muro-mini" viewBox="0 0 120 64" aria-hidden="true">
        <rect x="6" y="10" width="30" height="20" rx="4" /><rect x="84" y="4" width="30" height="20" rx="4" /><rect x="70" y="40" width="30" height="20" rx="4" />
        <path d="M36 20 C 60 20, 60 14, 84 14" /><path d="M36 20 C 54 20, 52 50, 70 50" />
      </svg>
    );
  }
  const M = window.MuroModelo;
  const alto = 130;
  const x0 = Math.min(...nodos.map(n => n.x)); const y0 = Math.min(...nodos.map(n => n.y));
  const x1 = Math.max(...nodos.map(n => n.x + n.w)); const y1 = Math.max(...nodos.map(n => n.y + alto));
  const m = Math.max(x1 - x0, y1 - y0) * 0.06 + 10;
  return (
    <svg className="muro-mini" viewBox={`${x0 - m} ${y0 - m} ${x1 - x0 + 2 * m} ${y1 - y0 + 2 * m}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {conexiones.map(k => <path key={k.id} d={M.ruta(indice[k.a], indice[k.b]).d} />)}
      {nodos.map(n => <rect key={n.id} x={n.x} y={n.y} width={n.w} height={alto} rx="14" />)}
    </svg>
  );
};
