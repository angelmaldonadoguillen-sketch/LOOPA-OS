'use strict';
// Expansión, fechas y agrupación: el planificador puro.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../functions/production-plan');
const { loadFixtures, buildSale } = require('../harness.cjs');

const fx = loadFixtures();
const scenario = (name) => fx.scenarios.find(s => s.name === name);
const saleOf = (name, services = fx.services) => buildSale(structuredClone(scenario(name).sale), services);
const plan = (sale, context = fx.context) => core.planSale(sale, context);
const errorCodes = (p) => p.issues.filter(i => i.severity === 'error').map(i => i.code);

test('dos servicios del mismo cliente y día se agrupan en una tarjeta', () => {
  const p = plan(saleOf('paquete-mismo-dia'));
  assert.equal(p.status, 'ready');
  assert.equal(p.tasks.length, 1);
  const [task] = p.tasks;
  assert.equal(task.sourceLineIds.length, 2);
  assert.equal(task.sourceWorkItems.length, 2);
  assert.equal(task.checklist.length, 3 * 3 + 1 + 4, '3 reels × 3 pasos + entrega + 4 de fotos');
  assert.equal(new Set(task.checklist.map(c => c.id)).size, task.checklist.length, 'ids de checklist únicos');
  assert.equal(task.priority, 'high', 'la prioridad más alta del paquete');
  assert.equal(task.title, 'Café Aurora · Reels + Fotografía');
  assert.deepEqual(task.tags, ['foto', 'loopa', 'reels']);
  assert.ok(p.issues.some(i => i.code === 'line.no_plan' && i.severity === 'warning'), 'la línea sin plantilla avisa');
  assert.deepEqual(core.validateGeneratedTask(task), []);
});

test('la tarjeta generada conserva procedencia, cliente por id y forma FRAME', () => {
  const sale = saleOf('paquete-mismo-dia');
  const [task] = plan(sale).tasks;
  assert.equal(task.sourceSystem, 'loopa');
  assert.equal(task.sourceSaleId, sale.id);
  assert.equal(task.sourceSaleNumber, sale.n);
  assert.equal(task.clientId, 'cli-demo-cafe-aurora');
  assert.equal(task.client, 'Café Aurora', 'el nombre visible sale de la ficha única');
  assert.deepEqual(task.workspaceIds, [task.workspaceId]);
  assert.deepEqual(task.viewerIds, [...fx.context.workspaces['ws-loopa-produccion'].memberIds].sort());
  assert.equal(task.id, core.ids.taskDocId(task.idempotencyKey));
  assert.equal(task.clientVisible, false);
  assert.ok(task.checklist.every(c => c.done === false));
});

test('clientes o fechas distintos nunca se agrupan', () => {
  // Fechas distintas dentro de una venta.
  const p = plan(saleOf('fechas-distintas'));
  assert.equal(p.tasks.length, 3);
  assert.equal(new Set(p.tasks.map(t => t.sessionDate)).size, 3);

  // Mismo día, misma composición, otro cliente → otra clave y otra tarjeta.
  const a = saleOf('paquete-mismo-dia');
  const b = { ...structuredClone(a), id: '0b9f5a8e-1c2d-4e3f-8a9b-0c1d2e3f4a5b', client: { ...a.client, clientId: 'cli-demo-ferreteria-norte', nombre: 'Ferretería Norte' } };
  const ta = plan(a).tasks[0];
  const tb = plan(b).tasks[0];
  assert.equal(ta.sessionDate, tb.sessionDate);
  assert.notEqual(ta.idempotencyKey, tb.idempotencyKey);
  assert.notEqual(ta.id, tb.id);

  // La clave cambia con cada dimensión de agrupación.
  const base = ['sale-1', 'ws-a', 'fc-1', '2026-11-17', 'produccion'];
  const keyOf = (parts) => core.ids.packageKey(...parts);
  [1, 2, 3, 4].forEach(i => {
    const changed = [...base];
    changed[i] = `${changed[i]}-x`;
    assert.notEqual(keyOf(base), keyOf(changed), `la dimensión ${i} debe separar`);
  });
});

