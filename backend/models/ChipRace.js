const mongoose = require('mongoose');

const ChipRaceSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  type: { type: String, enum: ['chip-race', 'color-up'], required: true },
  active_tables: { type: Number, required: true },
  num_players: { type: Number, default: 0 },
  chips_per_player: { type: Number, default: 1 },
  from_chip: { type: mongoose.Schema.Types.ObjectId, ref: 'ChipModel', required: true },
  from_quantity: { type: Number, required: true },
  to_chip: { type: mongoose.Schema.Types.ObjectId, ref: 'ChipModel', required: true },
  to_quantity: { type: Number },
  total_value: { type: Number },
  status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' }
}, { timestamps: true });

module.exports = mongoose.model('ChipRace', ChipRaceSchema);
