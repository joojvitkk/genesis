// Foto de perfil: cada usuário troca a PRÓPRIA; formato e tamanho validados; aparece em /me, no login e na lista de usuários.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');
const app = require('../app');
const { User } = require('../models');

before(connect); after(disconnect); beforeEach(clearDb);

// PNG 1×1 válido
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const as = async (role) => { const u = await makeUser(role); return { h: { Authorization: `Bearer ${u.token}` }, user: u.user }; };

test('o usuário define, lê e remove a própria foto', async () => {
  const { h, user } = await as('salao');
  const put = await request(app).put('/api/me/avatar').set(h).send({ image: PNG });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal((await request(app).get('/api/me').set(h)).body.avatar, PNG);
  assert.equal((await User.findById(user._id)).avatar, PNG);

  const del = await request(app).delete('/api/me/avatar').set(h);
  assert.equal(del.status, 200);
  assert.equal((await request(app).get('/api/me').set(h)).body.avatar, null);
});

test('um usuário não altera a foto de outro; a lista de usuários traz as fotos (admin)', async () => {
  const a = await as('salao'); const b = await as('material'); const adm = await as('admin');
  await request(app).put('/api/me/avatar').set(a.h).send({ image: PNG });
  assert.equal((await request(app).get('/api/me').set(b.h)).body.avatar, null, 'foto de A não vaza para B');
  const list = (await request(app).get('/api/users').set(adm.h)).body;
  assert.equal(list.find((u) => String(u._id) === String(a.user._id)).avatar, PNG);
});

test('valida formato, base64 e tamanho; exige login', async () => {
  const { h } = await as('salao');
  const put = (image) => request(app).put('/api/me/avatar').set(h).send({ image });
  assert.equal((await put('texto qualquer')).status, 400);
  assert.equal((await put('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).status, 400, 'SVG pode carregar script: recusado');
  assert.equal((await put('data:text/html;base64,PGgxPg==')).status, 400);
  assert.equal((await put('data:image/png;base64,@@@')).status, 400);
  assert.equal((await put(`data:image/jpeg;base64,${'A'.repeat(160_000)}`)).status, 413);
  assert.equal((await request(app).put('/api/me/avatar').send({ image: PNG })).status, 401);
});

test('GET /chat/avatars devolve só quem tem foto, indexado por e-mail, para qualquer usuário logado', async () => {
  const a = await as('salao'); const b = await as('material');
  await request(app).put('/api/me/avatar').set(a.h).send({ image: PNG });
  const r = await request(app).get('/api/chat/avatars').set(b.h);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), [a.user.email]);
  assert.equal(r.body[a.user.email], PNG);
  assert.equal((await request(app).get('/api/chat/avatars')).status, 401);
});
