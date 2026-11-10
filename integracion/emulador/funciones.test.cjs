'use strict';
// ─────────────────────────────────────────────────────────────────
// Tanda 3.4 — LOOPA con Firebase de punta a punta, sólo en EMULADORES
// (proyecto demo-loopa; nunca la nube):
//
//   node integracion/emulador/correr.cjs --funciones
//
//   · Auth: inicio de sesión real (emulador) de una persona del equipo
//     comercial, otra aprobada pero no comercial, y nadie.
//   · Firestore con las REGLAS EN BORRADOR: lo que la app lee.
//   · Functions: el codebase «loopa» de functions/ tal cual se publicaría
//     (onCall + disparador del outbox).
//   · La app usa _fuente/datos/fuente.js (cola + adaptadorFirebase) y
//     _fuente/datos/fusion.js, como en el navegador.
// ─────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');

const ACTIVO = process.env.LOOPA_FUNCIONES === '1' && process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!ACTIVO && process.env.LOOPA_FUNCIONES === '1') throw new Error('Faltan los emuladores de Firestore/Auth');
const skip = ACTIVO ? false : 'sin emuladores de Functions/Auth (node integracion/emulador/correr.cjs --funciones)';

const LoopaFusion = require('../../_fuente/datos/fusion.js');
const LoopaFuente = require('../../_fuente/datos/fuente.js');
const { sembrarEmulador, COMERCIAL, OTRO, PROJECT } = require('./siembra.cjs');

let admin; let adb; let fb; let seq = 0;
const uuid = () => { seq += 1; return `0f000000-0000-4000-8000-${String(seq).padStart(12, '0')}`; };
const esperar = async (cond, ms = 60000, cada = 250) => {
  const fin = Date.now() + ms;
  for (;;) {
    const r = await cond();
    if (r) return r;
    if (Date.now() > fin) throw new Error('tiempo agotado esperando al emulador');
    await new Promise(res => setTimeout(res, cada));
  }
};

// Las funciones del emulador tardan en cargar la primera vez: se espera a
// que respondan (sin sesión: «unauthenticated») antes de empezar.
async function funcionesListas(ms = 120000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try {
      const r = await fetch('http://127.0.0.1:5001/demo-loopa/us-central1/loopaSaveClient', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"data":{}}' });
      if (r.status !== 404) return;
    } catch (e) { /* todavía no */ }
    await new Promise(res => setTimeout(res, 500));
  }
  throw new Error('Las funciones del emulador no cargaron');
}

async function preparar() {
  if (admin) return;
  await funcionesListas();
  const { app, db } = await sembrarEmulador();
  adb = db;
  admin = app;
  fb = {
    app: require('firebase/app'), auth: require('firebase/auth'), fs: require('firebase/firestore'), fns: require('firebase/functions'),
  };
  fb.fs.setLogLevel('silent');
}

// La app del navegador: una sesión del SDK cliente contra los emuladores.
async function sesion(usuario) {
  const nombre = `cliente-${usuario ? usuario.uid : 'anon'}-${seq += 1}`;
  const app = fb.app.initializeApp({ projectId: PROJECT, apiKey: 'demo-api-key', authDomain: 'demo-loopa.firebaseapp.com' }, nombre);
  const auth = fb.auth.getAuth(app);
  fb.auth.connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  if (usuario) await fb.auth.signInWithEmailAndPassword(auth, usuario.email, usuario.password);
  const db = fb.fs.getFirestore(app);
  const [h, p] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  fb.fs.connectFirestoreEmulator(db, h, Number(p));
  const functions = fb.fns.getFunctions(app, 'us-central1');
  fb.fns.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  const plano = (d) => ({ id: d.id, ...d.data() });
  const api = LoopaFuente.adaptadorFirebase({
    leerDoc: async (c, id) => { const d = await fb.fs.getDoc(fb.fs.doc(db, c, id)); return d.exists() ? plano(d) : null; },
    leerColeccion: async (c) => (await fb.fs.getDocs(fb.fs.collection(db, c))).docs.map(plano),
    consultarIgual: async (c, campo, v) => (await fb.fs.getDocs(fb.fs.query(fb.fs.collection(db, c), fb.fs.where(campo, '==', v)))).docs.map(plano),
    invocar: async (n, data) => (await fb.fns.httpsCallable(functions, n)(data)).data,
    escucharColeccion: (c, cb, err) => fb.fs.onSnapshot(fb.fs.collection(db, c), q => cb(q.docs.map(plano)), err),
  });
  return { app, db, api, cerrar: () => fb.app.deleteApp(app) };
}
const almacen = () => { const m = new Map(); return { leer: k => (m.has(k) ? m.get(k) : null), escribir: (k, v) => m.set(k, v) }; };
const conSaldo = (ventas) => ventas.find(x => x.estado !== 'cancelado' && x.total - x.abonos.reduce((a, b) => a + b.monto, 0) >= 100);

