// ═══════════════════════════════════════════════════════════════
// LOOPA OS · Producción con los datos del tablero (Fase 3, tanda 3.5)
//
// Puro (sin Firebase ni DOM; se prueba con Node): arma lo que necesita el
// módulo Producción a partir de los documentos de FRAME y calcula qué se
// escribe al cambiar una tarea. La lectura y la escritura las hace la app
// (calendario.jsx, useFuenteTablero) con el SDK, bajo las reglas.
//
//   tareasDelTablero   como FRAME: tareas del tablero (workspaceId) + las
//                      compartidas (viewerIds) que incluyen el tablero
//   columnasDe         config/kanban_columns de FRAME → columnas del módulo
//   equipoDe           miembros del tablero, con las tarjetas que guarda
//                      el tablero (workspaceMembers de FRAME)
//   armarProduccion    → { hoy, columnas, tareas, equipo, clientes, workspace, rutina }
//   parcheTarea        sólo los campos editables que cambiaron (como
//                      handleUpdateProject de FRAME); nunca procedencia
//   resumenActividad   el texto del historial, igual que activitySummary de FRAME
//   puedeEnlazar       si las reglas aceptarían poner clientId a esa tarea
//   parcheEnlace       enlazar una tarea vieja a su ficha (clientId, una vez)
//   fechaEnRango       una fecha completa y razonable (no un año a medio escribir)
//   hoyEnTegucigalpa   fecha local YYYY-MM-DD de America/Tegucigalpa
// ═══════════════════════════════════════════════════════════════

const LoopaProduccionReal = (function () {
  const P = (typeof LoopaProduccion !== 'undefined') ? LoopaProduccion
    : (typeof require === 'function' ? require('./nucleo.js') : null);

  // Mismos campos que puede cambiar applyTaskPatch: lo demás nunca viaja.
  const EDITABLES = ['title', 'status', 'priority', 'sessionDate', 'deadline', 'checklist', 'assignees', 'tags', 'clientVisible'];

  // Pieza por pieza: no depende de cómo formatee cada versión del navegador.
  function hoyEnTegucigalpa(fecha = new Date()) {
    const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Tegucigalpa', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(fecha);
    const de = (t) => (partes.find(p => p.type === t) || {}).value;
    const r = `${de('year')}-${de('month')}-${de('day')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r)) throw new Error(`Fecha local inválida: ${r}`);
    return r;
  }

  // Un input de fecha manda cada tecla del año (0002, 0020, 0202…): en el
  // tablero compartido eso movería la tarea a otro siglo.
  const fechaEnRango = (s) => typeof s === 'string' && P.isDay(s) && s >= '2000-01-01' && s <= '2100-12-31';

  const plano = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function tareasDelTablero(porTablero, compartidas, wsId) {
    // (sin Map: la prueba de pureza vigila cualquier escritura del módulo)
    const porId = Object.create(null);
    const orden = [];
    const poner = (t) => { if (!(t.id in porId)) orden.push(t.id); porId[t.id] = t; };
    (porTablero || []).forEach(t => { if (t && t.id) poner(t); });
    (compartidas || []).forEach(t => {
      if (t && t.id && (t.workspaceId === wsId || (Array.isArray(t.workspaceIds) && t.workspaceIds.includes(wsId)))) poner(t);
    });
    return orden.map(id => porId[id]);
  }

  // Los indicadores van tal cual (también un false explícito, que FRAME
  // guarda): si no, el núcleo caería al valor por omisión de «delivered».
  function columnasDe(doc) {
    const cols = doc && Array.isArray(doc.columns) ? doc.columns.filter(c => plano(c) && typeof c.id === 'string' && c.id && c.id !== 'archived') : [];
    if (!cols.length) return P.STATUSES.filter(s => s.id !== 'archived').map(s => ({ ...s }));
    return cols.map(c => ({
      id: c.id,
      label: typeof c.label === 'string' && c.label ? c.label : c.id,
      ...(c.color ? { color: c.color } : {}),
      ...(typeof c.isDone === 'boolean' ? { isDone: c.isDone } : {}),
      ...(typeof c.requiresChecklist === 'boolean' ? { requiresChecklist: c.requiresChecklist } : {}),
    }));
  }

  // Sin leer perfiles ajenos (las reglas no lo permiten): las tarjetas de
  // miembro que guarda el tablero (members[uid], como FRAME) y el perfil
  // propio; si no hay, un nombre corto.
  function equipoDe(workspace, yo) {
    const ids = workspace && Array.isArray(workspace.memberIds) ? workspace.memberIds.filter(x => typeof x === 'string') : [];
    const tarjetas = workspace && plano(workspace.members) ? workspace.members : {};
    return ids.map(id => {
      const t = plano(tarjetas[id]) ? tarjetas[id] : {};
      const propio = yo && id === yo.uid ? (yo.name || yo.email) : '';
      return { id, name: (typeof t.name === 'string' && t.name) || propio || `Miembro ${id.slice(0, 6)}`, status: 'active' };
    });
  }

  function armarProduccion({ workspace, columnas, porTablero, compartidas, clientes, rutina, yo, hoy }) {
    if (!workspace || !workspace.id) throw new Error('Falta el tablero de producción');
    return {
      hoy,
      workspace: { id: workspace.id, name: workspace.name || workspace.id },
      columnas: columnasDe(columnas),
      tareas: tareasDelTablero(porTablero, compartidas, workspace.id),
      equipo: equipoDe(workspace, yo),
      clientes: (clientes || []).filter(c => c && c.id && c.workspaceId === workspace.id),
      rutina: plano(rutina) ? rutina : {},
    };
  }

  const igual = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

  // `antes` y `despues` normalizados (applyTaskPatch parte de normalizeTask).
  function parcheTarea(antes, despues) {
    const p = {};
    EDITABLES.forEach(k => { if (!igual(antes[k], despues[k])) p[k] = despues[k] === undefined ? null : despues[k]; });
    return p;
  }

  // El mismo texto que activitySummary de FRAME (historial de la tarea).
  function resumenActividad(antes, despues, columnas) {
    const etiqueta = (s) => { const c = (columnas || []).find(x => x.id === s) || P.STATUSES.find(x => x.id === s); return c ? c.label : s; };
    if (antes.status !== despues.status) return `cambió el estado a ${etiqueta(despues.status)}`;
    if (antes.startDate !== despues.startDate) return 'reprogramó la fecha de inicio';
    if (antes.deadline !== despues.deadline) return 'cambió la fecha límite';
    if (antes.sessionDate !== despues.sessionDate) return 'reprogramó la próxima fecha de trabajo';
    if (!igual(antes.assignees, despues.assignees)) return 'actualizó los responsables';
    if (!igual(antes.checklist, despues.checklist)) return 'actualizó el checklist';
    return null;
  }

  // Las reglas sólo aceptan poner clientId si la tarea NUNCA tuvo el campo
  // (ni vacío) y la ficha es del mismo tablero principal de la tarea.
  const puedeEnlazar = (crudo, wsId) => !!crudo && !Object.prototype.hasOwnProperty.call(crudo, 'clientId') && crudo.workspaceId === wsId;

  // Enlazar (linkTaskToClient): sólo clientId.
  function parcheEnlace(antes, despues) {
    return !antes.clientId && despues.clientId ? { clientId: despues.clientId } : {};
  }

  return { EDITABLES, hoyEnTegucigalpa, fechaEnRango, tareasDelTablero, columnasDe, equipoDe, armarProduccion, parcheTarea, resumenActividad, puedeEnlazar, parcheEnlace };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LoopaProduccionReal;
