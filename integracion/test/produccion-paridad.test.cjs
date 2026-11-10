'use strict';
// Fase 2 — paridad del núcleo de Producción contra el código REAL de FRAME.
//
// Se ejecuta el data.jsx de FRAME en una máquina virtual (con "hoy" fijo) y se
// extraen literalmente los fragmentos de lógica del calendario (views.jsx) y
// del carry-over (app.jsx). Si FRAME cambia esa lógica, estas pruebas fallan y
// obligan a revisar el port.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../../_fuente/produccion/nucleo.js');

const FRAME = process.env.FRAME_REPO || 'C:\\Users\\ANGEL M\\Documents\\Codex\\2026-08-10\\realtime-voice-chat\\work\\frame-studio-manager';
const hasFrame = fs.existsSync(path.join(FRAME, 'data.jsx'));
// Sin FRAME las pruebas de paridad se SALTEAN (visible en el reporte). Con
// REQUIRE_FRAME=1 fallan: así corre la verificación antes de aceptar un cambio.
if (!hasFrame && process.env.REQUIRE_FRAME === '1') throw new Error(`REQUIRE_FRAME=1 y no está FRAME en ${FRAME}`);
const skip = hasFrame ? false : 'No se encontró el repositorio de FRAME (FRAME_REPO): paridad SIN verificar';
const read = (f) => fs.readFileSync(path.join(FRAME, f), 'utf8');

// "Hoy" fijo: 2026-11-10 al mediodía local, sea cual sea la zona del equipo.
const FIXED = new Date(2026, 10, 10, 12, 0, 0).getTime();
const TODAY = '2026-11-10';

function loadFrame() {
  class FixedDate extends Date {
    constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
    static now() { return FIXED; }
  }
  const ctx = { window: {}, setInterval: () => 0, console, Date: FixedDate, Intl, Math, JSON, Set, Map, Array, Object, String, Number, FrameAttachments: { normalizeRemoteImageUrl: x => x } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${read('data.jsx')}\n;this.__api = { normalizeProject, isClosed, isUrgent, isOverdue, needsAttention, progressOf, boardOf, daysUntil, localISO };`, ctx);
  return ctx;
}

// Generador determinista de tareas con todas las formas raras que FRAME tolera.
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function genTasks(n, seed = 7) {
  const r = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  // Incluye fechas inválidas que FRAME también trata como inválidas.
  const date = () => pick(['', undefined, P.addDays(TODAY, Math.floor(r() * 21) - 10), P.addDays(TODAY, Math.floor(r() * 21) - 10), '2026-11-00', '2026-13-01', '2026-00-10']);
  return Array.from({ length: n }, (_, i) => {
    const t = { id: `p${i}` };
    const status = pick(['briefing', 'producing', 'delivered', 'archived', 'review', 'custom-done', 'custom-open', undefined]);
    if (status !== undefined) t.status = status;
    ['title', 'client', 'type', 'priority', 'currency'].forEach(k => { if (r() < 0.7) t[k] = `${k}-${i}`; });
    ['deadline', 'sessionDate', 'startDate'].forEach(k => { const v = date(); if (v !== undefined) t[k] = v; });
    if (r() < 0.8) t.checklist = Array.from({ length: Math.floor(r() * 5) }, (_, j) => ({ id: `c${j}`, text: 'x', done: r() < 0.5 }));
    if (r() < 0.5) t.workspaceIds = pick([['w1'], ['w1', 'w1', ''], [], ['w2', 'w1']]);
    if (r() < 0.5) t.workspaceId = pick(['w1', 'w2', '']);
    if (r() < 0.4) t.viewerIds = pick([['u1', 'u1'], [], ['u2', null, 'u3']]);
    if (r() < 0.3) t.budget = pick([100, '100', null]);
    if (r() < 0.3) t.clientVisible = pick([false, true, 'no']);
    if (r() < 0.3) t.cover = pick([null, { type: 'image', value: 'x' }, 'string']);
    if (r() < 0.3) t.tags = pick([['a'], 'no-array']);
    return t;
  });
}
const COLUMN_SETS = [
  undefined,
  [{ id: 'briefing' }, { id: 'producing' }, { id: 'delivered' }],
  [{ id: 'briefing', isDone: false }, { id: 'custom-done', isDone: true, requiresChecklist: false }, { id: 'delivered', isDone: false }],
  [{ id: 'custom-open', isDone: false, requiresChecklist: true }, { id: 'delivered', isDone: true }],
];

test('paridad: normalizeProject de FRAME ≡ normalizeTask', { skip }, () => {
  const { __api: F } = loadFrame();
  genTasks(400).forEach(t => {
    assert.deepEqual(JSON.parse(JSON.stringify(P.normalizeTask(t, TODAY))), JSON.parse(JSON.stringify(F.normalizeProject(t))), t.id);
  });
  assert.equal(F.localISO(new Date(FIXED)), TODAY, 'el "hoy" de FRAME en la VM es el de la prueba');
});

test('paridad: cierre, urgencia, vencimiento, atención, progreso y tablero', { skip }, () => {
  const ctx = loadFrame();
  const F = ctx.__api;
  COLUMN_SETS.forEach((cols, k) => {
    ctx.window.FRAME_KANBAN_COLUMNS = cols;
    genTasks(300, 11 + k).forEach(raw => {
      [raw, P.normalizeTask(raw, TODAY)].forEach(t => {
        const where = `${t.id} columnas#${k}`;
        assert.equal(P.isClosed(t, cols), F.isClosed(t), `isClosed ${where}`);
        assert.equal(P.isUrgent(t, TODAY, cols), F.isUrgent(t), `isUrgent ${where}`);
        assert.equal(P.isOverdue(t, TODAY, cols), F.isOverdue(t), `isOverdue ${where}`);
        assert.equal(P.needsAttention(t, TODAY, cols), F.needsAttention(t), `needsAttention ${where}`);
        assert.equal(P.progressOf(t), F.progressOf(t), `progressOf ${where}`);
        // Los arreglos de la VM son de otro realm: se comparan por valor.
        assert.deepEqual(P.boardOf(t), JSON.parse(JSON.stringify(F.boardOf(t))), `boardOf ${where}`);
        if (t.deadline) assert.equal(P.daysUntil(t.deadline, TODAY), F.daysUntil(t.deadline), `daysUntil ${where}`);
      });
    });
  });
});

