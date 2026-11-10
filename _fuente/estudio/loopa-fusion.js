// ─────────────────────────────────────────────────────────────────
// FRAME ⇄ LOOPA OS — lo que FRAME debe respetar mientras convive con las
// ventas de LOOPA (fusión, Fase 3 tanda 3.6 del repo LOOPA-OS).
//
// LOOPA genera tareas desde sus ventas (sourceSystem: 'loopa') y guarda
// datos comerciales en las fichas de cliente. Las reglas nuevas protegen
// eso; estas funciones puras hacen que FRAME no intente lo que las reglas
// van a rechazar (y que la pantalla no quede mintiendo):
//
//   isFromSale            ¿la tarea la generó una venta?
//   withoutProvenance     copia sin los campos de procedencia de la venta
//   duplicateOf           la copia de «Duplicar» (manual, sin procedencia;
//                         sin ficha si la ficha no es del tablero destino)
//   restorableFromTrash   qué se restaura de la papelera (o por qué no)
//   clientHasSales        ¿la ficha tiene ventas de LOOPA? (no se borra)
//   clientUpdatePatch     sólo lo que FRAME cambió de una ficha (nunca lo
//                         que escribe el servidor de LOOPA)
//
// Sin DOM ni Firebase: se prueba con node (loopa-fusion.test.js).
// ─────────────────────────────────────────────────────────────────
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FrameLoopa = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Los mismos 10 campos que protegen las reglas (provenanceKeys()).
  const PROVENANCE_KEYS = ['sourceSystem', 'sourceSaleId', 'sourceSaleNumber', 'sourceSaleStatus', 'sourceLineIds',
    'sourceEventId', 'sourceTemplateVersions', 'sourceWorkItems', 'idempotencyKey', 'integration'];
  // Lo que en una ficha escribe sólo el servidor de LOOPA (y createdAt, que
  // no cambia después de crearse).
  const CLIENT_SERVER_KEYS = ['commercial', 'legacyLoopaIds', 'hasSales', 'createdBy', 'updatedBy', 'createdAt'];

  const isFromSale = (p) => !!p && p.sourceSystem === 'loopa';

  const withoutProvenance = (p) => {
    const c = { ...p };
    PROVENANCE_KEYS.forEach(k => { delete c[k]; });
    return c;
  };

  // `clientIdsInTarget`: ids de las fichas del tablero donde nace la copia.
  // Una ficha de otro tablero no se puede enlazar (las reglas lo rechazan).
  function duplicateOf(original, { newId, wsId, viewerIds, now, clientIdsInTarget }) {
    const base = withoutProvenance(original);
    const copy = {
      ...base,
      id: newId,
      title: `${original.title || ''} (copia)`,
      // Una copia manual no se presenta como venta.
      ...(Array.isArray(base.tags) ? { tags: base.tags.filter(t => t !== 'loopa') } : {}),
      workspaceId: wsId,
      workspaceIds: [wsId],
      viewerIds,
      createdAt: now,
    };
    const fichaValida = typeof original.clientId === 'string' && original.clientId
      && Array.isArray(clientIdsInTarget) && clientIdsInTarget.includes(original.clientId);
    if (!fichaValida) delete copy.clientId;
    return copy;
  }

  // `clientOk`: la ficha existe y es del tablero de origen.
  // Devuelve { ok, project } o { ok: false, reason }.
  function restorableFromTrash(stored, { originId, clientOk }) {
    if (isFromSale(stored) || (typeof stored.id === 'string' && stored.id.startsWith('loopa_'))) {
      return { ok: false, reason: 'Las tareas de una venta de LOOPA no se restauran desde acá: se archivan en el tablero.' };
    }
    const project = withoutProvenance(stored);
    // Si la ficha ya no existe (o es de otro tablero), la tarea vuelve sin
    // ficha: con un clientId inválido las reglas rechazan recrearla.
    if (Object.prototype.hasOwnProperty.call(project, 'clientId') && !(project.clientId && clientOk === true)) {
      delete project.clientId;
    }
    return { ok: true, project: { ...project, workspaceId: originId } };
  }

  // Igual que la regla: alcanza con que la CLAVE exista (aunque esté vacía).
  const SALES_KEYS = ['commercial', 'legacyLoopaIds', 'hasSales'];
  const clientHasSales = (c) => !!c && SALES_KEYS.some(k => Object.prototype.hasOwnProperty.call(c, k));

  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

  // Lo que cambió de `next` respecto de `prev`, sin las claves del servidor
  // ni el id. Con `update` (no `set`) lo comercial de la ficha queda intacto
  // aunque esta pantalla tenga una copia vieja.
  function clientUpdatePatch(prev, next) {
    const patch = {};
    Object.keys(next || {}).forEach(k => {
      if (k === 'id' || CLIENT_SERVER_KEYS.includes(k)) return;
      if (next[k] === undefined) return; // lo quitado lo maneja clientRemovedKeys
      if (!same((prev || {})[k], next[k])) patch[k] = next[k];
    });
    return patch;
  }

  // Lo que la pantalla QUITÓ de la ficha (con set() desaparecía; con update
  // hay que borrarlo a propósito). Nunca claves del servidor ni el id.
  function clientRemovedKeys(prev, next) {
    return Object.keys(prev || {}).filter(k => k !== 'id' && !CLIENT_SERVER_KEYS.includes(k) && !Object.prototype.hasOwnProperty.call(next || {}, k));
  }

  return { PROVENANCE_KEYS, CLIENT_SERVER_KEYS, isFromSale, withoutProvenance, duplicateOf, restorableFromTrash, clientHasSales, clientUpdatePatch, clientRemovedKeys };
});
