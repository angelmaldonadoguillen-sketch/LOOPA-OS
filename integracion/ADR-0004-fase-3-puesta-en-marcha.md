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
| 3.3 | Pantallas de LOOPA conectadas al modelo nuevo detrás de `?datos=fusion`, con cola persistente de cambios; probadas con un servidor local (§9). | No |
| 3.4 | Conexión al proyecto: lecturas con el SDK (bajo las reglas) y llamadas `httpsCallable`, probadas con los emuladores de Firestore + Functions + Auth. | No |
| 3.5 | Producción con datos reales: `frame_projects` del tablero, con los cambios de interfaz que piden las reglas. | No |
| 3.6 | Ajustes en la app de FRAME (duplicar, borrar, papelera), si sigue en uso durante la transición. | No |

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

## 8. Tanda 3.2 · Servidor para las pantallas de LOOPA y traductor del navegador (hecha)

- **Hueco de seguridad cerrado.** `createSale` aceptaba las líneas tal como llegaban del navegador, incluida la plantilla de producción. Ahora el servidor arma cada línea desde el catálogo (`loopa_services`) y del navegador sólo toma servicio, cantidad, precio y costo.
  - Al editar, una línea existente conserva lo que se vendió (su snapshot y su plantilla congelada); una línea nueva toma el catálogo vigente.
  - Un servicio inexistente o archivado no se vende.
- **Funciones nuevas:**
  - `loopaSaveClient`: alta con UUID del navegador en el tablero por defecto, o edición parcial de lo comercial de una ficha habilitada.
  - `loopaSaveService`: lo comercial del servicio; la plantilla nunca viaja desde LOOPA.
  - `loopaRemovePayment`: anula un cobro.
- **Decisiones (por defecto):**
  - **D16 · «Eliminar venta» cancela.** Nada se borra y su trabajo de producción queda marcado, no desaparece.
  - **D17 · El avance de LOOPA** (pendiente, en proceso, revisión, entregado) queda como dato comercial transitorio (`legacyProductionState`): no genera eventos ni toca producción, que lleva FRAME. «Cancelado» es cambiar el estado de la venta. Reconfirmar desde cancelado vuelve con el avance elegido.
  - **D18 · Anular un cobro, no borrarlo.** Pasa a `abonosAnulados` con quién, cuándo y el motivo; deja de sumar, y su id no se reutiliza.
- **Traductor del navegador** (`_fuente/datos/fusion.js`): es puro y se prueba con Node.
  - Lee los documentos del modelo nuevo con la forma que ya usan las pantallas, con paridad con el lector de la migración. Agrega la versión del documento (para no pisar ediciones ajenas) y el estado de producción.
  - Traduce cada acción de las pantallas a llamadas al servidor: nueva venta (cliente y venta), cambios de estado, líneas, fechas, nota, pago, anular un cobro, «eliminar», servicio y cliente.
  - Al vender a una ficha existente, los campos vacíos no borran sus datos.
  - Todavía no está conectado a la app: eso es la tanda 3.3.
- **Reglas en borrador:** el catálogo lo lee el equipo comercial y nadie lo escribe desde el navegador. La auditoría de las fichas (`createdBy`, `updatedBy`, `createdAt`) es sólo del servidor.
- **Verificación:** 172 pruebas sin red, LOOPA 6/6 y 21/21 en el emulador (11 del almacén y el servidor, 10 de reglas).

**Revisión independiente de la tanda 3.2:** no lista para el commit tal como estaba. La corrección principal funcionaba: una plantilla falsificada, campos de línea de más o `__proto__` se rechazaban. Todo lo que encontró está corregido, con prueba:

1. **Las reglas en borrador rechazaban el «Nuevo cliente» de FRAME,** que crea sus fichas con `createdAt`.
   - Ahora `createdAt` se acepta al crear y después no cambia. El autor (`createdBy`, `updatedBy`) sólo lo pone el servidor.
   - Hay una prueba con la forma exacta de FRAME (crear y editar con `set` completo).
