'use strict';
// ─────────────────────────────────────────────────────────────────────
// Punto A (publicar en frame-studio-3a18f) — utilidades PURAS: sin red,
// sin Firebase y sin DOM. Se prueban con node
// (integracion/test/puesta-en-marcha.test.cjs).
//
//   permitido        la única puerta a la red de chequeo-a.cjs: sólo GET,
//                    sólo https://*.googleapis.com y sólo este proyecto
//   urls             qué se lee del proyecto (y nada más)
//   evaluarLocal     ¿está todo listo en esta PC para publicar?
//   evaluarProyecto  lo que pide el ADR-0004 §7, a partir de lo leído
//   reglasParaFrame  el archivo de reglas de FRAME (firestore.rules.v2)
//                    generado desde el borrador probado en el emulador
//   informe          el resumen en texto, sin datos sensibles
// ─────────────────────────────────────────────────────────────────────

const PROYECTO = 'frame-studio-3a18f';
const REGION = 'us-central1';
// Lo que exporta functions/index.js (la prueba lo compara con el archivo).
const CALLABLES_LOOPA = ['loopaCreateSale', 'loopaUpdateSale', 'loopaAddPayment', 'loopaRemovePayment', 'loopaSaveClient', 'loopaSaveService'];
const FUNCIONES_LOOPA = [...CALLABLES_LOOPA, 'loopaOnEventCreated', 'loopaSweepEvents'];
// Un trigger de Firestore en us-central1 necesita la base en una de estas.
const UBICACIONES_OK = ['nam5', 'us-central1'];

// ── La puerta a la red ────────────────────────────────────────────
// Las únicas APIs que se leen.
const HOSTS = ['firestore', 'firebaserules', 'cloudfunctions', 'run', 'cloudresourcemanager', 'orgpolicy'].map(h => `${h}.googleapis.com`);
const QUERY_OK = ['pageSize', 'pageToken'];
function permitido(metodo, url) {
  if (metodo !== 'GET') return false;
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== 'https:' || !HOSTS.includes(u.hostname)) return false;
  if (u.username || u.password || u.port || u.hash) return false;
  if (![...u.searchParams.keys()].every(k => QUERY_OK.includes(k))) return false;
  // La ruta cruda (sin decodificar, sin %) y el proyecto al principio.
  if (u.pathname.includes('%')) return false;
  return new RegExp(`^/v[0-9a-z]+/projects/${PROYECTO}(/|:|$)`).test(u.pathname);
}

const urls = {
  base: () => `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)`,
  releases: (pagina) => `https://firebaserules.googleapis.com/v1/projects/${PROYECTO}/releases?pageSize=100${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`,
  // name = projects/<p>/rulesets/<id>, tal como viene en la release.
  ruleset: (name) => {
    if (!new RegExp(`^projects/${PROYECTO}/rulesets/[A-Za-z0-9-]+$`).test(String(name))) throw new Error(`ruleset inesperado: ${name}`);
    return `https://firebaserules.googleapis.com/v1/${name}`;
  },
  funciones: (pagina) => `https://cloudfunctions.googleapis.com/v2/projects/${PROYECTO}/locations/-/functions?pageSize=200${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`,
  // servicio = projects/<p>/locations/<r>/services/<s>, tal como lo da la función.
  iam: (servicio) => {
    if (!new RegExp(`^projects/${PROYECTO}/locations/[a-z0-9-]+/services/[a-z0-9-]+$`).test(String(servicio))) throw new Error(`servicio inesperado: ${servicio}`);
    return `https://run.googleapis.com/v2/${servicio}:getIamPolicy`;
  },
  proyecto: () => `https://cloudresourcemanager.googleapis.com/v3/projects/${PROYECTO}`,
  politica: (restriccion) => `https://orgpolicy.googleapis.com/v2/projects/${PROYECTO}/policies/${restriccion}:getEffectivePolicy`,
};

