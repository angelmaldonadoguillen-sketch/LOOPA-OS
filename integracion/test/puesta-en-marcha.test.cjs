'use strict';
// Punto A: las utilidades puras de integracion/puesta-en-marcha (sin red).
//   node --test integracion/test/puesta-en-marcha.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../puesta-en-marcha/punto-a.cjs');

const RAIZ = path.join(__dirname, '..', '..');
const BORRADOR = fs.readFileSync(path.join(RAIZ, 'integracion', 'reglas', 'firestore.rules.borrador'), 'utf8');
const P = A.PROYECTO;

test('permitido: sólo GET a *.googleapis.com de este proyecto', () => {
  Object.values(A.urls).forEach(f => {
    const u = f.length ? null : f();
    if (u) assert.equal(A.permitido('GET', u), true, u);
  });
  assert.equal(A.permitido('GET', A.urls.ruleset(`projects/${P}/rulesets/abc-123`)), true);
  assert.equal(A.permitido('GET', A.urls.iam(`projects/${P}/locations/us-central1/services/loopacreatesale`)), true);
  assert.equal(A.permitido('GET', A.urls.politica('iam.allowedPolicyMemberDomains')), true);
  assert.equal(A.permitido('GET', A.urls.funciones('tok/en=1')), true, 'con página');
  assert.equal(A.permitido('GET', A.urls.releases('abc')), true, 'con página');
  const bien = A.urls.base();
  ['POST', 'PUT', 'PATCH', 'DELETE', 'get', ''].forEach(m => assert.equal(A.permitido(m, bien), false, m));
  [
    `http://firestore.googleapis.com/v1/projects/${P}/databases/(default)`,
    `https://firestore.googleapis.com.evil.test/v1/projects/${P}`,
    `https://evil.test/v1/projects/${P}`,
    `https://firestore.googleapis.com/v1/projects/otro-proyecto/databases/(default)`,
    `https://firestore.googleapis.com/v1/projects/${P}x/databases`,
    `https://user:pw@firestore.googleapis.com/v1/projects/${P}`,
    `https://firestore.googleapis.com:8443/v1/projects/${P}`,
    `https://firestore.googleapis.com/v1/projects/otro/databases/(default)/documents/projects/${P}`,
    `https://firestore.googleapis.com/v1/projects%2F${P}/x`,
    `https://storage.googleapis.com/v1/projects/${P}/x`,
    `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)?alt=media`,
    `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)#x`,
    `https://firestore.googleapis.com/projects/${P}`,
    'no es una url',
  ].forEach(u => assert.equal(A.permitido('GET', u), false, u));
});

test('urls: ruleset e iam sólo con nombres de este proyecto', () => {
  assert.throws(() => A.urls.ruleset('projects/otro/rulesets/x'));
  assert.throws(() => A.urls.ruleset(`projects/${P}/rulesets/../../x`));
  assert.throws(() => A.urls.iam('projects/otro/locations/us-central1/services/x'));
  assert.throws(() => A.urls.iam(`projects/${P}/locations/us-central1/services/X?y`));
});

