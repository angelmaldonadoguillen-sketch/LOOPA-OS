'use strict';
// Fase 3, tanda 3.3 — la fuente de datos de las pantallas (_fuente/datos/
// fuente.js): lectura, cola persistente de cambios, cadena de versiones,
// errores, y de punta a punta contra la lógica REAL del servidor
// (functions/loopa-server.js) en memoria y por HTTP (servidor local).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const LoopaFusion = require('../../_fuente/datos/fusion.js');
const LoopaFuente = require('../../_fuente/datos/fuente.js');
const server = require('../../functions/loopa-server');
const local = require('../servidor-local/servidor.cjs');

const ROOT = path.join(__dirname, '..', '..');
const T = '2026-11-10T15:00:00.000Z';

// Almacén tipo localStorage.
const almacen = () => { const m = new Map(); return { leer: k => (m.has(k) ? m.get(k) : null), escribir: (k, v) => m.set(k, v), m }; };
let seq = 0;
const uuid = () => { seq += 1; return `0f000000-0000-4000-8000-${String(seq).padStart(12, '0')}`; };

// `llamar` que corre la función del servidor contra el almacén en memoria y,
// como el disparador, procesa el evento de la venta.
const FN = {
  loopaCreateSale: server.createSale, loopaUpdateSale: server.updateSale, loopaAddPayment: server.addPayment,
  loopaRemovePayment: server.removePayment, loopaSaveClient: server.saveClient, loopaSaveService: server.saveService,
};
function llamarEn(store, log = []) {
  return async (op) => {
    log.push(op);
    try {
      const r = await FN[op.fn](store, local.USUARIO, op.data, { now: () => T });
      if (r && r.eventId) await server.onEventCreated(store, r.eventId, { now: () => T });
      return r;
    } catch (err) {
      const e = server.toServerError(err);
      throw Object.assign(new Error(e.message), { code: `functions/${e.kind}`, details: e.details });
    }
  };
}
const leerDe = async (store) => LoopaFuente.armarDatos(await local.datos(store));
const esperar = (cola) => cola.procesar();
// Una venta activa con saldo por cobrar (para registrar cobros de prueba).
const conSaldo = (ventas) => ventas.find(x => x.estado !== 'cancelado' && x.total - x.abonos.reduce((a, b) => a + b.monto, 0) >= 100);

test('armarDatos: la forma de las pantallas, sin borradores ni el servicio marcador', async () => {
  const store = await local.sembrar();
  const docs = await local.datos(store);
  docs.sales.push({ ...docs.sales[0], id: 'borrador', status: 'draft' });
  docs.services.push({ id: LoopaFusion.UNCATALOGUED_SERVICE_ID, nombre: 'x' });
  const d = LoopaFuente.armarDatos(docs);
  assert.equal(d.ventas.length, docs.sales.length - 1, 'el borrador no aparece');
  assert.ok(d.ventas.every((v, i, a) => i === 0 || a[i - 1].n >= v.n), 'de la más nueva a la más vieja');
  assert.ok(!d.servicios.some(s => s.id === LoopaFusion.UNCATALOGUED_SERVICE_ID));
  assert.ok(d.ventas.every(v => typeof v.id === 'string' && Number.isInteger(v.version)), 'cada venta trae id y versión');
  // Dos ventas migradas comparten el número visible: se distinguen por id.
  const dup = d.ventas.filter(v => v.n === 1005);
  assert.equal(dup.length, 2);
  assert.notEqual(dup[0].id, dup[1].id);
  assert.deepEqual(LoopaFuente.armarDatos(null), { ventas: [], clientes: [], servicios: [] });
});

test('normalizarError: qué se reintenta solo y qué no', () => {
  const n = LoopaFuente.normalizarError;
  assert.deepEqual(n({ code: 'functions/aborted', details: { code: 'version_conflict' } }).transitorio, false, 'un conflicto no se arregla reintentando');
  assert.match(n({ code: 'functions/aborted', details: { code: 'version_conflict' } }).mensaje, /Otra persona/);
  assert.equal(n({ code: 'functions/aborted', details: { code: 'aborted' } }).transitorio, true, 'contención: sí');
  assert.equal(n({ code: 'aborted', details: { code: 'already-exists' } }).transitorio, false);
  assert.equal(n(new TypeError('Failed to fetch')).tipo, 'red');
  assert.equal(n(new TypeError('Failed to fetch')).transitorio, true);
  assert.equal(n({ code: 'functions/unavailable' }).transitorio, true);
  assert.equal(n({ code: 'functions/permission-denied', message: 'x' }).transitorio, false);
  assert.equal(n({ code: 'functions/invalid-argument', message: 'Falta la venta' }).mensaje, 'Falta la venta');
  assert.equal(n(undefined).tipo, 'internal');
  assert.ok(n({ message: 'x'.repeat(1000), code: 'functions/invalid-argument' }).mensaje.length <= 300);
});

