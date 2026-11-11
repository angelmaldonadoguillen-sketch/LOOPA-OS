'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../functions/production-plan/ficha.js');

const plan = () => F.normalizarFicha({
  duracion: { cantidad: 1, unidad: 'meses' },
  entregables: [
    { id: 'posts', nombre: 'Post', cantidad: 12, costo: 100, patron: { tipo: 'repartido' } },
    { id: 'sesion', nombre: 'Sesión de fotos', detalle: '30 fotos', cantidad: 1, costo: 1500, patron: { tipo: 'dia', dia: 3 } },
    { id: 'reels', nombre: 'Reel', costo: 300, patron: { tipo: 'semanal', dias: [5, 1, 5] } },
    { id: 'reporte', nombre: 'Reporte', cantidad: 1, costo: 0, patron: { tipo: 'final' } },
  ],
  proceso: [{ texto: 'Idea' }, { texto: 'Diseño' }, { texto: '' }, { texto: 'Aprobación' }],
  costosExtra: [{ concepto: 'Pauta', monto: 2000 }],
});

test('ficha: el rango sale del inicio y la duración (10 → 10 del mes siguiente)', () => {
  assert.deepEqual(F.rango('2026-11-10', { cantidad: 1, unidad: 'meses' }), { inicio: '2026-11-10', fin: '2026-12-10', dias: 30 });
  assert.equal(F.rango('2026-01-31', { cantidad: 1, unidad: 'meses' }).fin, '2026-02-28', 'fin de mes se ajusta');
  assert.equal(F.rango('2026-11-10', { cantidad: 2, unidad: 'semanas' }).fin, '2026-11-24');
  assert.equal(F.rango('2026-12-30', { cantidad: 5, unidad: 'dias' }).fin, '2027-01-04');
  assert.equal(F.rango('2026-02-30', { cantidad: 1, unidad: 'dias' }), null);
});

test('ficha: cada patrón cae donde dice, dentro del rango', () => {
  const r = F.rango('2026-11-10', { cantidad: 1, unidad: 'meses' });
  const f = plan();
  const de = (id) => F.fechasEntregable(f.entregables.find(e => e.id === id), r);
  const posts = de('posts');
  assert.equal(posts.length, 12);
  assert.deepEqual(posts.slice(0, 3), ['2026-11-11', '2026-11-13', '2026-11-16']);
  assert.ok(posts.every(d => d >= r.inicio && d < r.fin), 'repartido no cae el último día');
  assert.deepEqual(de('sesion'), ['2026-11-12']);
  assert.deepEqual(de('reporte'), ['2026-12-10']);
  const reels = de('reels');
  assert.ok(reels.every(d => [1, 5].includes(F.diaSemana(d))), 'sólo lunes y viernes');
  assert.equal(reels[0], '2026-11-13', 'el primer viernes');
  // Lunes 16, 23, 30 y 7; viernes 13, 20, 27 y 4 (el 10 de diciembre no entra).
  assert.equal(reels.length, 8);
  assert.equal(F.diaSemana('2026-11-10'), 2, 'el 10 de noviembre de 2026 es martes');
});

test('ficha: el calendario ordena todas las entregas por fecha', () => {
  const cal = F.calendario(plan(), '2026-11-10');
  assert.equal(cal.entregas.length, 12 + 1 + 8 + 1);
  assert.ok(cal.entregas.every((e, i, a) => i === 0 || a[i - 1].fecha <= e.fecha));
  const p3 = cal.entregas.filter(e => e.entregableId === 'posts')[2];
  assert.deepEqual({ n: p3.n, total: p3.total, nombre: p3.nombre }, { n: 3, total: 12, nombre: 'Post' });
});

test('ficha: costos y utilidad (típicos y con un inicio real)', () => {
  const f = plan();
  // Típico: 12 posts + sesión + reels 2 por semana en 30 días (≈9) + pauta.
  assert.deepEqual(F.costos(f), { entregables: 12 * 100 + 1500 + 9 * 300, extras: 2000, total: 7400 });
  assert.deepEqual(F.utilidad(f, 10000), { costo: 7400, utilidad: 2600, margen: 26 });
  // Con el inicio real se cuentan las entregas de verdad (8 reels).
  assert.equal(F.costos(f, '2026-11-10').total, 7100);
  assert.equal(F.utilidad(f, 0).margen, null);
});

