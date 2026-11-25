const mongoose = require('mongoose');

// Registro imutável de mudanças na estrutura de blinds DURANTE a sessão: regra aplicada ou nível acrescentado (autor, horário, nível).
const BlindChangeSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentSession', required: true, index: true },
  kind: { type: String, enum: ['rule_applied', 'levels_added', 'level_edited', 'level_removed'], required: true },
  rule_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BlindRule', default: null },
  rule_name: { type: String },
  level_number: { type: Number, default: null },  // nível em andamento quando aconteceu
  minutes: { type: Number, default: null },
  rows_affected: { type: Number, default: 0 },
  auto: { type: Boolean, default: false },
  user_name: { type: String },
  at: { type: Date, default: Date.now },
});
module.exports = mongoose.model('BlindChange', BlindChangeSchema);
