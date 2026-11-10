const fs = require('fs');
const assert = require('assert');

const app = fs.readFileSync('app.jsx', 'utf8');
const mobile = fs.readFileSync('mobile.jsx', 'utf8');

assert.match(app, /tags: \[\], startDate: \[\], deadline: \[\], progress: \[\], attributes: \[\]/);
assert.match(app, /Más filtros/);
assert.doesNotMatch(app, /label: 'Fecha de inicio'/);
assert.match(app, /Fecha de entrega/);
assert.match(app, /Sin checklist/);
assert.match(app, /Sin responsable/);
assert.match(app, /Con entregables/);
assert.match(app, /dateFilterMatches/);
assert.match(app, /progressFilterMatches/);
assert.match(app, /attributeFilterMatches/);
assert.match(app, /value === 'overdue'\) return !closed/);
assert.match(app, /JSON\.stringify\(p\.description \|\| \[\]\)/);
assert.match(app, /freshFilters\(\)/);
assert.match(app, /hidden xl:flex/);
assert.match(mobile, /MobileFiltersSheet/);
assert.match(mobile, /applyFilters\(\{ \.\.\.state, sidebarFilter: 'all' \}\)/);
assert.match(mobile, /Buscar tareas…/);
assert.match(mobile, /Filtrar tareas/);

console.log('filter-contract: 18 checks passed');
