'use strict';
// Lo ejecuta `firebase emulators:exec` (ver correr.cjs). El Firebase CLI
// standalone trae su propio "node" embebido, que no entiende --test; este
// puente lanza el Node real (LOOPA_NODE) sin shell, con los archivos ya
// resueltos (sin depender de globs).
//
// --test-timeout: si el emulador muere a mitad de la suite, una llamada del
// SDK puede quedarse esperando para siempre; así la prueba falla y no cuelga.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const real = process.env.LOOPA_NODE;
if (!real) { console.error('Falta LOOPA_NODE: usar node integracion/emulador/correr.cjs'); process.exit(2); }
const pedidos = (process.env.LOOPA_SUITE || '').split('|').filter(Boolean);
const archivos = pedidos.length ? pedidos : fs.readdirSync(__dirname).filter(f => f.endsWith('.test.cjs')).map(f => path.join(__dirname, f));
const r = spawnSync(real, ['--test', '--test-timeout=180000', ...archivos], { stdio: 'inherit', env: process.env });
process.exit(r.status === null ? 1 : r.status);
