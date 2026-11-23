const mongoose = require('mongoose');

// Chave de idempotência (Salão, item 13): cada lançamento do cliente leva um identificador único (cabeçalho `Idempotency-Key`
// ou `client_op_id` no corpo). Um reenvio devolve o MESMO resultado sem repetir a operação. Escopo: usuário + chave.
const IdempotencyKeySchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  key: { type: String, required: true, maxlength: 128 },
  method: { type: String },
  path: { type: String },
  state: { type: String, enum: ['pending', 'done'], default: 'pending' },
  status: { type: Number },
  body: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 }, // guarda 7 dias
});
IdempotencyKeySchema.index({ user_id: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('IdempotencyKey', IdempotencyKeySchema);
