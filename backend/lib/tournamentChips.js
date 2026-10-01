// Fichas em jogo de um torneio (G3) — o servidor calcula; o frontend só exibe.
//
//   ações registradas (entradas por tipo/ação) × composição do modelo de stack da ação
//
// Cada entrada carrega uma AÇÃO (buy_in, optional_buy_in, re_entry, add_on…). O modelo aplicável é o
// mapeado para a ação no torneio (`stack_models`) ou, na falta, o padrão (`stack_model_id`).
// Entradas antigas com `stack_model_id` próprio (o operador escolhia por entrada) continuam honradas.
const mongoose = require('mongoose');
const { Tournament, TournamentEntry, StackModel, Chip, Conversion, Movement } = require('../models');
const { HttpError } = require('./catalog');
const calc = require('./stackCalc');

const idOf = (x) => String(x && x._id ? x._id : x);

/** Ação efetiva de uma entrada (registrada ou derivada do tipo). */
const actionOf = (entry) => entry.action || calc.ACTION_BY_ENTRY_TYPE[entry.type];

async function loadModels(ids) {
  const uniq = [...new Set(ids.filter(Boolean).map(idOf))];
  if (!uniq.length) return new Map();
  const docs = await StackModel.find({ _id: { $in: uniq } }).setOptions({ withDeleted: true }).lean();
  return new Map(docs.map((d) => [idOf(d._id), d]));
}
async function loadChips(models) {
  const ids = new Set();
  for (const m of models.values()) for (const l of m.composition || []) ids.add(idOf(l.chip_id));
  const docs = ids.size ? await Chip.find({ _id: { $in: [...ids] } }).setOptions({ withDeleted: true }).select('name value color').lean() : [];
  return new Map(docs.map((c) => [idOf(c._id), c]));
}

/** Contagem de entradas por (ação, modelo legado da entrada). */
function groupEntries(entries) {
  const groups = new Map();
  for (const e of entries) {
    const action = actionOf(e);
    const legacy = e.stack_model_id ? idOf(e.stack_model_id) : null;
    const k = `${action}|${legacy || ''}`;
    const g = groups.get(k) || { action, legacy_model_id: legacy, count: 0 };
    g.count += 1;
    groups.set(k, g);
  }
  return [...groups.values()];
}

/** Resultado formatado para a API. `usages` já resolvidos (com modelo). */
function shape({ tournament, usages, models, chips, counts }) {
  const result = calc.needs(usages, chips);
  const labelOf = (action) => {
    for (const m of models.values()) {
      const a = (m.actions || []).find((x) => x.key === action);
      if (a) return a.label;
    }
    return calc.DEFAULT_ACTIONS.find((a) => a.key === action)?.label || action;
  };
  const actionKeys = [...new Set([...Object.keys(counts), ...result.rows.flatMap((r) => Object.keys(r.by_action))])];
  return {
    tournament_id: tournament?._id,
    counts,
    actions: actionKeys.map((key) => {
      const m = tournament ? calc.modelForAction(tournament, key, models) : null;
      return { key, label: labelOf(key), count: counts[key] || 0, stack_model: m ? { _id: m._id, name: m.name } : null };
    }),
    rows: result.rows.map((r) => ({ ...r, chip: chips.get(r.chip_id) || { _id: r.chip_id } })),
    totals: result.totals,
    uncovered: result.uncovered.map((u) => ({ ...u, label: labelOf(u.action) })),
  };
}

/** Fichas em jogo (teórico) a partir das entradas registradas. */
async function chipsInPlay(tournamentId, { sessionId } = {}) {
  const tournament = await Tournament.findById(tournamentId).lean();
  if (!tournament) throw new HttpError(404, 'Torneio não encontrado.');
  // sem sessionId: o torneio inteiro (soma das sessões); com sessionId: só as ações daquela sessão
  const filter = { tournament_id: tournament._id, ...(sessionId ? { session_id: sessionId } : {}) };
  const entries = await TournamentEntry.find(filter).select('type action stack_model_id').lean();
  const groups = groupEntries(entries);

  const models = await loadModels([
    tournament.stack_model_id, ...(tournament.stack_models || []).map((m) => m.stack_model_id), ...groups.map((g) => g.legacy_model_id),
  ]);
  const chips = await loadChips(models);

  const counts = {};
  const usages = groups.map((g) => {
    counts[g.action] = (counts[g.action] || 0) + g.count;
    const model = g.legacy_model_id ? models.get(g.legacy_model_id) : calc.modelForAction(tournament, g.action, models);
    return { action: g.action, count: g.count, model };
  });
  const result = await applyConversions(tournament._id, shape({ tournament, usages, models, chips, counts }), sessionId);
  return { session_id: sessionId || null, ...result };
}

