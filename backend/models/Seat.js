const mongoose = require('mongoose');

// Um documento por lugar OCUPADO. Lugares vazios não existem como doc.
const SeatSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  // Cada sessão tem as suas mesas (Dia 1A e Dia 1B sentam jogadores independentemente).
  session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentSession', default: null },
  table_number: { type: Number, required: true },
  seat_number: { type: Number, required: true },
  entry_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentEntry', required: true }, // quem ocupa o lugar: a ENTRADA (sem nomes)
}, { timestamps: true });

SeatSchema.index({ tournament_id: 1, session_id: 1, table_number: 1, seat_number: 1 }, { unique: true });
// parcial: assentos antigos (ainda por jogador, antes da migração) não têm entry_id e não podem colidir entre si
SeatSchema.index({ tournament_id: 1, session_id: 1, entry_id: 1 }, { unique: true, partialFilterExpression: { entry_id: { $type: 'objectId' } } });

module.exports = mongoose.model('Seat', SeatSchema);
