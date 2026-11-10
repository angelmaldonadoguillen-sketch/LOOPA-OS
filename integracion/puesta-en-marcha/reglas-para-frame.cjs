#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// Genera firestore.rules.v2 de FRAME desde el borrador probado en el
// emulador (integracion/reglas/firestore.rules.borrador). Sólo escribe un
// archivo LOCAL del repo de FRAME; no publica nada.
//
//   node integracion/puesta-en-marcha/reglas-para-frame.cjs <repo FRAME>            compara
//   node integracion/puesta-en-marcha/reglas-para-frame.cjs <repo FRAME> --escribir  escribe
//
// (o FRAME_REPO en el entorno en lugar del argumento)
// ─────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const { reglasParaFrame, mismasReglas } = require('./punto-a.cjs');

const args = process.argv.slice(2);
const escribir = args.includes('--escribir');
const repo = args.find(a => !a.startsWith('--')) || process.env.FRAME_REPO;
if (!repo) { console.error('Falta la ruta del repo de FRAME (argumento o FRAME_REPO).'); process.exit(2); }
const destino = path.join(path.resolve(repo), 'firestore.rules.v2');
if (!fs.existsSync(destino)) { console.error(`No existe ${destino}`); process.exit(2); }

const borrador = fs.readFileSync(path.join(__dirname, '..', 'reglas', 'firestore.rules.borrador'), 'utf8');
const actual = fs.readFileSync(destino, 'utf8');
const eol = actual.includes('\r\n') ? '\r\n' : '\n';
const nuevo = reglasParaFrame(borrador).replace(/\n/g, eol) + (/\r?\n$/.test(actual) ? eol : '');

if (mismasReglas(actual, nuevo)) { console.log('firestore.rules.v2 de FRAME ya es el borrador.'); process.exit(0); }
if (!escribir) { console.log('firestore.rules.v2 de FRAME difiere del borrador (usar --escribir).'); process.exit(1); }
fs.writeFileSync(destino, nuevo);
console.log(`Escrito ${destino}`);
