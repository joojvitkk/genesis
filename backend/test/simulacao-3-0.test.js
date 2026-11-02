// Simulação 3.0 — Dia 2/Dia Final herdam fichas e histórico, níveis continuam entre fases, Chip Race sem duplicar saldo e
// estoque físico de fichas KO (sem financeiro).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Allocation, KoMovement } = require('../models');
const { clockPayload } = require('../lib/tournamentClock');
const { clockView } = require('../lib/sessions');

before(async () => { await connect(); await Allocation.init(); });
after(disconnect);
beforeEach(clearDb);

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);
const del = (h, url) => request(app).delete(url).set(h);

const levels = (n) => Array.from({ length: n }, (_, i) => ({ row_type: 'level', small_blind: 100 * (i + 1), big_blind: 200 * (i + 1), ante: 0, duration: 20 }));

async function scene(extra = {}) {
  const c1000 = await makeChip({ value: 1000, color: '#0000ff' });
  const c5000 = await makeChip({ value: 5000, color: '#00ff00' });
  const binder = await makeBinder('LISA 1', [{ chip: c1000, quantity: 5000 }, { chip: c5000, quantity: 5000 }]);
  const admin = await as('admin');
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: c5000._id, quantities: { buy_in: 10, re_entry: 10 } }] })).body;
  const t = (await post(admin, '/api/tournaments', {
    name: 'Warm Up', date: '2026-10-01', stack_model_id: stack._id, sessions: ['Dia 1A', 'Dia 1B', 'Dia Final'],
    blind_structure: [...levels(8), { row_type: 'end_day', label: 'Fim do dia' }, ...levels(4)], ...extra,
  })).body;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id });
  const s = Object.fromEntries(t.sessions.map((x) => [x.name, x]));
  return { admin, t, s, c1000, c5000, binder };
}
const enter = (h, t, session, body = {}) => post(h, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', session_id: session._id, ...body });
const finish = async (h, t, session, qualified) => {
  const cur = (await get(h, `/api/tournaments/${t._id}/sessions`)).body.find((x) => x._id === session._id);
  if (cur.status === 'scheduled') await put(h, `/api/tournaments/${t._id}/sessions/${session._id}`, { status: 'running' });
  return put(h, `/api/tournaments/${t._id}/sessions/${session._id}`, { status: 'finished', qualified_count: qualified });
};
const clockOf = async (h, t, session) => (await get(h, `/api/tournaments/${t._id}/clock?session_id=${session._id}`)).body;

test('Dia Final herda o Chip Count (com Color Up) e o histórico de entradas; não gera stacks novos', async () => {
  const { admin, t, s, c1000, c5000 } = await scene();
  assert.equal((await enter(admin, t, s['Dia 1A'], { quantity: 3 })).status, 201);
  assert.equal((await enter(admin, t, s['Dia 1B'], { quantity: 2 })).status, 201);
  const re = await enter(admin, t, s['Dia 1B'], { type: 're-entry' });
  assert.equal(re.status, 201, JSON.stringify(re.body));
  // as fichas precisam estar no Salão para o Color Up: envio por ação (buy-in) ao 1A
  assert.equal((await post(admin, `/api/tournaments/${t._id}/sends`, { items: [{ action: 'buy_in', count: 3 }], session_id: s['Dia 1A']._id })).status, 201);
  // Color Up no 1A: 2 × 5.000 saem, 10 × 1.000 entram (mesmo valor nominal, outra composição)
  const cu = await post(admin, '/api/conversions', {
    tournament_id: t._id, session_id: s['Dia 1A']._id, type: 'COLOR_UP', outs: [{ chip_id: c5000._id, quantity: 2 }], ins: [{ chip_id: c1000._id, quantity: 10 }],
  });
  assert.equal(cu.status, 201, JSON.stringify(cu.body));
  assert.equal((await finish(admin, t, s['Dia 1A'], 2)).status, 200);
  assert.equal((await finish(admin, t, s['Dia 1B'], 3)).status, 200);

  const sessions = (await get(admin, `/api/tournaments/${t._id}/sessions`)).body;
  const fin = sessions.find((x) => x.type === 'FINAL');
  assert.equal(fin.players.starting_players, 5, '2 + 3 classificados');
  assert.deepEqual(fin.players.inherited, { entries_initial: 5, entries_reentries: 1, entries_total: 6 }, 'histórico somado, só consulta');
  assert.equal(fin.players.entries_total, 0, 'a fase não lança entradas');
  assert.equal(fin.chips_value, 6 * 50000, 'Chip Count herdado — não "classificados × stack inicial" (5 × 50.000)');

  const inPlay = (await get(admin, `/api/tournaments/${t._id}/sessions/${fin._id}/chips-in-play`)).body;
  const q = (chip) => inPlay.rows.find((r) => String(r.chip._id) === String(chip._id))?.quantity;
  assert.equal(q(c5000), 60 - 2);
  assert.equal(q(c1000), 10);

  // o relógio da fase lê a mesma posição: média = Chip Count ÷ jogadores
  const clock = await clockOf(admin, t, fin);
  assert.equal(clock.total_chips_in_play, 300000);
  assert.equal(clock.actual_players, 5);
  assert.equal(clock.avg_stack, 60000);
  assert.equal(clock.entries_initial, 5, 'histórico herdado no cache da fase');
  // nenhum lançamento novo nessa fase
  assert.equal((await enter(admin, t, fin)).status, 409);
});

test('Material do Dia Final: só a posição atual das fichas em jogo (sem envio/stacks disponíveis)', async () => {
  const { admin, t, s } = await scene();
  const e = await enter(admin, t, s['Dia 1A'], { quantity: 2 });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  await finish(admin, t, s['Dia 1A'], 2);
  await finish(admin, t, s['Dia 1B'], 0);
  const m = (await get(admin, `/api/tournaments/${t._id}/material?session_id=${s['Dia Final']._id}`)).body;
  assert.equal(m.phase, 'final');
  assert.equal(m.chip_count.value, 100000);
  assert.deepEqual(m.stacks, []);
  const q = (await get(admin, `/api/tournaments/${t._id}/material?session_id=${s['Dia 1A']._id}`)).body;
  assert.equal(q.phase, 'qualifier');
});

test('Nível: o Dia Final continua do último nível jogável + 1; SB/BB/ante editáveis sem mudar o número', async () => {
  const { admin, t, s } = await scene();
  const A = s['Dia 1A']; const B = s['Dia 1B']; const F = s['Dia Final'];
  await enter(admin, t, A);
  await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'start', session_id: A._id });
  await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'goto', seconds: 7, session_id: A._id }); // linha 7 = Level 8
  await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'start', session_id: B._id });
  await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'goto', seconds: 3, session_id: B._id }); // Level 4
  assert.equal((await clockOf(admin, t, A)).level_number, 8);
  assert.equal((await clockOf(admin, t, B)).level_number, 4, 'relógios independentes');
  await finish(admin, t, A, 1);
  await finish(admin, t, B, 0);

  const c = await clockOf(admin, t, F);
  assert.equal(c.level_number, 9, 'último Level 8 → próximo 9 (sem somar 1A + 1B)');
  assert.equal(c.level.small_blind, 100, 'blinds iniciais = os configurados para o Nível 9 na estrutura (não os do 8)');
  assert.equal(c.level.big_blind, 200);

  const ed = await put(admin, `/api/tournaments/${t._id}/sessions/${F._id}/level`, { small_blind: 1000, big_blind: 2000, ante: 2000 });
  assert.equal(ed.status, 200, JSON.stringify(ed.body));
  assert.equal(ed.body.level_number, 9, 'editar SB/BB/ante não muda o número');
  assert.equal(ed.body.level.small_blind, 1000);
  assert.equal(ed.body.level.ante, 2000);
  assert.equal((await put(admin, `/api/tournaments/${t._id}/sessions/${F._id}/level`, { small_blind: 0 })).status, 400);
  // acrescentar nível; o intervalo (break) e o marcador de fim de dia não incrementam o número
  const ap = await put(admin, `/api/tournaments/${t._id}/sessions/${F._id}/level`, { append: true });
  assert.equal(ap.status, 200);
  const next = await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'next', session_id: F._id });
  assert.equal(next.body.level_number, 10);
  // sessão classificatória usa a estrutura do torneio: sem edição por sessão
  assert.equal((await put(admin, `/api/tournaments/${t._id}/sessions/${A._id}/level`, { small_blind: 5 })).status, 409);
});

