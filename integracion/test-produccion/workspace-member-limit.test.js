const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.jsx', 'utf8');
const team = fs.readFileSync('team.jsx', 'utf8');
const rules = fs.readFileSync('firestore.rules.v2', 'utf8');

assert.match(app, /memberIds \|\| \[\]\)\.length >= 6/);
assert.match(app, /memberIds \|\| \[\]\)\.length\}\/6/);
assert.match(team, /\{count\}\/6/);
assert.match(team, /team\.length >= 6/);
assert.match(rules, /resource\.data\.kind == 'personal' \? 1 : 6/);
assert.match(rules, /request\.resource\.data\.memberIds\.size\(\) <= 6/);
assert.match(rules, /data\.viewerIds\.size\(\) <= 30/);
assert.doesNotMatch(app + team, /length >= 3|\}\/3/);

console.log('workspace-member-limit: 8 checks passed');
