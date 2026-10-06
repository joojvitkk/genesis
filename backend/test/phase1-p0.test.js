// Relatório da fase 1 de testes — P0: nível × intervalo (BUG-02/03), "Iniciar" único (BUG-01),
// inscrições × jogadores ativos (BUG-04/05).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser, makeChip } = require('./helpers');
const app = require('../app');
const { Tournament, TournamentSession, Elimination } = require('../models');
const { clockPayload, applyAction, levelNumber } = require('../lib/tournamentClock');

before(connect);
after(disconnect);
beforeEach(clearDb);

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);

// Warm Up da Tracking Sheet (resumo): break depois do 5, break + fim do registro depois do 10, fim do dia no 16
const lvl = (n, sb, bb) => ({ row_type: 'level', level: n, small_blind: sb, big_blind: bb, duration: 30 });
const WARM_UP = [
  lvl(1, 100, 200), lvl(2, 200, 300), lvl(3, 200, 400), lvl(4, 300, 500), lvl(5, 300, 600),
  { row_type: 'break', duration: 15, label: 'Break 15 min' },
  lvl(6, 400, 800), lvl(7, 500, 1000),
  { row_type: 'break', duration: 60, label: 'Dinner break' },
  { row_type: 'end_registration', label: 'Fim do Registro' },
  lvl(8, 600, 1200),
  { row_type: 'end_day', label: 'Fim do Dia Classificatório' },
];

async function newTournament(admin, extra = {}) {
  const r = await post(admin, '/api/tournaments', { name: 'Warm Up', date: '2026-10-28', start_time: '14:00', blind_structure: WARM_UP, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

test('BUG-02: o nº do nível ignora intervalos — retoma no 6 depois do break do 5 (não no índice 7)', () => {
  assert.equal(levelNumber(WARM_UP, 4), 5);          // nível 5 (300/600)
  assert.equal(levelNumber(WARM_UP, 5), null);       // break: não tem número
  assert.equal(levelNumber(WARM_UP, 6), 6);          // retoma no nível 6 (400/800), e não "7"
  assert.equal(levelNumber(WARM_UP, 8), null);       // dinner break
  assert.equal(levelNumber(WARM_UP, 10), 8);         // depois do dinner + fim do registro
  const p = clockPayload({ _id: 'x', blind_structure: WARM_UP, current_level: 6, clock_status: 'running' });
  assert.equal(p.level_number, 6);
  assert.equal(p.level.big_blind, 800, 'número e blind coincidem com a estrutura');
});

test('BUG-01: Iniciar é idempotente — repetir não reinicia o nível nem o relógio', () => {
  const running = { clock_status: 'running', current_level: 3, level_started_at: new Date(1000) };
  assert.deepEqual(applyAction(running, 'start', { now: 99999 }), {});
  assert.deepEqual(applyAction({ ...running, clock_status: 'paused' }, 'start', { now: 99999 }), {});
  assert.equal(applyAction({ clock_status: 'stopped', current_level: 2 }, 'start', { now: 5 }).current_level, 2);
});

test('BUG-01: iniciar pela sessão, pelo torneio ou pelo relógio chega ao MESMO estado', async () => {
  const admin = await as('admin');
  // 1) pelo botão da sessão
  const a = await newTournament(admin);
  const sa = (await get(admin, `/api/tournaments/${a._id}/sessions`)).body[0];
  assert.equal((await put(admin, `/api/tournaments/${a._id}/sessions/${sa._id}`, { status: 'running' })).status, 200);
  const ta = await Tournament.findById(a._id);
  assert.equal(ta.clock_status, 'running');
  assert.equal(ta.status, 'running');
  const startedAt = ta.level_started_at.getTime();
  // repetir (sessão já rodando → transição inválida) ou pelo relógio não reinicia
  await post(admin, `/api/tournaments/${a._id}/clock`, { action: 'start' });
  assert.equal((await Tournament.findById(a._id)).level_started_at.getTime(), startedAt);

  // 2) pelo botão do torneio (status = running)
  const b = await newTournament(admin);
  assert.equal((await put(admin, `/api/tournaments/${b._id}`, { status: 'running' })).status, 200);
  assert.equal((await Tournament.findById(b._id)).clock_status, 'running');

  // 3) pelo relógio: o torneio também sai de "agendado"
  const c = await newTournament(admin);
  await post(admin, `/api/tournaments/${c._id}/clock`, { action: 'start' });
  const tc = await Tournament.findById(c._id);
  assert.equal(tc.clock_status, 'running');
  assert.equal(tc.status, 'running');
});

test('BUG-04/05: 10 entradas + 2 reentradas, 8 ativos — 12 inscrições, média ÷ 8; eliminar só mexe nos ativos', async () => {
  const admin = await as('admin');
  const t = await newTournament(admin);
  const chip = await makeChip({ value: 50000 });
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 1, re_entry: 1 } }] })).body;
  await put(admin, `/api/tournaments/${t._id}`, { stack_model_id: stack._id });

  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 10 });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 're-entry', quantity: 2 });
  let c = (await get(admin, `/api/tournaments/${t._id}/headcount`)).body;
  assert.deepEqual([c.entries_initial, c.entries_reentries, c.entries_total, c.active], [10, 2, 12, 12]);

  const set = await put(admin, `/api/tournaments/${t._id}/active-players`, { active_players: 8, reason: 'conferência das mesas' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  c = set.body;
  assert.deepEqual([c.entries_total, c.active], [12, 8], 'inscrições seguem 12; ativos 8');
  let payload = clockPayload(await Tournament.findById(t._id));
  assert.equal(payload.actual_players, 8);
  assert.equal(payload.total_chips_in_play, 12 * 50000);
  assert.equal(payload.avg_stack, Math.round(12 * 50000 / 8), 'média usa 8 como divisor');

  // eliminação: ativos 8 → 7; histórico de inscrições e Chip Count intactos
  const entries = (await get(admin, `/api/tournaments/${t._id}/entries`)).body;
  const el = await post(admin, `/api/tournaments/${t._id}/eliminations`, { entry_id: entries[0]._id });
  assert.equal(el.status, 201, JSON.stringify(el.body));
  c = (await get(admin, `/api/tournaments/${t._id}/headcount`)).body;
  assert.deepEqual([c.entries_initial, c.entries_reentries, c.entries_total, c.active], [10, 2, 12, 7]);
  payload = clockPayload(await Tournament.findById(t._id));
  assert.equal(payload.total_chips_in_play, 12 * 50000, 'eliminação não tira fichas do total');
  assert.equal(await TournamentSession.countDocuments({ tournament_id: t._id }) >= 1, true);
  assert.equal(await Elimination.countDocuments({ tournament_id: t._id }), 1);

  // a edição fica rastreada (antes → depois + motivo)
  const { ActivityLog } = require('../models');
  const log = await ActivityLog.findOne({ action: 'Ativos Informados (Salão)' });
  assert.match(log.details, /ativos 12 → 8/);
  assert.match(log.details, /conferência das mesas/);

  // zero ativos: média não aplicável (sem divisão por zero)
  await put(admin, `/api/tournaments/${t._id}/active-players`, { active_players: 0 });
  payload = clockPayload(await Tournament.findById(t._id));
  assert.equal(payload.avg_stack, null);
});

