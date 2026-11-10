#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// Carga las plantillas de producción (plantillas-produccion.cjs) en
// loopa_services/{id}.executionPlan de frame-studio-3a18f.
//
//   node integracion/puesta-en-marcha/plantillas.cjs --respaldo <carpeta b-…> --tablero <id> [--escribir]
//
// Antes valida cada plantilla (contrato + columnas y tipos REALES del tablero,
// del respaldo de B0). Sólo actualiza el campo executionPlan de servicios que
// ya existen (los crea la migración). Nunca baja ni pisa una versión: una
// plantilla distinta con la misma versión se rechaza.
// ─────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const { validateExecutionPlan } = require('../../functions/production-plan/contracts');
const { canonicalJson } = require('../../functions/production-plan/ids');
const { PLANTILLAS } = require('./plantillas-produccion.cjs');

// Pura: problemas de una plantilla para un tablero { statusIds, typeIds }.
function revisar(plan, tablero) {
  const out = validateExecutionPlan(plan).filter(i => i.severity !== 'warning').map(i => `${i.path}: ${i.message}`);
  (plan.templates || []).forEach((t, i) => {
    if (tablero.statusIds && !tablero.statusIds.includes(t.initialStatus)) out.push(`templates[${i}].initialStatus: «${t.initialStatus}» no es una columna del tablero`);
    if (tablero.typeIds && !tablero.typeIds.includes(t.type)) out.push(`templates[${i}].type: «${t.type}» no es un tipo del tablero`);
  });
  return out;
}

// Pura: qué hacer con un servicio dado lo que tiene ahora.
function decidir(actual, plan) {
  if (!actual) return { accion: 'falta', motivo: 'el servicio no existe (¿se corrió la migración?)' };
  const prev = actual.executionPlan;
  if (!prev) return { accion: 'cargar' };
  if (canonicalJson(prev) === canonicalJson(plan)) return { accion: 'igual' };
  if (!(Number.isInteger(prev.version) && plan.version > prev.version)) return { accion: 'rechazar', motivo: `ya tiene la versión ${prev.version}: subí version para cambiarla` };
  return { accion: 'cargar' };
}

// a: { respaldo, tablero, escribir }. Devuelve el código de salida.
async function aplicar(a, store, log = console.log) {
  const cfg = JSON.parse(fs.readFileSync(path.join(a.respaldo, 'tableros-config.json'), 'utf8'))[a.tablero] || {};
  const tablero = {
    statusIds: cfg.kanban_columns && Array.isArray(cfg.kanban_columns.columns) ? [...cfg.kanban_columns.columns.map(c => c.id), 'archived'] : null,
    typeIds: cfg.project_types && Array.isArray(cfg.project_types.types) ? cfg.project_types.types.map(t => t.id) : null,
  };
  let malas = 0;
  Object.entries(PLANTILLAS).forEach(([id, p]) => { const r = revisar(p, tablero); if (r.length) { malas += 1; r.forEach(x => log(`  ✖ ${id} ${x}`)); } });
  if (malas) return 3;
  log(`${Object.keys(PLANTILLAS).length} plantillas válidas para el tablero ${a.tablero}.`);
  let problemas = 0;
  for (const [id, plan] of Object.entries(PLANTILLAS)) {
    const d = decidir(await store.get('loopa_services', id), plan);
    log(`  ${id}: ${d.accion}${d.motivo ? ` (${d.motivo})` : ''}`);
    if (d.accion === 'falta' || d.accion === 'rechazar') { problemas += 1; continue; }
    if (d.accion !== 'cargar' || !a.escribir) continue;
    const hecho = await store.transaction(async tx => {
      const actual = await tx.get('loopa_services', id);
      if (decidir(actual, plan).accion !== 'cargar') return false;
      tx.update('loopa_services', id, { executionPlan: plan });
      return true;
    });
    log(hecho ? '    ✔ cargada' : '    · ya no hacía falta (cambió mientras tanto)');
  }
  if (!a.escribir) log('(Sin --escribir: no se escribió nada.)');
  return problemas ? 3 : 0;
}

module.exports = { revisar, decidir, aplicar };

if (require.main === module) {
  (async () => {
    const a = { escribir: false };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i += 1) {
      const k = argv[i];
      if (k === '--escribir') a.escribir = true;
      else if (k === '--respaldo') a.respaldo = path.resolve(argv[++i]);
      else if (k === '--tablero') a.tablero = argv[++i];
      else throw new Error(`Argumento desconocido: ${k}`);
    }
    if (!a.respaldo || !a.tablero) throw new Error('Faltan --respaldo o --tablero');
    const { AlmacenRest } = require('./almacen-rest.cjs');
    const { transporte, PROYECTO_REAL } = require('./migrar.cjs');
    const base = `https://firestore.googleapis.com/v1/projects/${PROYECTO_REAL}/databases/(default)`;
    const store = new AlmacenRest({ base, pedir: transporte(require('./sesion-cli.cjs').tokenDelCli(PROYECTO_REAL)) });
    process.exit(await aplicar(a, store));
  })().catch(e => { console.error(`✖ ${e.message}`); process.exit(1); });
}
