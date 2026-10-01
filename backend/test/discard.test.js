// G7 — descarte de stack (spec §9, §18.5): as fichas devolvidas saem de jogo e voltam ao fichário na hora.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Allocation, Binder, Movement, Tournament } = require('../models');
const mv = require('../lib/movements');

before(async () => { await connect(); await Allocation.init(); });
after(disconnect);
beforeEach(clearDb);
afterEach(() => { mv._setTransactionMode(null); app.set('io', undefined); });

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);
const del = (h, url) => request(app).delete(url).set(h);
const bal = (binder, chip) => mv.balanceAt({ kind: 'binder', id: binder._id }, chip._id);
const onTable = async (t, chip) => (await mv.playBalances({ tournament_id: t._id, chip_id: chip._id }))[0]?.quantity || 0;

// torneio com 10 buy-ins enviados: em jogo 100×100, 500×40, 1000×70, 5000×20
async function scene() {
  const c = {};
  for (const [v, color] of [[100, '#000000'], [500, '#ff0000'], [1000, '#0000ff'], [5000, '#00ff00']]) c[v] = await makeChip({ value: v, color });
  const binder = await makeBinder('LISA 1', [
    { chip: c[100], quantity: 5000 }, { chip: c[500], quantity: 2000 }, { chip: c[1000], quantity: 1000 }, { chip: c[5000], quantity: 500 },
  ]);
  const admin = await as('admin'); const mat = await as('material');
  const stack = (await post(admin, '/api/stacks', {
    name: 'Warm Up', actions: [{ key: 'buy_in', label: 'Buy-in' }, { key: 're_entry', label: 'Reentrada' }],
    composition: [
      { chip_id: c[100]._id, quantities: { buy_in: 10, re_entry: 10 } }, { chip_id: c[500]._id, quantities: { buy_in: 4, re_entry: 4 } },
      { chip_id: c[1000]._id, quantities: { buy_in: 7, re_entry: 7 } }, { chip_id: c[5000]._id, quantities: { buy_in: 2, re_entry: 2 } },
    ],
  })).body;
  const t = (await post(admin, '/api/tournaments', { name: 'Warm Up', date: '2026-10-01', stack_model_id: stack._id })).body;
  const tournament = await Tournament.findById(t._id);
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'binder' });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 10 });
  const sent = await post(mat, `/api/tournaments/${t._id}/sends`, { items: [{ action: 'buy_in', count: 10 }] });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  return { c, binder, admin, mat, t, tournament, stack };
}
const discard = (h, t, body) => post(h, `/api/tournaments/${t._id}/discards`, body);
const inPlay = async (h, t) => (await get(h, `/api/tournaments/${t._id}/chips-in-play`)).body;
const row = (r, chip) => r.rows.find((x) => x.chip._id === String(chip._id));
const allocRow = async (h, binder, chip) => (await get(h, `/api/allocations/matrix?binder_id=${binder._id}`)).body.chips.find((r) => r.chip._id === String(chip._id));

// ─── ACEITE ──────────────────────────────────────────────────────────────────

