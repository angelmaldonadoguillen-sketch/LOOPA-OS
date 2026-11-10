'use strict';
// ─────────────────────────────────────────────────────────────────────
// Plantillas de producción de los servicios de LOOPA (decisión 2026-11-10:
// «1 tarea por servicio»). Cada venta confirmada crea, por cada línea, una
// tarea «Servicio · Cliente» en el tablero de producción, en Briefing, con
// un checklist corto y la entrega de la venta como fecha límite.
//
// Se ajustan servicio por servicio después: cambiar una plantilla exige subir
// `version` (las ventas ya hechas conservan la que congelaron).
// Tipos: sólo los de FRAME por defecto (existen en todo tablero).
// ─────────────────────────────────────────────────────────────────────

const CHECKLIST = [
  { itemId: 'briefing', text: 'Briefing con el cliente', perUnit: false },
  { itemId: 'produccion', text: 'Producción', perUnit: false },
  { itemId: 'revision', text: 'Revisión del cliente', perUnit: false },
  { itemId: 'entrega', text: 'Entrega', perUnit: false },
];

// serviceId → [clave de agrupación, tipo de FRAME]
const SERVICIOS = {
  'SRV-MUG355P3X6R8': ['plan-continuidad', 'campaign'],          // Plan Continuidad
  'SRV-MVEK74LX0WFH': ['publicidad-estrategia', 'campaign'],     // Publicidad y Estrategia Digital
  'SRV-MVIZVBHBENH0': ['logotipo', 'other'],                     // Logotipo
  'SRV-MW08X5IU33ZA': ['asesoria-procesos', 'other'],            // Asesoría y construcción procesos
  'SRV-MW9TIR1GOQ5M': ['paquete-presencia', 'campaign'],         // Paquete Presencia Digital
  'SRV-MW9TJ3A64LCE': ['paquete-crecimiento', 'campaign'],       // Paquete Crecimiento Digital
  'SRV-MW9TJCCR1TQS': ['paquete-marca', 'other'],                // Paquete Marca Comercial
  'SRV-MW9TJN27BCRL': ['sistema-digital-f1', 'other'],           // Paquete Sistema Digital — Fase 1
  'SRV-MW9TRDVH5Q2U': ['plan-esencial', 'campaign'],             // Plan Esencial
  'SRV-MW9TRQE6UTNS': ['plan-impulso', 'campaign'],              // Plan Impulso · Recomendado
};

function plantilla(grupo, tipo) {
  return {
    schemaVersion: 1,
    enabled: true,
    version: 1,
    workspaceId: null, // el tablero de producción por defecto (loopa_config/production)
    grouping: { strategy: 'separate', groupKey: grupo },
    templates: [{
      templateId: 'principal',
      label: 'Producción',
      title: '{servicio} · {cliente}',
      type: tipo,
      initialStatus: 'briefing',
      priority: 'medium',
      tags: ['loopa'],
      quantityMode: 'ignore',
      checklist: CHECKLIST.map(x => ({ ...x })),
      schedule: { sessionAnchor: 'sale_date', sessionOffsetDays: 0, deadlineAnchor: 'delivery_date', deadlineOffsetDays: 0 },
      recurrence: null,
    }],
  };
}

const PLANTILLAS = Object.fromEntries(Object.entries(SERVICIOS).map(([id, [g, t]]) => [id, plantilla(g, t)]));

module.exports = { PLANTILLAS, SERVICIOS };
