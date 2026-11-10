# ADR-0001 — Fusión LOOPA OS: generación de producción desde ventas

- **Estado:** propuesto · Fase 0.1 (contrato y arnés local, adaptado a la fusión) · pendiente de revisión independiente
- **Fecha:** 2026-11-09
- **Plan general:** `../../PLAN-FUSION-LOOPA-OS.md` (carpeta `Codex/2026-11-09`)
- **Alcance:** sólo código puro, fixtures, simulador y pruebas. No hay escrituras
  remotas, Cloud Functions, reglas ni `firebase.json`. La app publicada (`index.html`,
  `_fuente/`) no cambia.

### Cambio de rumbo (2026-11-09)

El encargo original hablaba de **integrar** dos sistemas. Ángel definió una **fusión**:

- Un solo producto, LOOPA OS, con módulos; FRAME pasa a ser el módulo **Producción**.
- Una ficha única de cliente.
- El código base es el repositorio LOOPA-OS. El de FRAME queda intacto como app viva y referencia hasta el corte.
- Portfolio no entra.

Consecuencias en este ADR:

- La venta apunta al cliente unificado con `client.clientId`. Desaparecen `loopaClientId` y `frameClientId`, y con ellos el "enlace entre sistemas".
- El núcleo, los fixtures, el simulador y las pruebas viven en este repo (`functions/production-plan/`, `integracion/`).
- Donde el texto dice "FRAME" se refiere al modelo de tareas y calendario que hoy vive en FRAME y que se porta como módulo Producción. Las colecciones `frame_*` conservan su nombre hasta que la Fase 1 decida el esquema final.

## 1. Contexto confirmado en el código

### LOOPA OS (`main` @ `4fcebd6`)

| Tema | Realidad del código | Consecuencia |
|---|---|---|
| Persistencia | `loopa/{ventas,clientes,servicios,config,gastos}` con `{items:[…]}`; `Store.save` hace `set()` del documento entero desde el navegador | Último en escribir gana: dos navegadores pueden perder ventas. Tope de 1 MB |
| Identidad de venta | Sólo `n`; `nextN = max(n)+1` calculado en el cliente; `handleUpdate/Delete(n)` | Carrera de correlativo; no hay identidad estable |
| Líneas | `snapshotServicio(s)` + `q`; la `key` se descarta al guardar | No hay `lineId` |
| Estado | `estado` mezcla producción (`pendiente…entregado`) y anulación (`cancelado`) | No hay borrador/confirmada; registrar = confirmar |
| Servicio | `id SRV-…`, `modelo` plan/unitario/proyecto/especial; sin plantilla operativa ni versión | Hay que añadir `executionPlan` versionado |
| Cliente | `CL-…`; al vender se reutiliza por teléfono, email **o nombre+empresa** | Emparejamiento difuso; sin vínculo con `frame_clients` |
| Borrado | `handleDelete` elimina la venta (con deshacer) | Con integración dejaría tareas huérfanas |
| Acceso | Regla en `tooned-os` consulta `frame_users` **de `tooned-os`** | Puede divergir de los miembros reales de `frame-studio-3a18f` |

### FRAME (`main` @ `55a4976`)

| Tema | Realidad del código |
|---|---|
| Tarea | Forma garantizada por `normalizeProject` (`data.jsx`): `title, client, type, status, priority, assignees, startDate, deadline, sessionDate, tags, checklist[{id,text,done}], deliverables, timeline, description[], workspaceId, workspaceIds, viewerIds, clientVisible, cover` |
| Calendario | Ubica por `sessionDate`; arrastre y carry-over (cliente y `carryOverIncompleteTasks`) sólo mueven `sessionDate`; `deadline` nunca (contrato `calendar-date-contract.test.js`) |
| Cliente en tarea | **Sólo por nombre** (`clients.jsx`, `portal.jsx`: comparación en minúsculas). No existe `clientId` |
| Reglas de alta | `workspaceIds == [workspaceId]` y `viewerIds == memberIds` del tablero |
| Reglas de edición | Cualquiera con acceso puede cambiar cualquier campo (incluida procedencia futura) |
| Escrituras del navegador | `handleUpdateProject` envía arrays completos (checklist); `handleToggleFavorite` hace `set()` del documento entero |
| Functions | `functions/index.js`, Node 22, `us-central1`, `America/Tegucigalpa` |

### Contradicciones documentación ↔ código

