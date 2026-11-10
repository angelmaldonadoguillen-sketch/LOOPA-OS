'use strict';
// Regresiones de la revisión independiente de la Fase 1 (2026-11-09).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { buildMigrationPlan } = require('../../functions/migration/plan');
const { runMigration } = require('../../functions/migration/runner');
const { backupReceipt } = require('../../functions/migration/source');
const { proposeClientMerge } = require('../../functions/migration/clients');
const { toLegacyVenta, toLegacyCliente } = require('../../functions/migration/compat');
const repo = require('../../functions/repositories/sales');
const core = require('../../functions/production-plan');
const { MemoryStore } = require('../memory-store.cjs');
const { loadFixtures, buildSale } = require('../harness.cjs');

const FX = path.join(__dirname, '..', 'fixtures', 'migration');
const backupText = fs.readFileSync(path.join(FX, 'loopa-backup.json'), 'utf8');
const backup = JSON.parse(backupText);
const frame = JSON.parse(fs.readFileSync(path.join(FX, 'frame-clients.json'), 'utf8'));
const { decisions } = JSON.parse(fs.readFileSync(path.join(FX, 'client-decisions.json'), 'utf8'));
const WS = frame.workspaceId;
const T = '2026-11-10T03:00:00.000Z';
const planOf = (b, d = decisions) => buildMigrationPlan({ backup: b, frameClients: frame.clients, decisions: d, workspaceId: WS });
const codes = (p, severity = 'error') => p.issues.filter(i => i.severity === severity).map(i => i.code);
const clone = () => structuredClone(backup);

const fx = loadFixtures();
function salesStore() {
  const store = new MemoryStore();
  store.seed(repo.COUNTERS, 'sales', { next: 2000 });
  Object.entries(fx.context.clients).forEach(([id, c]) => store.seed('frame_clients', id, { id, ...c }));
  return store;
}
function draft(over = {}) {
  const sale = buildSale(structuredClone(fx.scenarios.find(s => s.name === 'paquete-mismo-dia').sale), fx.services);
  const { n, revision, schemaVersion, ...rest } = sale;
  return { ...rest, id: crypto.randomUUID(), status: 'confirmed', commercial: { subtotal: 9000, descuento: 0, total: 9000, pay: 'bac', abonos: [], canal: 'WhatsApp', nota: 'n', contacto: { telefono: '', email: '' } }, ...over };
}

test('F1 volver a borrador no existe (dejaría producción sin evento)', async () => {
  const store = salesStore();
  const d = draft();
  await repo.createSale(store, d, { now: () => T });
  await assert.rejects(repo.updateSale(store, d.id, { status: 'draft' }, { expectedVersion: 1 }), err => err.code === 'invalid_transition');
  const c = await repo.updateSale(store, d.id, { status: 'cancelled' }, { expectedVersion: 1, now: () => T });
  await assert.rejects(repo.updateSale(store, d.id, { status: 'draft' }, { expectedVersion: c.version }), err => err.code === 'invalid_transition');
});

test('F2 importes ilegibles bloquean; con miles se convierten con advertencia y se guarda el original', () => {
  const bad = clone();
  bad.ventas[0].abonos[0].monto = 'L 6,000';
  bad.ventas[1].total = '1.500,50';
  const p = planOf(bad);
  assert.equal(p.status, 'blocked');
  assert.equal(codes(p).filter(c => c === 'legacy.amount.unparseable').length, 2);
  const ok = planOf(backup);
  const ferre = ok.ops.find(o => o.collection === 'loopa_sales' && o.data.n === 1002).data;
  assert.equal(ferre.commercial.total, 3000);
  assert.equal(ferre.legacyRaw.total, '3,000', 'el texto original queda para auditoría');
  assert.ok(codes(ok, 'warning').includes('legacy.amount.formatted'));
});

