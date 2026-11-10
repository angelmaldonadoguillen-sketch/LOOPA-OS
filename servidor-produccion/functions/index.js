const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onObjectFinalized, onObjectDeleted } = require('firebase-functions/v2/storage');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const crypto = require('node:crypto');

initializeApp();
const db = getFirestore();
const PORTFOLIO_STORAGE_LIMIT = 1024 * 1024 * 1024;
const PORTFOLIO_FILE_LIMIT = 10 * 1024 * 1024;
const PORTFOLIO_SVG_LIMIT = 500 * 1024;
const PORTFOLIO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml']);
const FRAME_STORAGE_BUCKET = 'frame-studio-3a18f.firebasestorage.app';

const todayInTegucigalpa = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Tegucigalpa', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

// Se ejecuta en servidor: no depende de que alguien abra Frame ni del
// localStorage de un dispositivo. Respeta la configuración de cada tablero.
exports.carryOverIncompleteTasks = onSchedule({
  schedule: '5 0 * * *',
  timeZone: 'America/Tegucigalpa',
  region: 'us-central1',
}, async () => {
  const today = todayInTegucigalpa();
  const workspaces = await db.collection('frame_workspaces').get();
  const batches = [];

  for (const workspace of workspaces.docs) {
    const settings = await workspace.ref.collection('config').doc('display_settings').get();
    if (!settings.data()?.carryOverProjects) continue;
    const columnConfig = await workspace.ref.collection('config').doc('kanban_columns').get();
    const columns = columnConfig.data()?.columns || [];
    const completedStatuses = new Set(
      columns.filter(column => column.isDone).map(column => column.id)
    );
    // Compatibilidad con configuraciones anteriores a los comportamientos.
    if (!columns.some(column => typeof column.isDone === 'boolean')) completedStatuses.add('delivered');

    const tasks = await db.collection('frame_projects')
      .where('workspaceId', '==', workspace.id).get();
    let batch = db.batch();
    let count = 0;

    for (const task of tasks.docs) {
      const data = task.data();
      const checklist = Array.isArray(data.checklist) ? data.checklist : [];
      const incomplete = checklist.length > 0 && checklist.some(item => !item.done);
      const refDate = data.sessionDate || data.startDate || data.deadline;
      if (!incomplete || !refDate || refDate >= today || data.status === 'archived' || completedStatuses.has(data.status)) continue;

      batch.update(task.ref, {

        sessionDate: today,
        carryOverAt: FieldValue.serverTimestamp(),
      });
      const activity = task.ref.collection('activity').doc();
      batch.set(activity, {
        id: activity.id,
        actorId: 'system',
        actorName: 'Frame',
        summary: 'movió la próxima fecha de trabajo por checklist incompleto',
        at: new Date().toISOString(),
      });
      count += 1;
      if (count === 400) { batches.push(batch.commit()); batch = db.batch(); count = 0; }
    }
    if (count > 0) batches.push(batch.commit());
  }
  await Promise.all(batches);
});

// La purga no depende de que alguien abra la aplicación. deletedAt se guarda
// como ISO, cuyo orden lexicográfico coincide con el cronológico.
exports.purgeExpiredTrash = onSchedule({
  schedule: '20 0 * * *',
  timeZone: 'America/Tegucigalpa',
  region: 'us-central1',
}, async () => {
  const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  while (true) {
    const expired = await db.collection('frame_trash')
      .where('deletedAt', '<=', cutoff)
      .limit(400)
      .get();
    if (expired.empty) break;
    const batch = db.batch();
    expired.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    if (expired.size < 400) break;
  }
});

// La reserva se hace en una transacción antes de tocar Storage. Contar sólo
// después de subir permitiría que dos pestañas superaran el límite a la vez.
exports.reservePortfolioAsset = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Iniciá sesión para subir archivos.');
  const uid = request.auth.uid;
  const profile = await db.collection('frame_users').doc(uid).get();
  if (!profile.exists || profile.data().status !== 'active') {
    throw new HttpsError('permission-denied', 'Tu perfil de FRAME no está habilitado para subir archivos.');
  }
  const size = Number(request.data?.size);
  const contentType = String(request.data?.contentType || '').toLowerCase();
  const kind = request.data?.kind === 'logo' ? 'logo' : 'content';
  const perFileLimit = contentType === 'image/svg+xml' ? PORTFOLIO_SVG_LIMIT : PORTFOLIO_FILE_LIMIT;
  if (!Number.isSafeInteger(size) || size <= 0 || size > perFileLimit || !PORTFOLIO_TYPES.has(contentType)) {
    throw new HttpsError('invalid-argument', 'El archivo no cumple los límites del portfolio.');
  }

  const assetId = crypto.randomUUID().replaceAll('-', '');
  const path = `frame-portfolios/${uid}/${assetId}`;
  const usageRef = db.collection('frame_portfolio_usage').doc(uid);
  const reservationRef = db.collection('frame_portfolio_uploads').doc(uid).collection('portfolio_assets').doc(assetId);
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(Date.now() + 30 * 60 * 1000);

  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(usageRef);
    const usage = snapshot.exists ? snapshot.data() : {};
    const usedBytes = Math.max(0, Number(usage.usedBytes) || 0);
    const reservedBytes = Math.max(0, Number(usage.reservedBytes) || 0);
    if (usedBytes + reservedBytes + size > PORTFOLIO_STORAGE_LIMIT) {
      throw new HttpsError('resource-exhausted', 'Alcanzaste el límite de 1 GB de tu portfolio.');
    }
    transaction.set(usageRef, {
      ownerId: uid,
      usedBytes,
      reservedBytes: reservedBytes + size,
      limitBytes: PORTFOLIO_STORAGE_LIMIT,
      updatedAt: now,
    }, { merge: true });
    transaction.set(reservationRef, {
      ownerId: uid, assetId, path, size, contentType, kind,
      status: 'reserved', createdAt: now, expiresAt,
    });
  });
  return { assetId, path, limitBytes: PORTFOLIO_STORAGE_LIMIT };
});

