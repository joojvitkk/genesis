const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');
const { computeStartsAt, DEFAULT_TZ } = require('../lib/datetime');

const TournamentSchema = new mongoose.Schema({
  event_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null }, // Evento → Torneio → Sessões (G4)
  number: { type: Number, default: null, min: 1 },                                  // nº do torneio no evento (#02)
  name: { type: String, required: true },
  date: { type: Date, required: true },
  start_time: { type: String },
  timezone: { type: String, default: DEFAULT_TZ },       // P6 — fuso do salão
  starts_at: { type: Date, default: null },               // instante derivado (date+start_time@tz)
  status: { type: String, enum: ['scheduled', 'running', 'paused', 'finished', 'finalized'], default: 'scheduled' },
  estimated_players: { type: Number, default: 0 },
  actual_players: { type: Number, default: 0 },
  entry_seq: { type: Number, default: 0 }, // contador das entradas (numera "Entrada #n"; nunca volta atrás, nem ao cancelar)
  starting_stack: { type: Number, default: 0 }, // DERIVADO: valor nominal do stack do buy-in padrão
  // Modelo de stack PADRÃO (vale para toda ação sem mapeamento próprio) e mapeamento por AÇÃO
  // (`action` = chave da coluna do modelo: buy_in, optional_buy_in, re_entry, add_on…).
  stack_model_id: { type: mongoose.Schema.Types.ObjectId, ref: 'StackModel', default: null },
  stack_models: [{
    _id: false,
    action: { type: String, required: true },
    stack_model_id: { type: mongoose.Schema.Types.ObjectId, ref: 'StackModel', required: true },
  }],
  // Valor nominal das fichas em jogo — DERIVADO (lib/tournamentChips.refreshTournamentChips), null = não calculado.
  chips_value_in_play: { type: Number, default: null },
  blind_structure: [{
    row_type: { type: String, enum: ['level', 'break', 'end_registration', 'end_day'], default: 'level' },
    level: { type: Number },
    small_blind: { type: Number },
    big_blind: { type: Number },
    ante: { type: Number },
    duration: { type: Number },   // minutes (for levels and breaks)
    label: { type: String }       // custom label for special rows
  }],
  current_level: { type: Number, default: 0 },
  notes: { type: String },
  seats_per_table: { type: Number, default: 9 }, // P4
  blind_version: { type: Number, default: 0 },   // P6 — trava otimista da estrutura de blinds

  // ─── Financeiro (P2) ─────────────────────────────────────────────────────
  buy_in: { type: Number, default: 0 },        // valor total da entrada
  rake: { type: Number, default: 0 },          // valor fixo de rake por entrada
  addon_value: { type: Number, default: 0 },   // preço do add-on (0 = sem add-on)
  addon_chips: { type: Number, default: 0 },   // fichas que o add-on concede
  bounty_value: { type: Number, default: 0 },  // parte do buy-in reservada como bounty (financeiro do torneio)
  payout_template_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PayoutTemplate', default: null },
  finalized_at: { type: Date, default: null },

  // ─── Relógio do torneio (P1) ──────────────────────────────────────────────
  // Fonte da verdade fica no servidor; clientes só renderizam a contagem.
  clock_status: { type: String, enum: ['stopped', 'running', 'paused'], default: 'stopped' },
  level_started_at: { type: Date, default: null },     // início efetivo do nível atual
  paused_at: { type: Date, default: null },            // instante da pausa (null = rodando)
  clock_adjust_seconds: { type: Number, default: 0 },  // ajuste manual acumulado no nível
}, { timestamps: true });

// mantém starts_at derivado sempre que date/start_time/timezone mudam
TournamentSchema.pre('save', function () {
  if (this.isModified('date') || this.isModified('start_time') || this.isModified('timezone') || this.starts_at == null) {
    this.starts_at = computeStartsAt(this.date, this.start_time, this.timezone);
  }
});

TournamentSchema.plugin(softDelete);
TournamentSchema.index({ status: 1, starts_at: -1 });
TournamentSchema.index({ clock_status: 1 });

module.exports = mongoose.model('Tournament', TournamentSchema);
