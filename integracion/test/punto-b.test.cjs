'use strict';
// Punto B0: utilidades puras del respaldo de sólo lectura (sin red).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../puesta-en-marcha/punto-b.cjs');

test('permitidoB: sólo GET a los documentos de LOOPA y a 3 colecciones de FRAME', () => {
  B.DOCS_LOOPA.forEach(k => assert.equal(B.permitidoB('GET', B.urlsB.loopa(k)), true, k));
  B.COLECCIONES_FRAME.forEach(c => {
    assert.equal(B.permitidoB('GET', B.urlsB.frame(c)), true, c);
    assert.equal(B.permitidoB('GET', B.urlsB.frame(c, 'tok/x=')), true, `${c} con página`);
  });
  const base = 'https://firestore.googleapis.com/v1/projects';
  [
    ['POST', B.urlsB.loopa('ventas')],
    ['PATCH', B.urlsB.frame('frame_clients')],
    ['GET', `${base}/tooned-os/databases/(default)/documents/loopa/otra`],
    ['GET', `${base}/tooned-os/databases/(default)/documents/tooned/ventas`],
    ['GET', `${base}/tooned-os/databases/(default)/documents/loopa/ventas?pageSize=1`],
    ['GET', `${base}/frame-studio-3a18f/databases/(default)/documents/loopa_sales`],
    ['GET', `${base}/frame-studio-3a18f/databases/(default)/documents/frame_clients/c1`],
    ['GET', `${base}/frame-studio-3a18f/databases/(default)/documents/frame_clients?mask.fieldPaths=x`],
    ['GET', `${base}/otro/databases/(default)/documents/frame_clients`],
    ['GET', `${base}/frame-studio-3a18f/databases/(default)/documents/frame%5Fclients`],
    ['GET', 'https://firestore.googleapis.com.evil.test/v1/projects/tooned-os/databases/(default)/documents/loopa/ventas'],
    ['GET', 'http://firestore.googleapis.com/v1/projects/tooned-os/databases/(default)/documents/loopa/ventas'],
  ].forEach(([m, u]) => assert.equal(B.permitidoB(m, u), false, `${m} ${u}`));
  assert.equal(B.permitidoB('GET', B.urlsB.config('ws123', 'kanban_columns')), true);
  assert.equal(B.permitidoB('GET', B.urlsB.config('ws123', 'project_types')), true);
  assert.equal(B.permitidoB('GET', `${base}/frame-studio-3a18f/databases/(default)/documents/frame_workspaces/ws1/config/otra`), false);
  assert.equal(B.permitidoB('GET', `${base}/frame-studio-3a18f/databases/(default)/documents/frame_workspaces/ws1/members/u1`), false);
  assert.throws(() => B.urlsB.config('../x', 'kanban_columns'));
  assert.throws(() => B.urlsB.loopa('../x'));
  assert.throws(() => B.urlsB.frame('loopa_sales'));
});

test('decodificar: tipos de Firestore REST a JS, sin perder datos', () => {
  const d = B.decodificar({
    name: 'projects/tooned-os/databases/(default)/documents/loopa/ventas',
    fields: {
      items: { arrayValue: { values: [{ mapValue: { fields: {
        n: { integerValue: '1042' }, total: { doubleValue: 1500.5 }, cliente: { stringValue: 'Café' },
        pagado: { booleanValue: false }, nota: { nullValue: null }, lineas: { arrayValue: {} },
      } } }] } },
      vacio: { mapValue: {} },
      creado: { timestampValue: '2026-11-10T00:00:00Z' },
    },
  });
  assert.equal(d.id, 'ventas');
  assert.deepEqual(d.datos, {
    items: [{ n: 1042, total: 1500.5, cliente: 'Café', pagado: false, nota: null, lineas: [] }],
    vacio: {}, creado: { __timestamp: '2026-11-10T00:00:00Z' },
  });
  assert.throws(() => B.valor({ integerValue: '9007199254740993' }, 'x'), /fuera de rango/);
  assert.throws(() => B.valor({ doubleValue: 'NaN' }, 'x'), /no finito/);
  assert.throws(() => B.valor({ geoPointValue: {} }, 'x'), /no soportado/);
  assert.throws(() => B.valor(null, 'x'));
});

test('armarRespaldo: la forma del export de LOOPA, que lee la migración', () => {
  const { readLoopaSource } = require('../../functions/migration/source');
  const docs = { ventas: { items: [{ id: 'v1' }] }, clientes: { items: [] }, servicios: { items: [{ id: 's1' }] }, config: { moneda: 'L' }, gastos: { variables: [{ id: 'g' }], fijos: [] } };
  const r = B.armarRespaldo(docs, '2026-11-10T00:00:00Z');
  assert.equal(r.app, 'LOOPA OS');
  const { source, issues } = readLoopaSource(r);
  assert.deepEqual(issues, []);
  assert.equal(source.ventas.length, 1);
  assert.equal(source.gastosVariables.length, 1);
  assert.deepEqual(B.resumenRespaldo(r), { ventas: 1, clientes: 0, servicios: 1, gastosVariables: 1, gastosFijos: 0 });
  assert.throws(() => B.armarRespaldo({ ...docs, ventas: null }, 'x'), /loopa\/ventas/);
});