test('clockPayload: offset de nível da fase seguinte numera intervalos e marcadores sem incrementar', () => {
  const rows = [{ row_type: 'level', small_blind: 1, big_blind: 2, duration: 1 }, { row_type: 'break', duration: 5 }, { row_type: 'level', small_blind: 2, big_blind: 4, duration: 1 }];
  const p = (cur) => clockPayload({ _id: 'x', blind_structure: rows, level_offset: 16, current_level: cur, clock_status: 'stopped' });
  assert.equal(p(0).level_number, 17);
  assert.equal(p(1).level_number, null, 'break não tem número');
  assert.equal(p(1).next_play_level.level_number, 18);
  assert.equal(p(2).level_number, 18);
  assert.equal(clockView({ _id: 't', blind_structure: rows }, { _id: 's', blind_structure: [] }).level_offset, 0);
});

test('Chip Race: o saldo físico do fichário só muda pelo que foi registrado (sem duplicar)', async () => {
  const { admin, t, s, c1000, c5000, binder } = await scene();
  await enter(admin, t, s['Dia 1A'], { quantity: 2 });
  const before = (await get(admin, `/api/tournaments/${t._id}/material?session_id=${s['Dia 1A']._id}`)).body;
  assert.equal(before.binders.length, 1);
  assert.equal(before.binders[0].balances[String(c1000._id)], 5000);
  await post(admin, '/api/conversions', {
    tournament_id: t._id, session_id: s['Dia 1A']._id, type: 'CHIP_RACE', outs: [{ chip_id: c1000._id, quantity: 4 }, { chip_id: c5000._id, quantity: 1 }], ins: [{ chip_id: c5000._id, quantity: 1 }],
  });
  const after = (await get(admin, `/api/tournaments/${t._id}/material?session_id=${s['Dia 1A']._id}`)).body;
  assert.equal(after.binders[0].balances[String(c1000._id)], 5000, 'o que saiu e não existia em jogo não é presumido');
  assert.ok(binder);
});

