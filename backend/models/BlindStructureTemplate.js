const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Mesma forma de Tournament.blind_structure — reutilizável.
const BlindStructureTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  rows: [{
    row_type: { type: String, enum: ['level', 'break', 'end_registration', 'end_day'], default: 'level' },
    level: { type: Number },
    small_blind: { type: Number },
    big_blind: { type: Number },
    ante: { type: Number },
    duration: { type: Number },
    label: { type: String },
  }],
  notes: { type: String },
}, { timestamps: true });

BlindStructureTemplateSchema.plugin(softDelete);

module.exports = mongoose.model('BlindStructureTemplate', BlindStructureTemplateSchema);
