const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { ChipModel, ChipCase, Tournament, InventoryLedger } = require('../models');
const { recalcChip } = require('../lib/inventoryLedger');

before(connect);
after(disconnect);
beforeEach(clearDb);

async function H(role = 'material') {
  const { token } = await makeUser(role);
  return { Authorization: `Bearer ${token}` };
}

test('criar ficha com quantidade inicial gera lançamento e saldo derivado', async () => {
  const h = await H();
  const res = await request(app).post('/api/chips').set(h)
    .send({ name: 'F25', value: 25, total_quantity: 1000 });
  assert.equal(res.status, 201);
  assert.equal(res.body.total_quantity, 1000);
  assert.equal(res.body.available_quantity, 1000);

  const ledger = await InventoryLedger.find({ chip_id: res.body._id });
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].type, 'saldo_inicial');
});

test('entrada e saída via /inventory/update movem o saldo pelo ledger', async () => {
  const h = await H();
  const { body: chip } = await request(app).post('/api/chips').set(h).send({ name: 'F', value: 5, total_quantity: 100 });

  await request(app).post('/api/inventory/update').set(h).send({ chip_id: chip._id, quantity_change: 50 });
  await request(app).post('/api/inventory/update').set(h).send({ chip_id: chip._id, quantity_change: -30 });

  const fresh = await ChipModel.findById(chip._id);
  assert.equal(fresh.total_quantity, 120);
  assert.equal(fresh.available_quantity, 120);

  const bad = await request(app).post('/api/inventory/update').set(h).send({ chip_id: chip._id, quantity_change: -999 });
  assert.equal(bad.status, 400);
});

test('quebra reduz o total e aparece no ledger', async () => {
  const h = await H();
  const { body: chip } = await request(app).post('/api/chips').set(h).send({ name: 'F', value: 5, total_quantity: 100 });
  const res = await request(app).post('/api/inventory/breakage').set(h).send({ chip_id: chip._id, quantity: 12, note: 'caiu no chão' });
  assert.equal(res.status, 200);
  assert.equal(res.body.chip.total_quantity, 88);

  const q = await InventoryLedger.findOne({ chip_id: chip._id, type: 'quebra' });
  assert.equal(q.quantity, -12);
});

test('alocar fichário a torneio reserva as fichas; finalizar devolve', async () => {
  const hMat = await H('material');
  const hSalao = await H('salao');
  const { body: chip } = await request(app).post('/api/chips').set(hMat).send({ name: 'F25', value: 25, total_quantity: 1000 });

  const kase = await ChipCase.create({ name: 'Maleta A', chips: [{ chip_id: chip._id, quantity: 400 }] });
  const t = await Tournament.create({ name: 'Etapa', date: new Date(), status: 'scheduled', allocated_cases: [kase._id] });

  // inicia -> reserva 400
  await request(app).put(`/api/tournaments/${t._id}`).set(hSalao).send({ status: 'running' });
  let fresh = await ChipModel.findById(chip._id);
  assert.equal(fresh.total_quantity, 1000);
  assert.equal(fresh.reserved_quantity, 400);
  assert.equal(fresh.available_quantity, 600);

  // finaliza -> devolve
  await request(app).put(`/api/tournaments/${t._id}`).set(hSalao).send({ status: 'finished' });
  fresh = await ChipModel.findById(chip._id);
  assert.equal(fresh.reserved_quantity, 0);
  assert.equal(fresh.available_quantity, 1000);
});

test('conferência de fichário ajusta conteúdo e lança a diferença', async () => {
  const h = await H('material');
  const { body: chip } = await request(app).post('/api/chips').set(h).send({ name: 'F', value: 5, total_quantity: 500 });
  const kase = await ChipCase.create({ name: 'Maleta B', chips: [{ chip_id: chip._id, quantity: 200 }] });

  const res = await request(app).post(`/api/cases/${kase._id}/count`).set(h)
    .send({ counts: [{ chip_id: chip._id, counted: 188 }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.diffs[0].diff, -12);

  const fresh = await ChipModel.findById(chip._id);
  assert.equal(fresh.total_quantity, 488); // 500 - 12

  const updatedCase = await ChipCase.findById(kase._id);
  assert.equal(updatedCase.chips[0].quantity, 188);
});

test('conferência durante alocação: retorno devolve exatamente o alocado', async () => {
  const hMat = await H('material');
  const hSalao = await H('salao');
  const { body: chip } = await request(app).post('/api/chips').set(hMat).send({ name: 'F', value: 25, total_quantity: 1000 });
  const kase = await ChipCase.create({ name: 'M', chips: [{ chip_id: chip._id, quantity: 400 }] });
  const t = await Tournament.create({ name: 'T', date: new Date(), status: 'scheduled', allocated_cases: [kase._id] });

  await request(app).put(`/api/tournaments/${t._id}`).set(hSalao).send({ status: 'running' });
  // conferência reduz a maleta para 390 enquanto está alocada
  await request(app).post(`/api/cases/${kase._id}/count`).set(hMat).send({ counts: [{ chip_id: chip._id, counted: 390 }] });
  await request(app).put(`/api/tournaments/${t._id}`).set(hSalao).send({ status: 'finished' });

  const fresh = await ChipModel.findById(chip._id);
  assert.equal(fresh.reserved_quantity, 0, 'nada deve ficar reservado');
  assert.equal(fresh.total_quantity, 990, '1000 - 10 (perda na conferência)');
  assert.equal(fresh.available_quantity, 990);
});

test('recalcChip é idempotente', async () => {
  const h = await H();
  const { body: chip } = await request(app).post('/api/chips').set(h).send({ name: 'F', value: 5, total_quantity: 300 });
  const a = await recalcChip(chip._id);
  const b = await recalcChip(chip._id);
  assert.deepEqual(a, b);
  assert.equal(a.total, 300);
});

test('GET /inventory/ledger pagina e filtra por ficha', async () => {
  const h = await H();
  const { body: c1 } = await request(app).post('/api/chips').set(h).send({ name: 'A', value: 5, total_quantity: 100 });
  const { body: c2 } = await request(app).post('/api/chips').set(h).send({ name: 'B', value: 10, total_quantity: 100 });
  await request(app).post('/api/inventory/update').set(h).send({ chip_id: c1._id, quantity_change: 10 });

  const all = await request(app).get('/api/inventory/ledger').set(h);
  assert.equal(all.body.length, 3);

  const onlyC1 = await request(app).get(`/api/inventory/ledger?chip_id=${c1._id}`).set(h);
  assert.equal(onlyC1.body.length, 2);
});
