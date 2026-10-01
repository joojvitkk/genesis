// G10 — dashboard e relatórios sobre a FONTE DA VERDADE (movimentos): "onde estão as fichas / o que acontece agora" (spec §14, §21).
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const { Movement, Chip, Binder, Occurrence } = require('../models');
const mv = require('../lib/movements');

before(async () => { await connect(); await Occurrence.init(); });
after(disconnect);
beforeEach(clearDb);
afterEach(() => { mv.setNotifier(null); mv._setTransactionMode(null); app.set('io', undefined); });

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);
const oid = (x) => new mongoose.Types.ObjectId(String(x));

// Cenário completo: 2 fichários, torneio com 2 sessões, envio, retorno, descarte, chip race (quebra +500),
// perda no fichário (com recuperação parcial) e perda em jogo.
async function scene() {
  const c100 = await makeChip({ value: 100, color: '#111111' });
  const c500 = await makeChip({ value: 500, color: '#ff0000' });
  const A = await makeBinder('LISA A', [{ chip: c100, quantity: 1000 }, { chip: c500, quantity: 200 }]);
  const B = await makeBinder('LISA B', [{ chip: c100, quantity: 500 }]);
  const admin = await as('admin'); const mat = await as('material'); const sal = await as('salao');
  const t = (await post(admin, '/api/tournaments', { name: 'Warm Up', date: '2026-10-01', sessions: ['Dia 1A', 'Dia 1B'] })).body;
  const [s1, s2] = t.sessions;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: A._id, mode: 'binder' });

  const send = (session, chips) => post(mat, `/api/tournaments/${t._id}/sends`, { chips, session_id: session._id });
  assert.equal((await send(s1, [{ chip_id: c100._id, quantity: 200 }, { chip_id: c500._id, quantity: 20 }])).status, 201);
  assert.equal((await send(s2, [{ chip_id: c100._id, quantity: 100 }])).status, 201);
  assert.equal((await post(mat, `/api/tournaments/${t._id}/returns`, { binder_id: A._id, chips: [{ chip_id: c100._id, quantity: 10 }], session_id: s1._id })).status, 201);
  assert.equal((await post(mat, `/api/tournaments/${t._id}/discards`, { chips: [{ chip_id: c100._id, quantity: 5 }], session_id: s1._id })).status, 201);
  const race = await post(mat, '/api/conversions', { tournament_id: t._id, type: 'CHIP_RACE', binder_id: A._id, session_id: s1._id, outs: [{ chip_id: c100._id, quantity: 5 }], ins: [{ chip_id: c500._id, quantity: 2 }] });
  assert.equal(race.status, 201, JSON.stringify(race.body));
  assert.equal(race.body.math_breakage, 500);
  const lossA = (await post(mat, `/api/binders/${A._id}/count`, { counts: [{ chip_id: c100._id, counted: (await mv.balanceAt({ kind: 'binder', id: A._id }, c100._id)) - 4 }], reason: 'caíram 4' })).body.occurrences[0];
  assert.equal((await post(mat, `/api/occurrences/${lossA._id}/recover`, { quantity: 1 })).status, 201);
  assert.equal((await post(mat, `/api/tournaments/${t._id}/count`, { counts: [{ chip_id: c500._id, counted: 21 }], reason: 'x' })).status, 200); // 22 esperado → −1
  return { c100, c500, A, B, t, s1, s2, admin, mat, sal };
}
const stats = async (h, qs = '') => (await get(h, `/api/dashboard/stats${qs}`)).body;

// ─── ACEITE: bate com GET /balances ──────────────────────────────────────────

test('ACEITE: a matriz fichário × denominação e os totais BATEM com GET /balances', async () => {
  const { admin } = await scene();
  const d = await stats(admin, '?blocks=inventory');
  const b = (await get(admin, '/api/balances')).body;

  const cell = (row, chipId) => row.cells[chipId] || 0;
  for (const r of b.rows) {
    const line = d.inventory.matrix.rows.find((x) => String(x.binder._id) === String(r.binder._id));
    assert.equal(cell(line, String(r.chip._id)), r.quantity, `${r.binder.name} × ${r.chip.value}`);
  }
  assert.equal(d.inventory.matrix.rows.reduce((s, r) => s + r.total, 0), b.totals.quantity);
  assert.equal(d.inventory.matrix.rows.reduce((s, r) => s + r.value, 0), b.totals.value);
  assert.equal(d.inventory.totals.in_binders, b.totals.quantity);
  assert.equal(d.inventory.totals.value_in_binders, b.totals.value);

  const lost = (await get(admin, '/api/balances?kind=lost')).body;
  assert.equal(d.inventory.totals.lost, lost.totals.quantity, 'divergência (fichário + torneio) = GET /balances?kind=lost');
  assert.equal(d.inventory.totals.lost, 3 + 1, '3 de 100 no fichário + 1 de 500 em jogo');
});

