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
});

test('tarea de una venta: el equipo la trabaja, pero no toca procedencia, entrega ni la borra', { skip }, async () => {
  const t = ref(as('u2'), 'frame_projects', 'tSale');
  await ok(fsMod.updateDoc(t, { status: 'producing', checklist: [{ id: 'k1', text: 'Grabar', done: true }] }), 'avance');
  await ok(fsMod.updateDoc(t, { sessionDate: '2026-11-19' }), 'reprogramar mueve el día de trabajo');
  await ok(fsMod.updateDoc(t, { clientVisible: true }), 'compartir con el cliente');
  await no(fsMod.updateDoc(t, { deadline: '2026-11-30' }), 'la entrega la fija la venta');
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
