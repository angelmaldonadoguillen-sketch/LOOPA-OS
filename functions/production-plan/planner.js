'use strict';
// ─────────────────────────────────────────────────────────────────
// Planificador: venta confirmada → tarjetas FRAME propuestas.
//
// Función pura y determinista. Misma venta + mismo contexto = mismo JSON,
// byte a byte. No lee la hora (context.today se inyecta), no usa azar, no
// toca Firebase. Es lo que corre el worker en servidor y lo que muestra el
// simulador; el editor de servicios podrá usarlo para la vista previa.
//
//   1. Expansión: línea × bloque de plantilla × ocurrencia = unidad de trabajo
//   2. Fechas:    sessionDate (calendario) y deadline (compromiso) por unidad
//   3. Agrupación: unidades con igual (venta, tablero, cliente, día, groupKey)
//                  → una tarjeta con checklist combinado
//
// Si hay un solo error bloqueante no se propone NINGUNA tarjeta: generar la
// mitad de una venta y llamarlo éxito es justo lo que no puede pasar.
// ─────────────────────────────────────────────────────────────────

const { addDays, addMonths, compareYmd, isValidYmd } = require('./dates');
const { ids, fingerprint, isStableId } = require('./ids');
const { issue, hasErrors } = require('./errors');
const { validateSale, validateGeneratedTask, LIMITS, SCHEMA_VERSION } = require('./contracts');
const Ficha = require('./ficha');

const own = (obj, key) => (obj && Object.hasOwn(obj, key) ? obj[key] : undefined);

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

const render = (text, vars) => String(text).replace(/\{([a-z]+)\}/g, (_, name) => (vars[name] === undefined ? `{${name}}` : String(vars[name])));
const clip = (text, max = LIMITS.text) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const uniqSorted = (list) => [...new Set(list)].sort();

const stepDate = (base, recurrence, index) => {
  if (!recurrence || index === 0) return base;
  if (recurrence.unit === 'day') return addDays(base, index * recurrence.interval);
  if (recurrence.unit === 'week') return addDays(base, index * recurrence.interval * 7);
  return addMonths(base, index * recurrence.interval);
};

// Lo que define "el contenido generado" de una tarjeta. Sirve para saber si
// alguien ya la tocó (comparando contra la huella guardada al crearla).
// No incluye viewerIds ni sourceEventId: cambian sin que cambie el trabajo.
const taskContent = (task) => ({
  title: task.title,
  type: task.type,
  status: task.status,
  priority: task.priority,
  tags: Array.isArray(task.tags) ? [...task.tags] : [],
  client: task.client,
  clientId: task.clientId,
  workspaceId: task.workspaceId,
  sessionDate: task.sessionDate,
  deadline: task.deadline,
  checklist: (Array.isArray(task.checklist) ? task.checklist : []).map(c => ({ id: c.id, text: c.text, done: c.done === true })),
});
const contentFingerprint = (task) => fingerprint(taskContent(task));

// Intacta = el contenido generado no cambió Y nadie asignó responsables,
// subió entregables, armó timeline ni comentó. Cualquiera de esas señales es
// trabajo iniciado aunque el checklist siga igual.
const STARTED_SIGNALS = ['assignees', 'deliverables', 'timeline', 'comments'];
const isPristine = (task) => !!task && !!task.integration
  && contentFingerprint(task) === task.integration.generatedFingerprint
  && STARTED_SIGNALS.every(k => !Array.isArray(task[k]) || task[k].length === 0);

const workItemsOf = (task) => (Array.isArray(task && task.sourceWorkItems) ? task.sourceWorkItems.map(w => w.workItemKey) : []);

function resolveClient(sale, workspaceId, context, path, out) {
  const clientId = sale.client.clientId;
  const client = own(context.clients, clientId);
  if (!client) {
    out.push(issue('client.unknown', `${path}.client.clientId`,
      'El cliente no existe en la ficha única de clientes (¿todavía no se migró?). No se empareja por nombre.'));
    return null;
  }
  if (client.workspaceId !== workspaceId) {
    out.push(issue('client.workspace_mismatch', `${path}.client.clientId`, 'El cliente pertenece a otro tablero que el de producción'));
    return null;
  }
  return { id: clientId, name: client.name };
}

