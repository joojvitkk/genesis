const mongoose = require('mongoose');

const TournamentEntrySchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  type: { type: String, enum: ['buy-in', 're-entry', 'add-on'], required: true },
  stack_model_id: { type: mongoose.Schema.Types.ObjectId, ref: 'StackModel' },
  player_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
  player_name: { type: String }, // fallback / legado

  // Snapshots financeiros no momento da entrada (não seguem mudanças no torneio)
  amount_paid: { type: Number, default: 0 },
  prize_contribution: { type: Number, default: 0 },
  bounty_contribution: { type: Number, default: 0 },

  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

TournamentEntrySchema.index({ tournament_id: 1, timestamp: -1 });
TournamentEntrySchema.index({ tournament_id: 1, player_id: 1 });

module.exports = mongoose.model('TournamentEntry', TournamentEntrySchema);
