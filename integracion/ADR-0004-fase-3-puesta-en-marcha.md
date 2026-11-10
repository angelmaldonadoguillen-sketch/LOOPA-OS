# ADR-0004 — Fase 3: puesta en marcha (plan y puntos de aprobación)

Estado: en curso. Fecha: 2026-11-09.

## 1. Qué cambia en la Fase 3

Hasta la Fase 2 todo corre en memoria o en el emulador local. La Fase 3 conecta la fusión al proyecto real **frame-studio-3a18f**:
- funciones del servidor;
- reglas;
- migración de los datos de LOOPA (hoy en el proyecto tooned-os);
- la app LOOPA leyendo y escribiendo en el modelo unificado.

## 2. Hallazgos que condicionan el plan

1. **FRAME ya publica funciones en frame-studio-3a18f** (`carryOverIncompleteTasks`, `purgeExpiredTrash`, portfolio…), desde su propio repo. Un `firebase deploy --only functions` desde LOOPA con la configuración por defecto **borraría las de FRAME**. Por eso las de LOOPA van en un *codebase* separado (`loopa`, en `firebase.json`) y se publican sólo con `--only functions:loopa`.
2. **LOOPA hoy inicia sesión en tooned-os.** En frame-studio-3a18f la entrada es la de FRAME: usuarios en `frame_users` aprobados por el admin de plataforma. Cada persona que usa LOOPA necesita una cuenta aprobada ahí. Quién ve ventas lo decide `loopa_config/access.commercialUids` (D15).
3. **Las reglas en borrador** (`integracion/reglas/firestore.rules.borrador`, ADR-0003 §11) exigen cambios de interfaz: duplicar, borrar y la papelera de tareas de venta, y conservar los campos del servidor al editar fichas. Mientras la app de FRAME siga en uso, esos flujos tienen que estar resueltos antes de publicar las reglas.

## 3. Tandas (todo local hasta los puntos de aprobación)

| Tanda | Qué | Toca lo real |
|---|---|---|
| 3.1 | Funciones del servidor: `createSale`/`updateSale`/`addPayment` (`onCall`, sólo para el equipo comercial aprobado), el worker del outbox (al crearse un evento) y el barrido programado. Probadas en memoria y en el emulador. | No |
| 3.2 | Capa de datos de LOOPA: leer ventas de `loopa_sales` (lector compatible) y escribir por las funciones, detrás de una bandera. | No |
| 3.3 | Producción con datos reales: `frame_projects` del tablero, con los cambios de interfaz que piden las reglas. | No |
| 3.4 | Ajustes en la app de FRAME (duplicar, borrar, papelera), si sigue en uso durante la transición. | No |

## 4. Puntos de aprobación (cada uno con un «sí» explícito)

- **A. Publicar** reglas y funciones (`codebase loopa`) en frame-studio-3a18f. Antes:
  - un respaldo de las reglas activas;
  - la lista de funciones de FRAME, para verificar que siguen después.
- **B. Respaldo y migración real.** Primero el respaldo archivado de `loopa/*` en tooned-os. Después la corrida en seco, la revisión de conflictos y la corrida real con LOOPA en sólo lectura (D10).
- **C. Encender la fusión** para el equipo: la bandera, y las cuentas y la lista comercial cargadas.
- **D. Push** de la rama y, si corresponde, publicar la app.

## 5. Datos que el servidor necesita (los carga el admin, nunca la app)

- `loopa_config/production`: `{ defaultWorkspaceId, allowedWorkspaceIds }`. Son los tableros donde la venta genera trabajo.
- `loopa_config/access`: `{ commercialUids }` (D15).
- `loopa_counters/sales`: el correlativo, que lo crea la migración.

## 6. Tanda 3.1 · Funciones del servidor (hecha)

- **Lógica** (`functions/loopa-server.js`), sin Firebase: se prueba en memoria y en el emulador.
  - `createSale`, `updateSale` y `addPayment` exigen una sesión, un usuario aprobado en `frame_users` y el uid en `commercialUids`: la misma condición que las reglas en borrador.
  - Responden sólo lo que la pantalla necesita (número, versión, evento).
  - Los errores del dominio salen con un código estable (`version_conflict`, `client_unknown`, `payment_conflict`…). Lo inesperado sale como `internal`, sin mensaje.
- **Contexto del planificador:** se lee del proyecto en cada evento:
  - `loopa_config/production`;
  - los tableros habilitados y sus miembros;
  - la ficha del cliente de la venta;
  - la fecha de hoy en Tegucigalpa.

  Sin configuración, el evento queda pendiente (no se pierde) y el barrido lo informa.
