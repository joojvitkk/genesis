// Modo enxuto — itens 4, 13, 14, 22 e 23: nível extra editável, lista de Trackings, "Encerradas hoje" e Tracking das fases herdadas.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser, makeChip } = require('./helpers');
const app = require('../app');
const { SessionLevelLog, BlindChange } = require('../models');

before(async () => { await connect(); await SessionLevelLog.init(); });
after(disconnect);
beforeEach(clearDb);

const hdr = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, u, b) => request(app).post(u).set(h).send(b);
const put = (h, u, b) => request(app).put(u).set(h).send(b);
const del = (h, u) => request(app).delete(u).set(h);
const get = (h, u) => request(app).get(u).set(h);
const rows = () => Array.from({ length: 6 }, (_, i) => ({ row_type: 'level', small_blind: 100 * (i + 1), big_blind: 200 * (i + 1), ante: 0, duration: 20 }));
const sp = (t, s) => `/api/tournaments/${t._id}/sessions/${s._id}`;

async function scene(names = ['Dia 1A', 'Dia Final']) {
  const admin = await hdr('admin');
  const chip = await makeChip({ value: 1000, color: '#0000ff' });
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 10, re_entry: 10 } }] })).body;
  const t = (await post(admin, '/api/tournaments', { name: 'Main', date: '2026-10-01', stack_model_id: stack._id, sessions: names, blind_structure: rows() })).body;
  const s = Object.fromEntries(t.sessions.map((x) => [x.name, x]));
  const clockCmd = (sess, action, seconds) => post(admin, `/api/tournaments/${t._id}/clock`, { action, session_id: sess._id, ...(seconds !== undefined ? { seconds } : {}) });
  return { admin, t, s, clockCmd };
}

test('item 4: nível extra editável e removível enquanto não começou; tudo registrado com autor', async () => {
  const { admin, t, s, clockCmd } = await scene(['Dia 1A', 'Dia 1B']);
  const A = s['Dia 1A'];
  assert.equal((await post(admin, `${sp(t, A)}/blinds/append`, { rows: [{ small_blind: 700, big_blind: 1400, duration: 20 }, { small_blind: 800, big_blind: 1600, duration: 20 }] })).status, 201);
  let sess = (await get(admin, `/api/tournaments/${t._id}/sessions`)).body.find((x) => x._id === A._id);
  assert.equal(sess.blind_structure.length, 8);
  assert.equal(sess.blind_structure[6].label, 'Adicional');
  // edita o primeiro extra
  const ed = await put(admin, `${sp(t, A)}/blinds/extra/6`, { small_blind: 750, big_blind: 1500, ante: 1500, duration: 15 });
  assert.equal(ed.status, 200, JSON.stringify(ed.body));
  sess = (await get(admin, `/api/tournaments/${t._id}/sessions`)).body.find((x) => x._id === A._id);
  assert.deepEqual([sess.blind_structure[6].small_blind, sess.blind_structure[6].ante, sess.blind_structure[6].duration], [750, 1500, 15]);
  // nível da estrutura original não é "extra"
  assert.equal((await put(admin, `${sp(t, A)}/blinds/extra/2`, { small_blind: 1 })).status, 404);
  // inválido
  assert.equal((await put(admin, `${sp(t, A)}/blinds/extra/6`, { small_blind: 900, big_blind: 100 })).status, 400);
  // remove o último extra
  assert.equal((await del(admin, `${sp(t, A)}/blinds/extra/7`)).status, 200);
  sess = (await get(admin, `/api/tournaments/${t._id}/sessions`)).body.find((x) => x._id === A._id);
  assert.equal(sess.blind_structure.length, 7);
  const kinds = (await BlindChange.find({ session_id: A._id }).sort({ at: 1 })).map((c) => [c.kind, !!c.user_name]);
  assert.deepEqual(kinds, [['levels_added', true], ['level_edited', true], ['level_removed', true]]);
  // depois que o relógio passa do nível extra, ele trava
  await clockCmd(A, 'start');
  await clockCmd(A, 'goto', 6);
  assert.equal((await put(admin, `${sp(t, A)}/blinds/extra/6`, { small_blind: 760, big_blind: 1520 })).status, 409);
  assert.equal((await del(admin, `${sp(t, A)}/blinds/extra/6`)).status, 409);
});

test('itens 13 e 14: lista de Trackings com sessões encerradas + filtros; "Encerradas hoje" no Salão agora', async () => {
  const { admin, t, s, clockCmd } = await scene(['Dia 1A', 'Dia 1B']);
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 3, session_id: s['Dia 1A']._id });
  await clockCmd(s['Dia 1A'], 'start');
  await put(admin, sp(t, s['Dia 1A']), { status: 'running' });
  await put(admin, sp(t, s['Dia 1A']), { status: 'finished', qualified_count: 2 });
  const list = (await get(admin, '/api/tracking-sheets')).body;
  assert.equal(list.length, 2);
  const a = list.find((x) => x.session_name === 'Dia 1A');
  assert.deepEqual([a.status, a.entries_total, a.qualified_count, a.tournament_name], ['finished', 3, 2, 'Main']);
  assert.equal((await get(admin, '/api/tracking-sheets?status=finished')).body.length, 1);
  assert.equal((await get(admin, `/api/tracking-sheets?tournament_id=${t._id}`)).body.length, 2);
  assert.equal((await get(admin, '/api/tracking-sheets?date=1999-01-01')).body.length, 0);
  // o Tracking de sessão encerrada continua abrindo
  assert.equal((await get(admin, `${sp(t, s['Dia 1A'])}/tracking`)).status, 200);
  // Salão agora: a sessão encerrada hoje aparece, marcada como encerrada
  const now = (await get(admin, '/api/salao/now')).body;
  const closed = now.find((x) => x.session_name === 'Dia 1A');
  assert.ok(closed, 'encerrada hoje fica no painel');
  assert.deepEqual([closed.ended, closed.status, closed.playing], [true, 'finished', 2]);
  const restricted = await makeUser('salao', { allowed_tournament_ids: ['64b000000000000000000000'] });
  assert.equal((await get({ Authorization: `Bearer ${restricted.token}` }, '/api/tracking-sheets')).body.length, 0);
});

test('itens 22 e 23: resumo do dia traz o valor nominal em jogo; Tracking do Final mostra inscritos acumulados e Jogando preenchido', async () => {
  const { admin, t, s, clockCmd } = await scene();
  const [A, F] = [s['Dia 1A'], s['Dia Final']];
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 5, session_id: A._id });
  await put(admin, sp(t, A), { status: 'running' });
  await put(admin, sp(t, A), { status: 'finished', qualified_count: 4 });
  const sum = (await get(admin, `/api/tournaments/${t._id}/sessions/${A._id}/day-summary`)).body;
  assert.ok(sum.chips_value_at_close >= 0 && Number.isFinite(sum.chips_value_at_close));
  await clockCmd(F, 'start');
  await clockCmd(F, 'next');
  const sheet = (await get(admin, `${sp(t, F)}/tracking`)).body;
  const actual = sheet.rows.filter((r) => r.kind === 'actual' || r.kind === 'current');
  assert.ok(actual.length >= 1);
  assert.deepEqual([sheet.now.playing, sheet.now.entries_total], [4, 5]);
  for (const r of actual) {
    assert.equal(r.entries_total, 5, 'inscritos = acumulado do torneio');
    assert.equal(r.playing, 4, 'jogando preenchido em todos os níveis');
  }
});
