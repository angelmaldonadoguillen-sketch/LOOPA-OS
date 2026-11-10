#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────
// Servidor LOCAL de la fusión (Fase 3, tanda 3.3) — sólo para este equipo.
//
// Corre la MISMA lógica del servidor (functions/loopa-server.js) contra un
// almacén en memoria, para probar las pantallas de LOOPA con el modelo
// nuevo sin tocar ningún proyecto de Firebase:
//
//   node _fuente/build.js && node integracion/preview/armar-preview.cjs
//   node integracion/servidor-local/servidor.cjs [--puerto 8790]
//   luego: http://127.0.0.1:8790/?datos=fusion&produccion=demo
//
//   GET  /                 la vista previa (integracion/preview/index.html)
//   GET  /api/datos        ventas, fichas y catálogo (lo que el equipo
//                          comercial puede leer según las reglas en borrador)
//   POST /api/fn/<nombre>  las funciones del servidor, con el mismo contrato
//                          que una función onCall: { data } → { result } o
//                          { error: { status, message, details } }
//   POST /api/fallar       { veces, status } hace fallar las próximas llamadas
//                          (para probar la cola sin red)
//
// Datos de arranque: el respaldo SINTÉTICO de integracion/fixtures/migration
// migrado en memoria. Al apagar, todo se descarta. Escucha sólo en 127.0.0.1.
// Usuario fijo «u-local» (equipo comercial aprobado): no hay inicio de sesión.
// ─────────────────────────────────────────────────────────────────

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const server = require('../../functions/loopa-server');
const { buildMigrationPlan } = require('../../functions/migration/plan');
const { runMigration } = require('../../functions/migration/runner');
const { MemoryStore } = require('../memory-store.cjs');

const RAIZ = path.join(__dirname, '..', '..');
const FX = path.join(RAIZ, 'integracion', 'fixtures');
const leerJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const USUARIO = { uid: 'u-local' };

const FUNCIONES = {
  loopaCreateSale: server.createSale,
  loopaUpdateSale: server.updateSale,
  loopaAddPayment: server.addPayment,
  loopaRemovePayment: server.removePayment,
  loopaSaveClient: server.saveClient,
  loopaSaveService: server.saveService,
};

async function sembrar(store = new MemoryStore()) {
  const ctx = leerJson(path.join(FX, 'context.json'));
  const backupText = fs.readFileSync(path.join(FX, 'migration', 'loopa-backup.json'), 'utf8');
  const frame = leerJson(path.join(FX, 'migration', 'frame-clients.json'));
  const decisions = leerJson(path.join(FX, 'migration', 'client-decisions.json')).decisions || {};
  store.seed('frame_users', USUARIO.uid, { status: 'active' });
  store.seed('loopa_config', 'access', { commercialUids: [USUARIO.uid] });
  store.seed('loopa_config', 'production', { defaultWorkspaceId: ctx.defaultWorkspaceId, allowedWorkspaceIds: ctx.allowedWorkspaceIds });
  Object.entries(ctx.workspaces).forEach(([id, w]) => {
    store.seed('frame_workspaces', id, { name: w.name, memberIds: w.memberIds });
    if (w.statusIds) store.seed(`frame_workspaces/${id}/config`, 'kanban_columns', { columns: w.statusIds.filter(s => s !== 'archived').map(s => ({ id: s, label: s })) });
    if (w.typeIds) store.seed(`frame_workspaces/${id}/config`, 'project_types', { types: w.typeIds.map(t => ({ id: t, label: t })) });
  });
  (frame.clients || []).forEach(c => store.seed('frame_clients', c.id, c));
  const plan = buildMigrationPlan({ backup: JSON.parse(backupText), frameClients: frame.clients || [], decisions, workspaceId: frame.workspaceId });
  if (plan.status !== 'ready') throw new Error(`El respaldo de ejemplo no se pudo migrar: ${plan.status}`);
  const r = await runMigration(store, plan, { runId: 'local-1', archivedBackupText: backupText });
  if (r.status !== 'done') throw new Error(`Migración de ejemplo: ${r.status}`);
  // Los servicios migrados no traen plantilla de producción (la define
  // producción). El catálogo de ejemplo sí: venderlos genera tarjetas.
  leerJson(path.join(FX, 'services.json')).services.forEach(s => store.seed('loopa_services', s.id, s));
  return store;
}

// Lo que el equipo comercial puede leer (reglas en borrador): ventas,
// catálogo y las fichas de los tableros de producción habilitados.
async function datos(store) {
  const cfg = await store.get('loopa_config', 'production');
  const allowed = new Set((cfg && cfg.allowedWorkspaceIds) || []);
  return {
    sales: store.list('loopa_sales'),
    clients: store.list('frame_clients').filter(c => allowed.has(c.workspaceId)),
    services: store.list('loopa_services'),
  };
}