function resolveWorkspace(plan, context, path, out) {
  const workspaceId = plan.workspaceId || context.defaultWorkspaceId;
  if (!isStableId(workspaceId)) {
    out.push(issue('workspace.missing', `${path}.workspaceId`, 'No hay tablero de producción configurado'));
    return null;
  }
  if (!(context.allowedWorkspaceIds || []).includes(workspaceId)) {
    out.push(issue('workspace.not_allowed', `${path}.workspaceId`, 'El tablero de destino no está habilitado para recibir producción de LOOPA'));
    return null;
  }
  const ws = own(context.workspaces, workspaceId);
  if (!ws || !Array.isArray(ws.memberIds) || ws.memberIds.length === 0) {
    out.push(issue('workspace.no_members', `${path}.workspaceId`, 'El tablero de destino no existe o no tiene miembros'));
    return null;
  }
  return { id: workspaceId, ...ws };
}

// ── Producto con ficha: una tarjeta por entrega, con su fecha ─────
// Las fechas salen del patrón de cada entregable dentro del rango congelado
// en la línea (Ficha.calendario: la misma cuenta que mostró la venta). Cada
// entrega es una unidad de trabajo propia (estrategia «separate»), con el
// proceso del producto como checklist. Va a la primera columna del tablero.
function expandFichaLine(sale, line, lineIndex, context, out, resolved) {
  const path = `sale.lines[${lineIndex}]`;
  const ficha = Ficha.normalizarFicha(line.ficha);
  const workspace = resolveWorkspace({ workspaceId: null }, context, path, out);
  if (!workspace) return [];
  if (!resolved.has(workspace.id)) resolved.set(workspace.id, resolveClient(sale, workspace.id, context, 'sale', out));
  const client = resolved.get(workspace.id);
  if (!client) return [];
  if (!ficha.proceso.length) {
    out.push(issue('line.ficha.no_process', `${path}.ficha.proceso`, `«${line.snapshot.nombre}» no tiene proceso: no se puede armar el checklist`));
    return [];
  }
  const cal = Ficha.calendario(ficha, line.inicio);
  if (!cal.rango) { out.push(issue('line.ficha.inicio', `${path}.inicio`, 'La línea no tiene una fecha de inicio válida')); return []; }
  const status = (workspace.statusIds && workspace.statusIds[0]) || 'briefing';
  // El tipo de tarjeta del entregable, si el tablero lo tiene; si no, «other».
  const otro = workspace.typeIds ? (workspace.typeIds.includes('other') ? 'other' : workspace.typeIds[0] || 'other') : 'other';
  const tipoDe = (t) => (t && (!workspace.typeIds || workspace.typeIds.includes(t)) ? t : otro);
  const porEntregable = new Map(ficha.entregables.map((e, i) => [e.id, i]));
  return cal.entregas.map((x) => {
    const workItemKey = ids.workItemKey(sale.id, line.lineId, `f-${x.entregableId}`, x.n);
    if (context.today && compareYmd(x.fecha, context.today) < 0) {
      out.push(issue('work_item.session_in_past', path, `«${x.nombre}» ${x.n}/${x.total}: la fecha ${x.fecha} ya pasó`, 'warning'));
    }
    const titulo = x.total > 1 ? `${x.nombre} ${x.n}/${x.total}` : x.nombre;
    return {
      workItemKey,
      lineIndex,
      templateIndex: porEntregable.get(x.entregableId),
      occurrence: x.n,
      occurrences: x.total,
      lineId: line.lineId,
      serviceId: line.serviceId,
      serviceName: line.snapshot.nombre,
      quantity: 1,
      templateId: `f-${x.entregableId}`,
      templateVersion: ficha.version,
      label: x.nombre,
      title: clip(`${client.name} · ${titulo}`),
      type: tipoDe(x.tipo),
      initialStatus: status,
      priority: 'medium',
      tags: [clip(line.snapshot.nombre, 40)],
      workspaceId: workspace.id,
      memberIds: uniqSorted(workspace.memberIds),
      clientId: client.id,
      clientName: client.name,
      startDate: line.inicio,
      sessionDate: x.fecha,
      deadline: x.fecha,
      detalle: x.detalle || '',
      strategy: 'separate',
      groupKey: 'ficha',
      checklist: ficha.proceso.map(p => ({ id: ids.checklistItemId(workItemKey, p.id, 0), text: clip(p.texto) })),
    };
  });
}

