const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('clients.jsx', 'utf8');
const helperSource = source.match(/const clientMonthlyProgress = \(projects, clientName, today = TODAY\) => \{[\s\S]*?\n\};/)[0];
const context = {
  isCompletionStatus: status => status === 'delivered' || status === 'approved',
};
vm.runInNewContext(`${helperSource}; this.clientMonthlyProgress = clientMonthlyProgress;`, context);

const projects = [
  { client: 'Acme', startDate: '2026-08-02', status: 'delivered' },
  { client: 'ACME', startDate: '2026-08-18', status: 'editing' },
  { client: 'Acme', startDate: '2026-08-20', status: 'archived' },
  { client: 'Acme', startDate: '2026-07-30', status: 'delivered' },
  { client: 'Otro', startDate: '2026-08-05', status: 'delivered' },
  { client: 'Acme', startDate: '2026-08-22', status: 'approved' },
];

assert.deepEqual(
  { ...context.clientMonthlyProgress(projects, ' acme ', new Date('2026-08-15T12:00:00')) },
  { total: 3, completed: 2, percent: 67 },
);
assert.deepEqual(
  { ...context.clientMonthlyProgress(projects, 'Sin tareas', new Date('2026-08-15T12:00:00')) },
  { total: 0, completed: 0, percent: 0 },
);
assert.match(source, /role="progressbar"/);
assert.match(source, /aria-valuenow=\{monthlyProgress\.percent\}/);
assert.match(source, /Progreso del mes/);

assert.match(source, /isCompletionStatus\(project\.status\)/);

console.log('client-progress: 6 checks passed');
