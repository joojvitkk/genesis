const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

const PlayerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  document: { type: String, trim: true },   // CPF/RG/passaporte
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  notes: { type: String },
  created_by: { type: String },
}, { timestamps: true });

PlayerSchema.plugin(softDelete);
PlayerSchema.index({ name: 1 });
PlayerSchema.index({ document: 1 });

module.exports = mongoose.model('Player', PlayerSchema);