test('cola: en orden, persistente después de cada operación y reanuda donde quedó', async () => {
  const a = almacen();
  const hechas = [];
  let fallarEn = 'B2';
  const llamar = async (op) => {
    if (op.data.k === fallarEn) { fallarEn = null; throw Object.assign(new Error('sin red'), { code: 'functions/unavailable' }); }
    hechas.push(op.data.k);
    return { ok: op.data.k };
  };
  const estados = [];
  const confirmadas = [];
  const cola = LoopaFuente.crearCola({ llamar, almacen: a, alCambiar: e => estados.push(e), alConfirmar: (e, r) => confirmadas.push([e.etiqueta, r]) });
  cola.encolar({ etiqueta: 'A', ops: [{ fn: 'f', data: { k: 'A1' } }] });
  cola.encolar({ etiqueta: 'B', ops: [{ fn: 'f', data: { k: 'B1' } }, { fn: 'f', data: { k: 'B2' } }, { fn: 'f', data: { k: 'B3' } }] });
  cola.encolar({ etiqueta: 'C', ops: [{ fn: 'f', data: { k: 'C1' } }] });
  const r = await esperar(cola);
  assert.deepEqual(hechas, ['A1', 'B1'], 'se detiene en la que falló; C espera');
  assert.equal(r.pendientes, 2);
  assert.equal(r.error.etiqueta, 'B');
  assert.equal(r.error.transitorio, true);
  const guardado = JSON.parse(a.leer(LoopaFuente.CLAVE));
  assert.equal(guardado.entradas[0].progreso.hechas, 1, 'B1 quedó anotada como hecha');

  // «Recargar la página»: otra cola con el mismo almacén retoma desde B2.
  const hechas2 = [];
  const cola2 = LoopaFuente.crearCola({ llamar: async op => { hechas2.push(op.data.k); return { ok: op.data.k }; }, almacen: a });
  assert.equal(cola2.estado().pendientes, 2);
  await cola2.procesar();
  assert.deepEqual(hechas2, [], 'con el error anotado no avanza sola');
  await cola2.reintentar();
  assert.deepEqual(hechas2, ['B2', 'B3', 'C1'], 'retoma en B2 sin repetir B1, y sigue con C');
  assert.equal(cola2.estado().pendientes, 0);
  assert.deepEqual(JSON.parse(a.leer(LoopaFuente.CLAVE)).entradas, []);
  assert.deepEqual(confirmadas.map(c => c[0]), ['A']);
  assert.ok(estados.length >= 3);
});

test('cola: reintentar manda LAS MISMAS operaciones; descartar sigue con la próxima', async () => {
  const a = almacen();
  const vistas = [];
  let falla = true;
  const llamar = async (op) => { vistas.push(JSON.stringify(op)); if (falla && op.data.k === 'X') throw Object.assign(new Error('c'), { code: 'functions/aborted', details: { code: 'version_conflict' } }); return {}; };
  let vaciada = 0;
  let avisarVacia;
  const vacia = new Promise(r => { avisarVacia = r; });
  const cola = LoopaFuente.crearCola({ llamar, almacen: a, alVaciarse: () => { vaciada += 1; avisarVacia(); } });
  cola.encolar({ etiqueta: 'X', ops: [{ fn: 'f', data: { k: 'X', id: uuid() } }] });
  cola.encolar({ etiqueta: 'Y', ops: [{ fn: 'f', data: { k: 'Y' } }] });
  let st = await esperar(cola);
  assert.equal(st.error.transitorio, false);
  await cola.reintentar();
  assert.equal(vistas[0], vistas[1], 'mismo id, mismos datos');
  st = cola.estado();
  assert.equal(st.error.etiqueta, 'X');
  const descartada = cola.descartar();
  assert.equal(descartada.etiqueta, 'X');
  // descartar sigue sola con la próxima (sin llamar a procesar).
  await Promise.race([vacia, new Promise((_, rej) => setTimeout(() => rej(new Error('descartar no siguió con la próxima')), 2000))]);
  assert.equal(cola.estado().pendientes, 0);
  assert.ok(vistas.some(v => v.includes('"Y"')));
  assert.equal(vaciada, 1);
  assert.equal(cola.descartar(), null, 'nada que descartar');
  assert.throws(() => cola.encolar({ etiqueta: 'vacía', ops: [] }));
});

test('cola: un almacén roto o lleno no rompe la pantalla', async () => {
  const roto = { leer: () => '{no es json', escribir: () => { throw new Error('QuotaExceeded'); } };
  const cola = LoopaFuente.crearCola({ llamar: async () => ({}), almacen: roto });
  assert.equal(cola.estado().pendientes, 0);
  cola.encolar({ etiqueta: 'a', ops: [{ fn: 'f', data: {} }] });
  await esperar(cola);
  assert.equal(cola.estado().pendientes, 0);
  assert.throws(() => LoopaFuente.crearCola({}), /llamar/);
});

