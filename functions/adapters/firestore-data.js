'use strict';
// ─────────────────────────────────────────────────────────────────
// Qué acepta Firestore, validado ANTES de escribir. Lo usan el adaptador real
// y MemoryStore: así una prueba en memoria no puede pasar con datos que
// Firestore rechazaría (o convertiría en otra cosa). Todos los errores llevan
// code 'invalid-argument'.
//
//   · valores: null, boolean, number, string, objeto plano y array;
//   · sin undefined, funciones, símbolos, bigint, Date (vuelve como
//     Timestamp), Map ni instancias de clases;
//   · sin arrays anidados directamente ni huecos en arrays;
//   · claves de mapa no vacías y no reservadas (__x__);
//   · documento ≤ ~1 MiB (se estima con margen);
//   · ids y rutas: segmentos no vacíos, sin '/', ni '.'/'..', ni __x__.
// ─────────────────────────────────────────────────────────────────

const MAX_DOC_BYTES = 1000 * 1000; // margen bajo el límite de 1 MiB de Firestore

const invalid = (message) => Object.assign(new Error(message), { code: 'invalid-argument' });
const reserved = (k) => /^__.*__$/.test(k);
const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

function validateValue(value, path) {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'boolean' || t === 'number') return;
  if (t === 'undefined') throw invalid(`Valor undefined en ${path || 'el documento'}`);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value)) throw invalid(`Hueco en el array ${path}[${i}]`);
      if (Array.isArray(value[i])) throw invalid(`Array dentro de array en ${path}[${i}]: Firestore no lo admite`);
      validateValue(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const k of Object.keys(value)) {
      if (k === '') throw invalid(`Clave vacía en ${path || 'el documento'}`);
      if (reserved(k)) throw invalid(`Clave reservada ${k} en ${path || 'el documento'}`);
      validateValue(value[k], path ? `${path}.${k}` : k);
    }
    return;
  }
  const kind = t === 'object' ? (value.constructor && value.constructor.name) || 'objeto' : t;
  throw invalid(`Tipo no admitido (${kind}) en ${path || 'el documento'}`);
}

function validateDocument(data) {
  if (!isPlainObject(data)) throw invalid('El documento debe ser un objeto plano');
  validateValue(data, '');
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_DOC_BYTES) throw invalid('El documento supera el tamaño máximo de Firestore');
}

// update(): merge SUPERFICIAL de campos de primer nivel. El SDK interpreta
// '.' como ruta de campo y rechaza '/': esas claves no son de primer nivel.
function validatePatch(patch) {
  if (!isPlainObject(patch)) throw invalid('El cambio debe ser un objeto plano');
  const bad = Object.keys(patch).filter(k => k === '' || k.includes('.') || k.includes('/') || reserved(k));
  if (bad.length) throw invalid(`Claves no válidas para update: ${bad.join(', ')}`);
  validateValue(patch, '');
}

function validateDocId(id) {
  if (typeof id !== 'string' || id === '' || id.includes('/') || id === '.' || id === '..' || reserved(id) || Buffer.byteLength(id, 'utf8') > 1500) {
    throw invalid('Id de documento inválido');
  }
}

function validateCollectionPath(col) {
  const segs = String(col).split('/');
  if (typeof col !== 'string' || segs.length % 2 !== 1) throw invalid(`Ruta de colección inválida: ${col}`);
  segs.forEach(validateDocId);
}

// queryEquals compara un campo de PRIMER NIVEL con un valor primitivo (como
// MemoryStore, que usa ===). Con '.' Firestore seguiría la ruta anidada.
function validateQuery(field, value) {
  if (typeof field !== 'string' || field === '' || field.includes('.') || reserved(field)) throw invalid(`Campo de consulta inválido: ${field}`);
  if (!(value === null || ['string', 'number', 'boolean'].includes(typeof value))) throw invalid('El valor de la consulta debe ser primitivo');
}

module.exports = { validateDocument, validatePatch, validateDocId, validateCollectionPath, validateQuery, MAX_DOC_BYTES };
