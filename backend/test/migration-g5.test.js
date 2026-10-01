// G5 — migração 20260927000000-allocations: allocated_cases (fichário inteiro) → Allocation por denominação/quantidade.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect } = require('./helpers');
const migration = require('../migrations/20260927000000-allocations');

before(connect);
after(async () => { await require('../models').Allocation.syncIndexes(); await disconnect(); });
beforeEach(clearDb);

const db = () => mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();
const at = (d) => new Date(`2026-10-${d}T12:00:00Z`);

const asm = (binder, chip, quantity) => ({
  type: 'ASSEMBLY', chip_id: chip, quantity, from: { kind: 'external', id: null }, to: { kind: 'binder', id: binder }, binder_id: binder,
  batch_id: oid(), reason: 'abertura', createdAt: at('01'),
});

async function seed() {
  const [c100, c5000] = [oid(), oid()];
  const [b1, b2, bGone] = [oid(), oid(), oid()];
  const [tRun, tSchedDup, tSchedOk, tClosed, tDel] = [oid(), oid(), oid(), oid(), oid()];
  await db().collection('chipmodels').insertMany([
    { _id: c100, name: 'Ficha 100', value: 100, color: '#000000', total_quantity: 1500, reserved_quantity: 999, available_quantity: 501, deleted_at: null },
    { _id: c5000, name: 'Ficha 5000', value: 5000, color: '#00ff00', total_quantity: 100, reserved_quantity: 0, available_quantity: 100, deleted_at: null },
  ]);
  await db().collection('chipcases').insertMany([
    { _id: b1, name: 'B1', status: 'allocated', deleted_at: null, chips: [] },
    { _id: b2, name: 'B2', status: 'available', deleted_at: null, chips: [] },
    { _id: bGone, name: 'Apagado', status: 'available', deleted_at: at('02'), chips: [] },
  ]);
  await db().collection('movements').insertMany([asm(b1, c100, 1000), asm(b1, c5000, 100), asm(b2, c100, 500)]);
  await db().collection('tournaments').insertMany([
    { _id: tRun, name: 'Rodando', date: at('05'), status: 'running', deleted_at: null, allocated_cases: [b1] },
    { _id: tSchedDup, name: 'Agendado (mesmo fichário)', date: at('06'), status: 'scheduled', deleted_at: null, allocated_cases: [b1] },
    { _id: tSchedOk, name: 'Agendado', date: at('07'), status: 'scheduled', deleted_at: null, allocated_cases: [b2, bGone] },
    { _id: tClosed, name: 'Encerrado', date: at('01'), status: 'finished', deleted_at: null, allocated_cases: [b1] },
    { _id: tDel, name: 'Excluído', date: at('01'), status: 'scheduled', deleted_at: at('02'), allocated_cases: [b2] },
  ]);
  await db().collection('inventoryledgers').insertMany([
    { chip_id: c100, type: 'saldo_inicial', quantity: 1500, createdAt: at('01') },
    { chip_id: c100, type: 'alocacao', quantity: 999, ref: { kind: 'tournament', id: tRun }, createdAt: at('05') },
  ]);
  return { c100, c5000, b1, b2, tRun, tSchedDup, tSchedOk, tClosed, tDel };
}

const open = (t) => db().collection('allocations').find({ tournament_id: t, open: true }).toArray();
const qty = (a) => Object.fromEntries(a.chips.map((c) => [String(c.chip_id), c.quantity]));

test('torneio em andamento: alocação ATIVA com o saldo atual do fichário (modo "binder")', async () => {
  const { tRun, b1, c100, c5000 } = await seed();
  await migration.up(db());
  const [a] = await open(tRun);
  assert.equal(String(a.binder_id), String(b1));
  assert.deepEqual([a.status, a.mode, a.migrated, a.created_by], ['active', 'binder', true, 'Migração G5']);
  assert.deepEqual(qty(a), { [c100]: 1000, [c5000]: 100 });
});

test('torneio agendado com fichário livre: alocação PLANEJADA; fichário inexistente é ignorado', async () => {
  const { tSchedOk, b2, c100 } = await seed();
  await migration.up(db());
  const list = await open(tSchedOk);
  assert.equal(list.length, 1, 'o fichário apagado não gera alocação');
  assert.deepEqual([list[0].status, String(list[0].binder_id)], ['planned', String(b2)]);
  assert.deepEqual(qty(list[0]), { [c100]: 500 });
});

