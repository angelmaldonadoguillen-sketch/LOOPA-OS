#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// Punto B — la migración de LOOPA al modelo unificado (frame-studio-3a18f).
//
//   node integracion/puesta-en-marcha/migrar.cjs --respaldo <carpeta b-…> \
//        --archivado <copia de loopa-respaldo.json guardada APARTE> --tablero <id> \
//        [--decisiones <client-decisions.json>] [--emulador <puerto>] \
//        [--escribir --huella <huella del plan>]
//
// Sin --escribir: arma el plan y lo compara con el destino (sólo LEE): dice
// cuántos documentos se crearían, cuáles ya están y si hay conflictos.
// Con --escribir y la huella EXACTA del plan: corre la migración
// (functions/migration/runner.js): nunca sobrescribe ni borra, verifica la
// copia archivada del respaldo y se puede reanudar (mismo runId por huella).
//
// --emulador <puerto>: contra el emulador local de Firestore (proyecto
// demo-loopa-migracion), sembrando antes las fichas de FRAME del respaldo.
// Sin --emulador: el proyecto REAL, con la sesión del Firebase CLI.
// ─────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const { buildMigrationPlan } = require('../../functions/migration/plan');
const { runMigration, dryRun } = require('../../functions/migration/runner');
const { AlmacenRest } = require('./almacen-rest.cjs');

const PROYECTO_REAL = 'frame-studio-3a18f';
const PROYECTO_EMU = 'demo-loopa-migracion';

function args(argv) {
  const a = { decisiones: null, emulador: null, escribir: false, huella: null };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (!x) throw new Error(`Falta el valor de ${k}`); return x; };
    if (k === '--respaldo') a.respaldo = path.resolve(v());
    else if (k === '--archivado') a.archivado = path.resolve(v());
    else if (k === '--tablero') a.tablero = v();
    else if (k === '--decisiones') a.decisiones = path.resolve(v());
    else if (k === '--emulador') a.emulador = Number(v());
    else if (k === '--huella') a.huella = v();
    else if (k === '--escribir') a.escribir = true;
    else throw new Error(`Argumento desconocido: ${k}`);
  }
  if (!a.respaldo || !a.archivado || !a.tablero) throw new Error('Faltan --respaldo, --archivado o --tablero');
  if (a.emulador !== null && !(Number.isInteger(a.emulador) && a.emulador > 0 && a.emulador < 65536)) throw new Error('--emulador: un puerto');
  if (a.escribir && !a.huella) throw new Error('--escribir exige --huella (la del plan, que muestra la corrida sin --escribir)');
  return a;
}

function plan(a) {
  const leer = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
  const backup = leer(path.join(a.respaldo, 'loopa-respaldo.json'));
  const frame = leer(path.join(a.respaldo, 'frame-clients.json'));
  const decisions = a.decisiones ? (leer(a.decisiones).decisions || {}) : {};
  return { plan: buildMigrationPlan({ backup, frameClients: frame.clients || [], decisions, workspaceId: a.tablero }), frame: frame.clients || [] };
}

// La copia archivada: guardada APARTE (no dentro de la carpeta del respaldo)
// y con el mismo contenido que el respaldo de B0 (su sha256.txt).
function leerArchivado(a) {
  const crypto = require('node:crypto');
  const real = fs.realpathSync(a.archivado);
  const carpeta = fs.realpathSync(a.respaldo);
  if (real === carpeta || real.startsWith(carpeta + path.sep)) {
    throw new Error('--archivado tiene que ser la copia guardada APARTE (Drive u otro disco), no el archivo de la carpeta del respaldo');
  }
  const buf = fs.readFileSync(real);
  const linea = fs.existsSync(path.join(a.respaldo, 'sha256.txt')) ? fs.readFileSync(path.join(a.respaldo, 'sha256.txt'), 'utf8') : '';
  const esperado = (linea.match(/^[0-9a-f]{64}/) || [])[0];
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (esperado && sha !== esperado) throw new Error(`La copia archivada no es idéntica al respaldo (sha256 ${sha.slice(0, 12)}… ≠ ${esperado.slice(0, 12)}…)`);
  return buf.toString('utf8').replace(/^﻿/, '');
}

// El transporte: fetch con el token (real) o con «owner» (emulador). Sin
// respuesta en 30 s, o sin red, es un error «unavailable» (reintentable).
function transporte(token) {
  return async (metodo, url, cuerpo) => {
    let r;
    try {
      r = await fetch(url, {
        method: metodo, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
        ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      });
    } catch (e) {
      return { status: 503, cuerpo: { error: { status: 'UNAVAILABLE', message: 'sin respuesta de la red' } } };
    }
    return { status: r.status, cuerpo: await r.json().catch(() => ({})) };
  };
}