test('ACEITE: stack parcial (3×100 + 1×500) volta ao fichário; "em jogo" cai; valor total do servidor', async () => {
  const { c, binder, admin, mat, t, tournament } = await scene();
  const before = { table100: await onTable(tournament, c[100]), bin100: await bal(binder, c[100]), inPlay: await inPlay(admin, t), alloc: await allocRow(admin, binder, c[100]) };

  const res = await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 3 }, { chip_id: c[500]._id, quantity: 1 }], note: 'stack curto, vai reentrar' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual([res.body.total_chips, res.body.total_value], [4, 800], '3×100 + 1×500, calculado pelo servidor');
  assert.equal(res.body.binder.name, 'LISA 1', 'o único fichário alocado é o destino');
  for (const m of res.body.movements) assert.deepEqual([m.type, m.from.kind, m.to.kind, String(m.to.id)], ['DISCARD', 'play', 'binder', String(binder._id)].map((x, i) => (i === 3 ? String(binder._id) : x)));
  for (const m of res.body.movements) {
    assert.equal(m.user_name, 'Test material', 'usuário automático');
    assert.ok(m.createdAt, 'data/hora automática');
    assert.equal(String(m.tournament_id), String(tournament._id));
    assert.ok(m.session_id, 'sessão automática (torneio de uma sessão)');
  }

  // em jogo cai; fichário sobe — na hora
  assert.equal(await onTable(tournament, c[100]), before.table100 - 3);
  assert.equal(await onTable(tournament, c[500]), 40 - 1);
  assert.equal(await bal(binder, c[100]), before.bin100 + 3);
  const after = await allocRow(admin, binder, c[100]);
  assert.equal(after.balance, before.alloc.balance + 3, 'o saldo do fichário sobe');
  assert.equal(after.allocated[0].quantity, before.alloc.allocated[0].quantity + 3, 'e a reserva do torneio (restante) também');
  assert.equal(after.free, before.alloc.free, 'sem mexer no livre dos outros');

  // o "esperado em jogo" (G3) cai exatamente pelo descarte
  const now = await inPlay(admin, t);
  assert.equal(row(now, c[100]).quantity, row(before.inPlay, c[100]).quantity - 3);
  assert.equal(row(now, c[100]).discarded, 3);
  assert.equal(row(now, c[500]).quantity, row(before.inPlay, c[500]).quantity - 1);
  assert.equal(now.totals.value, before.inPlay.totals.value - 800);
  assert.equal((await Tournament.findById(t._id)).chips_value_in_play, now.totals.value, 'o valor do relógio/projeção acompanha');
});

test('as fichas descartadas NÃO precisam ser a composição original do stack', async () => {
  const { c, mat, t, tournament } = await scene();
  const res = await discard(mat, t, { chips: [{ chip_id: c[5000]._id, quantity: 2 }, { chip_id: c[100]._id, quantity: 17 }] }); // 2×5.000 + 17×100
  assert.equal(res.status, 201);
  assert.equal(res.body.total_value, 10000 + 1700);
  assert.equal(await onTable(tournament, c[5000]), 18);
});

test('ACEITE (socket): descartar emite eventos para o dashboard atualizar na hora', async () => {
  const { c, mat, t, binder } = await scene();
  const events = [];
  app.set('io', { emit: (name, payload) => events.push([name, payload]) });
  await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 3 }, { chip_id: c[500]._id, quantity: 1 }] });

  const byName = Object.fromEntries(events.map(([n, p]) => [n, p]));
  assert.ok(byName.materialChanged && byName.balancesChanged && byName.discardRegistered && byName.chipsInPlayChanged, Object.keys(byName).join(','));
  assert.equal(String(byName.discardRegistered.tournament_id), t._id);
  assert.equal(String(byName.discardRegistered.binder_id), String(binder._id));
  assert.deepEqual([byName.discardRegistered.total_chips, byName.discardRegistered.total_value], [4, 800]);
  assert.equal(String(byName.balancesChanged.binder_id), String(binder._id));
});

// ─── saldo e validações ──────────────────────────────────────────────────────

test('descartar além do que está em jogo → 409 com o saldo real; nada é gravado; o exato passa', async () => {
  const { c, mat, t, tournament } = await scene();
  const before = await Movement.countDocuments();
  const res = await discard(mat, t, { chips: [{ chip_id: c[5000]._id, quantity: 21 }] }); // só há 20 em jogo
  assert.equal(res.status, 409);
  assert.match(res.body.error, /jogo no torneio "Warm Up" tem 20/);
  assert.equal(res.body.details[0].available, 20);
  assert.equal(await Movement.countDocuments(), before);
  assert.equal(await onTable(tournament, c[5000]), 20);
  assert.equal((await discard(mat, t, { chips: [{ chip_id: c[5000]._id, quantity: 20 }] })).status, 201);
  assert.equal(await onTable(tournament, c[5000]), 0);
});

test('o lote é tudo-ou-nada: uma denominação sem saldo derruba o descarte inteiro', async () => {
  const { c, mat, t, tournament } = await scene();
  const before = await Movement.countDocuments();
  const res = await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 5 }, { chip_id: c[5000]._id, quantity: 999 }] });
  assert.equal(res.status, 409);
  assert.equal(await Movement.countDocuments(), before);
  assert.equal(await onTable(tournament, c[100]), 100, 'as 5 de 100 também não saíram');
});

