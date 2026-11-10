const assert = require('node:assert/strict');
const fs = require('node:fs');

const analytics = fs.readFileSync('analytics.jsx', 'utf8');

assert.match(analytics, /const reportable = projects\.filter\(p => p\.status !== 'archived'\)/);
assert.match(analytics, /const active\s+= reportable\.filter\(p => !isClosed\(p\)\)/);
assert.match(analytics, /const urgent\s+= active\.filter\(needsAttention\)/);
assert.match(analytics, /const totalBudget\s+= active\.reduce/);
assert.match(analytics, /delivered\.length \/ reportable\.length/);
assert.match(analytics, /const upcoming = active/);
assert.match(analytics, /color: resolveThemeColor\(s\.color\)/);
assert.match(analytics, /displayColor: resolveThemeColor\(m\.color\)/);
assert.match(analytics, /resolveThemeColor\(cl\?\.color \|\| fallbackPalette/);
assert.match(analytics, /background: colorAlpha\(color, 13\)/);
assert.match(analytics, /color="var\(--resource-teal\)"/);
assert.match(analytics, /color="var\(--resource-violet\)"/);
assert.match(analytics, /grid-cols-1 sm:grid-cols-2 xl:grid-cols-4/);
assert.match(analytics, /grid-cols-1 lg:grid-cols-2/);
assert.match(analytics, /grid-cols-1 lg:grid-cols-\[minmax\(0,1fr\)_300px\]/);
assert.doesNotMatch(analytics, /#7DD3C0|#A78BFA|proy\.|color \+ '22'|color \+ '33'/);

console.log('analytics-contract: 16 checks passed');
