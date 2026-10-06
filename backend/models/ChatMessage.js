const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
  message: { type: String, default: '' },
  image: { type: String },  // data URL (base64), limitado no envio — P6
  sender_name: { type: String },
  sender_email: { type: String },
  sender_role: { type: String, enum: ['admin', 'material', 'salao'] },
  event_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null }, // o chat é por evento (obrigatório no envio)
  channel: { type: String, enum: ['general', 'material', 'salao'], default: 'general' }, // canal dentro do evento
  // resposta a outra mensagem (guarda um resumo para não depender da original)
  reply_to: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
  reply_preview: { sender_name: String, message: String, has_image: Boolean },
  reactions: [{ _id: false, kind: String, user_name: String, user_email: String }],
  // quem visualizou — só o remetente e o administrador enxergam (ver lib/chat.js)
  read_by: [{ _id: false, user_name: String, user_email: String, at: { type: Date, default: Date.now } }],
  is_urgent: { type: Boolean, default: false },
  // confirmações de leitura de alertas urgentes — P6
  acks: [{ user_name: String, user_email: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });

ChatMessageSchema.index({ event_id: 1, channel: 1, createdAt: -1 });
ChatMessageSchema.index({ is_urgent: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
