# LOOPA OS

Sistema de ventas de LOOPA studio. Misma base que TOONED OS (shell, estética,
Firebase, métricas), pero sin inventario: lo que se vende son **tipos de servicio**
reutilizables.

## Cómo se usa

1. **Nueva venta** → elegís o escribís el cliente → tocás los tipos de servicio
   (o escribís uno nuevo y Enter: se crea y queda guardado) → cobro → listo.
2. Tocar un tipo que ya está en la venta suma 1 a la cantidad.
3. Si cambiás el precio en una venta, aparece **«Guardar como precio base»**
   para actualizar el tipo.
4. En **Ventas** abrís cualquier venta para cambiar estado, registrar abonos,
   editar servicios o **Vender de nuevo** (misma venta para el mismo cliente,
   ideal para planes mensuales).
5. **Servicios** es el catálogo: precio/costo base, margen, cuántas veces se vendió
   e ingresos. Un tipo ya vendido no se borra: se archiva.

## Módulos

| Módulo | Qué hace |
|---|---|
| Nueva venta | Cliente → servicios → cobro (pagado / anticipo / por cobrar) |
| Ventas | Base de datos con filtros, cobros, estados, exportar a Excel |
| Servicios | Catálogo de tipos de servicio |
| Clientes | Se crean solos con cada venta; historial y saldo por cliente |
| Métricas | Venta, cobrado, por cobrar, ganancia neta, top servicios / clientes |
| Gastos | Variables (con fecha) y fijos mensuales; se restan en Métricas |
| Configuración | Métodos de pago y comisión, categorías, canales, moneda, respaldo |

## Dónde se guardan los datos

En la nube (Firebase), en el proyecto heredado de TOONED (id interno `tooned-os`),
colección `loopa`. Se entra con **la misma cuenta que FRAME** y solo pueden entrar
los miembros **activos** del equipo (colección `frame_users`, status `active`).

La regla de Firestore que protege LOOPA (línea del comodín, al final):

```
allow read, write: if !col.matches('frame_.*') && (col != 'loopa' || activeMember());
```

**Pendiente de seguridad:** ese mismo comodín deja públicos los datos viejos de
TOONED (`data`, `thumbs`). TOONED ya no se usa; conviene cerrarlos.

### Datos de cuando era modo local
Si un navegador tiene datos de antes, al entrar LOOPA ofrece **«Subir a la nube»**:
une tipos por nombre y clientes por teléfono/email, renumera ventas repetidas y
no duplica. Los datos locales quedan archivados en ese navegador (`loopa-local-*`).

## Dónde está publicada

Igual que TOONED OS, vive en GitHub Pages:
**https://angelmaldonadoguillen-sketch.github.io/LOOPA-OS/**
(repo `angelmaldonadoguillen-sketch/LOOPA-OS`). Para instalarla como app,
abrí el link y usá la opción «Instalar» del navegador o «Agregar a pantalla
de inicio» en el celular.

Para publicar cambios: `node _fuente/build.js`, luego commit y `git push`.

## Límite conocido

Igual que TOONED OS, todas las ventas viven en un solo documento de Firestore,
que tiene tope de 1 MB (aprox. 1.000–1.200 ventas). Cuando se acerque a eso,
conviene pasar las ventas a un documento por venta.

## Editar el sistema

El código fuente está en `_fuente/`:

- `app.jsx` — toda la lógica y pantallas (React)
- `base.css` — estilos base heredados de TOONED OS (copia propia: LOOPA ya no depende de la carpeta de TOONED)
- `extra.css` — estilos propios de LOOPA
- `build.js` — arma `index.html` (toma `base.css`, lo pasa a la paleta LOOPA y descarta lo que no se usa)
- `logo-loopa.svg` — logo oficial; si cambia el logo, reemplazá este archivo y volvé a armar

Identidad: fondo `#14281f`, acento `#e2e58d`, tipografía Roboto con solo 3 tamaños (`--fs-s` 12 px, `--fs-m` 14 px, `--fs-l` 30 px; 24 px en celular) y 3 pesos (300 títulos, 400 texto, 500 énfasis). Usá siempre esas variables al agregar pantallas.

Después de editar: `node _fuente/build.js`. La config de Firebase que ya
hayas pegado en `index.html` se conserva.
