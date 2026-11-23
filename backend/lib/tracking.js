// Tracking Sheet da sessão (itens 2 e 11) e painel "Salão agora" (item 9).
// A folha digital junta: cabeçalho (torneio e sessões, SEM valores em dinheiro e SEM stack inicial), grade de níveis (horário REAL
// nos níveis jogados, PREVISTO nos próximos — recalculado com o tempo restante e as pausas) e rodapé (classificados, encerramento).
const { Tournament, TournamentSession, SessionLevelLog } = require('../models');
const sessionsLib = require('./sessions');
const clock = require('./tournamentClock');
const dayClosing = require('./dayClosing');
const { HttpError } = require('./catalog');

const isLevel = (r) => !r.row_type || r.row_type === 'level';

/**
 * Horários por linha da estrutura. Função pura (testável).
 * @param rows        estrutura da sessão
 * @param view        { current_level, clock_status, level_started_at, paused_at, clock_adjust_seconds, level_offset }
 * @param logs        registros por nível (mais antigos primeiro); o último fechado de cada linha vale como "jogado"
 * @param startsAt    início previsto da sessão (para sessão ainda não iniciada)
 */
function forecastRows(rows, view, logs, startsAt, now = Date.now()) {
  const closedBy = new Map();
  for (const l of logs) if (l.status === 'closed') closedBy.set(l.row_index, l);
  const started = !!view.level_started_at && view.clock_status !== 'stopped' || logs.length > 0;
  const cur = view.current_level || 0;
  const out = [];
  let cursor = null; // instante em que a linha seguinte começa (previsto)

  rows.forEach((row, idx) => {
    const dur = clock.levelDurationMs(row);
    const num = clock.levelNumber(rows, idx);
    const base = {
      index: idx, row_type: row.row_type || 'level', label: row.label || null,
      level_number: num === null ? null : num + (view.level_offset || 0),
      small_blind: isLevel(row) ? row.small_blind : null, big_blind: isLevel(row) ? row.big_blind : null, ante: isLevel(row) ? row.ante || 0 : null,
      duration_min: Number(row.duration) || 0,
    };
    const played = closedBy.get(idx);
    if (played) {
      out.push({ ...base, kind: 'actual', start: played.started_at, end: played.ended_at, duration_ms: played.duration_ms, log_id: String(played._id), entries_total: played.entries_total, entries_initial: played.entries_initial, entries_reentries: played.entries_reentries, playing: played.playing, floor_counts: played.floor_counts || [] });
      return;
    }
    if (idx === cur && started) {
      const open = logs.find((l) => l.status === 'open' && l.row_index === idx);
      const start = open?.started_at || view.level_started_at;
      const end = new Date(now + clock.remainingMs({ blind_structure: rows, ...view }, now));
      cursor = end.getTime();
      out.push({ ...base, kind: 'current', start, end, log_id: open ? String(open._id) : null, entries_total: open?.entries_total ?? null, entries_initial: open?.entries_initial ?? null, entries_reentries: open?.entries_reentries ?? null, playing: open?.playing ?? null, floor_counts: open?.floor_counts || [] });
      return;
    }
    if (idx < cur && started) { out.push({ ...base, kind: 'skipped', start: null, end: null }); return; }
    if (cursor === null) cursor = startsAt ? new Date(startsAt).getTime() : null; // sessão ainda não começou
    const start = cursor === null ? null : new Date(cursor);
    const end = cursor === null ? null : new Date(cursor + dur);
    if (cursor !== null) cursor += dur;
    out.push({ ...base, kind: 'forecast', start, end });
  });
  return out;
}

