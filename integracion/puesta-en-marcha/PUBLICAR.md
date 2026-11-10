# Publicar el servidor (desde LOOPA-OS)

FRAME está retirado. Todo lo del proyecto `frame-studio-3a18f` se publica desde este repo. Su `firebase.json` falla a propósito si alguien intenta publicar desde allá.

Cada publicación nombra el proyecto a mano (no hay `.firebaserc`). Se corre desde la carpeta `LOOPA-OS`.

| Qué | Archivo fuente | Comando |
| --- | --- | --- |
| Funciones de ventas (codebase `loopa`) | `functions/` | `firebase deploy --only functions:loopa --project frame-studio-3a18f` |
| Reglas de Firestore | `servidor-produccion/firestore.rules.v2` (se genera desde el borrador con `node integracion/puesta-en-marcha/reglas-para-frame.cjs servidor-produccion --escribir`) | `firebase deploy --only firestore:rules --config servidor-produccion/firebase.json --project frame-studio-3a18f` |
| Reglas de Storage | `servidor-produccion/storage.rules` | `firebase deploy --only storage --config servidor-produccion/firebase.json --project frame-studio-3a18f` |
| Funciones de Producción (codebase `default`: rutina, papelera, portfolio) | `servidor-produccion/functions/` | primero `pnpm install` en esa carpeta; después `firebase deploy --only functions:default --config servidor-produccion/firebase.json --project frame-studio-3a18f` |

Antes de publicar reglas, probalas sin publicar: el mismo comando con `--dry-run`.

Los dos codebases están separados: publicar uno nunca borra las funciones del otro.

Estado al 2026-11-10: lo de `servidor-produccion/` es idéntico a lo publicado (reglas y storage comparados contra el respaldo de las 14:28; funciones idénticas al repo de FRAME). No hace falta publicar nada ahora.
