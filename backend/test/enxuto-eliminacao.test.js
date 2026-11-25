// Modo enxuto — itens 19 a 21 e 28: eliminação nas fases herdadas, encerramento do dia e saldo físico herdado.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser, makeChip } = require('./helpers');
const app = require('../app');

before(connect);
after(disconnect);
beforeEach(clearDb);

const hdr = async (role) => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, u, b) => request(app).post(u).set(h).send(b);
const put = (h, u, b) => request(app).put(u).set(h).send(b);
const get = (h, u) => request(app).get(u).set(h);

async function scene(names = ['Dia 1A', 'Dia 1B', 'Dia Final']) {
  const admin = await hdr('admin');
  const chip = await makeChip({ value: 1000, color: '#0000ff' });
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 10, re_entry: 10 } }] })).body;
  const t = (await post(admin, '/api/tournaments', { name: 'Warm Up', date: '2026-10-01', stack_model_id: stack._id, sessions: names })).body;
  const s = Object.fromEntries(t.sessions.map((x) => [x.name, x]));
  return { admin, t, s, chip };
}
const base = (t) => `/api/tournaments/${t._id}`;
const sp = (t, s) => `${base(t)}/sessions/${s._id}`;
const enter = async (h, t, s, n, type = 'buy-in') => { const r = await post(h, `${base(t)}/entries`, { type, quantity: n, session_id: s._id }); assert.equal(r.status, 201, JSON.stringify(r.body)); };
const finish = async (h, t, s, q) => { await put(h, sp(t, s), { status: 'running' }); return put(h, sp(t, s), { status: 'finished', ...(q === undefined ? {} : { qualified_count: q }) }); };
const counts = async (h, t, s) => (await get(h, `${base(t)}/sessions`)).body.find((x) => x._id === s._id).players;
const elim = (h, t, s) => post(h, `${base(t)}/eliminations`, { session_id: s._id });

test('item 20: encerrar o 1B com 188 inscrições e 62 classificados → Jogando 62, Eliminados 126', async () => {
  const { admin, t, s } = await scene(['Dia 1A', 'Dia 1B']);
  await enter(admin, t, s['Dia 1B'], 120); await enter(admin, t, s['Dia 1B'], 68, 're-entry');
  assert.equal((await finish(admin, t, s['Dia 1B'], 62)).status, 200);
  const c = await counts(admin, t, s['Dia 1B']);
  assert.equal(c.active, 62);
  assert.equal(c.eliminated, 126);
  assert.equal(c.entries_total, 188);
  const sess = (await get(admin, `${base(t)}/sessions`)).body.find((x) => x._id === s['Dia 1B']._id);
  assert.equal(sess.closing_adjust.qualified, 62);
  assert.equal(sess.closing_adjust.previous_active, 188);
  // "Corrigir classificados" mantém a conta
  assert.equal((await put(admin, `${sp(t, s['Dia 1B'])}/qualified`, { qualified_count: 60, reason: 'recontagem' })).status, 200);
  const c2 = await counts(admin, t, s['Dia 1B']);
  assert.deepEqual([c2.active, c2.eliminated], [60, 128]);
});

test('item 19: "−1 eliminação" no Dia Final (sem entrada própria) diminui o Jogando, grava a colocação e desfaz', async () => {
  const { admin, t, s } = await scene();
  await enter(admin, t, s['Dia 1A'], 5);
  await finish(admin, t, s['Dia 1A'], 3);
  await finish(admin, t, s['Dia 1B'], 0).catch(() => {});
  const fin = s['Dia Final'];
  let c = await counts(admin, t, fin);
  assert.equal(c.active, 3);
  const r1 = await elim(admin, t, fin);
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.position, 3);
  c = await counts(admin, t, fin);
  assert.deepEqual([c.active, c.eliminated], [2, 1]);
  const r2 = await elim(admin, t, fin);
  assert.equal(r2.body.position, 2);
  c = await counts(admin, t, fin);
  assert.equal(c.active, 1); // restou 1 → campeão (colocação 1)
  const r3 = await elim(admin, t, fin);
  assert.equal(r3.status, 409);
  // desfazer a última eliminação devolve o jogador
  const undo = await post(admin, `${base(t)}/eliminations/${r2.body.elimination_id}/cancel`, { reason: 'toque errado' });
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  c = await counts(admin, t, fin);
  assert.equal(c.active, 2);
});

test('item 28: o Chip Race do Dia Final confere contra as fichas das origens encerradas', async () => {
  const { admin, t, s, chip } = await scene(['Dia 1A', 'Dia Final']);
  const { Binder } = require('../models');
  const mv = require('../lib/movements');
  // envia 100 stacks (10 × 1.000) ao 1A pelo livro e encerra o dia
  const binder = await Binder.create({ name: 'F1', code: 'F1' });
  await mv.postBatch([{ type: 'ASSEMBLY', chip_id: chip._id, quantity: 2000, from: { kind: 'external' }, to: { kind: 'binder', id: binder._id }, reason: 'montagem' }], { user: { name: 'x' } });
  await mv.postBatch([{ type: 'SEND_BUY_IN', chip_id: chip._id, quantity: 1000, from: { kind: 'binder', id: binder._id }, to: { kind: 'play', id: t._id }, session_id: s['Dia 1A']._id }], { user: { name: 'x' } });
  await enter(admin, t, s['Dia 1A'], 4);
  await finish(admin, t, s['Dia 1A'], 4);
  const fin = s['Dia Final'];
  assert.equal((await mv.playBalances({ tournament_id: t._id, session_id: fin._id })).find((r) => String(r.chip_id) === String(chip._id))?.quantity, 1000);
  // o Final devolve fichas ao fichário (como uma troca faria): antes era recusado por saldo 0 na sessão
  const r = await mv.postBatch([{ type: 'RETURN', chip_id: chip._id, quantity: 400, from: { kind: 'play', id: t._id }, to: { kind: 'binder', id: binder._id }, session_id: fin._id }], { user: { name: 'x' } });
  assert.ok(r);
  assert.equal((await mv.playBalances({ tournament_id: t._id, session_id: fin._id })).find((x) => String(x.chip_id) === String(chip._id)).quantity, 600);
  await assert.rejects(mv.postBatch([{ type: 'RETURN', chip_id: chip._id, quantity: 601, from: { kind: 'play', id: t._id }, to: { kind: 'binder', id: binder._id }, session_id: fin._id }], { user: { name: 'x' } }), /insuficiente/i);
});
