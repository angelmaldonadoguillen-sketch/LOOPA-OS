#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// Punto B0 — respaldo de SÓLO LECTURA para la migración.
//
//   node integracion/puesta-en-marcha/respaldo-b.cjs
//
// Lee (GET, permitidoB):
//   · tooned-os: loopa/{ventas,clientes,servicios,config,gastos}
//   · frame-studio-3a18f: frame_workspaces, frame_clients, frame_users
// y deja en integracion/puesta-en-marcha/respaldo/b-<fecha>-<hora>/ (fuera de git):
//   loopa-respaldo.json   el origen, con la forma del export de LOOPA
//   frame-clients.json    { workspaceId: null, clients: [...] } para migrate.cjs
//   tableros.json         id, nombre, dueño y miembros de cada tablero
//   usuarios.json         uid, nombre, email y estado (para el punto C)
//   sha256.txt            huella de loopa-respaldo.json
// No escribe nada en ningún proyecto. El token no se imprime ni se guarda.
// ─────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const B = require('./punto-b.cjs');
const { sello } = require('./punto-a.cjs');
const { tokenDelCli } = require('./sesion-cli.cjs');

async function leer(url, tk) {
  if (!B.permitidoB('GET', url)) throw new Error(`Lectura no permitida: ${url}`);
  const r = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${tk}` }, redirect: 'error' });
  const cuerpo = await r.json().catch(() => ({}));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} ${(cuerpo.error && cuerpo.error.status) || ''} al leer ${new URL(url).pathname.split('/documents/')[1]}`);
  return cuerpo;
}

async function coleccion(c, tk) {
  const out = [];
  let pagina = '';
  do {
    const r = await leer(B.urlsB.frame(c, pagina), tk);
    ((r && r.documents) || []).forEach(d => { const { id, datos } = B.decodificar(d); out.push({ id, ...datos }); });
    pagina = (r && r.nextPageToken) || '';
  } while (pagina);
  return out;
}

(async () => {
  const s = sello(new Date());
  const dir = path.join(__dirname, 'respaldo', `b-${s.dia}-${s.hora}`);
  if (fs.existsSync(dir)) throw new Error(`Ya existe ${dir}`);

  const tkOrigen = tokenDelCli(B.ORIGEN);
  const docs = {};
  for (const k of B.DOCS_LOOPA) {
    const d = await leer(B.urlsB.loopa(k), tkOrigen);
    docs[k] = d ? B.decodificar(d).datos : null;
  }
  const respaldo = B.armarRespaldo(docs, new Date().toISOString());

  const tk = tokenDelCli(B.DESTINO);
  const tableros = await coleccion('frame_workspaces', tk);
  const clientes = await coleccion('frame_clients', tk);
  const usuarios = await coleccion('frame_users', tk);

  fs.mkdirSync(dir, { recursive: true });
  const texto = JSON.stringify(respaldo, null, 2);
  fs.writeFileSync(path.join(dir, 'loopa-respaldo.json'), texto);
  const sha = crypto.createHash('sha256').update(texto).digest('hex');
  fs.writeFileSync(path.join(dir, 'sha256.txt'), `${sha}  loopa-respaldo.json\n`);
  fs.writeFileSync(path.join(dir, 'frame-clients.json'), JSON.stringify({ workspaceId: null, clients: clientes }, null, 2));
  fs.writeFileSync(path.join(dir, 'tableros.json'), JSON.stringify(tableros.map(w => ({
    id: w.id, nombre: w.name || '', dueño: w.ownerId || '', miembros: w.memberIds || [],
    fichas: clientes.filter(c => c.workspaceId === w.id).length,
  })), null, 2));
  fs.writeFileSync(path.join(dir, 'usuarios.json'), JSON.stringify(usuarios.map(u => ({
    uid: u.id, nombre: u.name || u.displayName || '', email: u.email || '', estado: u.status || '', admin: u.platformAdmin === true,
  })), null, 2));

  const r = B.resumenRespaldo(respaldo);
  console.log('Punto B0 · respaldo de sólo lectura');
  console.log(`  LOOPA (tooned-os): ${r.ventas} ventas, ${r.clientes} clientes, ${r.servicios} servicios, ${r.gastosVariables} gastos variables, ${r.gastosFijos} fijos`);
  console.log(`  FRAME: ${tableros.length} tableros, ${clientes.length} fichas de cliente, ${usuarios.length} usuarios`);
  console.log(`  sha256 loopa-respaldo.json: ${sha}`);
  console.log(`  En ${path.relative(path.join(__dirname, '..', '..'), dir)}`);
})().catch(e => { console.error(`✖ ${e.message}`); process.exit(1); });
