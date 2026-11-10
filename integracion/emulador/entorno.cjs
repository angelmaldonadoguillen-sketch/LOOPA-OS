'use strict';
// Entorno para los emuladores de Firebase en este equipo (lo usan correr.cjs
// y arrancar-fusion.cjs). Nunca credenciales reales.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function entornoEmulador(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.GOOGLE_APPLICATION_CREDENTIALS; // nunca credenciales reales

  // En Windows, Java abre su "pipe" interno con un socket de dominio Unix en el
  // directorio temporal. Con el TEMP de este equipo (ruta corta ANGELM~1) eso
  // falla y el emulador muere con "Unable to establish loopback connection".
  // Con tmpdir VACÍO Java crea el socket en el DIRECTORIO ACTUAL (no usa TCP):
  // por eso el emulador corre dentro de una carpeta propia (.jtmp, ignorada por
  // git), que también recibe firestore-debug.log. Las rutas de socket tienen un
  // límite de ~108 caracteres: se avisa si la carpeta queda demasiado larga.
  const JTMP = path.join(__dirname, '.jtmp');
  fs.mkdirSync(JTMP, { recursive: true });
  if (process.platform === 'win32' && !/unixdomain\.tmpdir/.test(env.JAVA_TOOL_OPTIONS || '')) {
    env.JAVA_TOOL_OPTIONS = `${env.JAVA_TOOL_OPTIONS ? `${env.JAVA_TOOL_OPTIONS} ` : ''}-Djdk.net.unixdomain.tmpdir=`;
    if (JTMP.length > 85) console.warn(`Aviso: ${JTMP} es una ruta larga para el socket de Java; si el emulador no arranca, mové el repo a una ruta más corta.`);
  }

  // Java instalado recién puede no estar todavía en el PATH de esta consola.
  if (process.platform === 'win32' && spawnSync('java', ['-version'], { shell: true }).status !== 0) {
    const base = 'C:\\Program Files\\Eclipse Adoptium';
    // La versión más nueva por número (jdk-21.0.13 > jdk-21.0.9), no por texto.
    const ver = (d) => (d.match(/\d+/g) || []).map(Number);
    const cmp = (a, b) => {
      const x = ver(a), y = ver(b);
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
      return 0;
    };
    const jdk = fs.existsSync(base) && fs.readdirSync(base).filter(d => /^jdk-21/.test(d)).sort(cmp).pop();
    if (jdk) env.PATH = `${path.join(base, jdk, 'bin')};${env.PATH}`;
  }
  return { env, JTMP };
}

module.exports = { entornoEmulador };