test('validações: corpo vazio, quantidades ruins, ficha repetida/inexistente, fichário inválido', async () => {
  const { c, mat, t } = await scene();
  const ok = { chip_id: c[100]._id, quantity: 1 };
  const bad = [
    {}, { chips: [] }, { chips: 'x' }, { chips: [{ chip_id: c[100]._id, quantity: 0 }] }, { chips: [{ chip_id: c[100]._id, quantity: -2 }] },
    { chips: [{ chip_id: c[100]._id, quantity: 1.5 }] }, { chips: [ok, ok] }, { chips: [{ chip_id: '64b000000000000000000000', quantity: 1 }] },
    { chips: [ok], binder_id: 'lixo' },
  ];
  for (const body of bad) assert.equal((await discard(mat, t, body)).status, 400, JSON.stringify(body));
  assert.equal((await discard(mat, t, { chips: [ok], binder_id: '64b000000000000000000000' })).status, 404);
  assert.equal((await post(mat, '/api/tournaments/64b000000000000000000000/discards', { chips: [ok] })).status, 404);
  assert.equal(await Movement.countDocuments({ type: 'DISCARD' }), 0);
});

test('fichário de destino: o único alocado é o padrão; vários (ou nenhum) exigem binder_id', async () => {
  const { c, mat, admin, t, binder } = await scene();
  const other = await makeBinder('LISA 2', [{ chip: c[100], quantity: 10 }]);
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: other._id, mode: 'binder' });

  const amb = await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 2 }] });
  assert.equal(amb.status, 400);
  assert.match(amb.body.error, /vários fichários alocados/);
  const chosen = await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 2 }], binder_id: other._id });
  assert.equal(chosen.status, 201);
  assert.equal(chosen.body.binder.name, 'LISA 2');
  assert.equal(await bal(other, c[100]), 12);

  // sem nenhuma alocação e sem binder_id
  await Allocation.updateMany({}, { $set: { open: false, status: 'released' } });
  const none = await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 1 }] });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /Informe o fichário/);
  assert.equal((await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 1 }], binder_id: binder._id })).status, 201, 'com o fichário informado passa');
});

test('não há campo de jogador: player_* é ignorado; a anotação é guardada e listada', async () => {
  const { c, mat, t } = await scene();
  await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 1 }], player_id: '64b000000000000000000000', player_name: 'Zé', note: '  stack abandonado  ' });
  await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 1 }] });

  const list = (await get(mat, `/api/tournaments/${t._id}/discards`)).body;
  assert.deepEqual(list.map((d) => d.note), [null, 'stack abandonado'], 'mais recente primeiro');
  assert.ok(list.every((d) => d.player === undefined), 'sem jogador na resposta');
  const m = await Movement.findOne({ type: 'DISCARD', 'meta.note': 'stack abandonado' });
  assert.equal(m.meta.player_name, undefined);
});

// ─── sessão e estado do torneio ──────────────────────────────────────────────

