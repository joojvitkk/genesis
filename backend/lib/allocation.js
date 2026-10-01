// Alocação parcial e validação de conflito (G5) — spec §5, §18.2, §18.9.
//
//   livre(fichário, ficha) = saldo físico − Σ alocações abertas (planejadas/ativas) de todos os torneios
//   quantidade alocada ≤ livre   (senão 409 com o excesso e quem está segurando)
//
// A checagem roda DENTRO dos mesmos bloqueios do motor de movimentações (`movements.execute` com as chaves
// `binder:<id>:<ficha>`): uma alocação e uma retirada simultâneas da mesma ficha se serializam, então o
// saldo nunca fica alocado acima do que existe. A reserva vale desde a criação (não só quando o torneio inicia).
const mongoose = require('mongoose');
const { Allocation, Binder, Chip, Tournament } = require('../models');
const mv = require('./movements');
const { HttpError } = require('./catalog');

const CLOSED = ['finished', 'finalized'];
const RUNNING = ['running', 'paused'];
const oid = (x) => new mongoose.Types.ObjectId(String(x));
const idOf = (x) => String(x && x._id ? x._id : x);

const statusFor = (tournament) => (RUNNING.includes(tournament.status) ? 'active' : 'planned');

// ─── pedido → lista de fichas ────────────────────────────────────────────────
function normalizeQuantities(list) {
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Informe as fichas e quantidades a alocar.');
  const seen = new Set();
  return list.map((l) => {
    const id = String(l?.chip_id || '');
    if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Ficha inválida na alocação.');
    if (seen.has(id)) throw new HttpError(400, 'A mesma ficha não pode aparecer duas vezes na alocação.');
    seen.add(id);
    const quantity = Number(l.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) throw new HttpError(400, 'A quantidade de cada ficha deve ser um inteiro ≥ 1.');
    return { chip_id: id, quantity };
  });
}

/**
 * Traduz o modo em fichas:
 *  - quantities:    `chips: [{ chip_id, quantity }]` explícito;
 *  - binder:        TODAS as fichas do fichário, na quantidade do saldo (fichário inteiro);
 *  - denominations: as fichas escolhidas (`chip_ids`) ou por faixa de valor (`min_value`/`max_value`),
 *                   na quantidade do saldo (ex.: ≥ 5.000 no torneio A, ≤ 1.000 no B).
 * `full` = a quantidade é o saldo inteiro da ficha (recalculado sob o bloqueio).
 */
async function resolveRequest(binderId, mode, params) {
  if (mode === 'quantities') return { wanted: normalizeQuantities(params.chips), full: false };
  if (!['binder', 'denominations'].includes(mode)) throw new HttpError(400, 'Modo inválido. Use: binder, denominations ou quantities.');

  let rows = (await mv.balances({ binder_id: binderId })).filter((r) => r.quantity > 0);
  if (mode === 'denominations') {
    const ids = Array.isArray(params.chip_ids) ? params.chip_ids.map(String) : null;
    const min = params.min_value !== undefined && params.min_value !== null && params.min_value !== '' ? Number(params.min_value) : null;
    const max = params.max_value !== undefined && params.max_value !== null && params.max_value !== '' ? Number(params.max_value) : null;
    if (!ids?.length && min === null && max === null) throw new HttpError(400, 'Informe chip_ids ou uma faixa de valor (min_value/max_value).');
    if ([min, max].some((v) => v !== null && !Number.isFinite(v))) throw new HttpError(400, 'Faixa de valor inválida.');
    if (min !== null && max !== null && min > max) throw new HttpError(400, 'A faixa de valor está invertida (min > max).');
    const chips = await Chip.find({ _id: { $in: rows.map((r) => r.chip_id) } }).setOptions({ withDeleted: true });
    const value = new Map(chips.map((c) => [String(c._id), c.value]));
    if (ids?.length) {
      const have = new Set(rows.map((r) => String(r.chip_id)));
      const missing = ids.filter((id) => !have.has(id));
      if (missing.length) throw new HttpError(400, 'Alguma ficha escolhida não tem saldo neste fichário.');
      rows = rows.filter((r) => ids.includes(String(r.chip_id)));
    }
    rows = rows.filter((r) => {
      const v = value.get(String(r.chip_id)) ?? 0;
      return (min === null || v >= min) && (max === null || v <= max);
    });
    if (!rows.length) throw new HttpError(400, 'Nenhuma ficha do fichário corresponde à seleção.');
  }
  if (!rows.length) throw new HttpError(400, 'O fichário não tem fichas (monte-o antes de alocar).');
  return { wanted: rows.map((r) => ({ chip_id: String(r.chip_id), quantity: r.quantity })), full: true };
}