test('las funciones de LOOPA son las que exporta functions/index.js', () => {
  const idx = fs.readFileSync(path.join(RAIZ, 'functions', 'index.js'), 'utf8');
  const exp = [...idx.matchAll(/^exports\.(\w+)\s*=/gm)].map(m => m[1]).sort();
  assert.deepEqual([...A.FUNCIONES_LOOPA].sort(), exp);
  const callables = [...idx.matchAll(/^exports\.(\w+)\s*=\s*callable\(/gm)].map(m => m[1]).sort();
  assert.deepEqual([...A.CALLABLES_LOOPA].sort(), callables);
  assert.match(idx, /const REGION = 'us-central1';/, 'evaluarProyecto supone us-central1');
});

test('sello: fecha y hora de Tegucigalpa (UTC-6)', () => {
  assert.deepEqual(A.sello(new Date('2026-11-10T05:30:00Z')), { dia: '2026-11-09', hora: '233000' });
  assert.deepEqual(A.sello(new Date('2026-11-10T06:05:07Z')), { dia: '2026-11-10', hora: '000507' });
});

test('reglasParaFrame: el encabezado de FRAME vuelve; las reglas no cambian', () => {
  const r = A.reglasParaFrame(BORRADOR);
  assert.doesNotMatch(r, /NO PUBLICAR|BORRADOR/);
  assert.match(r, /Se publican con: firebase deploy --only firestore:rules/);
  assert.match(r, /reglas-para-frame\.cjs/);
  assert.match(r, /\/\/ Lo que agrega la fusión:/);
  // Fuera de los comentarios, idéntico al borrador.
  const codigo = (t) => A.normalizar(t).split('\n').filter(l => !/^\s*\/\//.test(l) && l.trim()).join('\n');
  assert.equal(codigo(r), codigo(BORRADOR));
  assert.equal(r.split('\n')[0], "rules_version = '2';");
  assert.equal(A.reglasParaFrame(BORRADOR.replace(/\r?\n/g, '\r\n')), r, 'igual con CRLF');
  assert.throws(() => A.reglasParaFrame("rules_version = '2';\nservice cloud.firestore {}"));
});

// La base del borrador son las reglas PUBLICADAS (respaldo de A0, 2026-11-10:
// incluían un cambio de FRAME del 2026-10-15 que no estaba en su repo).
test('reglasParaFrame: las reglas publicadas siguen todas, salvo lo que cambia LOOPA', () => {
  const base = fs.readFileSync(path.join(RAIZ, 'integracion', 'reglas', 'base-frame-publicada.rules'), 'utf8');
  const lineas = (t) => A.normalizar(t).split('\n').map(l => l.trim());
  const nuevas = lineas(A.reglasParaFrame(BORRADOR));
  const nuevo = new Set(nuevas);
  // Como multiconjunto: una línea repetida en varios bloques cuenta cada vez.
  const cuenta = {};
  nuevas.forEach(l => { cuenta[l] = (cuenta[l] || 0) + 1; });
  const faltan = lineas(base).filter(l => !(cuenta[l]-- > 0));
  // Sólo las 4 que LOOPA reemplaza a propósito (borrar tareas de venta, fichas
  // con ventas) y las 3 de hasProjectAccess que impedían listar las tareas
  // compartidas (2026-11-10: ver reglas.test.cjs, «tareas compartidas»).
  assert.deepEqual(faltan, [
    '(data.keys().hasAll([\'viewerIds\'])',
    '&& data.viewerIds is list',
    '&& myUid() in data.viewerIds)',
    'allow delete: if memberOfExisting();',
    'allow read, delete: if memberOfExisting();',
    'allow create:       if memberOfIncoming();',
    'allow update:       if memberOfExisting() && memberOfIncoming();',
  ]);
  // Y lo publicado el 2026-10-15 está.
  ['function memberOfAnyBoard(data) {', 'function visibilityUnchanged() {', '&& memberOfAnyBoard(resource.data)'].forEach(l => assert.ok(nuevo.has(l), l));
});

test('reglasParaFrame: el archivo de reglas que se publica es el generado (servidor-produccion)', () => {
  const frame = fs.readFileSync(path.join(RAIZ, 'servidor-produccion', 'firestore.rules.v2'), 'utf8');
  assert.ok(A.mismasReglas(frame, A.reglasParaFrame(BORRADOR)), 'correr reglas-para-frame.cjs --escribir');
});

const LISTO = {
  firebaseJson: { functions: [{ source: 'functions', codebase: 'loopa', ignore: [] }] },
  hayFirebaserc: false, dependencias: true, ramaFrame: 'fusion/reglas-loopa',
  reglasFrame: 'a', reglasGeneradas: 'a\r\n', loopaLimpio: true, frameLimpio: true,
};
const estados = (items) => Object.fromEntries(items.map(i => [i.id, i.estado]));

test('evaluarLocal: todo listo', () => {
  const e = estados(A.evaluarLocal(LISTO));
  assert.ok(Object.values(e).every(x => x === 'ok'), JSON.stringify(e));
});

test('evaluarLocal: lo que bloquea y lo que avisa', () => {
  const v = (cambio) => estados(A.evaluarLocal({ ...LISTO, ...cambio }));
  assert.equal(v({ firebaseJson: { ...LISTO.firebaseJson, firestore: { rules: 'x' } } })['config-loopa'], 'falta', 'LOOPA no publica reglas');
  assert.equal(v({ firebaseJson: { functions: { source: 'functions' } } })['config-loopa'], 'falta', 'sin codebase');
  assert.equal(v({ firebaseJson: { functions: [{ source: 'functions', codebase: 'default' }] } })['config-loopa'], 'falta');
  assert.equal(v({ firebaseJson: null })['config-loopa'], 'falta');
  assert.equal(v({ hayFirebaserc: true })['proyecto-fijo'], 'falta');
  assert.equal(v({ dependencias: false }).dependencias, 'falta');
  assert.equal(v({ reglasFrame: 'b' })['reglas-frame'], 'falta');
  assert.equal(v({ reglasFrame: null })['reglas-frame'], 'aviso');
  assert.equal(v({ ramaFrame: 'otra' })['rama-frame'], 'aviso');
  assert.equal(v({ loopaLimpio: false })['loopa-limpio'], 'falta', 'se publica desde el árbol: sin commit no');
  assert.equal(v({ frameLimpio: false })['frame-limpio'], 'falta');
});

const FN = (nombre, codebase, extra = {}) => ({ nombre, region: 'us-central1', codebase, estado: 'ACTIVE', servicio: `projects/${P}/locations/us-central1/services/${nombre.toLowerCase()}`, disparador: 'https', ...extra });
const ABIERTA = { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] };
const PROY = {
  base: { locationId: 'nam5' },
  funciones: [FN('carryOverIncompleteTasks', 'default'), FN('reservePortfolioAsset', 'default')],
  iamFrame: ABIERTA, iamLoopa: {}, proyecto: { parent: null }, politicaDominios: null,
  reglasActivas: 'v2\n', reglasNuevas: 'fusion',
  versionesFrame: [{ commit: 'c3fusion', texto: 'fusion' }, { commit: 'b2nueva', texto: 'v2' }, { commit: 'a1vieja', texto: 'v1' }],
};

test('evaluarProyecto: todo en orden', () => {
  const e = estados(A.evaluarProyecto(PROY));
  assert.deepEqual(e, { ubicacion: 'ok', funciones: 'ok', invocacion: 'ok', organizacion: 'ok', 'reglas-activas': 'ok' });
});

test('evaluarProyecto: ubicación', () => {
  assert.equal(estados(A.evaluarProyecto({ ...PROY, base: { locationId: 'us-central1' } })).ubicacion, 'ok');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, base: { locationId: 'southamerica-east1' } })).ubicacion, 'falta');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, base: { error: '403' } })).ubicacion, 'falta');
});