- `CLAUDE.md` de FRAME dice "no hay tests": hay ~50 pruebas de contrato.
- `CLAUDE.md` dice papelera a 5 días: el código usa 10 (`TRASH_RETENTION_DAYS`, `purgeExpiredTrash`).
- `CLAUDE.md` lista `frame_config` como colección de configuración: las reglas la niegan; la configuración vive en `frame_workspaces/{id}/config`.
- `CLAUDE.md` dice ids `'p' + Date.now()`: hoy llevan sufijo aleatorio.
- El encargo dice que el modelo de LOOPA ya distingue los cuatro modelos comerciales: **confirmado** (`MODELOS_SERVICIO`).

## 2. Decisión

1. **Outbox + worker en servidor.** Confirmar una venta escribirá, en la misma
   transacción, la venta y un evento en `loopa_integration_events`. Un worker
   (Cloud Function, Fase 3) lo procesa con Admin SDK. Los navegadores nunca
   escriben tareas generadas.
2. **Núcleo puro y determinista** en `functions/production-plan/` de LOOPA-OS
   (CommonJS, sin dependencias, sin Firebase, sin DOM). Vive en `functions/` porque
   ahí correrá el worker cuando las Cloud Functions se muden a este repo (Fase 3).
   Hoy no hay `functions/index.js` ni `firebase.json`: nada es desplegable.
3. **Idempotencia por identidad derivada + precondición.** Cada tarjeta tiene un
   id de documento derivado de su clave de idempotencia y se crea con
   `create()` (falla si existe). El lease del evento evita trabajo doble, pero la
   corrección no depende de él.
4. **Unidad de trabajo como identidad del trabajo.** `workItemKey =
   H(saleId, lineId, templateId, ocurrencia)`. Una unidad nunca puede quedar en dos
   tarjetas (ver `relocated`).
5. **Snapshot congelado.** La línea de venta copia (no referencia) la plantilla
   operativa vigente. Editar el servicio sólo afecta ventas futuras.

## 3. Contratos (schemaVersion 1)

Implementados y validados en `functions/production-plan/contracts.js`.

### Venta (`loopa_sales/{id}`)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | Estable. Se rechaza un id igual al correlativo |
| `n` | entero | Correlativo visible; no participa de ninguna clave |
| `revision` | entero ≥ 1 | Sube con cada edición o cancelación |
| `status` | `draft` · `confirmed` · `cancelled` | Separado del avance de producción |
| `fecha`, `entrega` | `YYYY-MM-DD` / `''` | Días locales de Tegucigalpa; `entrega ≥ fecha` |
| `client` | `{ clientId, nombre, empresa }` | `clientId` = ficha única de cliente; nombre y empresa son el snapshot comercial |
| `lines[]` | ver abajo | 1–50 |
| `operations` | `{ status, taskIds, lastEventId, lastSuccessAt, lastError, pendingDiff, updatedAt }` | Escrito sólo por el worker. `status`: `ready` · `attention` · `resync_required` · `cancelled_review` · `not_applicable` |

### Línea de venta

`{ lineId (UUID), serviceId, quantity (>0), snapshot: { nombre, modelo, categoria, unidad, alcance, precio, costo }, executionPlan (copia congelada | null), executionTemplateVersion }`.
`executionTemplateVersion` debe coincidir con la versión congelada.

### Servicio y plantilla operativa (`executionPlan`)

```
{ schemaVersion: 1, enabled, version (≥1, inmutable una vez vendida),
  workspaceId | null (null = tablero de producción por defecto),
  grouping: { strategy: 'client_day_package' | 'separate', groupKey },
  templates: [{
    templateId (estable), label, title ({cliente} {servicio} {cantidad} {unidad} {ocurrencia} {ocurrencias} {venta} {fecha}),
    type, initialStatus, priority, tags[],
    quantityMode: 'ignore' | 'expand_checklist' | 'repeat_schedule',
    checklist: [{ itemId (estable), text, perUnit }],
    schedule: { sessionAnchor: 'sale_date'|'delivery_date', sessionOffsetDays,
                deadlineAnchor: 'delivery_date'|'session_date', deadlineOffsetDays },
    recurrence: null | { unit: 'day'|'week'|'month', interval, count }
  }] }
```

Un servicio sin `executionPlan` vende igual y produce una advertencia `line.no_plan`.

### Evento de integración (`loopa_integration_events/{eventId}`)

`{ schemaVersion, eventId = H(type, saleId, revision), type, saleId, saleRevision, occurredAt, sale }` + estado del outbox
`{ status: pending|processing|done|failed|needs_attention|rejected|superseded, attempts, leaseOwner, leaseUntil, lastError (saneado), result }`.
Tipos: `sale.confirmed`, `sale.updated`, `sale.cancelled`, `sale.resync_requested`.
El evento lleva la venta completa: el worker no relee un documento que pudo cambiar.

