'use strict';
// Migración LOOPA → modelo unificado (Fase 1). Puro, sin Firebase ni red.
// El único ejecutor recibe un puerto de almacenamiento; en esta fase sólo se
// usa con el almacén en memoria (integracion/migrate.cjs --simulate).

module.exports = {
  ...require('./source'),
  ...require('./clients'),
  ...require('./plan'),
  ...require('./runner'),
  ...require('./compat'),
};
