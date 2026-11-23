// "Livro do torneio": visão consolidada, SÓ DE LEITURA, no formato da planilha do Material.
// Linhas = denominações; colunas = sessões. Por sessão: ações, esperado (ações × montagem), trocas (saiu/entrou, com a quebra),
// descartes, Chip Count (em jogo) e a contagem de fim de dia com a diferença. Valores = valor NOMINAL das fichas.
const { Tournament, TournamentEntry, Conversion, SessionCount } = require('../models');
const tournamentChips = require('./tournamentChips');
const sessionsLib = require('./sessions');
const { HttpError } = require('./catalog');

const sid = (x) => String(x);

async function bookOf(tournamentId) {
  const tournament = await Tournament.findById(tournamentId).lean();
  if (!tournament) throw new HttpError(404, 'Torneio não encontrado.');
  const sessions = await sessionsLib.listSessions(tournamentId);

  const chips = new Map(); // chip_id → chip
  const out = [];
  for (const s of sessions) {
    const inPlay = await tournamentChips.chipsInPlay(tournamentId, { sessionId: s._id });
    const entries = await TournamentEntry.find({ tournament_id: tournamentId, session_id: s._id }).select('type action').lean();
    const actions = {};
    for (const e of entries) { const a = tournamentChips.actionOf(e); if (a) actions[a] = (actions[a] || 0) + 1; }
    const convs = await Conversion.find({ tournament_id: tournamentId, session_id: s._id, status: 'active', legacy: { $ne: true } }).lean();
    const count = await SessionCount.findOne({ tournament_id: tournamentId, session_id: s._id, status: 'active' }).sort({ createdAt: -1 }).lean();

    const by = {};
    const cell = (id) => by[id] || (by[id] = { expected: 0, out: 0, in: 0, discarded: 0, in_play: 0, counted: null, diff: null });
    for (const r of inPlay.rows) {
      const id = sid(r.chip._id);
      chips.set(id, r.chip);
      const c = cell(id);
      c.in_play = r.quantity;
      c.discarded = r.discarded || 0;
      c.expected = r.quantity - (r.conversion || 0) + (r.discarded || 0); // antes de trocas e descartes
    }
    for (const cv of convs) {
      for (const l of cv.outs) cell(sid(l.chip_id)).out += l.quantity;
      for (const l of cv.ins) cell(sid(l.chip_id)).in += l.quantity;
    }
    for (const l of count?.players || []) { const c = cell(sid(l.chip_id)); c.counted = l.counted; c.diff = l.counted - l.expected; }

    out.push({
      session_id: sid(s._id), name: s.name, type: s.type, status: s.status, actions,
      total_actions: Object.values(actions).reduce((a, b) => a + b, 0),
      by_chip: by,
      breakage: convs.reduce((sum, cv) => sum + (cv.math_breakage || 0), 0),
      counted_at: count?.createdAt || null, counted_by: count?.user_name || null, has_count: !!count,
      count_hall_checked: !!count?.hall_checked,
    });
  }

  const missing = [...new Set(out.flatMap((s) => Object.keys(s.by_chip)))].filter((id) => !chips.has(id));
  if (missing.length) {
    const { Chip } = require('../models');
    for (const c of await Chip.find({ _id: { $in: missing } }).setOptions({ withDeleted: true }).select('name value color').lean()) chips.set(sid(c._id), c);
  }
  const value = (id) => chips.get(id)?.value || 0;
  for (const s of out) {
    const sum = (f) => Object.entries(s.by_chip).reduce((t, [id, c]) => t + (c[f] || 0) * value(id), 0);
    s.totals = {
      expected: sum('expected'), out: sum('out'), in: sum('in'), discarded: sum('discarded'), in_play: sum('in_play'),
      counted: s.has_count ? Object.entries(s.by_chip).reduce((t, [id, c]) => t + (c.counted ?? c.in_play) * value(id), 0) : null,
    };
    s.totals.diff = s.has_count ? s.totals.counted - s.totals.in_play : null;
  }
  const rows = [...chips.entries()].map(([id, chip]) => ({ chip: { _id: id, name: chip.name, value: chip.value, color: chip.color } }))
    .sort((a, b) => (a.chip.value || 0) - (b.chip.value || 0));
  const total = (f) => out.reduce((t, s) => t + (s.totals[f] || 0), 0);
  return {
    tournament: { _id: sid(tournament._id), name: tournament.name }, chips: rows.map((r) => r.chip), sessions: out,
    totals: { expected: total('expected'), out: total('out'), in: total('in'), discarded: total('discarded'), in_play: total('in_play'), breakage: out.reduce((t, s) => t + s.breakage, 0), actions: out.reduce((t, s) => t + s.total_actions, 0) },
  };
}

module.exports = { bookOf };