test('evaluarProyecto: funciones', () => {
  assert.equal(estados(A.evaluarProyecto({ ...PROY, funciones: { error: '403' } })).funciones, 'falta');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, funciones: [...PROY.funciones, FN('loopaCreateSale', 'default')] })).funciones, 'falta', 'nombre de LOOPA en otro codebase');
  const ya = estados(A.evaluarProyecto({ ...PROY, funciones: [...PROY.funciones, FN('loopaCreateSale', 'loopa')], iamLoopa: { loopaCreateSale: { bindings: [] } } }));
  assert.equal(ya.funciones, 'ok');
  assert.equal(ya['funciones-loopa'], 'aviso');
  assert.equal(ya['invocacion-loopaCreateSale'], 'aviso');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, iamLoopa: { loopaCreateSale: ABIERTA } }))['invocacion-loopaCreateSale'], 'ok');
});

test('evaluarProyecto: invocación y organización', () => {
  assert.equal(estados(A.evaluarProyecto({ ...PROY, iamFrame: { bindings: [{ role: 'roles/run.invoker', members: ['serviceAccount:x'] }] } })).invocacion, 'aviso');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, iamFrame: { bindings: [{ role: 'roles/viewer', members: ['allUsers'] }] } })).invocacion, 'aviso');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, iamFrame: null })).invocacion, 'aviso');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, iamFrame: { error: '403' } })).invocacion, 'aviso');
  const org = { ...PROY, proyecto: { parent: 'organizations/123' }, politicaDominios: { spec: { rules: [{ values: { allowedValues: ['C0abc'] } }] } } };
  assert.equal(estados(A.evaluarProyecto(org)).invocacion, 'falta');
  assert.equal(estados(A.evaluarProyecto({ ...org, politicaDominios: { spec: { rules: [{ allowAll: true }] } } })).invocacion, 'ok');
});

