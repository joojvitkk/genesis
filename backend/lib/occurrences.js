// Ocorrências, conferência física e recuperação (G8) — spec §10, §11, §18.1/6/7.
//
//  • Conferência: contado × esperado (SALDO DERIVADO dos movimentos). Nunca sobrescreve quantidade:
//      falta → LOSS (fichário|jogo → divergência) + Ocorrência;  sobra → FOUND (externo → fichário|jogo) + Ocorrência.
//  • Recuperação: RECOVERY (divergência → fichário); a ocorrência fica `partially_recovered`/`recovered` com trilha em `history`.
//  • A ocorrência nunca é apagada (§18.6). Correção: estorno dos movimentos (`voidOccurrence`) — o registro permanece `voided`.
//  • Quebra matemática de Chip Race/Color Up NÃO gera ocorrência (§18.4): a conferência é por QUANTIDADE por denominação,
//    e as conversões já movimentaram as fichas; o valor da quebra só é exibido como explicação.
const mongoose = require('mongoose');
const { Occurrence, Movement, Chip, Binder, Tournament, Conversion } = require('../models');
const mv = require('./movements');
const severity = require('./severity');
const settings = require('./settings');
const sessionsLib = require('./sessions');
const { HttpError } = require('./catalog');

const oid = (x) => new mongoose.Types.ObjectId(String(x));
const TERMINAL = ['recovered', 'closed', 'voided'];
const actor = (user) => ({ user_id: user?.id || user?._id || null, user_name: user?.name || user?.email || 'Sistema' });
const text = (v) => (v == null ? '' : String(v).trim());

async function loadChips(ids) {
  const docs = await Chip.find({ _id: { $in: ids } }).setOptions({ withDeleted: true }).select('name value color');
  return new Map(docs.map((c) => [String(c._id), c]));
}

/** Situação derivada do registro (a ocorrência guarda `status`, mas ele é sempre recalculado por aqui). */
function statusOf(o) {
  if (['closed', 'voided'].includes(o.status)) return o.status;
  if (o.kind === 'LOSS' && o.recovered_quantity >= o.quantity) return 'recovered';
  if (o.recovered_quantity > 0) return 'partially_recovered';
  return text(o.justification) ? 'justified' : 'open';
}
const remainingOf = (o) => (o.kind === 'LOSS' && !['closed', 'voided'].includes(o.status) ? Math.max(0, o.quantity - (o.recovered_quantity || 0)) : 0);

/** Recuperado ATIVO, derivado dos movimentos: Σ RECOVERY da ocorrência sem estorno. */
async function recoveredQuantity(id) {
  const recs = await Movement.find({ type: 'RECOVERY', 'meta.occurrence_id': oid(id) }).select('_id quantity').lean();
  if (!recs.length) return 0;
  const reversed = new Set((await Movement.find({ reverses: { $in: recs.map((r) => r._id) } }).select('reverses').lean()).map((r) => String(r.reverses)));
  return recs.filter((r) => !reversed.has(String(r._id))).reduce((s, r) => s + r.quantity, 0);
}

async function refresh(occ) {
  occ.recovered_quantity = await recoveredQuantity(occ._id);
  occ.status = statusOf(occ);
  await occ.save();
  return occ;
}

const history = (action, user, extra = {}) => ({ action, at: new Date(), ...actor(user), ...extra });

// ─── conferência ─────────────────────────────────────────────────────────────
function normalizeCounts(list) {
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Informe as contagens (counts).');
  const seen = new Set();
  return list.map((c) => {
    const id = String(c?.chip_id || '');
    if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Ficha inválida na contagem.');
    const counted = Number(c?.counted);
    if (!Number.isInteger(counted) || counted < 0) throw new HttpError(400, 'A quantidade contada deve ser um inteiro ≥ 0.');
    if (seen.has(id)) throw new HttpError(400, 'A mesma ficha aparece duas vezes na contagem.');
    seen.add(id);
    return { chip_id: id, counted };
  });
}

/**
 * Registra as diferenças como movimentos + ocorrências, num lote só (tudo ou nada).
 * `diffs`: [{ chip_id, expected, counted, diff }]. `where`: { scope, binder?, tournament?, session? }.
 */
