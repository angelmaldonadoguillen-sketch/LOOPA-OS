const assert = require('node:assert/strict');
const fs = require('node:fs');
const views = fs.readFileSync('views.jsx', 'utf8');
const modal = fs.readFileSync('modal.jsx', 'utf8');
// Las tarjetas cerradas son resúmenes, nunca formularios permanentes.
assert.doesNotMatch(views, /<CardQuickFields\b/);
assert.match(modal, /label="Fecha de entrega"/);
assert.match(modal, /label="Estado"/);
assert.match(modal, /label="Prioridad"/);
assert.match(views, /label: 'Sin fecha'/);
console.log('compact-card-contract: 5 checks passed');
