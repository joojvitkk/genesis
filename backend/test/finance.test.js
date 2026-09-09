const { test } = require('node:test');
const assert = require('node:assert/strict');
const { entryContribution, summarize, payoutTable, validateTemplate } = require('../lib/tournamentFinance');

test('entryContribution: buy-in separa rake e bounty', () => {
  const t = { buy_in: 100, rake: 10, bounty_value: 30 };
  assert.deepEqual(entryContribution(t, 'buy-in'), { amount_paid: 100, prize_contribution: 60, bounty_contribution: 30 });
  assert.deepEqual(entryContribution(t, 're-entry'), { amount_paid: 100, prize_contribution: 60, bounty_contribution: 30 });
});

test('entryContribution: add-on vai inteiro pro pool, sem rake nem bounty', () => {
  const t = { buy_in: 100, rake: 10, bounty_value: 30, addon_value: 50 };
  assert.deepEqual(entryContribution(t, 'add-on'), { amount_paid: 50, prize_contribution: 50, bounty_contribution: 0 });
});

test('summarize agrega entradas e bounties pagos', () => {
  const t = { buy_in: 100, rake: 10, bounty_value: 0 };
  const mk = (type) => ({ type, ...entryContribution(t, type) });
  const entries = [mk('buy-in'), mk('buy-in'), mk('re-entry'), mk('add-on')];
  const elims = [{ bounty_awarded: 0 }];
  const s = summarize(entries, elims);
  assert.equal(s.buyins, 2);
  assert.equal(s.reentries, 1);
  assert.equal(s.addons, 1);
  assert.equal(s.total_entries, 3);
  assert.equal(s.prize_pool, 270);      // 3 entradas × 90 (add-on aqui é 0, sem addon_value)
  assert.equal(s.rake_collected, 30);   // 3 × 10
});

test('payoutTable escolhe a faixa e ajusta o arredondamento no 1º', () => {
  const tpl = {
    brackets: [
      { min_players: 2, max_players: 9, payouts: [{ place: 1, pct: 65 }, { place: 2, pct: 35 }] },
      { min_players: 10, max_players: null, payouts: [{ place: 1, pct: 50 }, { place: 2, pct: 30 }, { place: 3, pct: 20 }] },
    ],
  };
  const small = payoutTable(1000, tpl, 7);
  assert.equal(small.length, 2);
  assert.equal(small[0].amount + small[1].amount, 1000);

  const big = payoutTable(3333, tpl, 25);
  assert.equal(big.length, 3);
  assert.equal(big[0].amount + big[1].amount + big[2].amount, 3333); // sobra vai pro 1º
});

test('payoutTable sem faixa aplicável → vazio', () => {
  const tpl = { brackets: [{ min_players: 20, max_players: 30, payouts: [{ place: 1, pct: 100 }] }] };
  assert.deepEqual(payoutTable(1000, tpl, 5), []);
});

test('validateTemplate exige soma 100% por faixa', () => {
  assert.deepEqual(validateTemplate({ name: 'OK', brackets: [{ min_players: 2, payouts: [{ place: 1, pct: 100 }] }] }), []);
  const errs = validateTemplate({ name: 'Ruim', brackets: [{ min_players: 2, payouts: [{ place: 1, pct: 90 }] }] });
  assert.ok(errs.length > 0);
});
