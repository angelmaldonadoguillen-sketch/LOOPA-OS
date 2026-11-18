// ═══════════════════════════════════════════════════════════════
// LOOPA OS · Resultados del cliente en redes (2026-11-17)
//
// La raíz es el MES CALENDARIO (del 1 al último día), aparte del plan: datos
// netos de cada mes, comparables entre sí. Se cargan a mano (red por red) o
// con el CSV que exporta el Administrador de anuncios de Meta; los carga el
// equipo o Claude, que los copia de Meta Business Suite y TikTok Studio.
// Cuando haya API, escribe el mismo documento (loopa_results).
//
// Cálculos en datos/resultados.js (LoopaResultados), probados con Node.
// ═══════════════════════════════════════════════════════════════

const RESULTADOS_LOCAL = 'loopa-resultados';

// Lectura y escritura: Firestore con la fusión; este navegador sin ella.
function useResultadosCliente(clienteId) {
  const [docs, setDocs] = useState({});
  const [estado, setEstado] = useState('cargando'); // cargando | listo | sin-acceso | error
  useEffect(() => {
    if (!clienteId) { setDocs({}); setEstado('listo'); return undefined; }
    setEstado('cargando');
    if (FUSION_FB) {
      return FUSION_FB.db.collection('loopa_results').where('clientId', '==', clienteId).onSnapshot(q => {
        const m = {};
        q.docs.forEach(d => { const x = d.data(); if (LoopaResultados.esMes(x.mes)) m[x.mes] = { ...x, id: d.id }; });
        setDocs(m); setEstado('listo');
      }, e => setEstado(e && e.code === 'permission-denied' ? 'sin-acceso' : 'error'));
    }
    try {
      const todos = JSON.parse(localStorage.getItem(RESULTADOS_LOCAL) || '{}');
      const m = {};
      Object.values(todos).forEach(x => { if (x.clientId === clienteId && LoopaResultados.esMes(x.mes)) m[x.mes] = x; });
      setDocs(m);
    } catch (e) { setDocs({}); }
    setEstado('listo');
    return undefined;
  }, [clienteId]);

  const guardar = async (doc) => {
    if (FUSION_FB) {
      const uid = FUSION_FB.auth.currentUser && FUSION_FB.auth.currentUser.uid;
      await FUSION_FB.db.collection('loopa_results').doc(doc.id).set({
        ...doc, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: uid,
      });
      return;
    }
    const todos = JSON.parse(localStorage.getItem(RESULTADOS_LOCAL) || '{}');
    todos[doc.id] = { ...doc, updatedAt: new Date().toISOString(), updatedBy: 'local' };
    localStorage.setItem(RESULTADOS_LOCAL, JSON.stringify(todos));
    setDocs(d => ({ ...d, [doc.mes]: todos[doc.id] }));
  };
  return { docs, estado, guardar };
}

const fmtN = (n) => (typeof n === 'number' ? n.toLocaleString('es-HN', { maximumFractionDigits: 2 }) : '—');
const fmtPlata = (moneda, n) => (typeof n === 'number' ? `${moneda === 'HNL' ? 'L' : '$'} ${n.toLocaleString('es-HN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}` : '—');
const fmtInversion = (inv) => {
  const m = Object.keys(inv || {});
  return m.length ? m.map(k => fmtPlata(k, inv[k])).join(' + ') : '—';
};

// Cambio contra el mes anterior. `alReves`: subir es malo (costo por resultado).
function Delta({ valor, alReves = false, contra = 'vs mes anterior' }) {
  if (valor === null || valor === undefined) return null;
  const bueno = alReves ? valor < 0 : valor > 0;
  const color = valor === 0 ? 'var(--muted)' : bueno ? 'var(--ok)' : 'var(--danger)';
  return <div className="delta" style={{ color }}>{valor > 0 ? '▲' : valor < 0 ? '▼' : '■'} {Math.abs(valor)} % {contra}</div>;
}

// Mes en curso: a cuánto llegaría el mes si sigue igual.
const Proyeccion = ({ texto }) => (texto ? <div className="resultados-proy">→ {texto} al cierre</div> : null);

// Semáforo de campañas (LoopaResultados.campanas).
const ESTADO_CAMPANA = {
  bien: { color: 'var(--ok)', texto: 'Bajo el promedio' },
  ojo: { color: 'var(--warn)', texto: 'Hasta 1,5× el promedio' },
  mal: { color: 'var(--danger)', texto: 'Caro: más de 1,5× el promedio' },
  'sin-leads': { color: 'var(--danger)', texto: 'Gastó y no trajo leads' },
  otro: { color: 'var(--muted)', texto: 'Otro objetivo (clics)' },
};

