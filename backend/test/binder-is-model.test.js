// MEL-01 (relatório fase 1): não há "modelo de fichário". O fichário é uma unidade física única; a composição
// informada no cadastro vira o saldo inicial (UM lançamento no livro-razão) e depois o saldo só muda por movimentação.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip } = require('./helpers');
const request = require('supertest');
const app = require('../app');
const { Movement } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

const H = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });

test('cadastrar o fichário com 10 fichas de 100 → saldo 10 e UM lote inicial; consultar de novo não cria movimento', async () => {
  const admin = await H();
  const chip = await makeChip({ value: 100 });
  const r = await request(app).post('/api/binders').set(admin).send({ name: 'Drogon', code: 'D1', stamp: 'Dragão', composition: [{ chip_id: chip._id, quantity: 10 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.stamp, 'Dragão');
  assert.equal(r.body.chips.find((c) => String(c.chip_id._id || c.chip_id) === String(chip._id)).quantity, 10);

  const moves = await Movement.find({});
  assert.equal(moves.length, 1);
  assert.equal(moves[0].type, 'ASSEMBLY');
  assert.equal(moves[0].quantity, 10);

  await request(app).get('/api/binders').set(admin);
  await request(app).get('/api/binders').set(admin);
  assert.equal(await Movement.countDocuments({}), 1, 'consultar não gera movimentação física');
});

test('saída de 4 → 6; retorno de 2 → 8 (explicável no livro-razão)', async () => {
  const admin = await H();
  const chip = await makeChip({ value: 100 });
  const b = (await request(app).post('/api/binders').set(admin).send({ name: 'Shenlong', composition: [{ chip_id: chip._id, quantity: 10 }] })).body;
  const mv = require('../lib/movements');
  const bid = new (require('mongoose').Types.ObjectId)(b._id);
  await mv.postBatch([{ type: 'WITHDRAWAL', chip_id: chip._id, quantity: 4, from: { kind: 'binder', id: b._id }, to: { kind: 'external' }, reason: 'saída' }], { user: { name: 'T' } });
  assert.equal(await mv.balanceAt({ kind: 'binder', id: bid }, chip._id), 6);
  await mv.postBatch([{ type: 'ADJUSTMENT', chip_id: chip._id, quantity: 2, from: { kind: 'external' }, to: { kind: 'binder', id: b._id }, reason: 'retorno' }], { user: { name: 'T' } });
  assert.equal(await mv.balanceAt({ kind: 'binder', id: bid }, chip._id), 8);
});

test('a composição não é editável depois do cadastro; sem modelo de fichário (rotas removidas)', async () => {
  const admin = await H();
  const chip = await makeChip({ value: 100 });
  const b = (await request(app).post('/api/binders').set(admin).send({ name: 'Drogon', composition: [{ chip_id: chip._id, quantity: 10 }] })).body;
  assert.equal((await request(app).put(`/api/binders/${b._id}`).set(admin).send({ composition: [{ chip_id: chip._id, quantity: 99 }] })).status, 400);
  assert.equal((await request(app).put(`/api/binders/${b._id}`).set(admin).send({ stamp: 'Nova' })).status, 200);
  assert.equal((await request(app).get('/api/binder-models').set(admin)).status, 404);
  assert.equal((await request(app).post('/api/binder-models').set(admin).send({ name: 'M' })).status, 404);
});

test('composição inválida não deixa fichário pela metade; só admin cadastra', async () => {
  const admin = await H();
  const chip = await makeChip({ value: 100 });
  const bad = await request(app).post('/api/binders').set(admin).send({ name: 'X', composition: [{ chip_id: chip._id, quantity: -3 }] });
  assert.equal(bad.status, 400);
  assert.equal((await request(app).get('/api/binders').set(admin)).body.length ?? 0, 0);
  assert.equal((await request(app).post('/api/binders').set(await H('material')).send({ name: 'Y' })).status, 403);
});

test('conciliação por denominação: inicial 10, saída 4, retorno 2 → saldo 8, tudo explicado', async () => {
  const admin = await H();
  const chip = await makeChip({ value: 100 });
  const b = (await request(app).post('/api/binders').set(admin).send({ name: 'Drogon', composition: [{ chip_id: chip._id, quantity: 10 }] })).body;
  const mv = require('../lib/movements');
  const bid = new (require('mongoose').Types.ObjectId)(b._id);
  await mv.postBatch([{ type: 'WITHDRAWAL', chip_id: chip._id, quantity: 4, from: { kind: 'binder', id: bid }, to: { kind: 'external' }, reason: 'saída' }], { user: { name: 'T' } });
  await mv.postBatch([{ type: 'ADJUSTMENT', chip_id: chip._id, quantity: 2, from: { kind: 'external' }, to: { kind: 'binder', id: bid }, reason: 'retorno' }], { user: { name: 'T' } });
  const r = (await request(app).get(`/api/binders/${b._id}/reconciliation`).set(admin)).body;
  const row = r.rows[0];
  assert.deepEqual([row.opening, row.total_in, row.total_out, row.balance, row.explained, row.free], [10, 2, 4, 8, true, 8]);
  assert.equal(r.explained, true);
});