test('sessão: alias /sessions/:sid/discards; várias sessões sem indicar → 400; encerrada → 409; torneio encerrado → 409', async () => {
  const c = { 100: await makeChip({ value: 100 }) };
  const binder = await makeBinder('B', [{ chip: c[100], quantity: 1000 }]);
  const admin = await as('admin'); const mat = await as('material');
  const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01', sessions: ['Dia 1A', 'Dia 1B'] })).body;
  const [s1, s2] = t.sessions;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'binder' });
  await post(mat, `/api/tournaments/${t._id}/sends`, { chips: [{ chip_id: c[100]._id, quantity: 100 }], session_id: s1._id });
  const body = { chips: [{ chip_id: c[100]._id, quantity: 10 }] };

  const amb = await discard(mat, t, body);
  assert.equal(amb.status, 400);
  assert.match(amb.body.error, /session_id/);
  const viaAlias = await post(mat, `/api/tournaments/${t._id}/sessions/${s1._id}/discards`, body);
  assert.equal(viaAlias.status, 201, JSON.stringify(viaAlias.body));
  assert.equal(String(viaAlias.body.movements[0].session_id), String(s1._id));
  assert.equal((await discard(mat, t, { ...body, session_id: s1._id })).status, 201, 'session_id no corpo também');

  const only1 = (await get(mat, `/api/tournaments/${t._id}/sessions/${s1._id}/discards`)).body;
  assert.equal(only1.length, 2);
  assert.equal((await get(mat, `/api/tournaments/${t._id}/discards?session_id=${s2._id}`)).body.length, 0);

  await put(admin, `/api/tournaments/${t._id}/sessions/${s2._id}`, { status: 'running' });
  await put(admin, `/api/tournaments/${t._id}/sessions/${s2._id}`, { status: 'finished' });
  const closedSession = await discard(mat, t, { ...body, session_id: s2._id });
  assert.equal(closedSession.status, 409);
  assert.match(closedSession.body.error, /encerrada/);

  await Tournament.updateOne({ _id: t._id }, { status: 'finished' });
  assert.equal((await discard(mat, t, { ...body, session_id: s1._id })).status, 409, 'torneio encerrado não aceita descarte');
});

// ─── efeito nos cálculos ─────────────────────────────────────────────────────

test('o descarte reduz o esperado e o em jogo por igual: o pendente não muda; a coluna "descartado" aparece', async () => {
  const { c, mat, admin, t } = await scene();
  const summary = async () => (await get(admin, `/api/tournaments/${t._id}/material`)).body;
  const before = await summary();
  assert.equal(before.rows.find((r) => r.chip.value === 100).pending, 0, 'tudo que era esperado foi enviado');

  await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 3 }, { chip_id: c[500]._id, quantity: 1 }] });
  const after = await summary();
  const r100 = after.rows.find((r) => r.chip.value === 100);
  assert.deepEqual([r100.expected, r100.discarded, r100.on_table, r100.pending], [97, 3, 97, 0]);
  assert.equal(after.rows.find((r) => r.chip.value === 500).discarded, 1);
  assert.equal(after.rows.find((r) => r.chip.value === 5000).discarded, 0);
  assert.equal(after.totals.expected_value, before.totals.expected_value - 800);
  assert.equal(after.totals.pending_value, 0);
});

test('depois de descartar, a REENTRADA soma um stack novo por cima do que ficou (entradas − descartes)', async () => {
  const { c, mat, admin, t } = await scene();
  await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 4 }, { chip_id: c[500]._id, quantity: 2 }] });
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 're-entry' }); // stack de reentrada: 10×100, 4×500, 7×1000, 2×5000

  const r = await inPlay(admin, t);
  assert.equal(row(r, c[100]).quantity, 100 - 4 + 10);
  assert.equal(row(r, c[500]).quantity, 40 - 2 + 4);
  const sum = (await get(admin, `/api/tournaments/${t._id}/material`)).body;
  assert.equal(sum.rows.find((x) => x.chip.value === 100).pending, 10, 'só falta enviar o stack da reentrada');
  const send = await post(mat, `/api/tournaments/${t._id}/sends`, { items: [{ action: 're_entry', count: 1 }] });
  assert.equal(send.status, 201, JSON.stringify(send.body));
  assert.equal((await get(admin, `/api/tournaments/${t._id}/material`)).body.rows.every((x) => x.pending === 0), true);
});

test('fichas em jogo por sessão: o descarte só abate a sessão em que foi lançado', async () => {
  const c = { 100: await makeChip({ value: 100 }) };
  const binder = await makeBinder('B', [{ chip: c[100], quantity: 1000 }]);
  const admin = await as('admin'); const mat = await as('material');
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: c[100]._id, quantities: { buy_in: 10 } }] })).body;
  const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01', sessions: ['Dia 1A', 'Dia 1B'], stack_model_id: stack._id })).body;
  const [s1, s2] = t.sessions;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'binder' });
  for (const s of [s1, s2]) {
    await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 5, session_id: s._id });
    await post(mat, `/api/tournaments/${t._id}/sends`, { items: [{ action: 'buy_in', count: 5 }], session_id: s._id });
  }
  await post(mat, `/api/tournaments/${t._id}/sessions/${s1._id}/discards`, { chips: [{ chip_id: c[100]._id, quantity: 7 }] });

  const q = async (sid) => (await get(admin, `/api/tournaments/${t._id}/${sid ? `sessions/${sid}/` : ''}chips-in-play`)).body.rows[0].quantity;
  assert.equal(await q(s1._id), 50 - 7);
  assert.equal(await q(s2._id), 50);
  assert.equal(await q(null), 100 - 7);
});