test('leer como el equipo comercial, bajo las reglas en borrador', { skip }, async (t) => {
  await preparar();
  const s = await sesion(COMERCIAL);
  t.after(s.cerrar);
  const d = LoopaFuente.armarDatos(await s.api.leer());
  assert.ok(d.ventas.length >= 6, 'ventas migradas');
  assert.ok(d.clientes.some(c => c.id === 'fc-mig-aurora'));
  assert.ok(!d.clientes.some(c => c.id === 'fc-mig-otro-tablero'), 'sólo fichas de los tableros de producción');
  assert.ok((await adb.doc('frame_clients/fc-mig-otro-tablero').get()).exists, 'existe, pero en otro tablero');
  assert.ok(d.servicios.some(x => x.id === 'SRV-DEMO-REEL' && x.generaProduccion));
});

test('quien no es comercial (o no inició sesión) no lee ventas ni vende', { skip }, async (t) => {
  await preparar();
  for (const u of [OTRO, null]) {
    const s = await sesion(u);
    t.after(s.cerrar);
    const lect = await s.api.leer().catch(e => e);
    assert.equal(LoopaFuente.normalizarError(lect).tipo, 'permission-denied', `leer: ${u ? u.uid : 'sin sesión'}`);
    const err = await s.api.llamar({ fn: 'loopaSaveClient', data: { client: { id: uuid(), nombre: 'X' } } }).catch(e => e);
    assert.equal(LoopaFuente.normalizarError(err).tipo, u ? 'permission-denied' : 'unauthenticated');
  }
});

test('de punta a punta: vender por la cola → funciones → disparador → tarjetas', { skip }, async (t) => {
  await preparar();
  const s = await sesion(COMERCIAL);
  t.after(s.cerrar);
  const antes = LoopaFuente.armarDatos(await s.api.leer());
  const confirmadas = [];
  const cola = LoopaFuente.crearCola({ llamar: s.api.llamar, almacen: almacen(), alConfirmar: (e, r) => confirmadas.push(r) });
  const srv = { id: 'SRV-EMU-NUEVO', nombre: 'Video corto', categoria: 'Video', unidad: 'pieza', modelo: 'unitario', precio: 500, costo: 0, activo: true };
  cola.encolar({ etiqueta: 'servicio', ops: [LoopaFusion.operacionServicio(srv)] });
  const venta = {
    fecha: '2026-11-10', entrega: '2026-11-25', estado: 'pendiente', pay: 'bac', nota: '',
    items: [{ tipoId: 'SRV-DEMO-REEL', precio: 1800, costo: 0, q: 1, descripcion: '' }, { tipoId: srv.id, precio: 500, costo: 0, q: 1, descripcion: '' }],
    subtotal: 2300, descuento: 0, total: 2300, abonos: [],
  };
  const armado = LoopaFusion.operacionesNuevaVenta(venta, { nombre: 'Clienta Emulador', telefono: '9999-1111', canal: 'WhatsApp' }, null, uuid);
  cola.encolar({ etiqueta: 'venta', ops: armado.ops, id: `V-${armado.ventaId}` });
  const st = await cola.procesar();
  assert.equal(st.error, null, st.error && st.error.mensaje);
  const r = confirmadas.at(-1).find(x => x && x.n);
  assert.equal(r.n, Math.max(...antes.ventas.map(v => v.n)) + 1, 'número del servidor');
  // El disparador del outbox genera las tarjetas (asíncrono).
  const tareas = await esperar(async () => {
    const q = await adb.collection('frame_projects').where('sourceSaleId', '==', armado.ventaId).get();
    return q.size ? q.docs : null;
  });
  assert.ok(tareas.length >= 1);
  // En vivo: la pantalla ve el trabajo de producción listo sin recargar.
  let vivo = null;
  const dejar = s.api.escucharVentas(sales => { vivo = sales; });
  const enVivo = await esperar(async () => { const x = vivo && vivo.find(d => d.id === armado.ventaId); return x && x.operations && x.operations.status === 'ready' ? x : null; });
  dejar();
  assert.equal(LoopaFusion.ventaDesdeDoc(enVivo).produccion.tareas, tareas.length);
  const despues = LoopaFuente.armarDatos(await s.api.leer());
  const v = despues.ventas.find(x => x.id === armado.ventaId);
  assert.equal(v.cliente, 'Clienta Emulador');
  await esperar(async () => ((await adb.doc(`loopa_sales/${armado.ventaId}`).get()).data().operations || {}).status === 'ready');
  assert.ok(despues.clientes.some(c => c.id === armado.clienteId), 'la ficha nueva quedó en el tablero de producción');
});

