// Cenário real do Warm Up (stack 50.000): trocas do Dia 1A, herança do Dia Final e plano das mesas (itens 28 e 30).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');
const app = require('../app');
const conversion = require('../lib/conversion');

before(connect);
after(disconnect);
beforeEach(clearDb);

const as = async (role) => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, u, b) => request(app).post(u).set(h).send(b);
const put = (h, u, b) => request(app).put(u).set(h).send(b);
const get = (h, u) => request(app).get(u).set(h);

test('item 30: método das mesas — Chip Race de 100 e Color Up de 500 do cenário real', () => {
  const race = conversion.tablePlan({ outValueInPlay: 1000 * 100, tables: 36, enterValue: 5000 });
  assert.deepEqual([race.raw_per_table, race.per_table_value, race.quantity_in, race.value_in], [2778, 5000, 36, 180000]);
  const color = conversion.tablePlan({ outValueInPlay: 372 * 500, tables: 24, enterValue: 25000 });
  assert.deepEqual([color.raw_per_table, color.per_table_value, color.quantity_in, color.value_in], [7750, 25000, 24, 600000]);
  assert.throws(() => conversion.tablePlan({ outValueInPlay: 100, tables: 0, enterValue: 5 }), /mesas/);
});

async function warmUp() {
  const c = {};
  for (const [v, color] of [[100, '#000001'], [500, '#000002'], [1000, '#000003'], [5000, '#000004'], [25000, '#000005']]) c[v] = await makeChip({ value: v, color });
  const binder = await makeBinder('Maleta', Object.entries(c).map(([, chip]) => ({ chip, quantity: 100000 })));
  const admin = await as('admin');
  const stack = (await post(admin, '/api/stacks', {
    name: 'Warm Up 50k', actions: [{ key: 'buy_in', label: 'Buy-in padrão' }, { key: 're_entry', label: 'Reentrada' }],
    composition: [
      { chip_id: c[100]._id, quantities: { buy_in: 10 } }, { chip_id: c[500]._id, quantities: { buy_in: 4 } },
      { chip_id: c[1000]._id, quantities: { buy_in: 7 } }, { chip_id: c[5000]._id, quantities: { buy_in: 8 } },
      { chip_id: c[25000]._id, quantities: { re_entry: 2 } },
    ],
  })).body;
  const t = (await post(admin, '/api/tournaments', { name: 'Warm Up', date: '2026-10-01', stack_model_id: stack._id, sessions: ['Dia 1A', 'Dia 1B', 'Dia Final'] })).body;
  assert.equal((await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id })).status, 201);
  return { c, binder, admin, t, s: Object.fromEntries(t.sessions.map((x) => [x.name, x])) };
}

