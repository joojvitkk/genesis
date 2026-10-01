// Material no torneio (G6): envio e retorno de fichas, conversões (Chip Race / Color Up) e o resumo
// esperado × em jogo. Tudo vira MOVEMENT (fonte da verdade); a alocação (G5) é o TETO do que pode ser enviado.
//
//  • send     fichário → em jogo, por AÇÃO (buy-in, opcional, reentrada…) calculada pelo stack, ou fichas avulsas.
//  • return   em jogo → fichário, por denominação (contagem física).
//  • conversão OUT (em jogo → fichário) + IN (fichário → em jogo) em UM lote; quebra matemática no registro.
const mongoose = require('mongoose');
const { Tournament, Conversion, Binder, Chip, Allocation, Movement } = require('../models');
const mv = require('./movements');
const conv = require('./conversion');
const tournamentChips = require('./tournamentChips');
const sessionsLib = require('./sessions');
const { HttpError } = require('./catalog');

const CLOSED = ['finished', 'finalized'];
const oid = (x) => new mongoose.Types.ObjectId(String(x));
const asHttp = (e) => (e instanceof HttpError ? e : new HttpError(400, e.message));

const SEND_TYPES = ['SEND_BUY_IN', 'SEND_OPTIONAL', 'SEND_REENTRY', 'SEND_ADDITIONAL'];
/** Tipo de movimento do envio conforme a ação (as demais colunas do stack — add-on, VIP… — são "adicional"). */
const sendTypeFor = (action) => ({ buy_in: 'SEND_BUY_IN', optional_buy_in: 'SEND_OPTIONAL', re_entry: 'SEND_REENTRY' }[action] || 'SEND_ADDITIONAL');

async function openTournament(id) {
  const t = await Tournament.findById(id);
  if (!t) throw new HttpError(404, 'Torneio não encontrado.');
  return t;
}
const assertNotClosed = (t) => { if (CLOSED.includes(t.status)) throw new HttpError(409, 'O torneio está encerrado.'); };

// ─── origem das fichas: as alocações do torneio ──────────────────────────────
/**
 * Escolhe de quais fichários sai cada ficha: só dos ALOCADOS ao torneio, até o que ainda está reservado
 * (alocado − enviado) e existe fisicamente no fichário. `needs`: [{ chip_id, quantity, ...meta }].
 * @returns [{ ...need, quantity, binder_id }]  (uma linha por fichário de origem)
 */
async function pickSources(tournament, needs, { binder_id } = {}) {
  const filter = { tournament_id: tournament._id, open: true, ...(binder_id ? { binder_id } : {}) };
  const allocations = await Allocation.find(filter).sort({ createdAt: 1 });
  if (!allocations.length) {
    throw new HttpError(409, binder_id ? 'Este fichário não está alocado ao torneio.' : 'O torneio não tem fichas alocadas: aloque um fichário antes de enviar.');
  }
  // capacidade = min(reservado, saldo físico) por (fichário, ficha); consumida à medida que as necessidades são atendidas
  const capacity = new Map();
  for (const a of allocations) {
    const [states, bal] = await Promise.all([mv.allocationStates(a.binder_id), mv.balances({ binder_id: a.binder_id })]);
    const mine = states.find((x) => String(x.allocation_id) === String(a._id));
    for (const c of mine?.chips || []) {
      const phys = bal.find((b) => String(b.chip_id) === String(c.chip_id))?.quantity || 0;
      capacity.set(`${a.binder_id}:${c.chip_id}`, Math.max(0, Math.min(c.remaining, phys)));
    }
  }

  const specs = []; const missing = [];
  for (const need of needs) {
    let left = need.quantity;
    for (const a of allocations) {
      if (left <= 0) break;
      const k = `${a.binder_id}:${need.chip_id}`;
      const take = Math.min(left, capacity.get(k) || 0);
      if (take > 0) {
        capacity.set(k, capacity.get(k) - take);
        left -= take;
        specs.push({ ...need, quantity: take, binder_id: a.binder_id });
      }
    }
    if (left > 0) missing.push({ chip_id: String(need.chip_id), requested: need.quantity, missing: left });
  }
  if (missing.length) {
    const chips = await Chip.find({ _id: { $in: missing.map((m) => m.chip_id) } }).setOptions({ withDeleted: true }).select('name');
    const name = new Map(chips.map((c) => [String(c._id), c.name]));
    const details = missing.map((m) => ({ ...m, chip: name.get(m.chip_id) }));
    throw new HttpError(409,
      `Fichas insuficientes nos fichários alocados ao torneio: ${details.slice(0, 3).map((d) => `${d.chip} (faltam ${d.missing} de ${d.requested})`).join(', ')}${details.length > 3 ? '…' : ''}. `
      + 'Aumente a alocação ou o saldo do fichário.', details);
  }
  return specs;
}

