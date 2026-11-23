const mongoose = require('mongoose');

// Contagem de FIM DE DIA de uma sessão (Material C/D): sacos dos jogadores × Chip Count e sobra no salão × disponível.
// Imutável: uma nova contagem da mesma sessão substitui a anterior (a anterior fica no histórico, `superseded`).
const LineSchema = new mongoose.Schema({
  chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Chip', required: true },
  expected: { type: Number, required: true },
  counted: { type: Number, required: true },
  diff: { type: Number, required: true },
}, { _id: false });

const SessionCountSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true, index: true },
  session_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  players: { type: [LineSchema], default: [] },     // sacos/stacks dos jogadores × Chip Count (em jogo)
  hall: { type: [LineSchema], default: [] },        // sobra no salão (ilha) × disponível; vazio = não conferida
  hall_checked: { type: Boolean, default: false },
  math_breakage: { type: Number, default: 0 },      // quebra das trocas da sessão (valor nominal) — explicação, não perda
  occurrence_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  note: { type: String, trim: true },
  status: { type: String, enum: ['active', 'superseded'], default: 'active' },
  user_name: { type: String },
}, { timestamps: true });

SessionCountSchema.index({ tournament_id: 1, session_id: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('SessionCount', SessionCountSchema);
