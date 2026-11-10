#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// Punto A — chequeos antes de publicar (ADR-0004 §7 y PUNTO-A.md).
//
//   node integracion/puesta-en-marcha/chequeo-a.cjs --frame <repo FRAME>
//       Sólo esta PC: configuración, dependencias, reglas de FRAME, git.
//       No usa la red.
//
//   node integracion/puesta-en-marcha/chequeo-a.cjs --frame <repo FRAME> --leer-proyecto
//       Además LEE frame-studio-3a18f (requiere aprobación): ubicación de la
//       base, reglas activas (respaldo), funciones publicadas y permisos de
//       invocación. Guarda el respaldo en integracion/puesta-en-marcha/respaldo/
//       (fuera de git).
//
// SÓLO LECTURA. Toda llamada pasa por permitido(): GET, https a las APIs de
// Google que se leen y sólo este proyecto. Usa la sesión del Firebase CLI de
// esta PC (la misma de `firebase login`); el token no se imprime ni se guarda.
//
// FRAME_REPO (o --frame <ruta>): el repo de FRAME, para comparar las reglas.
// ─────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const A = require('./punto-a.cjs');

const RAIZ = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const LEER = args.includes('--leer-proyecto');
const iFrame = args.indexOf('--frame');
const FRAME = iFrame >= 0 ? args[iFrame + 1] : process.env.FRAME_REPO;
const RAMA = 'fusion/reglas-loopa';
// --base <carpeta de respaldo de A0>: las reglas activas se comparan con ese
// respaldo (A3/A4), no con la historia de FRAME.
const iBase = args.indexOf('--base');
const BASE = iBase >= 0 ? path.resolve(args[iBase + 1] || '', 'firestore.rules') : null;
if (BASE && !fs.existsSync(BASE)) { console.error(`✖ No existe ${BASE}`); process.exit(2); }

const git = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};

// Todas las versiones de firestore.rules.v2 en la historia de FRAME (main y
// la rama de la fusión), de la más nueva a la más vieja.
function versionesFrame(frame) {
  const refs = [RAMA, 'main'].filter(r => git(frame, 'rev-parse', '--verify', '--quiet', r) !== null);
  if (!refs.length) return [];
  const log = git(frame, 'log', '--format=%H', '-n', '40', ...refs, '--', 'firestore.rules.v2') || '';
  return log.split('\n').filter(Boolean).map(commit => ({ commit, texto: git(frame, 'show', `${commit}:firestore.rules.v2`) })).filter(v => v.texto != null);
}

function local() {
  const borrador = fs.readFileSync(path.join(RAIZ, 'integracion', 'reglas', 'firestore.rules.borrador'), 'utf8');
  const frame = FRAME && fs.existsSync(path.join(FRAME, 'firestore.rules.v2')) ? path.resolve(FRAME) : null;
  let firebaseJson = null;
  try { firebaseJson = JSON.parse(fs.readFileSync(path.join(RAIZ, 'firebase.json'), 'utf8')); } catch (e) { /* queda null */ }
  const st = (cwd) => { const s = git(cwd, 'status', '--porcelain'); return s === null ? null : s.trim() === ''; };
  const reglasNuevas = A.reglasParaFrame(borrador);
  return {
    datos: {
      firebaseJson,
      hayFirebaserc: fs.existsSync(path.join(RAIZ, '.firebaserc')),
      dependencias: fs.existsSync(path.join(RAIZ, 'functions', 'node_modules', 'firebase-functions')),
      // Lo que se publica tiene que estar en un commit: se compara el de HEAD.
      reglasFrame: frame ? git(frame, 'show', 'HEAD:firestore.rules.v2') : null,
      reglasGeneradas: reglasNuevas,
      ramaFrame: frame ? (git(frame, 'branch', '--show-current') || '').trim() || null : null,
      loopaLimpio: st(RAIZ),
      frameLimpio: frame ? st(frame) : null,
    },
    frame,
    reglasNuevas,
  };
}

