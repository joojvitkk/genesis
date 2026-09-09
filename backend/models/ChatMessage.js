const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
  message: { type: String, default: '' },
  image: { type: String },  // data URL (base64), limitado no envio — P6
  sender_name: { type: String },
  sender_email: { type: String },
  sender_role: { type: String, enum: ['admin', 'material', 'salao'] },
  channel: { type: String, enum: ['general', 'material', 'salao'], default: 'general' },
  is_urgent: { type: Boolean, default: false },
  // confirmações de leitura de alertas urgentes — P6
  acks: [{ user_name: String, user_email: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });

ChatMessageSchema.index({ channel: 1, createdAt: -1 });
ChatMessageSchema.index({ is_urgent: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
