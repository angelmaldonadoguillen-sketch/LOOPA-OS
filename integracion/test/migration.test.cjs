'use strict';
// Fase 1 — migración simulada al modelo unificado.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { buildMigrationPlan } = require('../../functions/migration/plan');
const { runMigration, dryRun, mergeClient } = require('../../functions/migration/runner');
const { proposeClientMerge } = require('../../functions/migration/clients');
const { sourceManifest, readLoopaSource, backupReceipt } = require('../../functions/migration/source');
const { canonicalJson } = require('../../functions/production-plan/ids');
const { MemoryStore } = require('../memory-store.cjs');

const FX = path.join(__dirname, '..', 'fixtures', 'migration');
const load = (f) => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));
const backupText = fs.readFileSync(path.join(FX, 'loopa-backup.json'), 'utf8');
const backup = JSON.parse(backupText);
const receipt = backupReceipt(backupText);
const frame = load('frame-clients.json');
const { decisions } = load('client-decisions.json');
const WS = frame.workspaceId;
const plan = (over = {}) => buildMigrationPlan({ backup, frameClients: frame.clients, decisions, workspaceId: WS, ...over });
const T = '2026-11-10T03:00:00.000Z';
const seededStore = () => { const s = new MemoryStore(); frame.clients.forEach(c => s.seed('frame_clients', c.id, c)); return s; };
const runOpts = (p, over = {}) => ({ runId: 'run-a', archivedBackupText: backupText, now: () => T, checkpointEvery: 4, ...over });
const errors = (p) => p.issues.filter(i => i.severity === 'error').map(i => i.code);

test('el manifiesto del respaldo es estable y no depende del orden', () => {
  const a = sourceManifest(readLoopaSource(backup).source);
  const shuffled = { ...backup, ventas: [...backup.ventas].reverse(), clientes: [...backup.clientes].reverse() };
  assert.deepEqual(sourceManifest(readLoopaSource(shuffled).source), a);
  const changed = structuredClone(backup);
  changed.ventas[0].total = 1;
  assert.notEqual(sourceManifest(readLoopaSource(changed).source).total, a.total, 'cualquier cambio de datos cambia el hash');
  assert.deepEqual(readLoopaSource({ app: 'TOONED OS', ventas: [], servicios: [] }).issues.map(i => i.code), ['source.app']);
});

test('fusión de clientes: sólo teléfono o email, nunca por nombre', () => {
  const r = proposeClientMerge(backup.clientes, frame.clients, { workspaceId: WS });
  const by = Object.fromEntries(r.proposals.map(p => [p.loopaClientId, p]));
  assert.equal(by['CL-M-AURORA'].final, 'link', '+504 9988-7766 ≡ 99887766');
  assert.equal(by['CL-M-AURORA'].unifiedId, 'fc-mig-aurora', 'el homónimo de otro tablero no cuenta');
  assert.equal(by['CL-M-FERRE'].unifiedId, 'fc-mig-ferre', 'email sin distinguir mayúsculas, aunque el nombre difiera');
  assert.equal(by['CL-M-LIENZO'].reason, 'name_only');
  assert.equal(by['CL-M-LIENZO'].final, 'unresolved', 'mismo nombre no alcanza');
  assert.equal(by['CL-M-MULTI'].reason, 'multiple_candidates');
  assert.equal(by['CL-M-DUP'].reason, 'duplicate_in_loopa');
  assert.equal(by['CL-M-NUEVO'].final, 'new');
  assert.match(by['CL-M-NUEVO'].unifiedId, /^cli_[0-9a-f]{24}$/);
  assert.deepEqual(r.counts, { match: 2, new: 1, conflict: 3, resolvedByDecision: 0, unresolved: 3 });
});

