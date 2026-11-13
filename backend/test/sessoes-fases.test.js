// Sessões e fases: Tracking Sheet por sessão, número oficial do nível, continuidade (retomar/próximo) e inscrições por sessão.
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

// Níveis 1–40 (duração 20), com um Break de 15 min depois de cada 8 níveis.
const rows = () => Array.from({ length: 40 }, (_, i) => i).flatMap((i) => [
  { row_type: 'level', small_blind: 100 * (i + 1), big_blind: 200 * (i + 1), ante: 0, duration: 20 },
  ...((i + 1) % 8 === 0 ? [{ row_type: 'break', duration: 15, label: 'Break' }] : []),
]);

async function scene(names = ['Dia 1A', 'Dia 1B', 'Dia 2', 'Dia Final']) {
  const admin = await hdr('admin');
  const chip = await makeChip({ value: 1000, color: '#0000ff' });
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 10, re_entry: 10 } }] })).body;
  const t = (await post(admin, '/api/tournaments', { name: 'Main Event', date: '2026-10-01', stack_model_id: stack._id, sessions: names, blind_structure: rows() })).body;
  const s = Object.fromEntries(t.sessions.map((x) => [x.name, x]));
  return { admin, t, s };
}
const sp = (t, sess) => `/api/tournaments/${t._id}/sessions/${sess._id}`;
const clockOf = async (h, t, sess) => (await get(h, `/api/tournaments/${t._id}/clock?session_id=${sess._id}`)).body;
const start = (h, t, sess) => post(h, `/api/tournaments/${t._id}/clock`, { action: 'start', session_id: sess._id });
const gotoIdx = (h, t, sess, i) => post(h, `/api/tournaments/${t._id}/clock`, { action: 'goto', seconds: i, session_id: sess._id });
const finish = async (h, t, sess, q) => {
  await put(h, sp(t, sess), { status: 'running' });
  return put(h, sp(t, sess), { status: 'finished', ...(q === undefined ? {} : { qualified_count: q }) });
};

