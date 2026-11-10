'use strict';
// ─────────────────────────────────────────────────────────────────
// Funciones de LOOPA OS en frame-studio-3a18f (Fase 3, tanda 3.1).
//
// Codebase «loopa» (ver firebase.json): se publican SÓLO con
//   firebase deploy --only functions:loopa
// para no tocar las funciones de FRAME, que viven en otro codebase y se
// publican desde su propio repo. Publicar requiere aprobación (ADR-0004 §4 A).
//
// Toda la lógica está en loopa-server.js (probada en memoria y en el
// emulador); acá sólo se conecta con Firebase y se registra lo que falla.
// ─────────────────────────────────────────────────────────────────
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { FirestoreStore } = require('./adapters/firestore-store');
const { sanitizeError } = require('./production-plan/errors');
const server = require('./loopa-server');

initializeApp();
const REGION = 'us-central1';

// En las funciones publicadas el almacén habla con el proyecto real: es el
// único lugar con allowRemote. En el emulador de funciones también vale.
let cached = null;
const store = () => (cached || (cached = new FirestoreStore(getFirestore(), { allowRemote: true })));

// Al convertir en HttpsError, firebase-functions ya no registra el error:
// lo inesperado se registra acá, saneado (sin emails, claves ni tokens).
const logError = (where, err) => console.error(JSON.stringify({ loopa: where, error: sanitizeError(err) }));

const callable = (name, fn) => onCall({ region: REGION, timeoutSeconds: 60 }, async (request) => {
  try {
    return await fn(store(), request.auth, request.data);
  } catch (err) {
    const e = err instanceof server.ServerError ? err : server.toServerError(err);
    if (e.kind === 'internal' || e.kind === 'unavailable') logError(name, err);
    throw new HttpsError(e.kind, e.message, e.details);
  }
});

exports.loopaCreateSale = callable('loopaCreateSale', server.createSale);
exports.loopaUpdateSale = callable('loopaUpdateSale', server.updateSale);
exports.loopaAddPayment = callable('loopaAddPayment', server.addPayment);

// El outbox: cada evento nuevo se procesa enseguida (y la cola de su venta).
// Sin retry automático: si falla, el evento queda pendiente o con backoff y
// lo retoma el barrido. Una venta grande son cientos de transacciones: 5 min.
exports.loopaOnEventCreated = onDocumentCreated({ region: REGION, document: 'loopa_integration_events/{eventId}', timeoutSeconds: 300 }, async (event) => {
  try {
    await server.onEventCreated(store(), event.params.eventId);
  } catch (err) {
    logError('loopaOnEventCreated', err);
  }
});

// Barrido: pendientes que esperaban candado, reintentos y leases vencidos.
exports.loopaSweepEvents = onSchedule({ region: REGION, schedule: 'every 5 minutes', timeZone: 'America/Tegucigalpa', timeoutSeconds: 540 }, async () => {
  const r = await server.sweep(store());
  if (r.due) console.log(JSON.stringify({ loopa: 'sweep', due: r.due, sales: r.sales.length }));
  r.sales.filter(s => s.error).forEach(s => console.error(JSON.stringify({ loopa: 'sweep', saleId: s.saleId, error: s.error })));
});
