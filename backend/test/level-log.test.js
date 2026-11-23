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

// ─── item 3: conferência do floor por nível ──────────────────────────────────
test('3: contagem do floor grava diferença, autor e motivo ligados ao nível e ajusta o active_offset; histórico preservado', async () => {
  const { admin, t, s, clockCmd, logs } = await scene();
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 10, session_id: s['Dia 1A']._id });
  await clockCmd(s['Dia 1A'], 'start');
  const url = `/api/tournaments/${t._id}/active-players`;
  const r = await put(admin, url, { active_players: 8, session_id: s['Dia 1A']._id, reason: 'conferi mesa a mesa' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.active, 8);
  await clockCmd(s['Dia 1A'], 'next');
  await put(admin, url, { active_players: 7, session_id: s['Dia 1A']._id });
  const l = await logs(s['Dia 1A']);
  const [n1, n2] = l.rows;
  assert.equal(n1.floor_counts.length, 1, 'ligado ao nível 1');
  assert.deepEqual([n1.floor_counts[0].counted, n1.floor_counts[0].calculated, n1.floor_counts[0].diff], [8, 10, -2]);
  assert.equal(n1.floor_counts[0].reason, 'conferi mesa a mesa');
  assert.ok(n1.floor_counts[0].user_name);
  assert.equal(n2.floor_counts[0].diff, -1, 'diferença do nível 2 é sobre o valor já ajustado: 8 → 7');
  assert.equal((await TournamentSession.findById(s['Dia 1A']._id)).active_offset, -3);
  assert.equal((await put(await hdr('material'), url, { active_players: 5, session_id: s['Dia 1A']._id })).status, 403, 'só quem opera o Salão confere');
});

// ─── item 4: fechamento do dia ───────────────────────────────────────────────
test('4: resumo do dia (inscritos, classificados, horários, "parou no nível…", pico e níveis) e resumo do torneio', async () => {
  const { admin, t, s, clockCmd } = await scene();
  const A = s['Dia 1A']; const B = s['Dia 1B'];
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 6, session_id: A._id });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 're-entry', quantity: 2, session_id: A._id });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 3, session_id: B._id });
  await clockCmd(A, 'start'); await clockCmd(A, 'next'); await clockCmd(A, 'next');
  await put(admin, sp(t, A), { status: 'running' });
  assert.equal((await put(admin, sp(t, A), { status: 'finished', qualified_count: 5 })).status, 200);
  await put(admin, sp(t, B), { status: 'running' });
  await put(admin, sp(t, B), { status: 'finished', qualified_count: 2 });

  const d = (await get(admin, `${sp(t, A)}/day-summary`)).body;
  assert.deepEqual([d.entries_initial, d.entries_reentries, d.entries_total, d.qualified_count], [6, 2, 8, 5]);
  assert.equal(d.levels_played, 3);
  assert.equal(d.peak_players >= 8, true);
  assert.match(d.stopped, /^parou no nível 3, faltando \d\d:\d\d$/);
  assert.ok(d.started_at && d.ended_at && d.duration_ms >= 0 && d.duration_net_ms <= d.duration_ms);

  await put(admin, `${sp(t, A)}/qualified`, { qualified_count: 4, reason: 'recontagem' });
  assert.equal((await get(admin, `${sp(t, A)}/day-summary`)).body.qualified_log.length, 1, 'histórico de correções');

  const sum = (await get(admin, `/api/tournaments/${t._id}/summary`)).body;
  assert.deepEqual([sum.totals.entries_initial, sum.totals.entries_reentries, sum.totals.qualified], [9, 2, 6]);
  assert.equal(sum.days.length, 2);
  assert.equal(JSON.stringify(sum).includes('R$'), false);
  assert.equal((await get(admin, `/api/tournaments/${t._id}/sessions/000000000000000000000000/day-summary`)).status, 404);
});

// ─── itens 2 e 11: folha digital, previsão com pausas e "Salão agora" ────────
const { forecastRows } = require('../lib/tracking');

test('11: previsão = início real + tempo restante + durações; níveis jogados mostram o horário REAL; pausa desloca a previsão', () => {
  const rows = [
    { row_type: 'level', small_blind: 100, big_blind: 200, duration: 20 },
    { row_type: 'level', small_blind: 200, big_blind: 400, duration: 20 },
    { row_type: 'break', duration: 10, label: 'Break' },
    { row_type: 'end_registration' },
    { row_type: 'level', small_blind: 300, big_blind: 600, duration: 20 },
    { row_type: 'end_day' },
  ];
  const t0 = Date.parse('2026-10-01T18:00:00Z');
  const logs = [{ status: 'closed', row_index: 0, started_at: new Date(t0), ended_at: new Date(t0 + 25 * 60000), duration_ms: 25 * 60000, entries_total: 5, playing: 5 }];
  const view = { current_level: 1, clock_status: 'running', level_started_at: new Date(t0 + 25 * 60000), clock_adjust_seconds: 0, level_offset: 0 };
  const now = t0 + 35 * 60000; // 10 min dentro do nível 2 → faltam 10
  const g = forecastRows(rows, view, logs, null, now);
  assert.equal(g[0].kind, 'actual');
  assert.equal(new Date(g[0].end).getTime(), t0 + 25 * 60000, 'horário real, nunca o previsto');
  assert.equal(g[1].kind, 'current');
  assert.equal(new Date(g[1].end).getTime(), now + 10 * 60000);
  assert.equal(new Date(g[2].start).getTime(), now + 10 * 60000, 'break começa quando o nível atual acaba');
  assert.equal(new Date(g[3].end).getTime(), now + 20 * 60000, 'fim do registro previsto');
  assert.equal(new Date(g[5].end).getTime(), now + 40 * 60000, 'fim do dia previsto');

  // pausado: o tempo restante congela em 10 min; 30 min depois a previsão desliza 30 min
  const paused = { ...view, clock_status: 'paused', paused_at: new Date(now) };
  const later = forecastRows(rows, paused, logs, null, now + 30 * 60000);
  assert.equal(new Date(later[5].end).getTime(), now + 70 * 60000, 'pausado há 30 min: a previsão desliza 30 min junto com o "agora"');
  assert.equal(new Date(forecastRows(rows, paused, logs, null, now)[1].end).getTime(), now + 10 * 60000);
});

