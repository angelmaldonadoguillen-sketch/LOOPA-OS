'use strict';
// ─────────────────────────────────────────────────────────────────
// Arnés local: carga fixtures, arma ventas desde el catálogo y reproduce
// escenarios contra el almacén en memoria. Lo usan el simulador y las pruebas.
// Nunca importa Firebase ni abre conexiones.
// ─────────────────────────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');
const core = require('../functions/production-plan');
const { MemoryStore } = require('./memory-store.cjs');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const readJson = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

function loadFixtures(dir = FIXTURES_DIR) {
  return {
    context: readJson(dir, 'context.json'),
    services: readJson(dir, 'services.json').services,
    scenarios: readJson(dir, 'sales.json').scenarios,
  };
}

// Congela cada línea desde el catálogo, como hará la confirmación de venta.
function buildSale(draft, services) {
  const byId = new Map(services.map(s => [s.id, s]));
  return {
    ...draft,
    lines: draft.lines.map(line => {
      if (line.snapshot) return line;
      const service = byId.get(line.serviceId);
      if (!service) throw new Error(`El fixture usa un servicio inexistente: ${line.serviceId}`);
      return core.buildSaleLine(service, { lineId: line.lineId, quantity: line.quantity, precio: line.precio });
    }),
  };
}

const plusMinutes = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString();

const DEFAULT_STEPS = [
  { event: 'sale.confirmed' },
  { event: 'sale.confirmed', note: 'mismo evento otra vez (doble clic / reintento de la plataforma)' },
  { event: 'sale.resync_requested' },
];

// Reproduce un escenario. Cada evento emitido actualiza también el documento
// de la venta en memoria, igual que hará LOOPA en una sola transacción.
async function runScenario(scenario, { context, services }, { store = new MemoryStore(), workerId = 'sim-worker' } = {}) {
  let sale = scenario.raw ? scenario.sale : buildSale(scenario.sale, services);
  let clock = scenario.occurredAt;
  const now = () => clock;
  const log = [];
  const steps = scenario.steps || DEFAULT_STEPS;

  for (const step of steps) {
    clock = plusMinutes(clock, 5);
    if (step.action === 'start_work') {
      const tasks = store.list(core.COLLECTIONS.tasks).filter(t => t.sourceSaleId === sale.id);
      const target = tasks[0];
      if (target) {
        const checklist = target.checklist.map((c, i) => (i === 0 ? { ...c, done: true } : c));
        store.seed(core.COLLECTIONS.tasks, target.id, { ...target, status: 'producing', checklist });
      }
      log.push({ step: 'start_work', taskId: target ? target.id : null });
      continue;
    }
    const type = step.event;
    // Editar o cancelar cambia la venta y sube la revisión. Repetir la
    // confirmación o pedir resincronizar refieren a la revisión vigente.
    if (type === 'sale.updated') sale = applyPatch(sale, step.patch || {});
    if (type === 'sale.cancelled') sale = { ...sale, status: 'cancelled', revision: sale.revision + 1 };
    const problems = core.validateEvent({
      schemaVersion: 1, eventId: core.ids.eventId(type, sale.id, sale.revision), type,
      saleId: sale.id, saleRevision: sale.revision, occurredAt: clock, sale,
    });
    if (core.hasErrors(problems)) {
      log.push({ step: type, status: 'invalid_event', issues: problems.filter(p => p.severity === 'error') });
      continue;
    }
    const event = core.createEvent(type, sale, clock);
    store.merge(core.COLLECTIONS.sales, sale.id, { id: sale.id, n: sale.n, revision: sale.revision, status: sale.status });
    const enq = await core.enqueueEvent(store, event, clock);
    const result = await core.processEvent(store, event.eventId, { context, workerId, now });
    log.push({
      step: type,
      note: step.note || null,
      eventId: event.eventId,
      saleRevision: sale.revision,
      enqueued: enq.enqueued,
      status: result.status,
      created: result.created ? result.created.length : 0,
      existing: result.existing ? result.existing.length : 0,
      updated: result.updated ? result.updated.length : 0,
      conflicts: result.conflicts || [],
      diff: result.diff ? result.diff.counts : null,
      flagged: result.flagged ? result.flagged.length : 0,
      issues: result.issues || null,
    });
  }
  return { sale, log, store };
}

function applyPatch(sale, patch) {
  const lines = sale.lines.map(line => {
    const change = (patch.lines || []).find(l => l.lineId === line.lineId);
    return change ? { ...line, quantity: change.quantity } : line;
  });
  return { ...sale, ...patch, lines, revision: sale.revision + 1 };
}

module.exports = { loadFixtures, buildSale, runScenario, applyPatch, FIXTURES_DIR };
