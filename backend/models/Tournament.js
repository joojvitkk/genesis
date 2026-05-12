const mongoose = require('mongoose');

const TournamentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  date: { type: Date, required: true },
  start_time: { type: String },
  status: { type: String, enum: ['scheduled', 'running', 'paused', 'finished'], default: 'scheduled' },
  estimated_players: { type: Number, default: 0 },
  actual_players: { type: Number, default: 0 },
  starting_stack: { type: Number, default: 0 },
  blind_structure: [{
    level: { type: Number },
    small_blind: { type: Number },
    big_blind: { type: Number },
    ante: { type: Number },
    duration: { type: Number }
  }],
  allocated_cases: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ChipCase' }],
  stack_composition: [{
    chip_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChipModel' },
    per_player: { type: Number, default: 0 }
  }],
  current_level: { type: Number, default: 0 },
  notes: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Tournament', TournamentSchema);
