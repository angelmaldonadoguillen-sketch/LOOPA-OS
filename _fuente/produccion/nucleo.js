// ═══════════════════════════════════════════════════════════════
// LOOPA OS · Producción — núcleo puro (portado de FRAME, data.jsx)
//
// Reglas de negocio de las tareas de producción, sin React, sin DOM y sin
// globales: todo lo que FRAME leía de window (columnas del tablero, "hoy") se
// recibe por parámetro. Corre igual en el navegador (dentro del bundle de
// build.js) y en Node (pruebas de paridad contra el código original de FRAME).
//
// Las pruebas en integracion/test/produccion-paridad.test.cjs ejecutan el
// data.jsx real de FRAME y comparan resultado por resultado.
// ═══════════════════════════════════════════════════════════════
const LoopaProduccion = (function () {
  // Columnas por defecto de FRAME (comportamiento, no color: LOOPA es b/n).
  const STATUSES = [
    { id: 'briefing',  label: 'Briefing' },
    { id: 'producing', label: 'En producción' },
    { id: 'editing',   label: 'Edición' },
    { id: 'review',    label: 'Revisión cliente' },
    { id: 'delivered', label: 'Entregado', isDone: true, requiresChecklist: true },
    { id: 'archived',  label: 'Archivado' },
  ];
  const PRIORITIES = [
    { id: 'high',   label: 'Alta' },
    { id: 'medium', label: 'Media' },
    { id: 'low',    label: 'Baja' },
  ];
  // Ícono y color iguales a FRAME: viajan en la proyección pública del
  // portal (la página del cliente los dibuja).
  const PROJECT_TYPES = [
    { id: 'reel', label: 'Reel', icon: 'film', color: 'var(--resource-violet)' },
    { id: 'photo', label: 'Fotografía', icon: 'camera', color: 'var(--resource-blue)' },
    { id: 'corp', label: 'Video corporativo', icon: 'briefcase', color: 'var(--resource-teal)' },
    { id: 'campaign', label: 'Campaign', icon: 'zap', color: 'var(--resource-coral)' },
    { id: 'bts', label: 'BTS', icon: 'film', color: 'var(--warn)' },
    { id: 'podcast', label: 'Podcast', icon: 'mic', color: 'var(--resource-pink)' },
    { id: 'other', label: 'Otro', icon: 'folder', color: 'var(--resource-neutral)' },
  ];
  const typeOf = (id, customTypes) => (customTypes || []).find(t => t.id === id) || PROJECT_TYPES.find(t => t.id === id) || PROJECT_TYPES[PROJECT_TYPES.length - 1];
  const statusOf = (id, columns) => (columns || []).find(c => c.id === id) || STATUSES.find(c => c.id === id) || STATUSES[0];
  const URGENT_DAYS = 3;

  // ── Fechas de calendario (YYYY-MM-DD local) ───────────────────
  const pad = (n) => String(n).padStart(2, '0');
  const localISO = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  // Fecha estricta: "2026-11-00", "2026-13-01" o "0099-01-01" no son días
  // válidos (Date.UTC los "arreglaría" en silencio y FRAME los trata como
  // inválidos). Inválida → NaN, igual que FRAME.
  const dayNumber = (iso) => {
    const m = YMD.exec(typeof iso === 'string' ? iso : '');
    if (!m) return NaN;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return NaN;
    const dt = new Date(0);
    dt.setUTCFullYear(y, mo - 1, d);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
    return Math.round(dt.getTime() / 86400000);
  };
  const isDay = (iso) => !Number.isNaN(dayNumber(iso));
  const fromDayNumber = (n) => {
    if (!Number.isFinite(n)) return '';
    const d = new Date(0);
    d.setTime(n * 86400000);
    return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };
  // Fecha inválida → '' (nunca "NaN-NaN-NaN").
  const addDays = (iso, k) => fromDayNumber(dayNumber(iso) + k);
  // Días entre hoy y la fecha (negativo = ya pasó). Igual que FRAME, sin
  // depender de la hora del día.
  const daysUntil = (iso, todayISO) => dayNumber(iso) - dayNumber(todayISO);

  // ── Forma garantizada de una tarea (normalizeProject de FRAME) ──
  // `today` reemplaza al localISO(new Date()) que FRAME evaluaba adentro.
  function normalizeTask(p, today) {
    return {
      ...p,
      title:        p.title        ?? '',
      client:       p.client       ?? '',
      type:         p.type         ?? 'other',
      status:       p.status       ?? 'briefing',
      priority:     p.priority     ?? 'medium',
      startDate:    p.startDate    || today,
      deadline:     p.deadline     ?? '',
      sessionDate:  p.sessionDate  || p.startDate || p.deadline || today,
      currency:     (p.currency === 'USD' && !p.budget) ? 'HNL' : (p.currency ?? 'HNL'),
      budget:       typeof p.budget === 'number' ? p.budget : 0,
      tags:         Array.isArray(p.tags)         ? p.tags         : [],
      assignees:    Array.isArray(p.assignees)    ? p.assignees    : [],
      checklist:    Array.isArray(p.checklist)    ? p.checklist    : [],
      deliverables: Array.isArray(p.deliverables) ? p.deliverables : [],
      comments:     Array.isArray(p.comments)     ? p.comments     : [],
      timeline:     Array.isArray(p.timeline)     ? p.timeline     : [],
      description:  Array.isArray(p.description)  ? p.description  : [],
      workspaceIds: Array.isArray(p.workspaceIds)
        ? [...new Set(p.workspaceIds.filter(Boolean))]
        : (p.workspaceId ? [p.workspaceId] : []),
      viewerIds:    Array.isArray(p.viewerIds) ? [...new Set(p.viewerIds.filter(Boolean))] : [],
      clientVisible: p.clientVisible !== false,
      cover:        p.cover && typeof p.cover === 'object' ? p.cover : { type: 'color', value: 'var(--surface-2)' },
    };
  }

  const boardOf = (task) => (task && task.workspaceIds && task.workspaceIds.length ? task.workspaceIds : [task && task.workspaceId]).filter(Boolean);

  // ── Columnas: el cierre es comportamiento, no nombre ────────────
  // `columns` es la configuración del tablero (kanban_columns). Si no se pasa,
  // rige la compatibilidad de FRAME: sólo 'delivered' cierra.
  const columnOf = (status, columns) => (columns || []).find(c => c.id === status);
  const isCompletionStatus = (status, columns) => {
    const c = columnOf(status, columns);
    return typeof (c && c.isDone) === 'boolean' ? c.isDone : status === 'delivered';
  };
  const requiresChecklistForStatus = (status, columns) => {
    const c = columnOf(status, columns);
    return typeof (c && c.requiresChecklist) === 'boolean' ? c.requiresChecklist : status === 'delivered';
  };
  const isClosed = (task, columns) => task.status === 'archived' || isCompletionStatus(task.status, columns);
  const isUrgent = (task, todayISO, columns) => {
    if (isClosed(task, columns)) return false;
    const d = daysUntil(task.deadline, todayISO);
    return d >= 0 && d <= URGENT_DAYS;
  };
  const isOverdue = (task, todayISO, columns) => !isClosed(task, columns) && daysUntil(task.deadline, todayISO) < 0;
  const needsAttention = (task, todayISO, columns) => isUrgent(task, todayISO, columns) || isOverdue(task, todayISO, columns);
  const progressOf = (task) => {
    if (!task.checklist || !task.checklist.length) return 0;
    return Math.round((task.checklist.filter(c => c.done).length / task.checklist.length) * 100);
  };

  // ── Calendario ──────────────────────────────────────────────────
  // Una tarea, un día: el de trabajo (sessionDate). La fecha límite no ubica
  // nada; es el compromiso con el cliente y se muestra como dato.
  const calendarDateOf = (task) => task.sessionDate || task.startDate || task.deadline || '';
  function tasksByDate(tasks) {
    const map = {};
    (tasks || []).forEach(t => {
      const date = calendarDateOf(t);
      if (!date) return;
      if (!map[date]) map[date] = [];
      if (!map[date].some(x => x.id === t.id)) map[date].push(t);
    });
    return map;
  }
  // 42 días (6 semanas) empezando en lunes, como FRAME.
  function monthGrid(year, monthIndex) {
    const first = `${year}-${pad(monthIndex + 1)}-01`;
    const dow = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
    const start = addDays(first, -dow);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }
  function weekOf(iso) {
    const m = YMD.exec(iso);
    const dow = (new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7;
    const start = addDays(iso, -dow);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  // ── Carry-over: lo incompleto pasa a hoy (sólo sessionDate) ─────
  // FRAME tiene DOS reglas que no coinciden del todo:
  //   · carryOverCandidates        = la del navegador (app.jsx): progreso
  //     redondeado < 100 y cierre según isClosed (flags booleanos).
  //   · carryOverCandidatesServidor = la de la función programada
  //     (functions/index.js): algún ítem sin hacer, columnas cerradas con
  //     isDone "verdadero", y 'delivered' sólo si ninguna columna define isDone.
  // Difieren con 199 de 200 ítems hechos, con isDone no booleano y con estados
  // que no están en las columnas. Cuál rige en LOOPA es la decisión D12
  // (ADR-0003); ambas tienen prueba de paridad contra su original.
  function carryOverCandidates(tasks, todayISO, columns) {
    return (tasks || []).filter(t => {
      if (!t.checklist || !t.checklist.length || progressOf(t) >= 100) return false;
      if (isClosed(t, columns)) return false;
      const ref = t.sessionDate || t.startDate || t.deadline;
      return !!ref && ref < todayISO;
    }).map(t => t.id);
  }
  function carryOverCandidatesServidor(tasks, todayISO, columns) {
    const cols = Array.isArray(columns) ? columns : [];
    const completed = new Set(cols.filter(c => c.isDone).map(c => c.id));
    if (!cols.some(c => typeof c.isDone === 'boolean')) completed.add('delivered');
    return (tasks || []).filter(data => {
      const checklist = Array.isArray(data.checklist) ? data.checklist : [];
      const incomplete = checklist.length > 0 && checklist.some(item => !item.done);
      const refDate = data.sessionDate || data.startDate || data.deadline;
      return !(!incomplete || !refDate || refDate >= todayISO || data.status === 'archived' || completed.has(data.status));
    }).map(t => t.id);
  }
  // El compromiso (deadline) nunca se toca al reprogramar.
  const reschedule = (task, sessionDate) => ({ ...task, sessionDate });

  // ── Tablero: columnas propias + las de estados desconocidos ─────
  // Igual que boardColumns de FRAME (sin tableros ajenos, que LOOPA no tiene:
  // hay un solo tablero de producción). Una tarjeta con un estado que no está
  // en las columnas no desaparece: se agrega su columna al final.
  function boardColumns(columns, tasks) {
    const mias = new Set((columns || []).map(c => c.id));
    const extra = [];
    (tasks || []).forEach(t => {
      if (!t.status || mias.has(t.status) || extra.some(c => c.id === t.status)) return;
      extra.push({ id: t.status, label: t.status, color: '#8a8a8e', fromBoardId: '', fromBoard: 'otro tablero' });
    });
    return extra.length ? [...(columns || []), ...extra] : (columns || []);
  }

  // ── Edición de una tarea ────────────────────────────────────────
  // Reglas de FRAME (handleUpdateProject) + las de la fusión:
  //   · pasar a una columna que exige checklist completo, con el checklist
  //     incompleto, se rechaza (la restricción es de la columna destino);
  //   · reprogramar mueve sólo sessionDate (debe ser un día válido);
  //   · en una tarea generada por una venta, la entrega (deadline) es el
  //     compromiso que fija la venta y la procedencia es inmutable;
  //   · sólo se editan campos conocidos: el resto se rechaza.
  const EDITABLE = ['title', 'status', 'priority', 'sessionDate', 'deadline', 'checklist', 'assignees', 'tags', 'clientVisible'];
  const PROVENANCE = ['sourceSystem', 'sourceSaleId', 'sourceSaleNumber', 'sourceSaleStatus', 'sourceLineIds', 'sourceEventId', 'sourceTemplateVersions', 'sourceWorkItems', 'idempotencyKey', 'integration', 'workspaceId', 'workspaceIds', 'viewerIds', 'id', 'clientId'];
  const editError = (code, message) => ({ ok: false, error: { code, message } });

  function statusChangeBlocked(prev, next, columns) {
    return !!(prev && requiresChecklistForStatus(next.status, columns) && prev.status !== next.status
      && next.checklist && next.checklist.length && progressOf(next) < 100);
  }

  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  const isStringList = (v) => Array.isArray(v) && v.every(x => typeof x === 'string');

  function applyTaskPatch(task, patch, columns) {
    if (!isPlain(patch)) return editError('patch_invalid', 'El cambio debe ser un objeto');
    const keys = Object.keys(patch);
    const locked = keys.filter(k => PROVENANCE.includes(k));
    if (locked.length) return editError('provenance_locked', `No se puede cambiar: ${locked.join(', ')}`);
    const unknown = keys.filter(k => !EDITABLE.includes(k));
    if (unknown.length) return editError('field_not_editable', `Campos no editables: ${unknown.join(', ')}`);
    const fromSale = task.sourceSystem === 'loopa';
    if (fromSale && Object.prototype.hasOwnProperty.call(patch, 'deadline') && patch.deadline !== task.deadline) {
      return editError('deadline_locked', 'La entrega la fija la venta: se cambia editando la venta en LOOPA');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'sessionDate') && !isDay(patch.sessionDate)) {
      return editError('session_invalid', 'El día de trabajo debe ser una fecha válida');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'deadline') && patch.deadline !== '' && !isDay(patch.deadline)) {
      return editError('deadline_invalid', 'La entrega debe ser una fecha válida o quedar vacía');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'title') && !(typeof patch.title === 'string' && patch.title.trim())) {
      return editError('title_empty', 'La tarea necesita un título');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'checklist')) {
      const ok = Array.isArray(patch.checklist) && patch.checklist.every(c => c && typeof c.id === 'string' && typeof c.text === 'string' && typeof c.done === 'boolean');
      const ids = ok ? patch.checklist.map(c => c.id) : [];
      if (!ok || new Set(ids).size !== ids.length) return editError('checklist_invalid', 'El checklist tiene ítems inválidos o repetidos');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'priority') && !PRIORITIES.some(p => p.id === patch.priority)) {
      return editError('priority_invalid', 'Prioridad desconocida');
    }
    // El estado debe existir: una columna del tablero, el estado actual o
    // 'archived'. Un estado vacío haría desaparecer la tarjeta del tablero.
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      const known = (columns && columns.length ? columns : STATUSES).map(c => c.id);
      if (typeof patch.status !== 'string' || !patch.status || !(known.includes(patch.status) || patch.status === task.status || patch.status === 'archived')) {
        return editError('status_invalid', 'Estado desconocido para este tablero');
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'tags') && !isStringList(patch.tags)) return editError('tags_invalid', 'Las etiquetas deben ser una lista de textos');
    if (Object.prototype.hasOwnProperty.call(patch, 'clientVisible') && typeof patch.clientVisible !== 'boolean') return editError('visibility_invalid', 'La visibilidad debe ser sí o no');
    if (Object.prototype.hasOwnProperty.call(patch, 'assignees') && !isStringList(patch.assignees)) return editError('assignees_invalid', 'Los responsables deben ser una lista de ids');
    // Copias: el estado guardado nunca comparte arreglos con quien llama.
    const copy = { ...patch };
    if (copy.checklist) copy.checklist = copy.checklist.map(c => ({ ...c }));
    if (copy.tags) copy.tags = [...copy.tags];
    if (copy.assignees) copy.assignees = [...copy.assignees];
    const next = { ...task, ...copy };
    if (statusChangeBlocked(task, next, columns)) {
      const col = columnOf(next.status, columns) || STATUSES.find(c => c.id === next.status);
      return editError('checklist_incomplete', `Completá el checklist antes de mover la tarea a ${col ? col.label : next.status}.`);
    }
    return { ok: true, task: next };
  }

  const toggleChecklistItem = (task, itemId) => ({
    checklist: task.checklist.map(c => (c.id === itemId ? { ...c, done: !c.done } : c)),
  });
  const addChecklistItem = (task, text, id) => ({
    checklist: [...task.checklist, { id, text: String(text).trim(), done: false }],
  });

  // ── Rutina diaria del equipo (routine.jsx de FRAME) ─────────────
  // Documento: { tasks:[{id,text,assignee?}], today:{date,checks,debt},
  // history:[{date,completed,total}], config:{carryOver} }.
  // Todas las funciones devuelven un documento NUEVO; nunca mutan.
  const ROUTINE_HISTORY_MAX = 60;
  function routineDedupeHistory(history) {
    const seen = new Set();
    return (history || []).filter(e => {
      if (!e || !e.date || seen.has(e.date)) return false;
      seen.add(e.date);
      return true;
    });
  }
  // Al cambiar de día: el día anterior pasa al historial y, con carry-over,
  // lo que quedó sin hacer suma deuda. Reglas (ADR-0003 §8):
  //   · sólo se cambia de día si la fecha guardada es un día válido ANTERIOR
  //     a hoy. Una fecha futura (reloj adelantado) no borra las marcas ni
  //     ensucia el historial; una fecha inválida empieza el día de cero sin
  //     tocar el historial (FRAME metía la fecha basura al historial);
  //   · la deuda cuenta DÍAS de calendario (FRAME sumaba 1 por apertura: tras
  //     una semana sin abrir decía "pendiente de ayer");
  //   · el historial se deduplica DESPUÉS de agregar el día (nunca dos
  //     entradas con la misma fecha) y se corta en 60.
  function routineRollover(doc, todayISO) {
    const d = doc || {};
    const tasks = Array.isArray(d.tasks) ? d.tasks : [];
    const today = d.today || { date: todayISO, checks: {} };
    const history = routineDedupeHistory(d.history);
    const carry = !!(d.config && d.config.carryOver);
    const base = { tasks, history, config: { carryOver: carry } };
    if (today.date && !isDay(today.date)) {
      return { changed: true, doc: { ...base, today: { date: todayISO, checks: {}, debt: {} } } };
    }
    if (today.date && today.date < todayISO) {
      const checks = today.checks || {};
      const entry = { date: today.date, completed: tasks.filter(t => checks[t.id]).length, total: tasks.length };
      const gap = daysUntil(todayISO, today.date);
      const debt = {};
      if (carry) {
        const prev = today.debt || {};
        tasks.forEach(t => { if (!checks[t.id]) debt[t.id] = (prev[t.id] || 0) + gap; });
      }
      return { changed: true, doc: { ...base, history: routineDedupeHistory([entry, ...history]).slice(0, ROUTINE_HISTORY_MAX), today: { date: todayISO, checks: {}, debt } } };
    }
    return {
      changed: history.length !== (Array.isArray(d.history) ? d.history.length : 0) || !d.today,
      doc: { ...base, today: { date: today.date || todayISO, checks: today.checks || {}, debt: today.debt || {} } },
    };
  }
  function routineToggle(doc, taskId) {
    const checks = { ...doc.today.checks, [taskId]: !doc.today.checks[taskId] };
    const debt = { ...doc.today.debt };
    if (checks[taskId]) delete debt[taskId]; // completar salda la deuda
    return { ...doc, today: { ...doc.today, checks, debt } };
  }
  function routineAddTask(doc, text, id) {
    const t = String(text || '').trim();
    if (!t || doc.tasks.some(x => x.id === id)) return doc;
    return { ...doc, tasks: [...doc.tasks, { id, text: t.slice(0, 200) }] };
  }
  // A diferencia de FRAME, también se borra su deuda (FRAME la dejaba huérfana).
  function routineDeleteTask(doc, id) {
    const omit = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => k !== id));
    return { ...doc, tasks: doc.tasks.filter(t => t.id !== id), today: { ...doc.today, checks: omit(doc.today.checks), debt: omit(doc.today.debt) } };
  }
  function routineRenameTask(doc, id, text) {
    const t = String(text || '').trim();
    if (!t) return doc;
    return { ...doc, tasks: doc.tasks.map(x => (x.id === id ? { ...x, text: t.slice(0, 200) } : x)) };
  }
  // Apagar el arrastre limpia la deuda (igual que FRAME en toggleCarryOver).
  function routineSetCarryOver(doc, on) {
    return { ...doc, config: { ...doc.config, carryOver: !!on }, today: on ? doc.today : { ...doc.today, debt: {} } };
  }
  const routineAssignTask = (doc, id, userId) => ({ ...doc, tasks: doc.tasks.map(x => (x.id === id ? { ...x, assignee: userId || null } : x)) });
  // Racha: días perfectos seguidos hasta hoy (hoy cuenta si ya está completo).
  function routineStats(doc, todayISO) {
    const total = doc.tasks.length;
    const completed = doc.tasks.filter(t => doc.today.checks[t.id]).length;
    const allDone = total > 0 && completed === total;
    const perfect = new Set(doc.history.filter(e => e.total > 0 && e.completed === e.total).map(e => e.date));
    if (allDone) perfect.add(todayISO);
    let streak = 0;
    for (let i = 0; i < ROUTINE_HISTORY_MAX; i += 1) {
      if (perfect.has(addDays(todayISO, -i))) streak += 1;
      else break;
    }
    return { total, completed, allDone, pct: total === 0 ? 0 : Math.round((completed / total) * 100), streak };
  }

  // ── Resumen de producción (analytics.jsx de FRAME, sin importes) ──
  // LOOPA no copia importes a Producción (D8): se omiten presupuesto y
  // montos por mes. Clientes se agrupan por id cuando lo hay (ficha única) y
  // si no por nombre, como FRAME.
  function productionSummary(tasks, columns, team, todayISO) {
    const cols = columns || [];
    const reportable = (tasks || []).filter(p => p.status !== 'archived');
    const active = reportable.filter(p => !isClosed(p, cols));
    const delivered = reportable.filter(p => isCompletionStatus(p.status, cols));
    const urgent = active.filter(p => needsAttention(p, todayISO, cols));
    const deliveryRate = reportable.length ? Math.round((delivered.length / reportable.length) * 100) : 0;
    const workflow = cols.length ? cols : STATUSES.filter(x => x.id !== 'archived');
    const statusGroups = workflow.map(c => ({ id: c.id, label: c.label, count: reportable.filter(p => p.status === c.id).length }));
    const typeIds = [...new Set(reportable.map(p => p.type).filter(Boolean))];
    const typeCounts = typeIds
      .map(id => ({ id, label: (PROJECT_TYPES.find(t => t.id === id) || { label: id }).label, count: reportable.filter(p => p.type === id).length }))
      .sort((a, b) => b.count - a.count);
    const workload = (team || []).filter(m => !m.status || m.status === 'active')
      .map(m => ({ id: m.id, name: m.name, count: active.filter(p => (p.assignees || []).includes(m.id)).length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const byClient = {};
    reportable.forEach(p => {
      if (!p.client) return;
      const key = p.clientId || p.client;
      if (!byClient[key]) byClient[key] = { key, name: p.client, count: 0 };
      byClient[key].count += 1;
    });
    const topClients = Object.values(byClient).sort((a, b) => b.count - a.count).slice(0, 6);
    const [ty, tm] = todayISO.split('-').map(Number);
    const months = [];
    for (let i = 5; i >= 0; i -= 1) {
      const idx = ty * 12 + (tm - 1) - i;
      const key = `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
      months.push({ key, count: reportable.filter(p => (p.deadline || p.startDate || '').startsWith(key)).length });
    }
    // Próximas entregas: sólo fechas válidas, de la más cercana a la más lejana.
    // Empates (mismo día, frecuentes: una tarjeta por cliente y día) se
    // desempatan por id para que el orden sea estable; FRAME conservaba el
    // orden de llegada.
    const upcoming = active.filter(p => isDay(p.deadline))
      .sort((a, b) => a.deadline.localeCompare(b.deadline) || String(a.id).localeCompare(String(b.id)))
      .slice(0, 5);
    return { reportable: reportable.length, active: active.length, delivered: delivered.length, urgent: urgent.length, deliveryRate, statusGroups, typeCounts, workload, topClients, months, upcoming };
  }

  // ── Portal del cliente (portal.jsx de FRAME) ────────────────────
  // Qué tareas son de un cliente. FRAME comparaba sólo el NOMBRE: con dos
  // clientes homónimos, uno veía el trabajo del otro en su portal público.
  // En la fusión (ficha única):
  //   · una tarea con clientId pertenece sólo al cliente con ese id;
  //   · una tarea vieja sin clientId cae por nombre SÓLO si ningún otro
  //     cliente del tablero tiene ese nombre; si es ambiguo, no se publica.
  //   · un cliente SIN nombre nunca recibe tareas por nombre (si no, se
  //     llevaría todas las tareas internas o «sin cliente»);
  //   · sin la lista de clientes (allClients) no se puede saber si hay
  //     homónimos: entonces sólo cuenta el clientId.
  // El nombre se compara normalizado (NFC, espacios colapsados, minúsculas):
  // «Café  Aurora» y «Café Aurora» (é compuesta o no) son el mismo nombre,
  // tanto para encontrar homónimos como para emparejar.
  const nameKey = (v) => String(v || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  function clientHomonyms(client, allClients) {
    const name = nameKey(client && client.name);
    if (!name) return [];
    return (allClients || []).filter(c => c && c.id !== client.id && nameKey(c.name) === name);
  }
  function clientTasks(client, tasks, allClients) {
    const name = nameKey(client.name);
    const porNombre = name !== '' && Array.isArray(allClients) && clientHomonyms(client, allClients).length === 0;
    return (tasks || []).filter(t => (t.clientId ? t.clientId === client.id : (porNombre && nameKey(t.client) === name)));
  }
  // Tareas viejas (sin clientId) que llevan el nombre de este cliente: con
  // homónimos quedan fuera de la ficha y del portal hasta enlazarlas.
  function unlinkedNameMatches(client, tasks) {
    const name = nameKey(client.name);
    if (!name) return [];
    return (tasks || []).filter(t => !t.clientId && nameKey(t.client) === name);
  }
  // Enlazar una tarea vieja a su ficha única. Es la ÚNICA forma de asignar
  // clientId desde la interfaz (applyTaskPatch lo bloquea como procedencia):
  // sólo una vez, sólo a un cliente que existe y sólo si el nombre coincide
  // (resuelve homónimos; las tareas sin cliente reconocible se enlazan en la
  // migración, no a mano).
  function linkTaskToClient(task, client, allClients) {
    if (!task || !client) return editError('link_invalid', 'Falta la tarea o el cliente');
    if (task.clientId) return editError('already_linked', 'La tarea ya tiene ficha de cliente');
    if (!(allClients || []).some(c => c && c.id === client.id)) return editError('client_unknown', 'El cliente no existe en este tablero');
    if (!nameKey(client.name) || nameKey(task.client) !== nameKey(client.name)) return editError('name_mismatch', 'Sólo se enlaza una tarea al cliente con su mismo nombre');
    return { ok: true, task: { ...task, clientId: client.id } };
  }

  // Proyección PÚBLICA de un cliente: lo único que ve en su portal. Misma
  // forma que buildClientPortalDocument de FRAME (las reglas validan esas
  // claves exactas). Nunca lleva comentarios, responsables, importes ni
  // datos internos. `now` reemplaza al new Date() interno.
  function buildPortalDocument({ client, tasks, allClients, workspace, published, columns, customTypes, now, studioName = 'LOOPA' }) {
    const isPublished = (published === undefined ? client.portalPublished === true : published) === true;
    const columnas = columns && columns.length ? columns : STATUSES;
    const fases = columnas.map(c => c.id);
    const avancePorFase = (t) => {
      if (isClosed(t, columns)) return 100;
      const i = fases.indexOf(t.status);
      if (i < 0 || fases.length < 2) return 0;
      return Math.round((i / fases.length) * 100);
    };
    const etiquetasFases = columnas.map(c => String(c.label || c.id || '')).slice(0, 12);
    const compartido = (item) => item.clientVisible !== false;
    // Misma URL aunque cambie la mayúscula del esquema/host o el token de
    // descarga (?alt=media&token=…): un archivo oculto no vuelve como portada.
    const urlKey = (u) => {
      const m = /^(https?):\/\/([^/?#]*)([^?#]*)/i.exec(String(u || '').trim());
      return m ? `${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3]}` : String(u || '').trim();
    };
    const objetos = (lista) => (Array.isArray(lista) ? lista : []).filter(item => item && typeof item === 'object');
    const esImagenDelBrief = (item) => /(?:\/|%2f)frame-descriptions(?:\/|%2f)/i.test(String(typeof item === 'string' ? item : (item && item.url) || ''));
    const portadaDe = (t) => {
      const cover = t.cover;
      if (cover && cover.type === 'image' && /^https:\/\//i.test(String(cover.value || '')) && !esImagenDelBrief(String(cover.value))) {
        const oculta = objetos(t.deliverables).some(item => urlKey(item.url) === urlKey(cover.value) && !compartido(item));
        if (!oculta) return String(cover.value);
      }
      const disponible = objetos(t.deliverables).find(item => compartido(item) && !esImagenDelBrief(item) && item.kind === 'photos' && /^https:\/\//i.test(String(item.url || '')));
      return disponible ? String(disponible.url) : '';
    };
    const visible = clientTasks(client, tasks, allClients)
      .filter(t => t.clientVisible !== false)
      // Una venta cancelada no se le muestra al cliente como «en producción»:
      // la tarea sigue en el tablero (cancelar nunca borra), pero sale del portal.
      .filter(t => t.sourceSaleStatus !== 'cancelled')
      .map(t => {
        const checklist = objetos(t.checklist);
        const completed = checklist.filter(item => item.done).length;
        const tipo = typeOf(t.type, customTypes);
        return {
          id: String(t.id),
          title: String(t.title || ''),
          // Un tipo propio sin nombre cae a su id (FRAME dejaba undefined).
          type: String(tipo.label || tipo.id || ''),
          typeIcon: String(tipo.icon || 'folder'),
          typeColor: String(tipo.color || 'var(--resource-neutral)').slice(0, 64),
          // Una columna sin nombre cae a su id: FRAME dejaba undefined, que
          // Firestore rechaza al escribir el documento público.
          status: String(statusOf(t.status, columns).label || statusOf(t.status, columns).id || ''),
          statusId: String(t.status || ''),
          startDate: String(t.startDate || ''),
          deadline: String(t.deadline || ''),
          progress: checklist.length ? Math.round((completed / checklist.length) * 100) : avancePorFase(t),
          phases: etiquetasFases,
          phaseIndex: isClosed(t, columns) ? etiquetasFases.length : fases.indexOf(t.status),
          cover: portadaDe(t),
          deliverables: objetos(t.deliverables).filter(item => compartido(item) && !esImagenDelBrief(item)).map(item => ({
            name: String(item.name || 'Entregable'),
            kind: String(item.kind || 'file'),
            url: /^https:\/\//i.test(String(item.url || '')) ? String(item.url) : '',
          })).slice(0, 20),
        };
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const ws = workspace || {};
    // Lo que valida la regla validPortal: nombres ≤ 200 y avatar sólo como
    // imagen embebida (una URL de foto de perfil haría fallar la escritura).
    const avatar = String((ws.members && ws.ownerId && ws.members[ws.ownerId] && ws.members[ws.ownerId].avatar) || '');
    const avatarValido = avatar.length <= 350000 && /^data:image\/(jpeg|png|webp);base64,/.test(avatar) ? avatar : '';
    return {
      workspaceId: String(client.workspaceId || ws.id || ''),
      clientId: String(client.id),
      clientName: String(client.name || 'Cliente').slice(0, 200),
      clientInitials: String(client.initials || String(client.name || 'Cliente').slice(0, 2).toUpperCase()).slice(0, 4),
      clientColor: String(client.color || 'var(--resource-blue)').slice(0, 64),
      studioName: String(ws.name || studioName).slice(0, 200),
      studioAvatar: avatarValido,
      published: isPublished,
      updatedAt: String(now),
      taskIds: isPublished ? visible.slice(0, 100).map(t => t.id) : [],
      tasks: isPublished ? visible.slice(0, 100) : [],
    };
  }

  // ── Vínculo con la venta (tareas generadas desde LOOPA) ─────────
  const saleLinkOf = (task) => (task && task.sourceSystem === 'loopa'
    ? { saleId: task.sourceSaleId, n: task.sourceSaleNumber, cancelled: task.sourceSaleStatus === 'cancelled' }
    : null);

  return {
    STATUSES, PRIORITIES, PROJECT_TYPES, URGENT_DAYS,
    localISO, addDays, daysUntil, isDay,
    normalizeTask, boardOf,
    isCompletionStatus, requiresChecklistForStatus, isClosed, isUrgent, isOverdue, needsAttention, progressOf,
    calendarDateOf, tasksByDate, monthGrid, weekOf,
    carryOverCandidates, carryOverCandidatesServidor, reschedule, saleLinkOf,
    boardColumns, statusChangeBlocked, applyTaskPatch, toggleChecklistItem, addChecklistItem,
    routineDedupeHistory, routineRollover, routineSetCarryOver, routineToggle, routineAddTask, routineDeleteTask, routineRenameTask, routineAssignTask, routineStats,
    productionSummary, clientTasks, clientHomonyms, unlinkedNameMatches, linkTaskToClient, buildPortalDocument, typeOf, statusOf,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LoopaProduccion;
