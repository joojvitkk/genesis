const mongoose = require('mongoose');

// Ocorrência (G8, spec §10): divergência física registrada na conferência (ou numa perda lançada à mão).
// A FONTE DA VERDADE continua sendo o Movement (LOSS/FOUND/RECOVERY); a ocorrência é o registro de gestão
// (semáforo, justificativa, situação) e o histórico. Nunca é apagada (§18.6): corrige-se por estorno.
//
//   kind LOSS     falta física → LOSS (fichário|jogo → divergência); pode ser recuperada, parcial ou totalmente
//   kind SURPLUS  sobra física → FOUND (externo → fichário|jogo); só registro (não há o que recuperar)
//   status: open → justified → partially_recovered → recovered | closed | voided
const OCCURRENCE_KINDS = ['LOSS', 'SURPLUS'];
const OCCURRENCE_STATUS = ['open', 'justified', 'partially_recovered', 'recovered', 'closed', 'voided'];
const SEVERITIES = ['GREEN', 'YELLOW', 'RED'];

const HistorySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  action: { type: String, required: true }, // opened | justified | recovered | recovery_reversed | closed | voided
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  user_name: { type: String },
  quantity: { type: Number },
  note: { type: String },
  batch_id: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { _id: false });

const OccurrenceSchema = new mongoose.Schema({
  kind: { type: String, enum: OCCURRENCE_KINDS, required: true },
  scope: { type: String, enum: ['binder', 'tournament'], required: true },
  chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Chip', required: true },
  binder_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Binder', default: null },
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', default: null },
  session_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  expected: { type: Number, default: null },  // null em perda lançada à mão (sem contagem)
  counted: { type: Number, default: null },
  diff: { type: Number, required: true },     // counted − expected (negativo = falta)
  quantity: { type: Number, required: true, min: 1 }, // |diff|
  severity: { type: String, enum: SEVERITIES, required: true }, // fotografia no momento (mudar a config não reescreve o passado)
  severity_reason: { type: String, enum: ['band', 'quantity'], default: 'band' },
  status: { type: String, enum: OCCURRENCE_STATUS, default: 'open' },
  justification: { type: String, trim: true },
  source: { type: String, enum: ['count', 'manual', 'legacy'], default: 'count' },
  legacy_movement_id: { type: mongoose.Schema.Types.ObjectId, default: null }, // LOSS anterior ao G8 (movimento sem meta.occurrence_id)
  movement_batch_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  recovered_quantity: { type: Number, default: 0 }, // CACHE: Σ RECOVERY ativos (derivado dos movimentos)
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  user_name: { type: String },
  history: { type: [HistorySchema], default: [] },
}, { timestamps: true });

OccurrenceSchema.index({ status: 1, severity: 1, createdAt: -1 });
OccurrenceSchema.index({ binder_id: 1, createdAt: -1 });
OccurrenceSchema.index({ tournament_id: 1, createdAt: -1 });
OccurrenceSchema.index({ chip_id: 1 });
OccurrenceSchema.index({ legacy_movement_id: 1 }, { unique: true, partialFilterExpression: { legacy_movement_id: { $type: 'objectId' } }, name: 'occurrence_legacy_once' });

// Nunca apagar (§18.6).
const blocked = () => { throw new Error('Ocorrências não podem ser apagadas: use estorno ou encerramento.'); };
['deleteOne', 'deleteMany', 'findOneAndDelete'].forEach((op) => OccurrenceSchema.pre(op, blocked));
OccurrenceSchema.pre('deleteOne', { document: true, query: false }, blocked);

module.exports = mongoose.model('Occurrence', OccurrenceSchema);
module.exports.OCCURRENCE_STATUS = OCCURRENCE_STATUS;
module.exports.SEVERITIES = SEVERITIES;
