const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Ficha KO (Simulação 3.0 §5): estoque FÍSICO separado das denominações de jogo. Só cor/tipo e quantidade — nunca dinheiro.
// Não entra no Chip Count nem em fichários de jogo. `quantity` = total físico cadastrado; o que está fora do estoque
// vem do livro de movimentos (KoMovement).
const KoChipSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },   // cor/tipo (ex.: "KO vermelha")
  color: { type: String, default: '#dc2626' },
  quantity: { type: Number, required: true, min: 0, default: 0 },
  notes: { type: String },
}, { timestamps: true });

KoChipSchema.plugin(softDelete);
module.exports = mongoose.model('KoChip', KoChipSchema);
