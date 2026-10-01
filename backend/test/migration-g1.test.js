// G1 — migração 20260923000000-chip-binder-model: dados legados → Ficha / Modelo / Fichário.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect } = require('./helpers');
const migration = require('../migrations/20260923000000-chip-binder-model');

before(connect);
// o teste `down` derruba o índice único; recria para não afetar outros arquivos que usam o mesmo banco
after(async () => { await require('../models').Chip.createIndexes(); await disconnect(); });
beforeEach(async () => { await clearDb(); delete process.env.GENESIS_MERGE_DUPLICATE_CHIPS; });
afterEach(() => { delete process.env.GENESIS_MERGE_DUPLICATE_CHIPS; });

const db = () => mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();
const d = (iso) => new Date(iso);

// fichas legadas (sem kind/active, nome de "modelo", quantidade global)
async function seedLegacy() {
  const [a, b, c, dead] = [oid(), oid(), oid(), oid()];
  await db().collection('chipmodels').insertMany([
    { _id: a, name: 'Ficha Preta Modelo A', value: 100, color: '#000', total_quantity: 1000, reserved_quantity: 0, available_quantity: 1000, deleted_at: null, createdAt: d('2026-01-01') },
    { _id: b, name: 'Ficha Preta Modelo B', value: 100, color: '#000000', total_quantity: 500, reserved_quantity: 0, available_quantity: 500, deleted_at: null, createdAt: d('2026-02-01') },
    { _id: c, name: 'Ficha Vermelha', value: 500, color: '#FF0000', total_quantity: 200, reserved_quantity: 0, available_quantity: 200, deleted_at: null, createdAt: d('2026-01-15') },
    { _id: dead, name: 'Velha', value: 5, color: '#111111', total_quantity: 0, deleted_at: d('2026-03-01'), createdAt: d('2026-01-01') },
  ]);
  const L = (chip_id, type, quantity, at) => ({ chip_id, type, quantity, ref: { kind: 'manual', id: null }, createdAt: d(at), updatedAt: d(at) });
  await db().collection('inventoryledgers').insertMany([
    L(a, 'saldo_inicial', 1000, '2026-01-02'), L(b, 'saldo_inicial', 500, '2026-02-02'), L(c, 'saldo_inicial', 200, '2026-01-16'),
  ]);
  return { a, b, c, dead };
}

test('duplicatas ativas ABORTAM a migração sem escrever nada (mesclagem é assistida)', async () => {
  const { a } = await seedLegacy();
  await assert.rejects(migration.up(db()), (e) => {
    assert.match(e.message, /abortada/);
    assert.match(e.message, /GENESIS_MERGE_DUPLICATE_CHIPS=1/);
    assert.match(e.message, /valor 100/);
    return true;
  });
  const chip = await db().collection('chipmodels').findOne({ _id: a });
  assert.equal(chip.name, 'Ficha Preta Modelo A', 'nada foi normalizado');
  assert.equal(chip.kind, undefined);
  assert.equal(await db().collection('bindermodels').countDocuments(), 0);
});

test('com autorização: mescla na ficha mais antiga, reaponta referências e soma o saldo', async () => {
  const { a, b, c } = await seedLegacy();
  const caseId = oid();
  const stackId = oid();
  const tId = oid();
  await db().collection('chipcases').insertOne({
    _id: caseId, name: 'Maleta 1', deleted_at: null,
    chips: [{ chip_id: a, quantity: 300 }, { chip_id: b, quantity: 200 }, { chip_id: c, quantity: 50 }],
  });
  await db().collection('stackmodels').insertOne({ _id: stackId, name: 'S', composition: [{ chip_id: b, quantity: 10 }, { chip_id: a, quantity: 5 }] });
  await db().collection('tournaments').insertOne({ _id: tId, name: 'T', stack_composition: [{ chip_id: b, per_player: 4 }] });
  await db().collection('chipraces').insertOne({ from_chip: b, to_chip: c, tournament_id: tId });

  process.env.GENESIS_MERGE_DUPLICATE_CHIPS = '1';
  await migration.up(db());

  const chips = await db().collection('chipmodels').find({}).toArray();
  const keeper = chips.find((x) => String(x._id) === String(a));
  const dup = chips.find((x) => String(x._id) === String(b));
  assert.equal(dup.active, false);
  assert.ok(dup.deleted_at);
  assert.equal(String(dup.merged_into), String(a));
  assert.equal(keeper.active, true);
  assert.equal(keeper.total_quantity, 1500, 'saldo das duas fichas somado');
  assert.equal(keeper.available_quantity, 1500);

  const ledger = await db().collection('inventoryledgers').find({ chip_id: a }).sort({ createdAt: 1 }).toArray();
  assert.deepEqual(ledger.map((r) => r.balance_after), [1000, 1500], 'balance_after recalculado em ordem cronológica');
  assert.equal(await db().collection('inventoryledgers').countDocuments({ chip_id: b }), 0);

  const kase = await db().collection('chipcases').findOne({ _id: caseId });
  assert.equal(kase.chips.length, 2, 'linhas das fichas mescladas viram uma só');
  assert.equal(kase.chips.find((l) => String(l.chip_id) === String(a)).quantity, 500);
  const stack = await db().collection('stackmodels').findOne({ _id: stackId });
  assert.equal(stack.composition.length, 1);
  assert.equal(stack.composition[0].quantity, 15);
  assert.equal((await db().collection('tournaments').findOne({ _id: tId })).stack_composition[0].chip_id.toString(), String(a));
  assert.equal((await db().collection('chipraces').findOne({})).from_chip.toString(), String(a));
});

