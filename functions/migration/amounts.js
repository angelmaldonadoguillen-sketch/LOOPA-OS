'use strict';
// ─────────────────────────────────────────────────────────────────
// Lectura estricta de importes del esquema viejo.
//
// LOOPA guardaba importes como número o como texto ("9,000"). Su función
// num() quitaba las comas y convertía lo ilegible en 0: "L 6,000" → 0 y
// "1.500,50" → 1.5005, en silencio. La migración no hereda eso:
//
//   number finito          → se usa tal cual
//   "1500" / "1500.5"      → número
//   "1,500" / "1,500.50"   → número + advertencia (formato con miles)
//   vacío / null           → 0 (campo opcional)
//   cualquier otra cosa    → ERROR: se corrige la venta en LOOPA y se repite
//
// Es un parser distinto del de la app vieja a propósito: la conciliación
// compara contra él, así que un importe mal leído no puede "cuadrar".
// ─────────────────────────────────────────────────────────────────

const PLAIN = /^-?\d+(\.\d+)?$/;
const THOUSANDS = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/;
// Formas numéricas sin ambigüedad que num() también leía bien: "9000.",
// ".5", "+500", "1e3". Se aceptan con advertencia.
const LOOSE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, kind: 'number' } : { value: NaN, kind: 'invalid' };
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { value: 0, kind: 'empty' };
  if (typeof raw !== 'string') return { value: NaN, kind: 'invalid' };
  const s = raw.trim();
  if (PLAIN.test(s)) return { value: Number(s), kind: 'plain' };
  if (THOUSANDS.test(s)) return { value: Number(s.replace(/,/g, '')), kind: 'thousands' };
  if (LOOSE.test(s) && Number.isFinite(Number(s))) return { value: Number(s), kind: 'loose' };
  return { value: NaN, kind: 'invalid' };
}

module.exports = { parseAmount };
