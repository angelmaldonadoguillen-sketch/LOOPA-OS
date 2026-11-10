# ADR-0003 — Producción dentro de LOOPA OS (Fase 2)

- **Estado:** propuesto · tanda 2.1 hecha · revisión independiente aplicada
- **Fecha:** 2026-11-09
- **Depende de:** ADR-0001 (generación de producción), ADR-0002 (modelo unificado) y `PLAN-FUSION-LOOPA-OS.md`.

## 1. Punto de partida

| | LOOPA OS | FRAME |
|---|---|---|
| Código | `_fuente/app.jsx` (~3.000 líneas) → `build.js` arma un solo `index.html` | 10 archivos `.jsx` (~17.000 líneas) cargados por separado |
| Estilo | CSS propio (`base.css` + `extra.css`, podado por uso), identidad b/n | **Tailwind por CDN** + `frame.css`: ~700 clases utilitarias en vistas, modal, rutina, analytics y portal |
| Datos | `loopa/*` en `tooned-os` | `frame_*` en `frame-studio-3a18f` |

Llevar FRAME a LOOPA no es copiar archivos: hay que cambiar el sistema de estilos y la fuente de datos de cada vista.

## 2. Decisiones de la tanda 2.1

1. **Módulos en el build, sin bundler nuevo.** `build.js` arma `MODULES` y `MODULE_CSS`, en un orden fijo, antes de `app.jsx` y en el mismo script de Babel. La poda de CSS considera el código de los módulos.
2. **Bandera.** `?produccion=demo` muestra datos de ejemplo; `?produccion=1` muestra el aviso de que los datos reales se conectan en la Fase 3; `?produccion=0` (o `off`, `false`, `no`) la apaga. Cualquier otro valor se ignora. La bandera queda recordada en el navegador. **Sin bandera, el menú, las rutas y el comportamiento de la app publicada no cambian.** Si quedó guardada la ruta `produccion` sin bandera, la app vuelve a "Nueva venta".
3. **Núcleo puro portado** (`_fuente/produccion/nucleo.js`): normalización de tareas, cierre por comportamiento de columna, urgencia, vencimiento, progreso, tablero, día del calendario, grilla del mes, semana y carry-over. No usa globales: "hoy" y las columnas se reciben como parámetros. Corre en el navegador y en Node.
   - **Fechas estrictas:** `2026-11-00`, `2026-13-01` o `2026-02-30` son inválidas. FRAME, por herencia de V8, convierte `2026-02-30` en el 2 de marzo; LOOPA lo muestra como "fecha inválida" para corregirla. Es una divergencia deliberada y tiene su propia prueba.
   - **Dos reglas de carry-over:** FRAME tiene una en el navegador (`app.jsx`) y otra en la función programada (`functions/index.js`), y no coinciden. Difieren con 199 de 200 ítems hechos (el navegador redondea a 100 %), con `isDone` no booleano y con estados que no están en las columnas. Se portaron las dos (`carryOverCandidates` y `carryOverCandidatesServidor`), cada una con paridad contra su original. Cuál rige es la decisión D12.
4. **Paridad contra el código real de FRAME** (`integracion/test/produccion-paridad.test.cjs`):
   - ejecuta `data.jsx` de FRAME en una máquina virtual con "hoy" fijo;
   - extrae literalmente los fragmentos del calendario (`views.jsx`) y del carry-over (`app.jsx`);
   - compara 400 tareas en normalización y 1.200 en reglas, con cuatro configuraciones de columnas (incluidas fechas inválidas), 48 meses de grilla, 800 semanas y las dos reglas de carry-over (la del servidor con seis configuraciones, incluidos `isDone` no booleano y un estado fuera de columnas).

   Si FRAME cambia esa lógica, la prueba falla. **Si el repositorio de FRAME no está en la máquina, estas pruebas se saltean** (el reporte lo muestra). Con `REQUIRE_FRAME=1` fallan en vez de saltearse: es la forma obligatoria de correrlas antes de aceptar un cambio.
