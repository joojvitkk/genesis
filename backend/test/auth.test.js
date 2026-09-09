const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { User } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

test('POST /api/login com credenciais válidas retorna token', async () => {
  await User.create({ name: 'A', email: 'admin@test.com', password: 'admin123', role: 'admin' });
  const res = await request(app).post('/api/login').send({ email: 'ADMIN@test.com', password: 'admin123' });
  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.user.role, 'admin');
});

test('POST /api/login com senha errada retorna 401 genérico', async () => {
  await User.create({ name: 'A', email: 'a@test.com', password: 'admin123', role: 'admin' });
  const res = await request(app).post('/api/login').send({ email: 'a@test.com', password: 'nope' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Credenciais inválidas.');
});

test('login não vaza o hash da senha', async () => {
  await User.create({ name: 'A', email: 'b@test.com', password: 'admin123', role: 'admin' });
  const res = await request(app).post('/api/login').send({ email: 'b@test.com', password: 'admin123' });
  assert.equal(res.body.user.password, undefined);
});

test('rate limit bloqueia após 20 falhas do mesmo ip+email', async () => {
  await User.create({ name: 'A', email: 'rl@test.com', password: 'admin123', role: 'admin' });
  for (let i = 0; i < 20; i++) {
    const r = await request(app).post('/api/login').send({ email: 'rl@test.com', password: 'x' });
    assert.equal(r.status, 401);
  }
  const blocked = await request(app).post('/api/login').send({ email: 'rl@test.com', password: 'x' });
  assert.equal(blocked.status, 429);
  // acerto de outro e-mail continua funcionando
  const ok = await request(app).post('/api/login').send({ email: 'rl@test.com', password: 'admin123' });
  assert.equal(ok.status, 429, 'e-mail bloqueado permanece bloqueado mesmo com senha certa');
});

test('GET /api/me exige token e devolve o usuário', async () => {
  const { token } = await makeUser('material');
  const noToken = await request(app).get('/api/me');
  assert.equal(noToken.status, 401);
  const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.role, 'material');
});

test('token inválido retorna 401', async () => {
  const res = await request(app).get('/api/me').set('Authorization', 'Bearer garbage');
  assert.equal(res.status, 401);
});
