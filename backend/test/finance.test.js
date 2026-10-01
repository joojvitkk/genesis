// Financeiro do torneio e eliminações — SEM cadastro de jogadores: a identidade é a ENTRADA ("Entrada #n").
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const models = require('../models');
const { Tournament, PayoutTemplate } = models;

before(connect);
after(disconnect);
beforeEach(clearDb);

async function authed(role = 'admin') {
  const { token } = await makeUser(role);
  return { Authorization: `Bearer ${token}` };
}
const enter = (H, t, body = {}) => request(app).post(`/api/tournaments/${t._id}/entries`).set(H).send({ type: 'buy-in', ...body });
const eliminate = (H, t, entry) => request(app).post(`/api/tournaments/${t._id}/eliminations`).set(H).send({ entry_id: entry._id });

test('não existe cadastro de jogadores: o modelo, as rotas e os campos saíram', async () => {
  const H = await authed();
  assert.equal(models.Player, undefined);
  for (const [m, url] of [['get', '/api/players'], ['post', '/api/players'], ['get', '/api/players/64b000000000000000000000'], ['put', '/api/players/64b000000000000000000000'], ['delete', '/api/players/64b000000000000000000000']]) {
    assert.equal((await request(app)[m](url).set(H).send({ name: 'x' })).status, 404, `${m} ${url}`);
  }
  const t = await Tournament.create({ name: 'T', date: new Date(), buy_in: 10 });
  const e = (await enter(H, t, { player_id: '64b000000000000000000000', player_name: 'Ana' })).body;
  assert.equal(e.player_id, undefined, 'campos de jogador são ignorados');
  assert.equal(e.player_name, undefined);
  assert.equal(e.number, 1);
});

test('template de premiação: rejeita faixa que não soma 100%', async () => {
  const H = await authed();
  const bad = await request(app).post('/api/payout-templates').set(H).send({
    name: 'Ruim', brackets: [{ min_players: 2, payouts: [{ place: 1, pct: 80 }] }],
  });
  assert.equal(bad.status, 400);
  const ok = await request(app).post('/api/payout-templates').set(H).send({
    name: 'Padrão', brackets: [{ min_players: 2, max_players: null, payouts: [{ place: 1, pct: 60 }, { place: 2, pct: 40 }] }],
  });
  assert.equal(ok.status, 201);
});

test('entradas calculam contribuições, são NUMERADAS e o finance agrega', async () => {
  const H = await authed();
  const tpl = await PayoutTemplate.create({ name: 'T', brackets: [{ min_players: 2, max_players: null, payouts: [{ place: 1, pct: 70 }, { place: 2, pct: 30 }] }] });
  const t = await Tournament.create({ name: 'Etapa', date: new Date(), buy_in: 100, rake: 10, bounty_value: 20, payout_template_id: tpl._id });

  const numbers = [];
  for (let i = 0; i < 3; i++) {
    const r = await enter(H, t);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.prize_contribution, 70);   // 100 - 10 - 20
    assert.equal(r.body.bounty_contribution, 20);
    numbers.push(r.body.number);
  }
  assert.deepEqual(numbers, [1, 2, 3]);

  const fin = await request(app).get(`/api/tournaments/${t._id}/finance`).set(H);
  assert.equal(fin.body.summary.prize_pool, 210);
  assert.equal(fin.body.summary.bounty_pool, 60);
  assert.equal(fin.body.summary.rake_collected, 30);
  assert.equal(fin.body.summary.bounty_paid, 0, 'sem eliminador não há bounty pago');
  assert.equal(fin.body.players_remaining, 3);
  assert.equal(fin.body.payouts[0].amount, 147); // 70% de 210
});

test('entradas em lote também são numeradas em sequência e cada uma ganha um lugar', async () => {
  const H = await authed();
  const t = await Tournament.create({ name: 'Lote', date: new Date(), buy_in: 10 });
  await enter(H, t);
  const batch = await enter(H, t, { quantity: 5 });
  assert.equal(batch.status, 201);
  const list = (await request(app).get(`/api/tournaments/${t._id}/entries`).set(H)).body;
  assert.deepEqual(list.map((e) => e.number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.equal(await models.Seat.countDocuments({ tournament_id: t._id }), 6);
  assert.equal((await Tournament.findById(t._id)).entry_seq, 6);
});

test('fluxo de eliminação até finalizar com premiação (por entrada)', async () => {
  const H = await authed();
  const tpl = await PayoutTemplate.create({ name: 'T', brackets: [{ min_players: 2, max_players: null, payouts: [{ place: 1, pct: 70 }, { place: 2, pct: 30 }] }] });
  const t = await Tournament.create({ name: 'Etapa', date: new Date(), status: 'running', buy_in: 100, rake: 0, bounty_value: 10, payout_template_id: tpl._id });
  const [e1, e2, e3] = [(await enter(H, t)).body, (await enter(H, t)).body, (await enter(H, t)).body];

  let r = await eliminate(H, t, e3);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const out = r.body.eliminations.find((x) => String(x.entry_id) === String(e3._id));
  assert.deepEqual([out.position, out.label, out.entry_number], [3, 'Entrada #3', 3]);
  assert.equal(r.body.players_remaining, 2);

  r = await eliminate(H, t, e2);
  assert.equal(r.status, 201);
  assert.equal(r.body.tournament.status, 'finalized');

  const results = await request(app).get(`/api/tournaments/${t._id}/results`).set(H);
  assert.equal(results.body.length, 3);
  const champ = results.body.find((x) => x.position === 1);
  assert.deepEqual([champ.label, String(champ.entry_id)], ['Entrada #1', String(e1._id)]);
  assert.equal(champ.prize, 189);                                       // 70% de 270 (3×100 − 3×10 de bounty)
  assert.equal(champ.bounty_won, undefined, 'não há bounty por eliminador');
  assert.equal(results.body.find((x) => x.position === 2).prize, 81);   // 30%
  assert.equal(results.body.find((x) => x.position === 3).prize, 0);
});

test('não elimina entrada inexistente, de outro torneio, add-on ou já eliminada', async () => {
  const H = await authed();
  const t = await Tournament.create({ name: 'X', date: new Date(), status: 'running', buy_in: 50, addon_value: 10 });
  const other = await Tournament.create({ name: 'Y', date: new Date(), status: 'running', buy_in: 50 });
  const a = (await enter(H, t)).body;
  await enter(H, t);
  await enter(H, t);
  const foreign = (await enter(H, other)).body;
  const addon = (await enter(H, t, { type: 'add-on' })).body;

  assert.equal((await eliminate(H, t, { _id: '64b000000000000000000000' })).status, 400);
  assert.equal((await eliminate(H, t, { _id: 'lixo' })).status, 400);
  assert.equal((await eliminate(H, t, foreign)).status, 400, 'entrada de outro torneio');
  assert.equal((await eliminate(H, t, addon)).status, 400, 'add-on não joga');
  assert.equal((await eliminate(H, t, a)).status, 201);
  assert.equal((await eliminate(H, t, a)).status, 400, 'já eliminada');
});