// Extrae el cuerpo literal de un fragmento de FRAME entre dos marcas.
function snippet(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `No se encontró en FRAME: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `No se encontró el fin del fragmento: ${end}`);
  return src.slice(a + start.length, b);
}

test('paridad: grilla del mes y tareas por día (views.jsx de FRAME)', { skip }, () => {
  const views = read('views.jsx');
  // eslint-disable-next-line no-new-func
  const frameGrid = new Function('year', 'month', snippet(views, 'const monthGrid = useMemo(() => {', '}, [year, month]);'));
  // eslint-disable-next-line no-new-func
  const frameByDate = new Function('projects', snippet(views, 'const projectsByDate = useMemo(() => {', '}, [projects]);'));
  for (let y = 2025; y <= 2028; y += 1) {
    for (let m = 0; m < 12; m += 1) {
      assert.deepEqual(P.monthGrid(y, m), frameGrid(y, m).map(d => P.localISO(d)), `${y}-${m + 1}`);
    }
  }
  const tasks = genTasks(200, 99);
  tasks.push({ ...tasks[0] }); // duplicado: FRAME no lo repite en el día
  const mine = P.tasksByDate(tasks);
  const theirs = frameByDate(tasks);
  assert.deepEqual(Object.keys(mine).sort(), Object.keys(theirs).sort());
  Object.keys(theirs).forEach(k => assert.deepEqual(mine[k].map(t => t.id), [...theirs[k]].map(t => t.id), k));
});

test('paridad: candidatos de carry-over (app.jsx de FRAME)', { skip }, () => {
  const ctx = loadFrame();
  const app = read('app.jsx');
  const body = snippet(app, 'const toUpdate = state.projects.filter(p => {', '\n    });');
  ctx.__body = body;
  vm.runInContext('this.__frameFilter = new Function("p", "today", "progressOf", "isClosed", this.__body);', ctx);
  COLUMN_SETS.forEach((cols, k) => {
    ctx.window.FRAME_KANBAN_COLUMNS = cols;
    const tasks = genTasks(300, 31 + k).map(t => P.normalizeTask(t, TODAY));
    const theirs = tasks.filter(p => ctx.__frameFilter(p, TODAY, ctx.__api.progressOf, ctx.__api.isClosed)).map(p => p.id);
    assert.deepEqual(P.carryOverCandidates(tasks, TODAY, cols), [...theirs], `columnas#${k}`);
    assert.ok(theirs.length > 0, 'el caso de prueba tiene candidatos reales');
  });
});

test('paridad: candidatos de carry-over del SERVIDOR (functions/index.js de FRAME)', { skip }, () => {
  const fn = read('functions/index.js');
  const cols = snippet(fn, 'const completedStatuses = new Set(', "completedStatuses.add('delivered');");
  const body = snippet(fn, 'const data = task.data();', 'continue;');
  // Se reproduce el bucle del servidor con su código literal: el fragmento
  // termina en `if (...)`, así que le sigue `continue;` como en el original.
  // eslint-disable-next-line no-new-func
  const server = new Function('columns', 'tasks', 'today', [
    `const completedStatuses = new Set(${cols}completedStatuses.add('delivered');`,
    'const out = [];',
    `for (const task of tasks) { const data = task; ${body}continue; out.push(task.id); }`,
    'return out;',
  ].join('\n'));
  const extra = [
    [{ id: 'briefing', isDone: false }, { id: 'done2', isDone: true }],
    [{ id: 'briefing', isDone: 'yes' }],
  ];
  [...COLUMN_SETS, ...extra].forEach((cols2, k) => {
    // El servidor lee los documentos tal cual (sin normalizar).
    const tasks = genTasks(300, 51 + k);
    tasks.push({ id: 'casi', status: 'producing', sessionDate: '2026-11-01', checklist: Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, done: i > 0 })) });
    // Como en functions/index.js: `columnConfig.data()?.columns || []`.
    assert.deepEqual(P.carryOverCandidatesServidor(tasks, TODAY, cols2), [...server(cols2 || [], tasks, TODAY)], `servidor columnas#${k}`);
  });
});

test('divergencias documentadas entre las dos reglas de FRAME', () => {
  const casi = { id: 'casi', status: 'producing', sessionDate: '2026-11-01', checklist: Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, done: i > 0 })) };
  assert.deepEqual(P.carryOverCandidates([casi], TODAY), [], 'navegador: 199/200 redondea a 100%');
  assert.deepEqual(P.carryOverCandidatesServidor([casi], TODAY), ['casi'], 'servidor: queda un ítem sin hacer');
  const entregada = { id: 'e', status: 'delivered', sessionDate: '2026-11-01', checklist: [{ id: 'a', done: false }] };
  const cols = [{ id: 'briefing', isDone: false }, { id: 'done2', isDone: true }];
  assert.deepEqual(P.carryOverCandidates([entregada], TODAY, cols), []);
  assert.deepEqual(P.carryOverCandidatesServidor([entregada], TODAY, cols), ['e']);
});

test('fechas estrictas: LOOPA no "arregla" días imposibles (FRAME sí, por V8)', () => {
  // V8 convierte 2026-02-30 en 2026-03-02 y FRAME lo hereda. LOOPA lo trata
  // como inválido: una entrega imposible se muestra como dato a corregir.
  assert.equal(P.isDay('2026-02-30'), false);
  assert.ok(Number.isNaN(P.daysUntil('2026-02-30', TODAY)));
  assert.equal(P.addDays('2026-02-30', 1), '');
  ['2026-11-00', '2026-13-01', '2026-00-10', '26-1-1', null].forEach(d => assert.equal(P.isDay(d), false, String(d)));
  assert.equal(P.addDays('0099-01-01', 1), '0099-01-02', 'años de cuatro cifras sin reinterpretar');
  assert.equal(P.isOverdue({ status: 'producing', deadline: '2026-11-00' }, TODAY), false);
});

