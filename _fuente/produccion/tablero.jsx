// ═══════════════════════════════════════════════════════════════
// LOOPA OS · Producción — tablero por estado (Fase 2, tanda 3)
//
// Columnas = configuración del tablero (kanban_columns). Una tarea con un
// estado que no está en las columnas no desaparece: boardColumns agrega su
// columna al final, como FRAME. Las tarjetas se abren en la ficha editable;
// el estado se cambia ahí o con las flechas de la tarjeta (teclado incluido).
// ═══════════════════════════════════════════════════════════════

function ProduccionTablero({ tareas, columnas, hoy, onAbrir, onMover }) {
  // Tras mover con las flechas la tarjeta se vuelve a montar en otra
  // columna: el foco se lleva a la misma flecha (o a la tarjeta) para que el
  // teclado no pierda el lugar.
  const [foco, setFoco] = useState(null); // { id, lado }
  useEffect(() => {
    if (!foco) return;
    const item = document.querySelector(`.pr-col-item[data-id="${CSS.escape(foco.id)}"]`);
    if (!item) return;
    const flechas = item.querySelectorAll('.pr-mover .icon-btn');
    const preferida = flechas[foco.lado === 'izq' ? 0 : 1];
    const destino = preferida && !preferida.disabled ? preferida : ([...flechas].find(b => !b.disabled) || item.querySelector('.pr-card'));
    if (destino) destino.focus();
    setFoco(null);
  }, [foco, tareas]);
  const mover = (t, status, lado) => { const r = onMover(t, status); if (r && r.ok) setFoco({ id: t.id, lado }); };
  const normalizadas = useMemo(() => tareas.map(t => LoopaProduccion.normalizeTask(t, hoy)), [tareas, hoy]);
  // Lo archivado no ocupa el tablero (FRAME tampoco lo muestra como columna).
  const visibles = normalizadas.filter(t => t.status !== 'archived');
  const cols = LoopaProduccion.boardColumns(columnas, visibles).filter(c => c.id !== 'archived');
  const orden = cols.map(c => c.id);
  return (
    <div className="pr-tablero" role="list" aria-label="Tablero de producción">
      {cols.map((c, i) => {
        const lista = visibles.filter(t => t.status === c.id)
          .sort((a, b) => LoopaProduccion.calendarDateOf(a).localeCompare(LoopaProduccion.calendarDateOf(b)) || a.id.localeCompare(b.id));
        return (
          <section key={c.id} className="pr-col" role="listitem" aria-label={`${c.label}: ${lista.length} tareas`}>
            <header className="pr-col-cab">
              <span>{c.label}{!columnas.some(x => x.id === c.id) ? ' · fuera de las columnas' : ''}</span>
              <span className="mono dim">{lista.length}</span>
            </header>
            <div className="pr-col-lista">
              {lista.length === 0 && <div className="pr-col-vacia">Sin tareas</div>}
              {lista.map(t => (
                <div key={t.id} className="pr-col-item" data-id={t.id}>
                  <ProdTarjeta t={t} hoy={hoy} columnas={columnas} onAbrir={onAbrir} />
                  <div className="pr-mover">
                    <button className="icon-btn" disabled={i === 0} onClick={() => mover(t, orden[i - 1], 'izq')} aria-label={`Mover «${t.title}» a ${i > 0 ? cols[i - 1].label : ''}`}><Icon name="arrow-l" size={11} /></button>
                    <button className="icon-btn" disabled={i === cols.length - 1} onClick={() => mover(t, orden[i + 1], 'der')} aria-label={`Mover «${t.title}» a ${i < cols.length - 1 ? cols[i + 1].label : ''}`}><Icon name="arrow-r" size={11} /></button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