test('F3 ids repetidos: gastos se re-identifican sin perder ninguno; clientes repetidos bloquean', () => {
  const dupExp = clone();
  dupExp.gastos.variables.push({ id: 'GV-M-1', fecha: '2026-09-07', concepto: 'Otro freelancer', categoria: 'Freelancer', monto: 900 });
  const p = planOf(dupExp);
  assert.equal(p.status, 'ready');
  const expenses = p.ops.filter(o => o.collection === 'loopa_expenses');
  assert.equal(expenses.length, 4, 'no se pierde ningún gasto');
  assert.equal(new Set(expenses.map(e => e.id)).size, 4);
  assert.ok(expenses.every(e => e.id !== 'GV-M-1'), 'un id ambiguo no se usa');

  const dupCli = clone();
  dupCli.clientes.push({ ...dupCli.clientes[0], nombre: 'Otro con el mismo id' });
  const q = planOf(dupCli);
  assert.equal(q.status, 'blocked');
  assert.ok(codes(q).includes('legacy.client.duplicate_id'));
  assert.equal(planOf(backup).reconciliation.clientes.origen, planOf(backup).reconciliation.clientes.destino);
});

test('F4 los ids de gastos no dependen de la posición', () => {
  const reversed = clone();
  reversed.gastos.variables.reverse();
  assert.equal(planOf(reversed).fingerprint, planOf(backup).fingerprint);
  // La app vieja inserta los gastos nuevos al frente: los viejos conservan su id.
  const grown = clone();
  grown.gastos.variables.unshift({ fecha: '2026-11-01', concepto: 'Nuevo', categoria: 'Otro', monto: 10 });
  const oldIds = planOf(backup).ops.filter(o => o.collection === 'loopa_expenses').map(o => o.id);
  const newIds = planOf(grown).ops.filter(o => o.collection === 'loopa_expenses').map(o => o.id);
  assert.ok(oldIds.every(id => newIds.includes(id)));
});

test('F5 el outbox no lleva precio ni costo', async () => {
  const store = salesStore();
  const created = await repo.createSale(store, draft(), { now: () => T });
  const ev = await store.get(core.COLLECTIONS.events, created.eventId);
  assert.doesNotMatch(JSON.stringify(ev.payload), /"precio"|"costo"|"total"|"abonos"/);
  assert.equal((await core.processEvent(store, created.eventId, { context: fx.context, now: () => T })).status, 'done', 'producción no los necesita');
});

test('F6 una corrida con otras decisiones no junta dos clientes en una ficha', async () => {
  const store = new MemoryStore();
  frame.clients.forEach(c => store.seed('frame_clients', c.id, c));
  const p1 = planOf(backup);
  assert.equal((await runMigration(store, p1, { runId: 'run-1', archivedBackupText: backupText, now: () => T })).status, 'done');
  const p2 = planOf(backup, { ...decisions, 'CL-M-LIENZO': { action: 'new' }, 'CL-M-NUEVO': { action: 'link', frameClientId: 'fc-mig-lienzo' } });
  const r2 = await runMigration(store, p2, { runId: 'run-2', archivedBackupText: backupText, now: () => T });
  assert.ok(r2.conflicts.some(c => c.id === 'fc-mig-lienzo' && c.outcome === 'conflict_foreign_link'));
  assert.deepEqual((await store.get('frame_clients', 'fc-mig-lienzo')).legacyLoopaIds, ['CL-M-LIENZO']);
});

test('F7 teléfono de oficina compartido no enlaza negocios distintos; extensiones y varios números', () => {
  const frameX = [
    { id: 'f-taller', name: 'Taller Mecánico Ruiz', workspaceId: WS, contact: { phone: '5566 7788', email: '—' } },
    { id: 'f-delta', name: 'Delta', workspaceId: WS, contact: { phone: '+504 2222-3333', email: '—' } },
    { id: 'f-multi', name: 'Panadería Luna', workspaceId: WS, contact: { phone: '9988-0000 / 3311-0000', email: '—' } },
  ];
  const r = proposeClientMerge([
    { id: 'CL-A', nombre: 'Panadería Sol', telefono: '+504 5566-7788' },
    { id: 'CL-B', nombre: 'Delta', telefono: '2222-3333 ext 12' },
    { id: 'CL-C', nombre: 'Panadería Luna', telefono: '3311-0000' },
  ], frameX, { workspaceId: WS });
  const by = Object.fromEntries(r.proposals.map(p => [p.loopaClientId, p]));
  assert.equal(by['CL-A'].reason, 'phone_only_name_mismatch');
  assert.equal(by['CL-A'].final, 'unresolved');
  assert.equal(by['CL-B'].unifiedId, 'f-delta', 'la extensión no impide coincidir');
  assert.equal(by['CL-C'].unifiedId, 'f-multi', 'cualquiera de los números del campo');
});