test('paridad: semana de lunes a domingo (views.jsx de FRAME)', { skip }, () => {
  const views = read('views.jsx');
  // eslint-disable-next-line no-new-func
  const frameWeek = new Function('refDate', `${snippet(views, "if (mode === 'week') {", 'const sameMonth')} return weekStart;`);
  for (let i = 0; i < 800; i += 1) {
    const iso = P.addDays('2025-01-01', i);
    const [y, m, d] = iso.split('-').map(Number);
    assert.equal(P.weekOf(iso)[0], P.localISO(frameWeek(new Date(y, m - 1, d))), iso);
  }
});

test('núcleo: reprogramar mueve sólo sessionDate; la venta queda enlazada', () => {
  const t = { id: 'x', sessionDate: '2026-11-10', deadline: '2026-11-20', sourceSystem: 'loopa', sourceSaleId: 's1', sourceSaleNumber: 1042, sourceSaleStatus: 'cancelled' };
  assert.deepEqual(P.reschedule(t, '2026-11-12'), { ...t, sessionDate: '2026-11-12' });
  assert.deepEqual(P.saleLinkOf(t), { saleId: 's1', n: 1042, cancelled: true });
  assert.equal(P.saleLinkOf({ id: 'manual' }), null);
  assert.deepEqual(P.weekOf('2026-11-12'), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
});

// ── Tanda 2.3: edición ────────────────────────────────────────────

test('paridad: columnas del tablero (boardColumns de FRAME)', { skip }, () => {
  const ctx = loadFrame();
  vm.runInContext('this.__bc = boardColumns;', ctx);
  COLUMN_SETS.forEach((cols, k) => {
    const tasks = genTasks(120, 71 + k).map(t => P.normalizeTask(t, TODAY));
    const theirs = JSON.parse(JSON.stringify(ctx.__bc(cols, tasks)));
    assert.deepEqual(JSON.parse(JSON.stringify(P.boardColumns(cols, tasks))), theirs, `columnas#${k}`);
  });
});

test('paridad: bloqueo al cambiar de estado con checklist incompleto (app.jsx de FRAME)', { skip }, () => {
  const ctx = loadFrame();
  const app = read('app.jsx');
  const cond = snippet(app, 'if (prev && requiresChecklistForStatus(project.status)', ') {');
  // Se usan las funciones REALES de data.jsx (requiresChecklistForStatus y
  // progressOf), que leen window.FRAME_KANBAN_COLUMNS como en FRAME.
  ctx.__cond = `return !!(prev && requiresChecklistForStatus(project.status)${cond});`;
  vm.runInContext('this.__guard = new Function("prev", "project", this.__cond);', ctx);
  const statuses = ['briefing', 'producing', 'delivered', 'custom-done', 'custom-open', 'archived'];
  COLUMN_SETS.forEach((cols, k) => {
    ctx.window.FRAME_KANBAN_COLUMNS = cols;
    genTasks(200, 91 + k).map(t => P.normalizeTask(t, TODAY)).forEach((prev, i) => {
      // Cambia el estado y, en dos de cada tres casos, también el checklist
      // (completarlo o desmarcar algo): la regla mira el checklist NUEVO.
      const status = statuses[i % statuses.length];
      const checklist = i % 3 === 0 ? prev.checklist
        : i % 3 === 1 ? prev.checklist.map(c => ({ ...c, done: true }))
          : prev.checklist.map((c, j) => ({ ...c, done: j === 0 ? false : c.done }));
      const next = { ...prev, status, checklist };
      assert.equal(P.statusChangeBlocked(prev, next, cols), ctx.__guard(prev, next), `${prev.id} ${prev.status}→${status} columnas#${k}`);
    });
  });
});

test('edición: reglas de la fusión sobre las de FRAME', () => {
  const venta = { id: 'v', status: 'producing', priority: 'medium', sessionDate: '2026-11-12', deadline: '2026-11-20', sourceSystem: 'loopa', sourceSaleId: 's', checklist: [{ id: 'a', text: 'A', done: false }] };
  const manual = { ...venta, id: 'm', sourceSystem: undefined, sourceSaleId: undefined };
  const err = (t, p) => { const r = P.applyTaskPatch(t, p); return r.ok ? 'ok' : r.error.code; };
  assert.equal(err(venta, { status: 'delivered' }), 'checklist_incomplete');
  assert.equal(err(venta, { ...P.toggleChecklistItem(venta, 'a'), status: 'delivered' }), 'ok', 'completar y entregar en un mismo cambio');
  assert.equal(err(venta, { deadline: '2026-11-25' }), 'deadline_locked', 'la entrega de una venta la fija la venta');
  assert.equal(err(venta, { deadline: '2026-11-20' }), 'ok', 'reenviar el mismo valor no es un cambio');
  assert.equal(err(manual, { deadline: '2026-11-25' }), 'ok', 'una tarea manual sí puede cambiar su entrega');
  assert.equal(err(manual, { deadline: '' }), 'ok');
  assert.equal(err(venta, { sessionDate: '2026-02-30' }), 'session_invalid');
  assert.equal(err(venta, { sourceSaleId: 'otra' }), 'provenance_locked');
  assert.equal(err(venta, { idempotencyKey: 'x' }), 'provenance_locked');
  assert.equal(err(venta, { color: 'rojo' }), 'field_not_editable');
  assert.equal(err(venta, { priority: 'urgentísima' }), 'priority_invalid');
  assert.equal(err(venta, { title: '   ' }), 'title_empty');
  assert.equal(err(venta, { checklist: [{ id: 'a', text: 'A', done: false }, { id: 'a', text: 'B', done: false }] }), 'checklist_invalid');
  const r = P.applyTaskPatch(venta, { sessionDate: '2026-11-15' });
  assert.equal(r.task.deadline, '2026-11-20', 'reprogramar no mueve la entrega');
  assert.equal(venta.sessionDate, '2026-11-12', 'la tarea original no se muta');
  const added = P.applyTaskPatch(venta, P.addChecklistItem(venta, '  Subir a Drive  ', 'c9'));
  assert.deepEqual(added.task.checklist.at(-1), { id: 'c9', text: 'Subir a Drive', done: false });
});

test('edición: entradas inválidas se rechazan y nada se comparte con quien llama', () => {
  const cols = [{ id: 'briefing' }, { id: 'producing' }, { id: 'delivered', isDone: true, requiresChecklist: true }];
  const t = { id: 'x', status: 'briefing', priority: 'medium', sessionDate: '2026-11-12', checklist: [{ id: 'a', text: 'A', done: false }], tags: [] };
  const err = (p) => { const r = P.applyTaskPatch(t, p, cols); return r.ok ? 'ok' : r.error.code; };
  ['', 5, 'zzz', null].forEach(v => assert.equal(err({ status: v }), 'status_invalid', String(v)));
  assert.equal(err({ status: 'archived' }), 'ok', 'archivar siempre es posible');
  assert.equal(err({ status: 'producing' }), 'ok');
  assert.equal(err({ tags: 'x' }), 'tags_invalid');
  assert.equal(err({ assignees: { a: 1 } }), 'assignees_invalid');
  assert.equal(err({ tags: ['ok', 'sí'] }), 'ok');
  [null, undefined, [], 'x', 3].forEach(v => assert.equal(err(v), 'patch_invalid', String(v)));
  assert.equal(err(JSON.parse('{"__proto__": {"x": 1}}')), 'field_not_editable');
  const lista = [{ id: 'a', text: 'A', done: true }];
  const r = P.applyTaskPatch(t, { checklist: lista }, cols);
  assert.notEqual(r.task.checklist, lista);
  assert.notEqual(r.task.checklist[0], lista[0]);
  lista[0].done = false;
  assert.equal(r.task.checklist[0].done, true, 'mutar el arreglo de quien llama no cambia la tarea');
});

// ── Tanda 2.4: rutina y resumen ──────────────────────────────────

function genRoutine(seed) {
  const r = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const tasks = Array.from({ length: Math.floor(r() * 5) }, (_, i) => ({ id: `t${i}`, text: `rutina ${i}` }));
  const checks = Object.fromEntries(tasks.filter(() => r() < 0.5).map(t => [t.id, true]));
  const debt = Object.fromEntries(tasks.filter(() => r() < 0.4).map(t => [t.id, 1 + Math.floor(r() * 3)]));
  // Historial con huecos, a veces desordenado, a veces de más de 60 días y
  // con fechas repetidas de valores distintos (el bug viejo de FRAME).
  const n = pick([0, 3, 9, 30, 70]);
  let offset = 0;
  let history = Array.from({ length: n }, () => {
    offset += 1 + (r() < 0.3 ? Math.floor(r() * 4) : 0);
    const total = Math.floor(r() * 4);
    return { date: P.addDays(TODAY, -offset), completed: r() < 0.6 ? total : Math.floor(r() * (total + 1)), total };
  });
  if (r() < 0.3) history = history.map((e, i) => ({ e, k: (i * 7919 + seed) % 13 })).sort((a, b) => a.k - b.k).map(x => x.e);
  if (r() < 0.4 && history.length) history.splice(Math.floor(r() * history.length), 0, { ...pick(history), completed: 0, total: 9 });
  const todayDate = pick([TODAY, P.addDays(TODAY, -1), P.addDays(TODAY, -1 - Math.floor(r() * 9)), P.addDays(TODAY, 2), 'garbage', '2026-02-30', undefined]);
  if (r() < 0.2 && history.length && todayDate && P.isDay(todayDate)) history.push({ date: todayDate, completed: 1, total: 1 }); // el día ya está en el historial
  return { tasks, today: todayDate === undefined ? undefined : { date: todayDate, checks, debt }, history, config: { carryOver: r() < 0.5 } };
}

test('paridad: rutina — historial, cambio de día, deuda y racha (routine.jsx de FRAME)', { skip }, () => {
  const ctx = loadFrame();
  const src = read('routine.jsx');
  const dedupe = snippet(src, 'const seen = new Set();', 'if (cleanHistory.length');
  const roll = snippet(src, 'const prevCompleted', 'ref.update({');
  const streak = snippet(src, 'const perfect = new Set(', '}, [history, allDone, total, todayISO]);');
  ctx.__dedupe = `const seen = new Set();${dedupe} return cleanHistory;`;
  ctx.__roll = `const prevCompleted${roll} return { updatedHist, newDebt };`;
  ctx.__streak = `const perfect = new Set(${streak}`;
  vm.runInContext([
    'this.__fDedupe = new Function("storedHistory", this.__dedupe);',
    'this.__fRoll = new Function("storedTasks", "storedToday", "cleanHistory", "storedCarry", this.__roll);',
    'this.__fStreak = new Function("history", "allDone", "total", "todayISO", this.__streak);',
  ].join('\n'), ctx);
  const casos = { ayer: 0, hueco: 0, futuro: 0, invalido: 0, sinHoy: 0, largo: 0, repetido: 0 };
  for (let seed = 1; seed <= 600; seed += 1) {
    const doc = genRoutine(seed);
    const clean = JSON.parse(JSON.stringify(ctx.__fDedupe(doc.history)));
    assert.deepEqual(P.routineDedupeHistory(doc.history), clean, `dedupe #${seed}`);
    const mine = P.routineRollover(doc, TODAY);
    const prev = doc.today && doc.today.date;
    if (doc.history.length > 60) casos.largo += 1;
    if (!doc.today) {
      casos.sinHoy += 1;
      assert.equal(mine.doc.today.date, TODAY, `sin día guardado #${seed}`);
    } else if (!P.isDay(prev)) {
      // DIVERGENCIA documentada: FRAME metía la fecha basura al historial.
      casos.invalido += 1;
      assert.deepEqual(mine.doc.history, clean, `fecha inválida no toca el historial #${seed}`);
      assert.deepEqual([mine.doc.today.date, mine.doc.today.checks], [TODAY, {}]);
    } else if (prev > TODAY) {
      // DIVERGENCIA documentada: FRAME borraba las marcas de un día "futuro".
      casos.futuro += 1;
      assert.deepEqual(mine.doc.today, { date: prev, checks: doc.today.checks, debt: doc.today.debt }, `reloj adelantado #${seed}`);
      assert.deepEqual(mine.doc.history, clean);
    } else if (prev < TODAY) {
      const theirs = JSON.parse(JSON.stringify(ctx.__fRoll(doc.tasks, doc.today, clean, doc.config.carryOver)));
      const gap = P.daysUntil(TODAY, prev);
      // El día que pasa al historial es el mismo; el resto, deduplicado
      // DESPUÉS de agregarlo (FRAME podía dejar dos entradas con esa fecha).
      assert.deepEqual(mine.doc.history[0], theirs.updatedHist[0], `entrada #${seed}`);
      assert.deepEqual(mine.doc.history, P.routineDedupeHistory([theirs.updatedHist[0], ...clean]).slice(0, 60), `historial #${seed}`);
      if (clean.some(e => e.date === prev)) casos.repetido += 1;
      else if (clean.length < 60) assert.deepEqual(mine.doc.history, theirs.updatedHist, `sin repetidos es idéntico #${seed}`);
      // Deuda: FRAME suma 1 por apertura; LOOPA suma los días transcurridos.
      const esperada = Object.fromEntries(Object.entries(theirs.newDebt).map(([k, v]) => [k, v + gap - 1]));
      assert.deepEqual(mine.doc.today.debt, esperada, `deuda #${seed}`);
      if (gap === 1) { casos.ayer += 1; assert.deepEqual(mine.doc.today.debt, theirs.newDebt, `deuda de ayer idéntica #${seed}`); } else casos.hueco += 1;
    }
    const st = P.routineStats(mine.doc, TODAY);
    assert.equal(st.streak, ctx.__fStreak(mine.doc.history, st.allDone, st.total, TODAY), `racha #${seed}`);
  }
  Object.entries(casos).forEach(([k, v]) => assert.ok(v >= 5, `el generador cubre «${k}» (${v} casos)`));
});

test('rutina: apagar el arrastre limpia la deuda (toggleCarryOver de FRAME)', { skip }, () => {
  const app = read('app.jsx');
  assert.match(app, /if \(!next\) patch\.today = \{ debt: \{\} \};/, 'FRAME limpia la deuda al apagar');
  const doc = P.routineRollover({ tasks: [{ id: 'a', text: 'A' }], today: { date: TODAY, checks: { a: false }, debt: { a: 3 } }, history: [], config: { carryOver: true } }, TODAY).doc;
  const off = P.routineSetCarryOver(doc, false);
  assert.deepEqual([off.config.carryOver, off.today.debt, off.today.checks], [false, {}, { a: false }], 'las marcas se conservan');
  const on = P.routineSetCarryOver(off, true);
  const manana = P.routineRollover(on, P.addDays(TODAY, 1)).doc;
  assert.deepEqual(manana.today.debt, { a: 1 }, 'al volver a encender, la deuda vieja no reaparece');
});

test('rutina: marcar salda la deuda; borrar limpia marca y deuda; nada se muta', () => {
  const doc = P.routineRollover({ tasks: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], today: { date: TODAY, checks: {}, debt: { a: 2, b: 1 } }, history: [], config: { carryOver: true } }, TODAY).doc;
  const t = P.routineToggle(doc, 'a');
  assert.deepEqual([t.today.checks, t.today.debt], [{ a: true }, { b: 1 }]);
  assert.deepEqual(doc.today.debt, { a: 2, b: 1 }, 'el original queda intacto');
  const d = P.routineDeleteTask(t, 'b');
  assert.deepEqual([d.tasks.map(x => x.id), d.today.debt], [['a'], {}]);
  assert.equal(P.routineAddTask(d, '   ', 'z'), d, 'texto vacío no agrega');
  assert.equal(P.routineAddTask(d, 'Otra', 'a'), d, 'id repetido no agrega');
  assert.equal(P.routineAddTask(d, ' Revisar correo ', 'c').tasks.at(-1).text, 'Revisar correo');
  assert.equal(P.routineAssignTask(d, 'a', 'u1').tasks[0].assignee, 'u1');
  assert.equal(P.routineRenameTask(d, 'a', '').tasks[0].text, 'A');
  const perfecto = P.routineToggle(P.routineToggle(doc, 'a'), 'b');
  assert.deepEqual(P.routineStats(perfecto, TODAY), { total: 2, completed: 2, allDone: true, pct: 100, streak: 1 });
});

