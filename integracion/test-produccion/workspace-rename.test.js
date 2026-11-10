const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.jsx', 'utf8');
const mobile = fs.readFileSync('mobile.jsx', 'utf8');
const handler = app.match(/  const handleRenameWorkspace = async[\s\S]*?\n  \};/)[0];
const calls = [];
let failure = null;
const context = {
  state: { workspaces: [
    { id: 'personal', name: 'Personal', ownerId: 'me', memberIds: ['me'] },
    { id: 'team', name: 'Equipo', ownerId: 'me', memberIds: ['me', 'other'] },
    { id: 'other', name: 'Ajeno', ownerId: 'other', memberIds: ['me', 'other'] },
  ] },
  authUser: { uid: 'me' }, navigator: { onLine: true }, console: { error() {} },
  window: { db: { collection(collection) { return { doc(id) { return {
    async update(patch) { if (failure) throw failure; calls.push({ collection, id, ...patch }); },
  }; } }; } } },
};
vm.runInNewContext(`${handler}; this.rename = handleRenameWorkspace`, context);
(async () => {
  await context.rename('personal', '  Mi estudio  ');
  assert.deepEqual(calls.pop(), { collection: 'frame_workspaces', id: 'personal', name: 'Mi estudio' });
  await context.rename('team', 'Producción');
  assert.deepEqual(calls.pop(), { collection: 'frame_workspaces', id: 'team', name: 'Producción' });
  await assert.rejects(context.rename('other', 'Cambiar'), /propietario/);
  await assert.rejects(context.rename('missing', 'Cambiar'), /propietario/);
  await assert.rejects(context.rename('team', '   '), /1 a 80/);
  await assert.rejects(context.rename('team', 'a'.repeat(81)), /1 a 80/);
  await context.rename('team', 'Equipo');
  assert.equal(calls.length, 0);
  context.navigator.onLine = false;
  await assert.rejects(context.rename('team', 'Nuevo'), /Sin conexión/);
  context.navigator.onLine = true;
  failure = new Error('permission-denied');
  await assert.rejects(context.rename('team', 'Nuevo'), /No se pudo/);
  failure = null;
  context.authUser = null;
  await assert.rejects(context.rename('team', 'Nuevo'), /propietario/);
  assert.equal(calls.length, 0);
  assert.match(app, /await onRename\(workspace.id, name\);\s+onClose\(\)/);
  assert.match(app, /maxLength=\{80\}/);
  assert.match(app, /role="alert"/);
  assert.match(app, /savingRef.current \|\| !name.trim\(\)/);
  assert.match(mobile, /<WorkspaceRenameForm/);
  assert.match(mobile, /activeWorkspace\?\.ownerId === authUser.uid/);
  console.log('workspace-rename: 17 checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
