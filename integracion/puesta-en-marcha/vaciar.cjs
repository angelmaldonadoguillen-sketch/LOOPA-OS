#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// Vaciar ventas, clientes y tareas (2026-11-10). BORRA DATOS REALES.
//
//   node integracion/puesta-en-marcha/vaciar.cjs [--gastos] [--copia-vieja]
//       Prueba en seco: lee, arma el plan y muestra qué borraría y su huella.
//   node integracion/puesta-en-marcha/vaciar.cjs [--gastos] [--copia-vieja] --escribir --huella <h>
//       Borra SÓLO si el plan de ahora tiene esa huella (nada cambió desde
//       que se revisó). Después vuelve a leer y confirma que quedó en cero.
//
// Siempre: ventas, clientes, portales (y sus comentarios), tareas (y sus
// comentarios e historial), papelera, eventos de integración, los avisos que
// llevan a una tarea, y los archivos de tareas y portales en Storage. La
// próxima venta vuelve a ser la #1001. Con --gastos: los gastos. Con
// --copia-vieja: la copia archivada loopa/* de tooned-os.
// Quedan: usuarios, tableros, equipo, servicios, configuración, portfolio.
//
// Antes: respaldo-ventas-clientes.cjs y respaldo-tareas-archivos.cjs.
// ─────────────────────────────────────────────────────────────────────
const P = require('./vaciar-plan.cjs');
const { tokenDelCli } = require('./sesion-cli.cjs');

const args = process.argv.slice(2);
const ESCRIBIR = args.includes('--escribir');
const OPC = { gastos: args.includes('--gastos'), copiaVieja: args.includes('--copia-vieja') };
const HUELLA = (args[args.indexOf('--huella') + 1] || '').trim();
const FS = 'https://firestore.googleapis.com/v1';
const ST = `https://storage.googleapis.com/storage/v1/b/${P.BUCKET}/o`;

async function get(url, tk) {
  const u = new URL(url);
  const ok = (u.hostname === 'firestore.googleapis.com' && (u.pathname.startsWith(`/v1/${P.DOCS}/`) || u.pathname.startsWith(`/v1/${P.DOCS_ORIGEN}/loopa/`)))
    || (u.hostname === 'storage.googleapis.com' && u.pathname === `/storage/v1/b/${P.BUCKET}/o`);
  if (!ok) throw new Error(`Lectura no permitida: ${url}`);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tk}` }, redirect: 'error' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} al leer ${u.pathname}`);
  return r.json();
}
async function listar(ruta, tk, base = P.DOCS) {
  const out = []; let pagina = '';
  do {
    const r = await get(`${FS}/${base}/${ruta}?pageSize=300${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`, tk);
    out.push(...((r && r.documents) || [])); pagina = (r && r.nextPageToken) || '';
  } while (pagina);
  return out;
}
const campo = (d, k) => { const v = d.fields && d.fields[k]; return v ? (v.stringValue ?? v.integerValue ?? null) : null; };

async function leerEstado(tk, tkOrigen) {
  const estado = { docs: {}, subdocs: [], notificaciones: [], storage: [], gastos: [], origen: [], contador: null };
  for (const c of P.COLECCIONES) estado.docs[c] = (await listar(c, tk)).map(d => d.name);
  for (const t of estado.docs.frame_projects) for (const sub of ['comments', 'activity']) estado.subdocs.push(...(await listar(`${t.split('/documents/')[1]}/${sub}`, tk)).map(d => d.name));
  for (const p of estado.docs.frame_client_portals) estado.subdocs.push(...(await listar(`${p.split('/documents/')[1]}/comments`, tk)).map(d => d.name));
  for (const u of await listar('frame_users', tk)) {
    const uid = u.name.split('/').pop();
    estado.notificaciones.push(...(await listar(`frame_notifications/${uid}/items`, tk)).map(d => ({ name: d.name, projectId: campo(d, 'projectId') })));
  }
  for (const c of P.CARPETAS_STORAGE) {
    let pagina = '';
    do {
      const r = await get(`${ST}?prefix=${encodeURIComponent(c)}${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`, tk);
      estado.storage.push(...((r && r.items) || []).map(o => ({ name: o.name, generation: o.generation })));
      pagina = (r && r.nextPageToken) || '';
    } while (pagina);
  }
  estado.gastos = (await listar('loopa_expenses', tk)).map(d => d.name);
  const cont = await get(`${FS}/${P.DOCS}/loopa_counters/sales`, tk);
  estado.contador = cont ? { name: cont.name, next: Number(campo(cont, 'next')) } : null;
  if (tkOrigen) for (const k of ['ventas', 'clientes', 'servicios', 'config', 'gastos']) {
    const d = await get(`${FS}/${P.DOCS_ORIGEN}/loopa/${k}`, tkOrigen);
    if (d) estado.origen.push(d.name);
  }
  return estado;
}

