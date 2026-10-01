// G11 — migração 20261001000000-legacy-cleanup: arquiva o legado e o remove dos documentos vivos (sem perder dado).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect } = require('./helpers');
const migration = require('../migrations/20261001000000-legacy-cleanup');

before(connect);
after(disconnect);
beforeEach(clearDb);
const db = () => mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();

async function seed() {
  const [chip, binder, tournament] = [oid(), oid(), oid()];
  await db().collection('chipmodels').insertOne({ _id: chip, value: 100, color: '#000000', kind: 'TOURNAMENT', total_quantity: 500, reserved_quantity: 100, available_quantity: 400, legacy_name: 'Ficha 100 – Modelo A' });
  await db().collection('chipcases').insertOne({ _id: binder, name: 'LISA', chips: [{ chip_id: chip, quantity: 500 }], allocations: [{ tournament_id: tournament, tournament_name: 'T' }], allocated_to_tournament: String(tournament), allocated_to_tournament_name: 'T', status: 'allocated' });
  await db().collection('tournaments').insertOne({ _id: tournament, name: 'T', allocated_cases: [binder], stack_composition: [{ chip_id: chip, per_player: 50 }], status: 'scheduled' });
  await db().collection('inventoryledgers').insertMany([{ chip_id: chip, type: 'ENTRY', quantity: 500, legacy: true }, { chip_id: chip, type: 'RESERVE', quantity: -100 }]);
  await db().collection('chipraces').insertOne({ tournament_id: tournament, type: 'chip-race', from_chip: chip, from_quantity: 10 });
  return { chip, binder, tournament };
}

test('arquiva ledger v1 e chip races (originais intactos) e remove o legado dos documentos vivos', async () => {
  const { chip, binder, tournament } = await seed();
  await migration.up(db());

  assert.equal(await db().collection('archive_inventoryledgers').countDocuments(), 2);
  assert.equal(await db().collection('archive_chipraces').countDocuments(), 1);
  assert.equal(await db().collection('inventoryledgers').countDocuments(), 2, 'original intacto');
  assert.equal(await db().collection('chipraces').countDocuments(), 1, 'original intacto');

  const c = await db().collection('chipmodels').findOne({ _id: chip });
  for (const f of ['total_quantity', 'reserved_quantity', 'available_quantity', 'legacy_name']) assert.equal(c[f], undefined, f);
  assert.equal(c.value, 100, 'o cadastro da ficha permanece');
  const b = await db().collection('chipcases').findOne({ _id: binder });
  for (const f of ['chips', 'allocations', 'allocated_to_tournament', 'allocated_to_tournament_name']) assert.equal(b[f], undefined, f);
  assert.equal(b.name, 'LISA');
  const t = await db().collection('tournaments').findOne({ _id: tournament });
  assert.equal(t.allocated_cases, undefined);
  assert.equal(t.stack_composition, undefined);

  // e nada se perdeu: está nos arquivos
  assert.deepEqual([(await db().collection('archive_chip_legacy').findOne({ chip_id: chip })).total_quantity, (await db().collection('archive_chip_legacy').findOne({ chip_id: chip })).legacy_name], [500, 'Ficha 100 – Modelo A']);
  assert.equal((await db().collection('archive_binder_legacy').findOne({ binder_id: binder })).chips[0].quantity, 500);
  assert.equal((await db().collection('archive_tournament_legacy').findOne({ tournament_id: tournament })).stack_composition[0].per_player, 50);
});

test('idempotente: rodar de novo não duplica nem perde o arquivo', async () => {
  await seed();
  await migration.up(db());
  await migration.up(db());
  assert.equal(await db().collection('archive_inventoryledgers').countDocuments(), 2);
  assert.equal(await db().collection('archive_chip_legacy').countDocuments(), 1);
  assert.equal((await db().collection('archive_chip_legacy').findOne({})).total_quantity, 500, 'a 2ª rodada não sobrescreve o arquivo com vazio');
});

test('down restaura os campos a partir dos arquivos', async () => {
  const { chip, binder, tournament } = await seed();
  await migration.up(db());
  await migration.down(db());
  assert.equal((await db().collection('chipmodels').findOne({ _id: chip })).total_quantity, 500);
  assert.equal((await db().collection('chipcases').findOne({ _id: binder })).chips[0].quantity, 500);
  assert.equal((await db().collection('tournaments').findOne({ _id: tournament })).stack_composition[0].per_player, 50);
});

test('banco sem nada legado: não falha (coleções ausentes)', async () => {
  await migration.up(db());
  assert.equal(await db().collection('archive_inventoryledgers').countDocuments(), 0);
});
