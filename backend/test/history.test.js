// G11 — histórico de saldo (spec §15): o efeito de cada movimento no saldo, reconstruído dos movimentos.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const { User } = require('../models');
const mv = require('../lib/movements');

before(connect);
after(disconnect);
beforeEach(clearDb);

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);
const oid = (x) => new mongoose.Types.ObjectId(String(x));

async function scene() {
  const chip = await makeChip({ value: 100 });
  const other = await makeChip({ value: 500, color: '#ff0000' });
  const binder = await makeBinder('LISA', [{ chip, quantity: 100 }, { chip: other, quantity: 40 }]);
  const admin = await as('admin'); const mat = await as('material');
  const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01' })).body;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'binder' });
  await post(mat, `/api/tournaments/${t._id}/sends`, { chips: [{ chip_id: chip._id, quantity: 30 }, { chip_id: other._id, quantity: 5 }] });
  await post(mat, `/api/tournaments/${t._id}/returns`, { binder_id: binder._id, chips: [{ chip_id: chip._id, quantity: 10 }] });
  const loss = (await post(mat, `/api/binders/${binder._id}/count`, { counts: [{ chip_id: chip._id, counted: 76 }], reason: 'caíram 4' })).body.occurrences[0]; // esperado 80 → 76
  await post(mat, `/api/occurrences/${loss._id}/recover`, { quantity: 1 });
  return { chip, other, binder, admin, mat, t, loss };
}
const hist = async (h, qs) => (await get(h, `/api/audit/history?${qs}`));

