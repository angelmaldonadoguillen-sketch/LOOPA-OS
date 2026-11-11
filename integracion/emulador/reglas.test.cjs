'use strict';
// ─────────────────────────────────────────────────────────────────
// Tanda 2.7 — el BORRADOR de reglas (integracion/reglas/firestore.rules.borrador)
// contra el emulador local, con usuarios de ejemplo. Nada de esto toca las
// reglas activas de frame-studio-3a18f.
//
//   node integracion/emulador/correr.cjs
//
// Cada prueba arranca de un emulador limpio (clearFirestore sólo borra los
// datos del EMULADOR, proyecto demo-*) y siembra lo suyo sin reglas.
// ─────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMU && process.env.REQUIRE_EMULATOR === '1') throw new Error('REQUIRE_EMULATOR=1 sin FIRESTORE_EMULATOR_HOST');
const skip = EMU ? false : 'sin emulador de Firestore (node integracion/emulador/correr.cjs)';

const RULES = path.join(__dirname, '..', 'reglas', 'firestore.rules.borrador');
const PROJECT = 'demo-loopa-reglas';

let env;
let fsMod;
async function setup() {
  if (env) return;
  const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
  fsMod = require('firebase/firestore');
  // Cada rechazo esperado se loguea como error del SDK: ruido, no fallas.
  fsMod.setLogLevel('silent');
  const [host, port] = EMU.split(':');
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: fs.readFileSync(RULES, 'utf8'), host, port: Number(port) } });
}

const SALE_TASK = {
  id: 'tSale', title: 'Café Aurora · Reels', client: 'Café Aurora', clientId: 'c1', status: 'briefing',
  sessionDate: '2026-11-18', deadline: '2026-11-20', checklist: [{ id: 'k1', text: 'Grabar', done: false }],
  workspaceId: 'ws1', workspaceIds: ['ws1'], viewerIds: ['u1', 'u2'],
  sourceSystem: 'loopa', sourceSaleId: 's1', sourceSaleNumber: 1042, sourceSaleStatus: 'confirmed',
  sourceLineIds: ['l1'], sourceEventId: 'e1', idempotencyKey: 'k-1', clientVisible: false,
  sourceTemplateVersions: { 'SRV-1': 1 }, sourceWorkItems: ['w1'], integration: { generatedFingerprint: 'f1' },
};
// Los 10 campos de procedencia (provenanceKeys en el borrador).
const PROVENANCE = ['sourceSystem', 'sourceSaleId', 'sourceSaleNumber', 'sourceSaleStatus', 'sourceLineIds',
  'sourceEventId', 'sourceTemplateVersions', 'sourceWorkItems', 'idempotencyKey', 'integration'];
const MANUAL_TASK = {
  id: 'tManual', title: 'Ordenar archivo', client: 'LOOPA (interno)', status: 'briefing', sessionDate: '2026-11-19', deadline: '2026-11-21',
  checklist: [], workspaceId: 'ws1', workspaceIds: ['ws1'], viewerIds: ['u1', 'u2'],
};
const LEGACY_TASK = {
  id: 'tLegacy', title: 'Sesión vieja', client: 'Café Aurora', status: 'producing', sessionDate: '2026-10-01', deadline: '2026-10-05',
  checklist: [], workspaceId: 'ws1',
};

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (c, id, d) => fsMod.setDoc(fsMod.doc(db, c, id), d);
    await put('frame_users', 'u1', { status: 'active', name: 'Comercial' });
    await put('frame_users', 'u2', { status: 'active', name: 'Producción' });
    await put('frame_users', 'u3', { status: 'active', name: 'Otro tablero' });
    await put('frame_users', 'adm', { status: 'active', platformAdmin: true });
    await put('frame_users', 'pend', { status: 'pending' });
    await put('frame_users', 'rej', { status: 'rejected' });
    await put('frame_users', 'u5', { status: 'active', name: 'En los dos tableros' });
    await put('frame_workspaces', 'ws1', { name: 'LOOPA · Producción', ownerId: 'u1', memberIds: ['u1', 'u2', 'pend', 'u5'] });
    await put('frame_workspaces', 'ws2', { name: 'Otro', ownerId: 'u3', memberIds: ['u3', 'u5'] });
    await put('frame_clients', 'c1', { id: 'c1', name: 'Café Aurora', workspaceId: 'ws1' });
    await put('frame_clients', 'c2', { id: 'c2', name: 'Café Aurora', workspaceId: 'ws2' });
    await put('frame_clients', 'cm', { id: 'cm', name: 'Ferretería Norte', workspaceId: 'ws1', commercial: { nombreLoopa: 'Ferretería Norte', telefono: '9999-0000' }, legacyLoopaIds: ['CL-1'] });
    // Ficha creada después de la migración, con ventas nuevas (createSale la marcó).
    await put('frame_clients', 'cs', { id: 'cs', name: 'Estudio Lienzo', workspaceId: 'ws1', hasSales: true });
    // Ficha vieja de FRAME sin campo id.
    await put('frame_clients', 'cold', { name: 'Cliente viejo', workspaceId: 'ws1' });
    await put('frame_projects', 'tSale', SALE_TASK);
    await put('frame_projects', 'tManual', MANUAL_TASK);
    await put('frame_projects', 'tLegacy', LEGACY_TASK);
    await put('loopa_sales', 's1', { id: 's1', n: 1042, status: 'confirmed', commercial: { total: 9000 } });
    // pend y rej están en la lista a propósito: sin aprobación no alcanza.
    await put('loopa_config', 'access', { commercialUids: ['u1', 'pend', 'rej'] });
    await put('loopa_config', 'otro', { secreto: true });
    await put('loopa_config', 'production', { defaultWorkspaceId: 'ws1', allowedWorkspaceIds: ['ws1'] });
    // Tanda 3.8: configuración comercial y un gasto migrados.
    await put('loopa_config', 'main', { payConfig: [], categorias: ['Redes'], canales: [], gastoTipos: ['Software'], moneda: 'L', migration: { hash: 'h-main' } });
    await put('loopa_expenses', 'GV-1', { id: 'GV-1', kind: 'variable', fecha: '2026-11-01', concepto: 'Hosting', categoria: 'Software', monto: 500, nota: '', legacyId: 'GV-1', migration: { hash: 'h-gv1' } });
    await put('loopa_integration_events', 'e1', { eventId: 'e1', status: 'done' });
    await put('loopa_counters', 'sales', { next: 1043 });
    await put('loopa_migrations', 'run-a', { status: 'done' });
    await put('loopa_services', 'SRV-1', { id: 'SRV-1', nombre: 'Reel', precio: 1500, executionPlan: null });
    await put('frame_clients', 'cl-audit', { id: 'cl-audit', name: 'Con auditoría', workspaceId: 'ws1', createdBy: 'u1' });
  });
}