test('fusión: "—" no es un dato y dos clientes no caen en la misma ficha', () => {
  const twins = [
    { id: 'CL-X1', nombre: 'Uno', telefono: '—', email: '—' },
    { id: 'CL-X2', nombre: 'Dos', telefono: '', email: 'compartido@x.example' },
    { id: 'CL-X3', nombre: 'Tres', telefono: '', email: '' },
  ];
  const frameX = [
    { id: 'f1', name: 'Sin datos', workspaceId: WS, contact: { email: '—', phone: '—' } },
    { id: 'f2', name: 'Compartido', workspaceId: WS, contact: { email: 'compartido@x.example', phone: '—' } },
  ];
  const r = proposeClientMerge(twins, frameX, { workspaceId: WS, decisions: { 'CL-X3': { action: 'link', frameClientId: 'f2' } } });
  const by = Object.fromEntries(r.proposals.map(p => [p.loopaClientId, p]));
  assert.equal(by['CL-X1'].final, 'new', 'los guiones de FRAME no emparejan');
  assert.ok(r.issues.some(i => i.code === 'client.decision.shared_target'), 'una decisión no puede juntar dos clientes en una ficha');
  const bad = proposeClientMerge(twins, frameX, { workspaceId: WS, decisions: { 'CL-X1': { action: 'link', frameClientId: 'inventado' }, 'CL-NO': { action: 'new' } } });
  assert.deepEqual(bad.issues.map(i => i.code).sort(), ['client.decision.invalid', 'client.decision.unknown_client']);
});

test('sin decisiones el plan se bloquea; con decisiones queda listo', () => {
  const blocked = plan({ decisions: {} });
  assert.equal(blocked.status, 'blocked');
  assert.equal(errors(blocked).filter(c => c === 'client.unresolved').length, 3);
  const ready = plan();
  assert.equal(ready.status, 'ready', JSON.stringify(errors(ready)));
  assert.equal(ready.clientReport.counts.unresolved, 0);
});

test('conciliación: no se pierde ni un centavo, ni una venta, ni un cobro', () => {
  const p = plan();
  Object.entries(p.reconciliation).forEach(([k, r]) => assert.equal(r.origen, r.destino, k));
  assert.equal(p.reconciliation.total.origen, 48800);
  assert.equal(p.reconciliation.cobrado.origen, 38500);
  const sales = p.ops.filter(o => o.collection === 'loopa_sales').map(o => o.data);
  const ferre = sales.find(s => s.n === 1002);
  assert.equal(ferre.commercial.total, 3000, '"3,000" → 3000');
  assert.match(ferre.commercial.abonos[0].id, /^abono_legacy_/, 'un cobro sin id recibe uno determinista');
  const cancelled = sales.find(s => s.n === 1003);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.lines[1].serviceId, 'SRV-SIN-CATALOGO', 'la línea sin tipo no se pierde');
  assert.ok(sales.every(s => s.version === 1 && s.lock === null && s.operations.status === 'not_applicable'));
  assert.ok(sales.every(s => s.client.clientId), 'toda venta apunta a una ficha única');
  const counter = p.ops.find(o => o.collection === 'loopa_counters');
  assert.equal(counter.data.next, 1006);
});

test('servicios: acuerdo especial re-apuntado a la ficha única', () => {
  const p = plan();
  const esp = p.ops.find(o => o.id === 'SRV-M-ESP').data;
  assert.equal(esp.specialClientId, 'fc-mig-aurora');
  const plan9000 = p.ops.find(o => o.id === 'SRV-M-PLAN').data;
  assert.equal(plan9000.precio, 9000);
  assert.equal(p.ops.find(o => o.id === 'SRV-M-OLD').data.activo, false, 'archivados se migran archivados');
});

test('repetir el plan produce exactamente el mismo resultado, en cualquier orden', () => {
  const a = plan();
  const b = plan();
  const shuffled = buildMigrationPlan({ backup: { ...backup, ventas: [...backup.ventas].reverse(), clientes: [...backup.clientes].reverse(), servicios: [...backup.servicios].reverse() }, frameClients: [...frame.clients].reverse(), decisions, workspaceId: WS });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(canonicalJson(a.ops), canonicalJson(b.ops));
  assert.equal(shuffled.fingerprint, a.fingerprint);
});

