#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// Pruebas de Producción (las de contrato que traía FRAME, Fase 4).
//
//   node integracion/test-produccion/correr.cjs
//
// Cada prueba lee los archivos por su nombre ('app.jsx', 'firestore.rules.v2'…),
// como en FRAME. Se arma una carpeta temporal con esos nombres:
//   · el código de Producción (_fuente/estudio/)
//   · firestore.rules.v2: las reglas publicables (del borrador de LOOPA)
//   · storage.rules y functions/index.js: servidor-produccion/
//   · index.html: el que arma LOOPA
// y se corre cada prueba ahí. Sin red.
// ─────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { reglasParaFrame } = require('../puesta-en-marcha/punto-a.cjs');

const RAIZ = path.join(__dirname, '..', '..');
const vista = fs.mkdtempSync(path.join(os.tmpdir(), 'loopa-produccion-'));
const copiar = (de, a) => { fs.mkdirSync(path.dirname(a), { recursive: true }); fs.copyFileSync(de, a); };

const estudio = path.join(RAIZ, '_fuente', 'estudio');
fs.readdirSync(estudio).forEach(f => copiar(path.join(estudio, f), path.join(vista, f)));
const pruebas = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
pruebas.forEach(f => copiar(path.join(__dirname, f), path.join(vista, f)));
fs.writeFileSync(path.join(vista, 'firestore.rules.v2'), reglasParaFrame(fs.readFileSync(path.join(RAIZ, 'integracion', 'reglas', 'firestore.rules.borrador'), 'utf8')));
copiar(path.join(RAIZ, 'servidor-produccion', 'storage.rules'), path.join(vista, 'storage.rules'));
copiar(path.join(RAIZ, 'servidor-produccion', 'firebase.json'), path.join(vista, 'firebase.json'));
copiar(path.join(RAIZ, 'servidor-produccion', 'functions', 'index.js'), path.join(vista, 'functions', 'index.js'));
copiar(path.join(RAIZ, 'index.html'), path.join(vista, 'index.html'));

let fallas = 0;
for (const f of pruebas) {
  const r = spawnSync(process.execPath, [f], { cwd: vista, encoding: 'utf8' });
  if (r.status === 0) console.log(`✔ ${f}`);
  else {
    fallas += 1;
    console.log(`✖ ${f}`);
    console.log((r.stderr || r.stdout).split('\n').filter(Boolean).slice(0, 6).map(l => `    ${l}`).join('\n'));
  }
}
fs.rmSync(vista, { recursive: true, force: true });
console.log(`\n${pruebas.length - fallas}/${pruebas.length} pruebas de Producción`);
process.exit(fallas ? 1 : 0);
