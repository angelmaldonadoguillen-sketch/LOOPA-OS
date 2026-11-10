#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// Complemento de respaldo-ventas-clientes.cjs: SÓLO LECTURA.
//
//   node integracion/puesta-en-marcha/respaldo-tareas-archivos.cjs <carpeta vc-…>
//
// Agrega a esa carpeta:
//   crudo|legible/frame_projects__comments.json   comentarios de cada tarea
//   crudo|legible/frame_projects__activity.json   historial de cada tarea
//   archivos/<ruta en Storage>                    los archivos de tareas y portales
//   archivos.json                                 lista, tamaño y md5 de cada uno
// Storage: sólo las carpetas de tareas y portales (no el portfolio).
// No escribe nada en ningún proyecto. El token no se imprime ni se guarda.
// ─────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const B = require('./punto-b.cjs');
const { tokenDelCli } = require('./sesion-cli.cjs');

const PROYECTO = 'frame-studio-3a18f';
const BUCKET = 'frame-studio-3a18f.firebasestorage.app';
const CARPETAS = ['frame-covers/', 'frame-descriptions/', 'frame-deliverables/', 'frame-client-comments/'];
const FS = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const ST = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o`;

function permitido(metodo, url) {
  if (metodo !== 'GET') return false;
  let u; try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) return false;
  if (u.hostname === 'firestore.googleapis.com') return u.pathname.startsWith(`/v1/projects/${PROYECTO}/databases/(default)/documents/frame_projects/`);
  if (u.hostname === 'storage.googleapis.com') return u.pathname.startsWith(`/storage/v1/b/${BUCKET}/o`);
  return false;
}
async function get(url, tk, binario = false) {
  if (!permitido('GET', url)) throw new Error(`Lectura no permitida: ${url}`);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tk}` }, redirect: 'error' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} al leer ${new URL(url).pathname}`);
  return binario ? Buffer.from(await r.arrayBuffer()) : r.json();
}

(async () => {
  const dir = path.resolve(process.argv[2] || '');
  if (!fs.existsSync(path.join(dir, 'crudo', 'frame_projects.json'))) throw new Error('Pasá la carpeta vc-… de respaldo-ventas-clientes.cjs');
  const tk = tokenDelCli(PROYECTO);
  const huellas = [];
  const guardar = (nombre, crudo) => {
    const texto = JSON.stringify(crudo, null, 1);
    fs.writeFileSync(path.join(dir, 'crudo', `${nombre}.json`), texto);
    fs.writeFileSync(path.join(dir, 'legible', `${nombre}.json`), JSON.stringify(crudo.map(d => {
      try { const { id, datos } = B.decodificar(d); return { id, _ruta: d.name.split('/documents/')[1], ...datos }; } catch (e) { return { _ruta: d.name, _noLegible: e.message }; }
    }), null, 1));
    huellas.push(`${crypto.createHash('sha256').update(texto).digest('hex')}  crudo/${nombre}.json`);
  };
  const resumen = JSON.parse(fs.readFileSync(path.join(dir, 'resumen.json'), 'utf8'));

  const tareas = JSON.parse(fs.readFileSync(path.join(dir, 'crudo', 'frame_projects.json'), 'utf8'));
  for (const sub of ['comments', 'activity']) {
    const todos = [];
    for (const t of tareas) {
      const ruta = t.name.split('/documents/')[1];
      let pagina = '';
      do {
        const r = await get(`${FS}/${ruta}/${sub}?pageSize=300${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`, tk);
        todos.push(...((r && r.documents) || []));
        pagina = (r && r.nextPageToken) || '';
      } while (pagina);
    }
    guardar(`frame_projects__${sub}`, todos);
    resumen[`frame_projects/*/${sub}`] = todos.length;
  }

  const archivos = [];
  for (const c of CARPETAS) {
    let pagina = '';
    do {
      const r = await get(`${ST}?prefix=${encodeURIComponent(c)}${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`, tk);
      for (const o of (r && r.items) || []) {
        const datos = await get(`${ST}/${encodeURIComponent(o.name)}?alt=media`, tk, true);
        const md5 = crypto.createHash('md5').update(datos).digest('base64');
        if (md5 !== o.md5Hash) throw new Error(`md5 distinto en ${o.name}`);
        const destino = path.join(dir, 'archivos', ...o.name.split('/'));
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.writeFileSync(destino, datos);
        archivos.push({ name: o.name, size: Number(o.size), contentType: o.contentType, md5Hash: o.md5Hash, metadata: o.metadata || null });
      }
      pagina = (r && r.nextPageToken) || '';
    } while (pagina);
  }
  fs.writeFileSync(path.join(dir, 'archivos.json'), JSON.stringify(archivos, null, 1));
  resumen.archivos_storage = archivos.length;
  resumen.archivos_storage_mb = +(archivos.reduce((a, o) => a + o.size, 0) / 1048576).toFixed(2);
  fs.writeFileSync(path.join(dir, 'resumen.json'), JSON.stringify(resumen, null, 2));
  fs.appendFileSync(path.join(dir, 'sha256.txt'), huellas.join('\n') + '\n');
  console.log(JSON.stringify(resumen, null, 2));
})().catch(e => { console.error('✖', e.message); process.exit(1); });
