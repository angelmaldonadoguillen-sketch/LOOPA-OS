'use strict';
// Resultados del cliente en redes (2026-11-17): meses netos, resumen, alertas y CSV de Meta.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../_fuente/datos/resultados.js');

test('meses calendario: anterior, siguiente, último día y en curso', () => {
  assert.equal(R.mesAnterior('2026-01'), '2025-12');
  assert.equal(R.sumarMeses('2026-11', 2), '2027-01');
  assert.equal(R.ultimoDia('2026-02'), 28);
  assert.equal(R.ultimoDia('2028-02'), 29);
  assert.equal(R.nombreMes('2026-11'), 'noviembre 2026');
  assert.equal(R.enCurso('2026-11', '2026-11-17'), true);
  assert.equal(R.enCurso('2026-10', '2026-11-17'), false);
  assert.equal(R.docId('cli1', '2026-11'), 'cli1_2026-11');
});

test('normalizar: sólo redes y métricas conocidas, números válidos', () => {
  const d = R.normalizar({ redes: { meta_ads: { inversion: '1,250.50', moneda: 'USD', basura: 3, mensajes: -2 }, x: { a: 1 }, facebook: {} } });
  assert.deepEqual(d.redes, { meta_ads: { inversion: 1250.5, moneda: 'USD' } });
});

test('resumen: suma redes, inversión por moneda y costo por resultado', () => {
  const s = R.resumen({
    redes: {
      meta_ads: { inversion: 300, moneda: 'USD', mensajes: 50, leads: 10, alcance: 20000 },
      instagram: { alcance: 5000, seguidores_nuevos: 120, interacciones: 900 },
      tiktok: { reproducciones: 8000, seguidores_nuevos: 40 },
    },
    ventas: { cantidad: 6 },
  });
  assert.deepEqual(s.inversion, { USD: 300 });
  assert.equal(s.resultados, 60);
  assert.equal(s.costoPorResultado, 5);
  assert.equal(s.alcance, 25000);
  assert.equal(s.seguidoresNuevos, 160);
  assert.equal(s.ventas, 6);
  // Dos monedas: no se inventa un costo por resultado.
  const dos = R.resumen({ redes: { meta_ads: { inversion: 100, moneda: 'USD', mensajes: 5 }, tiktok_ads: { inversion: 1000, moneda: 'HNL', mensajes: 5 } } });
  assert.equal(dos.costoPorResultado, null);
});

test('alertas: sólo lo urgente', () => {
  const oct = { redes: { meta_ads: { inversion: 300, moneda: 'USD', mensajes: 60 } } };
  const nov = { redes: { meta_ads: { inversion: 300, moneda: 'USD', mensajes: 30 } } };
  const textos = R.alertas(nov, oct).map(a => a.texto);
  assert.ok(textos.some(t => /costo por lead subió 100/.test(t)));
  assert.ok(textos.some(t => /50 % abajo contra el mes anterior/.test(t)));
  assert.deepEqual(R.alertas(nov, oct, { cerrado: false }), [], 'un mes en curso no se compara');
  const sinNada = R.alertas({ redes: { meta_ads: { inversion: 200, moneda: 'USD', mensajes: 0, leads: 0 } } }, null);
  assert.equal(sinNada.length, 1);
  assert.deepEqual(R.alertas(oct, oct), [], 'un mes igual al anterior no alerta');
});

test('CSV de Meta Ads en español: totales, moneda, mensajes y aviso de rango', () => {
  const csv = '﻿Nombre del anuncio,Inicio del informe,Fin del informe,Importe gastado (USD),Alcance,Impresiones,Clics en el enlace,Resultados,Indicador de resultado\n'
    + '"Reel moto, oferta",2026-10-01,2026-10-31,120.50,8000,15000,300,40,actions:onsite_conversion.messaging_conversation_started_7d\n'
    + 'Formulario taller,2026-10-01,2026-10-31,79.50,5000,9000,120,12,actions:lead\n'
    + ',2026-10-01,2026-10-31,200,13000,24000,420,,\n';
  const r = R.leerCsvMetaAds(csv);
  assert.equal(r.mes, '2026-10');
  assert.equal(r.moneda, 'USD');
  assert.deepEqual(r.totales, { inversion: 200, alcance: 13000, impresiones: 24000, clics: 420, mensajes: 40, leads: 12, anuncios: 2 });
  assert.equal(r.anuncios[0].nombre, 'Reel moto, oferta');
  assert.ok(!r.avisos.some(a => /tiene que ir del 1/.test(a)), 'el mes completo no avisa');
});

test('CSV en inglés con punto y coma: del 1 a mitad de mes es el mes en curso con corte', () => {
  const csv = 'Ad name;Reporting starts;Reporting ends;Amount spent (HNL);Reach;Impressions;Results;Result indicator\n'
    + 'Promo;2026-11-01;2026-11-17;5000;10000;20000;80;messaging_conversation_started\n';
  const r = R.leerCsvMetaAds(csv);
  assert.equal(r.moneda, 'HNL');
  assert.equal(r.totales.mensajes, 80);
  assert.equal(r.corte, '2026-11-17');
  assert.ok(!r.avisos.some(a => /empezar el 1/.test(a)), 'del 1 al 17 no es un error');
  const mal = R.leerCsvMetaAds(csv.replace('2026-11-01', '2026-11-05'));
  assert.ok(mal.avisos.some(a => /empezar el 1/.test(a)), 'empezar el 5 sí avisa');
});

