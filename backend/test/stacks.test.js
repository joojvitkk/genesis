// G3 — Modelos de Stack por ação, entradas por ação e fichas em jogo (spec §3.4, §7).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { StackModel, Tournament, TournamentEntry, Chip } = require('../models');
const { clockPayload } = require('../lib/tournamentClock');

before(connect);
after(disconnect);
beforeEach(clearDb);

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);

// tabela ilustrativa da spec §3.4 (Buy-in Padrão / Opcional / Reentrada)
async function fixture() {
  const c100 = await makeChip({ value: 100, color: '#000000' });
  const c500 = await makeChip({ value: 500, color: '#ff0000' });
  const c1000 = await makeChip({ value: 1000, color: '#0000ff' });
  const c5000 = await makeChip({ value: 5000, color: '#00ff00' });
  const c25000 = await makeChip({ value: 25000, color: '#ffff00' });
  const admin = await as('admin');
  const stack = await post(admin, '/api/stacks', {
    name: 'Warm Up',
    composition: [
      { chip_id: c100._id, quantities: { buy_in: 10 } },
      { chip_id: c500._id, quantities: { buy_in: 4, optional_buy_in: 4 } },
      { chip_id: c1000._id, quantities: { buy_in: 7, optional_buy_in: 8 } },
      { chip_id: c5000._id, quantities: { buy_in: 8, optional_buy_in: 8 } },
      { chip_id: c25000._id, quantities: { re_entry: 2 } },
    ],
  });
  assert.equal(stack.status, 201, JSON.stringify(stack.body));
  return { c100, c500, c1000, c5000, c25000, admin, stack: stack.body };
}
const newTournament = (h, extra = {}) => post(h, '/api/tournaments', { name: 'T', date: '2026-10-01', ...extra });

// ─── modelos de stack ────────────────────────────────────────────────────────

test('modelo de stack: grade ficha × ação com totais derivados no servidor', async () => {
  const { stack, admin } = await fixture();
  assert.deepEqual(stack.actions.map((a) => a.key), ['buy_in', 'optional_buy_in', 're_entry']);
  assert.equal(stack.composition.length, 5);
  // valor de cada coluna: nunca digitado
  assert.deepEqual(stack.totals, {
    buy_in: 10 * 100 + 4 * 500 + 7 * 1000 + 8 * 5000,
    optional_buy_in: 4 * 500 + 8 * 1000 + 8 * 5000,
    re_entry: 2 * 25000,
  });
  assert.equal(stack.total_value, 50000, 'compat: total_value = coluna do buy-in padrão');

  const list = await get(admin, '/api/stacks');
  assert.equal(list.body[0].totals.buy_in, 50000);
});