- **Worker y barrido:** cada evento nuevo se procesa al crearse y después se vacía la cola de su venta. Cada 5 minutos el barrido retoma lo pendiente, los reintentos y los leases vencidos.
- **Punto de entrada** (`functions/index.js`): es el único archivo que carga Firebase y sólo envuelve la lógica. `firebase.json` declara el codebase `loopa`. No hay `.firebaserc`: publicar exige elegir el proyecto a mano.
- **Verificación:**
  - 149 pruebas sin red y LOOPA 6/6;
  - 19/19 en el emulador, que incluye el flujo del servidor comparado documento por documento con la memoria;
  - `functions/index.js` cargado con `firebase-functions` 6.5.0 real: exporta las 5 funciones y convierte los errores en `HttpsError`.

**Revisión independiente de la tanda 3.1:** no aprobada tal como estaba. La autorización y el aislamiento del despliegue estaban bien. Todo lo que encontró está corregido, con prueba de regresión:

1. **Una venta podía quedar trabada sin tarjetas.** El worker vaciaba la cola de la venta con el contexto del PRIMER evento. Si se cambiaba el cliente antes de procesar, el evento nuevo se planificaba con el cliente viejo y quedaba `needs_attention` («cliente no migrado»).
   - Ahora cada evento se procesa con el contexto de SU venta.
   - El drenaje y el barrido viven en `loopa-server.js`.
2. **El evento que esperaba el candado tardaba hasta ~7 minutos** (2 de lease más 5 del barrido). Ahora, al soltar el candado, los pendientes de esa venta se toman enseguida; `claim()` vuelve a mirar el candado, así que es seguro.
3. **Se podía vender a una ficha de otro tablero.**
   - Ahora sólo se vende a fichas de los tableros habilitados en `loopa_config/production`, y la ficha ajena ya no queda marcada como «con ventas».
   - Inexistente y ajena dan el mismo error: la respuesta no revela qué ids existen.
   - Sin configuración no se vende (`config_missing`).
4. **Auditoría.** Queda registrado quién vendió (`createdBy`), quién cambió la venta (`updatedBy`, `estadoLog[].by`) y quién cobró (`abono.registradoPor`).
   - Lo pone sólo el servidor: un `registradoPor` enviado desde la app se ignora y no rompe la idempotencia del cobro.
   - `createdBy` y `updatedBy` no se pueden editar.
5. **Registro de fallas:**
   - lo inesperado en las funciones se registra saneado;
   - el barrido registra el error de cada venta;
   - sin configuración, el evento sigue pendiente con `lastError.code = config_missing` a la vista.
6. **Errores transitorios** (`unavailable`, `deadline-exceeded`, `resource-exhausted`): llegan a la app como `unavailable`, para que sepa que puede reintentar. Lo que el almacén rechaza llega como `invalid-argument`.
7. **El contexto trae las columnas y los tipos del tablero** (`frame_workspaces/{ws}/config/kanban_columns` y `project_types`, como FRAME): el planificador valida contra el tablero real.
8. **Despliegue:**
   - `functions/package-lock.json`;
   - `functions/node_modules` ignorado por git;
   - la lista `ignore` de `firebase.json` conserva los valores por defecto;
   - tiempos máximos: 300 s el trigger y 540 s el barrido;
   - el barrido atiende primero las ventas con el evento más viejo.
9. **Pruebas:** 10 mutaciones de la lógica del servidor hacen fallar la suite. Entre ellas están las 4 que antes pasaban inadvertidas: sin drenaje, barrido sin leases vencidos, error de cobro sin mapear y «hoy» del reloj real.

**Queda abierto (decisión de producto, no bloquea):**
- crear una venta con cobros que superan el total;
- bajar el total por debajo de lo ya cobrado;
- campos extra dentro de un cobro.

Se documenta para la tanda 3.2 (la pantalla de cobros).

**Verificación:** 158 pruebas sin red, LOOPA 6/6 y 19/19 en el emulador.

## 7. Punto A: lo que hay que confirmar en el proyecto real antes de publicar

Sólo lectura, con aprobación:

1. **Ubicación de la base de datos.** Un trigger de Firestore v2 en `us-central1` necesita una base compatible (nam5 o us-central1). FRAME no tiene triggers de Firestore con los que comparar.
2. **Invocación de las funciones `onCall`.** La función `reservePortfolioAsset` de FRAME responde 403 (`FIREBASE-PENDIENTE.md` §1). Las de LOOPA probablemente necesitan el permiso `run.invoker` para `allUsers`. Puede haber una política de la organización que lo bloquee.
3. **Reglas activas.** Confirmar que hoy niegan escribir `loopa_config` y `frame_users.status` desde el navegador: los controles del servidor se apoyan en eso.
4. **Respaldo** de las reglas activas, y la lista de funciones de FRAME para verificar que siguen después de publicar.
