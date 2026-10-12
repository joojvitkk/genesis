// Simulação 2.1 §4/§12 — estado em execução POR SESSÃO: relógios independentes, pausa independente, reentrada por sessão,
// Dia Final (sem buy-in/reentrada; inicia com a soma dos classificados).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser, makeChip } = require('./helpers');
const app = require('../app');
const { Tournament, TournamentSession } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);

const blinds = [
  { row_type: 'level', level: 1, small_blind: 100, big_blind: 200, duration: 20 },
  { row_type: 'level', level: 2, small_blind: 200, big_blind: 400, duration: 20 },
];
async function warmUp(h) {
  const chip = await makeChip({ value: 100 });
  const stack = (await post(h, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 5, re_entry: 5 } }] })).body;
  const t = await post(h, '/api/tournaments', {
    name: 'Warm Up', date: '2026-10-01', blind_structure: blinds, stack_model_id: stack._id,
    sessions: [{ name: 'Dia 1A' }, { name: 'Dia 1B' }, { name: 'Dia Final', type: 'FINAL' }],
  });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  return { t: t.body, s: Object.fromEntries(t.body.sessions.map((x) => [x.name, x])), chip };
}
const clock = (h, t, sid, action, extra = {}) => post(h, `/api/tournaments/${t._id}/sessions/${sid}/clock`, { action, ...extra });
const clockOf = async (h, t, sid) => (await get(h, `/api/tournaments/${t._id}/clock?session_id=${sid}`)).body;

test('sessão "Final" nasce com type FINAL e as demais QUALIFIER', async () => {
  const h = await as();
  const { s } = await warmUp(h);
  assert.deepEqual([s['Dia 1A'].type, s['Dia 1B'].type, s['Dia Final'].type], ['QUALIFIER', 'QUALIFIER', 'FINAL']);
});

test('relógios independentes: iniciar 1A e 1B, pausar só o 1A — o 1B continua correndo', async () => {
  const h = await as();
  const { t, s } = await warmUp(h);
  const [a, b] = [s['Dia 1A']._id, s['Dia 1B']._id];
  assert.equal((await clock(h, t, a, 'start')).status, 200);
  assert.equal((await clock(h, t, b, 'start')).status, 200);
  assert.equal((await clock(h, t, a, 'next')).status, 200); // 1A vai para o nível 2

  assert.equal((await clock(h, t, a, 'pause')).status, 200);
  const [ca, cb] = [await clockOf(h, t, a), await clockOf(h, t, b)];
  assert.equal(ca.clock_status, 'paused');
  assert.equal(cb.clock_status, 'running', 'pausar o 1A não pausa o 1B');
  assert.equal(ca.current_level, 1);
  assert.equal(cb.current_level, 0, 'nível do 1B não mudou');
  assert.equal(ca.session_id, a);
  assert.equal(cb.session_id, b);

  // retomar o 1A também não altera o 1B
  const startedB = (await TournamentSession.findById(b)).level_started_at.getTime();
  await clock(h, t, a, 'resume');
  assert.equal((await TournamentSession.findById(b)).level_started_at.getTime(), startedB);
  assert.equal((await clockOf(h, t, a)).clock_status, 'running');
  // resumo do torneio é derivado: rodando enquanto alguma sessão roda
  await clock(h, t, a, 'pause'); await clock(h, t, b, 'pause');
  assert.equal((await Tournament.findById(t._id)).clock_status, 'paused');
});

test('ação de relógio sem sessão com várias sessões abertas exige session_id (nunca cai na errada)', async () => {
  const h = await as();
  const { t } = await warmUp(h);
  const r = await post(h, `/api/tournaments/${t._id}/clock`, { action: 'start' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /sess/i);
});

test('reentrada lançada no 1B fica só no 1B (entradas, ativos e fichas em jogo do 1A não mudam)', async () => {
  const h = await as();
  const { t, s, chip } = await warmUp(h);
  const [a, b] = [s['Dia 1A']._id, s['Dia 1B']._id];
  await post(h, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 4, session_id: a });
  await post(h, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 3, session_id: b });
  const before = (await get(h, `/api/tournaments/${t._id}/sessions`)).body.find((x) => x._id === a);

  assert.equal((await post(h, `/api/tournaments/${t._id}/entries`, { type: 're-entry', session_id: b })).status, 201);
  const sessions = (await get(h, `/api/tournaments/${t._id}/sessions`)).body;
  const [A, B] = [sessions.find((x) => x._id === a), sessions.find((x) => x._id === b)];
  assert.deepEqual([A.players.entries_initial, A.players.entries_reentries, A.players.active], [4, 0, 4]);
  assert.deepEqual([B.players.entries_initial, B.players.entries_reentries, B.players.active], [3, 1, 4]);
  assert.equal(A.chips_value, before.chips_value, 'fichas em jogo do 1A inalteradas');
  assert.equal(B.chips_value, 4 * 5 * 100);

  // o relógio de cada sessão carrega os SEUS números
  assert.equal((await clockOf(h, t, a)).actual_players, 4);
  assert.equal((await clockOf(h, t, b)).entries_reentries, 1);
  assert.equal((await clockOf(h, t, a)).entries_reentries, 0);
});