test('paridad: resumen de producción (analytics.jsx de FRAME, conteos)', { skip }, () => {
  const ctx = loadFrame();
  const src = read('analytics.jsx');
  ctx.__an = [
    `const reportable = projects.filter${snippet(src, 'const reportable = projects.filter', '\n  return (')}`,
    'return { reportable: reportable.length, active: active.length, delivered: delivered.length, urgent: urgent.length, deliveryRate,',
    '  statusGroups: statusGroups.map(s => ({ id: s.id, count: s.count })), typeCounts: typeCounts.map(t => ({ id: t.id, count: t.count })),',
    '  workload: workload.map(w => ({ id: w.id, count: w.count })), topClients: topClients.map(c => ({ name: c.name, count: c.count })),',
    '  months: months.map(m => ({ key: m.key, count: m.count })), upcoming: upcoming.map(p => p.id) };',
  ].join('\n');
  vm.runInContext('this.__fAn = new Function("projects", "clients", "team", "currentUserId", this.__an);', ctx);
  const team = [{ id: 'u1', status: 'active' }, { id: 'u2' }, { id: 'u3', status: 'pending' }, { id: 'u4', status: 'active' }];
  const known = new Set(P.PROJECT_TYPES.map(t => t.id));
  COLUMN_SETS.forEach((cols, k) => {
    ctx.window.FRAME_KANBAN_COLUMNS = cols;
    const r = mulberry32(200 + k);
    // Sólo fechas válidas: FRAME ordena las próximas entregas con new Date()
    // y con una fecha inválida el orden queda indefinido. Fechas únicas para
    // que el orden no dependa del desempate.
    const tasks = genTasks(250, 300 + k)
      .map(t => P.normalizeTask(t, TODAY))
      .filter(t => !t.deadline || P.isDay(t.deadline))
      .map((t, i) => ({
        ...t,
        id: `p${String(i).padStart(4, '0')}`,
        deadline: t.deadline ? P.addDays('2026-06-01', i) : t.deadline,
        assignees: ['u1', 'u2', 'u3', 'u4'].filter(() => r() < 0.3),
        client: ['Aurora', 'Norte', 'Lienzo', ''][i % 4],
        type: ['reel', 'photo', 'reel', 'corp'][i % 4],
      }));
    const theirs = JSON.parse(JSON.stringify(ctx.__fAn(tasks, [], team, 'u1')));
    const mine = P.productionSummary(tasks, cols, team, TODAY);
    ['reportable', 'active', 'delivered', 'urgent', 'deliveryRate'].forEach(f => assert.equal(mine[f], theirs[f], `${f} columnas#${k}`));
    assert.deepEqual(mine.statusGroups.map(s => ({ id: s.id, count: s.count })), theirs.statusGroups, `estados columnas#${k}`);
    assert.deepEqual(mine.typeCounts.map(t => ({ id: known.has(t.id) ? t.id : 'other', count: t.count })), theirs.typeCounts, `tipos columnas#${k}`);
    assert.deepEqual(mine.workload.map(w => ({ id: w.id, count: w.count })), theirs.workload, `carga columnas#${k}`);
    assert.deepEqual(mine.topClients.map(c => ({ name: c.name, count: c.count })), theirs.topClients, `clientes columnas#${k}`);
    assert.deepEqual(mine.months, theirs.months, `meses columnas#${k}`);
    assert.deepEqual(mine.upcoming.map(p => p.id), theirs.upcoming, `próximas columnas#${k}`);
  });
});