function expandLine(sale, line, lineIndex, context, out, resolved) {
  const path = `sale.lines[${lineIndex}]`;
  if (line.ficha) return expandFichaLine(sale, line, lineIndex, context, out, resolved);
  const plan = line.executionPlan;
  if (!plan) {
    out.push(issue('line.no_plan', path, `«${line.snapshot.nombre}» se vendió sin plantilla operativa: no genera trabajo`, 'warning'));
    return [];
  }
  if (!plan.enabled) {
    out.push(issue('line.plan_disabled', path, `«${line.snapshot.nombre}» tiene la producción deshabilitada: no genera trabajo`, 'warning'));
    return [];
  }
  const workspace = resolveWorkspace(plan, context, `${path}.executionPlan`, out);
  if (!workspace) return [];
  // El cliente se resuelve una vez por tablero: un enlace faltante es un solo
  // error, no uno por línea.
  if (!resolved.has(workspace.id)) resolved.set(workspace.id, resolveClient(sale, workspace.id, context, 'sale', out));
  const client = resolved.get(workspace.id);
  if (!client) return [];

  const items = [];
  plan.templates.forEach((tpl, tplIndex) => {
    const tp = `${path}.executionPlan.templates[${tplIndex}]`;
    const qty = line.quantity;
    const needsInteger = tpl.quantityMode === 'expand_checklist' || tpl.quantityMode === 'repeat_schedule';
    if (needsInteger && !Number.isInteger(qty)) {
      out.push(issue('line.quantity.not_integer', `${path}.quantity`, `La cantidad debe ser entera para el bloque «${tpl.label}»`));
      return;
    }
    const units = tpl.quantityMode === 'expand_checklist' ? qty : 1;
    if (units > LIMITS.expandedUnits) {
      out.push(issue('line.quantity.too_many_units', `${path}.quantity`, `Máximo ${LIMITS.expandedUnits} unidades por bloque`));
      return;
    }
    const perSale = tpl.recurrence ? tpl.recurrence.count : 1;
    const occurrences = tpl.quantityMode === 'repeat_schedule' ? perSale * qty : perSale;
    if (occurrences > LIMITS.occurrences) {
      out.push(issue('line.occurrences.too_many', `${path}.quantity`, `El bloque «${tpl.label}» generaría ${occurrences} ocurrencias (máximo ${LIMITS.occurrences})`));
      return;
    }
    if (workspace.statusIds && !workspace.statusIds.includes(tpl.initialStatus)) {
      out.push(issue('template.status.unknown', `${tp}.initialStatus`, `La columna «${tpl.initialStatus}» no existe en el tablero de destino`));
      return;
    }
    if (workspace.typeIds && !workspace.typeIds.includes(tpl.type)) {
      out.push(issue('template.type.unknown', `${tp}.type`, `El tipo «${tpl.type}» no existe en el tablero de destino; FRAME lo mostrará como «Otro»`, 'warning'));
    }

    const sched = tpl.schedule;
    const needsDelivery = sched.sessionAnchor === 'delivery_date' || sched.deadlineAnchor === 'delivery_date';
    if (needsDelivery && !isValidYmd(sale.entrega)) {
      out.push(issue('sale.entrega.required', 'sale.entrega', `El bloque «${tpl.label}» se programa desde la fecha de entrega, y la venta no la tiene`));
      return;
    }
    let dates;
    try {
      const sessionBase = addDays(sched.sessionAnchor === 'sale_date' ? sale.fecha : sale.entrega, sched.sessionOffsetDays);
      dates = Array.from({ length: occurrences }, (_, occ) => {
        const sessionDate = stepDate(sessionBase, tpl.recurrence, occ);
        const deadline = sched.deadlineAnchor === 'delivery_date'
          ? addDays(sale.entrega, sched.deadlineOffsetDays)
          : addDays(sessionDate, sched.deadlineOffsetDays);
        return { sessionDate, deadline };
      });
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
      out.push(issue('work_item.date_out_of_range', tp, `Las fechas del bloque «${tpl.label}» quedan fuera del rango válido`));
      return;
    }

    for (let occ = 0; occ < occurrences; occ += 1) {
      const { sessionDate, deadline } = dates[occ];
      const workItemKey = ids.workItemKey(sale.id, line.lineId, tpl.templateId, occ + 1);
      const vars = {
        cliente: client.name,
        servicio: line.snapshot.nombre,
        cantidad: qty,
        unidad: line.snapshot.unidad || '',
        ocurrencia: occ + 1,
        ocurrencias: occurrences,
        venta: `#${sale.n}`,
        fecha: sessionDate,
      };
      if (compareYmd(sessionDate, deadline) > 0) {
        out.push(issue('work_item.session_after_deadline', tp,
          `«${tpl.label}» ${occ + 1}/${occurrences}: la fecha de trabajo ${sessionDate} queda después de la fecha límite ${deadline}`, 'warning'));
      }
      if (context.today && compareYmd(sessionDate, context.today) < 0) {
        out.push(issue('work_item.session_in_past', tp, `«${tpl.label}» ${occ + 1}/${occurrences}: la fecha de trabajo ${sessionDate} ya pasó`, 'warning'));
      }
      const checklist = [];
      tpl.checklist.forEach(item => {
        if (item.perUnit) {
          for (let u = 1; u <= units; u += 1) {
            const suffix = units > 1 ? ` (${u}/${units})` : '';
            checklist.push({ id: ids.checklistItemId(workItemKey, item.itemId, u), text: clip(`${render(item.text, vars)}${suffix}`) });
          }
        } else {
          checklist.push({ id: ids.checklistItemId(workItemKey, item.itemId, 0), text: clip(render(item.text, vars)) });
        }
      });
      items.push({
        workItemKey,
        lineIndex,
        templateIndex: tplIndex,
        occurrence: occ + 1,
        occurrences,
        lineId: line.lineId,
        serviceId: line.serviceId,
        serviceName: line.snapshot.nombre,
        quantity: qty,
        templateId: tpl.templateId,
        templateVersion: plan.version,
        label: tpl.label,
        title: clip(render(tpl.title, vars)),
        type: tpl.type,
        initialStatus: tpl.initialStatus,
        priority: tpl.priority,
        tags: [...tpl.tags],
        workspaceId: workspace.id,
        memberIds: uniqSorted(workspace.memberIds),
        clientId: client.id,
        clientName: client.name,
        sessionDate,
        deadline,
        strategy: plan.grouping.strategy,
        groupKey: plan.grouping.groupKey,
        checklist,
      });
    }
  });
  return items;
}

