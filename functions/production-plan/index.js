'use strict';
// Núcleo puro de la integración LOOPA → FRAME (Fase 0).
// Sin Firebase, sin DOM, sin red. Todavía NO está conectado a functions/index.js:
// no se exporta ninguna Cloud Function nueva. Ver integracion-loopa/ADR-0001.

module.exports = {
  ...require('./dates'),
  ...require('./ids'),
  ...require('./errors'),
  ...require('./contracts'),
  ...require('./catalog'),
  ...require('./planner'),
  ...require('./executor'),
  ...require('./legacy-loopa'),
};
