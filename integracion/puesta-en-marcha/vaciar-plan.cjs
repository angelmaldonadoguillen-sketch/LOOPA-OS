'use strict';
// ─────────────────────────────────────────────────────────────────────
// Vaciar ventas, clientes y tareas (2026-11-10) — utilidades PURAS.
// Sin red: se prueban con node (integracion/test/vaciar.test.cjs).
//
//   armarPlan(estado, opciones)  qué se borra, a partir de lo leído
//   huella(plan)                 sha256 del plan (orden estable)
//   permitidoVaciar(m, url, plan) la única puerta a la red del borrado:
//                                sólo lo que está en el plan
// ─────────────────────────────────────────────────────────────────────
const crypto = require('node:crypto');

const PROYECTO = 'frame-studio-3a18f';
const ORIGEN = 'tooned-os';
const BUCKET = 'frame-studio-3a18f.firebasestorage.app';
const DOCS = `projects/${PROYECTO}/databases/(default)/documents`;
const DOCS_ORIGEN = `projects/${ORIGEN}/databases/(default)/documents`;
const CARPETAS_STORAGE = ['frame-covers/', 'frame-descriptions/', 'frame-deliverables/', 'frame-client-comments/'];
// Colecciones que se vacían enteras (más sus subcolecciones leídas).
const COLECCIONES = ['loopa_sales', 'frame_clients', 'frame_client_portals', 'frame_projects', 'frame_trash', 'loopa_integration_events'];
const PRIMERA_VENTA = 1001;

// estado: {
//   docs: { <colección>: [nombre completo de cada documento] },
//   subdocs: [nombres completos de documentos de subcolecciones],
//   notificaciones: [{ name, projectId }],
//   storage: [{ name, generation }],
//   gastos: [nombres], origen: [nombres de loopa/* en tooned-os],
//   contador: { name, next } | null,
// }
function armarPlan(estado, { gastos = false, copiaVieja = false } = {}) {
  const tareas = new Set((estado.docs.frame_projects || []).map(n => n.split('/').pop()));
  const borrar = [
    ...COLECCIONES.flatMap(c => estado.docs[c] || []),
    ...(estado.subdocs || []),
    // Avisos que llevan a una tarea que deja de existir.
    ...(estado.notificaciones || []).filter(x => x.projectId && tareas.has(String(x.projectId))).map(x => x.name),
    ...(gastos ? estado.gastos || [] : []),
  ];
  const origen = copiaVieja ? (estado.origen || []) : [];
  borrar.forEach(n => { if (!n.startsWith(DOCS + '/')) throw new Error(`fuera del proyecto: ${n}`); });
  origen.forEach(n => { if (!new RegExp(`^${DOCS_ORIGEN.replace(/[()]/g, '\\$&')}/loopa/[a-z]+$`).test(n)) throw new Error(`fuera de loopa/*: ${n}`); });
  (estado.storage || []).forEach(o => { if (!CARPETAS_STORAGE.some(c => o.name.startsWith(c))) throw new Error(`archivo fuera de las carpetas de tareas: ${o.name}`); });
  if (!estado.contador || !Number.isInteger(estado.contador.next)) throw new Error('falta loopa_counters/sales');
  return {
    borrar: [...new Set(borrar)].sort(),
    origen: [...origen].sort(),
    storage: [...(estado.storage || [])].map(o => ({ name: o.name, generation: String(o.generation) })).sort((a, b) => a.name.localeCompare(b.name)),
    contador: { name: estado.contador.name, de: estado.contador.next, a: PRIMERA_VENTA },
  };
}

function huella(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 16);
}

function resumenPlan(plan) {
  const cuenta = {};
  plan.borrar.forEach(n => {
    const partes = n.slice(DOCS.length + 1).split('/');
    const clave = partes.length > 2 ? `${partes[0]}/*/${partes[2]}` : partes[0];
    cuenta[clave] = (cuenta[clave] || 0) + 1;
  });
  if (plan.origen.length) cuenta['tooned-os loopa/*'] = plan.origen.length;
  cuenta['archivos de Storage'] = plan.storage.length;
  cuenta['próxima venta'] = `#${plan.contador.de} → #${plan.contador.a}`;
  return cuenta;
}

// La única puerta a la red al borrar: commit a Firestore (los deletes se
// revisan aparte, contra el plan) y DELETE de un archivo del plan.
function permitidoVaciar(metodo, url, plan) {
  let u; try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) return false;
  if (metodo === 'POST' && u.hostname === 'firestore.googleapis.com') {
    return u.search === '' && (u.pathname === `/v1/${DOCS}:commit` || u.pathname === `/v1/${DOCS_ORIGEN}:commit`);
  }
  if (metodo === 'DELETE' && u.hostname === 'storage.googleapis.com') {
    const pre = `/storage/v1/b/${BUCKET}/o/`;
    if (!u.pathname.startsWith(pre)) return false;
    const nombre = decodeURIComponent(u.pathname.slice(pre.length));
    const o = plan.storage.find(x => x.name === nombre);
    return !!o && u.search === `?ifGenerationMatch=${o.generation}`;
  }
  return false;
}

// Las escrituras de un commit: sólo deletes del plan (con «exists» para no
// tocar lo que ya no está) y el contador, nada más.
function escriturasValidas(writes, plan) {
  const permitidos = new Set([...plan.borrar, ...plan.origen]);
  return writes.every(w => {
    if (w.delete) return permitidos.has(w.delete) && w.currentDocument && w.currentDocument.exists === true;
    if (w.update) {
      return w.update.name === plan.contador.name
        && JSON.stringify(w.update.fields) === JSON.stringify({ next: { integerValue: String(plan.contador.a) } })
        && JSON.stringify(w.updateMask) === JSON.stringify({ fieldPaths: ['next'] })
        && w.currentDocument && w.currentDocument.exists === true;
    }
    return false;
  });
}

module.exports = { PROYECTO, ORIGEN, BUCKET, DOCS, DOCS_ORIGEN, CARPETAS_STORAGE, COLECCIONES, PRIMERA_VENTA, armarPlan, huella, resumenPlan, permitidoVaciar, escriturasValidas };