test('ativos informados pelo Salão valem para a sessão escolhida', async () => {
  const h = await as();
  const { t, s } = await warmUp(h);
  const [a, b] = [s['Dia 1A']._id, s['Dia 1B']._id];
  await post(h, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 10, session_id: a });
  await post(h, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 10, session_id: b });
  const r = await put(h, `/api/tournaments/${t._id}/active-players`, { active_players: 7, session_id: a });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.active, 7);
  assert.equal((await get(h, `/api/tournaments/${t._id}/headcount?session_id=${b}`)).body.active, 10, 'o 1B segue com 10');
});

test('Dia Final: encerrar classificatórias registra os classificados; a final inicia com a SOMA e não aceita buy-in/reentrada', async () => {
  const h = await as();
  const { t, s } = await warmUp(h);
  const [a, b, f] = [s['Dia 1A']._id, s['Dia 1B']._id, s['Dia Final']._id];
  await post(h, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 12, session_id: a });
  await post(h, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 9, session_id: b });
  await put(h, `/api/tournaments/${t._id}/active-players`, { active_players: 5, session_id: a });

  // 1A: classificados = ativos no encerramento (5)
  const endA = await put(h, `/api/tournaments/${t._id}/sessions/${a}`, { status: 'running' });
  assert.equal(endA.status, 200, JSON.stringify(endA.body));
  const closeA = await put(h, `/api/tournaments/${t._id}/sessions/${a}`, { status: 'finished' });
  assert.equal(closeA.status, 200, JSON.stringify(closeA.body));
  assert.equal(closeA.body.qualified_count, 5);
  // 1B: encerrar informando o número
  await put(h, `/api/tournaments/${t._id}/sessions/${b}`, { status: 'running' });
  const closeB = await put(h, `/api/tournaments/${t._id}/sessions/${b}`, { status: 'finished', qualified_count: 3 });
  assert.equal(closeB.body.qualified_count, 3);
  assert.equal((await clockOf(h, t, a)).clock_status, 'stopped', 'encerrar a sessão para o seu relógio');

  const fin = (await get(h, `/api/tournaments/${t._id}/headcount?session_id=${f}`)).body;
  assert.equal(fin.starting_players, 8, '5 + 3');
  assert.equal(fin.active, 8);
  assert.equal(fin.entries_total, 0);

  for (const type of ['buy-in', 're-entry']) {
    const r = await post(h, `/api/tournaments/${t._id}/entries`, { type, session_id: f });
    assert.equal(r.status, 409, type);
    assert.match(r.body.error, /Final/i);
  }
  // correção auditável dos classificados
  const bad = await put(h, `/api/tournaments/${t._id}/sessions/${b}/qualified`, { qualified_count: 4 });
  assert.equal(bad.status, 400, 'motivo obrigatório');
  const fix = await put(h, `/api/tournaments/${t._id}/sessions/${b}/qualified`, { qualified_count: 4, reason: 'contagem na mesa final' });
  assert.equal(fix.status, 200, JSON.stringify(fix.body));
  assert.equal(fix.body.qualified_log.length, 1);
  assert.equal((await get(h, `/api/tournaments/${t._id}/headcount?session_id=${f}`)).body.starting_players, 9);
});

test('Dia Final: ativos informados e relógio próprios', async () => {
  const h = await as();
  const { t, s } = await warmUp(h);
  const [a, f] = [s['Dia 1A']._id, s['Dia Final']._id];
  await post(h, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 6, session_id: a });
  await put(h, `/api/tournaments/${t._id}/sessions/${a}`, { status: 'running' });
  await put(h, `/api/tournaments/${t._id}/sessions/${a}`, { status: 'finished' });
  const r = await put(h, `/api/tournaments/${t._id}/active-players`, { active_players: 4, session_id: f });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.active, 4);
  assert.equal(r.body.starting_players, 6);
  assert.equal((await clock(h, t, f, 'start')).status, 200);
  assert.equal((await clockOf(h, t, f)).session_type, 'FINAL');
});
