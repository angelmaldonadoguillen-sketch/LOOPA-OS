const fs = require('fs');
const assert = require('assert');

const portal = fs.readFileSync('portal.jsx', 'utf8');
const app = fs.readFileSync('app.jsx', 'utf8');
const clients = fs.readFileSync('clients.jsx', 'utf8');
const rules = fs.readFileSync('firestore.rules.v2', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };

// LOOPA (Fase 4): todo va en un solo ámbito; el portal se arma antes que la app.
check(index.indexOf('// ── estudio: portal.jsx') > 0 && index.indexOf('// ── estudio: portal.jsx') < index.indexOf('// ── estudio: app.jsx'), 'el portal debe cargarse antes de montar la app');
// LOOPA (Fase 4): el portal (?portal=) lo abre LOOPA sin pasar por el ingreso.
// index.html lleva el JS ya compilado (fase 4.6): JSX → React.createElement, sin espacios.
const compacto = index.replace(/\s+/g, '');
check(compacto.includes("if(PORTAL_TOKEN&&PROD_ON==='estudio')return") && compacto.includes('React.createElement(LoopaEstudio.ClientPortal,{token:PORTAL_TOKEN})'), 'el enlace debe abrir el portal sin entrar al gestor');
check(portal.includes('crypto.getRandomValues'), 'el token debe usar entropía criptográfica');
check(portal.includes("filter(project => String(project.client"), 'el portal debe limitarse al cliente correcto');
check(portal.includes('project.clientVisible !== false'), 'las tareas del cliente deben publicarse salvo exclusión explícita');
check(fs.readFileSync('data.jsx', 'utf8').includes('clientVisible: p.clientVisible !== false'), 'los documentos anteriores deben ser visibles por compatibilidad');
check(!portal.includes('comments:'), 'la proyección no debe exponer comentarios internos');
check(!portal.includes('budget:'), 'la proyección no debe exponer presupuesto');
check(!portal.includes('assignees:'), 'la proyección no debe exponer responsables');
check(clients.includes('Publicar portal'), 'el perfil debe permitir publicar el portal');
check(clients.includes("p.clientVisible !== false ? 'Visible' : 'Oculta'"), 'cada tarea debe mostrar su visibilidad');
check(rules.includes('match /frame_client_portals/{token}'), 'las reglas deben cubrir la colección nueva');
check(rules.includes('allow get: if resource.data.published == true'), 'sólo un portal publicado debe ser legible');
check(rules.includes('allow list: if false'), 'nadie debe enumerar portales');
check(rules.includes('data.tasks.size() <= 100'), 'la proyección debe tener un límite');
check(rules.includes("data.keys().hasOnly(['workspaceId', 'clientId', 'clientName', 'clientInitials', 'clientColor', 'studioName', 'studioAvatar', 'published', 'updatedAt', 'taskIds', 'tasks'])"), 'el documento público debe rechazar campos privados');
check(portal.includes('max-w-[1440px]'), 'el portal debe aprovechar pantallas amplias');
check(portal.includes('Recursos compartidos'), 'el detalle debe reutilizar los entregables normales');
check(portal.includes('<SharedClientComments'), 'el detalle público debe incluir conversación');
check(!fs.readFileSync('modal.jsx', 'utf8').includes('Información para el cliente'), 'la tarjeta creativa no debe tener un bloque público pegado');
check(fs.readFileSync('modal.jsx', 'utf8').includes("label:'Comentarios'"), 'la pestaña debe llamarse Comentarios: no es un chat, es un registro');
check(!fs.readFileSync('modal.jsx', 'utf8').includes('El cliente y el equipo ven esta misma conversación.'), 'el chat no debe mostrar explicaciones redundantes');
check(fs.readFileSync('data.jsx', 'utf8').includes("avatar:   m?.avatar"), 'la ficha del tablero debe conservar el avatar del perfil');
check(portal.includes('studioAvatar:'), 'el portal debe proyectar sólo el avatar público del estudio');
check(rules.includes("data.studioAvatar.matches('data:image/(jpeg|png|webp);base64,.*')"), 'las reglas deben limitar el formato del avatar público');
check(fs.readFileSync('modal.jsx', 'utf8').includes('Usar archivo como portada'), 'la portada debe elegirse entre los archivos de esta tarea');
check(fs.readFileSync('modal.jsx', 'utf8').includes('aria-expanded={activityOpen}'), 'la actividad debe ser desplegable y accesible');
check(fs.readFileSync('modal.jsx', 'utf8').includes('<Icon name="image" size={13} /> Imagen'), 'los recursos deben ofrecer una acción compacta para imágenes');
check(fs.readFileSync('modal.jsx', 'utf8').includes('<Icon name="paperclip" size={13} /> Archivo'), 'los recursos deben ofrecer una acción compacta para documentos');
check(fs.readFileSync('modal.jsx', 'utf8').includes('setLinkOpen(open => !open)'), 'el formulario de enlace debe abrirse sólo cuando se solicita');
check(fs.readFileSync('modal.jsx', 'utf8').includes('onPaste={onPaste}'), 'el chat debe aceptar imágenes pegadas');
check(fs.readFileSync('modal.jsx', 'utf8').includes('Agregar emoji'), 'el chat debe ofrecer emojis');
check(!fs.readFileSync('modal.jsx', 'utf8').includes('Agregar entregable'), 'los recursos no deben esconderse dentro de un formulario de entregable');
check(fs.readFileSync('modal.jsx', 'utf8').includes('Enlace externo'), 'el enlace debe ser un campo independiente');
check(!fs.readFileSync('modal.jsx', 'utf8').includes("dv.url.replace(/^https?:\\/\\//"), 'la interfaz no debe mostrar la URL técnica del recurso');
// Compartido de entrada, con un interruptor para la excepción. La visibilidad
// NO usa `status`: ese campo venía en 'pending' por defecto, así que todo lo
// subido hasta ahora arrancaría oculto. Se usa clientVisible, igual que las
// tareas: sin el campo, se comparte.
check(!fs.readFileSync('modal.jsx', 'utf8').includes("'Compartido' : 'Privado'"),
  'no debe quedar el chip de privado: se comparte al subir');
