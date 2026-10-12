const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Sessão/fase de um torneio (spec §3.5): Dia 1A, 1B, 1C Turbo, Dia Final…
// Pertence ao MESMO torneio — não é um torneio independente. A estrutura (blinds, fichário, modelos de
// stack) é compartilhada com o torneio, mas o ESTADO EM EXECUÇÃO é da sessão (Simulação 2.1 §4): relógio,
// nível, entradas, reentradas, jogadores ativos, fichas em jogo e Chip Race. Pausar o 1A nunca mexe no 1B.
//   type QUALIFIER = permite buy-in, reentrada e atualização de ativos; ao encerrar registra os classificados.
//   type FINAL     = Dia Final: sem buy-in nem reentrada; começa com a soma dos classificados.
const SESSION_STATUS = ['scheduled', 'running', 'finished'];
const SESSION_TYPES = ['QUALIFIER', 'FINAL'];

const TournamentSessionSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  name: { type: String, required: true, trim: true },
  order: { type: Number, default: 0 },                 // posição na sequência (Dia 1A = 1, 1B = 2…)
  starts_at: { type: Date, default: null },
  status: { type: String, enum: SESSION_STATUS, default: 'scheduled' },
  started_at: { type: Date, default: null },
  finished_at: { type: Date, default: null },
  notes: { type: String },
  type: { type: String, enum: SESSION_TYPES, default: 'QUALIFIER' },

  // ─── Estado em execução (próprio da sessão) ───────────────────────────────
  clock_status: { type: String, enum: ['stopped', 'running', 'paused'], default: 'stopped' },
  current_level: { type: Number, default: 0 },
  level_started_at: { type: Date, default: null },
  paused_at: { type: Date, default: null },
  clock_adjust_seconds: { type: Number, default: 0 },
  active_offset: { type: Number, default: 0 },   // ajuste do Salão sobre os ativos derivados desta sessão
  // caches (derivados): atualizados por lib/headcount e lib/tournamentChips
  actual_players: { type: Number, default: 0 },
  entries_initial: { type: Number, default: 0 },
  entries_reentries: { type: Number, default: 0 },
  chips_value_in_play: { type: Number, default: null },
  // Classificados (só QUALIFIER): gravado ao encerrar; pode ser corrigido de forma auditável
  qualified_count: { type: Number, default: null },
  qualified_log: [{ _id: false, from: Number, to: Number, by: String, reason: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });

TournamentSessionSchema.index({ tournament_id: 1, order: 1 });
TournamentSessionSchema.plugin(softDelete);

module.exports = mongoose.model('TournamentSession', TournamentSessionSchema);
module.exports.SESSION_STATUS = SESSION_STATUS;
module.exports.SESSION_TYPES = SESSION_TYPES;
