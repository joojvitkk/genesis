// G8 — migração 20260929000000-occurrences: perdas anteriores viram ocorrências `legacy` (sem tocar nos movimentos).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');
const migration = require('../migrations/20260929000000-occurrences');
const request = require('supertest');
const app = require('../app');
const { Occurrence, Movement } = require('../models');
const mv = require('../lib/movements');

before(async () => { await connect(); await Occurrence.init(); });
after(disconnect);
beforeEach(clearDb);
const db = () => mongoose.connection.db;

// perdas "antigas": movimentos LOSS gravados direto, sem meta.occurrence_id
async function seed() {
  const c100 = await makeChip({ value: 100 });
  const c5000 = await makeChip({ value: 5000, color: '#00ff00' });
  const binder = await makeBinder('LISA 1', [{ chip: c100, quantity: 100 }, { chip: c5000, quantity: 10 }]);
  const lose = (chip, quantity, reason, meta) => mv.postBatch([{ type: 'LOSS', chip_id: chip._id, quantity, from: { kind: 'binder', id: binder._id }, to: { kind: 'lost', id: binder._id }, reason, meta }], { user: { name: 'Op' } });
  const [a] = await lose(c100, 3, 'quebra no turno', { count: { expected: 100, counted: 97 } });
  const [b] = await lose(c5000, 2, 'sumiu');
  const [gone] = await lose(c100, 1, 'lançada errada');
  await mv.reverseMovements([gone._id], { reason: 'erro', user: { name: 'Adm' } });
  return { c100, c5000, binder, a, b, gone };
}

test('cada perda antiga vira ocorrência legacy, com semáforo, motivo como justificativa e o vínculo ao movimento', async () => {
  const { a, b, binder } = await seed();
  await migration.up(db());
  const list = await Occurrence.find({ source: 'legacy' }).sort({ quantity: -1 });
  assert.equal(list.length, 2, 'a perda estornada é ignorada');
  const of = (m) => list.find((o) => String(o.legacy_movement_id) === String(m._id));
  assert.deepEqual([of(a).severity, of(a).status, of(a).justification, of(a).expected, of(a).counted, of(a).quantity], ['GREEN', 'justified', 'quebra no turno', 100, 97, 3]);
  assert.deepEqual([of(b).severity, of(b).severity_reason], ['RED', 'band']);
  assert.deepEqual([of(a).scope, String(of(a).binder_id), of(a).history[0].action], ['binder', String(binder._id), 'opened']);
  assert.equal(of(a).createdAt.toISOString(), a.createdAt.toISOString(), 'mantém a data original');
  assert.equal(await Movement.countDocuments({ type: 'LOSS' }), 3, 'nenhum movimento alterado');
});

test('idempotente: rodar de novo não duplica; down remove só as legacy', async () => {
  await seed();
  await migration.up(db());
  await migration.up(db());
  assert.equal(await Occurrence.countDocuments(), 2);
  await Occurrence.collection.insertOne({ kind: 'LOSS', source: 'count', quantity: 1 });
  await migration.down(db());
  assert.equal(await Occurrence.countDocuments(), 1);
});

test('a ocorrência legacy funciona no ciclo de vida: recuperar, e estornar pela ocorrência (não pela rota de movimentos)', async () => {
  const { c100, binder, a } = await seed();
  await migration.up(db());
  const admin = { Authorization: `Bearer ${(await makeUser('admin')).token}` };
  const mat = { Authorization: `Bearer ${(await makeUser('material')).token}` };
  const o = await Occurrence.findOne({ legacy_movement_id: a._id });

  const blocked = await request(app).post(`/api/movements/${a._id}/reverse`).set(admin).send({ reason: 'x' });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, new RegExp(String(o._id)));

  const rec = await request(app).post(`/api/occurrences/${o._id}/recover`).set(mat).send({ quantity: 2 });
  assert.equal(rec.status, 201, JSON.stringify(rec.body));
  assert.deepEqual([rec.body.status, rec.body.remaining], ['partially_recovered', 1]);
  assert.equal(await mv.balanceAt({ kind: 'binder', id: binder._id }, c100._id), 99, '97 (após a perda de 3) + 2 recuperadas');

  // sem recuperação, o admin estorna a perda pela ocorrência
  const ob = await Occurrence.findOne({ legacy_movement_id: (await Movement.findOne({ type: 'LOSS', reason: 'sumiu' }))._id });
  const v = await request(app).post(`/api/occurrences/${ob._id}/reverse`).set(admin).send({ reason: 'lançada errada' });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal(v.body.status, 'voided');
  assert.equal(await Movement.countDocuments({ type: 'REVERSAL', 'meta.original_type': 'LOSS' }), 2, 'a do teste + a da semente');
});