test('estrategia separate: una tarjeta por bloque aunque coincida el día', () => {
  const sale = saleOf('fechas-distintas');
  sale.entrega = '2026-11-19'; // propuesta (entrega-7) = 11-12 ≠ descubrimiento (venta+1) = 11-11
  const branding = sale.lines[0];
  const plan2 = structuredClone(branding.executionPlan);
  plan2.templates[1].schedule = { ...plan2.templates[1].schedule, sessionAnchor: 'sale_date', sessionOffsetDays: 1 };
  sale.lines[0] = { ...branding, executionPlan: plan2 };
  const p = plan(sale);
  const brandingTasks = p.tasks.filter(t => t.sourceLineIds.includes(branding.lineId));
  assert.equal(brandingTasks.length, 2);
  assert.equal(brandingTasks[0].sessionDate, brandingTasks[1].sessionDate);
});

test('un plan mensual genera sólo las ocurrencias configuradas', () => {
  const monthly = plan(saleOf('plan-mensual'));
  assert.equal(monthly.tasks.length, 4);
  assert.deepEqual(monthly.tasks.map(t => t.sessionDate), ['2026-11-12', '2026-11-19', '2026-11-26', '2026-12-03']);
  assert.deepEqual(monthly.tasks.map(t => t.deadline), ['2026-11-17', '2026-11-24', '2026-12-01', '2026-12-08']);
  assert.deepEqual(monthly.tasks.map(t => t.sourceWorkItems[0].occurrence), [1, 2, 3, 4]);

  const quarterly = plan(saleOf('plan-trimestral'));
  assert.equal(quarterly.tasks.length, 12, 'cantidad 3 × 4 sesiones');
  assert.equal(quarterly.tasks.at(-1).sessionDate, '2027-01-28');

  // Recurrencia mensual: fin de mes se ajusta, no desborda.
  const sale = saleOf('plan-mensual');
  sale.fecha = '2027-01-29';
  const tpl = structuredClone(sale.lines[0].executionPlan);
  tpl.templates[0].recurrence = { unit: 'month', interval: 1, count: 3 };
  tpl.templates[0].quantityMode = 'ignore';
  sale.lines[0] = { ...sale.lines[0], executionPlan: tpl };
  assert.deepEqual(plan(sale).tasks.map(t => t.sessionDate), ['2027-01-31', '2027-02-28', '2027-03-31']);
});

test('el tope de ocurrencias se respeta con un error claro', () => {
  const sale = saleOf('plan-mensual');
  sale.lines[0] = { ...sale.lines[0], quantity: 16 }; // 64 sesiones
  const p = plan(sale);
  assert.equal(p.status, 'blocked');
  assert.deepEqual(errorCodes(p), ['line.occurrences.too_many']);
  assert.equal(p.tasks.length, 0);
});

test('deadline es el compromiso: no depende de sessionDate', () => {
  const sale = saleOf('paquete-mismo-dia');
  const before = plan(sale).tasks[0];
  // Mover la sesión de la plantilla no mueve la fecha límite anclada a la entrega.
  const shifted = structuredClone(sale);
  shifted.lines = shifted.lines.map(line => {
    if (!line.executionPlan) return line;
    const p2 = structuredClone(line.executionPlan);
    p2.templates.forEach(t => { t.schedule.sessionOffsetDays = -6; });
    return { ...line, executionPlan: p2 };
  });
  const after = plan(shifted).tasks[0];
  assert.notEqual(after.sessionDate, before.sessionDate);
  assert.equal(after.deadline, before.deadline);

  // Una tarjeta reprogramada en FRAME (sólo cambia sessionDate) se reconoce
  // como editada y se respeta: el diff no propone tocarla.
  const rescheduled = { ...before, sessionDate: '2026-11-18' };
  assert.equal(core.diffPlan([before], [rescheduled]).entries[0].action, 'edited_same_plan');
  assert.equal(rescheduled.deadline, before.deadline);
});

