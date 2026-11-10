#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────
// Arma integracion/preview/index.html: una copia LOCAL de LOOPA para ver
// módulos en desarrollo sin tocar la nube ni la app publicada.
//
//   · sin configuración de Firebase → LOOPA arranca en modo local
//     (sólo este navegador; nunca lee ni escribe en la nube);
//   · sin service worker (no deja cachés de desarrollo);
//   · los datos de ejemplo de Producción se leen desde esta carpeta.
//
//   node _fuente/build.js && node integracion/preview/armar-preview.cjs
//   luego: http://localhost:8765/integracion/preview/index.html?produccion=demo
//
// El archivo generado está en .gitignore: no se publica.
// ─────────────────────────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const before = html;
html = html.replace(/window\.LOOPA_FIREBASE = \{[\s\S]*?\};/, 'window.LOOPA_FIREBASE = { apiKey: "" }; // vista previa local: sin nube');
if (html === before) throw new Error('No se encontró la configuración de Firebase en index.html');
// Se apaga la condición completa del registro: el script queda válido.
const swBefore = html;
html = html.replace("if ('serviceWorker' in navigator && location.protocol.startsWith('http'))", 'if (false) /* vista previa: sin service worker */');
if (html === swBefore) throw new Error('No se encontró el registro del service worker');
html = html.replace('</head>', '<script>window.LOOPA_DEMO_URL = "produccion-demo.json";</script>\n</head>');
html = html.replace('<title>LOOPA OS</title>', '<title>LOOPA OS · vista previa local</title>');
if (/apiKey:\s*"[^"]+"/.test(html)) throw new Error('La vista previa no debe llevar claves de Firebase');

const outIdx = process.argv.indexOf('--out');
fs.writeFileSync(outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : path.join(__dirname, 'index.html'), html);
console.log('OK integracion/preview/index.html (modo local, sin Firebase ni service worker)');
