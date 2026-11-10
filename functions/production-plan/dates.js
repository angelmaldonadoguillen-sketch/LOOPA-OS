'use strict';
// ─────────────────────────────────────────────────────────────────
// Fechas de calendario puras (YYYY-MM-DD), sin zona horaria.
//
// Una fecha de trabajo es un día del calendario, no un instante. Toda la
// aritmética se hace sobre el número de día civil (algoritmo days_from_civil
// de Howard Hinnant), así que no depende de la zona del proceso ni de
// toISOString(), que en Honduras ya devuelve "mañana" desde las 18:00.
//
// El único punto donde entra un instante es todayInTimeZone(), que convierte
// un Date a día local de America/Tegucigalpa con Intl, igual que
// functions/index.js.
// ─────────────────────────────────────────────────────────────────

const DEFAULT_TIME_ZONE = 'America/Tegucigalpa';
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const daysInMonth = (y, m) => {
  if (m === 2) return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
};

// Devuelve { y, m, d } o null si el texto no es una fecha real.
const parseYmd = (s) => {
  if (typeof s !== 'string') return null;
  const match = YMD_RE.exec(s);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1970 || y > 9999 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
};

const isValidYmd = (s) => parseYmd(s) !== null;

const pad = (n, w = 2) => String(n).padStart(w, '0');
const formatYmd = ({ y, m, d }) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

// Días desde 1970-01-01 (proleptic gregorian).
const toDayNumber = ({ y, m, d }) => {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
};

const fromDayNumber = (z) => {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
};

const requireYmd = (s) => {
  const parsed = parseYmd(s);
  if (!parsed) throw new RangeError(`Fecha inválida: se esperaba YYYY-MM-DD real y se recibió ${JSON.stringify(s)}`);
  return parsed;
};

// Toda fecha calculada vuelve a validarse: nunca sale de acá un año 10000.
const checked = (parts) => {
  const out = formatYmd(parts);
  if (!parseYmd(out)) throw new RangeError(`La fecha calculada ${out} queda fuera del rango válido`);
  return out;
};

const addDays = (ymd, days) => {
  if (!Number.isInteger(days)) throw new RangeError('addDays requiere un entero de días');
  return checked(fromDayNumber(toDayNumber(requireYmd(ymd)) + days));
};

// Suma meses conservando el día; si el mes destino es más corto, se ajusta
// al último día (31 ene + 1 mes = 28/29 feb). Nunca desborda al mes siguiente.
const addMonths = (ymd, months) => {
  if (!Number.isInteger(months)) throw new RangeError('addMonths requiere un entero de meses');
  const { y, m, d } = requireYmd(ymd);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  if (ny < 1970 || ny > 9999) throw new RangeError('La fecha calculada queda fuera del rango válido');
  return checked({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
};

const compareYmd = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const todayInTimeZone = (now = new Date(), timeZone = DEFAULT_TIME_ZONE) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

module.exports = {
  DEFAULT_TIME_ZONE,
  parseYmd,
  isValidYmd,
  addDays,
  addMonths,
  compareYmd,
  todayInTimeZone,
};