function buildPackage(sale, key, items, eventId) {
  const first = items[0];
  const multi = items.length > 1;
  const labels = [...new Set(items.map(i => i.label))];
  const checklist = [];
  items.forEach(item => {
    item.checklist.forEach(c => checklist.push({ id: c.id, text: multi ? clip(`${item.label} · ${c.text}`) : c.text, done: false }));
  });
  const lineIds = uniqSorted(items.map(i => i.lineId));
  const lineSummary = [];
  sale.lines.forEach(line => {
    if (lineIds.includes(line.lineId)) lineSummary.push(`${line.snapshot.nombre} ×${line.quantity}`);
  });
  const task = {
    id: ids.taskDocId(key),
    title: multi ? clip(`${first.clientName} · ${labels.join(' + ')}`) : first.title,
    client: first.clientName,
    clientId: first.clientId,
    type: first.type,
    status: first.initialStatus,
    priority: items.reduce((best, i) => (PRIORITY_RANK[i.priority] > PRIORITY_RANK[best] ? i.priority : best), first.priority),
    assignees: [],
    // Con ficha: el inicio del paquete que eligió la venta.
    startDate: first.startDate || sale.fecha,
    sessionDate: first.sessionDate,
    // El compromiso de la tarjeta es el más temprano de sus entregables. Cada
    // unidad conserva el suyo en sourceWorkItems.
    deadline: items.map(i => i.deadline).sort()[0],
    tags: uniqSorted(['loopa', ...items.flatMap(i => i.tags)]),
    cover: { type: 'color', value: 'var(--surface-2)' },
    description: [
      { type: 'p', text: `Generado desde la venta #${sale.n} de LOOPA.` },
      { type: 'b', text: 'Servicios vendidos' },
      { type: 'ul', items: lineSummary },
      ...(first.detalle && !multi ? [{ type: 'b', text: 'Detalle' }, { type: 'p', text: first.detalle }] : []),
    ],
    checklist,
    deliverables: [],
    timeline: [],
    comments: [],
    // Producción interna: no se publica en el portal del cliente hasta que
    // alguien lo decida (ADR-0001, decisión D5).
    clientVisible: false,
    workspaceId: first.workspaceId,
    workspaceIds: [first.workspaceId],
    viewerIds: first.memberIds,
    sourceSystem: 'loopa',
    sourceSaleId: sale.id,
    sourceSaleNumber: sale.n,
    sourceSaleStatus: sale.status,
    sourceLineIds: lineIds,
    sourceEventId: eventId || null,
    sourceTemplateVersions: uniqSorted(items.map(i => `${i.serviceId}#${i.templateId}@${i.templateVersion}`)),
    sourceWorkItems: items.map(i => ({
      workItemKey: i.workItemKey,
      lineId: i.lineId,
      serviceId: i.serviceId,
      templateId: i.templateId,
      templateVersion: i.templateVersion,
      occurrence: i.occurrence,
      occurrences: i.occurrences,
      sessionDate: i.sessionDate,
      deadline: i.deadline,
    })),
    idempotencyKey: key,
    integration: { schemaVersion: SCHEMA_VERSION, generatedFingerprint: '' },
  };
  task.integration.generatedFingerprint = contentFingerprint(task);
  return task;
}

