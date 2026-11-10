'use strict';
// Plantillas de producción de los servicios reales: válidas y, pasadas por el
// planificador de verdad, una venta crea UNA tarea por servicio.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../functions/production-plan');
const { buildSaleLine } = require('../../functions/production-plan/catalog');
const { PLANTILLAS, SERVICIOS } = require('../puesta-en-marcha/plantillas-produccion.cjs');
const { revisar, decidir } = require('../puesta-en-marcha/plantillas.cjs');
const { loadFixtures } = require('../harness.cjs');

const fx = loadFixtures();
// Columnas y tipos de FRAME por defecto (los de «Loopa Estudio» al 2026-11-10).
const TABLERO = fx.context.workspaces['ws-loopa-produccion'];

test('las 10 plantillas son válidas para un tablero con las columnas y tipos de FRAME', () => {
  assert.equal(Object.keys(PLANTILLAS).length, 10);
  Object.entries(PLANTILLAS).forEach(([id, p]) => assert.deepEqual(revisar(p, TABLERO), [], id));
  assert.match(revisar({ ...PLANTILLAS['SRV-MVIZVBHBENH0'], templates: [{ ...PLANTILLAS['SRV-MVIZVBHBENH0'].templates[0], type: 'ct_x' }] }, TABLERO).join(), /no es un tipo del tablero/);
  assert.match(revisar({ ...PLANTILLAS['SRV-MVIZVBHBENH0'], templates: [{ ...PLANTILLAS['SRV-MVIZVBHBENH0'].templates[0], initialStatus: 'nada' }] }, TABLERO).join(), /no es una columna/);
  const grupos = Object.values(SERVICIOS).map(([g]) => g);
  assert.equal(new Set(grupos).size, grupos.length, 'cada servicio con su propia clave de agrupación');
});

test('una venta con dos servicios crea dos tareas «Servicio · Cliente», con la entrega de la venta', () => {
  const servicio = (id, nombre) => ({ schemaVersion: 1, id, nombre, categoria: 'Redes sociales', modelo: 'plan', precio: 1000, costo: 0, executionPlan: PLANTILLAS[id] });
  const lines = [
    buildSaleLine(servicio('SRV-MUG355P3X6R8', 'Plan Continuidad'), { lineId: 'l1', quantity: 1, precio: 18900, costo: 0 }),
    buildSaleLine(servicio('SRV-MVIZVBHBENH0', 'Logotipo'), { lineId: 'l2', quantity: 2, precio: 3000, costo: 0 }),
  ];
  const sale = { schemaVersion: 1, id: '5b1c2a4e-0000-4000-8000-000000000001', n: 1007, revision: 1, status: 'confirmed', fecha: '2026-11-10', entrega: '2026-11-20', client: { clientId: 'cli-demo-cafe-aurora', nombre: 'Café Aurora' }, lines };
  const plan = core.planSale(sale, fx.context);
  assert.deepEqual(plan.issues.filter(i => i.severity === 'error'), []);
  assert.equal(plan.tasks.length, 2);
  const titulos = plan.tasks.map(t => t.title).sort();
  assert.deepEqual(titulos, ['Logotipo · Café Aurora', 'Plan Continuidad · Café Aurora']);
  plan.tasks.forEach(t => {
    assert.equal(t.status, 'briefing');
    assert.equal(t.deadline, '2026-11-20');
    assert.equal(t.workspaceId, 'ws-loopa-produccion');
    assert.equal(t.checklist.length, 4);
  });
});

test('decidir: carga si no tiene, igual si es la misma, nunca pisa una versión', () => {
  const p = PLANTILLAS['SRV-MVIZVBHBENH0'];
  assert.equal(decidir(null, p).accion, 'falta');
  assert.equal(decidir({ executionPlan: null }, p).accion, 'cargar');
  assert.equal(decidir({ executionPlan: structuredClone(p) }, p).accion, 'igual');
  const otra = { ...structuredClone(p), templates: [{ ...p.templates[0], priority: 'high' }] };
  assert.equal(decidir({ executionPlan: otra }, p).accion, 'rechazar', 'misma versión, otro contenido');
  assert.equal(decidir({ executionPlan: p }, { ...otra, version: 2 }).accion, 'cargar', 'versión nueva');
  assert.equal(decidir({ executionPlan: { ...otra, version: 3 } }, p).accion, 'rechazar', 'nunca baja');
});

test('un servicio tal como lo crea la migración, con su plantilla, genera su tarea', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { buildMigrationPlan } = require('../../functions/migration/plan');
  const FX = path.join(__dirname, '..', 'fixtures', 'migration');
  const leer = (f) => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));
  const frame = leer('frame-clients.json');
  const p = buildMigrationPlan({ backup: leer('loopa-backup.json'), frameClients: frame.clients, decisions: leer('client-decisions.json').decisions, workspaceId: frame.workspaceId });
  const op = p.ops.find(o => o.collection === 'loopa_services');
  assert.ok(op, 'la migración crea servicios');
  assert.equal(op.data.executionPlan, null, 'la migración no inventa plantillas');
  const servicio = { ...op.data, executionPlan: PLANTILLAS['SRV-MVIZVBHBENH0'] };
  const line = buildSaleLine(servicio, { lineId: 'l1', quantity: 1, precio: 100, costo: 0 });
  const sale = { schemaVersion: 1, id: '5b1c2a4e-0000-4000-8000-000000000002', n: 1008, revision: 1, status: 'confirmed', fecha: '2026-11-10', entrega: '2026-11-25', client: { clientId: 'cli-demo-cafe-aurora', nombre: 'Café Aurora' }, lines: [line] };
  const plan = core.planSale(sale, fx.context);
  assert.deepEqual(plan.issues.filter(i => i.severity === 'error'), []);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].title, `${op.data.nombre} · Café Aurora`);
});