async function openFromDiffs(diffs, where, { reason, user, source = 'count' }) {
  const cfg = await settings.getSetting('severity');
  const chips = await loadChips(diffs.map((d) => d.chip_id));
  const rows = diffs.map((d) => {
    const chip = chips.get(String(d.chip_id));
    if (!chip) throw new HttpError(400, 'Ficha não encontrada.');
    const quantity = Math.abs(d.diff);
    return { ...d, chip, quantity, kind: d.diff < 0 ? 'LOSS' : 'SURPLUS', ...severity.classify(chip, quantity, cfg), occurrence_id: new mongoose.Types.ObjectId() };
  });

  const need = rows.find((r) => severity.requiresJustification(r.level, cfg));
  if (need && !reason) {
    throw new HttpError(400, `Há diferença de severidade ${need.level} (${need.chip.name}): a justificativa é obrigatória.`);
  }

  const here = where.scope === 'binder' ? { kind: 'binder', id: where.binder._id } : { kind: 'play', id: where.tournament._id };
  const lostHere = { kind: 'lost', id: here.id };
  const label = where.scope === 'binder' ? `Conferência "${where.binder.name}"` : `Conferência do torneio "${where.tournament.name}"`;
  const docs = await mv.postBatch(rows.map((r) => ({
    type: r.kind === 'LOSS' ? 'LOSS' : 'FOUND', chip_id: r.chip._id, quantity: r.quantity,
    from: r.kind === 'LOSS' ? here : { kind: 'external' }, to: r.kind === 'LOSS' ? lostHere : here,
    tournament_id: where.tournament?._id || null, session_id: where.session?._id || null,
    reason: `${label}: esperado ${r.expected ?? '—'}, contado ${r.counted ?? '—'}.${reason ? ` ${reason}` : ''}`,
    meta: { occurrence_id: r.occurrence_id, count: { expected: r.expected, counted: r.counted } },
  })), { user });

  const occurrences = await Occurrence.insertMany(rows.map((r) => ({
    _id: r.occurrence_id, kind: r.kind, scope: where.scope, chip_id: r.chip._id,
    binder_id: where.binder?._id || null, tournament_id: where.tournament?._id || null, session_id: where.session?._id || null,
    expected: r.expected, counted: r.counted, diff: r.diff, quantity: r.quantity,
    severity: r.level, severity_reason: r.reason, source,
    status: reason ? 'justified' : 'open', justification: reason || undefined,
    movement_batch_id: docs[0].batch_id, ...actor(user),
    history: [history('opened', user, { quantity: r.quantity, note: reason || undefined, batch_id: docs[0].batch_id })],
  })));
  return { docs, occurrences };
}

/** Conferência de um FICHÁRIO: contado × saldo derivado. Só compara as fichas informadas. */
async function countBinder(binder, { counts, reason, user }) {
  const list = normalizeCounts(counts);
  const expected = new Map((await mv.balances({ binder_id: binder._id })).map((r) => [String(r.chip_id), r.quantity]));
  const diffs = list.map((c) => ({ chip_id: c.chip_id, expected: expected.get(c.chip_id) || 0, counted: c.counted }))
    .map((d) => ({ ...d, diff: d.counted - d.expected })).filter((d) => d.diff !== 0);
  return finish(diffs, { scope: 'binder', binder }, { reason: text(reason), user });
}

/** Conferência do JOGO de um torneio (ou de uma sessão): contado × fichas em jogo derivadas dos movimentos. */
async function countTournament(tournament, { counts, reason, session_id, user }) {
  const list = normalizeCounts(counts);
  const session = session_id ? await sessionsLib.resolveSession(tournament._id, session_id) : null;
  const expected = new Map((await mv.playBalances({ tournament_id: tournament._id, session_id: session?._id })).map((r) => [String(r.chip_id), r.quantity]));
  const all = list.map((c) => ({ chip_id: c.chip_id, expected: expected.get(c.chip_id) || 0, counted: c.counted }))
    .map((d) => ({ ...d, diff: d.counted - d.expected }));
  const result = await finish(all.filter((d) => d.diff !== 0), { scope: 'tournament', tournament, session }, { reason: text(reason), user });

  // Explicação em VALOR: a quebra matemática das conversões ativas NÃO é perda física (§18.4).
  const chips = await loadChips(list.map((c) => c.chip_id));
  const val = (f) => all.reduce((s, d) => s + d[f] * (chips.get(d.chip_id)?.value || 0), 0);
  const convs = await Conversion.find({ tournament_id: tournament._id, status: 'active', legacy: { $ne: true }, ...(session ? { session_id: session._id } : {}) }).select('math_breakage').lean();
  const math_breakage = convs.reduce((s, c) => s + (c.math_breakage || 0), 0);
  return { ...result, value: { expected: val('expected'), counted: val('counted'), diff: val('counted') - val('expected'), math_breakage } };
}

