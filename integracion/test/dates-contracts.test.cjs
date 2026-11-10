'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../functions/production-plan');
const { loadFixtures, buildSale } = require('../harness.cjs');

const fx = loadFixtures();
const service = (id) => structuredClone(fx.services.find(s => s.id === id));
const scenario = (name) => fx.scenarios.find(s => s.name === name);
const codes = (issues) => issues.filter(i => i.severity === 'error').map(i => i.code);

test('fechas: aritmética de calendario sin zona horaria', () => {
  assert.equal(core.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(core.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(core.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(core.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(core.addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(core.addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(core.isValidYmd('2026-02-30'), false);
  assert.equal(core.isValidYmd('2026-2-3'), false);
  assert.throws(() => core.addDays('2026-13-01', 1), /Fecha inválida/);
});

test('fechas: el día local de Tegucigalpa no es el de toISOString()', () => {
  // 19:30 del 9 de noviembre en Honduras (UTC-6) ya es 10 de noviembre en UTC.
  const instant = new Date('2026-11-10T01:30:00.000Z');
  assert.equal(instant.toISOString().slice(0, 10), '2026-11-10');
  assert.equal(core.todayInTimeZone(instant), '2026-11-09');
  assert.equal(core.DEFAULT_TIME_ZONE, 'America/Tegucigalpa');
});

test('plantilla: errores claros y todos juntos', () => {
  const plan = service('SRV-DEMO-REEL').executionPlan;
  plan.templates.push({ ...structuredClone(plan.templates[0]) }); // templateId repetido
  plan.templates[0].title = '{cliente} · {precio}';                 // marcador desconocido
  plan.templates[0].quantityMode = 'ignore';                        // perUnit sin expansión
  plan.templates[1].quantityMode = 'repeat_schedule';               // sin recurrencia
  plan.grouping.strategy = 'por_semana';
  const found = codes(core.validateExecutionPlan(plan));
  for (const code of ['plan.template.duplicate', 'plan.placeholder.unknown', 'plan.checklist.per_unit_mode', 'plan.recurrence.required', 'plan.grouping.strategy']) {
    assert.ok(found.includes(code), `falta ${code} en ${found.join(', ')}`);
  }
});

test('servicio sin plantilla es válido (vende, no produce)', () => {
  assert.deepEqual(codes(core.validateService(service('SRV-DEMO-ASESORIA'))), []);
});

test('venta: datos inválidos producen errores legibles y estables', () => {
  const bad = scenario('datos-invalidos').sale;
  const issues = core.validateSale(bad);
  const found = codes(issues);
  ['sale.id', 'sale.fecha', 'sale.client.nombre', 'line.quantity', 'line.id.duplicate', 'line.snapshot.missing', 'line.template_version.orphan']
    .forEach(code => assert.ok(found.includes(code), `falta ${code}`));
  issues.forEach(i => {
    assert.match(i.path, /^sale(\.|$)/);
    assert.ok(i.message.length > 10 && i.message.length < 200);
  });
});

test('venta: el correlativo visible no es identidad', () => {
  const sale = buildSale(scenario('paquete-mismo-dia').sale, fx.services);
  assert.deepEqual(codes(core.validateSale({ ...sale, id: undefined })), ['sale.id']);
  assert.deepEqual(codes(core.validateSale({ ...sale, id: String(sale.n) })), ['sale.id.is_correlative']);
  assert.deepEqual(codes(core.validateSale({ ...sale, n: 7 })), [], 'cambiar el correlativo no cambia la identidad');
  assert.notEqual(core.ids.eventId('sale.confirmed', sale.id, 1), core.ids.eventId('sale.confirmed', 'otra', 1));
});

test('evento: el id se deriva de (tipo, venta, revisión) y se valida', () => {
  const sale = buildSale(scenario('paquete-mismo-dia').sale, fx.services);
  const a = core.createEvent('sale.confirmed', sale, '2026-11-10T15:00:00.000Z');
  const b = core.createEvent('sale.confirmed', sale, '2026-11-10T15:09:00.000Z');
  assert.equal(a.eventId, b.eventId, 'doble clic = mismo evento');
  assert.notEqual(a.eventId, core.createEvent('sale.confirmed', { ...sale, revision: 2 }, a.occurredAt).eventId);
  assert.deepEqual(codes(core.validateEvent({ ...a, eventId: 'evt_inventado' })), ['event.id.not_derived']);
  assert.throws(() => core.createEvent('sale.cancelled', sale, a.occurredAt), err => err.name === 'ContractError' && /cancelada/.test(err.message));
});

test('errores saneados: sin emails, claves, tokens ni stack', () => {
  const err = Object.assign(new Error('Fallo al escribir para ana@example.com con key AIzaSyA1234567890abcdefghijklmnop y token=abc.def.ghi'), { code: 'unavailable' });
  const safe = core.sanitizeError(err);
  assert.equal(safe.code, 'unavailable');
  assert.doesNotMatch(JSON.stringify(safe), /example\.com|AIza|abc\.def|at Object|\n/);
  assert.equal(core.sanitizeError({ code: 'bad code with spaces', message: 'x' }).code, 'internal');
});