const portfolioObject = object => {
  const match = String(object.name || '').match(/^frame-portfolios\/([^/]+)\/([a-f0-9]{32})$/);
  return match ? { uid: match[1], assetId: match[2] } : null;
};

exports.accountPortfolioAsset = onObjectFinalized({ region: 'us-central1', bucket: FRAME_STORAGE_BUCKET }, async event => {
  const object = event.data;
  const identity = portfolioObject(object);
  if (!identity) return;
  const { uid, assetId } = identity;
  const usageRef = db.collection('frame_portfolio_usage').doc(uid);
  const reservationRef = db.collection('frame_portfolio_uploads').doc(uid).collection('portfolio_assets').doc(assetId);
  await db.runTransaction(async transaction => {
    const [reservationSnapshot, usageSnapshot] = await Promise.all([transaction.get(reservationRef), transaction.get(usageRef)]);
    if (!reservationSnapshot.exists) return;
    const reservation = reservationSnapshot.data();
    if (reservation.status === 'stored') return;
    const usage = usageSnapshot.exists ? usageSnapshot.data() : {};
    const actualSize = Math.max(0, Number(object.size) || 0);
    transaction.set(usageRef, {
      ownerId: uid,
      usedBytes: Math.max(0, Number(usage.usedBytes) || 0) + actualSize,
      reservedBytes: Math.max(0, (Number(usage.reservedBytes) || 0) - (Number(reservation.size) || 0)),
      limitBytes: PORTFOLIO_STORAGE_LIMIT,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(reservationRef, { status: 'stored', actualSize, storedAt: FieldValue.serverTimestamp() });
  });
});

exports.releasePortfolioAsset = onObjectDeleted({ region: 'us-central1', bucket: FRAME_STORAGE_BUCKET }, async event => {
  const identity = portfolioObject(event.data);
  if (!identity) return;
  const { uid, assetId } = identity;
  const usageRef = db.collection('frame_portfolio_usage').doc(uid);
  const reservationRef = db.collection('frame_portfolio_uploads').doc(uid).collection('portfolio_assets').doc(assetId);
  await db.runTransaction(async transaction => {
    const [reservationSnapshot, usageSnapshot] = await Promise.all([transaction.get(reservationRef), transaction.get(usageRef)]);
    if (!reservationSnapshot.exists) return;
    const reservation = reservationSnapshot.data();
    if (reservation.status === 'deleted') return;
    const usage = usageSnapshot.exists ? usageSnapshot.data() : {};
    const actualSize = reservation.status === 'stored' ? Math.max(0, Number(reservation.actualSize) || Number(event.data.size) || 0) : 0;
    const reservedSize = reservation.status === 'reserved' ? Math.max(0, Number(reservation.size) || 0) : 0;
    transaction.set(usageRef, {
      ownerId: uid,
      usedBytes: Math.max(0, (Number(usage.usedBytes) || 0) - actualSize),
      reservedBytes: Math.max(0, (Number(usage.reservedBytes) || 0) - reservedSize),
      limitBytes: PORTFOLIO_STORAGE_LIMIT,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(reservationRef, { status: 'deleted', deletedAt: FieldValue.serverTimestamp() });
  });
});

exports.releaseExpiredPortfolioReservations = onSchedule({
  schedule: 'every 15 minutes', region: 'us-central1',
}, async () => {
  const expired = await db.collectionGroup('portfolio_assets').where('expiresAt', '<=', Timestamp.now()).limit(300).get();
  await Promise.all(expired.docs.filter(doc => doc.data().status === 'reserved').map(doc => db.runTransaction(async transaction => {
    const fresh = await transaction.get(doc.ref);
    if (!fresh.exists || fresh.data().status !== 'reserved') return;
    const uid = fresh.data().ownerId;
    const usageRef = db.collection('frame_portfolio_usage').doc(uid);
    const usageSnapshot = await transaction.get(usageRef);
    const usage = usageSnapshot.exists ? usageSnapshot.data() : {};
    transaction.set(usageRef, {
      ownerId: uid,
      usedBytes: Math.max(0, Number(usage.usedBytes) || 0),
      reservedBytes: Math.max(0, (Number(usage.reservedBytes) || 0) - (Number(fresh.data().size) || 0)),
      limitBytes: PORTFOLIO_STORAGE_LIMIT,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(doc.ref, { status: 'expired', expiredAt: FieldValue.serverTimestamp() });
  })));
});
