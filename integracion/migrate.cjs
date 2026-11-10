#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────
// Migración LOOPA → modelo unificado, en modo SIMULACIÓN.
// Sólo lee archivos locales y escribe en memoria. No hay código de red.
//
//   node integracion/migrate.cjs                                   fixtures de ejemplo
//   node integracion/migrate.cjs --backup <respaldo.json> --frame-clients <frame_clients.json> \
//        --decisions <client-decisions.json> --workspace <id>
//   node integracion/migrate.cjs --simulate                        además ensaya la corrida (memoria):
//                                                                  interrupción, reanudación y repetición
//   node integracion/migrate.cjs --json                            salida JSON determinista
//   --archived-backup <copia.json>  la corrida verifica contra la copia archivada del respaldo
//
// Código de salida: 0 plan listo, 3 plan bloqueado (faltan decisiones o hay errores), 2 error de uso.
// ─────────────────────────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');
const { buildMigrationPlan } = require('../functions/migration/plan');
const { runMigration, dryRun } = require('../functions/migration/runner');
const { backupReceipt } = require('../functions/migration/source');
const { sanitizeError } = require('../functions/production-plan/errors');
const { MemoryStore } = require('./memory-store.cjs');

const FX = path.join(__dirname, 'fixtures', 'migration');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function parseArgs(argv) {
  const a = { backup: path.join(FX, 'loopa-backup.json'), frameClients: path.join(FX, 'frame-clients.json'), decisions: path.join(FX, 'client-decisions.json'), workspace: null, json: false, simulate: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--json') a.json = true;
    else if (k === '--simulate') a.simulate = true;
    else if (k === '--no-decisions') a.decisions = null;
    else if (['--backup', '--frame-clients', '--decisions', '--workspace', '--archived-backup'].includes(k)) {
      const v = argv[++i];
      if (!v) throw new Error(`Falta el valor de ${k}`);
      if (k === '--backup') a.backup = path.resolve(v);
      if (k === '--frame-clients') a.frameClients = path.resolve(v);
      if (k === '--decisions') a.decisions = path.resolve(v);
      if (k === '--workspace') a.workspace = v;
      if (k === '--archived-backup') a.archived = path.resolve(v);
    } else throw new Error(`Argumento desconocido: ${k}`);
  }
  return a;
}

async function rehearse(plan, frameClients, archivedBackupText) {
  const store = new MemoryStore();
  frameClients.forEach(c => store.seed('frame_clients', c.id, c));
  const T = '2026-11-10T03:00:00.000Z';
  const opts = { runId: 'ensayo-1', archivedBackupText, now: () => T, checkpointEvery: 5 };
  const steps = [];
  steps.push({ paso: 'dry-run', ...(await dryRun(store, plan)) });
  steps.push({ paso: 'sin respaldo verificado', ...(await runMigration(store, plan, { ...opts, archivedBackupText: null })) });
  // Corte a mitad: falla la cuarta venta y la corrida queda interrumpida.
  store.injectFault({ op: 'tx-create', collection: 'loopa_sales', after: 3, message: 'Conexión perdida' });
  steps.push({ paso: 'corrida interrumpida', ...(await runMigration(store, plan, opts)) });
  steps.push({ paso: 'reanudación', ...(await runMigration(store, plan, opts)) });
  steps.push({ paso: 'otra corrida completa del mismo plan', ...(await runMigration(store, plan, { ...opts, runId: 'ensayo-2' })) });
  steps.push({ paso: 'dry-run posterior', ...(await dryRun(store, plan)) });
  const sales = store.list('loopa_sales');
  return { steps, docs: { ventas: sales.length, clientes: store.list('frame_clients').length, counter: (await store.get('loopa_counters', 'sales')).next } };
}

