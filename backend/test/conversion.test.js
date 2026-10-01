// G6 — conversão de fichas (lib/conversion.js): lógica PURA do Chip Race / Color Up e da quebra matemática.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../lib/conversion');

const chips = new Map([
  ['c25', { value: 25 }], ['c100', { value: 100 }], ['c500', { value: 500 }], ['c1000', { value: 1000 }],
]);

test('valor retirado, valor colocado e quebra matemática (spec §8: ±500 é válido)', () => {
  // retirou 1.030 fichas de 100 (103.000) e colocou 207 de 500 (103.500) → +500 de quebra
  const r = c.compute([{ chip_id: 'c100', quantity: 1030 }], [{ chip_id: 'c500', quantity: 207 }], chips);
  assert.equal(r.value_out, 103000);
  assert.equal(r.value_in, 103500);
  assert.equal(r.math_breakage, 500);

  const neg = c.compute([{ chip_id: 'c100', quantity: 1030 }], [{ chip_id: 'c500', quantity: 205 }], chips);
  assert.equal(neg.math_breakage, -500, 'quebra negativa também é legítima');

  const zero = c.compute([{ chip_id: 'c100', quantity: 1000 }], [{ chip_id: 'c500', quantity: 200 }], chips);
  assert.equal(zero.math_breakage, 0);
});

test('vários itens por lado; cada linha traz o seu valor e o total é a soma', () => {
  const r = c.compute(
    [{ chip_id: 'c25', quantity: 40 }, { chip_id: 'c100', quantity: 10 }],
    [{ chip_id: 'c1000', quantity: 2 }],
    chips,
  );
  assert.deepEqual(r.outs.map((l) => l.value), [1000, 1000]);
  assert.equal(r.value_out, 2000);
  assert.equal(r.ins[0].value, 2000);
  assert.equal(r.math_breakage, 0);
  assert.equal(r.value_out, r.outs.reduce((s, l) => s + l.value, 0));
});

test('propriedade: quebra = valor colocado − valor retirado, para quaisquer quantidades', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 200; i++) {
    const o = 1 + Math.floor(rnd() * 5000); const n = 1 + Math.floor(rnd() * 900);
    const r = c.compute([{ chip_id: 'c25', quantity: o }], [{ chip_id: 'c1000', quantity: n }], chips);
    assert.equal(r.math_breakage, n * 1000 - o * 25);
    assert.equal(r.value_in - r.value_out, r.math_breakage);
  }
});

test('normalize: as duas pontas são obrigatórias e uma ficha não pode estar nos dois lados', () => {
  const ok = c.normalize([{ chip_id: 'c100', quantity: 5 }], [{ chip_id: 'c500', quantity: 1 }]);
  assert.deepEqual(ok, { outs: [{ chip_id: 'c100', quantity: 5 }], ins: [{ chip_id: 'c500', quantity: 1 }] });

  const bad = [
    [[], [{ chip_id: 'c500', quantity: 1 }]],
    [[{ chip_id: 'c100', quantity: 5 }], []],
    [null, [{ chip_id: 'c500', quantity: 1 }]],
    [[{ chip_id: 'c100', quantity: 5 }], [{ chip_id: 'c100', quantity: 1 }]],                  // mesma ficha nos 2 lados
    [[{ chip_id: 'c100', quantity: 5 }, { chip_id: 'c100', quantity: 1 }], [{ chip_id: 'c500', quantity: 1 }]], // repetida
    [[{ chip_id: 'c100', quantity: 0 }], [{ chip_id: 'c500', quantity: 1 }]],
    [[{ chip_id: 'c100', quantity: -3 }], [{ chip_id: 'c500', quantity: 1 }]],
    [[{ chip_id: 'c100', quantity: 1.5 }], [{ chip_id: 'c500', quantity: 1 }]],
    [[{ quantity: 5 }], [{ chip_id: 'c500', quantity: 1 }]],
  ];
  for (const [outs, ins] of bad) assert.throws(() => c.normalize(outs, ins), undefined, JSON.stringify([outs, ins]));
});

test('ficha desconhecida na conta é erro (não vira valor zero em silêncio)', () => {
  assert.throws(() => c.compute([{ chip_id: 'nao', quantity: 1 }], [{ chip_id: 'c500', quantity: 1 }], chips), /Ficha não encontrada/);
});

test('função pura: não altera as entradas; tipos de movimento por conversão', () => {
  const outs = [{ chip_id: 'c100', quantity: 5 }]; const ins = [{ chip_id: 'c500', quantity: 1 }];
  const before = JSON.stringify([outs, ins]);
  c.compute(outs, ins, chips);
  assert.equal(JSON.stringify([outs, ins]), before);
  assert.deepEqual([c.OUT_TYPE.CHIP_RACE, c.IN_TYPE.CHIP_RACE, c.OUT_TYPE.COLOR_UP, c.IN_TYPE.COLOR_UP],
    ['CHIP_RACE_OUT', 'CHIP_RACE_IN', 'COLOR_UP_OUT', 'COLOR_UP_IN']);
});
