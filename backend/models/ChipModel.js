const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

const ChipModelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  value: { type: Number, required: true },
  color: { type: String },
  // Saldos DERIVADOS do InventoryLedger (cache mantido por lib/inventoryLedger.recalcChip).
  // Não edite direto — use os lançamentos de estoque.
  total_quantity: { type: Number, default: 0 },
  reserved_quantity: { type: Number, default: 0 }, // alocado a torneios em andamento
  available_quantity: { type: Number, default: 0 }, // total - reserved
}, { timestamps: true });

ChipModelSchema.plugin(softDelete);

module.exports = mongoose.model('ChipModel', ChipModelSchema);
