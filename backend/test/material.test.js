// G6 — envio/retorno de fichas e Chip Race / Color Up (spec §6, §8, §18.4).
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Allocation, Binder, Chip, Conversion, Movement, Tournament } = require('../models');
const mv = require('../lib/movements');

before(async () => { await connect(); await Allocation.init(); await Conversion.init(); });
after(disconnect);
beforeEach(clearDb);
afterEach(() => mv._setTransactionMode(null));

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);
const del = (h, url) => request(app).delete(url).set(h);

const bal = (binder, chip) => mv.balanceAt({ kind: 'binder', id: binder._id }, chip._id);
const onTable = async (t, chip) => (await mv.playBalances({ tournament_id: t._id, chip_id: chip._id }))[0]?.quantity || 0;

// fichário com estoque, modelo de stack e torneio com o fichário INTEIRO alocado
async function scene({ allocate = true } = {}) {
  const c = {};
  for (const [v, color] of [[100, '#000000'], [500, '#ff0000'], [1000, '#0000ff'], [5000, '#00ff00']]) c[v] = await makeChip({ value: v, color });
  const binder = await makeBinder('LISA 1', [
    { chip: c[100], quantity: 5000 }, { chip: c[500], quantity: 2000 }, { chip: c[1000], quantity: 1000 }, { chip: c[5000], quantity: 500 },
  ]);
  const admin = await as('admin');
  const stack = (await post(admin, '/api/stacks', {
    name: 'Warm Up', actions: [{ key: 'buy_in', label: 'Buy-in' }, { key: 'optional_buy_in', label: 'Opcional' }, { key: 're_entry', label: 'Reentrada' }, { key: 'add_on', label: 'Add-on' }],
    composition: [
      { chip_id: c[100]._id, quantities: { buy_in: 10, re_entry: 5 } },
      { chip_id: c[500]._id, quantities: { buy_in: 4, optional_buy_in: 4 } },
      { chip_id: c[1000]._id, quantities: { buy_in: 7, optional_buy_in: 8, add_on: 3 } },
      { chip_id: c[5000]._id, quantities: { buy_in: 2, optional_buy_in: 2 } },
    ],
  })).body;
  const t = (await post(admin, '/api/tournaments', { name: 'Warm Up', date: '2026-10-01', stack_model_id: stack._id, addon_value: 100, addon_chips: 3000 })).body;
  const tournament = await Tournament.findById(t._id);
  if (allocate) {
    const a = await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'binder' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
  }
  return { c, binder, admin, stack, t, tournament, mat: await as('material') };
}
const send = (h, t, body) => post(h, `/api/tournaments/${t._id}/sends`, body);
const allocRow = async (binder, chip) => (await get(await as('admin'), `/api/allocations/matrix?binder_id=${binder._id}`)).body.chips.find((r) => r.chip._id === String(chip._id));

// ─── envio ───────────────────────────────────────────────────────────────────

