# Puntos B, C y D — el corte a un solo ecosistema

**Estado (2026-11-10): preparado y probado; nada escrito.**
- B0 está hecho: se leyeron los datos sin escribir nada.
- La corrida en seco del corte completo contra el proyecto real da:
  - 29 documentos para migrar, 0 conflictos (huella `2b025fc88494025c7edbac54f3cdc4fe`);
  - la configuración del tablero de producción y de quién vende;
  - las 10 plantillas.

## Qué cambia para el equipo

- **Antes:** LOOPA guarda en `tooned-os` (colección `loopa`) y FRAME en `frame-studio-3a18f`.
- **Después:**
  - LOOPA y FRAME usan la misma base, la de FRAME, y se entra a LOOPA con la cuenta de FRAME.
  - Cada cliente tiene una sola ficha.
  - Los gastos y la configuración se sincronizan entre dispositivos.
  - Al confirmar una venta, se crea sola una tarea por servicio en «Loopa Estudio».
- `tooned-os/loopa` queda como archivo y no se borra.

## Decisiones (Ángel, 2026-11-10)

1. **Tablero de producción:** «Loopa Estudio» (`ws1787627671662tws`, con Ángel y Luther).
2. **Quién vende:** Ángel. Para sumar a alguien más hace falta:
   - una cuenta aprobada en FRAME;
   - que sea miembro de «Loopa Estudio»;
   - correr `configurar-c.cjs --comerciales <su email> --escribir`. La lista suma personas; no saca a nadie.
3. **Plantillas:** una tarea por servicio, definida en `plantillas-produccion.cjs`.
   - **La tarea:** se llama «Servicio · Cliente», empieza en Briefing y trae un checklist de 4 pasos.
   - **Fecha límite:** la entrega de la venta.
   - **Tipo:** Campaign para redes y publicidad, Otro para el resto.
   - **Para cambiar una plantilla:** se edita, se sube `version` y se corre `plantillas.cjs --escribir`.

## El corte, en orden

| Paso | Qué | Quién |
|---|---|---|
| 0 | **Reglas nuevas** (tanda 3.8: el equipo comercial lee y edita gastos y configuración en FRAME).<br>Desde FRAME `main`: `firebase deploy --only firestore:rules --project frame-studio-3a18f`.<br>Se puede hacer antes del corte: sin lista comercial, nadie gana acceso. | Ángel, en su terminal |
| 1 | Avisar al equipo: no usar LOOPA durante el corte, que es cuestión de minutos (D10). | Ángel |
| 2 | B0 de nuevo, con los datos al día: `node integracion/puesta-en-marcha/respaldo-b.cjs`. Después, la corrida en seco de `corte.cjs`, que da la huella. | Claude |
| 3 | Guardar una copia de `loopa-respaldo.json` **fuera de la carpeta del respaldo**, idealmente en Drive. Es la copia «archivada»; tiene que ser idéntica, porque se verifica su sha256. | Ángel |
| 4 | **El corte de datos, en un comando:**<br>`node integracion/puesta-en-marcha/corte.cjs --respaldo <b-…> --archivado <copia> --tablero ws1787627671662tws --comerciales <email de Ángel> --escribir --huella <huella>`<br>Hace la migración, la configuración y las plantillas, y se detiene en el primer problema. | Ángel, en su terminal |
| 5 | **Publicar LOOPA (D):** `LOOPA_FUSION_REAL=1 node _fuente/build.js`, merge a `main` y push. GitHub Pages lo publica. | Claude |
| 6 | Cada uno recarga LOOPA y entra con su cuenta de FRAME. Hay que cerrar las pestañas viejas de LOOPA. | Equipo |
| 7 | **Verificar:**<br>· las 6 ventas, #1001–#1006, con sus montos;<br>· los 8 gastos y la configuración;<br>· una venta nueva toma el número #1007;<br>· esa venta crea su tarea en «Loopa Estudio». | Claude + Ángel |
| 8 | **Pestañas viejas.** Volver a correr B0 y la corrida en seco. Si una pestaña vieja guardó algo en `tooned-os` después del corte, la huella cambia: lo nuevo aparece como «crear» y lo editado como conflicto. Lo nuevo se pasa con otra corrida. | Claude |

**Volver atrás:**
- **Antes del paso 5:** no hace falta tocar nada. LOOPA sigue con `tooned-os`.
- **Después del paso 5:** revertir el commit del build en `main`. LOOPA vuelve a `tooned-os`, pero lo vendido después del corte quedó en FRAME.

## Herramientas

- **`respaldo-b.cjs`:** sólo lectura (`permitidoB`). Lee:
  - los 5 documentos de LOOPA;
  - 3 colecciones de FRAME;
  - las columnas y tipos de cada tablero.
- **`corte.cjs`:** el comando del corte. Usa las tres herramientas de abajo, que también se pueden correr sueltas.
- **`migrar.cjs` + `almacen-rest.cjs`:**
  - usan el ejecutor de siempre, que nunca sobrescribe ni borra;
  - con conflictos en el destino, no escriben;
  - exigen la huella exacta y la copia archivada aparte e idéntica;
  - se pueden retomar si se cortan;
  - la API REST se limita a las colecciones de la migración: crear sólo si el documento no existe, actualizar sólo si existe;
  - en el emulador se probaron igual a la corrida en memoria.
- **`configurar-c.cjs`:**
  - escribe `loopa_config/production` y `access` con la forma que piden las reglas;
  - no toca un documento con claves de más;
  - la lista comercial suma personas.
- **`plantillas.cjs`:**
  - valida contra las columnas y tipos reales del tablero;
  - nunca pisa ni baja una versión.
- **LOOPA (tandas 3.7 y 3.8):**
  - `?datos=fusion&servidor=real`, o el build con `LOOPA_FUSION_REAL=1`, usan FRAME;
  - gastos y configuración se leen y guardan en FRAME, en vivo; se escribe sólo lo que cambió.
