// Histórico de saldo (G11, spec §15): reconstrói, a partir dos MOVIMENTOS, o efeito de cada lançamento no saldo de
// uma ficha, de um fichário ou de um torneio — com o saldo "depois do lançamento". Nada é gravado: é leitura pura.
const mongoose = require('mongoose');
const { Movement, Chip, Binder, Tournament } = require('../models');
const { HttpError } = require('./catalog');

const oid = (x) => new mongoose.Types.ObjectId(String(x));
const key = (l) => `${l.kind}:${l.id ?? ''}`;

/** Localizações acompanhadas por entidade. `null` = todas (histórico da ficha). */
function tracked({ binder_id, tournament_id }) {
  if (binder_id) return [{ kind: 'binder', id: binder_id }, { kind: 'lost', id: binder_id }];
  if (tournament_id) return [{ kind: 'play', id: tournament_id }, { kind: 'lost', id: tournament_id }];
  return null;
}

/**
 * @param {{ binder_id?, chip_id?, tournament_id? }} q  ao menos um; fichário + ficha filtra a ficha dentro do fichário
 * @returns {Promise<{ entity, rows, balances }>} rows do mais NOVO para o mais antigo; `balances` = saldo atual por localização × ficha
 */
async function history(q = {}) {
  const ids = ['binder_id', 'chip_id', 'tournament_id'].filter((k) => q[k]);
  if (!ids.length) throw new HttpError(400, 'Informe a ficha, o fichário ou o torneio (chip_id, binder_id ou tournament_id).');
  if (q.binder_id && q.tournament_id) throw new HttpError(400, 'Escolha o fichário OU o torneio.');
  for (const k of ids) if (!mongoose.isValidObjectId(q[k])) throw new HttpError(400, `${k} inválido.`);

  const scope = tracked(q);
  const match = {};
  if (q.chip_id) match.chip_id = oid(q.chip_id);
  if (scope) match.$or = scope.flatMap((l) => [{ 'from.kind': l.kind, 'from.id': oid(l.id) }, { 'to.kind': l.kind, 'to.id': oid(l.id) }]);
  const mine = scope ? new Set(scope.map(key)) : null;

  const moves = await Movement.find(match).sort({ createdAt: 1, _id: 1 })
    .populate([{ path: 'chip_id', select: 'name value color' }, { path: 'binder_id', select: 'name code' }, { path: 'tournament_id', select: 'name' }])
    .lean();
  const reversedBy = new Map((await Movement.find({ reverses: { $in: moves.map((m) => m._id) } }).select('reverses reason user_name createdAt').lean()).map((r) => [String(r.reverses), r]));

  const balance = new Map(); // "<local>|<ficha>" -> saldo
  const rows = [];
  for (const m of moves) {
    const effects = [];
    for (const [loc, sign] of [[m.from, -1], [m.to, 1]]) {
      if (loc.kind === 'external') continue;                // origem/destino ilimitados: não têm saldo
      if (mine && !mine.has(key(loc))) continue;
      const k = `${key(loc)}|${m.chip_id._id}`;
      const after = (balance.get(k) || 0) + sign * m.quantity;
      balance.set(k, after);
      effects.push({ location: { kind: loc.kind, id: loc.id }, delta: sign * m.quantity, balance_after: after });
    }
    if (effects.length) rows.push({ ...m, effects, reversed_by: reversedBy.get(String(m._id)) || null });
  }

  const [chip, binder, tournament] = await Promise.all([
    q.chip_id ? Chip.findById(q.chip_id).setOptions({ withDeleted: true }).select('name value') : null,
    q.binder_id ? Binder.findById(q.binder_id).setOptions({ withDeleted: true }).select('name code') : null,
    q.tournament_id ? Tournament.findById(q.tournament_id).setOptions({ withDeleted: true }).select('name') : null,
  ]);
  if (q.chip_id && !chip) throw new HttpError(404, 'Ficha não encontrada.');
  if (q.binder_id && !binder) throw new HttpError(404, 'Fichário não encontrado.');
  if (q.tournament_id && !tournament) throw new HttpError(404, 'Torneio não encontrado.');

  const entity = q.binder_id ? { type: 'binder', _id: binder._id, name: binder.name } : q.tournament_id ? { type: 'tournament', _id: tournament._id, name: tournament.name } : { type: 'chip', _id: chip._id, name: chip.name };
  const balances = [...balance.entries()].filter(([, v]) => v !== 0).map(([k, v]) => { const [loc, chipId] = k.split('|'); const [kind, id] = loc.split(':'); return { location: { kind, id: id || null }, chip_id: chipId, quantity: v }; });
  return { entity, rows: rows.reverse(), balances };
}

/**
 * Conciliação de um fichário por denominação (BUG-07): saldo inicial + entradas − saídas = saldo atual, com a quebra por tipo
 * de movimento, o que está reservado (alocações abertas) e o que está efetivamente livre. Leitura pura.
 * `explained` = o saldo atual é exatamente o que os movimentos explicam (sempre deve ser true: o saldo É derivado deles).
 */
async function reconcile(binderId) {
  if (!mongoose.isValidObjectId(binderId)) throw new HttpError(400, 'Fichário inválido.');
  const binder = await Binder.findById(binderId).setOptions({ withDeleted: true }).select('name');
  if (!binder) throw new HttpError(404, 'Fichário não encontrado.');
  const id = oid(binderId);
  const moves = await Movement.find({ $or: [{ 'from.kind': 'binder', 'from.id': id }, { 'to.kind': 'binder', 'to.id': id }] })
    .sort({ createdAt: 1, _id: 1 }).select('chip_id type quantity from to batch_id').lean();
  const firstBatch = moves.length ? String(moves[0].batch_id) : null;
  const by = new Map();
  const row = (c) => by.get(c) || by.set(c, { chip_id: c, opening: 0, entries: {}, exits: {}, balance: 0 }).get(c);
  for (const m of moves) {
    const r = row(String(m.chip_id));
    const incoming = m.to.kind === 'binder' && String(m.to.id) === String(id);
    const q = incoming ? m.quantity : -m.quantity;
    r.balance += q;
    if (incoming && m.type === 'ASSEMBLY' && String(m.batch_id) === firstBatch) r.opening += m.quantity; // saldo inicial do cadastro
    else (incoming ? r.entries : r.exits)[m.type] = ((incoming ? r.entries : r.exits)[m.type] || 0) + m.quantity;
  }
  const states = await require('./movements').allocationStates(id);
  const reserved = new Map();
  for (const st of states) for (const c of st.chips || []) reserved.set(String(c.chip_id), (reserved.get(String(c.chip_id)) || 0) + c.remaining);
  const chips = new Map((await Chip.find({ _id: { $in: [...by.keys()] } }).setOptions({ withDeleted: true }).select('name value').lean()).map((c) => [String(c._id), c]));
  const rows = [...by.values()].map((r) => {
    const inn = Object.values(r.entries).reduce((a, b) => a + b, 0);
    const out = Object.values(r.exits).reduce((a, b) => a + b, 0);
    const res = Math.min(reserved.get(r.chip_id) || 0, Math.max(0, r.balance));
    return { chip: chips.get(r.chip_id) || { _id: r.chip_id }, ...r, total_in: inn, total_out: out, explained: r.opening + inn - out === r.balance, reserved: res, free: Math.max(0, r.balance - res) };
  }).sort((a, b) => (a.chip.value ?? 0) - (b.chip.value ?? 0));
  return { binder: { _id: binder._id, name: binder.name }, rows, explained: rows.every((r) => r.explained) };
}

module.exports = { history, reconcile };
