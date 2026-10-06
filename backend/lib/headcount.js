// Inscrições × ativos (BUG-04/05). Duas coisas diferentes, nunca misturadas:
//   • inscrições  = entradas iniciais (buy-in) + reentradas — acumulado do histórico (add-on não é inscrição);
//   • ativos      = quem ainda está jogando = inscrições − eliminações, ajustado pelo Salão (`active_offset`).
// O Salão pode "informar" os ativos: guardamos só a diferença para o derivado (offset), então entradas e
// eliminações lançadas depois continuam movendo o número. Nada do histórico (entradas, eliminações) é alterado.
const { Tournament, TournamentEntry, Elimination } = require('../models');

/** Contagens do torneio (todas as sessões somadas). `active` nunca fica negativo. */
async function playerCounts(tournamentId) {
  const t = await Tournament.findById(tournamentId).select('active_offset').lean();
  const [initial, reentries, addons, eliminated] = await Promise.all([
    TournamentEntry.countDocuments({ tournament_id: tournamentId, type: 'buy-in' }),
    TournamentEntry.countDocuments({ tournament_id: tournamentId, type: 're-entry' }),
    TournamentEntry.countDocuments({ tournament_id: tournamentId, type: 'add-on' }),
    Elimination.countDocuments({ tournament_id: tournamentId, position: { $gt: 1 } }), // posição 1 = campeã, não é eliminada
  ]);
  const entriesTotal = initial + reentries;
  const derived = Math.max(0, entriesTotal - eliminated);
  const offset = t?.active_offset || 0;
  return { entries_initial: initial, entries_reentries: reentries, entries_total: entriesTotal, addons, eliminated, derived, offset, active: Math.max(0, derived + offset) };
}

/** Recalcula os caches do torneio (`actual_players` = ativos) e avisa os clientes. */
async function refreshPlayers(tournamentId, io) {
  const c = await playerCounts(tournamentId);
  await Tournament.updateOne({ _id: tournamentId }, { $set: { actual_players: c.active, entries_initial: c.entries_initial, entries_reentries: c.entries_reentries } });
  io?.emit('playersChanged', { tournament_id: tournamentId, ...c });
  return c;
}

/** O Salão informa quantos jogadores estão ativos agora. Devolve { before, after, counts }. */
async function setActivePlayers(tournamentId, value, io) {
  const n = value === null || value === '' || value === undefined ? NaN : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100000) {
    const e = new Error('Informe um número inteiro de jogadores ativos (0 ou mais).'); e.status = 400; throw e;
  }
  const before = await playerCounts(tournamentId);
  await Tournament.updateOne({ _id: tournamentId }, { $set: { active_offset: n - before.derived } });
  const counts = await refreshPlayers(tournamentId, io);
  return { before: before.active, after: counts.active, counts };
}

module.exports = { playerCounts, refreshPlayers, setActivePlayers };