const as = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const ref = (db, c, id) => fsMod.doc(db, c, id);
const ok = async (p, msg) => { const { assertSucceeds } = require('@firebase/rules-unit-testing'); await assertSucceeds(p).catch(e => { throw new Error(`${msg}: ${e.message}`); }); };
const no = async (p, msg) => { const { assertFails } = require('@firebase/rules-unit-testing'); await assertFails(p).catch(e => { throw new Error(`${msg}: debía rechazarse (${e.message})`); }); };

test.before(async () => { if (!skip) await setup(); });
test.after(async () => { if (env) await env.cleanup(); });
test.beforeEach(async () => { if (!skip) await seed(); });

test('tareas compartidas: la consulta por viewerIds se permite (y sólo la propia)', { skip }, async () => {
  // Una tarea de ws1 que también se ve en ws2: u3 (sólo ws2) la tiene que
  // poder listar con la consulta de la app (viewerIds array-contains uid).
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fsMod.setDoc(fsMod.doc(ctx.firestore(), 'frame_projects', 'tShared'), {
      ...MANUAL_TASK, id: 'tShared', workspaceIds: ['ws1', 'ws2'], viewerIds: ['u1', 'u2', 'u3', 'u5'],
    });
  });
  const compartidas = (uid, de = uid) => fsMod.getDocs(fsMod.query(fsMod.collection(as(uid), 'frame_projects'), fsMod.where('viewerIds', 'array-contains', de)));
  await ok(compartidas('u3'), 'u3 lista sus tareas compartidas');
  const snap = await compartidas('u3');
  assert.deepEqual(snap.docs.map(d => d.id), ['tShared']);
  await ok(compartidas('u1'), 'u1 lista sus tareas compartidas');
  // Nadie lista las de otro, ni sin aprobación.
  await no(compartidas('u3', 'u1'), 'u3 no lista las de u1');
  await no(compartidas('pend'), 'una cuenta pendiente no lista');
  // Leer una por una sigue igual: u3 la ve; quien no está, no.
  await ok(fsMod.getDoc(ref(as('u3'), 'frame_projects', 'tShared')), 'u3 lee la compartida');
  await no(fsMod.getDoc(ref(as('u3'), 'frame_projects', 'tManual')), 'u3 no lee una de ws1 que no le compartieron');
  await ok(fsMod.getDoc(ref(as('u2'), 'frame_projects', 'tLegacy')), 'una tarea vieja (sin viewerIds) se lee por el tablero');
});

test('ventas: sólo el equipo comercial lee; nadie escribe desde el navegador', { skip }, async () => {
  const s = (uid) => ref(as(uid), 'loopa_sales', 's1');
  await ok(fsMod.getDoc(s('u1')), 'comercial lee');
  await no(fsMod.getDoc(s('u2')), 'producción no ve montos');
  await no(fsMod.getDoc(s('u3')), 'otro tablero');
  await no(fsMod.getDoc(s(null)), 'sin sesión');
  await no(fsMod.getDoc(s('adm')), 'el admin no es comercial por serlo');
  // pend y rej ESTÁN en commercialUids: sin aprobación de plataforma no alcanza.
  await no(fsMod.getDoc(s('pend')), 'un usuario pendiente nunca, aunque esté en la lista');
  await no(fsMod.getDoc(s('rej')), 'uno rechazado tampoco');
  await no(fsMod.updateDoc(s('u1'), { status: 'cancelled' }), 'editar: sólo el servidor (D9)');
  await no(fsMod.setDoc(ref(as('u1'), 'loopa_sales', 's2'), { id: 's2', n: 1043 }), 'crear: sólo el servidor (D9)');
  await no(fsMod.deleteDoc(s('u1')), 'borrar');
});