// ─── estorno e imutabilidade ─────────────────────────────────────────────────

test('estorno (admin, com motivo): restaura em jogo e esperado; o original permanece; 2× → 409', async () => {
  const { c, binder, mat, admin, t, tournament } = await scene();
  const d = (await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 3 }, { chip_id: c[500]._id, quantity: 1 }] })).body;
  const before = { table: await onTable(tournament, c[100]), bin: await bal(binder, c[100]), moves: await Movement.countDocuments() };
  const url = `/api/tournaments/${t._id}/discards/${d.batch_id}/reverse`;

  assert.equal((await post(mat, url, { reason: 'x' })).status, 403, 'material não estorna');
  assert.equal((await post(admin, url, {})).status, 400, 'motivo obrigatório');
  assert.equal((await post(admin, `/api/tournaments/${t._id}/discards/64b000000000000000000000/reverse`, { reason: 'x' })).status, 404);

  const rev = await post(admin, url, { reason: 'lancei no jogador errado' });
  assert.equal(rev.status, 201, JSON.stringify(rev.body));
  assert.equal(await onTable(tournament, c[100]), before.table + 3);
  assert.equal(await bal(binder, c[100]), before.bin - 3);
  assert.equal(await Movement.countDocuments(), before.moves + 2, 'nada apagado');
  assert.equal(await Movement.countDocuments({ type: 'DISCARD' }), 2, 'os originais permanecem');
  assert.equal(String(rev.body.movements[0].tournament_id), t._id);
  assert.equal(row(await inPlay(admin, t), c[100]).quantity, 100, 'o esperado volta');
  assert.equal(row(await inPlay(admin, t), c[100]).discarded || 0, 0);

  const list = (await get(admin, `/api/tournaments/${t._id}/discards`)).body;
  assert.equal(list[0].reversed, true);
  assert.equal(list[0].reversed_by.reason, 'lancei no jogador errado');
  const again = await post(admin, url, { reason: 'de novo' });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /já foi estornado/);
});

test('estorno bloqueado se as fichas já voltaram a ser usadas (fichário sem saldo)', async () => {
  const chip = await makeChip({ value: 100 });
  const binder = await makeBinder('B', [{ chip, quantity: 10 }]);
  const admin = await as('admin'); const mat = await as('material');
  const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01' })).body;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'binder' });
  const body = { chips: [{ chip_id: chip._id, quantity: 10 }] };
  await post(mat, `/api/tournaments/${t._id}/sends`, body);
  const d = (await discard(mat, t, body)).body;
  await post(mat, `/api/tournaments/${t._id}/sends`, body); // as mesmas fichas saem de novo para a mesa
  assert.equal(await bal(binder, chip), 0);

  const rev = await post(admin, `/api/tournaments/${t._id}/discards/${d.batch_id}/reverse`, { reason: 'tarde demais' });
  assert.equal(rev.status, 409);
  assert.match(rev.body.error, /Não é possível estornar/);
  assert.equal(await Movement.countDocuments({ type: 'REVERSAL' }), 0);
});

test('imutável: editar/excluir descarte → 405; sem rota de escrita nos movimentos', async () => {
  const { c, mat, admin, t } = await scene();
  const d = (await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 1 }] })).body;
  for (const h of [admin, mat]) {
    const p = await put(h, `/api/tournaments/${t._id}/discards/${d.batch_id}`, { chips: [] });
    assert.equal(p.status, 405);
    assert.match(p.body.error, /imutáveis/);
    assert.equal((await del(h, `/api/tournaments/${t._id}/discards/${d.batch_id}`)).status, 405);
  }
  await assert.rejects(Movement.deleteMany({ type: 'DISCARD' }), /imutáveis/);
  assert.equal(await Movement.countDocuments({ type: 'DISCARD' }), 1);
});