2. **El registro de cobros anulados (D18) se podía falsificar o borrar desde la app,** y los cobros cargados al vender no tenían autor.
   - Ahora `commercial` acepta una lista cerrada de campos al crear y al editar: `abonosAnulados` nunca viene de la app.
   - Cada cobro tiene forma fija (id, fecha, monto, método).
   - El autor de los cobros iniciales lo pone el servidor; el que mande la app se descarta.
3. **Una venta migrada con una línea fuera del catálogo no se podía editar.** Ahora esa línea conserva su servicio marcador y se edita su cantidad o precio. Una línea NUEVA sin catálogo se rechaza, y el id marcador no se puede crear como servicio.
4. **Se perdía el avance elegido al vender.** Ahora viaja en la venta nueva y se valida.
5. **Se perdía la descripción editada por línea** (el alcance acordado). Ahora se guarda al vender y al editar; la plantilla no cambia.
6. **Un acuerdo especial se podía vender a cualquier cliente.** Ahora el servidor exige que sea el suyo.
7. **Reintentar varias llamadas era inseguro:** repetir un cambio ya hecho daba `version_conflict`. Ahora `ejecutarOperaciones` recuerda cuántas se confirmaron, y reintentar con las mismas operaciones retoma desde la que falló.
8. **Historial.** Los cambios de avance quedan en `estadoLog` con su autor, y reconfirmar muestra el avance elegido.
9. **Un error revelaba si un id de cliente existía.** Ahora un id viejo inexistente da el mismo error que uno ajeno.
10. **La cantidad debe ser entera** (1 a 1000) desde que se vende, no recién en el worker.
11. **Pruebas:** 17 mutaciones de la tanda hacen fallar la suite. Entre ellas están las 5 que antes pasaban:
    - conservar la línea vieja al cambiar de servicio;
    - anular un cobro sin idempotencia;
    - anular sin subir la versión;
    - pisar el nombre de la ficha;
    - perder la fecha de alta.

**Requisitos para la tanda 3.3 (conectar las pantallas):**
- Guardar la lista de operaciones y su progreso, y reintentar con ellos (no armar operaciones nuevas, que generarían ids nuevos).
- Un servicio creado en medio de una venta se guarda antes (`loopaSaveService`) de crear la venta.
- La pantalla muestra el número de venta que devuelve el servidor, no el que calculaba LOOPA.

**Verificación:** 182 pruebas sin red, LOOPA 6/6 y 22/22 en el emulador, en dos corridas.


## 9. Tanda 3.3 · Pantallas de LOOPA sobre el modelo nuevo (hecha)

Con `?datos=fusion`, las ventas, los clientes y los servicios salen del modelo nuevo y todo cambio pasa por el servidor. Sin la bandera, LOOPA funciona como siempre. Por ahora la bandera sólo funciona con el **servidor local** (`127.0.0.1`), que corre la misma lógica del servidor sobre datos de ejemplo en memoria. La conexión al proyecto real queda para la 3.4.

**Piezas:**
- `_fuente/datos/fuente.js` (puro, probado con Node):
  - `armarDatos`: pasa los documentos a la forma que usan las pantallas.
  - `crearCola`: cola **persistente** de cambios. Cada acción se guarda como una lista fija de operaciones con su progreso, y se manda en orden. Si algo falla, la cola se detiene ahí, sobrevive a recargar la página y se reintenta con las mismas operaciones.
    - El almacén (localStorage) es la fuente de verdad: dos pestañas comparten la cola.
    - Un candado (`navigator.locks`) hace que la ejecute una sola pestaña a la vez.
  - `normalizarError`: separa lo que se reintenta solo (sin red, servidor ocupado, contención) de lo que no (conflicto, permiso, dato inválido).
  - `adaptadorHttp`: habla con el servidor local con el mismo contrato que una función `onCall`.
- `integracion/servidor-local/servidor.cjs`: servidor de prueba.
  - Sólo acepta pedidos desde este equipo: `Host` local y JSON declarado.
  - Arranca con el respaldo sintético migrado y el catálogo de ejemplo.
  - Simula el disparador: cada venta genera su trabajo de producción.
  - `POST /api/fallar` simula cortes de red.