test('de punta a punta: venta nueva con cliente y servicio nuevos, número del servidor', async () => {
  const store = await local.sembrar();
  const log = [];
  const confirmadas = [];
  const cola = LoopaFuente.crearCola({ llamar: llamarEn(store, log), almacen: almacen(), alConfirmar: (e, r) => confirmadas.push(r) });
  const antes = await leerDe(store);
  // Servicio creado a mitad de la venta: se encola ANTES que la venta.
  const srv = { id: 'SRV-PRUEBA1', nombre: 'Video corto', categoria: 'Video', unidad: 'pieza', modelo: 'unitario', precio: 500, costo: 100, activo: true };
  cola.encolar({ etiqueta: 'servicio', ops: [LoopaFusion.operacionServicio(srv)] });
  const reel = antes.servicios.find(s => s.id === 'SRV-DEMO-REEL');
  assert.ok(reel.generaProduccion, 'servicio con plantilla');
  const venta = {
    n: null, fecha: '2026-11-10', estado: 'en-proceso', entrega: '2026-11-20', pay: 'bac', nota: 'prueba',
    items: [{ tipoId: reel.id, nombre: reel.nombre, precio: 1800, costo: 0, q: 1, descripcion: '' }, { tipoId: srv.id, nombre: srv.nombre, precio: 500, costo: 100, q: 2, descripcion: 'dos piezas' }],
    subtotal: 2800, descuento: 0, total: 2800, abonos: [{ id: 'AB-1', fecha: '2026-11-10', monto: 1000, metodo: 'bac' }],
  };
  const cli = { nombre: 'Cliente Nuevo', empresa: 'Nueva SA', telefono: '9999-0000', email: 'n@x.example', canal: 'WhatsApp' };
  const armado = LoopaFusion.operacionesNuevaVenta(venta, cli, null, uuid);
  cola.encolar({ etiqueta: 'venta', ops: armado.ops, id: `V-${armado.ventaId}` });
  const st = await esperar(cola);
  assert.equal(st.error, null, st.error && st.error.mensaje);
  assert.deepEqual(log.map(o => o.fn), ['loopaSaveService', 'loopaSaveClient', 'loopaCreateSale'], 'el servicio llega antes que la venta');

  const despues = await leerDe(store);
  const v = despues.ventas.find(x => x.id === armado.ventaId);
  assert.ok(v, 'la venta está');
  assert.equal(v.n, Math.max(...antes.ventas.map(x => x.n)) + 1, 'número correlativo del servidor');
  assert.equal(confirmadas.at(-1).find(r => r && r.n).n, v.n, 'la pantalla recibe el número del servidor');
  assert.equal(v.estado, 'en-proceso');
  assert.equal(v.items[1].descripcion, 'dos piezas');
  assert.equal(v.items[1].q, 2);
  assert.deepEqual(v.abonos.map(a => a.id), ['AB-1']);
  const c = despues.clientes.find(x => x.id === armado.clienteId);
  assert.equal(c.nombre, 'Cliente Nuevo');
  assert.equal(c.telefono, '9999-0000');
  assert.ok(despues.servicios.some(s => s.id === 'SRV-PRUEBA1'));
  // El trabajo de producción se generó (disparador simulado).
  assert.ok(store.list('frame_projects').some(t => t.sourceSaleId === armado.ventaId));
});

test('de punta a punta: cambios seguidos sobre la misma venta sin recargar (cadena de versiones)', async () => {
  const store = await local.sembrar();
  const cola = LoopaFuente.crearCola({ llamar: llamarEn(store), almacen: almacen() });
  const { ventas } = await leerDe(store);
  const v = conSaldo(ventas);
  // Todas las operaciones se arman con la versión VIEJA de la pantalla.
  cola.encolar({ etiqueta: '1', ops: LoopaFusion.operacionesCambio(v, { estado: 'revision' }, uuid) });
  cola.encolar({ etiqueta: '2', ops: [LoopaFusion.operacionCobro(v, { id: 'AB-cad', fecha: '2026-11-10', monto: 10, metodo: 'bac' })] });
  cola.encolar({ etiqueta: '3', ops: LoopaFusion.operacionesCambio(v, { nota: 'después del cobro' }, uuid) });
  cola.encolar({ etiqueta: '4', ops: LoopaFusion.operacionesCambio({ ...v, abonos: [...v.abonos, { id: 'AB-cad' }] }, { abonos: v.abonos }, uuid) });
  cola.encolar({ etiqueta: '5', ops: [LoopaFusion.operacionEliminar(v)] });
  const st = await esperar(cola);
  assert.equal(st.error, null, st.error && `${st.error.etiqueta}: ${st.error.mensaje}`);
  const doc = await store.get('loopa_sales', v.id);
  assert.equal(doc.status, 'cancelled');
  assert.equal(doc.legacyProductionState, 'revision');
  assert.equal(doc.commercial.nota, 'después del cobro');
  assert.deepEqual(doc.commercial.abonosAnulados.map(a => a.id), ['AB-cad'], 'anulado, no borrado (D18)');
  assert.equal(doc.version, v.version + 5);

  // Reactivar con la versión vieja también sigue la cadena.
  cola.encolar({ etiqueta: 'reactivar', ops: LoopaFusion.operacionesCambio({ ...v, estado: 'cancelado' }, { estado: 'en-proceso' }, uuid) });
  assert.equal((await esperar(cola)).error, null);
  const re = await store.get('loopa_sales', v.id);
  assert.equal(re.status, 'confirmed');
  assert.equal(re.legacyProductionState, 'en-proceso');
});

