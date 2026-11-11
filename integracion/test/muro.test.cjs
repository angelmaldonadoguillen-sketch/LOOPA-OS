'use strict';
// El modelo del Muro (lienzo de ideas de cada tarea), sin DOM ni Firebase.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../_fuente/estudio/muro-modelo.js');

const nota = (id, x = 0, y = 0) => M.crearNodo('nota', x, y, {}, id);

test('un nodo se normaliza: tipo válido, límites y datos sin basura', () => {
  assert.equal(M.normalizarNodo({ id: 'x', tipo: 'virus' }), null);
  assert.equal(M.normalizarNodo({ tipo: 'nota' }), null);
  const n = M.normalizarNodo({ id: 'a', tipo: 'nota', x: '10.4', y: 'nada', w: 99999, titulo: '', datos: { texto: 5, color: 'rojo', extra: 1 } });
  assert.deepEqual(n, { id: 'a', clase: 'nodo', tipo: 'nota', titulo: 'Nota', x: 10, y: 0, w: M.LIM.anchoMax, datos: { texto: '5', color: '' } });
  assert.equal(M.normalizarNodo({ id: 'p', tipo: 'paleta', datos: { colores: ['#112233', 'rojo', '#GGGGGG'] } }).datos.colores.length, 1);
});

test('sólo se guardan enlaces http(s)', () => {
  assert.equal(M.urlSegura('javascript:alert(1)'), '');
  assert.equal(M.urlSegura('data:text/html,x'), '');
  assert.equal(M.urlSegura('https://a.com/x'), 'https://a.com/x');
  assert.equal(M.crearNodo('enlace', 0, 0, { url: 'javascript:void(0)' }).datos.url, '');
  assert.equal(M.crearNodo('imagen', 0, 0, { url: 'javascript:void(0)' }).datos.url, '');
});

test('cada tipo nace listo para escribir', () => {
  assert.equal(M.crearNodo('guion', 0, 0).datos.escenas.length, 1);
  assert.equal(M.crearNodo('lista', 0, 0).datos.filas.length, 1);
  assert.equal(M.crearNodo('paleta', 0, 0).datos.colores.length, 3);
  M.TIPOS.forEach(t => assert.ok(M.crearNodo(t, 1, 2), t));
});

test('conexiones: sin duplicados, sin bucles y sin líneas colgando', () => {
  const docs = [nota('a'), nota('b')];
  const l = M.leer(docs);
  const c = M.conectar(l.indice, 'a', 'b');
  assert.equal(c.id, M.idConexion('b', 'a'), 'a-b y b-a son la misma');
  assert.equal(M.conectar(l.indice, 'a', 'a'), null);
  assert.equal(M.conectar(l.indice, 'a', 'zzz'), null);
  const l2 = M.leer([...docs, c]);
  assert.equal(M.conectar(l2.indice, 'b', 'a'), null, 'ya existe');
  assert.equal(M.leer([nota('a'), c]).conexiones.length, 0, 'si falta un nodo, no se dibuja');
});

test('las líneas salen de los lados que se miran', () => {
  const a = nota('a', 0, 0); const b = nota('b', 600, 100);
  assert.deepEqual(M.puntos(a, b), { x1: a.w, y1: M.PUERTO_Y, x2: 600, y2: 100 + M.PUERTO_Y, s1: 1, s2: -1 });
  assert.deepEqual(M.puntos(b, a), { x1: 600, y1: 100 + M.PUERTO_Y, x2: a.w, y2: M.PUERTO_Y, s1: -1, s2: 1 });
  const arriba = nota('c', 100, 400);
  assert.deepEqual([M.puntos(a, arriba).s1, M.puntos(a, arriba).s2], [1, 1], 'una sobre otra: rodea por la derecha');
  const r = M.ruta(a, b);
  assert.match(r.d, /^M /);
  assert.equal(r.my, (M.PUERTO_Y + 100 + M.PUERTO_Y) / 2);
});

test('zoom: el punto bajo el cursor no se mueve y hay topes', () => {
  const v = { x: 40, y: 20, z: 1 };
  const antes = M.aMundo(v, 300, 200);
  const z = M.zoomEn(v, 1.5, 300, 200);
  const despues = M.aMundo(z, 300, 200);
  assert.ok(Math.abs(antes.x - despues.x) < 1e-9 && Math.abs(antes.y - despues.y) < 1e-9);
  assert.equal(M.zoomEn({ x: 0, y: 0, z: 2 }, 5, 0, 0).z, M.ZOOM_MAX);
  assert.equal(M.zoomEn({ x: 0, y: 0, z: 0.2 }, 0.1, 0, 0).z, M.ZOOM_MIN);
});