test('ACEITE: "quantas existem, onde estão, em que torneio/sessão, retornadas, descartadas, chip race, divergência, recuperadas" numa chamada só', async () => {
  const { c100, c500, t, s1, s2, admin } = await scene();
  const d = await stats(admin);
  const chip = (c) => d.inventory.rows.find((r) => String(r.chip._id) === String(c._id));

  // ficha 100: montadas 1500 → 1000+500. Em jogo: 200+100 −10 retorno −5 descarte −5 (chip race) = 280. Divergência: −4 perdidas +1 recuperada = 3
  assert.deepEqual([chip(c100).in_play, chip(c100).lost], [280, 3]);
  assert.equal(chip(c100).in_binders, 1500 - 300 + 10 + 5 + 5 - 4 + 1, 'em fichários');
  assert.equal(chip(c100).existing, chip(c100).in_binders + chip(c100).in_play);
  assert.equal(chip(c100).existing + chip(c100).lost, 1500, 'conservação: existentes + em divergência = montadas');
  // 500: 200 montadas, +20 enviadas, +2 conversão; 1 perdida em jogo
  assert.deepEqual([chip(c500).in_play, chip(c500).lost, chip(c500).existing + chip(c500).lost], [21, 1, 200]);

  // onde: em qual torneio e sessão
  const row = d.in_play.rows.find((r) => String(r.tournament._id) === t._id);
  assert.equal(row.tournament.name, 'Warm Up');
  const bySession = Object.fromEntries(row.sessions.filter((s) => s.session).map((s) => [String(s.session._id), s]));
  assert.equal(bySession[s1._id].quantity, (await mv.playBalances({ tournament_id: t._id, session_id: s1._id })).reduce((a, r) => a + r.quantity, 0));
  assert.equal(bySession[s2._id].quantity, (await mv.playBalances({ tournament_id: t._id, session_id: s2._id })).reduce((a, r) => a + r.quantity, 0));
  assert.equal(row.quantity, chip(c100).in_play + chip(c500).in_play);
  assert.equal(row.value, 280 * 100 + 21 * 500);
  assert.deepEqual(row.chips.map((c) => c.chip.value), [100, 500]);

  // o que aconteceu
  assert.deepEqual([d.flows.sent.quantity, d.flows.sent.value], [200 + 20 + 100, 200 * 100 + 20 * 500 + 100 * 100]);
  assert.deepEqual([d.flows.returned.quantity, d.flows.returned.value], [10, 1000]);
  assert.deepEqual([d.flows.discarded.quantity, d.flows.discarded.value], [5, 500]);
  assert.deepEqual([d.flows.chip_race.out.quantity, d.flows.chip_race.in.quantity, d.flows.chip_race.count, d.flows.chip_race.math_breakage], [5, 2, 1, 500]);
  assert.deepEqual([d.flows.lost.quantity, d.flows.recovered.quantity], [4 + 1, 1]);
  assert.equal(d.flows.lost.value, 4 * 100 + 500);
});

test('NÃO lê os caches legados: corromper Chip/Binder.chips não muda dashboard, estoque nem relatórios', async () => {
  const { admin } = await scene();
  const before = { d: await stats(admin), inv: (await get(admin, '/api/inventory/by-chip')).body, rep: (await get(admin, '/api/reports/data')).body };
  await Chip.collection.updateMany({}, { $set: { total_quantity: 999999, available_quantity: 888888, reserved_quantity: 777777 } });
  await Binder.collection.updateMany({}, { $set: { chips: [{ chip_id: new mongoose.Types.ObjectId(), quantity: 424242 }] } });
  const after = { d: await stats(admin), inv: (await get(admin, '/api/inventory/by-chip')).body, rep: (await get(admin, '/api/reports/data')).body };
  const clean = (x) => JSON.parse(JSON.stringify(x, (k, v) => (['total_quantity', 'available_quantity', 'reserved_quantity', 'logs', 'recentActivities', 'createdAt', 'updatedAt'].includes(k) ? undefined : v)));
  assert.deepEqual(clean(after.d.inventory), clean(before.d.inventory));
  assert.deepEqual(after.d.metrics, before.d.metrics);
  assert.deepEqual(clean(after.inv), clean(before.inv));
  assert.deepEqual(after.rep.stats, before.rep.stats);
  assert.deepEqual(after.rep.charts, before.rep.charts);
});

