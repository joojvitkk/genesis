// Inscrições × ativos (BUG-04/05), agora POR SESSÃO (Simulação 2.1 §4). Duas coisas diferentes, nunca misturadas:
//   • inscrições  = entradas iniciais (buy-in) + reentradas da sessão — acumulado do histórico (add-on não é inscrição);
//   • ativos      = quem ainda está jogando = inscrições − eliminações, ajustado pelo Salão (`active_offset` da sessão).
// O Salão pode "informar" os ativos: guardamos só a diferença para o derivado (offset), então entradas e
// eliminações lançadas depois continuam movendo o número. Nada do histórico (entradas, eliminações) é alterado.
//
// Dia Final (type FINAL): não tem buy-in nem reentrada. Os jogadores iniciais são a SOMA dos classificados das
// sessões classificatórias encerradas; o Salão só controla os ativos (e as eliminações).
// Torneio sem sessões (dados anteriores ao G4): conta no próprio torneio, como antes.
const { Tournament, TournamentSession, TournamentEntry, Elimination } = require('../models');
const { HttpError } = require('./catalog');
const sessionsLib = require('./sessions');

/** Entradas próprias (buy-in, reentrada, add-on) e eliminações de um escopo. */
async function ownCounts(scope) {
  const [initial, reentries, addons, eliminated] = await Promise.all([
    TournamentEntry.countDocuments({ ...scope, type: 'buy-in' }),
    TournamentEntry.countDocuments({ ...scope, type: 're-entry' }),
    TournamentEntry.countDocuments({ ...scope, type: 'add-on' }),
    Elimination.countDocuments({ ...scope, position: { $gt: 1 } }),
  ]);
  return { entries_initial: initial, entries_reentries: reentries, entries_total: initial + reentries, addons, eliminated };
}

/**
 * Durante o dia: eliminados = inscrições − jogando (a conferência do floor ajusta o jogando). Sessão ENCERRADA com
 * classificados: o dia fechou com esse número ("Jogando" = classificados). Os toques de eliminação ficam em `eliminated_taps`.
 */
function closedView(session, out, startingPlayers) {
  const closed = session.status === 'finished' && session.qualified_count != null && sessionsLib.hasQualified(session);
  const active = closed ? session.qualified_count : out.active;
  // eliminados = tudo que entrou (herdados + inscrições) − jogando; os toques de "−1 eliminação" ficam só como detalhe
  return { ...out, eliminated_taps: out.eliminated, eliminated: Math.max(0, startingPlayers + out.entries_total - active), active, ...(closed ? { closed: true } : {}) };
}

/** Contagens de UMA sessão (`session` = documento) ou, sem sessões, do torneio. `active` nunca fica negativo. */
async function countsFor(tournamentId, session) {
  const scope = session ? { tournament_id: tournamentId, session_id: session._id } : { tournament_id: tournamentId };
  const offset = (session ? session.active_offset : (await Tournament.findById(tournamentId).select('active_offset').lean())?.active_offset) || 0;

  if (session && sessionsLib.isInheriting(session)) {
    // Fases de continuação (Dia 2, 3…, Final): iniciam com os classificados da fase anterior; se a sessão permitir, novas
    // inscrições SOMAM-se a eles (sem duplicar os classificados).
    const starting = await sessionsLib.qualifiedTotal(tournamentId, session);
    const own = await ownCounts(scope);
    const eliminated = own.eliminated;
    const derived = Math.max(0, starting + own.entries_total - eliminated);
    // Histórico HERDADO (Simulação 3.0 §1): somatório válido da(s) fase(s) anterior(es), só para consulta.
    const sources = sessionsLib.sourceSessions(await sessionsLib.listSessions(tournamentId), session).filter((x) => x.status === 'finished');
    const hist = await Promise.all(sources.map((q) => countsFor(tournamentId, q)));
    const inherited = {
      entries_initial: hist.reduce((a, c) => a + c.entries_initial + (c.inherited?.entries_initial || 0), 0),
      entries_reentries: hist.reduce((a, c) => a + c.entries_reentries + (c.inherited?.entries_reentries || 0), 0),
    };
    inherited.entries_total = inherited.entries_initial + inherited.entries_reentries;
    return closedView(session, {
      session_id: String(session._id), session_type: session.type, entries_initial: own.entries_initial, entries_reentries: own.entries_reentries,
      entries_total: own.entries_total, addons: own.addons,
      inherited, starting_players: starting, eliminated, derived, offset, active: Math.max(0, derived + offset),
    }, starting);
  }
  const [initial, reentries, addons, eliminated] = await Promise.all([
    TournamentEntry.countDocuments({ ...scope, type: 'buy-in' }),
    TournamentEntry.countDocuments({ ...scope, type: 're-entry' }),
    TournamentEntry.countDocuments({ ...scope, type: 'add-on' }),
    Elimination.countDocuments({ ...scope, position: { $gt: 1 } }), // posição 1 = campeã, não é eliminada
  ]);
  const entriesTotal = initial + reentries;
  const derived = Math.max(0, entriesTotal - eliminated);
  const out = {
    session_id: session ? String(session._id) : null, session_type: session?.type || null,
    entries_initial: initial, entries_reentries: reentries, entries_total: entriesTotal, addons, eliminated, derived, offset, active: Math.max(0, derived + offset),
  };
  return session ? closedView(session, out, 0) : out;
}

