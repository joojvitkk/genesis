const mongoose = require('mongoose');

// Regra de duração dos blinds (item 6): "quando [jogadores ≤ N | nível ≥ X | ações ≥ Y], a duração dos níveis passa a Z minutos".
// Cadastro EDITÁVEL por torneio, com exceção por sessão (`session_id`: a regra da sessão vale no lugar da do torneio com o mesmo
// nome). Nada fixo no código. Aplicação automática ou com confirmação; toda aplicação é registrada em BlindChange.
const CONDITIONS = ['players_lte', 'level_gte', 'actions_gte'];

const BlindRuleSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true, index: true },
  session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentSession', default: null }, // null = vale para o torneio todo
  name: { type: String, required: true, trim: true },
  condition: { type: String, enum: CONDITIONS, required: true },
  value: { type: Number, required: true, min: 0 },
  minutes: { type: Number, required: true, min: 1, max: 600 },
  mode: { type: String, enum: ['auto', 'confirm'], default: 'confirm' },
  active: { type: Boolean, default: true },
  applied_sessions: { type: [mongoose.Schema.Types.ObjectId], default: [] },  // sessões em que já foi aplicada (uma vez por sessão)
  pending_sessions: { type: [mongoose.Schema.Types.ObjectId], default: [] },  // condição atingida, aguardando confirmação
  created_by: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('BlindRule', BlindRuleSchema);
module.exports.CONDITIONS = CONDITIONS;
