// G2 — migração 20260924000000-movement-opening-balances: ledger v1 + composição de fichários → Movement.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect } = require('./helpers');
const migration = require('../migrations/20260924000000-movement-opening-balances');
const mv = require('../lib/movements');

before(connect);
after(disconnect);
beforeEach(clearDb);

const db = () => mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();
const at = (i) => new Date(`2026-01-0${i}T10:00:00Z`);

// estado LEGADO: fichas com saldo global no ledger v1 + fichários com composição gravada
async function seed({ excess = false } = {}) {
  const [c100, c500, c1000] = [oid(), oid(), oid()];
  const [b1, b2, bDel] = [oid(), oid(), oid()];
  await db().collection('chipmodels').insertMany([
    { _id: c100, name: 'Ficha 100', value: 100, color: '#000000', kind: 'TOURNAMENT', active: true, deleted_at: null, total_quantity: 1000, reserved_quantity: 0, available_quantity: 1000 },
    { _id: c500, name: 'Ficha 500', value: 500, color: '#ff0000', kind: 'TOURNAMENT', active: true, deleted_at: null, total_quantity: 300, reserved_quantity: 0, available_quantity: 300 },
    { _id: c1000, name: 'Ficha 1000', value: 1000, color: '#0000ff', kind: 'TOURNAMENT', active: true, deleted_at: null, total_quantity: 50, reserved_quantity: 0, available_quantity: 50 },
  ]);
  const L = (chip_id, type, quantity, i, extra = {}) => ({ chip_id, type, quantity, ref: { kind: 'manual', id: null }, createdAt: at(i), updatedAt: at(i), ...extra });
  await db().collection('inventoryledgers').insertMany([
    L(c100, 'saldo_inicial', 1000, 1), L(c100, 'saida', -100, 2),     // v1 total 900
    L(c500, 'saldo_inicial', 300, 1),                                  // v1 total 300
    L(c1000, 'saldo_inicial', 50, 1), L(c1000, 'alocacao', 20, 3, { ref: { kind: 'tournament', id: oid() } }), // total 50, reserva 20
  ]);
  await db().collection('chipcases').insertMany([
    { _id: b1, name: 'Maleta 1', deleted_at: null, chips: [{ chip_id: c100, quantity: 500 }, { chip_id: c500, quantity: 300 }] },
    { _id: b2, name: 'Maleta 2', deleted_at: null, chips: [{ chip_id: c100, quantity: excess ? 900 : 200 }] },
    { _id: bDel, name: 'Excluída', deleted_at: at(2), chips: [{ chip_id: c100, quantity: 77 }] },
  ]);
  return { c100, c500, c1000, b1, b2, bDel };
}

const balanceOf = (binder, chip) => mv.balanceAt({ kind: 'binder', id: binder }, chip);

test('cada fichário ativo recebe um ASSEMBLY de abertura com a composição legada', async () => {
  const { c100, c500, b1, b2, bDel } = await seed();
  await migration.up(db());

  assert.equal(await balanceOf(b1, c100), 500);
  assert.equal(await balanceOf(b1, c500), 300);
  assert.equal(await balanceOf(b2, c100), 200);
  assert.equal(await balanceOf(bDel, c100), 0, 'fichário excluído não recebe saldo');

  const rows = await db().collection('movements').find({ binder_id: b1 }).toArray();
  assert.equal(rows.length, 2);
  for (const m of rows) {
    assert.equal(m.type, 'ASSEMBLY');
    assert.equal(m.from.kind, 'external');
    assert.equal(m.meta.migration, 'g2-opening');
    assert.equal(m.user_name, 'Migração G2');
    assert.ok(m.batch_id);
  }
});

