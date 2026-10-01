const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Fichário FÍSICO (spec §3.3): a unidade real usada e rastreada no evento. Pode ser criado a
// partir de um Modelo de Fichário (`model_id`) e tem identificação própria (`name`/`code`).
// Vários fichários físicos podem seguir o mesmo modelo.
const BinderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, trim: true },
  model_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BinderModel', default: null },
  // Só 'maintenance' é uma escolha manual; 'available'/'allocated' é derivado das alocações abertas na leitura.
  status: { type: String, enum: ['available', 'allocated', 'maintenance'], default: 'available' },
  // Conteúdo, alocações e situação NÃO são gravados aqui: são derivados dos movimentos e das alocações (lib/binderView.js).
}, { timestamps: true });

BinderSchema.plugin(softDelete);

// Mantém a coleção `chipcases` (sem migração de coleção).
module.exports = mongoose.model('Binder', BinderSchema, 'chipcases');
