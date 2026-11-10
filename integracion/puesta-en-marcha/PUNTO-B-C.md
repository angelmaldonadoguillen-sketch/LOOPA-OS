# Puntos B, C y D — el corte a un solo ecosistema

Estado al 2026-11-10: **preparado; nada escrito.**

- B0 se hizo: es la lectura de los datos, sin escribir nada. El respaldo está en `respaldo/b-2026-11-10-125825`.
- La corrida en seco contra el proyecto real da 29 documentos para crear y 0 conflictos. Huella del plan: `2b025fc88494025c7edbac54f3cdc4fe`.

## Qué cambia para el equipo

- **Antes:** LOOPA guarda en `tooned-os` (colección `loopa`) y FRAME en `frame-studio-3a18f`.
- **Después:**
  - LOOPA y FRAME usan la misma base, la de FRAME, y se entra a LOOPA con la cuenta de FRAME.
  - Cada cliente tiene una sola ficha.
  - Al confirmar una venta se crean solas sus tareas en el tablero de producción, si el servicio tiene plantilla.
- `tooned-os/loopa` queda como archivo y no se borra.

## Antes del corte (decisiones)

1. **Tablero de producción.** Propuesto: «Loopa Estudio» (`ws1787627671662tws`, con Ángel y Luther).
2. **Quiénes venden.** Cada persona necesita:
   - una cuenta aprobada en FRAME;
   - estar en la lista comercial;
   - ser miembro del tablero de producción.
3. **Plantillas de producción**, es decir, qué tareas crea cada servicio. Hoy ningún servicio tiene: las ventas se registran, pero no generan tareas.

## El corte, en orden

| Paso | Qué | Quién |
|---|---|---|
| 1 | Avisar al equipo: no usar LOOPA durante el corte, que es cuestión de minutos (D10). | Ángel |
| 2 | B0 de nuevo, para tener los datos al día:<br>`node integracion/puesta-en-marcha/respaldo-b.cjs`<br>Si el manifiesto cambió, la huella también. | Claude |
| 3 | Guardar una copia de `loopa-respaldo.json` **fuera de esta PC** (Drive). Es la copia «archivada». | Ángel |
| 4 | Corrida en seco: `node integracion/puesta-en-marcha/migrar.cjs --respaldo <b-…> --archivado <copia> --tablero ws1787627671662tws` | Claude |
| 5 | **Migración**: lo mismo con `--escribir --huella <huella del paso 4>`. | Ángel, en su terminal |
| 6 | **Configuración C**: `node integracion/puesta-en-marcha/configurar-c.cjs --respaldo <b-…> --tablero ws1787627671662tws --comerciales <emails> --escribir` | Ángel, en su terminal |
| 7 | **Publicar LOOPA (D)**:<br>`LOOPA_FUSION_REAL=1 node _fuente/build.js`<br>después merge a `main` y push. GitHub Pages lo publica. | Claude |
| 8 | Cada uno recarga LOOPA y entra con su cuenta de FRAME. | Equipo |
| 9 | Verificar:<br>· las 6 ventas, #1001–#1006, con sus montos;<br>· una venta nueva toma el número #1007;<br>· la venta nueva crea sus tareas en «Loopa Estudio», si el servicio tiene plantilla. | Claude + Ángel |

**Volver atrás antes del paso 7:** no hace falta tocar nada. LOOPA sigue con `tooned-os`, y lo migrado sólo lo usan las funciones nuevas.

**Volver atrás después del paso 7:** revertir el commit del build en `main`. LOOPA vuelve a `tooned-os`, pero lo vendido después del corte quedó en FRAME y habría que pasarlo a mano.

## Herramientas

- **`respaldo-b.cjs`**: sólo lectura (`permitidoB`). Lee los 5 documentos de LOOPA y 3 colecciones de FRAME.
- **`migrar.cjs` + `almacen-rest.cjs`**:
  - usan el ejecutor probado (`functions/migration/runner.js`), que nunca sobrescribe ni borra;
  - verifican la copia archivada del respaldo y se pueden reanudar;
  - la API REST se limita a las colecciones de la migración: crear sólo si el documento no existe, actualizar sólo si existe;
  - en el emulador se probaron igual a la corrida en memoria, con un corte a mitad incluido.
- **`configurar-c.cjs`**: verifica que cada comercial esté aprobado y sea miembro del tablero. Escribe `loopa_config/production` y `access` con la forma de las reglas.
- **LOOPA**:
  - `?datos=fusion&servidor=real` usa FRAME;
  - el build con `LOOPA_FUSION_REAL=1` lo deja como modo de siempre y no inicia nunca la app de `tooned-os`;
  - la decisión es `LoopaFuente.modoDatos`, probada caso por caso.
