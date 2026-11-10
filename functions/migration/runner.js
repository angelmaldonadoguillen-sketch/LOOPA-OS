'use strict';
// ─────────────────────────────────────────────────────────────────
// Ejecutor de la migración: aplica un plan con dry-run, verificación de
// respaldo, puntos de control y reanudación. Mismo puerto de almacenamiento
// que el worker de producción (forma de Firestore Admin).
//
//   · Nunca sobrescribe: un documento distinto en el destino es conflicto.
//   · Nunca borra.
//   · Reanudable: el cursor vive en loopa_migrations/{runId}. Repetir una
//     operación ya hecha da 'same' (la huella del dato viaja en el documento).
//   · Exige el hash del respaldo verificado: sin respaldo no se escribe.
//   · Una corrida está atada a la huella de su plan: si el plan cambia, se
//     usa otro runId.
// ─────────────────────────────────────────────────────────────────

const { canonicalJson } = require('../production-plan/ids');
const { sanitizeError } = require('../production-plan/errors');
const { backupReceipt: receiptOf } = require('./source');

const RUNS = 'loopa_migrations';
const PLACEHOLDER = /^[\s—–-]*$/;
const empty = (v) => typeof v !== 'string' || PLACEHOLDER.test(v);

// Completa una ficha existente sin pisar lo que ya tiene.
function mergeClient(target, patch) {
  const ids = [...new Set([...(target.legacyLoopaIds || []), ...patch.legacyLoopaIds])].sort();
  const commercial = { ...patch.commercial };
  Object.entries(target.commercial || {}).forEach(([k, v]) => { if (!empty(v)) commercial[k] = v; });
  const contact = { ...(target.contact || {}) };
  if (empty(contact.email) && !empty(patch.commercial.email)) contact.email = patch.commercial.email;
  if (empty(contact.phone) && !empty(patch.commercial.telefono)) contact.phone = patch.commercial.telefono;
  return { legacyLoopaIds: ids, commercial, contact, migration: patch.migration };
}

const sameMerge = (target, patch) => {
  const next = mergeClient(target, patch);
  return canonicalJson(next.legacyLoopaIds) === canonicalJson(target.legacyLoopaIds || [])
    && canonicalJson(next.commercial) === canonicalJson(target.commercial || {})
    && canonicalJson(next.contact) === canonicalJson(target.contact || {});
};

function classify(op, current) {
  if (op.op === 'create') {
    if (!current) return 'create';
    return current.migration && current.migration.hash === op.hash ? 'same' : 'conflict';
  }
  if (!current) return 'conflict_missing_target';
  if (current.workspaceId !== op.data.workspaceId) return 'conflict_workspace';
  // La ficha ya está enlazada a OTRO cliente de LOOPA (p. ej. una corrida con
  // decisiones distintas): no se juntan dos clientes en una ficha.
  const mine = new Set(op.data.legacyLoopaIds);
  if ((current.legacyLoopaIds || []).some(id => !mine.has(id))) return 'conflict_foreign_link';
  return sameMerge(current, op.data) ? 'same' : 'merge';
}

async function dryRun(store, plan) {
  const results = [];
  for (const op of plan.ops) {
    results.push({ collection: op.collection, id: op.id, outcome: classify(op, await store.get(op.collection, op.id)) });
  }
  return summarize(results, { dryRun: true });
}

function summarize(results, extra) {
  const counts = {};
  results.forEach(r => { counts[r.outcome] = (counts[r.outcome] || 0) + 1; });
  const conflicts = results.filter(r => r.outcome.startsWith('conflict'));
  return { ...extra, counts, conflicts, total: results.length };
}

/**
 * @param {object} opts { runId, backupHash, now, checkpointEvery, hooks }
 */
async function runMigration(store, plan, opts) {
  const { runId, archivedBackupText, now = () => new Date().toISOString(), checkpointEvery = 25, hooks = {} } = opts;
  if (plan.status !== 'ready') return { status: 'refused', reason: 'plan_blocked' };
  // El recibo se calcula ACÁ, a partir del contenido de la copia archivada:
  // no se acepta un recibo armado por quien llama.
  const backupReceipt = typeof archivedBackupText === 'string' ? receiptOf(archivedBackupText) : null;
  if (!backupReceipt || backupReceipt.ok !== true || backupReceipt.manifestTotal !== plan.manifest.total) {
    return { status: 'refused', reason: 'backup_not_verified' };
  }
  if (typeof runId !== 'string' || !/^[a-z0-9-]{3,64}$/.test(runId)) return { status: 'refused', reason: 'invalid_run_id' };

  const start = await store.transaction(async tx => {
    const run = await tx.get(RUNS, runId);
    if (!run) {
      tx.create(RUNS, runId, { runId, planFingerprint: plan.fingerprint, sourceManifest: plan.manifest.total, backupFileSha256: backupReceipt.fileSha256, cursor: 0, total: plan.ops.length, status: 'running', counts: {}, conflicts: [], startedAt: now(), updatedAt: now(), lastError: null });
      return { cursor: 0, counts: {}, conflicts: [] };
    }
    if (run.planFingerprint !== plan.fingerprint) return { refused: 'plan_changed' };
    if (run.status === 'done') return { done: true, counts: run.counts, conflicts: [] };
    return { cursor: run.cursor, counts: run.counts || {}, conflicts: run.conflicts || [] };
  });
  if (start.refused) return { status: 'refused', reason: start.refused };
  if (start.done) return { status: 'done', resumed: false, counts: start.counts, conflicts: [] };

  const counts = { ...start.counts };
  // Los conflictos ya encontrados viajan con la corrida: reanudar no los olvida.
  const conflicts = [...start.conflicts];
  let cursor = start.cursor;
  const checkpoint = (status, extra = {}) => store.transaction(async tx => {
    const run = await tx.get(RUNS, runId);
    if (!run || run.planFingerprint !== plan.fingerprint) throw Object.assign(new Error('La corrida cambió de dueño'), { code: 'run_mismatch' });
    tx.update(RUNS, runId, { cursor, counts, conflicts: conflicts.slice(0, 200), status, updatedAt: now(), ...extra });
  });

  try {
    while (cursor < plan.ops.length) {
      const op = plan.ops[cursor];
      if (hooks.beforeOp) await hooks.beforeOp(cursor, op);
      const outcome = await store.transaction(async tx => {
        const current = await tx.get(op.collection, op.id);
        const result = classify(op, current);
        if (result === 'create') tx.create(op.collection, op.id, op.data);
        if (result === 'merge') tx.update(op.collection, op.id, mergeClient(current, op.data));
        return result;
      });
      const key = outcome === 'create' ? 'created' : outcome === 'merge' ? 'merged' : outcome;
      counts[key] = (counts[key] || 0) + 1;
      if (outcome.startsWith('conflict')) conflicts.push({ collection: op.collection, id: op.id, outcome });
      cursor += 1;
      if (cursor % checkpointEvery === 0) await checkpoint('running');
    }
    const status = conflicts.length ? 'done_with_conflicts' : 'done';
    await checkpoint(status === 'done' ? 'done' : 'needs_attention', { finishedAt: now() });
    return { status, resumed: start.cursor > 0, counts, conflicts };
  } catch (err) {
    const safe = sanitizeError(err);
    try { await checkpoint('failed', { lastError: safe }); } catch (inner) { /* el cursor anterior sigue valiendo: reanudar repite ops idempotentes */ safe.checkpoint = sanitizeError(inner).code; }
    return { status: 'failed', error: safe, cursor, counts };
  }
}

module.exports = { runMigration, dryRun, mergeClient, classify, RUNS };