test('modelo de stack: total_value/totais enviados pelo cliente são ignorados', async () => {
  const chip = await makeChip({ value: 100 });
  const res = await post(await as('admin'), '/api/stacks', {
    name: 'X', total_value: 999999, totals: { buy_in: 1 }, composition: [{ chip_id: chip._id, quantities: { buy_in: 5 } }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.totals.buy_in, 500);
  assert.equal((await StackModel.findById(res.body._id).lean()).total_value, undefined);
});

test('modelo de stack: ações extras configuráveis e formato antigo (quantity → buy_in)', async () => {
  const chip = await makeChip({ value: 100 });
  const admin = await as('admin');
  const custom = await post(admin, '/api/stacks', {
    name: 'Com VIP', actions: [{ key: 'buy_in', label: 'Padrão' }, { key: 'vip', label: 'VIP' }],
    composition: [{ chip_id: chip._id, quantities: { buy_in: 5, vip: 20 } }],
  });
  assert.equal(custom.status, 201, JSON.stringify(custom.body));
  assert.deepEqual(custom.body.totals, { buy_in: 500, vip: 2000 });

  const legacy = await post(admin, '/api/stacks', { name: 'Antigo', composition: [{ chip_id: chip._id, quantity: 7 }] });
  assert.equal(legacy.status, 201);
  assert.deepEqual(legacy.body.composition[0].quantities, { buy_in: 7 });
});

test('modelo de stack: validações (nome, ficha, quantidade, ação, ficha inativa) e nome único', async () => {
  const chip = await makeChip({ value: 100 });
  const off = await makeChip({ value: 5, color: '#050505' });
  await Chip.updateOne({ _id: off._id }, { active: false });
  const admin = await as('admin');
  const ok = { name: 'A', composition: [{ chip_id: chip._id, quantities: { buy_in: 1 } }] };

  const bad = [
    { ...ok, name: '  ' },
    { name: 'B', composition: [] },
    { name: 'B', composition: [{ chip_id: chip._id, quantities: { buy_in: 0 } }] },
    { name: 'B', composition: [{ chip_id: chip._id, quantities: { buy_in: 1.5 } }] },
    { name: 'B', composition: [{ chip_id: chip._id, quantities: { buy_in: -1 } }] },
    { name: 'B', composition: [{ chip_id: chip._id, quantities: { nao_existe: 1 } }] },
    { name: 'B', composition: [{ chip_id: chip._id, quantities: { buy_in: 1 } }, { chip_id: chip._id, quantities: { buy_in: 2 } }] },
    { name: 'B', composition: [{ chip_id: '64b000000000000000000000', quantities: { buy_in: 1 } }] },
    { name: 'B', composition: [{ chip_id: off._id, quantities: { buy_in: 1 } }] },
    { name: 'B', actions: [{ key: 'Buy In', label: 'x' }], composition: [{ chip_id: chip._id, quantities: {} }] },
  ];
  for (const body of bad) assert.equal((await post(admin, '/api/stacks', body)).status, 400, JSON.stringify(body));
  assert.equal(await StackModel.countDocuments(), 0);

  assert.equal((await post(admin, '/api/stacks', ok)).status, 201);
  assert.equal((await post(admin, '/api/stacks', { ...ok, name: 'a' })).status, 409, 'nome único sem diferenciar maiúsculas');
});

test('modelo de stack: só admin cria/edita/exclui; material e salão apenas leem', async () => {
  const { stack, c100 } = await fixture();
  for (const role of ['material', 'salao']) {
    const h = await as(role);
    const body = { name: 'Z', composition: [{ chip_id: c100._id, quantities: { buy_in: 1 } }] };
    assert.equal((await post(h, '/api/stacks', body)).status, 403, `${role} POST`);
    assert.equal((await put(h, `/api/stacks/${stack._id}`, { name: 'Z' })).status, 403, `${role} PUT`);
    assert.equal((await request(app).delete(`/api/stacks/${stack._id}`).set(h)).status, 403, `${role} DELETE`);
    assert.equal((await get(h, '/api/stacks')).status, 200, `${role} GET`);
  }
  assert.equal(await StackModel.countDocuments(), 1);
});

test('modelo de stack: editar a grade; excluir só se não estiver em uso (soft-delete)', async () => {
  const { stack, admin, c100 } = await fixture();
  const edited = await put(admin, `/api/stacks/${stack._id}`, {
    composition: [{ chip_id: c100._id, quantities: { buy_in: 20, re_entry: 5 } }],
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body.totals, { buy_in: 2000, optional_buy_in: 0, re_entry: 500 });

  const t = await newTournament(admin, { stack_model_id: stack._id });
  assert.equal(t.status, 201);
  const blocked = await request(app).delete(`/api/stacks/${stack._id}`).set(admin);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /em uso/);

  await request(app).delete(`/api/tournaments/${t.body._id}`).set(admin); // soft-delete do torneio
  await Tournament.updateOne({ _id: t.body._id }, { $set: { stack_model_id: null } }).setOptions({ withDeleted: true });
  const ok = await request(app).delete(`/api/stacks/${stack._id}`).set(admin);
  assert.equal(ok.status, 200);
  assert.equal((await get(admin, '/api/stacks')).body.length, 0, 'sai da listagem');
  assert.ok(await StackModel.findById(stack._id).setOptions({ withDeleted: true }), 'mas o registro permanece (soft-delete)');
});

// ─── torneio: stack derivado ─────────────────────────────────────────────────

test('torneio: starting_stack vem do modelo (coluna buy-in) e não pode ser digitado', async () => {
  const { stack, admin } = await fixture();
  const t = await newTournament(admin, { stack_model_id: stack._id, starting_stack: 1, stack_composition: [{ chip_id: stack.composition[0].chip_id._id, per_player: 999 }] });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.starting_stack, 50000);
  assert.equal(t.body.stack_composition, undefined, 'stack_composition (legado) deixou de existir');
  assert.equal(t.body.chips_value_in_play, 0);

  const upd = await put(admin, `/api/tournaments/${t.body._id}`, { starting_stack: 7 });
  assert.equal(upd.body.tournament.starting_stack, 50000);
});

test('torneio: mapeamento de stack por ação valida modelo e ação', async () => {
  const { stack, admin } = await fixture();
  const ghost = '64b000000000000000000000';
  assert.equal((await newTournament(admin, { stack_model_id: ghost })).status, 400);
  assert.equal((await newTournament(admin, { stack_models: [{ action: 'buy_in', stack_model_id: ghost }] })).status, 400);
  assert.equal((await newTournament(admin, { stack_models: [{ action: 'Ação Ruim', stack_model_id: stack._id }] })).status, 400);
  assert.equal((await newTournament(admin, { stack_models: [{ action: 'buy_in', stack_model_id: stack._id }, { action: 'buy_in', stack_model_id: stack._id }] })).status, 400);
  const ok = await newTournament(admin, { stack_models: [{ action: 're_entry', stack_model_id: stack._id }] });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.stack_models[0].action, 're_entry');
});