test('outbox, correlativo y migraciones: cerrados a todos los clientes', { skip }, async () => {
  for (const [c, id] of [['loopa_integration_events', 'e1'], ['loopa_counters', 'sales'], ['loopa_migrations', 'run-a']]) {
    for (const uid of ['u1', 'adm']) {
      const db = as(uid);
      await no(fsMod.getDoc(ref(db, c, id)), `${uid} lee ${c}`);
      await no(fsMod.updateDoc(ref(db, c, id), { x: 1 }), `${uid} edita ${c}`);
      await no(fsMod.setDoc(ref(db, c, 'nuevo'), { x: 1 }), `${uid} crea en ${c}`);
    }
  }
  await no(fsMod.updateDoc(ref(as('u1'), 'loopa_counters', 'sales'), { next: 1 }), 'nadie reinicia el correlativo');
});

test('quién es comercial lo decide sólo el admin de plataforma', { skip }, async () => {
  await ok(fsMod.setDoc(ref(as('adm'), 'loopa_config', 'access'), { commercialUids: ['u1', 'u2'] }), 'admin agrega');
  await ok(fsMod.getDoc(ref(as('u1'), 'loopa_config', 'access')), 'comercial ve la lista');
  await no(fsMod.setDoc(ref(as('u1'), 'loopa_config', 'access'), { commercialUids: ['u1', 'u3'] }), 'un comercial no se suma gente');
  await no(fsMod.getDoc(ref(as('u3'), 'loopa_config', 'access')), 'otro tablero');
  await no(fsMod.setDoc(ref(as('adm'), 'loopa_config', 'access'), { commercialUids: 'u3' }), 'forma inválida');
  await no(fsMod.setDoc(ref(as('adm'), 'loopa_config', 'access'), { commercialUids: ['u1'], extra: true }), 'campos extra');
  await no(fsMod.deleteDoc(ref(as('adm'), 'loopa_config', 'access')), 'no se borra');
  await no(fsMod.getDoc(ref(as('u1'), 'loopa_config', 'otro')), 'un comercial sólo ve la lista, no otra configuración');
  await ok(fsMod.getDoc(ref(as('u1'), 'loopa_config', 'production')), 'comercial ve qué tableros son de producción');
  await no(fsMod.getDoc(ref(as('u3'), 'loopa_config', 'production')), 'ni comercial ni del tablero: no');
  await ok(fsMod.getDoc(ref(as('u5'), 'loopa_config', 'production')), 'miembro del tablero de producción (no comercial): sí, para Producción');
  await no(fsMod.getDoc(ref(as('u5'), 'loopa_config', 'access')), 'pero no la lista comercial');
  await no(fsMod.getDoc(ref(as('pend'), 'loopa_config', 'production')), 'miembro pendiente: no');
  await ok(fsMod.setDoc(ref(as('adm'), 'loopa_config', 'production'), { defaultWorkspaceId: 'ws1', allowedWorkspaceIds: ['ws1'] }), 'admin configura tableros');
  await no(fsMod.setDoc(ref(as('adm'), 'loopa_config', 'production'), { defaultWorkspaceId: 'ws1', allowedWorkspaceIds: ['ws1'], secreto: 'x' }), 'production no lleva otros campos (lo lee el equipo comercial)');
  await no(fsMod.setDoc(ref(as('u1'), 'loopa_config', 'production'), { defaultWorkspaceId: 'ws1', allowedWorkspaceIds: ['ws1', 'ws9'] }), 'un comercial no cambia tableros');
});

test('tarea de una venta: el equipo la trabaja, pero no toca procedencia, entrega ni la borra', { skip }, async () => {
  const t = ref(as('u2'), 'frame_projects', 'tSale');
  await ok(fsMod.updateDoc(t, { status: 'producing', checklist: [{ id: 'k1', text: 'Grabar', done: true }] }), 'avance');
  await ok(fsMod.updateDoc(t, { sessionDate: '2026-11-19' }), 'reprogramar mueve el día de trabajo');
  await ok(fsMod.updateDoc(t, { clientVisible: true }), 'compartir con el cliente');
  await no(fsMod.updateDoc(t, { deadline: '2026-11-30' }), 'la entrega la fija la venta');
  await no(fsMod.updateDoc(t, { deadline: '2026-11-25', sessionDate: '2026-11-25' }), 'si trabajo y entrega eran distintas, no se junta');
  for (const k of PROVENANCE) {
    await no(fsMod.updateDoc(t, { [k]: 'x' }), `procedencia ${k}`);
    await no(fsMod.updateDoc(t, { [k]: fsMod.deleteField() }), `quitar ${k}`);
  }
  await no(fsMod.updateDoc(t, { 'integration.generatedFingerprint': 'otra' }), 'ni por ruta anidada');
  await no(fsMod.updateDoc(t, { id: 'otro' }), 'el campo id no cambia');
  await no(fsMod.updateDoc(t, { clientId: 'cm' }), 'clientId no cambia');
  await no(fsMod.deleteDoc(t), 'cancelar nunca borra: se archiva (D14)');
  await ok(fsMod.updateDoc(t, { status: 'archived' }), 'archivar sí');
  await no(fsMod.getDoc(ref(as('u3'), 'frame_projects', 'tSale')), 'otro tablero no la ve (FRAME)');
});

test('tarjeta de venta día por día: trabajo y entrega se mueven sólo juntas', { skip }, async () => {
  const admin = (ctx) => fsMod.setDoc(fsMod.doc(ctx.firestore(), 'frame_projects', 'tFicha'), { ...SALE_TASK, id: 'tFicha', sessionDate: '2026-11-18', deadline: '2026-11-18' });
  await env.withSecurityRulesDisabled(admin);
  const t = ref(as('u2'), 'frame_projects', 'tFicha');
  await no(fsMod.updateDoc(t, { deadline: '2026-11-20' }), 'la entrega sola no');
  await ok(fsMod.updateDoc(t, { sessionDate: '2026-11-20', deadline: '2026-11-20' }), 'las dos juntas sí');
  await no(fsMod.updateDoc(t, { sessionDate: '2026-11-22', deadline: '2026-11-25' }), 'a días distintos no');
});