test('evaluarProyecto: reglas activas', () => {
  assert.equal(estados(A.evaluarProyecto({ ...PROY, reglasActivas: null }))['reglas-activas'], 'falta', 'sin respaldo no se publica');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, reglasActivas: 'otra cosa' }))['reglas-activas'], 'falta');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, versionesFrame: [] }))['reglas-activas'], 'falta');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, reglasActivas: 'fusion' }))['reglas-activas'], 'aviso');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, reglasActivas: 'v1' }))['reglas-activas'], 'aviso', 'versión vieja de FRAME');
  // Revisión: después de A1, main ya tiene la fusión; el chequeo sigue valiendo
  // porque compara con la última versión ANTERIOR a la fusión, no con main.
  const despuesDeA1 = { ...PROY, versionesFrame: [{ commit: 'd4merge', texto: 'fusion' }, ...PROY.versionesFrame] };
  assert.equal(estados(A.evaluarProyecto(despuesDeA1))['reglas-activas'], 'ok');
  // Antes del commit de la fusión en FRAME: igual.
  assert.equal(estados(A.evaluarProyecto({ ...PROY, versionesFrame: PROY.versionesFrame.slice(1) }))['reglas-activas'], 'ok');
});

test('evaluarProyecto: con el respaldo de A0 como base (A3/A4)', () => {
  // A0 encontró reglas publicadas que no estaban en el repo; las nuevas se
  // armaron sobre ese respaldo, así que la referencia es el respaldo.
  const conBase = { ...PROY, reglasActivas: 'vivo', reglasBase: 'vivo\r\n' };
  assert.equal(estados(A.evaluarProyecto(conBase))['reglas-activas'], 'ok');
  assert.equal(estados(A.evaluarProyecto({ ...conBase, reglasActivas: 'otra' }))['reglas-activas'], 'falta', 'alguien publicó después de A0');
  assert.equal(estados(A.evaluarProyecto({ ...conBase, reglasActivas: 'fusion' }))['reglas-activas'], 'aviso', 'ya publicadas');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, reglasActivas: 'vivo' }))['reglas-activas'], 'falta', 'sin base: no está en el repo');
});

test('evaluarProyecto: una lectura fallida nunca cuenta como «todo bien»', () => {
  const org = { ...PROY, proyecto: { parent: 'organizations/1' }, politicaDominios: { error: '403' } };
  assert.equal(estados(A.evaluarProyecto(org)).politica, 'aviso');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, proyecto: { error: '403' } })).organizacion, 'aviso');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, proyecto: null })).organizacion, 'aviso');
  assert.equal(estados(A.evaluarProyecto({ ...PROY, inalcanzables: ['europe-west1'] })).funciones, 'falta', 'lista incompleta');
});

test('informe: un renglón por punto y el balance', () => {
  const t = A.informe('X', [{ id: 'a', estado: 'ok', texto: 'bien' }, { id: 'b', estado: 'falta', texto: 'mal' }]);
  assert.match(t, /^## X/);
  assert.match(t, /✔ bien/);
  assert.match(t, /✖ mal/);
  assert.match(t, /1 bloquea/);
  assert.match(A.informe('Y', [{ id: 'a', estado: 'aviso', texto: 'ojo' }]), /Sin bloqueos; 1 aviso/);
});

test('chequeo-a.cjs: la red sólo pasa por permitido() y el token no se imprime', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'integracion', 'puesta-en-marcha', 'chequeo-a.cjs'), 'utf8');
  assert.equal((src.match(/fetch\(/g) || []).length, 1, 'un solo fetch');
  assert.match(src, /if \(!A\.permitido\('GET', url\)\) throw/);
  assert.match(src, /method: 'GET'/);
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*(tk|access_token|token\(\))/);
  assert.doesNotMatch(src, /writeFileSync\([^)]*(tk|access_token)/);
});

test('el respaldo queda fuera de git', () => {
  assert.match(fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8'), /^integracion\/puesta-en-marcha\/respaldo\/$/m);
});
