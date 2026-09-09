const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Tournament, Player, PayoutTemplate } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

async function authed(role = 'salao') {
  const { token } = await makeUser(role);
  return { Authorization: `Bearer ${token}` };
}

test('CRUD de jogador + busca', async () => {
  const H = await authed();
  const created = await request(app).post('/api/players').set(H).send({ name: 'Ana Silva', document: '111' });
  assert.equal(created.status, 201);

  await request(app).post('/api/players').set(H).send({ name: 'Bruno Costa' });

  const search = await request(app).get('/api/players?search=silva').set(H);
  assert.equal(search.status, 200);
  assert.equal(search.body.length, 1);
  assert.equal(search.body[0].name, 'Ana Silva');

  const del = await request(app).delete(`/api/players/${created.body._id}`).set(H);
  assert.equal(del.status, 200);
  assert.equal((await request(app).get('/api/players').set(H)).body.length, 1);
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

test('entrada com jogador calcula contribuições e finance agrega', async () => {
  const H = await authed();
  const tpl = await PayoutTemplate.create({
    name: 'T', brackets: [{ min_players: 2, max_players: null, payouts: [{ place: 1, pct: 70 }, { place: 2, pct: 30 }] }],
  });
  const t = await Tournament.create({
    name: 'Etapa', date: new Date(), buy_in: 100, rake: 10, bounty_value: 20, payout_template_id: tpl._id,
  });
  const p1 = await Player.create({ name: 'P1' });
  const p2 = await Player.create({ name: 'P2' });
  const p3 = await Player.create({ name: 'P3' });

  for (const p of [p1, p2, p3]) {
    const r = await request(app).post(`/api/tournaments/${t._id}/entries`).set(H)
      .send({ type: 'buy-in', player_id: p._id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.prize_contribution, 70);   // 100 - 10 - 20
    assert.equal(r.body.bounty_contribution, 20);
  }

  const fin = await request(app).get(`/api/tournaments/${t._id}/finance`).set(H);
  assert.equal(fin.body.summary.prize_pool, 210);
  assert.equal(fin.body.summary.bounty_pool, 60);
  assert.equal(fin.body.summary.rake_collected, 30);
  assert.equal(fin.body.players_remaining, 3);
  assert.equal(fin.body.payouts.length, 2);
  assert.equal(fin.body.payouts[0].amount, 147); // 70% de 210
});

test('fluxo de eliminação até finalizar com premiação', async () => {
  const H = await authed();
  const tpl = await PayoutTemplate.create({
    name: 'T', brackets: [{ min_players: 2, max_players: null, payouts: [{ place: 1, pct: 70 }, { place: 2, pct: 30 }] }],
  });
  const t = await Tournament.create({
    name: 'Etapa', date: new Date(), status: 'running', buy_in: 100, rake: 0, bounty_value: 10, payout_template_id: tpl._id,
  });
  const [p1, p2, p3] = await Promise.all([
    Player.create({ name: 'P1' }), Player.create({ name: 'P2' }), Player.create({ name: 'P3' }),
  ]);
  for (const p of [p1, p2, p3]) {
    await request(app).post(`/api/tournaments/${t._id}/entries`).set(H).send({ type: 'buy-in', player_id: p._id });
  }

  // P3 sai em 3º, eliminado por P1 (ganha bounty de 10)
  let r = await request(app).post(`/api/tournaments/${t._id}/eliminations`).set(H)
    .send({ player_id: p3._id, eliminated_by: p1._id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.eliminations.find((e) => String(e.player_id._id) === String(p3._id)).position, 3);
  assert.equal(r.body.players_remaining, 2);

  // P2 sai em 2º → sobra P1 → finaliza
  r = await request(app).post(`/api/tournaments/${t._id}/eliminations`).set(H)
    .send({ player_id: p2._id, eliminated_by: p1._id });
  assert.equal(r.status, 201);
  assert.equal(r.body.tournament.status, 'finalized');

  const results = await request(app).get(`/api/tournaments/${t._id}/results`).set(H);
  assert.equal(results.body.length, 3);
  const champ = results.body.find((x) => x.position === 1);
  assert.equal(champ.player.name, 'P1');
  // prize pool = 3×100 - 3×10 bounty = 270; 70% = 189
  assert.equal(champ.prize, 189);
  assert.equal(champ.bounty_won, 20); // 2 KOs × 10
  assert.equal(results.body.find((x) => x.position === 2).prize, 81); // 30% de 270
  assert.equal(results.body.find((x) => x.position === 3).prize, 0);
});

test('não pode eliminar jogador não inscrito ou já eliminado', async () => {
  const H = await authed();
  const t = await Tournament.create({ name: 'X', date: new Date(), status: 'running', buy_in: 50 });
  const [p1, p2] = await Promise.all([Player.create({ name: 'A' }), Player.create({ name: 'B' })]);
  await request(app).post(`/api/tournaments/${t._id}/entries`).set(H).send({ type: 'buy-in', player_id: p1._id });

  const notIn = await request(app).post(`/api/tournaments/${t._id}/eliminations`).set(H).send({ player_id: p2._id });
  assert.equal(notIn.status, 400);
});
