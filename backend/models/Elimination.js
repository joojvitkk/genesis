const mongoose = require('mongoose');

const EliminationSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true, index: true },
  player_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
  position: { type: Number, required: true },   // colocação final (1 = campeão)
  eliminated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
  bounty_awarded: { type: Number, default: 0 }, // valor pago ao eliminador
  prize_awarded: { type: Number, default: 0 },  // prêmio da colocação (preenchido ao finalizar)
  at: { type: Date, default: Date.now },
}, { timestamps: true });

EliminationSchema.index({ tournament_id: 1, position: 1 });

module.exports = mongoose.model('Elimination', EliminationSchema);
