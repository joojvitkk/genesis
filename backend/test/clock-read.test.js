const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');
const app = require('../app');
const { Tournament } = require('../models');

before(connect); after(disconnect); beforeEach(clearDb);

test('GET /tournaments/:id/clock devolve o estado atual (parado mostra a duração cheia do nível, não 00:00)', async () => {
  const H = { Authorization: `Bearer ${(await makeUser('material')).token}` };
  const t = await Tournament.create({ name: 'T', date: new Date(), blind_structure: [{ row_type: 'level', level: 1, small_blind: 100, big_blind: 200, duration: 30 }] });
  const r = await request(app).get(`/api/tournaments/${t._id}/clock`).set(H);
  assert.equal(r.status, 200);
  assert.equal(r.body.clock_status, 'stopped');
  assert.equal(r.body.remaining_ms, 30 * 60_000);
  assert.equal(r.body.level_number, 1);
  assert.equal((await request(app).get('/api/tournaments/64b000000000000000000000/clock').set(H)).status, 404);
  assert.equal((await request(app).get(`/api/tournaments/${t._id}/clock`)).status, 401);
});

test('relógio parado mostra a duração do nível mesmo com level_started_at antigo; rodando desconta o tempo', () => {
  const { remainingMs } = require('../lib/tournamentClock');
  const rows = [{ row_type: 'level', level: 1, duration: 30 }];
  const old = new Date(Date.now() - 6 * 3600_000);
  assert.equal(remainingMs({ blind_structure: rows, current_level: 0, clock_status: 'stopped', level_started_at: old }), 30 * 60_000);
  const r = remainingMs({ blind_structure: rows, current_level: 0, clock_status: 'running', level_started_at: new Date(Date.now() - 60_000) });
  assert.ok(r < 30 * 60_000 && r > 28 * 60_000);
});