5. **Calendario de sólo lectura con identidad LOOPA** (`calendario.jsx` + `produccion.css`):
   - mes y semana sobre una sola fecha de referencia (cambiar de vista no salta de período), con navegación que suma bien aunque se haga clic rápido, título de semana con año y aviso de período vacío;
   - detalle lateral como diálogo modal accesible: `aria-modal`, el foco entra al abrir, Tab queda atrapado y el foco vuelve a la tarjeta al cerrar. Muestra entregables, estado, entrega, venta y venta cancelada;
   - con datos de ejemplo, el número de venta es texto ("venta de ejemplo"), nunca un enlace: podría coincidir con una venta real;
   - en celular se convierte en agenda (sólo días con trabajo);
   - sin Tailwind; el único color es semántico (aviso y alerta).
6. **Datos de ejemplo producidos por el planificador real** (`integracion/preview/generar-demo.cjs` → `produccion-demo.json`). Son deterministas y se validan con el contrato de tarea generada.
7. **Vista previa local** (`integracion/preview/armar-preview.cjs` → `index.html`, en `.gitignore`): sin claves de Firebase (modo local), sin service worker y sin publicarse.

## 3. Verificación

- 116 pruebas en verde con `REQUIRE_FRAME=1` (al cierre de la tanda 2.3): 9 de paridad y núcleo, 5 del módulo y las de las Fases 0 y 1. Las 6 de LOOPA también. Las pruebas no escriben en el repositorio: los generadores aceptan `--out`.
- Revisión en navegador (`?produccion=demo`): mes, semana, navegación entre años, detalle con foco y teclado, período vacío y celular. Sin bandera, el menú es el original de 7 módulos y una ruta `produccion` guardada vuelve a "Nueva venta". La consola queda limpia.

## 4. Plan de tandas restante

| Tanda | Contenido | Depende de |
|---|---|---|
| 2.2 | Navegación unificada: menú de módulos agrupado (Comercial / Producción / Sistema) y barra de celular con «Más» | — |
| 2.3 | Tablero (kanban) y edición de tareas: modal o panel con checklist, estado, fechas, responsables; carry-over en el cliente | D11 |
| 2.4 | Rutina diaria y analytics de producción dentro de Métricas | D11 |
| 2.5 | Ficha de cliente unificada (ventas + producción + portal) y portal del cliente | D11, ADR-0002 riesgo 6 |
| 2.6 | Adaptador de datos de Producción contra el emulador de Firestore | Fase 3 (reglas y backend unificado) |

Mientras tanto, FRAME sigue siendo la herramienta de edición del equipo.

## 5. Riesgos y pendientes

1. ~~**Barra inferior del celular:** 8 botones con etiquetas pisadas.~~ Resuelto en la tanda 2.2: 4 principales y «Más».
2. **"Hoy" en la vista de ejemplo:** el calendario usa el "hoy" de los datos de ejemplo (`2026-11-17`) y la barra superior de LOOPA, el del navegador. Con datos reales se usará el día local de Tegucigalpa.
3. **La paridad cubre la lógica, no la interfaz.** La interfaz se reconstruye con la identidad de LOOPA; su verificación es visual y de comportamiento, no línea a línea.
4. **El archivo de ejemplo es estático:** si cambian los fixtures o el planificador, hay que regenerarlo. Una prueba verifica que esté al día.
5. **Peso del bundle:** `index.html` pasa de unos 240 KB a 268 KB, y Babel compila el módulo en cada carga aunque la bandera esté apagada. Es aceptable para esta tanda. Antes del corte, evaluar precompilar con el mismo `build.js` (Babel en Node, sin bundler) o cargar el módulo sólo con la bandera encendida.
6. **Revisión independiente de la tanda 2.1:** aprobada con cambios. Todos los hallazgos verificados están corregidos: dos reglas de carry-over, diálogo accesible, una sola fecha de referencia, enlaces de demo, fechas estrictas, valores de la bandera, año en la semana, período vacío, pruebas que escribían en el repo, paridad salteada sin aviso, semana sin paridad y falsas pestañas.

## 6. Decisiones

**Tomadas el 2026-11-09:** D11 = reconstruir con el estilo de LOOPA (decisión de Ángel). D12 = por defecto la regla del servidor (recomendación del responsable técnico; Ángel puede cambiarla).

### Detalle

