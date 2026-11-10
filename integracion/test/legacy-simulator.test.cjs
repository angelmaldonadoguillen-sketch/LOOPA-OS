'use strict';
// Migración legacy repetible, simulador CLI y garantías de "sin remoto".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = require('../../functions/production-plan');

const ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(ROOT, 'functions', 'production-plan');
const HARNESS = path.join(ROOT, 'integracion');
const legacy = JSON.parse(fs.readFileSync(path.join(HARNESS, 'fixtures', 'legacy-loopa.json'), 'utf8'));
const simulate = (...args) => spawnSync(process.execPath, [path.join(HARNESS, 'simulate.cjs'), ...args], { encoding: 'utf8', cwd: ROOT });

test('repetir la migración produce el mismo resultado, en cualquier orden', () => {
  const a = core.migrateLegacyLoopa(legacy, { clientMap: legacy.clientMap });
  const b = core.migrateLegacyLoopa(structuredClone(legacy), { clientMap: legacy.clientMap });
  const shuffled = { ventas: { items: [...legacy.ventas.items].reverse() } };
  const c = core.migrateLegacyLoopa(shuffled, { clientMap: legacy.clientMap });
  assert.equal(core.canonicalJson(a), core.canonicalJson(b));
  assert.equal(core.canonicalJson(a), core.canonicalJson(c));
  assert.equal(a.counts.migradas, 3);
});

test('migración: identidad estable, estados y sin trabajo retroactivo', () => {
  const { sales, issues } = core.migrateLegacyLoopa(legacy, { clientMap: legacy.clientMap });
  const byN = Object.fromEntries(sales.map(s => [s.n, s]));
  assert.equal(byN[1002].status, 'cancelled');
  assert.equal(byN[1003].status, 'confirmed');
  assert.equal(byN[1003].legacyProductionState, 'entregado');
  assert.equal(byN[1003].client.clientId, 'cli-demo-cafe-aurora');
  assert.equal(byN[1003].client.legacyClientId, 'CL-DEMO-AURORA');
  assert.equal(byN[1001].client.clientId, null, 'sin ficha unificada: no se adivina por nombre');
  assert.ok(issues.some(i => i.code === 'legacy.client.unmapped' && i.path.includes('1001')));
  assert.equal(byN[1002].lines[0].snapshot.precio, 9000, 'importes con coma de miles');
  assert.ok(issues.some(i => i.code === 'legacy.sale.weak_identity' && i.path.includes('1001')));
  assert.ok(issues.some(i => i.code === 'legacy.line.no_service'));

  // Renumerar el correlativo no cambia la identidad cuando existe `creado`.
  const renumbered = structuredClone(legacy);
  renumbered.ventas.items[0].n = 2003;
  assert.equal(core.migrateLegacyLoopa(renumbered).sales.find(s => s.n === 2003).id, byN[1003].id);

  // Las ventas históricas validan y no generan producción.
  const sale = byN[1003];
  assert.deepEqual(core.validateSale(sale).filter(i => i.severity === 'error'), []);
  const plan = core.planSale(sale, JSON.parse(fs.readFileSync(path.join(HARNESS, 'fixtures', 'context.json'), 'utf8')));
  assert.equal(plan.status, 'nothing_to_do');
  assert.equal(plan.tasks.length, 0);
});

test('simulador: termina bien y su salida JSON es determinista', () => {
  const a = simulate('--json');
  const b = simulate('--json');
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
  const out = JSON.parse(a.stdout);
  const byName = Object.fromEntries(out.map(s => [s.scenario, s]));
  assert.equal(byName['paquete-mismo-dia'].tasks.length, 1);
  assert.equal(byName['plan-mensual'].tasks.length, 4);
  assert.equal(byName['datos-invalidos'].status, 'blocked');
  assert.deepEqual(byName['paquete-mismo-dia'].run.map(r => r.status), ['done', 'already_done', 'done']);
  assert.deepEqual(byName['paquete-mismo-dia'].run.map(r => r.created), [1, 0, 0]);
});

test('simulador: muestra claves, agrupación, checklist, fechas, conflictos y errores', () => {
  const r = simulate();
  assert.equal(r.status, 0, r.stderr);
  for (const fragment of ['clave de idempotencia pkg_', 'agrupa 2 unidad(es)', 'checklist (14)', 'sessionDate 2026-11-17 · deadline 2026-11-20',
    'conflict_started', 'marcadas para revisión, 0 borradas', 'client.unknown', 'sale.entrega.required', 'sin duplicados: sí']) {
    assert.ok(r.stdout.includes(fragment), `falta «${fragment}» en la salida`);
  }
  const migration = simulate('--migration');
  assert.equal(migration.status, 0);
  assert.match(migration.stdout, /repetir produce lo mismo: sí/);
  assert.equal(simulate('--scenario', 'no-existe').status, 2);
});

test('sin remoto: el núcleo y el arnés no cargan Firebase ni abren red', () => {
  const dirs = [LIB, path.join(ROOT, 'functions', 'migration'), path.join(ROOT, 'functions', 'repositories')];
  const files = [
    ...dirs.flatMap(d => fs.readdirSync(d).map(f => path.join(d, f))),
    ...fs.readdirSync(HARNESS).filter(f => f.endsWith('.cjs')).map(f => path.join(HARNESS, f)),
  ];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /require\(['"](firebase|firebase-admin|firebase-functions|@google-cloud)[^'"]*['"]\)/, file);
    assert.doesNotMatch(src, /require\(['"]node:(http|https|net|dgram|tls)['"]\)/, file);
    assert.doesNotMatch(src, /\bfetch\(/, file);
  }
  // Todavía no hay Cloud Functions en LOOPA OS: el núcleo no está conectado a
  // ninguna función desplegable (eso es Fase 3).
  const entry = path.join(ROOT, 'functions', 'index.js');
  if (fs.existsSync(entry)) assert.doesNotMatch(fs.readFileSync(entry, 'utf8'), /production-plan/);
  assert.equal(fs.existsSync(path.join(ROOT, 'firebase.json')), false, 'sin configuración de despliegue en esta fase');
});

test('sin día local por toISOString: el núcleo sólo lo usa para instantes', () => {
  for (const f of fs.readdirSync(LIB)) {
    const src = fs.readFileSync(path.join(LIB, f), 'utf8');
    assert.doesNotMatch(src, /toISOString\(\)\.slice\(0,\s*10\)|toISOString\(\)\.split\('T'\)/, f);
  }
});