- `_fuente/app.jsx`, detrás de `DATOS_FUSION`:
  - la carga y las acciones de las pantallas van por la cola;
  - las ventas se identifican por id (`claveVenta`), porque dos ventas migradas pueden compartir el número visible;
  - un aviso en la barra muestra «Guardando N…», «Sin guardar», «No se guardó» o «Cola sin respaldo», con «Reintentar» y «Descartar…». Se reintenta solo cada 15 s, hasta 5 veces seguidas, y al volver la red.

**Requisitos de la §8 cumplidos:**
- Las operaciones se guardan con su progreso y se reintentan tal cual.
- Un servicio creado a mitad de una venta se encola antes que la venta.
- La pantalla muestra el número que devuelve el servidor. Mientras tanto dice «Guardando venta…», y al confirmarse la venta entra a la lista con su número.

**Decisiones:**
- **D19. Idempotencia por operación y cadena de versiones.**
  - Cada cambio que sube la versión de una venta (`updateSale`, `addPayment`, `removePayment`) lleva un `opId`. El servidor guarda los últimos 30 en la venta (`appliedOps`, sólo del servidor). Si la respuesta se perdió y la app reintenta, contesta `existing` con el salto `from → to` que hizo esa operación, en vez de un conflicto falso o un cambio repetido.
  - La cola anota esos saltos con la **sesión** (carga de página) que los encoló. Una operación armada con la versión vieja sigue sólo saltos de su misma sesión, es decir, lo que su pantalla ya mostraba.
  - Un cambio de otra persona, de otra pestaña o de antes de recargar no está en esa cadena: da `version_conflict`, y nunca se pisa en silencio.
- **D20. Con la fusión, nada se borra desde LOOPA.**
  - «Eliminar venta» la cancela (D16), y «Deshacer» la reactiva.
  - Un servicio «eliminado» queda inactivo.
  - Un cliente no se borra.
  - Restaurar un respaldo no está disponible.
- **D21. Configuración y gastos** quedan en este navegador (`loopa-fusion-*`), nunca en la colección `loopa`, hasta que tengan funciones del servidor.
- La pantalla de la venta muestra el estado de producción. Al vender sin fecha de entrega, se avisa que el trabajo que se programa desde esa fecha queda esperando.

**Revisión independiente de la tanda 3.3:** encontró 11 problemas confirmados. Todos están corregidos, con prueba:

1. **Si se perdía la respuesta de un cambio**, el reintento daba un conflicto falso. Eso trababa la cola, y descartar perdía el resto de la acción. Ahora hay `opId` (D19).
2. **Si se perdía la respuesta de un cobro o de una anulación**, el cambio siguiente sobre la venta daba un conflicto falso. Ahora el servidor devuelve el salto `from → to` y la cadena lo anota.
3. **Un error permanente tomado como transitorio trababa la cola para siempre.** Por ejemplo, un cuerpo enorme que cortaba la conexión, o un error de programación tomado por «sin red».
   - Ahora «Descartar» está siempre disponible y los reintentos automáticos tienen tope.
   - El servidor local responde 413 en vez de cortar la conexión.
   - Sólo un error de red es «sin red».
4. **Dos pestañas se pisaban la cola** y podían ejecutar dos veces. Ahora el almacén es la fuente de verdad y hay un candado entre pestañas. (Al probarlo apareció otro caso: una pestaña podaba los saltos de otra todavía abierta; ahora un salto se guarda 10 minutos aunque su sesión no tenga nada pendiente.)
5. **Después de recargar, un cambio nuevo podía pisar en silencio uno viejo que seguía pendiente.** Ahora la cadena es por sesión (D19).
6. **Dos ventas seguidas a un cliente nuevo creaban dos fichas.** Ahora el cliente entra a la lista al vender.
7. **Una lectura vieja podía pisar una más nueva** en la pantalla. Ahora cada lectura lleva un número de generación.
8. **«Abrir venta» desde Producción** buscaba por número. Ahora abre la venta si el número es único.
9. **Borrar en el modo de siempre** comparaba por número con una clave que podía ser id.
10. **«Descartar» podía tirar una entrada distinta** de la que la persona vio. Ahora descarta por id.
11. **El servidor local respondía a nombres del prototipo** (`/api/fn/constructor`).

