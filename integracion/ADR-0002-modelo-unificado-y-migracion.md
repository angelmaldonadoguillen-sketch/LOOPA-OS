# ADR-0002 — Modelo de datos unificado y migración simulada (Fase 1)

- **Estado:** propuesto · Fase 1 · dos rondas de revisión independiente aplicadas
- **Fecha:** 2026-11-09
- **Alcance:** código puro, repositorio de ventas, migración simulada, fixtures y pruebas.
  - Sin escrituras remotas, sin reglas, sin `firebase.json`.
  - La app publicada (`index.html`, `_fuente/`) no cambia: sigue usando el esquema viejo hasta el corte de la Fase 2/5.
- **Depende de:** [ADR-0001](ADR-0001-fusion-loopa-os.md) y `PLAN-FUSION-LOOPA-OS.md`.

## 1. Problema

El esquema actual de LOOPA guarda cada colección en **un solo documento** (`loopa/ventas = { items: [...] }`) y el navegador lo reescribe entero con `set()`. Eso trae cuatro problemas:

- **Pérdida de ventas:** dos personas que guardan a la vez se pisan.
- **Correlativo repetido:** `nextN = max(n)+1` se calcula en cada navegador.
- **Tope de 1 MB:** todas las ventas viven en el mismo documento.
- **Clientes duplicados:** una ficha en LOOPA y otra en FRAME, vinculadas sólo por nombre.

## 2. Decisión: un documento por entidad

| Colección | Documento | Notas |
|---|---|---|
| `loopa_sales/{saleId}` | Venta = contrato de producción (ADR-0001) + `commercial` + `version`, `revision`, `operations`, `lock`, `estadoLog`, `createdAt` | `saleId` UUID. `n` visible, nunca identidad |
| `loopa_counters/sales` | `{ next }` | Correlativo transaccional. Lo siembra la migración con `max(n)+1` |
| `loopa_services/{serviceId}` | Catálogo comercial + `executionPlan` (null hasta la Fase 3) + `specialClientId` | Archivados se migran archivados |
| `frame_clients/{clientId}` | **Ficha única**: forma de FRAME + `commercial` (empresa, teléfono, email, canal, notas) + `legacyLoopaIds` | Extiende la colección existente; el portal y las tareas siguen funcionando |
| `loopa_expenses/{id}` | `kind: 'variable' \| 'fixed'` | Un documento por gasto |
| `loopa_config/main` | Métodos de pago, categorías, canales, tipos de gasto, moneda | |
| `loopa_integration_events/{eventId}` | Outbox (ADR-0001) | Sólo servidor |
| `loopa_migrations/{runId}` | Punto de control de la migración | Sólo servidor |

### `version` y `revision` son contadores distintos

- **`version`** sube con cualquier cambio. Es la concurrencia optimista de la interfaz: quien guarda con una versión vieja recibe `version_conflict` y no pisa.
- **`revision`** sube sólo cuando cambia algo que afecta a producción: estado, fechas, cliente o líneas. Cobros y notas no la tocan, así que no disparan resincronizaciones ni hacen quedar atrás (`superseded`) a eventos válidos.

### Repositorio de ventas (`functions/repositories/sales.js`)

- **`createSale`**: en **una** transacción lee el contador, crea la venta con `n = next`, sube el contador y, si nace confirmada, escribe su evento en el outbox.
  - Es idempotente por `id`: reintentar no consume otro número.
  - Reintenta sólo ante contención (`aborted`, o `10`/`ABORTED` del Admin SDK), con espera aleatoria.
  - Acepta sólo los campos de un borrador (`id`, `status`, `fecha`, `entrega`, `client`, `lines`, `commercial`) y exige que el cliente exista en la ficha única.
  - Sin contador migrado se niega (`counter_missing`), para no reiniciar la numeración.