test('resumen: clientes por ficha única y entregas inválidas fuera de "próximas"', () => {
  const t = (id, extra) => P.normalizeTask({ id, status: 'producing', type: 'reel', ...extra }, TODAY);
  const s = P.productionSummary([
    t('a', { client: 'Café Aurora', clientId: 'cli-1', deadline: '2026-11-20' }),
    t('b', { client: 'Cafe Aurora', clientId: 'cli-1', deadline: '2026-02-30' }),
    t('c', { client: 'Café Aurora', clientId: 'cli-2', deadline: '2026-11-18' }),
  ], [], [], TODAY);
  assert.deepEqual(s.topClients.map(c => [c.key, c.count]), [['cli-1', 2], ['cli-2', 1]], 'dos fichas homónimas no se mezclan');
  assert.deepEqual(s.upcoming.map(p => p.id), ['c', 'a'], 'la fecha imposible no entra en "próximas"');
});

// ── Tanda 2.5: portal del cliente ─────────────────────────────────

function genPortalTasks(seed, n = 120) {
  const r = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  return genTasks(n, seed).map((t, i) => {
    const x = P.normalizeTask(t, TODAY);
    x.client = pick(['Café Aurora', 'café aurora ', 'Ferretería Norte', 'Otro', '']);
    x.clientVisible = pick([true, true, false]);
    x.type = pick(['reel', 'photo', 'custom-x', 'other', undefined]);
    x.deliverables = Array.from({ length: Math.floor(r() * 4) }, (_, j) => ({
      name: pick(['Master', '', undefined]), kind: pick(['photos', 'video', undefined]),
      url: pick(['https://cdn.example/a.jpg', 'http://inseguro/b.jpg', 'https://x/frame-descriptions/c.png', '', undefined]),
      clientVisible: pick([true, false, undefined]),
    }));
    x.cover = pick([{ type: 'image', value: 'https://cdn.example/a.jpg' }, { type: 'image', value: 'https://x/frame-descriptions/z.png' }, { type: 'color', value: '#000' }, undefined]);
    x.comments = [{ text: 'interno' }];
    x.assignees = ['uid-x'];
    x.budget = 999;
    x.id = `t${String(i).padStart(3, '0')}`;
    return x;
  });
}

