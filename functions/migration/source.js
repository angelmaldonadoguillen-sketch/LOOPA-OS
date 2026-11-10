'use strict';
// ─────────────────────────────────────────────────────────────────
// Origen de la migración: el respaldo que LOOPA ya exporta desde
// Configuración (loopa-respaldo-AAAA-MM-DD.json) o los documentos agregados
// de la colección `loopa` ({ items: [...] }). Sólo lectura.
//
// El manifiesto (conteos + hash por colección) es la "prueba de respaldo":
// el ejecutor se niega a escribir si no se le presenta el hash exacto del
// origen que se respaldó.
// ─────────────────────────────────────────────────────────────────

const { sha256Hex, canonicalJson } = require('../production-plan/ids');
const { issue } = require('../production-plan/errors');

const COLLECTIONS = ['ventas', 'clientes', 'servicios', 'gastosVariables', 'gastosFijos'];

const listOf = (v) => (Array.isArray(v) ? v : (v && Array.isArray(v.items) ? v.items : null));

function readLoopaSource(raw) {
  const issues = [];
  if (!raw || typeof raw !== 'object') {
    return { source: null, issues: [issue('source.invalid', 'source', 'El origen no es un objeto JSON')] };
  }
  const ventas = listOf(raw.ventas);
  const servicios = listOf(raw.servicios);
  if (!ventas || !servicios) issues.push(issue('source.format', 'source', 'No parece un respaldo de LOOPA OS: faltan ventas o servicios'));
  if (raw.app !== undefined && raw.app !== 'LOOPA OS') issues.push(issue('source.app', 'source.app', `El respaldo es de «${raw.app}», no de LOOPA OS`));
  const gastos = raw.gastos && typeof raw.gastos === 'object' ? raw.gastos : {};
  const source = {
    ventas: ventas || [],
    clientes: listOf(raw.clientes) || [],
    servicios: servicios || [],
    gastosVariables: Array.isArray(gastos.variables) ? gastos.variables : [],
    gastosFijos: Array.isArray(gastos.fijos) ? gastos.fijos : [],
    config: raw.config && typeof raw.config === 'object' ? raw.config : {},
  };
  return { source: issues.length ? null : source, issues };
}

// Hash independiente del orden: se ordena por una clave estable de cada
// elemento antes de hashear. Repetir sobre el mismo respaldo da lo mismo.
const sortKey = (item) => String(item.id || item.creado || `${item.n || ''}|${item.fecha || ''}|${item.nombre || item.concepto || ''}`);
const collectionHash = (items) => sha256Hex(canonicalJson([...items].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0)))).slice(0, 32);

function sourceManifest(source) {
  const collections = {};
  COLLECTIONS.forEach(k => { collections[k] = { count: source[k].length, hash: collectionHash(source[k]) }; });
  collections.config = { count: 1, hash: sha256Hex(canonicalJson(source.config)).slice(0, 32) };
  const total = sha256Hex(canonicalJson(collections)).slice(0, 32);
  return { schemaVersion: 1, collections, total };
}

// Recibo de respaldo: se calcula leyendo el ARCHIVO guardado (bytes), no el
// plan. Prueba que el respaldo archivado contiene exactamente el origen del
// plan. El ejecutor exige este recibo.
function backupReceipt(fileText) {
  const fileSha256 = sha256Hex(String(fileText));
  let parsed;
  try { parsed = JSON.parse(fileText); } catch (e) { return { ok: false, reason: 'backup_not_json', fileSha256 }; }
  const { source, issues } = readLoopaSource(parsed);
  if (!source) return { ok: false, reason: 'backup_invalid', fileSha256, issues };
  const manifest = sourceManifest(source);
  return { ok: true, fileSha256, manifestTotal: manifest.total, counts: Object.fromEntries(Object.entries(manifest.collections).map(([k, v]) => [k, v.count])) };
}

module.exports = { readLoopaSource, sourceManifest, backupReceipt };