// ── Red: sólo GET, sólo este proyecto ─────────────────────────────
function token() {
  // Un comando de lectura del CLI renueva la sesión si hace falta (y de paso
  // confirma que el CLI ve el proyecto).
  // En Windows el CLI se busca con el shell: el comando va en un solo texto
  // (fijo, sin datos de afuera).
  const r = process.platform === 'win32'
    ? spawnSync(`firebase functions:list --project ${A.PROYECTO}`, { encoding: 'utf8', shell: true })
    : spawnSync('firebase', ['functions:list', '--project', A.PROYECTO], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('El Firebase CLI no pudo leer el proyecto (¿firebase login?).');
  const f = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const t = JSON.parse(fs.readFileSync(f, 'utf8')).tokens || {};
  if (!t.access_token || !(Number(t.expires_at) > Date.now() + 60000)) throw new Error('La sesión del Firebase CLI no tiene un token vigente: correr `firebase login --reauth`.');
  return t.access_token;
}

async function leer(url, tk) {
  if (!A.permitido('GET', url)) throw new Error(`Lectura no permitida: ${url}`);
  const r = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${tk}` }, redirect: 'error' });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) return { error: `${r.status} ${(cuerpo.error && cuerpo.error.status) || ''}`.trim() };
  return cuerpo;
}
// Un punto que falla no corta los demás: queda como { error }.
const seguro = async (fn) => { try { return await fn(); } catch (e) { return { error: e.message }; } };

async function proyecto(reglasNuevas, frame) {
  const tk = token();
  const s = A.sello(new Date());
  const dir = path.join(__dirname, 'respaldo', `${s.dia}-${s.hora}`);
  // Un respaldo no se pisa nunca.
  if (fs.existsSync(dir)) throw new Error(`Ya existe ${dir}: esperar un segundo y repetir.`);
  fs.mkdirSync(dir, { recursive: true });

  const base = await seguro(() => leer(A.urls.base(), tk));

  // Reglas activas (todas las releases, con páginas).
  const releases = [];
  let reglasActivas = null;
  let pagina = '';
  do {
    const rel = await seguro(() => leer(A.urls.releases(pagina), tk));
    if (rel.error) { releases.push({ error: rel.error }); break; }
    (rel.releases || []).forEach(x => releases.push({ name: x.name, rulesetName: x.rulesetName, updateTime: x.updateTime }));
    pagina = rel.nextPageToken || '';
  } while (pagina);
  for (const x of releases.filter(r => !r.error)) {
    const rs = await seguro(() => leer(A.urls.ruleset(x.rulesetName), tk));
    if (rs.error) { x.error = rs.error; continue; }
    const archivos = (rs.source && rs.source.files) || [];
    const texto = archivos.map(f => f.content).join('\n');
    const esFirestore = /\/releases\/cloud\.firestore$/.test(x.name);
    const nombre = esFirestore ? 'firestore.rules' : `${String(x.name).split('/releases/')[1].replace(/[^A-Za-z0-9._-]+/g, '_')}.rules`;
    if (archivos.length) fs.writeFileSync(path.join(dir, nombre), texto);
    if (esFirestore && archivos.length) reglasActivas = texto;
  }
  fs.writeFileSync(path.join(dir, 'releases.json'), JSON.stringify(releases, null, 2));

  // Funciones (con páginas; las regiones sin respuesta se informan).
  let funciones = [];
  const inalcanzables = [];
  pagina = '';
  do {
    const fl = await seguro(() => leer(A.urls.funciones(pagina), tk));
    if (fl.error) { funciones = fl; break; }
    funciones.push(...A.resumirFunciones(fl.functions));
    (fl.unreachable || []).forEach(u => inalcanzables.push(u));
    pagina = fl.nextPageToken || '';
  } while (pagina);
  fs.writeFileSync(path.join(dir, 'funciones.json'), JSON.stringify({ funciones, inalcanzables }, null, 2));

  let iamFrame = null;
  const iamLoopa = {};
  if (Array.isArray(funciones)) {
    const reserva = funciones.find(f => f.nombre === 'reservePortfolioAsset' && f.servicio);
    if (reserva) iamFrame = await seguro(() => leer(A.urls.iam(reserva.servicio), tk));
    for (const f of funciones.filter(x => A.CALLABLES_LOOPA.includes(x.nombre) && x.codebase === 'loopa' && x.servicio)) {
      iamLoopa[f.nombre] = await seguro(() => leer(A.urls.iam(f.servicio), tk));
    }
  }
  const pr = await seguro(() => leer(A.urls.proyecto(), tk));
  const politicaDominios = pr && !pr.error && pr.parent ? await seguro(() => leer(A.urls.politica('iam.allowedPolicyMemberDomains'), tk)) : null;

  const items = A.evaluarProyecto({
    base: base.error ? base : { locationId: base.locationId },
    funciones, inalcanzables, iamFrame, iamLoopa, proyecto: pr.error ? pr : { parent: pr.parent || null },
    politicaDominios, reglasActivas, reglasNuevas,
    versionesFrame: frame ? versionesFrame(frame) : [],
    reglasBase: BASE ? fs.readFileSync(BASE, 'utf8') : undefined,
  });
  return { items, dir };
}

(async () => {
  const l = local();
  const itemsLocal = A.evaluarLocal(l.datos);
  console.log(A.informe('Punto A · esta PC', itemsLocal));
  let bloquea = itemsLocal.some(i => i.estado === 'falta');
  if (LEER) {
    if (!l.frame) throw new Error('Para leer el proyecto hace falta el repo de FRAME (--frame o FRAME_REPO): con él se comparan las reglas activas.');
    const { items, dir } = await proyecto(l.reglasNuevas, l.frame);
    const texto = A.informe(`Punto A · ${A.PROYECTO} (sólo lectura)`, items);
    console.log(`\n${texto}`);
    fs.writeFileSync(path.join(dir, 'informe.md'), `${A.informe('Punto A · esta PC', itemsLocal)}\n\n${texto}\n`);
    console.log(`\nRespaldo e informe en ${path.relative(RAIZ, dir)}`);
    if (fs.existsSync(path.join(dir, 'firestore.rules'))) {
      console.log('Siguiente: probar las reglas activas en el emulador (ver PUNTO-A.md, A0).');
    }
    bloquea = bloquea || items.some(i => i.estado === 'falta');
  } else {
    console.log('\n(Sin --leer-proyecto: no se leyó nada del proyecto real.)');
  }
  process.exit(bloquea ? 1 : 0);
})().catch(e => { console.error(`✖ ${e.message}`); process.exit(1); });
