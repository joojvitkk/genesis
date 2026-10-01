// Migração 20261002000000-remove-players-and-chip-money: ficha sem valor monetário; entradas no lugar de jogadores.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect } = require('./helpers');
const migration = require('../migrations/20261002000000-remove-players-and-chip-money');

before(connect);
after(disconnect);
beforeEach(clearDb);
const db = () => mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();
const at = (m) => new Date(`2026-10-01T${String(m).padStart(2, '0')}:00:00Z`);

async function seed() {
  const [ko, t, ana, bruno, s1] = [oid(), oid(), oid(), oid(), oid()];
  await db().collection('chipmodels').insertOne({ _id: ko, value: 1, color: '#123456', kind: 'KO', monetary_value: 50, active: true });
  await db().collection('tournaments').insertOne({ _id: t, name: 'T', date: at(1) });
  await db().collection('players').insertMany([{ _id: ana, name: 'Ana' }, { _id: bruno, name: 'Bruno' }]);
  // ordem por timestamp: Ana(1) Bruno(2) Ana re-entry(3) Bruno add-on(4)
  const mk = (n, extra) => ({ _id: oid(), tournament_id: t, session_id: s1, timestamp: at(n), ...extra });
  const [e1, e2, e3, e4] = [mk(1, { type: 'buy-in', player_id: ana, player_name: 'Ana' }), mk(2, { type: 'buy-in', player_id: bruno }), mk(3, { type: 're-entry', player_id: ana }), mk(4, { type: 'add-on', player_id: bruno })];
  await db().collection('tournamententries').insertMany([e1, e2, e3, e4]);
  // Ana foi eliminada (1ª entrada) e reentrou (3ª); Bruno sentado
  const el = { _id: oid(), tournament_id: t, player_id: ana, eliminated_by: bruno, bounty_awarded: 10, position: 5, at: at(2) };
  await db().collection('eliminations').insertOne(el);
  const seatAna = { _id: oid(), tournament_id: t, session_id: s1, table_number: 1, seat_number: 1, player_id: ana };
  const seatBruno = { _id: oid(), tournament_id: t, session_id: s1, table_number: 1, seat_number: 2, player_id: bruno };
  const orphan = { _id: oid(), tournament_id: t, session_id: s1, table_number: 1, seat_number: 3, player_id: oid() }; // jogador sem entrada
  await db().collection('seats').insertMany([seatAna, seatBruno, orphan]);
  return { ko, t, ana, bruno, e: [e1, e2, e3, e4], el, seatAna, seatBruno, orphan };
}

test('ficha: o valor monetário sai (arquivado); o cadastro nominal permanece', async () => {
  const { ko } = await seed();
  await migration.up(db());
  const c = await db().collection('chipmodels').findOne({ _id: ko });
  assert.equal(c.monetary_value, undefined);
  assert.deepEqual([c.value, c.kind, c.color], [1, 'KO', '#123456']);
  assert.equal((await db().collection('archive_chip_legacy').findOne({ chip_id: ko })).monetary_value, 50);
});

test('entradas: numeradas por ordem no torneio, sem dados de jogador (arquivados); o torneio recebe entry_seq', async () => {
  const { t, e, ana } = await seed();
  await migration.up(db());
  const list = await db().collection('tournamententries').find({ tournament_id: t }).sort({ timestamp: 1 }).toArray();
  assert.deepEqual(list.map((x) => x.number), [1, 2, 3, 4]);
  for (const x of list) { assert.equal(x.player_id, undefined); assert.equal(x.player_name, undefined); }
  assert.equal((await db().collection('tournaments').findOne({ _id: t })).entry_seq, 4);
  const a = await db().collection('archive_entry_players').findOne({ entry_id: e[0]._id });
  assert.deepEqual([String(a.player_id), a.player_name], [String(ana), 'Ana']);
  assert.equal(await db().collection('archive_players').countDocuments(), 2);
  assert.equal(await db().collection('players').countDocuments(), 2, 'a coleção original NÃO é tocada');
});

test('assentos: passam para a entrada mais recente do jogador; sem entrada → arquivado e removido', async () => {
  const { e, seatAna, seatBruno, orphan } = await seed();
  await migration.up(db());
  const seats = db().collection('seats');
  assert.equal(String((await seats.findOne({ _id: seatAna._id })).entry_id), String(e[2]._id), 'Ana: a re-entrada');
  assert.equal(String((await seats.findOne({ _id: seatBruno._id })).entry_id), String(e[1]._id), 'Bruno: o buy-in (add-on não senta)');
  assert.equal((await seats.findOne({ _id: seatAna._id })).player_id, undefined);
  assert.equal(await seats.findOne({ _id: orphan._id }), null);
  assert.equal(await db().collection('archive_seats_legacy').countDocuments({ _id: orphan._id }), 1);
});

test('eliminações: apontam para a entrada correspondente; jogador, eliminador e bounty ficam no arquivo', async () => {
  const { e, el } = await seed();
  await migration.up(db());
  const x = await db().collection('eliminations').findOne({ _id: el._id });
  assert.equal(String(x.entry_id), String(e[0]._id), 'a 1ª eliminação da Ana é da 1ª entrada dela');
  for (const f of ['player_id', 'eliminated_by', 'bounty_awarded']) assert.equal(x[f], undefined, f);
  const a = await db().collection('archive_elimination_players').findOne({ elimination_id: el._id });
  assert.equal(a.bounty_awarded, 10);
});

test('idempotente; down restaura chip, entradas e eliminações; índice antigo de assentos é removido', async () => {
  const { ko, e, el } = await seed();
  await db().collection('seats').createIndex({ tournament_id: 1, session_id: 1, player_id: 1 }, { unique: true, name: 'tournament_id_1_session_id_1_player_id_1' });
  await migration.up(db());
  await migration.up(db());
  assert.equal(await db().collection('archive_entry_players').countDocuments(), 4);
  assert.equal(await db().collection('archive_elimination_players').countDocuments(), 1);
  assert.equal((await db().collection('seats').indexes()).some((i) => i.name === 'tournament_id_1_session_id_1_player_id_1'), false);

  await migration.down(db());
  assert.equal((await db().collection('chipmodels').findOne({ _id: ko })).monetary_value, 50);
  assert.equal((await db().collection('tournamententries').findOne({ _id: e[0]._id })).player_name, 'Ana');
  assert.equal((await db().collection('eliminations').findOne({ _id: el._id })).bounty_awarded, 10);
});

test('banco sem nada disso: não falha', async () => {
  await migration.up(db());
  assert.equal(await db().collection('archive_entry_players').countDocuments(), 0);
});
