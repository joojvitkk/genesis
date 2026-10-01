// Dashboard e relatórios sobre a FONTE DA VERDADE (G10, spec §14, §21): tudo é derivado dos movimentos
// (Σ to − Σ from). NADA aqui lê os caches legados de quantidade (ficha e fichário).
//
// A pergunta-guia: "onde estão as fichas?" (inventory, in_play) e "o que acontece agora?" (flows,
// occurrences, conflicts, timeline). Cada bloco é uma função independente para o front refazer só o afetado.
const mongoose = require('mongoose');
const { Movement, Chip, Binder, Tournament, TournamentSession, Allocation, Occurrence, Conversion } = require('../models');
const mv = require('./movements');
const allocationLib = require('./allocation');

const oid = (x) => new mongoose.Types.ObjectId(String(x));
const ACTIVE_OCC = { $nin: ['recovered', 'closed', 'voided'] };

async function chipDocs(ids) {
  const docs = ids.length ? await Chip.find({ _id: { $in: ids } }).setOptions({ withDeleted: true }).select('name value color active').lean() : [];
  return new Map(docs.map((c) => [String(c._id), c]));
}

/** Saldo líquido por (localização `kind`, ficha) — a base de "quantas fichas existem e onde estão". */
async function netByKindChip() {
  const agg = (side, sign) => Movement.aggregate([
    { $match: { [`${side}.kind`]: { $ne: 'external' } } },
    { $group: { _id: { k: `$${side}.kind`, c: '$chip_id' }, q: { $sum: sign > 0 ? '$quantity' : { $multiply: ['$quantity', -1] } } } },
  ]);
  const [ins, outs] = await Promise.all([agg('to', 1), agg('from', -1)]);
  const map = new Map();
  for (const r of [...ins, ...outs]) {
    const id = String(r._id.c);
    const cur = map.get(id) || { binder: 0, play: 0, lost: 0 };
    cur[r._id.k] = (cur[r._id.k] || 0) + r.q;
    map.set(id, cur);
  }
  return map;
}

// ─── inventory: onde estão as fichas ─────────────────────────────────────────
/** Por ficha: em fichários, reservado (alocações), livre, em jogo, em divergência + valor nominal. */
async function byChip() {
  const net = await netByKindChip();
  const chips = await chipDocs([...net.keys()]);
  const reserved = await mv.reservedByChip([...net.keys()]);
  const rows = [...net.entries()].map(([id, n]) => {
    const chip = chips.get(id) || { _id: id };
    const res = Math.min(reserved.get(id) || 0, Math.max(0, n.binder));
    return {
      chip, in_binders: n.binder, reserved: res, free: n.binder - res, in_play: n.play, lost: n.lost,
      existing: n.binder + n.play, value_in_binders: n.binder * (chip.value || 0), value_in_play: n.play * (chip.value || 0),
    };
  }).filter((r) => r.in_binders || r.in_play || r.lost).sort((a, b) => (a.chip.value ?? 0) - (b.chip.value ?? 0));
  const sum = (f) => rows.reduce((s, r) => s + r[f], 0);
  return {
    rows,
    totals: { in_binders: sum('in_binders'), reserved: sum('reserved'), free: sum('free'), in_play: sum('in_play'), lost: sum('lost'), existing: sum('existing'), value_in_binders: sum('value_in_binders'), value_in_play: sum('value_in_play') },
  };
}

/** Matriz fichário × denominação (saldo derivado — igual ao GET /balances). */
async function matrix() {
  const rows = await mv.balances({ kind: 'binder' });
  const [chips, binders] = await Promise.all([
    chipDocs([...new Set(rows.map((r) => String(r.chip_id)))]),
    Binder.find({ _id: { $in: [...new Set(rows.map((r) => String(r.binder_id)))] } }).setOptions({ withDeleted: true }).select('name code').lean(),
  ]);
  const bById = new Map(binders.map((b) => [String(b._id), b]));
  const chipList = [...new Set(rows.map((r) => String(r.chip_id)))].map((id) => chips.get(id) || { _id: id }).sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  const byBinder = new Map();
  for (const r of rows) {
    const b = byBinder.get(String(r.binder_id)) || { binder: bById.get(String(r.binder_id)) || { _id: r.binder_id }, cells: {}, total: 0, value: 0 };
    b.cells[String(r.chip_id)] = r.quantity;
    b.total += r.quantity;
    b.value += r.quantity * (chips.get(String(r.chip_id))?.value || 0);
    byBinder.set(String(r.binder_id), b);
  }
  return { chips: chipList, rows: [...byBinder.values()].sort((a, b) => String(a.binder.name).localeCompare(String(b.binder.name))) };
}