// ─── blocos, permissões, formato legado ──────────────────────────────────────

test('?blocks= devolve só o que foi pedido; bloco desconhecido → 400; todos os papéis veem; sem login → 401', async () => {
  const { admin, sal, mat } = await scene();
  const only = await stats(admin, '?blocks=flows,occurrences');
  assert.deepEqual(Object.keys(only).sort(), ['flows', 'occurrences']);
  const all = await stats(admin);
  for (const k of ['metrics', 'recentTournaments', 'recentActivities', 'inventory', 'in_play', 'flows', 'occurrences', 'conflicts', 'timeline', 'binders']) assert.ok(k in all, k);
  const bad = await get(admin, '/api/dashboard/stats?blocks=flows,xpto');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /xpto/);
  for (const h of [sal, mat]) assert.equal((await get(h, '/api/dashboard/stats')).status, 200);
  assert.equal((await request(app).get('/api/dashboard/stats')).status, 401);
});

test('métricas (formato que o painel já usa) agora derivam dos movimentos; "fichários livres" = sem alocação aberta', async () => {
  const { admin, A, B } = await scene();
  const m = (await stats(admin, '?blocks=metrics')).metrics;
  const b = (await get(admin, '/api/balances')).body;
  assert.equal(m.totalChipsInStock, b.totals.quantity);
  assert.equal(m.stockValue, b.totals.value);
  assert.equal(m.availableCases, 1, 'A está alocada ao torneio; B está livre');
  assert.equal(m.chipRacesToday, 1);
  assert.ok(m.chipsInPlay > 0 && m.valueInPlay > 0);
  const bl = (await stats(admin, '?blocks=binders')).binders;
  assert.deepEqual([bl.total, bl.free, bl.allocated], [2, 1, 1]);
  assert.ok(A && B);
});

test('ocorrências: abertas por semáforo, recuperadas e o que ainda falta; conflitos de alocação', async () => {
  const { admin, A, c100, mat } = await scene();
  const o = (await stats(admin, '?blocks=occurrences')).occurrences;
  assert.deepEqual(o.open_by_severity, { GREEN: 2, YELLOW: 0, RED: 0 });
  assert.deepEqual([o.open_total, o.recovered.quantity, o.recovered.occurrences], [2, 1, 1]);
  assert.equal(o.missing_quantity, 3 + 1, '3 de 100 ainda faltam + 1 de 500 perdida em jogo');
  assert.equal(o.pending_justification, 0, 'as duas perdas foram justificadas na conferência');

  // uma alocação SAUDÁVEL (B, de outro torneio) não pode aparecer como conflito
  const other = (await post(admin, '/api/tournaments', { name: 'Outro', date: '2026-10-02' })).body;
  assert.equal((await post(admin, `/api/tournaments/${other._id}/allocations`, { binder_id: (await Binder.findOne({ name: 'LISA B' }))._id, mode: 'binder' })).status, 201);

  // fechar uma ocorrência tira das abertas (mas o registro fica)
  const list = (await get(admin, '/api/occurrences?status=active')).body;
  await post(admin, `/api/occurrences/${list[0]._id}/close`, { justification: 'perda definitiva' });
  assert.equal((await stats(admin, '?blocks=occurrences')).occurrences.open_total, 1);

  // A está alocada ao torneio (fichário inteiro): uma perda depois disso vira conflito de alocação
  await post(mat, `/api/binders/${A._id}/count`, { counts: [{ chip_id: c100._id, counted: 10 }] }); // quase tudo some do fichário
  const conflicts = (await stats(admin, '?blocks=conflicts')).conflicts;
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].binder.name, 'LISA A');
  assert.equal(conflicts[0].tournament.name, 'Warm Up');
  assert.ok(conflicts[0].chips.some((c) => c.chip.value === 100 && c.shortfall > 0));
});

test('linha do tempo: movimentos recentes, mais novos primeiro, com ficha/fichário/torneio; limitada a 15', async () => {
  const { admin, mat, t, A, c100, s1 } = await scene();
  for (let i = 0; i < 4; i++) await post(mat, `/api/tournaments/${t._id}/returns`, { binder_id: A._id, chips: [{ chip_id: c100._id, quantity: 1 }], session_id: s1._id });
  const tl = (await stats(admin, '?blocks=timeline')).timeline;
  assert.equal(await Movement.countDocuments() > 15, true);
  assert.equal(tl.length, 15);
  assert.ok(new Date(tl[0].createdAt) >= new Date(tl[14].createdAt));
  assert.ok(tl.every((m) => m.chip_id?.value !== undefined));
  assert.ok(tl.some((m) => m.tournament_id?.name === 'Warm Up'));
});