test('F8 el recibo de respaldo sale del archivo, no del plan', async () => {
  const p = planOf(backup);
  const store = new MemoryStore();
  const fake = { ok: true, fileSha256: '0'.repeat(64), manifestTotal: p.manifest.total };
  assert.equal((await runMigration(store, p, { runId: 'r', backupReceipt: fake, now: () => T })).reason, 'backup_not_verified', 'no se acepta un recibo de afuera');
  assert.equal((await runMigration(store, p, { runId: 'r', archivedBackupText: '{"app":"LOOPA OS","ventas":[],"servicios":[]}', now: () => T })).reason, 'backup_not_verified');
  assert.equal(backupReceipt('{no es json').ok, false);
  assert.equal(backupReceipt(backupText).manifestTotal, p.manifest.total);
});

test('F9 lectura compatible fiel a la interfaz vieja', () => {
  assert.equal(toLegacyVenta({ status: 'draft' }), null, 'un borrador no cuenta como venta activa');
  const p = planOf(backup);
  const doc = p.ops.find(o => o.collection === 'loopa_sales' && o.data.n === 1001).data;
  const v = toLegacyVenta({ ...doc, estadoLog: [{ estado: 'draft', ts: 'a' }, { estado: 'confirmed', ts: 'b' }, { estado: 'cancelled', ts: 'c' }] });
  assert.deepEqual(v.estadoLog.map(e => e.estado), ['pendiente', 'cancelado']);
  assert.equal(v.items[0].recomendado, true, 'el snapshot conserva «recomendado»');
  const lienzo = p.ops.find(o => o.id === 'fc-mig-lienzo').data;
  assert.equal(lienzo.commercial.nombreLoopa, 'Estudio Lienzo', 'el nombre que usaba LOOPA no se pierde');
  const esp = p.ops.find(o => o.collection === 'loopa_sales' && o.data.n === 1005 && o.data.lines[0].serviceId === 'SRV-M-ESP');
  assert.ok(esp);
  assert.equal(toLegacyCliente({ id: 'x', name: 'Ficha', commercial: { nombreLoopa: 'Viejo', telefono: '1' }, contact: {} }).nombre, 'Viejo', 'las pantallas viejas muestran el nombre de LOOPA');
  assert.equal(toLegacyCliente({ id: 'y', name: 'Ficha', commercial: {}, contact: {} }).nombre, 'Ficha');
});

test('F10 el repositorio no acepta campos de más, cobros de más ni clientes inexistentes', async () => {
  const store = salesStore();
  await assert.rejects(repo.createSale(store, { ...draft(), migration: { x: 1 } }), err => err.code === 'field_not_editable');
  await assert.rejects(repo.createSale(store, draft({ client: { clientId: 'cli-inexistente', nombre: 'X', empresa: '' } })), err => err.code === 'client_unknown');
  const d = draft();
  await repo.createSale(store, d, { now: () => T });
  await repo.updateSale(store, d.id, { commercial: { nota: 'otra' } }, { expectedVersion: 1, now: () => T });
  const sale = await store.get(core.COLLECTIONS.sales, d.id);
  assert.equal(sale.commercial.pay, 'bac', 'editar una parte no borra el resto');
  await assert.rejects(repo.updateSale(store, d.id, { commercial: { abonos: [] } }, { expectedVersion: 2 }), err => err.code === 'use_add_payment');
  await assert.rejects(repo.addPayment(store, d.id, { id: 'AB-x', fecha: '2026-11-10', monto: 1e9, metodo: 'bac' }), err => err.code === 'payment_exceeds_total');
  const c = await repo.updateSale(store, d.id, { status: 'cancelled' }, { expectedVersion: 2, now: () => T });
  await assert.rejects(repo.updateSale(store, d.id, { status: 'cancelled', lines: d.lines.map(l => ({ ...l, quantity: 9 })) }, { expectedVersion: c.version }), err => err.code === 'sale_cancelled');
  await assert.rejects(repo.updateSale(store, d.id, { client: { clientId: 'cli-inexistente', nombre: 'X', empresa: '' }, status: 'confirmed' }, { expectedVersion: c.version }), err => err.code === 'client_unknown');
});

