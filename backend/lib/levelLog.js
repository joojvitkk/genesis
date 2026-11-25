// Registro automático por nível (item 1). Chamado sempre que o nível da sessão muda: avanço automático do executor,
// comandos do Salão (próximo/anterior/ir para), início/retomada e encerramento da sessão.
//
// Garantias:
//  • um único registro ABERTO por sessão (índice único parcial) e fechamento atômico (findOneAndUpdate open→closed):
//    executor e comandos simultâneos nunca duplicam um nível;
//  • falha ao gravar NUNCA derruba o relógio: é registrada no log e `reconcile` a repara no próximo tick;
//  • registro fechado é imutável; correção = nova entrada em `corrections` (valor, motivo, autor).
const { SessionLevelLog, Tournament, TournamentSession } = require('../models');
const sessionsLib = require('./sessions');
const headcount = require('./headcount');
const tournamentChips = require('./tournamentChips');
const clock = require('./tournamentClock');
const logger = require('./logger');
const { HttpError } = require('./catalog');

const CORRECTABLE = ['entries_initial', 'entries_reentries', 'playing'];

async function snapshot(session) {
  const counts = await headcount.playerCounts(session.tournament_id, session._id);
  let avg = null;
  if (counts.active > 0) {
    const inPlay = await tournamentChips.chipsInPlay(session.tournament_id, { sessionId: session._id });
    avg = Math.round((inPlay.totals?.value || 0) / counts.active);
  }
  // fases herdadas: "Inscritos" mostra o ACUMULADO do torneio (herdado + da fase), não só as entradas próprias
  const inh = counts.inherited;
  const initial = counts.entries_initial + (inh?.entries_initial || 0);
  const reentries = counts.entries_reentries + (inh?.entries_reentries || 0);
  return { entries_initial: initial, entries_reentries: reentries, entries_total: initial + reentries, playing: counts.active, avg_stack: avg };
}

const rowsOf = (tournament, session) => sessionsLib.clockView(tournament, session).blind_structure || [];

/** Fecha o registro aberto (atômico). Devolve o documento fechado ou null se outro já o fechou. */
async function closeOpen(session, { reason, now = new Date(), snap } = {}) {
  const open = await SessionLevelLog.findOne({ session_id: session._id, status: 'open' }).lean();
  if (!open) return null;
  const pausedMs = (open.paused_ms || 0) + (open.paused_since ? Math.max(0, now - open.paused_since) : 0);
  const data = snap || await snapshot(session);
  return SessionLevelLog.findOneAndUpdate(
    { _id: open._id, status: 'open' },
    { $set: { status: 'closed', ended_at: now, paused_ms: pausedMs, paused_since: null, duration_ms: Math.max(0, now - open.started_at - pausedMs), close_reason: reason || 'next', ...data } },
    { returnDocument: 'after' },
  );
}

/**
 * Garante que a sessão tenha o registro aberto da linha atual. Se a linha mudou, fecha o anterior e abre o novo.
 * Idempotente: chamá-la duas vezes seguidas para a mesma linha não cria nada.
 */
async function sync(sessionId, { reason = 'next', now = new Date(), io } = {}) {
  const session = await TournamentSession.findById(sessionId);
  if (!session) return null;
  if (session.clock_status === 'stopped' && !session.level_started_at) return null;
  const tournament = await Tournament.findById(session.tournament_id);
  if (!tournament) return null;
  const rows = rowsOf(tournament, session);
  const idx = session.current_level || 0;
  const row = rows[idx];
  if (!row) return null;

  const open = await SessionLevelLog.findOne({ session_id: session._id, status: 'open' }).lean();
  if (open && open.row_index === idx) return open; // mesma linha: nada a fazer
  if (open) await closeOpen(session, { reason, now });

  const last = await SessionLevelLog.findOne({ session_id: session._id }).sort({ seq: -1 }).select('seq').lean();
  const num = clock.levelNumber(rows, idx);
  const snap = await snapshot(session);
  try {
    const doc = await SessionLevelLog.create({
      tournament_id: session.tournament_id, session_id: session._id, seq: (last?.seq || 0) + 1,
      row_index: idx, row_type: row.row_type || 'level', level_number: num === null ? null : num + (session.level_offset || 0), label: row.label,
      small_blind: row.small_blind ?? null, big_blind: row.big_blind ?? null, ante: row.ante || 0, planned_minutes: Number(row.duration) || 0,
      started_at: session.level_started_at || now, at_start: snap, ...snap,
      ...(session.clock_status === 'paused' ? { paused_since: now } : {}),
    });
    io?.emit('sessionLevelLog', { tournament_id: String(session.tournament_id), session_id: String(session._id) });
    require('./blindRules').evaluate(session._id, io); // regras de duração: nível ≥ X (não bloqueia o relógio)
    return doc;
  } catch (e) {
    if (e.code === 11000) return SessionLevelLog.findOne({ session_id: session._id, status: 'open' }).lean(); // outro executor chegou primeiro
    throw e;
  }
}

