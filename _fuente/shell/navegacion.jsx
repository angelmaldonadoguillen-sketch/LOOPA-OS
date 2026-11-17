// ═══════════════════════════════════════════════════════════════
// LOOPA OS · navegación unificada (Fase 2, tanda 2)
//
// Sólo se usa con la bandera de Producción: sin ella, app.jsx dibuja su menú
// original y nada cambia. Agrupa los módulos en Comercial / Producción /
// Sistema. En el celular muestra los cuatro principales y un «Más» con el
// resto, en lugar de una barra de ocho botones donde las etiquetas se pisan.
// ═══════════════════════════════════════════════════════════════

const NAV_GRUPOS = [
  { id: 'comercial', label: 'Comercial', ids: ['nueva', 'ventas', 'servicios', 'clientes'] },
  { id: 'produccion', label: 'Producción', ids: ['produccion', 'mis-tareas', 'equipo', 'papelera'] },
  { id: 'sistema', label: 'Sistema', ids: ['metricas', 'gastos', 'config'] },
];
const NAV_PRINCIPALES = ['nueva', 'ventas', 'produccion', 'clientes'];

function NavAgrupada({ modules, route, onGo }) {
  const [masAbierto, setMasAbierto] = useState(false);
  const masBtn = useRef(null);
  const hoja = useRef(null);
  const byId = Object.fromEntries(modules.map(m => [m.id, m]));
  const secundarios = modules.filter(m => !NAV_PRINCIPALES.includes(m.id));
  const enMas = secundarios.some(m => m.id === route);
  // Hoja «Más»: diálogo simple. El foco entra al abrir, Tab no sale de la
  // hoja, Escape la cierra y devuelve el foco a «Más». Si la pantalla se
  // agranda (ya no hay barra inferior), se cierra sola.
  useEffect(() => {
    if (!masAbierto) return undefined;
    const primero = hoja.current && hoja.current.querySelector('button');
    if (primero) primero.focus();
    const cerrar = () => { setMasAbierto(false); if (masBtn.current) masBtn.current.focus(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); cerrar(); return; }
      if (e.key !== 'Tab' || !hoja.current) return;
      const focos = [...hoja.current.querySelectorAll('button')];
      const a = focos[0], z = focos[focos.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    const mq = window.matchMedia('(min-width: 641px)');
    const onMq = (ev) => { if (ev.matches) setMasAbierto(false); };
    window.addEventListener('keydown', onKey, true);
    mq.addEventListener('change', onMq);
    return () => { window.removeEventListener('keydown', onKey, true); mq.removeEventListener('change', onMq); };
  }, [masAbierto]);
  const ir = (id) => { setMasAbierto(false); onGo(id); };

  const item = (m, extra = '') => (
    <button key={m.id} className={`nav-item ${extra} ${route === m.id ? 'active' : ''}`} onClick={() => ir(m.id)} title={m.label} aria-current={route === m.id ? 'page' : undefined}>
      <Icon name={m.icon} size={15} />
      <span>{m.label}</span>
      <span className="nav-mobile-label">{m.label.split(' ')[0]}</span>
    </button>
  );

  return (
    <nav className="nav nav-agrupada" style={{ marginTop: 8 }} aria-label="Módulos">
      {NAV_GRUPOS.map(g => {
        const items = g.ids.map(id => byId[id]).filter(Boolean);
        if (!items.length) return null;
        return (
          <React.Fragment key={g.id}>
            <div className="nav-grupo" aria-hidden="true">{g.label}</div>
            {items.map(m => item(m, NAV_PRINCIPALES.includes(m.id) ? '' : 'nav-secundario'))}
          </React.Fragment>
        );
      })}
      <button ref={masBtn} className={`nav-item nav-mas ${enMas ? 'active' : ''}`} onClick={() => setMasAbierto(v => !v)} aria-expanded={masAbierto} aria-controls="nav-mas-hoja" title="Más">
        <Icon name="list" size={15} />
        <span className="nav-mobile-label">Más</span>
      </button>
      {masAbierto && (
        <div className="nav-mas-fondo" onMouseDown={() => setMasAbierto(false)}>
          <div ref={hoja} id="nav-mas-hoja" className="nav-mas-hoja" role="dialog" aria-modal="true" aria-label="Más módulos" onMouseDown={e => e.stopPropagation()}>
            {secundarios.map(m => (
              <button key={m.id} className={`nav-mas-item ${route === m.id ? 'on' : ''}`} aria-current={route === m.id ? 'page' : undefined} onClick={() => ir(m.id)}>
                <Icon name={m.icon} size={15} /> <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