// ─── regra central ───────────────────────────────────────────────────────────
/** Confere `quantidade ≤ livre` por ficha; devolve os conflitos (vazio = ok). Ajusta `full` ao saldo atual. */
async function findConflicts(binderId, wanted, { full, excludeAllocationId, session }) {
  const conflicts = [];
  for (const w of wanted) {
    const balance = await mv.balanceAt({ kind: 'binder', id: oid(binderId) }, w.chip_id, session);
    if (full) w.quantity = balance;
    if (w.quantity <= 0) continue;
    const held = await mv.allocatedIn(binderId, w.chip_id, { session, excludeAllocationId });
    const free = Math.max(0, balance - held.total);
    if (w.quantity > free) {
      conflicts.push({ chip_id: w.chip_id, requested: w.quantity, balance, allocated_elsewhere: held.total, free, excess: w.quantity - free, held_by: held.by });
    }
  }
  return conflicts;
}

async function conflictError(binderId, conflicts) {
  const chips = await Chip.find({ _id: { $in: conflicts.map((c) => c.chip_id) } }).setOptions({ withDeleted: true }).select('name');
  const chipName = new Map(chips.map((c) => [String(c._id), c.name]));
  const tIds = [...new Set(conflicts.flatMap((c) => c.held_by.map((h) => String(h.tournament_id))))];
  const ts = tIds.length ? await Tournament.find({ _id: { $in: tIds } }).setOptions({ withDeleted: true }).select('name') : [];
  const tName = new Map(ts.map((t) => [String(t._id), t.name]));
  const binder = await Binder.findById(binderId).setOptions({ withDeleted: true }).select('name');

  const details = conflicts.map((c) => ({
    ...c, chip: chipName.get(String(c.chip_id)),
    held_by: c.held_by.map((h) => ({ tournament_id: h.tournament_id, tournament: tName.get(String(h.tournament_id)), quantity: h.quantity })),
  }));
  const first = details[0];
  const who = first.held_by.length ? `; já alocadas: ${first.held_by.map((h) => `${h.tournament || 'torneio'} ${h.quantity}`).join(', ')}` : '';
  const err = new HttpError(409,
    `Alocação acima do saldo livre em "${binder?.name}": ${first.chip} — pedido ${first.requested}, livre ${first.free} (excesso ${first.excess})${who}.`
    + (details.length > 1 ? ` (+${details.length - 1} ficha(s) em conflito)` : ''), details);
  err.allocationConflict = { binder_id: binderId, details };
  return err;
}

const lockKeys = (binderId, chipIds) => chipIds.map((c) => mv.locKey({ kind: 'binder', id: oid(binderId) }, c));

// ─── criar / editar / liberar ────────────────────────────────────────────────
/**
 * Cria a alocação de um fichário para um torneio. Reserva na hora (status `planned`, ou `active` se o
 * torneio já está rodando). Uma alocação aberta por (torneio, fichário): para mudar, use `updateChips`.
 */
