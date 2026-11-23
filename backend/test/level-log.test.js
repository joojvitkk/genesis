// Salão item 13 (idempotência) e item 1 (registro automático por nível).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser, makeChip } = require('./helpers');
const app = require('../app');
const { SessionLevelLog, TournamentSession, IdempotencyKey } = require('../models');
const levelLog = require('../lib/levelLog');

before(async () => { await connect(); await SessionLevelLog.init(); await IdempotencyKey.init(); });
after(disconnect);
beforeEach(clearDb);

const hdr = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, u, b, extra = {}) => request(app).post(u).set(h).set(extra).send(b);
const put = (h, u, b) => request(app).put(u).set(h).send(b);
const get = (h, u) => request(app).get(u).set(h);
const rows = () => Array.from({ length: 6 }, (_, i) => ({ row_type: 'level', small_blind: 100 * (i + 1), big_blind: 200 * (i + 1), ante: 0, duration: 20 }));
const sp = (t, s) => `/api/tournaments/${t._id}/sessions/${s._id}`;

async function scene(names = ['Dia 1A', 'Dia 1B']) {
  const admin = await hdr('admin');
  const chip = await makeChip({ value: 1000, color: '#0000ff' });
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 10, re_entry: 10 } }] })).body;
  const t = (await post(admin, '/api/tournaments', { name: 'Main', date: '2026-10-01', stack_model_id: stack._id, sessions: names, blind_structure: rows() })).body;
  const s = Object.fromEntries(t.sessions.map((x) => [x.name, x]));
  const clockCmd = (sess, action, seconds) => post(admin, `/api/tournaments/${t._id}/clock`, { action, session_id: sess._id, ...(seconds !== undefined ? { seconds } : {}) });
  const logs = async (sess) => (await get(admin, `${sp(t, sess)}/level-log`)).body;
  return { admin, t, s, clockCmd, logs };
}

// ─── item 13: idempotência ───────────────────────────────────────────────────
test('13: reenvio com a mesma Idempotency-Key devolve o mesmo resultado e NÃO repete o lançamento', async () => {
  const { admin, t, s } = await scene();
  const url = `/api/tournaments/${t._id}/entries`;
  const key = { 'Idempotency-Key': 'op-entrada-0001' };
  const a = await post(admin, url, { type: 'buy-in', quantity: 1, session_id: s['Dia 1A']._id }, key);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await post(admin, url, { type: 'buy-in', quantity: 1, session_id: s['Dia 1A']._id }, key);
  assert.equal(b.status, 201);
  assert.equal(b.headers['idempotent-replay'], 'true');
  assert.deepEqual(b.body, a.body);
  const list = (await get(admin, url + `?session_id=${s['Dia 1A']._id}`)).body;
  assert.equal((Array.isArray(list) ? list : list.data).length, 1, 'só uma entrada foi gravada');
});

test('13: toque duplo simultâneo grava UMA entrada; chave reaproveitada em outra operação → 422; falha libera a chave', async () => {
  const { admin, t, s } = await scene();
  const url = `/api/tournaments/${t._id}/entries`;
  const body = { type: 'buy-in', quantity: 1, session_id: s['Dia 1A']._id };
  const res = await Promise.all([1, 2, 3].map(() => post(admin, url, body, { 'Idempotency-Key': 'toque-duplo-01' })));
  assert.equal(res.filter((r) => r.status === 201).length >= 1, true);
  assert.ok(res.every((r) => [201, 409].includes(r.status)));
  const list = (await get(admin, url + `?session_id=${s['Dia 1A']._id}`)).body;
  assert.equal((Array.isArray(list) ? list : list.data).length, 1);

  const other = await post(admin, `/api/tournaments/${t._id}/eliminations`, {}, { 'Idempotency-Key': 'toque-duplo-01' });
  assert.equal(other.status, 422);

  const bad = await post(admin, url, { type: 'invalido' }, { 'Idempotency-Key': 'falha-liberada-01' });
  assert.ok(bad.status >= 400);
  assert.equal(await IdempotencyKey.countDocuments({ key: 'falha-liberada-01' }), 0, 'falha não prende a chave');
  assert.equal((await post(admin, url, { type: 'buy-in', quantity: 1, session_id: s['Dia 1A']._id }, { 'Idempotency-Key': 'falha-liberada-01' })).status, 201);
  assert.equal((await post(admin, url, body, { 'Idempotency-Key': 'x' })).status, 400, 'chave inválida');
});

test('13: o mesmo comando do relógio reenviado não avança o nível duas vezes', async () => {
  const { clockCmd, s, admin, t } = await scene();
  await clockCmd(s['Dia 1A'], 'start');
  const k = { 'Idempotency-Key': 'relogio-next-01' };
  const send = () => post(admin, `/api/tournaments/${t._id}/clock`, { action: 'next', session_id: s['Dia 1A']._id }, k);
  assert.equal((await send()).status, 200);
  assert.equal((await send()).headers['idempotent-replay'], 'true');
  assert.equal((await TournamentSession.findById(s['Dia 1A']._id)).current_level, 1);
});