// ─── envio ───────────────────────────────────────────────────────────────────
/**
 * Envio ao torneio/sessão. Por AÇÃO: `items: [{ action, count }]` — as fichas por denominação vêm do modelo de
 * stack da ação (o operador só informa a quantidade de ações). Avulso: `chips: [{ chip_id, quantity }]` (envio adicional).
 */
async function send(tournament, body = {}, user) {
  assertNotClosed(tournament);
  const session = await sessionsLib.resolveSession(tournament._id, body.session_id, { open: true });
  const needs = [];

  if (body.items !== undefined) {
    if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, 'items deve ser uma lista de { action, count }.');
    const counts = {};
    for (const it of body.items) counts[it?.action] = (counts[it?.action] || 0) + Number(it?.count);
    const plan = await tournamentChips.needsForTournament(tournament._id, counts);
    if (plan.uncovered.length) {
      throw new HttpError(400, `Sem composição de stack para: ${plan.uncovered.map((u) => u.label || u.action).join(', ')}. Escolha um modelo de stack com essa coluna.`);
    }
    for (const row of plan.rows) {
      for (const [action, quantity] of Object.entries(row.by_action)) {
        needs.push({ type: sendTypeFor(action), chip_id: String(row.chip._id), quantity, meta: { action, count: plan.counts[action] } });
      }
    }
  }
  if (body.chips !== undefined) {
    let list;
    try { list = conv.normalizeSide(body.chips, 'chips'); } catch (e) { throw asHttp(e); }
    for (const l of list) needs.push({ type: 'SEND_ADDITIONAL', chip_id: l.chip_id, quantity: l.quantity, meta: { action: null } });
  }
  if (!needs.length) throw new HttpError(400, 'Informe as ações (items) ou as fichas (chips) a enviar.');

  const picked = await pickSources(tournament, needs, { binder_id: body.binder_id });
  const docs = await mv.postBatch(picked.map((p) => ({
    type: p.type, chip_id: p.chip_id, quantity: p.quantity,
    from: { kind: 'binder', id: p.binder_id }, to: { kind: 'play', id: tournament._id },
    session_id: session?._id || null, reason: body.reason, meta: p.meta,
  })), { user });
  return docs;
}

// ─── retorno ─────────────────────────────────────────────────────────────────
/** Retorno de fichas do jogo para um fichário, por denominação (o que foi fisicamente contado/devolvido). */
async function returnChips(tournament, body = {}, user) {
  if (!mongoose.isValidObjectId(body.binder_id)) throw new HttpError(400, 'Informe o fichário de destino.');
  const binder = await Binder.findById(body.binder_id);
  if (!binder) throw new HttpError(404, 'Fichário não encontrado.');
  let list;
  try { list = conv.normalizeSide(body.chips, 'chips'); } catch (e) { throw asHttp(e); }

  let session = null; // um retorno pode acontecer depois do fim das sessões: só vincula se não for ambíguo
  try { session = await sessionsLib.resolveSession(tournament._id, body.session_id); } catch (e) { if (body.session_id) throw e; }
  return mv.postBatch(list.map((l) => ({
    type: 'RETURN', chip_id: l.chip_id, quantity: l.quantity,
    from: { kind: 'play', id: tournament._id }, to: { kind: 'binder', id: binder._id },
    session_id: session?._id || null, reason: body.reason,
  })), { user });
}

// ─── conversões (Chip Race / Color Up) ───────────────────────────────────────
async function chipsMap(ids) {
  const chips = await Chip.find({ _id: { $in: ids } }).setOptions({ withDeleted: true }).select('name value color');
  return new Map(chips.map((c) => [String(c._id), c]));
}

/** Prévia de valores e quebra (sem gravar nada): a MESMA conta que o registro usa. */
async function preview(body = {}) {
  let n;
  try { n = conv.normalize(body.outs, body.ins); } catch (e) { throw asHttp(e); }
  const chips = await chipsMap([...n.outs, ...n.ins].map((l) => l.chip_id));
  try { return conv.compute(n.outs, n.ins, chips); } catch (e) { throw asHttp(e); }
}

