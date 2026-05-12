const mongoose = require('mongoose');

const ChipCaseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  status: { type: String, enum: ['available', 'allocated', 'maintenance'], default: 'available' },
  chips: [{
    chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChipModel' },
    quantity: { type: Number }
  }],
  allocated_to_tournament: { type: String },
  allocated_to_tournament_name: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('ChipCase', ChipCaseSchema);
