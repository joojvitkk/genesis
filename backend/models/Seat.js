const mongoose = require('mongoose');

// Um documento por lugar OCUPADO. Lugares vazios não existem como doc.
const SeatSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  table_number: { type: Number, required: true },
  seat_number: { type: Number, required: true },
  player_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', required: true },
}, { timestamps: true });

SeatSchema.index({ tournament_id: 1, table_number: 1, seat_number: 1 }, { unique: true });
SeatSchema.index({ tournament_id: 1, player_id: 1 }, { unique: true });

module.exports = mongoose.model('Seat', SeatSchema);
