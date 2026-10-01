const mongoose = require('mongoose');

// Alocação (spec §5, §18.2, §18.9): RESERVA de fichas de um fichário para um torneio, por denominação e
// quantidade — não o fichário inteiro. O mesmo fichário pode atender dois torneios ao mesmo tempo
// (ex.: ≥ 5.000 no A e ≤ 1.000 no B) desde que a soma alocada de cada ficha não passe do saldo físico.
//
//   livre(fichário, ficha) = saldo físico − Σ alocações abertas (planejadas/ativas) de TODOS os torneios
//
// A reserva vale a partir do momento em que é criada (planned) — não só quando o torneio inicia.
// É uma reserva, não uma movimentação: as fichas só saem do fichário no envio (G6). Alocações não
// são apagadas: ao liberar viram `released` (histórico).
const ALLOCATION_STATUS = ['planned', 'active', 'released'];
const ALLOCATION_MODES = ['binder', 'denominations', 'quantities']; // como foi criada (informativo)

const AllocationSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  binder_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Binder', required: true },
  mode: { type: String, enum: ALLOCATION_MODES, default: 'quantities' },
  chips: [{
    _id: false,
    chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Chip', required: true },
    quantity: {
      type: Number, required: true, min: 1,
      validate: { validator: Number.isInteger, message: 'A quantidade deve ser um número inteiro.' },
    },
  }],
  status: { type: String, enum: ALLOCATION_STATUS, default: 'planned' },
  open: { type: Boolean, default: true },      // false = liberada (histórico); é o que a regra de conflito consulta
  note: { type: String },
  created_by: { type: String },
  released_at: { type: Date, default: null },
  released_by: { type: String },
  migrated: { type: Boolean, default: false }, // criada pela migração G5 a partir do modelo antigo
}, { timestamps: true });

// no máximo UMA alocação aberta por (torneio, fichário): para mudar, edite-a
AllocationSchema.index({ tournament_id: 1, binder_id: 1 }, { unique: true, partialFilterExpression: { open: true }, name: 'allocation_open_once' });
AllocationSchema.index({ binder_id: 1, open: 1 });
AllocationSchema.index({ tournament_id: 1, open: 1 });

module.exports = mongoose.model('Allocation', AllocationSchema);
module.exports.ALLOCATION_STATUS = ALLOCATION_STATUS;
module.exports.ALLOCATION_MODES = ALLOCATION_MODES;