/**
 * O que está em jogo NÃO é só ações × stack. Dois ajustes físicos mudam a composição:
 *  • Chip Race / Color Up (G6): soma o que ENTROU e tira o que SAIU (conversões ativas; estornadas e legadas não contam);
 *  • Descarte de stack (G7, spec §9): as fichas devolvidas NÃO permanecem em jogo (descartes líquidos de estorno).
 */
async function applyConversions(tournamentId, result, sessionId) {
  const scope = sessionId ? { session_id: sessionId } : {};
  const convs = await Conversion.find({ tournament_id: tournamentId, status: 'active', legacy: { $ne: true }, ...scope }).lean();
  // saídas do jogo líquidas por ficha: descartes (G7) — Σ tipo − Σ estornos do tipo
  const outs = await Movement.aggregate([
    { $match: {
      tournament_id: new mongoose.Types.ObjectId(String(tournamentId)),
      ...(sessionId ? { session_id: new mongoose.Types.ObjectId(String(sessionId)) } : {}),
      $or: [{ type: 'DISCARD' }, { type: 'REVERSAL', 'meta.original_type': 'DISCARD' }],
    } },
    { $group: {
      _id: { c: '$chip_id', f: { $cond: [{ $eq: ['$type', 'REVERSAL'] }, '$meta.original_type', '$type'] } },
      q: { $sum: { $cond: [{ $eq: ['$type', 'REVERSAL'] }, { $multiply: ['$quantity', -1] }, '$quantity'] } },
    } },
  ]);
  const netOf = (family) => outs.filter((d) => d._id.f === family && d.q !== 0).map((d) => [idOf(d._id.c), d.q]);
  if (!convs.length && !outs.some((d) => d.q !== 0)) return result;

  const delta = new Map();
  const discarded = new Map(netOf('DISCARD'));
  for (const c of convs) {
    for (const l of c.ins) delta.set(idOf(l.chip_id), (delta.get(idOf(l.chip_id)) || 0) + l.quantity);
    for (const l of c.outs) delta.set(idOf(l.chip_id), (delta.get(idOf(l.chip_id)) || 0) - l.quantity);
  }
  for (const [id, q] of discarded) delta.set(id, (delta.get(id) || 0) - q);
  const byChip = new Map(result.rows.map((r) => [String(r.chip._id), r]));
  const extra = [...delta.keys()].filter((id) => !byChip.has(id));
  const extraChips = extra.length ? await Chip.find({ _id: { $in: extra } }).setOptions({ withDeleted: true }).select('name value color').lean() : [];
  const chipDoc = new Map([...byChip.entries()].map(([id, r]) => [id, r.chip]).concat(extraChips.map((c) => [String(c._id), c])));

  const rows = [];
  for (const id of new Set([...byChip.keys(), ...delta.keys()])) {
    const base = byChip.get(id);
    const quantity = (base?.quantity || 0) + (delta.get(id) || 0);
    if (quantity <= 0) continue;
    const chip = chipDoc.get(id) || { _id: id };
    const conversion = (delta.get(id) || 0) + (discarded.get(id) || 0); // só a parte das conversões
    rows.push({ chip_id: id, quantity, value: quantity * (chip.value || 0), by_action: base?.by_action || {}, conversion, discarded: discarded.get(id) || 0, chip });
  }
  rows.sort((a, b) => (a.chip.value || 0) - (b.chip.value || 0));
  return { ...result, rows, totals: { quantity: rows.reduce((s, r) => s + r.quantity, 0), value: rows.reduce((s, r) => s + r.value, 0) } };
}

/** Simulação: "e se houver N ações de cada tipo?" — usa os modelos mapeados no torneio. */
async function needsForTournament(tournamentId, counts) {
  const tournament = await Tournament.findById(tournamentId).lean();
  if (!tournament) throw new HttpError(404, 'Torneio não encontrado.');
  const clean = cleanCounts(counts);
  const models = await loadModels([tournament.stack_model_id, ...(tournament.stack_models || []).map((m) => m.stack_model_id)]);
  const chips = await loadChips(models);
  const usages = Object.entries(clean).map(([action, count]) => ({ action, count, model: calc.modelForAction(tournament, action, models) }));
  return shape({ tournament, usages, models, chips, counts: clean });
}

/** Simulação para UM modelo de stack (tela de modelos). */
async function needsForStackModel(stackModelId, counts) {
  const model = await StackModel.findById(stackModelId).lean();
  if (!model) throw new HttpError(404, 'Modelo de stack não encontrado.');
  const clean = cleanCounts(counts);
  const models = new Map([[idOf(model._id), model]]);
  const chips = await loadChips(models);
  const usages = Object.entries(clean).map(([action, count]) => ({ action, count, model }));
  return shape({ tournament: null, usages, models, chips, counts: clean });
}