// ─── entradas por ação + fichas em jogo ──────────────────────────────────────

test('ACEITE: informar 100 buy-ins → necessidade por denominação; valor = ações × valor do stack', async () => {
  const { stack, admin, c100, c500, c1000, c5000, c25000 } = await fixture();
  const t = (await newTournament(admin, { stack_model_id: stack._id })).body;
  const sal = await as('salao'); // o salão registra as ações

  const res = await post(sal, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 100 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.created, 100);
  assert.equal(await TournamentEntry.countDocuments({ tournament_id: t._id, action: 'buy_in' }), 100);
  assert.equal((await Tournament.findById(t._id)).actual_players, 100);

  const r = (await get(sal, `/api/tournaments/${t._id}/chips-in-play`)).body;
  const q = Object.fromEntries(r.rows.map((x) => [x.chip._id, x.quantity]));
  assert.deepEqual(q, { [c100._id]: 1000, [c500._id]: 400, [c1000._id]: 700, [c5000._id]: 800 });
  assert.equal(r.totals.value, 100 * 50000);
  assert.equal(r.counts.buy_in, 100);
  assert.equal(r.rows.find((x) => x.chip._id === String(c100._id)).value, 100 * 1000);
  assert.ok(!(String(c25000._id) in q), 'a ficha só da reentrada não entra sem reentradas');
});

test('buy-in opcional, reentrada e mix de ações somam pelo modelo de cada coluna', async () => {
  const { stack, admin, c500, c25000 } = await fixture();
  const t = (await newTournament(admin, { stack_model_id: stack._id })).body;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 100 });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', action: 'optional_buy_in', quantity: 20 });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 're-entry', quantity: 10 });

  const r = (await get(admin, `/api/tournaments/${t._id}/chips-in-play`)).body;
  const row = (c) => r.rows.find((x) => x.chip._id === String(c._id));
  assert.equal(row(c500).quantity, 100 * 4 + 20 * 4);
  assert.deepEqual(row(c500).by_action, { buy_in: 400, optional_buy_in: 80 });
  assert.equal(row(c25000).quantity, 20);
  assert.deepEqual(r.counts, { buy_in: 100, optional_buy_in: 20, re_entry: 10 });
  const optionalStack = 4 * 500 + 8 * 1000 + 8 * 5000; // coluna "opcional" da tabela da spec
  const reentryStack = 2 * 25000;                       // coluna "reentrada"
  assert.equal(r.totals.value, 100 * 50000 + 20 * optionalStack + 10 * reentryStack);
  assert.equal((await Tournament.findById(t._id)).actual_players, 120, 'buy-in opcional também conta como jogador');
});

