const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '_fuente', 'app.jsx'), 'utf8');

test('el catálogo diferencia los cuatro modelos comerciales', () => {
  for (const id of ['plan', 'unitario', 'proyecto', 'especial']) {
    assert.match(source, new RegExp(`id: '${id}'`));
  }
  assert.match(source, /modeloServicio = \(s = \{\}\)/);
});

test('los acuerdos especiales se restringen al cliente vinculado', () => {
  assert.match(source, /servicioDisponiblePara = \(s, cliente\)/);
  assert.match(source, /s\.clienteIdEspecial === cliente\.id/);
  assert.match(source, /activos = servicios\.filter\(s => s\.activo !== false && servicioDisponiblePara\(s, cliente\)\)/);
  assert.match(source, /Solo aparecerá en Nueva venta cuando este cliente esté seleccionado/);
});

test('la venta conserva una instantánea del modelo comercial', () => {
  assert.match(source, /snapshotServicio = \(s\) =>/);
  assert.match(source, /modelo: modeloServicio\(s\)/);
  assert.match(source, /recomendado: s\.recomendado === true/);
  assert.match(source, /\.\.\.snapshotServicio\(s\)/);
});

test('el catálogo permite recomendar planes y filtrar por modelo', () => {
  assert.match(source, /Plan mensual/);
  assert.match(source, /Destacado comercial/);
  assert.match(source, /Recomendado/);
  assert.match(source, /setModelo/);
});
