const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'material', 'salao'], default: 'salao' },
  created_by: { type: String },

  // P5 — segurança de sessão
  session_version: { type: Number, default: 1 },        // incrementar = revoga todos os tokens
  must_change_password: { type: Boolean, default: false }, // força troca no próximo login
}, { timestamps: true });

UserSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model('User', UserSchema);
