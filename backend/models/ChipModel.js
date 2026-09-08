const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

const ChipModelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  value: { type: Number, required: true },
  color: { type: String },
  total_quantity: { type: Number, required: true },
  available_quantity: { type: Number, default: function() { return this.total_quantity; } }
}, { timestamps: true });

ChipModelSchema.plugin(softDelete);

module.exports = mongoose.model('ChipModel', ChipModelSchema);