test('normaliza: cor hexadecimal, kind, active, rótulo derivado e legacy_name', async () => {
  const { a, c, dead } = await seedLegacy();
  process.env.GENESIS_MERGE_DUPLICATE_CHIPS = '1';
  await migration.up(db());

  const find = (id) => db().collection('chipmodels').findOne({ _id: id });
  const keeper = await find(a);
  assert.equal(keeper.color, '#000000', '#000 → #000000');
  assert.equal(keeper.kind, 'TOURNAMENT');
  assert.equal(keeper.name, 'Ficha 100');
  assert.equal(keeper.legacy_name, 'Ficha Preta Modelo A');
  assert.equal(keeper.monetary_value, null);
  assert.equal((await find(c)).color, '#ff0000');
  assert.equal((await find(dead)).active, false, 'excluída legada fica inativa');
});

test('cria um Modelo de Fichário por fichário existente e vincula (nome repetido ganha sufixo)', async () => {
  const { a, c } = await seedLegacy();
  await db().collection('chipmodels').deleteOne({ value: 100, color: '#000000' }); // evita duplicata neste cenário
  const k1 = oid(); const k2 = oid(); const k3 = oid(); const kGone = oid();
  await db().collection('chipcases').insertMany([
    { _id: k1, name: 'Maleta', deleted_at: null, chips: [{ chip_id: a, quantity: 300 }, { chip_id: c, quantity: 50 }] },
    { _id: k2, name: 'Maleta', deleted_at: null, chips: [{ chip_id: a, quantity: 100 }] },
    { _id: k3, name: 'Vazia', deleted_at: null, chips: [] },
    { _id: kGone, name: 'Excluída', deleted_at: d('2026-03-01'), chips: [{ chip_id: a, quantity: 1 }] },
  ]);
  await migration.up(db());

  const models = await db().collection('bindermodels').find({}).sort({ name: 1 }).toArray();
  assert.deepEqual(models.map((m) => m.name), ['Maleta', 'Maleta (2)']);
  const m1 = models.find((m) => m.name === 'Maleta');
  assert.deepEqual(m1.composition.map((l) => l.quantity).sort((x, y) => x - y), [50, 300]);
  assert.equal((await db().collection('chipcases').findOne({ _id: k1 })).model_id.toString(), String(m1._id));
  assert.equal((await db().collection('chipcases').findOne({ _id: k3 })).model_id, null, 'fichário vazio não gera modelo');
  assert.equal((await db().collection('chipcases').findOne({ _id: kGone })).model_id, null, 'excluído não gera modelo');
});

test('é idempotente: rodar duas vezes não duplica modelos nem refaz nada', async () => {
  const { c } = await seedLegacy();
  await db().collection('chipmodels').deleteOne({ value: 100, color: '#000000' });
  await db().collection('chipmodels').deleteOne({ value: 100, color: '#000' });
  await db().collection('chipcases').insertOne({ name: 'M', deleted_at: null, chips: [{ chip_id: c, quantity: 10 }] });

  await migration.up(db());
  const snap = async () => JSON.stringify({
    chips: await db().collection('chipmodels').find({}).sort({ _id: 1 }).toArray(),
    models: (await db().collection('bindermodels').find({}).toArray()).map((m) => ({ ...m, _id: 0 })),
  });
  const first = await snap();
  await migration.up(db());
  assert.equal(await snap(), first);
  assert.equal(await db().collection('bindermodels').countDocuments(), 1);
});

test('cria o índice único e ele barra nova duplicata ativa, mas aceita descontinuada', async () => {
  await db().collection('chipmodels').insertOne({ name: 'X', value: 100, color: '#000000', deleted_at: null, createdAt: d('2026-01-01') });
  await migration.up(db());

  const idx = (await db().collection('chipmodels').indexes()).find((i) => i.name === 'chip_identity_active');
  assert.ok(idx?.unique);
  await assert.rejects(
    db().collection('chipmodels').insertOne({ value: 100, color: '#000000', kind: 'TOURNAMENT', active: true }),
    (e) => e.code === 11000,
  );
  await db().collection('chipmodels').insertOne({ value: 100, color: '#000000', kind: 'TOURNAMENT', active: false });
});

test('down: remove modelos criados, desvincula fichários e restaura o nome antigo', async () => {
  const { c } = await seedLegacy();
  await db().collection('chipmodels').deleteMany({ value: 100 });
  const kid = oid();
  await db().collection('chipcases').insertOne({ _id: kid, name: 'M', deleted_at: null, chips: [{ chip_id: c, quantity: 10 }] });
  await migration.up(db());
  await migration.down(db());

  assert.equal(await db().collection('bindermodels').countDocuments(), 0);
  assert.equal((await db().collection('chipcases').findOne({ _id: kid })).model_id, null);
  assert.equal((await db().collection('chipmodels').findOne({ _id: c })).name, 'Ficha Vermelha');
  assert.ok(!(await db().collection('chipmodels').indexes()).some((i) => i.name === 'chip_identity_active'));
});