test('de punta a punta: si OTRA persona cambió la venta, conflicto (no se pisa)', async () => {
  const store = await local.sembrar();
  const cola = LoopaFuente.crearCola({ llamar: llamarEn(store), almacen: almacen() });
  const { ventas } = await leerDe(store);
  const v = ventas.find(x => x.estado === 'en-proceso');
  // Otro equipo cambia la venta (versión v → v+1, fuera de esta cola).
  await server.updateSale(store, local.USUARIO, { saleId: v.id, patch: { commercial: { nota: 'de otra persona' } }, expectedVersion: v.version }, { now: () => T });
  cola.encolar({ etiqueta: 'mío', ops: LoopaFusion.operacionesCambio(v, { nota: 'mía' }, uuid) });
  const st = await esperar(cola);
  assert.equal(st.error.codigo, 'version_conflict');
  assert.equal(st.error.transitorio, false);
  assert.equal((await store.get('loopa_sales', v.id)).commercial.nota, 'de otra persona', 'no se pisó');
  cola.descartar();
  assert.equal(cola.estado().pendientes, 0);
});

test('de punta a punta: un cobro repetido por reintento no se duplica', async () => {
  const store = await local.sembrar();
  const { ventas } = await leerDe(store);
  const v = conSaldo(ventas);
  const llamarReal = llamarEn(store);
  let cortar = true;
  // El servidor guardó, pero la respuesta se perdió: la cola no se enteró.
  const llamar = async (op) => { const r = await llamarReal(op); if (cortar) { cortar = false; throw new TypeError('Failed to fetch'); } return r; };
  const cola = LoopaFuente.crearCola({ llamar, almacen: almacen() });
  cola.encolar({ etiqueta: 'cobro', ops: [LoopaFusion.operacionCobro(v, { id: 'AB-rep', fecha: '2026-11-10', monto: 5, metodo: 'bac' })] });
  assert.equal((await esperar(cola)).error.tipo, 'red');
  assert.equal((await cola.reintentar()).error, null);
  const doc = await store.get('loopa_sales', v.id);
  assert.equal(doc.commercial.abonos.filter(a => a.id === 'AB-rep').length, 1);
});

