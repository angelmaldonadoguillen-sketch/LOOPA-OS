#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// Punto C — encender la fusión: qué tablero recibe el trabajo de las ventas
// y quiénes venden (ADR-0004 §5).
//
//   node integracion/puesta-en-marcha/configurar-c.cjs --respaldo <carpeta b-…> \
//        --tablero <id> --comerciales <uid o email>,<uid o email> [--escribir]
//
// Escribe (sólo con --escribir) en frame-studio-3a18f:
//   loopa_config/production = { defaultWorkspaceId, allowedWorkspaceIds: [id] }
//   loopa_config/access     = { commercialUids: [...] }
// con la misma forma cerrada que exigen las reglas. Sin --escribir, sólo
// muestra lo que haría y lo que ya hay.
//
// Antes verifica, con el respaldo de B0 (usuarios y tableros): cada comercial
// existe, está aprobado y es MIEMBRO del tablero (si no, Producción en LOOPA
// no le puede leer las tareas).
// ─────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const { AlmacenRest } = require('./almacen-rest.cjs');
const { transporte, PROYECTO_REAL } = require('./migrar.cjs');

function leer(f) { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); }

// Pura: arma los documentos y explica lo que falte.
function armar({ usuarios, tableros, tablero, comerciales }) {
  const errores = [];
  const ws = tableros.find(t => t.id === tablero);
  if (!ws) errores.push(`No existe el tablero ${tablero}`);
  const uids = [];
  comerciales.forEach(c => {
    const u = usuarios.find(x => x.uid === c || (x.email && x.email.toLowerCase() === String(c).toLowerCase()));
    if (!u) { errores.push(`No hay una cuenta de FRAME para «${c}»`); return; }
    if (u.estado !== 'active') errores.push(`${u.nombre || u.uid}: la cuenta no está aprobada (${u.estado})`);
    if (ws && !(ws.miembros || []).includes(u.uid)) errores.push(`${u.nombre || u.uid}: no es miembro del tablero «${ws.nombre}» (agregalo desde FRAME)`);
    if (!uids.includes(u.uid)) uids.push(u.uid);
  });
  if (!uids.length) errores.push('Falta al menos una persona que venda');
  if (uids.length > 50) errores.push('Más de 50 comerciales');
  return {
    errores,
    production: { defaultWorkspaceId: tablero, allowedWorkspaceIds: [tablero] },
    access: { commercialUids: [...uids].sort() },
    nombres: uids.map(id => (usuarios.find(x => x.uid === id) || {}).nombre || id),
  };
}

module.exports = { armar };

if (require.main === module) {
  (async () => {
    const a = { escribir: false };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i += 1) {
      const k = argv[i];
      if (k === '--escribir') a.escribir = true;
      else if (k === '--respaldo') a.respaldo = path.resolve(argv[++i]);
      else if (k === '--tablero') a.tablero = argv[++i];
      else if (k === '--comerciales') a.comerciales = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
      else throw new Error(`Argumento desconocido: ${k}`);
    }
    if (!a.respaldo || !a.tablero || !a.comerciales) throw new Error('Faltan --respaldo, --tablero o --comerciales');
    const r = armar({ usuarios: leer(path.join(a.respaldo, 'usuarios.json')), tableros: leer(path.join(a.respaldo, 'tableros.json')), tablero: a.tablero, comerciales: a.comerciales });
    console.log(`Tablero de producción: ${a.tablero}`);
    console.log(`Venden: ${r.nombres.join(', ') || '—'}`);
    if (r.errores.length) { r.errores.forEach(e => console.log(`  ✖ ${e}`)); process.exit(3); }
    const base = `https://firestore.googleapis.com/v1/projects/${PROYECTO_REAL}/databases/(default)`;
    const store = new AlmacenRest({ base, pedir: transporte(require('./sesion-cli.cjs').tokenDelCli(PROYECTO_REAL)) });
    for (const [doc, datos] of [['production', r.production], ['access', r.access]]) {
      const ahora = await store.get('loopa_config', doc);
      console.log(`loopa_config/${doc}: ahora ${ahora ? JSON.stringify(ahora) : '(no existe)'} → ${JSON.stringify(datos)}`);
      if (!a.escribir) continue;
      await store.transaction(async tx => {
        const actual = await tx.get('loopa_config', doc);
        if (actual) tx.update('loopa_config', doc, datos);
        else tx.create('loopa_config', doc, datos);
      });
      console.log(`  ✔ escrito`);
    }
    if (!a.escribir) console.log('(Sin --escribir: no se escribió nada.)');
  })().catch(e => { console.error(`✖ ${e.message}`); process.exit(1); });
}
