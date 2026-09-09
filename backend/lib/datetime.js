// Combina a data (armazenada como meia-noite UTC) + horário "HH:MM" + fuso
// num instante real (Date UTC). Sem dependência: usa Intl para achar o offset
// do fuso naquela data (respeita horário de verão).

const DEFAULT_TZ = process.env.TZ_DEFAULT || 'America/Sao_Paulo';

/** offset do fuso `tz` (em ms) para um dado instante UTC. */
function tzOffsetMs(utcMillis, tz) {
  const d = new Date(utcMillis);
  const asTz = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const asUtc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return asTz.getTime() - asUtc.getTime();
}

/**
 * @param {Date|string} date  data (só o dia importa)
 * @param {string} startTime  "20:00"
 * @param {string} tz          ex. "America/Sao_Paulo"
 * @returns {Date|null}
 */
function computeStartsAt(date, startTime, tz = DEFAULT_TZ) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;

  const [h = 0, m = 0] = String(startTime || '00:00').split(':').map((n) => Number(n) || 0);
  const wallUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0);

  // itera 2x porque o offset pode mudar perto da transição de horário de verão
  let instant = wallUtc - tzOffsetMs(wallUtc, tz);
  instant = wallUtc - tzOffsetMs(instant, tz);
  return new Date(instant);
}

module.exports = { computeStartsAt, tzOffsetMs, DEFAULT_TZ };