test('cambios, cobros, conflicto y respuesta perdida a través de las funciones', { skip }, async (t) => {
  await preparar();
  const s = await sesion(COMERCIAL);
  t.after(s.cerrar);
  const { ventas } = LoopaFuente.armarDatos(await s.api.leer());
  const v = conSaldo(ventas);
  // Respuesta perdida: el servidor guarda, la app no se entera y reintenta.
  let perder = true;
  const llamar = async (op) => { const res = await s.api.llamar(op); if (perder && op.fn === 'loopaUpdateSale') { perder = false; throw new TypeError('Failed to fetch'); } return res; };
  const cola = LoopaFuente.crearCola({ llamar, almacen: almacen() });
  cola.encolar({ etiqueta: 'estado', ops: LoopaFusion.operacionesCambio(v, { estado: 'revision' }, uuid) });
  cola.encolar({ etiqueta: 'cobro', ops: [LoopaFusion.operacionCobro(v, { id: 'AB-emu', fecha: '2026-11-10', monto: 50, metodo: 'bac' })] });
  cola.encolar({ etiqueta: 'nota', ops: LoopaFusion.operacionesCambio(v, { nota: 'desde el emulador' }, uuid) });
  assert.equal((await cola.procesar()).error.tipo, 'red');
  const st = await cola.reintentar();
  assert.equal(st.error, null, st.error && `${st.error.etiqueta}: ${st.error.mensaje}`);
  const doc = (await adb.doc(`loopa_sales/${v.id}`).get()).data();
  assert.equal(doc.legacyProductionState, 'revision');
  assert.equal(doc.commercial.nota, 'desde el emulador');
  assert.equal(doc.version, v.version + 3, 'cada cambio una sola vez');
  assert.equal(doc.commercial.abonos.find(a => a.id === 'AB-emu').registradoPor, COMERCIAL.uid, 'el autor lo pone el servidor');
  // Conflicto: la versión vieja, sin cadena (otra sesión).
  const otra = LoopaFuente.crearCola({ llamar: s.api.llamar, almacen: almacen() });
  otra.encolar({ etiqueta: 'vieja', ops: LoopaFusion.operacionesCambio(v, { nota: 'pisaría' }, uuid) });
  const c = await otra.procesar();
  assert.equal(c.error.codigo, 'version_conflict');
  assert.equal(c.error.transitorio, false);
  assert.match(c.error.mensaje, /Otra persona/);
});

test('las reglas en borrador: la app no escribe ventas ni catálogo directo', { skip }, async (t) => {
  await preparar();
  const s = await sesion(COMERCIAL);
  t.after(s.cerrar);
  const intento = (p) => p.then(() => 'ok', e => e.code);
  assert.equal(await intento(fb.fs.setDoc(fb.fs.doc(s.db, 'loopa_sales', 'pirata'), { n: 1 })), 'permission-denied');
  assert.equal(await intento(fb.fs.setDoc(fb.fs.doc(s.db, 'loopa_services', 'SRV-PIRATA'), { nombre: 'x' })), 'permission-denied');
  assert.equal(await intento(fb.fs.getDocs(fb.fs.collection(s.db, 'loopa_integration_events'))), 'permission-denied');
});

test('un tablero de producción del que la persona no es miembro: aviso claro', { skip }, async (t) => {
  await preparar();
  const ref = adb.doc('loopa_config/production');
  const antes = (await ref.get()).data();
  await ref.set({ ...antes, allowedWorkspaceIds: [...antes.allowedWorkspaceIds, 'ws-demo-personal'] });
  t.after(() => ref.set(antes));
  const s = await sesion(COMERCIAL);
  t.after(s.cerrar);
  const e = await s.api.leer().catch(x => x);
  assert.equal(LoopaFuente.normalizarError(e).codigo, 'workspace_forbidden');
});