| # | Decisión | Recomendación | Alternativa |
|---|---|---|---|
| D12 | Qué regla de carry-over rige en LOOPA (antes de la tanda 2.3) | **La del servidor**: es la que corre siempre (todas las noches), mira si queda algún ítem sin hacer, no un porcentaje redondeado, y es la que ya mueve las tarjetas reales. La del navegador se retira | Mantener la del navegador y alinear la función programada con ella |
| D11 | Cómo portar las pantallas de edición de FRAME (tablero, modal de tarea, rutina, analytics, portal) | **Reconstruirlas con el CSS e identidad de LOOPA**, por tandas, reusando el núcleo portado. Es más lento, pero da una sola identidad y un solo sistema de estilos, que es lo que pide la fusión | Portarlas casi tal cual sumando Tailwind por CDN a LOOPA: más rápido y fiel a FRAME, pero suma un segundo sistema de estilos (otro framework en LOOPA), choca con la identidad b/n y complica la poda de CSS |

## 7. Tandas 2.2 y 2.3 (hechas)

**2.2 · Navegación unificada** (`_fuente/shell/navegacion.jsx` + `navegacion.css`). Sólo con bandera: sin ella, `app.jsx` dibuja su menú original sin cambios.
- **Escritorio:** grupos Comercial / Producción / Sistema.
- **Celular:** cuatro principales (Nueva, Ventas, Clientes, Producción) más «Más», una hoja con Servicios, Métricas, Gastos y Configuración que se cierra con Escape. Verificado a 375 px: 5 botones de 75 px, sin desborde.

**2.3 · Tablero y ficha editable** (`tablero.jsx` y la ficha de `calendario.jsx`):
- **Núcleo:** `boardColumns`, `statusChangeBlocked`, `applyTaskPatch`, `toggleChecklistItem`, `addChecklistItem`.
- **Reglas de FRAME, con paridad contra su código real:** un estado desconocido agrega su columna en vez de esconder la tarjeta, y pasar a una columna que exige checklist completo, con el checklist incompleto, se rechaza.
- **Reglas de la fusión:** en una tarea vendida, la entrega la fija la venta (`deadline_locked`) y la procedencia es inmutable (`provenance_locked`). Sólo se editan campos conocidos, el día de trabajo debe ser válido y nunca se muta la tarea original.
- **Tablero:** las tarjetas se mueven con flechas, accesibles por teclado.
- **Ficha:** se editan estado, prioridad, día de trabajo, entrega (sólo en tareas manuales) y entregables (marcar y agregar). Un rechazo se muestra en la ficha y la tarea queda igual.
- **Fuente de datos de ejemplo en memoria** (`useFuenteDemo`): aplica las reglas reales y no persiste nada, con aviso visible. Tiene el mismo contrato que tendrá la fuente real: `cambiar(id, patch) → { ok, error }`.
- **Arrastrar y soltar** queda para después: las flechas y el selector de estado cubren el teclado y el celular.

**Pendiente para la fuente real (Fase 3):**
- persistir con update/merge sobre los campos cambiados (nunca `set()` completo, riesgo del ADR-0002);
- registrar actividad (`activity`);
- reglas que impidan al navegador tocar la procedencia;
- la regla D12 de carry-over en el servidor.

**Revisión independiente de las tandas 2.2 y 2.3:** aprobada con cambios. Todos los hallazgos verificados están corregidos y verificados en el navegador:
1. `applyTaskPatch` valida estado (columna conocida, el actual o `archived`), etiquetas, responsables y la forma del cambio, y copia los arreglos.
2. El foco del teclado vuelve a la flecha de la misma tarjeta al moverla, y a la tarjeta al cerrar la ficha aunque se haya vuelto a montar.
3. Un cambio exitoso, abrir una ficha o cambiar de vista limpian el aviso de error.
4. Sin títulos de grupo cortados en tablet.
5. La hoja «Más» no tapa la barra inferior.
6. La paridad del bloqueo de estado usa las funciones reales de FRAME y cubre cambios simultáneos de estado y checklist.
7. Un cambio `null` o que no es objeto se rechaza.
8. El estado guardado no comparte arreglos con quien llama.
9. La hoja «Más» es un diálogo con foco atrapado, no un menú sin teclado, y se cierra sola si la pantalla se agranda.
10. Comparador de orden estable.
11. ADR al día.

Quedan como decisiones de diseño, alineadas con FRAME:
- mover a una columna «fuera de las columnas» está permitido;
- desmarcar un entregable de una tarea entregada no la reabre;
- el título de una tarea vendida es editable;
- el límite WIP por columna no está portado.

## 8. Tanda 2.4 · Resumen y rutina diaria (hecha)