/**
 * Registra a conversão: OUT (em jogo → fichário) + IN (fichário → em jogo) num único lote atômico.
 * O que saiu volta para `binder_id` (ou o único fichário alocado); o que entra sai dos fichários alocados.
 */
async function createConversion(tournament, body = {}, user) {
  assertNotClosed(tournament);
  if (!conv.TYPES.includes(body.type)) throw new HttpError(400, `Tipo inválido. Use: ${conv.TYPES.join(', ')}.`);
  let n;
  try { n = conv.normalize(body.outs, body.ins); } catch (e) { throw asHttp(e); }
  const session = await sessionsLib.resolveSession(tournament._id, body.session_id, { open: true });
  const chips = await chipsMap([...n.outs, ...n.ins].map((l) => l.chip_id));
  let values;
  try { values = conv.compute(n.outs, n.ins, chips); } catch (e) { throw asHttp(e); }

  // destino do que saiu: fichário informado ou o único alocado ao torneio
  const allocations = await Allocation.find({ tournament_id: tournament._id, open: true });
  let dest = body.binder_id;
  if (!dest) {
    if (allocations.length === 1) dest = allocations[0].binder_id;
    else throw new HttpError(400, allocations.length ? 'O torneio tem vários fichários alocados: informe o fichário que recebe as fichas retiradas (binder_id).' : 'O torneio não tem fichas alocadas.');
  }
  if (!(await Binder.exists({ _id: dest }))) throw new HttpError(404, 'Fichário não encontrado.');

  const ins = await pickSources(tournament, n.ins.map((l) => ({ type: conv.IN_TYPE[body.type], chip_id: l.chip_id, quantity: l.quantity })));
  const batch = new mongoose.Types.ObjectId();
  const doc = await new Conversion({
    tournament_id: tournament._id, session_id: session?._id || null, type: body.type,
    outs: values.outs.map((l) => ({ chip_id: l.chip_id, quantity: l.quantity })), ins: values.ins.map((l) => ({ chip_id: l.chip_id, quantity: l.quantity })),
    value_out: values.value_out, value_in: values.value_in, math_breakage: values.math_breakage,
    binder_id: dest, movement_batch_id: batch, note: body.note, user_name: user?.name || user?.email || 'Sistema',
  }).save();

  try {
    await mv.postBatch([
      ...n.outs.map((l) => ({
        type: conv.OUT_TYPE[body.type], chip_id: l.chip_id, quantity: l.quantity,
        from: { kind: 'play', id: tournament._id }, to: { kind: 'binder', id: dest }, session_id: session?._id || null,
        meta: { conversion_id: doc._id }, reason: body.note,
      })),
      ...ins.map((p) => ({
        type: p.type, chip_id: p.chip_id, quantity: p.quantity,
        from: { kind: 'binder', id: p.binder_id }, to: { kind: 'play', id: tournament._id }, session_id: session?._id || null,
        meta: { conversion_id: doc._id }, reason: body.note,
      })),
    ], { user, batch_id: batch });
  } catch (err) {
    await Conversion.deleteOne({ _id: doc._id }); // o registro nasce junto com o lote: se o lote falha, ele não existe
    throw err;
  }
  return doc;
}

/** Estorna o lote de movimentos da conversão (o original permanece) e marca a conversão como `reversed`. */
async function reverseConversion(conversion, { reason, user } = {}) {
  if (conversion.legacy) throw new HttpError(409, 'Registro do modelo anterior (só histórico): não há movimentos para estornar.');
  if (conversion.status === 'reversed') throw new HttpError(409, 'Esta conversão já foi estornada.');
  const originals = await Movement.find({ batch_id: conversion.movement_batch_id, type: { $ne: 'REVERSAL' } }).select('_id');
  await mv.reverseMovements(originals.map((m) => m._id), { reason, user });
  conversion.status = 'reversed';
  conversion.reversed_at = new Date();
  conversion.reversed_by = user?.name || user?.email || 'Sistema';
  conversion.reverse_reason = String(reason).trim();
  await conversion.save();
  return conversion;
}

