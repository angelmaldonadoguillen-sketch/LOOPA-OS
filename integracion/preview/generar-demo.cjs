#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────
// Genera integracion/preview/produccion-demo.json: tareas de Producción de
// EJEMPLO, producidas por el planificador real (Fase 0) a partir de las
// ventas ficticias de los fixtures. Lo usa LOOPA con ?produccion=demo.
//
//   node integracion/preview/generar-demo.cjs
//
// Determinista: mismos fixtures → mismo archivo. Sin red, sin Firebase.
// ─────────────────────────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');
const core = require('../../functions/production-plan');
const { loadFixtures, buildSale } = require('../harness.cjs');

const HOY = '2026-11-17';
// Equipo de EJEMPLO: los mismos ids que context.json (miembros del tablero).
const EQUIPO = [
  { id: 'uid-demo-carla', name: 'Carla (ejemplo)', status: 'active' },
  { id: 'uid-demo-ana', name: 'Ana (ejemplo)', status: 'active' },
  { id: 'uid-demo-beto', name: 'Beto (ejemplo)', status: 'active' },
];
const fx = loadFixtures();
const context = { ...fx.context, today: HOY };

const tareas = [];
fx.scenarios.filter(s => !s.raw).forEach(s => {
  const sale = buildSale(structuredClone(s.sale), fx.services);
  const plan = core.planSale(sale, context, { eventId: core.ids.eventId('sale.confirmed', sale.id, sale.revision) });
  if (plan.status !== 'ready') return;
  plan.tasks.forEach(t => tareas.push(t));
});

// Algo de avance para que se vea un equipo trabajando: lo que ya pasó está
// más avanzado. Determinista (depende sólo de la fecha y del id).
tareas.forEach((t, i) => {
  const pasada = t.sessionDate < HOY;
  const done = pasada ? Math.ceil(t.checklist.length * 0.6) : (t.sessionDate === HOY ? 1 : 0);
  t.checklist = t.checklist.map((c, j) => ({ ...c, done: j < done }));
  if (pasada && done === t.checklist.length) t.status = 'delivered';
  else if (pasada || t.sessionDate === HOY) t.status = 'producing';
  if (i % 7 === 3) t.priority = 'high';
  // Responsables: el equipo de ejemplo se reparte el trabajo (determinista).
  t.assignees = [EQUIPO[i % EQUIPO.length].id];
});

// Producción nace oculta al portal (D5). En el ejemplo, el equipo ya decidió
// compartir con Café Aurora su trabajo de reels y fotos.
tareas.filter(t => t.clientId === 'cli-demo-cafe-aurora' && /reel|fotograf/i.test(t.title)).forEach(t => { t.clientVisible = true; });

// La venta "editada-y-cancelada" del simulador termina cancelada.
const cancelada = fx.scenarios.find(s => s.name === 'editada-y-cancelada');
tareas.filter(t => t.sourceSaleId === cancelada.sale.id).forEach(t => { t.sourceSaleStatus = 'cancelled'; });

// Una tarea manual (no viene de una venta), como las que el equipo crea en FRAME.
tareas.push({
  id: 'p-demo-manual', title: 'Ordenar el archivo de material de noviembre', client: 'LOOPA (interno)', type: 'other',
  status: 'briefing', priority: 'low', sessionDate: '2026-11-19', deadline: '2026-11-21',
  checklist: [{ id: 'c1', text: 'Respaldar tarjetas de memoria', done: false }, { id: 'c2', text: 'Nombrar carpetas por cliente', done: false }],
  workspaceId: 'ws-loopa-produccion', workspaceIds: ['ws-loopa-produccion'],
});

tareas.sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : (a.id < b.id ? -1 : 1)));
const out = {
  _nota: 'DATOS DE EJEMPLO generados por integracion/preview/generar-demo.cjs. No son datos reales.',
  hoy: HOY,
  columnas: [
    { id: 'briefing', label: 'Briefing', isDone: false },
    { id: 'producing', label: 'En producción', isDone: false },
    { id: 'editing', label: 'Edición', isDone: false },
    { id: 'review', label: 'Revisión cliente', isDone: false },
    { id: 'delivered', label: 'Entregado', isDone: true, requiresChecklist: true },
  ],
  tareas,
  equipo: EQUIPO,
  // Fichas únicas de cliente del tablero (las del fixture de contexto).
  clientes: Object.entries(fx.context.clients)
    .filter(([, c]) => c.workspaceId === 'ws-loopa-produccion')
    .map(([id, c]) => ({ id, name: c.name, workspaceId: c.workspaceId, initials: c.name.slice(0, 2).toUpperCase(), portalPublished: id === 'cli-demo-cafe-aurora' })),
  workspace: { id: 'ws-loopa-produccion', name: 'LOOPA · Producción' },
  // Rutina diaria del tablero, guardada AYER: al abrir, el núcleo hace el
  // cambio de día (historial + deuda) igual que FRAME.
  rutina: {
    tasks: [
      { id: 'r1', text: 'Revisar entregas del día', assignee: 'uid-demo-carla' },
      { id: 'r2', text: 'Responder mensajes de clientes', assignee: 'uid-demo-ana' },
      { id: 'r3', text: 'Respaldar material grabado', assignee: 'uid-demo-beto' },
      { id: 'r4', text: 'Actualizar el tablero', assignee: null },
    ],
    today: { date: '2026-11-16', checks: { r1: true, r2: true, r4: true }, debt: { r3: 1 } },
    history: [
      // El 15 quedó sin hacer «Respaldar material» (r3): por eso arrastra deuda.
      { date: '2026-11-15', completed: 3, total: 4 },
      { date: '2026-11-14', completed: 4, total: 4 },
      { date: '2026-11-13', completed: 4, total: 4 },
    ],
    config: { carryOver: true },
  },
};
const outIdx = process.argv.indexOf('--out');
const file = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : path.join(__dirname, 'produccion-demo.json');
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(`OK ${path.relative(process.cwd(), file)} · ${tareas.length} tareas · hoy ${HOY}`);