test('F11 datos que la app vieja aceptaba se migran marcados; ventas sin cliente reciben ficha', () => {
  const odd = clone();
  odd.ventas[4].entrega = '2026-10-01'; // anterior a la venta
  odd.ventas[4].items[0].precio = -100;
  odd.ventas.push({ n: 1006, fecha: '2026-10-10', cliente: 'Kiosko Sin Ficha', telefono: '7777-8888', items: [], subtotal: 0, descuento: 0, total: 0, pay: 'bac', abonos: [], estado: 'pendiente', entrega: '', creado: '2026-10-10T10:00:00.000Z' });
  odd.ventas.push({ n: 1007, fecha: '2026-10-11', cliente: 'Cliente Borrado', clienteId: 'CL-YA-NO-EXISTE', items: [{ tipoId: 'SRV-M-REEL', nombre: 'Reel', precio: 1, costo: 0, q: 1 }], subtotal: 1, descuento: 0, total: 1, pay: 'bac', abonos: [], estado: 'pendiente', entrega: '', creado: '2026-10-11T10:00:00.000Z' });
  const p = planOf(odd);
  assert.equal(p.status, 'ready', JSON.stringify(codes(p)));
  const warnings = codes(p, 'warning');
  ['sale.entrega.before_sale', 'line.snapshot.precio', 'sale.lines.empty', 'legacy.sale.orphan_client'].forEach(c => assert.ok(warnings.includes(c), c));
  const marked = p.ops.find(o => o.collection === 'loopa_sales' && o.data.n === 1005 && o.data.client.legacyClientId === 'CL-M-NUEVO').data;
  assert.deepEqual(marked.legacyIssues, ['line.snapshot.precio', 'sale.entrega.before_sale']);
  const orphanIds = p.clientReport.proposals.filter(x => x.loopaClientId.startsWith('CL-ORPHAN-')).map(x => x.loopaClientId);
  assert.equal(orphanIds.length, 2);
  // La ficha huérfana admite decisiones como cualquier otra.
  const linked = planOf(odd, { ...decisions, [orphanIds[0]]: { action: 'link', frameClientId: 'fc-mig-solo-frame' } });
  assert.equal(linked.status, 'ready');
  assert.equal(linked.reconciliation.ventas.origen, linked.reconciliation.ventas.destino);
});

// ── Segunda ronda de la revisión de la Fase 1 ────────────────────

test('R2-A el repositorio valida precio y costo de cada línea', async () => {
  const store = salesStore();
  const d = draft();
  d.lines = d.lines.map((l, i) => (i === 0 ? { ...l, snapshot: { ...l.snapshot, precio: -5, costo: 'abc' } } : l));
  await assert.rejects(repo.createSale(store, d), err => err.name === 'ContractError' && err.issues.some(i => i.code === 'line.snapshot.precio') && err.issues.some(i => i.code === 'line.snapshot.costo'));
});

test('R2-B una venta migrada con problemas viejos sigue siendo editable', async () => {
  const odd = clone();
  odd.ventas[4].entrega = '2026-10-01'; // anterior a la venta
  odd.ventas[0].abonos[0].fecha = '10/09/2026';
  const p = planOf(odd);
  assert.equal(p.status, 'ready');
  const store = new MemoryStore();
  frame.clients.forEach(c => store.seed('frame_clients', c.id, c));
  assert.equal((await runMigration(store, p, { runId: 'mig-b', archivedBackupText: JSON.stringify(odd), now: () => T })).status, 'done');
  const late = store.list('loopa_sales').find(s => s.n === 1005 && s.client.legacyClientId === 'CL-M-NUEVO');
  assert.ok(late.legacyIssues.includes('sale.entrega.before_sale'));
  // Cancelarla o anotar algo no toca la fecha: se permite.
  const c = await repo.updateSale(store, late.id, { status: 'cancelled' }, { expectedVersion: late.version, now: () => T });
  assert.equal(c.status, 'updated');
  const paid = store.list('loopa_sales').find(s => s.n === 1001);
  assert.ok(paid.legacyIssues.includes('payment.fecha'));
  assert.equal((await repo.updateSale(store, paid.id, { commercial: { nota: 'ok' } }, { expectedVersion: paid.version, now: () => T })).status, 'updated');
  assert.equal(c.eventId, null, 'nunca pasó por Producción: no hay evento que encolar');
  // Tocar el campo con problema exige corregirlo.
  const fresh = store.list('loopa_sales').find(s => s.n === 1005 && s.client.legacyClientId === 'CL-M-NUEVO');
  await assert.rejects(repo.updateSale(store, fresh.id, { status: 'confirmed', entrega: '2026-09-01' }, { expectedVersion: fresh.version }), err => err.code === 'invalid');
  // Re-confirmarla sin corregir: no se encola un evento inválido.
  await assert.rejects(repo.updateSale(store, fresh.id, { status: 'confirmed' }, { expectedVersion: fresh.version }), err => err.code === 'production_invalid' && err.issues.some(i => i.code === 'sale.entrega.before_sale'));
  // Corrigiendo la entrega, sí.
  const ok = await repo.updateSale(store, fresh.id, { status: 'confirmed', entrega: '2026-10-12' }, { expectedVersion: fresh.version, now: () => T });
  assert.ok(ok.eventId);
});

