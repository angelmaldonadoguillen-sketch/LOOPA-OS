// Ensambla LOOPA OS en un solo index.html, igual que TOONED OS.
// CSS base = base.css (heredado de TOONED OS), recoloreado a la identidad LOOPA:
// blanco y negro (negro cálido #121211, el tono del logo) y tipografía Manrope (3 tamaños, 3 pesos).
const fs = require('fs');
const path = require('path');
const here = __dirname;
const OUT = path.join(__dirname, '..');
let baseCss = fs.readFileSync(path.join(here, "base.css"), "utf8");
baseCss = baseCss
  .replace('--accent: #E63946;', '--accent: #f4f4f1;')
  .replace('--accent-ink: #FF5461;', '--accent-ink: #ffffff;')
  .replace(/rgba\(230,\s*57,\s*70/g, 'rgba(var(--accent-rgb)');

// Grises neutros de TOONED → grises cálidos de LOOPA (mismo orden de luminosidad)
const TINT = {
  '060606': '0c0c0b', '0a0a0a': '121211', '0b0b0b': '0e0e0d', '0c0c0c': '0e0e0d', '0d0d0d': '0e0e0d',
  '0f0f0f': '171716', '111': '181817', '121212': '1a1a19', '141414': '1b1b1a', '151515': '1e1e1d',
  '161616': '1e1e1d', '181818': '20201f', '191919': '20201f', '1a1a1a': '20201f', '1c1c1c': '252524',
  '1e1e1e': '252524', '1f1f1f': '252524', '242424': '2a2a28', '2a2a2a': '2e2e2c', '2e2e2e': '343432',
  '333': '383836', '3a3a3a': '3f3f3c', '555': '5a5a56', '5a5a5a': '63635f', '888': '9a9a95',
  '8a8a8a': '9a9a95', 'e0e0e0': 'e6e6e2', 'f1f1f1': 'f4f4f1',
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
const largoSvg = fs.readFileSync(path.join(here, 'logo-loopa-largo.svg'), 'utf8');
const largo = { viewBox: largoSvg.match(/viewBox="([^"]+)"/)[1], inner: [...largoSvg.matchAll(/<(path|circle|rect|polygon)\b[^>]*\/>/g)].map(m => m[0].replace(/\s*class="[^"]*"/, '')).join('') };
// LOOPA_SVG = logo compacto (menú) · LOOPA_SVG_LARGO = loop largo (acceso y carga)
const paths = 'window.LOOPA_SVG = ' + JSON.stringify({ viewBox, inner: shapes.join('') }) + ';\nwindow.LOOPA_SVG_LARGO = ' + JSON.stringify(largo) + ';\n';
// Ícono de app: la "L" + el loop (las dos primeras formas de logo-loopa.svg), que es lo
// más reconocible del logotipo; "estudio creativo" no se lee a 48 px. La caja se mide sola.
function pathBox(d) {
  const t = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g); let i = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = '';
  const P = [], n = () => parseFloat(t[i++]), isNum = (v) => v !== undefined && !/^[a-zA-Z]$/.test(v);
  while (i < t.length) {
    if (!isNum(t[i])) cmd = t[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const pt = (a, b) => rel ? [x + a, y + b] : [a, b];
    if (C === 'Z') { x = sx; y = sy; continue; }
    if (C === 'M' || C === 'L' || C === 'T') { [x, y] = pt(n(), n()); if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; } P.push([x, y]); }
    else if (C === 'H') { x = rel ? x + n() : n(); P.push([x, y]); }
    else if (C === 'V') { y = rel ? y + n() : n(); P.push([x, y]); }
    else if (C === 'C') { const p = [pt(n(), n()), pt(n(), n()), pt(n(), n())]; P.push(...p); [x, y] = p[2]; }
    else if (C === 'S' || C === 'Q') { const p = [pt(n(), n()), pt(n(), n())]; P.push(...p); [x, y] = p[1]; }
    else if (C === 'A') { n(); n(); n(); n(); n(); [x, y] = pt(n(), n()); P.push([x, y]); }
    else throw new Error('Comando SVG no soportado en el logo: ' + cmd);
  }
  return P;
}
const markBox = (els) => {
  const P = [];
  els.forEach(e => {
    const c = e.match(/cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.-]+)"/);
    if (c) { const [cx, cy, r] = c.slice(1).map(Number); P.push([cx - r, cy - r], [cx + r, cy + r]); }
    else P.push(...pathBox(e.match(/ d="([^"]+)"/)[1]));
  });
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0, pad = Math.max(w, h) * 0.01;
  return [x0 - pad, y0 - pad, w + 2 * pad, h + 2 * pad].map(v => +v.toFixed(2)).join(' ');
};
const mark = shapes.slice(0, 2);
fs.writeFileSync(path.join(OUT, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="104" fill="#121211"/><svg x="72" y="72" width="368" height="368" viewBox="${markBox(mark)}" fill="#f4f4f1">${mark.join('')}</svg></svg>`);
if (/<\/script/i.test(app)) throw new Error('app.jsx contiene </script>');

const html = `<!doctype html><!-- LOOPA OS v3.0 · base TOONED OS v2.8 -->
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>LOOPA OS</title>
<link rel="manifest" href="manifest.json" />
<meta name="theme-color" content="#121211" />
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
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500&display=swap" rel="stylesheet" />
<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
<script>
  // ══ CONECTAR LA NUBE ══════════════════════════════════════════
  // Proyecto Firebase de LOOPA (heredado de TOONED: id interno "tooned-os").
  // Los datos de LOOPA viven en la colección "loopa" de Firestore.
  // Si apiKey queda vacío, LOOPA OS funciona en MODO LOCAL (solo este navegador).
  window.LOOPA_FIREBASE = {
    apiKey: "AIzaSyDjuOtF5CUQmZ9nsLDPUeTPFG6sLJZTTkE",
    authDomain: "tooned-os.firebaseapp.com",
    projectId: "tooned-os",
    storageBucket: "tooned-os.firebasestorage.app",
    messagingSenderId: "193761852127",
    appId: "1:193761852127:web:ba8d049866d581920e076a"
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
