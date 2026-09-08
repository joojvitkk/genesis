const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

const TournamentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  date: { type: Date, required: true },
  start_time: { type: String },
  status: { type: String, enum: ['scheduled', 'running', 'paused', 'finished'], default: 'scheduled' },
  estimated_players: { type: Number, default: 0 },
  actual_players: { type: Number, default: 0 },
  starting_stack: { type: Number, default: 0 },
  stack_model_id: { type: mongoose.Schema.Types.ObjectId, ref: 'StackModel', default: null },
  blind_structure: [{
    row_type: { type: String, enum: ['level', 'break', 'end_registration', 'end_day'], default: 'level' },
    level: { type: Number },
    small_blind: { type: Number },
    big_blind: { type: Number },
    ante: { type: Number },
    duration: { type: Number },   // minutes (for levels and breaks)
    label: { type: String }       // custom label for special rows
  }],
  allocated_cases: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ChipCase' }],
  stack_composition: [{
    chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChipModel' },
    per_player: { type: Number, default: 0 }
  }],
  current_level: { type: Number, default: 0 },
  notes: { type: String }
}, { timestamps: true });

TournamentSchema.plugin(softDelete);
TournamentSchema.index({ status: 1, date: -1 });

module.exports = mongoose.model('Tournament', TournamentSchema);
