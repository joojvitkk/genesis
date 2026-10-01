// G5 — alocação parcial e validação de conflito (spec §5, §18.2, §18.9; João: "nunca alocar mais do que o físico").
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Allocation, Binder, Chip, Tournament, Movement } = require('../models');
const mv = require('../lib/movements');
const binderView = require('../lib/binderView');
// saldos DERIVADOS (não há mais cache na ficha): total nos fichários e reservado às alocações abertas
const derived = async (chip) => ({ total: await mv.chipTotal(chip._id), reserved: (await mv.reservedByChip([chip._id])).get(String(chip._id)) || 0 });
const statusOf = async (binderId) => (await binderView.presentOne(await Binder.findById(binderId))).status;

before(async () => { await connect(); await Allocation.init(); });
after(disconnect);
beforeEach(clearDb);
afterEach(() => mv._setTransactionMode(null));

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);
const del = (h, url) => request(app).delete(url).set(h);

const tournament = (name, extra = {}) => Tournament.create({ name, date: new Date(), status: 'scheduled', ...extra });
const allocate = (h, t, body) => post(h, `/api/tournaments/${t._id}/allocations`, body);
const qty = (alloc) => Object.fromEntries(alloc.chips.map((c) => [c.chip_id.value ?? c.chip_id, c.quantity]));

// fichário da spec (§3.2, exemplo LISA) com denominações baixas e altas
async function scene() {
  const c = {};
  for (const [v, color] of [[100, '#000000'], [500, '#ff0000'], [1000, '#0000ff'], [5000, '#00ff00'], [25000, '#ffff00']]) c[v] = await makeChip({ value: v, color });
  const binder = await makeBinder('LISA 1', [
    { chip: c[100], quantity: 3000 }, { chip: c[500], quantity: 2000 }, { chip: c[1000], quantity: 1500 },
    { chip: c[5000], quantity: 1000 }, { chip: c[25000], quantity: 500 },
  ]);
  return { c, binder, admin: await as('admin'), A: await tournament('Torneio A'), B: await tournament('Torneio B') };
}

// ─── ACEITE: alocação parcial ────────────────────────────────────────────────

test('ACEITE: fichas altas do fichário no torneio A e baixas no B, sem conflito', async () => {
  const { binder, admin, A, B, c } = await scene();
  const high = await allocate(admin, A, { binder_id: binder._id, mode: 'denominations', min_value: 5000 });
  const low = await allocate(admin, B, { binder_id: binder._id, mode: 'denominations', max_value: 1000 });
  assert.equal(high.status, 201, JSON.stringify(high.body));
  assert.equal(low.status, 201, JSON.stringify(low.body));

  const q = (a) => Object.fromEntries(a.body.chips.map((x) => [x.chip_id.value, x.quantity]));
  assert.deepEqual(q(high), { 5000: 1000, 25000: 500 });
  assert.deepEqual(q(low), { 100: 3000, 500: 2000, 1000: 1500 });

  const m = (await get(admin, `/api/allocations/matrix?binder_id=${binder._id}`)).body;
  assert.equal(m.chips.length, 5);
  for (const row of m.chips) {
    assert.equal(row.free, 0, `${row.chip.value}: tudo alocado, nada em conflito`);
    assert.equal(row.allocated.length, 1, 'cada ficha está com um só torneio');
  }
  assert.equal(m.chips.find((r) => r.chip.value === 5000).allocated[0].tournament_name, 'Torneio A');
  assert.equal(m.chips.find((r) => r.chip.value === 100).allocated[0].tournament_name, 'Torneio B');
  assert.ok(c[100]);
});

test('ACEITE: uma ficha além do livre → 409 com o excesso e quem está segurando; nada é criado', async () => {
  const { binder, admin, A, B, c } = await scene(); // 1000 fichas de 5.000
  const ok = await allocate(admin, A, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[5000]._id, quantity: 600 }] });
  assert.equal(ok.status, 201);

  const over = await allocate(admin, B, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[5000]._id, quantity: 401 }] });
  assert.equal(over.status, 409);
  assert.match(over.body.error, /Alocação acima do saldo livre/);
  const d = over.body.details[0];
  assert.deepEqual([d.requested, d.balance, d.allocated_elsewhere, d.free, d.excess], [401, 1000, 600, 400, 1]);
  assert.equal(d.held_by[0].tournament, 'Torneio A');
  assert.equal(d.held_by[0].quantity, 600);
  assert.equal(await Allocation.countDocuments({ tournament_id: B._id }), 0, 'nada foi gravado');

  assert.equal((await allocate(admin, B, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[5000]._id, quantity: 400 }] })).status, 201, 'o livre exato passa');
});

