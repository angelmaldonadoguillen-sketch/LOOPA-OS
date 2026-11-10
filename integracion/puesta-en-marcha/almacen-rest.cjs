'use strict';
// ─────────────────────────────────────────────────────────────────────
// Punto B — almacén de la migración sobre la API REST de Firestore.
//
// Misma interfaz que MemoryStore y FirestoreStore para lo que usa el ejecutor
// (functions/migration/runner.js):
//   await store.get(col, id)              → datos | null
//   await store.transaction(fn, intentos) → fn(tx) con tx.get / create / update
//
// Por qué REST y no el Admin SDK: en esta PC no hay credenciales de servicio
// (ni gcloud). La sesión del Firebase CLI da un token OAuth del dueño del
// proyecto, que habla con la API REST.
//
// Límites (además de los del ejecutor, que nunca sobrescribe ni borra):
//   · sólo las colecciones de la migración (COLECCIONES);
//   · create = escribir con «el documento NO existe»; update = sólo los campos
//     indicados y con «el documento SÍ existe». Sin borrados ni transforms;
//   · toda llamada pasa por permitidoAlmacen() (sólo esta base de datos).
//
// Se prueba con el emulador (integracion/emulador/migracion-rest.test.cjs),
// comparando documento por documento con la corrida en memoria.
// ─────────────────────────────────────────────────────────────────────

const COLECCIONES = ['frame_clients', 'loopa_sales', 'loopa_services', 'loopa_expenses', 'loopa_config', 'loopa_counters', 'loopa_migrations'];
// «.» y «..» no son ids de Firestore (y en una URL suben de carpeta).
const ID = /^(?!\.\.?$)[A-Za-z0-9_.-]{1,200}$/;

// ── JS ⇄ Firestore Value ──────────────────────────────────────────
function aValor(v, ruta = '') {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`número no finito en ${ruta}`);
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map((x, i) => aValor(x, `${ruta}[${i}]`)) } };
  if (typeof v === 'object') {
    const k = Object.keys(v);
    if (k.length === 1 && k[0] === '__timestamp' && typeof v.__timestamp === 'string') return { timestampValue: v.__timestamp };
    if (Object.getPrototypeOf(v) !== Object.prototype) throw new Error(`objeto no plano en ${ruta}`);
    return { mapValue: { fields: aCampos(v, ruta) } };
  }
  throw new Error(`tipo no soportado en ${ruta}: ${typeof v}`);
}
function aCampos(obj, ruta = '') {
  const out = {};
  Object.keys(obj).forEach(k => {
    if (obj[k] === undefined) return; // como el Admin SDK con ignoreUndefinedProperties
    out[k] = aValor(obj[k], ruta ? `${ruta}.${k}` : k);
  });
  return out;
}
function deValor(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) {
    const n = Number(v.integerValue);
    if (!Number.isSafeInteger(n)) throw new Error(`entero fuera de rango: ${v.integerValue}`);
    return n;
  }
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return { __timestamp: v.timestampValue };
  if ('mapValue' in v) return deCampos((v.mapValue && v.mapValue.fields) || {});
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(deValor);
  throw new Error(`tipo de Firestore no soportado: ${Object.keys(v).join(',')}`);
}
function deCampos(f) { const o = {}; Object.keys(f).forEach(k => { o[k] = deValor(f[k]); }); return o; }