test('envio por AÇÃO: 100 buy-ins → o stack calcula as fichas e elas saem do fichário para o jogo', async () => {
  const { c, binder, mat, tournament } = await scene();
  const res = await send(mat, tournament, { items: [{ action: 'buy_in', count: 100 }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const byChip = Object.fromEntries(res.body.movements.map((m) => [m.chip_id, m.quantity]));
  assert.deepEqual(byChip, { [c[100]._id]: 1000, [c[500]._id]: 400, [c[1000]._id]: 700, [c[5000]._id]: 200 });
  for (const m of res.body.movements) {
    assert.equal(m.type, 'SEND_BUY_IN');
    assert.deepEqual([m.from.kind, m.to.kind, String(m.to.id)], ['binder', 'play', String(tournament._id)]);
    assert.equal(String(m.tournament_id), String(tournament._id));
    assert.equal(m.meta.action, 'buy_in');
  }

  assert.equal(await bal(binder, c[100]), 4000);
  assert.equal(await onTable(tournament, c[100]), 1000);
  assert.equal(await onTable(tournament, c[5000]), 200);
});

test('tipos de envio por ação: opcional, reentrada e as demais colunas (adicional)', async () => {
  const { mat, tournament } = await scene();
  const res = await send(mat, tournament, { items: [{ action: 'optional_buy_in', count: 2 }, { action: 're_entry', count: 3 }, { action: 'add_on', count: 4 }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const types = new Set(res.body.movements.map((m) => m.type));
  assert.deepEqual([...types].sort(), ['SEND_ADDITIONAL', 'SEND_OPTIONAL', 'SEND_REENTRY']);
  assert.equal(res.body.movements.find((m) => m.type === 'SEND_ADDITIONAL').meta.action, 'add_on');
  assert.equal(res.body.movements.find((m) => m.type === 'SEND_REENTRY').quantity, 15, '3 reentradas × 5 fichas de 100');
});

test('envio avulso ("adicional"): fichas informadas à mão', async () => {
  const { c, binder, mat, tournament } = await scene();
  const res = await send(mat, tournament, { chips: [{ chip_id: c[500]._id, quantity: 50 }], reason: 'reposição na mesa 3' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual([res.body.movements[0].type, res.body.movements[0].reason], ['SEND_ADDITIONAL', 'reposição na mesa 3']);
  assert.equal(await bal(binder, c[500]), 1950);
});

test('enviar CONSOME a reserva: o "livre" do fichário não muda e o restante da alocação cai', async () => {
  const { c, binder, mat, tournament } = await scene();
  const before = await allocRow(binder, c[100]);
  assert.deepEqual([before.balance, before.allocated_total, before.free], [5000, 5000, 0]);

  await send(mat, tournament, { items: [{ action: 'buy_in', count: 100 }] }); // 1.000 fichas de 100
  const after = await allocRow(binder, c[100]);
  assert.equal(after.balance, 4000);
  assert.equal(after.allocated_total, 4000, 'restante reservado = alocado 5000 − enviado 1000');
  assert.equal(after.free, 0, 'o livre continua zero: nada foi "liberado" nem "faltando" por enviar');
  assert.deepEqual([after.allocated[0].allocated, after.allocated[0].sent, after.allocated[0].quantity], [5000, 1000, 4000]);

  const total = await mv.chipTotal(c[100]._id);
  const reserved = (await mv.reservedByChip([c[100]._id])).get(String(c[100]._id)) || 0;
  assert.deepEqual([total, reserved, total - reserved], [4000, 4000, 0], 'saldos derivados');

  const list = (await get(await as('admin'), `/api/allocations?tournament_id=${tournament._id}`)).body[0];
  assert.equal(list.has_shortfall, false, 'enviar não vira "falta"');
  const line = list.chips.find((x) => x.chip_id._id === String(c[100]._id));
  assert.deepEqual([line.quantity, line.sent, line.remaining, line.balance], [5000, 1000, 4000, 4000]);
});

test('envio além do que a alocação reserva → 409 com o que falta; nada é gravado', async () => {
  const { c, mat, tournament, admin, binder } = await scene({ allocate: false });
  // aloca só 300 fichas de 100 (quantidade específica)
  await post(admin, `/api/tournaments/${tournament._id}/allocations`, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[100]._id, quantity: 300 }, { chip_id: c[500]._id, quantity: 1000 }] });
  const before = await Movement.countDocuments();

  const res = await send(mat, tournament, { chips: [{ chip_id: c[100]._id, quantity: 301 }] });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Fichas insuficientes nos fichários alocados/);
  assert.deepEqual([res.body.details[0].requested, res.body.details[0].missing], [301, 1]);
  assert.equal(await Movement.countDocuments(), before);

  // ficha não alocada (5.000) também não sai, mesmo havendo saldo no fichário
  const other = await send(mat, tournament, { chips: [{ chip_id: c[5000]._id, quantity: 1 }] });
  assert.equal(other.status, 409);
  assert.equal(await bal(binder, c[5000]), 500);
  assert.equal((await send(mat, tournament, { chips: [{ chip_id: c[100]._id, quantity: 300 }] })).status, 201, 'o teto exato passa');
});

test('o lote é tudo-ou-nada: um item sem saldo derruba o envio inteiro', async () => {
  const { c, mat, tournament, binder } = await scene();
  const before = await Movement.countDocuments();
  // 5.000: alocado 500; pedir 100 buy-ins (200) + 400 extras ultrapassa
  const res = await send(mat, tournament, { items: [{ action: 'buy_in', count: 100 }], chips: [{ chip_id: c[5000]._id, quantity: 400 }] });
  assert.equal(res.status, 409);
  assert.equal(await Movement.countDocuments(), before, 'nem os itens válidos foram gravados');
  assert.equal(await bal(binder, c[100]), 5000);
});

test('envio sem alocação, ou com fichário não alocado ao torneio → 409', async () => {
  const { mat, tournament, c, admin } = await scene({ allocate: false });
  const none = await send(mat, tournament, { items: [{ action: 'buy_in', count: 1 }] });
  assert.equal(none.status, 409);
  assert.match(none.body.error, /não tem fichas alocadas/);

  const other = await makeBinder('Outro', [{ chip: c[100], quantity: 100 }]);
  await post(admin, `/api/tournaments/${tournament._id}/allocations`, { binder_id: (await Binder.findOne({ name: 'LISA 1' }))._id, mode: 'binder' });
  const wrong = await send(mat, tournament, { chips: [{ chip_id: c[100]._id, quantity: 1 }], binder_id: other._id });
  assert.equal(wrong.status, 409);
  assert.match(wrong.body.error, /não está alocado/);
});

test('envio de vários fichários alocados: sai de cada um até o que ele tem reservado', async () => {
  const { c, mat, tournament, admin, binder } = await scene({ allocate: false });
  const second = await makeBinder('LISA 2', [{ chip: c[100], quantity: 400 }]);
  await post(admin, `/api/tournaments/${tournament._id}/allocations`, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[100]._id, quantity: 600 }] });
  await post(admin, `/api/tournaments/${tournament._id}/allocations`, { binder_id: second._id, mode: 'quantities', chips: [{ chip_id: c[100]._id, quantity: 400 }] });

  const res = await send(mat, tournament, { chips: [{ chip_id: c[100]._id, quantity: 900 }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const from = Object.fromEntries(res.body.movements.map((m) => [String(m.binder_id), m.quantity]));
  assert.deepEqual(from, { [String(binder._id)]: 600, [String(second._id)]: 300 }, 'primeiro esgota a 1ª alocação, depois a 2ª');
  assert.equal(await bal(binder, c[100]), 4400);
  assert.equal(await bal(second, c[100]), 100);
  assert.equal(await onTable(tournament, c[100]), 900);
});

test('validações do envio: ação sem composição, corpo vazio, itens inválidos, torneio encerrado/inexistente', async () => {
  const { mat, tournament, c } = await scene();
  const url = `/api/tournaments/${tournament._id}/sends`;
  const bad = [
    {}, { items: [] }, { items: 'x' }, { items: [{ action: 'buy_in', count: 0 }] }, { items: [{ action: 'buy_in', count: 1.5 }] },
    { items: [{ action: 'Ação Ruim', count: 1 }] }, { chips: [] }, { chips: [{ chip_id: c[100]._id, quantity: 0 }] },
    { chips: [{ chip_id: c[100]._id, quantity: 1 }, { chip_id: c[100]._id, quantity: 2 }] },
  ];
  for (const body of bad) assert.equal((await post(mat, url, body)).status, 400, JSON.stringify(body));
  // ação que existe no modelo mas sem fichas para ela → 400
  const bare = (await post(await as('admin'), '/api/stacks', { name: 'Só buy-in', composition: [{ chip_id: c[100]._id, quantities: { buy_in: 1 } }] })).body;
  await put(await as('admin'), `/api/tournaments/${tournament._id}`, { stack_model_id: bare._id });
  const unc = await send(mat, tournament, { items: [{ action: 're_entry', count: 1 }] });
  assert.equal(unc.status, 400);
  assert.match(unc.body.error, /Sem composição de stack/);

  await Tournament.updateOne({ _id: tournament._id }, { status: 'finished' });
  const closed = await send(mat, tournament, { chips: [{ chip_id: c[100]._id, quantity: 1 }] });
  assert.equal(closed.status, 409);
  assert.match(closed.body.error, /encerrado/);
  assert.equal((await post(mat, '/api/tournaments/64b000000000000000000000/sends', { chips: [{ chip_id: c[100]._id, quantity: 1 }] })).status, 404);
});

test('sessão: envio grava a sessão; várias sessões sem indicar → 400; encerrada → 409', async () => {
  const c = { 100: await makeChip({ value: 100 }) };
  const binder = await makeBinder('B', [{ chip: c[100], quantity: 1000 }]);
  const admin = await as('admin'); const mat = await as('material');
  const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01', sessions: ['Dia 1A', 'Dia 1B'] })).body;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'binder' });
  const [s1, s2] = t.sessions;
  const body = { chips: [{ chip_id: c[100]._id, quantity: 10 }] };

  const amb = await send(mat, t, body);
  assert.equal(amb.status, 400);
  assert.match(amb.body.error, /session_id/);
  const ok = await send(mat, t, { ...body, session_id: s1._id });
  assert.equal(ok.status, 201);
  assert.equal(String(ok.body.movements[0].session_id), String(s1._id));

  await put(admin, `/api/tournaments/${t._id}/sessions/${s2._id}`, { status: 'running' });
  await put(admin, `/api/tournaments/${t._id}/sessions/${s2._id}`, { status: 'finished' });
  const closed = await send(mat, t, { ...body, session_id: s2._id });
  assert.equal(closed.status, 409);
  assert.match(closed.body.error, /encerrada/);

  const perSession = (await get(admin, `/api/tournaments/${t._id}/material?session_id=${s1._id}`)).body;
  assert.equal(perSession.rows[0].on_table, 10);
  assert.equal((await get(admin, `/api/tournaments/${t._id}/material?session_id=${s2._id}`)).body.rows.length, 0);
});

// ─── retorno ─────────────────────────────────────────────────────────────────

test('retorno: em jogo → fichário, por denominação; devolve a reserva ao torneio', async () => {
  const { c, binder, mat, tournament } = await scene();
  await send(mat, tournament, { items: [{ action: 'buy_in', count: 100 }] });

  const res = await post(mat, `/api/tournaments/${tournament._id}/returns`, { binder_id: binder._id, chips: [{ chip_id: c[100]._id, quantity: 300 }, { chip_id: c[5000]._id, quantity: 50 }], reason: 'contagem do fim do dia' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  for (const m of res.body.movements) assert.deepEqual([m.type, m.from.kind, m.to.kind], ['RETURN', 'play', 'binder']);
  assert.equal(await onTable(tournament, c[100]), 700);
  assert.equal(await bal(binder, c[100]), 4300);
  const row = await allocRow(binder, c[100]);
  assert.deepEqual([row.allocated[0].sent, row.allocated[0].quantity, row.free], [700, 4300, 0], 'o que voltou fica reservado ao torneio de novo');
});

test('retorno além do que está em jogo → 409 com o saldo real; nada é gravado', async () => {
  const { c, binder, mat, tournament } = await scene();
  await send(mat, tournament, { chips: [{ chip_id: c[100]._id, quantity: 100 }] });
  const before = await Movement.countDocuments();
  const res = await post(mat, `/api/tournaments/${tournament._id}/returns`, { binder_id: binder._id, chips: [{ chip_id: c[100]._id, quantity: 101 }] });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /jogo no torneio "Warm Up" tem 100/);
  assert.equal(await Movement.countDocuments(), before);
  assert.equal(await onTable(tournament, c[100]), 100);
});

test('retorno: validações e permitido depois de o torneio encerrar', async () => {
  const { c, binder, mat, tournament } = await scene();
  await send(mat, tournament, { chips: [{ chip_id: c[100]._id, quantity: 50 }] });
  const url = `/api/tournaments/${tournament._id}/returns`;
  for (const body of [{}, { binder_id: binder._id }, { binder_id: 'x', chips: [{ chip_id: c[100]._id, quantity: 1 }] }, { binder_id: binder._id, chips: [{ chip_id: c[100]._id, quantity: 0 }] }]) {
    assert.equal((await post(mat, url, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await post(mat, url, { binder_id: '64b000000000000000000000', chips: [{ chip_id: c[100]._id, quantity: 1 }] })).status, 404);

  await Tournament.updateOne({ _id: tournament._id }, { status: 'finished' });
  assert.equal((await post(mat, url, { binder_id: binder._id, chips: [{ chip_id: c[100]._id, quantity: 50 }] })).status, 201, 'devolver depois do fim é normal');
  assert.equal(await onTable(tournament, c[100]), 0);
});

test('estornar um retorno reenvia ao jogo (o estorno respeita o teto e a reserva)', async () => {
  const { c, binder, mat, admin, tournament } = await scene();
  await send(mat, tournament, { chips: [{ chip_id: c[100]._id, quantity: 100 }] });
  const ret = await post(mat, `/api/tournaments/${tournament._id}/returns`, { binder_id: binder._id, chips: [{ chip_id: c[100]._id, quantity: 100 }] });
  assert.equal(await onTable(tournament, c[100]), 0);

  const rev = await post(admin, `/api/movements/${ret.body.movements[0]._id}/reverse`, { reason: 'devolvi a mais' });
  assert.equal(rev.status, 201, JSON.stringify(rev.body));
  assert.equal(await onTable(tournament, c[100]), 100);
  assert.equal(String(rev.body.movements[0].tournament_id), String(tournament._id), 'o estorno mantém o torneio');
  assert.equal((await allocRow(binder, c[100])).free, 0);
});

// ─── Chip Race / Color Up ────────────────────────────────────────────────────

async function raceScene() {
  const s = await scene();
  // coloca 5.000 fichas de 100 e 100 de 500 em jogo (via envio avulso)
  const r = await send(s.mat, s.tournament, { chips: [{ chip_id: s.c[100]._id, quantity: 2000 }, { chip_id: s.c[500]._id, quantity: 100 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return s;
}
const race = (s, body) => post(s.mat, '/api/conversions', { tournament_id: s.tournament._id, type: 'CHIP_RACE', binder_id: s.binder._id, ...body });

test('ACEITE: Chip Race com quebra de +500 — movimenta as fichas e NÃO gera perda física', async () => {
  const s = await raceScene();
  const { c, binder, tournament } = s;
  const res = await race(s, { outs: [{ chip_id: c[100]._id, quantity: 1030 }], ins: [{ chip_id: c[500]._id, quantity: 207 }], note: 'chip race do nível 6' });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  // servidor calcula tudo
  assert.deepEqual([res.body.value_out, res.body.value_in, res.body.math_breakage], [103000, 103500, 500]);
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.binder_id.name, 'LISA 1');

  // movimentos em lote: OUT (em jogo → fichário) e IN (fichário → em jogo)
  const moves = await Movement.find({ batch_id: res.body.movement_batch_id }).sort({ type: 1 });
  assert.deepEqual(moves.map((m) => [m.type, m.from.kind, m.to.kind, m.quantity]), [['CHIP_RACE_IN', 'binder', 'play', 207], ['CHIP_RACE_OUT', 'play', 'binder', 1030]]);
  assert.ok(moves.every((m) => String(m.meta.conversion_id) === String(res.body._id)));

  assert.equal(await onTable(tournament, c[100]), 2000 - 1030);
  assert.equal(await onTable(tournament, c[500]), 100 + 207);
  assert.equal(await bal(binder, c[100]), 5000 - 2000 + 1030);
  assert.equal(await bal(binder, c[500]), 2000 - 100 - 207);

  // a quebra matemática NUNCA vira divergência física
  assert.equal(await Movement.countDocuments({ type: 'LOSS' }), 0);
  assert.equal((await mv.balances({ kind: 'lost' })).length, 0, 'nada em divergência');
  assert.equal(await Movement.countDocuments({ type: 'ADJUSTMENT' }), 0);
});

test('quebra negativa (−500) e zero também são legítimas; Color Up usa os tipos próprios', async () => {
  const s = await raceScene();
  const { c } = s;
  const neg = await race(s, { outs: [{ chip_id: c[100]._id, quantity: 1030 }], ins: [{ chip_id: c[500]._id, quantity: 205 }] });
  assert.equal(neg.body.math_breakage, -500);
  const up = await post(s.mat, '/api/conversions', {
    tournament_id: s.tournament._id, type: 'COLOR_UP', binder_id: s.binder._id,
    outs: [{ chip_id: c[100]._id, quantity: 500 }], ins: [{ chip_id: c[500]._id, quantity: 100 }],
  });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.math_breakage, 0);
  const types = (await Movement.find({ batch_id: up.body.movement_batch_id })).map((m) => m.type).sort();
  assert.deepEqual(types, ['COLOR_UP_IN', 'COLOR_UP_OUT']);
  assert.equal(await Movement.countDocuments({ type: 'LOSS' }), 0);
});

test('ACEITE: conversão e movimentos são imutáveis — editar/excluir → 405; a calculadora antiga foi removida', async () => {
  const s = await raceScene();
  const conv = (await race(s, { outs: [{ chip_id: s.c[100]._id, quantity: 100 }], ins: [{ chip_id: s.c[500]._id, quantity: 20 }] })).body;

  for (const h of [s.admin, s.mat]) {
    const p = await put(h, `/api/conversions/${conv._id}`, { math_breakage: 0 });
    assert.equal(p.status, 405);
    assert.match(p.body.error, /imutáveis/);
    assert.equal((await del(h, `/api/conversions/${conv._id}`)).status, 405);
  }
  const fresh = await Conversion.findById(conv._id);
  assert.equal(fresh.status, 'active');
  assert.equal(await Conversion.countDocuments(), 1);

  // a calculadora antiga (/chip-races) saiu do sistema (G11): as rotas não existem mais
  assert.equal((await post(s.admin, '/api/chip-races', { tournament_id: s.tournament._id })).status, 404);
  assert.equal((await get(s.admin, '/api/chip-races')).status, 404);
});

test('ACEITE: estorno do lote restaura os saldos; o original permanece e a conversão vira "reversed"', async () => {
  const s = await raceScene();
  const { c, binder, tournament } = s;
  const before = { p100: await onTable(tournament, c[100]), p500: await onTable(tournament, c[500]), b100: await bal(binder, c[100]), b500: await bal(binder, c[500]) };
  const conv = (await race(s, { outs: [{ chip_id: c[100]._id, quantity: 1030 }], ins: [{ chip_id: c[500]._id, quantity: 207 }] })).body;
  const movesBefore = await Movement.countDocuments();

  const rev = await post(s.admin, `/api/conversions/${conv._id}/reverse`, { reason: 'lançado na sessão errada' });
  assert.equal(rev.status, 200, JSON.stringify(rev.body));
  assert.deepEqual([rev.body.status, rev.body.reverse_reason, rev.body.reversed_by], ['reversed', 'lançado na sessão errada', 'Test admin']);
  assert.ok(rev.body.reversed_at);

  assert.deepEqual(
    { p100: await onTable(tournament, c[100]), p500: await onTable(tournament, c[500]), b100: await bal(binder, c[100]), b500: await bal(binder, c[500]) },
    before, 'saldos exatamente como antes da conversão');
  assert.equal(await Movement.countDocuments(), movesBefore + 2, 'dois estornos; nada apagado');
  assert.equal(await Movement.countDocuments({ batch_id: conv.movement_batch_id, type: { $ne: 'REVERSAL' } }), 2, 'os originais permanecem');
  assert.equal(await Movement.countDocuments({ type: 'REVERSAL' }), 2);

  const again = await post(s.admin, `/api/conversions/${conv._id}/reverse`, { reason: 'de novo' });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /já foi estornada/);
});

test('estorno: só admin, com motivo; bloqueado se as fichas já foram movimentadas depois', async () => {
  const s = await raceScene();
  const { c, binder, tournament } = s;
  const conv = (await race(s, { outs: [{ chip_id: c[100]._id, quantity: 1000 }], ins: [{ chip_id: c[500]._id, quantity: 200 }] })).body;

  assert.equal((await post(s.mat, `/api/conversions/${conv._id}/reverse`, { reason: 'x' })).status, 403, 'material não estorna');
  assert.equal((await post(await as('salao'), `/api/conversions/${conv._id}/reverse`, { reason: 'x' })).status, 403);
  assert.equal((await post(s.admin, `/api/conversions/${conv._id}/reverse`, {})).status, 400, 'motivo obrigatório');
  assert.equal((await post(s.admin, '/api/conversions/64b000000000000000000000/reverse', { reason: 'x' })).status, 404);

  // devolve TODAS as fichas de 500 que entraram → o estorno da IN não tem mais o que tirar do jogo
  await post(s.mat, `/api/tournaments/${tournament._id}/returns`, { binder_id: binder._id, chips: [{ chip_id: c[500]._id, quantity: await onTable(tournament, c[500]) }] });
  const blocked = await post(s.admin, `/api/conversions/${conv._id}/reverse`, { reason: 'tarde demais' });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Não é possível estornar/);
  assert.equal((await Conversion.findById(conv._id)).status, 'active', 'nada mudou');
  assert.equal(await Movement.countDocuments({ type: 'REVERSAL' }), 0, 'estorno é tudo-ou-nada');
});

test('conversão: o que sai precisa estar em jogo; o que entra, dentro do alocado', async () => {
  const s = await raceScene(); // em jogo: 2000×100 e 100×500
  const { c } = s;
  const before = await Movement.countDocuments();

  const outOver = await race(s, { outs: [{ chip_id: c[100]._id, quantity: 2001 }], ins: [{ chip_id: c[500]._id, quantity: 1 }] });
  assert.equal(outOver.status, 409);
  assert.match(outOver.body.error, /jogo no torneio/);

  const inOver = await race(s, { outs: [{ chip_id: c[100]._id, quantity: 10 }], ins: [{ chip_id: c[5000]._id, quantity: 501 }] });
  assert.equal(inOver.status, 409, 'só há 500 fichas de 5.000 no fichário/alocação');
  assert.match(inOver.body.error, /Fichas insuficientes/);

  assert.equal(await Movement.countDocuments(), before, 'nada gravado');
  assert.equal(await Conversion.countDocuments(), 0, 'o registro só existe junto com o lote');
});

test('conversão: validações de corpo, tipo, fichário e torneio', async () => {
  const s = await raceScene();
  const { c } = s;
  const ok = { outs: [{ chip_id: c[100]._id, quantity: 10 }], ins: [{ chip_id: c[500]._id, quantity: 2 }] };
  const bad = [
    { ...ok, type: 'OUTRO' }, { ...ok, outs: [] }, { ...ok, ins: [] }, { ...ok, outs: [{ chip_id: c[100]._id, quantity: 0 }] },
    { ...ok, ins: [{ chip_id: c[100]._id, quantity: 1 }] },   // mesma ficha nos dois lados
    { ...ok, outs: [{ chip_id: '64b000000000000000000000', quantity: 1 }] },
  ];
  for (const body of bad) assert.equal((await race(s, body)).status, 400, JSON.stringify(body));
  assert.equal((await race(s, { ...ok, binder_id: '64b000000000000000000000' })).status, 404);
  assert.equal((await post(s.mat, '/api/conversions', { ...ok, type: 'CHIP_RACE', tournament_id: '64b000000000000000000000' })).status, 404);
  assert.equal(await Conversion.countDocuments(), 0);

  await Tournament.updateOne({ _id: s.tournament._id }, { status: 'finalized' });
  assert.equal((await race(s, ok)).status, 409, 'torneio encerrado');
});

test('conversão: destino das fichas retiradas — único fichário alocado é o padrão; vários exigem binder_id', async () => {
  const s = await raceScene();
  const { c, tournament, admin } = s;
  const ok = { tournament_id: tournament._id, type: 'CHIP_RACE', outs: [{ chip_id: c[100]._id, quantity: 100 }], ins: [{ chip_id: c[500]._id, quantity: 20 }] };
  const auto = await post(s.mat, '/api/conversions', ok);
  assert.equal(auto.status, 201, JSON.stringify(auto.body));
  assert.equal(auto.body.binder_id.name, 'LISA 1');

  const second = await makeBinder('LISA 2', [{ chip: c[5000], quantity: 10 }]);
  await post(admin, `/api/tournaments/${tournament._id}/allocations`, { binder_id: second._id, mode: 'binder' });
  const ambiguous = await post(s.mat, '/api/conversions', ok);
  assert.equal(ambiguous.status, 400);
  assert.match(ambiguous.body.error, /vários fichários alocados/);
  assert.equal((await post(s.mat, '/api/conversions', { ...ok, binder_id: second._id })).status, 201);
});

test('pré-visualização: a MESMA conta do registro (servidor), sem gravar nada', async () => {
  const s = await raceScene();
  const { c } = s;
  const body = { outs: [{ chip_id: c[100]._id, quantity: 1030 }], ins: [{ chip_id: c[500]._id, quantity: 207 }] };
  const before = await Movement.countDocuments();

  const pv = await post(s.mat, '/api/conversions/preview', body);
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.deepEqual([pv.body.value_out, pv.body.value_in, pv.body.math_breakage], [103000, 103500, 500]);
  assert.equal(pv.body.outs[0].value, 103000);
  assert.equal(await Movement.countDocuments(), before);
  assert.equal(await Conversion.countDocuments(), 0);

  const saved = (await race(s, body)).body;
  assert.deepEqual([saved.value_out, saved.value_in, saved.math_breakage], [pv.body.value_out, pv.body.value_in, pv.body.math_breakage]);
  assert.equal((await post(s.mat, '/api/conversions/preview', { outs: [], ins: [] })).status, 400);
  assert.equal((await post(await as('salao'), '/api/conversions/preview', body)).status, 200, 'o salão pode simular');
});

test('as conversões mudam o que está "em jogo" (esperado): entra o colocado, sai o retirado, com a quebra', async () => {
  const s = await scene();
  const { c, mat, admin, tournament, t } = s;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 100 });
  await send(mat, tournament, { items: [{ action: 'buy_in', count: 100 }] });

  const inPlay = async () => (await get(admin, `/api/tournaments/${t._id}/chips-in-play`)).body;
  const before = await inPlay();
  assert.equal(before.rows.find((r) => r.chip._id === String(c[100]._id)).quantity, 1000);
  assert.equal(before.totals.value, 100 * (1000 + 2000 + 7000 + 10000));

  const conv = (await post(mat, '/api/conversions', {
    tournament_id: t._id, type: 'COLOR_UP', binder_id: s.binder._id,
    outs: [{ chip_id: c[100]._id, quantity: 1000 }], ins: [{ chip_id: c[5000]._id, quantity: 21 }], // 100.000 → 105.000
  })).body;
  assert.equal(conv.math_breakage, 5000);

  const after = await inPlay();
  assert.equal(after.rows.find((r) => r.chip._id === String(c[100]._id)), undefined, 'as fichas de 100 saíram todas de jogo');
  const r5 = after.rows.find((r) => r.chip._id === String(c[5000]._id));
  assert.deepEqual([r5.quantity, r5.conversion], [200 + 21, 21]);
  assert.equal(after.totals.value, before.totals.value + 5000, 'o valor em jogo muda exatamente pela quebra');
  assert.equal((await Tournament.findById(t._id)).chips_value_in_play, after.totals.value, 'o valor do relógio/projeção acompanha a quebra');

  // estornada não conta mais
  await post(admin, `/api/conversions/${conv._id}/reverse`, { reason: 'erro' });
  assert.equal((await inPlay()).totals.value, before.totals.value);
  assert.equal((await Tournament.findById(t._id)).chips_value_in_play, before.totals.value, 'o estorno também recalcula');
});

test('conversões do modelo antigo (legacy) nunca alteram as fichas em jogo', async () => {
  const s = await scene();
  await Conversion.create({
    tournament_id: s.tournament._id, type: 'CHIP_RACE', legacy: true, legacy_id: new (require('mongoose').Types.ObjectId)(),
    outs: [{ chip_id: s.c[100]._id, quantity: 500 }], ins: [{ chip_id: s.c[500]._id, quantity: 100.5 }], value_out: 50000, value_in: 50250, math_breakage: 250,
  });
  await post(s.admin, `/api/tournaments/${s.t._id}/entries`, { type: 'buy-in', quantity: 1 });
  const r = (await get(s.admin, `/api/tournaments/${s.t._id}/chips-in-play`)).body;
  assert.equal(r.rows.find((x) => x.chip._id === String(s.c[100]._id)).quantity, 10);
  assert.equal(r.rows.find((x) => x.chip._id === String(s.c[500]._id)).quantity, 4);
  assert.equal(r.rows.find((x) => x.chip._id === String(s.c[500]._id)).conversion, undefined);
});

test('GET /conversions: filtros e dados populados; detalhe', async () => {
  const s = await raceScene();
  const a = (await race(s, { outs: [{ chip_id: s.c[100]._id, quantity: 100 }], ins: [{ chip_id: s.c[500]._id, quantity: 20 }] })).body;
  await race(s, { outs: [{ chip_id: s.c[100]._id, quantity: 50 }], ins: [{ chip_id: s.c[500]._id, quantity: 10 }] });
  await post(s.admin, `/api/conversions/${a._id}/reverse`, { reason: 'x' });

  const sal = await as('salao');
  const all = (await get(sal, '/api/conversions')).body;
  assert.equal(all.length, 2);
  assert.equal(all[0].tournament_id.name, 'Warm Up');
  assert.equal(all[0].outs[0].chip_id.value, 100);
  assert.equal((await get(sal, '/api/conversions?status=reversed')).body.length, 1);
  assert.equal((await get(sal, `/api/conversions?tournament_id=${s.tournament._id}&status=active`)).body.length, 1);
  assert.equal((await get(sal, `/api/conversions/${a._id}`)).body.status, 'reversed');
  assert.equal((await get(sal, '/api/conversions/64b000000000000000000000')).status, 404);
  assert.equal((await request(app).get('/api/conversions')).status, 401);
});

// ─── resumo ──────────────────────────────────────────────────────────────────

test('resumo: esperado × enviado × devolvido × em jogo × pendente, por ficha', async () => {
  const s = await scene();
  const { c, mat, admin, t, tournament, binder } = s;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 10 }); // esperado: 100×100, 500×40, 1000×70, 5000×20
  await send(mat, tournament, { items: [{ action: 'buy_in', count: 6 }] });                    // enviado: 60/24/42/12
  await post(mat, `/api/tournaments/${t._id}/returns`, { binder_id: binder._id, chips: [{ chip_id: c[100]._id, quantity: 10 }] });

  const sum = (await get(await as('salao'), `/api/tournaments/${t._id}/material`)).body;
  const row = (v) => sum.rows.find((r) => r.chip.value === v);
  assert.deepEqual([row(100).expected, row(100).sent, row(100).returned, row(100).on_table, row(100).pending], [100, 60, 10, 50, 50]);
  assert.deepEqual([row(500).expected, row(500).sent, row(500).on_table, row(500).pending], [40, 24, 24, 16]);
  assert.equal(row(5000).pending, 20 - 12);
  assert.equal(sum.totals.expected_value, 100 * 100 + 40 * 500 + 70 * 1000 + 20 * 5000);
  assert.equal(sum.totals.on_table_value, 50 * 100 + 24 * 500 + 42 * 1000 + 12 * 5000);
  assert.equal(sum.totals.pending_value, sum.totals.expected_value - sum.totals.on_table_value);
  assert.deepEqual(sum.rows.map((r) => r.chip.value), [100, 500, 1000, 5000], 'ordenado pelo valor');
  assert.equal((await get(admin, '/api/tournaments/64b000000000000000000000/material')).status, 404);
});

// ─── reserva, alocação e retiradas ───────────────────────────────────────────

test('a alocação não pode ser reduzida abaixo do que já foi enviado, nem perder uma ficha com envio', async () => {
  const { c, mat, admin, tournament, binder } = await scene({ allocate: false });
  const a = (await post(admin, `/api/tournaments/${tournament._id}/allocations`, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[100]._id, quantity: 1000 }, { chip_id: c[500]._id, quantity: 100 }] })).body;
  await send(mat, tournament, { chips: [{ chip_id: c[100]._id, quantity: 400 }] });

  const below = await put(admin, `/api/allocations/${a._id}`, { chips: [{ chip_id: c[100]._id, quantity: 399 }, { chip_id: c[500]._id, quantity: 100 }] });
  assert.equal(below.status, 409);
  assert.match(below.body.error, /Já foram enviadas 400/);
  const drop = await put(admin, `/api/allocations/${a._id}`, { chips: [{ chip_id: c[500]._id, quantity: 100 }] });
  assert.equal(drop.status, 409, 'não dá para tirar a ficha com envio');
  assert.equal((await put(admin, `/api/allocations/${a._id}`, { chips: [{ chip_id: c[100]._id, quantity: 400 }, { chip_id: c[500]._id, quantity: 100 }] })).status, 200, 'exatamente o enviado pode');
});