test('BUG-04: não dá para sobrescrever os ativos pelo PUT genérico do torneio', async () => {
  const admin = await as('admin');
  const t = await newTournament(admin);
  await put(admin, `/api/tournaments/${t._id}`, { actual_players: 999 });
  assert.equal((await Tournament.findById(t._id)).actual_players, 0);
});

test('BUG-04: ativos inválidos são recusados', async () => {
  const admin = await as('admin');
  const t = await newTournament(admin);
  for (const bad of [-1, 1.5, 'abc', null]) {
    const r = await put(admin, `/api/tournaments/${t._id}/active-players`, { active_players: bad });
    assert.equal(r.status, 400, `valor ${bad}`);
  }
});

test('editar torneio: identidade (nome, data, horário, fuso) só enquanto AGENDADO; fuso inválido recusado; sem jogadores estimados', async () => {
  const admin = await as('admin');
  const t = await newTournament(admin);
  const ok = await put(admin, `/api/tournaments/${t._id}`, { name: 'Warm Up Editado', date: '2026-11-02', start_time: '15:30', timezone: 'America/Manaus', estimated_players: 99 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const fresh = await Tournament.findById(t._id);
  assert.equal(fresh.name, 'Warm Up Editado');
  assert.equal(fresh.start_time, '15:30');
  assert.equal(fresh.timezone, 'America/Manaus');
  assert.equal(fresh.toObject().estimated_players, undefined, 'campo removido do produto');
  assert.equal(fresh.starts_at.toISOString(), '2026-11-02T19:30:00.000Z', 'starts_at recalculado no novo fuso (UTC−4)');

  assert.equal((await put(admin, `/api/tournaments/${t._id}`, { timezone: 'Marte/Olympus' })).status, 400);

  await put(admin, `/api/tournaments/${t._id}`, { status: 'running' });
  const locked = await put(admin, `/api/tournaments/${t._id}`, { name: 'Outro nome' });
  assert.equal(locked.status, 409);
  assert.match(locked.body.error, /agendados/);
  assert.equal((await put(admin, `/api/tournaments/${t._id}`, { name: 'Warm Up Editado', notes: 'ok' })).status, 200, 'mesmo valor não conta como alteração');
});
