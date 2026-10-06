const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Fichário FÍSICO: unidade única, com identificação própria (`name`/`code`/`stamp`) e composição própria.
// O saldo inicial entra por um lote ASSEMBLY no cadastro; depois só muda por movimentação.
const BinderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, trim: true },
  stamp: { type: String, trim: true },                 // estampa (identificação visual do fichário)
  model_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BinderModel', default: null }, // LEGADO: o modelo de fichário foi removido
  // Só 'maintenance' é uma escolha manual; 'available'/'allocated' é derivado das alocações abertas na leitura.
  status: { type: String, enum: ['available', 'allocated', 'maintenance'], default: 'available' },
  // Conteúdo, alocações e situação NÃO são gravados aqui: são derivados dos movimentos e das alocações (lib/binderView.js).
}, { timestamps: true });

BinderSchema.plugin(softDelete);

// Mantém a coleção `chipcases` (sem migração de coleção).
module.exports = mongoose.model('Binder', BinderSchema, 'chipcases');
