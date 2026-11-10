const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.jsx', 'utf8');
const analytics = fs.readFileSync('analytics.jsx', 'utf8');
const auth = fs.readFileSync('auth.jsx', 'utf8');
const clients = fs.readFileSync('clients.jsx', 'utf8');
const css = fs.readFileSync('frame.css', 'utf8');
const mobile = fs.readFileSync('mobile.jsx', 'utf8');
const modal = fs.readFileSync('modal.jsx', 'utf8');
const portal = fs.readFileSync('portal.jsx', 'utf8');
const views = fs.readFileSync('views.jsx', 'utf8');

assert.match(css, /\.ui-section-label\s*\{/);
assert.match(modal, /className="ui-section-label basis-full mb-3">Propiedades/);
assert.match(modal, /<SectionTitle icon="check"[^>]*>[\s\S]*?Checklist[\s\S]*?<\/SectionTitle>/);
assert.doesNotMatch(modal, /Checklist de producción/);
assert.match(modal, /\{id:'comments',label:'Comentarios',icon:'message'\}/);
assert.doesNotMatch(modal, /Los mensajes del equipo aparecerán aquí|El cliente y el equipo comparten este chat|Los cambios importantes aparecerán aquí/);
assert.match(views, /label = 'Nueva tarea'/);
assert.match(mobile, /aria-label="Nueva tarea"/);
assert.doesNotMatch(views + mobile, /Agregar tarjeta/);
assert.match(app, />Campos visibles<\/h2>/);
assert.doesNotMatch(app, /Elegí qué campos se muestran|Comportamiento de las tareas cuando no se completan|Automatizaciones de fechas para las tareas/);
assert.doesNotMatch(clients, /Empezá agregando tu primer cliente|Probá con otro término/);
assert.doesNotMatch(auth, /console\.firebase\.google\.com|Authorized domains|tooned-os/);
assert.doesNotMatch(analytics, /rounded-xl border border-app p-[45]/);
assert.match(analytics, /className="surf-panel p-5"/);
assert.match(portal, /className="ui-section-label mb-3">Recursos compartidos/);
assert.doesNotMatch(portal, />Progreso para</);

console.log('ux-consistency-contract: 17 checks passed');
