'use strict';
// ─────────────────────────────────────────────────────────────────
// Fusión de clientes: LOOPA (`loopa/clientes`) + FRAME (`frame_clients`)
// → una sola ficha (que extiende frame_clients).
//
// Reglas:
//   · Coincidencia automática SÓLO por teléfono (últimos 8 dígitos) o email
//     normalizado. Nunca por nombre.
//   · El nombre igual sin otro dato es una sugerencia, no una coincidencia:
//     queda como conflicto hasta que una persona decida.
//   · Cualquier ambigüedad (varios candidatos, datos que se contradicen, dos
//     clientes de LOOPA que apuntan al mismo de FRAME, duplicados dentro de
//     LOOPA) bloquea la migración hasta que exista una decisión explícita.
//   · Las decisiones viven en un archivo revisable (client-decisions.json):
//     { "<loopaClientId>": { "action": "link", "frameClientId": "…" } | { "action": "new" } }
// ─────────────────────────────────────────────────────────────────

const { ids, isStableId } = require('../production-plan/ids');
const { issue } = require('../production-plan/errors');

const PLACEHOLDER = /^[\s—–-]*$/;
const clean = (v) => (typeof v === 'string' && !PLACEHOLDER.test(v) ? v.trim() : '');
// Un campo de teléfono puede traer varios números ("9988-7766 / 2233-4455")
// y extensiones ("2222-3333 ext 12"): se separan y se descarta la extensión.
const phoneKeys = (v) => [...new Set(clean(v)
  .split(/[\/,;]|\s+(?:y|o)\s+/i)
  .map(part => part.replace(/(?:ext\.?|extensi[oó]n|x)\s*\d+\s*$/i, '').replace(/\D/g, ''))
  .filter(d => d.length >= 8)
  .map(d => d.slice(-8)))].sort();
const emailKey = (v) => { const e = clean(v).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ''; };
const nameKey = (v) => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const shareAny = (a, b) => a.some(x => b.includes(x));
// Nombres compatibles: todas las palabras del más corto están, como palabras
// enteras, en el más largo ("Café Aurora" / "Café Aurora S.A."). Un nombre de
// una sola palabra corta no alcanza ("Sol", "Ana"): "Ana" no coincide con
// "Mariana Pérez" ni "Sol" con "Soluciones Industriales".
const words = (k) => k.split(' ').filter(Boolean);
function namesAgree(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = words(a).length <= words(b).length ? [words(a), words(b)] : [words(b), words(a)];
  const meaningful = short.length >= 2 || (short[0] || '').length >= 4;
  return meaningful && short.every(w => long.includes(w));
}

const loopaKeys = (c) => ({ phones: phoneKeys(c.telefono), email: emailKey(c.email), name: nameKey(c.nombre) });
const frameKeys = (f) => ({ phones: phoneKeys(f.contact && f.contact.phone), email: emailKey(f.contact && f.contact.email), name: nameKey(f.name) });

// Id determinista de la ficha nueva para un cliente que sólo existía en LOOPA.
const unifiedIdFor = (loopaClientId) => ids.unifiedClientId(loopaClientId);

