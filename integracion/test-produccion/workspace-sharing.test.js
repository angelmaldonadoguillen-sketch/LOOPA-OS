const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.jsx', 'utf8');
const handler = app.match(/  const handleSetProjectWorkspaces = async[\s\S]*?\n  \};/)[0];
const workspace = (id, memberIds) => ({ id, name: id, memberIds });
const records = new Map([
  ['frame_workspaces/home', workspace('home', ['me'])],
  ['frame_workspaces/team', workspace('team', ['me', 'new-member'])],
]);
let committed = [], pending = [], failure = null;
const messages = [];
const ref = path => ({
  path,
  collection: name => ({ doc: id => ref(`${path}/${name}/${id}`) }),
  async get() { return { exists: records.has(path), data: () => records.get(path) }; },
  async set() { assert.match(path, /\/activity\//); },
  async update() { throw new Error('No debe haber escrituras parciales fuera del lote'); },
});
const context = {
  wsId: 'home',
  state: { currentUserId: 'me', team: [],
    workspaces: [{ ...workspace('home', ['me']), _hasPendingWrites: true }, workspace('team', ['me'])],
    customTypes: [{ id: 'custom', label: 'Custom' }],
    kanbanColumns: [{ id: 'review', label: 'Revisión' }],
  },
  PROJECT_TYPES: [], STATUSES: [], console,
  notifyWriteError: error => messages.push(error.message),
  firebase: { firestore: { FieldValue: { arrayUnion: id => ({ add: id }), arrayRemove: id => ({ remove: id }) } } },
  window: {
    frameToast: message => messages.push(message),
    db: {
      collection: name => ({ doc: id => ref(`${name}/${id}`) }),
      batch() {
        pending = [];
        return {
          set: (ref, patch) => pending.push({ path: ref.path, patch }),
          update: (ref, patch) => pending.push({ path: ref.path, patch }),
          async commit() { if (failure) throw failure; committed = [...pending]; },
        };
      },
    },
  },
};
vm.runInNewContext(`${handler}; this.share = handleSetProjectWorkspaces`, context);
const project = { id: 'task', workspaceId: 'home', workspaceIds: ['home'], type: 'custom', status: 'review' };
(async () => {
  await context.share(project, ['team', 'team']);
  const task = committed.find(write => write.path === 'frame_projects/task');
  assert.deepEqual(Array.from(task.patch.workspaceIds), ['home', 'team']);
  assert.deepEqual(Array.from(task.patch.viewerIds), ['me', 'new-member']);
  assert.equal(committed.length, 5); // tipo, columna, tarea y dos referencias
  assert.ok(committed.some(write => write.path.endsWith('/kanban_columns')));
  assert.ok(committed.some(write => write.path.endsWith('/project_types')));
  assert.equal(committed.find(write => write.path === 'frame_workspaces/team').patch.sharedTaskIds.add, 'task');
  committed = [];
  failure = Object.assign(new Error('denied'), { code: 'permission-denied' });
  await assert.rejects(context.share(project, ['team']), /denied/);
  assert.equal(committed.length, 0);
  assert.equal(messages.at(-1), 'denied');
  failure = null;
  await assert.rejects(context.share(project, ['missing']), /acceso/);
  assert.equal(committed.length, 0);
  context.wsId = 'team';
  await assert.rejects(context.share(project, ['team']), /principal/);
  context.wsId = 'home';
  await context.share({ ...project, workspaceIds: ['home', 'team'] }, []);
  assert.equal(committed.find(write => write.path === 'frame_workspaces/team').patch.sharedTaskIds.remove, 'task');
  assert.deepEqual(Array.from(committed.find(write => write.path === 'frame_projects/task').patch.viewerIds), ['me']);
  records.set('frame_workspaces/team', workspace('team', ['other']));
  await assert.rejects(context.share(project, ['team']), /Ya no tenés acceso/);
  assert.match(app, /No se pudieron cargar las tareas compartidas/);
  assert.match(fs.readFileSync('modal.jsx', 'utf8'), /const availableWorkspaces = workspaces;/);
  console.log('workspace-sharing: 17 checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