async function finish(diffs, where, { reason, user }) {
  if (!diffs.length) return { diffs: [], occurrences: [] };
  const { occurrences } = await openFromDiffs(diffs, where, { reason, user });
  const byChip = new Map(occurrences.map((o) => [String(o.chip_id), o]));
  return {
    diffs: diffs.map((d) => { const o = byChip.get(String(d.chip_id)); return { ...d, occurrence_id: o._id, severity: o.severity, kind: o.kind }; }),
    occurrences,
  };
}

/** Perda lançada à mão (Estoque → Quebra/Perda): também é ocorrência (§10); o motivo vale como justificativa. */
async function recordManualLoss(binder, items, { reason, user }) {
  if (!text(reason)) throw new HttpError(400, 'Informe o motivo da movimentação.'); // lançamento manual sempre se explica
  const rows = items.map((i) => ({ chip_id: String(i.chip_id), expected: null, counted: null, diff: -Number(i.quantity) }));
  if (rows.some((r) => !Number.isInteger(r.diff) || r.diff >= 0)) throw new HttpError(400, 'A quantidade deve ser um inteiro maior que zero.');
  return openFromDiffs(rows, { scope: 'binder', binder }, { reason: text(reason), user, source: 'manual' });
}

// ─── ciclo de vida ───────────────────────────────────────────────────────────
async function load(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Ocorrência não encontrada.');
  const o = await Occurrence.findById(id);
  if (!o) throw new HttpError(404, 'Ocorrência não encontrada.');
  return o;
}
const locked = (id, fn) => mv.execute([`occurrence:${id}`], fn);
const assertActive = (o) => { if (['closed', 'voided'].includes(o.status)) throw new HttpError(409, `A ocorrência está ${o.status === 'closed' ? 'encerrada' : 'estornada'}.`); };

async function justify(id, { justification }, user) {
  const note = text(justification);
  if (!note) throw new HttpError(400, 'Informe a justificativa.');
  return locked(id, async () => {
    const o = await load(id);
    assertActive(o);
    o.justification = note;
    o.history.push(history('justified', user, { note }));
    return refresh(o);
  });
}

async function recover(id, { quantity, binder_id, note }, user) {
  const q = Number(quantity);
  if (!Number.isInteger(q) || q < 1) throw new HttpError(400, 'A quantidade recuperada deve ser um inteiro ≥ 1.');
  return locked(id, async () => {
    const o = await load(id);
    if (o.kind !== 'LOSS') throw new HttpError(409, 'Só perdas podem ser recuperadas.');
    assertActive(o);
    o.recovered_quantity = await recoveredQuantity(o._id); // fonte da verdade: os movimentos
    const remaining = o.quantity - o.recovered_quantity;
    if (q > remaining) throw new HttpError(409, `Só ${remaining} ficha(s) ainda podem ser recuperadas desta ocorrência (perdidas ${o.quantity}, já recuperadas ${o.recovered_quantity}).`);

    let target;
    if (o.scope === 'binder') {
      if (binder_id && String(binder_id) !== String(o.binder_id)) throw new HttpError(400, 'Uma perda de fichário volta para o mesmo fichário.');
      target = o.binder_id;
    } else {
      if (!mongoose.isValidObjectId(binder_id)) throw new HttpError(400, 'Informe o fichário que recebe as fichas recuperadas.');
      const b = await Binder.findById(binder_id);
      if (!b) throw new HttpError(404, 'Fichário não encontrado.');
      target = b._id;
    }
    const lostId = o.scope === 'binder' ? o.binder_id : o.tournament_id;
    const docs = await mv.postBatch([{
      type: 'RECOVERY', chip_id: o.chip_id, quantity: q, from: { kind: 'lost', id: lostId }, to: { kind: 'binder', id: target },
      tournament_id: o.tournament_id, session_id: o.session_id,
      reason: text(note) || `Recuperação da ocorrência ${o._id}`, meta: { occurrence_id: o._id },
    }], { user });
    o.history.push(history('recovered', user, { quantity: q, note: text(note) || undefined, batch_id: docs[0].batch_id }));
    return refresh(o);
  });
}

