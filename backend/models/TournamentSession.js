const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Sessão/fase de um torneio (spec §3.5): Dia 1A, 1B, 1C Turbo, Dia Final…
// Pertence ao MESMO torneio — não é um torneio independente. O vínculo operacional (fichários,
// modelos de stack) é do torneio e vale para todas as sessões (regra §18.8); a sessão só
// separa as ações (entradas) e as mesas. Relógio e blinds seguem no torneio (decisão D2).
const SESSION_STATUS = ['scheduled', 'running', 'finished'];

const TournamentSessionSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  name: { type: String, required: true, trim: true },
  order: { type: Number, default: 0 },                 // posição na sequência (Dia 1A = 1, 1B = 2…)
  starts_at: { type: Date, default: null },
  status: { type: String, enum: SESSION_STATUS, default: 'scheduled' },
  started_at: { type: Date, default: null },
  finished_at: { type: Date, default: null },
  notes: { type: String },
}, { timestamps: true });

TournamentSessionSchema.index({ tournament_id: 1, order: 1 });
TournamentSessionSchema.plugin(softDelete);

module.exports = mongoose.model('TournamentSession', TournamentSessionSchema);
module.exports.SESSION_STATUS = SESSION_STATUS;