- **Ubicación:** dentro de Producción, como tercera vista (**Calendario / Tablero / Resumen**), y no en Métricas como decía el plan. Así queda junto al trabajo que resume y la pantalla comercial de Métricas sigue intacta. La vista elegida se recuerda en el navegador.
- **Núcleo, todo con paridad contra el código real de FRAME:**
  - Rutina (`routine.jsx`): `routineDedupeHistory`, `routineRollover` (el día anterior pasa al historial, máx. 60, y con carry-over suma deuda), `routineToggle` (completar salda la deuda), alta, baja, renombre y asignación, y `routineStats` (avance y racha de días perfectos). La paridad cubre 300 rutinas generadas: historial deduplicado, cambio de día, deuda y racha.
  - Resumen (`analytics.jsx`): `productionSummary`, con conteos de activas, entregadas, tasa de entrega, que requieren atención, por estado, por tipo, carga del equipo, clientes con más trabajo, tareas por mes de entrega y próximas entregas. La paridad cubre cuatro configuraciones de columnas.
- **Diferencias deliberadas con FRAME:**
  1. **Sin importes (D8):** no se calculan presupuesto ni montos por mes.
  2. **Clientes por ficha única:** se agrupan por `clientId` si existe, así dos fichas con el mismo nombre no se mezclan. FRAME agrupaba por nombre.
  3. **Próximas entregas:** excluyen fechas imposibles. FRAME las ordenaba con `new Date()`, que deja el orden indefinido.
  4. **Borrar una tarea de rutina también borra su deuda.** FRAME la dejaba huérfana.
  5. **Tipos desconocidos:** se muestran con su id. FRAME los mostraba como «Otro».
- **Datos de ejemplo:** equipo de 3 personas con responsables asignados, y una rutina guardada "ayer" para que al abrir se vea el cambio de día real. Todo en memoria y sin persistir.
- **Verificación:** 121 pruebas con `REQUIRE_FRAME=1`. En el navegador: cambio de día (16-nov 3/4 al historial, deuda 2 días), racha al completar, apertura de la ficha desde «Próximas entregas» y celular sin desbordes.

**Revisión independiente de la tanda 2.4:** aprobada con cambios. Todo corregido y verificado:
- **Reglas del cambio de día** (divergencias deliberadas con FRAME):
  - se cambia de día sólo si la fecha guardada es un día válido anterior a hoy;
  - una fecha futura (reloj adelantado) no borra las marcas;
  - una fecha inválida empieza el día de cero sin ensuciar el historial;
  - la deuda suma los días de calendario transcurridos (FRAME sumaba 1 por apertura);
  - el historial se deduplica después de agregar el día.
- **Apagar el arrastre** limpia la deuda y oculta el aviso, como FRAME (`routineSetCarryOver`, con prueba contra `toggleCarryOver`).
- **Paridad de la rutina:**
  - el generador ahora cubre historial con huecos, desordenado, de más de 60 días y con fechas repetidas, más fechas guardadas de ayer, con hueco, futuras, inválidas o ausentes;
  - exige al menos 5 casos de cada tipo;
  - se comprobó que detecta las mutaciones del revisor: tope de 9 y deuda +1.
- **Interfaz:**
  - KPI «Total sin archivar» y «% del total», que reemplazan al «período» engañoso;
  - el foco vuelve al botón de la fila tras renombrar o cancelar, y a la fila siguiente tras quitar;
  - un responsable inactivo o desconocido aparece como «(inactivo)»;
  - fichas homónimas se distinguen con el final de su id;
  - cada vista tiene su descripción;
  - el foco visible en «Próximas entregas» tiene contorno.
- **Datos de ejemplo coherentes** (el día 15 quedó 3/4, que explica la deuda).
- **Orden de próximas entregas:** los empates se desempatan por id. FRAME conservaba el orden de llegada; está documentado en el código.

## 9. Tanda 2.5 · Ficha del cliente y portal (hecha)

- **Núcleo (paridad con `buildClientPortalDocument` de FRAME):**
  - `buildPortalDocument` arma la proyección pública: las mismas claves que valida la regla de FRAME, sin comentarios, responsables, importes, checklist ni procedencia;
  - `clientTasks` decide qué tareas son de un cliente;
  - `typeOf` y `statusOf`;
  - `clientVisible` pasa a ser editable (booleano validado).
