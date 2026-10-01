const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { computeStartsAt } = require('../lib/datetime');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');
const request = require('supertest');
const app = require('../app');
const { Tournament } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

test('computeStartsAt combina data + hora no fuso de São Paulo', () => {
  // 01/out/2026 20:00 em São Paulo (UTC-3, sem horário de verão) → 23:00 UTC
  const instant = computeStartsAt(new Date('2026-10-01T00:00:00Z'), '20:00', 'America/Sao_Paulo');
  assert.equal(instant.toISOString(), '2026-10-01T23:00:00.000Z');
});

test('computeStartsAt usa 00:00 quando não há horário', () => {
  const instant = computeStartsAt(new Date('2026-06-15T00:00:00Z'), '', 'America/Sao_Paulo');
  assert.equal(instant.toISOString(), '2026-06-15T03:00:00.000Z');
});

test('POST /tournaments deriva starts_at', async () => {
  const { token } = await makeUser('admin');
  const res = await request(app).post('/api/tournaments').set('Authorization', `Bearer ${token}`)
    .send({ name: 'X', date: '2026-10-01', start_time: '20:00', timezone: 'America/Sao_Paulo' });
  assert.equal(res.status, 201);
  assert.equal(new Date(res.body.starts_at).toISOString(), '2026-10-01T23:00:00.000Z');
});

test('trava otimista: blind_version desatualizado → 409', async () => {
  const { token } = await makeUser('admin');
  const H = { Authorization: `Bearer ${token}` };
  const t = await Tournament.create({ name: 'X', date: new Date() });

  // 1ª edição ok (sem versão enviada)
  let r = await request(app).put(`/api/tournaments/${t._id}`).set(H)
    .send({ blind_structure: [{ row_type: 'level', level: 1, small_blind: 25, big_blind: 50, duration: 20 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.tournament.blind_version, 1);

  // edição com versão certa
  r = await request(app).put(`/api/tournaments/${t._id}`).set(H)
    .send({ blind_version: 1, blind_structure: [{ row_type: 'level', level: 1, small_blind: 50, big_blind: 100, duration: 20 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.tournament.blind_version, 2);

  // edição com versão velha → 409
  r = await request(app).put(`/api/tournaments/${t._id}`).set(H)
    .send({ blind_version: 1, blind_structure: [] });
  assert.equal(r.status, 409);
  assert.equal(r.body.blind_version, 2);
});
