'use strict';
// Fase 2 — el módulo Producción dentro de LOOPA OS: armado, bandera, datos de
// ejemplo y garantías de que la app publicada no cambia de comportamiento.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loopa-f2-')), name);
const core = require('../../functions/production-plan');
const P = require('../../_fuente/produccion/nucleo.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('el build incluye los módulos de Producción antes de app.jsx', () => {
  const build = read('_fuente/build.js');
  // Tanda 3.3: los módulos de datos de la fusión van primero.
  // Etapa «experiencia»: la ficha del producto (la misma lógica que el servidor) va primero.
  assert.match(build, /const MODULES = \['\.\.\/functions\/production-plan\/ficha\.js', 'datos\/fusion\.js', 'datos\/fuente\.js', 'produccion\/nucleo\.js', 'produccion\/datos-reales\.js', 'produccion\/calendario\.jsx', 'produccion\/tablero\.jsx', 'produccion\/resumen\.jsx', 'produccion\/cliente\.jsx', 'shell\/navegacion\.jsx', 'catalogo\/ficha\.jsx'\]/);
  assert.match(build, /const MODULE_CSS = \['produccion\/produccion\.css', 'shell\/navegacion\.css', 'catalogo\/ficha\.css'\]/);
  const html = read('index.html');
  // index.html lleva el JS ya compilado (fase 4.6): se busca sin depender de espacios.
  const iNucleo = html.search(/const LoopaProduccion\s*=\s*\(?function/);
  const iModulo = html.indexOf('function ProduccionModulo(');
  const iApp = html.indexOf('// ── app.jsx ──');
  assert.ok(iNucleo > 0 && iModulo > iNucleo && iApp > iModulo, 'index.html desactualizado: correr node _fuente/build.js');
  assert.match(html, /\.pr-grilla \{/, 'el CSS de Producción sobrevive a la poda');
});

test('sin Producción (ni bandera ni FRAME), no aparece ni deja una pantalla vacía', () => {
  const app = read('_fuente/app.jsx');
  // Tanda 3.9: PROD_ON = FRAME (modo real) o la bandera de pruebas.
  assert.match(app, /: PROD_ON \? \[\{ id: 'produccion', label: 'Producción', icon: 'calendar' \}\] : \[\];/);
  assert.match(app, /\.\.\.modProduccion,/);
  assert.match(app, /route === 'produccion' && PROD_ON && PROD_ON !== 'estudio' && <ProduccionModulo/);
  assert.match(app, /if \(deProduccion && !PROD_ON\) return 'nueva';/);
  const cal = read('_fuente/produccion/calendario.jsx');
  assert.match(cal, /return stored === 'demo' \|\| stored === '1' \? stored : null;/, 'sólo demo o 1 encienden el módulo');
  assert.match(cal, /\['0', 'off', 'false', 'no'\]\.includes\(v\)/, '?produccion=0/off/false/no lo apagan');
});

test('sin Producción, el menú es el original (la navegación agrupada sólo con Producción)', () => {
  const app = read('_fuente/app.jsx');
  assert.match(app, /\{PROD_ON && !soloProduccion \? <NavAgrupada modules=\{modules\} route=\{route\}/);
  assert.match(app, /<nav className="nav" style=\{\{ marginTop: 8 \}\}>\s*\{modules\.map\(m => \(/, 'el menú original sigue intacto en la otra rama');
  const nav = read('_fuente/shell/navegacion.jsx');
  ['nueva', 'ventas', 'servicios', 'clientes', 'produccion', 'metricas', 'gastos', 'config'].forEach(id => assert.match(nav, new RegExp(`'${id}'`), id));
});

test('la barra lateral se contrae y lo recuerda en este equipo', () => {
  const app = read('_fuente/app.jsx');
  assert.match(app, /<div className=\{`app\$\{barraPlegada \? ' collapsed' : ''\}`\}>/);
  assert.match(app, /localStorage\.getItem\('loopa-barra-plegada'\) === '1'/);
  assert.match(app, /localStorage\.setItem\('loopa-barra-plegada', barraPlegada \? '1' : '0'\)/);
  assert.match(app, /onClick=\{\(\) => setBarraPlegada\(v => !v\)\} aria-expanded=\{!barraPlegada\}/);
});

test('mover una tarjeta: entrega y trabajo van juntas sólo en la de venta día por día', () => {
  const { workDatePatch } = require(path.join(ROOT, '_fuente/estudio/loopa-fusion.js'));
  const venta = { sourceSystem: 'loopa', sessionDate: '2026-11-18', deadline: '2026-11-18' };
  assert.deepEqual(workDatePatch(venta, '2026-11-20'), { sessionDate: '2026-11-20', deadline: '2026-11-20' });
  assert.deepEqual(workDatePatch({ ...venta, deadline: '2026-11-25' }, '2026-11-20'), { sessionDate: '2026-11-20' }, 'con entrega aparte no se junta');
  assert.deepEqual(workDatePatch({ sessionDate: '2026-11-18', deadline: '2026-11-18' }, '2026-11-20'), { sessionDate: '2026-11-20' }, 'en una manual la entrega es otro compromiso');
  assert.deepEqual(workDatePatch({ sourceSystem: 'loopa', sessionDate: '2026-11-18', deadline: '' }, '2026-11-20'), { sessionDate: '2026-11-20' }, 'sin entrega no inventa una');
});

test('ficha de tarea: lo auditado sigue corregido', () => {
  const modal = read('_fuente/estudio/modal.jsx');
  assert.match(modal, /validateImageUrl\(url\)/, 'editar un enlace lo valida como al crearlo');
  assert.match(modal, /enlaceSeguro\(dv\.url\) && \(/, 'sólo http(s) se abre');
  assert.match(read('_fuente/estudio/portal.jsx'), /enlaceSeguro\(item\.url\) \?/, 'también en el portal');
  assert.match(modal, /<InlineEdit value=\{project\.title\}[^\n]*\brequired\b/, 'el título no queda vacío');
  assert.match(modal, /campo\.tagName === 'INPUT'[^\n]*isContentEditable\)\) \{\s*if \(campo\.isConnected\) campo\.blur\(\);\s*return;/, 'Esc escribiendo no cierra');
  assert.match(modal, /if \(list\.length\) onAdd\(list\);/, 'los tags pegados van juntos');
  assert.match(modal, /setConfirmDvId\(dv\.id\)/, 'borrar un recurso pide confirmación');
  assert.match(modal, /const urgente = isUrgent\(project\);/, 'mismo criterio de urgencia');
  assert.match(modal, /label="Fecha de trabajo"/);
  assert.match(modal, /if \(!label\.trim\(\) \|\| !date\) return;/, 'un hito lleva fecha');
  assert.match(read('_fuente/estudio/app.jsx'), /workspaceKind=\{tableroDeLaTarea\?\.kind/, 'los campos dependen del tablero de la tarea');
});

test('el módulo no depende de globales de FRAME ni escribe datos', () => {
  // TODOS los archivos del módulo (y la navegación).
  const archivos = ['_fuente/produccion/calendario.jsx', '_fuente/produccion/nucleo.js', '_fuente/produccion/datos-reales.js', '_fuente/produccion/tablero.jsx', '_fuente/produccion/resumen.jsx', '_fuente/produccion/cliente.jsx', '_fuente/shell/navegacion.jsx'];
  const src = archivos.map(read).join('\n');
  assert.doesNotMatch(src, /FRAME_KANBAN_COLUMNS|__liveTeam|FRAME_CUSTOM_TYPES|window\.db|firebase/);
  // Tanda 3.5: el ÚNICO lugar que habla con Firestore es useFuenteTablero,
  // con la conexión que le pasan (nunca un global). Escribe exactamente dos
  // cosas: update() de la tarea y set() de su evento en el historial (como
  // FRAME). Nada de lotes, transacciones, borrados ni otras colecciones.
  const ini = src.indexOf('function useFuenteTablero(');
  const fin = ini < 0 ? -1 : ini + src.slice(ini).search(/\r?\n\}\r?\n/);
  assert.ok(ini > 0 && fin > ini, 'useFuenteTablero existe');
  const hook = src.slice(ini, fin);
  const resto = src.slice(0, ini) + src.slice(fin);
  // (.add( de un Set es legítimo; en una colección exige «collection», ya prohibido)
  const escrituras = /\b(db|collection|batch|runTransaction|onSnapshot)\b\s*[.(]|\.(set|update|delete)\s*\(|\[\s*['"`](set|update|delete|add)['"`]\s*\]/;
  assert.doesNotMatch(resto, escrituras, 'fuera del hook, nada de Firestore');
  assert.doesNotMatch(hook, /\b(batch|runTransaction)\b|\.(delete|add)\s*\(|\[\s*['"`](set|update|delete|add)['"`]\s*\]/, 'ni lotes, ni transacciones, ni borrados');
  assert.deepEqual(hook.match(/\.(set|update)\s*\(/g), ['.update(', '.set('], 'dos escrituras, nada más');
  assert.match(hook, /const tarea = conexion\.db\.collection\('frame_projects'\)\.doc\(id\);\s*tarea\.update\(p\)/, 'la tarea');
  assert.match(hook, /tarea\.collection\('activity'\)\.doc\(ev\.id\)\.set\(ev\)/, 'y su evento del historial');
  // Si las reglas rechazan las compartidas DESPUÉS de una foto de caché, esa
  // foto vieja no puede quedarse pisando las tareas en vivo.
  assert.match(hook, /e => \{ setCompartidas\(\[\]\);/, 'al rechazarse, las compartidas se vacían');
  // Lee sólo lo del tablero de producción.
  const colecciones = [...new Set([...hook.matchAll(/collection\('([^']+)'\)/g)].map(m => m[1]))].sort();
  assert.deepEqual(colecciones, ['activity', 'config', 'frame_clients', 'frame_projects', 'frame_users', 'frame_workspaces', 'loopa_config'].sort());
  // localStorage sólo para la bandera (2) y la preferencia de vista (1).
  assert.equal((src.match(/localStorage\.setItem\(/g) || []).length, 3, 'sólo bandera y vista preferida');
  assert.match(src, /los cambios no se guardan/, 'la edición de ejemplo avisa que no persiste');
});

test('los datos de ejemplo son deterministas y salen del planificador real', () => {
  const file = path.join(ROOT, 'integracion', 'preview', 'produccion-demo.json');
  const before = fs.readFileSync(file, 'utf8');
  const out = tmp('produccion-demo.json');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'integracion', 'preview', 'generar-demo.cjs'), '--out', out], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), before, 'el archivo del repo está al día: regenerar da exactamente lo mismo');
  const demo = JSON.parse(before);
  const generadas = demo.tareas.filter(t => t.sourceSystem === 'loopa');
  assert.ok(generadas.length >= 15);
  // Salvo el avance simulado (checklist/estado), son tareas válidas del contrato.
  generadas.forEach(t => {
    const issues = core.validateGeneratedTask({ ...t, checklist: t.checklist.map(c => ({ ...c, done: false })) });
    assert.deepEqual(issues, [], t.id);
  });
  // El calendario las ubica por día de trabajo, una vez cada una.
  const byDate = P.tasksByDate(demo.tareas.map(t => P.normalizeTask(t, demo.hoy)));
  assert.equal(Object.values(byDate).reduce((a, l) => a + l.length, 0), demo.tareas.length);
  assert.ok(demo.tareas.some(t => t.sourceSaleStatus === 'cancelled'), 'muestra una venta cancelada');
});

test('la vista previa local nunca lleva claves ni service worker', () => {
  const out = tmp('index.html');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'integracion', 'preview', 'armar-preview.cjs'), '--out', out], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(out, 'utf8');
  assert.doesNotMatch(html, /apiKey:\s*"[^"]+"/);
  assert.match(html, /if \(false\) \/\* vista previa: sin service worker \*\//);
  assert.match(html, /window\.LOOPA_DEMO_URL = "produccion-demo\.json"/);
  assert.match(read('.gitignore'), /integracion\/preview\/index\.html/, 'la vista previa no se publica');
});

test('teclado: el foco no se pierde al mover tarjetas ni al cerrar la ficha', () => {
  const tablero = read('_fuente/produccion/tablero.jsx');
  const cal = read('_fuente/produccion/calendario.jsx');
  assert.match(tablero, /data-id=\{t\.id\}/);
  assert.match(tablero, /setFoco\(\{ id: t\.id, lado \}\)/, 'tras mover, el foco vuelve a la flecha de la misma tarjeta');
  assert.match(cal, /data-id=\{t\.id\} className=\{`pr-card/);
  assert.match(cal, /document\.querySelector\(`\.pr-card\[data-id="\$\{CSS\.escape\(t\.id\)\}"\]`\)/, 'si la tarjeta se volvió a montar, se la busca por id');
  assert.match(cal, /if \(r\.ok\) setAviso\(null\);/, 'un cambio exitoso limpia el aviso');
  const nav = read('_fuente/shell/navegacion.jsx');
  assert.doesNotMatch(nav, /role="menu"|menuitem|aria-haspopup/, 'la hoja «Más» es un diálogo, no un menú sin teclado');
  assert.match(nav, /role="dialog" aria-modal="true"/);
  const css = read('_fuente/shell/navegacion.css');
  assert.match(css, /bottom: 60px;/, 'la hoja no tapa la barra inferior');
  assert.match(css, /@media \(max-width: 900px\) \{\r?\n  \.nav-grupo \{ display: none; \}/, 'en tablet no hay títulos cortados');
});

test('resumen y rutina: datos de ejemplo con equipo y rutina, sin importes', () => {
  const demo = JSON.parse(read('integracion/preview/produccion-demo.json'));
  assert.ok(Array.isArray(demo.equipo) && demo.equipo.length === 3);
  assert.ok(demo.tareas.every(t => !t.assignees || t.assignees.every(id => demo.equipo.some(m => m.id === id))), 'responsables del equipo');
  const doc = P.routineRollover(demo.rutina, demo.hoy).doc;
  assert.equal(doc.history[0].date, '2026-11-16', 'el día guardado pasa al historial al abrir');
  assert.equal(doc.today.debt.r3, 2, 'lo que quedó sin hacer suma deuda');
  const s = P.productionSummary(demo.tareas.map(t => P.normalizeTask(t, demo.hoy)), demo.columnas, demo.equipo, demo.hoy);
  assert.equal(s.workload.length, 3);
  // El resumen no calcula importes (D8). Las tareas de «próximas» traen el
  // budget: 0 que agrega normalizeTask, pero la vista nunca lo muestra.
  assert.deepEqual(Object.keys(s).sort(), ['active', 'delivered', 'deliveryRate', 'months', 'reportable', 'statusGroups', 'topClients', 'typeCounts', 'upcoming', 'urgent', 'workload']);
  const src = read('_fuente/produccion/resumen.jsx');
  assert.doesNotMatch(src, /budget|precio|total:/, 'sin montos en la vista');
  assert.match(read('_fuente/build.js'), /'produccion\/resumen\.jsx'/);
});

test('ficha del cliente: tareas por id, vista previa exacta del portal y sin datos internos', () => {
  const demo = JSON.parse(read('integracion/preview/produccion-demo.json'));
  assert.ok(demo.clientes.length >= 3 && demo.workspace && demo.workspace.name);
  const aurora = demo.clientes.find(c => c.id === 'cli-demo-cafe-aurora');
  const tareas = demo.tareas.map(t => P.normalizeTask(t, demo.hoy));
  const propias = P.clientTasks(aurora, tareas, demo.clientes);
  assert.ok(propias.length > 0 && propias.every(t => t.clientId === aurora.id), 'por id de ficha única');
  const doc = P.buildPortalDocument({ client: aurora, tasks: tareas, allClients: demo.clientes, workspace: demo.workspace, published: true, columns: demo.columnas, now: demo.hoy });
  assert.ok(doc.tasks.length >= 1 && doc.tasks.every(t => propias.find(p => p.id === t.id).clientVisible === true), 'sólo lo marcado visible (D5: nace oculto)');
  const src = read('_fuente/produccion/cliente.jsx');
  assert.match(src, /LoopaProduccion\.buildPortalDocument\(/, 'la vista previa usa la misma proyección que se publicaría');
  assert.match(src, /role="dialog" aria-modal="true"/);
  assert.doesNotMatch(src, /\.set\(|\.update\(|window\.db|firebase/, 'nada se publica de verdad en esta tanda');
  // La visibilidad pasa por las reglas del núcleo (booleano, no cualquier cosa).
  assert.equal(P.applyTaskPatch(propias[0], { clientVisible: 'sí' }).error.code, 'visibility_invalid');
  assert.equal(P.applyTaskPatch(propias[0], { clientVisible: false }).ok, true);
});

test('ficha del cliente (revisión 2.5): homónimos, archivadas, accesibilidad y foco', () => {
  const src = read('_fuente/produccion/cliente.jsx');
  const cal = read('_fuente/produccion/calendario.jsx');
  assert.match(src, /LoopaProduccion\.clientHomonyms\(cliente, clientes\)/, 'homónimos con la misma normalización que el núcleo');
  assert.match(src, /isClosed\(t, columnas\) && t\.status !== 'archived'/, 'archivado no cuenta como entregado');
  assert.match(src, /aria-label=\{`Visible para el cliente: \$\{t\.title\}`\}/, 'cada interruptor dice de qué tarea es');
  assert.match(src, /onEnlazarTarea\(t\.id\)/, 'el aviso de homónimos ofrece cómo enlazar');
  assert.match(src, /cancelada/, 'la venta cancelada se marca');
  assert.match(cal, /LoopaProduccion\.linkTaskToClient\(/, 'enlazar pasa por las reglas del núcleo');
  assert.match(cal, /abrir\(t, origenFicha\.current\)/, 'tarea abierta desde la ficha: el foco vuelve a quien abrió la ficha');
  assert.match(cal, /onAbrirCliente=\{clientes\.some\(c => c\.id === tareaAbierta\.clientId\) \? abrirCliente : null\}/, 'sin ficha conocida no hay botón que no abre nada');
});