test('paridad: proyección pública del portal (buildClientPortalDocument de FRAME)', { skip }, () => {
  const ctx = loadFrame();
  const src = read('portal.jsx');
  ctx.__portal = `const buildClientPortalDocument = ${snippet(src, 'const buildClientPortalDocument = ', '\n// ── Línea de proceso')}\nreturn buildClientPortalDocument;`;
  vm.runInContext('this.__fPortal = (new Function(this.__portal))();', ctx);
  const workspace = { id: 'ws1', name: 'Estudio', ownerId: 'u1', members: { u1: { avatar: 'data:image/png;base64,AAA' } } };
  const clients = [
    { id: 'c1', name: 'Café Aurora', workspaceId: 'ws1', initials: 'CA', color: 'var(--warn)' },
    { id: 'c2', name: 'Ferretería Norte', workspaceId: 'ws1' },
  ];
  const now = new Date(FIXED).toISOString();
  COLUMN_SETS.forEach((cols, k) => {
    ctx.window.FRAME_KANBAN_COLUMNS = cols;
    const tasks = genPortalTasks(400 + k);
    clients.forEach(client => {
      [true, false].forEach(published => {
        const theirs = JSON.parse(JSON.stringify(ctx.__fPortal(client, tasks, workspace, published, cols || [])));
        // Mejora documentada: estado sin nombre → su id (FRAME dejaba undefined).
        theirs.tasks.forEach(tt => { if (tt.status === undefined) tt.status = tt.statusId; });
        const mine = P.buildPortalDocument({ client, tasks, allClients: clients, workspace, published, columns: cols || [], now });
        // FRAME ignora `columns` para el nombre del estado (usa el global);
        // con las mismas columnas en ambos, el documento es idéntico.
        assert.deepEqual(mine, theirs, `${client.id} publicado=${published} columnas#${k}`);
      });
    });
  });
});

