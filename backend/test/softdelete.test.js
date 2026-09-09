const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Tournament, TournamentEntry, ChipRace, ChipModel } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

test('DELETE torneio: soft-delete + cascata em entradas e chip races', async () => {
  const { token } = await makeUser('salao');
  const t = await Tournament.create({ name: 'Cascata', date: new Date() });
  await TournamentEntry.create({ tournament_id: t._id, type: 'buy-in' });
  await TournamentEntry.create({ tournament_id: t._id, type: 're-entry' });
  const chip = await ChipModel.create({ name: 'F', value: 5, total_quantity: 10 });
  await ChipRace.create({
    tournament_id: t._id, type: 'chip-race', active_tables: 1,
    from_chip: chip._id, from_quantity: 10, to_chip: chip._id, to_quantity: 2, total_value: 10,
  });

  const res = await request(app).delete(`/api/tournaments/${t._id}`).set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);

  // some das listagens
  const list = await request(app).get('/api/tournaments').set('Authorization', `Bearer ${token}`);
  assert.equal(list.body.find((x) => x._id === String(t._id)), undefined);

  // mas continua no banco com deleted_at
  const raw = await Tournament.findById(t._id).setOptions({ withDeleted: true });
  assert.ok(raw.deleted_at instanceof Date);

  // entradas removidas
  assert.equal(await TournamentEntry.countDocuments({ tournament_id: t._id }), 0);

  // chip race arquivada
  const race = await ChipRace.findOne({ tournament_id: t._id });
  assert.equal(race.status, 'cancelled');
});

test('listagem de fichas exclui as soft-deleted', async () => {
  const { token } = await makeUser('material');
  const a = await ChipModel.create({ name: 'Viva', value: 25, total_quantity: 100 });
  await ChipModel.create({ name: 'Morta', value: 50, total_quantity: 100 });

  await request(app).delete(`/api/chips/${a._id}`).set('Authorization', `Bearer ${token}`);

  const list = await request(app).get('/api/chips').set('Authorization', `Bearer ${token}`);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].name, 'Morta');
});

test('paginação: ?page devolve envelope { data, pagination }', async () => {
  const { token } = await makeUser('material');
  for (let i = 0; i < 5; i++) await ChipModel.create({ name: `F${i}`, value: i + 1, total_quantity: 10 });

  const res = await request(app).get('/api/chips?page=1&limit=2').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.pagination.total, 5);
  assert.equal(res.body.pagination.pages, 3);
  assert.equal(res.headers['x-total-count'], '5');
});