/** Estorna UMA recuperação (admin): as fichas voltam para a divergência; a ocorrência reabre. */
async function reverseRecovery(id, { batch_id, reason }, user) {
  if (!text(reason)) throw new HttpError(400, 'Informe o motivo do estorno.');
  return locked(id, async () => {
    const o = await load(id);
    assertActive(o);
    const entry = o.history.find((h) => h.action === 'recovered' && String(h.batch_id) === String(batch_id));
    if (!entry) throw new HttpError(404, 'Recuperação não encontrada nesta ocorrência.');
    const recs = await Movement.find({ type: 'RECOVERY', batch_id: entry.batch_id, 'meta.occurrence_id': o._id }).select('_id');
    await mv.reverseMovements(recs.map((r) => r._id), { reason, user });
    o.history.push(history('recovery_reversed', user, { quantity: entry.quantity, note: text(reason), batch_id: entry.batch_id }));
    return refresh(o);
  });
}

/** Encerra (admin): a divergência restante fica como perda definitiva, documentada; exige justificativa. */
async function close(id, { justification }, user) {
  return locked(id, async () => {
    const o = await load(id);
    assertActive(o);
    if (o.status === 'recovered') throw new HttpError(409, 'A ocorrência já foi totalmente recuperada.');
    const note = text(justification) || text(o.justification);
    if (!note) throw new HttpError(400, 'Informe a justificativa para encerrar.');
    o.justification = note;
    o.status = 'closed';
    o.history.push(history('closed', user, { note }));
    await o.save();
    return o;
  });
}

/** Estorna a própria divergência (admin): contagem errada. Exige que não haja recuperação ativa. */
async function voidOccurrence(id, { reason }, user) {
  if (!text(reason)) throw new HttpError(400, 'Informe o motivo do estorno.');
  return locked(id, async () => {
    const o = await load(id);
    if (o.status === 'voided') throw new HttpError(409, 'A ocorrência já foi estornada.');
    if ((await recoveredQuantity(o._id)) > 0) throw new HttpError(409, 'Estorne primeiro as recuperações desta ocorrência.');
    const originals = await Movement.find({
      type: { $in: ['LOSS', 'FOUND'] },
      $or: [{ 'meta.occurrence_id': o._id }, ...(o.legacy_movement_id ? [{ _id: o.legacy_movement_id }] : [])],
    }).select('_id');
    await mv.reverseMovements(originals.map((m) => m._id), { reason, user });
    o.status = 'voided';
    o.history.push(history('voided', user, { note: text(reason) }));
    await o.save();
    return o;
  });
}

// ─── consulta ────────────────────────────────────────────────────────────────
const shape = (o) => { const j = o.toJSON ? o.toJSON() : o; return { ...j, remaining: remainingOf(j) }; };

async function summary() {
  const [byStatus, bySeverity, redOpen, pendingJustification] = await Promise.all([
    Occurrence.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Occurrence.aggregate([{ $match: { status: { $nin: TERMINAL } } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]),
    Occurrence.countDocuments({ severity: 'RED', status: { $nin: TERMINAL } }),
    Occurrence.countDocuments({ status: 'open' }),
  ]);
  const obj = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
  return { by_status: obj(byStatus), open_by_severity: obj(bySeverity), red_open: redOpen, pending_justification: pendingJustification };
}

/** Dados legíveis para o alerta em tempo real. */
async function alertPayload(o) {
  const [chip, binder, tournament] = await Promise.all([
    Chip.findById(o.chip_id).setOptions({ withDeleted: true }).select('name value'),
    o.binder_id ? Binder.findById(o.binder_id).setOptions({ withDeleted: true }).select('name') : null,
    o.tournament_id ? Tournament.findById(o.tournament_id).setOptions({ withDeleted: true }).select('name') : null,
  ]);
  return {
    _id: String(o._id), severity: o.severity, kind: o.kind, quantity: o.quantity, status: o.status,
    chip: chip ? { name: chip.name, value: chip.value } : null,
    binder_name: binder?.name || null, tournament_name: tournament?.name || null,
  };
}

module.exports = {
  countBinder, countTournament, recordManualLoss, justify, recover, reverseRecovery, close, voidOccurrence,
  load, shape, summary, alertPayload, statusOf, remainingOf, recoveredQuantity, TERMINAL,
};