// Cuánto trabajo generaría la venta, calculado sin expandir nada: así una
// venta desmesurada se rechaza en milisegundos, no después de hashear miles
// de ítems (y antes de agotar el lease del worker).
function estimateWork(sale) {
  let workItems = 0;
  let checklistItems = 0;
  sale.lines.forEach(line => {
    if (line.ficha) {
      const f = Ficha.normalizarFicha(line.ficha);
      const n = Ficha.calendario(f, line.inicio).entregas.length;
      workItems += n;
      checklistItems += n * f.proceso.length;
      return;
    }
    const plan = line.executionPlan;
    if (!plan || !plan.enabled) return;
    const qty = Number.isInteger(line.quantity) ? line.quantity : 1;
    plan.templates.forEach(t => {
      const occ = (t.recurrence ? t.recurrence.count : 1) * (t.quantityMode === 'repeat_schedule' ? qty : 1);
      const units = t.quantityMode === 'expand_checklist' ? qty : 1;
      const perOcc = t.checklist.reduce((n, item) => n + (item.perUnit ? units : 1), 0);
      workItems += occ;
      checklistItems += occ * perOcc;
    });
  });
  return { workItems, checklistItems };
}

const sortItems = (a, b) => a.lineIndex - b.lineIndex || a.templateIndex - b.templateIndex || a.occurrence - b.occurrence;

/**
 * @param {object} sale     venta normalizada (contracts.validateSale)
 * @param {object} context  { today, defaultWorkspaceId, allowedWorkspaceIds, workspaces, clients }
 * @param {object} [opts]   { eventId }
 * @returns {{ status, saleId, saleRevision, issues, workItems, groups, tasks }}
 */
