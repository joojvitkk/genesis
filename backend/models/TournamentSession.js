const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Sessão/fase de um torneio (spec §3.5): Dia 1A, 1B, 1C Turbo, Dia Final…
// Pertence ao MESMO torneio — não é um torneio independente. A estrutura (blinds, fichário, modelos de
// stack) é compartilhada com o torneio, mas o ESTADO EM EXECUÇÃO é da sessão (Simulação 2.1 §4): relógio,
// nível, entradas, reentradas, jogadores ativos, fichas em jogo e Chip Race. Pausar o 1A nunca mexe no 1B.
//   type QUALIFIER = permite buy-in, reentrada e atualização de ativos; ao encerrar registra os classificados.
//   type CONTINUATION = fase de continuação (Dia 2, 3, 4…): herda classificados e fichas da fase anterior.
//   type FINAL     = Dia Final: herda como a continuação; sem buy-in/reentrada por padrão.
//   type SINGLE    = Dia Único: aceita entradas, fichas próprias (ações × montagem); nunca herda nem gera classificados.
// Inscrições são configuráveis POR SESSÃO (allow_buyins/allow_reentries/encerramento); null = padrão do tipo
// (classificatória permite, continuação e final não). Cada sessão tem a SUA estrutura de blinds (blind_structure).
const SESSION_STATUS = ['scheduled', 'running', 'finished'];
const SESSION_TYPES = ['QUALIFIER', 'CONTINUATION', 'FINAL', 'SINGLE'];
// Fases que HERDAM classificados e fichas das origens (Dia 2, 3…, Final). Classificatória e Dia Único têm fichas próprias.
const INHERITING_TYPES = ['CONTINUATION', 'FINAL'];
const START_MODES = ['manual', 'next', 'resume'];

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
  // Continuidade de níveis (Simulação 3.0 §4): a fase seguinte (Dia Final) continua a numeração do último nível jogável das
  // classificatórias. `level_offset` = último nível anterior (o primeiro nível da fase é offset + 1); `blind_structure` é a
  // estrutura PRÓPRIA da fase (1ª linha preenchida com os blinds do último nível anterior, editáveis sem mudar o número).
  level_offset: { type: Number, default: 0 },
  blind_structure: [{
    _id: false,
    row_type: { type: String, enum: ['level', 'break', 'end_registration', 'end_day'], default: 'level' },
    level: Number, // número OFICIAL do nível (a 1ª linha da estrutura não precisa ser o Nível 1)
    small_blind: Number, big_blind: Number, ante: Number, duration: Number, label: String,
  }],
  blind_source: { type: String, default: null }, // nome da estrutura (Tracking Sheet) ou "Torneio" de onde a sessão copiou os níveis
  blinds_edited: { type: Boolean, default: false },
  // Continuidade configurável: como a fase começa em relação ao último nível da fase anterior.
  start_mode: { type: String, enum: [...START_MODES, null], default: null }, // next (padrão) | resume | manual
  resume_remaining_ms: { type: Number, default: null },  // tempo restante a aplicar ao iniciar (modo resume)
  // Ao encerrar: último nível efetivamente jogado (número oficial) e o tempo que restava nele
  ended_level_number: { type: Number, default: null },
  ended_remaining_ms: { type: Number, default: null },
  // Inscrições da sessão (null = padrão do tipo) e encerramento opcional do registro
  allow_buyins: { type: Boolean, default: null },
  allow_reentries: { type: Boolean, default: null },
  registration_close_level: { type: Number, default: null },   // registro fecha após este nível oficial
  registration_close_marker: { type: Boolean, default: false }, // ou ao passar o marcador "Fim do Registro" da estrutura
  active_offset: { type: Number, default: 0 },   // ajuste do Salão sobre os ativos derivados desta sessão
  // caches (derivados): atualizados por lib/headcount e lib/tournamentChips
  actual_players: { type: Number, default: 0 },
  entries_initial: { type: Number, default: 0 },
  entries_reentries: { type: Number, default: 0 },
  chips_value_in_play: { type: Number, default: null },
  // Classificados (QUALIFIER e CONTINUATION; Dia Final e Dia Único não geram): gravado ao encerrar; pode ser corrigido de forma auditável
  qualified_count: { type: Number, default: null },
  // Ajuste de fechamento: ao encerrar, "Jogando" passa a ser os classificados (valor anterior, autor e horário ficam registrados)
  closing_adjust: { type: new mongoose.Schema({ previous_active: Number, qualified: Number, by: String, at: { type: Date, default: Date.now } }, { _id: false }), default: null },
  qualified_log: [{ _id: false, from: Number, to: Number, by: String, reason: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });

TournamentSessionSchema.index({ tournament_id: 1, order: 1 });
TournamentSessionSchema.plugin(softDelete);

module.exports = mongoose.model('TournamentSession', TournamentSessionSchema);
module.exports.SESSION_STATUS = SESSION_STATUS;
module.exports.SESSION_TYPES = SESSION_TYPES;
module.exports.INHERITING_TYPES = INHERITING_TYPES;
module.exports.START_MODES = START_MODES;