// ─── descarte de stack (G7, spec §9) ─────────────────────────────────────────
/**
 * O jogador tem poucas fichas, abandona o stack e faz nova inscrição: as fichas DEVOLVIDAS (as que ele realmente
 * tinha — não precisam ser a composição original) saem de jogo e voltam ao fichário na hora. O valor total é
 * calculado aqui; usuário, data/hora e sessão são automáticos; o lote imutável é o registro permanente.
 */
async function discard(tournament, body = {}, user) {
  assertNotClosed(tournament);
  let list;
  try { list = conv.normalizeSide(body.chips, 'chips'); } catch (e) { throw asHttp(e); }
  const session = await sessionsLib.resolveSession(tournament._id, body.session_id, { open: true });

  // fichário que recebe: o informado ou o único alocado ao torneio
  let binderId = body.binder_id;
  if (!binderId) {
    const allocations = await Allocation.find({ tournament_id: tournament._id, open: true });
    if (allocations.length === 1) binderId = allocations[0].binder_id;
    else throw new HttpError(400, allocations.length ? 'O torneio tem vários fichários alocados: informe o fichário que recebe as fichas (binder_id).' : 'Informe o fichário que recebe as fichas (binder_id).');
  }
  if (!mongoose.isValidObjectId(binderId)) throw new HttpError(400, 'Fichário inválido.');
  const binder = await Binder.findById(binderId);
  if (!binder) throw new HttpError(404, 'Fichário não encontrado.');

  const note = body.note ? String(body.note).trim() : undefined;

  const docs = await mv.postBatch(list.map((l) => ({
    type: 'DISCARD', chip_id: l.chip_id, quantity: l.quantity,
    from: { kind: 'play', id: tournament._id }, to: { kind: 'binder', id: binder._id },
    session_id: session?._id || null, reason: note, meta: { note },
  })), { user });
  const chips = await chipsMap(list.map((l) => l.chip_id));
  return { docs, binder, ...totalsOf(list, chips) };
}

/** Linhas com valor + totais (a mesma conta do registro). */
function totalsOf(list, chips) {
  const lines = list.map((l) => {
    const chip = chips.get(String(l.chip_id));
    if (!chip) throw new HttpError(400, 'Ficha não encontrada.');
    return { chip, chip_id: String(l.chip_id), quantity: l.quantity, value: l.quantity * (chip.value || 0) };
  });
  return { chips: lines, total_chips: lines.reduce((s, l) => s + l.quantity, 0), total_value: lines.reduce((s, l) => s + l.value, 0) };
}

/** Prévia do valor descartado (não grava nada). */
async function discardPreview(body = {}) {
  let list;
  try { list = conv.normalizeSide(body.chips, 'chips'); } catch (e) { throw asHttp(e); }
  return totalsOf(list, await chipsMap(list.map((l) => l.chip_id)));
}

/** Descartes do torneio (um por lote), do mais recente ao mais antigo, com o total e se foi estornado. */
async function listDiscards(tournamentId, { sessionId } = {}) {
  const moves = await Movement.find({ tournament_id: tournamentId, type: 'DISCARD', ...(sessionId ? { session_id: sessionId } : {}) }).sort({ createdAt: -1, _id: -1 }).lean();
  if (!moves.length) return [];
  const reversals = await Movement.find({ reverses: { $in: moves.map((m) => m._id) } }).select('reverses createdAt user_name reason').lean();
  const revBy = new Map(reversals.map((r) => [String(r.reverses), r]));
  const chips = await chipsMap([...new Set(moves.map((m) => String(m.chip_id)))]);
  const binders = new Map((await Binder.find({ _id: { $in: moves.map((m) => m.binder_id) } }).setOptions({ withDeleted: true }).select('name code').lean()).map((b) => [String(b._id), b]));

  const byBatch = new Map();
  for (const m of moves) {
    const k = String(m.batch_id);
    const d = byBatch.get(k) || {
      batch_id: m.batch_id, at: m.createdAt, user_name: m.user_name, session_id: m.session_id, binder: binders.get(String(m.binder_id)) || null,
      note: m.meta?.note || null,
      chips: [], total_chips: 0, total_value: 0, movement_ids: [], reversed: true, reversed_by: null,
    };
    const chip = chips.get(String(m.chip_id)) || { _id: m.chip_id };
    d.chips.push({ chip, quantity: m.quantity, value: m.quantity * (chip.value || 0) });
    d.total_chips += m.quantity; d.total_value += m.quantity * (chip.value || 0);
    d.movement_ids.push(m._id);
    const r = revBy.get(String(m._id));
    if (!r) d.reversed = false; else d.reversed_by = { user_name: r.user_name, reason: r.reason, at: r.createdAt };
    byBatch.set(k, d);
  }
  return [...byBatch.values()].map((d) => ({ ...d, chips: d.chips.sort((a, b) => (a.chip.value || 0) - (b.chip.value || 0)), reversed_by: d.reversed ? d.reversed_by : null }));
}

