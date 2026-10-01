// Cálculo de fichas por stack (G3) — LÓGICA PURA, sem I/O (spec §7, §18.11: todo cálculo crítico
// é do servidor e testável).
//
//   quantidade de ações × composição do modelo de stack = fichas necessárias por denominação
//
// Entradas são objetos simples (ids podem ser ObjectId, string ou documento populado).

/** Colunas padrão de um modelo novo (spec §3.4). `add_on` pode ser adicionada como extra. */
const DEFAULT_ACTIONS = [
  { key: 'buy_in', label: 'Buy-in padrão' },
  { key: 'optional_buy_in', label: 'Buy-in opcional' },
  { key: 're_entry', label: 'Reentrada' },
];

/** Ação padrão de cada tipo de entrada do torneio. */
const ACTION_BY_ENTRY_TYPE = { 'buy-in': 'buy_in', 're-entry': 're_entry', 'add-on': 'add_on' };
/** Ações fixas de um tipo (as demais só valem para buy-in, que aceita variantes: opcional, VIP…). */
const FIXED_ACTION_TYPES = { 're-entry': 're_entry', 'add-on': 'add_on' };

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

const idOf = (ref) => String(ref && typeof ref === 'object' && ref._id ? ref._id : ref);

/** Valida e normaliza as colunas (chave estável em snake_case + rótulo). */
function normalizeActions(actions) {
  const list = actions == null ? DEFAULT_ACTIONS : actions;
  if (!Array.isArray(list) || !list.length) throw new Error('O modelo precisa de ao menos uma ação (coluna).');
  const seen = new Set();
  return list.map((a) => {
    const key = String(a?.key ?? '').trim();
    const label = String(a?.label ?? '').trim();
    if (!KEY_RE.test(key)) throw new Error(`Chave de ação inválida: "${key}" (use letras minúsculas, números e _).`);
    if (!label) throw new Error(`A ação "${key}" precisa de um rótulo.`);
    if (seen.has(key)) throw new Error(`Ação repetida: "${key}".`);
    seen.add(key);
    return { key, label };
  });
}

/**
 * Valida e normaliza a grade ficha × ação: `[{ chip_id, quantities: { [action]: inteiro ≥ 0 } }]`.
 * Aceita o formato antigo `{ chip_id, quantity }` (vira a coluna `buy_in`). Linhas sem nenhuma
 * quantidade são descartadas; a ficha não pode repetir; o modelo precisa entregar ao menos 1 ficha.
 */
function normalizeComposition(rows, actions) {
  if (!Array.isArray(rows)) throw new Error('A composição deve ser uma lista de fichas.');
  const keys = new Set(actions.map((a) => a.key));
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const chip = idOf(row?.chip_id);
    if (!row?.chip_id || chip === 'undefined') throw new Error('Ficha inválida na composição.');
    if (seen.has(chip)) throw new Error('A mesma ficha não pode aparecer em duas linhas da composição.');
    seen.add(chip);
    const raw = row.quantities ?? (row.quantity !== undefined ? { buy_in: row.quantity } : {});
    const quantities = {};
    for (const [key, val] of Object.entries(raw)) {
      if (!keys.has(key)) throw new Error(`A ação "${key}" não existe neste modelo.`);
      const n = Number(val);
      if (!Number.isInteger(n) || n < 0) throw new Error('As quantidades devem ser inteiros ≥ 0.');
      if (n > 0) quantities[key] = n;
    }
    if (Object.keys(quantities).length) out.push({ chip_id: row.chip_id, quantities });
  }
  if (!out.length) throw new Error('Informe ao menos uma ficha com quantidade maior que zero.');
  return out;
}

/** Quantidade de cada ficha entregue a UM jogador nesta ação. → Map chipId → quantidade */
function perPlayer(model, action) {
  const map = new Map();
  for (const line of model?.composition || []) {
    const q = line.quantities?.[action];
    if (q > 0) map.set(idOf(line.chip_id), q);
  }
  return map;
}

/** Valor nominal do stack de UM jogador nesta ação. */
function stackValue(model, action, chipsById) {
  let total = 0;
  for (const [chip, q] of perPlayer(model, action)) total += q * (chipsById.get(chip)?.value || 0);
  return total;
}

/**
 * Fichas necessárias para um conjunto de usos.
 * @param {Array<{ action: string, count: number, model: object|null }>} usages
 *        `model` = modelo de stack aplicável àquela ação (null = nenhum).
 * @param {Map<string, {value:number, ...}>} chipsById  dados das fichas (valor nominal…)
 * @returns {{ rows, totals, uncovered }}
 *   rows: [{ chip_id, quantity, value, by_action: { [action]: quantidade } }] ordenado pelo valor da ficha
 *   totals: { quantity, value }
 *   uncovered: [{ action, count }] — ações com jogadores mas sem composição para a ação
 */
function needs(usages, chipsById = new Map()) {
  const acc = new Map(); // chipId -> { quantity, by_action }
  const uncoveredMap = new Map();

  for (const u of usages) {
    const count = Number(u.count) || 0;
    if (count <= 0) continue;
    const per = perPlayer(u.model, u.action);
    if (!per.size) {
      uncoveredMap.set(u.action, (uncoveredMap.get(u.action) || 0) + count);
      continue;
    }
    for (const [chip, q] of per) {
      const cur = acc.get(chip) || { quantity: 0, by_action: {} };
      cur.quantity += q * count;
      cur.by_action[u.action] = (cur.by_action[u.action] || 0) + q * count;
      acc.set(chip, cur);
    }
  }

  const rows = [...acc.entries()].map(([chip_id, r]) => ({
    chip_id, quantity: r.quantity, value: r.quantity * (chipsById.get(chip_id)?.value || 0), by_action: r.by_action,
  })).sort((a, b) => (chipsById.get(a.chip_id)?.value || 0) - (chipsById.get(b.chip_id)?.value || 0) || a.chip_id.localeCompare(b.chip_id));

  return {
    rows,
    totals: { quantity: rows.reduce((s, r) => s + r.quantity, 0), value: rows.reduce((s, r) => s + r.value, 0) },
    uncovered: [...uncoveredMap].map(([action, count]) => ({ action, count })),
  };
}

/** Atalho: contagens por ação de UM modelo → `needs`. */
function needsForModel(counts, model, chipsById) {
  return needs(Object.entries(counts || {}).map(([action, count]) => ({ action, count, model })), chipsById);
}

/** Modelo aplicável a uma ação de um torneio: mapeamento explícito da ação, senão o padrão. */
function modelForAction(tournament, action, modelsById) {
  const explicit = (tournament.stack_models || []).find((m) => m.action === action);
  const id = explicit ? idOf(explicit.stack_model_id) : tournament.stack_model_id ? idOf(tournament.stack_model_id) : null;
  return id ? modelsById.get(id) || null : null;
}

module.exports = {
  DEFAULT_ACTIONS, ACTION_BY_ENTRY_TYPE, FIXED_ACTION_TYPES, KEY_RE,
  normalizeActions, normalizeComposition, perPlayer, stackValue, needs, needsForModel, modelForAction,
};
