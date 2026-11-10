// ─────────────────────────────────────────────────────────────────
// SEED DATA — content studio sample dataset (May 2026)
// ─────────────────────────────────────────────────────────────────

const USERS = [
  { id: 'u1', name: 'Lucía Mendoza',   role: 'Director',    initials: 'LM', color: 'var(--resource-green)' },
  { id: 'u2', name: 'Mateo Vargas',    role: 'Editor',      initials: 'MV', color: 'var(--resource-coral)' },
  { id: 'u3', name: 'Sofía Reyes',     role: 'Fotógrafa',   initials: 'SR', color: 'var(--resource-blue)' },
  { id: 'u4', name: 'Diego Cruz',      role: 'Productor',   initials: 'DC', color: 'var(--resource-violet)' },
  { id: 'u5', name: 'Ana Torres',      role: 'Asistente',   initials: 'AT', color: 'var(--warn)' },
];

const PROJECT_TYPES = [
  { id: 'reel',     label: 'Reel',              color: 'var(--resource-violet)', icon: 'film' },
  { id: 'photo',    label: 'Fotografía',        color: 'var(--resource-blue)', icon: 'camera' },
  { id: 'corp',     label: 'Video corporativo', color: 'var(--resource-teal)', icon: 'briefcase' },
  { id: 'campaign', label: 'Campaign',          color: 'var(--resource-coral)', icon: 'zap' },
  { id: 'bts',      label: 'BTS',               color: 'var(--warn)', icon: 'film' },
  { id: 'podcast',  label: 'Podcast',           color: 'var(--resource-pink)', icon: 'mic' },
  { id: 'other',    label: 'Otro',              color: 'var(--resource-neutral)', icon: 'folder' },
];

const STATUSES = [
  { id: 'briefing',  label: 'Briefing',           color: 'var(--resource-neutral)' },
  { id: 'producing', label: 'En producción',      color: 'var(--warn)' },
  { id: 'editing',   label: 'Edición',            color: 'var(--resource-blue)' },
  { id: 'review',    label: 'Revisión cliente',   color: 'var(--resource-violet)' },
  { id: 'delivered', label: 'Entregado',          color: 'var(--resource-teal)', isDone: true, requiresChecklist: true },
  { id: 'archived',  label: 'Archivado',          color: '#62626B' },
];

const PRIORITIES = [
  { id: 'high',   label: 'Alta',  color: 'var(--danger)' },
  { id: 'medium', label: 'Media', color: 'var(--warn)' },
  { id: 'low',    label: 'Baja',  color: 'var(--resource-teal)' },
];

const TRASH_RETENTION_DAYS = 10;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Fecha actual real.
// Era `const` fijado al cargar la página. FRAME se deja abierto todo el día,
// así que después de medianoche "hoy" seguía siendo el día anterior: lo vencido,
// el resaltado del calendario y el reinicio de la rutina quedaban corridos un
// día. Se refresca cada minuto; las 19 lecturas del código toman el valor vivo.
let TODAY = new Date();
setInterval(() => { TODAY = new Date(); }, 60000);

// ── Fecha ISO en hora LOCAL ──────────────────────────────────────
// toISOString() convierte a UTC antes de formatear, así que en cualquier
// zona al oeste de Greenwich devuelve el día siguiente a partir de cierta
// hora de la tarde (en Honduras, UTC-6, desde las 18:00). Una tarjeta
// creada de noche quedaba fechada al día equivocado.
//
// Vive acá porque data.jsx es el primer archivo que carga; el resto de la
// app lo usa desde este punto en adelante.
const localISO = (dt) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Opacidad compatible con hex y con variables CSS. Concatenar "22" a un
// color funcionaba con #RRGGBB, pero se rompe cuando la paleta cambia por tema.
const colorAlpha = (color, percent) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

const d = (offset) => {
  const dt = new Date(TODAY);
  dt.setDate(dt.getDate() + offset);
  return localISO(dt);
};

const COVER_IMAGES = {
  // Use Unsplash source URLs as covers — falls back gracefully
  campaign:  'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=70',
  corp:      'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=70',
  bts:       'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=1200&q=70',
  podcast:   'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?auto=format&fit=crop&w=1200&q=70',
  reels:     'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&w=1200&q=70',
  product:   'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=1200&q=70',
  fashion:   'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1200&q=70',
  music:     'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1200&q=70',
};