- **`updateSale`**: hace un update con merge y exige `expectedVersion`.
  - Rechaza los campos del servidor (`operations`, `lock`, `n`, `revision`, `id`, `migration`, `createdAt`).
  - Si cambió producción, encola en la misma transacción el evento que corresponde: borrador → confirmada da `sale.confirmed`; confirmada → confirmada, `sale.updated`; cancelar, `sale.cancelled`; cancelada → confirmada, `sale.confirmed`.
  - **Transiciones permitidas:** borrador → {borrador, confirmada, cancelada}; confirmada → {confirmada, cancelada}; cancelada → {cancelada, confirmada}. Volver a borrador se rechaza (`invalid_transition`): dejaría trabajo en Producción sin evento.
  - Una venta cancelada no admite cambios de producción salvo re-confirmarse.
  - `commercial` se edita por partes (lo que no viene se conserva). Los cobros no se editan acá (`use_add_payment`).
  - Valida también precio y costo de cada línea: la vista de producción no los lleva, así que se validan en el repositorio.
  - **Ventas migradas:** los problemas que traían (`legacyIssues`) no bloquean ediciones que no los tocan. Tocar el campo afectado exige corregirlo. Mandar la venta a Producción (confirmar o editar líneas o fechas) con problemas pendientes devuelve `production_invalid`, con la lista de qué corregir.
  - Cancelar una venta que nunca pasó por Producción (`operations: not_applicable`) no encola evento: no hay tarjetas que marcar.
- **`addPayment`**: es idempotente por id de cobro, no toca `revision` y rechaza dejar la venta pagada de más (`payment_exceeds_total`, salvo `allowOverpayment`).
- **El outbox lleva sólo la vista de producción.** Importes (también `precio` y `costo` de las líneas), cobros y contacto no viajan en el evento (atenúa el riesgo 10 del ADR-0001).

## 3. Fusión de clientes

Reglas implementadas en `functions/migration/clients.js`:

1. Sólo se compara contra las fichas de FRAME del tablero de producción.
2. **Coincidencia automática sólo por teléfono (últimos 8 dígitos) o email normalizado.** El `—` de FRAME no es un dato. Un campo de teléfono puede tener varios números (`/`, `,`, `;`, «y», «o») y se descartan las extensiones.
   - Si sólo coincide el teléfono y los nombres no concuerdan, es conflicto (`phone_only_name_mismatch`): puede ser un teléfono de oficina compartido.
   - Para que dos nombres concuerden, todas las palabras del más corto deben estar enteras en el más largo, y una sola palabra corta no alcanza. «Café Aurora» concuerda con «Café Aurora S.A.»; «Ana» no concuerda con «Mariana Pérez», ni «Sol» con «Soluciones Industriales».
3. Mismo nombre sin otro dato es `name_only`: queda en conflicto, nunca se enlaza solo.
4. Son conflicto, y bloquean la migración hasta que haya una decisión:
   - varios candidatos;
   - datos que se contradicen;
   - duplicados dentro de LOOPA;
   - dos clientes de LOOPA que caerían en la misma ficha.
5. Las decisiones viven en `client-decisions.json` (`link` a una ficha existente del tablero, o `new`). Una decisión no puede inventar destinos ni juntar dos clientes en una ficha.
6. **Completar una ficha existente nunca pisa** nombre ni contacto. Sólo agrega `commercial` (incluido `nombreLoopa`, el nombre con que LOOPA la conocía), `legacyLoopaIds` y llena un email o teléfono que estaba en `—`.
   - Si la ficha ya está enlazada a **otro** cliente de LOOPA (por ejemplo, una corrida anterior con decisiones distintas), el ejecutor la marca como conflicto (`conflict_foreign_link`) y no la toca.
7. Un cliente que sólo existía en LOOPA recibe ficha nueva con id determinista `cli_H(loopaClientId)`.
8. Una venta sin `clienteId`, o con uno que ya no existe, recibe una ficha "huérfana" que pasa por la misma fusión y admite decisiones.
   - El id es `CL-ORPHAN-H(id borrado)` si la venta conserva el id del cliente borrado (así todas sus ventas caen en la misma ficha aunque cambie el teléfono), o `CL-ORPHAN-H(nombre, teléfonos, email)` si no lo tiene.
   - La ficha se arma con la venta más antigua del grupo, no con la primera del respaldo: no depende del orden.
   - La venta conserva `client.legacyClientId` (el id original) y `client.orphanClientId`.
9. Un id de cliente repetido en LOOPA bloquea (`legacy.client.duplicate_id`): no se sabe a cuál apunta cada venta.

## 4. Migración

```
respaldo (JSON exportado por LOOPA) ─► manifiesto (conteos + hash por colección)
   + frame_clients exportado          ─► propuesta de fusión de clientes
   + client-decisions.json            ─► plan (lista exacta de escrituras + huella)
                                      ─► conciliación (ventas, clientes, servicios, gastos, total, cobrado, líneas)
                                      ─► dry-run ─► corrida con puntos de control
```

