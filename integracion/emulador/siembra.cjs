'use strict';
// Siembra los EMULADORES (proyecto demo-loopa) con los datos de ejemplo del
// servidor local (respaldo sintético migrado + catálogo de ejemplo) y crea
// las cuentas de prueba en el emulador de Auth. Lo usan funciones.test.cjs y
// arrancar-fusion.cjs. Se niega a correr sin emuladores.
//
// Cuentas de prueba (sólo existen en el emulador de este equipo):
//   comercial@demo.test / clave-demo-123   equipo comercial (y miembro del tablero)
//   otro@demo.test      / clave-demo-456   aprobada, NO comercial
const local = require('../servidor-local/servidor.cjs');

const PROJECT = 'demo-loopa';
const COMERCIAL = { uid: 'u-local', email: 'comercial@demo.test', password: 'clave-demo-123' };
const OTRO = { uid: 'u-otro', email: 'otro@demo.test', password: 'clave-demo-456' };
const TABLERO = 'ws-loopa-produccion';

async function sembrarEmulador() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Sin emuladores: no se siembra nada');
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { getAuth } = require('firebase-admin/auth');
  const app = getApps().find(a => a.name === 'siembra') || initializeApp({ projectId: PROJECT }, 'siembra');
  const db = getFirestore(app);
  const store = await local.sembrar();
  await Promise.all([...store.docs].map(([clave, { data }]) => db.doc(clave).set(data)));
  // La persona comercial es miembro del tablero de producción (requisito del
  // punto C: las reglas sólo dejan leer fichas de los tableros propios).
  const ws = (await db.doc(`frame_workspaces/${TABLERO}`).get()).data();
  await db.doc(`frame_workspaces/${TABLERO}`).set({ ...ws, memberIds: [...new Set([...ws.memberIds, COMERCIAL.uid, OTRO.uid])] });
  await db.doc(`frame_users/${OTRO.uid}`).set({ status: 'active' });
  await db.doc(`frame_users/${COMERCIAL.uid}`).set({ status: 'active', name: 'Comercial (prueba)', email: COMERCIAL.email });
  // El tablero como lo tiene FRAME: columnas con nombre y cierre, la rutina
  // del día y dos tareas MANUALES (sin venta): una con ficha y otra vieja,
  // sin ficha, para enlazar.
  const demo = require('../preview/produccion-demo.json');
  await db.doc(`frame_workspaces/${TABLERO}/config/kanban_columns`).set({ columns: demo.columnas });
  await db.doc(`frame_workspaces/${TABLERO}/config/daily_routine`).set(demo.rutina);
  const miembros = [...new Set([...ws.memberIds, COMERCIAL.uid, OTRO.uid])];
  const manual = (id, over) => db.doc(`frame_projects/${id}`).set({
    id, title: 'Sesión de fotos', client: 'Café Aurora', type: 'photo', status: 'briefing', priority: 'medium',
    assignees: [COMERCIAL.uid], startDate: '2026-11-10', sessionDate: '2026-11-12', deadline: '2026-11-20', tags: [],
    cover: { type: 'color', value: 'var(--surface-2)' }, description: [], checklist: [{ id: 'k1', text: 'Grabar', done: false }],
    deliverables: [], timeline: [], comments: [], clientVisible: true,
    workspaceId: TABLERO, workspaceIds: [TABLERO], viewerIds: miembros, ...over,
  });
  await manual('manual-con-ficha', { clientId: 'fc-mig-aurora' });
  await manual('manual-sin-ficha', { title: 'Video viejo', type: 'reel' });
  const auth = getAuth(app);
  for (const u of [COMERCIAL, OTRO]) await auth.createUser(u).catch(e => { if (!/exists/.test(e.code || '')) throw e; });
  return { app, db };
}

module.exports = { sembrarEmulador, PROJECT, COMERCIAL, OTRO };
