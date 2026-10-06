// MEL-02: fluxo Salão → Material do Chip Race / Color Up.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');
const app = require('../app');
const { ConversionRequest } = require('../models');
const { estimate } = require('../lib/conversionRequests');

before(connect);
after(disconnect);
beforeEach(clearDb);

const as = async (role) => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);

async function scene() {
  const admin = await as('admin');
  const c100 = await makeChip({ value: 100 }); const c5000 = await makeChip({ value: 5000 });
  const binder = await makeBinder('Drogon', [{ chip: c100, quantity: 5000 }, { chip: c5000, quantity: 500 }]);
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: c100._id, quantities: { buy_in: 100 } }] })).body;
  const t = (await post(admin, '/api/tournaments', { name: 'Warm Up', date: '2026-10-28', stack_model_id: stack._id })).body;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'binder' });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 20 });
  return { admin, t, c100, c5000, binder };
}

test('estimativa: base e arredondamento para cima por mesa', () => {
  const e = estimate({ tables: 3, active: 20, entriesTotal: 22, rows: [{ chip: { _id: 'a', value: 100 }, quantity: 1000 }] });
  assert.equal(e.players_per_table, 7);          // 20 ÷ 3 = 6,67 → 7
  assert.equal(e.per_table[0].per_table, 334);   // 1000 ÷ 3 = 333,3 → 334
  assert.deepEqual(e.base, { tables: 3, active_players: 20, entries_total: 22 });
});

test('Salão solicita com as mesas reais; Material recebe, prepara, e a conversão conclui o chamado', async () => {
  const { t, c100, c5000, admin } = await scene();
  const sal = await as('salao'); const mat = await as('material');

  // só o Salão (ou admin) solicita; o material não
  assert.equal((await post(mat, `/api/tournaments/${t._id}/conversion-requests`, { type: 'CHIP_RACE', tables: 2 })).status, 403);
  assert.equal((await post(sal, `/api/tournaments/${t._id}/conversion-requests`, { type: 'CHIP_RACE', tables: 0 })).status, 400, 'mesas reais ≥ 1');
  const r = await post(sal, `/api/tournaments/${t._id}/conversion-requests`, { type: 'CHIP_RACE', tables: 2, note: 'nível 5' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'requested');
  assert.equal(r.body.snapshot.active_players, 20);

  // o material enxerga o chamado e atende
  const queue = (await get(mat, '/api/conversion-requests?status=open')).body;
  assert.equal(queue.length, 1);
  assert.equal((await put(sal, `/api/conversion-requests/${r.body._id}`, { status: 'in_preparation' })).status, 403, 'salão não atende');
  assert.equal((await put(mat, `/api/conversion-requests/${r.body._id}`, { status: 'ready' })).status, 409, 'não pula o preparo');
  assert.equal((await put(mat, `/api/conversion-requests/${r.body._id}`, { status: 'in_preparation' })).status, 200);
  assert.equal((await put(mat, `/api/conversion-requests/${r.body._id}`, { status: 'ready' })).status, 200);

  // envio das fichas e execução da troca vinculada ao chamado: 100×100 → 2×5000 (valor conservado)
  assert.equal((await post(mat, `/api/tournaments/${t._id}/sends`, { items: [{ action: 'buy_in', count: 20 }] })).status, 201);
  const wrong = await post(mat, '/api/conversions', { tournament_id: t._id, type: 'COLOR_UP', request_id: r.body._id, outs: [{ chip_id: c100._id, quantity: 100 }], ins: [{ chip_id: c5000._id, quantity: 2 }] });
  assert.equal(wrong.status, 409, 'tipo diferente do solicitado');
  const done = await post(mat, '/api/conversions', { tournament_id: t._id, type: 'CHIP_RACE', request_id: r.body._id, outs: [{ chip_id: c100._id, quantity: 100 }], ins: [{ chip_id: c5000._id, quantity: 2 }] });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.math_breakage, 0);

  const after = await ConversionRequest.findById(r.body._id);
  assert.equal(after.status, 'completed');
  assert.equal(String(after.conversion_id), String(done.body._id));
  assert.deepEqual(after.history.map((h) => h.status), ['requested', 'in_preparation', 'ready', 'completed']);

  // fechar/alterar entradas depois NÃO reescreve o snapshot da troca já executada
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 5 });
  assert.equal((await ConversionRequest.findById(r.body._id)).snapshot.active_players, 20);
  // chamado concluído não pode ser reutilizado
  const again = await post(mat, '/api/conversions', { tournament_id: t._id, type: 'CHIP_RACE', request_id: r.body._id, outs: [{ chip_id: c100._id, quantity: 1 }], ins: [{ chip_id: c100._id, quantity: 1 }] });
  assert.equal(again.status, 409);
});

test('o Salão cancela o próprio chamado; chamado cancelado não atende conversão', async () => {
  const { t, c100 } = await scene();
  const sal = await as('salao'); const mat = await as('material');
  const r = (await post(sal, `/api/tournaments/${t._id}/conversion-requests`, { type: 'COLOR_UP', tables: 1 })).body;
  assert.equal((await put(sal, `/api/conversion-requests/${r._id}`, { status: 'cancelled' })).status, 200);
  const res = await post(mat, '/api/conversions', { tournament_id: t._id, type: 'COLOR_UP', request_id: r._id, outs: [{ chip_id: c100._id, quantity: 1 }], ins: [{ chip_id: c100._id, quantity: 1 }] });
  assert.equal(res.status, 409);
});
