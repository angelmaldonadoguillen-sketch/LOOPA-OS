const fs = require('fs');
const assert = require('assert');

const data = fs.readFileSync('data.jsx', 'utf8');
const app = fs.readFileSync('app.jsx', 'utf8');
const views = fs.readFileSync('views.jsx', 'utf8');
const analytics = fs.readFileSync('analytics.jsx', 'utf8');
const clients = fs.readFileSync('clients.jsx', 'utf8');
const team = fs.readFileSync('team.jsx', 'utf8');
const modal = fs.readFileSync('modal.jsx', 'utf8');

assert.match(data, /isDone: true, requiresChecklist: true/);
assert.match(data, /const isCompletionStatus/);
assert.match(data, /const requiresChecklistForStatus/);
assert.match(data, /typeof column\?\.isDone === 'boolean'/);
assert.match(app, /requiresChecklistForStatus\(project\.status\)/);
assert.match(app, /window\.FRAME_KANBAN_COLUMNS = columns/);
assert.match(app, /isCompletionStatus\(p\.status\)/);
assert.match(views, /Cuenta como completada/);
assert.match(views, /Exigir checklist al 100% para entrar/);
assert.match(analytics, /isCompletionStatus\(p\.status\)/);
assert.match(clients, /isCompletionStatus\(project\.status\)/);
assert.match(team, /isCompletionStatus\(p\.status\)/);
assert.match(modal, /!isClosed\(project\)/);
assert.doesNotMatch(app, /project\.status === 'delivered' && prev\.status !== 'delivered'/);

console.log('workflow-semantics-contract: 14 checks passed');