test('GET /inventory/by-chip: em fichários, reservado, livre, em jogo — o Estoque não usa mais o cache da ficha', async () => {
  const c100 = await makeChip({ value: 100 });
  const A = await makeBinder('A', [{ chip: c100, quantity: 100 }]);
  const admin = await as('admin'); const mat = await as('material');
  const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01' })).body;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: A._id, mode: 'quantities', chips: [{ chip_id: c100._id, quantity: 30 }] });
  let r = (await get(mat, '/api/inventory/by-chip')).body.rows[0];
  assert.deepEqual([r.in_binders, r.reserved, r.free, r.in_play], [100, 30, 70, 0]);
  await post(mat, `/api/tournaments/${t._id}/sends`, { chips: [{ chip_id: c100._id, quantity: 10 }] });
  r = (await get(mat, '/api/inventory/by-chip')).body.rows[0];
  assert.deepEqual([r.in_binders, r.reserved, r.free, r.in_play], [90, 20, 70, 10], 'enviar consome a reserva; o livre não muda');
  assert.equal((await get(await as('salao'), '/api/inventory/by-chip')).status, 200);
  assert.equal((await request(app).get('/api/inventory/by-chip')).status, 401);
});

// ─── relatórios ──────────────────────────────────────────────────────────────

test('relatórios: estoque, valor, distribuição, perdas e recuperações vêm dos movimentos', async () => {
  const { admin, mat, sal } = await scene();
  const r = (await get(mat, '/api/reports/data')).body;
  const inv = (await stats(admin, '?blocks=inventory')).inventory.totals;
  assert.equal(r.stats.totalChips, inv.existing);
  assert.equal(r.stats.stockValue, inv.value_in_binders + inv.value_in_play);
  assert.deepEqual([r.stats.chipsInBinders, r.stats.chipsInPlay, r.stats.chipsLost], [inv.in_binders, inv.in_play, inv.lost]);
  assert.deepEqual([r.stats.discardedChips, r.stats.discardedValue, r.stats.lostChips, r.stats.recoveredChips, r.stats.recoveredValue], [5, 500, 5, 1, 100]);
  assert.equal(r.stats.openOccurrences, 2);
  assert.equal(r.stats.totalChipRaces, 1);
  const dist = Object.fromEntries(r.charts.chipDistribution.map((c) => [c.name, c]));
  assert.deepEqual([dist['Ficha 100'].in_play, dist['Ficha 100'].in_binders], [280, 1500 - 300 + 10 + 5 + 5 - 4 + 1]);
  assert.equal(r.charts.chipDistribution.reduce((s, c) => s + c.value, 0), r.stats.totalChips);
  assert.deepEqual(r.charts.byLocation.map((x) => x.name), ['Em fichários', 'Em jogo', 'Em divergência']);
  assert.equal((await get(sal, '/api/reports/data')).status, 403);
});

test('comparativo entre torneios: material por torneio (enviado, devolvido, descartado, perdido, quebra)', async () => {
  const { mat, t, A } = await scene();
  const rows = (await get(mat, '/api/reports/comparison')).body;
  const jogo = (await get(mat, '/api/occurrences?scope=tournament')).body[0];
  await post(mat, `/api/occurrences/${jogo._id}/recover`, { quantity: 1, binder_id: A._id }); // a ficha perdida em jogo foi achada
  await require('../models').Tournament.updateOne({ _id: t._id }, { status: 'finished' });
  const rows2 = (await get(mat, '/api/reports/comparison')).body;
  const mine = rows2.find((x) => x._id === t._id);
  assert.ok(mine, 'torneio encerrado aparece no comparativo');
  assert.deepEqual(mine.material, {
    sent_value: 200 * 100 + 20 * 500 + 100 * 100, returned_value: 1000, discarded_value: 500,
    lost_value: 0, math_breakage: 500, // perda em jogo (500) menos a recuperada (500)
  });
  assert.ok(Array.isArray(rows));
});

// ─── tempo real ──────────────────────────────────────────────────────────────