test('o que o ledger v1 tem e não está em fichário vai para o LEGADO; nada some, nada duplica', async () => {
  const { c100, c500, c1000 } = await seed();
  await migration.up(db());

  const legado = await db().collection('chipcases').findOne({ code: 'LEGADO' });
  assert.ok(legado);
  // c100: v1 900 − 700 nos fichários = 200 ; c500: 300 − 300 = 0 (sem linha) ; c1000: 50 − 0 = 50
  assert.equal(await balanceOf(legado._id, c100), 200);
  assert.equal(await balanceOf(legado._id, c500), 0);
  assert.equal(await balanceOf(legado._id, c1000), 50);

  // total físico por ficha == total do ledger v1 (conservação na migração)
  assert.equal(await mv.chipTotal(c100), 900);
  assert.equal(await mv.chipTotal(c500), 300);
  assert.equal(await mv.chipTotal(c1000), 50);
});

test('fichários que somam MAIS que o ledger v1: vale o fichário e não cria LEGADO para essa ficha', async () => {
  const { c100 } = await seed({ excess: true }); // 500 + 900 = 1400 > 900 do v1
  await migration.up(db());
  assert.equal(await mv.chipTotal(c100), 1400);
  const legado = await db().collection('chipcases').findOne({ code: 'LEGADO' });
  assert.equal(legado ? await balanceOf(legado._id, c100) : 0, 0);
});

test('v1 de estoque vira histórico (legacy) e as reservas de torneio continuam vivas', async () => {
  await seed();
  await migration.up(db());
  const led = db().collection('inventoryledgers');
  assert.equal(await led.countDocuments({ legacy: true }), 4, 'saldo_inicial×3 + saida');
  assert.equal(await led.countDocuments({ type: 'alocacao', legacy: true }), 0);
  assert.equal(await led.countDocuments({ type: 'alocacao' }), 1);
});

test('caches derivados: Binder.chips e Chip.total/reserved/available refletem os movimentos', async () => {
  const { c1000, b1 } = await seed();
  await migration.up(db());

  const b = await db().collection('chipcases').findOne({ _id: b1 });
  assert.deepEqual(b.chips.map((l) => l.quantity).sort((x, y) => x - y), [300, 500]);
  const chip = await db().collection('chipmodels').findOne({ _id: c1000 });
  assert.equal(chip.total_quantity, 50);
  assert.equal(chip.reserved_quantity, 20, 'reserva v1 preservada');
  assert.equal(chip.available_quantity, 30);
});

test('é idempotente: rodar de novo não duplica movimentos nem cria outro LEGADO', async () => {
  await seed();
  await migration.up(db());
  const count = await db().collection('movements').countDocuments();
  await migration.up(db());
  assert.equal(await db().collection('movements').countDocuments(), count);
  assert.equal(await db().collection('chipcases').countDocuments({ code: 'LEGADO' }), 1);
});

test('banco sem nada a migrar: não falha e não cria LEGADO', async () => {
  await migration.up(db());
  assert.equal(await db().collection('movements').countDocuments(), 0);
  assert.equal(await db().collection('chipcases').countDocuments({ code: 'LEGADO' }), 0);
});

test('down: remove os movimentos de migração, o LEGADO e a flag legacy', async () => {
  const { c100 } = await seed();
  await migration.up(db());
  await migration.down(db());
  assert.equal(await db().collection('movements').countDocuments(), 0);
  assert.equal(await db().collection('chipcases').countDocuments({ code: 'LEGADO' }), 0);
  assert.equal(await db().collection('inventoryledgers').countDocuments({ legacy: true }), 0);
  assert.equal((await db().collection('chipmodels').findOne({ _id: c100 })).total_quantity, 0);
});

test('depois da migração o motor funciona sobre os saldos de abertura', async () => {
  const { c100, b1 } = await seed();
  await migration.up(db());
  const [m] = await mv.postBatch([{
    type: 'WITHDRAWAL', chip_id: c100, quantity: 100, reason: 'x', from: { kind: 'binder', id: b1 }, to: { kind: 'external' },
  }], { user: { name: 't' } });
  assert.equal(m.quantity, 100);
  assert.equal(await balanceOf(b1, c100), 400);
  await assert.rejects(mv.postBatch([{
    type: 'WITHDRAWAL', chip_id: c100, quantity: 401, reason: 'x', from: { kind: 'binder', id: b1 }, to: { kind: 'external' },
  }]), /Saldo insuficiente/);
});
