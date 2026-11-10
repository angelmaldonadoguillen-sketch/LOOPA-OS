// ─────────────────────────────────────────────────────────────────
// PORTAL DE CLIENTE — proyección pública, nunca el documento interno
// ─────────────────────────────────────────────────────────────────

const createClientPortalToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

const clientPortalUrl = (token) => {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('portal', token);
  return url.toString();
};

// `columns` son las columnas del tablero. No se proyectan al documento —la
// forma pública no cambia— pero sirven para que una tarea sin checklist no
// informe 0%: el avance sale de en qué fase está.
const buildClientPortalDocument = (client, projects, workspace, published = client.portalPublished === true, columns = []) => {
  const name = String(client.name || '').trim().toLowerCase();

  // Un checklist vacío no significa "no se empezó", significa que el creativo
  // no lo usa. Informar 0% en una tarea que va por la mitad le dice al cliente
  // exactamente lo contrario de lo que pasa.
  const columnas = (columns && columns.length ? columns : STATUSES);
  const fases = columnas.map(c => c.id);
  const avancePorFase = (project) => {
    if (isClosed(project)) return 100;
    const i = fases.indexOf(project.status);
    if (i < 0 || fases.length < 2) return 0;
    // Entrar en una fase no es haberla terminado: se informa el piso de la
    // fase, nunca de más. La última no llega a 100 hasta que se entrega.
    return Math.round((i / fases.length) * 100);
  };

  // Las fases viajan DENTRO de cada tarea, no como clave nueva del documento.
  // La regla valida las claves de arriba con hasOnly y limita tasks a una
  // lista de 100, pero no mira la forma de cada elemento. Así el portal puede
  // dibujar la línea de proceso sin publicar reglas nuevas — y sin el riesgo
  // de que un documento con una clave de más quede rechazado en silencio.
  const etiquetasFases = columnas.map(c => String(c.label || c.id || '')).slice(0, 12);

  // La imagen de la tarjeta. Primero la portada que puso el creativo; si no
  // hay, la primera imagen que ya compartió. Un trabajo audiovisual se
  // reconoce por la imagen antes que por el título, y en una lista de seis
  // trabajos es la diferencia entre buscar y ver.
  //
  // Sólo https: una portada de color o una ruta interna no son una imagen que
  // el cliente pueda abrir.
  // Compartido salvo que el creativo lo apague, igual que las tareas con
  // clientVisible. Sin el campo se comparte: los recursos viejos no traen
  // ninguno y no tendrían por qué quedar ocultos.
  const compartido = item => item.clientVisible !== false;

  // Una imagen pegada dentro del brief vive en frame-descriptions. Aunque un
  // documento antiguo la haya guardado también entre los recursos o como
  // portada, sigue siendo contenido editorial: nunca se publica como archivo
  // ni se usa para identificar la tarea en el portal del cliente.
  const esImagenDelBrief = item => {
    const url = String(typeof item === 'string' ? item : item?.url || '');
    return /(?:\/|%2f)frame-descriptions(?:\/|%2f)/i.test(url);
  };

  const portadaDe = (project) => {
    const cover = project.cover;
    if (cover && cover.type === 'image' && /^https:\/\//i.test(String(cover.value || '')) && !esImagenDelBrief(String(cover.value))) {
      // Si esa imagen es un recurso que el creativo apagó, no se usa de
      // portada: apagarla y verla igual en la tarjeta sería peor que no
      // tener el interruptor.
      const oculta = (project.deliverables || []).some(item =>
        item.url === cover.value && !compartido(item));
      if (!oculta) return String(cover.value);
    }
    const disponible = (project.deliverables || []).find(item =>
      compartido(item) && !esImagenDelBrief(item) && item.kind === 'photos' && /^https:\/\//i.test(String(item.url || '')));
    return disponible ? String(disponible.url) : '';
  };
  const visible = (projects || [])
    // Visible por defecto: al publicar un cliente entran todas sus tareas.
    // Sólo se excluye una cuando el creativo lo decide explícitamente.
    .filter(project => String(project.client || '').trim().toLowerCase() === name && project.clientVisible !== false)
    .map(project => {
      const checklist = project.checklist || [];
      const completed = checklist.filter(item => item.done).length;
      return {
        id: String(project.id),
        title: String(project.title || ''),
        type: getType(project.type).label,
        // El icono y el color del tipo, para que la pastilla del portal sea la
        // misma que ve el creativo y no una etiqueta gris cualquiera.
        typeIcon: String(getType(project.type).icon || 'folder'),
        typeColor: String(getType(project.type).color || 'var(--resource-neutral)').slice(0, 64),
        status: getStatus(project.status).label,
        statusId: String(project.status || ''),
        startDate: String(project.startDate || ''),
        deadline: String(project.deadline || ''),
        progress: checklist.length ? Math.round((completed / checklist.length) * 100) : avancePorFase(project),
        phases: etiquetasFases,
        // Una tarea entregada tiene todas las fases cumplidas, esté en la
        // columna que esté. -1 cuando el estado no pertenece al tablero
        // (columnas viejas o borradas): ahí no se dibuja la línea en vez de
        // dibujarla mal.
        phaseIndex: isClosed(project) ? etiquetasFases.length : fases.indexOf(project.status),
        cover: portadaDe(project),
        deliverables: (project.deliverables || []).filter(item => compartido(item) && !esImagenDelBrief(item)).map(item => ({
          name: String(item.name || 'Entregable'),
          kind: String(item.kind || 'file'),
          url: /^https:\/\//i.test(String(item.url || '')) ? String(item.url) : '',
        })).slice(0, 20),
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  return {
    workspaceId: String(client.workspaceId || workspace?.id || ''),
    clientId: String(client.id),
    clientName: String(client.name || 'Cliente'),
    clientInitials: String(client.initials || String(client.name || 'Cliente').slice(0, 2).toUpperCase()).slice(0, 4),
    clientColor: String(client.color || 'var(--resource-blue)').slice(0, 64),
    studioName: String(workspace?.name || 'LOOPA'),
    studioAvatar: String(workspace?.members?.[workspace?.ownerId]?.avatar || ''),
    published: published === true,
    updatedAt: new Date().toISOString(),
    taskIds: published ? visible.slice(0, 100).map(task => task.id) : [],
    tasks: published ? visible.slice(0, 100) : [],
  };
};

// ── Línea de proceso ─────────────────────────────────────────────
// Contesta las tres preguntas del cliente de un vistazo: dónde va, qué ya
// pasó y qué falta. Un porcentaje solo dice "62%" y no significa nada para
// quien no conoce el trabajo por dentro.
//
// Son segmentos y no puntos con etiqueta: cinco etiquetas no entran en 375px
// sin abreviarlas hasta volverlas ilegibles. El nombre de la fase actual va
// aparte, en texto, que es el único que importa leer.
const PhaseLine = ({ phases, phaseIndex, size = 'sm' }) => {
  if (!Array.isArray(phases) || phases.length < 2) return null;
  const i = Number(phaseIndex);
  if (!Number.isFinite(i) || i < 0) return null;
  const alto = size === 'lg' ? 5 : 3;

  return (
    <div className="flex items-center gap-1" role="img"
         aria-label={`Fase ${Math.min(i + 1, phases.length)} de ${phases.length}`}>
      {phases.map((label, index) => {
        const cumplida = index < i;
        const actual   = index === i;
        return (
          <span key={index} className="flex-1 rounded-full transition-[background] duration-500"
                title={label}
                style={{
                  height: actual ? alto + 2 : alto,
                  background: cumplida ? 'var(--resource-green)'
                            : actual   ? 'var(--accent)'
                            : 'var(--surface-3)',
                }} />
        );
      })}
    </div>
  );
};

// La pastilla del tipo, con el mismo icono y color que ve el creativo. Una
// etiqueta gris que dice "Post" obliga a leerla; con su color se reconoce.
const TypeChip = ({ task }) => {
  if (!task.type) return null;
  const color = task.typeColor || 'var(--resource-neutral)';
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium"
          style={{ color, background: colorAlpha(color, 14), boxShadow: `inset 0 0 0 1px ${colorAlpha(color, 30)}` }}>
      <Icon name={task.typeIcon || 'folder'} size={11} />
      {task.type}
    </span>
  );
};

// El nombre de la fase donde está, y cuántas quedan. "Edición · 3 de 5" le
// dice al cliente que faltan dos pasos, no sólo que estamos editando.
const phaseText = (task) => {
  const phases = Array.isArray(task.phases) ? task.phases : [];
  const i = Number(task.phaseIndex);
  if (!phases.length || !Number.isFinite(i) || i < 0) return task.status;
  if (i >= phases.length) return task.status;
  return `${phases[i]} · ${i + 1} de ${phases.length}`;
};

const ClientPortal = ({ token }) => {
  const [portal, setPortal] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [unavailable, setUnavailable] = React.useState(false);
  const [openTask, setOpenTask] = React.useState(null);
  // Visor a tamaño completo. Abrir la imagen en otra pestaña deja al cliente
  // fuera del seguimiento y con una URL de Storage en la barra; acá se mira y
  // se vuelve con Escape.
  const [lightbox, setLightbox] = React.useState('');

  React.useEffect(() => {
    if (!lightbox) return;
    const esc = e => { if (e.key === 'Escape') setLightbox(''); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [lightbox]);

  // Cuántos comentarios tiene cada trabajo. Es una sola escucha para todo el
  // portal, no una por tarjeta: los comentarios ya viven en una subcolección
  // del mismo documento y el cliente ya tiene permiso de leerlos.
  const [conteoComentarios, setConteoComentarios] = React.useState({});
  React.useEffect(() => {
    if (!/^[a-f0-9]{48}$/.test(token || '')) return;
    const unsub = window.db.collection('frame_client_portals').doc(token).collection('comments')
      .onSnapshot(snap => {
        const cuenta = {};
        snap.docs.forEach(doc => {
          const id = doc.data()?.projectId;
          if (id) cuenta[id] = (cuenta[id] || 0) + 1;
        });
        setConteoComentarios(cuenta);
      }, () => setConteoComentarios({}));
    return () => unsub();
  }, [token]);

  React.useEffect(() => {
    if (!/^[a-f0-9]{48}$/.test(token || '')) { setUnavailable(true); setLoading(false); return; }
    const unsub = window.db.collection('frame_client_portals').doc(token).onSnapshot(doc => {
      if (!doc.exists || doc.data()?.published !== true) setUnavailable(true);
      else { setPortal(doc.data()); setUnavailable(false); }
      setLoading(false);
    }, () => { setUnavailable(true); setLoading(false); });
    return () => unsub();
  }, [token]);


  if (loading) return <LoadingScreen />;
  if (unavailable || !portal) return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="surf-panel max-w-md w-full p-8 text-center">
        <FrameMark size={40} className="mx-auto mb-4 block" />
        <h1 className="font-display text-xl font-bold mb-2">Enlace no disponible</h1>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>Este seguimiento no existe o el estudio dejó de compartirlo. Solicitá un enlace actualizado.</p>
      </div>
    </div>
  );

  const tasks = portal.tasks || [];
  const entregada = task => task.progress >= 100 || ['delivered', 'archived'].includes(task.statusId);
  const completed = tasks.filter(entregada).length;
  const overall = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) / tasks.length) : 0;

  // ── Lo que el cliente vino a preguntar ──────────────────────────
  // "¿Cuándo me entregás?" se responde arriba de todo y sin tocar nada.
  //
  // Acá hubo un calendario mensual y se quitó a propósito: contestaba "cómo
  // está repartido el mes", que es la pregunta de quien planifica el trabajo,
  // no la de quien lo espera. Además obligaba a arrastrar 3,3 pantallas en un
  // teléfono. La línea de proceso de cada trabajo dice lo mismo y mejor.
  const pendientes = tasks.filter(t => !entregada(t))
    .sort((a, b) => (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31'));
  const proxima = pendientes[0] || null;

  // Entregadas al final: ya no son noticia, pero sirven de historial.
  const enOrden = [...pendientes, ...tasks.filter(entregada)
    .sort((a, b) => (b.deadline || '').localeCompare(a.deadline || ''))];

  // Días hasta la entrega, en fechas locales. Se comparan strings AAAA-MM-DD
  // para no arrastrar la hora ni la zona horaria.
  const diasHasta = (iso) => {
    if (!iso) return null;
    const hoy = new Date(localISO(new Date(TODAY)) + 'T00:00');
    const fin = new Date(iso + 'T00:00');
    return Math.round((fin - hoy) / 86400000);
  };

  // El texto que el cliente lee. Es deliberadamente literal: el valor de esto
  // es que la fecha no se pueda leer de dos maneras.
  const cuando = (iso) => {
    const d = diasHasta(iso);
    if (d === null) return { texto: 'Sin fecha', color: 'var(--text-muted)' };
    if (d < 0)  return { texto: Math.abs(d) === 1 ? '1 día de atraso' : Math.abs(d) + ' días de atraso', color: 'var(--danger)' };
    if (d === 0) return { texto: 'Hoy', color: 'var(--warn)' };
    if (d === 1) return { texto: 'Mañana', color: 'var(--warn)' };
    return { texto: 'En ' + d + ' días', color: 'var(--text-dim)' };
  };

  return (
    // body está bloqueado por la aplicación principal. El portal necesita su
    // propio viewport desplazable; min-height lo hacía crecer fuera de una
    // página que no podía scrollear.
    <div className="h-screen overflow-y-auto overscroll-contain portal-page-scroll" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <header className="px-5 sm:px-8 py-5 border-b border-app" style={{ background: 'var(--surface)' }}>
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* La foto del estudio va acá, que es donde identifica a quien
                comparte. Antes se usaba para firmar cada comentario del
                equipo, y le ponía la cara del dueño del tablero a lo que
                escribía cualquier otro. */}
            {portal.studioAvatar
              ? <img src={portal.studioAvatar} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
              : <div className="w-9 h-9 rounded-lg flex items-center justify-center font-display font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}>{String(portal.studioName || 'F').trim().slice(0, 1).toUpperCase()}</div>}
            <div className="min-w-0"><div className="font-semibold truncate">{portal.studioName}</div><div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Seguimiento compartido</div></div>
          </div>
          <div className="text-[11px] tnum" style={{ color: 'var(--text-muted)' }}>Actualizado {relativeTime(portal.updatedAt)}</div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-5 sm:px-8 py-8 sm:py-12">
        <div className="mb-8 max-w-5xl">
          <h1 className="font-display text-3xl sm:text-5xl font-bold balance mb-6">{portal.clientName}</h1>

          {/* Próxima entrega: la respuesta, antes que cualquier otra cosa. */}
          {proxima ? (
            <div className="surf-panel p-5 sm:p-7">
              <div className="ui-section-label mb-3">Próxima entrega</div>
              <h2 className="font-display text-xl sm:text-3xl font-bold pretty mb-4">{proxima.title}</h2>

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-5">
                <span className="font-display text-2xl sm:text-3xl font-bold tnum">
                  {proxima.deadline ? fmtDateLong(proxima.deadline) : 'Sin fecha'}
                </span>
                <span className="text-[13px] font-semibold" style={{ color: cuando(proxima.deadline).color }}>
                  {cuando(proxima.deadline).texto}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-[12px] font-medium">{phaseText(proxima)}</span>
                <span className="text-[12px] tnum" style={{ color: 'var(--text-muted)' }}>{proxima.progress}%</span>
              </div>
              {proxima.phases?.length > 1 && Number(proxima.phaseIndex) >= 0 ? (
                <PhaseLine phases={proxima.phases} phaseIndex={proxima.phaseIndex} size="lg" />
              ) : (
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                  <div className="h-full rounded-full transition-[width] duration-500"
                       style={{ width: `${proxima.progress}%`, background: 'var(--accent)' }} />
                </div>
              )}

              <button onClick={() => setOpenTask(proxima)}
                      className="mt-5 text-[13px] font-semibold inline-flex items-center gap-1.5"
                      style={{ color: 'var(--accent-dim)' }}>
                Ver detalle <Icon name="chevronRight" size={13} />
              </button>
            </div>
          ) : (
            <div className="surf-panel p-5 sm:p-7">
              <div className="ui-section-label mb-2">Estado</div>
              <h2 className="font-display text-xl sm:text-2xl font-bold">
                {tasks.length ? 'Todo entregado' : 'Todavía no hay trabajos publicados'}
              </h2>
              {tasks.length > 0 && (
                <p className="text-[13px] mt-2" style={{ color: 'var(--text-muted)' }}>
                  {completed} de {tasks.length} trabajos completados.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Los trabajos, en el orden en que llegan. Una lista se lee de un
            vistazo en el teléfono; una grilla de un mes no. */}
        {tasks.length > 0 && (
          <section className="mb-10">
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <h2 className="font-display text-lg font-bold">Tus trabajos</h2>
              <span className="text-[11px] tnum" style={{ color: 'var(--text-muted)' }}>
                {completed} de {tasks.length} · {overall}% general
              </span>
            </div>
            <div className="space-y-2">
              {enOrden.map(task => {
                const listo = entregada(task);
                const c = cuando(task.deadline);
                return (
                  <button key={task.id} onClick={() => setOpenTask(task)}
                          className="w-full text-left surf surf-hover p-4">
                    <div className="flex items-start gap-3.5">
                      {/* La miniatura antes de abrir nada: en una lista de
                          trabajos audiovisuales, la imagen identifica más
                          rápido que el título. */}
                      {task.cover && (
                        <img src={task.cover} alt="" loading="lazy" referrerPolicy="no-referrer"
                             className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                             style={{ background: 'var(--surface-3)' }} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-semibold truncate">{task.title}</div>
                        <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          <span className="truncate">{listo ? task.status : phaseText(task)}</span>
                          {task.deadline && <span className="flex-shrink-0">· {fmtDate(task.deadline)}</span>}
                        </div>
                        {/* Tipo, y qué hay adentro sin tener que entrar. Los
                            contadores sólo aparecen cuando hay algo: un cero
                            ocupa el mismo lugar y no informa nada. */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <TypeChip task={task} />
                          {task.deliverables?.length > 0 && (
                            <span className="flex items-center gap-1 text-[11px] tnum" style={{ color: 'var(--text-muted)' }}
                                  title={task.deliverables.length + ' recurso(s) compartido(s)'}>
                              <Icon name="paperclip" size={11} />{task.deliverables.length}
                            </span>
                          )}
                          {conteoComentarios[task.id] > 0 && (
                            <span className="flex items-center gap-1 text-[11px] tnum" style={{ color: 'var(--text-muted)' }}
                                  title={conteoComentarios[task.id] + ' comentario(s)'}>
                              <Icon name="message" size={11} />{conteoComentarios[task.id]}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {listo ? (
                          <span className="text-[12px] font-semibold" style={{ color: 'var(--resource-green)' }}>Entregado</span>
                        ) : (
                          <div className="text-[12px] font-semibold" style={{ color: c.color }}>{c.texto}</div>
                        )}
                      </div>
                    </div>
                    {/* La línea va abajo y a lo ancho: es lo que se mira de
                        reojo al recorrer la lista. */}
                    <div className="mt-3">
                      <PhaseLine phases={task.phases} phaseIndex={task.phaseIndex} />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

      </main>
      {openTask && (
        <div className="fixed inset-0 z-50 backdrop flex items-center justify-center p-4" onClick={() => setOpenTask(null)}>
          <div className="surf-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={event => event.stopPropagation()}>
            <div className="p-5 sm:p-7">
              <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 mb-2.5 flex-wrap"><TypeChip task={openTask} /><span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{openTask.status}</span></div><h2 className="font-display text-2xl font-bold pretty">{openTask.title}</h2></div><button onClick={() => setOpenTask(null)} className="p-2 rounded-md hover:bg-[var(--surface-3)]"><Icon name="x" size={15} /></button></div>
              {/* Acá NO va la portada, y se quitó dos veces por el mismo
                  motivo: la imagen sirve para reconocer el trabajo en la
                  lista, pero adentro la misma foto ya aparece abajo en
                  Recursos. Puesta arriba se veía dos veces en la misma
                  pantalla y empujaba fuera de la vista el estado, las fechas
                  y los comentarios — que es lo que el cliente vino a leer. */}

              {/* Fase actual, con la misma línea que la lista: el cliente no
                  tiene que traducir entre una vista y la otra. */}
              <div className="mt-5">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-[12px] font-medium">{phaseText(openTask)}</span>
                  <span className="text-[12px] tnum" style={{ color: 'var(--text-muted)' }}>{openTask.progress}%</span>
                </div>
                <PhaseLine phases={openTask.phases} phaseIndex={openTask.phaseIndex} size="lg" />
              </div>

              <div className="grid grid-cols-2 gap-3 my-5"><div className="surf p-3"><div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Inicio</div><div className="font-semibold tnum">{fmtDate(openTask.startDate)}</div></div><div className="surf p-3"><div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Fecha límite</div><div className="font-semibold tnum">{fmtDate(openTask.deadline)}</div></div></div>
              {openTask.deliverables?.length > 0 && <section className="mb-6"><h3 className="ui-section-label mb-3">Recursos compartidos</h3><div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{openTask.deliverables.map((item, index) => item.url ? (item.kind === 'photos' ? <button key={index} type="button" onClick={() => setLightbox(item.url)} className="surf overflow-hidden group text-left" aria-label={'Ver ' + item.name}><img src={item.url} alt={item.name} referrerPolicy="no-referrer" className="w-full h-24 object-cover transition-transform group-hover:scale-105" /><div className="px-2.5 py-2 text-[10px] truncate">{item.name}</div></button> : <a key={index} href={item.url} target="_blank" rel="noopener noreferrer" className="surf overflow-hidden group"><div className="h-20 flex items-center justify-center"><Icon name={item.kind === 'link' ? 'link' : item.kind === 'video' ? 'film' : 'paperclip'} size={18} /></div><div className="px-2.5 py-2 text-[10px] truncate">{item.name}</div></a>) : <div key={index} className="surf px-3 py-3 text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{item.name}</div>)}</div></section>}
              <SharedClientComments portalToken={token} projectId={openTask.id} authorType="client" authorName={portal.clientName} clientInitials={portal.clientInitials || ''} clientColor={portal.clientColor || ''} studioAvatar={portal.studioAvatar || ''} />
            </div>
          </div>
        </div>
      )}

      {/* Visor. z-index por encima del detalle, que ya está en 50: si no, la
          imagen se abre debajo de la tarjeta que la abrió. */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.92)' }}
             onClick={() => setLightbox('')} role="dialog" aria-label="Imagen a tamaño completo">
          <img src={lightbox} alt="" referrerPolicy="no-referrer"
               onClick={event => event.stopPropagation()}
               style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 10, objectFit: 'contain' }} />
          <button onClick={() => setLightbox('')} aria-label="Cerrar"
                  className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}>
            <Icon name="x" size={18} />
          </button>
        </div>
      )}
    </div>
  );
};

Object.assign(window, { ClientPortal, createClientPortalToken, clientPortalUrl, buildClientPortalDocument });
