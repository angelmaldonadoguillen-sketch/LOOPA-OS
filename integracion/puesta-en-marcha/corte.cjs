#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// El corte en UN comando: migración (B), configuración (C) y plantillas de
// producción, en ese orden, contra frame-studio-3a18f. Se detiene en el
// primer problema.
//
//   node integracion/puesta-en-marcha/corte.cjs --respaldo <carpeta b-…> \
//        --archivado <copia guardada aparte> --tablero <id> --comerciales <email,…> \
//        [--escribir --huella <huella del plan>]
//
// Sin --escribir: hace los tres pasos en modo lectura (dice qué haría).
// ─────────────────────────────────────────────────────────────────────
const path = require('node:path');
const M = require('./migrar.cjs');
const C = require('./configurar-c.cjs');
const P = require('./plantillas.cjs');
const { AlmacenRest } = require('./almacen-rest.cjs');

(async () => {
  const argv = process.argv.slice(2);
  const comun = [];
  let comerciales = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--comerciales') { comerciales = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean); continue; }
    comun.push(argv[i]);
  }
  const a = M.args(comun);
  if (!comerciales || !comerciales.length) throw new Error('Falta --comerciales');
  const base = `https://firestore.googleapis.com/v1/projects/${M.PROYECTO_REAL}/databases/(default)`;
  const pedir = M.transporte(require('./sesion-cli.cjs').tokenDelCli(M.PROYECTO_REAL));
  console.log(`Destino: PROYECTO REAL ${M.PROYECTO_REAL}${a.escribir ? ' · ESCRIBE' : ' · sólo lectura'}\n`);

  console.log('── 1/3 · Migración ──');
  const m = await M.ejecutar(a, { pedir, base });
  // En modo lectura la migración «falta» todavía: los pasos 2 y 3 igual se muestran.
  if (m.codigo !== 0) { console.log('\n✖ Se detiene: la migración no quedó completa.'); process.exit(m.codigo); }

  const store = new AlmacenRest({ base, pedir });
  console.log('\n── 2/3 · Tablero de producción y quién vende ──');
  const c = await C.aplicar({ respaldo: a.respaldo, tablero: a.tablero, comerciales, escribir: a.escribir }, store);
  if (c !== 0) { console.log('\n✖ Se detiene en la configuración.'); process.exit(c); }

  console.log('\n── 3/3 · Plantillas de producción ──');
  const p = await P.aplicar({ respaldo: a.respaldo, tablero: a.tablero, escribir: a.escribir }, store);
  if (p !== 0 && a.escribir) { console.log('\n✖ Las plantillas no quedaron todas.'); process.exit(p); }

  console.log(a.escribir ? '\n✔ Corte de datos completo. Falta publicar LOOPA (eso lo hace Claude).' : '\n(Modo lectura: no se escribió nada. Las plantillas dicen «falta» hasta que corra la migración.)');
})().catch(e => { console.error(`✖ ${e.message}`); process.exit(1); });