function planSale(sale, context, opts = {}) {
  const issues = validateSale(sale);
  const base = { saleId: sale && sale.id, saleRevision: sale && sale.revision, issues, workItems: [], groups: [], tasks: [] };
  if (hasErrors(issues)) return { status: 'blocked', ...base };
  if (sale.status !== 'confirmed') {
    issues.push(issue('sale.status.not_plannable', 'sale.status', `Sólo una venta confirmada genera producción (estado actual: ${sale.status})`));
    return { status: 'blocked', ...base };
  }

  const budget = estimateWork(sale);
  if (budget.workItems > LIMITS.workItemsPerSale || budget.checklistItems > LIMITS.checklistItemsPerSale) {
    issues.push(issue('sale.too_much_work', 'sale',
      `La venta generaría ${budget.workItems} unidades y ${budget.checklistItems} ítems de checklist (máximo ${LIMITS.workItemsPerSale} y ${LIMITS.checklistItemsPerSale})`));
    return { status: 'blocked', ...base };
  }

  const workItems = [];
  const resolved = new Map();
  sale.lines.forEach((line, i) => workItems.push(...expandLine(sale, line, i, context, issues, resolved)));
  if (hasErrors(issues)) return { status: 'blocked', ...base };
  workItems.sort(sortItems);

  const groups = new Map();
  workItems.forEach(item => {
    const key = item.strategy === 'client_day_package'
      ? ids.packageKey(sale.id, item.workspaceId, item.clientId, item.sessionDate, item.groupKey)
      : ids.separateKey(item.workItemKey);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const tasks = [];
  groups.forEach((items, key) => {
    const task = buildPackage(sale, key, items, opts.eventId);
    if (task.checklist.length > LIMITS.packageChecklist) {
      issues.push(issue('package.checklist.too_large', `package ${task.sessionDate}`,
        `La tarjeta del ${task.sessionDate} juntaría ${task.checklist.length} ítems (máximo ${LIMITS.packageChecklist}). Dividí la plantilla o usá otro groupKey.`));
    }
    validateGeneratedTask(task, `package ${task.sessionDate}`)
      .filter(i => i.code !== 'task.checklist.size' || task.checklist.length === 0)
      .forEach(i => issues.push(i));
    tasks.push(task);
  });
  if (tasks.length > LIMITS.tasksPerSale) {
    issues.push(issue('sale.too_many_tasks', 'sale', `La venta generaría ${tasks.length} tarjetas (máximo ${LIMITS.tasksPerSale})`));
  }
  if (hasErrors(issues)) return { status: 'blocked', ...base };

  tasks.sort((a, b) => compareYmd(a.sessionDate, b.sessionDate) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    status: tasks.length ? 'ready' : 'nothing_to_do',
    ...base,
    workItems: workItems.map(({ memberIds, checklist, ...rest }) => ({ ...rest, checklistCount: checklist.length })),
    groups: tasks.map(t => ({ taskId: t.id, idempotencyKey: t.idempotencyKey, workItemKeys: t.sourceWorkItems.map(w => w.workItemKey) })),
    tasks,
  };
}

// ── Diferencia contra lo que ya existe en FRAME ───────────────────
// Nunca propone borrar. Clasifica cada tarjeta:
//   create            — falta; se puede crear
//   unchanged         — existe y coincide
//   edited_same_plan  — alguien la editó, pero el plan no cambió: se respeta
//   update_pristine   — el plan cambió y nadie la tocó: actualizable SÓLO con resync explícito
//   conflict_started  — el plan cambió y ya hay trabajo: requiere decisión humana
//   conflict_split    — el plan cambió, nadie la tocó, pero actualizarla le
//                       quitaría unidades de trabajo (se mudan a otro día): se
//                       deja como está y se pide decisión humana
//   relocated         — el plan la quiere en otro día/tarjeta, pero sus unidades de
//                       trabajo ya viven en una tarjeta existente: crearla duplicaría
//                       trabajo, así que requiere decisión humana (mover o conservar)
//   foreign           — el id está ocupado por otra cosa (no se toca)
//   orphaned          — existe para esta venta pero el plan ya no la incluye (no se borra)
//
// La identidad del trabajo es la unidad (workItemKey), no la tarjeta: una
// unidad nunca puede quedar en dos tarjetas.
function diffPlan(plannedTasks, existingTasks) {
  const existingById = new Map((existingTasks || []).map(t => [t.id, t]));
  const holderOf = new Map();
  (existingTasks || []).forEach(t => (t.sourceWorkItems || []).forEach(w => holderOf.set(w.workItemKey, t.id)));
  const accounted = new Set();
  const entries = plannedTasks.map(planned => {
    const existing = existingById.get(planned.id);
    // Unidades de esta tarjeta que ya viven en OTRA tarjeta existente.
    const heldElsewhere = [...new Set(planned.sourceWorkItems
      .map(w => holderOf.get(w.workItemKey))
      .filter(id => id && id !== planned.id))].sort();
    heldElsewhere.forEach(id => accounted.add(id));
    if (existing) accounted.add(planned.id);
    if (heldElsewhere.length) return { taskId: planned.id, action: 'relocated', heldBy: heldElsewhere };
    if (!existing) return { taskId: planned.id, action: 'create' };
    if (existing.idempotencyKey !== planned.idempotencyKey) return { taskId: planned.id, action: 'foreign' };
    const generated = existing.integration && existing.integration.generatedFingerprint;
    const pristine = isPristine(existing);
    const samePlan = generated === planned.integration.generatedFingerprint;
    if (samePlan) return { taskId: planned.id, action: pristine ? 'unchanged' : 'edited_same_plan' };
    if (!pristine) return { taskId: planned.id, action: 'conflict_started' };
    const plannedItems = new Set(workItemsOf(planned));
    const dropped = workItemsOf(existing).filter(k => !plannedItems.has(k));
    if (dropped.length) return { taskId: planned.id, action: 'conflict_split', dropped };
    return { taskId: planned.id, action: 'update_pristine' };
  });
  existingById.forEach(task => { if (!accounted.has(task.id)) entries.push({ taskId: task.id, action: 'orphaned' }); });
  const counts = {};
  entries.forEach(e => { counts[e.action] = (counts[e.action] || 0) + 1; });
  return { entries, counts };
}

module.exports = { planSale, diffPlan, taskContent, contentFingerprint, isPristine, workItemsOf, estimateWork, render };
