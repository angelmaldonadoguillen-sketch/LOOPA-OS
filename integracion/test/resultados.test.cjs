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
  assert.ok(textos.some(t => /costo por resultado subió 100/.test(t)));
  assert.ok(textos.some(t => /cayeron 50/.test(t)));
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

test('CSV en inglés con punto y coma y rango incompleto avisa', () => {
  const csv = 'Ad name;Reporting starts;Reporting ends;Amount spent (HNL);Reach;Impressions;Results;Result indicator\n'
    + 'Promo;2026-11-01;2026-11-17;5000;10000;20000;80;messaging_conversation_started\n';
  const r = R.leerCsvMetaAds(csv);
  assert.equal(r.moneda, 'HNL');
  assert.equal(r.totales.mensajes, 80);
  assert.ok(r.avisos.some(a => /tiene que ir del 1 al 30/.test(a)));
});
