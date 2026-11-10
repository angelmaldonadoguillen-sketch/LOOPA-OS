#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// Respaldo de SÓLO LECTURA antes de vaciar ventas y clientes (2026-11-10).
//
//   node integracion/puesta-en-marcha/respaldo-ventas-clientes.cjs
//
// Lee con GET (nada más) todo lo de ventas y clientes, y lo que los toca:
//   · frame-studio-3a18f: las colecciones de COLECCIONES, más los
//     comentarios de cada portal de cliente;
//   · tooned-os: loopa/{ventas,clientes,servicios,config,gastos} (la copia
//     archivada de antes del corte).
// Deja en integracion/puesta-en-marcha/respaldo/vc-<fecha>-<hora>/ (fuera de git):
//   crudo/<colección>.json   los documentos tal cual los da la API (sin pérdida)
//   legible/<colección>.json los mismos, como objetos JS
//   resumen.json             cuántos hay de cada cosa
//   sha256.txt               huella de cada archivo crudo
// No escribe nada en ningún proyecto. El token no se imprime ni se guarda.
// ─────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const B = require('./punto-b.cjs');
const { sello } = require('./punto-a.cjs');
const { tokenDelCli } = require('./sesion-cli.cjs');

const PROYECTO = 'frame-studio-3a18f';
const COLECCIONES = [
  'loopa_sales', 'frame_clients', 'frame_client_portals', 'frame_projects', 'frame_trash',
  'loopa_integration_events', 'loopa_counters', 'loopa_services', 'loopa_expenses', 'loopa_config', 'loopa_migrations',
];
const BASE = (p) => `https://firestore.googleapis.com/v1/projects/${p}/databases/(default)/documents`;

// La única puerta a la red: GET a Firestore REST de estos dos proyectos.
function permitido(metodo, url) {
  if (metodo !== 'GET') return false;
  let u; try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.hostname !== 'firestore.googleapis.com' || u.username || u.password || u.port || u.hash) return false;
  return u.pathname.startsWith(`/v1/projects/${PROYECTO}/databases/(default)/documents/`)
    || u.pathname.startsWith(`/v1/projects/${B.ORIGEN}/databases/(default)/documents/loopa/`);
}

async function leer(url, tk) {
  if (!permitido('GET', url)) throw new Error(`Lectura no permitida: ${url}`);
  const r = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${tk}` }, redirect: 'error' });
  const cuerpo = await r.json().catch(() => ({}));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} ${(cuerpo.error && cuerpo.error.status) || ''} al leer ${new URL(url).pathname.split('/documents/')[1]}`);
  return cuerpo;
}

async function listar(ruta, tk) {
  const out = [];
  let pagina = '';
  do {
    const r = await leer(`${BASE(PROYECTO)}/${ruta}?pageSize=300${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`, tk);
    out.push(...((r && r.documents) || []));
    pagina = (r && r.nextPageToken) || '';
  } while (pagina);
  return out;
}

const legible = (docs) => docs.map(d => {
  try { const { id, datos } = B.decodificar(d); return { id, ...datos }; }
  catch (e) { return { id: d.name.split('/').pop(), _noLegible: e.message }; }
});

(async () => {
  const s = sello(new Date());
  const dir = path.join(__dirname, 'respaldo', `vc-${s.dia}-${s.hora}`);
  if (fs.existsSync(dir)) throw new Error(`Ya existe ${dir}`);
  fs.mkdirSync(path.join(dir, 'crudo'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'legible'), { recursive: true });
  const huellas = [];
  const guardar = (nombre, crudo) => {
    const texto = JSON.stringify(crudo, null, 1);
    fs.writeFileSync(path.join(dir, 'crudo', `${nombre}.json`), texto);
    fs.writeFileSync(path.join(dir, 'legible', `${nombre}.json`), JSON.stringify(legible(crudo), null, 1));
    huellas.push(`${crypto.createHash('sha256').update(texto).digest('hex')}  crudo/${nombre}.json`);
  };

  const tk = tokenDelCli(PROYECTO);
  const resumen = {};
  for (const c of COLECCIONES) {
    const docs = await listar(c, tk);
    guardar(c, docs);
    resumen[c] = docs.length;
  }
  // Comentarios de cada portal de cliente.
  const portales = JSON.parse(fs.readFileSync(path.join(dir, 'crudo', 'frame_client_portals.json'), 'utf8'));
  const comentarios = [];
  for (const p of portales) {
    const ruta = p.name.split('/documents/')[1];
    comentarios.push(...await listar(`${ruta}/comments`, tk));
  }
  guardar('frame_client_portals__comments', comentarios);
  resumen['frame_client_portals/*/comments'] = comentarios.length;

  // La copia archivada en tooned-os (de antes del corte).
  const tkOrigen = tokenDelCli(B.ORIGEN);
  const archivo = [];
  for (const k of B.DOCS_LOOPA) {
    const d = await leer(`${BASE(B.ORIGEN)}/loopa/${k}`, tkOrigen);
    if (d) archivo.push(d);
  }
  guardar('tooned-os__loopa', archivo);
  resumen['tooned-os loopa/*'] = archivo.length;

  // Lo que se cruza con ventas y clientes.
  const L = (n) => JSON.parse(fs.readFileSync(path.join(dir, 'legible', `${n}.json`), 'utf8'));
  const tareas = L('frame_projects');
  resumen.tareas_de_venta = tareas.filter(t => t.sourceSystem === 'loopa').length;
  resumen.tareas_con_clientId = tareas.filter(t => t.clientId).length;
  resumen.tareas_con_cliente_por_nombre = tareas.filter(t => t.client && !t.clientId).length;
  const archivoLegible = L('tooned-os__loopa');
  archivoLegible.forEach(d => { const v = Object.values(d).find(Array.isArray); resumen[`tooned-os loopa/${d.id} (elementos)`] = v ? v.length : '?'; });

  fs.writeFileSync(path.join(dir, 'resumen.json'), JSON.stringify(resumen, null, 2));
  fs.writeFileSync(path.join(dir, 'sha256.txt'), huellas.join('\n') + '\n');
  console.log(JSON.stringify(resumen, null, 2));
  console.log(`Respaldo en ${path.relative(process.cwd(), dir)}`);
})().catch(e => { console.error('✖', e.message); process.exit(1); });
