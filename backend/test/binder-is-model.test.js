// O Modelo de Fichário É o fichário: criar o modelo cria a sua única unidade, já montada; não há criação avulsa.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip } = require('./helpers');
const request = require('supertest');
const app = require('../app');
const { Binder } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

test('POST /binder-models cria o fichário único, montado com a composição; POST /binders é recusado', async () => {
  const H = { Authorization: `Bearer ${(await makeUser('admin')).token}` };
  const chip = await makeChip({ value: 100 });
  const r = await request(app).post('/api/binder-models').set(H).send({ name: 'Padrão', composition: [{ chip_id: chip._id, quantity: 50 }] });
  assert.equal(r.status, 201);
  const binders = await Binder.find({ model_id: r.body._id });
  assert.equal(binders.length, 1);
  assert.equal(binders[0].name, 'Padrão');
  const list = await request(app).get('/api/binders').set(H);
  const rows = list.body.data || list.body;
  assert.equal(rows[0].chips.find((c) => String(c.chip_id._id || c.chip_id) === String(chip._id)).quantity, 50);
  assert.equal((await request(app).post('/api/binders').set(H).send({ name: 'Avulso' })).status, 410);
});
