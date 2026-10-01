const mongoose = require('mongoose');
const cancellable = require('../lib/cancellable');

const EliminationSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true, index: true },
  entry_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentEntry', required: true }, // a ENTRADA eliminada (não há cadastro de jogadores)
  position: { type: Number, required: true },   // colocação final (1 = campeão)
  prize_awarded: { type: Number, default: 0 },  // prêmio da colocação (preenchido ao finalizar)
  at: { type: Date, default: Date.now },
}, { timestamps: true });

EliminationSchema.index({ tournament_id: 1, position: 1 });

EliminationSchema.plugin(cancellable);

module.exports = mongoose.model('Elimination', EliminationSchema);