test('ACEITE: dois torneios agendados disputando o mesmo saldo → o segundo é recusado', async () => {
  const { binder, admin, A, B } = await scene();
  assert.equal((await allocate(admin, A, { binder_id: binder._id, mode: 'binder' })).status, 201);

  const second = await allocate(admin, B, { binder_id: binder._id, mode: 'binder' });
  assert.equal(second.status, 409, 'os dois estão agendados: a reserva de A já vale');
  assert.equal(second.body.details.length, 5, 'as 5 denominações conflitam');
  assert.equal(await Allocation.countDocuments({ tournament_id: B._id }), 0);
  assert.equal((await allocate(admin, B, { binder_id: binder._id, mode: 'denominations', max_value: 1000 })).status, 409, 'nem parcialmente');

  // liberar A devolve a capacidade
  const a = await Allocation.findOne({ tournament_id: A._id });
  assert.equal((await del(admin, `/api/allocations/${a._id}`)).status, 200);
  assert.equal((await allocate(admin, B, { binder_id: binder._id, mode: 'binder' })).status, 201);
});

// ─── modos ───────────────────────────────────────────────────────────────────

test('modo "fichário inteiro": todas as fichas na quantidade do saldo', async () => {
  const { binder, admin, A } = await scene();
  const res = await allocate(admin, A, { binder_id: binder._id, mode: 'binder', note: 'main event' });
  assert.equal(res.status, 201);
  assert.deepEqual(Object.fromEntries(res.body.chips.map((x) => [x.chip_id.value, x.quantity])), { 100: 3000, 500: 2000, 1000: 1500, 5000: 1000, 25000: 500 });
  assert.equal(res.body.mode, 'binder');
  assert.equal(res.body.status, 'planned');
  assert.equal(res.body.binder_id.name, 'LISA 1');
  assert.equal(res.body.created_by, 'Test admin');
  assert.equal(res.body.note, 'main event');
});

test('modo "por denominação": fichas escolhidas ou faixa de valor; validações', async () => {
  const { binder, admin, A, B, c } = await scene();
  const chosen = await allocate(admin, A, { binder_id: binder._id, mode: 'denominations', chip_ids: [c[500]._id, c[1000]._id] });
  assert.equal(chosen.status, 201, JSON.stringify(chosen.body));
  assert.deepEqual(chosen.body.chips.map((x) => x.chip_id.value).sort((a, b) => a - b), [500, 1000]);

  const range = await allocate(admin, B, { binder_id: binder._id, mode: 'denominations', min_value: 100, max_value: 100 });
  assert.equal(range.status, 201);
  assert.deepEqual(range.body.chips.map((x) => x.chip_id.value), [100]);

  const C = await tournament('C');
  const bad = [
    { mode: 'denominations' },                                   // sem seleção
    { mode: 'denominations', min_value: 10, max_value: 5 },       // faixa invertida
    { mode: 'denominations', min_value: 'x' },
    { mode: 'denominations', min_value: 999999 },                 // nada corresponde
    { mode: 'denominations', chip_ids: ['64b000000000000000000000'] }, // ficha sem saldo aqui
    { mode: 'nao_existe' },
  ];
  for (const body of bad) assert.equal((await allocate(admin, C, { binder_id: binder._id, ...body })).status, 400, JSON.stringify(body));
  assert.equal(await Allocation.countDocuments({ tournament_id: C._id }), 0);
});

test('modo "quantidade específica": validações de ficha e quantidade', async () => {
  const { binder, admin, A, c } = await scene();
  const url = { binder_id: binder._id, mode: 'quantities' };
  const bad = [
    { chips: [] }, {}, { chips: [{ chip_id: c[100]._id, quantity: 0 }] }, { chips: [{ chip_id: c[100]._id, quantity: -5 }] },
    { chips: [{ chip_id: c[100]._id, quantity: 1.5 }] }, { chips: [{ chip_id: 'lixo', quantity: 1 }] },
    { chips: [{ chip_id: c[100]._id, quantity: 1 }, { chip_id: c[100]._id, quantity: 2 }] },
  ];
  for (const body of bad) assert.equal((await allocate(admin, A, { ...url, ...body })).status, 400, JSON.stringify(body));

  // ficha sem saldo neste fichário → livre 0 → conflito
  const outsider = await makeChip({ value: 7, color: '#070707' });
  const none = await allocate(admin, A, { ...url, chips: [{ chip_id: outsider._id, quantity: 1 }] });
  assert.equal(none.status, 409);
  assert.equal(none.body.details[0].free, 0);
  assert.equal(await Allocation.countDocuments(), 0);
});

