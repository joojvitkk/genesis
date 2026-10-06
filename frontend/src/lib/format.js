import { locale } from './i18n-runtime/translate';
// Formatação de data/hora de torneio respeitando o fuso salvo.

const DEFAULT_TZ = 'America/Sao_Paulo';

/** "01/10/2026 · 20:00" no fuso do torneio (usa starts_at quando existe). */
export function tournamentWhen(t, opts = {}) {
  if (!t) return '';
  const tz = t.timezone || DEFAULT_TZ;
  const d = t.starts_at ? new Date(t.starts_at) : (t.date ? new Date(t.date) : null);
  if (!d || Number.isNaN(d.getTime())) return t.start_time || '';

  const date = d.toLocaleDateString(locale(), { timeZone: tz, day: '2-digit', month: '2-digit', year: opts.year === false ? undefined : 'numeric' });
  if (t.starts_at) {
    const time = d.toLocaleTimeString(locale(), { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    return `${date} · ${time}`;
  }
  return t.start_time ? `${date} · ${t.start_time}` : date;
}

export function tournamentDate(t) {
  return tournamentWhen(t, { year: true }).split(' · ')[0];
}