test('retirada de estoque do fichário continua limitada ao livre depois de envios', async () => {
  const { c, mat, admin, tournament, binder } = await scene({ allocate: false });
  await post(admin, `/api/tournaments/${tournament._id}/allocations`, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[100]._id, quantity: 3000 }] });
  await send(mat, tournament, { chips: [{ chip_id: c[100]._id, quantity: 1000 }] }); // saldo 4000, reservado restante 2000, livre 2000
  const w = (q) => post(admin, '/api/movements', { type: 'WITHDRAWAL', binder_id: binder._id, chip_id: c[100]._id, quantity: q, reason: 'x' });
  const over = await w(2001);
  assert.equal(over.status, 409);
  assert.match(over.body.error, /2000 estão alocadas.*só 2000 podem sair/);
  assert.equal((await w(2000)).status, 201);
  assert.equal(await bal(binder, c[100]), 2000, 'o reservado ao torneio (2.000) está intacto');
});

test('perda apurada na conferência depois de enviar vira FALTA só do que ainda está reservado', async () => {
  const { c, mat, admin, tournament, binder } = await scene();
  await send(mat, tournament, { chips: [{ chip_id: c[5000]._id, quantity: 100 }] }); // 5.000: saldo 400, reservado 400
  const count = await post(mat, `/api/binders/${binder._id}/count`, { counts: [{ chip_id: c[5000]._id, counted: 390 }], reason: 'caíram 10' });
  assert.equal(count.status, 200, JSON.stringify(count.body));
  const list = (await get(admin, '/api/allocations')).body[0];
  const line = list.chips.find((x) => x.chip_id._id === String(c[5000]._id));
  assert.deepEqual([line.balance, line.remaining, line.shortfall], [390, 400, 10]);
  assert.equal(list.has_shortfall, true);
});

