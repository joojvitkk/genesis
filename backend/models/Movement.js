const mongoose = require('mongoose');

// Movimentação de fichas — FONTE DA VERDADE dos saldos (spec §6, §15).
// Partida dobrada: cada lançamento tira `quantity` de uma localização (`from`) e põe em outra (`to`).
// Saldo de qualquer localização = Σ entradas (to) − Σ saídas (from). Nada é gravado como número:
// caches em Chip/Binder são DERIVADOS (lib/movements.js) e reconstruíveis.
//
// IMUTÁVEL: não há rota de escrita, e este schema barra update/replace/delete (query e documento).
// Erro de lançamento se corrige com ESTORNO (type REVERSAL, `reverses` → original) + novo lançamento.
//
// Localizações (`kind`):
//   external — fora do sistema (compra, descarte definitivo, montagem/estoque inicial)
//   binder   — dentro de um fichário (id = Binder._id): saldo disponível
//   lost     — divergência física (id = Binder._id de origem; perda em jogo: id = Tournament._id)
//   play     — em jogo num torneio (id = Tournament._id; a sessão vai em `session_id` do movimento)
const LOCATION_KINDS = ['external', 'binder', 'lost', 'play'];
const MOVEMENT_TYPES = [
  'ASSEMBLY', 'WITHDRAWAL', 'ADJUSTMENT', 'LOSS', 'REVERSAL',
  // G6 — material no torneio: envio (fichário → em jogo), retorno (em jogo → fichário) e conversões
  'SEND_BUY_IN', 'SEND_OPTIONAL', 'SEND_REENTRY', 'SEND_ADDITIONAL', 'RETURN',
  'CHIP_RACE_OUT', 'CHIP_RACE_IN', 'COLOR_UP_OUT', 'COLOR_UP_IN',
  // G7 — descarte de stack: o jogador abandona o stack e as fichas voltam do jogo para o fichário
  'DISCARD',
  // G8 — divergências: sobra encontrada na conferência (externo → fichário/jogo) e recuperação do que estava perdido (divergência → fichário)
  'FOUND', 'RECOVERY',
];

const LocationSchema = new mongoose.Schema({
  kind: { type: String, enum: LOCATION_KINDS, required: true },
  id: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { _id: false });

const MovementSchema = new mongoose.Schema({
  type: { type: String, enum: MOVEMENT_TYPES, required: true },
  chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Chip', required: true },
  quantity: {
    type: Number, required: true, min: 1,
    validate: { validator: Number.isInteger, message: 'A quantidade deve ser um número inteiro.' },
  },
  from: { type: LocationSchema, required: true },
  to: { type: LocationSchema, required: true },
  binder_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Binder', default: null }, // fichário envolvido (índice/filtro)
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', default: null }, // G4/G6
  session_id: { type: mongoose.Schema.Types.ObjectId, default: null },                       // G4/G6
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  user_name: { type: String },
  reason: { type: String, trim: true },
  reverses: { type: mongoose.Schema.Types.ObjectId, ref: 'Movement', default: null },
  batch_id: { type: mongoose.Schema.Types.ObjectId, required: true }, // lançamentos gravados juntos
  meta: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } });

MovementSchema.pre('validate', function () {
  const same = this.from?.kind === this.to?.kind && String(this.from?.id ?? '') === String(this.to?.id ?? '');
  if (same) this.invalidate('to', 'Origem e destino não podem ser a mesma localização.');
});

// ─── imutabilidade ───────────────────────────────────────────────────────────
const IMMUTABLE_MSG = 'Movimentações são imutáveis: corrija por estorno + novo lançamento.';
const blocked = () => { throw new Error(IMMUTABLE_MSG); };
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne',
  'deleteOne', 'deleteMany', 'findOneAndDelete'].forEach((op) => MovementSchema.pre(op, blocked));
MovementSchema.pre('deleteOne', { document: true, query: false }, blocked);
MovementSchema.pre('save', function () { if (!this.isNew) blocked(); });

// Um movimento só pode ser estornado uma vez (defesa no banco, além da checagem na aplicação).
MovementSchema.index({ reverses: 1 }, { unique: true, partialFilterExpression: { reverses: { $type: 'objectId' } }, name: 'movement_reversed_once' });
MovementSchema.index({ 'to.kind': 1, 'to.id': 1, chip_id: 1 });
MovementSchema.index({ 'from.kind': 1, 'from.id': 1, chip_id: 1 });
MovementSchema.index({ binder_id: 1, createdAt: -1 });
MovementSchema.index({ chip_id: 1, createdAt: -1 });
MovementSchema.index({ batch_id: 1 });
MovementSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('Movement', MovementSchema);
module.exports.LOCATION_KINDS = LOCATION_KINDS;
module.exports.MOVEMENT_TYPES = MOVEMENT_TYPES;
module.exports.IMMUTABLE_MSG = IMMUTABLE_MSG;