async function allocate(tournament, { binder_id, mode = 'quantities', note, ...params }, user) {
  if (CLOSED.includes(tournament.status)) throw new HttpError(409, 'O torneio está encerrado: não aceita novas alocações.');
  if (!mongoose.isValidObjectId(binder_id)) throw new HttpError(400, 'Informe o fichário.');
  const binder = await Binder.findById(binder_id);
  if (!binder) throw new HttpError(404, 'Fichário não encontrado.');
  if (binder.status === 'maintenance') throw new HttpError(409, `O fichário "${binder.name}" está em manutenção.`);
  if (await Allocation.exists({ tournament_id: tournament._id, binder_id: binder._id, open: true })) {
    throw new HttpError(409, `Este torneio já tem uma alocação do fichário "${binder.name}": edite-a ou libere-a.`);
  }

  const { wanted, full } = await resolveRequest(binder._id, mode, params);
  let created;
  try {
    created = await mv.execute(lockKeys(binder._id, wanted.map((w) => w.chip_id)), async (session) => {
      const conflicts = await findConflicts(binder._id, wanted, { full, session });
      if (conflicts.length) throw await conflictError(binder._id, conflicts);
      const chips = wanted.filter((w) => w.quantity > 0);
      if (!chips.length) throw new HttpError(400, 'O fichário não tem saldo das fichas selecionadas.');
      const [doc] = await Allocation.create([{
        tournament_id: tournament._id, binder_id: binder._id, mode, chips, status: statusFor(tournament),
        note, created_by: user?.name || user?.email || 'Sistema',
      }], session ? { session } : {});
      return doc;
    });
  } catch (err) {
    if (err?.code === 11000) throw new HttpError(409, 'Este torneio já tem uma alocação aberta deste fichário.');
    throw err;
  }
  return created;
}

/** Substitui as fichas/quantidades de uma alocação aberta (a lista completa; o que não vier é removido). */
async function updateChips(allocation, list, user) {
  if (!allocation.open) throw new HttpError(409, 'A alocação já foi liberada.');
  const wanted = normalizeQuantities(list);
  const before = allocation.chips.map((c) => String(c.chip_id));
  const keys = lockKeys(allocation.binder_id, [...new Set([...before, ...wanted.map((w) => w.chip_id)])]);
  await mv.execute(keys, async (session) => {
    // o que já foi ENVIADO ao torneio não pode ficar acima do novo teto (nem a ficha pode sumir da lista)
    const [state] = (await mv.allocationStates(allocation.binder_id, { session })).filter((x) => String(x.allocation_id) === String(allocation._id));
    for (const c of state?.chips || []) {
      const w = wanted.find((x) => x.chip_id === String(c.chip_id));
      if (c.sent > 0 && (!w || w.quantity < c.sent)) {
        throw new HttpError(409, `Já foram enviadas ${c.sent} unidade(s) desta ficha ao torneio: a alocação não pode ficar abaixo disso.`,
          [{ chip_id: c.chip_id, sent: c.sent, requested: w?.quantity || 0 }]);
      }
    }
    const conflicts = await findConflicts(allocation.binder_id, wanted, { full: false, excludeAllocationId: allocation._id, session });
    if (conflicts.length) throw await conflictError(allocation.binder_id, conflicts);
    allocation.chips = wanted;
    allocation.mode = 'quantities';
    await allocation.save(session ? { session } : {});
  });
  return allocation;
}

/** Libera a alocação (fica no histórico como `released`); a capacidade volta a ficar livre. */
async function release(allocation, user) {
  if (!allocation.open) return allocation;
  allocation.open = false;
  allocation.status = 'released';
  allocation.released_at = new Date();
  allocation.released_by = user?.name || user?.email || 'Sistema';
  await allocation.save();
  return allocation;
}

// ─── ciclo de vida do torneio ────────────────────────────────────────────────
/** Torneio começou: as alocações planejadas passam a ativas (a reserva já existia desde a criação). */
async function activateForTournament(tournamentId) {
  return (await Allocation.updateMany({ tournament_id: tournamentId, open: true, status: 'planned' }, { $set: { status: 'active' } })).modifiedCount;
}

/** Torneio encerrou/foi excluído: libera todas as alocações abertas. */
async function releaseForTournament(tournamentId, user) {
  const open = await Allocation.find({ tournament_id: tournamentId, open: true });
  if (!open.length) return 0;
  await Allocation.updateMany(
    { _id: { $in: open.map((a) => a._id) } },
    { $set: { open: false, status: 'released', released_at: new Date(), released_by: user?.name || user?.email || 'Sistema' } },
  );
  return open.length;
}

// ─── leitura ─────────────────────────────────────────────────────────────────
/**
 * Matriz de um fichário: por ficha, saldo físico, quanto está alocado a cada torneio e o LIVRE.
 * `free` negativo = falta (o saldo caiu abaixo do alocado, ex.: perda apurada na conferência).
 */