test('quien no es comercial tampoco lee ventas ni catálogo directo (reglas de cada colección)', { skip }, async (t) => {
  await preparar();
  const s = await sesion(OTRO);
  t.after(s.cerrar);
  const intento = (p) => p.then(() => 'ok', e => e.code);
  assert.equal(await intento(fb.fs.getDocs(fb.fs.collection(s.db, 'loopa_sales'))), 'permission-denied');
  assert.equal(await intento(fb.fs.getDocs(fb.fs.collection(s.db, 'loopa_services'))), 'permission-denied');
});

// ── Tanda 3.5: Producción con las tareas del tablero ─────────────
const LoopaProduccion = require('../../_fuente/produccion/nucleo.js');
const LoopaProduccionReal = require('../../_fuente/produccion/datos-reales.js');
const TABLERO = 'ws-loopa-produccion';

// Lo mismo que useFuenteTablero (calendario.jsx), con el SDK modular.
async function leerTablero(s, uid) {
  const g = async (...p) => { const d = await fb.fs.getDoc(fb.fs.doc(s.db, ...p)); return d.exists() ? { id: d.id, ...d.data() } : null; };
  const lista = async (q) => (await fb.fs.getDocs(q)).docs.map(d => ({ ...d.data(), id: d.id }));
  const col = fb.fs.collection(s.db, 'frame_projects');
  return LoopaProduccionReal.armarProduccion({
    workspace: await g('frame_workspaces', TABLERO),
    columnas: await g('frame_workspaces', TABLERO, 'config', 'kanban_columns'),
    rutina: await g('frame_workspaces', TABLERO, 'config', 'daily_routine'),
    yo: { ...(await g('frame_users', uid)), uid },
    clientes: await lista(fb.fs.query(fb.fs.collection(s.db, 'frame_clients'), fb.fs.where('workspaceId', '==', TABLERO))),
    porTablero: await lista(fb.fs.query(col, fb.fs.where('workspaceId', '==', TABLERO))),
    // Como FRAME y el hook: con las reglas v2 esta consulta se rechaza
    // (permission-denied) y se ignora; las tareas entran por el tablero.
    compartidas: await lista(fb.fs.query(col, fb.fs.where('viewerIds', 'array-contains', uid))).catch(e => { if (e.code !== 'permission-denied') throw e; return []; }),
    hoy: LoopaProduccionReal.hoyEnTegucigalpa(),
  });
}
const actualizar = (s, id, p) => fb.fs.updateDoc(fb.fs.doc(s.db, 'frame_projects', id), p).then(() => 'ok', e => e.code);

test('Producción: leer el tablero real bajo las reglas', { skip }, async (t) => {
  await preparar();
  const s = await sesion(COMERCIAL);
  t.after(s.cerrar);
  const d = await leerTablero(s, COMERCIAL.uid);
  assert.equal(d.workspace.name, 'LOOPA · Producción');
  assert.ok(d.columnas.some(c => c.isDone && c.requiresChecklist), 'columnas de FRAME con cierre');
  assert.ok(d.tareas.some(x => x.id === 'manual-con-ficha'));
  assert.ok(d.equipo.some(m => m.id === COMERCIAL.uid && m.name === 'Comercial (prueba)'));
  assert.ok(Array.isArray(d.rutina.tasks));
});

