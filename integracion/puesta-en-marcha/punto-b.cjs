'use strict';
// ─────────────────────────────────────────────────────────────────────
// Punto B (migración) — utilidades PURAS para el respaldo de sólo lectura
// (respaldo-b.cjs). Sin red ni Firebase: se prueban con node
// (integracion/test/punto-b.test.cjs).
//
//   permitidoB     la única puerta a la red: GET a Firestore REST, sólo a
//                  los 5 documentos de LOOPA en tooned-os y a 3 colecciones
//                  de FRAME en frame-studio-3a18f
//   decodificar    documento de Firestore REST → objeto JS (falla ante lo
//                  que no se puede representar sin perder datos)
//   armarRespaldo  los 5 documentos → la forma del respaldo que LOOPA exporta
// ─────────────────────────────────────────────────────────────────────

const ORIGEN = 'tooned-os';
const DESTINO = 'frame-studio-3a18f';
const DOCS_LOOPA = ['ventas', 'clientes', 'servicios', 'config', 'gastos'];
const COLECCIONES_FRAME = ['frame_workspaces', 'frame_clients', 'frame_users'];
const BASE = (p) => `https://firestore.googleapis.com/v1/projects/${p}/databases/(default)/documents`;

const urlsB = {
  loopa: (k) => {
    if (!DOCS_LOOPA.includes(k)) throw new Error(`documento de LOOPA inesperado: ${k}`);
    return `${BASE(ORIGEN)}/loopa/${k}`;
  },
  frame: (c, pagina) => {
    if (!COLECCIONES_FRAME.includes(c)) throw new Error(`colección inesperada: ${c}`);
    return `${BASE(DESTINO)}/${c}?pageSize=300${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`;
  },
};

function permitidoB(metodo, url) {
  if (metodo !== 'GET') return false;
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.hostname !== 'firestore.googleapis.com') return false;
  if (u.username || u.password || u.port || u.hash || u.pathname.includes('%')) return false;
  if (![...u.searchParams.keys()].every(k => k === 'pageSize' || k === 'pageToken')) return false;
  const loopa = new RegExp(`^/v1/projects/${ORIGEN}/databases/\\(default\\)/documents/loopa/(${DOCS_LOOPA.join('|')})$`);
  const frame = new RegExp(`^/v1/projects/${DESTINO}/databases/\\(default\\)/documents/(${COLECCIONES_FRAME.join('|')})$`);
  if (loopa.test(u.pathname)) return u.search === '';
  return frame.test(u.pathname);
}

// ── Firestore REST → JS ───────────────────────────────────────────
function valor(v, ruta) {
  if (!v || typeof v !== 'object') throw new Error(`valor inválido en ${ruta}`);
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) {
    const n = Number(v.integerValue);
    if (!Number.isSafeInteger(n)) throw new Error(`entero fuera de rango en ${ruta}: ${v.integerValue}`);
    return n;
  }
  if ('doubleValue' in v) {
    const n = Number(v.doubleValue);
    if (!Number.isFinite(n)) throw new Error(`número no finito en ${ruta}: ${v.doubleValue}`);
    return n;
  }
  // Fechas de Firestore (p. ej. createdAt de FRAME): quedan como texto ISO,
  // marcadas, para que nada las reescriba como texto sin querer.
  if ('timestampValue' in v) return { __timestamp: v.timestampValue };
  if ('mapValue' in v) return campos((v.mapValue && v.mapValue.fields) || {}, ruta);
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map((x, i) => valor(x, `${ruta}[${i}]`));
  if ('referenceValue' in v) return { __referencia: v.referenceValue };
  throw new Error(`tipo de Firestore no soportado en ${ruta}: ${Object.keys(v).join(',')}`);
}
function campos(fields, ruta = '') {
  const out = {};
  Object.keys(fields).forEach(k => { out[k] = valor(fields[k], ruta ? `${ruta}.${k}` : k); });
  return out;
}
// { name, fields } → { id, ...datos }
function decodificar(doc) {
  const name = String(doc && doc.name || '');
  const id = name.split('/').pop();
  if (!id) throw new Error('documento sin nombre');
  return { id, datos: campos((doc && doc.fields) || {}, id) };
}

// Los 5 documentos (o null si no existen) → respaldo con la forma del
// export de LOOPA (Configuración → Respaldo), que lee functions/migration/source.js.
function armarRespaldo(docs, exportado) {
  const faltan = ['ventas', 'servicios'].filter(k => !docs[k]);
  if (faltan.length) throw new Error(`No existen en tooned-os: loopa/${faltan.join(', loopa/')}`);
  const out = { app: 'LOOPA OS', version: 1, exportado, origen: `${ORIGEN}/loopa (lectura directa, punto B0)` };
  DOCS_LOOPA.forEach(k => { out[k] = docs[k] || null; });
  return out;
}

// Resumen sin datos personales, para el informe.
function resumenRespaldo(r) {
  const n = (x) => (Array.isArray(x) ? x.length : (x && Array.isArray(x.items) ? x.items.length : 0));
  const g = r.gastos || {};
  return {
    ventas: n(r.ventas), clientes: n(r.clientes), servicios: n(r.servicios),
    gastosVariables: Array.isArray(g.variables) ? g.variables.length : 0,
    gastosFijos: Array.isArray(g.fijos) ? g.fijos.length : 0,
  };
}

module.exports = { ORIGEN, DESTINO, DOCS_LOOPA, COLECCIONES_FRAME, urlsB, permitidoB, valor, decodificar, armarRespaldo, resumenRespaldo };
