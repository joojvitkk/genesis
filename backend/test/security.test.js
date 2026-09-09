const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { User } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

async function login(email, password) {
  const r = await request(app).post('/api/login').send({ email, password });
  return r;
}

test('usuário criado por admin precisa trocar a senha', async () => {
  await User.create({ name: 'Admin', email: 'a@t.com', password: 'admin123', role: 'admin' });
  const adminTok = (await login('a@t.com', 'admin123')).body.token;

  const created = await request(app).post('/api/users').set('Authorization', `Bearer ${adminTok}`)
    .send({ name: 'Op', email: 'op@t.com', password: 'secret1', role: 'salao' });
  assert.equal(created.status, 201);

  const opLogin = await login('op@t.com', 'secret1');
  assert.equal(opLogin.status, 200);
  assert.equal(opLogin.body.user.must_change_password, true);
});

test('logout-all revoga o token anterior', async () => {
  await User.create({ name: 'A', email: 'a@t.com', password: 'admin123', role: 'admin' });
  const token = (await login('a@t.com', 'admin123')).body.token;

  // token funciona
  assert.equal((await request(app).get('/api/me').set('Authorization', `Bearer ${token}`)).status, 200);

  // encerra todas as sessões
  await request(app).post('/api/me/logout-all').set('Authorization', `Bearer ${token}`);

  // aguarda o cache de session_version expirar não é necessário: bumpSessionVersion limpa
  const after = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
  assert.equal(after.status, 401);
});

test('troca de senha: senha atual errada → 401; certa → novo token e flag limpa', async () => {
  const u = await User.create({ name: 'A', email: 'a@t.com', password: 'oldpass1', role: 'salao', must_change_password: true });
  const token = (await login('a@t.com', 'oldpass1')).body.token;

  const bad = await request(app).post('/api/me/password').set('Authorization', `Bearer ${token}`)
    .send({ current_password: 'wrong', new_password: 'newpass1' });
  assert.equal(bad.status, 401);

  const ok = await request(app).post('/api/me/password').set('Authorization', `Bearer ${token}`)
    .send({ current_password: 'oldpass1', new_password: 'newpass1' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);

  const relog = await login('a@t.com', 'newpass1');
  assert.equal(relog.body.user.must_change_password, false);
  // token antigo foi revogado pela troca
  assert.equal((await request(app).get('/api/me').set('Authorization', `Bearer ${token}`)).status, 401);
});

test('admin reseta senha → senha temporária funciona e exige troca', async () => {
  await User.create({ name: 'Admin', email: 'a@t.com', password: 'admin123', role: 'admin' });
  const target = await User.create({ name: 'Op', email: 'op@t.com', password: 'secret1', role: 'salao' });
  const adminTok = (await login('a@t.com', 'admin123')).body.token;

  const reset = await request(app).post(`/api/users/${target._id}/reset-password`).set('Authorization', `Bearer ${adminTok}`);
  assert.equal(reset.status, 200);
  assert.ok(reset.body.temporary_password);

  const rl = await login('op@t.com', reset.body.temporary_password);
  assert.equal(rl.status, 200);
  assert.equal(rl.body.user.must_change_password, true);

  // senha antiga não funciona mais
  assert.equal((await login('op@t.com', 'secret1')).status, 401);
});