test('R2-C fichas huérfanas: independientes del orden y sin perder el id original', () => {
  const odd = clone();
  odd.ventas.push({ n: 1010, fecha: '2026-10-20', cliente: 'panaderia SOL', empresa: 'Panadería Sol S.A.', telefono: '7777-0000', clienteId: 'CL-BORRADO', items: [{ tipoId: 'SRV-M-REEL', nombre: 'Reel', precio: 1, costo: 0, q: 1 }], subtotal: 1, descuento: 0, total: 1, pay: 'bac', abonos: [], estado: 'pendiente', entrega: '', creado: '2026-10-20T10:00:00.000Z' });
  odd.ventas.push({ n: 1011, fecha: '2026-10-21', cliente: 'Panadería Sol', empresa: '', telefono: '7777-1111', clienteId: 'CL-BORRADO', items: [{ tipoId: 'SRV-M-REEL', nombre: 'Reel', precio: 1, costo: 0, q: 1 }], subtotal: 1, descuento: 0, total: 1, pay: 'bac', abonos: [], estado: 'pendiente', entrega: '', creado: '2026-10-21T10:00:00.000Z' });
  const a = planOf(odd);
  const b = planOf({ ...odd, ventas: [...odd.ventas].reverse() });
  assert.equal(a.fingerprint, b.fingerprint, 'el orden del respaldo no cambia la ficha');
  const orphanProposals = a.clientReport.proposals.filter(x => x.loopaClientId.startsWith('CL-ORPHAN-'));
  assert.equal(orphanProposals.length, 1, 'el mismo cliente borrado da una sola ficha aunque cambie el teléfono');
  const sales = a.ops.filter(o => o.collection === 'loopa_sales' && o.data.n >= 1010).map(o => o.data);
  assert.ok(sales.every(s => s.client.legacyClientId === 'CL-BORRADO' && s.client.orphanClientId === orphanProposals[0].loopaClientId));
});

test('R2-D nombres: palabras enteras, no subcadenas', () => {
  const frameX = [
    { id: 'f-mariana', name: 'Mariana Pérez', workspaceId: WS, contact: { phone: '1111-2222', email: '—' } },
    { id: 'f-soluciones', name: 'Soluciones Industriales', workspaceId: WS, contact: { phone: '3333-4444', email: '—' } },
    { id: 'f-aurora', name: 'Café Aurora S.A.', workspaceId: WS, contact: { phone: '5555-6666', email: '—' } },
  ];
  const r = proposeClientMerge([
    { id: 'CL-1', nombre: 'Ana', telefono: '1111-2222' },
    { id: 'CL-2', nombre: 'Sol', telefono: '3333-4444' },
    { id: 'CL-3', nombre: 'Café Aurora', telefono: '5555-6666' },
  ], frameX, { workspaceId: WS });
  const by = Object.fromEntries(r.proposals.map(p => [p.loopaClientId, p]));
  assert.equal(by['CL-1'].reason, 'phone_only_name_mismatch');
  assert.equal(by['CL-2'].reason, 'phone_only_name_mismatch');
  assert.equal(by['CL-3'].unifiedId, 'f-aurora');
});

test('R2-2 formas numéricas sin ambigüedad se aceptan con advertencia', () => {
  const { parseAmount } = require('../../functions/migration/amounts');
  ['9000.', '.5', '+500', '1e3', '1,500.'].forEach(s => assert.ok(Number.isFinite(parseAmount(s).value), s));
  ['L 6,000', '1.500,50', '12abc', '--5'].forEach(s => assert.equal(parseAmount(s).kind, 'invalid', s));
  const loose = clone();
  loose.ventas[0].abonos[0].monto = '6000.';
  const p = planOf(loose);
  assert.equal(p.status, 'ready');
  assert.ok(codes(p, 'warning').includes('legacy.amount.formatted'));
});
