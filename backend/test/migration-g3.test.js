// G3 — migração 20260925000000-stack-actions: stack de uma coluna → grade ficha × ação.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect } = require('./helpers');
const migration = require('../migrations/20260925000000-stack-actions');

before(connect);
after(disconnect);
beforeEach(clearDb);

const db = () => mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();

async function seed() {
  const [c100, c500, stackId, tId] = [oid(), oid(), oid(), oid()];
  await db().collection('stackmodels').insertOne({
    _id: stackId, name: 'Antigo', total_value: 4000, notes: 'n',
    composition: [{ chip_id: c100, quantity: 10 }, { chip_id: c500, quantity: 6 }, { chip_id: oid(), quantity: 0 }],
  });
  await db().collection('tournaments').insertOne({ _id: tId, name: 'T', date: new Date(), stack_model_id: stackId, starting_stack: 4000 });
  await db().collection('tournamententries').insertMany([
    { tournament_id: tId, type: 'buy-in', stack_model_id: stackId },
    { tournament_id: tId, type: 're-entry' },
    { tournament_id: tId, type: 'add-on' },
    { tournament_id: tId, type: 'buy-in', action: 'optional_buy_in' }, // já migrada: não pode ser sobrescrita
  ]);
  return { c100, c500, stackId, tId };
}

test('a composição antiga vira a coluna buy_in, com as colunas padrão, e o total_value sai', async () => {
  const { c100, c500, stackId } = await seed();
  await migration.up(db());

  const s = await db().collection('stackmodels').findOne({ _id: stackId });
  assert.deepEqual(s.actions.map((a) => a.key), ['buy_in', 'optional_buy_in', 're_entry']);
  assert.equal(s.composition.length, 3);
  const line = (id) => s.composition.find((l) => String(l.chip_id) === String(id));
  assert.deepEqual(line(c100).quantities, { buy_in: 10 });
  assert.deepEqual(line(c500).quantities, { buy_in: 6 });
  assert.deepEqual(s.composition.find((l) => l.quantities && !Object.keys(l.quantities).length).quantities, {}, 'quantidade 0 não vira coluna');
  assert.equal(s.total_value, undefined);
  assert.equal(s.name, 'Antigo');
  assert.ok(s.composition.every((l) => l.quantity === undefined), 'o campo antigo não sobra');
});

test('as entradas ganham a ação do tipo; a que já tinha ação e o stack legado da entrada são mantidos', async () => {
  const { stackId } = await seed();
  await migration.up(db());

  const e = async (q) => db().collection('tournamententries').findOne(q);
  assert.equal((await e({ type: 'buy-in', stack_model_id: stackId })).action, 'buy_in');
  assert.equal((await e({ type: 're-entry' })).action, 're_entry');
  assert.equal((await e({ type: 'add-on' })).action, 'add_on');
  assert.equal((await e({ type: 'buy-in', action: 'optional_buy_in' })).action, 'optional_buy_in');
  assert.equal(String((await e({ type: 'buy-in', stack_model_id: { $exists: true } })).stack_model_id), String(stackId), 'stack legado preservado');
});

test('torneios ganham stack_models = [] e mantêm o stack padrão', async () => {
  const { tId, stackId } = await seed();
  await migration.up(db());
  const t = await db().collection('tournaments').findOne({ _id: tId });
  assert.deepEqual(t.stack_models, []);
  assert.equal(String(t.stack_model_id), String(stackId));
});

test('é idempotente e não desfaz um modelo já migrado', async () => {
  await seed();
  await migration.up(db());
  const snap = async () => JSON.stringify({
    s: await db().collection('stackmodels').find({}).toArray(),
    e: await db().collection('tournamententries').find({}).sort({ _id: 1 }).toArray(),
    t: await db().collection('tournaments').find({}).toArray(),
  });
  const first = await snap();
  await migration.up(db());
  assert.equal(await snap(), first);
});

test('banco vazio: não falha', async () => {
  await migration.up(db());
  assert.equal(await db().collection('stackmodels').countDocuments(), 0);
});

test('down volta ao formato de uma coluna (buy_in) e remove as ações', async () => {
  const { stackId, c100 } = await seed();
  await migration.up(db());
  await migration.down(db());
  const s = await db().collection('stackmodels').findOne({ _id: stackId });
  assert.equal(s.actions, undefined);
  assert.deepEqual(s.composition.map((l) => [String(l.chip_id), l.quantity]).find(([id]) => id === String(c100)), [String(c100), 10]);
  assert.equal(await db().collection('tournamententries').countDocuments({ action: { $exists: true } }), 0);
});

test('depois da migração o motor calcula sobre os dados antigos (entrada legada + modelo migrado)', async () => {
  const { stackId, tId, c100 } = await seed();
  await migration.up(db());
  const { chipsInPlay } = require('../lib/tournamentChips');
  await db().collection('chipmodels').insertMany([
    { _id: c100, value: 100, color: '#000000', kind: 'TOURNAMENT', active: true, deleted_at: null },
  ]);
  const r = await chipsInPlay(tId);
  assert.equal(r.counts.buy_in, 1);
  assert.equal(r.rows.find((x) => String(x.chip._id) === String(c100)).quantity, 10, 'a entrada legada usa o stack migrado');
  assert.ok(stackId);
});