También se corrigió:
- otro sitio abierto en el navegador podía usar el servidor local;
- un aviso de pantalla que fallaba podía trabar la cola;
- si el navegador no deja guardar, ahora se avisa («Cola sin respaldo»);
- una fecha a medio escribir (año 0002) ya no se manda;
- el doble clic en «Registrar venta» ya no crea dos ventas;
- se corrigieron los textos de servicio desactivado y de dónde se guardan los datos.

**Queda para después:**
- Si la venta del servicio creado a mitad de la venta se descarta, la venta falla con «servicio no está en el catálogo» (visible; se descarta y se rehace).
- Los avisos de éxito de cobros y cambios son optimistas: un rechazo aparece después en la barra.
- Con la cola trabada, lo pendiente no se ve en las listas (sólo en el aviso).
- La nota abierta en la ficha no se refresca si otra persona la cambió (igual que antes).
- Producción con datos reales (3.5) debe abrir la venta por id (`sourceSaleId`).

**Pruebas:** 22 pruebas de la tanda (`integracion/test/fuente.test.cjs`). De 25 mutaciones del código nuevo, 24 hacen fallar la suite. La que sobrevive (sacar `appliedOps` de los campos sólo del servidor) es equivalente: la lista cerrada de campos editables ya la rechaza.