### Tarea FRAME generada (`frame_projects/{loopa_…}`)

Forma normalizada de FRAME más procedencia:

| Campo | Valor |
|---|---|
| `id` | `taskDocId(idempotencyKey)` |
| `client` / `clientId` | Nombre visible tomado de la ficha única (el tablero heredado de FRAME todavía filtra por nombre) + id estable |
| `sessionDate` / `deadline` | Calendario / compromiso (el más temprano del paquete) |
| `workspaceId`, `workspaceIds=[ws]`, `viewerIds` | `viewerIds` es el mismo conjunto de miembros del tablero, ordenado y sin duplicados (máx. 30, validado antes de escribir). La regla de alta del navegador compara la lista en orden, pero el worker escribe con Admin SDK; la regla de edición compara conjuntos |
| `clientVisible` | `false` (D5) |
| `sourceSystem` | `'loopa'` |
| `sourceSaleId`, `sourceSaleNumber`, `sourceSaleStatus` | Vínculo con la venta |
| `sourceLineIds`, `sourceEventId` | Líneas agrupadas; evento que la creó o actualizó |
| `sourceTemplateVersions` | `serviceId#templateId@version` (lista: una tarjeta puede agrupar varias plantillas) |
| `sourceWorkItems[]` | Cada unidad con su `deadline` propio |
| `idempotencyKey` | Clave del paquete |
| `integration.generatedFingerprint` | Huella del contenido generado: detecta si alguien la editó |

**Desviación respecto del encargo:** el encargo sugería `sourceTemplateVersion` (singular). Como una tarjeta puede agrupar varias plantillas, se usa la lista `sourceTemplateVersions` y el detalle en `sourceWorkItems`.

## 4. Identidades y claves

| Identidad | Derivación (SHA-256, espacio `loopa-frame/v1`) |
|---|---|
| Evento | `evt_` H(type, saleId, revision) |
| Unidad de trabajo | `wi_` H(saleId, lineId, templateId, ocurrencia) |
| Paquete `client_day_package` | `pkg_` H(saleId, workspaceId, clientId, sessionDate, groupKey) |
| Paquete `separate` | `pkg_` H(workItemKey) |
| Documento de tarea | `loopa_` H(idempotencyKey) |
| Ítem de checklist | `ck_` H(workItemKey, itemId, unidad) |
| Venta legacy | `sale_legacy_` H(`creado`) o semilla débil con advertencia |

## 5. Semántica de cambios

| Situación | Comportamiento implementado |
|---|---|
| Confirmar | Genera una vez. Mismo evento repetido = `already_done` |
| Reintentar tras fallo | El evento queda `failed` con `nextAttemptAt` (espera creciente). El reintento recalcula el mismo plan y crea sólo lo que falta. Tras `maxAttempts` (5) queda `dead`, terminal, y la venta en `attention` |
| Dos workers | Lease del evento con un token por invocación, más candado de la venta (`loopa_sales.lock`). Mientras el candado esté vigente (`leaseMs`), dos eventos de la misma venta no corren en paralelo: el segundo recibe `sale_busy` y queda `pending`, con `waitingUntil`. Si el candado vence a mitad de un trabajo, puede haber paralelismo, pero no duplicados: cada creación es una transacción con precondición. Sólo quien tiene el candado escribe `operations`, y el que perdió el lease no marca resultado |
| Retomar lo pendiente | `drainSale(saleId)` procesa en orden de revisión los eventos de la venta a los que les toca (`isDue`). El worker lo llama al terminar un evento, y el barrido programado de la Fase 3 usa la misma condición |
| En revisión humana | `needs_attention` no se reprocesa automáticamente (`awaiting_human`) ni consume intentos. Lo destraba un evento nuevo (edición o resync explícito) o `force` |
| Guardia de revisión | Cada escritura sobre tarjetas relee la venta en la misma transacción. Si la venta avanzó de revisión o se canceló, el evento se detiene como `superseded`: ninguna creación llega tarde |
| Editar venta no procesada | La nueva revisión emite su evento; el pendiente queda `superseded` |
| Editar venta procesada | Si sólo falta crear tarjetas (nada existente cambia), las crea. Si hay cualquier otro cambio, no escribe y deja `needs_attention` / `resync_required` con la diferencia |
| Resincronizar (explícito) | Crea faltantes. Actualiza sólo tarjetas intactas (`update_pristine`, verificado de nuevo en la transacción) y sólo si no pierden unidades. Deja `conflict_started`, `conflict_split`, `relocated` y `foreign` para decisión humana. Informa `orphaned` sin borrar |
| "Intacta" | Contenido igual a la huella generada **y** sin responsables, entregables, timeline ni comentarios. Incluye la subcolección `comments`, que se consulta antes de actualizar |
| Límites | Antes de expandir se calculan las unidades (máx. 400) y los ítems de checklist (máx. 3000) por venta, y el tamaño de la venta (máx. 200 KB, porque viaja dentro del evento) |
| Re-confirmar tras cancelar | Las tarjetas vuelven a `sourceSaleStatus: 'confirmed'` |
| Reprogramar en FRAME | `edited_same_plan`: se respeta; `deadline` no cambia |
| Cancelar | No borra ni cambia tareas; marca `sourceSaleStatus: 'cancelled'` y la venta queda `cancelled_review` |
| Confirmación + cancelación | Si la cancelación llega antes del claim, la confirmación queda `superseded` sin generar. Si llega a mitad, se detiene en la siguiente escritura. Lo ya creado se conserva y queda marcado cuando se procesa la cancelación |
| Quitar una línea que compartía tarjeta | `conflict_split`: la tarjeta no se reescribe y el resync no lo resuelve solo; requiere decisión humana (D6) |
| Cliente inexistente en la ficha única | Plan bloqueado (`client.unknown`), nunca se empareja por nombre. Al corregir la venta (nueva revisión) se genera |

