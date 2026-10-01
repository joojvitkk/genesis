const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Modelo de Fichário = composição PADRÃO de um conjunto (spec §3.2): quais fichas (já
// cadastradas) e quantas de cada. É aqui — e não na ficha — que a quantidade é informada.
// Um modelo pode originar vários fichários físicos (Binder); editar o modelo NÃO altera
// fichários já criados (eles guardam a sua própria composição física).
const BinderModelSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  composition: [{
    _id: false,
    chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Chip', required: true },
    quantity: {
      type: Number, required: true, min: 1,
      validate: { validator: Number.isInteger, message: 'A quantidade deve ser um número inteiro.' },
    },
  }],
  notes: { type: String },
}, { timestamps: true });

BinderModelSchema.path('composition').validate(function (lines) {
  const ids = lines.map((l) => String(l.chip_id));
  return new Set(ids).size === ids.length;
}, 'A mesma ficha não pode aparecer duas vezes na composição.');

BinderModelSchema.plugin(softDelete);

module.exports = mongoose.model('BinderModel', BinderModelSchema);
