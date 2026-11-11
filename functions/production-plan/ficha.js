// ─────────────────────────────────────────────────────────────────
// Ficha del producto (etapa «experiencia», 2026-11-10) — PURO.
//
// Un producto se define una vez y queda listo para vender:
//   duracion     cuánto dura el paquete (el rango): días, semanas o meses.
//                Al vender se elige el INICIO; el fin sale solo
//                (empieza el 10 → termina el 10 del mes siguiente).
//   entregables  qué incluye. Cada uno con cantidad, costo por entrega y un
//                PATRÓN que dice cuándo cae dentro del rango:
//                  dia        el día N del rango (1 = el inicio)
//                  repartido  N entregas parejas en el rango
//                  semanal    los días de la semana elegidos (L…D)
//                  final      el último día del rango
//   proceso      el checklist que sigue cada entrega.
//   costosExtra  costos del paquete que no son de una entrega (pauta…).
//
// Lo usan el servidor (functions/) y la pantalla (build.js lo incluye):
// las fechas que muestra la venta son las mismas que genera el servidor.
// Fechas de calendario YYYY-MM-DD, sin zona horaria.
// ─────────────────────────────────────────────────────────────────
var LoopaFicha = (function () {
  'use strict';

  var UNIDADES = ['dias', 'semanas', 'meses'];
  var PATRONES = ['dia', 'repartido', 'semanal', 'final'];
  var DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D']; // 1 = lunes … 7 = domingo
  var LIMITES = { entregables: 20, proceso: 30, costosExtra: 20, entregasPorVenta: 200, texto: 120, detalle: 300 };
  var MAX_DURACION = { dias: 365, semanas: 52, meses: 12 };

  // ── Fechas (días civiles, algoritmo de Howard Hinnant) ────────────
  function parse(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > diasDelMes(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }
  function diasDelMes(y, m) { return m === 2 ? ((y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28) : ([4, 6, 9, 11].indexOf(m) >= 0 ? 30 : 31); }
  function aDia(p) {
    var y = p.m <= 2 ? p.y - 1 : p.y, era = Math.floor(y / 400), yoe = y - era * 400;
    var doy = Math.floor((153 * (p.m + (p.m > 2 ? -3 : 9)) + 2) / 5) + p.d - 1;
    return era * 146097 + (yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy) - 719468;
  }
  function deDia(z) {
    z += 719468;
    var era = Math.floor(z / 146097), doe = z - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp + (mp < 10 ? 3 : -9), y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  function sumarDias(ymd, n) { return deDia(aDia(parse(ymd)) + n); }
  function sumarMeses(ymd, n) {
    var p = parse(ymd), t = p.y * 12 + (p.m - 1) + n, y = Math.floor(t / 12), m = t - y * 12 + 1;
    return deDia(aDia({ y: y, m: m, d: Math.min(p.d, diasDelMes(y, m)) }));
  }
  function diaSemana(ymd) { return ((aDia(parse(ymd)) + 3) % 7 + 7) % 7 + 1; } // 1970-01-01 fue jueves (4)
  var esFecha = function (s) { return parse(s) !== null; };

  // ── Normalizar (lo que guarda el servidor) ────────────────────────
  var esObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  var txt = function (v, max) { return typeof v === 'string' ? v.trim().slice(0, max || LIMITES.texto) : ''; };
  var ent = function (v, min, max, def) { var n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : def; };
  var monto = function (v) { var n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
  var idOk = function (v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v); };

  function normalizarFicha(f) {
    f = esObj(f) ? f : {};
    var dur = esObj(f.duracion) ? f.duracion : {};
    var unidad = UNIDADES.indexOf(dur.unidad) >= 0 ? dur.unidad : 'meses';
    return {
      version: 1,
      duracion: { cantidad: ent(dur.cantidad, 1, MAX_DURACION[unidad], 1), unidad: unidad },
      entregables: (Array.isArray(f.entregables) ? f.entregables : []).slice(0, LIMITES.entregables).filter(esObj).map(function (e, i) {
        var p = esObj(e.patron) ? e.patron : {};
        var tipo = PATRONES.indexOf(p.tipo) >= 0 ? p.tipo : 'repartido';
        var patron = { tipo: tipo };
        if (tipo === 'dia') patron.dia = ent(p.dia, 1, 400, 1);
        if (tipo === 'semanal') patron.dias = (Array.isArray(p.dias) ? p.dias : []).filter(function (d) { return ent(d, 1, 7, 0); }).map(Number)
          .filter(function (d, j, a) { return a.indexOf(d) === j; }).sort();
        return {
          id: idOk(e.id) ? e.id : 'e' + (i + 1),
          nombre: txt(e.nombre),
          // Tipo de tarjeta del tablero (reel, photo…); vacío = el que sugiera el nombre.
          tipo: typeof e.tipo === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(e.tipo) ? e.tipo : '',
          detalle: txt(e.detalle, LIMITES.detalle),
          cantidad: tipo === 'semanal' ? 1 : ent(e.cantidad, 1, 200, 1),
          costo: monto(e.costo),
          patron: patron,
        };
      }),
      proceso: (Array.isArray(f.proceso) ? f.proceso : []).slice(0, LIMITES.proceso).filter(esObj).map(function (p, i) {
        return { id: idOk(p.id) ? p.id : 'p' + (i + 1), texto: txt(p.texto) };
      }).filter(function (p) { return p.texto; }),
      costosExtra: (Array.isArray(f.costosExtra) ? f.costosExtra : []).slice(0, LIMITES.costosExtra).filter(esObj).map(function (c, i) {
        return { id: idOk(c.id) ? c.id : 'c' + (i + 1), concepto: txt(c.concepto), monto: monto(c.monto) };
      }).filter(function (c) { return c.concepto || c.monto; }),
    };
  }

  // ── Rango y fechas de cada entrega ────────────────────────────────
  function rango(inicio, duracion) {
    if (!esFecha(inicio)) return null;
    var d = duracion || { cantidad: 1, unidad: 'meses' };
    var fin = d.unidad === 'meses' ? sumarMeses(inicio, d.cantidad) : sumarDias(inicio, d.cantidad * (d.unidad === 'semanas' ? 7 : 1));
    return { inicio: inicio, fin: fin, dias: aDia(parse(fin)) - aDia(parse(inicio)) };
  }

  // Fechas de un entregable dentro del rango [inicio, fin].
  function fechasEntregable(e, r) {
    var p = e.patron || {}, n = e.cantidad || 1, out = [], k;
    if (p.tipo === 'dia') { var f = sumarDias(r.inicio, Math.min(p.dia - 1, r.dias)); for (k = 0; k < n; k++) out.push(f); }
    else if (p.tipo === 'final') { for (k = 0; k < n; k++) out.push(r.fin); }
    else if (p.tipo === 'semanal') {
      for (k = 0; k < r.dias; k++) { var d = sumarDias(r.inicio, k); if ((p.dias || []).indexOf(diaSemana(d)) >= 0) out.push(d); }
    } else { // repartido: parejo en el rango, sin caer en el último día
      var span = Math.max(r.dias, 1);
      for (k = 0; k < n; k++) out.push(sumarDias(r.inicio, Math.floor((k + 0.5) * span / n)));
    }
    return out;
  }

  // Todas las entregas de un producto que empieza en `inicio`, por fecha.
  function calendario(ficha, inicio) {
    var r = rango(inicio, ficha.duracion);
    if (!r) return { rango: null, entregas: [] };
    var entregas = [];
    ficha.entregables.forEach(function (e) {
      var fechas = fechasEntregable(e, r);
      var tipo = e.tipo || tipoSugerido(e.nombre);
      fechas.forEach(function (f, i) { entregas.push({ entregableId: e.id, nombre: e.nombre, detalle: e.detalle, tipo: tipo, n: i + 1, total: fechas.length, fecha: f, costo: e.costo }); });
    });
    entregas.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; });
    return { rango: r, entregas: entregas };
  }

  // Tipo de tarjeta que sugiere el nombre del entregable (tipos de FRAME por
  // defecto). '' si no hay una pista clara: el servidor usa «other».
  var PISTAS_TIPO = [
    [/\b(reels?|tiktoks?|shorts?|stor(y|ies))\b/i, 'reel'],
    [/\b(fotos?|fotograf|sesi[oó]n|photo)/i, 'photo'],
    [/\b(podcasts?)\b/i, 'podcast'],
    [/\b(bts|detr[aá]s de c[aá]mara)/i, 'bts'],
    [/\b(campa[nñ]as?|pauta|ads?|anuncios?|campaign)/i, 'campaign'],
    [/\b(videos?|corporativ)/i, 'corp'],
  ];
  function tipoSugerido(nombre) {
    var n = String(nombre || '');
    for (var i = 0; i < PISTAS_TIPO.length; i++) if (PISTAS_TIPO[i][0].test(n)) return PISTAS_TIPO[i][1];
    return '';
  }

  // ── Costos y utilidad ─────────────────────────────────────────────
  // Cuántas entregas trae un entregable en un paquete típico (semanal: según
  // las semanas del rango; un mes cuenta como 30 días).
  function cantidadTipica(e, duracion) {
    if (!e.patron || e.patron.tipo !== 'semanal') return e.cantidad || 1;
    var dias = duracion.cantidad * (duracion.unidad === 'meses' ? 30 : duracion.unidad === 'semanas' ? 7 : 1);
    return Math.round(dias / 7 * (e.patron.dias || []).length);
  }
  function costos(ficha, inicio) {
    var cal = inicio ? calendario(ficha, inicio) : null;
    var porEntregables = ficha.entregables.reduce(function (a, e) {
      var n = cal ? cal.entregas.filter(function (x) { return x.entregableId === e.id; }).length : cantidadTipica(e, ficha.duracion);
      return a + n * e.costo;
    }, 0);
    var extras = ficha.costosExtra.reduce(function (a, c) { return a + c.monto; }, 0);
    return { entregables: Math.round(porEntregables * 100) / 100, extras: extras, total: Math.round((porEntregables + extras) * 100) / 100 };
  }
  function utilidad(ficha, precio, inicio) {
    var c = costos(ficha, inicio).total, p = Number(precio) || 0;
    return { costo: c, utilidad: Math.round((p - c) * 100) / 100, margen: p > 0 ? Math.round((p - c) / p * 1000) / 10 : null };
  }

  // ── ¿Lista para vender? ───────────────────────────────────────────
  // Devuelve lo que falta, en palabras (vacío = lista).
  function faltantes(servicio) {
    var f = servicio && esObj(servicio.ficha) ? normalizarFicha(servicio.ficha) : null;
    var out = [];
    if (!servicio || !txt(servicio.nombre)) out.push('nombre');
    if (!(Number(servicio && servicio.precio) > 0)) out.push('precio');
    if (!f || !f.entregables.length) out.push('qué incluye');
    else {
      if (f.entregables.some(function (e) { return !e.nombre; })) out.push('nombre de cada entregable');
      if (f.entregables.some(function (e) { return e.patron.tipo === 'semanal' && !e.patron.dias.length; })) out.push('días de la semana');
      var r = rango('2026-01-01', f.duracion);
      if (f.entregables.some(function (e) { return e.patron.tipo === 'dia' && e.patron.dia - 1 > r.dias; })) out.push('un día dentro de la duración');
      if (calendario(f, '2026-01-01').entregas.length > LIMITES.entregasPorVenta) out.push('menos de ' + LIMITES.entregasPorVenta + ' entregas');
    }
    if (!f || !f.proceso.length) out.push('proceso');
    return out;
  }
  function lista(servicio) { return faltantes(servicio).length === 0; }

  // Texto corto del patrón («12 repartidas», «L·M·V», «día 3», «al final»).
  function describirPatron(e) {
    var p = e.patron || {};
    if (p.tipo === 'dia') return (e.cantidad > 1 ? e.cantidad + ' el ' : '') + 'día ' + p.dia;
    if (p.tipo === 'final') return (e.cantidad > 1 ? e.cantidad + ' ' : '') + 'al final';
    if (p.tipo === 'semanal') return (p.dias || []).length ? (p.dias || []).map(function (d) { return DIAS_SEMANA[d - 1]; }).join('·') + ' cada semana' : 'elegí los días';
    return e.cantidad + (e.cantidad === 1 ? ' en el rango' : ' repartidas');
  }
  function describirDuracion(d) {
    var n = d.cantidad, u = d.unidad;
    return n + ' ' + (u === 'meses' ? (n === 1 ? 'mes' : 'meses') : u === 'semanas' ? (n === 1 ? 'semana' : 'semanas') : (n === 1 ? 'día' : 'días'));
  }

  return {
    UNIDADES: UNIDADES, PATRONES: PATRONES, DIAS_SEMANA: DIAS_SEMANA, LIMITES: LIMITES, MAX_DURACION: MAX_DURACION,
    normalizarFicha: normalizarFicha, rango: rango, fechasEntregable: fechasEntregable, calendario: calendario,
    costos: costos, utilidad: utilidad, faltantes: faltantes, lista: lista,
    describirPatron: describirPatron, describirDuracion: describirDuracion, tipoSugerido: tipoSugerido,
    sumarDias: sumarDias, sumarMeses: sumarMeses, diaSemana: diaSemana, esFecha: esFecha,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LoopaFicha;