// ─── permissões ──────────────────────────────────────────────────────────────

test('permissões: admin e material registram; o salão só consulta', async () => {
  const { c, binder, tournament, admin } = await scene();
  const body = { chips: [{ chip_id: c[100]._id, quantity: 10 }] };
  const sal = await as('salao');

  assert.equal((await send(sal, tournament, body)).status, 403);
  assert.equal((await post(sal, `/api/tournaments/${tournament._id}/returns`, { binder_id: binder._id, ...body })).status, 403);
  assert.equal((await post(sal, '/api/conversions', { tournament_id: tournament._id, type: 'CHIP_RACE', outs: body.chips, ins: [{ chip_id: c[500]._id, quantity: 1 }] })).status, 403);
  assert.equal(await Movement.countDocuments({ type: { $ne: 'ASSEMBLY' } }), 0);

  for (const h of [admin, await as('material')]) assert.equal((await send(h, tournament, body)).status, 201);
  assert.equal((await get(sal, `/api/tournaments/${tournament._id}/material`)).status, 200);
  assert.equal((await request(app).post(`/api/tournaments/${tournament._id}/sends`).send(body)).status, 401);
});

// ─── movimentos: regras de origem/destino ────────────────────────────────────

test('regras de localização: envio só fichário → jogo; retorno só jogo → fichário; jogo exige um torneio', async () => {
  const { c, binder, tournament } = await scene();
  const base = { chip_id: c[100]._id, quantity: 1 };
  const play = { kind: 'play', id: tournament._id }; const bin = { kind: 'binder', id: binder._id };
  const wrong = [
    { type: 'SEND_BUY_IN', from: play, to: bin }, { type: 'SEND_BUY_IN', from: { kind: 'external' }, to: play },
    { type: 'RETURN', from: bin, to: play }, { type: 'CHIP_RACE_OUT', from: bin, to: play }, { type: 'COLOR_UP_IN', from: play, to: bin },
    { type: 'SEND_ADDITIONAL', from: bin, to: { kind: 'play', id: 'lixo' } },
  ];
  for (const w of wrong) await assert.rejects(mv.postBatch([{ ...base, ...w }]), /incompatíveis|inválido/, JSON.stringify(w));
  await assert.rejects(mv.postBatch([{ ...base, type: 'SEND_BUY_IN', from: bin, to: { kind: 'play', id: '64b000000000000000000000' } }]), /Torneio não encontrado/);
  assert.equal(await Movement.countDocuments({ type: { $ne: 'ASSEMBLY' } }), 0);
});