check(fs.readFileSync('modal.jsx', 'utf8').includes('const toggleDeliverableVisible'),
  'debe existir un interruptor para ocultarle un recurso al cliente');
check(fs.readFileSync('modal.jsx', 'utf8').includes('role="switch"'),
  'ocultar debe ser un interruptor y no un botón de texto');
check(fs.readFileSync('modal.jsx', 'utf8').includes("dv.clientVisible === false"),
  'el interruptor debe apagar clientVisible, no status');
check(portal.includes('item.clientVisible !== false'),
  'sin el campo el recurso se comparte: los viejos no deben quedar ocultos');
check(portal.includes('const compartido = item =>'), 'el portal debe respetar el interruptor');
check(portal.includes('item.url === cover.value && !compartido(item)'),
  'una imagen apagada no debe colarse como portada');
// El interruptor no lleva transición: un fondo que viene de una variable y
// tiene transition-colors se queda con el color anterior (mismo defecto que
// obligó al apagón de transiciones al cambiar de tema).
check(!/role="switch"[\s\S]{0,400}transition-colors/.test(fs.readFileSync('modal.jsx', 'utf8')),
  'el interruptor no debe transicionar un color que sale de una variable');
check(!portal.includes('openTask.checklist'), 'el cliente no debe ver el checklist interno');
check(fs.readFileSync('modal.jsx', 'utf8').includes("collection('comments')"), 'los comentarios deben sincronizarse en tiempo real');
check(rules.includes('match /comments/{commentId}'), 'las reglas deben cubrir comentarios del portal');
check(rules.includes("request.resource.data.authorType == 'client'"), 'el visitante sólo debe escribir como cliente');
check(rules.includes('request.resource.data.authorName == portal().clientName'), 'el visitante debe escribir con la identidad del perfil del cliente');
check(portal.includes('clientInitials={portal.clientInitials'), 'el chat público debe usar el avatar definido del cliente');
check(!fs.readFileSync('modal.jsx', 'utf8').includes('placeholder="Tu nombre"'), 'el portal no debe pedir un nombre dentro del chat');
check(fs.readFileSync('modal.jsx', 'utf8').includes('<Icon name="emoji" size={17}'), 'el selector debe usar un icono de emoji propio y legible');
check(fs.readFileSync('icons.jsx', 'utf8').includes('emoji: <><path'), 'el icono de emoji debe pertenecer al sistema visual de FRAME');
check(!fs.readFileSync('modal.jsx', 'utf8').includes('<Icon name="smile"'), 'el chat no debe volver al símbolo de carita anterior');
check(fs.readFileSync('modal.jsx', 'utf8').includes('<Icon name="arrowUp" size={17} strokeWidth={1.9}'), 'el envío debe usar una flecha ascendente minimalista');
check(!fs.readFileSync('modal.jsx', 'utf8').includes('<Icon name="send"'), 'el chat no debe conservar el avión de papel anterior');
check(fs.readFileSync('modal.jsx', 'utf8').includes('aria-label="Adjuntar imagen"'), 'el clip debe tener un nombre accesible');
check(fs.readFileSync('modal.jsx', 'utf8').includes('aria-expanded={emojiOpen}'), 'el selector de emojis del equipo debe exponer su estado');
check(fs.readFileSync('modal.jsx', 'utf8').includes('const CHAT_EMOJI_GROUPS = ['), 'el selector debe organizar los emojis en grupos');
check(fs.readFileSync('modal.jsx', 'utf8').includes("id: 'faces', label: 'Caras'"), 'el selector debe incluir una categoría de caras');
check(fs.readFileSync('modal.jsx', 'utf8').includes("id: 'work', label: 'Trabajo'"), 'el selector debe incluir una categoría orientada al trabajo');
check(fs.readFileSync('modal.jsx', 'utf8').includes('role="tablist" aria-label="Categorías de emojis"'), 'las categorías deben ser navegables y accesibles');
// Enter ya NO envía: un comentario se piensa antes de mandarlo, y con Enter
// enviando un párrafo de tres renglones quedaba como tres comentarios sueltos
// en el registro. Se envía con el botón, que además dice qué hace.
check(!/onKeyDown=\{event => \{ if \(event\.key === 'Enter' && !event\.shiftKey[\s\S]{0,80}send\(\)/.test(fs.readFileSync('modal.jsx', 'utf8')),
  'Enter no debe enviar el comentario');
check(/>\r?\n\s+\{sending \? 'Publicando…' : 'Comentar'\}/.test(fs.readFileSync('modal.jsx', 'utf8')),
  'el envío debe ser un botón con palabra, no una flecha');
check(!fs.readFileSync('modal.jsx', 'utf8').includes('Enter para enviar · Shift + Enter para una nueva línea'),
  'no debe quedar el cartel de un atajo que ya no existe');
check(fs.readFileSync('modal.jsx', 'utf8').includes('aria-live="polite"'), 'la conversación debe anunciar mensajes nuevos sin interrumpir');
check(fs.readFileSync('modal.jsx', 'utf8').includes('Sin comentarios todavía'), 'el estado vacío debe nombrar lo que hay, sin invitar a conversar');
check(fs.readFileSync('modal.jsx', 'utf8').includes("listRef.current.scrollTop = listRef.current.scrollHeight"), 'el chat debe mantener visible el mensaje más reciente');
check(!fs.readFileSync('modal.jsx', 'utf8').includes('<FormatBtn'), 'el chat interno no debe mostrar controles decorativos sin función');
check(rules.includes('request.resource.data.text.size() <= 2000'), 'los comentarios deben tener límite de tamaño');
check(rules.includes("'attachmentUrl', 'attachmentName'"), 'los comentarios deben admitir una imagen compartida');
check(rules.includes("attachmentUrl.matches('https://firebasestorage.googleapis.com/.*')"), 'la imagen del chat debe venir del almacenamiento controlado');
check(rules.includes("affectedKeys().hasOnly(['text', 'editedAt'])"), 'la edición sólo debe cambiar el texto y su marca temporal');
check(rules.includes('allow delete: if isMember(portal().workspaceId)'), 'sólo el equipo debe poder eliminar comentarios');
check(fs.readFileSync('modal.jsx', 'utf8').includes('Editar comentario'), 'el equipo debe poder editar sus comentarios');
check(fs.readFileSync('modal.jsx', 'utf8').includes('Eliminar comentario'), 'el equipo debe poder moderar y eliminar comentarios');
check(rules.includes('request.resource.data.projectId in portal().taskIds'), 'sólo se debe comentar una tarea publicada');
check(portal.includes('h-screen overflow-y-auto'), 'el portal debe crear su propio viewport vertical desplazable');
check(portal.includes('portal-page-scroll'), 'el scroll vertical debe tener una regla específica');
check(fs.readFileSync('frame.css', 'utf8').includes('overscroll-behavior-y: contain'), 'el scroll vertical debe permanecer contenido en el portal');


// ── Fase 1: el portal responde la pregunta del cliente ──────────────
check(portal.includes('Próxima entrega'), 'la portada debe abrir con la próxima entrega');
check(portal.includes('Tus trabajos'), 'el cliente debe ver la lista de sus trabajos');
check(portal.includes('const proxima = pendientes[0]'), 'la próxima entrega debe salir de lo pendiente, no de lo entregado');
check(portal.includes("pendientes = tasks.filter") && portal.includes('a.deadline'), 'lo pendiente debe ordenarse por fecha de entrega');
check(portal.includes('días de atraso'), 'un atraso debe decirse con todas las letras');
check(portal.includes("texto: 'Hoy'"), 'la entrega de hoy debe leerse como Hoy');
check(portal.includes('const avancePorFase'), 'una tarea sin checklist no debe informar 0%');
check(portal.includes('columns = []'), 'las fases deben entrar por parámetro y no alterar la forma pública');
check(!portal.includes('columns: '), 'las columnas no deben proyectarse al documento del portal');
check(app.includes('activeWs, true, state.kanbanColumns'), 'la sincronización debe pasar las columnas del tablero');
// ── Línea de proceso ────────────────────────────────────────────────
check(portal.includes('const PhaseLine'), 'el portal debe dibujar una línea de proceso');
check(portal.includes('phases: etiquetasFases'), 'las fases deben viajar dentro de cada tarea');
check(portal.includes('phaseIndex:'), 'cada tarea debe decir en qué fase está');
// Las fases van DENTRO de cada tarea a propósito: la regla valida las claves de
// arriba con hasOnly, así que una clave nueva en el documento quedaría
// rechazada en silencio y el portal dejaría de actualizarse.
check(rules.includes("'updatedAt', 'taskIds', 'tasks']"), 'la forma pública del portal no debe cambiar');
check(!/^\s{4}phases:/m.test(portal.slice(portal.indexOf('  return {'), portal.indexOf('const PhaseLine'))),
  'las fases no deben agregarse como clave del documento');
check(portal.includes('if (!Number.isFinite(i) || i < 0) return null'),
  'un estado que ya no existe en el tablero no debe dibujar una línea equivocada');
check(portal.includes('isClosed(project) ? etiquetasFases.length'),
  'una tarea entregada debe mostrar todas las fases cumplidas');
check(portal.includes('const phaseText'), 'la fase actual debe decirse con palabras');
check(portal.includes('phases.length}'), 'debe decirse cuántas fases son en total');
check(portal.includes('role="img"'), 'la línea de proceso debe ser accesible');
check(portal.includes('phases.length < 2) return null'), 'sin fases suficientes no se dibuja nada');

// ── El registro no se puede lavar ───────────────────────────────────
// Antes estas dos reglas sólo pedían isMember: el equipo podía reescribir o
// borrar lo que había dicho el cliente. La interfaz no lo ofrecía, pero desde
// la consola del navegador se hacía en un minuto.
// Se normalizan los saltos de línea: el archivo se edita en Windows y guarda
// CRLF, así que comparar contra \n fallaba aunque la regla fuera correcta.
const reglasPlanas = rules.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
check(reglasPlanas.includes("allow update: if isMember(portal().workspaceId) && resource.data.authorType == 'studio' && request.resource.data.authorType == 'studio'"),
  'el estudio sólo debe poder editar comentarios propios');
check(reglasPlanas.includes("allow delete: if isMember(portal().workspaceId) && resource.data.authorType == 'studio';"),
  'el estudio sólo debe poder borrar comentarios propios');
check(fs.readFileSync('modal.jsx', 'utf8').includes("{authorType === 'studio' && comment.authorType === 'studio' && <div className=\"flex items-center gap-0.5"),
  'los controles de moderación no deben aparecer sobre un comentario del cliente');

// El selector de emojis se fue de la vista del cliente. Los emojis del teclado
// siguen funcionando: el campo es un textarea común.
check(!fs.readFileSync('modal.jsx', 'utf8').includes('shared-emoji-picker'),
  'los comentarios con el cliente no deben tener selector de emojis');
check(fs.readFileSync('modal.jsx', 'utf8').includes('team-emoji-picker'),
  'el chat interno del equipo sí conserva su selector');
check(/<textarea ref=\{composerRef\}/.test(fs.readFileSync('modal.jsx', 'utf8')),
  'el campo debe seguir siendo un textarea para que el teclado del teléfono aporte sus emojis');

// El anillo de foco pertenece al recuadro entero. Con la regla general, el
// textarea dibujaba el suyo —6px de radio, 2px de separación— dentro de un
// contenedor de 12px: quedaba corrido y dejaba la barra de acciones afuera.
const css = fs.readFileSync('frame.css', 'utf8');
check(css.includes('.composer:focus-within'), 'el foco debe dibujarse sobre el compositor completo');
check(css.replace(/\s+/g, ' ').includes('.composer textarea:focus-visible, .composer input:focus-visible { outline: none; }'),
  'el campo no debe dibujar un segundo anillo adentro');
check((fs.readFileSync('modal.jsx', 'utf8').match(/composer rounded-xl/g) || []).length === 2,
  'los dos compositores —cliente y equipo— deben usar la misma regla');

// ── Imagen: miniatura para identificar; el detalle prioriza el proceso ───
check(portal.includes('const portadaDe'), 'la tarjeta debe llevar imagen');
check(portal.includes('const esImagenDelBrief'), 'el portal debe reconocer imágenes que pertenecen al brief');
check(portal.includes("!esImagenDelBrief(String(cover.value))"), 'una imagen del brief no debe usarse como portada del cliente');
check(portal.includes("compartido(item) && !esImagenDelBrief(item)"), 'una imagen del brief no debe publicarse como recurso del cliente');
check(portal.includes('cover: portadaDe(project)'), 'la portada debe viajar dentro de cada tarea');
check(!/^\s{4}cover:/m.test(portal.slice(portal.indexOf('  return {'), portal.indexOf('// ── Línea de proceso'))),
  'la portada no debe agregarse como clave del documento');
check(portal.includes("cover.type === 'image'"), 'una portada de color no es una imagen que se pueda abrir');
check(portal.includes("item.kind === 'photos' && /^https:\\/\\//i.test"),
  'sin portada propia debe usarse una imagen de la tarea');
check(!portal.includes("item.status === 'ready'"),
  'el portal ya no filtra por estado: todo recurso se comparte al subirlo');
check(portal.includes('{task.cover && ('), 'la lista debe mostrar la miniatura sin abrir la tarjeta');
check(!portal.includes('{openTask.cover && ('), 'el detalle no debe repetir la portada en grande');
check(portal.includes('setLightbox'), 'la imagen debe poder abrirse a tamaño completo');
check(portal.includes("z-[60]") && portal.includes('z-50 backdrop'),
  'el visor debe quedar por encima del detalle que lo abrió');
check(portal.includes("if (e.key === 'Escape') setLightbox('')"), 'el visor debe cerrarse con Escape');
check(portal.includes("item.kind === 'photos' ? <button"),
  'un recurso de imagen debe abrirse en el visor y no en otra pestaña');
check(portal.includes("item.kind === 'link' ? 'link' : item.kind === 'video' ? 'film' : 'paperclip'"),
  'cada tipo de recurso debe llevar su propio icono');
check(portal.includes('>Fecha límite<'), 'el detalle debe nombrar la fecha límite igual que el gestor');

// ── Tipo, e indicadores de contenido en la miniatura ────────────────
check(portal.includes('const TypeChip'), 'el tipo debe verse como pastilla, no como texto gris');
check(portal.includes('typeIcon:') && portal.includes('typeColor:'),
  'el icono y el color del tipo deben viajar con la tarea');
check(portal.includes('colorAlpha(color, 14)'),
  'el color de la pastilla debe salir de la paleta para adaptarse a los dos temas');
check(portal.includes('<TypeChip task={task} />'), 'la miniatura debe mostrar el tipo');
check(portal.includes('<TypeChip task={openTask} />'), 'el detalle debe mostrar el mismo tipo');
check(portal.includes('task.deliverables?.length > 0 && ('),
  'la miniatura debe indicar que hay recursos, y sólo cuando los hay');
check(portal.includes('conteoComentarios[task.id] > 0 && ('),
  'la miniatura debe indicar que hay comentarios, y sólo cuando los hay');
check(portal.includes("collection('comments')\n      .onSnapshot") || /collection\('comments'\)[\s\S]{0,40}onSnapshot/.test(portal),
  'el conteo de comentarios debe ser una sola escucha para todo el portal');

console.log(`client-portal-contract: ${checks} checks passed`);
