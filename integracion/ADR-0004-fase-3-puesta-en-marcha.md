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
| 3.5 | Producción con datos reales: `frame_projects` del tablero, en vivo y bajo las reglas (§11). | No |
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


## 11. Tanda 3.5 · Producción con las tareas del tablero (hecha)

Con `?datos=fusion&servidor=emulador&produccion=1`, el módulo Producción muestra y edita las **tareas reales del tablero de producción** (`frame_projects`), las mismas que usa FRAME, bajo las reglas en borrador. Por ahora sólo en los emuladores. Con `?produccion=demo` sigue mostrando los datos de ejemplo, sin guardar.

**Piezas:**
- `_fuente/produccion/datos-reales.js` (puro, probado con Node):
  - arma los datos del módulo desde los documentos de FRAME: tablero, columnas (`config/kanban_columns`), rutina (`config/daily_routine`), equipo y fichas;
  - junta las tareas del tablero con las compartidas que lo incluyen, como FRAME;
  - `parcheTarea`: al cambiar una tarea viajan sólo los campos editables que cambiaron (como `handleUpdateProject` de FRAME), nunca procedencia ni ids;
  - `parcheEnlace`: pone el `clientId` una sola vez;
  - «hoy» es la fecha local de America/Tegucigalpa.
- `calendario.jsx` → `useFuenteTablero`:
  - escucha las tareas en vivo (por tablero y compartidas);
  - valida cada cambio con el núcleo (`applyTaskPatch`: checklist para cerrar, entrega fija en tareas de venta, campos conocidos) y escribe `update` ya;
  - Firestore muestra el cambio al instante y, si las reglas lo rechazan, lo revierte y se avisa.
  - Es el único lugar del módulo que habla con Firestore, y sólo con `update` de una tarea (lo vigila `produccion-modulo.test.cjs`).
- Las tareas de venta enlazan a su venta por id: `#n` abre esa venta aunque dos compartan número.
- Al vender, cada servicio sin plantilla de producción muestra «sin producción».

**Por ahora desde FRAME** (en LOOPA se ven, con aviso):
- editar la rutina del día;
- publicar el portal del cliente.

**Observación sobre las reglas de FRAME (v2, también en el borrador):** la consulta de tareas compartidas (`viewerIds array-contains`) se rechaza. FRAME ya la ignora («lo normal mientras las reglas nuevas no estén publicadas») y LOOPA hace lo mismo: las tareas entran por el tablero.

**Probado:**
- `produccion-real.test.cjs` (7 pruebas): hoy en Tegucigalpa, mezcla de tareas, columnas, equipo, parches.
- `funciones.test.cjs`, 2 pruebas nuevas en el emulador (9 en total):
  - leer el tablero bajo las reglas;
  - mover, checklist y enlazar se guardan;
  - la entrega y la procedencia de una tarea de venta no se cambian, y la tarea no se borra.
