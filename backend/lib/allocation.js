// Vínculo torneio ↔ fichário (Simulação 2.1 §5). Antes era uma RESERVA por denominação e quantidade; agora é só a
// escolha de QUAL fichário o torneio usa:
//   • sem quantidade, sem bloqueio: o desempenho do torneio é variável e o mesmo fichário pode atender mais de um torneio;
//   • as quantidades reais vêm das movimentações (enviado ao Salão, em jogo, retorno, Chip Race, perdas, conferência);
//   • o vínculo some da operação quando o torneio encerra (fica no histórico como `released`).
// (A coleção continua se chamando Allocation por compatibilidade com o histórico.)
const mongoose = require('mongoose');
const { Allocation, Binder } = require('../models');
const { HttpError } = require('./catalog');

const CLOSED = ['finished', 'finalized'];
const RUNNING = ['running', 'paused'];
const idOf = (x) => String(x && x._id ? x._id : x);

const statusFor = (tournament) => (RUNNING.includes(tournament.status) ? 'active' : 'planned');

/** Vincula um fichário (ativo) ao torneio. Um vínculo aberto por (torneio, fichário). */
async function link(tournament, { binder_id, note } = {}, user) {
  if (CLOSED.includes(tournament.status)) throw new HttpError(409, 'O torneio está encerrado: não aceita novos fichários.');
  if (!mongoose.isValidObjectId(binder_id)) throw new HttpError(400, 'Informe o fichário.');
  const binder = await Binder.findById(binder_id);
  if (!binder) throw new HttpError(404, 'Fichário não encontrado.');
  if (binder.archived) throw new HttpError(409, `O fichário "${binder.name}" está arquivado.`);
  if (binder.status === 'maintenance') throw new HttpError(409, `O fichário "${binder.name}" está em manutenção.`);
  if (await Allocation.exists({ tournament_id: tournament._id, binder_id: binder._id, open: true })) {
    throw new HttpError(409, `O fichário "${binder.name}" já está vinculado a este torneio.`);
  }
  try {
    return await Allocation.create({
      tournament_id: tournament._id, binder_id: binder._id, mode: 'binder', chips: [], status: statusFor(tournament),
      note, created_by: user?.name || user?.email || 'Sistema',
    });
  } catch (err) {
    if (err?.code === 11000) throw new HttpError(409, 'Este fichário já está vinculado ao torneio.');
    throw err;
  }
}

/** Desvincula (fica no histórico como `released`). */
async function release(allocation, user) {
  if (!allocation.open) return allocation;
  allocation.open = false;
  allocation.status = 'released';
  allocation.released_at = new Date();
  allocation.released_by = user?.name || user?.email || 'Sistema';
  await allocation.save();
  return allocation;
}

/** Torneio começou: os vínculos planejados passam a ativos. */
async function activateForTournament(tournamentId) {
  return (await Allocation.updateMany({ tournament_id: tournamentId, open: true, status: 'planned' }, { $set: { status: 'active' } })).modifiedCount;
}

/** Torneio encerrou/foi excluído: desvincula todos os fichários. */
async function releaseForTournament(tournamentId, user) {
  const open = await Allocation.find({ tournament_id: tournamentId, open: true });
  if (!open.length) return 0;
  await Allocation.updateMany(
    { _id: { $in: open.map((a) => a._id) } },
    { $set: { open: false, status: 'released', released_at: new Date(), released_by: user?.name || user?.email || 'Sistema' } },
  );
  return open.length;
}

/** Ids dos fichários vinculados (abertos) ao torneio, na ordem em que foram vinculados. */
async function linkedBinderIds(tournamentId) {
  const rows = await Allocation.find({ tournament_id: tournamentId, open: true }).sort({ createdAt: 1 }).select('binder_id').lean();
  return rows.map((r) => idOf(r.binder_id));
}

module.exports = { link, release, activateForTournament, releaseForTournament, linkedBinderIds, CLOSED, RUNNING };
