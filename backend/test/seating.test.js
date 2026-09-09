const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Tournament, Player, Seat, BlindStructureTemplate } = require('../models');
const S = require('../lib/seating');

before(connect);
after(disconnect);
beforeEach(clearDb);

// ─── Lógica pura ────────────────────────────────────────────────────────────
test('pickSeatForNewPlayer abre nova mesa quando todas cheias', () => {
  const tables = S.buildTables(
    Array.from({ length: 9 }, (_, i) => ({ table_number: 1, seat_number: i + 1, player_id: 'p' + i })),
    9
  );
  const spot = S.pickSeatForNewPlayer(tables, 9);
  assert.equal(spot.table_number, 2);
});

test('pickSeatForNewPlayer equilibra pela mesa menos cheia', () => {
  const docs = [
    ...Array.from({ length: 8 }, (_, i) => ({ table_number: 1, seat_number: i + 1, player_id: 'a' + i })),
    ...Array.from({ length: 3 }, (_, i) => ({ table_number: 2, seat_number: i + 1, player_id: 'b' + i })),
  ];
  const spot = S.pickSeatForNewPlayer(S.buildTables(docs, 9), 9);
  assert.equal(spot.table_number, 2);
});

test('suggestBalance dispara com diferença de 2+', () => {
  const docs = [
    ...Array.from({ length: 8 }, (_, i) => ({ table_number: 1, seat_number: i + 1, player_id: 'a' + i })),
    ...Array.from({ length: 4 }, (_, i) => ({ table_number: 2, seat_number: i + 1, player_id: 'b' + i })),
  ];
  const s = S.suggestBalance(S.buildTables(docs, 9), 9);
  assert.equal(s.from_table, 1);
  assert.equal(s.to_table, 2);

  const balanced = [
    ...Array.from({ length: 5 }, (_, i) => ({ table_number: 1, seat_number: i + 1, player_id: 'a' + i })),
    ...Array.from({ length: 4 }, (_, i) => ({ table_number: 2, seat_number: i + 1, player_id: 'b' + i })),
  ];
  assert.equal(S.suggestBalance(S.buildTables(balanced, 9), 9), null);
});

test('breakableTables sugere quebrar a menor quando cabe em uma mesa a menos', () => {
  // 7 + 2 = 9 cabe numa única mesa 9-max → quebra a mesa 2
  const canBreak = [
    ...Array.from({ length: 7 }, (_, i) => ({ table_number: 1, seat_number: i + 1, player_id: 'a' + i })),
    ...Array.from({ length: 2 }, (_, i) => ({ table_number: 2, seat_number: i + 1, player_id: 'b' + i })),
  ];
  const b = S.breakableTables(S.buildTables(canBreak, 9), 9);
  assert.equal(b.length, 1);
  assert.equal(b[0].table_number, 2);

  // 8 + 5 = 13 não cabe em uma mesa 9-max → nada a quebrar
  const cannot = [
    ...Array.from({ length: 8 }, (_, i) => ({ table_number: 1, seat_number: i + 1, player_id: 'a' + i })),
    ...Array.from({ length: 5 }, (_, i) => ({ table_number: 2, seat_number: i + 1, player_id: 'b' + i })),
  ];
  assert.deepEqual(S.breakableTables(S.buildTables(cannot, 9), 9), []);
});

test('redraw distribui todos e sem lugar duplicado', () => {
  const ids = Array.from({ length: 14 }, (_, i) => 'p' + i);
  const a = S.redraw(ids, null, 9);
  assert.equal(a.length, 14);
  const keys = new Set(a.map((x) => `${x.table_number}-${x.seat_number}`));
  assert.equal(keys.size, 14);
});

// ─── Endpoints ─────────────────────────────────────────────────────────────
async function H(role = 'salao') {
  const { token } = await makeUser(role);
  return { Authorization: `Bearer ${token}` };
}

test('inscrição senta o jogador; eliminação libera o lugar', async () => {
  const h = await H();
  const t = await Tournament.create({ name: 'T', date: new Date(), status: 'running', seats_per_table: 9, buy_in: 100 });
  const players = await Promise.all(['A', 'B', 'C'].map((n) => Player.create({ name: n })));

  for (const p of players) {
    await request(app).post(`/api/tournaments/${t._id}/entries`).set(h).send({ type: 'buy-in', player_id: p._id });
  }
  let view = (await request(app).get(`/api/tournaments/${t._id}/seating`).set(h)).body;
  assert.equal(view.total_seated, 3);
  assert.equal(view.tables[0].count, 3);

  await request(app).post(`/api/tournaments/${t._id}/eliminations`).set(h).send({ player_id: players[2]._id });
  view = (await request(app).get(`/api/tournaments/${t._id}/seating`).set(h)).body;
  assert.equal(view.total_seated, 2);
});

test('12 inscritos com mesa de 9 abrem uma 2ª mesa; redraw reequilibra', async () => {
  const h = await H();
  const t = await Tournament.create({ name: 'T', date: new Date(), status: 'running', seats_per_table: 9, buy_in: 50 });
  const players = await Promise.all(Array.from({ length: 12 }, (_, i) => Player.create({ name: 'P' + i })));
  for (const p of players) {
    await request(app).post(`/api/tournaments/${t._id}/entries`).set(h).send({ type: 'buy-in', player_id: p._id });
  }
  let view = (await request(app).get(`/api/tournaments/${t._id}/seating`).set(h)).body;
  assert.equal(view.tables.length, 2);
  assert.equal(view.total_seated, 12);

  view = (await request(app).post(`/api/tournaments/${t._id}/seating/redraw`).set(h).send({ tables: 2 })).body;
  assert.equal(view.total_seated, 12);
  assert.deepEqual(view.tables.map((x) => x.count).sort(), [6, 6]);
});

test('CRUD de template de blinds', async () => {
  const h = await H();
  const rows = [{ row_type: 'level', level: 1, small_blind: 25, big_blind: 50, duration: 20 }];
  const created = await request(app).post('/api/blind-templates').set(h).send({ name: 'Turbo', rows });
  assert.equal(created.status, 201);
  const list = await request(app).get('/api/blind-templates').set(h);
  assert.equal(list.body.length, 1);
  await request(app).delete(`/api/blind-templates/${created.body._id}`).set(h);
  assert.equal((await request(app).get('/api/blind-templates').set(h)).body.length, 0);
});
