'use strict';
// ─────────────────────────────────────────────────────────────────
// Del catálogo a la venta: el snapshot congelado.
//
// Al vender, cada línea copia la descripción comercial Y la plantilla
// operativa vigente (copia profunda, no referencia). Editar el servicio
// después sólo afecta ventas futuras: la venta histórica conserva lo que se
// vendió y cómo se iba a producir, aunque el servicio se archive o se borre.
// ─────────────────────────────────────────────────────────────────

const { validateService } = require('./contracts');
const { ContractError, hasErrors, issue } = require('./errors');

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

const cloneFrozen = (value) => deepFreeze(structuredClone(value));

// precio/costo pueden negociarse en la venta; el resto sale del catálogo.
function buildSaleLine(service, { lineId, quantity, precio, costo } = {}) {
  const problems = validateService(service);
  if (typeof lineId !== 'string' || !lineId) problems.push(issue('line.id', 'lineId', 'buildSaleLine necesita un lineId estable'));
  if (hasErrors(problems)) throw new ContractError(problems, `Servicio ${service && service.id ? service.id : '?'} inválido`);
  const plan = service.executionPlan && service.executionPlan.enabled !== undefined ? cloneFrozen(service.executionPlan) : null;
  return {
    lineId,
    serviceId: service.id,
    quantity: quantity === undefined ? 1 : quantity,
    snapshot: {
      nombre: service.nombre,
      modelo: service.modelo,
      categoria: service.categoria || '',
      unidad: service.unidad || '',
      alcance: service.descripcion || '',
      precio: Number(precio === undefined ? service.precio || 0 : precio),
      costo: Number(costo === undefined ? service.costo || 0 : costo),
    },
    executionPlan: plan,
    executionTemplateVersion: plan ? plan.version : null,
  };
}

module.exports = { buildSaleLine, deepFreeze, cloneFrozen };
