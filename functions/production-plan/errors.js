'use strict';
// ─────────────────────────────────────────────────────────────────
// Errores legibles y saneados.
//
// Un problema de validación es { code, path, message, severity }:
//   code     — estable, para pruebas y para la interfaz (no cambia de texto)
//   path     — dónde está el dato, p. ej. "lines[1].quantity"
//   message  — en español, sin volcar el payload
//   severity — 'error' bloquea la generación; 'warning' se informa
//
// sanitizeError() es lo único que se guarda en una venta o evento cuando algo
// falla: nunca el stack, nunca el payload, nunca emails ni tokens.
// ─────────────────────────────────────────────────────────────────

const issue = (code, path, message, severity = 'error') => ({ code, path, message, severity });

class ContractError extends Error {
  constructor(issues, label = 'Datos inválidos') {
    const list = Array.isArray(issues) ? issues : [issues];
    super(`${label}: ${list.filter(i => i.severity === 'error').map(i => `${i.path} → ${i.message}`).join('; ')}`);
    this.name = 'ContractError';
    this.code = 'contract_invalid';
    this.issues = list;
  }
}

const errorsOnly = (issues) => issues.filter(i => i.severity === 'error');
const hasErrors = (issues) => errorsOnly(issues).length > 0;

const MAX_MESSAGE = 240;
const SECRET_PATTERNS = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/AIza[0-9A-Za-z_-]{20,}/g, '[clave]'],
  [/\b(?:ya29|eyJ)[0-9A-Za-z._-]{10,}/g, '[token]'],
  [/\b(?:Bearer|token|apikey|api_key|password|secret)\s*[:=]?\s*\S+/gi, '[secreto]'],
  [/\b[0-9a-f]{40,}\b/gi, '[hash]'],
];

const sanitizeText = (text) => {
  let out = String(text ?? '');
  SECRET_PATTERNS.forEach(([re, rep]) => { out = out.replace(re, rep); });
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE - 1)}…` : out;
};

// Forma que se puede persistir/mostrar. Los issues conservan code y path,
// que no contienen datos del cliente.
const sanitizeError = (err) => {
  if (!err) return { code: 'unknown', message: 'Error desconocido' };
  const code = typeof err.code === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(err.code) ? err.code : 'internal';
  const out = { code, message: sanitizeText(err.message || 'Error sin mensaje') };
  if (Array.isArray(err.issues)) {
    out.issues = errorsOnly(err.issues).slice(0, 20).map(i => ({ code: i.code, path: i.path, message: sanitizeText(i.message) }));
  }
  return out;
};

module.exports = { issue, ContractError, errorsOnly, hasErrors, sanitizeError, sanitizeText };