test('fichário vazio, inexistente, em manutenção ou torneio encerrado são recusados', async () => {
  const { admin, A, c } = await scene();
  const empty = await makeBinder('Vazio');
  assert.equal((await allocate(admin, A, { binder_id: empty._id, mode: 'binder' })).status, 400);
  assert.equal((await allocate(admin, A, { binder_id: '64b000000000000000000000', mode: 'binder' })).status, 404);
  assert.equal((await allocate(admin, A, { mode: 'binder' })).status, 400);
  assert.equal((await post(admin, '/api/tournaments/64b000000000000000000000/allocations', { binder_id: empty._id, mode: 'binder' })).status, 404);

  const maint = await makeBinder('Manutenção', [{ chip: c[100], quantity: 10 }], { status: 'maintenance' });
  assert.equal((await allocate(admin, A, { binder_id: maint._id, mode: 'binder' })).status, 409);

  const done = await tournament('Encerrado', { status: 'finished' });
  const okBinder = await makeBinder('Ok', [{ chip: c[500], quantity: 10 }]);
  const closed = await allocate(admin, done, { binder_id: okBinder._id, mode: 'binder' });
  assert.equal(closed.status, 409);
  assert.match(closed.body.error, /encerrado/);
});

test('uma alocação aberta por (torneio, fichário): para mudar, edite; o índice do banco também barra', async () => {
  const { binder, admin, A, c } = await scene();
  const first = await allocate(admin, A, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[100]._id, quantity: 10 }] });
  assert.equal(first.status, 201);
  const again = await allocate(admin, A, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[500]._id, quantity: 10 }] });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /já tem uma alocação/);

  await assert.rejects(Allocation.create({ tournament_id: A._id, binder_id: binder._id, chips: [{ chip_id: c[100]._id, quantity: 1 }] }), (e) => e.code === 11000);

  await del(admin, `/api/allocations/${first.body._id}`);
  assert.equal((await allocate(admin, A, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[500]._id, quantity: 10 }] })).status, 201, 'liberada, pode alocar de novo');
});

// ─── editar / liberar ────────────────────────────────────────────────────────

test('editar: sobe até o livre (a própria alocação não conta contra si), desce e remove fichas', async () => {
  const { binder, admin, A, B, c } = await scene(); // 5.000: 1000
  const mine = (await allocate(admin, A, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[5000]._id, quantity: 300 }] })).body;
  await allocate(admin, B, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[5000]._id, quantity: 500 }] });

  const up = await put(admin, `/api/allocations/${mine._id}`, { chips: [{ chip_id: c[5000]._id, quantity: 500 }] }); // livre p/ A = 1000 − 500
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.chips[0].quantity, 500);

  const over = await put(admin, `/api/allocations/${mine._id}`, { chips: [{ chip_id: c[5000]._id, quantity: 501 }] });
  assert.equal(over.status, 409);
  assert.equal(over.body.details[0].excess, 1);
  assert.equal((await Allocation.findById(mine._id)).chips[0].quantity, 500, 'a falha não altera nada');

  const swap = await put(admin, `/api/allocations/${mine._id}`, { chips: [{ chip_id: c[25000]._id, quantity: 50 }, { chip_id: c[100]._id, quantity: 7 }] });
  assert.equal(swap.status, 200);
  assert.deepEqual(swap.body.chips.map((x) => x.chip_id.value).sort((a, b) => a - b), [100, 25000]);
  assert.equal(swap.body.mode, 'quantities');
  assert.equal((await derived(c[5000])).reserved, 500, 'só a do B segura as 5.000 agora');

  assert.equal((await put(admin, `/api/allocations/${mine._id}`, { chips: [] })).status, 400);
  assert.equal((await put(admin, '/api/allocations/64b000000000000000000000', { chips: [{ chip_id: c[100]._id, quantity: 1 }] })).status, 404);
});

