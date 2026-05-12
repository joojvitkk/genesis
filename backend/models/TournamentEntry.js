const mongoose = require('mongoose');

const TournamentEntrySchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  type: { type: String, enum: ['buy-in', 're-entry'], required: true },
  stack_model_id: { type: mongoose.Schema.Types.ObjectId, ref: 'StackModel' },
  player_name: { type: String }, // Optional for now
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('TournamentEntry', TournamentEntrySchema);