async function matrix(binderId) {
  const binder = await Binder.findById(binderId).setOptions({ withDeleted: true });
  if (!binder) throw new HttpError(404, 'Fichário não encontrado.');
  const [balances, states] = await Promise.all([mv.balances({ binder_id: binderId }), mv.allocationStates(binderId)]);
  const tournaments = await Tournament.find({ _id: { $in: states.map((a) => a.tournament_id) } }).setOptions({ withDeleted: true }).select('name status');
  const tById = new Map(tournaments.map((t) => [String(t._id), t]));

  const chipIds = new Set([...balances.map((b) => String(b.chip_id)), ...states.flatMap((a) => a.chips.map((c) => String(c.chip_id)))]);
  const chips = await Chip.find({ _id: { $in: [...chipIds] } }).setOptions({ withDeleted: true }).select('name value color');
  const rows = [...chipIds].map((cid) => {
    const balance = balances.find((b) => String(b.chip_id) === cid)?.quantity || 0;
    // `quantity` = o que ainda está RESERVADO dentro do fichário (alocado − enviado); `allocated` = teto; `sent` = já em jogo
    const allocated = states.flatMap((a) => a.chips.filter((c) => String(c.chip_id) === cid).map((c) => ({
      allocation_id: a.allocation_id, tournament_id: a.tournament_id, tournament_name: tById.get(String(a.tournament_id))?.name,
      status: a.status, quantity: c.remaining, allocated: c.allocated, sent: c.sent,
    }))).filter((x) => x.allocated > 0);
    const total = allocated.reduce((s, a) => s + a.quantity, 0);
    return { chip: chips.find((c) => String(c._id) === cid) || { _id: cid }, balance, allocated, allocated_total: total, free: balance - total };
  }).sort((a, b) => (a.chip.value ?? 0) - (b.chip.value ?? 0));
  return { binder: { _id: binder._id, name: binder.name, code: binder.code }, chips: rows };
}

/**
 * Anexa a cada alocação o saldo atual e a FALTA por ficha: quanto do total alocado (soma das alocações
 * abertas do fichário) já não tem saldo — ex.: perda apurada na conferência depois de alocar.
 */
async function withHealth(allocations) {
  const cache = new Map(); // binderId -> { balance: Map, reserved: Map chip->Σ restante, byAlloc: Map allocId -> Map chip -> {sent, remaining} }
  const stateOf = async (binderId) => {
    const k = String(binderId);
    if (!cache.has(k)) {
      const [bal, states] = await Promise.all([mv.balances({ binder_id: binderId }), mv.allocationStates(binderId)]);
      const reserved = new Map(); const byAlloc = new Map();
      for (const st of states) {
        const m = new Map();
        for (const c of st.chips) {
          reserved.set(String(c.chip_id), (reserved.get(String(c.chip_id)) || 0) + c.remaining);
          m.set(String(c.chip_id), { sent: c.sent, remaining: c.remaining });
        }
        byAlloc.set(String(st.allocation_id), m);
      }
      cache.set(k, { balance: new Map(bal.map((b) => [String(b.chip_id), b.quantity])), reserved, byAlloc });
    }
    return cache.get(k);
  };
  const out = [];
  for (const a of allocations) {
    const o = a.toObject ? a.toObject() : a;
    const st = await stateOf(idOf(o.binder_id));
    const mine = st.byAlloc.get(String(o._id));
    o.chips = o.chips.map((c) => {
      const id = idOf(c.chip_id);
      const balance = st.balance.get(id) || 0;
      const shortfall = o.open ? Math.max(0, (st.reserved.get(id) || 0) - balance) : 0;
      const line = mine?.get(id);
      return { ...c, balance, sent: line?.sent || 0, remaining: o.open ? (line?.remaining ?? c.quantity) : 0, shortfall };
    });
    o.has_shortfall = o.chips.some((c) => c.shortfall > 0);
    out.push(o);
  }
  return out;
}

module.exports = {
  allocate, updateChips, release, activateForTournament, releaseForTournament,
  matrix, withHealth, resolveRequest, CLOSED, RUNNING,
};