test('fichário × ficha: cada lançamento com o efeito e o saldo DEPOIS; o último bate com o saldo derivado', async () => {
  const { chip, binder, admin } = await scene();
  const r = await hist(admin, `binder_id=${binder._id}&chip_id=${chip._id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.entity.type, r.body.entity.name], ['binder', 'LISA']);

  // mais novo primeiro: RECOVERY, LOSS, RETURN, SEND, ASSEMBLY
  assert.deepEqual(r.body.rows.map((m) => m.type), ['RECOVERY', 'LOSS', 'RETURN', 'SEND_ADDITIONAL', 'ASSEMBLY']);
  const flow = r.body.rows.map((m) => m.effects.filter((e) => e.location.kind === 'binder').map((e) => [e.delta, e.balance_after])[0]);
  assert.deepEqual(flow, [[1, 77], [-4, 76], [10, 80], [-30, 70], [100, 100]].map((x, i) => (i === 0 ? [1, 77] : x)));
  // divergência do fichário também é acompanhada
  const lost = r.body.rows.find((m) => m.type === 'LOSS').effects.find((e) => e.location.kind === 'lost');
  assert.deepEqual([lost.delta, lost.balance_after], [4, 4]);
  assert.equal(r.body.rows.find((m) => m.type === 'RECOVERY').effects.find((e) => e.location.kind === 'lost').balance_after, 3);

  // o saldo final reconstruído == o saldo derivado do motor
  const finalBinder = r.body.balances.find((b) => b.location.kind === 'binder');
  assert.equal(finalBinder.quantity, await mv.balanceAt({ kind: 'binder', id: binder._id }, chip._id));
  assert.equal(r.body.balances.find((b) => b.location.kind === 'lost').quantity, await mv.balanceAt({ kind: 'lost', id: binder._id }, chip._id));
  // dados do movimento vêm junto (quem, quando, por quê)
  const loss = r.body.rows.find((m) => m.type === 'LOSS');
  assert.deepEqual([loss.user_name, loss.chip_id.value, /caíram 4/.test(loss.reason)], ['Test material', 100, true]);
});

test('fichário sem filtro de ficha: todas as fichas do fichário; o saldo é por ficha', async () => {
  const { chip, other, binder, admin } = await scene();
  const r = (await hist(admin, `binder_id=${binder._id}`)).body;
  const last = (c) => r.balances.filter((b) => b.location.kind === 'binder' && b.chip_id === String(c._id))[0].quantity;
  assert.equal(last(chip), await mv.balanceAt({ kind: 'binder', id: binder._id }, chip._id));
  assert.equal(last(other), await mv.balanceAt({ kind: 'binder', id: binder._id }, other._id));
  assert.ok(r.rows.some((m) => String(m.chip_id._id) === String(other._id)));
});

test('histórico da FICHA: passa por todas as localizações; a soma dos saldos finais conserva o que foi montado', async () => {
  const { chip, admin } = await scene();
  const r = (await hist(admin, `chip_id=${chip._id}`)).body;
  assert.equal(r.entity.type, 'chip');
  const total = r.balances.reduce((s, b) => s + b.quantity, 0);
  assert.equal(total, 100, 'montadas (100) = fichário + jogo + divergência');
  const kinds = new Set(r.balances.map((b) => b.location.kind));
  assert.deepEqual([...kinds].sort(), ['binder', 'lost', 'play']);
  // a montagem só tem efeito no destino (a origem "externo" não tem saldo)
  const asm = r.rows.find((m) => m.type === 'ASSEMBLY');
  assert.equal(asm.effects.length, 1);
});

test('histórico do TORNEIO: em jogo e divergência; bate com as fichas em jogo', async () => {
  const { chip, other, t, admin, mat } = await scene();
  await post(mat, `/api/tournaments/${t._id}/count`, { counts: [{ chip_id: other._id, counted: 4 }], reason: 'sumiu' });
  const r = (await hist(admin, `tournament_id=${t._id}`)).body;
  assert.deepEqual([r.entity.type, r.entity.name], ['tournament', 'T']);
  const play = (c) => r.balances.find((b) => b.location.kind === 'play' && b.chip_id === String(c._id))?.quantity;
  assert.equal(play(chip), (await mv.playBalances({ tournament_id: t._id, chip_id: chip._id }))[0].quantity);
  assert.equal(play(other), 4);
  assert.equal(r.balances.find((b) => b.location.kind === 'lost' && b.chip_id === String(other._id)).quantity, 1);
  assert.ok(r.rows.every((m) => m.effects.length > 0));
});

test('estorno aparece: o original mostra quem estornou; o estorno é uma linha com efeito inverso', async () => {
  const { chip, admin } = await scene();
  const binder = await makeBinder('Livre', [{ chip, quantity: 50 }]); // sem alocação: a retirada não é barrada pela reserva
  const withdrawal = (await post(admin, '/api/movements', { type: 'WITHDRAWAL', binder_id: binder._id, chip_id: chip._id, quantity: 5, reason: 'saída' })).body.movements[0];
  await post(admin, `/api/movements/${withdrawal._id}/reverse`, { reason: 'engano' });
  const r = (await hist(admin, `binder_id=${binder._id}&chip_id=${chip._id}`)).body;
  const original = r.rows.find((m) => String(m._id) === String(withdrawal._id));
  assert.deepEqual([original.reversed_by.reason, original.reversed_by.user_name], ['engano', 'Test admin']);
  const rev = r.rows.find((m) => m.type === 'REVERSAL');
  assert.equal(rev.effects.find((e) => e.location.kind === 'binder').delta, 5);
  assert.equal(r.rows[0].effects.find((e) => e.location.kind === 'binder').balance_after, await mv.balanceAt({ kind: 'binder', id: binder._id }, chip._id));
});

test('paginação sobre as linhas; validações; permissões', async () => {
  const { chip, binder, t, admin } = await scene();
  const p1 = (await hist(admin, `binder_id=${binder._id}&chip_id=${chip._id}&limit=2&page=1`)).body;
  const p3 = (await hist(admin, `binder_id=${binder._id}&chip_id=${chip._id}&limit=2&page=3`)).body;
  assert.deepEqual([p1.rows.length, p1.pagination.total, p1.pagination.pages, p3.rows.length], [2, 5, 3, 1]);

  assert.equal((await hist(admin, '')).status, 400);
  assert.equal((await hist(admin, `binder_id=${binder._id}&tournament_id=${t._id}`)).status, 400);
  assert.equal((await hist(admin, 'binder_id=lixo')).status, 400);
  assert.equal((await hist(admin, 'binder_id=64b000000000000000000000')).status, 404);
  assert.equal((await hist(admin, 'chip_id=64b000000000000000000000')).status, 404);
  assert.equal((await hist(admin, 'tournament_id=64b000000000000000000000')).status, 404);

  assert.equal((await hist(await as('material'), `binder_id=${binder._id}`)).status, 200);
  assert.equal((await hist(await as('salao'), `binder_id=${binder._id}`)).status, 403, 'auditoria é da área de relatórios');
  assert.equal((await request(app).get(`/api/audit/history?binder_id=${binder._id}`)).status, 401);
});

test('escopo por torneio: usuário restrito não vê o histórico de outro torneio', async () => {
  const { t, admin } = await scene();
  const other = (await post(admin, '/api/tournaments', { name: 'Outro', date: '2026-10-02' })).body;
  const mat = await makeUser('material');
  await User.updateOne({ _id: mat.user._id }, { allowed_tournament_ids: [other._id] });
  const h = { Authorization: `Bearer ${mat.token}` };
  assert.equal((await hist(h, `tournament_id=${t._id}`)).status, 403);
  assert.equal((await hist(h, `tournament_id=${other._id}`)).status, 200);
});