test('respaldo-b.cjs: la red sólo pasa por permitidoB y sólo lee', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'puesta-en-marcha', 'respaldo-b.cjs'), 'utf8');
  assert.equal((src.match(/fetch\(/g) || []).length, 1);
  assert.match(src, /if \(!B\.permitidoB\('GET', url\)\) throw/);
  assert.match(src, /method: 'GET'/);
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*\btk\b/);
});

test('configurar-c (punto C): sólo personas aprobadas y miembros del tablero', () => {
  const { armar } = require('../puesta-en-marcha/configurar-c.cjs');
  const usuarios = [
    { uid: 'u1', nombre: 'Ana', email: 'ana@x.test', estado: 'active' },
    { uid: 'u2', nombre: 'Beto', email: 'beto@x.test', estado: 'active' },
    { uid: 'u3', nombre: 'Ceci', email: 'ceci@x.test', estado: 'pending' },
  ];
  const tableros = [{ id: 'ws', nombre: 'Loopa Estudio', miembros: ['u1', 'u3'] }];
  const ok = armar({ usuarios, tableros, tablero: 'ws', comerciales: ['ANA@x.test', 'u1'] });
  assert.deepEqual(ok.errores, []);
  assert.deepEqual(ok.access, { commercialUids: ['u1'] });
  assert.deepEqual(ok.production, { defaultWorkspaceId: 'ws', allowedWorkspaceIds: ['ws'] });
  assert.match(armar({ usuarios, tableros, tablero: 'ws', comerciales: ['u2'] }).errores.join(), /no es miembro/);
  assert.match(armar({ usuarios, tableros, tablero: 'ws', comerciales: ['u3'] }).errores.join(), /no está aprobada/);
  assert.match(armar({ usuarios, tableros, tablero: 'ws', comerciales: ['nadie@x.test'] }).errores.join(), /No hay una cuenta/);
  assert.match(armar({ usuarios, tableros, tablero: 'otro', comerciales: ['u1'] }).errores.join(), /No existe el tablero/);
  assert.match(armar({ usuarios, tableros, tablero: 'ws', comerciales: [] }).errores.join(), /al menos una/);
});

test('configurar-c: nunca deja claves extra y la lista comercial suma (revisión)', () => {
  const { combinar } = require('../puesta-en-marcha/configurar-c.cjs');
  assert.deepEqual(combinar('access', null, { commercialUids: ['u1'] }).datos, { commercialUids: ['u1'] });
  assert.deepEqual(combinar('access', { commercialUids: ['u9'] }, { commercialUids: ['u1'] }).datos, { commercialUids: ['u1', 'u9'] }, 'agregar a alguien no saca a nadie');
  assert.deepEqual(combinar('access', { commercialUids: ['u9'] }, { commercialUids: ['u1'] }, { reemplazar: true }).datos, { commercialUids: ['u1'] });
  assert.match(combinar('access', { commercialUids: [], extra: 1 }, { commercialUids: ['u1'] }).error, /claves que no corresponden/);
  assert.match(combinar('production', { defaultWorkspaceId: 'w', allowedWorkspaceIds: [], secreto: 1 }, { defaultWorkspaceId: 'w', allowedWorkspaceIds: ['w'] }).error, /secreto/);
  assert.deepEqual(combinar('production', { defaultWorkspaceId: 'v', allowedWorkspaceIds: ['v'] }, { defaultWorkspaceId: 'w', allowedWorkspaceIds: ['w'] }).datos, { defaultWorkspaceId: 'w', allowedWorkspaceIds: ['w'] });
});

test('migrar: la copia archivada va aparte y es idéntica al respaldo (revisión)', () => {
  const os = require('node:os');
  const crypto = require('node:crypto');
  const { leerArchivado } = require('../puesta-en-marcha/migrar.cjs');
  const resp = fs.mkdtempSync(path.join(os.tmpdir(), 'resp-'));
  const fuera = fs.mkdtempSync(path.join(os.tmpdir(), 'copia-'));
  const texto = '{"app":"LOOPA OS"}';
  fs.writeFileSync(path.join(resp, 'loopa-respaldo.json'), texto);
  fs.writeFileSync(path.join(resp, 'sha256.txt'), `${crypto.createHash('sha256').update(texto).digest('hex')}  loopa-respaldo.json\n`);
  fs.writeFileSync(path.join(fuera, 'copia.json'), texto);
  fs.writeFileSync(path.join(fuera, 'otra.json'), texto + ' ');
  assert.equal(leerArchivado({ respaldo: resp, archivado: path.join(fuera, 'copia.json') }), texto);
  assert.throws(() => leerArchivado({ respaldo: resp, archivado: path.join(resp, 'loopa-respaldo.json') }), /APARTE/);
  assert.throws(() => leerArchivado({ respaldo: resp, archivado: path.join(fuera, 'otra.json') }), /no es idéntica/);
  fs.rmSync(resp, { recursive: true, force: true });
  fs.rmSync(fuera, { recursive: true, force: true });
});