// ─── item 1: registro por nível ──────────────────────────────────────────────
test('1: iniciar abre o nível 1; próximo nível fecha o anterior (duração real) e abre o novo com os inscritos', async () => {
  const { admin, t, s, clockCmd, logs } = await scene();
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 3, session_id: s['Dia 1A']._id });
  assert.equal((await clockCmd(s['Dia 1A'], 'start')).status, 200);
  let l = await logs(s['Dia 1A']);
  assert.equal(l.rows.length, 1);
  assert.deepEqual([l.rows[0].status, l.rows[0].level_number, l.rows[0].small_blind, l.rows[0].big_blind], ['open', 1, 100, 200]);
  assert.equal(l.rows[0].entries_total, 3);

  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 're-entry', quantity: 1, session_id: s['Dia 1A']._id });
  await clockCmd(s['Dia 1A'], 'next');
  l = await logs(s['Dia 1A']);
  assert.equal(l.rows.length, 2);
  assert.equal(l.rows[0].status, 'closed');
  assert.equal(l.rows[0].close_reason, 'next');
  assert.ok(l.rows[0].duration_ms >= 0 && l.rows[0].ended_at);
  assert.equal(l.rows[0].entries_total, 4, 'o fim do nível 1 já tem a reentrada');
  assert.equal(l.rows[0].at_start.entries_total, 3);
  assert.deepEqual([l.rows[1].status, l.rows[1].level_number, l.rows[1].entries_reentries, l.rows[1].playing], ['open', 2, 1, 4]);
});

test('1: sem duplicidade com o executor e comandos simultâneos; mesma linha não registra duas vezes', async () => {
  const { s, clockCmd, logs } = await scene();
  await clockCmd(s['Dia 1A'], 'start');
  await TournamentSession.updateOne({ _id: s['Dia 1A']._id }, { current_level: 2, level_started_at: new Date() });
  await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? levelLog.onAutoAdvance(s['Dia 1A']._id) : levelLog.reconcile(s['Dia 1A']._id))));
  const l = await logs(s['Dia 1A']);
  assert.equal(l.rows.length, 2, 'nível 1 + nível 3, nunca repetidos');
  assert.equal(l.rows.filter((r) => r.status === 'open').length, 1);
  assert.equal(l.rows[1].level_number, 3);
  assert.equal(new Set(l.rows.map((r) => r.seq)).size, l.rows.length);
});

test('1: pausa não conta na duração; ir para um nível anterior cria novo registro; encerrar a sessão fecha o nível', async () => {
  const { admin, t, s, clockCmd, logs } = await scene();
  await clockCmd(s['Dia 1A'], 'start');
  await clockCmd(s['Dia 1A'], 'pause');
  await new Promise((r) => setTimeout(r, 60));
  await clockCmd(s['Dia 1A'], 'resume');
  let open = (await logs(s['Dia 1A'])).rows[0];
  assert.ok(open.paused_ms >= 50, 'pausa acumulada');
  await clockCmd(s['Dia 1A'], 'next');
  await clockCmd(s['Dia 1A'], 'goto', 0);
  const l = await logs(s['Dia 1A']);
  assert.deepEqual(l.rows.map((r) => [r.level_number, r.status]), [[1, 'closed'], [2, 'closed'], [1, 'open']]);
  assert.ok(l.rows[0].duration_ms < 1000);

  assert.equal((await put(admin, sp(t, s['Dia 1A']), { status: 'running' })).status, 200);
  assert.equal((await put(admin, sp(t, s['Dia 1A']), { status: 'finished', qualified_count: 0 })).status, 200);
  const done = await logs(s['Dia 1A']);
  assert.equal(done.rows.filter((r) => r.status === 'open').length, 0);
  assert.equal(done.rows.at(-1).close_reason, 'session_finished');
});

test('1: sessões paralelas são isoladas; sessão antiga sem registro devolve has_history=false', async () => {
  const { s, clockCmd, logs } = await scene();
  await clockCmd(s['Dia 1A'], 'start');
  await clockCmd(s['Dia 1A'], 'next');
  assert.equal((await logs(s['Dia 1B'])).has_history, false);
  await clockCmd(s['Dia 1B'], 'start');
  assert.equal((await logs(s['Dia 1B'])).rows.length, 1);
  assert.equal((await logs(s['Dia 1A'])).rows.length, 2, 'o 1B não mexeu no 1A');
});

test('1: falha ao gravar o registro não trava o relógio e o reconcile repara', async () => {
  const { s, clockCmd, logs } = await scene();
  const headcount = require('../lib/headcount');
  const orig = headcount.playerCounts;
  headcount.playerCounts = async () => { throw new Error('falha simulada'); };
  try {
    const r = await clockCmd(s['Dia 1A'], 'start');
    assert.equal(r.status, 200, 'o relógio inicia mesmo assim');
  } finally { headcount.playerCounts = orig; }
  assert.equal((await logs(s['Dia 1A'])).has_history, false);
  await levelLog.reconcile(s['Dia 1A']._id);
  assert.equal((await logs(s['Dia 1A'])).rows.length, 1, 'reparado');
});

test('1: correção posterior grava valor novo com motivo e autor e preserva o original', async () => {
  const { admin, t, s, clockCmd, logs } = await scene();
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 5, session_id: s['Dia 1A']._id });
  await clockCmd(s['Dia 1A'], 'start');
  await clockCmd(s['Dia 1A'], 'next');
  const first = (await logs(s['Dia 1A'])).rows[0];
  const bad = await put(admin, `${sp(t, s['Dia 1A'])}/level-log/${first._id}`, { field: 'entries_initial', value: 4 });
  assert.equal(bad.status, 400, 'o motivo é obrigatório');
  const ok = await put(admin, `${sp(t, s['Dia 1A'])}/level-log/${first._id}`, { field: 'entries_initial', value: 4, reason: 'entrada cancelada com atraso' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.entries_initial, 4);
  assert.equal(ok.body.entries_total, 4);
  assert.equal(ok.body.corrections[0].from, 5);
  assert.equal(ok.body.corrections[0].reason, 'entrada cancelada com atraso');
  assert.equal(ok.body.at_start.entries_initial, 5, 'o valor original do início permanece');
});
