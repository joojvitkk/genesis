// Simulação 2.1 §5/§7: torneio escolhe só o fichário (sem reserva); fichário arquivado; migração do estado das sessões.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');
const app = require('../app');
const migration = require('../migrations/20261006000000-session-state');

before(connect);
after(disconnect);
beforeEach(clearDb);

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);

test('vincular fichário não reserva nada e o mesmo fichário atende dois torneios', async () => {
  const h = await as();
  const chip = await makeChip({ value: 100 });
  const binder = await makeBinder('A', [{ chip, quantity: 100 }]);
  const t1 = (await post(h, '/api/tournaments', { name: 'T1', date: '2026-10-01' })).body;
  const t2 = (await post(h, '/api/tournaments', { name: 'T2', date: '2026-10-01' })).body;
  const a = await post(h, `/api/tournaments/${t1._id}/allocations`, { binder_id: binder._id, chips: [{ chip_id: chip._id, quantity: 1 }] });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.deepEqual(a.body.chips, [], 'quantidades são ignoradas');
  assert.equal((await post(h, `/api/tournaments/${t2._id}/allocations`, { binder_id: binder._id })).status, 201, 'sem bloqueio absoluto');
  assert.equal((await post(h, `/api/tournaments/${t1._id}/allocations`, { binder_id: binder._id })).status, 409, 'duplicado no mesmo torneio');
  assert.equal((await get(h, '/api/allocations/matrix')).status, 404, 'matriz de reserva não existe mais');
});

test('arquivar: bloqueado enquanto vinculado a torneio aberto; arquivado não pode ser vinculado', async () => {
  const h = await as();
  const binder = await makeBinder('A', []);
  const t = (await post(h, '/api/tournaments', { name: 'T', date: '2026-10-01' })).body;
  await post(h, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id });
  assert.equal((await post(h, `/api/binders/${binder._id}/archive`, {})).status, 409);
  const link = (await get(h, `/api/allocations?tournament_id=${t._id}`)).body[0];
  await request(app).delete(`/api/allocations/${link._id}`).set(h);
  assert.equal((await post(h, `/api/binders/${binder._id}/archive`, {})).status, 200);
  const t2 = (await post(h, '/api/tournaments', { name: 'T2', date: '2026-10-01' })).body;
  assert.equal((await post(h, `/api/tournaments/${t2._id}/allocations`, { binder_id: binder._id })).status, 409);
  assert.equal((await post(h, '/api/dashboard/stats', {})).status, 404);
  assert.equal((await get(h, '/api/dashboard/stats?blocks=free_binders')).body.free_binders.length, 0, 'arquivado não é "livre"');
});

test('migração: estado do torneio vai para as sessões (ativos só na primeira aberta; "Final" vira FINAL)', async () => {
  const db = mongoose.connection.db;
  const tid = new mongoose.Types.ObjectId(); const s1 = new mongoose.Types.ObjectId(); const s2 = new mongoose.Types.ObjectId();
  await db.collection('tournaments').insertOne({ _id: tid, name: 'W', date: new Date(), clock_status: 'running', current_level: 3, active_offset: 2, deleted_at: null });
  await db.collection('tournamentsessions').insertMany([
    { _id: s1, tournament_id: tid, name: 'Dia 1A', order: 1, status: 'running', deleted_at: null },
    { _id: s2, tournament_id: tid, name: 'Dia Final', order: 2, status: 'scheduled', deleted_at: null },
  ]);
  await migration.up(db);
  const [a, f] = await Promise.all([db.collection('tournamentsessions').findOne({ _id: s1 }), db.collection('tournamentsessions').findOne({ _id: s2 })]);
  assert.deepEqual([a.type, a.clock_status, a.current_level, a.active_offset], ['QUALIFIER', 'running', 3, 2]);
  assert.deepEqual([f.type, f.clock_status, f.active_offset], ['FINAL', 'stopped', 0]);
  await migration.up(db); // idempotente
  assert.equal((await db.collection('tournamentsessions').findOne({ _id: s1 })).current_level, 3);
});