test('liberar: vira "released" (histórico, nunca é apagada) e devolve a capacidade', async () => {
  const { binder, admin, A, c } = await scene();
  const a = (await allocate(admin, A, { binder_id: binder._id, mode: 'binder' })).body;

  const rel = await del(admin, `/api/allocations/${a._id}`);
  assert.equal(rel.status, 200);
  assert.deepEqual([rel.body.status, rel.body.open], ['released', false]);
  assert.ok(rel.body.released_at);
  assert.equal(rel.body.released_by, 'Test admin');
  assert.equal((await del(admin, `/api/allocations/${a._id}`)).status, 200, 'liberar de novo é inofensivo');

  assert.equal(await Allocation.countDocuments(), 1, 'continua no banco');
  assert.equal((await get(admin, '/api/allocations')).body.length, 0, 'padrão: só as abertas');
  assert.equal((await get(admin, '/api/allocations?open=false')).body.length, 1);
  assert.equal((await get(admin, '/api/allocations?open=all')).body.length, 1);
  assert.equal((await get(admin, '/api/allocations?status=released')).body.length, 1);
  assert.equal((await put(admin, `/api/allocations/${a._id}`, { chips: [{ chip_id: c[100]._id, quantity: 1 }] })).status, 409, 'liberada não se edita');
  assert.equal((await del(admin, '/api/allocations/64b000000000000000000000')).status, 404);
});

// ─── ciclo de vida do torneio ────────────────────────────────────────────────

test('E5: a reserva vale desde a criação; iniciar ativa; encerrar libera; o derivado acompanha', async () => {
  const { binder, admin, A, c } = await scene();
  const sal = await as('salao');
  const a = (await allocate(admin, A, { binder_id: binder._id, mode: 'denominations', min_value: 5000 })).body;
  assert.equal(a.status, 'planned', 'torneio agendado → planejada');

  // reservado IMEDIATAMENTE (antes de o torneio iniciar)
  const held = await derived(c[5000]);
  assert.deepEqual([held.total, held.reserved, held.total - held.reserved], [1000, 1000, 0]);
  const b = await binderView.presentOne(await Binder.findById(binder._id));
  assert.equal(b.status, 'allocated');
  assert.equal(b.allocations[0].tournament_name, 'Torneio A');

  await put(sal, `/api/tournaments/${A._id}`, { status: 'running' });
  assert.equal((await Allocation.findById(a._id)).status, 'active');
  const live = await allocate(admin, await tournament('Rodando', { status: 'running' }), { binder_id: binder._id, mode: 'denominations', max_value: 100 });
  assert.equal(live.body.status, 'active', 'torneio já rodando → nasce ativa');

  await put(sal, `/api/tournaments/${A._id}`, { status: 'finished' });
  const done = await Allocation.findById(a._id);
  assert.deepEqual([done.status, done.open], ['released', false]);
  const after = await derived(c[5000]);
  assert.deepEqual([after.reserved, after.total - after.reserved], [0, 1000]);
  assert.equal(await statusOf(binder._id), 'allocated', 'ainda alocado ao torneio que roda');
});

test('excluir o torneio libera as alocações; o fichário volta a "available"', async () => {
  const { binder, admin, A } = await scene();
  await allocate(admin, A, { binder_id: binder._id, mode: 'binder' });
  assert.equal(await statusOf(binder._id), 'allocated');

  assert.equal((await del(admin, `/api/tournaments/${A._id}`)).status, 200);
  assert.equal(await Allocation.countDocuments({ open: true }), 0);
  const b = await binderView.presentOne(await Binder.findById(binder._id));
  assert.equal(b.status, 'available');
  assert.deepEqual(b.allocations, []);
});

test('o campo antigo allocated_cases não existe mais: é ignorado (a alocação só nasce por POST /allocations)', async () => {
  const { binder, admin, A } = await scene();
  assert.equal((await put(admin, `/api/tournaments/${A._id}`, { allocated_cases: [binder._id] })).status, 200);
  assert.equal((await post(admin, '/api/tournaments', { name: 'X', date: '2026-10-01', allocated_cases: [binder._id] })).status, 201);
  assert.equal(await Allocation.countDocuments(), 0, 'nada foi alocado por esse caminho');
  assert.equal((await Tournament.findById(A._id)).toObject().allocated_cases, undefined);
});

// ─── retiradas respeitam a reserva ───────────────────────────────────────────