/** Nunca lança: o relógio não pode travar por causa do registro. Falhas ficam no log e o `reconcile` repara. */
async function safe(fn, ctx) {
  try { return await fn(); } catch (err) { logger.error({ err, ...ctx }, 'level log failed (relógio segue; reconcile repara)'); return null; }
}

/** Reflete um comando do relógio: nível mudou / pausa / retomada / parada. */
async function onClockAction(sessionId, action, { io, now = new Date() } = {}) {
  return safe(async () => {
    const session = await TournamentSession.findById(sessionId);
    if (!session) return null;
    if (action === 'stop') return closeOpen(session, { reason: 'stop', now });
    if (action === 'pause') { await SessionLevelLog.updateOne({ session_id: session._id, status: 'open', paused_since: null }, { paused_since: now }); return null; }
    if (action === 'resume') {
      const open = await SessionLevelLog.findOne({ session_id: session._id, status: 'open', paused_since: { $ne: null } }).lean();
      if (open) await SessionLevelLog.updateOne({ _id: open._id, status: 'open' }, { $inc: { paused_ms: Math.max(0, now - open.paused_since) }, paused_since: null });
      return null;
    }
    return sync(sessionId, { reason: action === 'start' ? 'start' : action, now, io });
  }, { sessionId: String(sessionId), action });
}

const onAutoAdvance = (sessionId, io) => safe(() => sync(sessionId, { reason: 'auto', io }), { sessionId: String(sessionId), action: 'auto' });

/** Encerramento da sessão: fecha o nível em andamento. */
const onSessionFinished = (sessionId) => safe(async () => {
  const session = await TournamentSession.findById(sessionId);
  return session ? closeOpen(session, { reason: 'session_finished' }) : null;
}, { sessionId: String(sessionId), action: 'finish' });

/** Repara sessões em andamento sem o registro da linha atual (falha anterior, deploy no meio do nível). */
const reconcile = (sessionId, io) => safe(async () => {
  const s = await TournamentSession.findById(sessionId).select('clock_status current_level').lean();
  if (!s || s.clock_status === 'stopped') return null;
  return sync(sessionId, { reason: 'reconcile', io });
}, { sessionId: String(sessionId), action: 'reconcile' });

/**
 * Conferência do floor: liga a contagem real de jogadores ao nível em andamento (ou ao último, se o relógio está parado).
 * Chamada depois de `setActivePlayers`, que continua ajustando o `active_offset` (o histórico de ajustes não é apagado).
 */
async function recordFloorCount(sessionId, { counted, before, offsetAfter, reason, user }) {
  return safe(async () => {
    const log = await SessionLevelLog.findOne({ session_id: sessionId }).sort({ status: -1, seq: -1 }).select('_id status seq').lean();
    if (!log) return null;
    const open = await SessionLevelLog.findOne({ session_id: sessionId, status: 'open' }).select('_id').lean();
    const target = open?._id || log._id;
    return SessionLevelLog.findOneAndUpdate({ _id: target }, {
      $push: { floor_counts: { counted, calculated: before, diff: counted - before, offset_after: offsetAfter ?? null, reason: String(reason || '').trim() || undefined, user_name: user?.name || user?.email || 'Sistema' } },
      ...(open ? { $set: { playing: counted } } : {}),
    }, { returnDocument: 'after' });
  }, { sessionId: String(sessionId), action: 'floor-count' });
}

const list = (sessionId) => SessionLevelLog.find({ session_id: sessionId }).sort({ seq: 1 }).lean();

/** Correção posterior (ex.: entrada cancelada com atraso): guarda valor novo, motivo e autor; o original fica. */
async function correct(logId, { field, value, reason }, user) {
  if (!CORRECTABLE.includes(field)) throw new HttpError(400, `Campo inválido. Use: ${CORRECTABLE.join(', ')}.`);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'O valor deve ser um inteiro ≥ 0.');
  if (!String(reason || '').trim()) throw new HttpError(400, 'Informe o motivo da correção.');
  const log = await SessionLevelLog.findById(logId);
  if (!log) throw new HttpError(404, 'Registro de nível não encontrado.');
  const set = { [field]: n };
  if (field !== 'playing') set.entries_total = (field === 'entries_initial' ? n : log.entries_initial) + (field === 'entries_reentries' ? n : log.entries_reentries);
  return SessionLevelLog.findOneAndUpdate(
    { _id: log._id },
    { $set: set, $push: { corrections: { field, from: log[field], to: n, reason: String(reason).trim(), user_name: user?.name || user?.email || 'Sistema' } } },
    { returnDocument: 'after' },
  );
}

module.exports = { recordFloorCount, sync, closeOpen, onClockAction, onAutoAdvance, onSessionFinished, reconcile, list, correct, CORRECTABLE };
