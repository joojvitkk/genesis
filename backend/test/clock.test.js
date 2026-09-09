const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Tournament } = require('../models');
const { remainingMs, applyAction, autoAdvance, clockPayload } = require('../lib/tournamentClock');

before(connect);
after(disconnect);
beforeEach(clearDb);

const struct = [
  { row_type: 'level', level: 1, small_blind: 25, big_blind: 50, duration: 20 },
  { row_type: 'level', level: 2, small_blind: 50, big_blind: 100, duration: 20 },
  { row_type: 'break', duration: 10, label: 'Break' },
  { row_type: 'end_registration', label: 'Fim do registro' },
  { row_type: 'level', level: 3, small_blind: 75, big_blind: 150, duration: 20 },
  { row_type: 'end_day', label: 'Fim do dia' },
];

// ─── Lógica pura ────────────────────────────────────────────────────────────
test('remainingMs conta do início do nível', () => {
  const t = { blind_structure: struct, current_level: 0, clock_status: 'running',
    level_started_at: new Date(1000), paused_at: null, clock_adjust_seconds: 0 };
  assert.equal(remainingMs(t, 1000), 20 * 60_000);
  assert.equal(remainingMs(t, 1000 + 60_000), 19 * 60_000);
});

test('pausa congela a contagem', () => {
  const t = { blind_structure: struct, current_level: 0, clock_status: 'paused',
    level_started_at: new Date(0), paused_at: new Date(5 * 60_000), clock_adjust_seconds: 0 };
  // 1h depois ainda mostra 15 min restantes (pausado em 5 min)
  assert.equal(remainingMs(t, 3600_000), 15 * 60_000);
});

test('resume desloca o início pelo tempo pausado', () => {
  const t = { clock_status: 'paused', level_started_at: new Date(0), paused_at: new Date(60_000) };
  const u = applyAction(t, 'resume', { now: 200_000 });
  assert.equal(u.clock_status, 'running');
  assert.equal(u.paused_at, null);
  assert.equal(new Date(u.level_started_at).getTime(), 0 + (200_000 - 60_000));
});

test('adjust soma segundos (aceita negativo)', () => {
  assert.equal(applyAction({ clock_adjust_seconds: 0 }, 'adjust', { seconds: 120 }).clock_adjust_seconds, 120);
  assert.equal(applyAction({ clock_adjust_seconds: 100 }, 'adjust', { seconds: -60 }).clock_adjust_seconds, 40);
});

test('next/prev respeitam os limites', () => {
  const t = { blind_structure: struct, current_level: 0, clock_status: 'running' };
  assert.equal(applyAction(t, 'next', { now: 0 }).current_level, 1);
  assert.equal(applyAction({ ...t, current_level: 0 }, 'prev', { now: 0 }).current_level, 0);
  assert.equal(applyAction({ ...t, current_level: 5 }, 'next', { now: 0 }).current_level, 5);
});

test('ação desconhecida retorna null', () => {
  assert.equal(applyAction({}, 'explodir'), null);
});

test('autoAdvance pula marcadores e para no end_day', () => {
  // no nível 1 (índice 1), tempo esgotado → vai pro break (índice 2)
  let t = { blind_structure: struct, current_level: 1, clock_status: 'running',
    level_started_at: new Date(0), clock_adjust_seconds: 0 };
  let adv = autoAdvance(t, 999_999_999);
  assert.equal(adv.updates.current_level, 2);

  // no break (índice 2) → pula end_registration (3) e vai pro nível 3 (índice 4)
  t = { ...t, current_level: 2 };
  adv = autoAdvance(t, 999_999_999);
  assert.equal(adv.updates.current_level, 4);
  assert.ok(adv.events.some((e) => e.type === 'marker' && e.row_type === 'end_registration'));

  // no último nível (índice 4) → end_day para o relógio
  t = { ...t, current_level: 4 };
  adv = autoAdvance(t, 999_999_999);
  assert.equal(adv.updates.clock_status, 'stopped');
});

test('autoAdvance não faz nada se ainda há tempo ou se parado', () => {
  const running = { blind_structure: struct, current_level: 0, clock_status: 'running', level_started_at: new Date(Date.now()) };
  assert.equal(autoAdvance(running, Date.now()), null);
  assert.equal(autoAdvance({ ...running, clock_status: 'stopped' }, 9e12), null);
});

// ─── Endpoint ──────────────────────────────────────────────────────────────
test('POST /clock: start → running com nível começando agora', async () => {
  const { token } = await makeUser('salao');
  const t = await Tournament.create({ name: 'Etapa', date: new Date(), blind_structure: struct, actual_players: 12, starting_stack: 20000 });

  const res = await request(app).post(`/api/tournaments/${t._id}/clock`)
    .set('Authorization', `Bearer ${token}`).send({ action: 'start' });

  assert.equal(res.status, 200);
  assert.equal(res.body.clock_status, 'running');
  assert.equal(res.body.current_level, 0);
  assert.equal(res.body.total_chips_in_play, 12 * 20000);
  assert.ok(res.body.remaining_ms > 19 * 60_000);

  const fresh = await Tournament.findById(t._id);
  assert.ok(fresh.level_started_at instanceof Date);
});

test('POST /clock: ação inválida → 400', async () => {
  const { token } = await makeUser('salao');
  const t = await Tournament.create({ name: 'X', date: new Date(), blind_structure: struct });
  const res = await request(app).post(`/api/tournaments/${t._id}/clock`)
    .set('Authorization', `Bearer ${token}`).send({ action: 'turbo' });
  assert.equal(res.status, 400);
});

test('POST /clock: pause depois resume mantém o restante aproximado', async () => {
  const { token } = await makeUser('salao');
  const t = await Tournament.create({ name: 'X', date: new Date(), blind_structure: struct });
  const H = { Authorization: `Bearer ${token}` };

  await request(app).post(`/api/tournaments/${t._id}/clock`).set(H).send({ action: 'start' });
  const paused = await request(app).post(`/api/tournaments/${t._id}/clock`).set(H).send({ action: 'pause' });
  assert.equal(paused.body.clock_status, 'paused');
  const remainingWhilePaused = paused.body.remaining_ms;

  await new Promise((r) => setTimeout(r, 80));
  const resumed = await request(app).post(`/api/tournaments/${t._id}/clock`).set(H).send({ action: 'resume' });
  assert.equal(resumed.body.clock_status, 'running');
  assert.ok(Math.abs(resumed.body.remaining_ms - remainingWhilePaused) < 1000);
});

test('POST /clock exige acesso a torneios', async () => {
  const t = await Tournament.create({ name: 'X', date: new Date() });
  const res = await request(app).post(`/api/tournaments/${t._id}/clock`).send({ action: 'start' });
  assert.equal(res.status, 401);
});

test('clockPayload inclui nível atual e próximo', () => {
  const t = { _id: 'x', name: 'T', blind_structure: struct, current_level: 0, clock_status: 'stopped', actual_players: 0, starting_stack: 0 };
  const p = clockPayload(t, 0);
  assert.equal(p.level.big_blind, 50);
  assert.equal(p.next_level.big_blind, 100);
});