- **Plan determinista:** el mismo respaldo, los mismos clientes y las mismas decisiones dan la misma huella, en cualquier orden de entrada.
- **Importes estrictos** (`functions/migration/amounts.js`):
  - número, o texto sin ambigüedad: `1500`, `1,500.50`, `9000.`, `.5`, `+500`, `1e3`;
  - el texto se convierte con advertencia y el original queda en `legacyRaw`;
  - cualquier otro formato (`"L 6,000"`, `"1.500,50"`) **bloquea** y señala la venta para corregirla en LOOPA.
- **Conciliación obligatoria:** si no cuadran conteos, totales, cobros o líneas, el plan queda bloqueado. El origen se suma con el parser estricto, independiente de la conversión. Además, ningún documento destino puede escribirse dos veces (`migration.duplicate_op`).
- **El ejecutor** (`functions/migration/runner.js`):
  - recibe el **contenido de la copia archivada del respaldo** (`archivedBackupText`) y calcula él mismo el recibo (SHA-256 del archivo + manifiesto). No acepta recibos armados por quien llama. Si la copia no contiene exactamente el origen del plan, se niega (`backup_not_verified`), y el SHA-256 queda registrado en la corrida. El CLI lo recibe con `--archived-backup <copia>`, y en el ensayo avisa si se usó el mismo archivo de entrada;
  - no corre un plan bloqueado;
  - **nunca sobrescribe ni borra**: un documento distinto en el destino es conflicto;
  - es reanudable: el cursor vive en `loopa_migrations/{runId}`, y repetir operaciones ya hechas da `same` porque la huella del dato viaja en `migration.hash`;
  - recuerda los conflictos aunque se reanude;
  - una corrida queda atada a la huella de su plan (`plan_changed`).
- **Datos viejos difíciles, conservados con advertencia:**
  - venta sin `creado`: identidad débil;
  - línea sin tipo: servicio marcador `SRV-SIN-CATALOGO`;
  - correlativo repetido (la interfaz nueva distingue por id);
  - cobro sin id: id determinista;
  - gasto sin id, o con id repetido: id derivado sólo del contenido (no de la posición: la app vieja inserta gastos al frente);
  - importes con coma de miles;
  - lo que la app vieja aceptaba y el contrato nuevo no (entrega anterior a la venta, precio negativo, venta sin líneas): se migra marcado en `legacyIssues`, porque una venta histórica no va a producción.
- **Bloquean:** importes ilegibles, ids de cliente repetidos, clientes sin resolver, conciliación que no cuadra.
- **Lectura compatible** (`functions/migration/compat.js`): los documentos nuevos se leen con la forma vieja, con una prueba de ida y vuelta, para portar pantallas de a una en la Fase 2.
  - Un borrador devuelve `null`: la interfaz vieja no tenía borradores y lo contaría como venta activa.
  - `estadoLog` se traduce al vocabulario viejo.
  - Las pantallas viejas muestran el nombre con que LOOPA conocía al cliente (`commercial.nombreLoopa`); la ficha única conserva el suyo en `name`.

## 5. Cómo probar

```bash
node --test "integracion/test/*.test.cjs"
node integracion/migrate.cjs --simulate
node integracion/migrate.cjs --no-decisions
node integracion/migrate.cjs --backup <respaldo.json> --frame-clients <frame_clients.json> --decisions <decisiones.json> --workspace <id>
```

Con un respaldo real y un export real de `frame_clients`, el último comando produce el reporte completo sin escribir nada.

| Requisito | Prueba |
|---|---|
| Correlativo único bajo concurrencia | `repository › veinte ventas simultáneas…` |
| Sin pisadas | `repository › edición concurrente…`, `editar la venta no borra el estado del worker` |
| Outbox atómico | `repository › de punta a punta…`, `cambiar líneas o fechas…` |
| Fusión de clientes segura | `migration › fusión de clientes…`, `"—" no es un dato…` |
| No se pierde dinero ni datos | `migration › conciliación…`, `lectura compatible…` |
| Reanudación sin duplicar | `migration › una corrida interrumpida…` |
| Nunca sobrescribe | `migration › nunca sobrescribe…`, `completar una ficha…` |
| Migración repetida = mismo resultado | `migration › repetir el plan…`, `CLI: simulación completa y determinista` |

## 6. Riesgos y pendientes