test('portal: homónimos no se ven entre sí; clientId manda; nada interno sale', () => {
  const a = { id: 'c1', name: 'Café Aurora', workspaceId: 'ws1' };
  const b = { id: 'c9', name: 'café aurora', workspaceId: 'ws1' };
  const t = (id, extra) => P.normalizeTask({ id, status: 'producing', title: id, checklist: [], ...extra }, TODAY);
  const tasks = [
    t('vieja', { client: 'Café Aurora' }),                       // sin clientId, nombre ambiguo
    t('deA', { client: 'Café Aurora', clientId: 'c1' }),
    t('deB', { client: 'Café Aurora', clientId: 'c9' }),          // mismo nombre visible, OTRO cliente
    t('oculta', { client: 'Café Aurora', clientId: 'c1', clientVisible: false }),
  ];
  const doc = P.buildPortalDocument({ client: a, tasks, allClients: [a, b], published: true, columns: [], now: TODAY });
  assert.deepEqual(doc.taskIds, ['deA'], 'sólo lo de este cliente, por id; lo ambiguo y lo oculto no se publican');
  const solo = P.buildPortalDocument({ client: a, tasks, allClients: [a], published: true, columns: [], now: TODAY });
  assert.deepEqual(solo.taskIds.sort(), ['deA', 'vieja'], 'sin homónimos, la tarea vieja cae por nombre (compatibilidad)');
  const borrador = P.buildPortalDocument({ client: a, tasks, allClients: [a], published: false, columns: [], now: TODAY });
  assert.deepEqual([borrador.tasks, borrador.taskIds], [[], []], 'sin publicar no se proyecta nada');
  const texto = JSON.stringify(P.buildPortalDocument({ client: a, tasks: genPortalTasks(7).map(x => ({ ...x, clientId: 'c1' })), allClients: [a], published: true, columns: [], now: TODAY }));
  ['comments', 'budget', 'assignees', 'interno', 'uid-x', 'viewerIds', 'sourceSaleId', 'checklist'].forEach(k => assert.ok(!texto.includes(k), `no expone ${k}`));
  assert.deepEqual(Object.keys(doc).sort(), ['clientColor', 'clientId', 'clientInitials', 'clientName', 'published', 'studioAvatar', 'studioName', 'taskIds', 'tasks', 'updatedAt', 'workspaceId'], 'mismas claves que valida la regla de FRAME');
});

// ── Tanda 2.5: revisión (atribución y documento público) ──────────

test('paridad del portal también con tipos propios y tareas con clientId', { skip }, () => {
  const ctx = loadFrame();
  const src = read('portal.jsx');
  ctx.__portal = `const buildClientPortalDocument = ${snippet(src, 'const buildClientPortalDocument = ', '\n// ── Línea de proceso')}\nreturn buildClientPortalDocument;`;
  vm.runInContext('this.__fPortal = (new Function(this.__portal))();', ctx);
  const customTypes = [{ id: 'custom-x', label: 'Podcast', icon: 'mic', color: 'var(--resource-pink)' }, { id: 'reel', label: 'Reel vertical', icon: 'film', color: 'var(--resource-blue)' }];
  ctx.window.FRAME_CUSTOM_TYPES = customTypes;
  const workspace = { id: 'ws1', name: 'Estudio', ownerId: 'u1', members: { u1: { avatar: 'data:image/png;base64,AAA' } } };
  const client = { id: 'c1', name: 'Café Aurora', workspaceId: 'ws1' };
  const now = new Date(FIXED).toISOString();
  COLUMN_SETS.forEach((cols, k) => {
    ctx.window.FRAME_KANBAN_COLUMNS = cols;
    // Todas con el nombre del cliente y su clientId: FRAME empareja por
    // nombre, LOOPA por id; con datos coherentes, el documento es el mismo.
    const tasks = genPortalTasks(900 + k).map(t => ({ ...t, client: 'Café Aurora', clientId: 'c1' }));
    const theirs = JSON.parse(JSON.stringify(ctx.__fPortal(client, tasks, workspace, true, cols || [])));
    theirs.tasks.forEach(tt => { if (tt.status === undefined) tt.status = tt.statusId; }); // mejora documentada
    assert.ok(theirs.tasks.some(tt => tt.type === 'Podcast'), 'los tipos propios se ejercitan');
    const mine = P.buildPortalDocument({ client, tasks, allClients: [client, { id: 'c2', name: 'Otro', workspaceId: 'ws1' }], workspace, published: true, columns: cols || [], customTypes, now });
    assert.deepEqual(mine, theirs, `columnas#${k}`);
  });
});

test('portal: un cliente sin nombre no se lleva las tareas «sin cliente»', () => {
  const t = (id, extra) => P.normalizeTask({ id, status: 'producing', title: id, checklist: [], ...extra }, TODAY);
  const tasks = [t('interna', { client: '' }), t('sinCampo', {}), t('blanco', { client: '   ' }), t('propia', { clientId: 'c1' })];
  ['', '   ', undefined].forEach(name => {
    const c = { id: 'c1', name, workspaceId: 'ws1' };
    assert.deepEqual(P.clientTasks(c, tasks, [c]).map(x => x.id), ['propia'], JSON.stringify(name));
    assert.deepEqual(P.buildPortalDocument({ client: c, tasks, allClients: [c], published: true, columns: [], now: TODAY }).taskIds, ['propia']);
  });
  // Sin la lista de clientes no hay forma de saber si el nombre es ambiguo:
  // sólo cuenta el clientId.
  const a = { id: 'c1', name: 'Café Aurora' };
  assert.deepEqual(P.clientTasks(a, [t('vieja', { client: 'Café Aurora' }), t('propia', { clientId: 'c1' })]).map(x => x.id), ['propia']);
});