async function ejecutar(a, { pedir, base, log = console.log } = {}) {
  const { plan: p, frame } = plan(a);
  log(`Plan: ${p.status === 'ready' ? 'LISTO' : 'BLOQUEADO'} · huella ${p.fingerprint || '—'} · ${p.ops.length} escrituras`);
  if (p.status !== 'ready') {
    p.issues.filter(i => i.severity === 'error').forEach(i => log(`  ✖ ${i.code} ${i.path}: ${i.message}`));
    return { codigo: 3, plan: p };
  }
  const store = new AlmacenRest({ base, pedir });
  if (a.emulador !== null) {
    // El emulador arranca vacío: las fichas de FRAME del respaldo, tal cual.
    for (const c of frame) {
      const { id, ...datos } = c;
      if (!(await store.get('frame_clients', id))) await store.transaction(async tx => { tx.create('frame_clients', id, { id, ...datos }); });
    }
  }
  const previo = await dryRun(store, p);
  log(`Destino ahora: ${JSON.stringify(previo.counts)}${previo.conflicts.length ? ` · CONFLICTOS ${previo.conflicts.length}` : ''}`);
  previo.conflicts.slice(0, 20).forEach(c => log(`  ✖ ${c.outcome} ${c.collection}/${c.id}`));
  if (!a.escribir) {
    log('(Sin --escribir: no se escribió nada.)');
    return { codigo: previo.conflicts.length ? 3 : 0, plan: p, previo };
  }
  if (a.huella !== p.fingerprint) {
    log(`✖ La huella no coincide (plan ${p.fingerprint}, pedida ${a.huella}): el respaldo, las decisiones o el tablero cambiaron. No se escribe.`);
    return { codigo: 3, plan: p, previo };
  }
  // Con conflictos no se escribe: el ejecutor los saltearía y la corrida
  // quedaría «terminada» sin poder reintentarlos. Se resuelven antes.
  if (previo.conflicts.length) {
    log('✖ Hay conflictos en el destino: no se escribe nada. Revisalos (o ajustá las decisiones) y volvé a correr.');
    return { codigo: 3, plan: p, previo };
  }
  const archivado = leerArchivado(a);
  const r = await runMigration(store, p, { runId: `migracion-${p.fingerprint.slice(0, 16)}`, archivedBackupText: archivado, checkpointEvery: 5 });
  log(`Corrida: ${r.status}${r.reason ? ` (${r.reason})` : ''} ${r.counts ? JSON.stringify(r.counts) : ''}${r.conflicts && r.conflicts.length ? ` · conflictos ${r.conflicts.length}` : ''}`);
  const despues = await dryRun(store, p);
  log(`Destino después: ${JSON.stringify(despues.counts)}`);
  const todo = despues.counts.same === p.ops.length;
  log(todo ? '✔ Todo migrado: cada documento del plan está en el destino.'
    : r.status === 'failed' ? '⚠ Se cortó: volver a correr el mismo comando la retoma donde quedó.'
      : '⚠ No quedó todo y la corrida no se puede retomar sola (conflictos): revisar el destino antes de seguir.');
  return { codigo: r.status === 'done' && todo ? 0 : 1, plan: p, corrida: r, despues };
}

module.exports = { ejecutar, args, plan, transporte, leerArchivado, PROYECTO_REAL, PROYECTO_EMU };

if (require.main === module) {
  (async () => {
    const a = args(process.argv.slice(2));
    let base;
    let token;
    if (a.emulador !== null) {
      base = `http://127.0.0.1:${a.emulador}/v1/projects/${PROYECTO_EMU}/databases/(default)`;
      token = 'owner';
      console.log(`Destino: EMULADOR local (${PROYECTO_EMU})`);
    } else {
      base = `https://firestore.googleapis.com/v1/projects/${PROYECTO_REAL}/databases/(default)`;
      token = require('./sesion-cli.cjs').tokenDelCli(PROYECTO_REAL);
      console.log(`Destino: PROYECTO REAL ${PROYECTO_REAL}${a.escribir ? ' · ESCRIBE' : ' · sólo lectura'}`);
    }
    const r = await ejecutar(a, { pedir: transporte(token), base });
    process.exit(r.codigo);
  })().catch(e => { console.error(`✖ ${e.message}`); process.exit(1); });
}