test('conservação: fichas em fichários + em jogo = montadas (nenhum envio/retorno/conversão cria ou some fichas)', async () => {
  const s = await scene();
  const { c, mat, admin, binder, t, tournament } = s;
  await send(mat, tournament, { items: [{ action: 'buy_in', count: 30 }] });
  await race(s, { outs: [{ chip_id: c[100]._id, quantity: 100 }], ins: [{ chip_id: c[500]._id, quantity: 20 }] });
  await post(mat, `/api/tournaments/${t._id}/returns`, { binder_id: binder._id, chips: [{ chip_id: c[1000]._id, quantity: 50 }] });
  const conv = (await race(s, { outs: [{ chip_id: c[100]._id, quantity: 20 }], ins: [{ chip_id: c[500]._id, quantity: 4 }] })).body;
  await post(admin, `/api/conversions/${conv._id}/reverse`, { reason: 'x' });

  for (const chip of Object.values(c)) {
    const inBinders = await mv.chipTotal(chip._id);
    const inPlay = (await mv.playBalances({ tournament_id: t._id, chip_id: chip._id }))[0]?.quantity || 0;
    const assembled = (await Movement.aggregate([{ $match: { chip_id: chip._id, type: 'ASSEMBLY' } }, { $group: { _id: null, q: { $sum: '$quantity' } } }]))[0].q;
    assert.equal(inBinders + inPlay, assembled, `ficha ${chip.value}`);
  }
});

