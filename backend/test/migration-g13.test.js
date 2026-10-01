// Migração 20261003000000-remove-ko-and-chip-kind: sem tipo de ficha (nem KO); índice (valor, cor).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect } = require('./helpers');
const migration = require('../migrations/20261003000000-remove-ko-and-chip-kind');

before(connect);
after(disconnect);
beforeEach(clearDb);
const db = () => mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();

async function seed() {
  try { await db().collection('chipmodels').dropIndex('chip_value_color_active'); } catch { /* ainda não existe */ } // simula o banco ANTES da migração
  const [a, ko, dup, t] = [oid(), oid(), oid(), oid()];
  await db().collection('chipmodels').insertMany([
    { _id: a, value: 100, color: '#000000', kind: 'TOURNAMENT', active: true },
    { _id: ko, value: 1, color: '#123456', kind: 'KO', active: true },
    { _id: dup, value: 100, color: '#000000', kind: 'KO', active: true }, // colidiria com `a` sem o tipo
  ]);
  await db().collection('tournaments').insertOne({ _id: t, name: 'T', ko_chip_id: ko });
  return { a, ko, dup, t };
}

test('remove o tipo das fichas e o vínculo KO do torneio (tudo arquivado)', async () => {
  const { a, ko, t } = await seed();
  await migration.up(db());
  for (const id of [a, ko]) assert.equal((await db().collection('chipmodels').findOne({ _id: id })).kind, undefined);
  assert.equal((await db().collection('tournaments').findOne({ _id: t })).ko_chip_id, undefined);
  assert.equal((await db().collection('archive_chip_legacy').findOne({ chip_id: ko })).kind, 'KO');
  assert.equal(String((await db().collection('archive_tournament_legacy').findOne({ tournament_id: t })).ko_chip_id), String(ko));
});

test('a ficha KO que colidiria com uma ficha comum (mesmo valor e cor) é DESATIVADA — nada é apagado', async () => {
  const { a, dup } = await seed();
  await migration.up(db());
  assert.equal((await db().collection('chipmodels').findOne({ _id: a })).active, true, 'a comum permanece ativa');
  assert.equal((await db().collection('chipmodels').findOne({ _id: dup })).active, false);
  assert.equal(await db().collection('chipmodels').countDocuments(), 3);
});

test('troca o índice único (valor, cor, tipo) por (valor, cor); idempotente; down restaura os campos', async () => {
  const { ko, t } = await seed();
  await db().collection('chipmodels').createIndex({ value: 1, color: 1, kind: 1 }, { unique: true, name: 'chip_identity_active', partialFilterExpression: { active: true } });
  await migration.up(db());
  await migration.up(db());
  const names = (await db().collection('chipmodels').indexes()).map((i) => i.name);
  assert.equal(names.includes('chip_identity_active'), false);
  assert.equal(names.includes('chip_value_color_active'), true, 'o índice novo é criado pela própria migração');
  assert.equal(await db().collection('archive_chip_legacy').countDocuments({ kind: { $exists: true } }), 3);

  await migration.down(db());
  assert.equal((await db().collection('chipmodels').findOne({ _id: ko })).kind, 'KO');
  assert.equal(String((await db().collection('tournaments').findOne({ _id: t })).ko_chip_id), String(ko));
});

test('banco sem nada disso: não falha', async () => {
  await migration.up(db());
  assert.equal(await db().collection('archive_chip_legacy').countDocuments(), 0);
});
