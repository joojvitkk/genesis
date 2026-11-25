const mongoose = require('mongoose');
const cancellable = require('../lib/cancellable');

const EliminationSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true, index: true },
  session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentSession', default: null }, // sessão da entrada eliminada
  entry_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentEntry', default: null }, // a ENTRADA eliminada; nula nas fases herdadas (os classificados não têm entrada na fase)
  position: { type: Number, required: true },   // colocação final (1 = campeão)
  at: { type: Date, default: Date.now },
}, { timestamps: true });

EliminationSchema.index({ tournament_id: 1, position: 1 });
// uma entrada só é eliminada UMA vez (cancelar a eliminação libera de novo) — rede de segurança contra requisições simultâneas
EliminationSchema.index({ entry_id: 1 }, { unique: true, partialFilterExpression: { status: 'active', entry_id: { $type: 'objectId' } }, name: 'elimination_entry_active_once_v2' });

EliminationSchema.plugin(cancellable);

module.exports = mongoose.model('Elimination', EliminationSchema);
