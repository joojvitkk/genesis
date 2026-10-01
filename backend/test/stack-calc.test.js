// G3 — cálculo puro de fichas por stack (lib/stackCalc.js). Sem banco.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../lib/stackCalc');

// fichas de exemplo (valores da tabela da spec §3.4)
const chips = new Map([
  ['c100', { value: 100, color: '#000000' }],
  ['c500', { value: 500, color: '#ff0000' }],
  ['c1000', { value: 1000, color: '#0000ff' }],
  ['c5000', { value: 5000, color: '#00ff00' }],
  ['c25000', { value: 25000, color: '#ffff00' }],
]);
// tabela ilustrativa da spec: Buy-in Padrão / Opcional / Reentrada
const model = {
  composition: [
    { chip_id: 'c100', quantities: { buy_in: 10 } },
    { chip_id: 'c500', quantities: { buy_in: 4, optional_buy_in: 4 } },
    { chip_id: 'c1000', quantities: { buy_in: 7, optional_buy_in: 8 } },
    { chip_id: 'c5000', quantities: { buy_in: 8, optional_buy_in: 8 } },
    { chip_id: 'c25000', quantities: { re_entry: 2 } },
  ],
};

test('aceite: 100 buy-ins → necessidade por denominação e total em valor', () => {
  const r = c.needsForModel({ buy_in: 100 }, model, chips);
  const byChip = Object.fromEntries(r.rows.map((x) => [x.chip_id, x.quantity]));
  assert.deepEqual(byChip, { c100: 1000, c500: 400, c1000: 700, c5000: 800 });
  // valor do stack de 1 jogador: 10*100 + 4*500 + 7*1000 + 8*5000 = 50.000 → × 100 jogadores
  assert.equal(c.stackValue(model, 'buy_in', chips), 50000);
  assert.equal(r.totals.value, 100 * c.stackValue(model, 'buy_in', chips));
  assert.equal(r.totals.quantity, 1000 + 400 + 700 + 800);
  assert.deepEqual(r.uncovered, []);
});

test('soma tipos de ação diferentes: buy-in + opcional + reentrada', () => {
  const r = c.needsForModel({ buy_in: 100, optional_buy_in: 20, re_entry: 10 }, model, chips);
  const q = (id) => r.rows.find((x) => x.chip_id === id);
  assert.equal(q('c500').quantity, 100 * 4 + 20 * 4);
  assert.deepEqual(q('c500').by_action, { buy_in: 400, optional_buy_in: 80 });
  assert.equal(q('c25000').quantity, 10 * 2, 'a reentrada usa a ficha de 25.000');
  const expectedValue = 100 * 50000 + 20 * (4 * 500 + 8 * 1000 + 8 * 5000) + 10 * 2 * 25000;
  assert.equal(r.totals.value, expectedValue);
  // linhas ordenadas pelo valor nominal da ficha
  assert.deepEqual(r.rows.map((x) => x.chip_id), ['c100', 'c500', 'c1000', 'c5000', 'c25000']);
});

test('valor de cada linha = quantidade × valor nominal, e o total é a soma das linhas', () => {
  const r = c.needsForModel({ buy_in: 3, re_entry: 1 }, model, chips);
  for (const row of r.rows) assert.equal(row.value, row.quantity * chips.get(row.chip_id).value);
  assert.equal(r.totals.value, r.rows.reduce((s, x) => s + x.value, 0));
});

test('ação sem composição no modelo vai para `uncovered` (não some nem vira zero silencioso)', () => {
  const r = c.needsForModel({ buy_in: 5, add_on: 7 }, model, chips);
  assert.deepEqual(r.uncovered, [{ action: 'add_on', count: 7 }]);
  assert.equal(r.rows.find((x) => x.chip_id === 'c100').quantity, 50);
  // sem modelo nenhum
  const none = c.needs([{ action: 'buy_in', count: 4, model: null }], chips);
  assert.deepEqual(none.rows, []);
  assert.deepEqual(none.uncovered, [{ action: 'buy_in', count: 4 }]);
});

test('contagem zero, negativa ou vazia não gera necessidade', () => {
  for (const counts of [{}, { buy_in: 0 }, { buy_in: -3 }, null, undefined]) {
    const r = c.needsForModel(counts, model, chips);
    assert.deepEqual(r.rows, []);
    assert.deepEqual(r.totals, { quantity: 0, value: 0 });
  }
});

