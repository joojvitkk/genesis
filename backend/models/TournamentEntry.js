const mongoose = require('mongoose');
const cancellable = require('../lib/cancellable');

const TournamentEntrySchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  // Sessão/fase em que a ação foi registrada (Dia 1A, 1B…). Nulo só em dados anteriores ao G4 sem sessão.
  session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentSession', default: null },
  type: { type: String, enum: ['buy-in', 're-entry', 'add-on'], required: true },
  // AÇÃO que define o stack recebido (chave da coluna do modelo de stack). Derivada do tipo
  // (buy-in→buy_in, re-entry→re_entry, add-on→add_on); um buy-in pode ser `optional_buy_in` ou outra ação do modelo.
  action: { type: String },
  // LEGADO (G3): o operador escolhia o stack por entrada. Não é mais gravado; entradas antigas ainda o honram no cálculo.
  stack_model_id: { type: mongoose.Schema.Types.ObjectId, ref: 'StackModel' },
  // Número sequencial da entrada no torneio ("Entrada #12"): identifica a entrada nas mesas e eliminações, sem nomes.
  number: { type: Number, default: null },

  // Snapshots financeiros no momento da entrada (não seguem mudanças no torneio)
  amount_paid: { type: Number, default: 0 },
  prize_contribution: { type: Number, default: 0 },
  bounty_contribution: { type: Number, default: 0 },

  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

TournamentEntrySchema.index({ tournament_id: 1, timestamp: -1 });
TournamentEntrySchema.index({ tournament_id: 1, session_id: 1 });
TournamentEntrySchema.index({ tournament_id: 1, number: 1 });

TournamentEntrySchema.plugin(cancellable);

module.exports = mongoose.model('TournamentEntry', TournamentEntrySchema);
