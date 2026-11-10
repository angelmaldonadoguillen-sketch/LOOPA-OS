'use strict';
// El token de la sesión del Firebase CLI de esta PC (la de `firebase login`),
// para LEER con las APIs REST. No se imprime ni se guarda.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// `proyecto`: uno fijo del código (no datos de afuera). Un comando de lectura
// del CLI renueva la sesión si hace falta y confirma que el CLI ve el proyecto.
function tokenDelCli(proyecto) {
  if (!/^[a-z0-9-]+$/.test(proyecto)) throw new Error('proyecto inválido');
  const r = process.platform === 'win32'
    ? spawnSync(`firebase firestore:databases:list --project ${proyecto}`, { encoding: 'utf8', shell: true })
    : spawnSync('firebase', ['firestore:databases:list', '--project', proyecto], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`El Firebase CLI no pudo leer ${proyecto} (¿firebase login? ¿esta cuenta tiene acceso?).`);
  const f = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const t = JSON.parse(fs.readFileSync(f, 'utf8')).tokens || {};
  // Al menos 10 minutos de vigencia: la corrida no se queda sin sesión a mitad.
  if (!t.access_token || !(Number(t.expires_at) > Date.now() + 10 * 60000)) throw new Error('La sesión del Firebase CLI vence pronto: correr de nuevo en un minuto o `firebase login --reauth`.');
  return t.access_token;
}

module.exports = { tokenDelCli };
