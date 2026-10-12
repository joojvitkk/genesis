const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Fichário FÍSICO: unidade única, com identificação própria (`name`/`code`) e composição própria.
// O saldo inicial entra por um lote ASSEMBLY no cadastro; depois só muda por movimentação.
const BinderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, trim: true },
  model_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BinderModel', default: null }, // LEGADO: o modelo de fichário foi removido
  // Só 'maintenance' é uma escolha manual; 'available'/'allocated' é derivado das alocações abertas na leitura.
  status: { type: String, enum: ['available', 'allocated', 'maintenance'], default: 'available' },
  // Arquivado (Simulação 2.1 §7.2): fichário com histórico não se exclui — inativa. Some das seleções operacionais, mas
  // permanece em relatórios, Livro Razão e histórico. Reativar é só do administrador.
  archived: { type: Boolean, default: false },
  archived_at: { type: Date, default: null },
  archived_by: { type: String },
  archive_reason: { type: String },
  // Conteúdo, alocações e situação NÃO são gravados aqui: são derivados dos movimentos e das alocações (lib/binderView.js).
}, { timestamps: true });

BinderSchema.plugin(softDelete);

// Mantém a coleção `chipcases` (sem migração de coleção).
module.exports = mongoose.model('Binder', BinderSchema, 'chipcases');