test('servidor local por HTTP: lectura, funciones, errores y fallas simuladas', async (t) => {
  const store = await local.sembrar();
  const srv = local.crearServidor({ store, html: () => '<html>ok</html>' });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  assert.equal(srv.address().address, '127.0.0.1');
  const api = LoopaFuente.adaptadorHttp(fetch, base);
  const docs = await api.leer();
  const d = LoopaFuente.armarDatos(docs);
  assert.ok(d.ventas.length > 0);
  // Sólo fichas de los tableros habilitados (como las reglas).
  const cfg = await store.get('loopa_config', 'production');
  assert.ok(docs.clients.every(c => cfg.allowedWorkspaceIds.includes(c.workspaceId)));

  const v = d.ventas.find(x => x.estado === 'en-proceso');
  const r = await api.llamar(LoopaFusion.operacionesCambio(v, { estado: 'revision' }, uuid)[0]);
  assert.equal(r.status, 'updated');
  assert.equal(r.version, v.version + 1);

  const err = await api.llamar(LoopaFusion.operacionesCambio(v, { nota: 'x' }, uuid)[0]).catch(e => e);
  assert.equal(err.code, 'aborted');
  assert.equal(err.details.code, 'version_conflict');
  assert.equal(LoopaFuente.normalizarError(err).transitorio, false);

  const inv = await api.llamar({ fn: 'loopaUpdateSale', data: { saleId: v.id } }).catch(e => e);
  assert.equal(inv.code, 'invalid-argument');
  const nofn = await api.llamar({ fn: 'borrarTodo', data: {} }).catch(e => e);
  assert.equal(nofn.code, 'not-found');

  await fetch(`${base}/api/fallar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ veces: 1, status: 'unavailable' }) });
  const caida = await api.llamar({ fn: 'loopaAddPayment', data: {} }).catch(e => e);
  assert.equal(caida.code, 'unavailable');
  assert.equal(LoopaFuente.normalizarError(caida).transitorio, true);

  // Vender por HTTP genera el trabajo de producción (como el disparador).
  const ant = LoopaFuente.armarDatos(await api.leer());
  const nv = LoopaFusion.operacionesNuevaVenta({ fecha: '2026-11-10', entrega: '2026-11-25', estado: 'pendiente', items: [{ tipoId: 'SRV-DEMO-REEL', precio: 1800, costo: 0, q: 1 }], subtotal: 1800, total: 1800, abonos: [] }, ant.clientes[0], ant.clientes[0].id, uuid);
  for (const op of nv.ops) await api.llamar(op);
  assert.ok(store.list('frame_projects').some(t => t.sourceSaleId === nv.ventaId), 'tarjetas generadas');

  const html = await fetch(`${base}/?datos=fusion`);
  assert.equal(await html.text(), '<html>ok</html>');
  assert.equal((await fetch(`${base}/api/nada`)).status, 404);
  const malo = await fetch(`${base}/api/fn/loopaSaveClient`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{roto' });
  assert.equal(malo.status, 400);
  // Rutas del prototipo no son funciones.
  for (const nombre of ['constructor', 'toString', 'hasOwnProperty']) {
    const e = await api.llamar({ fn: nombre, data: {} }).catch(x => x);
    assert.equal(e.code, 'not-found', nombre);
  }
  // Otro sitio: sin JSON declarado (formulario) o con otro Host → rechazado.
  const form = await fetch(`${base}/api/fn/loopaSaveClient`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ data: { client: { id: uuid(), nombre: 'X' } } }) });
  assert.equal(form.status, 415);
  const http = require('node:http');
  const rebind = await new Promise((resolve, reject) => {
    const rq = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/datos', headers: { host: 'atacante.example:80' } }, r => { r.resume(); resolve(r.statusCode); });
    rq.on('error', reject); rq.end();
  });
  assert.equal(rebind, 403);
  // Demasiado grande: 413 con un error que NO se reintenta para siempre.
  const enorme = await api.llamar({ fn: 'loopaSaveClient', data: { client: { id: uuid(), nombre: 'x'.repeat(1_200_000) } } }).catch(x => x);
  assert.equal(enorme.code, 'invalid-argument');
  assert.equal(LoopaFuente.normalizarError(enorme).transitorio, false);

  // Sin servidor: error de red, transitorio.
  const lejos = LoopaFuente.adaptadorHttp(fetch, 'http://127.0.0.1:9');
  const e2 = await lejos.leer().catch(e => e);
  assert.equal(LoopaFuente.normalizarError(e2).transitorio, true);
});

test('las pantallas: la bandera sólo en este equipo y sin guardar en los documentos «loopa»', () => {
  const app = fs.readFileSync(path.join(ROOT, '_fuente', 'app.jsx'), 'utf8');
  const build = fs.readFileSync(path.join(ROOT, '_fuente', 'build.js'), 'utf8');
  assert.match(app, /get\('datos'\) !== 'fusion'\) return null;/);
  assert.match(app, /\['127\.0\.0\.1', 'localhost', '\[::1\]'\]\.includes\(window\.location\.hostname\)/);
  for (const k of ['ventas', 'clientes', 'servicios']) {
    assert.ok(app.includes(`if (ready && !DATOS_FUSION) queueSave('${k}'`), `${k} no se guarda como documento «loopa» con la fusión`);
  }
  // Configuración y gastos van aparte en este navegador, nunca a la nube.
  assert.match(app, /if \(DATOS_FUSION\) \{\s*try \{ localStorage\.setItem\('loopa-fusion-' \+ k/);
  // Los módulos de datos se arman antes que app.jsx.
  const mods = build.match(/const MODULES = \[([^\]]+)\]/)[1];
  assert.ok(mods.indexOf('datos/fusion.js') < mods.indexOf('datos/fuente.js'));
  // Ninguna venta se identifica sólo por número en las acciones.
  assert.ok(!/onUpdate\(v\.n,|onAbono\(v\.n,|onDelete\(v\.n\)|x\.n === openN|v\.n === menu\.n/.test(app));
});

test('cola: el progreso se guarda ANTES de la próxima llamada (si la página muere, no se repite)', async () => {
  const a = almacen();
  const llamadas = [];
  const cola = LoopaFuente.crearCola({ almacen: a, llamar: (op) => { llamadas.push(op.data.k); return op.data.k === 'B' ? new Promise(() => {}) : Promise.resolve({}); } });
  cola.encolar({ etiqueta: 'AB', ops: [{ fn: 'f', data: { k: 'A' } }, { fn: 'f', data: { k: 'B' } }] });
  for (let i = 0; i < 5 && llamadas.length < 2; i += 1) await new Promise(r => setImmediate(r));
  assert.deepEqual(llamadas, ['A', 'B'], 'B quedó en vuelo para siempre (la página «murió»)');
  const guardado = JSON.parse(a.leer(LoopaFuente.CLAVE));
  assert.equal(guardado.entradas[0].progreso.hechas, 1, 'A ya figura hecha en el almacén');
  assert.equal(cola.ocupada(), true);
});

test('cadena de versiones: una respuesta SIN cambio (existing) no esconde el cambio de otra persona', async () => {
  const store = await local.sembrar();
  const { ventas } = await leerDe(store);
  const v = ventas.find(x => x.estado !== 'cancelado' && x.abonos.length > 0);
  const ab = v.abonos[0];
  // Otra persona anula el cobro: versión v → v+1.
  await server.removePayment(store, local.USUARIO, { saleId: v.id, abonoId: ab.id }, { now: () => T });
  const cola = LoopaFuente.crearCola({ llamar: llamarEn(store), almacen: almacen() });
  // Este equipo, con la pantalla vieja, anula el mismo cobro (ya anulado →
  // 'existing', sin subir versión) y después edita la nota con la versión vieja.
  cola.encolar({ etiqueta: 'anular', ops: LoopaFusion.operacionesCambio(v, { abonos: v.abonos.filter(x => x.id !== ab.id) }, uuid) });
  cola.encolar({ etiqueta: 'nota', ops: LoopaFusion.operacionesCambio(v, { nota: 'pisaría' }, uuid) });
  const st = await esperar(cola);
  assert.equal(st.error && st.error.etiqueta, 'nota');
  assert.equal(st.error.codigo, 'version_conflict', 'la nota se armó sobre una versión que otra persona cambió');
});

test('cadena de versiones: sólo el salto exacto v → v+1 de un cambio propio', async () => {
  const vistas = [];
  const llamar = async (op) => {
    vistas.push(op.data.expectedVersion);
    if (op.data.k === 'mio') return { status: 'updated', saleId: 'S', version: 3 };
    return { status: 'updated', saleId: 'S', version: op.data.expectedVersion + 1 };
  };
  const cola = LoopaFuente.crearCola({ llamar, almacen: almacen() });
  const op = (k, v, saleId = 'S') => ({ fn: 'loopaUpdateSale', data: { k, saleId, expectedVersion: v } });
  cola.encolar({ etiqueta: 'a', ops: [op('mio', 2)] });        // propio: 2 → 3
  cola.encolar({ etiqueta: 'b', ops: [op('vieja', 2)] });      // armada con la 2: va con la 3
  cola.encolar({ etiqueta: 'c', ops: [op('mas-vieja', 1)] });  // armada con la 1: el 1 → 2 no fue propio
  cola.encolar({ etiqueta: 'd', ops: [op('otra', 2, 'T')] });  // otra venta: sin cadena
  await esperar(cola);
  assert.deepEqual(vistas, [2, 3, 1, 2]);
  // La operación guardada no se reescribe: sólo lo que viaja.
  const st = cola._estado();
  assert.equal(st.entradas.length, 0);
  assert.deepEqual(Object.fromEntries(Object.entries(st.cadena.S).map(([k, x]) => [k, x.to])), { 2: 3, 3: 4, 1: 2 });
});

// ── Revisión de la tanda 3.3 ─────────────────────────────────────
const repo = require('../../functions/repositories/sales');

// `llamar` que guarda en el servidor y PIERDE la respuesta de las ops elegidas.
function llamarQuePierde(store, perder) {
  const real = llamarEn(store);
  return async (op) => {
    const r = await real(op);
    if (perder(op)) throw new TypeError('Failed to fetch');
    return r;
  };
}

test('servidor: opId — un reintento de la misma operación no se repite ni da conflicto', async () => {
  const store = await local.sembrar();
  const { ventas } = await leerDe(store);
  const v = conSaldo(ventas);
  const u1 = await server.updateSale(store, local.USUARIO, { saleId: v.id, patch: { commercial: { nota: 'a' } }, expectedVersion: v.version, opId: 'op-aaaaaaaa1' }, { now: () => T });
  assert.deepEqual([u1.status, u1.from, u1.to], ['updated', v.version, v.version + 1]);
  // Otra persona cambia después; el reintento igual se reconoce.
  await server.updateSale(store, local.USUARIO, { saleId: v.id, patch: { commercial: { nota: 'b' } }, expectedVersion: v.version + 1 }, { now: () => T });
  const u2 = await server.updateSale(store, local.USUARIO, { saleId: v.id, patch: { commercial: { nota: 'a' } }, expectedVersion: v.version, opId: 'op-aaaaaaaa1' }, { now: () => T });
  assert.deepEqual([u2.status, u2.from, u2.to, u2.version], ['existing', v.version, v.version + 1, v.version + 2]);
  assert.equal((await store.get('loopa_sales', v.id)).commercial.nota, 'b', 'el reintento no pisó');
  const p1 = await server.addPayment(store, local.USUARIO, { saleId: v.id, abono: { id: 'AB-op', fecha: '2026-11-10', monto: 1, metodo: 'bac' }, opId: 'op-bbbbbbbb1' });
  const p2 = await server.addPayment(store, local.USUARIO, { saleId: v.id, abono: { id: 'AB-op', fecha: '2026-11-10', monto: 1, metodo: 'bac' }, opId: 'op-bbbbbbbb1' });
  assert.deepEqual([p2.status, p2.from, p2.to], ['existing', p1.from, p1.to]);
  const r1 = await server.removePayment(store, local.USUARIO, { saleId: v.id, abonoId: 'AB-op', opId: 'op-cccccccc1' }, { now: () => T });
  const r2 = await server.removePayment(store, local.USUARIO, { saleId: v.id, abonoId: 'AB-op', opId: 'op-cccccccc1' }, { now: () => T });
  assert.deepEqual([r2.status, r2.from, r2.to], ['existing', r1.from, r1.to]);
  // Validación y límites.
  const kind = (p) => p.then(() => 'ok', e => (e.details && e.details.code) || e.kind);
  assert.equal(await kind(server.updateSale(store, local.USUARIO, { saleId: v.id, patch: { commercial: { nota: 'x' } }, expectedVersion: 99, opId: 'corto' }, { now: () => T })), 'invalid');
  assert.equal(await kind(server.updateSale(store, local.USUARIO, { saleId: v.id, patch: { appliedOps: [] }, expectedVersion: 99 }, { now: () => T })), 'field_not_editable', 'appliedOps es sólo del servidor');
  let ver = (await store.get('loopa_sales', v.id)).version;
  for (let i = 0; i < 35; i += 1) {
    const r = await repo.updateSale(store, v.id, { commercial: { nota: `n${i}` } }, { expectedVersion: ver, opId: `op-lote-${String(i).padStart(4, '0')}` });
    ver = r.version;
  }
  assert.equal((await store.get('loopa_sales', v.id)).appliedOps.length, 30, 'se guardan las últimas 30');
});

test('respuesta perdida en un cambio: el reintento no da conflicto falso y lo que sigue se guarda', async () => {
  const store = await local.sembrar();
  const { ventas } = await leerDe(store);
  const v = conSaldo(ventas);
  let perdida = false;
  const cola = LoopaFuente.crearCola({ llamar: llamarQuePierde(store, op => op.fn === 'loopaUpdateSale' && !perdida && (perdida = true)), almacen: almacen() });
  cola.encolar({ etiqueta: 'estado', ops: LoopaFusion.operacionesCambio(v, { estado: 'revision' }, uuid) });
  cola.encolar({ etiqueta: 'nota', ops: LoopaFusion.operacionesCambio(v, { nota: 'después' }, uuid) });
  assert.equal((await esperar(cola)).error.tipo, 'red');
  const st = await cola.reintentar();
  assert.equal(st.error, null, st.error && `${st.error.etiqueta}: ${st.error.mensaje}`);
  const doc = await store.get('loopa_sales', v.id);
  assert.equal(doc.legacyProductionState, 'revision');
  assert.equal(doc.commercial.nota, 'después');
  assert.equal(doc.version, v.version + 2, 'cada cambio una sola vez');
});

test('respuesta perdida en un cobro o una anulación: el cambio siguiente no da conflicto falso', async () => {
  for (const fn of ['loopaAddPayment', 'loopaRemovePayment']) {
    const store = await local.sembrar();
    const { ventas } = await leerDe(store);
    const v = fn === 'loopaAddPayment' ? conSaldo(ventas) : ventas.find(x => x.estado !== 'cancelado' && x.abonos.length);
    let perdida = false;
    const cola = LoopaFuente.crearCola({ llamar: llamarQuePierde(store, op => op.fn === fn && !perdida && (perdida = true)), almacen: almacen() });
    const primera = fn === 'loopaAddPayment'
      ? [LoopaFusion.operacionCobro(v, { id: 'AB-perd', fecha: '2026-11-10', monto: 1, metodo: 'bac' })]
      : LoopaFusion.operacionesCambio(v, { abonos: v.abonos.slice(1) }, uuid);
    cola.encolar({ etiqueta: fn, ops: primera });
    cola.encolar({ etiqueta: 'nota', ops: LoopaFusion.operacionesCambio(v, { nota: fn }, uuid) });
    await esperar(cola);
    const st = await cola.reintentar();
    assert.equal(st.error, null, `${fn}: ${st.error && st.error.mensaje}`);
    assert.equal((await store.get('loopa_sales', v.id)).commercial.nota, fn);
  }
});

test('después de recargar, un cambio nuevo NO pisa uno viejo que seguía pendiente', async () => {
  const store = await local.sembrar();
  const a = almacen();
  const { ventas } = await leerDe(store);
  const v = conSaldo(ventas);
  let caido = true;
  const llamarReal = llamarEn(store);
  const llamar = async (op) => { if (caido) throw new TypeError('Failed to fetch'); return llamarReal(op); };
  const s1 = LoopaFuente.crearCola({ llamar, almacen: a });
  s1.encolar({ etiqueta: 'A (antes de recargar)', ops: LoopaFusion.operacionesCambio(v, { nota: 'A' }, uuid) });
  await esperar(s1);
  // Recarga: otra sesión, la pantalla muestra la venta SIN el cambio A.
  const s2 = LoopaFuente.crearCola({ llamar, almacen: a });
  s2.encolar({ etiqueta: 'B (después)', ops: LoopaFusion.operacionesCambio(v, { nota: 'B' }, uuid) });
  caido = false;
  const st = await s2.reintentar();
  assert.equal(st.error && st.error.etiqueta, 'B (después)');
  assert.equal(st.error.codigo, 'version_conflict', 'B se armó sin ver A: conflicto, no pisada silenciosa');
  assert.equal((await store.get('loopa_sales', v.id)).commercial.nota, 'A');
});

test('dos pestañas: una sola cola, cada operación una vez, nada se pierde', async () => {
  const a = almacen();
  const vistas = [];
  let soltar;
  const traba = new Promise(r => { soltar = r; });
  const llamar = async (op) => { vistas.push(op.data.k); if (op.data.k === 'A1') await traba; return {}; };
  // El mismo candado para las dos (navigator.locks en el navegador).
  let cadena = Promise.resolve();
  const exclusivo = (fn) => { const r = cadena.then(fn); cadena = r.catch(() => {}); return r; };
  const t1 = LoopaFuente.crearCola({ llamar, almacen: a, exclusivo });
  const t2 = LoopaFuente.crearCola({ llamar, almacen: a, exclusivo });
  t1.encolar({ etiqueta: 'A', ops: [{ fn: 'f', data: { k: 'A1' } }, { fn: 'f', data: { k: 'A2' } }] });
  t2.encolar({ etiqueta: 'B', ops: [{ fn: 'f', data: { k: 'B1' } }] });
  t1.encolar({ etiqueta: 'C', ops: [{ fn: 'f', data: { k: 'C1' } }] });
  assert.deepEqual(JSON.parse(a.leer(LoopaFuente.CLAVE)).entradas.map(x => x.etiqueta), ['A', 'B', 'C'], 'lo que encoló cada pestaña sigue ahí');
  soltar();
  await Promise.all([t1.procesar(), t2.procesar()]);
  await t1.procesar(); await t2.procesar();
  assert.deepEqual(vistas, ['A1', 'A2', 'B1', 'C1']);
  assert.equal(t1.estado().pendientes + t2.estado().pendientes, 0);
});

test('cola: descartar sólo la que la persona vio, intentos, opId estable y avisos que fallan', async () => {
  const a = almacen();
  let n = 0;
  const vistos = [];
  const llamar = async (op) => { vistos.push(op.data.opId); n += 1; if (n <= 3) throw Object.assign(new Error('x'), { code: 'functions/internal' }); return {}; };
  const cola = LoopaFuente.crearCola({ llamar, almacen: a, alCambiar: () => { throw new Error('pantalla rota'); }, alConfirmar: () => { throw new Error('idem'); } });
  const id = cola.encolar({ etiqueta: 'X', ops: [{ fn: 'loopaUpdateSale', data: { saleId: 'S', expectedVersion: 1 } }] });
  assert.equal(cola.encolar({ etiqueta: 'X otra vez', ops: [{ fn: 'f', data: {} }], id }), id);
  assert.equal(cola.estado().pendientes, 1, 'doble clic: una sola entrada');
  await esperar(cola);
  await cola.reintentar();
  const st = await cola.reintentar();
  assert.equal(st.error.intentos, 3, 'cuenta los intentos (la pantalla deja de reintentar sola)');
  assert.equal(st.error.transitorio, true);
  assert.ok(vistos.every(x => x === vistos[0] && /^op-/.test(x)), 'el mismo opId en cada intento');
  assert.equal(cola.descartar('otra-id'), null, 'no descarta una que la persona no vio');
  const sigue = await cola.reintentar();
  assert.equal(sigue.pendientes, 0, 'los avisos que fallan no traban la cola');
  assert.equal(cola.ocupada(), false);
  const malo = LoopaFuente.crearCola({ llamar: async () => ({}), almacen: { leer: () => null, escribir: () => { throw new Error('QuotaExceeded'); } } });
  malo.encolar({ etiqueta: 'a', ops: [{ fn: 'f', data: {} }] });
  assert.equal(malo.estado().sinPersistencia, true, 'la pantalla avisa que no se guarda en el equipo');
  assert.equal(LoopaFuente.normalizarError(new TypeError("Cannot read properties of undefined (reading 'x')")).tipo, 'internal', 'un error de programación no es «sin red»');
});

test('las pantallas (revisión 3.3): lo que la revisión pidió sigue en su lugar', () => {
  const app = fs.readFileSync(path.join(ROOT, '_fuente', 'app.jsx'), 'utf8');
  assert.ok(app.includes('setVentas(prev => prev.filter(x => claveVenta(x) !== n));'), 'borrar (modo de siempre) por la misma clave');
  assert.ok(app.includes('cola.current.descartar(id)'), 'descartar sólo la que se vio');
  assert.ok(/<button className="linkbtn" onClick=\{onDescartar\}>Descartar…<\/button>/.test(app) && !app.includes('!e.transitorio && <button'), 'descartar siempre disponible');
  assert.ok(app.includes("else setClientes(prev => [{ id: armado.clienteId, ...datos"), 'el cliente nuevo entra a la lista al vender');
  assert.ok(app.includes('if (mia !== lectura.current'), 'una lectura vieja no pisa la pantalla');
  assert.ok(app.includes("window.navigator.locks.request('loopa-fusion-cola'"), 'una pestaña a la vez');
  assert.ok(app.includes('colaEstado.error.intentos >= 5'), 'reintentos automáticos limitados');
  assert.ok(app.includes('if (enviando.current) return;'), 'doble clic en registrar');
});

test('cadena de versiones: un cambio de OTRA pestaña no sigue los saltos de ésta', async () => {
  const store = await local.sembrar();
  const a = almacen();
  const { ventas } = await leerDe(store);
  const v = conSaldo(ventas);
  let caido = true;
  const real = llamarEn(store);
  const llamar = async (op) => { if (caido) throw new TypeError('Failed to fetch'); return real(op); };
  const t1 = LoopaFuente.crearCola({ llamar, almacen: a });
  const t2 = LoopaFuente.crearCola({ llamar, almacen: a });
  t1.encolar({ etiqueta: 'A (pestaña 1)', ops: LoopaFusion.operacionesCambio(v, { nota: 'A' }, uuid) });
  await esperar(t1);
  t2.encolar({ etiqueta: 'B (pestaña 2, sin ver A)', ops: LoopaFusion.operacionesCambio(v, { nota: 'B' }, uuid) });
  caido = false;
  const st = await t1.reintentar(); // la pestaña 1 ejecuta las dos
  assert.equal(st.error && st.error.etiqueta, 'B (pestaña 2, sin ver A)');
  assert.equal(st.error.codigo, 'version_conflict');
  assert.equal((await store.get('loopa_sales', v.id)).commercial.nota, 'A');
});
