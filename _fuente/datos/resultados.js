// ═══════════════════════════════════════════════════════════════
// LOOPA OS · Resultados del cliente en redes (2026-11-17)
//
// Un documento por CLIENTE y MES CALENDARIO (del 1 al último día), aparte del
// plan vendido: lo que se quiere ver son datos netos de un mes, comparables
// con cualquier otro. Un anuncio que corre de octubre a diciembre aporta a
// cada mes sólo lo de sus días (así lo entrega Meta al exportar por mes).
//
//   loopa_results/{clienteId}_{AAAA-MM}
//     redes.{meta_ads|facebook|instagram|tiktok|tiktok_ads}.{métrica}: número
//     ventas.{cantidad, monto}   lo que el cliente reporta (opcional)
//     anuncios[]                 detalle del mes (del CSV de Meta), opcional
//     fuentes[]                  de dónde salió cada dato y cuándo
//
// Los datos los carga el equipo (o Claude) a mano o con el CSV que exporta
// el Administrador de anuncios. Cuando haya API, escribe lo mismo.
//
// Puro: sin DOM ni Firebase. Se prueba con Node (integracion/test/resultados.test.cjs).
// ═══════════════════════════════════════════════════════════════

const LoopaResultados = (function () {
  // ── Redes y métricas ─────────────────────────────────────────────
  // `pauta`: la red tiene inversión (anuncios); si no, es orgánico.
  const REDES = [
    { id: 'meta_ads', label: 'Meta Ads', grupo: 'Pauta', pauta: true, campos: ['inversion', 'alcance', 'impresiones', 'clics', 'mensajes', 'leads', 'anuncios'] },
    { id: 'facebook', label: 'Facebook', grupo: 'Orgánico', pauta: false, campos: ['alcance', 'interacciones', 'reproducciones', 'seguidores_nuevos', 'seguidores', 'publicaciones'] },
    { id: 'instagram', label: 'Instagram', grupo: 'Orgánico', pauta: false, campos: ['alcance', 'interacciones', 'reproducciones', 'seguidores_nuevos', 'seguidores', 'publicaciones'] },
    { id: 'tiktok', label: 'TikTok', grupo: 'Orgánico', pauta: false, campos: ['reproducciones', 'alcance', 'interacciones', 'seguidores_nuevos', 'seguidores', 'publicaciones'] },
    { id: 'tiktok_ads', label: 'TikTok Ads', grupo: 'Pauta', pauta: true, campos: ['inversion', 'impresiones', 'clics', 'mensajes', 'leads', 'anuncios'] },
  ];
  const METRICAS = {
    inversion: { label: 'Inversión', ayuda: 'Lo que se gastó en pauta en el mes.' },
    alcance: { label: 'Alcance', ayuda: 'Personas distintas que lo vieron en el mes.' },
    impresiones: { label: 'Impresiones', ayuda: 'Veces que se mostró.' },
    clics: { label: 'Clics', ayuda: 'Clics en el enlace.' },
    mensajes: { label: 'Mensajes', ayuda: 'Conversaciones iniciadas (WhatsApp, Messenger, Instagram Direct).' },
    leads: { label: 'Leads', ayuda: 'Formularios de contacto completados.' },
    anuncios: { label: 'Anuncios activos', ayuda: 'Anuncios que corrieron en el mes, aunque hayan empezado antes.' },
    interacciones: { label: 'Interacciones', ayuda: 'Me gusta, comentarios, compartidos y guardados.' },
    reproducciones: { label: 'Reproducciones', ayuda: 'Reproducciones de video y reels.' },
    seguidores_nuevos: { label: 'Seguidores nuevos', ayuda: 'Seguidores ganados en el mes (netos).' },
    seguidores: { label: 'Seguidores al cierre', ayuda: 'Total de seguidores el último día del mes.' },
    publicaciones: { label: 'Publicaciones', ayuda: 'Publicaciones del mes.' },
  };
  const MONEDAS = ['USD', 'HNL'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const pad = (n) => String(n).padStart(2, '0');
  const esMes = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
  const mesDe = (ymd) => (typeof ymd === 'string' && /^\d{4}-\d{2}/.test(ymd) ? ymd.slice(0, 7) : null);
  const mesActual = (hoy) => mesDe(hoy);
  const sumarMeses = (mes, n) => {
    const y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7)) - 1 + n;
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    return `${yy}-${pad(mm + 1)}`;
  };
  const mesAnterior = (mes) => sumarMeses(mes, -1);
  const ultimoDia = (mes) => {
    const y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
    return [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  };
  const nombreMes = (mes) => (esMes(mes) ? `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}` : '');
  const docId = (clienteId, mes) => `${clienteId}_${mes}`;
  // El mes en curso no está cerrado: no se compara como si lo estuviera.
  const enCurso = (mes, hoy) => mes === mesActual(hoy);

  const numero = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  };

  // ── Documento ────────────────────────────────────────────────────
  // Deja sólo redes y métricas conocidas, con números válidos (o se quitan).
  function normalizar(doc) {
    const d = doc || {};
    const redes = {};
    REDES.forEach(r => {
      const src = (d.redes && d.redes[r.id]) || {};
      const out = {};
      r.campos.forEach(c => { const n = numero(src[c]); if (n !== null) out[c] = n; });
      if (r.pauta && MONEDAS.includes(src.moneda)) out.moneda = src.moneda;
      if (Object.keys(out).some(k => k !== 'moneda')) redes[r.id] = out;
    });
    const ventas = {};
    if (d.ventas) { ['cantidad', 'monto'].forEach(k => { const n = numero(d.ventas[k]); if (n !== null) ventas[k] = n; }); }
    return {
      id: d.id, clientId: d.clientId, mes: d.mes,
      redes,
      ventas,
      notas: typeof d.notas === 'string' ? d.notas.slice(0, 2000) : '',
      anuncios: Array.isArray(d.anuncios) ? d.anuncios.slice(0, 300) : [],
      fuentes: Array.isArray(d.fuentes) ? d.fuentes.slice(-50) : [],
    };
  }

  // ── Resumen del mes ──────────────────────────────────────────────
  // Lo que se lee de un vistazo. El alcance de cada red se suma (es un
  // aproximado: una persona puede estar en dos redes). La inversión se suma
  // por moneda; el costo por resultado sólo sale si hay una sola moneda.
  function resumen(doc) {
    const d = normalizar(doc);
    const r = d.redes;
    const suma = (campo, ids) => {
      let total = null;
      (ids || REDES.map(x => x.id)).forEach(id => { const v = r[id] && r[id][campo]; if (typeof v === 'number') total = (total || 0) + v; });
      return total;
    };
    const inversion = {};
    REDES.filter(x => x.pauta).forEach(x => {
      const red = r[x.id];
      if (red && typeof red.inversion === 'number') {
        const m = red.moneda || 'USD';
        inversion[m] = (inversion[m] || 0) + red.inversion;
      }
    });
    const mensajes = suma('mensajes');
    const leads = suma('leads');
    const resultados = mensajes === null && leads === null ? null : (mensajes || 0) + (leads || 0);
    const monedas = Object.keys(inversion);
    const costoPorResultado = monedas.length === 1 && resultados ? Math.round((inversion[monedas[0]] / resultados) * 100) / 100 : null;
    return {
      inversion,
      moneda: monedas.length === 1 ? monedas[0] : null,
      resultados,
      mensajes,
      leads,
      costoPorResultado,
      alcance: suma('alcance'),
      impresiones: suma('impresiones'),
      interacciones: suma('interacciones'),
      reproducciones: suma('reproducciones'),
      seguidoresNuevos: suma('seguidores_nuevos'),
      publicaciones: suma('publicaciones'),
      anuncios: suma('anuncios'),
      ventas: d.ventas.cantidad ?? null,
      ventasMonto: d.ventas.monto ?? null,
      vacio: Object.keys(r).length === 0 && d.ventas.cantidad === undefined,
    };
  }

  // Cambio contra el mes anterior, en %. Null si no hay con qué comparar.
  function cambio(actual, anterior) {
    if (typeof actual !== 'number' || typeof anterior !== 'number' || anterior === 0) return null;
    return Math.round(((actual - anterior) / anterior) * 1000) / 10;
  }

  function comparar(actual, anterior) {
    const a = resumen(actual), b = anterior ? resumen(anterior) : null;
    const claves = ['resultados', 'costoPorResultado', 'alcance', 'interacciones', 'reproducciones', 'seguidoresNuevos', 'publicaciones', 'ventas'];
    const out = {};
    claves.forEach(k => { out[k] = b ? cambio(a[k], b[k]) : null; });
    const inv = (s) => (s.moneda ? s.inversion[s.moneda] : null);
    out.inversion = b && a.moneda && a.moneda === b.moneda ? cambio(inv(a), inv(b)) : null;
    return out;
  }

  // Sólo lo urgente (criterio de Ángel): plata que no rinde o un mes que se cae.
  function alertas(actual, anterior, { cerrado = true } = {}) {
    const a = resumen(actual);
    const out = [];
    const inv = a.moneda ? a.inversion[a.moneda] : null;
    if (inv && inv > 0 && a.resultados === 0) {
      out.push({ tono: 'danger', texto: `Se invirtieron ${a.moneda} ${inv.toLocaleString('es-HN')} y no hubo mensajes ni leads.` });
    }
    if (!anterior || !cerrado) return out;
    const c = comparar(actual, anterior);
    if (c.costoPorResultado !== null && c.costoPorResultado >= 30) {
      out.push({ tono: 'danger', texto: `El costo por resultado subió ${c.costoPorResultado} % contra el mes anterior.` });
    }
    if (c.resultados !== null && c.resultados <= -40) {
      out.push({ tono: 'danger', texto: `Los mensajes y leads cayeron ${Math.abs(c.resultados)} % contra el mes anterior.` });
    }
    return out;
  }

  // ── CSV del Administrador de anuncios de Meta ────────────────────
  // Se exporta con «Desglose: ninguno» y el rango del mes. Acepta encabezados
  // en español o inglés, separados por coma o punto y coma.
  function partirCsv(texto) {
    const limpio = String(texto || '').replace(/^﻿/, '');
    const primera = limpio.split(/\r?\n/)[0] || '';
    const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
    const filas = [];
    let fila = [], celda = '', comillas = false;
    for (let i = 0; i < limpio.length; i++) {
      const ch = limpio[i];
      if (comillas) {
        if (ch === '"' && limpio[i + 1] === '"') { celda += '"'; i++; }
        else if (ch === '"') comillas = false;
        else celda += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) { fila.push(celda); celda = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && limpio[i + 1] === '\n') i++;
        fila.push(celda); filas.push(fila); fila = []; celda = '';
      } else celda += ch;
    }
    if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
    return filas.filter(f => f.some(c => c.trim() !== ''));
  }

  const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  // Columna por nombres posibles (el primero que aparezca).
  const COLUMNAS = {
    nombre: ['nombre del anuncio', 'ad name', 'nombre de la campana', 'campaign name'],
    inicio: ['inicio del informe', 'reporting starts'],
    fin: ['fin del informe', 'reporting ends'],
    inversion: ['importe gastado', 'amount spent'],
    alcance: ['alcance', 'reach'],
    impresiones: ['impresiones', 'impressions'],
    clics: ['clics en el enlace', 'link clicks'],
    resultados: ['resultados', 'results'],
    indicador: ['indicador de resultado', 'result indicator', 'tipo de resultado', 'result type'],
    mensajes: ['conversaciones con mensajes iniciadas', 'messaging conversations started'],
    leads: ['clientes potenciales', 'leads'],
  };
  function indiceDe(encabezados, clave) {
    const opciones = COLUMNAS[clave];
    for (const o of opciones) {
      const i = encabezados.findIndex(h => h === o || h.startsWith(o + ' (') || h.startsWith(o + ' ['));
      if (i >= 0) return i;
    }
    return -1;
  }
  const esMensaje = (ind) => /messag|mensaj|conversation|conversaci/.test(ind);
  const esLead = (ind) => /lead|cliente potencial|clientes potenciales/.test(ind);

  // → { mes, moneda, totales: {inversion, alcance, impresiones, clics, mensajes, leads, anuncios}, anuncios[], avisos[] }
  function leerCsvMetaAds(texto) {
    const filas = partirCsv(texto);
    const avisos = [];
    if (filas.length < 2) return { mes: null, moneda: null, totales: {}, anuncios: [], avisos: ['El archivo no tiene filas.'] };
    const crudos = filas[0].map(h => h.trim());
    const enc = crudos.map(sinTildes);
    const col = {};
    Object.keys(COLUMNAS).forEach(k => { col[k] = indiceDe(enc, k); });
    if (col.inversion < 0) avisos.push('No encontré la columna «Importe gastado».');
    const monedaEnc = col.inversion >= 0 ? (crudos[col.inversion].match(/\(([A-Z]{3})\)/) || [])[1] : null;
    const moneda = MONEDAS.includes(monedaEnc) ? monedaEnc : (monedaEnc ? null : 'USD');
    if (monedaEnc && !MONEDAS.includes(monedaEnc)) avisos.push(`La moneda ${monedaEnc} no está en LOOPA (USD o HNL).`);
    const leer = (fila, k) => (col[k] >= 0 ? fila[col[k]] : undefined);
    const anuncios = [];
    let inicio = null, fin = null;
    filas.slice(1).forEach((f, i) => {
      const nombre = String(leer(f, 'nombre') || '').trim();
      // La fila de totales que agrega Meta a veces no tiene nombre: se ignora.
      if (!nombre) return;
      const ind = sinTildes(leer(f, 'indicador'));
      const res = numero(leer(f, 'resultados')) || 0;
      const msjCol = numero(leer(f, 'mensajes'));
      const leadCol = numero(leer(f, 'leads'));
      const ad = {
        id: `a${i + 1}`,
        nombre: nombre.slice(0, 200),
        inversion: numero(leer(f, 'inversion')) || 0,
        alcance: numero(leer(f, 'alcance')) || 0,
        impresiones: numero(leer(f, 'impresiones')) || 0,
        clics: numero(leer(f, 'clics')) || 0,
        mensajes: msjCol !== null ? msjCol : (esMensaje(ind) ? res : 0),
        leads: leadCol !== null ? leadCol : (esLead(ind) ? res : 0),
      };
      anuncios.push(ad);
      const ini = String(leer(f, 'inicio') || '').trim(), fi = String(leer(f, 'fin') || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(ini) && (!inicio || ini < inicio)) inicio = ini;
      if (/^\d{4}-\d{2}-\d{2}$/.test(fi) && (!fin || fi > fin)) fin = fi;
    });
    const sum = (k) => Math.round(anuncios.reduce((s, a) => s + (a[k] || 0), 0) * 100) / 100;
    const mes = mesDe(inicio);
    if (mes && (inicio !== `${mes}-01` || mesDe(fin) !== mes || fin !== `${mes}-${pad(ultimoDia(mes))}`)) {
      avisos.push(`El informe va del ${inicio} al ${fin}: para un mes neto tiene que ir del 1 al ${ultimoDia(mes)} del mismo mes.`);
    }
    if (!mes) avisos.push('No encontré las fechas del informe («Inicio del informe»).');
    // El alcance de cada anuncio no se puede sumar (una persona ve varios): se
    // guarda la suma como tope y se avisa.
    if (anuncios.length > 1) avisos.push('El alcance total es la suma de los anuncios (puede contar dos veces a la misma persona). Si querés el exacto, exportá también a nivel de cuenta.');
    return {
      mes,
      moneda,
      totales: {
        inversion: sum('inversion'),
        alcance: sum('alcance'),
        impresiones: sum('impresiones'),
        clics: sum('clics'),
        mensajes: sum('mensajes'),
        leads: sum('leads'),
        anuncios: anuncios.filter(a => a.inversion > 0 || a.impresiones > 0).length,
      },
      anuncios,
      avisos,
    };
  }

  return { REDES, METRICAS, MONEDAS, esMes, mesDe, mesActual, sumarMeses, mesAnterior, ultimoDia, nombreMes, docId, enCurso, numero, normalizar, resumen, cambio, comparar, alertas, partirCsv, leerCsvMetaAds };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LoopaResultados;
