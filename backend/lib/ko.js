// Fichas KO (Simulação 3.0 §5) — estoque FÍSICO, sem financeiro.
//   • cadastro (KoChip): cor/tipo e quantidade física;  • livro (KoMovement): envio, retorno, conferência, fechamento.
//   • torneio KO: 1 ficha por ação válida (buy-ins + reentradas não canceladas). As fichas passam entre jogadores sem baixa
//     a cada eliminação e NÃO entram no Chip Count.
//   • conferência: distribuídas × devolvidas; a diferença fica PENDENTE com justificativa (não é perda automática) e
//     devoluções posteriores são aceitas até o fechamento da etapa.
const mongoose = require('mongoose');
const { Tournament, TournamentEntry, KoChip, KoMovement } = require('../models');
const { HttpError } = require('./catalog');

const oid = (x) => new mongoose.Types.ObjectId(String(x));
const actor = (user) => user?.name || user?.email || 'Sistema';

/** Ações válidas = buy-ins + reentradas não canceladas (add-on não gera ficha KO). */
async function validActions(tournamentId) {
  return TournamentEntry.countDocuments({ tournament_id: tournamentId, status: { $ne: 'cancelled' }, type: { $in: ['buy-in', 're-entry'] } });
}

async function sums(match) {
  const rows = await KoMovement.aggregate([{ $match: match }, { $group: { _id: '$type', q: { $sum: '$quantity' } } }]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.q]));
  return { sent: by.SEND || 0, returned: by.RETURN || 0 };
}

/** Estoque de um cadastro: total físico, fora (enviado − devolvido em qualquer torneio) e disponível. */
async function stockOf(koChip) {
  const { sent, returned } = await sums({ ko_chip_id: koChip._id });
  const out = Math.max(0, sent - returned);
  return { quantity: koChip.quantity, out, available: Math.max(0, koChip.quantity - out) };
}

async function listChips() {
  const chips = await KoChip.find().sort({ name: 1 });
  return Promise.all(chips.map(async (c) => ({ ...c.toJSON(), stock: await stockOf(c) })));
}

const cleanQty = (v, label = 'Quantidade') => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) throw new HttpError(400, `${label} deve ser um inteiro ≥ 1.`);
  return n;
};

/** Posição das fichas KO de um torneio. */
async function summary(tournament) {
  const base = { tournament_id: tournament._id, is_ko: !!tournament.is_ko, closed: !!tournament.ko_closed_at, closed_at: tournament.ko_closed_at || null };
  if (!tournament.is_ko || !tournament.ko_chip_id) return { ...base, ko_chip: null, distributed: 0, sent: 0, returned: 0, pending: 0, surplus: 0, log: [] };
  const [chip, distributed, tot, log] = await Promise.all([
    KoChip.findById(tournament.ko_chip_id).setOptions({ withDeleted: true }),
    validActions(tournament._id),
    sums({ tournament_id: tournament._id }),
    KoMovement.find({ tournament_id: tournament._id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  return {
    ...base, ko_chip: chip ? { ...chip.toJSON(), stock: await stockOf(chip) } : null,
    distributed,                                       // 1 ficha KO por ação válida
    sent: tot.sent, returned: tot.returned,
    pending: Math.max(0, distributed - tot.returned),  // distribuídas que ainda não voltaram
    surplus: Math.max(0, tot.returned - distributed),
    log,
  };
}

function assertKo(tournament) {
  if (!tournament.is_ko || !tournament.ko_chip_id) throw new HttpError(409, 'Este torneio não é KO.');
}
function assertOpen(tournament) {
  if (tournament.ko_closed_at) throw new HttpError(409, 'A etapa KO está fechada: não aceita novos lançamentos.');
}

async function send(tournament, body, user) {
  assertKo(tournament); assertOpen(tournament);
  const quantity = cleanQty(body?.quantity);
  const chip = await KoChip.findById(tournament.ko_chip_id);
  if (!chip) throw new HttpError(404, 'Ficha KO não encontrada.');
  const stock = await stockOf(chip);
  if (quantity > stock.available) throw new HttpError(409, `Estoque KO insuficiente: disponíveis ${stock.available} de ${stock.quantity}.`);
  return new KoMovement({ ko_chip_id: chip._id, tournament_id: tournament._id, type: 'SEND', quantity, note: body?.note, user_name: actor(user) }).save();
}

async function returnChips(tournament, body, user) {
  assertKo(tournament); assertOpen(tournament);
  const quantity = cleanQty(body?.quantity);
  const { sent, returned } = await sums({ tournament_id: tournament._id });
  if (returned + quantity > sent) throw new HttpError(409, `Não é possível devolver mais do que foi enviado (enviadas ${sent}, já devolvidas ${returned}).`);
  return new KoMovement({ ko_chip_id: tournament.ko_chip_id, tournament_id: tournament._id, type: 'RETURN', quantity, note: body?.note, user_name: actor(user) }).save();
}

/** Conferência: grava distribuídas × devolvidas e, se sobrar pendência, o motivo (obrigatório). Não gera perda. */
async function conference(tournament, body, user) {
  assertKo(tournament); assertOpen(tournament);
  const s = await summary(tournament);
  const reason = String(body?.reason || '').trim();
  if (s.pending > 0 && !reason) throw new HttpError(400, `Há ${s.pending} ficha(s) KO pendente(s): informe o motivo.`);
  return new KoMovement({
    ko_chip_id: tournament.ko_chip_id, tournament_id: tournament._id, type: 'CONFERENCE',
    distributed: s.distributed, returned: s.returned, pending: s.pending, note: reason || undefined, user_name: actor(user),
  }).save();
}

/** Fecha a etapa: depois disso não há mais devoluções. Exige conferência com motivo quando há pendência. */
async function close(tournament, body, user) {
  assertKo(tournament); assertOpen(tournament);
  const s = await summary(tournament);
  if (s.pending > 0) {
    const conferred = await KoMovement.findOne({ tournament_id: tournament._id, type: 'CONFERENCE', pending: s.pending, note: { $exists: true, $ne: '' } });
    if (!conferred) throw new HttpError(409, `Há ${s.pending} ficha(s) KO pendente(s): registre a conferência com o motivo antes de fechar.`);
  }
  await Tournament.updateOne({ _id: tournament._id }, { $set: { ko_closed_at: new Date() } });
  return new KoMovement({
    ko_chip_id: tournament.ko_chip_id, tournament_id: tournament._id, type: 'CLOSE',
    distributed: s.distributed, returned: s.returned, pending: s.pending, note: body?.note, user_name: actor(user),
  }).save();
}

/** Valida o par (is_ko, ko_chip_id) vindo do cliente. Só devolve as chaves informadas. */
async function normalizeTournamentKo(body) {
  const out = {};
  if (body.is_ko === undefined && body.ko_chip_id === undefined) return out;
  const isKo = body.is_ko === true || body.is_ko === 'true';
  out.is_ko = isKo;
  if (!isKo) { out.ko_chip_id = null; return out; }
  if (!body.ko_chip_id || !mongoose.isValidObjectId(body.ko_chip_id) || !(await KoChip.exists({ _id: oid(body.ko_chip_id) }))) {
    throw new HttpError(400, 'Torneio KO: selecione a ficha KO.');
  }
  out.ko_chip_id = body.ko_chip_id;
  return out;
}

module.exports = { listChips, stockOf, summary, send, returnChips, conference, close, normalizeTournamentKo, validActions };