**Probado en el navegador (servidor local):**
- Venta nueva con un servicio creado a mitad de la venta.
- Venta a una clienta nueva con doble clic: una sola venta (#1006) y una sola ficha.
- Fecha de entrega cargada después: producción pasó de «necesita atención» a «1 tarea en el tablero».
- Conflicto con otra persona: aviso «No se guardó». Al descartar, la pantalla volvió a lo que tiene el servidor.
- Corte de red: aviso «Sin guardar»; el cambio sobrevivió a recargar la página y se guardó solo al volver la red.
- Sin la bandera, LOOPA guarda como siempre en este navegador.


## 10. Tanda 3.4 · Las pantallas con Firebase, en emuladores (hecha)

Con `?datos=fusion&servidor=emulador`, LOOPA usa Firebase tal cual: inicio de sesión (Auth), lecturas bajo las reglas en borrador (Firestore) y escrituras sólo por las funciones del codebase «loopa» (Functions). Por ahora sólo contra los **emuladores** de este equipo (proyecto `demo-loopa`, que no existe en la nube). Conectar el proyecto real es el punto A.

**Piezas:**
- `_fuente/datos/fuente.js` → `adaptadorFirebase`: recibe primitivas (leer un documento, una colección, consultar, invocar, escuchar). No importa el SDK: la app le pasa el compat y las pruebas el modular.
  - Lee `loopa_config/production` y, con eso, las fichas **por tablero de producción**: nunca toda la colección, que las reglas no dejan leer.
  - Lee ventas y catálogo.
  - Escucha las ventas en vivo: lo que hace el disparador (producción) y los cambios de otras personas aparecen sin recargar.
  - Escribe sólo llamando a las funciones.
- `_fuente/app.jsx`:
  - una app de Firebase **aparte** (`loopa-fusion`, demo), conectada a los emuladores antes de usarse;
  - inicio de sesión con el Auth del emulador;
  - cola por modo y por persona;
  - la pantalla se rearma al cambiar de persona.
- `integracion/emulador/`:
  - `correr.cjs --funciones` corre `funciones.test.cjs` con Auth + Firestore + Functions;
  - `arrancar-fusion.cjs` deja todo levantado para el navegador (`http://127.0.0.1:8791/?datos=fusion&servidor=emulador&produccion=demo`);
  - `siembra.cjs` carga los datos de ejemplo y las cuentas de prueba, que existen sólo en el emulador;
  - `entorno.cjs` arma el entorno de Java compartido.
- `firebase.emulador.json` (raíz): configuración SÓLO para emuladores. Apunta a las reglas en borrador y al codebase «loopa». El `firebase.json` de publicación no cambió.
- Reglas en borrador: el equipo comercial puede leer `loopa_config/production` (sólo ids de tableros).

**Requisito nuevo para el punto C:** las personas del equipo comercial deben ser **miembros** de los tableros de producción. Las reglas sólo dejan leer las fichas de cliente de los tableros propios.

**Probado:**
- `funciones.test.cjs`: 5 pruebas contra los emuladores.
  - Lectura bajo las reglas.
  - Quien no es comercial, o no inició sesión, no lee ni vende.
  - Venta por la cola → funciones → disparador → tarjetas, y la venta en vivo con su producción lista.
  - Cambio, cobro, nota con respuesta perdida y conflicto.
  - La app no escribe ventas ni catálogo directo.
- Navegador (emulador):
  - inicio de sesión con la cuenta de prueba;
  - venta nueva (el servidor asignó el #1006);
  - la ficha pasó sola de «en preparación» a «1 tarea en el tablero».

**Revisión independiente de la tanda 3.4:** 5 problemas confirmados y varios riesgos. Todo está corregido, con prueba:

1. **Las ventas en vivo cancelaban la recarga completa,** y un cliente o servicio descartado podía quedar en pantalla. Ahora hay contadores separados: la escucha sólo compite con las ventas.
2. **Al volver a iniciar sesión, la cola seguía trabada en «Tu sesión se cerró».** Ahora, con sesión, lo que falló por falta de sesión se reintenta solo. Antes de cerrar sesión con cambios sin enviar, se avisa.
3. **`arrancar-fusion.cjs` podía dejar emuladores huérfanos.** Ahora revisa que los puertos estén libres antes de arrancar y se apaga ordenado ante cualquier error. En Linux y Mac baja todo el grupo de procesos.
4. **Con `?servidor=emulador` sin el SDK (sin red), la app volvía en silencio a la de siempre,** que puede ser la nube real. Ahora `?datos=fusion` nunca cae a la app de siempre: si no se puede, muestra un aviso. Además, con la bandera la app de Firebase de siempre ni se inicia.
5. **La cola que quedó de la 3.3** (otra clave) se pasa a la nueva.

Riesgos corregidos:
- Cada llamada sale sólo con la sesión dueña de la cola, y la cola se detiene al cambiar de persona. El candado es por persona.
- Si la persona no es miembro de un tablero de producción: «Tu cuenta no es miembro de un tablero de producción», en vez de un «sin permiso» vago. Los tableros repetidos se consultan una vez. Una lista vacía da `config_missing`.
- `firebase.emulador.json` tiene una guarda: publicar con esa configuración en un proyecto que no sea `demo-*` se detiene antes de tocar nada (probado).
- `loopa_config/production` tiene forma cerrada en las reglas en borrador, porque la lee el equipo comercial.
- Si la escucha en vivo se cae, se reintenta a los 30 s.
- Si llega en vivo una venta de un cliente o servicio desconocido, se recarga todo.

**Queda para después:**
- Al arrancar, las ventas se leen dos veces: la carga y la primera escucha.
- Configuración y gastos (`loopa-fusion-*`) se comparten entre personas en el mismo navegador, hasta que tengan funciones del servidor.
- El SDK de Functions se carga también en la app publicada. Es inofensivo, pero sobra hasta el punto A.

**Pruebas:**
- `funciones.test.cjs`: 7 pruebas con Firebase emulado.
- Pruebas de la tanda: 26 en `fuente.test.cjs`.
- Suites generales: 208 sin red, 22 en el emulador de siempre y LOOPA 6/6.
- Navegador: sólo existe la app de Firebase de la fusión (la de siempre no se inició). Cambio de estado guardado, con la cola por persona.