test('usos com modelos diferentes por ação (torneio com stacks distintos)', () => {
  const vip = { composition: [{ chip_id: 'c25000', quantities: { optional_buy_in: 3 } }] };
  const r = c.needs([
    { action: 'buy_in', count: 10, model },
    { action: 'optional_buy_in', count: 5, model: vip },
  ], chips);
  assert.equal(r.rows.find((x) => x.chip_id === 'c25000').quantity, 15);
  assert.equal(r.rows.find((x) => x.chip_id === 'c100').quantity, 100);
  assert.equal(r.rows.find((x) => x.chip_id === 'c500').quantity, 40, 'o modelo padrão não vaza para a ação com modelo próprio');
});

test('ids podem vir como documento populado ou string', () => {
  const populated = { composition: [{ chip_id: { _id: 'c100', value: 100 }, quantities: { buy_in: 2 } }] };
  const r = c.needsForModel({ buy_in: 5 }, populated, chips);
  assert.equal(r.rows[0].chip_id, 'c100');
  assert.equal(r.rows[0].quantity, 10);
});

test('função pura: não altera as entradas', () => {
  const before = JSON.stringify(model);
  c.needsForModel({ buy_in: 9, re_entry: 2 }, model, chips);
  assert.equal(JSON.stringify(model), before);
});

test('propriedade: necessidade é linear — dobrar as ações dobra as fichas e o valor', () => {
  for (const counts of [{ buy_in: 7 }, { buy_in: 3, optional_buy_in: 5, re_entry: 2 }]) {
    const a = c.needsForModel(counts, model, chips);
    const doubled = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v * 2]));
    const b = c.needsForModel(doubled, model, chips);
    assert.equal(b.totals.value, a.totals.value * 2);
    assert.equal(b.totals.quantity, a.totals.quantity * 2);
  }
});

test('modelForAction: mapeamento por ação vence o modelo padrão', () => {
  const models = new Map([['A', { name: 'A' }], ['B', { name: 'B' }]]);
  const t = { stack_model_id: 'A', stack_models: [{ action: 're_entry', stack_model_id: 'B' }] };
  assert.equal(c.modelForAction(t, 'buy_in', models).name, 'A');
  assert.equal(c.modelForAction(t, 're_entry', models).name, 'B');
  assert.equal(c.modelForAction({ stack_models: [] }, 'buy_in', models), null);
  assert.equal(c.modelForAction({ stack_model_id: 'X' }, 'buy_in', models), null, 'modelo inexistente');
});

test('normalizeActions: chaves estáveis, rótulo e sem repetição', () => {
  assert.deepEqual(c.normalizeActions(undefined).map((a) => a.key), ['buy_in', 'optional_buy_in', 're_entry']);
  assert.deepEqual(c.normalizeActions([{ key: ' vip ', label: ' VIP ' }]), [{ key: 'vip', label: 'VIP' }]);
  for (const bad of [[], [{ key: 'Buy In', label: 'x' }], [{ key: '1a', label: 'x' }], [{ key: 'a', label: '' }],
    [{ key: 'a', label: 'x' }, { key: 'a', label: 'y' }], 'x']) {
    assert.throws(() => c.normalizeActions(bad), undefined, JSON.stringify(bad));
  }
});

test('normalizeComposition: valida a grade e aceita o formato antigo (quantity → buy_in)', () => {
  const actions = c.normalizeActions(undefined);
  assert.deepEqual(c.normalizeComposition([{ chip_id: 'a', quantities: { buy_in: '5', re_entry: 0 } }], actions),
    [{ chip_id: 'a', quantities: { buy_in: 5 } }], 'zeros saem, strings numéricas entram');
  assert.deepEqual(c.normalizeComposition([{ chip_id: 'a', quantity: 3 }], actions), [{ chip_id: 'a', quantities: { buy_in: 3 } }]);
  assert.deepEqual(c.normalizeComposition([{ chip_id: 'a', quantities: { buy_in: 1 } }, { chip_id: 'b', quantities: {} }], actions).length, 1,
    'linha toda zerada é descartada');
  const bad = [
    [], [{ chip_id: 'a', quantities: {} }], [{ chip_id: 'a', quantities: { buy_in: 1.5 } }], [{ chip_id: 'a', quantities: { buy_in: -1 } }],
    [{ chip_id: 'a', quantities: { inexistente: 1 } }], [{ chip_id: 'a', quantities: { buy_in: 1 } }, { chip_id: 'a', quantities: { buy_in: 2 } }],
    [{ quantities: { buy_in: 1 } }], 'x',
  ];
  for (const rows of bad) assert.throws(() => c.normalizeComposition(rows, actions), undefined, JSON.stringify(rows));
});
