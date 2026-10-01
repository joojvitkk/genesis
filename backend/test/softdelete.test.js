const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Tournament, TournamentEntry, Chip } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

test('DELETE torneio: soft-delete; entradas e movimentos PERMANECEM como histórico (G11, spec §18.3)', async () => {
  const { token } = await makeUser('admin');
  const t = await Tournament.create({ name: 'Histórico', date: new Date() });
  await TournamentEntry.create({ tournament_id: t._id, type: 'buy-in' });
  await TournamentEntry.create({ tournament_id: t._id, type: 're-entry' });

  const res = await request(app).delete(`/api/tournaments/${t._id}`).set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);

  // some das listagens
  const list = await request(app).get('/api/tournaments').set('Authorization', `Bearer ${token}`);
  assert.equal(list.body.find((x) => x._id === String(t._id)), undefined);

  // mas continua no banco com deleted_at
  const raw = await Tournament.findById(t._id).setOptions({ withDeleted: true });
  assert.ok(raw.deleted_at instanceof Date);

  // as entradas NÃO são apagadas
  assert.equal(await TournamentEntry.countDocuments({ tournament_id: t._id }), 2);
});

test('listagem de fichas exclui as soft-deleted', async () => {
  const { token } = await makeUser('material');
  const a = await Chip.create({ value: 25, color: '#111111' });
  await Chip.create({ value: 50, color: '#222222' });

  await Chip.softDeleteById(a._id);

  const list = await request(app).get('/api/chips').set('Authorization', `Bearer ${token}`);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].value, 50);
});

test('paginação: ?page devolve envelope { data, pagination }', async () => {
  const { token } = await makeUser('material');
  for (let i = 0; i < 5; i++) await Chip.create({ value: i + 1, color: '#333333' });

  const res = await request(app).get('/api/chips?page=1&limit=2').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.pagination.total, 5);
  assert.equal(res.body.pagination.pages, 3);
  assert.equal(res.headers['x-total-count'], '5');
});