/** Estorna o descarte inteiro (o lote); os movimentos originais permanecem. */
async function reverseDiscard(tournamentId, batchId, { reason, user } = {}) {
  if (!mongoose.isValidObjectId(batchId)) throw new HttpError(400, 'Descarte inválido.');
  const originals = await Movement.find({ tournament_id: tournamentId, batch_id: batchId, type: 'DISCARD' }).select('_id');
  if (!originals.length) throw new HttpError(404, 'Descarte não encontrado.');
  return mv.reverseMovements(originals.map((m) => m._id), { reason, user });
}

// ─── resumo: esperado × em jogo ──────────────────────────────────────────────
/**
 * Por ficha: esperado (ações × stack, ajustado por conversões), enviado, devolvido, conversões e o que está
 * FISICAMENTE em jogo; `pending` = esperado − em jogo (positivo = falta enviar; negativo = sobra na mesa).
 * Só informa: divergência formal é conferência física (G8).
 */
async function summary(tournamentId, { sessionId } = {}) {
  const inPlay = await tournamentChips.chipsInPlay(tournamentId, { sessionId });
  // Um ESTORNO abate a coluna do tipo que ele desfez (não fica "enviado/devolvido/descartado" o que foi estornado).
  const move = await Movement.aggregate([
    { $match: { tournament_id: oid(tournamentId), ...(sessionId ? { session_id: oid(sessionId) } : {}) } },
    { $group: {
      _id: { c: '$chip_id', t: { $cond: [{ $eq: ['$type', 'REVERSAL'] }, { $ifNull: ['$meta.original_type', 'REVERSAL'] }, '$type'] } },
      q: { $sum: { $cond: [{ $eq: ['$type', 'REVERSAL'] }, { $multiply: ['$quantity', -1] }, '$quantity'] } },
    } },
  ]);
  const bal = new Map((await mv.playBalances({ tournament_id: tournamentId, session_id: sessionId })).map((r) => [String(r.chip_id), r.quantity]));

  const by = new Map();
  const cell = (id) => by.get(id) || by.set(id, { expected: 0, sent: 0, returned: 0, discarded: 0, lost: 0, found: 0, conversion_in: 0, conversion_out: 0 }).get(id);
  for (const r of inPlay.rows) cell(String(r.chip._id)).expected = r.quantity;
  for (const r of move) {
    const c = cell(String(r._id.c));
    if (SEND_TYPES.includes(r._id.t)) c.sent += r.q;
    else if (r._id.t === 'RETURN') c.returned += r.q;
    else if (r._id.t === 'DISCARD') c.discarded += r.q;
    else if (r._id.t === 'LOSS') c.lost += r.q;   // conferência do jogo (G8): falta física
    else if (r._id.t === 'FOUND') c.found += r.q; // sobra física
    else if (r._id.t.endsWith('_IN')) c.conversion_in += r.q;
    else if (r._id.t.endsWith('_OUT')) c.conversion_out += r.q;
  }
  for (const id of bal.keys()) cell(id);
  const chips = await chipsMap([...by.keys()]);
  const rows = [...by.entries()].map(([id, c]) => {
    const on_table = bal.get(id) || 0;
    return { chip: chips.get(id) || { _id: id }, ...c, on_table, pending: c.expected - on_table };
  }).sort((a, b) => (a.chip.value ?? 0) - (b.chip.value ?? 0));
  const val = (f) => rows.reduce((s, r) => s + r[f] * (r.chip.value || 0), 0);
  return {
    tournament_id: String(tournamentId), session_id: sessionId || null, rows,
    totals: { expected_value: val('expected'), on_table_value: val('on_table'), pending_value: val('pending') },
    uncovered: inPlay.uncovered,
  };
}

module.exports = {
  send, returnChips, preview, createConversion, reverseConversion, summary, pickSources, sendTypeFor, SEND_TYPES, openTournament,
  discard, discardPreview, listDiscards, reverseDiscard,
};