// ── Fechas (America/Tegucigalpa) ──────────────────────────────────
function sello(fecha) {
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Tegucigalpa', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha).forEach(x => { p[x.type] = x.value; });
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}${p.minute}${p.second}` };
}

// ── Reglas ────────────────────────────────────────────────────────
const normalizar = (t) => String(t || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim();
const mismasReglas = (a, b) => normalizar(a) === normalizar(b);

const MARCA_FIN = '// ── Lo que sigue es el encabezado original de FRAME ──';
const FRAME_ORIGINAL = [
  '// cliente y portfolio. Es el único archivo de reglas del proyecto',
  '// frame-studio-3a18f y el que apunta firebase.json.',
  '//',
  '// Se publican con: firebase deploy --only firestore:rules',
  '// Antes de publicar, correr las pruebas de contrato (node security-contract.test.js',
  '// y las demás *-contract*), que leen este archivo.',
];

// El borrador es firestore.rules.v2 de FRAME + lo de LOOPA + un encabezado
// «NO PUBLICAR». Para publicar se devuelve el encabezado de FRAME (así un
// deploy desde el repo de FRAME publica lo mismo y no revierte la fusión) y
// se agrega de dónde sale lo de LOOPA. Las reglas en sí no cambian.
function reglasParaFrame(borrador) {
  const lineas = String(borrador).replace(/\r\n/g, '\n').split('\n');
  const ini = lineas.findIndex(l => /^\/\/ ═{20,}$/.test(l));
  const fin = lineas.indexOf(MARCA_FIN);
  if (ini < 0 || fin < ini) throw new Error('El borrador no tiene el encabezado esperado');
  const bloque = lineas.slice(ini, fin + 1);
  const ini2 = bloque.findIndex((l, i) => i > 0 && /^\/\/ ═{20,}$/.test(l));
  // «Lo que agrega la fusión: …» se conserva tal cual.
  const desde = bloque.findIndex(l => l === '// Lo que agrega la fusión:');
  if (ini2 < 0 || desde < 0 || desde > ini2) throw new Error('El borrador no tiene «Lo que agrega la fusión»');
  const fusion = bloque.slice(desde, ini2);
  const raya = lineas[ini].replace(/═/g, '─');
  const resto = lineas.slice(fin + 1);
  const i = resto.indexOf('// cliente y portfolio.');
  if (i < 0) throw new Error('El borrador no tiene el encabezado de FRAME');
  const cabeza = [
    ...FRAME_ORIGINAL,
    '//',
    '// Incluye la fusión con LOOPA OS (las ventas generan tareas). Las partes',
    '// de LOOPA van marcadas «LOOPA:». Su fuente es el repo LOOPA-OS',
    '// (integracion/reglas/firestore.rules.borrador, probado en el emulador) y',
    '// este archivo se genera con integracion/puesta-en-marcha/reglas-para-frame.cjs:',
    '// un cambio acá se hace allá y se vuelve a generar.',
    '//',
    ...fusion,
  ];
  return [...lineas.slice(0, ini), raya, ...resto.slice(0, i), ...cabeza, ...resto.slice(i + 1)].join('\n');
}

// ── Evaluación ────────────────────────────────────────────────────
const item = (id, estado, texto) => ({ id, estado, texto });

// d: { firebaseJson (objeto|null), hayFirebaserc, dependencias, ramaFrame,
//      reglasFrame (texto en el ÚLTIMO COMMIT de FRAME|null),
//      reglasGeneradas (texto), loopaLimpio, frameLimpio }
function evaluarLocal(d) {
  const out = [];
  const fb = d.firebaseJson;
  const fns = fb && Array.isArray(fb.functions) ? fb.functions : null;
  const soloLoopa = !!fns && fns.length === 1 && fns[0].codebase === 'loopa' && fns[0].source === 'functions'
    && Object.keys(fb).every(k => k === 'functions');
  out.push(soloLoopa
    ? item('config-loopa', 'ok', 'firebase.json de LOOPA publica sólo el codebase «loopa» (ni reglas ni hosting).')
    : item('config-loopa', 'falta', 'firebase.json de LOOPA tiene que publicar sólo functions con codebase «loopa».'));
  out.push(d.hayFirebaserc
    ? item('proyecto-fijo', 'falta', 'Hay un .firebaserc: publicar tiene que exigir --project a mano.')
    : item('proyecto-fijo', 'ok', 'Sin .firebaserc: cada publicación nombra el proyecto a mano.'));
  out.push(d.dependencias
    ? item('dependencias', 'ok', 'functions/node_modules instalado.')
    : item('dependencias', 'falta', 'Falta functions/node_modules: cd functions && npm ci --ignore-scripts'));
  if (d.reglasFrame == null) {
    out.push(item('reglas-frame', 'aviso', 'No se encontró el repo de FRAME (FRAME_REPO): no se pudo comparar su archivo de reglas.'));
  } else {
    out.push(mismasReglas(d.reglasFrame, d.reglasGeneradas)
      ? item('reglas-frame', 'ok', 'firestore.rules.v2 de FRAME (último commit) es el borrador probado, con el encabezado de FRAME.')
      : item('reglas-frame', 'falta', 'firestore.rules.v2 del último commit de FRAME no es el borrador: reglas-para-frame.cjs --escribir y commit en FRAME.'));
  }
  if (d.ramaFrame != null) {
    out.push(d.ramaFrame === 'fusion/reglas-loopa' || d.ramaFrame === 'main'
      ? item('rama-frame', 'ok', `FRAME está en la rama ${d.ramaFrame}.`)
      : item('rama-frame', 'aviso', `FRAME está en la rama ${d.ramaFrame}: los cambios están en fusion/reglas-loopa.`));
  }
  // Se publica desde el árbol de trabajo: lo que no está en un commit
  // quedaría publicado sin estar en el repo.
  out.push(d.loopaLimpio ? item('loopa-limpio', 'ok', 'LOOPA sin cambios sin commit.') : item('loopa-limpio', 'falta', 'LOOPA tiene cambios sin commit: se publicaría algo que no quedó registrado.'));
  if (d.frameLimpio != null) out.push(d.frameLimpio ? item('frame-limpio', 'ok', 'FRAME sin cambios sin commit.') : item('frame-limpio', 'falta', 'FRAME tiene cambios sin commit: se publicaría algo que no quedó registrado.'));
  return out;
}

// Lo que devuelve la API de funciones v2, reducido a lo que importa.
function resumirFunciones(lista) {
  return (lista || []).map(f => {
    const partes = String(f.name || '').split('/');
    const labels = f.labels || {};
    return {
      nombre: partes[partes.length - 1] || '',
      region: partes[3] || '',
      codebase: labels['firebase-functions-codebase'] || 'default',
      estado: f.state || '',
      servicio: (f.serviceConfig && f.serviceConfig.service) || null,
      disparador: f.eventTrigger ? (f.eventTrigger.eventType || 'evento') : 'https',
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

const abiertaATodos = (politica) => ((politica && politica.bindings) || [])
  .some(b => b.role === 'roles/run.invoker' && (b.members || []).includes('allUsers'));

// d: { base: {locationId}|{error}, funciones: [resumidas]|{error},
//      iamFrame: {bindings}|{error}|null (la callable de FRAME),
//      iamLoopa: { nombre: {bindings}|{error} } (si ya están publicadas),
//      inalcanzables: [regiones] (la lista de funciones vino incompleta),
//      proyecto: {parent}|{error}, politicaDominios: objeto|{error}|null,
//      reglasActivas: texto|null, reglasNuevas: texto,
//      versionesFrame: [{commit, texto}] del archivo de reglas de FRAME, de la
//        más nueva a la más vieja (un valor FIJO: no depende de dónde esté
//        main, así el chequeo sirve igual antes y después de A1),
//      reglasBase: texto del respaldo de A0 (--base) | undefined }
function evaluarProyecto(d) {
  const out = [];
  // 1. Ubicación de la base.
  if (!d.base || d.base.error) out.push(item('ubicacion', 'falta', `No se pudo leer la base: ${(d.base && d.base.error) || 'sin respuesta'}.`));
  else if (UBICACIONES_OK.includes(d.base.locationId)) out.push(item('ubicacion', 'ok', `La base está en ${d.base.locationId}: el trigger en ${REGION} sirve.`));
  else out.push(item('ubicacion', 'falta', `La base está en ${d.base.locationId}: el trigger de LOOPA (en ${REGION}) hay que moverlo a esa región antes de publicar.`));

  // 2. Las funciones de FRAME, para verificar que siguen después.
  if (!Array.isArray(d.funciones)) out.push(item('funciones', 'falta', `No se pudo leer la lista de funciones: ${(d.funciones && d.funciones.error) || 'sin respuesta'}.`));
  else if (d.inalcanzables && d.inalcanzables.length) out.push(item('funciones', 'falta', `La lista de funciones vino incompleta (sin respuesta de: ${d.inalcanzables.join(', ')}).`));
  else {
    const frame = d.funciones.filter(f => f.codebase !== 'loopa');
    const choque = frame.filter(f => FUNCIONES_LOOPA.includes(f.nombre));
    const yaLoopa = d.funciones.filter(f => f.codebase === 'loopa').map(f => f.nombre);
    if (choque.length) out.push(item('funciones', 'falta', `Ya hay funciones con nombres de LOOPA en otro codebase: ${choque.map(f => f.nombre).join(', ')}.`));
    else out.push(item('funciones', 'ok', `FRAME tiene ${frame.length} funciones (${frame.map(f => f.nombre).join(', ') || 'ninguna'}); ningún nombre choca con LOOPA.`));
    if (yaLoopa.length) out.push(item('funciones-loopa', 'aviso', `Ya hay funciones de LOOPA publicadas: ${yaLoopa.join(', ')}.`));
  }

  // 3. Invocación de las callables (run.invoker para allUsers).
  const restriccion = d.politicaDominios && !d.politicaDominios.error && d.politicaDominios.spec
    && (d.politicaDominios.spec.rules || []).some(r => r.values && Array.isArray(r.values.allowedValues) && r.values.allowedValues.length);
  if (d.politicaDominios && d.politicaDominios.error) out.push(item('politica', 'aviso', `No se pudo leer la política de dominios de la organización (${d.politicaDominios.error}): si existe, puede impedir abrir las callables.`));
  if (restriccion) out.push(item('invocacion', 'falta', 'Una política de la organización limita a quién se le da permiso (dominios): no se podrá abrir las funciones a todos. Hay que resolverlo con quien administra la organización.'));
  else if (!d.iamFrame) out.push(item('invocacion', 'aviso', 'No se encontró la callable de FRAME para comparar el permiso de invocación.'));
  else if (d.iamFrame.error) out.push(item('invocacion', 'aviso', `No se pudo leer el permiso de invocación de FRAME: ${d.iamFrame.error}.`));
  else if (abiertaATodos(d.iamFrame)) out.push(item('invocacion', 'ok', 'La callable de FRAME acepta llamadas desde el navegador (run.invoker para allUsers): las de LOOPA deberían quedar igual al publicarse.'));
  else out.push(item('invocacion', 'aviso', 'La callable de FRAME NO está abierta (por eso responde 403). Después de publicar, las 6 callables de LOOPA probablemente necesiten el mismo permiso (paso A3).'));
  Object.keys(d.iamLoopa || {}).sort().forEach(n => {
    const p = d.iamLoopa[n];
    out.push(p && !p.error && abiertaATodos(p)
      ? item(`invocacion-${n}`, 'ok', `${n} acepta llamadas desde el navegador.`)
      : item(`invocacion-${n}`, 'aviso', `${n} no acepta llamadas desde el navegador todavía${p && p.error ? ` (${p.error})` : ''}.`));
  });
  if (!d.proyecto || d.proyecto.error) out.push(item('organizacion', 'aviso', `No se pudo leer el proyecto (${(d.proyecto && d.proyecto.error) || 'sin respuesta'}): no se sabe si hay políticas de organización.`));
  else out.push(item('organizacion', 'ok', d.proyecto.parent ? `El proyecto cuelga de ${String(d.proyecto.parent).split('/')[0]}.` : 'El proyecto no pertenece a una organización (no hay políticas de organización).'));

  // 4. Reglas activas: tienen que ser la última versión de FRAME ANTERIOR a
  // la fusión (o ya la de la fusión).
  const previas = (d.versionesFrame || []).filter(v => !mismasReglas(v.texto, d.reglasNuevas));
  const igual = previas.findIndex(v => mismasReglas(d.reglasActivas, v.texto));
  if (d.reglasActivas == null) out.push(item('reglas-activas', 'falta', 'No se pudieron leer las reglas activas de Firestore: sin respaldo no se publica.'));
  else if (mismasReglas(d.reglasActivas, d.reglasNuevas)) out.push(item('reglas-activas', 'aviso', 'Las reglas activas YA son las de la fusión.'));
  // Con --base: el respaldo de A0 es la referencia fija (las reglas nuevas se
  // armaron sobre él). Sólo importa que nadie haya publicado otra cosa después.
  else if (d.reglasBase != null) {
    out.push(mismasReglas(d.reglasActivas, d.reglasBase)
      ? item('reglas-activas', 'ok', 'Las reglas activas siguen siendo las del respaldo de A0 (sobre las que se armaron las nuevas).')
      : item('reglas-activas', 'falta', 'Las reglas activas CAMBIARON desde el respaldo de A0: alguien publicó otra cosa. Comparar antes de publicar.'));
  }
  else if (!previas.length) out.push(item('reglas-activas', 'falta', 'No se encontraron versiones de firestore.rules.v2 en el repo de FRAME para comparar.'));
  else if (igual === 0) out.push(item('reglas-activas', 'ok', `Las reglas activas son la última versión de FRAME antes de la fusión (commit ${String(previas[0].commit).slice(0, 7)}): publicar encima no pierde nada.`));
  else if (igual > 0) out.push(item('reglas-activas', 'aviso', `Las reglas activas son una versión VIEJA de FRAME (commit ${String(previas[igual].commit).slice(0, 7)}): publicar también estrena lo de FRAME que nunca se publicó.`));
  else out.push(item('reglas-activas', 'falta', 'Las reglas activas no son ninguna versión de firestore.rules.v2 de FRAME: hay algo publicado que el repo no tiene. Comparar antes de publicar.'));
  return out;
}

const ICONO = { ok: '✔', aviso: '⚠', falta: '✖' };
function informe(titulo, items) {
  const lineas = [`## ${titulo}`, ''];
  items.forEach(i => lineas.push(`- ${ICONO[i.estado] || '·'} ${i.texto}`));
  const faltan = items.filter(i => i.estado === 'falta').length;
  const avisos = items.filter(i => i.estado === 'aviso').length;
  lineas.push('', faltan ? `**${faltan} bloquea(n).**` : avisos ? `Sin bloqueos; ${avisos} aviso(s).` : 'Todo en orden.');
  return lineas.join('\n');
}

module.exports = {
  PROYECTO, REGION, CALLABLES_LOOPA, FUNCIONES_LOOPA, UBICACIONES_OK,
  permitido, urls, sello, normalizar, mismasReglas, reglasParaFrame,
  evaluarLocal, resumirFunciones, abiertaATodos, evaluarProyecto, informe,
};