test('a ação vem do tipo: valores inválidos são recusados; stack_model_id do cliente é ignorado', async () => {
  const { stack, admin } = await fixture();
  const t = (await newTournament(admin, { stack_model_id: stack._id, addon_value: 100, addon_chips: 1000 })).body;
  const url = `/api/tournaments/${t._id}/entries`;

  assert.equal((await post(admin, url, { type: 're-entry', action: 'buy_in' })).status, 400, 'reentrada só usa re_entry');
  assert.equal((await post(admin, url, { type: 'add-on', action: 'buy_in' })).status, 400);
  assert.equal((await post(admin, url, { type: 'buy-in', action: 're_entry' })).status, 400, 'buy-in não pode virar reentrada');
  assert.equal((await post(admin, url, { type: 'buy-in', action: 'nao_existe' })).status, 400);
  assert.equal((await post(admin, url, { type: 'buy-in', action: 'Bad Key' })).status, 400);
  for (const quantity of [0, -1, 1.5, 501, 'x']) assert.equal((await post(admin, url, { type: 'buy-in', quantity })).status, 400, `quantity ${quantity}`);
  assert.equal(await TournamentEntry.countDocuments(), 0);

  const legacyClient = await post(admin, url, { type: 'buy-in', stack_model_id: '64b000000000000000000000' });
  assert.equal(legacyClient.status, 201, 'cliente antigo (fila offline) não quebra');
  assert.equal(legacyClient.body.action, 'buy_in');
  assert.equal(legacyClient.body.stack_model_id ?? null, null, 'o stack não é mais escolhido por entrada');
});

test('ação extra do modelo (ex.: vip) é aceita como variante de buy-in', async () => {
  const chip = await makeChip({ value: 100 });
  const admin = await as('admin');
  const s = (await post(admin, '/api/stacks', {
    name: 'VIP', actions: [{ key: 'buy_in', label: 'Padrão' }, { key: 'vip', label: 'VIP' }],
    composition: [{ chip_id: chip._id, quantities: { buy_in: 5, vip: 50 } }],
  })).body;
  const t = (await newTournament(admin, { stack_model_id: s._id })).body;
  assert.equal((await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', action: 'vip', quantity: 3 })).status, 201);
  const r = (await get(admin, `/api/tournaments/${t._id}/chips-in-play`)).body;
  assert.equal(r.rows[0].quantity, 150);
  assert.equal(r.actions.find((a) => a.key === 'vip').label, 'VIP');
});

test('ação sem composição vira `uncovered` (aviso) e não distorce o total', async () => {
  const { stack, admin } = await fixture();
  const t = (await newTournament(admin, { stack_model_id: stack._id, addon_value: 100, addon_chips: 5000 })).body;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 2 });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'add-on', quantity: 4 });

  const r = (await get(admin, `/api/tournaments/${t._id}/chips-in-play`)).body;
  assert.deepEqual(r.uncovered.map((u) => [u.action, u.count]), [['add_on', 4]]);
  assert.equal(r.totals.value, 2 * 50000);
  // sem modelo nenhum: tudo é "sem composição"
  const bare = (await newTournament(admin, {})).body;
  await post(admin, `/api/tournaments/${bare._id}/entries`, { type: 'buy-in', quantity: 3 });
  const rb = (await get(admin, `/api/tournaments/${bare._id}/chips-in-play`)).body;
  assert.deepEqual(rb.rows, []);
  assert.deepEqual(rb.uncovered.map((u) => [u.action, u.count]), [['buy_in', 3]]);
});