- **Divergencias deliberadas, de seguridad o robustez:**
  1. **Homónimos.** FRAME emparejaba tareas y portal sólo por nombre, así que un cliente podía ver en su portal público el trabajo de otro con el mismo nombre. Ahora una tarea con `clientId` pertenece sólo a esa ficha, y una vieja sin id cae por nombre sólo si no hay homónimos en el tablero; si es ambiguo, no se publica. La ficha avisa del caso.
  2. Un estado sin nombre se publica con su id. FRAME dejaba `undefined`, que Firestore rechaza.
  3. `updatedAt` se recibe por parámetro, para que la proyección sea determinista.
- **Ficha del cliente** (`cliente.jsx`): se abre desde «Clientes con más trabajo» del Resumen y desde la ficha de una tarea («Ver ficha de…»). Muestra:
  - trabajo activo, lo entregado y las ventas con producción;
  - un interruptor «Visible para el cliente» por tarea;
  - el estado del portal, con una **vista previa exacta** que usa la misma proyección que se publicaría.

  Se abre un solo panel a la vez y es un diálogo accesible.
- **Sin publicar de verdad todavía.** El documento público, el enlace con token y las reglas se conectan en la Fase 3. Las ventas y cobros del cliente se suman a la ficha con los datos migrados (adaptador real, tanda 2.6 / Fase 3).
- **Verificación:** 125 pruebas con `REQUIRE_FRAME=1`. En el navegador: abrir la ficha, ocultar una tarea (desaparece de la vista previa), despublicar, y pasar de la ficha a la tarea y de vuelta.

**Revisión independiente de la tanda 2.5:** aprobada con cambios. Confirmó que la proyección nunca publica comentarios, checklist, responsables, importes ni procedencia (con datos al azar y a mano). Todo lo verificado está corregido, con prueba de regresión:

1. **Cliente sin nombre.** Un cliente con nombre vacío o en blanco se llevaba por nombre todas las tareas internas o «sin cliente». Ahora un nombre vacío no empareja nada, y sin la lista de clientes (`allClients`) sólo cuenta el `clientId`.
2. **Homónimos sin salida.** El aviso pedía enlazar tareas viejas, pero `clientId` es procedencia bloqueada y no había cómo hacerlo. Ahora `linkTaskToClient` asigna el `clientId` una sola vez, sólo a un cliente que existe y sólo si el nombre coincide. La ficha lista las tareas «Sin ficha con este nombre» con un botón para enlazarlas. Las tareas sin cliente reconocible se enlazan en la migración (Fase 3), no a mano.
3. **Portada de un archivo oculto.** Volvía a publicarse si la URL difería en mayúsculas del esquema o del host, o en el token de descarga. Ahora se comparan URLs normalizadas (esquema y host en minúsculas, sin `?…`).
4. **Valores de `validPortal`.** `clientName` y `studioName` se recortan a 200. `studioAvatar` sólo pasa si es `data:image/(jpeg|png|webp);base64,`, si no queda `''`. Un tipo propio sin nombre se publica con su id, nunca `undefined`. Los entregables o ítems `null` se ignoran en lugar de romper la proyección.
5. **Foco.** Al pasar de la ficha a una tarea en Resumen, el foco se perdía al cerrar. Ahora vuelve a quien abrió la ficha: la fila del cliente o la tarjeta de la tarea. Verificado en el navegador.
6. **Ventas canceladas (decisión D13, por defecto).** Sus tareas siguen en el tablero (cancelar nunca borra), pero salen del portal: no se le muestra al cliente «en producción» algo cancelado. La ficha marca la venta «(cancelada)» y la tarea «no se publica».
7. **Detalles de la ficha:**
   - lo archivado no cuenta como entregado;
   - cada interruptor de visibilidad nombra su tarea;
   - los homónimos se detectan con la misma normalización que el núcleo (NFC, espacios colapsados, minúsculas);
   - «Ver ficha» sólo aparece si la ficha existe.

Paridad reforzada: el portal también se compara con tipos propios y con tareas que traen `clientId`.

Divergencias que quedan documentadas:
- `published` que no sea booleano nunca publica (FRAME publicaba con `published:false`).
- `updatedAt` en la vista previa es la fecha del día; el adaptador de la Fase 3 pasa la marca ISO.
- El filtro por workspace queda a cargo de quien llama: el adaptador consulta un solo tablero.

Verificación: 133 pruebas con `REQUIRE_FRAME=1` y LOOPA 6/6.