function proposeClientMerge(loopaClients, frameClients, { decisions = {}, workspaceId }) {
  const issues = [];
  const frame = frameClients.filter(f => f.workspaceId === workspaceId);
  const frameById = new Map(frame.map(f => [f.id, f]));
  const fk = new Map(frame.map(f => [f.id, frameKeys(f)]));
  const proposals = [];

  // Duplicados dentro de LOOPA (mismo teléfono o email en dos fichas).
  const seenKey = new Map();
  const dupOf = new Map();
  [...loopaClients].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach(c => {
    const k = loopaKeys(c);
    [...k.phones.map(p => `p:${p}`), k.email && `e:${k.email}`].filter(Boolean).forEach(key => {
      if (seenKey.has(key) && seenKey.get(key) !== c.id) dupOf.set(c.id, seenKey.get(key));
      else seenKey.set(key, c.id);
    });
  });

  [...loopaClients].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach(c => {
    if (!isStableId(c.id)) { issues.push(issue('client.loopa_id', `clientes[${c.nombre || '?'}]`, 'Cliente de LOOPA sin id válido')); return; }
    const k = loopaKeys(c);
    const byData = frame.filter(f => {
      const x = fk.get(f.id);
      return shareAny(k.phones, x.phones) || (k.email && k.email === x.email);
    }).map(f => f.id).sort();
    const byNameOnly = frame.filter(f => k.name && fk.get(f.id).name === k.name && !byData.includes(f.id)).map(f => f.id).sort();
    const contradictions = byData.filter(id => {
      const x = fk.get(id);
      return (k.phones.length && x.phones.length && !shareAny(k.phones, x.phones)) || (k.email && x.email && k.email !== x.email);
    });
    // Sólo coincide el teléfono y los nombres no tienen nada que ver: puede
    // ser un teléfono de oficina compartido. No se enlaza solo.
    const phoneOnlyMismatch = byData.length === 1 && !(k.email && k.email === fk.get(byData[0]).email)
      && !namesAgree(k.name, fk.get(byData[0]).name);

    let outcome;
    let reason = null;
    if (dupOf.has(c.id)) { outcome = 'conflict'; reason = 'duplicate_in_loopa'; }
    else if (byData.length > 1) { outcome = 'conflict'; reason = 'multiple_candidates'; }
    else if (byData.length === 1 && contradictions.length) { outcome = 'conflict'; reason = 'contradicting_data'; }
    else if (phoneOnlyMismatch) { outcome = 'conflict'; reason = 'phone_only_name_mismatch'; }
    else if (byData.length === 1) { outcome = 'match'; }
    else if (byNameOnly.length) { outcome = 'conflict'; reason = 'name_only'; }
    else { outcome = 'new'; }
    proposals.push({ loopaClientId: c.id, nombre: c.nombre || '', outcome, reason, candidates: byData.length ? byData : byNameOnly, duplicateOf: dupOf.get(c.id) || null });
  });

  // Dos clientes de LOOPA que caen en la misma ficha de FRAME.
  const claimed = new Map();
  proposals.filter(p => p.outcome === 'match').forEach(p => {
    const target = p.candidates[0];
    if (claimed.has(target)) {
      p.outcome = 'conflict'; p.reason = 'shared_target';
      const other = proposals.find(q => q.loopaClientId === claimed.get(target));
      if (other && other.outcome === 'match') { other.outcome = 'conflict'; other.reason = 'shared_target'; }
    } else claimed.set(target, p.loopaClientId);
  });

  // Decisiones humanas: sólo pueden resolver, nunca inventar destinos.
  Object.keys(decisions).forEach(id => {
    if (!proposals.some(p => p.loopaClientId === id)) issues.push(issue('client.decision.unknown_client', `decisions.${id}`, 'La decisión refiere a un cliente de LOOPA que no existe'));
  });
  proposals.forEach(p => {
    const d = Object.hasOwn(decisions, p.loopaClientId) ? decisions[p.loopaClientId] : null;
    if (!d) return;
    if (d.action === 'new') { p.resolution = 'new'; return; }
    if (d.action === 'link' && frameById.has(d.frameClientId)) { p.resolution = 'link'; p.target = d.frameClientId; return; }
    issues.push(issue('client.decision.invalid', `decisions.${p.loopaClientId}`, 'Decisión inválida: usá {"action":"new"} o {"action":"link","frameClientId":"<id existente en el tablero>"}'));
  });

  // Resultado final.
  const clientMap = {};
  const linkedTargets = new Map();
  proposals.forEach(p => {
    if (p.resolution === 'new' || (!p.resolution && p.outcome === 'new')) { p.final = 'new'; p.unifiedId = unifiedIdFor(p.loopaClientId); }
    else if (p.resolution === 'link') { p.final = 'link'; p.unifiedId = p.target; }
    else if (p.outcome === 'match') { p.final = 'link'; p.unifiedId = p.candidates[0]; }
    else { p.final = 'unresolved'; p.unifiedId = null; }
    if (p.final === 'link') {
      if (linkedTargets.has(p.unifiedId)) issues.push(issue('client.decision.shared_target', `decisions.${p.loopaClientId}`, `Dos clientes de LOOPA quedarían en la misma ficha (${linkedTargets.get(p.unifiedId)} y ${p.loopaClientId}); decidí cuál se enlaza`));
      linkedTargets.set(p.unifiedId, p.loopaClientId);
    }
    if (p.unifiedId) clientMap[p.loopaClientId] = p.unifiedId;
    if (p.final === 'unresolved') {
      issues.push(issue('client.unresolved', `clientes[${p.loopaClientId}]`, `Cliente sin resolver (${p.reason}); agregá una decisión en client-decisions.json`));
    }
  });

  const counts = { match: 0, new: 0, conflict: 0, resolvedByDecision: 0, unresolved: 0 };
  proposals.forEach(p => {
    counts[p.outcome] += 1;
    if (p.resolution) counts.resolvedByDecision += 1;
    if (p.final === 'unresolved') counts.unresolved += 1;
  });
  return { proposals, clientMap, issues, counts };
}

// Documento de la ficha única. Para un enlace: sólo los campos que se agregan
// (merge), nunca se pisan nombre ni contacto ya cargados en FRAME. Para uno
// nuevo: la forma de frame_clients más lo comercial.
function commercialOf(c) {
  return {
    // El nombre con que LOOPA conocía al cliente (la ficha conserva el suyo).
    nombreLoopa: clean(c.nombre),
    empresa: clean(c.empresa),
    telefono: clean(c.telefono),
    email: clean(c.email),
    canal: clean(c.canal),
    notas: clean(c.notas),
    creadoEnLoopa: clean(c.creado),
  };
}

function initialsOf(name) {
  const parts = clean(name).split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : (parts[0] || '?')[1] || '')).toUpperCase();
}

function newClientDoc(c, unifiedId, workspaceId) {
  return {
    id: unifiedId,
    name: clean(c.nombre) || 'Cliente sin nombre',
    workspaceId,
    industry: 'Sin categoría',
    color: 'var(--resource-neutral)',
    initials: initialsOf(c.nombre),
    contact: { name: '—', email: clean(c.email) || '—', phone: clean(c.telefono) || '—' },
    tags: [],
    notes: '',
    portalToken: '',
    portalPublished: false,
    commercial: commercialOf(c),
    legacyLoopaIds: [c.id],
  };
}

function linkPatch(c) {
  return { commercial: commercialOf(c), legacyLoopaIds: [c.id] };
}

module.exports = { proposeClientMerge, newClientDoc, linkPatch, unifiedIdFor, phoneKeys, emailKey, nameKey };
