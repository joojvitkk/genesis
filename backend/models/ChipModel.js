const mongoose = require('mongoose');

const ChipModelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  value: { type: Number, required: true },
  color: { type: String },
  total_quantity: { type: Number, required: true },
  available_quantity: { type: Number, default: function() { return this.total_quantity; } }
}, { timestamps: true });

module.exports = mongoose.model('ChipModel', ChipModelSchema);