/**
 * Contagens do torneio. Com `sessionId`: SÓ aquela sessão (é o que toda ação operacional usa). Sem: agregado do
 * torneio — entradas e eliminações somadas; ativos = os das sessões ainda não encerradas (as encerradas viram
 * "classificados").
 */
async function playerCounts(tournamentId, sessionId = null) {
  const sessions = await sessionsLib.listSessions(tournamentId);
  if (sessionId) {
    const session = sessions.find((s) => String(s._id) === String(sessionId));
    if (!session) throw new HttpError(404, 'Sessão não encontrada neste torneio.');
    return countsFor(tournamentId, session);
  }
  if (!sessions.length) return countsFor(tournamentId, null);
  const per = await Promise.all(sessions.map((s) => countsFor(tournamentId, s)));
  const sum = (f) => per.reduce((a, c) => a + c[f], 0);
  const open = per.filter((_, i) => sessions[i].status !== 'finished');
  const active = open.reduce((a, c) => a + c.active, 0);
  return {
    entries_initial: sum('entries_initial'), entries_reentries: sum('entries_reentries'), entries_total: sum('entries_total'),
    addons: sum('addons'), eliminated: sum('eliminated'), derived: open.reduce((a, c) => a + c.derived, 0), offset: sum('offset'), active,
    sessions: per,
  };
}

/** Recalcula os caches (sessões e torneio) e avisa os clientes. Devolve as contagens da sessão pedida (ou do torneio). */
async function refreshPlayers(tournamentId, io, sessionId = null) {
  const sessions = await sessionsLib.listSessions(tournamentId);
  for (const s of sessions) {
    const c = await countsFor(tournamentId, s);
    // Dia Final: o cache de entradas guarda o histórico herdado dos classificatórios (só leitura no relógio e nos cards)
    const shown = c.inherited
      ? { entries_initial: c.inherited.entries_initial + c.entries_initial, entries_reentries: c.inherited.entries_reentries + c.entries_reentries }
      : c;
    await TournamentSession.updateOne({ _id: s._id }, { $set: { actual_players: c.active, entries_initial: shown.entries_initial, entries_reentries: shown.entries_reentries } });
  }
  const total = await playerCounts(tournamentId);
  await Tournament.updateOne({ _id: tournamentId }, { $set: { actual_players: total.active, entries_initial: total.entries_initial, entries_reentries: total.entries_reentries } });
  const out = sessionId ? await playerCounts(tournamentId, sessionId) : total;
  io?.emit('playersChanged', { tournament_id: tournamentId, session_id: sessionId || null, ...out });
  if (sessionId) require('./blindRules').evaluate(sessionId, io); // regras: jogadores ≤ N / ações ≥ Y
  return out;
}

/** O Salão informa quantos jogadores estão ativos agora (na sessão). Devolve { before, after, counts }. */
async function setActivePlayers(tournamentId, value, io, sessionId = null) {
  const n = value === null || value === '' || value === undefined ? NaN : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100000) {
    const e = new Error('Informe um número inteiro de jogadores ativos (0 ou mais).'); e.status = 400; throw e;
  }
  const before = await playerCounts(tournamentId, sessionId);
  if (sessionId) await TournamentSession.updateOne({ _id: sessionId }, { $set: { active_offset: n - before.derived } });
  else await Tournament.updateOne({ _id: tournamentId }, { $set: { active_offset: n - before.derived } });
  const counts = await refreshPlayers(tournamentId, io, sessionId);
  return { before: before.active, after: counts.active, counts };
}

module.exports = { playerCounts, refreshPlayers, setActivePlayers };