## 6. Alternativas descartadas

- **Escrituras navegador → `frame_projects`:** sin atomicidad entre sistemas, con lógica duplicada, procedencia falsificable y riesgo de `set()` ciego.
- **Trigger sobre el documento de venta sin outbox:** no hay registro auditable de intentos ni un estado reintentable visible.
- **Ids aleatorios + consulta "¿ya existe?":** carrera entre la consulta y la escritura; duplica bajo concurrencia.
- **Una tarjeta por servicio o por entregable:** satura el calendario (va contra el objetivo de producto).
- **Guardar en la venta sólo el número de versión de la plantilla:** se rompe si el servicio se borra o se edita la versión; por eso se guarda el snapshot completo.

## 7. Riesgos abiertos

1. **Pérdida de ventas en LOOPA** por `set()` del documento agregado y por el correlativo calculado en el cliente. Lo resuelve Fase 1 (un documento por venta y contador transaccional).
2. **Escrituras completas del navegador en FRAME** (`handleToggleFavorite`, arrays del checklist). Mitigación: el worker sólo crea y, en un resync, actualiza dentro de una transacción con precondición. Falta endurecer el cliente y las reglas (Fase 3/4).
3. **Procedencia sin protección en reglas**: hoy un miembro podría editar `sourceSaleId` o `idempotencyKey`. Se necesitan reglas con `diff().affectedKeys()` y pruebas con emulador (Fase 3).
4. **Doble verdad de producción**: el `estado` de LOOPA frente al `status` de FRAME (D7).
5. **Membresía divergente** entre `tooned-os` y `frame-studio-3a18f` (refuerza la consolidación).
6. **Prueba 10 del encargo** (usuario inactivo o ajeno): no cubierta en Fase 0; requiere emulador de reglas.
7. **Vista previa en el navegador** (Fase 2): `ids.js` usa `node:crypto`. Hará falta un SHA-256 síncrono embebido o calcular la vista previa sin ids.
8. **Tarjetas `relocated` / `conflict_split`**: el contrato evita la duplicación y la pérdida de unidades, pero la acción "mover" (cambiar el día conservando la identidad) queda por diseñar (D6).
9. **Eventos sin worker**: un evento sólo avanza si alguien lo invoca. Hay tres casos:
   - `pending` tras `sale_busy`;
   - `failed` con `nextAttemptAt` cumplido;
   - `processing` con el lease vencido.

   `drainSale` e `isDue` ya existen. La Fase 3 debe llamar a `drainSale` al terminar cada evento y agregar un barrido programado con esa misma condición.
11. **El candado depende de que nadie pise la venta**: si LOOPA guarda `loopa_sales/{id}` con un `set()` completo, borra `lock` y `operations`. Regla obligatoria para la Fase 1/3: las escrituras de la app sobre la venta son `update`/merge, y las reglas niegan al navegador escribir `lock` y `operations`.
12. **Comentario en carrera con un resync**: la subcolección se consulta antes de la transacción de actualización, así que un comentario que entra en ese instante no se ve. Cerrarlo del todo requiere que FRAME mantenga un contador en la tarjeta o hacer la consulta dentro de la transacción (Admin SDK lo permite); queda para la Fase 3.
13. **El lease no se renueva**: `leaseMs` (2 min) debe superar el peor caso de una venta. Los límites de `estimateWork` lo acotan a milisegundos, y si se excediera, la corrección se sostiene igual por la precondición.
10. **Datos comerciales en el outbox**: `loopa_integration_events` guarda la venta completa (cliente, importes). Las reglas deben dejar esa colección sólo para el servidor (Fase 3).

