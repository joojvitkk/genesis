// Chamados de Chip Race / Color Up (MEL-02): solicitação do Salão → atendimento do Material.
// Simulação 2.1 §9: o chamado é POR SESSÃO e traz a denominação a retirar; o cálculo usa só a sessão. Estados:
// SOLICITADO (requested) → EM_PREPARO (in_preparation) → PRONTO (ready, opcional) → CONCLUÍDO (completed) | CANCELADO.
// Cada chamado é independente: cancelar um não afeta o próximo, e uma nova solicitação nasce com id e estado limpos.
const mongoose = require('mongoose');
const { ConversionRequest, Tournament, Conversion, Chip } = require('../models');
const { HttpError } = require('./catalog');
const sessionsLib = require('./sessions');
const players = require('./headcount');
const tournamentChips = require('./tournamentChips');

const OPEN = ['requested', 'in_preparation', 'ready'];
// quem avança cada passo é validado na rota (material/admin atendem; salão/admin cancelam)
const NEXT = { requested: ['in_preparation', 'cancelled'], in_preparation: ['ready', 'cancelled'], ready: ['cancelled'] };

/**
 * Estimativa da distribuição por mesa — LÓGICA PURA. Base: mesas reais, jogadores ativos DA SESSÃO e a quantidade EM JOGO da
 * denominação a retirar. Arredondamento operacional: sempre PARA CIMA (não faltar ficha na mesa). Só orienta; o lançamento do
 * que foi realmente retirado/entregue é a Conversion.
 */
function estimate({ tables, active, entriesTotal, chip, inPlay }) {
  const t = Number(tables);
  return {
    base: { tables: t, active_players: active, entries_total: entriesTotal, chip_id: String(chip._id), chip_value: chip.value },
    rounding: 'up',
    players_per_table: active > 0 ? Math.ceil(active / t) : null,
    per_table: [{ chip_id: String(chip._id), value: chip.value, in_play: inPlay, per_table: Math.ceil(inPlay / t) }],
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
  // a SESSÃO é obrigatória quando o torneio tem várias: o cálculo nunca mistura 1A com 1B
  if (!body.session_id && (await sessionsLib.listSessions(tournament._id)).length > 1) throw new HttpError(400, 'Selecione a sessão: o Chip Race / Color Up é calculado por sessão.');
  const session = await sessionsLib.resolveSession(tournament._id, body.session_id, { open: true });
  if (!mongoose.isValidObjectId(body?.chip_id)) throw new HttpError(400, 'Selecione a denominação que será retirada de jogo.');
  const chip = await Chip.findById(body.chip_id).setOptions({ withDeleted: true }).select('name value color');
  if (!chip) throw new HttpError(404, 'Ficha não encontrada.');

  const counts = await players.playerCounts(tournament._id, session?._id || null);
  const inPlay = await tournamentChips.chipsInPlay(tournament._id, { sessionId: session?._id });
  const inPlayQty = inPlay.rows.find((r) => String(r.chip._id) === String(chip._id))?.quantity || 0;
  const doc = await new ConversionRequest({
    tournament_id: tournament._id, session_id: session?._id || null, type: body.type, chip_id: chip._id, tables,
    note: body.note ? String(body.note).trim() : undefined,
    snapshot: {
      session_name: session?.name || null,
      active_players: counts.active, entries_initial: counts.entries_initial, entries_reentries: counts.entries_reentries, entries_total: counts.entries_total,
      chip_value: chip.value, in_play_quantity: inPlayQty,
      provisional: registrationOpen(tournament), // entradas ainda podem mudar: a estimativa é provisória; a troca executada não é reescrita
      taken_at: new Date(),
    },
    estimate: estimate({ tables, active: counts.active, entriesTotal: counts.entries_total, chip, inPlay: inPlayQty }),
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
async function assertOpen(requestId, { tournament_id, type, session_id } = {}) {
  const doc = await ConversionRequest.findById(requestId);
  if (!doc) throw new HttpError(404, 'Chamado não encontrado.');
  if (!OPEN.includes(doc.status)) throw new HttpError(409, `Este chamado já foi ${doc.status === 'completed' ? 'concluído' : 'cancelado'}. Para uma nova troca, crie um novo chamado.`);
  if (tournament_id && String(doc.tournament_id) !== String(tournament_id)) throw new HttpError(409, 'O chamado é de outro torneio.');
  if (session_id && doc.session_id && String(doc.session_id) !== String(session_id)) throw new HttpError(409, 'O chamado é de outra sessão.');
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
