const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Tournament } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

test('GET /api/users: salão recebe 403, admin recebe 200', async () => {
  const salao = await makeUser('salao');
  const admin = await makeUser('admin');

  const denied = await request(app).get('/api/users').set('Authorization', `Bearer ${salao.token}`);
  assert.equal(denied.status, 403);

  const ok = await request(app).get('/api/users').set('Authorization', `Bearer ${admin.token}`);
  assert.equal(ok.status, 200);
});

test('sem token: 401', async () => {
  const res = await request(app).get('/api/users');
  assert.equal(res.status, 401);
});

test('POST /api/tournaments ignora campos fora da whitelist', async () => {
  const { token } = await makeUser('salao');
  const created = await request(app)
    .post('/api/tournaments')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Etapa 1', date: '2026-10-01', hacker: 'x', deleted_at: '2000-01-01', __proto__: {} });

  assert.equal(created.status, 201);
  assert.equal(created.body.hacker, undefined);

  const inDb = await Tournament.findById(created.body._id);
  assert.equal(inDb.deleted_at, null, 'deleted_at não pode ser setado pelo cliente');
});

test('material não pode acessar /api/usuarios mas pode /api/relatorios', async () => {
  const { token } = await makeUser('material');
  const u = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
  assert.equal(u.status, 403);
  const r = await request(app).get('/api/reports/data').set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 200);
});
