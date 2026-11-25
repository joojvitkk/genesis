// Etapa C do modo enxuto: tipo "Dia Único", regras de escolha do tipo e herança só nas fases de continuação.
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
const msg = (r) => r.body.error || r.body.message || '';

async function scene(sessions) {
  const admin = await hdr('admin');
  const chip = await makeChip({ value: 1000, color: '#0000ff' });
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 10, re_entry: 10 } }] })).body;
  const t = (await post(admin, '/api/tournaments', { name: 'High Roller', date: '2026-10-01', stack_model_id: stack._id, ...(sessions ? { sessions } : {}) })).body;
  return { admin, t, stack };
}
const sp = (t, s) => `/api/tournaments/${t._id}/sessions/${s._id}`;
const entry = (admin, t, s) => post(admin, `/api/tournaments/${t._id}/entries`, { player_name: 'A', type: 'buy-in', session_id: s._id });

test('torneio com uma sessão só nasce como Dia Único, qualquer que seja o nome', async () => {
  const { t } = await scene(['Dia Final']);
  assert.equal(t.sessions.length, 1);
  assert.equal(t.sessions[0].type, 'SINGLE');
});

test('sem lista de sessões, o torneio nasce com um Dia Único', async () => {
  const { t } = await scene();
  assert.equal(t.sessions[0].type, 'SINGLE');
});

test('o Dia Único aceita entradas e não é fase herdada', async () => {
  const { admin, t } = await scene();
  const r = await entry(admin, t, t.sessions[0]);
  assert.equal(r.status, 201, msg(r));
  const mat = await get(admin, `/api/tournaments/${t._id}/material?session_id=${t.sessions[0]._id}`);
  assert.notEqual(mat.body.phase, 'final');
});

test('Dia Único não gera classificados ao encerrar nem aceita correção deles', async () => {
  const { admin, t } = await scene();
  const s = t.sessions[0];
  await put(admin, sp(t, s), { status: 'running' });
  const r = await put(admin, sp(t, s), { status: 'finished' });
  assert.equal(r.status, 200);
  assert.equal(r.body.qualified_count, null);
  assert.equal((await put(admin, `${sp(t, s)}/qualified`, { qualified_count: 3, reason: 'x' })).status, 409);
});

test('acrescentar a 2ª sessão converte o Dia Único em Classificatória', async () => {
  const { admin, t } = await scene();
  const r = await post(admin, `/api/tournaments/${t._id}/sessions`, { name: 'Dia 2' });
  assert.equal(r.status, 201, msg(r));
  assert.equal(r.body.type, 'QUALIFIER');
  const { TournamentSession } = require('../models');
  assert.equal((await TournamentSession.findById(t.sessions[0]._id)).type, 'QUALIFIER');
});

test('Dia Final e Continuação só existem com sessão antes (sem origem, recusa)', async () => {
  const { admin, t } = await scene();
  for (const type of ['FINAL', 'CONTINUATION']) {
    const r = await put(admin, sp(t, t.sessions[0]), { type });
    assert.equal(r.status, 409);
    assert.match(msg(r), /sessão antes/);
  }
});

test('mudar o tipo com inscrições: vale Classificatória ↔ Dia Único; bloqueado para Final/Continuação', async () => {
  const { admin, t } = await scene(['Dia 1A', 'Dia 1B']);
  const b = t.sessions[1];
  assert.equal((await entry(admin, t, b)).status, 201);
  assert.equal((await put(admin, sp(t, b), { type: 'SINGLE' })).status, 200);
  assert.equal((await put(admin, sp(t, b), { type: 'QUALIFIER' })).status, 200);
  const blocked = await put(admin, sp(t, b), { type: 'FINAL' });
  assert.equal(blocked.status, 409);
  assert.match(msg(blocked), /inscrições/);
});

test('sem inscrições, o tipo muda livremente (e Final solitária com inscrições é corrigida só entre os tipos próprios)', async () => {
  const { admin, t } = await scene(['Dia 1A', 'Dia 1B']);
  assert.equal((await put(admin, sp(t, t.sessions[1]), { type: 'FINAL' })).status, 200);
  assert.equal((await put(admin, sp(t, t.sessions[1]), { type: 'CONTINUATION' })).status, 200);
});

test('item 10/17: a lista de sessões diz quando buy-in e reentrada não são aceitos (a tela esconde os botões)', async () => {
  const { admin, t } = await scene(['Dia 1A', 'Dia Final']);
  const list = async () => (await get(admin, `/api/tournaments/${t._id}/sessions`)).body;
  const [a, f] = await list();
  assert.equal(a.registration.buy_in_block, null);
  assert.match(f.registration.buy_in_block, /não aceita buy-in/);
  assert.match(f.registration.re_entry_block, /não aceita reentrada/);
  // a direção abre entradas no Dia Final (torneio especial): os bloqueios somem
  await put(admin, sp(t, t.sessions[1]), { allow_buyins: true, allow_reentries: true });
  const f2 = (await list())[1];
  assert.deepEqual([f2.registration.buy_in_block, f2.registration.re_entry_block], [null, null]);
});