// ─── in_play: em qual torneio/sessão ─────────────────────────────────────────
async function inPlay() {
  const agg = (side, sign) => Movement.aggregate([
    { $match: { [`${side}.kind`]: 'play' } },
    { $group: { _id: { t: `$${side}.id`, s: '$session_id', c: '$chip_id' }, q: { $sum: sign > 0 ? '$quantity' : { $multiply: ['$quantity', -1] } } } },
  ]);
  const [ins, outs] = await Promise.all([agg('to', 1), agg('from', -1)]);
  const cells = new Map();
  for (const r of [...ins, ...outs]) {
    const k = `${r._id.t}|${r._id.s || ''}|${r._id.c}`;
    cells.set(k, { t: String(r._id.t), s: r._id.s ? String(r._id.s) : null, c: String(r._id.c), q: (cells.get(k)?.q || 0) + r.q });
  }
  const live = [...cells.values()].filter((x) => x.q !== 0);
  const chips = await chipDocs([...new Set(live.map((x) => x.c))]);
  const [tournaments, sessions] = await Promise.all([
    Tournament.find({ _id: { $in: [...new Set(live.map((x) => x.t))] } }).setOptions({ withDeleted: true }).select('name status').lean(),
    TournamentSession.find({ _id: { $in: [...new Set(live.filter((x) => x.s).map((x) => x.s))] } }).select('name status').lean(),
  ]);
  const tById = new Map(tournaments.map((t) => [String(t._id), t]));
  const sById = new Map(sessions.map((s) => [String(s._id), s]));
  const out = new Map();
  for (const x of live) {
    const chip = chips.get(x.c) || { _id: x.c };
    const t = out.get(x.t) || { tournament: tById.get(x.t) || { _id: x.t }, quantity: 0, value: 0, chips: new Map(), sessions: new Map() };
    const value = x.q * (chip.value || 0);
    t.quantity += x.q; t.value += value;
    t.chips.set(x.c, { chip, quantity: (t.chips.get(x.c)?.quantity || 0) + x.q });
    const sk = x.s || 'none';
    const s = t.sessions.get(sk) || { session: x.s ? (sById.get(x.s) || { _id: x.s }) : null, quantity: 0, value: 0 };
    s.quantity += x.q; s.value += value;
    t.sessions.set(sk, s);
    out.set(x.t, t);
  }
  const rows = [...out.values()].map((t) => ({
    tournament: t.tournament, quantity: t.quantity, value: t.value,
    chips: [...t.chips.values()].sort((a, b) => (a.chip.value ?? 0) - (b.chip.value ?? 0)),
    sessions: [...t.sessions.values()],
  })).sort((a, b) => String(a.tournament.name).localeCompare(String(b.tournament.name)));
  return { rows, totals: { quantity: rows.reduce((s, r) => s + r.quantity, 0), value: rows.reduce((s, r) => s + r.value, 0) } };
}

// ─── flows: o que aconteceu (enviado, devolvido, descartado, chip race, perdas) ───────
const FLOW_TYPES = ['SEND_BUY_IN', 'SEND_OPTIONAL', 'SEND_REENTRY', 'SEND_ADDITIONAL', 'RETURN', 'DISCARD', 'CHIP_RACE_OUT', 'CHIP_RACE_IN', 'COLOR_UP_OUT', 'COLOR_UP_IN', 'LOSS', 'FOUND', 'RECOVERY'];

/**
 * Líquido por tipo (um ESTORNO abate o tipo que desfez), em quantidade e valor. `filter` restringe (ex.: tournament_id).
 * @returns {Promise<Record<string, { quantity: number, value: number }>>}
 */
async function flowsByType(filter = {}) {
  const rows = await Movement.aggregate([
    { $match: { ...filter, $or: [{ type: { $in: FLOW_TYPES } }, { type: 'REVERSAL', 'meta.original_type': { $in: FLOW_TYPES } }] } },
    { $group: {
      _id: { t: { $cond: [{ $eq: ['$type', 'REVERSAL'] }, '$meta.original_type', '$type'] }, c: '$chip_id' },
      q: { $sum: { $cond: [{ $eq: ['$type', 'REVERSAL'] }, { $multiply: ['$quantity', -1] }, '$quantity'] } },
    } },
  ]);
  const chips = await chipDocs([...new Set(rows.map((r) => String(r._id.c)))]);
  const out = Object.fromEntries(FLOW_TYPES.map((t) => [t, { quantity: 0, value: 0 }]));
  for (const r of rows) {
    const cell = out[r._id.t];
    cell.quantity += r.q;
    cell.value += r.q * (chips.get(String(r._id.c))?.value || 0);
  }
  return out;
}