// ─── listagem, prévia e permissões ───────────────────────────────────────────

test('GET /discards: um item por lote, com total, fichas ordenadas, fichário, usuário e horário', async () => {
  const { c, mat, admin, t, binder } = await scene();
  await discard(mat, t, { chips: [{ chip_id: c[500]._id, quantity: 2 }, { chip_id: c[100]._id, quantity: 5 }] });
  await discard(mat, t, { chips: [{ chip_id: c[1000]._id, quantity: 1 }] });

  const list = (await get(await as('salao'), `/api/tournaments/${t._id}/discards`)).body;
  assert.equal(list.length, 2);
  assert.deepEqual([list[0].total_chips, list[0].total_value], [1, 1000], 'o mais recente primeiro');
  assert.deepEqual(list[1].chips.map((x) => x.chip.value), [100, 500], 'fichas ordenadas pelo valor');
  assert.deepEqual([list[1].total_chips, list[1].total_value], [7, 500 + 1000 + 500 * 1 + 0].map((x, i) => (i === 1 ? 5 * 100 + 2 * 500 : x)));
  assert.equal(list[1].binder.name, 'LISA 1');
  assert.equal(list[1].user_name, 'Test material');
  assert.ok(list[1].at);
  assert.equal(list[1].reversed, false);
  assert.equal(list[1].movement_ids.length, 2);
  assert.equal((await get(admin, '/api/tournaments/64b000000000000000000000/discards')).status, 404);
  assert.equal((await request(app).get(`/api/tournaments/${t._id}/discards`)).status, 401);
  assert.ok(binder);
});

test('prévia: a MESMA conta do registro (servidor), sem gravar; o salão também simula', async () => {
  const { c, mat, t } = await scene();
  const body = { chips: [{ chip_id: c[100]._id, quantity: 3 }, { chip_id: c[500]._id, quantity: 1 }] };
  const before = await Movement.countDocuments();
  const pv = await post(await as('salao'), `/api/tournaments/${t._id}/discards/preview`, body);
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.deepEqual([pv.body.total_chips, pv.body.total_value], [4, 800]);
  assert.deepEqual(pv.body.chips.map((x) => x.value), [300, 500]);
  assert.equal(await Movement.countDocuments(), before);
  assert.equal((await discard(mat, t, body)).body.total_value, pv.body.total_value);
  assert.equal((await post(mat, `/api/tournaments/${t._id}/discards/preview`, { chips: [] })).status, 400);
});

test('permissões: material e admin descartam; o salão só consulta', async () => {
  const { c, mat, admin, t } = await scene();
  const body = { chips: [{ chip_id: c[100]._id, quantity: 1 }] };
  assert.equal((await discard(await as('salao'), t, body)).status, 403);
  assert.equal((await post(await as('salao'), `/api/tournaments/${t._id}/sessions/${t.sessions[0]._id}/discards`, body)).status, 403);
  assert.equal(await Movement.countDocuments({ type: 'DISCARD' }), 0);
  assert.equal((await discard(mat, t, body)).status, 201);
  assert.equal((await discard(admin, t, body)).status, 201);
  assert.equal((await request(app).post(`/api/tournaments/${t._id}/discards`).send(body)).status, 401);
});

// ─── correção do resumo (G6): estornos abatem as colunas ─────────────────────