const SEED_PROJECTS = [
  {
    id: 'p1',
    title: 'Campaña de Lanzamiento — Marca Volcán',
    client: 'Volcán Activewear',
    type: 'campaign',
    status: 'producing',
    priority: 'high',
    assignees: ['u1', 'u3', 'u4'],
    startDate: d(-8),
    deadline: d(2),
    sessionDate: d(1),
    budget: 24000,
    currency: 'USD',
    tags: ['lanzamiento', 'multiformato', 'top-tier'],
    cover: { type: 'image', value: COVER_IMAGES.campaign },
    description: [
      { type: 'p', text: 'Campaña 360 para el lanzamiento de la nueva línea técnica de Volcán. Mix de reel hero + serie de fotografía editorial + cortes para paid social.' },
      { type: 'b', text: 'Entregables clave' },
      { type: 'ul', items: ['1× Reel hero 60s', '12× Fotografías editoriales', '6× Cortes verticales 9:16', 'BTS 30s'] },
    ],
    checklist: [
      { id: 'c1', text: 'Pre-producción y moodboard aprobado', done: true },
      { id: 'c2', text: 'Casting de talento confirmado', done: true },
      { id: 'c3', text: 'Scout de locación', done: true },
      { id: 'c4', text: 'Día de rodaje — Sesión principal', done: false },
      { id: 'c5', text: 'Edición v1 reel hero', done: false },
      { id: 'c6', text: 'Color grading', done: false },
      { id: 'c7', text: 'Selección y retoque fotográfico', done: false },
      { id: 'c8', text: 'Entrega final master + cortes', done: false },
    ],
    deliverables: [
      { id: 'd1', name: 'Reel hero 60s — master 4K', kind: 'video', status: 'pending' },
      { id: 'd2', name: 'Pack fotos editoriales (RAW + retoque)', kind: 'photos', status: 'pending' },
      { id: 'd3', name: 'Cortes verticales x6', kind: 'video', status: 'pending' },
    ],
    timeline: [
      { id: 't1', label: 'Kickoff con cliente', date: d(-12), status: 'done' },
      { id: 't2', label: 'Aprobación moodboard', date: d(-7), status: 'done' },
      { id: 't3', label: 'Día de rodaje', date: d(1),  status: 'pending' },
      { id: 't4', label: 'Entrega final',   date: d(2),  status: 'pending' },
    ],
    comments: [
      { id: 'cm1', userId: 'u4', text: 'Confirmé locación para el viernes. Llegamos 6am para luz dorada.', at: d(-2) + 'T09:24' },
      { id: 'cm2', userId: 'u1', text: '@Mateo Vargas ojo con el ratio de cortes verticales — el cliente quiere también 4:5.', at: d(-1) + 'T16:12' },
      { id: 'cm3', userId: 'u2', text: 'Perfecto, agrego 4:5 a la lista de exports.', at: d(-1) + 'T17:02' },
      { id: 'cm4', userId: 'u3', text: 'Subí el moodboard final v3 a la carpeta compartida 📎', at: d(0) + 'T11:48' },
    ],
  },

  {
    id: 'p2',
    title: 'Video Corporativo — Holding Norte',
    client: 'Holding Norte',
    type: 'corp',
    status: 'editing',
    priority: 'medium',
    assignees: ['u2', 'u4'],
    startDate: d(-20),
    deadline: d(5),
    sessionDate: d(-10),
    budget: 8500,
    currency: 'USD',
    tags: ['B2B', 'institucional'],
    cover: { type: 'image', value: COVER_IMAGES.corp },
    description: [
      { type: 'p', text: 'Pieza institucional 2:30 sobre los 25 años de la compañía. Mix de entrevistas con directivos + b-roll de operaciones.' },
    ],
    checklist: [
      { id: 'c1', text: 'Guion aprobado por comunicación', done: true },
      { id: 'c2', text: 'Rodaje entrevistas (3 directivos)', done: true },
      { id: 'c3', text: 'Captura de b-roll planta + oficinas', done: true },
      { id: 'c4', text: 'Edición v1', done: true },
      { id: 'c5', text: 'Color + sonido', done: false },
      { id: 'c6', text: 'Subtitulado ES/EN', done: false },
    ],
    deliverables: [
      { id: 'd1', name: 'Master 2:30 — 4K', kind: 'video', status: 'pending' },
      { id: 'd2', name: 'Versión sin subtítulos', kind: 'video', status: 'pending' },
      { id: 'd3', name: 'Cortes 30s para LinkedIn', kind: 'video', status: 'pending' },
    ],
    timeline: [
      { id: 't1', label: 'Aprobación guion', date: d(-18), status: 'done' },
      { id: 't2', label: 'Rodaje',           date: d(-10), status: 'done' },
      { id: 't3', label: 'Revisión interna v1', date: d(-1), status: 'done' },
      { id: 't4', label: 'Entrega final',    date: d(5),  status: 'pending' },
    ],
    comments: [
      { id: 'cm1', userId: 'u4', text: 'Recibido feedback del cliente — pidió bajar la música en la intro.', at: d(-1) + 'T14:00' },
      { id: 'cm2', userId: 'u2', text: 'Hecho. v2 lista para revisión interna.', at: d(0) + 'T10:30' },
    ],
  },

  {
    id: 'p3',
    title: 'BTS Colección Otoño — Studio Lumen',
    client: 'Studio Lumen',
    type: 'bts',
    status: 'review',
    priority: 'medium',
    assignees: ['u2', 'u3'],
    startDate: d(-14),
    deadline: d(0),
    sessionDate: d(-12),
    budget: 3200,
    currency: 'USD',
    tags: ['fashion', 'BTS'],
    cover: { type: 'image', value: COVER_IMAGES.fashion },
    description: [
      { type: 'p', text: 'Documental corto detrás de cámaras de la sesión de la nueva colección Otoño. Estética fílmica, super 16 simulado.' },
    ],
    checklist: [
      { id: 'c1', text: 'Briefing creativo', done: true },
      { id: 'c2', text: 'Día de rodaje BTS', done: true },
      { id: 'c3', text: 'Selecta', done: true },
      { id: 'c4', text: 'Edición v1', done: true },
      { id: 'c5', text: 'Revisión cliente — round 1', done: true },
      { id: 'c6', text: 'Revisión cliente — round 2', done: false },
      { id: 'c7', text: 'Master final', done: false },
    ],
    deliverables: [
      { id: 'd1', name: 'BTS 90s — versión cliente', kind: 'video', status: 'ready' },
      { id: 'd2', name: 'Master final aprobado', kind: 'video', status: 'pending' },
    ],
    timeline: [
      { id: 't1', label: 'Rodaje BTS',     date: d(-12), status: 'done' },
      { id: 't2', label: 'Revisión cliente', date: d(-3),  status: 'done' },
      { id: 't3', label: 'Entrega master',  date: d(0),   status: 'pending' },
    ],
    comments: [
      { id: 'cm1', userId: 'u3', text: 'El cliente pidió un par de cambios menores en el tercer acto.', at: d(-2) + 'T15:30' },
      { id: 'cm2', userId: 'u1', text: '@Mateo Vargas dale prioridad — entrega es hoy.', at: d(0) + 'T08:15' },
    ],
  },

  {
    id: 'p4',
    title: 'Podcast mensual — Episodio 12',
    client: 'Tinta Negra',
    type: 'podcast',
    status: 'producing',
    priority: 'low',
    assignees: ['u4', 'u5'],
    startDate: d(-3),
    deadline: d(8),
    sessionDate: d(3),
    budget: 1800,
    currency: 'USD',
    tags: ['recurrente', 'audio+video'],
    cover: { type: 'color', value: '#1a1a1f' },
    description: [
      { type: 'p', text: 'Episodio 12 de la serie mensual. Invitada confirmada: Carla Iturri (arquitecta). Set 3 cámaras + audio multipista.' },
    ],
    checklist: [
      { id: 'c1', text: 'Confirmación invitada', done: true },
      { id: 'c2', text: 'Preparar set y luces', done: false },
      { id: 'c3', text: 'Grabación (90 min)', done: false },
      { id: 'c4', text: 'Edición video + audio', done: false },
      { id: 'c5', text: 'Cortes para redes (5×)', done: false },
      { id: 'c6', text: 'Publicación plataformas', done: false },
    ],
    deliverables: [
      { id: 'd1', name: 'Episodio completo 60min', kind: 'video', status: 'pending' },
      { id: 'd2', name: 'Audio master MP3', kind: 'audio', status: 'pending' },
      { id: 'd3', name: '5× cortes verticales 60s', kind: 'video', status: 'pending' },
    ],
    timeline: [
      { id: 't1', label: 'Grabación',  date: d(3), status: 'pending' },
      { id: 't2', label: 'Publicación', date: d(8), status: 'pending' },
    ],
    comments: [
      { id: 'cm1', userId: 'u5', text: 'Carla confirmó horario para el lunes 10am. Llegará 9:30.', at: d(-1) + 'T13:20' },
    ],
  },

  {
    id: 'p5',
    title: 'Reels Redes Sociales — Paquete Mayo',
    client: 'Café Origen',
    type: 'reel',
    status: 'producing',
    priority: 'high',
    assignees: ['u1', 'u2'],
    startDate: d(-5),
    deadline: d(4),
    sessionDate: d(-2),
    budget: 4200,
    currency: 'USD',
    tags: ['social', 'paquete', 'mensual'],
    cover: { type: 'image', value: COVER_IMAGES.reels },
    description: [
      { type: 'p', text: 'Paquete mensual de 8 reels para Instagram + TikTok. Mix de producto + lifestyle + recetas.' },
    ],
    checklist: [
      { id: 'c1', text: 'Calendario editorial mayo', done: true },
      { id: 'c2', text: 'Sesión de grabación (8 piezas)', done: true },
      { id: 'c3', text: 'Edición lote 1 (4 reels)', done: true },
      { id: 'c4', text: 'Edición lote 2 (4 reels)', done: false },
      { id: 'c5', text: 'Aprobación cliente', done: false },
      { id: 'c6', text: 'Programación en Later', done: false },
    ],
    deliverables: [
      { id: 'd1', name: '8× Reels 9:16 — 30 a 45s', kind: 'video', status: 'pending' },
      { id: 'd2', name: 'Subtítulos burned-in', kind: 'video', status: 'pending' },
    ],
    timeline: [
      { id: 't1', label: 'Sesión rodaje',  date: d(-2), status: 'done' },
      { id: 't2', label: 'Entrega cliente', date: d(4), status: 'pending' },
    ],
    comments: [
      { id: 'cm1', userId: 'u2', text: 'Subí los 4 primeros a la carpeta de revisión.', at: d(0) + 'T09:00' },
      { id: 'cm2', userId: 'u1', text: 'Buenísimos. @Sofía Reyes ¿puedes revisar el color del reel 03? Está un toque cálido.', at: d(0) + 'T10:14' },
      { id: 'cm3', userId: 'u3', text: 'Mirando ahora — ajusto el WB y subo de nuevo.', at: d(0) + 'T10:42' },
    ],
  },

  {
    id: 'p6',
    title: 'Fotografía de producto — Línea Premium',
    client: 'Atelier Sur',
    type: 'photo',
    status: 'briefing',
    priority: 'medium',
    assignees: ['u3', 'u5'],
    startDate: d(0),
    deadline: d(12),
    sessionDate: d(6),
    budget: 5600,
    currency: 'USD',
    tags: ['producto', 'estudio'],
    cover: { type: 'image', value: COVER_IMAGES.product },
    description: [
      { type: 'p', text: 'Sesión de producto en estudio para la nueva línea premium. 24 SKUs, fondo neutro + lifestyle minimalista.' },
    ],
    checklist: [
      { id: 'c1', text: 'Recibir muestras de producto', done: false },
      { id: 'c2', text: 'Definir paleta y referencias', done: false },
      { id: 'c3', text: 'Sesión estudio día 1 (12 SKUs)', done: false },
      { id: 'c4', text: 'Sesión estudio día 2 (12 SKUs)', done: false },
      { id: 'c5', text: 'Selección + retoque', done: false },
      { id: 'c6', text: 'Entrega ecommerce + redes', done: false },
    ],
    deliverables: [
      { id: 'd1', name: '24× fotos producto fondo neutro', kind: 'photos', status: 'pending' },
      { id: 'd2', name: '12× fotos lifestyle', kind: 'photos', status: 'pending' },
    ],
    timeline: [
      { id: 't1', label: 'Briefing creativo', date: d(0), status: 'pending' },
      { id: 't2', label: 'Sesión',            date: d(6), status: 'pending' },
      { id: 't3', label: 'Entrega final',     date: d(12), status: 'pending' },
    ],
    comments: [],
  },

  {
    id: 'p7',
    title: 'Video Musical — Tonia "Aurora"',
    client: 'Sello Norte',
    type: 'reel',
    status: 'review',
    priority: 'high',
    assignees: ['u1', 'u2', 'u4'],
    startDate: d(-25),
    deadline: d(1),
    sessionDate: d(-15),
    budget: 18500,
    currency: 'USD',
    tags: ['music-video', 'narrativo'],
    cover: { type: 'image', value: COVER_IMAGES.music },
    description: [
      { type: 'p', text: 'Video musical narrativo 3:40 para el single "Aurora". Locación: dunas + casa abandonada. VFX ligeros.' },
    ],
    checklist: [
      { id: 'c1', text: 'Storyboard aprobado', done: true },
      { id: 'c2', text: 'Casting + locaciones', done: true },
      { id: 'c3', text: 'Rodaje 2 días', done: true },
      { id: 'c4', text: 'Edición v1', done: true },
      { id: 'c5', text: 'VFX + color', done: true },
      { id: 'c6', text: 'Aprobación artista', done: false },
      { id: 'c7', text: 'Master final', done: false },
    ],
    deliverables: [
      { id: 'd1', name: 'Master 4K — versión completa', kind: 'video', status: 'pending' },
      { id: 'd2', name: 'Vertical 9:16', kind: 'video', status: 'pending' },
    ],
    timeline: [
      { id: 't1', label: 'Rodaje',           date: d(-15), status: 'done' },
      { id: 't2', label: 'Aprobación artista', date: d(0), status: 'pending' },
      { id: 't3', label: 'Entrega',          date: d(1),  status: 'pending' },
    ],
    comments: [
      { id: 'cm1', userId: 'u1', text: 'Mandé v3 a Tonia ayer. Espero feedback hoy.', at: d(-1) + 'T20:10' },
      { id: 'cm2', userId: 'u4', text: 'El sello pidió ver una versión sin el plano de las dunas en el minuto 2:10.', at: d(0) + 'T07:45' },
      { id: 'cm3', userId: 'u2', text: 'Listo, hago el corte alternativo y lo subo en 1h.', at: d(0) + 'T08:30' },
    ],
  },

  {
    id: 'p8',
    title: 'Documental corto — Oficios del Sur',
    client: 'Fundación Raíz',
    type: 'corp',
    status: 'delivered',
    priority: 'low',
    assignees: ['u1', 'u3', 'u5'],
    startDate: d(-60),
    deadline: d(-3),
    sessionDate: d(-40),
    budget: 12000,
    currency: 'USD',
    tags: ['documental', 'fundación'],
    cover: { type: 'image', value: COVER_IMAGES.bts },
    description: [
      { type: 'p', text: 'Documental 8 minutos sobre oficios tradicionales del sur. Tres capítulos, narración off, música original.' },
    ],
    checklist: [
      { id: 'c1', text: 'Investigación', done: true },
      { id: 'c2', text: 'Rodaje en terreno (2 semanas)', done: true },
      { id: 'c3', text: 'Edición + narración', done: true },
      { id: 'c4', text: 'Música original', done: true },
      { id: 'c5', text: 'Entrega', done: true },
    ],
    deliverables: [
      { id: 'd1', name: 'Master 8min — 4K', kind: 'video', status: 'ready' },
      { id: 'd2', name: 'Trailer 60s', kind: 'video', status: 'ready' },
    ],
    timeline: [
      { id: 't1', label: 'Rodaje',  date: d(-40), status: 'done' },
      { id: 't2', label: 'Entrega', date: d(-3),  status: 'done' },
    ],
    comments: [
      { id: 'cm1', userId: 'u1', text: 'Cliente súper feliz. Posible segunda temporada.', at: d(-2) + 'T18:00' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

// Compatibilidad visual para documentos creados con la paleta eléctrica
// anterior. Se adapta al tema al renderizar y nunca reescribe Firestore.
const LEGACY_THEME_COLORS = {
  '#d4ff4f': 'var(--resource-green)',
  '#ff7a59': 'var(--resource-coral)',
  '#6cc4ff': 'var(--resource-blue)',
  '#c089ff': 'var(--resource-violet)',
  '#7dd3c0': 'var(--resource-teal)',
  '#fb7185': 'var(--resource-pink)',
  '#4ade80': 'var(--resource-green)',
  '#34d399': 'var(--resource-green)',
  '#f97316': 'var(--resource-orange)',
  '#f59e0b': 'var(--resource-orange)',
  '#38bdf8': 'var(--resource-blue)',
  '#06b6d4': 'var(--resource-teal)',
  '#8b5cf6': 'var(--resource-violet)',
  '#ec4899': 'var(--resource-pink)',
  '#9a9aa3': 'var(--resource-neutral)',
  '#62626b': 'var(--resource-neutral)',
};
const resolveThemeColor = (color) => {
  if (!color || typeof color !== 'string') return 'var(--resource-neutral)';
  return LEGACY_THEME_COLORS[color.trim().toLowerCase()] || color;
};
const themed = (item) => item ? { ...item, color: resolveThemeColor(item.color) } : item;

const getUser   = (id) => {
  const live = window.__liveTeam;
  if (live) { const u = live.find(u => u.id === id); if (u) return themed(u); }
  return themed(USERS.find(u => u.id === id)) || null;
};
// FRAME_CUSTOM_TYPES tiene prioridad — puede sobreescribir color/label de tipos default
const getType   = (id) => themed((window.FRAME_CUSTOM_TYPES || []).find(t => t.id === id) || PROJECT_TYPES.find(t => t.id === id) || PROJECT_TYPES[PROJECT_TYPES.length - 1]);
const getStatus = (id) => themed(
  (window.FRAME_KANBAN_COLUMNS || []).find(s => s.id === id)
  || STATUSES.find(s => s.id === id)
  || STATUSES[0]
);
const getPrio   = (id) => themed(PRIORITIES.find(p => p.id === id) || PRIORITIES[0]);

// ── Mi tablero: todo junto ──────────────────────────────────────
// El tablero personal es la bandeja del usuario: muestra las tarjetas de
// TODOS sus tableros, estén donde estén. No se copian ni se mueven — cada
// tarjeta sigue viviendo en el suyo, y lo que se edita acá se edita allá.
// Los tableros de equipo siguen mostrando lo suyo: ahí la lista es la del
// equipo, no la de una persona.
const boardOf = (project) => (project?.workspaceIds?.length ? project.workspaceIds : [project?.workspaceId]).filter(Boolean);

const boardProjects = (projects, workspaceId, todo) =>
  todo ? [...projects] : projects.filter(p => boardOf(p).includes(workspaceId));

// Una tarjeta de otro tablero trae el estado de ese tablero, y este puede no
// tener esa columna. Esconderla sería lo peor (la tarjeta desaparece sin
// avisar) y pintarla con el nombre de otra columna, peor todavía: se agrega
// la columna de donde viene, al final y sin poder editarla desde acá.
const boardColumns = (columns, projects, ajenas = {}, nombres = {}) => {
  const mias = new Set((columns || []).map(c => c.id));
  const extra = [];
  (projects || []).forEach(p => {
    if (!p.status || mias.has(p.status) || extra.some(c => c.id === p.status)) return;
    const origen = Object.keys(ajenas).find(id => (ajenas[id] || []).some(c => c.id === p.status));
    const columna = origen ? ajenas[origen].find(c => c.id === p.status) : null;
    extra.push({ ...(columna || { id: p.status, label: p.status, color: '#8a8a8e' }),
      fromBoardId: origen || '', fromBoard: (origen && nombres[origen]) || 'otro tablero' });
  });
  return extra.length ? [...(columns || []), ...extra] : (columns || []);
};

// Una columna prestada sólo recibe tarjetas de su propio tablero: soltar una
// tarjeta mía en la columna de otro le dejaría un estado que mi tablero no
// tiene.
const columnAccepts = (column, project) =>
  !column?.fromBoardId || boardOf(project).includes(column.fromBoardId);

// De qué tablero viene una tarjeta, cuando no es de este. Vacío si es de acá,
// así la etiqueta sólo aparece donde hace falta.
const boardOrigin = (project) => {
  const info = window.__frameBoards;
  if (!info || !project) return '';
  return boardOf(project).includes(info.activeId) ? '' : (info.names?.[project.workspaceId] || 'Otro tablero');
};

const fmtMoney = (n, c = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);
const fmtDate  = (iso) => {
  const dt = new Date(iso + 'T00:00');
  return dt.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
};
const fmtDateLong = (iso) => {
  const dt = new Date(iso + 'T00:00');
  return dt.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
};

const daysUntil = (iso) => {
  const dt = new Date(iso + 'T00:00');
  const today = new Date(TODAY); today.setHours(0,0,0,0);
  return Math.round((dt - today) / 86400000);
};

const relativeTime = (isoDateTime) => {
  const dt = new Date(isoDateTime);
  if (isNaN(dt.getTime())) return '';
  // Antes se comparaba contra un "ahora" fijo a las 14:00 del día de carga.
  // Todo lo posterior a esa hora daba diferencia negativa y caía en 'ahora',
  // y por la mañana inflaba las horas. Se mide contra el reloj real.
  const diffSec = (Date.now() - dt.getTime()) / 1000;
  if (diffSec < 60) return 'ahora';
  if (diffSec < 3600) return `hace ${Math.floor(diffSec/60)} min`;
  if (diffSec < 86400) return `hace ${Math.floor(diffSec/3600)} h`;
  const days = Math.floor(diffSec/86400);
  if (days < 7) return `hace ${days} d`;
  return new Date(isoDateTime).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
};

const progressOf = (project) => {
  if (!project.checklist?.length) return 0;
  return Math.round((project.checklist.filter(c => c.done).length / project.checklist.length) * 100);
};

// El texto visible del enlace sale del portapapeles: se escapa antes de
// meterlo en el HTML que se inserta.
const escapeDescText = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Texto legible para un enlace ─────────────────────────────────
// Una URL cruda de YouTube o Drive ocupa dos renglones y corta la lectura.
// Se muestra el dominio y lo justo del camino para reconocerla; el enlace
// completo sigue en el href.
const shortenUrl = (url) => {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const rest = (u.pathname === '/' ? '' : u.pathname) + u.search;
    if (!rest) return host;
    const full = host + rest;
    if (full.length <= 42) return full;
    // Se corta por el final: el principio es lo que dice de qué se trata
    // (drive.google.com/file/d/…). Cortar por el otro lado deja colas como
    // "…z012345/view?usp=sharing", que no le dicen nada a nadie.
    return full.slice(0, 41) + '…';
  } catch {
    return url.length <= 42 ? url : url.slice(0, 41) + '…';
  }
};

// ── Sanitizado del HTML de la descripción ────────────────────────
// La descripción se guarda como HTML y se pinta con innerHTML. innerHTML no
// ejecuta <script>, pero SÍ ejecuta manejadores de evento: basta un
// <img src=x onerror="..."> guardado en una tarjeta para que el código corra
// en el navegador de cualquier compañero que la abra — con su sesión de
// Firebase disponible.
//
// Se limpia con lista blanca: lo que no está permitido, se va. Al revés
// (lista negra) siempre queda algo afuera.
const DESC_ALLOWED_TAGS = new Set([
  'P','BR','DIV','SPAN','STRONG','B','EM','I','U','S',
  'UL','OL','LI','H1','H2','H3','BLOCKQUOTE','CODE','PRE','IMG','A',
]);

const sanitizeDescHTML = (html) => {
  if (!html || typeof html !== 'string') return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  const walk = (node) => {
    [...node.children].forEach(el => {
      // Primero adentro y después esta etiqueta. Al revés, desenvolver una
      // etiqueta prohibida sacaba a sus hijos de la lista que se estaba
      // recorriendo y nadie los volvía a revisar: <foo><img onerror=…></foo>
      // pasaba entero.
      walk(el);

      if (!DESC_ALLOWED_TAGS.has(el.tagName)) {
        // Se conserva el texto de adentro: quitar la etiqueta no debería
        // hacer desaparecer lo que la persona escribió.
        el.replaceWith(...el.childNodes);
        return;
      }
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const val  = (attr.value || '').trim();

        // Cualquier on* es un manejador de evento: fuera sin excepción.
        if (name.startsWith('on')) { el.removeAttribute(attr.name); return; }

        if (el.tagName === 'IMG' && name === 'src') {
          // Sólo imágenes remotas http(s) raster. Se rechazan data:, blob: y
          // SVG para no guardar contenido activo dentro de la descripción.
          if (!FrameAttachments.normalizeRemoteImageUrl(val)) el.removeAttribute(attr.name);
          else el.setAttribute('src', FrameAttachments.normalizeRemoteImageUrl(val));
          return;
        }
        if (el.tagName === 'IMG' && name === 'alt') {
          el.setAttribute('alt', val.slice(0, 200));
          return;
        }
        if (el.tagName === 'IMG' && name === 'loading') {
          el.setAttribute('loading', 'lazy');
          return;
        }
        if (el.tagName === 'IMG' && name === 'referrerpolicy') {
          el.setAttribute('referrerpolicy', 'no-referrer');
          return;
        }
        if (el.tagName === 'IMG' && name === 'data-frame-size') {
          if (!['sm', 'md', 'lg'].includes(val)) el.removeAttribute(attr.name);
          return;
        }
        if (el.tagName === 'IMG' && name === 'data-frame-align') {
          if (!['left', 'center', 'right'].includes(val)) el.removeAttribute(attr.name);
          return;
        }
        if (el.tagName === 'A' && name === 'href') {
          if (!/^(https?:\/\/|mailto:)/i.test(val)) el.removeAttribute(attr.name);
          return;
        }
        if (el.tagName === 'A' && (name === 'target' || name === 'rel')) {
          // Se normalizan en el segundo paso, más abajo.
          return;
        }
        // Todo lo demás sobra, incluido style: permite posicionar cosas
        // encima de la interfaz para engañar al que mira.
        el.removeAttribute(attr.name);
      });

      // Un enlace sin href no es enlace: se deja sólo el texto. Y el que sí
      // tiene abre aparte, con noopener para que la página de destino no
      // pueda tocar la pestaña de FRAME.
      if (el.tagName === 'A') {
        if (!el.getAttribute('href')) el.replaceWith(...el.childNodes);
        else {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }
      }
    });
  };

  walk(doc.body);
  return doc.body.innerHTML;
};

// ── Datos de presentación de un miembro ──────────────────────────
// Se guarda una copia dentro del tablero, no una referencia al perfil.
// Motivo: las reglas no permiten leer perfiles ajenos —y está bien que no lo
// permitan— así que sin esta copia el tablero no podría mostrar quién lo
// integra ni resolver los avatares de los responsables de un proyecto.
// Es sólo lo necesario para dibujar; lo demás vive en frame_users.
const memberCard = (m) => ({
  id:       m?.id       || '',
  name:     m?.name     || '',
  initials: m?.initials || (m?.name || '?').slice(0, 2).toUpperCase(),
  color:    m?.color    || '#9A9AA3',
  avatar:   m?.avatar   || '',
  role:     m?.role     || 'Colaborador',
  email:    m?.email    || '',
});

// Miembros del tablero, listos para pintar. El orden pone primero al dueño.
const workspaceMembers = (ws) => {
  if (!ws) return [];
  const map = ws.members || {};
  return (ws.memberIds || [])
    .map(uid => ({ ...memberCard(map[uid]), id: uid, isOwner: ws.ownerId === uid }))
    .sort((a, b) => (b.isOwner ? 1 : 0) - (a.isOwner ? 1 : 0));
};

// ── Urgencia ─────────────────────────────────────────────────────
// Un solo lugar donde se define qué es "urgente". Estaba repetido en cinco
// puntos con dos criterios distintos: la sidebar y los filtros usaban
// "menos de 3 días" y el contador de la tarjeta pintaba de amarillo "3 días
// o menos". Un proyecto a exactamente 3 días se veía amarillo pero no
// contaba en "Deadlines urgentes".
const URGENT_DAYS = 3;

const workflowColumn = (status) =>
  (window.FRAME_KANBAN_COLUMNS || []).find(column => column.id === status);

// Las columnas son editables, así que el cierre es comportamiento y no nombre.
// Los flags indefinidos conservan compatibilidad con tableros anteriores.
const isCompletionStatus = (status) => {
  const column = workflowColumn(status);
  return typeof column?.isDone === 'boolean' ? column.isDone : status === 'delivered';
};

const requiresChecklistForStatus = (status) => {
  const column = workflowColumn(status);
  return typeof column?.requiresChecklist === 'boolean'
    ? column.requiresChecklist
    : status === 'delivered';
};

const isClosed = (project) =>
  project.status === 'archived' || isCompletionStatus(project.status);

const isUrgent = (project) => {
  if (isClosed(project)) return false;
  const d = daysUntil(project.deadline);
  return d >= 0 && d <= URGENT_DAYS;
};

const isOverdue = (project) => !isClosed(project) && daysUntil(project.deadline) < 0;

// Lo que tiene que encender la alerta. isUrgent sola deja fuera lo ya
// vencido (pide d >= 0), que es el caso más urgente de todos: una tarea
// atrasada dejaba el icono en gris y el filtro vacío.
const needsAttention = (project) => isUrgent(project) || isOverdue(project);

// ── Normalización de proyectos ───────────────────────────────────
// Firestore no garantiza forma: un documento puede no tener un campo si se
// creó con otra versión del esquema, se editó desde la consola o entró por
// la API REST. El resto de la app asume que existen y hace cosas como
// p.tags.some(...) o p.client.toLowerCase() directamente — con un campo
// ausente eso no degrada, tira TypeError y se cae la vista entera
// (por ejemplo, escribir en el buscador con un solo proyecto sin tags).
//
// En vez de sembrar `|| []` en cada punto de uso, la forma se garantiza una
// sola vez acá, al entrar el dato. Todo lo de adentro puede confiar.
const normalizeProject = (p) => ({
  ...p,
  title:        p.title        ?? '',
  client:       p.client       ?? '',
  type:         p.type         ?? 'other',
  status:       p.status       ?? 'briefing',
  priority:     p.priority     ?? 'medium',
  // Las fechas faltantes dejaban el campo del modal en "dd/mm/aaaa" y
  // rompían el cálculo de urgencia, que compara contra deadline.
  startDate:    p.startDate    || localISO(new Date()),
  deadline:     p.deadline     ?? '',
  sessionDate:  p.sessionDate  || p.startDate || p.deadline || localISO(new Date()),
  currency:     p.currency     ?? 'USD',
  budget:       typeof p.budget === 'number' ? p.budget : 0,
  tags:         Array.isArray(p.tags)         ? p.tags         : [],
  assignees:    Array.isArray(p.assignees)    ? p.assignees    : [],
  checklist:    Array.isArray(p.checklist)    ? p.checklist    : [],
  deliverables: Array.isArray(p.deliverables) ? p.deliverables : [],
  comments:     Array.isArray(p.comments)     ? p.comments     : [],
  timeline:     Array.isArray(p.timeline)     ? p.timeline     : [],
  description:  Array.isArray(p.description)  ? p.description  : [],
  // Compatibilidad: una tarea anterior a la visibilidad múltiple pertenece
  // únicamente a su tablero original hasta que alguien la comparta.
  workspaceIds: Array.isArray(p.workspaceIds)
    ? [...new Set(p.workspaceIds.filter(Boolean))]
    : (p.workspaceId ? [p.workspaceId] : []),
  viewerIds:    Array.isArray(p.viewerIds) ? [...new Set(p.viewerIds.filter(Boolean))] : [],
  // Compatibilidad: las tareas anteriores al portal nacen visibles. Sólo un
  // false guardado explícitamente las excluye del seguimiento del cliente.
  clientVisible: p.clientVisible !== false,
  cover:        p.cover && typeof p.cover === 'object' ? p.cover : { type: 'color', value: 'var(--surface-2)' },
});

const normalizeClient = (c) => ({
  ...c,
  name:     c.name     ?? '',
  industry: c.industry ?? 'Sin categoría',
  tags:     Array.isArray(c.tags) ? c.tags : [],
  notes:    c.notes    ?? '',
  portalToken: typeof c.portalToken === 'string' ? c.portalToken : '',
  portalPublished: c.portalPublished === true,
  contact:  c.contact && typeof c.contact === 'object' ? c.contact : { name: '—', email: '—', phone: '—' },
});

const normalizeMember = (m) => ({
  ...m,
  name:   m.name   ?? '',
  role:   m.role   ?? 'Colaborador',
  email:  m.email  ?? '',
  skills: Array.isArray(m.skills) ? m.skills : [],
  status: m.status ?? 'pending',
});

Object.assign(window, {
  USERS, PROJECT_TYPES, STATUSES, PRIORITIES, SEED_PROJECTS, COVER_IMAGES,
  TRASH_RETENTION_DAYS, TRASH_RETENTION_MS,
  TODAY, d,
  getUser, getType, getStatus, getPrio,
  resolveThemeColor,
  fmtMoney, fmtDate, fmtDateLong, daysUntil, relativeTime, progressOf,
  localISO, normalizeProject, normalizeClient, normalizeMember,
  URGENT_DAYS, isClosed, isUrgent, isOverdue, needsAttention,
  memberCard, workspaceMembers, sanitizeDescHTML,
});
