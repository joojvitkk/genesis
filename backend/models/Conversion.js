const mongoose = require('mongoose');

// Conversão de fichas (spec §8): Chip Race / Color Up. O operador lança, POR DENOMINAÇÃO, o que SAIU de jogo
// (`outs`) e o que ENTROU (`ins`). O servidor calcula:
//   value_out      = Σ quantidade × valor nominal do que saiu
//   value_in       = Σ quantidade × valor nominal do que entrou
//   math_breakage  = value_in − value_out      ← QUEBRA MATEMÁTICA: diferença legítima da conversão
// A quebra matemática NÃO é perda física e nunca gera ocorrência (§18.4); só a conferência física (G8) gera.
//
// Os movimentos (CHIP_RACE_OUT/IN ou COLOR_UP_OUT/IN, em lote `movement_batch_id`) são a verdade física.
// Imutável: não há PUT/DELETE; corrige-se por estorno do lote (`status: reversed`).
// `legacy: true` = registros do ChipRace antigo (calculadora, sem movimentos): só histórico.
const ConversionSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentSession', default: null },
  type: { type: String, enum: ['CHIP_RACE', 'COLOR_UP'], required: true },
  outs: [{ _id: false, chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Chip', required: true }, quantity: { type: Number, required: true } }],
  ins: [{ _id: false, chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Chip', required: true }, quantity: { type: Number, required: true } }],
  value_out: { type: Number, default: 0 },
  value_in: { type: Number, default: 0 },
  math_breakage: { type: Number, default: 0 },
  binder_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Binder', default: null }, // fichário que recebeu o que saiu
  movement_batch_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  status: { type: String, enum: ['active', 'reversed'], default: 'active' },
  note: { type: String },
  user_name: { type: String },
  reversed_at: { type: Date, default: null },
  reversed_by: { type: String },
  reverse_reason: { type: String },
  legacy: { type: Boolean, default: false },
  legacy_id: { type: mongoose.Schema.Types.ObjectId, default: null },   // _id do ChipRace de origem
  legacy_meta: { type: mongoose.Schema.Types.Mixed },                    // mesas ativas, nº de jogadores… do modelo antigo
}, { timestamps: true });

ConversionSchema.index({ tournament_id: 1, createdAt: -1 });
ConversionSchema.index({ legacy_id: 1 }, { unique: true, partialFilterExpression: { legacy_id: { $type: 'objectId' } }, name: 'conversion_legacy_once' });

module.exports = mongoose.model('Conversion', ConversionSchema);