test('retirada/ajuste/estorno não podem levar o fichário abaixo do que está ALOCADO', async () => {
  const { binder, admin, A, c } = await scene(); // 500 fichas de 25.000
  await allocate(admin, A, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[25000]._id, quantity: 400 }] });
  const base = { type: 'WITHDRAWAL', binder_id: binder._id, chip_id: c[25000]._id, reason: 'teste' };

  const over = await post(admin, '/api/movements', { ...base, quantity: 101 });
  assert.equal(over.status, 409);
  assert.match(over.body.error, /400 estão alocadas.*Torneio A: 400.*só 100 podem sair/);
  assert.deepEqual([over.body.details[0].free, over.body.details[0].allocated], [100, 400]);

  const adj = await post(admin, '/api/movements', { type: 'ADJUSTMENT', direction: 'out', binder_id: binder._id, chip_id: c[25000]._id, quantity: 101, reason: 'x' });
  assert.equal(adj.status, 409);
  assert.equal((await post(admin, '/api/movements', { ...base, quantity: 100 })).status, 201, 'o livre exato pode sair');
  assert.equal((await mv.balanceAt({ kind: 'binder', id: binder._id }, c[25000]._id)), 400);

  // estornar a montagem original também tiraria fichas alocadas
  const assembly = await Movement.findOne({ chip_id: c[25000]._id, type: 'ASSEMBLY' });
  const rev = await post(admin, `/api/movements/${assembly._id}/reverse`, { reason: 'erro' });
  assert.equal(rev.status, 409);
  assert.equal(await Movement.countDocuments({ type: 'REVERSAL' }), 0);
});

test('perda apurada na conferência NÃO é barrada (é fato físico): vira FALTA na alocação', async () => {
  const { binder, admin, A, c } = await scene();
  await allocate(admin, A, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[25000]._id, quantity: 500 }] }); // todas as 500
  const mat = await as('material');

  const count = await post(mat, `/api/binders/${binder._id}/count`, { counts: [{ chip_id: c[25000]._id, counted: 480 }], reason: 'caíram 20' });
  assert.equal(count.status, 200, JSON.stringify(count.body));
  assert.equal(await mv.balanceAt({ kind: 'binder', id: binder._id }, c[25000]._id), 480);

  const list = (await get(admin, '/api/allocations')).body;
  assert.equal(list[0].has_shortfall, true);
  const line = list[0].chips[0];
  assert.deepEqual([line.quantity, line.balance, line.shortfall], [500, 480, 20]);
  const m = (await get(admin, `/api/allocations/matrix?binder_id=${binder._id}`)).body;
  assert.equal(m.chips.find((r) => r.chip.value === 25000).free, -20, 'livre negativo = falta');

  // e nada novo pode ser alocado dessa ficha enquanto estiver faltando
  const B = await tournament('B2');
  assert.equal((await allocate(admin, B, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[25000]._id, quantity: 1 }] })).status, 409);
});

// ─── concorrência ────────────────────────────────────────────────────────────

for (const mode of ['auto', 'mutex']) {
  test(`concorrência (${mode}): 6 torneios pedem 30 de 100 ao mesmo tempo → exatamente 3 conseguem`, async () => {
    if (mode === 'mutex') mv._setTransactionMode(false);
    const chip = await makeChip({ value: 100 });
    const binder = await makeBinder('B', [{ chip, quantity: 100 }]);
    const admin = await as('admin');
    const ts = await Promise.all(Array.from({ length: 6 }, (_, i) => tournament(`T${i}`)));

    const res = await Promise.all(ts.map((t) => allocate(admin, t, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: chip._id, quantity: 30 }] })));
    assert.deepEqual(res.map((r) => r.status).sort(), [201, 201, 201, 409, 409, 409], JSON.stringify(res.map((r) => r.body.error)));
    const held = (await Allocation.find({ open: true })).reduce((a, x) => a + x.chips[0].quantity, 0);
    assert.equal(held, 90);
    assert.ok(held <= 100, 'nunca alocado acima do físico');
    assert.equal((await derived(chip)).reserved, 90);
  });

  test(`concorrência (${mode}): alocar 60 e retirar 60 ao mesmo tempo → só um passa (nunca alocado > físico)`, async () => {
    if (mode === 'mutex') mv._setTransactionMode(false);
    const chip = await makeChip({ value: 100 });
    const binder = await makeBinder('B', [{ chip, quantity: 100 }]);
    const admin = await as('admin');
    const t = await tournament('T');

    for (let round = 0; round < 3; round++) {
      await Allocation.deleteMany({});
      await Movement.collection.deleteMany({ type: 'WITHDRAWAL' });
      await Movement.collection.deleteMany({ type: 'REVERSAL' });
      const [a, w] = await Promise.all([
        allocate(admin, t, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: chip._id, quantity: 60 }] }),
        post(admin, '/api/movements', { type: 'WITHDRAWAL', binder_id: binder._id, chip_id: chip._id, quantity: 60, reason: 'corrida' }),
      ]);
      assert.equal([a.status, w.status].filter((s) => s < 300).length, 1, `rodada ${round}: ${a.status}/${w.status}`);
      const balance = await mv.balanceAt({ kind: 'binder', id: binder._id }, chip._id);
      const allocated = (await Allocation.find({ open: true })).reduce((x, y) => x + y.chips[0].quantity, 0);
      assert.ok(allocated <= balance, `alocado ${allocated} ≤ saldo ${balance}`);
    }
  });
}

