const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { ChipModel } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

test('inventory/update rejeita movimentação que deixaria estoque negativo', async () => {
  const { token } = await makeUser('material');
  const chip = await ChipModel.create({ name: 'F25', value: 25, total_quantity: 100, available_quantity: 100 });

  const bad = await request(app)
    .post('/api/inventory/update')
    .set('Authorization', `Bearer ${token}`)
    .send({ chip_id: chip._id, quantity_change: -150 });
  assert.equal(bad.status, 400);

  const fresh = await ChipModel.findById(chip._id);
  assert.equal(fresh.total_quantity, 100, 'estoque não deve ter mudado');
});

test('inventory/update aplica entrada e saída válidas', async () => {
  const { token } = await makeUser('material');
  const chip = await ChipModel.create({ name: 'F25', value: 25, total_quantity: 100, available_quantity: 100 });

  await request(app).post('/api/inventory/update').set('Authorization', `Bearer ${token}`)
    .send({ chip_id: chip._id, quantity_change: 50 });
  await request(app).post('/api/inventory/update').set('Authorization', `Bearer ${token}`)
    .send({ chip_id: chip._id, quantity_change: -30 });

  const fresh = await ChipModel.findById(chip._id);
  assert.equal(fresh.total_quantity, 120);
  assert.equal(fresh.available_quantity, 120);
});

test('POST /api/chip-races calcula quantidades no servidor', async () => {
  const { token } = await makeUser('salao');
  const from = await ChipModel.create({ name: 'F25', value: 25, total_quantity: 500 });
  const to = await ChipModel.create({ name: 'F100', value: 100, total_quantity: 500 });
  const { Tournament } = require('../models');
  const t = await Tournament.create({ name: 'T', date: new Date() });

  const res = await request(app)
    .post('/api/chip-races')
    .set('Authorization', `Bearer ${token}`)
    .send({
      tournament_id: t._id, type: 'color-up', active_tables: 2,
      num_players: 18, chips_per_player: 4, from_chip: from._id, to_chip: to._id,
      // valores falsificados pelo cliente devem ser ignorados
      from_quantity: 999999, to_quantity: 999999, total_value: 999999,
    });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.from_quantity, 72);       // 18 * 4
  assert.equal(res.body.total_value, 72 * 25);    // 1800
  assert.equal(res.body.to_quantity, 1800 / 100); // 18
});
