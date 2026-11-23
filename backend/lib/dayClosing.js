// Fechamento do dia (item 4): resumo da sessão e resumo do torneio, calculados a partir do registro por nível e da sessão.
// Sem dinheiro (nada de ITM/premiação): só contagens, horários e duração.
const { TournamentSession, SessionLevelLog } = require('../models');
const sessionsLib = require('./sessions');
const headcount = require('./headcount');
const { HttpError } = require('./catalog');

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** "parou no nível 22, faltando 22:26" */
function stoppedMessage(session) {
  if (session.ended_level_number == null) return null;
  const rest = session.ended_remaining_ms == null ? '' : `, faltando ${mmss(session.ended_remaining_ms)}`;
  return `parou no nível ${session.ended_level_number}${rest}`;
}

async function sessionSummary(tournamentId, sessionId) {
  const session = await TournamentSession.findOne({ _id: sessionId, tournament_id: tournamentId }).lean();
  if (!session) throw new HttpError(404, 'Sessão não encontrada.');
  const logs = await SessionLevelLog.find({ session_id: session._id }).sort({ seq: 1 }).lean();
  const counts = await headcount.playerCounts(tournamentId, session._id);

  const started = logs[0]?.started_at || session.started_at || null;
  const last = logs[logs.length - 1];
  const ended = session.finished_at || last?.ended_at || null;
  const gross = started && ended ? Math.max(0, new Date(ended) - new Date(started)) : null;
  const paused = logs.reduce((t, l) => t + (l.paused_ms || 0), 0);
  const playedLogs = logs.filter((l) => (l.row_type || 'level') === 'level');
  const peak = logs.reduce((m, l) => Math.max(m, l.playing || 0, l.at_start?.playing || 0), counts.active);

  const inherited = counts.inherited?.entries_total || 0;
  return {
    session_id: String(session._id), name: session.name, type: session.type, status: session.status,
    entries_initial: counts.entries_initial, entries_reentries: counts.entries_reentries, entries_total: counts.entries_total,
    // fases de continuação: inscritos acumulados somam os herdados dos dias anteriores (até o final)
    entries_cumulative: counts.entries_total + inherited, entries_inherited: inherited,
    qualified_count: session.qualified_count ?? null, qualified_log: session.qualified_log || [],
    started_at: started, ended_at: ended,
    duration_ms: gross, duration_net_ms: gross == null ? null : Math.max(0, gross - paused), paused_ms: paused,
    stopped: stoppedMessage(session), ended_level_number: session.ended_level_number ?? null, ended_remaining_ms: session.ended_remaining_ms ?? null,
    peak_players: peak, levels_played: playedLogs.length, has_history: logs.length > 0,
  };
}

/** Resumo do torneio: junta todos os dias (substitui o resumo manual do topo de cada aba da planilha). */
async function tournamentSummary(tournamentId) {
  const sessions = await sessionsLib.listSessions(tournamentId);
  const days = [];
  for (const s of sessions) days.push(await sessionSummary(tournamentId, s._id));
  const qual = days.filter((d) => d.type === 'QUALIFIER');
  return {
    tournament_id: String(tournamentId), days,
    qualifiers: qual.map((d) => ({ session_id: d.session_id, name: d.name, entries_initial: d.entries_initial, entries_reentries: d.entries_reentries, qualified_count: d.qualified_count })),
    totals: {
      entries_initial: qual.reduce((t, d) => t + d.entries_initial, 0),
      entries_reentries: qual.reduce((t, d) => t + d.entries_reentries, 0),
      qualified: qual.reduce((t, d) => t + (d.qualified_count || 0), 0),
    },
    phase_durations: days.map((d) => ({ session_id: d.session_id, name: d.name, duration_ms: d.duration_ms, duration_net_ms: d.duration_net_ms })),
  };
}

module.exports = { sessionSummary, tournamentSummary, stoppedMessage, mmss };