// ─── concorrência ────────────────────────────────────────────────────────────

for (const mode of ['auto', 'mutex']) {
  test(`concorrência (${mode}): 6 envios simultâneos de 30 sobre 100 reservadas → exatamente 3 passam`, async () => {
    if (mode === 'mutex') mv._setTransactionMode(false);
    const chip = await makeChip({ value: 100 });
    const binder = await makeBinder('B', [{ chip, quantity: 500 }]);
    const admin = await as('admin'); const mat = await as('material');
    const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01' })).body;
    await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: chip._id, quantity: 100 }] });

    const res = await Promise.all(Array.from({ length: 6 }, () => post(mat, `/api/tournaments/${t._id}/sends`, { chips: [{ chip_id: chip._id, quantity: 30 }] })));
    assert.deepEqual(res.map((r) => r.status).sort(), [201, 201, 201, 409, 409, 409], JSON.stringify(res.map((r) => r.body.error)));
    const sent = (await mv.playBalances({ tournament_id: t._id }))[0].quantity;
    assert.equal(sent, 90, 'nunca passa do reservado');
    assert.ok(sent <= 100);
    assert.equal(await bal(binder, chip), 410);
  });

  test(`concorrência (${mode}): enviar e retirar do fichário ao mesmo tempo nunca deixa o reservado sem fichas`, async () => {
    if (mode === 'mutex') mv._setTransactionMode(false);
    const chip = await makeChip({ value: 100 });
    const binder = await makeBinder('B', [{ chip, quantity: 100 }]);
    const admin = await as('admin'); const mat = await as('material');
    const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01' })).body;
    await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: chip._id, quantity: 60 }] });

    // livre = 40; enviar 60 (reservado) e retirar 60 (só 40 livres) → o envio passa, a retirada não
    const [s, w] = await Promise.all([
      post(mat, `/api/tournaments/${t._id}/sends`, { chips: [{ chip_id: chip._id, quantity: 60 }] }),
      post(admin, '/api/movements', { type: 'WITHDRAWAL', binder_id: binder._id, chip_id: chip._id, quantity: 60, reason: 'corrida' }),
    ]);
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal(w.status, 409, JSON.stringify(w.body));
    assert.equal(await bal(binder, chip), 40);
  });
}

test('dashboard e relatórios contam as conversões ativas', async () => {
  const s = await raceScene();
  await race(s, { outs: [{ chip_id: s.c[100]._id, quantity: 100 }], ins: [{ chip_id: s.c[500]._id, quantity: 20 }] });
  const reversed = (await race(s, { outs: [{ chip_id: s.c[100]._id, quantity: 50 }], ins: [{ chip_id: s.c[500]._id, quantity: 10 }] })).body;
  await post(s.admin, `/api/conversions/${reversed._id}/reverse`, { reason: 'x' });

  assert.equal((await get(s.admin, '/api/dashboard/stats')).body.metrics.chipRacesToday, 1, 'a estornada não conta');
  const rep = (await get(s.admin, '/api/reports/data')).body;
  assert.equal(rep.stats.totalChipRaces, 1);
  assert.equal(rep.charts.racesByTournament[0].count, 1);
});