## 10. Tanda 2.6 · Adaptador Firestore y emulador local (hecha)

- **Adaptador** (`functions/adapters/firestore-store.js`): el almacén del integrador, del repositorio de ventas y de la migración, sobre el Admin SDK. Tiene la misma interfaz que `MemoryStore` y tampoco ofrece borrar.
  - Recibe el `db` ya creado: no carga `firebase-admin` ni decide a qué proyecto hablar.
  - Traduce los códigos gRPC (`6` → `already-exists`, `10`/`ABORTED` → `aborted`…) y deja intactos los del dominio (`counter_missing`, `contract_invalid`).
  - Rechaza lo mismo que la memoria: `undefined`, lecturas después de escrituras e ids con `/`. Además rechaza claves con punto en `update`, porque el SDK las tomaría como rutas y dejaría de ser un merge superficial.
- **Seguridad:** por defecto sólo acepta `FIRESTORE_EMULATOR_HOST` con un proyecto `demo-*`, que el emulador garantiza aislado de la nube. Hablar con un proyecto real exige `allowRemote: true`, que se usará en la Fase 3 y sólo con aprobación.
- **Suite del emulador** (`integracion/emulador/`, `node integracion/emulador/correr.cjs`):
  - Cada escenario corre en memoria y en el emulador y se compara el estado final documento por documento: confirmar y reprocesar, editar con trabajo iniciado y resincronizar, cancelar, id ocupado, repositorio de ventas (alta, versión, cobros, cliente inexistente) y la migración completa y repetida.
  - Las carreras reales se prueban por invariantes: 20 ventas simultáneas con correlativo consecutivo y tres workers con el lease vencido sin duplicar tarjetas.
  - Cada escenario usa un proyecto `demo-*` propio: aislamiento sin borrar nada. El emulador arranca vacío y se descarta al terminar.
  - Sin emulador la suite se saltea con aviso; `REQUIRE_EMULATOR=1` (lo pone `correr.cjs`) la hace fallar.
- **Fuerza de la suite:** tres mutaciones del adaptador hacen fallar la suite. Son: quitar el filtro de la consulta, convertir `update` en `set` (sobrescribir) y crear sin precondición.
- **Entorno:** Java 21 (Temurin) instalado con aprobación del usuario. `firebase-admin` está sólo en `integracion/emulador` (`npm install --ignore-scripts`), no en la app.
  - En Windows, Java no podía abrir su canal interno por socket de dominio Unix y el emulador moría con «Unable to establish loopback connection». `correr.cjs` pasa `-Djdk.net.unixdomain.tmpdir=` para que use TCP local.
  - El Firebase CLI standalone ejecuta los scripts con su Node embebido (v20), que no entiende `--test`. `suite.cjs` lanza el Node real.
- **Verificación:** 137 pruebas sin red y 9/9 en el emulador.

**Revisión independiente de la tanda 2.6:** aprobada con cambios. Todo lo verificado está corregido:

1. **La prueba de 20 ventas simultáneas fallaba a veces** (1 de 3 corridas, `ABORTED: Transaction lock timeout`).
   - Causa: el emulador bloquea el documento del contador mientras dura la transacción, y `retryOnContention` "esperaba" con turnos de `setImmediate`, que son casi 0 ms reales.
   - Arreglo: espera real con jitter completo (`0..min(2 s, 25 ms·2^i)`).
   - La prueba acepta que alguna venta agote sus reintentos, pero exige tres cosas: que sea sólo por contención, que las que entraron no dejen huecos y que reintentarla (es idempotente por id) complete los 20 números consecutivos.
   - Resultado: 3 corridas seguidas en verde, ~27 s cada una.
2. **El arreglo de Java no hacía lo que decía.** Con `jdk.net.unixdomain.tmpdir=` vacío, Java no usa TCP: crea el socket en el directorio actual.
   - El emulador ahora corre dentro de una carpeta propia y corta (`integracion/emulador/.jtmp`, ignorada por git), que también recibe `firestore-debug.log`. Se avisa si la ruta queda larga (límite de ~108 caracteres).
   - Se corrigió el comentario y se agregaron `socket_*` y `firebase-debug.log` a `.gitignore`.