test('muro de la tarea: lo trabaja quien tiene acceso; nadie más', { skip }, async () => {
  const nodo = { id: 'n1', clase: 'nodo', tipo: 'nota', titulo: 'Idea', x: 0, y: 0, w: 280, datos: { texto: 'hola', color: '' } };
  const d = (u, tarea, id = 'n1') => fsMod.doc(as(u), 'frame_projects', tarea, 'muro', id);
  await ok(fsMod.setDoc(d('u2', 'tSale'), nodo), 'el equipo escribe, también en tarjetas de venta');
  await ok(fsMod.getDoc(d('u1', 'tSale')), 'el equipo lee');
  await ok(fsMod.setDoc(d('u2', 'tSale'), { ...nodo, x: 40 }), 'y actualiza');
  await no(fsMod.getDoc(d('u3', 'tSale')), 'otro tablero no lee');
  await no(fsMod.setDoc(d('u3', 'tSale', 'n9'), { ...nodo, id: 'n9' }), 'otro tablero no escribe');
  await no(fsMod.deleteDoc(d('u3', 'tSale')), 'otro tablero no borra');
  await no(fsMod.setDoc(d('u2', 'tSale', 'n2'), nodo), 'el id tiene que coincidir');
  await no(fsMod.setDoc(d('u2', 'tSale', 'n3'), { ...nodo, id: 'n3', clase: 'otra' }), 'clase conocida');
  await no(fsMod.setDoc(d('u2', 'tSale', 'n4'), { ...nodo, id: 'n4', viewerIds: ['x'] }), 'sin campos extraños');
  await ok(fsMod.setDoc(d('u2', 'tSale', 'c_a__b'), { id: 'c_a__b', clase: 'conexion', a: 'a', b: 'b' }), 'conexiones');
  await ok(fsMod.deleteDoc(d('u2', 'tSale')), 'el equipo borra');
});

// Punto A0: las reglas activas traían un cambio de FRAME (2026-10-15) que no
// estaba en el repo: edita la membresía de HOY, no la foto de viewerIds. u5
// entró a ws1 pero no figura en viewerIds de las tareas.
test('quien entró después al tablero edita, con los límites de LOOPA', { skip }, async () => {
  const t = ref(as('u5'), 'frame_projects', 'tSale');
  await ok(fsMod.updateDoc(t, { checklist: [{ id: 'k1', text: 'Grabar', done: true }] }), 'miembro de hoy edita el contenido');
  await no(fsMod.updateDoc(t, { deadline: '2026-11-30' }), 'pero la entrega de la venta no');
  await no(fsMod.updateDoc(t, { sourceSaleStatus: 'cancelled' }), 'ni la procedencia');
  await no(fsMod.updateDoc(t, { viewerIds: ['u5'] }), 'el contenido no cambia la ACL');
  await ok(fsMod.updateDoc(ref(as('u5'), 'frame_projects', 'tManual'), { deadline: '2026-11-26' }), 'en una manual, la entrega sí');
  await ok(fsMod.updateDoc(ref(as('u5'), 'frame_projects', 'tLegacy'), { status: 'done' }), 'tarea vieja sin workspaceIds: por su tablero');
  await no(fsMod.updateDoc(ref(as('u3'), 'frame_projects', 'tManual'), { title: 'x' }), 'de otro tablero, no');
  await no(fsMod.updateDoc(ref(as('pend'), 'frame_projects', 'tManual'), { title: 'x' }), 'miembro pendiente, no');
});

test('tarea manual: reglas de FRAME intactas (entrega editable, se puede borrar)', { skip }, async () => {
  const t = ref(as('u2'), 'frame_projects', 'tManual');
  await ok(fsMod.updateDoc(t, { deadline: '2026-11-25' }), 'entrega editable');
  await no(fsMod.updateDoc(t, { sourceSystem: 'loopa' }), 'no se disfraza de tarea de venta');
  await ok(fsMod.deleteDoc(t), 'borrar una manual');
});

test('crear tareas: nunca con procedencia de venta; clientId sólo de una ficha del tablero', { skip }, async () => {
  const db = as('u1');
  const base = { title: 'Nueva', status: 'briefing', checklist: [], workspaceId: 'ws1', workspaceIds: ['ws1'], viewerIds: ['u1', 'u2', 'pend', 'u5'] };
  await ok(fsMod.setDoc(ref(db, 'frame_projects', 'n1'), base), 'tarea normal');
  await ok(fsMod.setDoc(ref(db, 'frame_projects', 'n2'), { ...base, clientId: 'c1' }), 'con ficha del tablero');
  await no(fsMod.setDoc(ref(db, 'frame_projects', 'n3'), { ...base, sourceSystem: 'loopa', sourceSaleId: 's1' }), 'fabricar tarea de venta');
  await no(fsMod.setDoc(ref(db, 'frame_projects', 'n4'), { ...base, idempotencyKey: 'k-1' }), 'clave de idempotencia');
  await no(fsMod.setDoc(ref(db, 'frame_projects', 'n5'), { ...base, clientId: 'c2' }), 'ficha de otro tablero');
  await no(fsMod.setDoc(ref(db, 'frame_projects', 'n6'), { ...base, clientId: 'no-existe' }), 'ficha inexistente');
  for (const k of PROVENANCE) await no(fsMod.setDoc(ref(db, 'frame_projects', `p-${k}`), { ...base, [k]: 'x' }), `crear con ${k}`);
  await no(fsMod.setDoc(ref(db, 'frame_projects', 'loopa_abc123'), base), 'los ids loopa_* son del servidor');
  await no(fsMod.setDoc(ref(db, 'frame_projects', 'n7'), { ...base, id: 'otro' }), 'id distinto del documento');
  await ok(fsMod.setDoc(ref(db, 'frame_projects', 'n8'), { ...base, id: 'n8' }), 'id igual al documento');
});

