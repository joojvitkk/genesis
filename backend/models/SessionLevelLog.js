const mongoose = require('mongoose');

// Registro por NÍVEL da sessão (Tracking Sheet digital, item 1): o que o floor escrevia à mão a cada nível.
// Escolha: coleção própria (e não subdocumento da sessão) — cresce a cada nível, é consultada por sessão/torneio, precisa de
// índice único para impedir duplicidade com o executor de 1 s e comandos manuais simultâneos, e não infla o documento da
// sessão que o relógio regrava a cada tick.
//
// Imutável depois de fechado: correções entram em `corrections` (valor novo + motivo + autor); o original permanece.
const CorrectionSchema = new mongoose.Schema({
  field: { type: String, required: true },
  from: { type: Number, default: null },
  to: { type: Number, default: null },
  reason: { type: String, required: true },
  user_name: { type: String },
  at: { type: Date, default: Date.now },
}, { _id: false });

// Conferência do floor (item 3): contagem real de jogadores num nível. Só se acrescenta — nunca se apaga o histórico de ajustes.
const FloorCountSchema = new mongoose.Schema({
  counted: { type: Number, required: true },
  calculated: { type: Number, required: true },   // "jogando" calculado pelo sistema no momento
  diff: { type: Number, required: true },         // counted − calculated
  offset_after: { type: Number, default: null },  // active_offset da sessão depois do ajuste
  reason: { type: String },
  user_name: { type: String },
  at: { type: Date, default: Date.now },
}, { _id: false });

const Snapshot = {
  entries_initial: { type: Number, default: 0 },
  entries_reentries: { type: Number, default: 0 },
  entries_total: { type: Number, default: 0 },   // inscritos acumulados (entradas + reentradas válidas da sessão)
  playing: { type: Number, default: 0 },         // jogando (calculado pelo sistema)
  avg_stack: { type: Number, default: null },    // Chip Count da sessão ÷ jogando; null sem jogadores
};

const SessionLevelLogSchema = new mongoose.Schema({
  tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentSession', required: true },
  seq: { type: Number, required: true },                 // ordem em que a sessão passou pelas linhas (um nível revisitado vira novo registro)
  row_index: { type: Number, required: true },           // índice da linha na estrutura da sessão
  row_type: { type: String, default: 'level' },          // level | break | end_registration | end_day
  level_number: { type: Number, default: null },         // número OFICIAL (com level_offset); null em break/marcador
  label: { type: String },
  small_blind: { type: Number, default: null },
  big_blind: { type: Number, default: null },
  ante: { type: Number, default: 0 },
  planned_minutes: { type: Number, default: 0 },
  started_at: { type: Date, required: true },
  ended_at: { type: Date, default: null },
  paused_ms: { type: Number, default: 0 },               // tempo pausado dentro do nível
  paused_since: { type: Date, default: null },
  duration_ms: { type: Number, default: null },          // duração real, descontando pausas (preenchida ao fechar)
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  close_reason: { type: String },                        // auto | next | prev | goto | stop | session_finished | ...
  at_start: Snapshot,
  ...Snapshot,                                           // valores no FIM do nível (ou atuais, se aberto) — é o que a folha mostra
  corrections: { type: [CorrectionSchema], default: [] },
  floor_counts: { type: [FloorCountSchema], default: [] },
}, { timestamps: true });

// no máximo UM registro aberto por sessão: impede nível duplicado mesmo com o executor e comandos manuais simultâneos
SessionLevelLogSchema.index({ session_id: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });
SessionLevelLogSchema.index({ session_id: 1, seq: 1 }, { unique: true });
SessionLevelLogSchema.index({ tournament_id: 1, session_id: 1 });

module.exports = mongoose.model('SessionLevelLog', SessionLevelLogSchema);
