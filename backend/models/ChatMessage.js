const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
  message: { type: String, required: true },
  sender_name: { type: String },
  sender_email: { type: String },
  sender_role: { type: String, enum: ['admin', 'material', 'salao'] },
  channel: { type: String, enum: ['general', 'material', 'salao'], default: 'general' },
  is_urgent: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