test('Dia 1A: 100 buy-ins + 97 reentradas, Chip Race 100 e Color Up 500 → saldo 9.853.000; Final herda e o plano das mesas bate', async () => {
  const { c, binder, admin, t, s } = await warmUp();
  const a = s['Dia 1A'];
  const r = await post(admin, `/api/tournaments/${t._id}/sends`, { session_id: a._id, items: [{ action: 'buy_in', count: 100 }, { action: 're_entry', count: 97 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 100, session_id: a._id })).status, 201);
  assert.equal((await post(admin, `/api/tournaments/${t._id}/entries`, { type: 're-entry', quantity: 97, session_id: a._id })).status, 201);

  const trade = (type, outs, ins) => post(admin, '/api/conversions', { tournament_id: t._id, session_id: a._id, binder_id: binder._id, type, outs, ins });
  const q = (chip, quantity) => ({ chip_id: c[chip]._id, quantity });
  const race = await trade('CHIP_RACE', [q(100, 1000), q(500, 28), q(1000, 56), q(5000, 2)], [q(5000, 36)]);
  assert.equal(race.status, 201, JSON.stringify(race.body));
  assert.equal(race.body.math_breakage, 0);
  const color = await trade('COLOR_UP', [q(500, 372), q(1000, 21), q(5000, 23), q(25000, 11)], [q(25000, 24)]);
  assert.equal(color.status, 201, JSON.stringify(color.body));
  assert.equal(color.body.math_breakage, 3000);

  const sum = (await get(admin, `/api/tournaments/${t._id}/material?session_id=${a._id}`)).body;
  const qty = Object.fromEntries(sum.rows.map((x) => [x.chip.value, x.in_play]));
  assert.deepEqual([qty[100] || 0, qty[500] || 0, qty[1000], qty[5000], qty[25000]], [0, 0, 623, 811, 207]);
  assert.equal(sum.chip_count.value, 9853000);
  // tabela por ação (item 26)
  const act = Object.fromEntries(sum.by_action.map((x) => [x.action, x]));
  assert.deepEqual([act.buy_in.sent, act.buy_in.used, act.buy_in.available, act.buy_in.missing], [100, 100, 0, 0]);
  assert.deepEqual([act.re_entry.sent, act.re_entry.used], [97, 97]);

  // encerra o 1A e o 1B (classificados 57 e 0); o Dia Final herda o que está nos sacos
  await put(admin, `/api/tournaments/${t._id}/sessions/${a._id}`, { status: 'running' });
  await put(admin, `/api/tournaments/${t._id}/sessions/${a._id}`, { status: 'finished', qualified_count: 57 });
  const fin = s['Dia Final'];
  const fsum = (await get(admin, `/api/tournaments/${t._id}/material?session_id=${fin._id}`)).body;
  assert.equal(fsum.chip_count.value, 9853000);
  const onTable = Object.fromEntries(fsum.rows.map((x) => [x.chip.value, x.on_table]));
  assert.deepEqual([onTable[1000], onTable[5000], onTable[25000]], [623, 811, 207], 'saldo físico do Final = o que veio das origens');

  // Livro (item 32): "Esperado" = ações × montagem, e o total do torneio nunca soma o herdado com as origens
  const book = (await get(admin, `/api/tournaments/${t._id}/book`)).body;
  const b1a = book.sessions.find((x) => x.name === 'Dia 1A');
  assert.equal(b1a.totals.expected, 9850000);
  assert.equal(b1a.totals.in_play, 9853000);
  assert.equal(b1a.breakage, 3000);
  assert.equal(b1a.trades.length, 2);
  assert.equal(b1a.trades[0].value_out, 180000);
  const bFinal = book.sessions.find((x) => x.name === 'Dia Final');
  assert.equal(bFinal.inherits, true);
  assert.equal(bFinal.totals.in_play, 9853000);
  assert.equal(book.totals.in_play, 9853000, 'herdado não duplica as origens');
  assert.equal(book.totals.expected, 9850000);
  assert.deepEqual([book.totals.closing.delivered, book.totals.closing.breakage, book.totals.closing.balance], [9850000, 3000, 9853000]);

  // plano das mesas sobre o Final: 25.000 × 207 em jogo = 5.175.000 ÷ 36 mesas → 143.750 → 150.000 (múltiplo de 25.000)
  const plan = await post(admin, '/api/conversions/plan', { tournament_id: t._id, session_id: fin._id, chip_out_id: c[5000]._id, chip_in_id: c[25000]._id, tables: 24 });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.equal(plan.body.chip_out.value_in_play, 811 * 5000);
  assert.equal(plan.body.per_table_value, 175000); // 4.055.000 ÷ 24 = 168.959 → 175.000
  assert.equal(plan.body.quantity_in, 24 * 7);

  // Chip Race no Final passa (antes: "Ficha 1000 tem 0 em jogo nesta sessão")
  const finalRace = await post(admin, '/api/conversions', { tournament_id: t._id, session_id: fin._id, binder_id: binder._id, type: 'CHIP_RACE', outs: [q(1000, 623), q(5000, 11)], ins: [q(25000, 28)] });
  assert.equal(finalRace.status, 201, JSON.stringify(finalRace.body));
  assert.equal(finalRace.body.math_breakage, 28 * 25000 - (623 * 1000 + 11 * 5000));
});
