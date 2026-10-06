const mongoose = require('mongoose');

// Chamado de Chip Race / Color Up (MEL-02): o SALÃO solicita informando as mesas abertas de verdade; o MATERIAL recebe,
// prepara, envia e conclui registrando a conversão (Conversion) que ele realmente executou.
//   requested → in_preparation → ready (fichas preparadas/enviadas) → completed (vinculada à conversão) | cancelled
// `snapshot` e `estimate` ficam CONGELADOS no pedido: o fechamento posterior de entradas/reentradas não reescreve uma
// troca já executada, e a estimativa nunca substitui o que foi efetivamente retirado e entregue (Conversion).
const ConversionRequestSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentSession', default: null },
  type: { type: String, enum: ['CHIP_RACE', 'COLOR_UP'], required: true },
  tables: { type: Number, required: true, min: 1 },
  note: { type: String },
  status: { type: String, enum: ['requested', 'in_preparation', 'ready', 'completed', 'cancelled'], default: 'requested' },
  snapshot: { type: mongoose.Schema.Types.Mixed },   // base do cálculo: ativos, inscrições, se o registro ainda estava aberto (provisório)
  estimate: { type: mongoose.Schema.Types.Mixed },   // distribuição por mesa + arredondamento
  conversion_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversion', default: null },
  requested_by: { type: String },
  history: [{ _id: false, status: String, by: String, at: { type: Date, default: Date.now }, note: String }],
}, { timestamps: true });

ConversionRequestSchema.index({ tournament_id: 1, createdAt: -1 });
ConversionRequestSchema.index({ status: 1 });

module.exports = mongoose.model('ConversionRequest', ConversionRequestSchema);
