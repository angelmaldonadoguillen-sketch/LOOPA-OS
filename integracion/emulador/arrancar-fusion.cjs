#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────
// LOOPA con Firebase EMULADO, para usarlo en el navegador de este equipo
// (tanda 3.4). Nada sale de la PC: proyecto demo-loopa, que no existe en la
// nube; los emuladores arrancan vacíos y se descartan al cerrar.
//
//   node _fuente/build.js && node integracion/preview/armar-preview.cjs
//   node integracion/emulador/arrancar-fusion.cjs
//   → http://127.0.0.1:8791/?datos=fusion&servidor=emulador&produccion=demo
//
// Levanta Auth + Firestore (con las reglas EN BORRADOR) + Functions (el
// codebase «loopa» de functions/), siembra los datos de ejemplo y las cuentas
// de prueba (ver siembra.cjs) y sirve la vista previa en 127.0.0.1:8791.
// Ctrl+C apaga todo.
// ─────────────────────────────────────────────────────────────────
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { entornoEmulador } = require('./entorno.cjs');

const RAIZ = path.join(__dirname, '..', '..');
const PREVIEW = path.join(RAIZ, 'integracion', 'preview');
const PUERTO = 8791;
const falta = [
  [path.join(__dirname, 'node_modules', 'firebase-admin'), 'cd integracion/emulador && npm install --ignore-scripts'],
  [path.join(RAIZ, 'functions', 'node_modules', 'firebase-functions'), 'cd functions && npm ci --ignore-scripts'],
  [path.join(PREVIEW, 'index.html'), 'node _fuente/build.js && node integracion/preview/armar-preview.cjs'],
].filter(([p]) => !fs.existsSync(p));
if (falta.length) { falta.forEach(([, cmd]) => console.error(`Falta: ${cmd}`)); process.exit(2); }

// Nunca credenciales reales, tampoco en este proceso (siembra con firebase-admin).
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

// Los puertos tienen que estar libres ANTES de arrancar: si no, se sembraría
// otro emulador que ya estaba corriendo, o quedarían emuladores huérfanos.
const PUERTOS = [8085, 5001, 9099, 4400, PUERTO];
const libre = (p) => new Promise(res => { const t = require('node:net').createServer(); t.once('error', () => res(false)); t.listen(p, '127.0.0.1', () => t.close(() => res(true))); });

let emu = null;
async function arrancarEmuladores() {
  const ocupados = [];
  for (const p of PUERTOS) if (!(await libre(p))) ocupados.push(p);
  if (ocupados.length) throw new Error(`Puertos ocupados: ${ocupados.join(', ')} (¿ya hay otra copia corriendo?)`);
  const { env, JTMP } = entornoEmulador();
  emu = spawn('firebase', [
  'emulators:start', '--only', 'firestore,functions,auth', '--project', 'demo-loopa',
  '--config', `"${path.join(RAIZ, 'firebase.emulador.json')}"`,
], { cwd: JTMP, env, stdio: 'inherit', shell: true, detached: process.platform !== 'win32' });
  emu.on('exit', (c) => { if (!cerrando) { console.error(`Los emuladores se cerraron (${c})`); process.exit(1); } });
}

let cerrando = false;
function cerrar(code = 0) {
  if (cerrando) return;
  cerrando = true;
  // En Windows, con shell: true hay que bajar todo el árbol (cmd → firebase → java).
  if (emu && emu.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(emu.pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-emu.pid, 'SIGINT'); } catch (e) { emu.kill('SIGINT'); } } // todo el grupo (sh → firebase → java)
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => cerrar(0));
process.on('SIGTERM', () => cerrar(0));
process.on('SIGHUP', () => cerrar(0));
process.on('uncaughtException', (e) => { console.error(e.message); cerrar(1); });

// Listo = la función responde (sin sesión: «unauthenticated»).
async function esperarFunciones(ms = 180000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try {
      const r = await fetch('http://127.0.0.1:5001/demo-loopa/us-central1/loopaSaveClient', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"data":{}}' });
      if (r.status !== 404) return;
    } catch (e) { /* todavía no */ }
    await new Promise(res => setTimeout(res, 1000));
  }
  throw new Error('Las funciones no arrancaron a tiempo');
}

function servirVistaPrevia() {
  const archivos = { '/': 'index.html', '/index.html': 'index.html', '/produccion-demo.json': 'produccion-demo.json' };
  return http.createServer((req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    const url = new URL(req.url, 'http://127.0.0.1');
    const f = archivos[url.pathname];
    if (!['127.0.0.1', 'localhost'].includes(host) || req.method !== 'GET' || !f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(path.join(PREVIEW, f)));
  }).on('error', (e) => { console.error(e.message); cerrar(1); }).listen(PUERTO, '127.0.0.1');
}

(async () => {
  await arrancarEmuladores();
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  await esperarFunciones();
  const { sembrarEmulador, COMERCIAL } = require('./siembra.cjs');
  await sembrarEmulador();
  servirVistaPrevia();
  console.log(`\nLOOPA con Firebase emulado: http://127.0.0.1:${PUERTO}/?datos=fusion&servidor=emulador&produccion=demo`);
  console.log(`Cuenta de prueba del equipo comercial: ${COMERCIAL.email} (clave en integracion/emulador/siembra.cjs)`);
  console.log('Ctrl+C para apagar (los datos del emulador se descartan).\n');
})().catch(err => { console.error(err.message); cerrar(1); });