async function flows() {
  const f = await flowsByType();
  const add = (...types) => types.reduce((s, t) => ({ quantity: s.quantity + f[t].quantity, value: s.value + f[t].value }), { quantity: 0, value: 0 });
  const breakage = await Conversion.aggregate([{ $match: { status: 'active', legacy: { $ne: true } } }, { $group: { _id: '$type', b: { $sum: '$math_breakage' }, n: { $sum: 1 } } }]);
  const br = Object.fromEntries(breakage.map((r) => [r._id, r]));
  return {
    sent: add('SEND_BUY_IN', 'SEND_OPTIONAL', 'SEND_REENTRY', 'SEND_ADDITIONAL'),
    returned: f.RETURN, discarded: f.DISCARD,
    chip_race: { out: f.CHIP_RACE_OUT, in: f.CHIP_RACE_IN, count: br.CHIP_RACE?.n || 0, math_breakage: br.CHIP_RACE?.b || 0 },
    color_up: { out: f.COLOR_UP_OUT, in: f.COLOR_UP_IN, count: br.COLOR_UP?.n || 0, math_breakage: br.COLOR_UP?.b || 0 },
    lost: f.LOSS, found: f.FOUND, recovered: f.RECOVERY,
  };
}

// ─── occurrences / conflicts / timeline ──────────────────────────────────────
async function occurrenceStats() {
  const [open, recovered, missing] = await Promise.all([
    Occurrence.aggregate([{ $match: { status: ACTIVE_OCC } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]),
    Occurrence.aggregate([{ $match: { recovered_quantity: { $gt: 0 } } }, { $group: { _id: null, n: { $sum: 1 }, quantity: { $sum: '$recovered_quantity' } } }]),
    Occurrence.aggregate([{ $match: { kind: 'LOSS', status: ACTIVE_OCC } }, { $group: { _id: null, quantity: { $sum: { $subtract: ['$quantity', '$recovered_quantity'] } } } }]),
  ]);
  const open_by_severity = { GREEN: 0, YELLOW: 0, RED: 0, ...Object.fromEntries(open.map((r) => [r._id, r.n])) };
  return {
    open_by_severity, open_total: Object.values(open_by_severity).reduce((a, b) => a + b, 0),
    pending_justification: await Occurrence.countDocuments({ status: 'open' }),
    recovered: { occurrences: recovered[0]?.n || 0, quantity: recovered[0]?.quantity || 0 },
    missing_quantity: missing[0]?.quantity || 0,
  };
}

/** Conflitos de alocação: alocações abertas que já não têm saldo (perda depois de alocar). */
async function conflicts() {
  const rows = await Allocation.find({ open: true }).populate([{ path: 'binder_id', select: 'name code' }, { path: 'tournament_id', select: 'name' }, { path: 'chips.chip_id', select: 'name value color' }]);
  const healthy = await allocationLib.withHealth(rows);
  return healthy.filter((a) => a.has_shortfall).map((a) => ({
    allocation_id: a._id, binder: a.binder_id, tournament: a.tournament_id,
    chips: a.chips.filter((c) => c.shortfall > 0).map((c) => ({ chip: c.chip_id, shortfall: c.shortfall, balance: c.balance })),
  }));
}

async function timeline(limit = 15) {
  return Movement.find().sort({ createdAt: -1 }).limit(limit)
    .populate([{ path: 'chip_id', select: 'name value color' }, { path: 'binder_id', select: 'name code' }, { path: 'tournament_id', select: 'name' }]).lean();
}

/** Fichários sem nenhuma alocação aberta (o "livre" agora vem das alocações, não de um status digitado). */
async function freeBinders() {
  const all = await Binder.countDocuments();
  const used = (await Allocation.distinct('binder_id', { open: true })).length;
  return { total: all, free: Math.max(0, all - used), allocated: used };
}

// ─── o painel ────────────────────────────────────────────────────────────────
const BLOCKS = {
  inventory: async () => ({ ...(await byChip()), matrix: await matrix() }),
  in_play: inPlay,
  flows,
  occurrences: occurrenceStats,
  conflicts,
  timeline: () => timeline(),
  binders: freeBinders,
};

/** `blocks`: lista dos blocos pedidos (default: todos). Cada um é calculado só se pedido. */
async function stats(blocks) {
  const wanted = (blocks && blocks.length ? blocks : Object.keys(BLOCKS)).filter((b) => BLOCKS[b]);
  const entries = await Promise.all(wanted.map(async (b) => [b, await BLOCKS[b]()]));
  return Object.fromEntries(entries);
}

module.exports = { stats, byChip, matrix, inPlay, flows, flowsByType, occurrenceStats, conflicts, timeline, freeBinders, netByKindChip, BLOCKS, FLOW_TYPES };