3. **La memoria aceptaba datos que Firestore rechaza o convierte.** Ahora `functions/adapters/firestore-data.js` valida igual en `MemoryStore` y en el adaptador, siempre con `invalid-argument`. Cubre:
   - arrays anidados, huecos, `Date`, `Map` e instancias de clases;
   - claves vacías o `__x__` e ids reservados;
   - documentos de más de ~1 MB;
   - claves de `update` con `.` o `/`;
   - rutas de documento usadas como colección;
   - consultas por campo anidado o por un valor objeto.

   Además, crear y actualizar el mismo documento en una transacción ahora vale también en memoria, porque las escrituras se evalúan en orden, como en Firestore.
4. **Reintentos del SDK.** Si un reclamo ya entró pero se perdió la respuesta, el SDK vuelve a correrlo. Ahora `claim()` reconoce su propio lease, no queda `busy` dos minutos y no suma un intento fantasma; la prueba de mutación lo confirma. `maxAttempts < 1` es `invalid-argument` en ambos almacenes.
5. **Control de seguridad.** Ahora mira la configuración real del `db` (`servicePath` de loopback, `ssl === false` y proyecto `demo-*`), no una variable de entorno ni una opción, y la revisa en cada operación. Así se bloquean:
   - un `db` creado antes de definir el emulador;
   - un "emulador" en otro host;
   - un `db.settings()` posterior a la construcción.
6. **Errores y cuelgues:**
   - `normalizeError` ya no arrastra el error original ni deja `host:puerto` en el mensaje, y deja intactos los errores sin código (bugs de programación) para no perder la traza.
   - La suite tiene `--test-timeout`: si el emulador muere a mitad de la suite, falla en lugar de quedarse colgada.
7. **Prueba de comparación:**
   - `merge` del emulador ahora es superficial, como en memoria;
   - la máscara de tokens sólo afecta a los workers conocidos;
   - se prueba `hasDocuments` en una subcolección con documentos;
   - la versión del JDK se elige por número.

Las tres mutaciones del adaptador siguen haciendo fallar la suite. Verificación: 141 pruebas sin red, LOOPA 6/6, simulador y migración simulada OK, y 9/9 en el emulador en 3 corridas seguidas.

Queda sin verificar si Firestore real se comporta como el emulador con 20 ventas simultáneas; se mide en la Fase 3. Una CI futura debe correr `correr.cjs` o definir `REQUIRE_EMULATOR=1`: un `node --test` pelado saltea la suite del emulador (con aviso) y sale con 0.
- **Tanda 2.7 (antes pendiente):** reglas para las colecciones nuevas (`loopa_sales`, eventos, contadores, migraciones; campos de procedencia y `deadline` bloqueados en `frame_projects`), escritas como borrador y probadas en el emulador sin tocar las reglas activas.

## 11. Tanda 2.7 · Reglas en borrador (hecha)

- **Borrador** (`integracion/reglas/firestore.rules.borrador`): es la base de reglas de FRAME (`firestore.rules.v2`) copiada tal cual, con los agregados marcados «LOOPA:».
  - **No se publica.** Sólo se carga en el emulador local.
  - Las reglas activas de frame-studio-3a18f no se tocaron; publicarlas es parte de la Fase 3 y necesita aprobación.
- **Ventas** (`loopa_sales`): sólo lectura, y sólo para el equipo comercial (**D15**).
  - El equipo comercial es una lista `commercialUids` en `loopa_config/access` que mantiene sólo el admin de plataforma.
  - Crear, editar y cobrar pasa por funciones del servidor (D9): el navegador no escribe ventas.
- **Outbox, correlativo y migraciones** (`loopa_integration_events`, `loopa_counters`, `loopa_migrations`): cerrados a todo cliente; sólo el Admin SDK escribe.
- **Tareas** (`frame_projects`):
  - la procedencia (`sourceSystem`, `sourceSaleId`, `sourceSaleStatus`, `idempotencyKey`…) sólo la escribe el servidor: no se puede crear, cambiar ni quitar desde el navegador;
  - en una tarea de venta, la entrega (`deadline`) no se edita y la tarea no se borra: se archiva (**D14**);
  - `clientId` se asigna una sola vez, a una ficha que existe en el mismo tablero, y después no cambia ni se quita;
  - las tareas manuales conservan las reglas de FRAME.
- **Fichas** (`frame_clients`):
  - `commercial`, `legacyLoopaIds` y `hasSales` los escribe sólo el servidor;
  - una ficha con cualquiera de esos campos no se borra (migrada o con ventas nuevas);
  - una ficha no se muda de tablero;
  - El `set()` completo de FRAME sigue valiendo si conserva esos campos. La UI de la Fase 3 debe conservarlos (o usar `update`).
