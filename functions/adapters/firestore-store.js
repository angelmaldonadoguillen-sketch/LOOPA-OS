'use strict';
// ─────────────────────────────────────────────────────────────────
// Adaptador Firestore (Admin SDK) del almacén que usan el integrador, el
// repositorio de ventas y la migración. Misma interfaz que MemoryStore:
//
//   await store.get(col, id)                 → datos | null
//   await store.create(col, id, data)        → falla 'already-exists'
//   await store.queryEquals(col, field, v)   → datos[] ordenados por id
//   await store.hasDocuments(col)            → boolean (col puede ser "a/b/c")
//   await store.transaction(fn, maxAttempts) → fn(tx) con tx.get/create/update
//
// No tiene delete(): el integrador nunca borra.
//
// Recibe la instancia `db` ya creada: este archivo no carga firebase-admin
// (se prueba con Node sin dependencias y no decide a qué proyecto hablar).
// Los datos se validan con las mismas reglas que MemoryStore
// (firestore-data.js), así ninguna prueba en memoria pasa con algo que
// Firestore rechazaría.
//
// SEGURIDAD (tanda 2.6): por defecto SÓLO acepta un `db` que de verdad apunte
// al emulador LOCAL (host de loopback, sin TLS) con un proyecto "demo-*", que
// el emulador garantiza aislado de la nube. Se mira la configuración real del
// db (no una variable de entorno ni una opción) y se vuelve a mirar en cada
// operación, por si alguien llamó db.settings() después de construir el
// almacén. Hablar con un proyecto real exige `allowRemote: true` (Fase 3, con
// aprobación).
// ─────────────────────────────────────────────────────────────────

const data = require('./firestore-data');
const { sanitizeText } = require('../production-plan/errors');

// Códigos gRPC del Admin SDK → los nombres que usa el resto del código.
const GRPC = {
  1: 'cancelled', 2: 'unknown', 3: 'invalid-argument', 4: 'deadline-exceeded', 5: 'not-found',
  6: 'already-exists', 7: 'permission-denied', 8: 'resource-exhausted', 9: 'failed-precondition',
  10: 'aborted', 11: 'out-of-range', 12: 'unimplemented', 13: 'internal', 14: 'unavailable',
  15: 'data-loss', 16: 'unauthenticated',
};
const NAMES = Object.values(GRPC);

// Errores del SDK → { code, message } limpios: sin el error original (trae
// detalles gRPC de la conexión) ni host:puerto en el texto. Los errores del
// dominio (counter_missing, contract_invalid…) pasan intactos.
function normalizeError(err) {
  if (!err || typeof err !== 'object') return err;
  let code = err.code;
  if (typeof code === 'number') code = GRPC[code] || 'unknown';
  else if (typeof code === 'string' && /^firestore\//.test(code)) code = code.slice('firestore/'.length);
  else if (typeof code === 'string' && /^[A-Z_]+$/.test(code) && NAMES.includes(code.toLowerCase().replace(/_/g, '-'))) code = code.toLowerCase().replace(/_/g, '-');
  // Sin code: un error de programación dentro de fn (TypeError…) o una
  // validación del SDK que firestore-data.js ya debería haber atajado. Sube
  // tal cual para no perder la traza.
  if (code === err.code) return err;
  const message = sanitizeText(String(err.details || err.message || code))
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<host>')
    .replace(/\b[a-z0-9.-]+\.[a-z]{2,}:\d+\b/gi, '<host>');
  return Object.assign(new Error(message || code), { code });
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const remoteError = (message) => Object.assign(new Error(message), { code: 'remote_not_allowed' });

function projectIdOf(db) {
  let id = '';
  try { id = (db && db.projectId) || ''; } catch (e) { /* el SDK aún no lo resolvió */ }
  if (!id && db && db._settings) id = db._settings.projectId || '';
  return String(id);
}

// Lo que importa es a dónde va a hablar ESTE db.
function assertLocal(db) {
  const s = (db && db._settings) || {};
  if (!LOOPBACK.has(String(s.servicePath || '').toLowerCase()) || s.ssl !== false) {
    throw remoteError('Este almacén sólo habla con el emulador local (host de loopback, sin TLS)');
  }
  if (!/^demo-[a-z0-9-]+$/.test(projectIdOf(db))) {
    throw remoteError('El proyecto del emulador debe llamarse demo-*: así nunca toca la nube');
  }
}

class FirestoreStore {
  // opts.allowRemote: sólo la Fase 3, con aprobación explícita.
  constructor(db, opts = {}) {
    this.db = db;
    this.allowRemote = opts.allowRemote === true;
    this.guard();
  }

  guard() { if (!this.allowRemote) assertLocal(this.db); }

  ref(col, id) {
    this.guard();
    data.validateCollectionPath(col);
    data.validateDocId(id);
    return this.db.collection(col).doc(id);
  }

  async get(col, id) {
    const r = this.ref(col, id);
    try {
      const snap = await r.get();
      return snap.exists ? snap.data() : null;
    } catch (err) { throw normalizeError(err); }
  }

  async create(col, id, doc) {
    data.validateDocument(doc);
    const r = this.ref(col, id);
    try { await r.create(doc); } catch (err) { throw normalizeError(err); }
  }

  async queryEquals(col, field, value) {
    this.guard();
    data.validateCollectionPath(col);
    data.validateQuery(field, value);
    try {
      // Sin orderBy explícito Firestore devuelve por id de documento, como
      // MemoryStore; no hace falta índice compuesto.
      const snap = await this.db.collection(col).where(field, '==', value).get();
      return snap.docs.map(d => d.data());
    } catch (err) { throw normalizeError(err); }
  }

  async hasDocuments(col) {
    this.guard();
    data.validateCollectionPath(col);
    try {
      const snap = await this.db.collection(col).limit(1).get();
      return !snap.empty;
    } catch (err) { throw normalizeError(err); }
  }

  // Ojo: el SDK vuelve a ejecutar fn si el commit falla por contención o por
  // un error de red reintentable, aun cuando el commit haya entrado (respuesta
  // perdida). Por eso fn debe ser idempotente (ver claim() en el ejecutor).
  async transaction(fn, maxAttempts = 5) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw Object.assign(new Error('maxAttempts debe ser un entero ≥ 1'), { code: 'invalid-argument' });
    this.guard();
    try {
      return await this.db.runTransaction(async (t) => {
        let wrote = false;
        const tx = {
          get: async (col, id) => {
            // El Admin SDK también lo exige; acá se falla igual que MemoryStore.
            if (wrote) throw Object.assign(new Error('Firestore exige todas las lecturas antes de las escrituras'), { code: 'invalid-argument' });
            const snap = await t.get(this.ref(col, id));
            return snap.exists ? snap.data() : null;
          },
          create: (col, id, doc) => { data.validateDocument(doc); wrote = true; t.create(this.ref(col, id), doc); },
          update: (col, id, patch) => { data.validatePatch(patch); wrote = true; t.update(this.ref(col, id), patch); },
        };
        return fn(tx);
      }, { maxAttempts });
    } catch (err) { throw normalizeError(err); }
  }
}

module.exports = { FirestoreStore, normalizeError, GRPC };
