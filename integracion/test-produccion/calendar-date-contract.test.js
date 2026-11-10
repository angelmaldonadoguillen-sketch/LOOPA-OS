const assert = require('node:assert/strict');
const fs = require('node:fs');

const views = fs.readFileSync('views.jsx', 'utf8');
const app = fs.readFileSync('app.jsx', 'utf8');

// La posición del calendario pertenece a sessionDate; deadline conserva el
// compromiso de entrega y no debe cambiar al reprogramar una tarjeta.
assert.match(views, /const date = p\.sessionDate \|\| p\.startDate \|\| p\.deadline/);
assert.match(views, /onUpdateProject\s*&&\s*onUpdateProject\(\{ \.\.\.project, sessionDate: iso \}\)/);
assert.match(views, /onUpdateProject\s*&&\s*onUpdateProject\(\{ \.\.\.cleanProject, sessionDate: iso \}\)/);
assert.doesNotMatch(views, /onUpdateProject\([^\n]*deadline:\s*iso/);
assert.match(app, /const dl = deadline \?\? ''/);
assert.match(app, /before\.sessionDate !== after\.sessionDate/);
assert.match(views, /const displayedDate = calendarDate \|\| project\.sessionDate/);
assert.match(views, /calendarDate=\{iso\}/);
assert.match(views, /fmtDate\(displayedDate\)/);
assert.doesNotMatch(views, /fmtDate\(project\.deadline\)/);

console.log('calendar-date-contract: 10 checks passed');
