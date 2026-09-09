// Lógica pura do financeiro do torneio (P2). Sem I/O.
//
// Convenções (definidas com o cliente):
//   - rake: valor FIXO por entrada (buy-in e re-entry). Add-on não tem rake.
//   - bounty_value: parte do buy-in que vira "cabeça" do jogador (KO). Add-on não.
//   - contribuição da entrada para o prize pool = buy_in - rake - bounty_value
//   - add-on: valor inteiro vai para o prize pool, concede addon_chips fichas.
//   - premiação: template de % com faixas por nº de inscritos (total de entradas).

function round(n) { return Math.round(n); }

/** Contribuição financeira de uma entrada, dado o tipo. */
function entryContribution(t, type) {
  if (type === 'add-on') {
    const paid = Math.max(0, t.addon_value || 0);
    return { amount_paid: paid, prize_contribution: paid, bounty_contribution: 0 };
  }
  // buy-in / re-entry
  const buyIn = Math.max(0, t.buy_in || 0);
  const rake = Math.max(0, t.rake || 0);
  const bounty = Math.max(0, t.bounty_value || 0);
  const prize = Math.max(0, buyIn - rake - bounty);
  return { amount_paid: buyIn, prize_contribution: prize, bounty_contribution: bounty };
}

/** Resumo agregado a partir das entradas e eliminações. */
function summarize(entries = [], eliminations = []) {
  const count = (type) => entries.filter((e) => e.type === type).length;
  const sum = (field) => entries.reduce((s, e) => s + (e[field] || 0), 0);

  const buyins = count('buy-in');
  const reentries = count('re-entry');
  const addons = count('add-on');

  const rakeCollected = entries.reduce(
    (s, e) => s + Math.max(0, (e.amount_paid || 0) - (e.prize_contribution || 0) - (e.bounty_contribution || 0)),
    0
  );

  return {
    buyins,
    reentries,
    addons,
    total_entries: buyins + reentries,          // "field size" para a premiação
    gross: sum('amount_paid'),
    rake_collected: rakeCollected,
    prize_pool: sum('prize_contribution'),
    bounty_pool: sum('bounty_contribution'),
    bounty_paid: eliminations.reduce((s, el) => s + (el.bounty_awarded || 0), 0),
  };
}

/**
 * Tabela de premiação: escolhe a faixa do template pelo nº de inscritos e
 * calcula os valores. O resto de arredondamento vai para o 1º lugar.
 */
function payoutTable(prizePool, template, runnerCount) {
  if (!template || !Array.isArray(template.brackets)) return [];
  const bracket = template.brackets.find(
    (b) => runnerCount >= b.min_players && (b.max_players == null || runnerCount <= b.max_players)
  );
  if (!bracket || !bracket.payouts?.length) return [];

  const sorted = bracket.payouts.slice().sort((a, b) => a.place - b.place);
  let allocated = 0;
  const rows = sorted.map((p) => {
    const amount = round((prizePool * p.pct) / 100);
    allocated += amount;
    return { place: p.place, pct: p.pct, amount };
  });
  rows[0].amount += prizePool - allocated; // sobra/falta de arredondamento no 1º
  return rows;
}

/** Valida que as faixas de um template somam ~100% e não têm buracos grosseiros. */
function validateTemplate(template) {
  const errors = [];
  if (!template.name) errors.push('Nome é obrigatório.');
  if (!Array.isArray(template.brackets) || template.brackets.length === 0) {
    errors.push('Adicione ao menos uma faixa.');
    return errors;
  }
  template.brackets.forEach((b, i) => {
    const total = (b.payouts || []).reduce((s, p) => s + (Number(p.pct) || 0), 0);
    if (Math.abs(total - 100) > 0.5) errors.push(`Faixa ${i + 1}: os percentuais somam ${total}%, deveria ser 100%.`);
    if (b.max_players != null && b.max_players < b.min_players) errors.push(`Faixa ${i + 1}: máximo menor que o mínimo.`);
  });
  return errors;
}

module.exports = { entryContribution, summarize, payoutTable, validateTemplate };