test('encuadre: todo queda a la vista y no agranda de más', () => {
  const v = M.encuadre([{ x: -500, y: 0, w: 300, h: 200 }, { x: 4000, y: 2000, w: 300, h: 200 }], 1000, 700);
  assert.ok(v.z < 1);
  const izq = -500 * v.z + v.x; const der = 4300 * v.z + v.x;
  assert.ok(izq >= 0 && der <= 1000);
  assert.equal(M.encuadre([{ x: 0, y: 0, w: 100, h: 100 }], 1000, 700).z, 1);
  assert.deepEqual(M.encuadre([], 1000, 700), { x: 120, y: 100, z: 1 });
});

test('una tarjeta nueva no cae exacta sobre otra', () => {
  const a = { x: 100, y: 100, w: 300, h: 200 };
  assert.deepEqual(M.lugarLibre([], 100, 100), { x: 100, y: 100 });
  const p = M.lugarLibre([a], 150, 120, 280, 180);
  const pisa = p.x < a.x + a.w && p.x + 280 > a.x && p.y < a.y + a.h && p.y + 180 > a.y;
  assert.equal(pisa, false);
  assert.ok(Math.hypot(p.x - 150, p.y - 120) < 700, 'queda cerca');
  const b = M.lugarLibre([{ x: 400, y: 0, w: 300, h: 200 }], 400, 0, 280, 180, null, true);
  assert.ok(b.y >= 0 && b.x >= 400, 'junto a otra, busca hacia abajo o a la derecha, no arriba');
  const zona = { x0: 0, y0: 0, x1: 900, y1: 700 };
  const q = M.lugarLibre([a], 150, 120, 280, 180, zona);
  assert.ok(q.x >= 0 && q.y >= 0 && q.x + 280 <= 900 && q.y + 180 <= 700, 'dentro de lo que se ve');
  const fuera = M.lugarLibre([{ x: 0, y: 0, w: 900, h: 700 }], 50, 50, 280, 180, zona);
  assert.ok(fuera.x >= 948 || fuera.y >= 748 || fuera.x + 280 <= -48 || fuera.y + 180 <= -48, 'si no hay lugar visible, busca fuera sin tapar');
});

test('deshacer: el inverso devuelve exactamente lo que había', () => {
  const l = M.leer([nota('a', 5, 5), nota('b')]);
  const cambios = { a: { ...l.indice.a, x: 900 }, b: null, c: nota('c') };
  const inv = M.inverso(l.indice, cambios);
  assert.equal(inv.a.x, 5);
  assert.equal(inv.b.id, 'b');
  assert.equal(inv.c, null, 'lo creado se borra al deshacer');
  const despues = M.aplicarCambios(l.indice, cambios);
  assert.deepEqual(M.aplicarCambios(despues, inv), l.indice);
});

test('borrar un nodo se lleva sus conexiones; duplicar conserva las internas', () => {
  const c1 = M.conectar(M.leer([nota('a'), nota('b')]).indice, 'a', 'b');
  const c2 = { id: M.idConexion('b', 'c'), clase: 'conexion', a: 'b', b: 'c' };
  const l = M.leer([nota('a'), nota('b'), nota('c'), c1, c2]);
  assert.deepEqual(Object.keys(M.cambiosDeBorrar(l, ['a'])).sort(), ['a', c1.id].sort());
  let i = 0;
  const d = M.cambiosDeDuplicar(l, ['a', 'b'], () => `copia${i++}`);
  assert.deepEqual(d.nuevos, ['copia0', 'copia1']);
  assert.ok(d.cambios[M.idConexion('copia0', 'copia1')], 'la conexión interna se copia');
  assert.equal(Object.keys(d.cambios).length, 3, 'la que sale del grupo no');
  assert.equal(d.cambios.copia0.x, l.indice.a.x + 36);
});

test('pegar: una dirección es un enlace; lo demás, una nota', () => {
  assert.deepEqual(M.dePegado(' https://a.com/x '), { tipo: 'enlace', datos: { url: 'https://a.com/x' } });
  assert.equal(M.dePegado('una idea https://a.com').tipo, 'nota');
  assert.equal(M.dePegado('javascript:alert(1)').tipo, 'nota');
  assert.equal(M.dePegado('   '), null);
});