// ─── fichas KO ────────────────────────────────────────────────────────────────

test('KO: cadastro físico, torneio KO, envio/retorno, pendência com motivo e fechamento — sem financeiro', async () => {
  const { admin, t, s } = await scene();
  const mat = await as('material');
  const ko = (await post(admin, '/api/ko-chips', { name: 'KO vermelha', color: '#dc2626', quantity: 300 })).body;
  assert.equal(ko.name, 'KO vermelha');
  assert.equal((await post(mat, '/api/ko-chips', { name: 'x', quantity: 1 })).status, 403, 'cadastro é do admin');

  // torneio KO exige a ficha KO
  assert.equal((await put(admin, `/api/tournaments/${t._id}`, { is_ko: true })).status, 400);
  assert.equal((await put(admin, `/api/tournaments/${t._id}`, { is_ko: true, ko_chip_id: ko._id })).status, 200);
  assert.equal((await get(admin, `/api/tournaments/${t._id}/ko`)).body.is_ko, true);

  // 100 buy-ins + 50 reentradas = 150 fichas; cancelada e add-on não contam
  await enter(admin, t, s['Dia 1A'], { quantity: 100 });
  await enter(admin, t, s['Dia 1B'], { type: 're-entry', quantity: 50 });
  await enter(admin, t, s['Dia 1B'], { type: 'add-on' });
  let sum = (await get(admin, `/api/tournaments/${t._id}/ko`)).body;
  assert.equal(sum.distributed, 150);

  assert.equal((await post(mat, `/api/tournaments/${t._id}/ko/send`, { quantity: 301 })).status, 409, 'estoque insuficiente');
  assert.equal((await post(mat, `/api/tournaments/${t._id}/ko/send`, { quantity: 150 })).status, 201);
  assert.equal((await post(mat, `/api/tournaments/${t._id}/ko/return`, { quantity: 151 })).status, 409, 'não devolve mais do que enviou');
  sum = (await post(mat, `/api/tournaments/${t._id}/ko/return`, { quantity: 149 })).body;
  assert.equal(sum.sent, 150); assert.equal(sum.returned, 149);
  assert.equal(sum.pending, 1, '150 × 149 → 1 pendente, não perda');
  assert.equal(sum.ko_chip.stock.available, 300 - 1, 'estoque físico: 1 ficha ainda fora');

  // fechar com pendência exige a conferência com motivo
  assert.equal((await post(mat, `/api/tournaments/${t._id}/ko/close`, {})).status, 409);
  assert.equal((await post(mat, `/api/tournaments/${t._id}/ko/conference`, {})).status, 400, 'motivo obrigatório');
  assert.equal((await post(mat, `/api/tournaments/${t._id}/ko/conference`, { reason: 'Jogador levou de lembrança' })).status, 201);
  // devolução posterior é aceita até o fechamento
  sum = (await post(mat, `/api/tournaments/${t._id}/ko/return`, { quantity: 1 })).body;
  assert.equal(sum.pending, 0);
  assert.equal((await post(mat, `/api/tournaments/${t._id}/ko/close`, {})).status, 201);
  assert.equal((await post(mat, `/api/tournaments/${t._id}/ko/return`, { quantity: 1 })).status, 409, 'etapa fechada');
  assert.equal((await KoMovement.countDocuments({ type: 'CONFERENCE' })), 1);

  // fichas KO não entram no Chip Count
  const inPlay = (await get(admin, `/api/tournaments/${t._id}/chips-in-play`)).body;
  assert.equal(inPlay.rows.length, 1);
  // sem campos monetários
  const json = JSON.stringify((await get(admin, `/api/tournaments/${t._id}/ko`)).body);
  assert.doesNotMatch(json, /R\$|price|prize|payout|money/i);
  assert.equal((await del(admin, `/api/ko-chips/${ko._id}`)).status, 409, 'já usada');
});

test('KO: torneio não-KO recusa movimentos e perfil salão só consulta', async () => {
  const { admin, t } = await scene();
  const mat = await as('material'); const salao = await as('salao');
  assert.equal((await post(mat, `/api/tournaments/${t._id}/ko/send`, { quantity: 1 })).status, 409);
  assert.equal((await get(salao, '/api/ko-chips')).status, 200);
  assert.equal((await post(salao, `/api/tournaments/${t._id}/ko/send`, { quantity: 1 })).status, 403);
  assert.ok(admin);
});