test('enlazar una tarea vieja a su ficha: una vez y sólo a una ficha del mismo tablero', { skip }, async () => {
  const t = ref(as('u2'), 'frame_projects', 'tLegacy');
  await no(fsMod.updateDoc(t, { clientId: 'c2' }), 'ficha de otro tablero');
  await no(fsMod.updateDoc(t, { clientId: 'no-existe' }), 'ficha inexistente');
  await no(fsMod.updateDoc(t, { clientId: '' }), 'vacío');
  await ok(fsMod.updateDoc(t, { clientId: 'c1' }), 'enlazar');
  await no(fsMod.updateDoc(t, { clientId: 'cm' }), 'después no cambia');
  await no(fsMod.updateDoc(t, { clientId: fsMod.deleteField() }), 'ni se quita');
});

test('fichas de cliente: lo comercial lo escribe el servidor; con historial no se borran', { skip }, async () => {
  const db = as('u2');
  await ok(fsMod.updateDoc(ref(db, 'frame_clients', 'cm'), { name: 'Ferretería Norte S.A.', notes: 'ok' }), 'editar la ficha');
  await no(fsMod.updateDoc(ref(db, 'frame_clients', 'cm'), { commercial: { telefono: '0000' } }), 'datos comerciales');
  await no(fsMod.updateDoc(ref(db, 'frame_clients', 'cm'), { legacyLoopaIds: [] }), 'vínculo con LOOPA');
  await no(fsMod.updateDoc(ref(db, 'frame_clients', 'cm'), { commercial: fsMod.deleteField() }), 'quitar lo comercial');
  await no(fsMod.deleteDoc(ref(db, 'frame_clients', 'cm')), 'con historial comercial no se borra');
  await ok(fsMod.deleteDoc(ref(db, 'frame_clients', 'c1')), 'una ficha sin historial sí (FRAME)');
  // u5 es miembro de los dos tableros: el rechazo es por la regla de LOOPA,
  // no porque no pertenezca al tablero destino.
  await no(fsMod.updateDoc(ref(as('u5'), 'frame_clients', 'cm'), { workspaceId: 'ws2' }), 'no se muda de tablero');
  await no(fsMod.updateDoc(ref(as('u5'), 'frame_clients', 'c1'), { workspaceId: 'ws2' }), 'ni una ficha sin historial');
  await no(fsMod.updateDoc(ref(db, 'frame_clients', 'cm'), { id: 'otro' }), 'el id no cambia');
  await ok(fsMod.updateDoc(ref(db, 'frame_clients', 'cold'), { id: 'cold', notes: 'x' }), 'una ficha vieja sin id puede recibir el suyo (set de FRAME)');
  // Ficha con ventas nuevas (hasSales): igual de protegida que una migrada.
  await no(fsMod.deleteDoc(ref(db, 'frame_clients', 'cs')), 'con ventas nuevas no se borra');
  await no(fsMod.updateDoc(ref(db, 'frame_clients', 'cs'), { hasSales: false }), 'la marca de ventas es del servidor');
  await no(fsMod.updateDoc(ref(db, 'frame_clients', 'cs'), { hasSales: fsMod.deleteField() }), 'ni se quita');
  await no(fsMod.setDoc(ref(db, 'frame_clients', 'cw'), { id: 'cw', name: 'W', workspaceId: 'ws1', hasSales: true }), 'ni se crea marcada');
  await ok(fsMod.updateDoc(ref(db, 'frame_clients', 'cs'), { notes: 'editable' }), 'el resto de la ficha sí');
  await no(fsMod.setDoc(ref(db, 'frame_clients', 'cx'), { id: 'cx', name: 'X', workspaceId: 'ws1', commercial: {} }), 'crear con datos comerciales');
  await no(fsMod.setDoc(ref(db, 'frame_clients', 'cy'), { id: 'otro', name: 'Y', workspaceId: 'ws1' }), 'id distinto del documento');
  await ok(fsMod.setDoc(ref(db, 'frame_clients', 'cz'), { id: 'cz', name: 'Z', workspaceId: 'ws1' }), 'crear una ficha normal');
  // FRAME guarda la ficha completa con set(): si conserva lo comercial tal cual, vale.
  let cur;
  await env.withSecurityRulesDisabled(async (ctx) => { cur = (await fsMod.getDoc(ref(ctx.firestore(), 'frame_clients', 'cm'))).data(); });
  await ok(fsMod.setDoc(ref(db, 'frame_clients', 'cm'), { ...cur, notes: 'set completo' }), 'set completo que conserva lo comercial');
  const { commercial, ...sinComercial } = cur;
  await no(fsMod.setDoc(ref(db, 'frame_clients', 'cm'), sinComercial), 'set que pierde lo comercial');
});