test('dry-run no escribe nada', async () => {
  const store = seededStore();
  const before = canonicalJson(store.list('frame_clients'));
  const r = await dryRun(store, plan());
  assert.deepEqual(r.counts, { create: 17, merge: 4 });
  assert.equal(store.stats.creates + store.stats.updates, 0);
  assert.equal(canonicalJson(store.list('frame_clients')), before);
});

test('sin respaldo verificado o con plan bloqueado no se escribe', async () => {
  const store = seededStore();
  const p = plan();
  assert.deepEqual(await runMigration(store, p, runOpts(p, { archivedBackupText: undefined })), { status: 'refused', reason: 'backup_not_verified' });
  const otherBackup = JSON.stringify({ ...backup, ventas: backup.ventas.slice(1) });
  assert.deepEqual(await runMigration(store, p, runOpts(p, { archivedBackupText: otherBackup })), { status: 'refused', reason: 'backup_not_verified' }, 'un respaldo distinto no sirve');
  assert.deepEqual(await runMigration(store, p, runOpts(p, { archivedBackupText: undefined, backupReceipt: { ok: true, manifestTotal: p.manifest.total } })), { status: 'refused', reason: 'backup_not_verified' }, 'un recibo armado a mano se ignora');
  assert.deepEqual(await runMigration(store, plan({ decisions: {} }), runOpts(p)), { status: 'refused', reason: 'plan_blocked' });
  assert.equal(store.stats.creates, 0);
});

test('una corrida interrumpida se reanuda y repetirla no duplica', async () => {
  const store = seededStore();
  const p = plan();
  store.injectFault({ op: 'tx-create', collection: 'loopa_sales', after: 3 });
  const failed = await runMigration(store, p, runOpts(p));
  assert.equal(failed.status, 'failed');
  const run = await store.get('loopa_migrations', 'run-a');
  assert.equal(run.status, 'failed');
  assert.ok(run.cursor > 0 && run.cursor < p.ops.length, 'el cursor quedó a mitad');

  const resumed = await runMigration(store, p, runOpts(p));
  assert.equal(resumed.status, 'done');
  assert.equal(resumed.resumed, true);
  assert.equal(store.list('loopa_sales').length, 6);

  const again = await runMigration(store, p, runOpts(p, { runId: 'run-b' }));
  assert.deepEqual(again.counts, { same: 21 });
  assert.equal(store.list('loopa_sales').length, 6);
  assert.equal((await runMigration(store, p, runOpts(p))).status, 'done', 'una corrida terminada no se repite');
});

test('una corrida no se reanuda con un plan distinto', async () => {
  const store = seededStore();
  const p = plan();
  store.injectFault({ op: 'tx-create', collection: 'loopa_sales', after: 1 });
  await runMigration(store, p, runOpts(p));
  const otherBackup = { ...backup, ventas: backup.ventas.slice(0, 5) };
  const other = buildMigrationPlan({ backup: otherBackup, frameClients: frame.clients, decisions, workspaceId: WS });
  assert.deepEqual(await runMigration(store, other, runOpts(other, { archivedBackupText: JSON.stringify(otherBackup) })), { status: 'refused', reason: 'plan_changed' });
});

test('nunca sobrescribe: un documento distinto es conflicto y se recuerda al reanudar', async () => {
  const store = seededStore();
  const p = plan();
  const sale = p.ops.find(o => o.collection === 'loopa_sales');
  store.seed('loopa_sales', sale.id, { id: sale.id, n: 1, nota: 'escrito a mano' });
  store.injectFault({ op: 'tx-create', collection: 'loopa_expenses', after: 0 });
  const first = await runMigration(store, p, runOpts(p));
  assert.equal(first.status, 'failed');
  const resumed = await runMigration(store, p, runOpts(p));
  assert.equal(resumed.status, 'done_with_conflicts');
  assert.deepEqual(resumed.conflicts.map(c => c.id), [sale.id], 'el conflicto encontrado antes del corte no se olvida');
  assert.equal((await store.get('loopa_sales', sale.id)).nota, 'escrito a mano');
  assert.equal((await store.get('loopa_migrations', 'run-a')).status, 'needs_attention');
});

