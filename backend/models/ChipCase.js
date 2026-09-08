const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

const ChipCaseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  status: { type: String, enum: ['available', 'allocated', 'maintenance'], default: 'available' },
  chips: [{
    chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChipModel' },
    quantity: { type: Number }
  }],
  // Legacy single-allocation fields (kept for backward compat)
  allocated_to_tournament: { type: String },
  allocated_to_tournament_name: { type: String },
  // NEW: multiple tournament allocations (one per distinct chip group)
  allocations: [{
    tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament' },
    tournament_name: { type: String },
    // which chip_ids from this case are used by that tournament
    chip_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ChipModel' }]
  }]
}, { timestamps: true });

ChipCaseSchema.plugin(softDelete);

module.exports = mongoose.model('ChipCase', ChipCaseSchema);
