// ═══════════════════════ VISTA «VENTAS» ═══════════════════════
// Etapa «experiencia»: el calendario agrupado por lo que se vendió. Una fila
// por producto vendido (cliente · producto · venta) con su rango —del inicio
// al fin del paquete— y cada entrega como un punto en su fecha. Todas las
// filas comparten la misma línea de tiempo, con «hoy» marcado.

const VL_DIA_PX = 26;
const vlDia = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const vlYmd = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const vlHoy = () => { const d = new Date(); return vlDia(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); };
const VL_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Agrupa las tarjetas que vienen de LOOPA por venta y producto (línea).
function agruparVentas(projects, columns) {
  const hechas = new Set((columns || []).filter(c => c.isDone).map(c => c.id));
  if (!hechas.size) hechas.add('delivered');
  const grupos = new Map();
  projects.forEach(p => {
    if (p.sourceSystem !== 'loopa' || !p.sourceSaleId || !p.sessionDate) return;
    const linea = (p.sourceLineIds && p.sourceLineIds[0]) || '';
    const key = `${p.sourceSaleId}|${linea}`;
    if (!grupos.has(key)) {
      const producto = (p.tags || []).find(t => t !== 'loopa') || '';
      grupos.set(key, { key, venta: p.sourceSaleNumber, cliente: p.client || '', producto, tareas: [], cancelada: p.sourceSaleStatus === 'cancelled' });
    }
    grupos.get(key).tareas.push({ ...p, hecha: hechas.has(p.status) });
  });
  return [...grupos.values()].map(g => {
    g.tareas.sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0));
    const inicios = g.tareas.map(t => t.startDate || t.sessionDate).sort();
    g.inicio = inicios[0];
    g.fin = g.tareas[g.tareas.length - 1].sessionDate;
    g.hechas = g.tareas.filter(t => t.hecha).length;
    g.terminada = g.hechas === g.tareas.length;
    return g;
  }).sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : (a.venta || 0) - (b.venta || 0)));
}

const VentasView = ({ projects, columns, onOpenProject }) => {
  const [verTerminadas, setVerTerminadas] = useState(false);
  const scrollRef = useRef(null);
  const todos = useMemo(() => agruparVentas(projects, columns), [projects, columns]);
  const filas = todos.filter(g => verTerminadas || !g.terminada);
  const hoy = vlHoy();
  // Ventana común: desde el primer inicio (o una semana antes de hoy) hasta el
  // último fin (o dos meses), con un poco de aire a cada lado.
  const desde = Math.min(hoy - 7, ...filas.map(g => vlDia(g.inicio))) - 2;
  const hasta = Math.max(hoy + 60, ...filas.map(g => vlDia(g.fin))) + 3;
  const dias = hasta - desde + 1;
  const x = (ymd) => (vlDia(ymd) - desde) * VL_DIA_PX;

  // Al abrir, la línea de tiempo arranca cerca de hoy.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, (hoy - desde - 5) * VL_DIA_PX);
  }, [filas.length > 0]);

  if (!todos.length) {
    return (
      <div className="vl-vacio">
        <Icon name="layers" size={22} />
        <b>Todavía no hay ventas en Producción</b>
        <span>Cuando vendas un producto con ficha, aparece acá con todas sus entregas en el tiempo.</span>
      </div>
    );
  }
  const dia = (n) => { const d = new Date(n * 864e5); return { d: d.getUTCDate(), m: d.getUTCMonth(), y: d.getUTCFullYear(), w: d.getUTCDay() }; };
  return (
    <div className="vl">
      <div className="vl-barra">
        <span className="vl-resumen">{filas.length} {filas.length === 1 ? 'producto en curso' : 'productos en curso'}</span>
        <button className={`vl-chip ${verTerminadas ? 'on' : ''}`} onClick={() => setVerTerminadas(v => !v)}>
          {verTerminadas ? 'Ocultar terminadas' : `Ver terminadas${todos.length - filas.length ? ` (${todos.length - filas.length})` : ''}`}
        </button>
        <button className="vl-chip" onClick={() => { if (scrollRef.current) scrollRef.current.scrollTo({ left: Math.max(0, (hoy - desde - 5) * VL_DIA_PX), behavior: 'smooth' }); }}>Hoy</button>
        <span className="vl-leyenda"><i className="vl-p" /> pendiente <i className="vl-p hecha" /> hecha <i className="vl-p tarde" /> atrasada</span>
      </div>
      <div className="vl-cuerpo">
        <div className="vl-nombres">
          <div className="vl-cab-nombre">Venta · producto</div>
          {filas.map(g => (
            <div key={g.key} className={`vl-nombre ${g.cancelada ? 'cancelada' : ''}`} title={`${g.cliente} · ${g.producto}`}>
              <div className="vl-cliente">{g.cliente}</div>
              <div className="vl-prod">{g.producto || 'Producto'}{g.venta ? <span> · #{g.venta}</span> : null}</div>
              <div className="vl-avance"><span style={{ width: `${(g.hechas / g.tareas.length) * 100}%` }} /></div>
              <div className="vl-cuenta">{g.hechas}/{g.tareas.length}{g.cancelada ? ' · venta cancelada' : ''}</div>
            </div>
          ))}
        </div>
        <div className="vl-tiempo" ref={scrollRef}>
          <div style={{ width: dias * VL_DIA_PX, position: 'relative' }}>
            <div className="vl-cab">
              {Array.from({ length: dias }, (_, i) => {
                const f = dia(desde + i);
                return (
                  <div key={i} className={`vl-dia ${f.w === 0 || f.w === 6 ? 'finde' : ''} ${desde + i === hoy ? 'hoy' : ''}`} style={{ width: VL_DIA_PX }}>
                    {(f.d === 1 || i === 0) && <span className="vl-mes">{VL_MESES[f.m]} {String(f.y).slice(2)}</span>}
                    <span className="vl-num">{f.d}</span>
                  </div>
                );
              })}
            </div>
            <div className="vl-hoy" style={{ left: (hoy - desde) * VL_DIA_PX + VL_DIA_PX / 2 }} />
            {filas.map(g => (
              <div key={g.key} className="vl-fila">
                <div className="vl-rango" style={{ left: x(g.inicio) + VL_DIA_PX / 2, width: Math.max(VL_DIA_PX / 2, x(g.fin) - x(g.inicio)) }} />
                {g.tareas.map(t => {
                  // Color del tipo; si el tablero no lo trae, el de FRAME por defecto.
                  const propio = (window.FRAME_CUSTOM_TYPES || []).find(x => x.id === t.type);
                  const base = PROJECT_TYPES.find(x => x.id === t.type);
                  const tono = propio && propio.color ? themed(propio).color : base ? themed(base).color : getType(t.type).color;
                  const tarde = !t.hecha && vlDia(t.sessionDate) < hoy;
                  return (
                    <button key={t.id} className={`vl-punto ${t.hecha ? 'hecha' : ''} ${tarde ? 'tarde' : ''}`}
                      style={{ left: x(t.sessionDate) + VL_DIA_PX / 2, '--tono': tono || 'var(--text-muted)' }}
                      title={`${t.title} · ${t.sessionDate}${t.hecha ? ' · hecha' : tarde ? ' · atrasada' : ''}`}
                      onClick={() => onOpenProject(t.id)} />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