test('Dia 2 vira CONTINUATION com estrutura própria (níveis 9–16) e inicia direto no Nível 9; classificatórios intactos', async () => {
  const { admin, t, s } = await scene();
  assert.equal((await put(admin, sp(t, s['Dia 2']), { type: 'CONTINUATION' })).status, 200);
  const r = await put(admin, `${sp(t, s['Dia 2'])}/blinds`, { level_from: 9, level_to: 16 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await put(admin, sp(t, s['Dia 1A']), { status: 'running' });
  await start(admin, t, s['Dia 1A']);
  await finish(admin, t, s['Dia 1A'], 3);
  await finish(admin, t, s['Dia 1B'], 2);
  await put(admin, sp(t, s['Dia 2']), { status: 'running' });
  const c = await clockOf(admin, t, s['Dia 2']);
  assert.equal(c.level_number, 9, 'o 1º registro da estrutura da sessão é o Nível 9');
  assert.equal(c.level.small_blind, 900);
  // a estrutura do torneio e a dos classificatórios não mudam
  const a = await clockOf(admin, t, s['Dia 1B']);
  assert.equal(a.level_number, 1);
  assert.equal((await get(admin, `/api/tournaments/${t._id}`)).body.blind_structure.length, rows().length);
  // Break não incrementa: Nível 16 é a última linha de nível da faixa 9–16
  const sess = (await get(admin, `/api/tournaments/${t._id}/sessions`)).body.find((x) => x._id === s['Dia 2']._id);
  assert.equal(sess.blind_structure.filter((x) => x.row_type === 'level').length, 8);
  assert.equal(sess.blind_structure[0].level, 9);
});

test('editar a estrutura do Dia Final não modifica Dia 2 nem classificatórios', async () => {
  const { admin, t, s } = await scene();
  await put(admin, sp(t, s['Dia 2']), { type: 'CONTINUATION' });
  await put(admin, `${sp(t, s['Dia 2'])}/blinds`, { level_from: 9, level_to: 16 });
  const rowsFinal = [{ row_type: 'level', level: 33, small_blind: 7, big_blind: 14, ante: 14, duration: 30 }];
  assert.equal((await put(admin, `${sp(t, s['Dia Final'])}/blinds`, { rows: rowsFinal })).status, 200);
  const list = (await get(admin, `/api/tournaments/${t._id}/sessions`)).body;
  const by = Object.fromEntries(list.map((x) => [x.name, x]));
  assert.equal(by['Dia Final'].blind_structure[0].small_blind, 7);
  assert.equal(by['Dia 2'].blind_structure[0].small_blind, 900);
  assert.equal(by['Dia 1A'].blind_structure.length, 0, 'classificatório continua na estrutura do torneio');
});

test('Dia Final retoma o nível em que a fase anterior parou (com o tempo restante) ou inicia no seguinte', async () => {
  for (const [mode, expected] of [['resume', 12], ['next', 13]]) {
    await clearDb();
    const { admin, t, s } = await scene();
    await put(admin, sp(t, s['Dia 2']), { type: 'CONTINUATION' });
    await put(admin, `${sp(t, s['Dia 2'])}/blinds`, { level_from: 9, level_to: 16 });
    await put(admin, sp(t, s['Dia Final']), { start_mode: mode });
    await put(admin, sp(t, s['Dia 1A']), { status: 'running' });
    await start(admin, t, s['Dia 1A']);
    await finish(admin, t, s['Dia 1A'], 3);
    await finish(admin, t, s['Dia 1B'], 2);
    await put(admin, sp(t, s['Dia 2']), { status: 'running' });
    await start(admin, t, s['Dia 2']);
    await gotoIdx(admin, t, s['Dia 2'], 3); // Nível 12 (a fase termina antes do 16)
    await post(admin, `${sp(t, s['Dia 2']).replace('/sessions/', '/sessions/')}/clock`, { action: 'adjust', seconds: -300 });
    await finish(admin, t, s['Dia 2']);
    const ended = (await get(admin, `/api/tournaments/${t._id}/sessions`)).body.find((x) => x._id === s['Dia 2']._id);
    assert.equal(ended.ended_level_number, 12);
    await start(admin, t, s['Dia Final']);
    const c = await clockOf(admin, t, s['Dia Final']);
    assert.equal(c.level_number, expected, mode);
    assert.equal(c.level.small_blind, expected * 100, 'valores vêm da estrutura selecionada');
    if (mode === 'resume') assert.ok(c.remaining_ms <= 15 * 60_000 && c.remaining_ms > 14 * 60_000, `tempo restante preservado: ${c.remaining_ms}`);
    else assert.ok(c.remaining_ms > 19 * 60_000);
  }
});

test('inscrições por sessão: Dia 2 aceita se configurado; Dia Final bloqueia por padrão; registro fecha no nível configurado', async () => {
  const { admin, t, s } = await scene();
  await put(admin, sp(t, s['Dia 2']), { type: 'CONTINUATION', allow_buyins: true, allow_reentries: false });
  const e = (sess, type) => post(admin, `/api/tournaments/${t._id}/entries`, { type, session_id: sess._id });
  assert.equal((await e(s['Dia 2'], 'buy-in')).status, 201);
  assert.equal((await e(s['Dia 2'], 're-entry')).status, 409);
  assert.equal((await e(s['Dia Final'], 'buy-in')).status, 409);
  // registro encerra após o Nível 2 na classificatória
  await put(admin, sp(t, s['Dia 1A']), { registration_close_level: 2, status: 'running' });
  await start(admin, t, s['Dia 1A']);
  assert.equal((await e(s['Dia 1A'], 'buy-in')).status, 201);
  await gotoIdx(admin, t, s['Dia 1A'], 2); // Nível 3
  assert.equal((await e(s['Dia 1A'], 'buy-in')).status, 409);
});

test('novas inscrições do Dia 2 somam só os novos stacks ao Chip Count herdado (sem duplicar classificados)', async () => {
  const { admin, t, s } = await scene();
  await put(admin, sp(t, s['Dia 2']), { type: 'CONTINUATION', allow_buyins: true });
  for (let i = 0; i < 5; i += 1) await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', session_id: s['Dia 1A']._id });
  await put(admin, sp(t, s['Dia 1A']), { status: 'running' });
  await finish(admin, t, s['Dia 1A'], 5);
  await finish(admin, t, s['Dia 1B'], 0);
  for (let i = 0; i < 2; i += 1) await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', session_id: s['Dia 2']._id });
  const chips = (await get(admin, `/api/tournaments/${t._id}/sessions/${s['Dia 2']._id}/chips-in-play`)).body;
  assert.equal(chips.totals.value, 70_000);
  const h = (await get(admin, `/api/tournaments/${t._id}/headcount?session_id=${s['Dia 2']._id}`)).body;
  assert.equal(h.starting_players, 5);
  assert.equal(h.entries_initial, 2);
  assert.equal(h.active, 7);
});