test('catálogo: el equipo comercial lo lee; nadie lo escribe desde el navegador', { skip }, async () => {
  await ok(fsMod.getDoc(ref(as('u1'), 'loopa_services', 'SRV-1')), 'comercial lee');
  await no(fsMod.getDoc(ref(as('u2'), 'loopa_services', 'SRV-1')), 'producción no ve precios');
  await no(fsMod.updateDoc(ref(as('u1'), 'loopa_services', 'SRV-1'), { precio: 1 }), 'precio: sólo el servidor');
  await no(fsMod.updateDoc(ref(as('u1'), 'loopa_services', 'SRV-1'), { executionPlan: { enabled: true } }), 'plantilla: nunca desde el navegador');
  await no(fsMod.setDoc(ref(as('u1'), 'loopa_services', 'SRV-2'), { id: 'SRV-2' }), 'crear: sólo el servidor');
});

test('auditoría de fichas: quién creó o editó lo escribe sólo el servidor', { skip }, async () => {
  const db = as('u2');
  await no(fsMod.updateDoc(ref(db, 'frame_clients', 'cl-audit'), { createdBy: 'u2' }), 'no se reescribe quién creó');
  await no(fsMod.updateDoc(ref(db, 'frame_clients', 'cl-audit'), { updatedBy: 'u2' }), 'ni quién editó');
  await no(fsMod.setDoc(ref(db, 'frame_clients', 'cl-nuevo'), { id: 'cl-nuevo', name: 'N', workspaceId: 'ws1', createdBy: 'u2' }), 'ni se crea con autor falso');
  await ok(fsMod.updateDoc(ref(db, 'frame_clients', 'cl-audit'), { notes: 'ok' }), 'el resto de la ficha sí');
});

test('FRAME sigue creando y editando fichas con su forma real (createdAt incluido)', { skip }, async () => {
  const db = as('u2');
  // Forma exacta de clients.jsx (Nuevo cliente) después de stampWs.
  const frame = { id: 'cl1731300000abc', name: 'Cliente FRAME', industry: 'Sin categoría', color: 'var(--resource-blue)', initials: 'CF',
    contact: { name: '—', email: '—', phone: '—' }, tags: [], notes: '', createdAt: '2026-11-10', workspaceId: 'ws1' };
  await ok(fsMod.setDoc(ref(db, 'frame_clients', frame.id), frame), 'FRAME crea su ficha');
  await ok(fsMod.setDoc(ref(db, 'frame_clients', frame.id), { ...frame, notes: 'editada' }), 'FRAME la edita con set completo');
  await no(fsMod.setDoc(ref(db, 'frame_clients', frame.id), { ...frame, createdAt: '2020-01-01' }), 'createdAt no se reescribe');
  await no(fsMod.setDoc(ref(db, 'frame_clients', 'cl-otra'), { ...frame, id: 'cl-otra', createdBy: 'u1' }), 'el autor lo pone sólo el servidor');
});

// ── Tanda 3.6: la app de FRAME con sus ajustes (loopa-fusion.js de FRAME) ──
// Los patrones de escritura de FRAME, armados con las MISMAS funciones que
// usa FRAME, contra el borrador. Sin el repo de FRAME se saltea (con
// REQUIRE_FRAME=1, falla).
// Fase 4: el código de Producción (antes FRAME) vive en _fuente/estudio.
const FRAME_REPO = process.env.FRAME_REPO || path.join(__dirname, '..', '..', '_fuente', 'estudio');
const frameFusion = fs.existsSync(path.join(FRAME_REPO, 'loopa-fusion.js')) ? require(path.join(FRAME_REPO, 'loopa-fusion.js')) : null;
if (!frameFusion && process.env.REQUIRE_FRAME === '1' && EMU) throw new Error(`REQUIRE_FRAME=1 y no está loopa-fusion.js en ${FRAME_REPO}`);
const skipFrame = skip || (frameFusion ? false : 'sin el repo de FRAME (FRAME_REPO)');

test('FRAME 3.6: borrar va en un lote — una tarea manual se va a la papelera; una de venta, no (y no deja fantasma)', { skip: skipFrame }, async () => {
  const db = as('u2');
  // Manual: papelera + borrado juntos.
  const b1 = fsMod.writeBatch(db);
  b1.set(ref(db, 'frame_trash', 'tManual'), { ...MANUAL_TASK, deletedAt: '2026-11-10T00:00:00Z' });
  b1.delete(ref(db, 'frame_projects', 'tManual'));
  await ok(b1.commit(), 'manual: papelera y borrado');
  // De venta: el lote entero se rechaza, sin copia en la papelera.
  const b2 = fsMod.writeBatch(db);
  b2.set(ref(db, 'frame_trash', 'tSale'), { ...SALE_TASK, deletedAt: '2026-11-10T00:00:00Z' });
  b2.delete(ref(db, 'frame_projects', 'tSale'));
  await no(b2.commit(), 'de venta: no se borra');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fantasma = await fsMod.getDoc(fsMod.doc(ctx.firestore(), 'frame_trash', 'tSale'));
    assert.equal(fantasma.exists(), false, 'sin copia fantasma');
  });
  // Lo que hace FRAME en su lugar: archivarla.
  assert.equal(frameFusion.isFromSale(SALE_TASK), true);
  await ok(fsMod.updateDoc(ref(db, 'frame_projects', 'tSale'), { status: 'archived' }), 'archivar la de venta');
});