### Revisión independiente (2026-11-09)

Hubo dos rondas de revisión adversarial. La segunda confirmó corregidos todos los hallazgos de la primera y reportó 4 medios y 3 bajos de vivacidad y documentación. Se corrigieron con pruebas `R2-*`, y lo no resoluble en esta fase quedó como riesgos 9 y 11–13.

Primera ronda: 3 hallazgos altos, 5 medios y 7 bajos, todos reproducidos. Se corrigieron todos menos los que quedaron como riesgos 9 y 10. Cada corrección tiene su prueba en `integracion/test/review-regressions.test.cjs`:

1. Cancelación perdida durante una creación.
2. Revisiones fuera de orden.
3. Pérdida de unidades al mover parte de un paquete.
4. Límites que se multiplicaban.
5. "Intacta" sin considerar responsables ni entregables.
6. Reintentos sin tope y fechas fuera de rango.
7. Edición que no completaba lo faltante.
8. Marca de cancelación sin limpiar.
9. Issues sin sanear.
10. Mismo `workerId` sin exclusión.
11. Claves del prototipo.
12. Id ajeno que tumbaba el evento.
13. Más de 30 miembros.
14. Fidelidad del almacén en memoria a Firestore.
15. Campos viejos en `operations`.

## 8. Decisiones que requieren aprobación

| # | Decisión | Por defecto en Fase 0 | Alternativa |
|---|---|---|---|
| D1 | Alcance de la agrupación | Dentro de una misma venta | Unir ventas distintas del mismo cliente y día (obliga a modificar tarjetas ya iniciadas) |
| D2 | ~~Cliente sin enlace~~ **Resuelta por la fusión**: ficha única de cliente. Queda un caso: venta con un `clientId` que no existe | Error bloqueante (`client.unknown`) | — |
| D3 | Ventas históricas | No generan trabajo (`not_applicable`) | Backfill de ventas abiertas |
| D4 | ~~Ubicación del núcleo~~ **Resuelta**: `functions/production-plan/` en LOOPA-OS | — | — |
| D5 | Portal del cliente | `clientVisible: false` | Visibles por defecto, como las tareas manuales |
| D6 | Cambio de fechas en una venta procesada | `relocated`: conflicto, no se crea | Acción "mover" que actualiza una tarjeta intacta |
| D7 | Estado de producción | FRAME es la fuente; LOOPA lo mostrará leído | Mantener `estado` editable en LOOPA |
| D8 | Moneda e importes en la tarjeta | No se copian (FRAME es producción) | Copiarlos como presupuesto |

## 9. Cómo verificar

```bash
node --test "integracion/test/*.test.cjs"
node integracion/simulate.cjs
node integracion/simulate.cjs --scenario editada-y-cancelada
node integracion/simulate.cjs --json
node integracion/simulate.cjs --migration
```

Mapa de pruebas a requisitos:

| Requisito | Prueba |
|---|---|
| Genera exactamente una vez | `idempotency › una venta confirmada genera trabajo exactamente una vez` |
| Concurrencia | `idempotency › dos ejecuciones simultáneas…` (con lease activo y con lease vencido), `confirmación y resincronización en carrera` |
| Fallo parcial | `idempotency › un fallo parcial queda visible y el reintento completa sin duplicar` |
| Agrupación mismo cliente y día | `planner › dos servicios del mismo cliente y día…` |
| No agrupar clientes ni fechas distintos | `planner › clientes o fechas distintos nunca se agrupan` |
| `deadline` estable | `planner › deadline es el compromiso…`, `idempotency › resync… respeta reprogramaciones` |
| Plan mensual | `planner › un plan mensual genera sólo las ocurrencias configuradas` |
| Cambio de plantilla | `planner › cambiar la plantilla del servicio no altera una venta histórica` |
| Cancelación | `idempotency › cancelar una venta no borra ni modifica el trabajo` (+ confirmación pendiente) |
| Datos inválidos | `dates-contracts › venta: datos inválidos…`, `plantilla: errores claros…`, `idempotency › evento inválido` |
| Migración o simulación repetida | `legacy-simulator › repetir la migración…`, `planner › repetir la simulación…`, `simulador… determinista` |
| Sin remoto | `legacy-simulator › sin remoto…` |
