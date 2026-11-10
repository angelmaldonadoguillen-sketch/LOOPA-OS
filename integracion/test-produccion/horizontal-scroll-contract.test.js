const fs = require('fs');
const assert = require('assert');

const views = fs.readFileSync('views.jsx', 'utf8');

assert.match(views, /const boardScrollRef = useRef\(null\)/);
assert.match(views, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
assert.match(views, /Math\.abs\(event\.deltaX\) > Math\.abs\(event\.deltaY\) \* 0\.75/);
assert.match(views, /horizontalGesture \? event\.deltaX : event\.deltaY/);
assert.match(views, /event\.shiftKey/);
assert.match(views, /board\.scrollLeft \+= rawDelta \* scale/);
assert.match(views, /event\.preventDefault\(\)/);
assert.match(views, /removeEventListener\('wheel', onWheel\)/);
assert.match(views, /overscrollBehaviorX: 'contain'/);

console.log('horizontal-scroll-contract: 9 checks passed');