async function commit(base, writes, tk, plan) {
  if (!P.escriturasValidas(writes, plan)) throw new Error('escritura fuera del plan');
  const url = `${FS}/${base}:commit`;
  if (!P.permitidoVaciar('POST', url, plan)) throw new Error(`no permitido: ${url}`);
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }), redirect: 'error' });
  if (!r.ok) throw new Error(`${r.status} en commit: ${JSON.stringify(await r.json().catch(() => ({}))).slice(0, 300)}`);
}

(async () => {
  const tk = tokenDelCli(P.PROYECTO);
  const tkOrigen = OPC.copiaVieja ? tokenDelCli(P.ORIGEN) : null;
  const plan = P.armarPlan(await leerEstado(tk, tkOrigen), OPC);
  const h = P.huella(plan);
  console.log(JSON.stringify(P.resumenPlan(plan), null, 2));
  console.log(`Huella del plan: ${h}`);
  if (!ESCRIBIR) { console.log('Prueba en seco: no se borró nada.'); return; }
  if (HUELLA !== h) throw new Error(`La huella no coincide (${HUELLA || 'falta --huella'} ≠ ${h}): algo cambió o el plan es otro. No se borró nada.`);

  // 1) Firestore del proyecto: deletes de a 400 + el contador al final.
  const writes = plan.borrar.map(n => ({ delete: n, currentDocument: { exists: true } }));
  for (let i = 0; i < writes.length; i += 400) await commit(P.DOCS, writes.slice(i, i + 400), tk, plan);
  await commit(P.DOCS, [{ update: { name: plan.contador.name, fields: { next: { integerValue: String(plan.contador.a) } } }, updateMask: { fieldPaths: ['next'] }, currentDocument: { exists: true } }], tk, plan);
  console.log(`✔ Firestore: ${plan.borrar.length} documentos borrados; próxima venta #${plan.contador.a}`);
  // 2) Copia vieja en tooned-os.
  if (plan.origen.length) {
    await commit(P.DOCS_ORIGEN, plan.origen.map(n => ({ delete: n, currentDocument: { exists: true } })), tkOrigen, plan);
    console.log(`✔ tooned-os: ${plan.origen.length} documentos borrados`);
  }
  // 3) Storage: cada archivo, sólo si es la misma versión que se revisó.
  for (const o of plan.storage) {
    const url = `${ST}/${encodeURIComponent(o.name)}?ifGenerationMatch=${o.generation}`;
    if (!P.permitidoVaciar('DELETE', url, plan)) throw new Error(`no permitido: ${o.name}`);
    const r = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${tk}` }, redirect: 'error' });
    if (!r.ok && r.status !== 404) throw new Error(`${r.status} al borrar ${o.name}`);
  }
  console.log(`✔ Storage: ${plan.storage.length} archivos borrados`);

  // 4) Verificación: volver a leer.
  const despues = P.armarPlan(await leerEstado(tk, tkOrigen), OPC);
  const quedan = despues.borrar.length + despues.origen.length + despues.storage.length;
  if (quedan || despues.contador.de !== P.PRIMERA_VENTA) throw new Error(`Quedaron ${quedan} cosas; próxima venta #${despues.contador.de}`);
  console.log('✔ Verificado: ventas, clientes y tareas en cero; la próxima venta es la #1001.');
})().catch(e => { console.error('✖', e.message); process.exit(1); });