/** { ação: inteiro ≥ 0 } — rejeita lixo em vez de assumir. */
function cleanCounts(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) throw new HttpError(400, 'Informe as quantidades por ação (counts).');
  const out = {};
  for (const [action, val] of Object.entries(counts)) {
    const n = Number(val);
    if (!calc.KEY_RE.test(action)) throw new HttpError(400, `Ação inválida: "${action}".`);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new HttpError(400, `Quantidade inválida para "${action}".`);
    if (n > 0) out[action] = n;
  }
  return out;
}

/**
 * Recalcula os DERIVADOS do torneio: `chips_value_in_play` (relógio/projeção) e `starting_stack`
 * (valor nominal do stack do buy-in padrão). Chamar após mudar entradas ou o mapeamento de stacks.
 */
async function refreshTournamentChips(tournamentId, io) {
  const result = await chipsInPlay(tournamentId);
  const tournament = await Tournament.findById(tournamentId).lean();
  const models = await loadModels([tournament.stack_model_id, ...(tournament.stack_models || []).map((m) => m.stack_model_id)]);
  const chips = await loadChips(models);
  const buyInModel = calc.modelForAction(tournament, 'buy_in', models);
  const starting = buyInModel ? calc.stackValue(buyInModel, 'buy_in', chips) : tournament.starting_stack || 0;

  await Tournament.updateOne({ _id: tournamentId }, { $set: { chips_value_in_play: result.totals.value, starting_stack: starting } });
  io?.emit('chipsInPlayChanged', { tournament_id: tournamentId, chips_value_in_play: result.totals.value });
  return { ...result, starting_stack: starting };
}

/**
 * Valida a configuração de stack vinda do cliente (só devolve as chaves informadas):
 *   stack_model_id  modelo padrão (vale para toda ação sem mapeamento próprio)
 *   stack_models    [{ action, stack_model_id }] mapeamento por ação (sem ação repetida)
 */
async function normalizeStackConfig(body) {
  const out = {};
  const exist = async (id) => (id ? StackModel.exists({ _id: id }) : true);
  if (body.stack_model_id !== undefined) {
    if (body.stack_model_id && !(await exist(body.stack_model_id))) throw new HttpError(400, 'Modelo de stack não encontrado.');
    out.stack_model_id = body.stack_model_id || null;
  }
  if (body.stack_models !== undefined) {
    if (!Array.isArray(body.stack_models)) throw new HttpError(400, 'stack_models deve ser uma lista de { action, stack_model_id }.');
    const seen = new Set();
    out.stack_models = [];
    for (const m of body.stack_models) {
      if (!calc.KEY_RE.test(String(m?.action || ''))) throw new HttpError(400, `Ação inválida: "${m?.action}".`);
      if (seen.has(m.action)) throw new HttpError(400, `A ação "${m.action}" está mapeada mais de uma vez.`);
      seen.add(m.action);
      if (!m.stack_model_id || !(await exist(m.stack_model_id))) throw new HttpError(400, 'Modelo de stack não encontrado no mapeamento.');
      out.stack_models.push({ action: m.action, stack_model_id: m.stack_model_id });
    }
  }
  return out;
}

/**
 * Ação de uma nova entrada. Padrão = ação do tipo (buy-in→buy_in, re-entry→re_entry, add-on→add_on).
 * Só o buy-in aceita variante (buy-in opcional ou outra coluna dos modelos do torneio).
 */
async function entryAction(tournament, type, action) {
  const def = calc.ACTION_BY_ENTRY_TYPE[type];
  if (action === undefined || action === null || action === '') return def;
  if (!calc.KEY_RE.test(String(action))) throw new HttpError(400, `Ação inválida: "${action}".`);
  const fixed = calc.FIXED_ACTION_TYPES[type];
  if (fixed) {
    if (action !== fixed) throw new HttpError(400, `Este tipo de entrada só usa a ação "${fixed}".`);
    return action;
  }
  const models = await loadModels([tournament.stack_model_id, ...(tournament.stack_models || []).map((m) => m.stack_model_id)]);
  const allowed = new Set(['buy_in', 'optional_buy_in']);
  for (const m of models.values()) for (const a of m.actions || []) allowed.add(a.key);
  for (const key of Object.values(calc.FIXED_ACTION_TYPES)) allowed.delete(key);
  if (!allowed.has(action)) throw new HttpError(400, `A ação "${action}" não existe nos modelos de stack deste torneio.`);
  return action;
}

module.exports = { defaultAction: (type) => calc.ACTION_BY_ENTRY_TYPE[type], entryAction, normalizeStackConfig, chipsInPlay, needsForTournament, needsForStackModel, refreshTournamentChips, cleanCounts, actionOf, groupEntries };
