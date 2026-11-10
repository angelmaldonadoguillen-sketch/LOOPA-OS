'use strict';
// Fase 3, tanda 3.5 — Producción con los datos del tablero
// (_fuente/produccion/datos-reales.js): qué se lee y qué se escribe.
const test = require('node:test');
const assert = require('node:assert/strict');
const LoopaProduccion = require('../../_fuente/produccion/nucleo.js');
const R = require('../../_fuente/produccion/datos-reales.js');

const WS = 'ws-prod';
const tarea = (over = {}) => ({
  id: 't1', title: 'Reel', client: 'Café Aurora', type: 'reel', status: 'briefing', priority: 'medium',
  sessionDate: '2026-11-12', deadline: '2026-11-20', checklist: [{ id: 'k1', text: 'Grabar', done: false }],
  workspaceId: WS, workspaceIds: [WS], viewerIds: ['u1'], ...over,
});

test('hoy es la fecha local de Tegucigalpa (UTC−6), no la de UTC', () => {
  assert.equal(R.hoyEnTegucigalpa(new Date('2026-11-11T03:00:00Z')), '2026-11-10', '9 p. m. del 10 en Tegucigalpa');
  assert.equal(R.hoyEnTegucigalpa(new Date('2026-11-11T06:00:00Z')), '2026-11-11');
  assert.match(R.hoyEnTegucigalpa(), /^\d{4}-\d{2}-\d{2}$/);
});

test('tareas del tablero: las suyas + las compartidas que lo incluyen, sin duplicar', () => {
  const propias = [tarea({ id: 'a' }), tarea({ id: 'b' })];
  const compartidas = [tarea({ id: 'b', title: 'versión compartida' }), tarea({ id: 'c', workspaceId: 'otro', workspaceIds: ['otro', WS] }), tarea({ id: 'd', workspaceId: 'otro', workspaceIds: ['otro'] })];
  const r = R.tareasDelTablero(propias, compartidas, WS);
  assert.deepEqual(r.map(t => t.id).sort(), ['a', 'b', 'c'], 'd es de otro tablero');
  assert.equal(r.find(t => t.id === 'b').title, 'versión compartida', 'la compartida (más nueva) gana, como en FRAME');
});

test('columnas: las del tablero (sin «archivado»), o las de FRAME si no hay', () => {
  const cols = R.columnasDe({ columns: [{ id: 'a', label: 'A' }, { id: 'archived', label: 'Arch' }, { id: 'z', isDone: true, requiresChecklist: true, extra: 1 }, null, { label: 'sin id' }] });
  assert.deepEqual(cols, [{ id: 'a', label: 'A' }, { id: 'z', label: 'z', isDone: true, requiresChecklist: true }]);
  assert.deepEqual(R.columnasDe(null).map(c => c.id), LoopaProduccion.STATUSES.filter(s => s.id !== 'archived').map(s => s.id));
});

test('equipo: sin leer perfiles ajenos', () => {
  const eq = R.equipoDe({ memberIds: ['u1', 'u2abcdefgh', 7] }, { uid: 'u1', name: 'Ana' });
  assert.deepEqual(eq, [{ id: 'u1', name: 'Ana', status: 'active' }, { id: 'u2abcdefgh', name: 'Miembro u2abcd', status: 'active' }]);
});

test('armarProduccion: la forma que usa el módulo; fichas sólo del tablero', () => {
  const d = R.armarProduccion({
    workspace: { id: WS, name: 'Producción', memberIds: ['u1'] }, columnas: null,
    porTablero: [tarea()], compartidas: [], clientes: [{ id: 'c1', workspaceId: WS }, { id: 'c2', workspaceId: 'otro' }],
    rutina: null, yo: { uid: 'u1' }, hoy: '2026-11-10',
  });
  assert.deepEqual(Object.keys(d).sort(), ['clientes', 'columnas', 'equipo', 'hoy', 'rutina', 'tareas', 'workspace']);
  assert.deepEqual(d.clientes.map(c => c.id), ['c1']);
  assert.deepEqual(d.rutina, {});
  assert.throws(() => R.armarProduccion({ workspace: null }), /tablero/);
});