test('mesmo fichário em 2 torneios (o modelo antigo permitia): o em andamento fica; o agendado perde o vínculo', async () => {
  const { tSchedDup, tRun } = await seed();
  await migration.up(db());
  assert.equal((await open(tRun)).length, 1);
  assert.equal((await open(tSchedDup)).length, 0, 'sem saldo livre: nada é inventado');
  const t = await db().collection('tournaments').findOne({ _id: tSchedDup });
  assert.deepEqual(t.allocated_cases, [], 'o campo derivado reflete o que restou');
});

test('a soma alocada nunca passa do saldo físico (invariante da spec §18.2)', async () => {
  const { b1, b2, c100, c5000 } = await seed();
  await migration.up(db());
  const bal = { [`${b1}:${c100}`]: 1000, [`${b1}:${c5000}`]: 100, [`${b2}:${c100}`]: 500 };
  const held = {};
  for (const a of await db().collection('allocations').find({ open: true }).toArray()) for (const c of a.chips) held[`${a.binder_id}:${c.chip_id}`] = (held[`${a.binder_id}:${c.chip_id}`] || 0) + c.quantity;
  for (const [k, q] of Object.entries(held)) assert.ok(q <= bal[k], `${k}: alocado ${q} ≤ saldo ${bal[k]}`);
});

test('encerrado mantém o allocated_cases antigo (histórico); excluído não é tocado', async () => {
  const { tClosed, tDel, b1, b2 } = await seed();
  await migration.up(db());
  assert.equal((await open(tClosed)).length, 0);
  assert.deepEqual((await db().collection('tournaments').findOne({ _id: tClosed })).allocated_cases.map(String), [String(b1)]);
  assert.equal((await open(tDel)).length, 0);
  assert.deepEqual((await db().collection('tournaments').findOne({ _id: tDel })).allocated_cases.map(String), [String(b2)]);
});

test('campos derivados: fichário (status/allocations), ficha (reservado/disponível) e torneio', async () => {
  const { b1, b2, c100, c5000, tRun } = await seed();
  await migration.up(db());
  const bin = (id) => db().collection('chipcases').findOne({ _id: id });
  const b1d = await bin(b1);
  assert.equal(b1d.status, 'allocated');
  assert.equal(b1d.allocations[0].tournament_name, 'Rodando');
  assert.equal(b1d.allocated_to_tournament_name, 'Rodando');
  assert.equal((await bin(b2)).status, 'allocated', 'planejado também reserva');

  const chip = (id) => db().collection('chipmodels').findOne({ _id: id });
  const p = await chip(c100);
  assert.deepEqual([p.reserved_quantity, p.available_quantity], [1500, 0], 'substitui o 999 antigo: Σ alocações abertas (1000 + 500)');
  assert.deepEqual([(await chip(c5000)).reserved_quantity], [100]);
  assert.deepEqual((await db().collection('tournaments').findOne({ _id: tRun })).allocated_cases.map(String), [String(b1)]);
});

test('todo o ledger v1 (inclusive as reservas) vira histórico', async () => {
  await seed();
  await migration.up(db());
  assert.equal(await db().collection('inventoryledgers').countDocuments({ legacy: { $ne: true } }), 0);
});

test('é idempotente e cria o índice de uma alocação aberta por (torneio, fichário)', async () => {
  await seed();
  await migration.up(db());
  const snap = async () => JSON.stringify((await db().collection('allocations').find({}).sort({ _id: 1 }).toArray()).map((a) => ({ ...a, _id: 0, createdAt: 0, updatedAt: 0 })));
  const first = await snap();
  await migration.up(db());
  assert.equal(await snap(), first);
  assert.equal(await db().collection('allocations').countDocuments(), 2);
  assert.ok((await db().collection('allocations').indexes()).some((i) => i.name === 'allocation_open_once' && i.unique));
});

test('banco sem alocações: não falha', async () => {
  await migration.up(db());
  assert.equal(await db().collection('allocations').countDocuments(), 0);
});

test('down: remove as migradas e devolve a reserva ao que o ledger v1 diz', async () => {
  const { c100 } = await seed();
  await migration.up(db());
  await migration.down(db());
  assert.equal(await db().collection('allocations').countDocuments({ migrated: true }), 0);
  assert.equal(await db().collection('inventoryledgers').countDocuments({ type: 'alocacao', legacy: true }), 0);
  assert.equal((await db().collection('chipmodels').findOne({ _id: c100 })).reserved_quantity, 999);
});
