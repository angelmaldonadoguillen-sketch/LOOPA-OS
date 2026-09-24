// Ensambla LOOPA OS en un solo index.html, igual que TOONED OS.
// CSS base = el de TOONED OS (líneas 46-1141) con el acento cambiado.
const fs = require('fs');
const path = require('path');
const here = __dirname;
const OUT = path.join(__dirname, '..');
const TOONED = 'D:/Escritorio 20 de Julio 26/Cloude programas/index.html';

const toonedLines = fs.readFileSync(TOONED, 'utf8').replace(/^\ufeff/, '').split(/\r?\n/);
let baseCss = toonedLines.slice(45, 1141).join('\n');
if (!baseCss.trimStart().startsWith(':root')) throw new Error('El CSS de TOONED cambió de lugar: revisar rango de líneas');
baseCss = baseCss
  .replace('--accent: #E63946;', '--accent: #7B61FF;')
  .replace('--accent-ink: #FF5461;', '--accent-ink: #9A85FF;')
  .replace(/rgba\(230,\s*57,\s*70/g, 'rgba(var(--accent-rgb)');

const extraCss = fs.readFileSync(path.join(here, 'extra.css'), 'utf8');
const paths = fs.readFileSync(path.join(here, 'paths.js'), 'utf8');
const app = fs.readFileSync(path.join(here, 'app.jsx'), 'utf8');
if (/<\/script/i.test(app)) throw new Error('app.jsx contiene </script>');

const html = `<!doctype html><!-- LOOPA OS v1.0 · base TOONED OS v2.8 -->
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>LOOPA OS</title>
<link rel="manifest" href="manifest.json" />
<meta name="theme-color" content="#0A0A0A" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="LOOPA OS" />
<link rel="apple-touch-icon" href="icon.svg" />
<link rel="icon" href="icon.svg" type="image/svg+xml" />
<script>
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW:', e)));
  }
</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700&family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet" />
<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
<script>
  // ══ CONECTAR LA NUBE ══════════════════════════════════════════
  // Pegá acá la config de tu proyecto Firebase (paso a paso en LEEME.md).
  // Mientras apiKey esté vacío, LOOPA OS funciona en MODO LOCAL:
  // los datos quedan solo en este navegador.
  window.LOOPA_FIREBASE = {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  };
  // ═══════════════════════════════════════════════════════════════
  window.USE_FB = !!(window.LOOPA_FIREBASE.apiKey && window.firebase);
  if (window.USE_FB) {
    firebase.initializeApp(window.LOOPA_FIREBASE);
    window.db = firebase.firestore();
  }
</script>
<style>
${baseCss}
${extraCss}
</style>
</head>
<body>
<div id="root"></div>
<script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" crossorigin="anonymous"></script>
<script>
${paths}</script>
<script type="text/babel" data-presets="react">
${app}
</script>
</body>
</html>
`;

fs.mkdirSync(OUT, { recursive: true });
// Si ya existe un index.html con Firebase conectado, conservar esa config
const outFile = path.join(OUT, 'index.html');
let final = html;
if (fs.existsSync(outFile)) {
  const prev = fs.readFileSync(outFile, 'utf8');
  const m = prev.match(/window\.LOOPA_FIREBASE = \{[\s\S]*?\};/);
  if (m && /apiKey:\s*"[^"]+"/.test(m[0])) final = final.replace(/window\.LOOPA_FIREBASE = \{[\s\S]*?\};/, m[0]);
}
fs.writeFileSync(outFile, final);
console.log('OK', outFile, (final.length / 1024).toFixed(0) + ' KB');
