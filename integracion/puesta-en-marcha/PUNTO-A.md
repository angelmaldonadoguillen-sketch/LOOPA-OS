# Punto A — publicar la fusión en frame-studio-3a18f

Fecha de preparación: 2026-11-10. Estado: **preparado, nada ejecutado.**

Cada paso marcado 🔒 cambia o lee algo real. Se hace sólo con un «sí» explícito de Ángel para ESE paso. Ningún «sí» anterior lo cubre.

## Orden y por qué

| Paso | Qué | Toca lo real | Se puede volver atrás |
|---|---|---|---|
| A0 🔒 | Chequeos de sólo lectura y respaldo | Lee | No cambia nada |
| A1 🔒 | Publicar FRAME (rama `fusion/reglas-loopa` → `main`) | GitHub Pages | Sí: revert en `main` |
| A2 🔒 | Publicar las funciones de LOOPA (codebase `loopa`) | Functions | Sí: borrar sólo las 8 de LOOPA |
| A3 🔒 | Abrir la invocación de las 6 callables, si hace falta | IAM de Cloud Run | Sí: quitar el permiso |
| A4 🔒 | Publicar las reglas de la fusión | Reglas de Firestore | Sí: volver a publicar el respaldo |

- **FRAME va antes que las reglas.** Las reglas nuevas rechazan algunas escrituras de la versión vieja de FRAME: borrar o restaurar una tarea de venta, reescribir una ficha entera, el favorito con `set`. La versión nueva funciona igual con las reglas viejas, así que publicarla primero no rompe nada.
- **Las funciones pueden ir antes que las reglas.** Son nuevas: nadie las llama todavía. Sin `loopa_config/production` no generan nada (`config_missing`).
- **Las reglas van al final.** Antes, todas las pestañas abiertas de FRAME tienen que estar en la versión nueva.
- **Lo que NO es el punto A:** la migración (B), cargar `loopa_config` y la lista comercial (C), y el push de LOOPA (D).

## A0 · Chequeos de sólo lectura 🔒 (lee)

Usa la sesión del Firebase CLI de esta PC. Todas las llamadas son GET, sólo a `*.googleapis.com` y sólo a este proyecto (`punto-a.cjs` → `permitido`). No se escribe nada en el proyecto. El token no se imprime ni se guarda.

```bash
node integracion/puesta-en-marcha/chequeo-a.cjs --leer-proyecto --frame "<repo FRAME>"
```

Deja en `integracion/puesta-en-marcha/respaldo/<fecha>-<hora>/` (fuera de git):
- `firestore.rules`: el respaldo de las reglas activas;
- las reglas de Storage;
- `releases.json`;
- `funciones.json`: la lista de funciones de FRAME, para comparar después;
- `informe.md`.

Revisa lo que pide el ADR-0004 §7:
1. **Ubicación de la base.** Tiene que ser `nam5` o `us-central1`. Si no, hay que mover el trigger de región antes de A2.
2. **Funciones.** Qué tiene FRAME y que ningún nombre choque con los de LOOPA.
3. **Invocación.**
   - Si la callable de FRAME (`reservePortfolioAsset`) está abierta a `allUsers`.
   - Si una política de la organización lo impide.
4. **Reglas activas.** Tienen que ser exactamente la última versión de `firestore.rules.v2` de FRAME anterior a la fusión.
   - Se compara contra la historia del archivo, no contra `main`. Así el chequeo sigue valiendo después de A1, cuando `main` ya tiene la fusión.
   - Si son una versión vieja del repo: aviso.
   - Si no son ninguna versión del repo, se para todo: hay algo publicado que el repo no tiene.
5. **Esta PC.** Los dos repos tienen que estar sin cambios sin commit, porque se publica desde el árbol de trabajo. Si no, el chequeo sale con ✖.

Después, las reglas activas se prueban en el emulador. La prueba confirma que el navegador no puede escribir `loopa_config` ni aprobarse a sí mismo, que es en lo que se apoya el servidor:

```bash
LOOPA_REGLAS_ACTIVAS=integracion/puesta-en-marcha/respaldo/<fecha>-<hora>/firestore.rules node integracion/emulador/correr.cjs integracion/emulador/reglas-activas.test.cjs
```

En PowerShell:

```powershell
$env:LOOPA_REGLAS_ACTIVAS = "integracion/puesta-en-marcha/respaldo/<fecha>-<hora>/firestore.rules"; node integracion/emulador/correr.cjs integracion/emulador/reglas-activas.test.cjs
```

La prueba también confirma que esas reglas viejas impiden crear desde el navegador eventos (`loopa_integration_events`), ventas y el correlativo. Rigen entre A2 y A4, con el worker ya publicado.

**Sigue sólo si el informe no tiene ✖ y la prueba pasa.**

## A1 · Publicar FRAME 🔒 (GitHub Pages)

En el repo de FRAME:

```bash
git status --porcelain            # tiene que salir vacío
git fetch origin
git merge-base --is-ancestor origin/main fusion/reglas-loopa   # si falla: GitHub avanzó, se para y se revisa
git switch main
git merge --ff-only origin/main
git merge --ff-only fusion/reglas-loopa
( for f in *.test.js portfolio-beta-contract.test.cjs; do node "$f" || exit 1; done ) && git push origin main
```

