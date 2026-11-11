// ─────────────────────────────────────────────────────────────────
// LOOPA · Muro de una tarea: el modelo, sin DOM ni Firebase.
//
// El Muro es un lienzo donde se conectan ideas (notas, guiones, imágenes,
// enlaces, listas y paletas). No genera nada: ordena el pensamiento. Cada
// nodo y cada conexión es un documento de frame_projects/{id}/muro, así dos
// personas pueden trabajar a la vez sin pisarse.
//
// Se prueba con node (integracion/test/muro.test.cjs).
// ─────────────────────────────────────────────────────────────────
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MuroModelo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const TIPOS = ['nota', 'guion', 'imagen', 'enlace', 'lista', 'paleta'];
  const TITULOS = { nota: 'Nota', guion: 'Guion', imagen: 'Imagen', enlace: 'Enlace', lista: 'Lista', paleta: 'Paleta' };
  const ANCHOS = { nota: 280, guion: 480, imagen: 280, enlace: 300, lista: 280, paleta: 280 };
  const COLORES_NOTA = ['', '#f2c94c', '#6fcf97', '#56ccf2', '#bb6bd9', '#eb5757'];
  const LIM = { items: 400, texto: 12000, titulo: 120, celda: 2000, escenas: 60, filas: 80, colores: 16, anchoMin: 180, anchoMax: 900 };
  // Altura del punto de conexión desde el borde superior de la tarjeta. Fija:
  // así las líneas no dependen de medir cuánto ocupa el contenido.
  const PUERTO_Y = 24;
  const ZOOM_MIN = 0.2;
  const ZOOM_MAX = 2;

  const esObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const txt = (v, max) => String(v === null || v === undefined ? '' : v).slice(0, max);
  const num = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
  const acotar = (v, a, b) => Math.min(b, Math.max(a, v));
  const nuevoId = (p = 'n') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const colorValido = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));

  // Sólo http(s): el resto no se guarda ni se convierte en enlace.
  function urlSegura(valor) {
    try {
      const u = new URL(String(valor || '').trim());
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch (e) { return ''; }
  }

  function datosDe(tipo, d) {
    const x = esObj(d) ? d : {};
    if (tipo === 'nota') return { texto: txt(x.texto, LIM.texto), color: COLORES_NOTA.includes(x.color) ? x.color : '' };
    if (tipo === 'guion') {
      const escenas = (Array.isArray(x.escenas) ? x.escenas : []).slice(0, LIM.escenas).filter(esObj)
        .map(e => ({ id: txt(e.id, 40) || nuevoId('e'), tiempo: txt(e.tiempo, 20), visual: txt(e.visual, LIM.celda), audio: txt(e.audio, LIM.celda) }));
      return { escenas };
    }
    if (tipo === 'imagen') return { url: urlSegura(x.url), storagePath: txt(x.storagePath, 300) };
    if (tipo === 'enlace') return { url: urlSegura(x.url) };
    if (tipo === 'lista') {
      const filas = (Array.isArray(x.filas) ? x.filas : []).slice(0, LIM.filas).filter(esObj)
        .map(f => ({ id: txt(f.id, 40) || nuevoId('f'), texto: txt(f.texto, LIM.celda), hecho: f.hecho === true }));
      return { filas };
    }
    if (tipo === 'paleta') return { colores: (Array.isArray(x.colores) ? x.colores : []).filter(colorValido).slice(0, LIM.colores) };
    return {};
  }

  function normalizarNodo(r) {
    if (!esObj(r) || !r.id || !TIPOS.includes(r.tipo)) return null;
    return {
      id: String(r.id), clase: 'nodo', tipo: r.tipo,
      titulo: txt(r.titulo, LIM.titulo) || TITULOS[r.tipo],
      x: num(r.x, 0), y: num(r.y, 0),
      w: acotar(num(r.w, ANCHOS[r.tipo]), LIM.anchoMin, LIM.anchoMax),
      datos: datosDe(r.tipo, r.datos),
    };
  }

  const DATOS_INICIALES = {
    guion: () => ({ escenas: [{ id: nuevoId('e'), tiempo: '', visual: '', audio: '' }] }),
    lista: () => ({ filas: [{ id: nuevoId('f'), texto: '', hecho: false }] }),
    paleta: () => ({ colores: ['#111111', '#f5f5f7', '#c8f04a'] }),
  };

  function crearNodo(tipo, x, y, datos, id) {
    const base = DATOS_INICIALES[tipo] ? DATOS_INICIALES[tipo]() : {};
    return normalizarNodo({ id: id || nuevoId('n'), tipo, x, y, datos: { ...base, ...(datos || {}) } });
  }

  const idConexion = (a, b) => `c_${[String(a), String(b)].sort().join('__')}`;

  // Convierte los documentos en lo que dibuja la pantalla. Una conexión cuyo
  // nodo ya no está se descarta: nunca queda una línea colgando.
  function leer(docs) {
    const indice = {}; const nodos = [];
    (docs || []).forEach(d => {
      if (!esObj(d)) return;
      if (d.clase === 'meta') { indice[d.id] = d; return; }
      if (d.clase !== 'conexion') {
        const n = normalizarNodo(d);
        if (n) { nodos.push(n); indice[n.id] = n; }
      }
    });
    const conexiones = [];
    (docs || []).forEach(d => {
      if (!esObj(d) || d.clase !== 'conexion') return;
      if (!esObj(indice[d.a]) || !esObj(indice[d.b]) || d.a === d.b) return;
      if (indice[d.a].clase !== 'nodo' || indice[d.b].clase !== 'nodo') return;
      const c = { id: idConexion(d.a, d.b), clase: 'conexion', a: String(d.a), b: String(d.b) };
      if (!indice[c.id]) { conexiones.push(c); indice[c.id] = c; }
    });
    return { nodos, conexiones, indice };
  }

  // La conexión nueva, o null si es a sí mismo, falta un nodo o ya existe.
  function conectar(indice, a, b) {
    if (!a || !b || a === b) return null;
    const A = indice[a]; const B = indice[b];
    if (!A || !B || A.clase !== 'nodo' || B.clase !== 'nodo') return null;
    const id = idConexion(a, b);
    return indice[id] ? null : { id, clase: 'conexion', a: String(a), b: String(b) };
  }

  // De qué lados salen las líneas: las tarjetas se miran de frente, así la
  // curva no da la vuelta aunque una quede a la izquierda de la otra.
  function puntos(a, b) {
    const y1 = a.y + PUERTO_Y; const y2 = b.y + PUERTO_Y;
    if (b.x >= a.x + a.w) return { x1: a.x + a.w, y1, x2: b.x, y2, s1: 1, s2: -1 };
    if (a.x >= b.x + b.w) return { x1: a.x, y1, x2: b.x + b.w, y2, s1: -1, s2: 1 };
    // Una encima de la otra: la línea rodea por la derecha, sin cruzar tarjetas.
    return { x1: a.x + a.w, y1, x2: b.x + b.w, y2, s1: 1, s2: 1 };
  }

  const tension = (p) => acotar(Math.max(Math.abs(p.x2 - p.x1), Math.abs(p.y2 - p.y1) * 0.6) * 0.5, 40, 220);

  function curva(p) {
    const c = tension(p);
    return `M ${p.x1} ${p.y1} C ${p.x1 + p.s1 * c} ${p.y1}, ${p.x2 + p.s2 * c} ${p.y2}, ${p.x2} ${p.y2}`;
  }

  function ruta(a, b) {
    const p = puntos(a, b);
    const c = tension(p);
    return { d: curva(p), mx: (p.x1 + p.x2) / 2 + (3 * (p.s1 + p.s2) * c) / 8, my: (p.y1 + p.y2) / 2 };
  }

  // ── Vista: pantalla = mundo × z + (x, y) ─────────────────────
  const aMundo = (v, sx, sy) => ({ x: (sx - v.x) / v.z, y: (sy - v.y) / v.z });

  function zoomEn(v, factor, sx, sy) {
    const z = acotar(v.z * factor, ZOOM_MIN, ZOOM_MAX);
    return { x: sx - ((sx - v.x) * z) / v.z, y: sy - ((sy - v.y) * z) / v.z, z };
  }

  // La vista que muestra todas las cajas ({x,y,w,h}); nunca agranda de más.
  function encuadre(cajas, ancho, alto, margen = 90) {
    if (!cajas || !cajas.length) return { x: 120, y: 100, z: 1 };
    const x0 = Math.min(...cajas.map(c => c.x)); const y0 = Math.min(...cajas.map(c => c.y));
    const x1 = Math.max(...cajas.map(c => c.x + c.w)); const y1 = Math.max(...cajas.map(c => c.y + c.h));
    const z = acotar(Math.min((ancho - margen * 2) / Math.max(1, x1 - x0), (alto - margen * 2) / Math.max(1, y1 - y0), 1), ZOOM_MIN, 1);
    return { x: (ancho - (x1 - x0) * z) / 2 - x0 * z, y: (alto - (y1 - y0) * z) / 2 - y0 * z, z };
  }

  // El lugar libre más cercano al pedido, dejando aire para la etiqueta.
  // `zona` ({x0,y0,x1,y1}) es lo que se ve: se prefiere un lugar dentro de ella.
  function lugarLibre(cajas, x, y, w = 280, h = 180, zona = null) {
    const aire = 48; const paso = 60;
    const pisa = (px, py) => (cajas || []).some(c => px < c.x + c.w + aire && px + w + aire > c.x && py < c.y + (c.h || 160) + aire && py + h + aire > c.y);
    const fuera = (px, py) => !!zona && (px < zona.x0 || py < zona.y0 || px + w > zona.x1 || py + h > zona.y1);
    const choca = (px, py) => pisa(px, py) || fuera(px, py);
    if (!choca(x, y)) return { x: Math.round(x), y: Math.round(y) };
    for (let r = 1; r <= 30; r += 1) {
      const anillo = [];
      for (let i = -r; i <= r; i += 1) {
        anillo.push([i, -r], [i, r]);
        if (Math.abs(i) !== r) anillo.push([-r, i], [r, i]);
      }
      anillo.sort((a, b) => Math.hypot(a[0], a[1] * 1.4) - Math.hypot(b[0], b[1] * 1.4));
      const libre = anillo.find(([i, j]) => !choca(x + i * paso, y + j * paso));
      if (libre) return { x: Math.round(x + libre[0] * paso), y: Math.round(y + libre[1] * paso) };
    }
    return zona ? lugarLibre(cajas, x, y, w, h, null) : { x: Math.round(x), y: Math.round(y) };
  }

  // ── Cambios: { id: documento | null } ────────────────────────
  // Lo que hay que escribir para volver a como estaba antes de `cambios`.
  function inverso(indice, cambios) {
    const out = {};
    Object.keys(cambios).forEach(id => { out[id] = indice[id] || null; });
    return out;
  }

  function aplicarCambios(indice, cambios) {
    const out = { ...indice };
    Object.keys(cambios).forEach(id => { if (cambios[id]) out[id] = cambios[id]; else delete out[id]; });
    return out;
  }

  // Borrar nodos se lleva sus conexiones.
  function cambiosDeBorrar(leido, ids) {
    const fuera = new Set(ids); const c = {};
    ids.forEach(id => { c[id] = null; });
    leido.conexiones.forEach(k => { if (fuera.has(k.a) || fuera.has(k.b)) c[k.id] = null; });
    return c;
  }

  // Duplicar conserva las conexiones que quedan dentro de lo duplicado.
  function cambiosDeDuplicar(leido, ids, crearId = () => nuevoId('n')) {
    const mapa = {}; const c = {};
    ids.forEach(id => {
      const n = leido.indice[id];
      if (!n || n.clase !== 'nodo') return;
      const copia = normalizarNodo({ ...JSON.parse(JSON.stringify(n)), id: crearId(), x: n.x + 36, y: n.y + 36 });
      mapa[id] = copia.id; c[copia.id] = copia;
    });
    leido.conexiones.forEach(k => {
      if (!mapa[k.a] || !mapa[k.b]) return;
      const id = idConexion(mapa[k.a], mapa[k.b]);
      c[id] = { id, clase: 'conexion', a: mapa[k.a], b: mapa[k.b] };
    });
    return { cambios: c, nuevos: Object.values(mapa) };
  }

  // ── Texto pegado sobre el lienzo ─────────────────────────────
  function dePegado(texto) {
    const t = String(texto || '').trim();
    if (!t) return null;
    const url = /^\S+$/.test(t) ? urlSegura(t) : '';
    return url ? { tipo: 'enlace', datos: { url } } : { tipo: 'nota', datos: { texto: t } };
  }

  function infoEnlace(valor) {
    const url = urlSegura(valor);
    if (!url) return { url: '', host: '', miniatura: '' };
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    let video = '';
    if (host === 'youtu.be') video = u.pathname.slice(1).split('/')[0];
    else if (/(^|\.)youtube\.com$/.test(host)) video = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/) || [])[1] || '';
    return { url, host, miniatura: /^[\w-]{6,20}$/.test(video) ? `https://i.ytimg.com/vi/${video}/hqdefault.jpg` : '' };
  }

  const PLURALES = { nota: ['nota', 'notas'], guion: ['guion', 'guiones'], imagen: ['imagen', 'imágenes'], enlace: ['enlace', 'enlaces'], lista: ['lista', 'listas'], paleta: ['paleta', 'paletas'] };

  // «2 notas · 1 guion · 3 conexiones»; vacío si no hay nada.
  function resumen(leido) {
    const partes = TIPOS.map(t => {
      const n = leido.nodos.filter(x => x.tipo === t).length;
      return n ? `${n} ${PLURALES[t][n === 1 ? 0 : 1]}` : '';
    }).filter(Boolean);
    const c = leido.conexiones.length;
    if (c) partes.push(`${c} ${c === 1 ? 'conexión' : 'conexiones'}`);
    return partes.join(' · ');
  }

  // ── El brief de antes pasa al muro ───────────────────────────
  // Nada se pierde al quitar el Brief de la ficha: al abrir el muro por
  // primera vez, su texto llega como nota y sus imágenes conectadas a ella.
  // Los ids son fijos: si dos personas lo abren a la vez, no se duplica.
  const RELLENO = 'Briefing inicial — añadí el contexto de la tarea acá.';

  function htmlDe(blocks) {
    const lista = Array.isArray(blocks) ? blocks.filter(esObj) : [];
    return lista.map(b => {
      if (b.type === 'html') return b.content || '';
      if (b.type === 'p' || b.type === 'b') return `<p>${b.text || ''}</p>`;
      if (b.type === 'ul' || b.type === 'ol') return (Array.isArray(b.items) ? b.items : []).map(i => `<li>${i}</li>`).join('');
      return '';
    }).join('');
  }

  function textoPlano(html) {
    return String(html)
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<li\b[^>]*>/gi, '• ')
      .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|ul|ol)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function briefANodos(description) {
    const html = htmlDe(description);
    const texto = textoPlano(html);
    const imagenes = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => urlSegura(m[1])).filter(Boolean).slice(0, 12);
    const conTexto = texto && texto !== RELLENO;
    if (!conTexto && !imagenes.length) return [];
    const salida = [{ id: 'meta', clase: 'meta', brief: true }];
    if (conTexto) salida.push(normalizarNodo({ id: 'brief-nota', tipo: 'nota', titulo: 'Brief', x: 0, y: 0, w: 360, datos: { texto } }));
    imagenes.forEach((url, i) => {
      const id = `brief-img-${i}`;
      salida.push(normalizarNodo({ id, tipo: 'imagen', titulo: `Referencia ${i + 1}`, x: conTexto ? 460 : (i % 3) * 320, y: conTexto ? i * 320 : Math.floor(i / 3) * 320, datos: { url } }));
      if (conTexto) salida.push({ id: idConexion('brief-nota', id), clase: 'conexion', a: 'brief-nota', b: id });
    });
    return salida;
  }

  return {
    TIPOS, TITULOS, ANCHOS, COLORES_NOTA, LIM, PUERTO_Y, ZOOM_MIN, ZOOM_MAX,
    nuevoId, urlSegura, colorValido, normalizarNodo, crearNodo, idConexion, leer, conectar, puntos, curva, ruta,
    aMundo, zoomEn, encuadre, lugarLibre, inverso, aplicarCambios, cambiosDeBorrar, cambiosDeDuplicar,
    dePegado, infoEnlace, resumen, briefANodos,
  };
});