// Curva de leads acumulados del mes: lo cargado (línea llena), hacia dónde va
// al ritmo de hoy (punteada) y, de fondo, el ritmo del mes anterior.
function CurvaLeads({ puntos, ultimoDia, proyeccion, anteriorTotal, anteriorDias, hoyDia }) {
  const W = 640, H = 190, PL = 8, PR = 56, PT = 14, PB = 24;
  const maxY = Math.max(1, proyeccion || 0, anteriorTotal || 0, ...puntos.map(p => p.resultados || 0)) * 1.08;
  const x = (dia) => PL + (dia / ultimoDia) * (W - PL - PR);
  const y = (v) => PT + (1 - v / maxY) * (H - PT - PB);
  const linea = puntos.map((p, i) => `${i ? 'L' : 'M'}${x(p.dia).toFixed(1)},${y(p.resultados).toFixed(1)}`).join(' ');
  const area = puntos.length > 1 ? `${linea} L${x(puntos[puntos.length - 1].dia).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z` : '';
  const ult = puntos[puntos.length - 1];
  const marcas = [1, 8, 15, 22, ultimoDia];
  return (
    <svg className="resultados-curva" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Leads acumulados del mes">
      {[0.25, 0.5, 0.75, 1].map(f => <line key={f} x1={PL} x2={W - PR} y1={y(maxY / 1.08 * f)} y2={y(maxY / 1.08 * f)} className="rc-grid" />)}
      <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} className="rc-base" />
      {marcas.map(d => <text key={d} x={x(d)} y={H - 6} className="rc-eje" textAnchor="middle">{d}</text>)}
      {anteriorTotal > 0 && (
        <g>
          <line x1={x(0)} y1={y(0)} x2={x(ultimoDia)} y2={y(anteriorTotal * ultimoDia / (anteriorDias || ultimoDia))} className="rc-anterior" />
          <text x={W - PR + 6} y={y(anteriorTotal * ultimoDia / (anteriorDias || ultimoDia)) + 4} className="rc-eje">mes ant.</text>
        </g>
      )}
      {hoyDia > 0 && hoyDia < ultimoDia && <line x1={x(hoyDia)} x2={x(hoyDia)} y1={PT} y2={y(0)} className="rc-hoy" />}
      {area && <path d={area} className="rc-area" />}
      {linea && <path d={linea} className="rc-linea" />}
      {ult && proyeccion > 0 && ult.dia < ultimoDia && (
        <g>
          <line x1={x(ult.dia)} y1={y(ult.resultados)} x2={x(ultimoDia)} y2={y(proyeccion)} className="rc-proy" />
          <circle cx={x(ultimoDia)} cy={y(proyeccion)} r="3.5" className="rc-proy-punto" />
          <text x={x(ultimoDia) + 6} y={y(proyeccion) + 4} className="rc-valor rc-valor--dim">{fmtN(proyeccion)}</text>
        </g>
      )}
      {puntos.slice(1).map(p => <circle key={p.dia} cx={x(p.dia)} cy={y(p.resultados)} r="3.5" className="rc-punto" />)}
      {ult && ult.dia > 0 && <text x={x(ult.dia)} y={y(ult.resultados) - 9} className="rc-valor" textAnchor="middle">{fmtN(ult.resultados)}</text>}
    </svg>
  );
}

// Reparto de la pauta por estado de la campaña: dónde está la plata.
function RepartoPauta({ filas }) {
  const orden = ['bien', 'ojo', 'mal', 'sin-leads', 'otro'];
  const por = orden.map(k => ({ k, p: Math.round(filas.filter(f => f.estado === k).reduce((s, f) => s + f.participacion, 0) * 10) / 10 })).filter(x => x.p > 0);
  if (!por.length) return null;
  return (
    <div className="resultados-reparto">
      <div className="rr-barra">{por.map(x => <span key={x.k} style={{ width: `${x.p}%`, background: ESTADO_CAMPANA[x.k].color }} title={`${ESTADO_CAMPANA[x.k].texto}: ${x.p} %`} />)}</div>
      <div className="rr-leyenda">
        {por.map(x => <span key={x.k}><i style={{ background: ESTADO_CAMPANA[x.k].color }} />{ESTADO_CAMPANA[x.k].texto} <b className="mono">{x.p} %</b></span>)}
      </div>
    </div>
  );
}

