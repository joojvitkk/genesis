// G6 — migração 20260928000000-conversions: ChipRace (calculadora) → Conversion legacy (só histórico).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect } = require('./helpers');
const migration = require('../migrations/20260928000000-conversions');

before(connect);
after(async () => { await require('../models').Conversion.syncIndexes(); await disconnect(); });
beforeEach(clearDb);

const db = () => mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();

async function seed() {
  const [c25, c100, tId] = [oid(), oid(), oid()];
  await db().collection('chipmodels').insertMany([{ _id: c25, name: 'F25', value: 25 }, { _id: c100, name: 'F100', value: 100 }]);
  const created = new Date('2026-09-10T12:00:00Z');
  const races = await db().collection('chipraces').insertMany([
    { tournament_id: tId, type: 'color-up', active_tables: 3, num_players: 18, chips_per_player: 4, from_chip: c25, from_quantity: 72, to_chip: c100, to_quantity: 18, total_value: 1800, status: 'confirmed', createdAt: created, updatedAt: created },
    { tournament_id: tId, type: 'chip-race', active_tables: 2, num_players: 10, chips_per_player: 3, from_chip: c25, from_quantity: 30, to_chip: c100, to_quantity: 7.5, total_value: 750, status: 'cancelled', createdAt: created, updatedAt: created },
  ]);
  return { c25, c100, tId, ids: Object.values(races.insertedIds) };
}

test('cada ChipRace vira uma Conversion legacy, com valores e a data de origem', async () => {
  const { c25, c100, tId, ids } = await seed();
  await migration.up(db());

  const list = await db().collection('conversions').find({}).sort({ legacy_id: 1 }).toArray();
  assert.equal(list.length, 2);
  const a = list.find((x) => String(x.legacy_id) === String(ids[0]));
  assert.deepEqual([a.type, a.status, a.legacy, String(a.tournament_id)], ['COLOR_UP', 'active', true, String(tId)]);
  assert.deepEqual(a.outs.map((l) => [String(l.chip_id), l.quantity]), [[String(c25), 72]]);
  assert.deepEqual(a.ins.map((l) => [String(l.chip_id), l.quantity]), [[String(c100), 18]]);
  assert.deepEqual([a.value_out, a.value_in, a.math_breakage], [1800, 1800, 0]);
  assert.equal(a.movement_batch_id, null, 'sem movimentos: só histórico');
  assert.equal(a.createdAt.toISOString(), '2026-09-10T12:00:00.000Z');
  assert.deepEqual(a.legacy_meta, { active_tables: 3, num_players: 18, chips_per_player: 4 });
});

test('cancelada no modelo antigo vira "reversed"; quantidade fracionária do modelo antigo é preservada', async () => {
  const { ids } = await seed();
  await migration.up(db());
  const b = await db().collection('conversions').findOne({ legacy_id: ids[1] });
  assert.equal(b.type, 'CHIP_RACE');
  assert.equal(b.status, 'reversed');
  assert.match(b.reverse_reason, /Cancelado no modelo anterior/);
  assert.equal(b.ins[0].quantity, 7.5);
  assert.equal(b.value_in, 750);
});

test('a coleção chipraces não é tocada e nenhum movimento/saldo é criado', async () => {
  await seed();
  const before = JSON.stringify(await db().collection('chipraces').find({}).sort({ _id: 1 }).toArray());
  await migration.up(db());
  assert.equal(JSON.stringify(await db().collection('chipraces').find({}).sort({ _id: 1 }).toArray()), before);
  assert.equal(await db().collection('movements').countDocuments(), 0);
});

test('é idempotente; o índice impede duplicar; banco sem ChipRace não falha', async () => {
  await seed();
  await migration.up(db());
  await migration.up(db());
  assert.equal(await db().collection('conversions').countDocuments(), 2);
  const doc = await db().collection('conversions').findOne({});
  await assert.rejects(db().collection('conversions').insertOne({ ...doc, _id: oid() }), (e) => e.code === 11000);

  await clearDb();
  await migration.up(db());
  assert.equal(await db().collection('conversions').countDocuments(), 0);
});

test('down remove só as conversões legacy (as novas ficam)', async () => {
  await seed();
  await migration.up(db());
  await db().collection('conversions').insertOne({ tournament_id: oid(), type: 'COLOR_UP', legacy: false, outs: [], ins: [], status: 'active' });
  await migration.down(db());
  assert.equal(await db().collection('conversions').countDocuments({ legacy: true }), 0);
  assert.equal(await db().collection('conversions').countDocuments({ legacy: false }), 1);
});

test('as conversões migradas aparecem no GET /conversions e não alteram fichas em jogo', async () => {
  const { tId } = await seed();
  await migration.up(db());
  const { makeUser } = require('./helpers');
  const request = require('supertest');
  const app = require('../app');
  const { token } = await makeUser('salao');
  const res = await request(app).get(`/api/conversions?tournament_id=${tId}`).set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.ok(res.body.every((c) => c.legacy === true));
});