test('11: sessão ainda não iniciada prevê a partir do horário da sessão; linhas puladas não têm horário', () => {
  const rows = [{ row_type: 'level', duration: 20 }, { row_type: 'level', duration: 20 }, { row_type: 'level', duration: 20 }];
  const start = new Date('2026-10-01T14:00:00Z');
  const g = forecastRows(rows, { current_level: 0, clock_status: 'stopped', level_started_at: null }, [], start, Date.now());
  assert.deepEqual(g.map((r) => r.kind), ['forecast', 'forecast', 'forecast']);
  assert.equal(new Date(g[2].end).toISOString(), '2026-10-01T15:00:00.000Z');
  const skipped = forecastRows(rows, { current_level: 2, clock_status: 'running', level_started_at: new Date() }, [], start);
  assert.deepEqual(skipped.map((r) => r.kind), ['skipped', 'skipped', 'current']);
});

test('2: folha digital da sessão: cabeçalho sem dinheiro nem stack inicial, grade, rodapé e escopo por torneio', async () => {
  const { admin, t, s, clockCmd } = await scene();
  const A = s['Dia 1A'];
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 4, session_id: A._id });
  await clockCmd(A, 'start'); await clockCmd(A, 'next');
  const r = await get(admin, `${sp(t, A)}/tracking`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body;
  assert.equal(b.sessions.length, 2, 'todas as sessões no cabeçalho');
  assert.equal(b.rows[0].kind, 'actual');
  assert.equal(b.rows[1].kind, 'current');
  assert.equal(b.rows[2].kind, 'forecast');
  assert.equal(b.rows[0].entries_total, 4);
  const text = JSON.stringify(b);
  for (const banned of ['starting_stack', 'buy_in', 'rake', 'bounty', 'R$']) assert.equal(text.includes(banned), false, `não expõe ${banned}`);
  assert.ok(b.day && b.tournament_summary);
  // operador restrito a outro torneio não lê a folha
  const other = await makeUser('salao', { allowed_tournament_ids: ['64b000000000000000000000'] });
  assert.equal((await get({ Authorization: `Bearer ${other.token}` }, `${sp(t, A)}/tracking`)).status, 403);
});

test('9: "Salão agora" lista as sessões em andamento de todos os torneios do escopo, por horário de início, sem misturar', async () => {
  const a = await scene(['Dia 1A', 'Dia 1B']);
  await a.clockCmd(a.s['Dia 1B'], 'start');
  await a.clockCmd(a.s['Dia 1A'], 'start');
  await post(a.admin, `/api/tournaments/${a.t._id}/entries`, { type: 'buy-in', quantity: 2, session_id: a.s['Dia 1B']._id });
  const r = await get(a.admin, '/api/salao/now');
  assert.equal(r.status, 200);
  const running = r.body.filter((x) => x.clock_status === 'running');
  assert.equal(running.length, 2);
  const b = running.find((x) => x.session_name === 'Dia 1B');
  assert.deepEqual([b.entries_total, b.level_number, b.tournament_name], [2, 1, 'Main']);
  assert.equal(running.find((x) => x.session_name === 'Dia 1A').entries_total, 0, 'o lançamento no 1B não altera o 1A');
  const restricted = await makeUser('salao', { allowed_tournament_ids: ['64b000000000000000000000'] });
  assert.equal((await get({ Authorization: `Bearer ${restricted.token}` }, '/api/salao/now')).body.length, 0);
});

test('10: eliminação de um toque (só session_id) elimina a entrada ativa mais recente da SESSÃO e devolve o id para desfazer', async () => {
  const { admin, t, s } = await scene();
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 3, session_id: s['Dia 1A']._id });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 2, session_id: s['Dia 1B']._id });
  const r = await post(admin, `/api/tournaments/${t._id}/eliminations`, { session_id: s['Dia 1A']._id }, { 'Idempotency-Key': 'elim-um-toque-1' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.elimination_id);
  const counts = async (sess) => (await get(admin, `/api/tournaments/${t._id}/headcount?session_id=${sess._id}`)).body.active;
  assert.equal(await counts(s['Dia 1A']), 2);
  assert.equal(await counts(s['Dia 1B']), 2, 'a eliminação no 1A não altera o 1B');
  const undo = await post(admin, `/api/tournaments/${t._id}/eliminations/${r.body.elimination_id}/cancel`, { reason: 'toque errado' });
  assert.equal(undo.status < 300, true, JSON.stringify(undo.body));
  assert.equal(await counts(s['Dia 1A']), 3);
  const empty = await post(admin, `/api/tournaments/${t._id}/eliminations`, { session_id: s['Dia 1B']._id });
  await post(admin, `/api/tournaments/${t._id}/eliminations`, { session_id: s['Dia 1B']._id });
  assert.equal((await post(admin, `/api/tournaments/${t._id}/eliminations`, { session_id: s['Dia 1B']._id })).status >= 400, true, 'sem ativos não elimina');
  assert.equal(empty.status, 201);
});
