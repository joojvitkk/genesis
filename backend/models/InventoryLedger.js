const mongoose = require('mongoose');

// Livro-razão de fichas — append-only. É a fonte da verdade dos saldos.
// `quantity` é SEMPRE com sinal (entrada +, saída/quebra -, ajuste +/-).
// O `type` decide se o lançamento afeta o TOTAL físico ou a RESERVA (alocação).
const InventoryLedgerSchema = new mongoose.Schema({
  chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChipModel', required: true },
  type: {
    type: String,
    required: true,
    enum: ['entrada', 'saida', 'quebra', 'contagem', 'ajuste', 'saldo_inicial', 'alocacao', 'retorno'],
  },
  quantity: { type: Number, required: true },
  ref: {
    kind: { type: String, enum: ['case', 'tournament', 'manual', null], default: 'manual' },
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
    label: { type: String },
  },
  note: { type: String },
  user_name: { type: String },
  balance_after: { type: Number },   // total físico derivado logo após este lançamento
}, { timestamps: true });

InventoryLedgerSchema.index({ chip_id: 1, createdAt: 1 });
InventoryLedgerSchema.index({ 'ref.id': 1 });
InventoryLedgerSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('InventoryLedger', InventoryLedgerSchema);
