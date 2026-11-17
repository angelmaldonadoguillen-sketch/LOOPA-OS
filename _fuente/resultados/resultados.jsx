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
const fmtPlata = (moneda, n) => (typeof n === 'number' ? `${moneda === 'HNL' ? 'L' : '$'} ${n.toLocaleString('es-HN', { maximumFractionDigits: 2 })}` : '—');
const fmtInversion = (inv) => {
  const m = Object.keys(inv || {});
  return m.length ? m.map(k => fmtPlata(k, inv[k])).join(' + ') : '—';
};

// Cambio contra el mes anterior. `alReves`: subir es malo (costo por resultado).
function Delta({ valor, alReves = false }) {
  if (valor === null || valor === undefined) return null;
  const bueno = alReves ? valor < 0 : valor > 0;
  const color = valor === 0 ? 'var(--muted)' : bueno ? 'var(--ok)' : 'var(--danger)';
  return <div className="delta" style={{ color }}>{valor > 0 ? '▲' : valor < 0 ? '▼' : '■'} {Math.abs(valor)} % vs mes anterior</div>;
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
  const vacio = () => ({ redes: {}, ventas: {}, notas: '', anuncios: [], fuentes: [] });
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
  useEffect(() => {
    const d = docs[mes];
    const base = d ? { redes: JSON.parse(JSON.stringify(d.redes || {})), ventas: { ...(d.ventas || {}) }, notas: d.notas || '', anuncios: d.anuncios || [], fuentes: d.fuentes || [] } : vacio();
    const p = csvPendiente.current;
    if (p && p.mes === mes) {
      csvPendiente.current = null;
      cambiado.current = true;
      setBorrador(p.aplicar(base)); setAvisos(p.avisos); setMensaje(p.mensaje); setRed('meta_ads');
      return;
    }
    setBorrador(base);
    setAvisos([]); setMensaje(''); cambiado.current = false; aMano.current = false;
  }, [mes, clienteId, docs[mes]]);

  const actual = docs[mes];
  const anterior = docs[R.mesAnterior(mes)];
  const cerrado = !R.enCurso(mes, hoy);
  const vista = cambiado.current ? borrador : (actual || borrador);
  const s = R.resumen(vista);
  const c = R.comparar(vista, anterior);
  const alertas = R.alertas(vista, anterior, { cerrado });
  const historial = Array.from({ length: 6 }, (_, i) => R.sumarMeses(mes, -i));

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
    });
    const mensajeCsv = `CSV leído: ${r.anuncios.length} anuncios. Revisá y guardá.`;
    if (r.mes && r.mes !== mes) {
      const ok = await uiConfirm({ title: 'El informe es de otro mes', message: `El CSV es de ${R.nombreMes(r.mes)}. ¿Lo cargo en ${R.nombreMes(r.mes)}?`, confirmLabel: `Ir a ${R.nombreMes(r.mes)}` });
      if (!ok) return;
      csvPendiente.current = { mes: r.mes, aplicar, avisos: r.avisos, mensaje: mensajeCsv };
      setMes(r.mes);
      return;
    }
    cambiado.current = true;
    setBorrador(aplicar);
    setRed('meta_ads');
    setAvisos(r.avisos);
    setMensaje(mensajeCsv);
  };

  const guardarMes = async () => {
    if (!clienteId) return;
    const n = R.normalizar({ ...borrador, id: R.docId(clienteId, mes), clientId: clienteId, mes });
    const fuentes = [...(borrador.fuentes || [])];
    if (aMano.current || !fuentes.length) fuentes.push({ tipo: 'manual', at: new Date().toISOString() });
    setGuardando(true);
    try {
      await guardar({ id: n.id, clientId: clienteId, mes, redes: n.redes, ventas: n.ventas, notas: n.notas, anuncios: n.anuncios, fuentes: fuentes.slice(-50) });
      cambiado.current = false; aMano.current = false;
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
            <span className="resultados-mes__nombre">{R.nombreMes(mes)}{!cerrado && <span className="resultados-curso">en curso</span>}</span>
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

      <div className="kpi-grid resultados-kpis">
        <div className="kpi"><div className="label">Inversión en pauta</div><div className="value">{fmtInversion(s.inversion)}</div>{cerrado && <Delta valor={c.inversion} alReves />}</div>
        <div className="kpi accent"><div className="label">Mensajes + leads</div><div className="value">{fmtN(s.resultados)}</div>{cerrado && <Delta valor={c.resultados} />}</div>
        <div className="kpi"><div className="label">Costo por resultado</div><div className="value">{s.costoPorResultado !== null ? fmtPlata(s.moneda, s.costoPorResultado) : '—'}</div>{cerrado && <Delta valor={c.costoPorResultado} alReves />}</div>
        <div className="kpi"><div className="label">Alcance (sumado)</div><div className="value">{fmtN(s.alcance)}</div>{cerrado && <Delta valor={c.alcance} />}</div>
        <div className="kpi"><div className="label">Seguidores nuevos</div><div className="value">{fmtN(s.seguidoresNuevos)}</div>{cerrado && <Delta valor={c.seguidoresNuevos} />}</div>
        <div className="kpi"><div className="label">Ventas reportadas</div><div className="value">{fmtN(s.ventas)}</div>{cerrado && <Delta valor={c.ventas} />}</div>
      </div>

      <div className="metrics-grid-2">
        <div className="panel crop">
          <div className="panel-head" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="panel-title">CARGAR · <span className="dim">{R.nombreMes(mes).toUpperCase()}</span></div>
            <label className="btn sm" style={{ marginLeft: 'auto', cursor: 'pointer' }} title="Administrador de anuncios › Exportar › CSV, con el rango del 1 al último día del mes">
              <Icon name="dl" size={11} /> Importar CSV de Meta Ads
              <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => { importarCsv(e.target.files && e.target.files[0]); e.target.value = ''; }} />
            </label>
          </div>
          <div className="panel-body">
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
          </div>
        </div>

        <div className="panel crop">
          <div className="panel-head"><div className="panel-title">ÚLTIMOS 6 MESES · <span className="dim">{cliente ? cliente.nombre.toUpperCase() : ''}</span></div></div>
          <div className="panel-body" style={{ overflowX: 'auto' }}>
            <table className="resultados-tabla">
              <thead><tr><th>Mes</th><th>Inversión</th><th>Mensajes + leads</th><th>Costo / resultado</th><th>Alcance</th><th>Seguidores</th></tr></thead>
              <tbody>
                {historial.map(m => {
                  const r = R.resumen(docs[m] || {});
                  return (
                    <tr key={m} className={m === mes ? 'is-actual' : ''} onClick={() => setMes(m)} style={{ cursor: 'pointer' }}>
                      <td>{R.nombreMes(m)}{R.enCurso(m, hoy) && <span className="resultados-curso">en curso</span>}</td>
                      <td className="mono">{docs[m] ? fmtInversion(r.inversion) : <span className="dim">sin datos</span>}</td>
                      <td className="mono">{docs[m] ? fmtN(r.resultados) : ''}</td>
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

      {(vista.anuncios || []).length > 0 && (
        <div className="panel crop" style={{ marginTop: 20 }}>
          <div className="panel-head"><div className="panel-title">ANUNCIOS DEL MES · <span className="dim">{vista.anuncios.length} (sólo lo de este mes)</span></div></div>
          <div className="panel-body" style={{ overflowX: 'auto' }}>
            <table className="resultados-tabla">
              <thead><tr><th>Anuncio</th><th>Inversión</th><th>Impresiones</th><th>Clics</th><th>Mensajes</th><th>Leads</th></tr></thead>
              <tbody>
                {[...vista.anuncios].sort((a, b) => (b.inversion || 0) - (a.inversion || 0)).map(a => (
                  <tr key={a.id}>
                    <td>{a.nombre}</td>
                    <td className="mono">{fmtPlata((vista.redes.meta_ads || {}).moneda || 'USD', a.inversion)}</td>
                    <td className="mono">{fmtN(a.impresiones)}</td>
                    <td className="mono">{fmtN(a.clics)}</td>
                    <td className="mono">{fmtN(a.mensajes)}</td>
                    <td className="mono">{fmtN(a.leads)}</td>
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
