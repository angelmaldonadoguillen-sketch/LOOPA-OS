'use strict';
// ─────────────────────────────────────────────────────────────────
// Almacén en memoria con la semántica de Firestore que importa acá:
//
//   · create() con precondición: falla con 'already-exists' si el doc existe
//   · transacciones optimistas: si un documento leído cambió antes de
//     confirmar, se reintenta la función entera (como Firestore)
//   · cada operación cede el turno (setImmediate), así dos ejecuciones en
//     Promise.all se entrelazan de verdad y las carreras aparecen en pruebas
//   · fallos inyectables por operación y colección
//
// No tiene delete(): el integrador no debe borrar nada, y si alguna vez lo
// intentara, la prueba fallaría por método inexistente.
//
// Sólo para pruebas y para el simulador. Nunca habla con la red.
// ─────────────────────────────────────────────────────────────────

const clone = (v) => (v === undefined || v === null ? null : structuredClone(v));
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));

const storeError = (code, message) => Object.assign(new Error(message), { code });

// Lo que Firestore rechaza (undefined, arrays anidados, huecos, Date, Map,
// claves vacías o reservadas, documentos enormes, claves con '.' o '/' en un
// update…) se rechaza acá con las MISMAS reglas que el adaptador real
// (functions/adapters/firestore-data.js): una prueba en memoria no puede
// pasar con datos que Firestore no aceptaría.
const fsData = require('../functions/adapters/firestore-data');
const checkRef = (col, id) => { fsData.validateCollectionPath(col); fsData.validateDocId(id); };

class MemoryStore {
  constructor() {
    this.docs = new Map();      // "col/id" → { data, ver }
    this.clock = 0;
    this.faults = [];
    this.successes = new Map(); // "op:col" → count
    this.stats = { creates: 0, updates: 0, txCommits: 0, txRetries: 0 };
  }

  static key(col, id) { return `${col}/${id}`; }

  seed(col, id, data) {
    checkRef(col, id); fsData.validateDocument(data);
    this.docs.set(MemoryStore.key(col, id), { data: clone(data), ver: ++this.clock });
  }

  // Escritura externa con merge superficial (como la que hará la app al
  // editar una venta): conserva campos que no conoce, p. ej. el candado.
  merge(col, id, patch) {
    const key = MemoryStore.key(col, id);
    const prev = this.docs.get(key);
    checkRef(col, id); fsData.validatePatch(patch);
    this.docs.set(key, { data: { ...(prev ? prev.data : {}), ...clone(patch) }, ver: ++this.clock });
  }

  // Falla la operación número (after + 1) de ese tipo, `times` veces.
  injectFault({ op, collection, after = 0, times = 1, code = 'unavailable', message = 'Fallo simulado de red' }) {
    this.faults.push({ op, collection, after, remaining: times, code, message });
  }

  checkFault(op, col) {
    const count = this.successes.get(`${op}:${col}`) || 0;
    const fault = this.faults.find(f => f.op === op && f.collection === col && f.remaining > 0 && count >= f.after);
    if (fault) {
      fault.remaining -= 1;
      throw storeError(fault.code, fault.message);
    }
  }

  ok(op, col) { this.successes.set(`${op}:${col}`, (this.successes.get(`${op}:${col}`) || 0) + 1); }

  async get(col, id) {
    checkRef(col, id);
    await yieldTurn();
    const entry = this.docs.get(MemoryStore.key(col, id));
    return entry ? clone(entry.data) : null;
  }

  async create(col, id, data) {
    await yieldTurn();
    checkRef(col, id); fsData.validateDocument(data);
    this.checkFault('create', col);
    const key = MemoryStore.key(col, id);
    if (this.docs.has(key)) throw storeError('already-exists', `El documento ${key} ya existe`);
    this.docs.set(key, { data: clone(data), ver: ++this.clock });
    this.stats.creates += 1;
    this.ok('create', col);
  }

  async queryEquals(col, field, value) {
    fsData.validateCollectionPath(col); fsData.validateQuery(field, value);
    await yieldTurn();
    const prefix = `${col}/`;
    return [...this.docs.entries()]
      .filter(([key, entry]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/') && entry.data[field] === value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, entry]) => clone(entry.data));
  }

  // ¿Hay algún documento en la colección (o subcolección "a/b/c")? En
  // Firestore: col.limit(1).get().
  async hasDocuments(col) {
    fsData.validateCollectionPath(col);
    await yieldTurn();
    const prefix = `${col}/`;
    return [...this.docs.keys()].some(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'));
  }

  list(col) {
    const prefix = `${col}/`;
    return [...this.docs.entries()]
      .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, entry]) => clone(entry.data));
  }

  // Firestore reintenta 5 veces por defecto.
  async transaction(fn, maxAttempts = 5) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw storeError('invalid-argument', 'maxAttempts debe ser un entero ≥ 1');
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const reads = new Map();
      const writes = [];
      const tx = {
        get: async (col, id) => {
          if (writes.length) throw storeError('invalid-argument', 'Firestore exige todas las lecturas antes de las escrituras');
          checkRef(col, id);
          await yieldTurn();
          const key = MemoryStore.key(col, id);
          const entry = this.docs.get(key);
          reads.set(key, entry ? entry.ver : 0);
          return entry ? clone(entry.data) : null;
        },
        create: (col, id, data) => { checkRef(col, id); fsData.validateDocument(data); writes.push({ op: 'create', col, id, data: clone(data) }); },
        update: (col, id, patch) => { checkRef(col, id); fsData.validatePatch(patch); writes.push({ op: 'update', col, id, data: clone(patch) }); },
      };
      const result = await fn(tx);
      await yieldTurn();
      // Confirmación atómica (sin await de por medio).
      const stale = [...reads.entries()].some(([key, ver]) => {
        const entry = this.docs.get(key);
        return (entry ? entry.ver : 0) !== ver;
      });
      if (stale) { this.stats.txRetries += 1; continue; }
      // Las escrituras se evalúan EN ORDEN, como Firestore: crear y después
      // actualizar el mismo documento en una transacción es válido.
      const willExist = new Set();
      for (const w of writes) {
        this.checkFault(`tx-${w.op}`, w.col);
        const key = MemoryStore.key(w.col, w.id);
        const exists = this.docs.has(key) || willExist.has(key);
        if (w.op === 'create' && exists) throw storeError('already-exists', `El documento ${key} ya existe`);
        if (w.op === 'update' && !exists) throw storeError('not-found', `El documento ${key} no existe`);
        willExist.add(key);
      }
      writes.forEach(w => {
        const key = MemoryStore.key(w.col, w.id);
        const data = w.op === 'create' ? w.data : { ...this.docs.get(key).data, ...w.data };
        this.docs.set(key, { data, ver: ++this.clock });
        if (w.op === 'update') this.stats.updates += 1; else this.stats.creates += 1;
        this.ok(`tx-${w.op}`, w.col);
      });
      this.stats.txCommits += 1;
      return result;
    }
    throw storeError('aborted', 'La transacción no pudo confirmarse por contención');
  }
}

module.exports = { MemoryStore };
