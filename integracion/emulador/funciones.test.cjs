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

async function preparar() {
  if (admin) return;
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