- **Pruebas:** `integracion/emulador/reglas.test.cjs` tiene 8 pruebas con usuarios de ejemplo (comercial, producción, otro tablero, admin y pendiente).
  - Siete debilitamientos deliberados del borrador hacen fallar la suite: edición libre, ventas para todos, borrar una tarea de venta, editar lo comercial, crear con procedencia, ficha de otro tablero y contador abierto.
  - La suite del emulador queda en 17/17: 9 escenarios del almacén y 8 de reglas.

**Revisión independiente de la tanda 2.7:** aprobada con cambios. No encontró ningún camino desde el navegador para:
- leer ventas o montos sin estar en la lista comercial;
- falsear o cambiar la procedencia (ni con `set`, `merge`, rutas anidadas, `deleteField` o el flujo de papelera);
- mover la entrega de una tarea de venta, borrarla o volver a enlazar su `clientId`;
- tocar el outbox, el correlativo o las migraciones.

Lo que encontró y quedó corregido:

1. **Una ficha con ventas nuevas se podía borrar,** y otro tablero podía ocupar su id. La protección sólo cubría fichas migradas.
   - Ahora el servidor marca la ficha con `hasSales: true` al crear una venta o al cambiarle el cliente, y la regla la protege igual que `commercial` y `legacyLoopaIds`.
   - La marca va en una transacción propia, chica e idempotente, y no en la del correlativo. Ponerla en la misma bloqueaba dos documentos calientes a la vez y hacía fallar la prueba de 20 ventas simultáneas en el emulador. Reintentar la misma venta completa una marca fallida.
2. **Las pruebas eran más débiles de lo que parecía.** Siete debilitamientos pasaban inadvertidos. Ahora las pruebas:
   - recorren los 10 campos de procedencia, más una ruta anidada;
   - ponen a un usuario pendiente y a uno rechazado DENTRO de la lista comercial;
   - usan un miembro de los dos tableros para probar la mudanza de una ficha;
   - prueban leer otro documento de configuración y cambiar el `id`.

   Resultado: 17 debilitamientos deliberados del borrador hacen fallar la suite.
3. **Ids `loopa_*` reservados.** Un miembro podía crear antes una tarea con el id determinista de una venta y frenar su producción. Ahora el navegador no puede crear tareas con id `loopa_*`.
4. **Campo `id`:** en tareas y fichas sólo puede ser el id del documento. Una ficha vieja de FRAME sin `id` puede recibir el suyo, como hace el `set()` de FRAME.
5. **Encabezado y ADR corregidos:** qué fichas no se borran y qué líneas del encabezado de FRAME se quitaron.

**Cambios que la interfaz necesita en la Fase 3** (el borrador los rechaza, a propósito):
- **Duplicar una tarea de venta:** la copia debe salir sin procedencia y, si cambia de tablero, sin `clientId`.
- **Borrar una tarea de venta:** la interfaz no debe ofrecerlo (se archiva, D14). FRAME escribe primero la copia en la papelera y después borra: con la regla nueva el borrado falla y queda una copia fantasma en la papelera, que al restaurarla pisaría la tarea viva. La papelera y el borrado deben ir en un solo lote.
- **Restaurar de la papelera una tarea cuya ficha se borró:** se rechaza. Hay que restaurarla sin `clientId`.
- **Editar una ficha con `set()` completo:** debe conservar `commercial`, `legacyLoopaIds` y `hasSales`, o usar `update`.

**Límites:**
- El límite que importa es el de 1000 expresiones evaluadas por pedido, no el de lecturas de documentos.
- El flujo real de FRAME de compartir con 4 tableros pasa igual que hoy.
- Compartir con 5 tableros ya lo rechazan las reglas activas de FRAME.
- Lo que el borrador sí rechaza nadie lo hace hoy: un cambio de acceso a 4 tableros junto con un enlace de ficha, o 10 o más enlaces a fichas distintas en un mismo lote.

**Verificación:** 142 pruebas sin red y 17/17 en el emulador (9 del almacén y 8 de reglas) en varias corridas seguidas.

**Sin verificar:**
- si en producción hay fichas sin `id` o con otro distinto;
- las reglas de Storage, que usan `viewerIds`.