test('torneio com modelos diferentes por ação usa o modelo mapeado de cada uma', async () => {
  const { stack, admin, c100, c500 } = await fixture();
  const reModel = (await post(admin, '/api/stacks', {
    name: 'Reentrada especial', composition: [{ chip_id: c500._id, quantities: { re_entry: 30 } }],
  })).body;
  const t = (await newTournament(admin, { stack_model_id: stack._id, stack_models: [{ action: 're_entry', stack_model_id: reModel._id }] })).body;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 10 });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 're-entry', quantity: 2 });

  const r = (await get(admin, `/api/tournaments/${t._id}/chips-in-play`)).body;
  const row = (c) => r.rows.find((x) => x.chip._id === String(c._id));
  assert.equal(row(c100).quantity, 100, 'buy-in pelo modelo padrão');
  assert.equal(row(c500).quantity, 10 * 4 + 2 * 30, 'reentrada pelo modelo mapeado (e não pela ficha de 25.000 do padrão)');
  assert.equal(r.actions.find((a) => a.key === 're_entry').stack_model.name, 'Reentrada especial');
});

test('entradas antigas com stack_model_id próprio continuam honradas no cálculo', async () => {
  const { stack, admin, c100, c500 } = await fixture();
  const other = (await post(admin, '/api/stacks', { name: 'Outro', composition: [{ chip_id: c500._id, quantities: { buy_in: 100 } }] })).body;
  const t = (await newTournament(admin, { stack_model_id: stack._id })).body;
  await TournamentEntry.create({ tournament_id: t._id, type: 'buy-in', stack_model_id: other._id }); // sem `action`: entrada pré-G3
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in' });

  const r = (await get(admin, `/api/tournaments/${t._id}/chips-in-play`)).body;
  const row = (c) => r.rows.find((x) => x.chip._id === String(c._id));
  assert.equal(row(c500).quantity, 100 + 4);
  assert.equal(row(c100).quantity, 10, 'só a entrada nova usa o modelo do torneio');
});

test('remover entrada recalcula fichas em jogo, jogadores e o valor do relógio', async () => {
  const { stack, admin } = await fixture();
  const t = (await newTournament(admin, { stack_model_id: stack._id })).body;
  const one = (await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in' })).body;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 4 });
  assert.equal((await Tournament.findById(t._id)).chips_value_in_play, 5 * 50000);

  const del = await post(admin, `/api/tournaments/${t._id}/entries/${one._id}/cancel`, { reason: 'lançada por engano' });
  assert.equal(del.status, 200);
  const fresh = await Tournament.findById(t._id);
  assert.equal(fresh.chips_value_in_play, 4 * 50000);
  assert.equal(fresh.actual_players, 4);
  assert.equal((await get(admin, `/api/tournaments/${t._id}/chips-in-play`)).body.totals.value, 4 * 50000);
});

test('relógio/projeção: "fichas em jogo" inclui reentradas (antes: jogadores × stack inicial)', async () => {
  const { stack, admin } = await fixture();
  const t = (await newTournament(admin, { stack_model_id: stack._id })).body;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 10 });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 're-entry', quantity: 2 });

  const payload = clockPayload(await Tournament.findById(t._id));
  assert.equal(payload.total_chips_in_play, 10 * 50000 + 2 * 50000);
  assert.notEqual(payload.total_chips_in_play, payload.actual_players * payload.starting_stack, 'a conta antiga ignorava a reentrada');
  assert.equal(payload.avg_stack, Math.round(payload.total_chips_in_play / 10));

  // torneio ainda não recalculado (cache nulo) mantém o comportamento anterior
  const legacy = clockPayload({ _id: 'x', actual_players: 12, starting_stack: 20000, chips_value_in_play: null });
  assert.equal(legacy.total_chips_in_play, 240000);
});

