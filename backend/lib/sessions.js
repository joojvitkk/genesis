// Sessões/fases de um torneio (G4): resolução da sessão "atual", ciclo de status e contadores.
//
//   Evento → Torneio → Sessões (Dia 1A, 1B, Dia Final…)
//
// A sessão separa as AÇÕES (entradas) e as MESAS; o vínculo operacional (fichários, modelos de
// stack) é do torneio e vale para todas as sessões (spec §18.8).
const { TournamentSession, TournamentEntry } = require('../models');
const { HttpError } = require('./catalog');
const { escapeRegex } = require('../utils/sanitize');

// scheduled → running → finished. Reabrir uma sessão encerrada (finished → running) é só do admin.
const TRANSITIONS = { scheduled: ['running'], running: ['finished'], finished: ['running'] };

const listSessions = (tournamentId) => TournamentSession.find({ tournament_id: tournamentId }).sort({ order: 1, createdAt: 1 });

/**
 * Sessão a usar numa operação (entrada, mesas…).
 *  - `requested` informado → precisa pertencer ao torneio;
 *  - senão: 1 sessão → ela; várias → a única em andamento; ambíguo → 400 (exige `session_id`);
 *  - torneio SEM sessões (dados anteriores ao G4) → null (compatível).
 * `open: true` recusa sessão encerrada.
 */
async function resolveSession(tournamentId, requested, { open = false } = {}) {
  let session = null;
  if (requested) {
    session = await TournamentSession.findOne({ _id: requested, tournament_id: tournamentId });
    if (!session) throw new HttpError(404, 'Sessão não encontrada neste torneio.');
  } else {
    const all = await listSessions(tournamentId);
    if (all.length === 1) session = all[0];
    else if (all.length > 1) {
      const running = all.filter((s) => s.status === 'running');
      if (running.length !== 1) throw new HttpError(400, 'Este torneio tem várias sessões: informe a sessão (session_id).');
      session = running[0];
    }
  }
  if (session && open && session.status === 'finished') throw new HttpError(409, `A sessão "${session.name}" está encerrada.`);
  return session;
}

async function assertUniqueName(tournamentId, name, excludeId) {
  const q = { tournament_id: tournamentId, name: new RegExp(`^${escapeRegex(name)}$`, 'i') };
  if (excludeId) q._id = { $ne: excludeId };
  if (await TournamentSession.exists(q)) throw new HttpError(409, `Já existe a sessão "${name}" neste torneio.`);
}

/** Cria uma sessão no fim da sequência. */
async function createSession(tournamentId, { name, starts_at, notes } = {}) {
  const clean = String(name || '').trim();
  if (!clean) throw new HttpError(400, 'Nome da sessão é obrigatório.');
  await assertUniqueName(tournamentId, clean);
  const last = await TournamentSession.findOne({ tournament_id: tournamentId }).sort({ order: -1 });
  return new TournamentSession({
    tournament_id: tournamentId, name: clean, order: (last?.order || 0) + 1,
    starts_at: starts_at || null, notes,
  }).save();
}

/** Aplica uma mudança de status respeitando o ciclo. */
function applyStatus(session, next, { isAdmin }) {
  if (next === session.status) return session;
  if (!TRANSITIONS[session.status]?.includes(next)) {
    throw new HttpError(409, `Uma sessão "${session.status}" não pode ir para "${next}".`);
  }
  if (session.status === 'finished' && !isAdmin) throw new HttpError(403, 'Só o administrador reabre uma sessão encerrada.');
  session.status = next;
  if (next === 'running') { session.started_at = session.started_at || new Date(); session.finished_at = null; }
  if (next === 'finished') session.finished_at = new Date();
  return session;
}

/** Sessões que ainda não foram encerradas. */
const pendingSessions = (tournamentId) => TournamentSession.find({ tournament_id: tournamentId, status: { $ne: 'finished' } }).sort({ order: 1 });

/** Encerra todas as sessões pendentes (usado ao fechar o torneio). Devolve quantas encerrou. */
async function finishAll(tournamentId) {
  const pending = await pendingSessions(tournamentId);
  const now = new Date();
  for (const s of pending) {
    s.started_at = s.started_at || now;
    s.finished_at = now;
    s.status = 'finished';
    await s.save();
  }
  return pending.length;
}

/** Contadores de ações por sessão: { [sessionId|'none']: { total, by_type, by_action } }. */
async function sessionCounters(tournamentId) {
  const rows = await TournamentEntry.aggregate([
    { $match: { tournament_id: tournamentId, status: { $ne: 'cancelled' } } },
    { $group: { _id: { s: '$session_id', t: '$type', a: '$action' }, n: { $sum: 1 } } },
  ]);
  const out = {};
  for (const r of rows) {
    const k = r._id.s ? String(r._id.s) : 'none';
    const c = out[k] || (out[k] = { total: 0, by_type: {}, by_action: {} });
    c.total += r.n;
    c.by_type[r._id.t] = (c.by_type[r._id.t] || 0) + r.n;
    if (r._id.a) c.by_action[r._id.a] = (c.by_action[r._id.a] || 0) + r.n;
  }
  return out;
}

module.exports = { TRANSITIONS, listSessions, resolveSession, createSession, applyStatus, pendingSessions, finishAll, sessionCounters, assertUniqueName };