test('resumo: enviado/devolvido estornados deixam de contar nas colunas (só o em jogo já estava certo)', async () => {
  const { c, binder, mat, admin, t } = await scene();
  const ret = await post(mat, `/api/tournaments/${t._id}/returns`, { binder_id: binder._id, chips: [{ chip_id: c[100]._id, quantity: 10 }] });
  const cols = async () => (await get(admin, `/api/tournaments/${t._id}/material`)).body.rows.find((r) => r.chip.value === 100);
  assert.deepEqual([(await cols()).sent, (await cols()).returned, (await cols()).on_table], [100, 10, 90]);

  await post(admin, `/api/movements/${ret.body.movements[0]._id}/reverse`, { reason: 'devolvi a mais', whole_batch: true });
  assert.deepEqual([(await cols()).sent, (await cols()).returned, (await cols()).on_table], [100, 0, 100], 'o retorno estornado não conta mais');

  const sendBatch = (await Movement.findOne({ type: 'SEND_BUY_IN', chip_id: c[100]._id })).batch_id;
  await post(admin, `/api/movements/${(await Movement.findOne({ batch_id: sendBatch }))._id}/reverse`, { reason: 'enviei errado', whole_batch: true });
  assert.deepEqual([(await cols()).sent, (await cols()).on_table], [0, 0], 'o envio estornado também sai da coluna');
});

// ─── regras de localização, concorrência e conservação ───────────────────────

test('regra do motor: DISCARD só vai de "em jogo" para fichário', async () => {
  const { c, binder, tournament } = await scene();
  const base = { type: 'DISCARD', chip_id: c[100]._id, quantity: 1 };
  const play = { kind: 'play', id: tournament._id }; const bin = { kind: 'binder', id: binder._id };
  for (const w of [{ from: bin, to: play }, { from: play, to: { kind: 'external' } }, { from: { kind: 'external' }, to: bin }, { from: play, to: { kind: 'lost', id: binder._id } }]) {
    await assert.rejects(mv.postBatch([{ ...base, ...w }]), /incompatíveis/, JSON.stringify(w));
  }
  assert.equal(await Movement.countDocuments({ type: 'DISCARD' }), 0);
});

for (const mode of ['auto', 'mutex']) {
  test(`concorrência (${mode}): 6 descartes simultâneos de 30 sobre 100 em jogo → exatamente 3 passam`, async () => {
    if (mode === 'mutex') mv._setTransactionMode(false);
    const chip = await makeChip({ value: 100 });
    const binder = await makeBinder('B', [{ chip, quantity: 500 }]);
    const admin = await as('admin'); const mat = await as('material');
    const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01' })).body;
    await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'binder' });
    await post(mat, `/api/tournaments/${t._id}/sends`, { chips: [{ chip_id: chip._id, quantity: 100 }] });

    const res = await Promise.all(Array.from({ length: 6 }, () => discard(mat, t, { chips: [{ chip_id: chip._id, quantity: 30 }] })));
    assert.deepEqual(res.map((r) => r.status).sort(), [201, 201, 201, 409, 409, 409], JSON.stringify(res.map((r) => r.body.error)));
    assert.equal((await mv.playBalances({ tournament_id: t._id }))[0].quantity, 10, 'nunca fica negativo');
    assert.equal(await bal(binder, chip), 400 + 90);
  });
}

test('conservação: fichários + em jogo = montadas depois de envios, descartes e estornos', async () => {
  const { c, binder, mat, admin, t } = await scene();
  const d1 = (await discard(mat, t, { chips: [{ chip_id: c[100]._id, quantity: 8 }, { chip_id: c[1000]._id, quantity: 3 }] })).body;
  await discard(mat, t, { chips: [{ chip_id: c[500]._id, quantity: 5 }] });
  await post(admin, `/api/tournaments/${t._id}/discards/${d1.batch_id}/reverse`, { reason: 'x' });
  await post(mat, `/api/tournaments/${t._id}/returns`, { binder_id: binder._id, chips: [{ chip_id: c[5000]._id, quantity: 4 }] });

  for (const chip of Object.values(c)) {
    const inBinders = await mv.chipTotal(chip._id);
    const inPlay = (await mv.playBalances({ tournament_id: t._id, chip_id: chip._id }))[0]?.quantity || 0;
    const assembled = (await Movement.aggregate([{ $match: { chip_id: chip._id, type: 'ASSEMBLY' } }, { $group: { _id: null, q: { $sum: '$quantity' } } }]))[0].q;
    assert.equal(inBinders + inPlay, assembled, `ficha ${chip.value}`);
  }
  assert.ok(Binder);
});