test('CSV por campaña sin alcance ni impresiones: esas métricas quedan vacías, no en 0', () => {
  const csv = 'Nombre de la campaña,Inicio del informe,Fin del informe,Importe gastado (HNL),Resultados,Indicador de resultado\n'
    + 'Choluteca,2026-11-01,2026-11-16,1576.65,298,actions:onsite_conversion.messaging_conversation_started_7d\n'
    + 'Navidad,2026-11-01,2026-11-16,2212.36,1,actions:lead\n'
    + 'Feria,2026-11-01,2026-11-16,1197.27,983,actions:link_click\n';
  const r = R.leerCsvMetaAds(csv);
  assert.deepEqual(r.totales, { inversion: 4986.28, clics: 983, mensajes: 298, leads: 1, anuncios: 3 });
  assert.equal(r.corte, '2026-11-16');
  assert.equal(r.avisos.length, 0);
});

test('mes en curso: corte, proyección al cierre y ritmo contra los mismos días del mes anterior', () => {
  const oct = { mes: '2026-10', redes: { meta_ads: { inversion: 310, moneda: 'USD', mensajes: 93 } } };
  const nov = { mes: '2026-11', corte: '2026-11-15', redes: { meta_ads: { inversion: 150, moneda: 'USD', mensajes: 30 } } };
  assert.equal(R.diasCubiertos('2026-11', '2026-11-15'), 15);
  assert.equal(R.diasCubiertos('2026-10', null), 31, 'mes cerrado sin corte: completo');
  const pr = R.proyeccion(nov, '2026-11', '2026-11-15');
  assert.equal(pr.resultados, 60);
  assert.deepEqual(pr.inversion, { USD: 300 });
  assert.equal(R.proyeccion(oct, '2026-10', null), null, 'un mes completo no se proyecta');
  const r = R.ritmo(nov, '2026-11', '2026-11-15', oct);
  assert.equal(r.inversion, 0, 'invierte al mismo ritmo (310 × 15/31 = 150)');
  assert.equal(r.resultados, -33.3, '30 contra 45 a esta altura de octubre');
  const al = R.alertas(nov, oct, { cerrado: false }).map(a => a.texto);
  assert.ok(al.some(t => /mismos días del mes anterior/.test(t)));
  assert.deepEqual(R.alertas({ ...nov, corte: '2026-11-04' }, oct, { cerrado: false }), [], 'con menos de una semana no alerta por ritmo');
  assert.deepEqual(R.puntoDeAvance(nov, '2026-11-15'), { fecha: '2026-11-15', inversion: 150, moneda: 'USD', resultados: 30, alcance: null, seguidoresNuevos: null });
});

test('campañas: un mensaje es un lead, semáforo contra el promedio y alerta de la que no rinde', () => {
  const doc = { mes: '2026-11', corte: '2026-11-16', redes: { meta_ads: { inversion: 6000, moneda: 'HNL', mensajes: 499, leads: 1 } }, anuncios: [
    { id: 'a1', nombre: 'Navidad', inversion: 2212.36, leads: 1 },
    { id: 'a2', nombre: 'Terminal', inversion: 1514.32, mensajes: 489 },
    { id: 'a3', nombre: 'Gracias', inversion: 185.1, mensajes: 10 },
    { id: 'a4', nombre: 'Feria clics', inversion: 1197.27, clics: 983 },
    { id: 'a5', nombre: 'Sin nada', inversion: 50 },
  ] };
  const r = R.campanas(doc);
  assert.equal(r.leads, 500);
  assert.equal(r.promedio, 7.82, '(2212.36 + 1514.32 + 185.1) ÷ 500');
  const por = Object.fromEntries(r.filas.map(f => [f.nombre, f]));
  assert.equal(por.Navidad.estado, 'mal');
  assert.equal(por.Terminal.estado, 'bien');
  assert.equal(por.Gracias.estado, 'mal', '18.51 es más de 1,5 veces el promedio');
  assert.equal(por['Feria clics'].estado, 'otro', 'buscaba clics: no se mide por leads');
  assert.equal(por['Sin nada'].estado, 'sin-leads');
  assert.equal(r.filas[0].nombre, 'Navidad', 'ordenadas por inversión');
  const al = R.alertas(doc, null, { cerrado: false }).map(a => a.texto);
  assert.ok(al.some(t => /«Navidad» se llevó 42\.9 % de la pauta y trajo 1 lead \(L 2,212\.36 por lead; el promedio de las campañas es L 7\.82\)/.test(t)));
  assert.ok(!al.some(t => /Gracias|Sin nada/.test(t)), 'las chicas no alertan');
  assert.equal(R.METRICAS.mensajes.label, 'Leads por mensaje');
});

test('serie del mes: arranca en 0 y sigue las cargas guardadas', () => {
  const doc = { mes: '2026-11', avance: [{ fecha: '2026-11-16', resultados: 1922, inversion: 16958.78 }, { fecha: '2026-11-09', resultados: 900, inversion: 8000 }, { fecha: '2026-10-31', resultados: 5 }] };
  assert.deepEqual(R.serieDelMes(doc).map(p => [p.dia, p.resultados]), [[0, 0], [9, 900], [16, 1922]]);
  assert.deepEqual(R.serieDelMes({ mes: '2026-11' }), []);
});