async function trackingSheet(tournamentId, sessionId) {
  const tournament = await Tournament.findById(tournamentId).lean();
  if (!tournament) throw new HttpError(404, 'Torneio não encontrado.');
  const all = await sessionsLib.listSessions(tournamentId);
  const session = all.find((s) => String(s._id) === String(sessionId));
  if (!session) throw new HttpError(404, 'Sessão não encontrada neste torneio.');
  const view = sessionsLib.clockView(tournament, session);
  const rows = view.blind_structure || [];
  const logs = await SessionLevelLog.find({ session_id: session._id }).sort({ seq: 1 }).lean();
  const grid = forecastRows(rows, view, logs, session.starts_at || tournament.starts_at);

  const markerEnd = (type) => grid.find((r) => r.row_type === type)?.end || null;
  const regRow = grid.findIndex((r) => r.row_type === 'end_registration');
  const regLevel = regRow > 0 ? [...grid.slice(0, regRow)].reverse().find((r) => r.level_number != null)?.level_number ?? null : null;
  const firstLevel = rows.find(isLevel);

  const sessionsHeader = [];
  for (const s of all) {
    const v = sessionsLib.clockView(tournament, s);
    const rws = v.blind_structure || [];
    const idx = rws.findIndex((r) => r.row_type === 'end_registration');
    sessionsHeader.push({
      _id: String(s._id), name: s.name, type: s.type, status: s.status, starts_at: s.starts_at || null,
      level_minutes: Number(rws.find(isLevel)?.duration) || null,
      registration_until_level: idx > 0 ? (clock.levelNumber(rws, rws.slice(0, idx).map((_, i) => i).reverse().find((i) => isLevel(rws[i]))) ?? null) : null,
    });
  }

  return {
    server_time: Date.now(),
    tournament: { _id: String(tournament._id), name: tournament.name, number: tournament.number, timezone: tournament.timezone, rules: tournament.notes || null },
    sessions: sessionsHeader,
    session: { _id: String(session._id), name: session.name, type: session.type, status: session.status, clock_status: session.clock_status, current_level: session.current_level, level_minutes: Number(firstLevel?.duration) || null, registration_until_level: regLevel },
    has_history: logs.length > 0,
    rows: grid,
    forecast: { registration_ends_at: markerEnd('end_registration'), day_ends_at: markerEnd('end_day') },
    day: await dayClosing.sessionSummary(tournamentId, session._id),
    tournament_summary: all.length > 1 ? await dayClosing.tournamentSummary(tournamentId) : null,
  };
}

/** Painel "Salão agora": sessões abertas ou em andamento de todos os torneios do escopo, por horário de início. */
async function salaoNow(allowedIds) {
  const filter = { status: { $in: ['scheduled', 'running', 'paused'] } };
  if (allowedIds) filter.tournament_id = { $in: allowedIds };
  const sessions = await TournamentSession.find({ ...filter, $or: [{ status: { $in: ['running', 'paused'] } }, { clock_status: { $ne: 'stopped' } }, { starts_at: { $ne: null } }] }).lean();
  const tIds = [...new Set(sessions.map((s) => String(s.tournament_id)))];
  const tournaments = new Map((await Tournament.find({ _id: { $in: tIds }, status: { $nin: ['finished', 'finalized'] } }).lean()).map((t) => [String(t._id), t]));
  const now = Date.now();
  const list = sessions.filter((s) => tournaments.has(String(s.tournament_id))).map((s) => {
    const t = tournaments.get(String(s.tournament_id));
    const view = sessionsLib.clockView(t, s);
    const p = clock.clockPayload(view, now);
    return {
      tournament_id: String(t._id), tournament_number: t.number, tournament_name: t.name,
      session_id: String(s._id), session_name: s.name, session_type: s.type, status: s.status,
      variant: /turbo|hyper/i.exec(`${t.name} ${s.name}`)?.[0]?.toUpperCase() || null,
      starts_at: s.starts_at || t.starts_at || null, timezone: t.timezone,
      clock_status: p.clock_status, level_number: p.level_number, remaining_ms: p.remaining_ms, is_break: p.is_break, server_time: now,
      entries_total: (s.entries_initial || 0) + (s.entries_reentries || 0), playing: s.actual_players || 0, chip_count_total: t.chips_value_in_play ?? 0,
    };
  });
  list.sort((a, b) => (new Date(a.starts_at || 0) - new Date(b.starts_at || 0)) || String(a.session_name).localeCompare(String(b.session_name)));
  return list;
}

module.exports = { forecastRows, trackingSheet, salaoNow };