- Navegador (emulador):
  - el tablero real con su nombre y la fecha de hoy;
  - mover una tarjeta queda guardado al recargar;
  - una venta nueva (#1007) aparece sola en Producción, con su entrega;
  - `#1007` abre esa venta.

**Revisión independiente de la tanda 3.5:** 4 problemas confirmados y varios riesgos. Todo está corregido, con prueba:

1. **Columnas con indicadores en `false`.** FRAME guarda `isDone: false` y `requiresChecklist: false` explícitos, y LOOPA los descartaba. El núcleo caía entonces al valor por omisión de «delivered»: LOOPA pedía checklist completo donde FRAME no, y contaba como cerradas tareas que FRAME ve abiertas. Ahora los indicadores se copian tal cual.
2. **Fechas a medio escribir.** El campo de fecha manda cada tecla del año (0002, 0020…) y eso se guardaba en el tablero compartido. Ahora sólo viaja una fecha completa entre 2000 y 2100.
3. **Si se caía la escucha del tablero,** el aviso decía «no aceptó el cambio» y la pantalla quedaba congelada con datos viejos, desde los que se podía seguir editando. Ahora se avisa que se perdió la conexión y la edición se frena hasta recargar.
4. **Los errores de acceso salían en inglés** («Missing or insufficient permissions»). Ahora cada lectura tiene su motivo: sin acceso a Producción, no es miembro del tablero, falta configuración.

Riesgos corregidos:
- **Enlazar:** sólo se ofrece si las reglas lo aceptarían, es decir, si la tarea nunca tuvo el campo de ficha y es del tablero.
- **Historial:** cada cambio deja su evento en `activity` con el mismo texto que FRAME.
- **Datos en vivo:** las fichas se escuchan en vivo, «hoy» cambia a medianoche (Tegucigalpa) y el tablero no se muestra vacío antes de la primera lectura.
- **Columnas:** si no se pueden leer, se avisa; ya no se usan las de FRAME en silencio.
- **«Hoy»** se arma pieza por pieza: no depende de cómo formatee el navegador.
- **Equipo:** se toma de las tarjetas de miembro del tablero, como FRAME.
- **Personas de producción que no son del equipo comercial** ahora pueden usar Producción: las reglas en borrador les dejan leer qué tablero es el de producción. Las ventas siguen siendo del equipo comercial (probado).
- **Prueba de pureza más estricta:** abarca todos los archivos del módulo, prohíbe lotes, transacciones y borrados, y fija las colecciones que se leen. Se escriben exactamente dos cosas: la tarea y su evento.

**Encontrado al probar en el navegador (corregido):**
- Las tareas compartidas llegaban primero desde la caché del SDK y después las rechazaban las reglas. Esa foto vieja quedaba y, al mezclar, pisaba las tareas en vivo: un movimiento se guardaba pero la pantalla no lo mostraba. Ahora, al rechazarse, se vacían.
- **FRAME tiene el mismo patrón** (`app.jsx`, consulta `viewerIds`): conviene revisarlo cuando se publiquen las reglas.

**Pruebas:**
- `produccion-real.test.cjs`: 12 pruebas. De 11 mutaciones, las 11 hacen fallar la suite.
- `funciones.test.cjs`: 11 pruebas con Firebase emulado.
- Suites generales: 220 sin red, 22 en el emulador de siempre y LOOPA 6/6.
- Navegador:
  - el cambio se ve al instante;
  - la fecha «0002» no se guarda y se avisa;
  - una venta aparece sola en Producción;
  - `#n` abre la venta.

**Queda para después:**
- Editar la rutina y publicar el portal desde LOOPA.
- Dos marcas seguidas del checklist, más rápidas que la respuesta, se pisan entre sí: es el mismo comportamiento de FRAME.

## 12. Tanda 3.6 · FRAME convive con las ventas de LOOPA (hecha, en una rama local de FRAME)

FRAME sigue en uso durante la transición, así que necesita respetar lo que las reglas nuevas protegen (ADR-0003 §11, «Cambios que la interfaz necesita»).

**Dónde está:** repo de FRAME, rama local `fusion/reglas-loopa` (sale de `main`; **sin push**). `main` se publica en GitHub Pages, así que mezclarla es parte del punto A, con aprobación.

**Qué cambia en FRAME:**
- `loopa-fusion.js` (nuevo, puro, con su prueba `loopa-fusion.test.js`): `isFromSale`, `withoutProvenance`, `duplicateOf`, `restorableFromTrash`, `clientHasSales`, `clientUpdatePatch` y `clientRemovedKeys`.
- **Borrar:**
  - una tarea de venta no se borra, se archiva (D14), y el detalle no ofrece «Eliminar»;
  - una tarea manual va a la papelera y se borra en **un solo lote**: si el borrado falla, no queda una copia fantasma;
  - un borrado rechazado se avisa.
- **Restaurar:**
  - una tarea de venta no se restaura;
  - si la ficha ya no existe, la tarea vuelve sin ficha;
  - una copia vieja de la papelera no pisa una tarea que sigue viva;
  - «Restaurar todo» dice el motivo.
- **Duplicar:** la copia es manual, sin procedencia ni la etiqueta `loopa`, y sin ficha si la ficha no es del tablero destino.
- **Fichas:**
  - editar usa `update` sólo con lo que cambió (lo que la pantalla quitó se borra a propósito), así que lo comercial que escribe LOOPA queda intacto aunque la copia en pantalla esté vieja;
  - una ficha con ventas de LOOPA (alcanza con que exista la clave, como en la regla) no se borra;
  - el portal se desactiva sólo después de un borrado exitoso, y publicarlo actualiza sólo token y estado.
- **Favorito:** sólo ese campo, nunca un `set()` completo.
- **Entrega de una tarea de venta:** sólo lectura, en la tarjeta y en el detalle («La fija la venta en LOOPA»).
- Si falta `loopa-fusion.js` (caché, archivo sin subir), no se escribe nada a medias y se avisa. `app.jsx?v` cambió.
- Todo esto funciona también con las reglas activas de hoy: FRAME se puede publicar antes que las reglas nuevas.

**Orden de la puesta en marcha (punto A):** primero FRAME con estos cambios. Después, cuando las cachés ya se hayan renovado, las reglas nuevas. Una pestaña vieja de FRAME podría dejar copias en la papelera de tareas de venta, pero no se pueden restaurar.

**Pruebas:**
- FRAME: `loopa-fusion.test.js` y las 21 pruebas de FRAME pasan. Se verificó en el navegador que FRAME compila y carga el módulo (sin iniciar sesión).
- LOOPA, `reglas.test.cjs`, 5 pruebas nuevas (16 en total). Escriben con las mismas funciones de FRAME contra el borrador:
  - borrar en lote, sin fantasma;
  - duplicar una tarea de venta;
  - restaurar con ficha y sin ficha;
  - editar una ficha con los campos de `stampWs`;
  - portal, favorito.
  - Se saltean sin el repo de FRAME; con `REQUIRE_FRAME=1`, fallan.

**Revisión independiente de la tanda 3.6:** 3 problemas confirmados y varios riesgos. Todo está corregido, con prueba:
1. Sin `loopa-fusion.js`, duplicar y editar fichas fallaban en silencio. Ahora hay una guarda en cada camino.
2. La entrega de una tarea de venta se podía «editar» en FRAME y las reglas la revertían con un mensaje vago. Ahora es sólo lectura.
3. `clientHasSales` no coincidía con la regla (con valores vacíos). Ahora mira si la clave existe, y el portal ya no se apaga antes de saber si el borrado se hizo.

También se corrigió:
- verificar la ficha al restaurar sin red;
- no pisar una tarea viva desde la papelera;
- favorito con `update`;
- avisar los errores al borrar;
- `merge` al guardar una ficha que no está en pantalla;
- pruebas más fieles a FRAME.

**Queda para después:** las tarjetas de las vistas todavía muestran «Eliminar» en tareas de venta (al confirmar, se archiva con aviso).

## 13. Punto A preparado (nada ejecutado)

El paso a paso está en `integracion/puesta-en-marcha/PUNTO-A.md`. Cada paso 🔒 lleva su propio «sí».

**Orden:**
1. A0: chequeos de sólo lectura y respaldo.
2. A1: publicar FRAME.
3. A2: funciones `loopa`.
4. A3: invocación de las callables, si hace falta.
5. A4: reglas, cuando el equipo ya recargó FRAME.

**Hallazgo: el archivo de reglas tiene que ser uno solo.** Las reglas activas se publican desde el repo de FRAME (`firebase.json` → `firestore.rules.v2`). Si las de la fusión se publicaran desde LOOPA, el próximo deploy de reglas de FRAME las revertiría sin aviso. Por eso:
- `integracion/puesta-en-marcha/reglas-para-frame.cjs` genera `firestore.rules.v2` de FRAME desde el borrador probado. Vuelve el encabezado de FRAME («Se publican con…») y se agrega de dónde sale lo de LOOPA. Las reglas no cambian.
- El archivo queda en la rama `fusion/reglas-loopa` de FRAME y se publica desde allí (A4).
- `firebase.json` de LOOPA sigue publicando sólo `functions:loopa`.
- `loopa-fusion.test.js` de FRAME verifica que su archivo de reglas tiene lo de LOOPA. Las 22 pruebas de FRAME pasan con las reglas nuevas.

**Chequeos** (`chequeo-a.cjs`, lógica pura en `punto-a.cjs`):
- **Sin flags, sólo esta PC:**
  - `firebase.json` publica sólo el codebase `loopa`;
  - no hay `.firebaserc`;
  - las dependencias están instaladas;
  - las reglas de FRAME son el borrador;
  - la rama y git están limpios.
- **Con `--leer-proyecto`** (A0, con aprobación), lee el proyecto:
  - la ubicación de la base;
  - las releases y los rulesets activos, como respaldo;
  - las funciones v2 con su codebase;
  - el IAM de Cloud Run de la callable de FRAME y de las de LOOPA;
  - el proyecto y la política de dominios, si hay organización.
  - Lo evalúa contra §7 y guarda todo en `respaldo/` (fuera de git).
- **La red pasa por una sola puerta** (`permitido`): sólo GET, https a `*.googleapis.com` y la ruta de `projects/frame-studio-3a18f`.
- Usa el token de la sesión del Firebase CLI. No lo imprime ni lo guarda.

**§7.3 en el emulador:** `integracion/emulador/reglas-activas.test.cjs`.
- Comprueba que el navegador no puede escribir `loopa_config` ni aprobarse o hacerse admin. Lo hace contra el borrador y, con `LOOPA_REGLAS_ACTIVAS`, contra las reglas respaldadas.
- Se validó en las dos direcciones: pasa con `firestore.rules.v2` de FRAME `main` y falla con reglas abiertas.

**Pruebas:** `integracion/test/puesta-en-marcha.test.cjs`, 17 pruebas sin red.

**Revisión independiente del punto A:** 3 problemas graves y 4 medios. Todo está corregido, con prueba:
1. **El chequeo de A3 y A4 bloqueaba siempre.** Después de A1, `main` ya tiene la fusión, así que comparar las reglas activas con `main` daba ✖. Ahora se comparan con la historia del archivo en FRAME: tienen que ser la última versión anterior a la fusión.
2. **Las reglas nuevas de FRAME no estaban en un commit** y el chequeo leía el árbol de trabajo. Ahora:
   - el chequeo lee las reglas de `HEAD`;
   - un repo con cambios sin commit da ✖, porque se publica desde el árbol de trabajo;
   - las reglas ya están en un commit de la rama de FRAME.
3. **A1 hacía push aunque fallaran las pruebas**, y fusionaba un `main` local quizás viejo. Ahora:
   - el push va después de `&&` sobre las pruebas, que también incluyen la `.cjs` de contrato;
   - antes se verifica `origin/main` con `merge-base --is-ancestor`.
4. **Prueba de reglas activas:** además verifica que el navegador no crea eventos, ventas ni el correlativo (rigen entre A2 y A4, con el worker ya publicado), y que nadie se registra con `platformAdmin`.
5. **Una lectura fallida** de la política o del proyecto ya no cuenta como «sin restricción»: da aviso.
6. **`permitido` está anclado a la ruta cruda:**
   - `^/vN/projects/frame-studio-3a18f`;
   - sin `%`;
   - sólo las 6 APIs que se leen;
   - en la consulta, sólo `pageSize` y `pageToken`.
7. **Robustez:**
   - cada lectura falla por separado;
   - las releases y las funciones se leen con todas sus páginas;
   - una región sin respuesta da ✖;
   - el respaldo lleva segundos en el nombre y nunca se pisa.

La revisión también confirmó:
- `--only functions:loopa` no toca las funciones de FRAME;
- las formas de las APIs son correctas;
- el token no se imprime;
- no hacen falta índices.

## 14. A0 hecho (2026-11-10, sólo lectura)

Corrido con aprobación («Sí, corré A0»). El respaldo está en `integracion/puesta-en-marcha/respaldo/2026-11-10-101612/`, fuera de git: reglas de Firestore y de Storage, releases, funciones e informe.

**Lo que se encontró:**
- **Base de datos:** está en `us-central1`, así que el trigger sirve tal como está.
- **Funciones de FRAME:**
  - son 6: `accountPortfolioAsset`, `carryOverIncompleteTasks`, `purgeExpiredTrash`, `releaseExpiredPortfolioReservations`, `releasePortfolioAsset` y `reservePortfolioAsset`;
  - ningún nombre choca con los de LOOPA.
- **Invocación:**
  - la callable de FRAME **no** está abierta a `allUsers` (de ahí su 403);
  - el proyecto no pertenece a una organización, así que no hay política que lo impida;
  - después de A2 hay que verificar las de LOOPA (A3).
- **Reglas activas** (publicadas el 2026-10-15): **no eran ninguna versión del repo de FRAME.**
  - Tienen un cambio que nunca llegó al repo: edita la tarjeta cualquier miembro de hoy de alguno de sus tableros, no la foto de `viewerIds` (`memberOfAnyBoard`, `visibilityUnchanged`).
  - Publicar el borrador de antes lo hubiera deshecho sin aviso: quien entró a un tablero después de crearse una tarjeta habría vuelto a no poder editarla.
  - Ninguna otra cosa difiere de `55a4976`.
- **§7.3:** las reglas activas, probadas en el emulador, niegan escribir `loopa_config`, eventos, ventas y el correlativo, y que alguien se apruebe o se haga admin a sí mismo.

**Qué se hizo con eso:**
- El borrador ahora parte de lo publicado. `integracion/reglas/base-frame-publicada.rules` es la copia de referencia, y lo de LOOPA sigue encima: en la edición se aplican primero sus límites (procedencia, entrega, `clientId`, id) y después las ramas A y B de FRAME.
- **Pruebas:**
  - `puesta-en-marcha.test.cjs` comprueba que cada línea publicada sigue en las reglas nuevas, salvo las 4 que LOOPA reemplaza a propósito;
  - `reglas.test.cjs` suma «quien entró después al tablero edita, con los límites de LOOPA».
- **FRAME:** `firestore.rules.v2` se regeneró; `workspace-visibility-contract.test.js` ahora verifica la regla de edición publicada.
- **Chequeo:** la opción `--base <respaldo>` compara las reglas activas con el respaldo de A0. Desde A3 se usa así, y vuelta a correr dio sin bloqueos.

## 15. A1 hecho: FRAME publicado (2026-11-10)

**Corrección a §14:** el cambio de reglas del 2026-10-15 sí estaba en GitHub (FRAME `1e21019`, más `9f9e2e1`, que agrega `.firebaserc`), pero esta PC no había hecho `fetch`. Las reglas de `origin/main` son idénticas a las activas. Lo demás de §14 no cambia: el borrador parte de lo publicado.

**Lo que se hizo:**
- La rama `fusion/reglas-loopa` se rebasó sobre `origin/main`.
  - Conflictos: las reglas se regeneraron con `reglas-para-frame.cjs` y la prueba de visibilidad quedó como en `main`.
  - El commit que sólo traía esas reglas quedó vacío y se omitió.
  - La rama anterior quedó guardada como `respaldo/fusion-reglas-loopa-antes-rebase`.
- Commits en FRAME: `e099766` (FRAME convive con las ventas) y `c503340` (las reglas de la fusión).
- Las 22 pruebas de FRAME pasan, y `reglas.test.cjs` pasa 17/17 con FRAME.
- `main` se adelantó con `--ff-only` y se hizo `git push origin main` (`9f9e2e1..c503340`). GitHub Pages lo publicó (build `built`).
- **Verificado:**
  - la página publicada carga `loopa-fusion.js?v=20261110-fusion` (200) y `app.jsx?v=20261110-fusion`;
  - `window.FrameLoopa` existe;
  - llega a la pantalla de ingreso sin errores en la consola (no se inició sesión).
- **FRAME y `clientId`:** FRAME no usa `clientId` en las tareas (guarda `client` como texto), así que la regla «`clientId` no cambia» no lo afecta.

**A2 (funciones):** el permiso de esta sesión bloqueó el `firebase deploy`. Lo corre Ángel, o se habilita el permiso.

## 16. A2–A4 hechos: punto A completo (2026-11-10)

- **A2.** Ángel corrió `firebase deploy --only functions:loopa --project frame-studio-3a18f` desde su terminal (esta sesión no tiene permiso para publicar en producción).
  - Se crearon las 8 funciones de LOOPA.
  - El CLI se aseguró de que estuvieran habilitadas las APIs: Cloud Functions, Cloud Build, Artifact Registry, Cloud Scheduler, Run, Eventarc, Pub/Sub y Storage. También generó las identidades de servicio de Pub/Sub y Eventarc.
  - No se borró nada. Las 6 funciones de FRAME siguen.
- **A3: no hizo falta.** El chequeo (con `--base`) da las 6 callables de LOOPA abiertas a `allUsers`. Una llamada sin sesión a `loopaCreateSale` responde 401 `UNAUTHENTICATED` («Iniciá sesión para vender»).
- **A4.** Ángel corrió `firebase deploy --only firestore:rules --project frame-studio-3a18f` desde FRAME `main` (`c503340`).
  - Las reglas compilaron y se publicaron.
  - El chequeo confirma que las reglas activas son las de la fusión: la release `cloud.firestore` es del 2026-11-10 16:56 UTC. Las de Storage no se tocaron (siguen siendo las del 2026-10-15).
- **Respaldos:**
  - `respaldo/2026-11-10-101612`: antes de todo;
  - `respaldo/2026-11-10-105209`: después de A2;
  - `respaldo/2026-11-10-105649`: después de A4.
- **Volver atrás las reglas:** historial de reglas en la consola, o publicar `respaldo/2026-11-10-101612/firestore.rules` desde FRAME (PUNTO-A.md, A4).
- **Pendiente:** la revisión con sesión en FRAME (la hace Ángel): mover una tarjeta, editar y marcar favorito, crear y editar una ficha, papelera y restaurar, portal de un cliente.
- **Sigue:** B (migración), C (configuración y equipo) y D (push de LOOPA).

## 17. Hacia el corte: B0, tanda 3.7 y herramientas de B y C (2026-11-10)

El detalle y el orden del corte están en `integracion/puesta-en-marcha/PUNTO-B-C.md`.

**B0 (sólo lectura):** `respaldo/b-2026-11-10-125825`.
- **LOOPA:** 6 ventas, 3 clientes, 10 servicios, 2 gastos variables y 6 fijos.
- **FRAME:** 12 tableros, 12 fichas y 8 usuarios.
- **Corrida en seco** sobre «Loopa Estudio»:
  - plan LISTO, 0 errores, 0 advertencias;
  - la conciliación cuadra: total 83 200 y cobrado 82 000;
  - los 3 clientes reciben ficha nueva;
  - contra el proyecto real: 29 documentos para crear y 0 conflictos.

**Tanda 3.7 (LOOPA contra el proyecto real):**
- `?datos=fusion&servidor=real` abre una app de Firebase aparte (`loopa-fusion`) sobre frame-studio-3a18f, con la cuenta de FRAME.
- `LOOPA_FUSION_REAL=1` en el build lo deja como modo por defecto. La app de `tooned-os` ya no se inicia (`USE_FB = false`).
- **Decisión pura:** `LoopaFuente.modoDatos`, probada caso por caso.
  - Local y emulador siguen funcionando sólo en este equipo.
  - Sin el SDK de Functions se muestra un aviso: nunca se cae a la app de siempre.
- **En el navegador:** el emulador sigue andando. El modo real muestra «Misma cuenta que FRAME», sólo con la app de FRAME (no se inició sesión).

**B (migración real):**
- **`almacen-rest.cjs`:** la interfaz del almacén sobre la API REST, porque no hay credenciales de servicio en esta PC. Limita a las colecciones de la migración y a dos tipos de escritura: crear sólo si el documento no existe, o actualizar campos sólo si existe.
- **`migrar.cjs`:** usa el ejecutor de siempre. Sin `--escribir` sólo lee; con `--escribir` exige la huella exacta.
- **Dos fallas encontradas probando en el emulador, corregidas:**
  1. un GET dentro de una transacción se cuelga en el emulador; ahora se usa `batchGet`, como los SDK;
  2. una transacción fallida retenía documentos; ahora se cierra (rollback) antes de reintentar.
- **`migracion-rest.test.cjs`:** la corrida por REST es igual a la corrida en memoria, documento por documento, y se reanuda tras un corte.

**C:** `configurar-c.cjs`. Verifica que cada comercial esté aprobado y sea miembro del tablero, y escribe `loopa_config/production` y `access`.

**Pendiente de decisión:**
- quiénes venden;
- el tablero de producción;
- las plantillas de producción de los servicios: ninguno tiene, así que las ventas todavía no crearían tareas.

**Pruebas:** 251 sin red, 33 en el emulador, 11 de funciones.

## 18. Plantillas, gastos y configuración en FRAME, y la revisión del corte (2026-11-10)

**Decisiones de Ángel:**
- **Tablero de producción:** «Loopa Estudio».
- **Quién vende:** Ángel.
- **Plantillas:** una tarea por servicio. Están en `integracion/puesta-en-marcha/plantillas-produccion.cjs` y se cargan con `plantillas.cjs`.
- **Pruebas de las plantillas:**
  - son válidas por contrato y para las columnas y tipos del tablero;
  - pasadas por el planificador real, cada línea da una tarea «Servicio · Cliente», en Briefing, con fecha límite en la entrega;
  - los 10 servicios que crea la migración son los mismos 10 de las plantillas.

**Revisión independiente de las herramientas del corte:** 1 problema grave y 6 menores. Todo está corregido, con prueba.

1. **Grave: después del corte, los gastos y la configuración desaparecían.** LOOPA los guardaba en cada navegador (D21) y nunca leía lo migrado. Ahora es la **tanda 3.8**:
   - **Reglas:**
     - `loopa_expenses/{id}`: lo lee y edita el equipo comercial;
     - `loopa_config/main`: forma cerrada;
     - lo que trae la migración (`legacyId`, `legacyRaw`, `migration`) no se cambia ni se fabrica desde el navegador.
   - **LOOPA:**
     - en modo real y en el emulador, lee y guarda en FRAME y escucha en vivo;
     - escribe sólo lo que cambió (`LoopaFuente.cambiosGastos` / `cambioConfig`, funciones puras) y con `merge`;
     - si hay un cambio propio esperando guardarse, lo que llega en vivo no lo pisa.
   - **Verificado en el navegador, con el emulador:**
     - lee los gastos migrados;
     - un gasto nuevo se guarda con la forma de las reglas;
     - un gasto migrado se edita sin perder su marca;
     - un cambio desde otro equipo aparece solo;
     - todo sigue ahí al recargar.
   - **Pendiente:** publicar las reglas nuevas (paso 0 de `PUNTO-B-C.md`). FRAME ya tiene el archivo regenerado.
2. **Pestañas viejas de LOOPA siguen escribiendo en tooned-os.** No se tocan las reglas de tooned-os, que es compartido con TOONED. En su lugar, el paso 8 del corte (B0 + corrida en seco) detecta lo que llegue tarde, y se pasa con otra corrida.
3. **`migrar` escribía con conflictos y después no se podía retomar.** Ahora, con conflictos, no escribe, y el mensaje distingue «se cortó» de «hay conflictos».
4. **`configurar-c`:**
   - no toca un documento con claves de más;
   - la lista comercial suma personas, salvo con `--reemplazar`.
5. **Copia archivada:** tiene que estar fuera de la carpeta del respaldo y ser idéntica (sha256). Se le quita el BOM.
6. **Enteros fuera del rango seguro:** van como double, igual que el SDK.
7. **Reintentos y sesión:**
   - `beginTransaction` se reintenta, con espera creciente;
   - `fetch` tiene un límite de 30 s, y sin red cuenta como `unavailable`;
   - el token tiene que valer al menos 10 minutos.

**Un solo comando para el corte:** `corte.cjs` (migración → configuración → plantillas). Su corrida en seco contra el proyecto real da 29 documentos para crear, 0 conflictos, la configuración que se escribiría y 10 plantillas válidas.

**Pruebas:** 259 sin red, 34 en el emulador (reglas 3.8 incluidas), 11 de funciones y 22 de FRAME.

## 19. El corte, hecho (2026-11-10)

**Pasos:**
1. **Paso 0.** Ángel publicó las reglas de la tanda 3.8 desde FRAME `main` (`1e0c5a6`). El chequeo de sólo lectura confirma que las activas son las de la fusión.
2. **B0 al momento del corte:** `respaldo/b-2026-11-10-143935`.
   - La huella del plan no cambió: `2b025fc8…`.
   - La copia archivada está en `Documentos\LOOPA-respaldos\loopa-respaldo-corte-2026-11-10-143935.json`, para subir a Drive.
3. **Ángel corrió `corte.cjs --escribir`:**
   - **Migración:** done, 29 creados; después, `same` 29.
   - **Configuración:** `loopa_config/production` (Loopa Estudio) y `access` (Ángel).
   - **Plantillas:** 10 cargadas.
4. **LOOPA publicado:**
   - build `LOOPA_FUSION_REAL=1`, commit `018a5b3`;
   - push de `feat/fusion-fase-0-1` a `main` (`4fcebd6..018a5b3`) y de la rama;
   - GitHub Pages: `built`.
5. **Verificado en la página publicada**, sin iniciar sesión:
   - sólo existe la app `loopa-fusion` sobre frame-studio-3a18f;
   - `USE_FB = false`;
   - aparece la pantalla «Misma cuenta que FRAME»;
   - la consola no muestra errores.

**Falta:**
- **La verificación con sesión (Ángel):**
  - las 6 ventas #1001–#1006, con sus montos;
  - los 8 gastos y la configuración;
  - que una venta nueva tome el número #1007 y cree su tarea en «Loopa Estudio».
- **El chequeo de pestañas viejas** (paso 8 de PUNTO-B-C.md): B0 y la corrida en seco otra vez.

## 20. Cierre del corte (2026-11-10)

- **Verificación con sesión (Ángel):** «Todo bien».
- **Pestañas viejas** (paso 8):
  - B0 otra vez: `tooned-os/loopa` sigue con 6 ventas, 3 clientes, 10 servicios y 8 gastos.
  - Corrida en seco: `same` 29, es decir, no llegó nada tarde.
  - La huella cambió (`45e05b4e…`) porque las 3 fichas migradas ya están en FRAME y ahora se enlazan en lugar de crearse.
- **Estado:** la fusión está en uso. LOOPA y FRAME comparten frame-studio-3a18f.

**Queda para después (no bloquea):**
- editar la rutina y publicar el portal desde LOOPA;
- «Eliminar» en las tarjetas de FRAME para tareas de venta (hoy archiva con aviso);
- sumar a más gente a ventas, con `configurar-c.cjs`;
- afinar las plantillas por servicio (subiendo la versión).

## 21. Un solo programa (tanda 3.9, 2026-11-10)

**Corrección del objetivo (Ángel):** no basta con la misma fuente de datos; tiene que ser **un solo programa**.
- El inventario dio que el módulo Producción nativo de LOOPA cubre una parte chica de FRAME, unas 1 800 líneas contra las 13 000 de FRAME.
- Además estaba escondido detrás de `?produccion=`.

**Decisión:** «Integrar FRAME ya». Después se rehacen sus pantallas, una por una.

**LOOPA:**
- Con datos reales, Producción se ve siempre y es FRAME completo dentro de LOOPA, en un iframe del mismo origen. Se monta una vez y queda vivo.
- **Una sola sesión:** LOOPA usa la app por defecto de Firebase (`[DEFAULT]`) con la configuración de FRAME. Mismo origen y misma app: mismo almacenamiento de sesión.
- **Quien no es del equipo comercial:** si leer ventas da `permission-denied`, LOOPA queda sólo con Producción (sin ventas, montos ni buscador, y sin escuchar ventas).
- `?ruta=produccion` abre directo ahí.

**FRAME:**
- Abierto solo en la versión publicada, redirige a `../LOOPA-OS/?ruta=produccion`.
- Se siguen abriendo solos:
  - el portal del cliente (`?portal=`);
  - el portfolio publicado (`?portfolio=`);
  - `?solo=1`, para emergencias.
- Decide antes de cargar Firebase.

**Publicado:**
- LOOPA `76e3070` y FRAME `0626038` en `main`; las dos páginas `built`.
- **Verificado sin iniciar sesión:**
  - FRAME solo lleva a LOOPA › Producción;
  - el portal del cliente no redirige;
  - LOOPA sólo abre `[DEFAULT]:frame-studio-3a18f` y no da errores.

**Falta:**
- **Verificación con sesión (Ángel):**
  - entrar a LOOPA y abrir Producción: FRAME sin un segundo ingreso;
  - con una cuenta que sólo produce, LOOPA tiene que mostrar sólo Producción.
- **Después:**
  - rehacer las pantallas de FRAME con el estilo de LOOPA, una por una;
  - «Abrir venta» desde una tarea de FRAME hacia LOOPA.

## 22. Fase 4 · un solo sistema: Producción es parte de LOOPA (tanda 4.1, 2026-11-10)

**Pedido de Ángel:** «un programa dentro de otro no es lo que busco: una sola integración, un solo ecosistema conectado, con una experiencia unificada». FRAME deja de existir como programa.

**Qué cambió:**
- **El código de FRAME se mudó a LOOPA:**
  - `_fuente/estudio/`: tablero, calendario, galería, lista, detalle de tarea, clientes y portal, equipo, análisis, rutina, papelera y notificaciones;
  - viene de FRAME `0626038`, sin el portfolio (se decide antes de retirar FRAME).
- **Un solo build y una sola página, sin iframe.**
  - El código de producción se arma en un solo ámbito (`LoopaEstudio`), así que sus nombres no chocan con los de LOOPA.
  - Las exportaciones a `window` entre archivos se neutralizan y los ganchos de React se declaran una vez.
- **Una sola sesión y una sola app de Firebase:** la de la fusión, como app por defecto, en real y en el emulador. `window.db`, `storage` y `functions` son los de LOOPA.
- **Un solo menú, el de LOOPA:**
  - Producción: Tablero, Mis tareas, Equipo y Papelera.
  - Pestañas «Comercial / Producción y portal» en Clientes, «Ventas / Producción» en Métricas y «General / Tablero y aprobaciones» en Configuración.
  - Filtros del tablero (Todas / Favoritas / Urgentes / Completadas) con el estilo de LOOPA.
  - El selector de tablero va en la barra de LOOPA.
  - Se fueron el menú lateral, el logo, el perfil, el ingreso y el modo claro de FRAME.
- **Un solo diseño:**
  - `frame.css` queda limitado a `.estudio`; el tema claro y el portfolio se descartan.
  - Los tokens de FRAME pasan a los valores de LOOPA (negro cálido, blanco, Manrope, radios).
  - Tailwind, que ya usaba FRAME, sólo actúa dentro de `.estudio` y sin preflight.
  - Las capas flotantes van a `#estudio-capa`.
  - La marca que se ve es la de LOOPA.
- **Quien no vende** entra a LOOPA sólo con Producción.
- **El portal del cliente** es una página de LOOPA (`?portal=`). Los enlaces viejos de FRAME siguen funcionando.
- **Una falla de Producción no tumba LOOPA** (`MuroProduccion`).
- **El servidor de Producción se mudó a LOOPA** (`servidor-produccion/`): funciones de FRAME, `storage.rules`, `firebase.json` y `firestore.rules.v2` generado desde el borrador. Todavía no se publica desde acá: va con el retiro de FRAME.
- **Pruebas:**
  - las 20 de contrato de FRAME pasan a `integracion/test-produccion/` (20/20, adaptadas al índice de LOOPA);
  - las de LOOPA apuntan a `_fuente/estudio`.

**Corregido en el camino:**
- **Variables de LOOPA borradas:** el armado borraba variables de LOOPA (`--accent`) que se llaman igual que las de producción.
- **Tarjeta en el celular:** se rompía con un responsable desconocido.
- **Sincronizar la ficha del tablero:** se reintentaba en cada render.
- **Siembra del emulador:** ahora con dueño del tablero.

**Verificado en el emulador:**
- en la computadora: tablero, detalle de tarea, Mis tareas, Equipo, Papelera, Clientes (pestaña de producción), Métricas y Configuración;
- en el celular: la barra inferior de LOOPA y el tablero;
- la consola sin errores nuevos.

**Pruebas:** 260 sin red, 20 de Producción y 34 en el emulador.

## 23. Fase 4.2: crear cuenta y un solo Clientes (2026-11-10)

**Crear cuenta desde LOOPA** (publicado en `f9bcfc9`):
- El ingreso ofrece «Crear cuenta». Usa `LoopaEstudio.crearCuentaEquipo`, la misma alta de FRAME: perfil `pending` en `frame_users`.
- Una cuenta sin aprobar (o rechazada) sólo ve el aviso de espera, sin menú. La aprueba un admin en Configuración › Tablero y aprobaciones.
- Probado en el emulador: alta, aviso y recarga.

**Un solo Clientes:**
- **Cada pantalla perdía lo que editaba la otra.** Producción leía y escribía `name`, `contact.*` y `notes`; LOOPA leía primero `commercial.*` y escribía sólo ahí.
- **Regla nueva: nombre, teléfono, email y notas viven en la ficha única.**
  - `clienteDesdeDoc` lee primero `name`, `contact.*` y `notes`; `commercial.*` queda de respaldo, y `—` no cuenta.
  - El servidor (`saveClient`) también escribe `contact.phone`, `contact.email` y `notes` cuando vienen con valor. **Hay que volver a publicar las funciones.**
  - El nombre se edita sólo desde la ficha: una venta no renombra al cliente.
  - Empresa y canal siguen siendo comerciales.
- **Pantalla:**
  - Clientes es la ficha única, en vivo, con su portal.
  - La lista suma ventas y saldo, el filtro «Con saldo» y la búsqueda por empresa, email o teléfono.
  - El detalle suma el bloque **Comercial**: ventas, total, ticket, saldo, empresa, canal, historial (abre la venta) y «Nueva venta» (con el cliente cargado).
  - Todo esto sólo para quien vende (`comercial` es null para quien sólo produce).
  - Al ir a Nueva venta se releen los clientes, así una ficha creada en Producción se puede elegir.
- **Teléfono:** Clientes, Equipo, análisis, ajustes y papelera muestran su pantalla; antes caían en el tablero rápido.
- **Pruebas:** 263 sin red (2 nuevas), 20 de Producción y 11 de funciones en el emulador.
- **Verificado en el navegador (emulador):**
  - la lista con saldo;
  - la ficha con el bloque Comercial;
  - el historial abre la venta y «Nueva venta» trae el cliente;
  - en el teléfono, sin desborde.

## 24. Fase 4.3: Producción con la cara de LOOPA (2026-11-10)

- **Encabezado único.** Tablero, Mis tareas, Clientes, Equipo, Papelera, Métricas y Configuración usan el `page-head` de LOOPA (sección, título y descripción, `CABECERAS_ESTUDIO`). Los títulos internos de Producción se ocultan (`estudio-titulo`); sus controles (búsqueda, filtros, botones) quedan.
- **Tablero:** los filtros (Todas, Favoritas, Urgentes, Completadas) son píldoras en el encabezado. La barra de vistas, búsqueda y «Nueva tarea» usa letra mayúscula y botones píldora (`estudio-toolbar`).
- **Área de trabajo:** un panel con el borde y el radio de LOOPA (`estudio-raiz`), igual que las tablas.
- **Métricas y Configuración:** las pestañas van dentro del encabezado.
- **Teléfono:** el buscador de Clientes ocupa todo el ancho (`estudio-buscador`). Sin desborde horizontal.
- **Pruebas:** 263 sin red, 20 de Producción y 34 en el emulador.
- **Verificado en el navegador (emulador):** todas las pantallas de Producción en escritorio, y Tablero y Clientes en el teléfono.
## 25. Fase 4.4: Métricas y Configuración, una sola página cada una (2026-11-10)

- **Sin pestañas.** Se quitaron `PESTANAS`, `subvista` y `Pestanas`. Métricas y Configuración son una página que se desplaza entera:
  - arriba, lo comercial de LOOPA (ventas, ganancia; pagos, categorías, canales, respaldos);
  - abajo, un título de sección **Producción** (`SECCIONES_JUNTAS`) y el panel de Producción (`SECCION_ESTUDIO`: `analytics` y `settings`) con su altura natural (`content-juntas`).
- **Quien sólo produce** ve únicamente la sección de Producción, con el encabezado de LOOPA (`CABECERAS_ESTUDIO`).
- Producción sigue montada una sola vez: el panel se reordena con CSS (`order`), no se vuelve a crear.
- **Pruebas:** 264 sin red (1 nueva), 20 de Producción y 34 en el emulador.
- **Verificado en el navegador (emulador):** Métricas y Configuración en escritorio y teléfono, sin recortes ni desborde; el Tablero sigue igual; la cuenta que sólo produce no ve montos ni ajustes comerciales.