const HTTP = { 'invalid-argument': 400, 'failed-precondition': 400, 'out-of-range': 400, unauthenticated: 401, 'permission-denied': 403, 'not-found': 404, aborted: 409, 'already-exists': 409, 'resource-exhausted': 429, internal: 500, unavailable: 503, 'deadline-exceeded': 504 };

function crearServidor({ store, html = () => fs.readFileSync(path.join(RAIZ, 'integracion', 'preview', 'index.html')), log = () => {} } = {}) {
  let fallas = { veces: 0, status: 'unavailable' };
  const responder = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const leerCuerpo = (req) => new Promise((resolve, reject) => {
    let n = 0; const partes = [];
    // Demasiado grande: se responde 413 (no se corta la conexión a ciegas,
    // que la app vería como «sin red» y reintentaría para siempre).
    req.on('data', c => { n += c.length; if (n > 1_100_000) { req.removeAllListeners('data'); req.resume(); reject(Object.assign(new Error('Los datos son demasiado grandes'), { status: 413 })); } else partes.push(c); });
    req.on('end', () => { try { resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); } });
    req.on('error', reject);
  });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      // Sólo este equipo: otro sitio abierto en el navegador no puede usar el
      // servidor (Host de rebinding de DNS, o POST sin JSON desde un formulario).
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return responder(res, 403, { error: { status: 'permission-denied', message: 'Sólo desde este equipo' } });
      if (req.method === 'POST' && !/^application\/json(;|$)/i.test(String(req.headers['content-type'] || ''))) {
        return responder(res, 415, { error: { status: 'invalid-argument', message: 'Se espera JSON' } });
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return responder(res, 200, html(), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/produccion-demo.json') return responder(res, 200, fs.readFileSync(path.join(RAIZ, 'integracion', 'preview', 'produccion-demo.json')));
      if (req.method === 'GET' && url.pathname === '/api/datos') return responder(res, 200, await datos(store));
      if (req.method === 'POST' && url.pathname === '/api/fallar') {
        const b = await leerCuerpo(req);
        fallas = { veces: Math.max(0, Math.min(50, Number(b.veces) || 0)), status: HTTP[b.status] ? b.status : 'unavailable' };
        return responder(res, 200, { ok: true, ...fallas });
      }
      const m = req.method === 'POST' && url.pathname.match(/^\/api\/fn\/([A-Za-z]+)$/);
      if (m) {
        const fn = Object.prototype.hasOwnProperty.call(FUNCIONES, m[1]) ? FUNCIONES[m[1]] : null;
        if (!fn) return responder(res, 404, { error: { status: 'not-found', message: 'Función desconocida' } });
        const body = await leerCuerpo(req);
        if (fallas.veces > 0) {
          fallas.veces -= 1;
          return responder(res, HTTP[fallas.status], { error: { status: fallas.status, message: 'Falla simulada' } });
        }
        try {
          const result = await fn(store, USUARIO, body.data);
          // Como el disparador onDocumentCreated: el evento se procesa al toque.
          if (result && result.eventId) await server.onEventCreated(store, result.eventId);
          log(`${m[1]} → ${result && result.status}`);
          return responder(res, 200, { result });
        } catch (err) {
          const e = server.toServerError(err);
          log(`${m[1]} ✖ ${e.kind} ${(e.details && e.details.code) || ''}`);
          return responder(res, HTTP[e.kind] || 500, { error: { status: e.kind, message: e.message, ...(e.details ? { details: e.details } : {}) } });
        }
      }
      return responder(res, 404, { error: { status: 'not-found', message: 'No existe' } });
    } catch (err) {
      if (err.status) res.setHeader('connection', 'close');
      return responder(res, err.status || 500, { error: { status: err.status ? 'invalid-argument' : 'internal', message: err.status ? err.message : 'Error interno' } });
    }
  });
}

module.exports = { sembrar, datos, crearServidor, USUARIO };

if (require.main === module) {
  const i = process.argv.indexOf('--puerto');
  const puerto = i > 0 ? Number(process.argv[i + 1]) : 8790;
  if (!fs.existsSync(path.join(RAIZ, 'integracion', 'preview', 'index.html'))) {
    console.error('Falta la vista previa: node _fuente/build.js && node integracion/preview/armar-preview.cjs');
    process.exit(2);
  }
  sembrar().then(store => {
    crearServidor({ store, log: (s) => console.log(new Date().toISOString().slice(11, 19), s) })
      .listen(puerto, '127.0.0.1', () => console.log(`Servidor local de la fusión: http://127.0.0.1:${puerto}/?datos=fusion&produccion=demo`));
  }).catch(err => { console.error(err.message); process.exit(1); });
}
