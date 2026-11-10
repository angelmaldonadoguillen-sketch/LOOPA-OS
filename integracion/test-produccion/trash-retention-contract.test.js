const fs = require('fs');
const assert = require('assert');

const data = fs.readFileSync('data.jsx', 'utf8');
const app = fs.readFileSync('app.jsx', 'utf8');
const views = fs.readFileSync('views.jsx', 'utf8');
const functions = fs.readFileSync('functions/index.js', 'utf8');

assert.match(data, /const TRASH_RETENTION_DAYS = 10/);
assert.match(app, /TRASH_RETENTION_MS/);
assert.match(views, /\{TRASH_RETENTION_DAYS\} días/);
assert.match(views, /Restaurar todo/);
assert.match(views, /Vaciar papelera/);
assert.match(views, /¿Vaciar definitivamente\?/);
assert.match(app, /const handleRestoreAllTrash/);
assert.match(app, /const handlePermanentDeleteAll/);
assert.match(app, /restore_projects/);
assert.match(app, /clear_trash/);
assert.match(app, /FieldValue\.arrayUnion\(project\.id\)/);
assert.match(app, /const originWorkspace = state\.workspaces\.find/);
assert.match(app, /const primaryViewerIds = \[\.\.\.new Set\(\(originWorkspace\?\.memberIds \|\| \[\]\)/);
assert.match(app, /workspaceIds: \[originId\],[\s\S]*viewerIds: primaryViewerIds/);
assert.match(app, /batch\.set\(projectRef, primaryProject\)/);
assert.match(app, /if \(availableIds\.length === 1\) return \{ project: primaryProject, sharingFailed: false \}/);
assert.match(app, /shareBatch\.update\(projectRef, \{ workspaceIds: availableIds, viewerIds \}\)/);
assert.match(functions, /exports\.purgeExpiredTrash/);
assert.match(functions, /10 \* 24 \* 60 \* 60 \* 1000/);
assert.match(functions, /\.limit\(400\)/);

console.log('trash-retention-contract: 20 checks passed');