test('parcheTarea: sólo lo editable que cambió; nunca procedencia ni ids', () => {
  const antes = LoopaProduccion.normalizeTask(tarea({ sourceSystem: 'loopa', sourceSaleId: 's1' }), '2026-11-10');
  const r = LoopaProduccion.applyTaskPatch(antes, { status: 'producing' }, null);
  assert.equal(r.ok, true);
  assert.deepEqual(R.parcheTarea(antes, r.task), { status: 'producing' });
  const r2 = LoopaProduccion.applyTaskPatch(antes, { checklist: [{ id: 'k1', text: 'Grabar', done: true }] }, null);
  assert.deepEqual(R.parcheTarea(antes, r2.task), { checklist: [{ id: 'k1', text: 'Grabar', done: true }] });
  // Aunque «después» traiga procedencia u otros campos distintos, no viajan.
  const raro = { ...antes, sourceSaleId: 'otra', workspaceId: 'x', id: 'y', clientId: 'z', title: 'Nuevo' };
  assert.deepEqual(R.parcheTarea(antes, raro), { title: 'Nuevo' });
  assert.deepEqual(R.parcheTarea(antes, antes), {}, 'sin cambios, sin escritura');
  // La entrega de una tarea de venta no se mueve (lo frena el núcleo).
  assert.equal(LoopaProduccion.applyTaskPatch(antes, { deadline: '2026-12-01' }, null).error.code, 'deadline_locked');
});

test('parcheEnlace: sólo poner clientId una vez', () => {
  const sinFicha = LoopaProduccion.normalizeTask(tarea({ clientId: '' }), '2026-11-10');
  const r = LoopaProduccion.linkTaskToClient(sinFicha, { id: 'c1', name: 'Café Aurora' }, [{ id: 'c1', name: 'Café Aurora' }]);
  assert.equal(r.ok, true);
  assert.deepEqual(R.parcheEnlace(sinFicha, r.task), { clientId: 'c1' });
  const conFicha = { ...sinFicha, clientId: 'c0' };
  assert.deepEqual(R.parcheEnlace(conFicha, { ...conFicha, clientId: 'c1' }), {}, 'no se re-enlaza');
});

test('revisión 3.5: columnas con indicadores en false se leen igual que en FRAME', () => {
  const cols = R.columnasDe({ columns: [{ id: 'briefing', label: 'B' }, { id: 'delivered', label: 'Entregado', isDone: false, requiresChecklist: false }] });
  assert.deepEqual(cols[1], { id: 'delivered', label: 'Entregado', isDone: false, requiresChecklist: false });
  // Con delivered sin checklist obligatorio, se puede pasar con el checklist incompleto (como FRAME).
  const t = LoopaProduccion.normalizeTask(tarea(), '2026-11-10');
  assert.equal(LoopaProduccion.applyTaskPatch(t, { status: 'delivered' }, cols).ok, true);
  assert.equal(LoopaProduccion.isClosed({ ...t, status: 'delivered' }, cols), false, 'y no cuenta como cerrada');
});

test('revisión 3.5: fechas a medio escribir no se aceptan', () => {
  for (const f of ['0002-11-12', '0202-11-12', '1999-12-31', '2101-01-01', '2026-13-01', '', null]) assert.equal(R.fechaEnRango(f), false, String(f));
  for (const f of ['2000-01-01', '2026-11-12', '2100-12-31']) assert.equal(R.fechaEnRango(f), true, f);
});

test('revisión 3.5: sólo se enlaza lo que las reglas aceptan', () => {
  assert.equal(R.puedeEnlazar({ workspaceId: WS }, WS), true, 'sin el campo y del tablero');
  assert.equal(R.puedeEnlazar({ workspaceId: WS, clientId: '' }, WS), false, 'el campo vacío ya cuenta (regla)');
  assert.equal(R.puedeEnlazar({ workspaceId: 'otro', workspaceIds: ['otro', WS] }, WS), false, 'compartida de otro tablero');
  assert.equal(R.puedeEnlazar(null, WS), false);
});

test('revisión 3.5: historial con el mismo texto que FRAME', () => {
  const a = LoopaProduccion.normalizeTask(tarea(), '2026-11-10');
  const cols = [{ id: 'briefing', label: 'Briefing' }, { id: 'producing', label: 'En producción' }];
  assert.equal(R.resumenActividad(a, { ...a, status: 'producing' }, cols), 'cambió el estado a En producción');
  assert.equal(R.resumenActividad(a, { ...a, sessionDate: '2026-11-13' }, cols), 'reprogramó la próxima fecha de trabajo');
  assert.equal(R.resumenActividad(a, { ...a, checklist: [] }, cols), 'actualizó el checklist');
  assert.equal(R.resumenActividad(a, { ...a, priority: 'high' }, cols), null, 'prioridad: FRAME no la registra');
});

test('revisión 3.5: el equipo usa las tarjetas de miembro del tablero', () => {
  const eq = R.equipoDe({ memberIds: ['u1', 'u2', 'u3'], members: { u2: { name: 'Beto' } } }, { uid: 'u1', email: 'a@x.test' });
  assert.deepEqual(eq.map(m => m.name), ['a@x.test', 'Beto', 'Miembro u3']);
});