// Ruta de campo de primer nivel (las claves raras van entre comillas invertidas).
const rutaCampo = (k) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(k) ? k : `\`${k.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``);

// ── La puerta ─────────────────────────────────────────────────────
// base: https://firestore.googleapis.com/v1/projects/<p>/databases/(default)
//    o: http://127.0.0.1:<puerto>/v1/projects/demo-<x>/databases/(default)
function baseValida(base) {
  return /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/[a-z0-9-]+\/databases\/\(default\)$/.test(base)
    || /^http:\/\/127\.0\.0\.1:\d{2,5}\/v1\/projects\/demo-[a-z0-9-]+\/databases\/\(default\)$/.test(base);
}
function permitidoAlmacen(metodo, url, base) {
  if (!baseValida(base) || typeof url !== 'string' || !url.startsWith(`${base}/documents`)) return false;
  const resto = url.slice(`${base}/documents`.length);
  if (metodo === 'POST') return [':beginTransaction', ':commit', ':rollback', ':batchGet'].includes(resto);
  if (metodo !== 'GET') return false;
  const m = /^\/([a-z_]+)\/([A-Za-z0-9_.-]+)$/.exec(resto);
  return !!m && COLECCIONES.includes(m[1]) && ID.test(m[2]);
}
// Un nombre completo de documento de la migración en esta base.
function nombreValido(nombre, base) {
  const prefijo = `${base.replace(/^https?:\/\/[^/]+\/v1\//, '')}/documents/`;
  if (typeof nombre !== 'string' || !nombre.startsWith(prefijo)) return false;
  const [col, id, ...resto] = nombre.slice(prefijo.length).split('/');
  return !resto.length && COLECCIONES.includes(col) && ID.test(id || '');
}
// Cada escritura del commit: sólo crear (no existe) o actualizar campos (existe).
function escrituraValida(w, base) {
  if (!nombreValido(w && w.update && w.update.name, base)) return false;
  const claves = Object.keys(w).sort().join(',');
  if (w.currentDocument && w.currentDocument.exists === false) return claves === 'currentDocument,update';
  if (w.currentDocument && w.currentDocument.exists === true) {
    return claves === 'currentDocument,update,updateMask' && Array.isArray(w.updateMask.fieldPaths) && w.updateMask.fieldPaths.length > 0;
  }
  return false;
}

const CODIGOS = { 400: 'invalid-argument', 401: 'unauthenticated', 403: 'permission-denied', 404: 'not-found', 409: 'aborted', 412: 'failed-precondition', 429: 'resource-exhausted', 500: 'internal', 503: 'unavailable', 504: 'deadline-exceeded' };
function errorDe(status, cuerpo) {
  const s = (cuerpo && cuerpo.error && cuerpo.error.status) || '';
  // ALREADY_EXISTS llega como 409 igual que ABORTED: se distingue por el status.
  const code = s === 'ALREADY_EXISTS' ? 'already-exists' : s === 'ABORTED' ? 'aborted' : (s ? s.toLowerCase().replace(/_/g, '-') : (CODIGOS[status] || 'unknown'));
  return Object.assign(new Error(`${status} ${s}`.trim()), { code });
}

class AlmacenRest {
  // pedir(metodo, url, cuerpo) → { status, cuerpo }: el transporte (fetch con
  // el token, o un doble en las pruebas).
  constructor({ base, pedir }) {
    if (!baseValida(base)) throw new Error(`Base de Firestore no válida: ${base}`);
    this.base = base;
    this.pedir = pedir;
  }

  url(col, id) {
    if (!COLECCIONES.includes(col) || !ID.test(String(id))) throw Object.assign(new Error(`Fuera de la migración: ${col}/${id}`), { code: 'invalid-argument' });
    return `${this.base}/documents/${col}/${id}`;
  }
  nombre(col, id) { return this.url(col, id).replace(/^https?:\/\/[^/]+\/v1\//, ''); }

  async llamar(metodo, url, cuerpo) {
    if (!permitidoAlmacen(metodo, url, this.base)) throw new Error(`Llamada no permitida: ${metodo} ${url}`);
    if (metodo === 'POST' && url.endsWith(':commit')) {
      if (!(cuerpo.writes || []).every(w => escrituraValida(w, this.base))) throw new Error('Escritura no permitida en el commit');
    }
    if (metodo === 'POST' && url.endsWith(':batchGet')) {
      const docs = (cuerpo && cuerpo.documents) || [];
      if (docs.length !== 1 || !nombreValido(docs[0], this.base)) throw new Error('Lectura no permitida');
    }
    const r = await this.pedir(metodo, url, cuerpo);
    if (r.status >= 200 && r.status < 300) return r.cuerpo || {};
    throw errorDe(r.status, r.cuerpo);
  }

  async leer(col, id, transaccion) {
    if (transaccion) {
      // Dentro de una transacción, como los SDK: batchGet (el emulador no
      // responde un GET con ?transaction=).
      const r = await this.llamar('POST', `${this.base}/documents:batchGet`, { documents: [this.nombre(col, id)], transaction: transaccion });
      const fila = (Array.isArray(r) ? r : []).find(x => x.found || x.missing);
      if (!fila) throw Object.assign(new Error('batchGet sin respuesta'), { code: 'unavailable' });
      return fila.found ? deCampos(fila.found.fields || {}) : null;
    }
    try {
      const d = await this.llamar('GET', this.url(col, id));
      return deCampos(d.fields || {});
    } catch (err) {
      if (err.code === 'not-found') return null;
      throw err;
    }
  }

  get(col, id) { return this.leer(col, id, null); }

  async transaction(fn, maxAttempts = 5) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw Object.assign(new Error('maxAttempts debe ser un entero ≥ 1'), { code: 'invalid-argument' });
    let ultimo;
    for (let intento = 1; intento <= maxAttempts; intento += 1) {
      const { transaction: t } = await this.llamar('POST', `${this.base}/documents:beginTransaction`, { options: { readWrite: {} } });
      const writes = [];
      const tx = {
        get: async (col, id) => {
          if (writes.length) throw Object.assign(new Error('Firestore exige todas las lecturas antes de las escrituras'), { code: 'invalid-argument' });
          return this.leer(col, id, t);
        },
        create: (col, id, doc) => { writes.push({ update: { name: this.nombre(col, id), fields: aCampos(doc) }, currentDocument: { exists: false } }); },
        update: (col, id, patch) => {
          const claves = Object.keys(patch).filter(k => patch[k] !== undefined);
          if (!claves.length) throw Object.assign(new Error('update sin campos'), { code: 'invalid-argument' });
          writes.push({ update: { name: this.nombre(col, id), fields: aCampos(patch) }, updateMask: { fieldPaths: claves.map(rutaCampo) }, currentDocument: { exists: true } });
        },
      };
      let resultado;
      try {
        resultado = await fn(tx);
      } catch (err) {
        await this.llamar('POST', `${this.base}/documents:rollback`, { transaction: t }).catch(() => {});
        throw err;
      }
      try {
        await this.llamar('POST', `${this.base}/documents:commit`, { writes, transaction: t });
        return resultado;
      } catch (err) {
        ultimo = err;
        // Una transacción abierta retiene los documentos que leyó: se cierra
        // antes de seguir (si el commit sí entró, el rollback falla y no importa).
        await this.llamar('POST', `${this.base}/documents:rollback`, { transaction: t }).catch(() => {});
        // Contención: se repite fn entera (como el SDK). Por eso fn debe ser idempotente.
        if (err.code !== 'aborted' && err.code !== 'unavailable') throw err;
      }
    }
    throw ultimo;
  }
}

module.exports = { AlmacenRest, COLECCIONES, aValor, aCampos, deValor, deCampos, rutaCampo, permitidoAlmacen, escrituraValida, nombreValido, baseValida, errorDe };