test('FRAME 3.6: duplicar una tarea de venta da una manual (con procedencia se rechazaría)', { skip: skipFrame }, async () => {
  const db = as('u2');
  const copia = frameFusion.duplicateOf(SALE_TASK, { newId: 'pCopia1', wsId: 'ws1', viewerIds: ['u1', 'u2', 'pend', 'u5'], now: '2026-11-10T00:00:00Z', clientIdsInTarget: ['c1'] });
  await ok(fsMod.setDoc(ref(db, 'frame_projects', 'pCopia1'), copia), 'copia manual con su ficha');
  await no(fsMod.setDoc(ref(db, 'frame_projects', 'pCopia2'), { ...SALE_TASK, id: 'pCopia2', title: 'x (copia)' }), 'copia con procedencia (lo que hacía FRAME)');
  // A otro tablero: sin la ficha de ws1.
  const otra = frameFusion.duplicateOf(SALE_TASK, { newId: 'pCopia3', wsId: 'ws2', viewerIds: ['u3', 'u5'], now: 'x', clientIdsInTarget: [] });
  await ok(fsMod.setDoc(ref(as('u5'), 'frame_projects', 'pCopia3'), otra), 'copia en otro tablero, sin ficha ajena');
});

test('FRAME 3.6: restaurar de la papelera una tarea cuya ficha se borró: vuelve sin ficha', { skip: skipFrame }, async () => {
  const db = as('u2');
  const guardada = { ...LEGACY_TASK, id: 'tVuelve', clientId: 'c-borrada', workspaceIds: ['ws1'], viewerIds: ['u1', 'u2'] };
  await no(fsMod.setDoc(ref(db, 'frame_projects', 'tVuelve'), { ...guardada, viewerIds: ['u1', 'u2', 'pend', 'u5'] }), 'con la ficha borrada se rechaza');
  const r = frameFusion.restorableFromTrash(guardada, { originId: 'ws1', clientOk: false });
  assert.equal(r.ok, true);
  // Como restoreTrashItem de FRAME: nace con la ACL del tablero principal.
  await ok(fsMod.setDoc(ref(db, 'frame_projects', 'tVuelve'), { ...r.project, workspaceIds: ['ws1'], viewerIds: ['u1', 'u2', 'pend', 'u5'] }), 'sin ficha, vuelve');
  assert.equal(frameFusion.restorableFromTrash(SALE_TASK, { originId: 'ws1', clientOk: true }).ok, false, 'una de venta no se restaura');
});

test('FRAME 3.6: editar una ficha con update de lo que cambió deja intacto lo comercial', { skip: skipFrame }, async () => {
  const db = as('u2');
  // La copia que tiene FRAME en pantalla está desactualizada: LOOPA cambió el teléfono.
  const enPantalla = { id: 'cm', name: 'Ferretería Norte', workspaceId: 'ws1', commercial: { nombreLoopa: 'Ferretería Norte', telefono: 'VIEJO' }, legacyLoopaIds: ['CL-1'] };
  const editada = { ...enPantalla, name: 'Ferretería del Norte' };
  await no(fsMod.setDoc(ref(db, 'frame_clients', 'cm'), editada), 'set() completo con lo comercial viejo (lo que hacía FRAME)');
  const patch = frameFusion.clientUpdatePatch(enPantalla, editada);
  assert.deepEqual(patch, { name: 'Ferretería del Norte' });
  await ok(fsMod.updateDoc(ref(db, 'frame_clients', 'cm'), patch), 'update sólo del nombre');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = (await fsMod.getDoc(fsMod.doc(ctx.firestore(), 'frame_clients', 'cm'))).data();
    assert.equal(d.name, 'Ferretería del Norte');
    assert.equal(d.commercial.telefono, '9999-0000', 'lo comercial del servidor, intacto');
  });
  assert.equal(frameFusion.clientHasSales(enPantalla), true, 'y FRAME no ofrece borrarla');
  await no(fsMod.deleteDoc(ref(db, 'frame_clients', 'cm')), 'las reglas tampoco');
});

