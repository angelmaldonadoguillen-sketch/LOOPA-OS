// Ensambla LOOPA OS en un solo index.html, igual que TOONED OS.
// CSS base = el de TOONED OS (líneas 46-1141), recoloreado a la paleta LOOPA:
// fondo #14281f (verde profundo) + acento #e2e58d (lima), tipografía Montserrat.
const fs = require('fs');
const path = require('path');
const here = __dirname;
const OUT = path.join(__dirname, '..');
const TOONED = 'D:/Escritorio 20 de Julio 26/Cloude programas/index.html';

const toonedLines = fs.readFileSync(TOONED, 'utf8').replace(/^\ufeff/, '').split(/\r?\n/);
let baseCss = toonedLines.slice(45, 1141).join('\n');
if (!baseCss.trimStart().startsWith(':root')) throw new Error('El CSS de TOONED cambió de lugar: revisar rango de líneas');
baseCss = baseCss
  .replace('--accent: #E63946;', '--accent: #e2e58d;')
  .replace('--accent-ink: #FF5461;', '--accent-ink: #eef0b3;')
  .replace(/rgba\(230,\s*57,\s*70/g, 'rgba(var(--accent-rgb)');

// Grises neutros de TOONED → verdes de LOOPA (mismo orden de luminosidad)
const TINT = {
  '060606': '0f2019', '0a0a0a': '14281f', '0b0b0b': '11231b', '0c0c0c': '11231b', '0d0d0d': '11231b',
  '0f0f0f': '172e24', '111': '182f25', '121212': '1a3228', '141414': '1a3329', '151515': '1d372c',
  '161616': '1d372c', '181818': '1f3a2f', '191919': '1f3a2f', '1a1a1a': '1f3a2f', '1c1c1c': '224034',
  '1e1e1e': '224034', '1f1f1f': '224034', '242424': '29473a', '2a2a2a': '2c4a3d', '2e2e2e': '325243',
  '333': '365646', '3a3a3a': '3d5e4e', '555': '58705f', '5a5a5a': '62796b', '888': '93a89b',
  '8a8a8a': '93a89b', 'e0e0e0': 'e3e6d3', 'f1f1f1': 'f3f4e4',
};
const tint = (s) => s.replace(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi, (m, h) => TINT[h.toLowerCase()] ? '#' + TINT[h.toLowerCase()] : m);
baseCss = tint(baseCss);

let extraCss = tint(fs.readFileSync(path.join(here, 'extra.css'), 'utf8'));
const app = tint(fs.readFileSync(path.join(here, 'app.jsx'), 'utf8'));

// ── Poda: TOONED trae estilos de inventario, tallas, DTF, envíos, etc. que
// LOOPA no usa. Se descarta toda regla cuyos selectores usen una clase que
// no aparece en app.jsx. TOONED no se toca: la poda ocurre solo al armar.
const DYNAMIC_PREFIXES = ['e-', 't-'];            // badge e-${estado}, toast t-${tono}
const classUsed = (c) => DYNAMIC_PREFIXES.some(p => c.startsWith(p)) ||
  new RegExp('(?<![\\w-])' + c.replace(/-/g, '\\-') + '(?![\\w-])').test(app);
const selectorUsed = (sel) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].every(m => classUsed(m[1]));
function prune(css, opts = {}) {
  let out = '', i = 0;
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    i = j;
    if (prelude.startsWith('@media')) {
      const inner = prune(body, opts);
      if (inner.trim()) out += `${prelude} {\n${inner}}\n`;
    } else if (prelude.startsWith('@keyframes')) {
      out += `${prelude} {${body}}\n`;            // se filtran al final según uso
    } else if (prelude === ':root' && opts.dropVars) {
      const decls = body.split(';').map(d => d.trim()).filter(d => d && !opts.dropVars.some(v => d.startsWith(v + ':')));
      if (decls.length) out += `:root { ${decls.join('; ')}; }\n`;
    } else {
      const sels = prelude.split(',').map(x => x.trim()).filter(selectorUsed);
      if (sels.length) out += `${sels.join(', ')} {${body}}\n`;
    }
  }
  return out;
}
// En el :root de TOONED sobran las variables que LOOPA redefine y las que nadie usa
const loopaVars = [...extraCss.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]);
const cssBefore = baseCss.length + extraCss.length;
baseCss = prune(baseCss, { dropVars: [...loopaVars, '--row-h', '--r-lg', '--r-xl'] });
extraCss = prune(extraCss);
// Animaciones que ya no usa nadie
for (const [css, set] of [[baseCss, (v) => baseCss = v], [extraCss, (v) => extraCss = v]]) {
  let c = css;
  for (const m of [...c.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)]) {
    const name = m[1], rest = (baseCss + extraCss + app).replace(new RegExp('@keyframes\\s+' + name + '\\b', 'g'), '');
    if (!new RegExp('\\b' + name + '\\b').test(rest)) c = c.replace(new RegExp('@keyframes\\s+' + name + '\\s*\\{[^{}]*(\\{[^{}]*\\}[^{}]*)*\\}\\n?'), '');
  }
  set(c);
}
console.log(`CSS: ${(cssBefore / 1024).toFixed(0)} KB → ${((baseCss.length + extraCss.length) / 1024).toFixed(0)} KB`);

// Logo (logo-loopa.svg): se inyecta sin colores para que tome currentColor
const logoSvg = fs.readFileSync(path.join(here, 'logo-loopa.svg'), 'utf8');
const viewBox = logoSvg.match(/viewBox="([^"]+)"/)[1];
const shapes = [...logoSvg.matchAll(/<(path|circle|rect|polygon)\b[^>]*\/>/g)].map(m => m[0].replace(/\s*class="[^"]*"/, ''));
if (!shapes.length) throw new Error('No se encontraron trazos en logo-loopa.svg');
const paths = 'window.LOOPA_SVG = ' + JSON.stringify({ viewBox, inner: shapes.join('') }) + ';\n';
fs.writeFileSync(path.join(OUT, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="104" fill="#14281f"/><g transform="translate(50 64) scale(1.9)" fill="#e2e58d">${shapes.slice(-2).join('')}</g></svg>`);
if (/<\/script/i.test(app)) throw new Error('app.jsx contiene </script>');

const html = `<!doctype html><!-- LOOPA OS v1.3 · base TOONED OS v2.8 -->
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>LOOPA OS</title>
<link rel="manifest" href="manifest.json" />
<meta name="theme-color" content="#14281f" />
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
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
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
