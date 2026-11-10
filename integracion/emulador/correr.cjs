#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────
// Levanta el emulador LOCAL de Firestore, corre la suite y lo apaga.
//
//   cd integracion/emulador && npm install --ignore-scripts   (una vez)
//   node integracion/emulador/correr.cjs [archivos.test.cjs…]
//
// Requiere Java 21 y Firebase CLI. Proyecto demo-*: el emulador no habla con
// la nube y no usa credenciales. No escribe nada fuera del emulador, que
// arranca vacío y se descarta al terminar (sin --import ni --export-on-exit).
// ─────────────────────────────────────────────────────────────────
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const AQUI = __dirname;
if (!fs.existsSync(path.join(AQUI, 'node_modules', 'firebase-admin'))) {
  console.error('Falta firebase-admin: cd integracion/emulador && npm install --ignore-scripts');
  process.exit(2);
}

const { env, JTMP } = require('./entorno.cjs').entornoEmulador({ REQUIRE_EMULATOR: '1' });

// El script de emulators:exec corre con el node embebido del CLI; suite.cjs
// lanza el Node real (este) con --test.
env.LOOPA_NODE = process.execPath;
// --funciones: además los emuladores de Functions (el codebase «loopa» de
// functions/, con sus dependencias instaladas) y Auth, con las reglas en
// borrador cargadas. Corre funciones.test.cjs (o los archivos indicados).
const FUNCIONES = process.argv.includes('--funciones');
const archivos = process.argv.slice(2).filter(a => a !== '--funciones');
if (FUNCIONES && !fs.existsSync(path.join(AQUI, '..', '..', 'functions', 'node_modules', 'firebase-functions'))) {
  console.error('Faltan las dependencias de functions/: cd functions && npm ci --ignore-scripts');
  process.exit(2);
}
if (FUNCIONES) env.LOOPA_FUNCIONES = '1';
env.LOOPA_SUITE = (archivos.length ? archivos.map(f => path.resolve(f)) : FUNCIONES ? [path.join(AQUI, 'funciones.test.cjs')] : []).join('|');
const r = spawnSync('firebase', [
  'emulators:exec', '--only', FUNCIONES ? 'firestore,functions,auth' : 'firestore', '--project', 'demo-loopa',
  '--config', `"${FUNCIONES ? path.join(AQUI, '..', '..', 'firebase.emulador.json') : path.join(AQUI, 'firebase.json')}"`,
  // Con shell: true los argumentos se unen; el comando va entre comillas.
  '"node ../suite.cjs"',
], { cwd: JTMP, env, stdio: 'inherit', shell: true });
process.exit(r.status === null ? 1 : r.status);
