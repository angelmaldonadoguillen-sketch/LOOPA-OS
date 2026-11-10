#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────
// Simulador LOOPA → FRAME (dry-run). Sólo lee fixtures y escribe en memoria.
//
//   node integracion/simulate.cjs                     todos los escenarios
//   node integracion/simulate.cjs --scenario plan-mensual
//   node integracion/simulate.cjs --json              salida JSON determinista
//   node integracion/simulate.cjs --fixtures <dir>    otros fixtures
//   node integracion/simulate.cjs --today 2026-11-09  fecha "hoy" (por defecto la de context.json)
//   node integracion/simulate.cjs --migration         dry-run del adaptador legacy
//
// Código de salida: 0 si todos los escenarios se comportan; 1 si un escenario
// marcado como válido quedó bloqueado o falló.
// ─────────────────────────────────────────────────────────────────

const path = require('node:path');
const fs = require('node:fs');
const core = require('../functions/production-plan');
const { loadFixtures, buildSale, runScenario, FIXTURES_DIR } = require('./harness.cjs');

function parseArgs(argv) {
  const args = { json: false, scenario: null, fixtures: FIXTURES_DIR, today: null, migration: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--migration') args.migration = true;
    else if (a === '--scenario') args.scenario = argv[++i];
    else if (a === '--fixtures') args.fixtures = path.resolve(argv[++i]);
    else if (a === '--today') args.today = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  if (args.today && !core.isValidYmd(args.today)) throw new Error('--today debe ser YYYY-MM-DD');
  return args;
}

const short = (id) => (id && id.length > 18 ? `${id.slice(0, 18)}…` : id);
const sev = (i) => (i.severity === 'error' ? '✖' : '⚠');

function planFor(scenario, fixtures) {
  const sale = scenario.raw ? scenario.sale : buildSale(scenario.sale, fixtures.services);
  const eventId = core.ids.eventId('sale.confirmed', sale.id || 'sin-id', Number.isInteger(sale.revision) ? sale.revision : 0);
  return { sale, plan: core.planSale(sale, fixtures.context, { eventId }), eventId };
}

function printScenario(scenario, { sale, plan, eventId }, run) {
  const L = [];
  L.push('');
  L.push(`══ Escenario: ${scenario.name} ${'═'.repeat(Math.max(2, 60 - scenario.name.length))}`);
  L.push(scenario.description);
  const client = sale.client || {};
  L.push(`Venta #${sale.n} · id ${short(sale.id) || '(sin id)'} · rev ${sale.revision} · ${client.nombre || '(sin cliente)'} · venta ${sale.fecha} · entrega ${sale.entrega || '—'}`);
  L.push(`Evento sale.confirmed · ${short(eventId)}`);
  const label = { ready: 'LISTO', blocked: 'BLOQUEADO', nothing_to_do: 'SIN TRABAJO' }[plan.status];
  L.push(`Plan: ${label} — ${plan.tasks.length} tarjeta(s), ${plan.workItems.length} unidad(es) de trabajo`);

  const errors = plan.issues.filter(i => i.severity === 'error');
  const warnings = plan.issues.filter(i => i.severity === 'warning');
  L.push('');
  L.push(`Errores de validación (${errors.length}):`);
  if (!errors.length) L.push('  (ninguno)');
  errors.forEach(i => L.push(`  ${sev(i)} ${i.code}  ${i.path}\n      ${i.message}`));
  L.push(`Advertencias y conflictos de fechas (${warnings.length}):`);
  if (!warnings.length) L.push('  (ninguno)');
  warnings.forEach(i => L.push(`  ${sev(i)} ${i.code}  ${i.path}\n      ${i.message}`));

  if (plan.workItems.length) {
    L.push('');
    L.push('Unidades de trabajo (línea × bloque × ocurrencia):');
    plan.workItems.forEach(w => L.push(`  ${short(w.workItemKey)}  ${w.serviceName} › ${w.label} ${w.occurrence}/${w.occurrences}  sesión ${w.sessionDate} · límite ${w.deadline} · ${w.checklistCount} ítem(s) · v${w.templateVersion}`));
  }
  if (plan.tasks.length) {
    L.push('');
    L.push('Tarjetas propuestas en FRAME:');
    plan.tasks.forEach(t => {
      L.push(`  ▸ «${t.title}»`);
      L.push(`      doc frame_projects/${t.id}`);
      L.push(`      clave de idempotencia ${t.idempotencyKey}`);
      L.push(`      tablero ${t.workspaceId} · cliente ${t.client} (${t.clientId}) · ${t.viewerIds.length} miembro(s)`);
      L.push(`      sessionDate ${t.sessionDate} · deadline ${t.deadline} · estado ${t.status} · prioridad ${t.priority} · tipo ${t.type}`);
      L.push(`      agrupa ${t.sourceWorkItems.length} unidad(es) · líneas ${t.sourceLineIds.map(short).join(', ')} · plantillas ${t.sourceTemplateVersions.join(', ')}`);
      L.push(`      checklist (${t.checklist.length}):`);
      t.checklist.forEach(c => L.push(`        [ ] ${c.text}   ${c.id}`));
    });
  }
  if (run) {
    L.push('');
    L.push('Dry-run del worker (almacén en memoria, sin red):');
    run.log.forEach((r, i) => {
      if (r.step === 'start_work') { L.push(`  ${i + 1}. el equipo empieza a trabajar en ${short(r.taskId)} (estado y checklist cambian)`); return; }
      const parts = [`${i + 1}. ${r.step} rev ${r.saleRevision}`];
      if (r.note) parts.push(`(${r.note})`);
      parts.push(`→ ${r.status}`);
      if (!r.enqueued) parts.push('· evento ya encolado');
      if (r.created || r.existing || r.updated) parts.push(`· creadas ${r.created} · existentes ${r.existing} · actualizadas ${r.updated}`);
      if (r.flagged) parts.push(`· ${r.flagged} tarjeta(s) marcadas para revisión, 0 borradas`);
      if (r.diff) parts.push(`· diferencia ${JSON.stringify(r.diff)}`);
      if (r.conflicts.length) parts.push(`· conflictos ${r.conflicts.map(c => `${short(c.taskId)}:${c.action}`).join(', ')}`);
      L.push(`  ${parts.join(' ')}`);
    });
    const tasks = run.store.list(core.COLLECTIONS.tasks);
    L.push(`  Total en frame_projects (memoria): ${tasks.length} tarjeta(s), sin duplicados: ${new Set(tasks.map(t => t.idempotencyKey)).size === tasks.length ? 'sí' : 'NO'}`);
  }
  return L.join('\n');
}

const jsonSummary = (scenario, { plan }, run) => ({
  scenario: scenario.name,
  status: plan.status,
  issues: plan.issues,
  tasks: plan.tasks,
  run: run ? run.log : null,
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//   node')).map(l => l.slice(3)).join('\n'));
    return 0;
  }
  const fixtures = loadFixtures(args.fixtures);
  if (args.today) fixtures.context.today = args.today;

  if (args.migration) {
    const legacy = JSON.parse(fs.readFileSync(path.join(args.fixtures, 'legacy-loopa.json'), 'utf8'));
    const first = core.migrateLegacyLoopa(legacy, { clientMap: legacy.clientMap });
    const second = core.migrateLegacyLoopa(legacy, { clientMap: legacy.clientMap });
    const same = core.canonicalJson(first) === core.canonicalJson(second);
    if (args.json) console.log(JSON.stringify({ ...first, repeatable: same }, null, 2));
    else {
      console.log('Dry-run de migración legacy (sin escrituras)');
      console.log(`  conteos: ${JSON.stringify(first.counts)}`);
      first.sales.forEach(s => console.log(`  #${s.n} → ${s.id} · ${s.status} · ${s.lines.length} línea(s) · cliente ${s.client.clientId || '(sin ficha unificada)'}`));
      first.issues.forEach(i => console.log(`  ${sev(i)} ${i.code}  ${i.path}: ${i.message}`));
      console.log(`  huella: ${core.fingerprint(first)} · repetir produce lo mismo: ${same ? 'sí' : 'NO'}`);
    }
    return same ? 0 : 1;
  }

  const selected = fixtures.scenarios.filter(s => !args.scenario || s.name === args.scenario);
  if (!selected.length) throw new Error(`No existe el escenario ${args.scenario}`);
  const out = [];
  let failed = false;
  for (const scenario of selected) {
    const planned = planFor(scenario, fixtures);
    const run = scenario.raw ? null : await runScenario(scenario, fixtures);
    const expectBlocked = ['cliente-desconocido', 'entrega-faltante', 'datos-invalidos'].includes(scenario.name);
    if (!expectBlocked && planned.plan.status === 'blocked') failed = true;
    if (run && run.log.some(r => r.status === 'failed')) failed = true;
    out.push(args.json ? jsonSummary(scenario, planned, run) : printScenario(scenario, planned, run));
  }
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(out.join('\n'));
  return failed ? 1 : 0;
}

main().then(code => { process.exitCode = code; }).catch(err => {
  console.error(`simulate: ${core.sanitizeError(err).message}`);
  process.exitCode = 2;
});