// ─── permissões e leitura ────────────────────────────────────────────────────

test('só o admin aloca/edita/libera; qualquer autenticado consulta; a matriz exige a área "fichários"', async () => {
  const { binder, admin, A, c } = await scene();
  const a = (await allocate(admin, A, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[100]._id, quantity: 10 }] })).body;

  for (const role of ['material', 'salao']) {
    const h = await as(role);
    assert.equal((await allocate(h, A, { binder_id: binder._id, mode: 'binder' })).status, 403, `${role} POST`);
    assert.equal((await put(h, `/api/allocations/${a._id}`, { chips: [{ chip_id: c[100]._id, quantity: 5 }] })).status, 403, `${role} PUT`);
    assert.equal((await del(h, `/api/allocations/${a._id}`)).status, 403, `${role} DELETE`);
    assert.equal((await get(h, `/api/allocations?tournament_id=${A._id}`)).status, 200, `${role} GET`);
  }
  assert.equal((await get(await as('material'), `/api/allocations/matrix?binder_id=${binder._id}`)).status, 200);
  assert.equal((await get(await as('salao'), `/api/allocations/matrix?binder_id=${binder._id}`)).status, 403, 'salão não tem a área fichários');
  assert.equal((await get(admin, '/api/allocations/matrix')).status, 400);
  assert.equal((await request(app).get('/api/allocations')).status, 401);
  assert.equal((await Allocation.findById(a._id)).chips[0].quantity, 10, 'nada mudou');
});

test('GET /allocations: filtros por torneio/fichário e dados populados com saldo', async () => {
  const { binder, admin, A, B, c } = await scene();
  await allocate(admin, A, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[100]._id, quantity: 10 }] });
  await allocate(admin, B, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[500]._id, quantity: 20 }] });

  assert.equal((await get(admin, '/api/allocations')).body.length, 2);
  const forA = (await get(admin, `/api/allocations?tournament_id=${A._id}`)).body;
  assert.equal(forA.length, 1);
  assert.equal(forA[0].tournament_id.name, 'Torneio A');
  assert.equal(forA[0].binder_id.name, 'LISA 1');
  assert.deepEqual([forA[0].chips[0].chip_id.value, forA[0].chips[0].quantity, forA[0].chips[0].balance, forA[0].chips[0].shortfall], [100, 10, 3000, 0]);
  assert.equal((await get(admin, `/api/allocations?binder_id=${binder._id}`)).body.length, 2);
  assert.equal((await get(admin, '/api/allocations?tournament_id=64b000000000000000000000')).body.length, 0);
});

test('a reserva da ficha é a soma das alocações de todos os torneios (cache derivado)', async () => {
  const { binder, admin, A, B, c } = await scene();
  const other = await makeBinder('Outro', [{ chip: c[100], quantity: 1000 }]);
  await allocate(admin, A, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[100]._id, quantity: 700 }] });
  await allocate(admin, B, { binder_id: binder._id, mode: 'quantities', chips: [{ chip_id: c[100]._id, quantity: 300 }] });
  await allocate(admin, B, { binder_id: other._id, mode: 'quantities', chips: [{ chip_id: c[100]._id, quantity: 100 }] });

  const chip = await derived(c[100]);
  assert.deepEqual([chip.total, chip.reserved, chip.total - chip.reserved], [4000, 1100, 2900]);
  assert.equal((await mv.reservedByChip([c[100]._id])).get(String(c[100]._id)), 1100);
  assert.equal(await mv.reservedByChip([c[500]._id]).then((m) => m.size), 0);
});
