const mongoose = require('mongoose');

// Livro imutável das fichas KO: envio ao torneio, retorno e justificativas da conferência. Sem edição nem exclusão.
const KoMovementSchema = new mongoose.Schema({
  ko_chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'KoChip', required: true },
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  type: { type: String, enum: ['SEND', 'RETURN', 'CONFERENCE', 'CLOSE'], required: true },
  quantity: { type: Number, default: 0, min: 0 },
  // conferência: distribuídas × devolvidas no momento do registro
  distributed: { type: Number },
  returned: { type: Number },
  pending: { type: Number },
  note: { type: String },
  user_name: { type: String },
}, { timestamps: true });

KoMovementSchema.index({ tournament_id: 1, createdAt: 1 });
KoMovementSchema.index({ ko_chip_id: 1 });
module.exports = mongoose.model('KoMovement', KoMovementSchema);
