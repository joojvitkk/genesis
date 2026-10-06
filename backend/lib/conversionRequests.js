// Chamados de Chip Race / Color Up (MEL-02): solicitação do Salão → atendimento do Material.
const { ConversionRequest, Tournament, Conversion } = require('../models');
const { HttpError } = require('./catalog');
const sessionsLib = require('./sessions');
const players = require('./headcount');
const tournamentChips = require('./tournamentChips');

const OPEN = ['requested', 'in_preparation', 'ready'];
// quem avança cada passo é validado na rota (material/admin atendem; salão/admin cancelam)
const NEXT = { requested: ['in_preparation', 'cancelled'], in_preparation: ['ready', 'cancelled'], ready: ['cancelled'] };

/**
 * Estimativa da distribuição por mesa — LÓGICA PURA. Base: mesas reais, jogadores ativos e fichas em jogo por denominação.
 * Arredondamento operacional: sempre PARA CIMA (não faltar ficha na mesa). Só orienta; o lançamento do que foi
 * realmente retirado/entregue é a Conversion.
 */
function estimate({ tables, active, entriesTotal, rows }) {
  const t = Number(tables);
  return {
    base: { tables: t, active_players: active, entries_total: entriesTotal },
    rounding: 'up',
    players_per_table: active > 0 ? Math.ceil(active / t) : null,
    per_table: rows.map((r) => ({ chip_id: String(r.chip._id), value: r.chip.value, in_play: r.quantity, per_table: Math.ceil(r.quantity / t) })),
  };
}

const registrationOpen = (tournament) => {
  const rows = tournament.blind_structure || [];
  const idx = rows.findIndex((r) => r.row_type === 'end_registration');
  return idx >= 0 ? (tournament.current_level || 0) < idx : tournament.status !== 'finalized' && tournament.status !== 'finished';
};

async function create(tournamentId, body, user) {
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new HttpError(404, 'Torneio não encontrado.');
  if (['finished', 'finalized'].includes(tournament.status)) throw new HttpError(409, 'O torneio está encerrado.');
  if (!['CHIP_RACE', 'COLOR_UP'].includes(body?.type)) throw new HttpError(400, 'Tipo inválido. Use CHIP_RACE ou COLOR_UP.');
  const tables = Number(body?.tables);
  if (!Number.isInteger(tables) || tables < 1 || tables > 500) throw new HttpError(400, 'Informe a quantidade REAL de mesas abertas (inteiro ≥ 1).');
  const session = await sessionsLib.resolveSession(tournament._id, body.session_id, { open: true });

  const counts = await players.playerCounts(tournament._id);
  const inPlay = await tournamentChips.chipsInPlay(tournament._id, { sessionId: session?._id });
  const doc = await new ConversionRequest({
    tournament_id: tournament._id, session_id: session?._id || null, type: body.type, tables,
    note: body.note ? String(body.note).trim() : undefined,
    snapshot: {
      active_players: counts.active, entries_initial: counts.entries_initial, entries_reentries: counts.entries_reentries, entries_total: counts.entries_total,
      provisional: registrationOpen(tournament), // entradas ainda podem mudar: a estimativa é provisória; a troca executada não é reescrita
      taken_at: new Date(),
    },
    estimate: estimate({ tables, active: counts.active, entriesTotal: counts.entries_total, rows: inPlay.rows }),
    requested_by: user?.name || user?.email,
    history: [{ status: 'requested', by: user?.name || user?.email, note: body.note }],
  }).save();
  return doc;
}

async function advance(id, status, { user, note, role } = {}) {
  const doc = await ConversionRequest.findById(id);
  if (!doc) throw new HttpError(404, 'Chamado não encontrado.');
  if (!NEXT[doc.status]?.includes(status)) throw new HttpError(409, `Um chamado "${doc.status}" não pode ir para "${status}".`);
  const material = role === 'material' || role === 'admin';
  const hall = role === 'salao' || role === 'admin';
  if (status === 'cancelled' ? !hall && !material : !material) throw new HttpError(403, 'Quem atende o chamado é o Material; quem solicitou (Salão) pode cancelá-lo.');
  doc.status = status;
  doc.history.push({ status, by: user?.name || user?.email, note });
  return doc.save();
}

/** O chamado pode ser atendido por esta conversão? (valida ANTES de movimentar fichas) */
async function assertOpen(requestId, { tournament_id, type } = {}) {
  const doc = await ConversionRequest.findById(requestId);
  if (!doc) throw new HttpError(404, 'Chamado não encontrado.');
  if (!OPEN.includes(doc.status)) throw new HttpError(409, 'Este chamado já foi concluído ou cancelado.');
  if (tournament_id && String(doc.tournament_id) !== String(tournament_id)) throw new HttpError(409, 'O chamado é de outro torneio.');
  if (type && doc.type !== type) throw new HttpError(409, `O chamado pede ${doc.type === 'CHIP_RACE' ? 'Chip Race' : 'Color Up'}.`);
  return doc;
}

/** Vincula a conversão executada ao chamado (conclui). Não reescreve snapshot/estimativa. */
async function complete(requestId, conversion, user) {
  const doc = await assertOpen(requestId, conversion);
  doc.status = 'completed';
  doc.conversion_id = conversion._id;
  doc.history.push({ status: 'completed', by: user?.name || user?.email });
  return doc.save();
}

module.exports = { OPEN, NEXT, estimate, create, advance, complete, assertOpen, Conversion };