test('cada lote gravado notifica (fichas, fichários, torneios e tipos afetados); falha do ouvinte não atrapalha; null desliga', async () => {
  const c100 = await makeChip({ value: 100 });
  const A = await makeBinder('A', [{ chip: c100, quantity: 50 }]);
  const seen = [];
  mv.setNotifier((p) => seen.push(p));
  const admin = await as('admin');
  const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01' })).body;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: A._id, mode: 'binder' });
  await post(await as('material'), `/api/tournaments/${t._id}/sends`, { chips: [{ chip_id: c100._id, quantity: 5 }] });

  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].types, seen[0].chip_ids, seen[0].binder_ids, seen[0].tournament_ids], [['SEND_ADDITIONAL'], [String(c100._id)], [String(A._id)], [t._id]]);
  assert.ok(seen[0].batch_id);

  mv.setNotifier(() => { throw new Error('ouvinte quebrado'); });
  const ok = await post(await as('material'), `/api/tournaments/${t._id}/returns`, { binder_id: A._id, chips: [{ chip_id: c100._id, quantity: 1 }] });
  assert.equal(ok.status, 201, 'o lançamento acontece mesmo com o ouvinte falhando');
  assert.equal(await mv.balanceAt({ kind: 'binder', id: A._id }, c100._id), 46);

  const before = seen.length;
  mv.setNotifier((p) => seen.push(p));
  await assert.rejects(mv.postBatch([{ type: 'WITHDRAWAL', chip_id: c100._id, quantity: 9999, reason: 'x', from: { kind: 'binder', id: A._id }, to: { kind: 'external' } }]), /Saldo insuficiente/);
  assert.equal(seen.length, before, 'lote recusado não notifica');
  mv.setNotifier(null);
  await mv.postBatch([{ type: 'ASSEMBLY', chip_id: c100._id, quantity: 1, reason: 'x', from: { kind: 'external' }, to: { kind: 'binder', id: A._id } }]);
  assert.equal(seen.length, before);
});

test('estornos abatem os fluxos: envio, descarte e chip race estornados saem do painel', async () => {
  const c100 = await makeChip({ value: 100 });
  const c500 = await makeChip({ value: 500, color: '#ff0000' });
  const A = await makeBinder('A', [{ chip: c100, quantity: 1000 }, { chip: c500, quantity: 100 }]);
  const admin = await as('admin'); const mat = await as('material');
  const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01' })).body;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: A._id, mode: 'quantities', chips: [{ chip_id: c100._id, quantity: 200 }, { chip_id: c500._id, quantity: 50 }] });
  const send = (await post(mat, `/api/tournaments/${t._id}/sends`, { chips: [{ chip_id: c100._id, quantity: 100 }, { chip_id: c500._id, quantity: 10 }] })).body;
  const discard = (await post(mat, `/api/tournaments/${t._id}/discards`, { chips: [{ chip_id: c100._id, quantity: 10 }] })).body;
  const conv = (await post(mat, '/api/conversions', { tournament_id: t._id, type: 'CHIP_RACE', binder_id: A._id, outs: [{ chip_id: c100._id, quantity: 5 }], ins: [{ chip_id: c500._id, quantity: 2 }] })).body;
  const f0 = (await stats(admin, '?blocks=flows')).flows;
  assert.deepEqual([f0.sent.quantity, f0.discarded.quantity, f0.chip_race.out.quantity, f0.chip_race.math_breakage], [110, 10, 5, 500]);

  const ok = async (p) => { const r = await p; assert.ok([200, 201].includes(r.status), JSON.stringify(r.body)); };
  await ok(post(admin, `/api/tournaments/${t._id}/discards/${discard.batch_id}/reverse`, { reason: 'x' }));
  await ok(post(admin, `/api/conversions/${conv._id}/reverse`, { reason: 'x' }));
  await ok(post(admin, `/api/movements/${send.movements[0]._id}/reverse`, { reason: 'x', whole_batch: true }));
  const f = (await stats(admin, '?blocks=flows')).flows;
  assert.deepEqual([f.sent.quantity, f.sent.value, f.discarded.quantity, f.discarded.value], [0, 0, 0, 0]);
  assert.deepEqual([f.chip_race.out.quantity, f.chip_race.in.quantity, f.chip_race.count, f.chip_race.math_breakage], [0, 0, 0, 0], 'conversão estornada não conta (nem a quebra)');
  const inv = (await stats(admin, '?blocks=inventory')).inventory.totals;
  assert.deepEqual([inv.in_play, inv.in_binders], [0, 1000 + 100], 'tudo voltou para o fichário');
});
