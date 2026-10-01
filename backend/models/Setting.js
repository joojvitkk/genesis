const mongoose = require('mongoose');

// Configurações globais chave/valor editáveis pelo admin (ex.: limites do semáforo — G8).
// Leia/escreva SEMPRE via lib/settings.js, que valida a chave e aplica os defaults.
const SettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updated_by: { type: String },
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('Setting', SettingSchema);