test('portal: homónimos con espacios dobles o acentos descompuestos también cuentan', () => {
  const a = { id: 'c1', name: 'Café Aurora' };
  const b = { id: 'c2', name: 'Café  aurora' };
  assert.equal(P.clientHomonyms(a, [a, b]).length, 1);
  const vieja = P.normalizeTask({ id: 'v', client: 'café aurora', status: 'producing', checklist: [] }, TODAY);
  assert.deepEqual(P.clientTasks(a, [vieja], [a, b]), [], 'ambiguo: no se atribuye');
  assert.deepEqual(P.clientTasks(a, [vieja], [a]).map(x => x.id), ['v']);
});

test('enlazar una tarea vieja a su ficha: una vez, a un cliente que existe y del mismo nombre', () => {
  const a = { id: 'c1', name: 'Café Aurora' };
  const b = { id: 'c2', name: 'Café Aurora' };
  const vieja = P.normalizeTask({ id: 'v', client: 'Café Aurora', status: 'producing', checklist: [] }, TODAY);
  assert.deepEqual(P.unlinkedNameMatches(a, [vieja]).map(x => x.id), ['v']);
  const r = P.linkTaskToClient(vieja, a, [a, b]);
  assert.equal(r.ok, true);
  assert.equal(r.task.clientId, 'c1');
  assert.deepEqual(P.clientTasks(a, [r.task], [a, b]).map(x => x.id), ['v'], 'enlazada, vuelve a la ficha y al portal');
  assert.deepEqual(P.clientTasks(b, [r.task], [a, b]), [], 'y nunca al homónimo');
  assert.equal(P.linkTaskToClient(r.task, b, [a, b]).error.code, 'already_linked');
  assert.equal(P.linkTaskToClient(vieja, { id: 'c9', name: 'Café Aurora' }, [a, b]).error.code, 'client_unknown');
  assert.equal(P.linkTaskToClient(vieja, { id: 'c3', name: 'Otro' }, [a, b, { id: 'c3', name: 'Otro' }]).error.code, 'name_mismatch');
  assert.equal(P.applyTaskPatch(vieja, { clientId: 'c1' }).error.code, 'provenance_locked', 'el patch común sigue sin poder tocarlo');
  assert.equal(vieja.clientId, undefined, 'no muta la tarea original');
});

test('portal: un archivo oculto no vuelve como portada por mayúsculas o token distinto', () => {
  const c = { id: 'c1', name: 'X' };
  const base = { id: 't', clientId: 'c1', status: 'producing', checklist: [] };
  const casos = [
    ['HTTPS://cdn.example/secret.jpg', 'https://cdn.example/secret.jpg'],
    ['https://CDN.example/secret.jpg', 'https://cdn.example/secret.jpg'],
    ['https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg?alt=media&token=111', 'https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg?alt=media&token=222'],
  ];
  casos.forEach(([cover, oculto]) => {
    const t = P.normalizeTask({ ...base, cover: { type: 'image', value: cover }, deliverables: [{ name: 'a', kind: 'photos', url: oculto, clientVisible: false }] }, TODAY);
    const doc = P.buildPortalDocument({ client: c, tasks: [t], allClients: [c], published: true, columns: [], now: TODAY });
    assert.equal(doc.tasks[0].cover, '', cover);
    assert.deepEqual(doc.tasks[0].deliverables, []);
  });
  // Un entregable null no rompe la proyección.
  const t = P.normalizeTask({ ...base }, TODAY);
  t.deliverables = [null, { name: 'ok', kind: 'photos', url: 'https://cdn.example/ok.jpg' }];
  assert.equal(P.buildPortalDocument({ client: c, tasks: [t], allClients: [c], published: true, columns: [], now: TODAY }).tasks[0].deliverables.length, 1);
});

test('portal: el documento cumple los valores que exige validPortal', () => {
  const largo = 'N'.repeat(250);
  const c = { id: 'c1', name: largo };
  const tasks = [P.normalizeTask({ id: 't', clientId: 'c1', type: 'sin-nombre', status: 'producing', checklist: [] }, TODAY)];
  const ws = (avatar) => ({ id: 'ws1', name: largo, ownerId: 'u1', members: { u1: { avatar } } });
  const doc = P.buildPortalDocument({ client: c, tasks, allClients: [c], workspace: ws('https://lh3.googleusercontent.com/a/foto'), published: true, columns: [], customTypes: [{ id: 'sin-nombre' }], now: TODAY });
  assert.equal(doc.clientName.length, 200);
  assert.equal(doc.studioName.length, 200);
  assert.equal(doc.studioAvatar, '', 'una URL no es un avatar válido para la regla');
  assert.equal(doc.tasks[0].type, 'sin-nombre', 'tipo propio sin nombre: su id, nunca undefined');
  assert.ok(doc.clientInitials.length > 0 && doc.clientInitials.length <= 4);
  const ok = P.buildPortalDocument({ client: c, tasks, allClients: [c], workspace: ws('data:image/webp;base64,AAA'), published: true, columns: [], now: TODAY });
  assert.equal(ok.studioAvatar, 'data:image/webp;base64,AAA');
  assert.equal(P.buildPortalDocument({ client: c, tasks, allClients: [c], workspace: ws('data:image/svg+xml;base64,AAA'), published: true, columns: [], now: TODAY }).studioAvatar, '');
  // published no booleano nunca publica.
  const raro = P.buildPortalDocument({ client: c, tasks, allClients: [c], published: 'yes', columns: [], now: TODAY });
  assert.deepEqual([raro.published, raro.tasks], [false, []]);
});

test('portal: las tareas de una venta cancelada salen del portal pero no del tablero', () => {
  const c = { id: 'c1', name: 'X' };
  const t = (id, extra) => P.normalizeTask({ id, clientId: 'c1', status: 'producing', checklist: [], sourceSystem: 'loopa', ...extra }, TODAY);
  const tasks = [t('vigente', { sourceSaleStatus: 'confirmed' }), t('cancelada', { sourceSaleStatus: 'cancelled' })];
  assert.deepEqual(P.buildPortalDocument({ client: c, tasks, allClients: [c], published: true, columns: [], now: TODAY }).taskIds, ['vigente']);
  assert.deepEqual(P.clientTasks(c, tasks, [c]).map(x => x.id), ['vigente', 'cancelada'], 'la ficha interna sí las lista');
});
