// Formatação da folha digital: horários no fuso do torneio (inclui sessões que passam da meia-noite) e cor por sessão.
export function fmtTime(iso, tz) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz || undefined }); } catch { return '—'; }
}
export function fmtDateTime(iso, tz) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: tz || undefined }); } catch { return '—'; }
}
export function fmtDuration(ms) {
  if (ms == null) return '—';
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}
/** Etiqueta de cor estável por sessão (classe de badge do design system). */
const BADGES = ['badge-brand', 'badge-info', 'badge-ok', 'badge-warn', 'badge-neutral'];
export function sessionBadge(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return BADGES[h % BADGES.length];
}
export function cacheKey(userId, sid) { return `genesis:tracking:${userId || 'anon'}:${sid}`; }