test('completar una ficha de FRAME nunca pisa nombre ni contacto existentes', () => {
  const target = frame.clients.find(c => c.id === 'fc-mig-ferre');
  const patch = plan().ops.find(o => o.id === 'fc-mig-ferre').data;
  const merged = mergeClient(target, patch);
  assert.equal(merged.contact.email, 'VENTAS@FerreNorte.example', 'el email ya cargado se respeta');
  assert.equal(merged.name, undefined, 'el nombre no forma parte del merge');
  assert.deepEqual(merged.legacyLoopaIds, ['CL-M-FERRE']);
  const aurora = mergeClient(frame.clients.find(c => c.id === 'fc-mig-aurora'), plan().ops.find(o => o.id === 'fc-mig-aurora').data);
  assert.equal(aurora.contact.email, 'hola@cafeaurora.example', 'un «—» se completa con el dato de LOOPA');
  assert.equal(aurora.contact.name, 'Ana');
});

test('CLI: simulación completa y determinista; bloquea sin decisiones', () => {
  const root = path.join(__dirname, '..', '..');
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'integracion', 'migrate.cjs'), ...args], { encoding: 'utf8', cwd: root });
  const a = run('--json', '--simulate');
  const b = run('--json', '--simulate');
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
  const out = JSON.parse(a.stdout);
  assert.deepEqual(out.rehearsal.steps.map(s => s.status || 'dry-run'), ['dry-run', 'refused', 'failed', 'done', 'done', 'dry-run']);
  assert.deepEqual(out.rehearsal.steps.at(-1).counts, { same: 21 });
  assert.equal(run('--no-decisions').status, 3);
  assert.match(run('--no-decisions').stdout, /Plantilla para client-decisions\.json/);
});

test('lectura compatible: lo migrado se lee con la forma vieja sin perder nada', () => {
  const { toLegacyVenta, toLegacyCliente, toLegacyServicio } = require('../../functions/migration/compat');
  const num = (v) => Number(String(v ?? '').replace(/,/g, ''));
  const p = plan();
  const docs = (col) => p.ops.filter(o => o.collection === col).map(o => o.data);
  const clientMap = Object.fromEntries(p.clientReport.proposals.map(x => [x.loopaClientId, x.unifiedId]));
  const byCreado = (v) => docs('loopa_sales').find(d => d.n === v.n && d.fecha === v.fecha);
  backup.ventas.forEach(v => {
    const back = toLegacyVenta(byCreado(v));
    assert.equal(back.n, v.n);
    assert.equal(back.fecha, v.fecha);
    assert.equal(back.cliente, v.cliente);
    assert.equal(back.clienteId, clientMap[v.clienteId], 'apunta a la ficha única');
    assert.equal(back.total, num(v.total));
    assert.equal(back.estado, v.estado, 'el estado de producción histórico se conserva');
    assert.equal(back.entrega, v.entrega || '');
    assert.deepEqual(back.abonos.map(a => a.monto), (v.abonos || []).map(a => num(a.monto)));
    assert.deepEqual(back.items.map(i => [i.tipoId || '', i.nombre, i.q, i.precio]), v.items.map(i => [i.tipoId || '', i.nombre, num(i.q) || 1, num(i.precio)]));
  });
  backup.servicios.forEach(s => {
    const back = toLegacyServicio(docs('loopa_services').find(d => d.id === s.id));
    assert.equal(back.nombre, s.nombre);
    assert.equal(back.precio, num(s.precio));
    assert.equal(back.activo, s.activo !== false);
  });
  const nuevo = toLegacyCliente(docs('frame_clients').find(d => d.legacyLoopaIds && d.legacyLoopaIds.includes('CL-M-NUEVO')));
  assert.deepEqual([nuevo.nombre, nuevo.telefono, nuevo.canal], ['Panadería Sol', '3311-2244', 'Facebook']);
});