test('cambiar la plantilla del servicio no altera una venta histórica', () => {
  const historical = saleOf('paquete-mismo-dia');
  const beforeJson = core.canonicalJson(plan(historical));

  // El catálogo evoluciona: v2 de la plantilla de reels con otro checklist.
  const catalog = structuredClone(fx.services);
  const reel = catalog.find(s => s.id === 'SRV-DEMO-REEL');
  reel.executionPlan.version = 2;
  reel.executionPlan.templates[0].checklist = [{ itemId: 'todo', text: 'Todo en un paso', perUnit: false }];
  reel.nombre = 'Reel (nuevo nombre)';

  assert.equal(core.canonicalJson(plan(historical)), beforeJson, 'la venta histórica no se recalcula con el catálogo');
  const fresh = saleOf('paquete-mismo-dia', catalog);
  assert.equal(fresh.lines[0].executionTemplateVersion, 2);
  assert.notEqual(core.canonicalJson(plan(fresh)), beforeJson, 'una venta nueva sí usa la v2');

  // El snapshot es una copia congelada: no se puede mutar por accidente.
  assert.ok(Object.isFrozen(historical.lines[0].executionPlan.templates[0].checklist));
  assert.throws(() => { historical.lines[0].executionPlan.templates[0].checklist.push({}); }, TypeError);
});

test('repetir la simulación produce exactamente el mismo resultado', () => {
  for (const s of fx.scenarios) {
    const a = s.raw ? plan(s.sale) : plan(saleOf(s.name));
    const b = s.raw ? plan(structuredClone(s.sale)) : plan(saleOf(s.name));
    assert.equal(core.canonicalJson(a), core.canonicalJson(b), s.name);
  }
  // El correlativo visible no participa de ninguna identidad.
  const sale = saleOf('plan-mensual');
  assert.deepEqual(plan({ ...sale, n: 9999 }).tasks.map(t => t.id), plan(sale).tasks.map(t => t.id));
});

test('validaciones de contexto: enlace de cliente, tablero y fechas', () => {
  assert.deepEqual(errorCodes(plan(saleOf('cliente-desconocido'))), ['client.unknown']);
  assert.deepEqual(errorCodes(plan(saleOf('entrega-faltante'))), ['sale.entrega.required']);

  const foreign = saleOf('paquete-mismo-dia');
  foreign.client = { ...foreign.client, clientId: 'cli-demo-cliente-ajeno' };
  assert.deepEqual(errorCodes(plan(foreign)), ['client.workspace_mismatch']);

  const notAllowed = saleOf('paquete-mismo-dia');
  notAllowed.lines = notAllowed.lines.map(l => (l.executionPlan ? { ...l, executionPlan: { ...structuredClone(l.executionPlan), workspaceId: 'ws-demo-personal' } } : l));
  assert.deepEqual(errorCodes(plan(notAllowed)), ['workspace.not_allowed', 'workspace.not_allowed']);

  const fractional = saleOf('paquete-mismo-dia');
  fractional.lines[0] = { ...fractional.lines[0], quantity: 2.5 };
  assert.deepEqual(errorCodes(plan(fractional)), ['line.quantity.not_integer']);

  const draft = { ...saleOf('paquete-mismo-dia'), status: 'draft' };
  assert.deepEqual(errorCodes(plan(draft)), ['sale.status.not_plannable']);

  const badStatus = saleOf('paquete-mismo-dia');
  badStatus.lines[1] = { ...badStatus.lines[1], executionPlan: { ...structuredClone(badStatus.lines[1].executionPlan) } };
  badStatus.lines[1].executionPlan.templates[0].initialStatus = 'columna-inexistente';
  assert.deepEqual(errorCodes(plan(badStatus)), ['template.status.unknown']);

  const late = saleOf('paquete-mismo-dia');
  const p = plan(late, { ...fx.context, today: '2026-11-18' });
  assert.equal(p.status, 'ready', 'una fecha pasada avisa pero no bloquea');
  assert.ok(p.issues.some(i => i.code === 'work_item.session_in_past'));
});