1. **La app sigue en el esquema viejo.** Hasta el corte, `loopa/ventas` sigue cambiando. La corrida real debe hacerse con LOOPA congelado (sólo lectura) o con una segunda pasada de cambios. Lo define el plan de corte de la Fase 5.
2. **Reglas de las colecciones nuevas** (Fase 3):
   - `loopa_*` sólo para miembros activos del tablero;
   - `lock`, `operations`, `revision`, `n` y `migration` sólo para el servidor;
   - `loopa_counters`, `loopa_migrations` y `loopa_integration_events` sin acceso del navegador, o con escritura mediada.

   Mientras el navegador no tenga Admin SDK, crear una venta con contador requiere que la regla permita incrementar `next` en uno y sólo junto con la creación de la venta, o mover `createSale` a una función `onCall`. **Recomendación: `onCall`** (D9).
3. **Contador caliente:** una sola fila de contador limita a algo así como una venta por segundo sostenida. Sobra para el estudio. Si alguna vez no alcanza, se reparte en bloques de números.
4. **Corrida real = muchas transacciones pequeñas** (una por documento). Para miles de documentos funciona, pero es lenta; puede agruparse en lotes en la Fase 5.
5. **Advertencias que conviene revisar con el respaldo real:** ventas sin `creado` (identidad débil) y correlativos repetidos.
6. **FRAME guarda clientes con `set()` completo** y los borra de verdad (`frame-studio-manager/app.jsx`). Desde una copia vieja podría borrar `commercial` y `legacyLoopaIds`. Al portar la ficha de cliente (Fase 2/4), guardar con merge y archivar en vez de borrar. Repetir una corrida terminada no lo repara.
7. **Editar una venta migrada** (`operations: not_applicable`) encola `sale.updated`. El worker no tiene tarjetas para ella y sus líneas no tienen plantilla, así que termina sin trabajo. Si la edición agrega una línea con plantilla, esa línea sí genera producción, que es lo esperado para lo que se vende de nuevo.
8. **El recibo de respaldo prueba que el archivo coincide con el plan, no que el archivo esté guardado en lugar seguro.** El procedimiento de la Fase 5 debe archivar el respaldo, y su SHA-256, fuera del equipo que corre la migración.
9. **Segunda pasada incremental (alternativa de D10):** los gastos sin id se identifican por contenido. Si entre dos pasadas se edita uno de dos gastos idénticos sin id, la segunda pasada lo vería como un gasto nuevo. Con D10 por defecto (LOOPA congelado durante la corrida) no ocurre. Si se elige la segunda pasada, antes hay que asignar ids a esos gastos en LOOPA.
10. **Lo que la app vieja ya guardó mal no se puede detectar:** `num()` convertía antes de guardar, así que un «1.500,50» tipeado quedó guardado como el número 1.5005. Conviene revisar a ojo los importes no enteros del respaldo real.

## 7. Decisiones nuevas

| # | Decisión | Por defecto | Alternativa |
|---|---|---|---|
| D9 | Cómo crea ventas el navegador | Función `onCall` `createSale` (Admin SDK) | Escritura directa con reglas que validen el incremento del contador |
| D10 | Congelamiento durante el corte | LOOPA en sólo lectura durante la corrida real | Corrida + segunda pasada incremental |

## 8. Revisión independiente (2026-11-09)

Una revisión adversarial de la Fase 1 reportó 11 hallazgos verificados (2 altos, 6 medios, 3 bajos) y 3 sin verificar. Todos los verificados están corregidos, con una prueba por hallazgo en `integracion/test/phase1-regressions.test.cjs`:

1. Volver a borrador sin evento.
2. Importes convertidos en silencio.
3. Ids repetidos que perdían datos.
4. Ids de gastos dependientes de la posición.
5. Importes en el outbox.
6. Dos clientes en una ficha entre corridas.
7. Teléfono compartido y extensiones.
8. Recibo de respaldo que no verificaba nada.
9. Lectura compatible infiel.
10. Huecos del repositorio.
11. Datos viejos aceptados que bloqueaban sin salida.

Los tres no verificados quedan cubiertos así: el código de contención del Admin SDK ya se reintenta, y los otros dos figuran como riesgos 6 y 7.

**Segunda ronda.** Confirmó 7 hallazgos cerrados y 3 parciales, y encontró 5 regresiones de las propias correcciones. Todo quedó resuelto, con pruebas `R2-*`:

- Formas numéricas sin ambigüedad aceptadas con advertencia.
- El recibo de respaldo se calcula dentro del ejecutor desde la copia archivada.
- Las pantallas viejas muestran el nombre de LOOPA.
- El repositorio valida precio y costo de las líneas (A).
- Las ventas migradas siguen siendo editables (B).
- Fichas huérfanas por cliente borrado y por venta representativa fija (C).
- Nombres comparados por palabras enteras (D).

La E queda como riesgo 9.