test('ficha: normalizar limpia lo que viene del navegador', () => {
  const f = plan();
  assert.deepEqual(f.proceso.map(p => p.texto), ['Idea', 'Diseño', 'Aprobación'], 'sin pasos vacíos');
  assert.deepEqual(f.entregables.find(e => e.id === 'reels').patron, { tipo: 'semanal', dias: [1, 5] }, 'días sin repetir y ordenados');
  const raro = F.normalizarFicha({ duracion: { cantidad: 99, unidad: 'años' }, entregables: [{ nombre: 'x'.repeat(500), cantidad: -3, costo: 'abc', patron: { tipo: 'cuando-sea' } }], extra: 1 });
  assert.deepEqual(raro.duracion, { cantidad: 1, unidad: 'meses' });
  assert.equal(raro.entregables[0].nombre.length, F.LIMITES.texto);
  assert.equal(raro.entregables[0].cantidad, 1);
  assert.equal(raro.entregables[0].costo, 0);
  assert.equal(raro.entregables[0].patron.tipo, 'repartido');
  assert.equal(raro.extra, undefined);
  assert.equal(F.normalizarFicha(null).entregables.length, 0);
});

test('ficha: sólo un producto completo está listo para vender', () => {
  const ok = { nombre: 'Plan redes', precio: 10000, ficha: plan() };
  assert.deepEqual(F.faltantes(ok), []);
  assert.ok(F.lista(ok));
  assert.deepEqual(F.faltantes({ nombre: 'Viejo', precio: 500 }), ['qué incluye', 'proceso']);
  assert.deepEqual(F.faltantes({ nombre: '', precio: 0, ficha: { entregables: [{ nombre: '', patron: { tipo: 'semanal', dias: [] } }], proceso: [] } }),
    ['nombre', 'precio', 'nombre de cada entregable', 'días de la semana', 'proceso']);
  const lejos = { nombre: 'x', precio: 1, ficha: { duracion: { cantidad: 1, unidad: 'semanas' }, entregables: [{ nombre: 'a', patron: { tipo: 'dia', dia: 20 } }], proceso: [{ texto: 'a' }] } };
  assert.deepEqual(F.faltantes(lejos), ['un día dentro de la duración']);
});

test('ficha: tipo de tarjeta por entregable (elegido o sugerido por el nombre)', () => {
  assert.equal(F.tipoSugerido('Reel semanal'), 'reel');
  assert.equal(F.tipoSugerido('Sesión de fotos'), 'photo');
  assert.equal(F.tipoSugerido('Video institucional'), 'corp');
  assert.equal(F.tipoSugerido('Campaña de pauta'), 'campaign');
  assert.equal(F.tipoSugerido('Post'), '');
  const f = F.normalizarFicha({ entregables: [{ nombre: 'Reel', tipo: 'Mal Tipo!' }, { nombre: 'Post', tipo: 'photo' }, { nombre: 'Sesión de fotos' }], proceso: [{ texto: 'a' }] });
  assert.deepEqual(f.entregables.map(e => e.tipo), ['', 'photo', ''], 'un tipo inválido se descarta');
  const cal = F.calendario(f, '2026-11-10');
  const tipoDe = (n) => cal.entregas.find(x => x.nombre === n).tipo;
  assert.deepEqual([tipoDe('Reel'), tipoDe('Post'), tipoDe('Sesión de fotos')], ['reel', 'photo', 'photo']);
});

test('ficha: textos cortos para la pantalla', () => {
  const f = plan();
  assert.deepEqual(f.entregables.map(F.describirPatron), ['12 repartidas', 'día 3', 'L·V cada semana', 'al final']);
  assert.equal(F.describirDuracion({ cantidad: 1, unidad: 'meses' }), '1 mes');
  assert.equal(F.describirDuracion({ cantidad: 2, unidad: 'semanas' }), '2 semanas');
});
