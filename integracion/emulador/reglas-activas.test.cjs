'use strict';
// ─────────────────────────────────────────────────────────────────────
// Punto A (ADR-0004 §7.3): los controles del servidor de LOOPA se apoyan en
// que el navegador NO pueda escribir loopa_config ni aprobarse a sí mismo
// en frame_users. Esto lo verifica contra:
//   · el borrador (siempre), y
//   · las reglas ACTIVAS respaldadas por chequeo-a.cjs, si se pasan:
//       LOOPA_REGLAS_ACTIVAS=<respaldo>/firestore.rules node integracion/emulador/correr.cjs integracion/emulador/reglas-activas.test.cjs
//
// Todo corre en el emulador local (proyecto demo-*): no toca nada real.
// ─────────────────────────────────────────────────────────────────────
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMU && process.env.REQUIRE_EMULATOR === '1') throw new Error('REQUIRE_EMULATOR=1 sin FIRESTORE_EMULATOR_HOST');
const skip = EMU ? false : 'sin emulador de Firestore (node integracion/emulador/correr.cjs)';

const ARCHIVOS = [['borrador', path.join(__dirname, '..', 'reglas', 'firestore.rules.borrador')]];
if (process.env.LOOPA_REGLAS_ACTIVAS) ARCHIVOS.push(['activas', path.resolve(process.env.LOOPA_REGLAS_ACTIVAS)]);

ARCHIVOS.forEach(([nombre, archivo], n) => {
  let env;
  let F;
  let R;
  async function preparar() {
    if (!env) {
      R = require('@firebase/rules-unit-testing');
      F = require('firebase/firestore');
      F.setLogLevel('silent');
      const [host, port] = EMU.split(':');
      env = await R.initializeTestEnvironment({ projectId: `demo-loopa-activas-${n}`, firestore: { rules: fs.readFileSync(archivo, 'utf8').replace(/^﻿/, ''), host, port: Number(port) } });
    }
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await F.setDoc(F.doc(db, 'frame_users', 'u1'), { status: 'active', name: 'Activo' });
      await F.setDoc(F.doc(db, 'frame_users', 'pend'), { status: 'pending', name: 'Pendiente' });
      await F.setDoc(F.doc(db, 'frame_users', 'adm'), { status: 'active', platformAdmin: true });
      await F.setDoc(F.doc(db, 'loopa_config', 'access'), { commercialUids: ['adm'] });
    });
  }
  const como = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

  test(`${nombre}: nadie escribe loopa_config desde el navegador`, { skip }, async () => {
    await preparar();
    for (const uid of [null, 'u1', 'pend']) {
      const db = como(uid);
      await R.assertFails(F.setDoc(F.doc(db, 'loopa_config', 'access'), { commercialUids: [uid || 'x'] }));
      await R.assertFails(F.setDoc(F.doc(db, 'loopa_config', 'production'), { defaultWorkspaceId: 'ws1', allowedWorkspaceIds: ['ws1'] }));
      await R.assertFails(F.deleteDoc(F.doc(db, 'loopa_config', 'access')));
    }
  });

  // Entre A2 (funciones publicadas) y A4 (reglas nuevas) rigen las reglas
  // viejas: el worker no puede recibir eventos ni ventas fabricados en el
  // navegador.
  test(`${nombre}: nadie escribe eventos, ventas ni el correlativo desde el navegador`, { skip }, async () => {
    await preparar();
    for (const uid of [null, 'u1', 'adm']) {
      const db = como(uid);
      await R.assertFails(F.setDoc(F.doc(db, 'loopa_integration_events', 'e-falso'), { eventId: 'e-falso', saleId: 's1', status: 'pending' }));
      await R.assertFails(F.setDoc(F.doc(db, 'loopa_sales', 's-falsa'), { id: 's-falsa', status: 'confirmed' }));
      await R.assertFails(F.setDoc(F.doc(db, 'loopa_counters', 'sales'), { next: 1 }));
    }
  });

  test(`${nombre}: nadie se aprueba ni se hace admin a sí mismo`, { skip }, async () => {
    await preparar();
    await R.assertFails(F.updateDoc(F.doc(como('pend'), 'frame_users', 'pend'), { status: 'active' }));
    await R.assertFails(F.setDoc(F.doc(como('nuevo'), 'frame_users', 'nuevo'), { status: 'active', name: 'Nuevo' }));
    // Alta pendiente pero con platformAdmin: sería admin al aprobarse (o antes).
    await R.assertFails(F.setDoc(F.doc(como('nuevo2'), 'frame_users', 'nuevo2'), { status: 'pending', platformAdmin: true }));
    await R.assertFails(F.updateDoc(F.doc(como('u1'), 'frame_users', 'u1'), { platformAdmin: true }));
    // Un usuario activo (no admin) tampoco aprueba a otro.
    await R.assertFails(F.updateDoc(F.doc(como('u1'), 'frame_users', 'pend'), { status: 'active' }));
  });

  test(`${nombre}: control — cada uno lee su propio perfil`, { skip }, async () => {
    await preparar();
    await R.assertSucceeds(F.getDoc(F.doc(como('u1'), 'frame_users', 'u1')));
  });

  test.after(async () => { if (env) await env.cleanup(); });
});