test('enlaces: YouTube trae miniatura; otros sitios sólo su nombre', () => {
  assert.match(M.infoEnlace('https://www.youtube.com/watch?v=dQw4w9WgXcQ').miniatura, /i\.ytimg\.com\/vi\/dQw4w9WgXcQ/);
  assert.match(M.infoEnlace('https://youtu.be/dQw4w9WgXcQ').miniatura, /dQw4w9WgXcQ/);
  assert.match(M.infoEnlace('https://www.youtube.com/shorts/dQw4w9WgXcQ').miniatura, /dQw4w9WgXcQ/);
  assert.deepEqual(M.infoEnlace('https://www.behance.net/a'), { url: 'https://www.behance.net/a', host: 'behance.net', miniatura: '' });
});

test('resumen en palabras', () => {
  const l = M.leer([nota('a'), nota('b'), M.crearNodo('imagen', 0, 0, {}, 'i')]);
  assert.equal(M.resumen(l), '2 notas · 1 imagen');
  assert.equal(M.resumen(M.leer([])), '');
});

test('el brief de antes pasa al muro sin perder texto ni imágenes', () => {
  const html = [{ type: 'html', content: '<p>Marca <strong>viva</strong> &amp; joven</p><ul><li>Uno</li><li>Dos</li></ul><img src="https://x.com/a.jpg"><img src="javascript:alert(1)">' }];
  const items = M.briefANodos(html);
  const n = items.find(i => i.id === 'brief-nota');
  assert.equal(n.datos.texto, 'Marca viva & joven\n• Uno\n• Dos');
  assert.equal(n.titulo, 'Brief');
  assert.equal(items.filter(i => i.tipo === 'imagen').length, 1, 'la imagen insegura no pasa');
  assert.equal(items.filter(i => i.clase === 'conexion').length, 1);
  assert.equal(items[0].id, 'meta');
  assert.equal(M.leer(items).nodos.length, 2);
});

test('formatos viejos del brief; vacío o de relleno no crea nada', () => {
  const items = M.briefANodos([{ type: 'b', text: 'Título' }, { type: 'p', text: 'Texto' }, { type: 'ul', items: ['a', 'b'] }]);
  assert.equal(items.find(i => i.id === 'brief-nota').datos.texto, 'Título\nTexto\n• a\n• b');
  assert.deepEqual(M.briefANodos([]), []);
  assert.deepEqual(M.briefANodos(undefined), []);
  assert.deepEqual(M.briefANodos([{ type: 'p', text: '' }]), []);
  assert.deepEqual(M.briefANodos([{ type: 'p', text: 'Briefing inicial — añadí el contexto de la tarea acá.' }]), []);
});

test('ordenar: lo conectado en columnas de izquierda a derecha; lo suelto, al final', () => {
  const n = (id, x, y) => M.crearNodo('nota', x, y, {}, id);
  const nodos = [n('a', 500, 0), n('b', 0, 300), n('c', 900, 900), n('s1', 50, 50), n('s2', 2000, 10)];
  const con = [{ a: 'b', b: 'a' }, { a: 'a', b: 'c' }];
  const p = M.ordenar(nodos, con, () => 100);
  const pos = (id) => p[id] || nodos.find(x => x.id === id);
  assert.ok(pos('b').x < pos('a').x && pos('a').x < pos('c').x, 'el grupo queda en columnas desde la primera tarjeta');
  assert.equal(pos('b').y, pos('a').y);
  assert.ok(pos('s1').y > pos('b').y + 100, 'las sueltas van debajo del grupo');
  assert.equal(pos('s1').y, pos('s2').y, 'en una misma fila');
  assert.deepEqual(M.ordenar([], []), {});
  const ya = M.ordenar(nodos.map(x => ({ ...x, ...pos(x.id) })), con, () => 100);
  assert.deepEqual(ya, {}, 'ordenar dos veces no mueve nada');
});

test('colores escritos a mano', () => {
  assert.equal(M.hexDe('C8F04A'), '#c8f04a');
  assert.equal(M.hexDe(' #cf4 '), '#ccff44');
  assert.equal(M.hexDe('rojo'), '');
  assert.equal(M.hexDe('#12345'), '');
});
