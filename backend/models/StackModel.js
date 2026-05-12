const mongoose = require('mongoose');

const StackModelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  composition: [{
    chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChipModel' },
    quantity: { type: Number, required: true }
  }],
  total_value: { type: Number, default: 0 },
  notes: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('StackModel', StackModelSchema);