function printHuman(plan, input, rehearsal) {
  const L = [];
  L.push('Migración LOOPA → modelo unificado · SIMULACIÓN (sin escrituras remotas)');
  L.push(`Plan: ${plan.status === 'ready' ? 'LISTO' : 'BLOQUEADO'} · huella ${plan.fingerprint || '—'}`);
  if (plan.manifest) {
    L.push('');
    L.push(`Manifiesto del respaldo (hash total ${plan.manifest.total}):`);
    Object.entries(plan.manifest.collections).forEach(([k, v]) => L.push(`  ${k.padEnd(16)} ${String(v.count).padStart(5)}  ${v.hash}`));
  }
  if (plan.clientReport) {
    L.push('');
    L.push(`Fusión de clientes: ${JSON.stringify(plan.clientReport.counts)}`);
    plan.clientReport.proposals.forEach(p => {
      const how = p.final === 'unresolved' ? `SIN RESOLVER (${p.reason}; candidatos: ${p.candidates.join(', ') || '—'})`
        : `${p.final === 'new' ? 'ficha nueva' : 'se enlaza a'} ${p.unifiedId}${p.resolution ? ' · por decisión' : p.reason ? '' : ' · automático'}`;
      L.push(`  ${p.loopaClientId.padEnd(14)} ${p.nombre.padEnd(26)} → ${how}`);
    });
    const pending = plan.clientReport.proposals.filter(p => p.final === 'unresolved');
    if (pending.length) {
      L.push('  Plantilla para client-decisions.json:');
      L.push(`  ${JSON.stringify({ decisions: Object.fromEntries(pending.map(p => [p.loopaClientId, p.candidates.length ? { action: 'link', frameClientId: p.candidates[0] } : { action: 'new' }])) })}`);
    }
  }
  if (plan.reconciliation) {
    L.push('');
    L.push('Conciliación (origen → destino):');
    Object.entries(plan.reconciliation).forEach(([k, r]) => L.push(`  ${k.padEnd(10)} ${r.origen} → ${r.destino} ${r.origen === r.destino ? '✓' : '✖'}`));
  }
  L.push('');
  L.push(`Escrituras planificadas: ${JSON.stringify(plan.counts)}`);
  const errors = plan.issues.filter(i => i.severity === 'error');
  const warnings = plan.issues.filter(i => i.severity === 'warning');
  L.push(`Errores (${errors.length}):`);
  errors.forEach(i => L.push(`  ✖ ${i.code}  ${i.path}: ${i.message}`));
  L.push(`Advertencias (${warnings.length}):`);
  warnings.forEach(i => L.push(`  ⚠ ${i.code}  ${i.path}: ${i.message}`));
  if (rehearsal) {
    L.push('');
    L.push('Ensayo de la corrida (almacén en memoria):');
    rehearsal.steps.forEach((s, i) => L.push(`  ${i + 1}. ${s.paso}: ${s.status || (s.dryRun ? 'dry-run' : '')} ${s.reason ? `(${s.reason})` : ''} ${s.counts ? JSON.stringify(s.counts) : ''} ${s.conflicts && s.conflicts.length ? `conflictos ${s.conflicts.length}` : ''}`.trimEnd()));
    L.push(`  Resultado: ${rehearsal.docs.ventas} ventas, ${rehearsal.docs.clientes} fichas de cliente, próximo correlativo #${rehearsal.docs.counter}`);
    L.push(`  Respaldo archivado: sha256 ${rehearsal.archivedBackup.sha256}${rehearsal.archivedBackup.separateCopy ? '' : ' · ⚠ es el mismo archivo de entrada: en la corrida real usá --archived-backup con la copia guardada aparte'}`);
  }
  return L.join('\n');
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const backupText = fs.readFileSync(a.backup, 'utf8');
  const backup = JSON.parse(backupText);
  // La corrida verifica contra la COPIA ARCHIVADA del respaldo. En el ensayo,
  // si no se indica otra, se usa el mismo archivo (y se avisa).
  const archivedText = fs.readFileSync(a.archived || a.backup, 'utf8');
  const receipt = backupReceipt(archivedText);
  const frame = readJson(a.frameClients);
  const decisions = a.decisions ? readJson(a.decisions).decisions || {} : {};
  const workspaceId = a.workspace || frame.workspaceId;
  const plan = buildMigrationPlan({ backup, frameClients: frame.clients || [], decisions, workspaceId });
  const rehearsal = a.simulate && plan.status === 'ready' ? await rehearse(plan, frame.clients || [], archivedText) : null;
  if (rehearsal) rehearsal.archivedBackup = { sha256: receipt.fileSha256, separateCopy: !!a.archived };
  if (a.json) {
    const { ops, ...rest } = plan;
    console.log(JSON.stringify({ ...rest, ops: ops.map(o => ({ op: o.op, collection: o.collection, id: o.id, hash: o.hash })), rehearsal }, null, 2));
  } else {
    console.log(printHuman(plan, a, rehearsal));
  }
  return plan.status === 'ready' ? 0 : 3;
}

main().then(code => { process.exitCode = code; }).catch(err => {
  console.error(`migrate: ${sanitizeError(err).message}`);
  process.exitCode = 2;
});

