// Migrações do modo enxuto: Dia Único e eliminação sem entrada (idempotentes, seguras para dados existentes).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect } = require('./helpers');
const diaUnico = require('../migrations/20261126000000-dia-unico');
const eliminacao = require('../migrations/20261126000001-eliminacao-sem-entrada');

before(connect);
after(async () => { await require('../models').Elimination.syncIndexes(); await disconnect(); });
beforeEach(clearDb);

const db = () => mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();

test('Dia Único: torneio de uma só sessão classificatória vira Dia Único; os demais ficam como estão; rodar de novo não muda nada', async () => {
  const [solo, multi, finalOnly] = [oid(), oid(), oid()];
  await db().collection('tournamentsessions').insertMany([
    { tournament_id: solo, name: 'Dia Único', type: 'QUALIFIER', deleted_at: null },
    { tournament_id: multi, name: 'Dia 1A', type: 'QUALIFIER', deleted_at: null },
    { tournament_id: multi, name: 'Dia 1B', type: 'QUALIFIER', deleted_at: null },
    { tournament_id: finalOnly, name: 'Dia Final', type: 'FINAL', deleted_at: null },
    { tournament_id: solo, name: 'Apagada', type: 'QUALIFIER', deleted_at: new Date() },
  ]);
  await diaUnico.up(db()); await diaUnico.up(db());
  const types = async (t) => (await db().collection('tournamentsessions').find({ tournament_id: t, deleted_at: null }).toArray()).map((s) => s.type);
  assert.deepEqual(await types(solo), ['SINGLE']);
  assert.deepEqual(await types(multi), ['QUALIFIER', 'QUALIFIER']);
  assert.deepEqual(await types(finalOnly), ['FINAL']);
});

test('eliminação sem entrada: novo índice aceita várias eliminações sem entry_id; prize_awarded é removido', async () => {
  const t = oid();
  await db().collection('eliminations').insertOne({ tournament_id: t, entry_id: oid(), position: 3, status: 'active', prize_awarded: 50 });
  await eliminacao.up(db()); await eliminacao.up(db());
  const idx = (await db().collection('eliminations').indexes()).map((i) => i.name);
  assert.ok(idx.includes('elimination_entry_active_once_v2'));
  assert.ok(!idx.includes('elimination_entry_active_once'));
  assert.equal((await db().collection('eliminations').find({ prize_awarded: { $exists: true } }).toArray()).length, 0);
  await db().collection('eliminations').insertMany([
    { tournament_id: t, entry_id: null, position: 5, status: 'active' }, { tournament_id: t, entry_id: null, position: 4, status: 'active' },
  ]);
  const same = oid();
  await db().collection('eliminations').insertOne({ tournament_id: t, entry_id: same, position: 2, status: 'active' });
  await assert.rejects(db().collection('eliminations').insertOne({ tournament_id: t, entry_id: same, position: 1, status: 'active' }), /duplicate key/);
});