- El push sólo sale si pasan todas las pruebas de FRAME que no necesitan navegador.
- La rama trae también `firestore.rules.v2` nuevo, ya en un commit. Subirlo a GitHub **no publica reglas**; sólo deja el repo de FRAME igual a lo que se va a publicar en A4.
- **Verificar:**
  - Abrir FRAME con Ctrl+Shift+R.
  - En la pestaña Red, `loopa-fusion.js?v=20261110-fusion` carga.
  - Mover una tarjeta, duplicar una tarea y editar una ficha.
- **Volver atrás:** `git revert` del merge en `main` y push.
- **Pestañas abiertas:** FRAME no guarda archivos en caché (`sw.js`), pero una pestaña abierta sigue con el código viejo hasta recargar. Antes de A4: avisar al equipo que recargue, o esperar al día siguiente.

## A2 · Publicar las funciones de LOOPA 🔒 (Functions)

En LOOPA-OS, con las pruebas en verde:

```bash
node --test "integracion/test/*.test.cjs"
node integracion/emulador/correr.cjs --funciones
node integracion/puesta-en-marcha/chequeo-a.cjs --frame "<repo FRAME>"
firebase deploy --only functions:loopa --project frame-studio-3a18f
```

- `--only functions:loopa` publica **sólo** el codebase `loopa`. Las funciones de FRAME (codebase `default`) no se tocan, porque el CLI sólo borra dentro del codebase que publica.
- FRAME ya tiene funciones programadas y triggers de Storage, así que las APIs (Eventarc, Pub/Sub, Scheduler) ya deberían estar habilitadas. Es el primer trigger de **Firestore**: si el primer intento falla con un error del «Eventarc Service Agent», se espera unos minutos y se repite.
- No hacen falta índices compuestos: el servidor sólo consulta por igualdad en un campo.
- **Verificar:**
  - `firebase functions:list --project frame-studio-3a18f`: están las de FRAME, igual que en `funciones.json` de A0, y las 8 de LOOPA.
  - El barrido corre cada 5 minutos sin errores: sin eventos, no hace nada.
- **Volver atrás:** borrar sólo las de LOOPA, con un «sí» aparte porque borra.

  ```bash
  firebase functions:delete loopaCreateSale loopaUpdateSale loopaAddPayment loopaRemovePayment loopaSaveClient loopaSaveService loopaOnEventCreated loopaSweepEvents --region us-central1 --project frame-studio-3a18f
  ```

## A3 · Invocación de las callables 🔒 (IAM), sólo si hace falta

Volver a correr el chequeo de A0. Ahora informa cada callable de LOOPA.

Si alguna dice «no acepta llamadas desde el navegador», hay que abrirla. Es la misma situación que el 403 de `reservePortfolioAsset` (`FIREBASE-PENDIENTE.md` §1 en FRAME). Abrirla es lo normal para una `onCall`: la seguridad la hace la función, que exige sesión, usuario aprobado y estar en `commercialUids`.

- **Consola:** Google Cloud Console → Cloud Run → `frame-studio-3a18f`. Para cada servicio `loopacreatesale`, `loopaupdatesale`, `loopaaddpayment`, `looparemovepayment`, `loopasaveclient` y `loopasaveservice`: Seguridad → Permitir invocaciones no autenticadas.
- **Verificar:** el chequeo las da por abiertas. Una llamada sin sesión responde 401, no 403.
- **Volver atrás:** quitar el permiso `allUsers` / `roles/run.invoker` de cada servicio.

## A4 · Publicar las reglas 🔒 (Firestore)

Recién cuando el equipo ya recargó FRAME (A1). Antes:

```bash
node integracion/puesta-en-marcha/chequeo-a.cjs --leer-proyecto --frame "<repo FRAME>"
node integracion/emulador/correr.cjs
```

- El chequeo tiene que confirmar que las reglas activas siguen siendo la última versión de FRAME anterior a la fusión, la misma que en A0. Si alguien publicó otra cosa entretanto, se para.
- `node integracion/emulador/correr.cjs` corre todas las pruebas de reglas sobre el borrador.

Desde el repo de FRAME, en `main` ya con el merge (es el que tiene `firebase.json` con `firestore.rules.v2`):

```bash
firebase deploy --only firestore:rules --project frame-studio-3a18f
```

- **Sólo `firestore:rules`:** ni Storage ni las funciones de FRAME.
- **Verificar en FRAME:**
  - abrir el tablero;
  - mover una tarjeta;
  - editar y marcar favorito;
  - crear y editar una ficha;
  - mandar una tarea manual a la papelera y restaurarla;
  - abrir el portal de un cliente.
- **Volver atrás** (con FRAME ya en la versión nueva, que funciona con las reglas viejas):
  - Consola: Firebase Console → Firestore → Reglas → historial → la versión anterior → Publicar.
  - O desde el repo de FRAME, publicando el respaldo de A0 en lugar del archivo del repo (`firebase deploy` siempre publica el archivo de `firebase.json`):

    ```bash
    cp <LOOPA-OS>/integracion/puesta-en-marcha/respaldo/<fecha>-<hora>/firestore.rules firestore.rules.v2
    firebase deploy --only firestore:rules --project frame-studio-3a18f
    git checkout -- firestore.rules.v2
    ```

## Lo que queda después del punto A

- **B:** respaldo de `loopa/*` en tooned-os y la migración: en seco primero, después la real.
- **C:** cargar `loopa_config/production` y `access`. Las personas de ventas tienen que ser miembros del tablero de producción. Después se enciende `?datos=fusion` para el equipo.
- **D:** push de la rama de LOOPA.
