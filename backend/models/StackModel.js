const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Modelo de Stack (spec §3.4): a composição entregue a UM jogador em cada tipo de AÇÃO
// (buy-in padrão, buy-in opcional, reentrada, add-on…). É uma grade ficha × ação:
//
//   composition: [{ chip_id, quantities: { buy_in: 10, optional_buy_in: 0, re_entry: 0 } }]
//
// `actions` define as colunas (chaves estáveis + rótulo). O valor total de cada coluna é DERIVADO
// (virtual `totals`), nunca digitado. Quantidade de jogadores × composição = fichas necessárias
// (lib/stackCalc.js).
const StackModelSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  actions: [{
    _id: false,
    key: { type: String, required: true },
    label: { type: String, required: true },
  }],
  composition: [{
    _id: false,
    chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Chip', required: true },
    quantities: { type: Object, default: {} },
  }],
  notes: { type: String },
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true }, minimize: false });

// valor nominal de cada coluna (só quando as fichas vieram populadas)
StackModelSchema.virtual('totals').get(function () {
  const totals = {};
  for (const a of this.actions || []) totals[a.key] = 0;
  for (const line of this.composition || []) {
    const value = line.chip_id && typeof line.chip_id === 'object' && 'value' in line.chip_id ? line.chip_id.value : null;
    if (value == null) return null; // sem populate: não dá para calcular
    for (const [key, q] of Object.entries(line.quantities || {})) totals[key] = (totals[key] || 0) + q * value;
  }
  return totals;
});
// compat com telas antigas: `total_value` = valor do buy-in padrão
StackModelSchema.virtual('total_value').get(function () {
  const t = this.totals;
  return t ? (t.buy_in || 0) : 0;
});

StackModelSchema.plugin(softDelete);

module.exports = mongoose.model('StackModel', StackModelSchema);