test('editar o modelo recalcula os torneios que o usam', async () => {
  const { stack, admin, c100 } = await fixture();
  const t = (await newTournament(admin, { stack_model_id: stack._id })).body;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 10 });
  assert.equal((await Tournament.findById(t._id)).chips_value_in_play, 500000);

  await put(admin, `/api/stacks/${stack._id}`, { composition: [{ chip_id: c100._id, quantities: { buy_in: 30 } }] });
  const fresh = await Tournament.findById(t._id);
  assert.equal(fresh.starting_stack, 3000);
  assert.equal(fresh.chips_value_in_play, 30000);
});

test('mudar o mapeamento do torneio recalcula as fichas em jogo', async () => {
  const { stack, admin, c500 } = await fixture();
  const cheap = (await post(admin, '/api/stacks', { name: 'Barato', composition: [{ chip_id: c500._id, quantities: { buy_in: 1 } }] })).body;
  const t = (await newTournament(admin, { stack_model_id: stack._id })).body;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 10 });
  assert.equal((await Tournament.findById(t._id)).chips_value_in_play, 500000);

  const res = await put(admin, `/api/tournaments/${t._id}`, { stack_models: [{ action: 'buy_in', stack_model_id: cheap._id }] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.tournament.starting_stack, 500);
  assert.equal(res.body.tournament.chips_value_in_play, 5000);
});

test('consolidated-chips (formato antigo) continua funcionando sobre o mesmo cálculo', async () => {
  const { stack, admin } = await fixture();
  const t = (await newTournament(admin, { stack_model_id: stack._id })).body;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 2 });
  const res = await get(admin, `/api/tournaments/${t._id}/consolidated-chips`);
  assert.deepEqual(res.body.map((x) => [x.value, x.quantity]), [[100, 20], [500, 8], [1000, 14], [5000, 16]]);
  assert.equal(res.body[0].color, '#000000');
});

// ─── simulação ───────────────────────────────────────────────────────────────

test('POST /stacks/:id/needs: 100 buy-ins → necessidade por denominação (servidor calcula)', async () => {
  const { stack, admin, c100 } = await fixture();
  const res = await post(admin, `/api/stacks/${stack._id}/needs`, { counts: { buy_in: 100, re_entry: 10, optional_buy_in: 0 } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.rows.find((r) => r.chip._id === String(c100._id)).quantity, 1000);
  assert.equal(res.body.totals.value, 100 * 50000 + 10 * 50000);
  assert.deepEqual(res.body.counts, { buy_in: 100, re_entry: 10 }, 'zeros saem');

  // material e salão também simulam (é leitura), mas com lixo → 400
  for (const role of ['material', 'salao']) {
    assert.equal((await post(await as(role), `/api/stacks/${stack._id}/needs`, { counts: { buy_in: 5 } })).status, 200, role);
  }
  for (const counts of [null, [], { buy_in: -1 }, { buy_in: 1.5 }, { 'Ação Ruim': 3 }, { buy_in: 'x' }, 'texto']) {
    assert.equal((await post(admin, `/api/stacks/${stack._id}/needs`, { counts })).status, 400, JSON.stringify(counts));
  }
  assert.equal((await post(admin, '/api/stacks/64b000000000000000000000/needs', { counts: { buy_in: 1 } })).status, 404);
});

test('POST /tournaments/:id/needs usa os modelos mapeados no torneio', async () => {
  const { stack, admin, c25000 } = await fixture();
  const t = (await newTournament(admin, { stack_model_id: stack._id })).body;
  const res = await post(admin, `/api/tournaments/${t._id}/needs`, { counts: { buy_in: 50, re_entry: 5 } });
  assert.equal(res.status, 200);
  assert.equal(res.body.rows.find((r) => r.chip._id === String(c25000._id)).quantity, 10);
  assert.equal(res.body.totals.value, 55 * 50000);
  assert.equal(await TournamentEntry.countDocuments(), 0, 'simulação não grava nada');
});

test('chips-in-play de torneio inexistente → 404', async () => {
  assert.equal((await get(await as('admin'), '/api/tournaments/64b000000000000000000000/chips-in-play')).status, 404);
});
