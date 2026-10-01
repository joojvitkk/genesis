const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Evento (spec §3.5): o "festival" que agrupa torneios. Evento → Torneio → Sessões/Fases.
// Ex.: KSOP Rio → #02 Warm Up → Dia 1A / Dia 1B / Dia Final.
const EventSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  start_date: { type: Date, default: null },
  end_date: { type: Date, default: null },
  location: { type: String, trim: true },
  notes: { type: String },
}, { timestamps: true });

EventSchema.plugin(softDelete);

module.exports = mongoose.model('Event', EventSchema);