test('Producción: mover, checklist y enlazar se guardan; procedencia y entrega de venta no', { skip }, async (t) => {
  await preparar();
  const s = await sesion(COMERCIAL);
  t.after(s.cerrar);
  let d = await leerTablero(s, COMERCIAL.uid);
  const cambiar = (id, patch) => {
    const antes = LoopaProduccion.normalizeTask(d.tareas.find(x => x.id === id), d.hoy);
    const r = LoopaProduccion.applyTaskPatch(antes, patch, d.columnas);
    assert.equal(r.ok, true, r.error && r.error.message);
    return actualizar(s, id, LoopaProduccionReal.parcheTarea(antes, r.task));
  };
  assert.equal(await cambiar('manual-con-ficha', { status: 'producing' }), 'ok');
  assert.equal(await cambiar('manual-con-ficha', { checklist: [{ id: 'k1', text: 'Grabar', done: true }] }), 'ok');
  // Enlazar la tarea vieja a su ficha: una vez.
  const vieja = LoopaProduccion.normalizeTask(d.tareas.find(x => x.id === 'manual-sin-ficha'), d.hoy);
  const enl = LoopaProduccion.linkTaskToClient(vieja, d.clientes.find(c => c.id === 'fc-mig-aurora'), d.clientes);
  assert.equal(enl.ok, true, enl.error && enl.error.message);
  assert.equal(await actualizar(s, 'manual-sin-ficha', LoopaProduccionReal.parcheEnlace(vieja, enl.task)), 'ok');
  assert.equal(await actualizar(s, 'manual-sin-ficha', { clientId: 'cli_0ba8b10a3885e85e293f72f0' }), 'permission-denied', 'no se re-enlaza');
  d = await leerTablero(s, COMERCIAL.uid);
  assert.equal(d.tareas.find(x => x.id === 'manual-con-ficha').status, 'producing');
  assert.equal(d.tareas.find(x => x.id === 'manual-sin-ficha').clientId, 'fc-mig-aurora');
  // Una tarea de venta: si todavía no hay, se vende una (prueba independiente).
  if (!d.tareas.some(x => x.sourceSystem === 'loopa')) {
    const cli = (await s.api.leer()).clients.find(c => c.id === 'fc-mig-aurora');
    const nv = LoopaFusion.operacionesNuevaVenta({ fecha: '2026-11-10', entrega: '2026-11-25', estado: 'pendiente', items: [{ tipoId: 'SRV-DEMO-REEL', precio: 1800, costo: 0, q: 1 }], subtotal: 1800, total: 1800, abonos: [] }, { nombre: cli.name }, cli.id, uuid);
    for (const op of nv.ops) await s.api.llamar(op);
    await esperar(async () => (await adb.collection('frame_projects').where('sourceSaleId', '==', nv.ventaId).get()).size > 0);
    d = await leerTablero(s, COMERCIAL.uid);
  }
  const deVenta = d.tareas.find(x => x.sourceSystem === 'loopa');
  assert.ok(deVenta, 'hay tareas generadas por ventas');
  assert.equal(await cambiar(deVenta.id, { status: 'producing' }), 'ok', 'el estado sí se mueve');
  assert.equal(await actualizar(s, deVenta.id, { deadline: '2027-01-01' }), 'permission-denied', 'la entrega la fija la venta');
  assert.equal(await actualizar(s, deVenta.id, { sourceSaleId: 'otra' }), 'permission-denied', 'procedencia');
  assert.equal(await fb.fs.deleteDoc(fb.fs.doc(s.db, 'frame_projects', deVenta.id)).then(() => 'ok', e => e.code), 'permission-denied', 'no se borra (se archiva)');
});

test('Producción: el historial de la tarea acepta el evento de quien edita (como FRAME)', { skip }, async (t) => {
  await preparar();
  const s = await sesion(COMERCIAL);
  t.after(s.cerrar);
  const ev = { id: 'a-prueba-1', actorId: COMERCIAL.uid, actorName: 'Comercial (prueba)', summary: 'cambió el estado a En producción', at: new Date().toISOString() };
  const ok = await fb.fs.setDoc(fb.fs.doc(s.db, 'frame_projects', 'manual-con-ficha', 'activity', ev.id), ev).then(() => 'ok', e => e.code);
  assert.equal(ok, 'ok');
  const falso = await fb.fs.setDoc(fb.fs.doc(s.db, 'frame_projects', 'manual-con-ficha', 'activity', 'a-prueba-2'), { ...ev, id: 'a-prueba-2', actorId: OTRO.uid }).then(() => 'ok', e => e.code);
  assert.equal(falso, 'permission-denied', 'no a nombre de otra persona');
});

test('Producción: alguien del tablero que NO es comercial usa Producción, pero no ve ventas', { skip }, async (t) => {
  await preparar();
  const s = await sesion(OTRO);
  t.after(s.cerrar);
  const d = await leerTablero(s, OTRO.uid);
  assert.ok(d.tareas.length > 0, 've las tareas del tablero');
  const cfg = await fb.fs.getDoc(fb.fs.doc(s.db, 'loopa_config', 'production')).then(x => x.exists(), e => e.code);
  assert.equal(cfg, true, 'lee qué tablero es el de producción');
  const ventas = await fb.fs.getDocs(fb.fs.collection(s.db, 'loopa_sales')).then(() => 'ok', e => e.code);
  assert.equal(ventas, 'permission-denied', 'las ventas siguen siendo del equipo comercial');
});