// Se entra desde la ficha del cliente (pedido de Ángel, 2026-11-17): `clienteInicial`
// es ese cliente y `onVolver` regresa a Clientes. El selector queda para cambiar.
function ResultadosRedes({ clientes, clienteInicial = '', onVolver }) {
  const lista = useMemo(() => [...(clientes || [])].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')), [clientes]);
  const [clienteId, setClienteId] = useState(() => { if (clienteInicial) return clienteInicial; try { return localStorage.getItem('loopa-resultados-cliente') || ''; } catch (e) { return ''; } });
  useEffect(() => { if (clienteInicial) setClienteId(clienteInicial); }, [clienteInicial]);
  useEffect(() => {
    if (!lista.length) return;
    if (!lista.some(c => c.id === clienteId)) setClienteId(lista[0].id);
  }, [lista]);
  useEffect(() => { try { localStorage.setItem('loopa-resultados-cliente', clienteId); } catch (e) {} }, [clienteId]);

  const hoy = today();
  const [mes, setMes] = useState(() => LoopaResultados.mesActual(hoy));
  const { docs, estado, guardar } = useResultadosCliente(clienteId);
  const cliente = lista.find(c => c.id === clienteId);
  const R = LoopaResultados;

  // Borrador del mes elegido: lo que se edita antes de guardar.
  // Hasta qué día llegan los datos: hoy en el mes en curso; un mes cerrado, completo.
  const corteDefecto = (m) => (LoopaResultados.enCurso(m, hoy) ? hoy : null);
  const vacio = () => ({ redes: {}, ventas: {}, notas: '', anuncios: [], fuentes: [], corte: corteDefecto(mes), avance: [] });
  const [borrador, setBorrador] = useState(vacio());
  const [red, setRed] = useState('meta_ads');
  const [avisos, setAvisos] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const cambiado = useRef(false);
  // Se tocó un campo a mano (no sólo el CSV): así la carga queda anotada como manual.
  const aMano = useRef(false);
  // Un CSV de otro mes: se aplica cuando ese mes ya está en pantalla (si no,
  // el cambio de mes lo borraba al limpiar el formulario).
  const csvPendiente = useRef(null);
  // Al cambiar de mes o de cliente: el formulario arranca de lo guardado.
  // Cuando llega una actualización de la base (por ejemplo, la propia
  // carga recién guardada) se recarga sólo si no hay cambios sin guardar, y
  // el mensaje de lo que pasó al guardar no se borra.
  const docMes = docs[mes];
  const baseDe = (d) => (d ? { redes: JSON.parse(JSON.stringify(d.redes || {})), ventas: { ...(d.ventas || {}) }, notas: d.notas || '', anuncios: d.anuncios || [], fuentes: d.fuentes || [], corte: d.corte || corteDefecto(mes), avance: d.avance || [] } : vacio());
  useEffect(() => {
    const base = baseDe(docs[mes]);
    const p = csvPendiente.current;
    if (p && p.mes === mes) {
      csvPendiente.current = null;
      cambiado.current = true;
      setBorrador(p.aplicar(base)); setAvisos(p.avisos); setMensaje(p.mensaje); setRed('meta_ads');
      return;
    }
    setBorrador(base);
    setAvisos([]); setMensaje(''); cambiado.current = false; aMano.current = false;
  }, [mes, clienteId]);
  useEffect(() => {
    if (cambiado.current) return;
    setBorrador(baseDe(docMes));
  }, [docMes]);

  const actual = docs[mes];
  const anterior = docs[R.mesAnterior(mes)];
  const cerrado = !R.enCurso(mes, hoy);
  const vista = cambiado.current ? borrador : (actual || borrador);
  const s = R.resumen(vista);
  const c = R.comparar(vista, anterior);
  const alertas = R.alertas({ ...vista, mes }, anterior, { cerrado });
  // En curso: contra los mismos días del mes anterior, y la proyección al cierre.
  const corteVista = vista.corte || corteDefecto(mes);
  const diasVista = R.diasCubiertos(mes, corteVista);
  const rit = cerrado ? {} : R.ritmo({ ...vista, mes }, mes, corteVista, anterior);
  const proy = cerrado ? null : R.proyeccion({ ...vista, mes }, mes, corteVista);
  const contraTxt = cerrado ? 'vs mes anterior' : 'vs mismos días del mes anterior';
  const d = (k) => (cerrado ? c[k] : rit[k]);
  const proyInversion = proy && Object.keys(proy.inversion).length ? fmtInversion(proy.inversion) : null;
  const historial = Array.from({ length: 6 }, (_, i) => R.sumarMeses(mes, -i));
  const maxLeadsHist = Math.max(1, ...historial.map(m => (docs[m] ? R.resumen(docs[m]).resultados || 0 : 0)));

  // Lo visual: curva del mes, campañas con semáforo y dónde va la pauta.
  const camp = R.campanas(vista);
  const ultimoDiaMes = R.ultimoDia(mes);
  const diaDatos = cerrado ? ultimoDiaMes : diasVista;
  let puntos = R.serieDelMes({ ...vista, mes }).filter(p => p.dia <= diaDatos);
  if (typeof s.resultados === 'number' && diaDatos > 0) {
    if (!puntos.length) puntos = [{ dia: 0, resultados: 0 }];
    puntos = [...puntos.filter(p => p.dia !== diaDatos), { dia: diaDatos, resultados: s.resultados }];
  }
  const anteriorTotal = anterior ? R.resumen(anterior).resultados : null;
  const conLeads = camp.filas.filter(f => f.costoPorLead !== null);
  const mejor = conLeads.length > 1 ? [...conLeads].sort((a, b) => a.costoPorLead - b.costoPorLead)[0] : null;
  const peor = conLeads.length > 1 ? [...conLeads].sort((a, b) => b.costoPorLead - a.costoPorLead)[0] : null;
  const maxInvCamp = Math.max(1, ...camp.filas.map(f => f.inversion));
  const monedaPauta = s.moneda || (vista.redes.meta_ads || {}).moneda || 'USD';
  const [cargaAbierta, setCargaAbierta] = useState(false);
  const mostrarCarga = cargaAbierta || !actual || cambiado.current;

  const setCampo = (redId, campo, valor) => {
    cambiado.current = true; aMano.current = true;
    setBorrador(b => ({ ...b, redes: { ...b.redes, [redId]: { ...(b.redes[redId] || {}), [campo]: valor } } }));
  };
  const setVentas = (campo, valor) => { cambiado.current = true; aMano.current = true; setBorrador(b => ({ ...b, ventas: { ...b.ventas, [campo]: valor } })); };

  const importarCsv = async (file) => {
    if (!file) return;
    const texto = await file.text();
    const r = R.leerCsvMetaAds(texto);
    const aplicar = (b) => ({
      ...b,
      redes: { ...b.redes, meta_ads: { ...(b.redes.meta_ads || {}), ...r.totales, ...(r.moneda ? { moneda: r.moneda } : {}) } },
      anuncios: r.anuncios,
      fuentes: [...(b.fuentes || []), { red: 'meta_ads', tipo: 'csv', archivo: file.name.slice(0, 120), at: new Date().toISOString() }],
      // El informe llega hasta una fecha: los datos son «del 1 al» esa fecha.
      ...(r.corte ? { corte: r.corte } : {}),
    });
    const avisosCsv = r.corte && r.mes && !R.enCurso(r.mes, hoy)
      ? [...r.avisos, `El informe llega al ${Number(r.corte.slice(8, 10))} y ${R.nombreMes(r.mes)} ya cerró: faltan días. Exportalo del 1 al ${R.ultimoDia(r.mes)}.`]
      : r.avisos;
    const mensajeCsv = `CSV leído: ${r.anuncios.length} anuncios${r.corte ? `, datos al ${Number(r.corte.slice(8, 10))}` : ''}. Revisá y guardá.`;
    if (r.mes && r.mes !== mes) {
      const ok = await uiConfirm({ title: 'El informe es de otro mes', message: `El CSV es de ${R.nombreMes(r.mes)}. ¿Lo cargo en ${R.nombreMes(r.mes)}?`, confirmLabel: `Ir a ${R.nombreMes(r.mes)}` });
      if (!ok) return;
      csvPendiente.current = { mes: r.mes, aplicar, avisos: avisosCsv, mensaje: mensajeCsv };
      setMes(r.mes);
      return;
    }
    cambiado.current = true;
    setBorrador(aplicar);
    setRed('meta_ads');
    setAvisos(avisosCsv);
    setMensaje(mensajeCsv);
  };

  const guardarMes = async () => {
    if (!clienteId) return;
    const n = R.normalizar({ ...borrador, id: R.docId(clienteId, mes), clientId: clienteId, mes });
    const fuentes = [...(borrador.fuentes || [])];
    if (aMano.current || !fuentes.length) fuentes.push({ tipo: 'manual', at: new Date().toISOString() });
    setGuardando(true);
    try {
      const corte = R.enCurso(mes, hoy) ? (R.esFecha(borrador.corte) ? borrador.corte : hoy) : null;
      const punto = R.puntoDeAvance(n, corte || `${mes}-${String(R.ultimoDia(mes)).padStart(2, '0')}`);
      const avance = [...(borrador.avance || []).filter(a => a.fecha !== punto.fecha), punto].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-62);
      await guardar({ id: n.id, clientId: clienteId, mes, redes: n.redes, ventas: n.ventas, notas: n.notas, anuncios: n.anuncios, fuentes: fuentes.slice(-50), avance, ...(corte ? { corte } : {}) });
      cambiado.current = false; aMano.current = false;
      // Lo guardado queda en el formulario (el avance con esta carga incluida).
      setBorrador(x => ({ ...x, avance, ...(corte ? { corte } : {}) }));
      setMensaje(`✓ Guardado ${R.nombreMes(mes)}`);
    } catch (e) {
      setMensaje(e && e.code === 'permission-denied' ? 'No tenés permiso para guardar resultados.' : 'No se pudo guardar. Revisá la conexión.');
    } finally { setGuardando(false); }
  };

  const ultimaFuente = (actual && actual.fuentes && actual.fuentes.length) ? actual.fuentes[actual.fuentes.length - 1] : null;
  const redDef = R.REDES.find(x => x.id === red);
  const valorRed = borrador.redes[red] || {};

  if (!lista.length) {
    return <div className="panel crop"><div className="panel-body dim">Todavía no hay clientes. Creá uno en Clientes para cargar sus resultados.</div></div>;
  }

  return (
    <div className="resultados">
      <div className="page-head">
        <div>
          {onVolver
            ? <button className="resultados-volver" onClick={onVolver}><Icon name="arrow-l" size={11} /> Clientes</button>
            : <div className="page-kicker">Clientes</div>}
          <div className="page-title">Resultados{cliente ? <span className="resultados-titulo-cliente"> · {cliente.nombre}</span> : null}</div>
          <div className="page-desc">Datos netos de cada mes calendario (del 1 al último día), aparte del plan vendido. Se cargan a mano o con el CSV de Meta Ads.</div>
        </div>
        <div className="resultados-controles">
          <select className="select" value={clienteId} onChange={e => setClienteId(e.target.value)} aria-label="Cliente">
            {lista.map(cl => <option key={cl.id} value={cl.id}>{cl.nombre}{cl.empresa && cl.empresa !== cl.nombre ? ` · ${cl.empresa}` : ''}</option>)}
          </select>
          <div className="resultados-mes" role="group" aria-label="Mes">
            <button className="btn sm" onClick={() => setMes(R.mesAnterior(mes))} aria-label="Mes anterior"><Icon name="arrow-l" size={12} /></button>
            <span className="resultados-mes__nombre">{R.nombreMes(mes)}{!cerrado && <span className="resultados-curso">en curso · día {diasVista} de {R.ultimoDia(mes)}</span>}</span>
            <button className="btn sm" onClick={() => setMes(R.sumarMeses(mes, 1))} disabled={mes >= R.mesActual(hoy)} aria-label="Mes siguiente"><Icon name="arrow-r" size={12} /></button>
          </div>
        </div>
      </div>

      {estado === 'sin-acceso' && <div className="panel crop" style={{ marginBottom: 16 }}><div className="panel-body dim">Sólo el equipo comercial ve los resultados (hay montos de pauta).</div></div>}
      {estado === 'error' && <div className="panel crop" style={{ marginBottom: 16 }}><div className="panel-body" style={{ color: 'var(--danger)' }}>No se pudieron leer los resultados. Recargá la página.</div></div>}

      {alertas.length > 0 && (
        <div className="resultados-alertas" role="status">
          {alertas.map((a, i) => <div key={i} className="resultados-alerta"><span className="resultados-punto" aria-hidden="true" />{a.texto}</div>)}
        </div>
      )}

      {typeof s.resultados === 'number' && (
        <div className="resultados-hero">
          <div className="panel crop">
            <div className="panel-head"><div className="panel-title">LEADS · <span className="dim">un mensaje es un lead</span></div></div>
            <div className="panel-body">
              <div className="rh-cifras">
                <div className="rh-bloque">
                  <div className="rh-num">{fmtN(s.resultados)}</div>
                  <div className="rh-sub">{fmtN(s.mensajes || 0)} por mensaje · {fmtN(s.leads || 0)} por formulario</div>
                  <Delta valor={d('resultados')} contra={contraTxt} />
                </div>
                <div className="rh-bloque">
                  <div className="rh-etq">Costo por lead</div>
                  <div className="rh-num rh-num--m">{s.costoPorResultado !== null ? fmtPlata(s.moneda, s.costoPorResultado) : '—'}</div>
                  <Delta valor={d('costoPorResultado')} alReves contra={contraTxt} />
                </div>
                {!cerrado && (
                  <div className="rh-bloque rh-bloque--mes">
                    <div className="rh-etq">Día {diasVista} de {ultimoDiaMes}</div>
                    <div className="rh-barra"><span style={{ width: `${Math.round((diasVista / ultimoDiaMes) * 100)}%` }} /></div>
                    {proy && proy.resultados !== null && <div className="rh-sub">Al ritmo de hoy cierra con <b className="mono">{fmtN(proy.resultados)}</b> leads{proyInversion ? <> y <b className="mono">{proyInversion}</b> de pauta</> : null}</div>}
                  </div>
                )}
              </div>
              <CurvaLeads puntos={puntos} ultimoDia={ultimoDiaMes} proyeccion={proy ? proy.resultados : null} anteriorTotal={anteriorTotal} anteriorDias={R.ultimoDia(R.mesAnterior(mes))} hoyDia={cerrado ? 0 : diasVista} />
              <div className="rc-leyenda">
                <span><i className="rcl-linea" />Leads acumulados</span>
                {!cerrado && proy && <span><i className="rcl-proy" />Si sigue igual</span>}
                {anteriorTotal > 0 && <span><i className="rcl-ant" />Ritmo del mes anterior</span>}
              </div>
            </div>
          </div>
          {camp.filas.length > 0 && (
            <div className="panel crop">
              <div className="panel-head"><div className="panel-title">DÓNDE VA LA PAUTA · <span className="dim">{fmtPlata(monedaPauta, camp.total)}</span></div></div>
              <div className="panel-body">
                <RepartoPauta filas={camp.filas} />
                <div className="rh-extremos">
                  {mejor && <div className="rh-extremo"><span className="rh-etq">Lead más barato</span><b>{mejor.nombre}</b><span className="mono" style={{ color: 'var(--ok)' }}>{fmtPlata(monedaPauta, mejor.costoPorLead)} por lead</span></div>}
                  {peor && <div className="rh-extremo"><span className="rh-etq">Lead más caro</span><b>{peor.nombre}</b><span className="mono" style={{ color: 'var(--danger)' }}>{fmtPlata(monedaPauta, peor.costoPorLead)} por lead</span></div>}
                  {camp.promedio !== null && <div className="rh-extremo"><span className="rh-etq">Promedio</span><span className="mono">{fmtPlata(monedaPauta, camp.promedio)} por lead · {camp.filas.length} campañas</span></div>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="kpi-grid resultados-kpis">
        <div className="kpi"><div className="label">Inversión en pauta</div><div className="value">{fmtInversion(s.inversion)}</div><Delta valor={d('inversion')} alReves contra={contraTxt} /><Proyeccion texto={proyInversion} /></div>
        {typeof s.resultados !== 'number' && <div className="kpi accent"><div className="label">Leads</div><div className="value">{fmtN(s.resultados)}</div></div>}
        {typeof s.resultados !== 'number' && <div className="kpi"><div className="label">Costo por lead</div><div className="value">—</div></div>}
        <div className="kpi"><div className="label">Alcance (sumado)</div><div className="value">{fmtN(s.alcance)}</div><Delta valor={d('alcance')} contra={contraTxt} /></div>
        <div className="kpi"><div className="label">Seguidores nuevos</div><div className="value">{fmtN(s.seguidoresNuevos)}</div><Delta valor={d('seguidoresNuevos')} contra={contraTxt} /><Proyeccion texto={proy && proy.seguidoresNuevos !== null ? fmtN(proy.seguidoresNuevos) : null} /></div>
        <div className="kpi"><div className="label">Ventas reportadas</div><div className="value">{fmtN(s.ventas)}</div><Delta valor={d('ventas')} contra={contraTxt} /><Proyeccion texto={proy && proy.ventas !== null ? fmtN(proy.ventas) : null} /></div>
      </div>

      {camp.filas.length > 0 && (
        <div className="panel crop" style={{ marginBottom: 20 }}>
          <div className="panel-head" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="panel-title">CAMPAÑAS · <span className="dim">{camp.filas.length} · costo por lead contra el promedio{camp.promedio !== null ? ` (${fmtPlata(monedaPauta, camp.promedio)})` : ''}</span></div>
          </div>
          <div className="panel-body" style={{ overflowX: 'auto' }}>
            <div className="rc-campanas" role="table" aria-label="Campañas del mes">
              <div className="rcc-fila rcc-cab" role="row">
                <span role="columnheader" />
                <span role="columnheader">Campaña</span>
                <span role="columnheader">Inversión</span>
                <span role="columnheader" className="num">Leads</span>
                <span role="columnheader" className="num">Costo / lead</span>
              </div>
              {camp.filas.map(f => {
                const e = ESTADO_CAMPANA[f.estado];
                return (
                  <div key={f.id || f.nombre} className={`rcc-fila rcc-${f.estado}`} role="row">
                    <span role="cell"><i className="rcc-punto" style={{ background: e.color }} title={e.texto} /></span>
                    <span role="cell" className="rcc-nombre" title={f.nombre}>{f.nombre}</span>
                    <span role="cell" className="rcc-inv">
                      <span className="rcc-barra"><span style={{ width: `${Math.max(2, (f.inversion / maxInvCamp) * 100)}%`, background: e.color }} /></span>
                      <span className="mono">{fmtPlata(monedaPauta, f.inversion)}</span>
                      <span className="mono dim rcc-pct">{f.participacion} %</span>
                    </span>
                    <span role="cell" className="num mono">{f.leads > 0 ? fmtN(f.leads) : (f.clics > 0 ? <span className="dim">{fmtN(f.clics)} clics</span> : '0')}</span>
                    <span role="cell" className="num">
                      {f.costoPorLead !== null
                        ? <span className="rcc-chip mono" style={{ color: e.color, borderColor: e.color }}>{fmtPlata(monedaPauta, f.costoPorLead)}{f.veces !== null && f.veces > 1.5 ? ` · ${f.veces}×` : ''}</span>
                        : <span className="rcc-chip mono" style={{ color: e.color, borderColor: e.color }}>{f.estado === 'otro' ? 'otro objetivo' : 'sin leads'}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="metrics-grid-2">
        <div className="panel crop">
          <div className="panel-head" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="panel-title">CARGAR · <span className="dim">{R.nombreMes(mes).toUpperCase()}</span></div>
            <label className="btn sm" style={{ marginLeft: 'auto', cursor: 'pointer' }} title="Administrador de anuncios › Exportar › CSV, del 1 a la fecha de hoy (o al último día si el mes ya cerró)">
              <Icon name="dl" size={11} /> Importar CSV de Meta Ads
              <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => { importarCsv(e.target.files && e.target.files[0]); e.target.value = ''; }} />
            </label>
            {actual && !cambiado.current && (
              <button className="btn sm" onClick={() => setCargaAbierta(v => !v)} aria-expanded={mostrarCarga}>{mostrarCarga ? 'Cerrar' : 'Editar a mano'}</button>
            )}
          </div>
          {!mostrarCarga && (
            <div className="panel-body dim mono" style={{ fontSize: 'var(--fs-s)' }}>
              {mensaje || (ultimaFuente ? `Última carga: ${ultimaFuente.tipo === 'csv' ? `CSV ${ultimaFuente.archivo || ''}` : 'manual'} · ${String(ultimaFuente.at || '').slice(0, 10)}` : '')}
              {actual && actual.corte ? ` · datos al ${Number(actual.corte.slice(8, 10))}` : ''}
              {actual && actual.notas ? <div className="resultados-nota">{actual.notas}</div> : null}
            </div>
          )}
          {mostrarCarga && <div className="panel-body">
            {!cerrado && (
              <label className="field resultados-corte" title="Hasta qué día llegan los datos que cargás (el informe de Meta del 1 a esa fecha)">
                <span>Datos del 1 al</span>
                <input className="input mono" type="date" min={`${mes}-01`} max={hoy} value={borrador.corte || hoy} style={{ colorScheme: 'dark' }}
                  onChange={e => { cambiado.current = true; setBorrador(b => ({ ...b, corte: e.target.value || hoy })); }} />
              </label>
            )}
            <div className="segmented resultados-redes" role="tablist" aria-label="Red">
              {R.REDES.map(x => (
                <button key={x.id} role="tab" aria-selected={red === x.id} className={red === x.id ? 'on' : ''} onClick={() => setRed(x.id)}>
                  {x.label}{borrador.redes[x.id] && Object.keys(borrador.redes[x.id]).some(k => k !== 'moneda' && borrador.redes[x.id][k] !== '' && borrador.redes[x.id][k] !== undefined) ? ' ·' : ''}
                </button>
              ))}
            </div>
            <div className="resultados-campos">
              {redDef.pauta && (
                <label className="field"><span>Moneda</span>
                  <select className="select" value={valorRed.moneda || 'USD'} onChange={e => setCampo(red, 'moneda', e.target.value)}>
                    {R.MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              )}
              {redDef.campos.map(campo => (
                <label key={campo} className="field" title={R.METRICAS[campo].ayuda}>
                  <span>{R.METRICAS[campo].label}</span>
                  <input className="input mono" inputMode="decimal" placeholder="—" value={valorRed[campo] ?? ''} onChange={e => setCampo(red, campo, e.target.value)} />
                </label>
              ))}
            </div>
            <div className="resultados-campos" style={{ marginTop: 14 }}>
              <label className="field" title="Lo que el cliente reporta que vendió en el mes"><span>Ventas reportadas (cantidad)</span>
                <input className="input mono" inputMode="decimal" placeholder="—" value={borrador.ventas.cantidad ?? ''} onChange={e => setVentas('cantidad', e.target.value)} /></label>
              <label className="field"><span>Ventas reportadas (monto L)</span>
                <input className="input mono" inputMode="decimal" placeholder="—" value={borrador.ventas.monto ?? ''} onChange={e => setVentas('monto', e.target.value)} /></label>
            </div>
            <label className="field" style={{ marginTop: 14 }}><span>Notas del mes</span>
              <textarea className="textarea" rows="2" value={borrador.notas} placeholder="Qué pasó este mes: campaña especial, feriado, cambio de oferta…" onChange={e => { cambiado.current = true; aMano.current = true; setBorrador(b => ({ ...b, notas: e.target.value })); }} /></label>
            {avisos.length > 0 && <div className="resultados-avisos">{avisos.map((a, i) => <div key={i}>· {a}</div>)}</div>}
            <div className="resultados-pie">
              <span className="dim mono" style={{ fontSize: 'var(--fs-s)' }}>
                {mensaje || (ultimaFuente ? `Última carga: ${ultimaFuente.tipo === 'csv' ? `CSV ${ultimaFuente.archivo || ''}` : 'manual'} · ${String(ultimaFuente.at || '').slice(0, 10)}` : 'Sin datos cargados para este mes')}
              </span>
              <button className="btn primary" onClick={guardarMes} disabled={guardando || estado === 'sin-acceso'}>{guardando ? 'Guardando…' : `Guardar ${R.nombreMes(mes)}`}</button>
            </div>
          </div>}
        </div>

        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">ÚLTIMOS 6 MESES · <span className="dim">{cliente ? cliente.nombre.toUpperCase() : ''}</span></div></div>
          <div className="panel-body" style={{ overflowX: 'auto' }}>
            <table className="resultados-tabla">
              <thead><tr><th>Mes</th><th>Inversión</th><th>Leads</th><th>Costo / lead</th><th>Alcance</th><th>Seguidores</th></tr></thead>
              <tbody>
                {historial.map(m => {
                  const r = R.resumen(docs[m] || {});
                  return (
                    <tr key={m} className={m === mes ? 'is-actual' : ''} onClick={() => setMes(m)} style={{ cursor: 'pointer' }}>
                      <td>{R.nombreMes(m)}{R.enCurso(m, hoy) && <span className="resultados-curso">{docs[m] && docs[m].corte ? `al ${Number(docs[m].corte.slice(8, 10))}` : 'en curso'}</span>}</td>
                      <td className="mono">{docs[m] ? fmtInversion(r.inversion) : <span className="dim">sin datos</span>}</td>
                      <td className="mono">{docs[m] && typeof r.resultados === 'number' ? (
                        <span className="rt-barra-celda"><span className="rt-barra" style={{ width: `${Math.max(3, Math.round((r.resultados / maxLeadsHist) * 64))}px` }} />{fmtN(r.resultados)}</span>
                      ) : (docs[m] ? '—' : '')}</td>
                      <td className="mono">{docs[m] && r.costoPorResultado !== null ? fmtPlata(r.moneda, r.costoPorResultado) : ''}</td>
                      <td className="mono">{docs[m] ? fmtN(r.alcance) : ''}</td>
                      <td className="mono">{docs[m] ? fmtN(r.seguidoresNuevos) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {!cerrado && (vista.avance || []).length > 0 && (
        <div className="panel crop" style={{ marginTop: 20 }}>
          <div className="panel-head"><div className="panel-title">AVANCE DEL MES · <span className="dim">cada carga, acumulado a su fecha</span></div></div>
          <div className="panel-body" style={{ overflowX: 'auto' }}>
            <table className="resultados-tabla">
              <thead><tr><th>Datos al</th><th>Inversión</th><th>Leads</th><th>Alcance</th><th>Seguidores nuevos</th></tr></thead>
              <tbody>
                {[...vista.avance].reverse().map(a => (
                  <tr key={a.fecha}>
                    <td className="mono">{a.fecha.slice(8, 10)}/{a.fecha.slice(5, 7)}</td>
                    <td className="mono">{a.inversion !== null && a.inversion !== undefined ? fmtPlata(a.moneda || 'USD', a.inversion) : '—'}</td>
                    <td className="mono">{fmtN(a.resultados)}</td>
                    <td className="mono">{fmtN(a.alcance)}</td>
                    <td className="mono">{fmtN(a.seguidoresNuevos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