test('FRAME 3.6 (revisión): ficha con los campos que agrega stampWs, portal, favorito y restaurar con ficha', { skip: skipFrame }, async () => {
  const db = as('u2');
  // FRAME arma la ficha con stampWs: en una ficha de LOOPA eso agrega startDate,
  // workspaceIds y viewerIds además del cambio.
  const enPantalla = { id: 'cm', name: 'Ferretería Norte', workspaceId: 'ws1', commercial: { nombreLoopa: 'Ferretería Norte', telefono: '9999-0000' }, legacyLoopaIds: ['CL-1'] };
  const stamp = (o) => ({ ...o, startDate: '2026-11-10', workspaceIds: ['ws1'], viewerIds: ['u1', 'u2', 'pend', 'u5'] });
  const patch = frameFusion.clientUpdatePatch(enPantalla, stamp({ ...enPantalla, notes: 'nota' }));
  assert.deepEqual(Object.keys(patch).sort(), ['notes', 'startDate', 'viewerIds', 'workspaceIds']);
  await ok(fsMod.updateDoc(ref(db, 'frame_clients', 'cm'), patch), 'update con los campos de stampWs');
  // Portal: sólo token y publicado.
  const portal = frameFusion.clientUpdatePatch(stamp(enPantalla), stamp({ ...enPantalla, portalToken: 'tok-1', portalPublished: true }));
  assert.deepEqual(portal, { portalToken: 'tok-1', portalPublished: true });
  await ok(fsMod.updateDoc(ref(db, 'frame_clients', 'cm'), portal), 'publicar el portal');
  // Favorito en una tarea de venta: sólo el campo (un set() completo con una copia vieja se rechaza).
  await ok(fsMod.updateDoc(ref(db, 'frame_projects', 'tSale'), { favorite: true }), 'favorito con update');
  await no(fsMod.setDoc(ref(db, 'frame_projects', 'tSale'), { ...SALE_TASK, sourceSaleStatus: 'viejo', favorite: true }), 'set() con procedencia vieja');
  // Restaurar con su ficha (c1 sigue en ws1), en el mismo lote que borra la papelera (como FRAME).
  const guardada = { ...MANUAL_TASK, id: 'tConFicha', clientId: 'c1' };
  await env.withSecurityRulesDisabled(async (ctx) => { await fsMod.setDoc(fsMod.doc(ctx.firestore(), 'frame_trash', 'tConFicha'), { ...guardada, deletedAt: 'x' }); });
  const r = frameFusion.restorableFromTrash(guardada, { originId: 'ws1', clientOk: true });
  assert.equal(r.project.clientId, 'c1');
  const b = fsMod.writeBatch(db);
  b.set(ref(db, 'frame_projects', 'tConFicha'), { ...r.project, workspaceIds: ['ws1'], viewerIds: ['u1', 'u2', 'pend', 'u5'] });
  b.delete(ref(db, 'frame_trash', 'tConFicha'));
  await ok(b.commit(), 'restaurar con su ficha y vaciar la papelera, juntos');
});

test('tanda 3.8: gastos y configuración comercial, sólo el equipo comercial', { skip }, async () => {
  const g = (uid, id = 'GV-1') => ref(as(uid), 'loopa_expenses', id);
  const cfg = (uid) => ref(as(uid), 'loopa_config', 'main');
  await ok(fsMod.getDoc(g('u1')), 'comercial lee un gasto');
  await ok(fsMod.getDoc(cfg('u1')), 'comercial lee la configuración');
  for (const uid of ['u2', 'u3', 'pend', null]) {
    await no(fsMod.getDoc(g(uid)), `${uid} no ve gastos`);
    await no(fsMod.getDoc(cfg(uid)), `${uid} no ve la configuración comercial`);
    await no(fsMod.setDoc(g(uid, 'GV-X'), { id: 'GV-X', kind: 'fixed', concepto: 'Renta', categoria: 'Local', monto: 1, nota: '', activo: true }), `${uid} no crea gastos`);
  }
  const nuevo = { id: 'GV-2', kind: 'variable', fecha: '2026-11-10', concepto: 'Taxi', categoria: 'Transporte', monto: 120, nota: '' };
  await ok(fsMod.setDoc(g('u1', 'GV-2'), nuevo), 'crea un gasto variable');
  await ok(fsMod.setDoc(g('u1', 'GF-1'), { id: 'GF-1', kind: 'fixed', concepto: 'Renta', categoria: 'Local', monto: 6000, nota: '', activo: true }), 'crea un gasto fijo');
  await no(fsMod.setDoc(g('u1', 'GV-3'), { ...nuevo, id: 'GV-3', fecha: '10/11/2026' }), 'fecha inválida');
  await no(fsMod.setDoc(g('u1', 'GV-4'), { ...nuevo, id: 'otro' }), 'id distinto del documento');
  await no(fsMod.setDoc(g('u1', 'GV-5'), { ...nuevo, id: 'GV-5', kind: 'regalo' }), 'tipo inventado');
  await no(fsMod.setDoc(g('u1', 'GV-6'), { ...nuevo, id: 'GV-6', monto: '120' }), 'monto como texto');
  await no(fsMod.setDoc(g('u1', 'GV-7'), { ...nuevo, id: 'GV-7', extra: 1 }), 'campos extra');
  await no(fsMod.setDoc(g('u1', 'GV-8'), { ...nuevo, id: 'GV-8', migration: { hash: 'x' } }), 'no se fabrica una marca de migración');
  await ok(fsMod.setDoc(g('u1'), { monto: 650, nota: 'subió' }, { merge: true }), 'edita un gasto migrado (merge)');
  await no(fsMod.updateDoc(g('u1'), { legacyId: 'otro' }), 'lo migrado no cambia');
  await no(fsMod.setDoc(g('u1'), { id: 'GV-1', kind: 'variable', fecha: '2026-11-01', concepto: 'Hosting', categoria: 'Software', monto: 1, nota: '' }), 'un set completo borraría la marca de migración');
  await ok(fsMod.deleteDoc(g('u1', 'GV-2')), 'borra un gasto');
  await no(fsMod.deleteDoc(g('u2', 'GF-1')), 'producción no borra gastos');
  await ok(fsMod.setDoc(cfg('u1'), { categorias: ['Redes', 'Web'] }, { merge: true }), 'edita la configuración');
  await no(fsMod.setDoc(cfg('u1'), { secreto: 1 }, { merge: true }), 'configuración: forma cerrada');
  await no(fsMod.setDoc(cfg('u1'), { migration: { hash: 'x' } }, { merge: true }), 'configuración: la marca de migración no cambia');
  await no(fsMod.setDoc(cfg('u2'), { categorias: [] }, { merge: true }), 'producción no edita la configuración comercial');
  await no(fsMod.deleteDoc(cfg('adm')), 'la configuración no se borra');
});
