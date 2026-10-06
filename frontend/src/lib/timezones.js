import { locale } from './i18n-runtime/translate';
// Fusos horários oferecidos ao cadastrar/editar um torneio: o do salão onde o torneio acontece.
// Rótulo: "(UTC−03:00) Brasília e São Paulo" — o deslocamento é calculado na hora (respeita horário de verão).
export const TIMEZONES = [
  { value: 'America/Noronha', name: 'Fernando de Noronha' },
  { value: 'America/Sao_Paulo', name: 'Brasília, São Paulo e Rio de Janeiro' },
  { value: 'America/Cuiaba', name: 'Cuiabá e Campo Grande' },
  { value: 'America/Manaus', name: 'Manaus' },
  { value: 'America/Rio_Branco', name: 'Rio Branco' },
  { value: 'America/Argentina/Buenos_Aires', name: 'Buenos Aires' },
  { value: 'America/New_York', name: 'Nova York' },
  { value: 'America/Chicago', name: 'Chicago' },
  { value: 'America/Los_Angeles', name: 'Las Vegas e Los Angeles' },
  { value: 'Europe/Lisbon', name: 'Lisboa' },
  { value: 'Europe/Madrid', name: 'Madri' },
  { value: 'UTC', name: 'UTC' },
];

/** Deslocamento do fuso em minutos para um instante (ex.: −180). */
export function offsetMinutes(timeZone, at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(at);
    const v = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
    const asUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch { return 0; }
}

/** "UTC−03:00" / "UTC+01:00" / "UTC". */
export function formatOffset(minutes) {
  if (!minutes) return 'UTC';
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Opções para o CustomSelect, ordenadas do mais a oeste para o mais a leste; mantém um fuso salvo que não está na lista. */
export function timezoneOptions(current, at = new Date()) {
  const list = TIMEZONES.some((t) => t.value === current) || !current ? TIMEZONES : [...TIMEZONES, { value: current, name: String(current).split('/').pop().replace(/_/g, ' ') }];
  return list
    .map((t) => ({ ...t, offset: offsetMinutes(t.value, at) }))
    .sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name, locale()))
    .map((t) => ({ value: t.value, label: `(${formatOffset(t.offset)}) ${t.name}` }));
}
