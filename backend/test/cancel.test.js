// G11 — nada operacional é apagado: entradas e eliminações são CANCELADAS com motivo (spec §18.3).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Tournament, TournamentEntry, Elimination, Seat, TournamentSession } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);
const del = (h, url) => request(app).delete(url).set(h);

async function scene(n = 3) {
  const admin = await as('admin');
  const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01', buy_in: 100, bounty_value: 20 })).body;
  // não há cadastro de jogadores: cada entrada é numerada e é ela que ocupa o lugar / é eliminada
  const entries = [];
  for (let i = 0; i < n; i++) entries.push((await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in' })).body);
  return { admin, t, entries };
}

test('DELETE de entrada e de eliminação → 405 (só cancelamento com motivo)', async () => {
  const { admin, t, entries } = await scene();
  const r = await del(admin, `/api/tournaments/${t._id}/entries/${entries[0]._id}`);
  assert.equal(r.status, 405);
  assert.match(r.body.error, /cancele com motivo/);
  assert.equal((await del(admin, `/api/tournaments/${t._id}/eliminations/64b000000000000000000000`)).status, 405);
  assert.equal(await TournamentEntry.countDocuments({ tournament_id: t._id }), 3);
});

test('cancelar entrada: exige motivo; o registro PERMANECE (quem, quando, por quê) e sai dos cálculos', async () => {
  const { admin, t, entries } = await scene();
  const url = `/api/tournaments/${t._id}/entries/${entries[0]._id}/cancel`;
  assert.equal((await post(admin, url, {})).status, 400);
  assert.equal((await post(admin, url, { reason: '   ' })).status, 400);
  assert.equal((await Tournament.findById(t._id)).actual_players, 3);

  const ok = await post(admin, url, { reason: 'lançada em duplicidade' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  // continua no banco, marcada
  const raw = await TournamentEntry.findById(entries[0]._id).setOptions({ withCancelled: true });
  assert.deepEqual([raw.status, raw.cancel_reason, raw.cancelled_by], ['cancelled', 'lançada em duplicidade', 'Test admin']);
  assert.ok(raw.cancelled_at instanceof Date);
  assert.equal(await TournamentEntry.countDocuments({ tournament_id: t._id }), 2, 'consultas ignoram as canceladas');
  assert.equal(await TournamentEntry.countDocuments({ tournament_id: t._id }).setOptions({ withCancelled: true }), 3);

  // efeitos: jogadores, lugar, listagem, financeiro
  assert.equal((await Tournament.findById(t._id)).actual_players, 2);
  assert.equal(await Seat.countDocuments({ tournament_id: t._id, entry_id: entries[0]._id }), 0, 'libera o lugar');
  const list = (await get(admin, `/api/tournaments/${t._id}/entries`)).body;
  assert.equal(list.length, 2);
  const fin = (await get(admin, `/api/tournaments/${t._id}/finance`)).body;
  assert.equal(fin.summary?.total_entries ?? fin.total_entries, 2);

  // 2× → 404 (já não está ativa)
  assert.equal((await post(admin, url, { reason: 'de novo' })).status, 404);
  assert.equal((await post(admin, `/api/tournaments/${t._id}/entries/64b000000000000000000000/cancel`, { reason: 'x' })).status, 404);
});

test('contadores por sessão e fichas em jogo ignoram entradas canceladas', async () => {
  const { admin, t, entries } = await scene();
  const before = (await get(admin, `/api/tournaments/${t._id}/sessions`)).body[0].counts.total;
  await post(admin, `/api/tournaments/${t._id}/entries/${entries[1]._id}/cancel`, { reason: 'x' });
  const after = (await get(admin, `/api/tournaments/${t._id}/sessions`)).body[0].counts.total;
  assert.deepEqual([before, after], [3, 2]);
});

test('o salão cancela entradas (operação de mesa); sessão encerrada só o admin', async () => {
  const { admin, t, entries } = await scene();
  const sal = await as('salao');
  assert.equal((await post(sal, `/api/tournaments/${t._id}/entries/${entries[0]._id}/cancel`, { reason: 'erro de digitação' })).status, 200);

  const session = await TournamentSession.findOne({ tournament_id: t._id });
  await TournamentSession.updateOne({ _id: session._id }, { status: 'finished' });
  const denied = await post(sal, `/api/tournaments/${t._id}/entries/${entries[1]._id}/cancel`, { reason: 'x' });
  assert.equal(denied.status, 409);
  assert.equal((await post(admin, `/api/tournaments/${t._id}/entries/${entries[1]._id}/cancel`, { reason: 'ok' })).status, 200);
});

test('cancelar eliminação: o registro permanece; a entrada volta ao jogo; exige motivo', async () => {
  const { admin, t, entries } = await scene(4);
  const res = await post(admin, `/api/tournaments/${t._id}/eliminations`, { entry_id: entries[0]._id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const elim = await Elimination.findOne({ tournament_id: t._id });
  assert.equal(String(elim.entry_id), String(entries[0]._id));
  const url = `/api/tournaments/${t._id}/eliminations/${elim._id}/cancel`;
  assert.equal((await post(admin, url, {})).status, 400);

  const ok = await post(admin, url, { reason: 'eliminada por engano' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const raw = await Elimination.findById(elim._id).setOptions({ withCancelled: true });
  assert.deepEqual([raw.status, raw.cancel_reason], ['cancelled', 'eliminada por engano']);
  assert.equal(await Elimination.countDocuments({ tournament_id: t._id }), 0, 'sai das consultas');
  assert.equal(await Seat.countDocuments({ tournament_id: t._id, entry_id: entries[0]._id }), 1, 'voltou ao jogo');
  assert.equal((await post(admin, url, { reason: 'x' })).status, 404);
});

test('reentrada é uma NOVA entrada: a eliminada continua eliminada e a nova ganha o seu lugar', async () => {
  const { admin, t, entries } = await scene(4);
  await post(admin, `/api/tournaments/${t._id}/eliminations`, { entry_id: entries[0]._id });
  const re = (await post(admin, `/api/tournaments/${t._id}/entries`, { type: 're-entry' })).body;
  assert.equal(re.number, 5, 'numeração sequencial do torneio');
  assert.equal(await Elimination.countDocuments({ tournament_id: t._id }), 1, 'a eliminação da entrada #1 permanece');
  assert.equal(await Seat.countDocuments({ tournament_id: t._id, entry_id: re._id }), 1);
  assert.equal(await Seat.countDocuments({ tournament_id: t._id, entry_id: entries[0]._id }), 0);
});

test('não se cancela uma entrada já eliminada (cancele a eliminação antes)', async () => {
  const { admin, t, entries } = await scene(3);
  await post(admin, `/api/tournaments/${t._id}/eliminations`, { entry_id: entries[0]._id });
  const r = await post(admin, `/api/tournaments/${t._id}/entries/${entries[0]._id}/cancel`, { reason: 'x' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /cancele a eliminação/);
});

test('excluir o torneio preserva entradas, eliminações e movimentos', async () => {
  const { admin, t, entries } = await scene(3);
  await post(admin, `/api/tournaments/${t._id}/eliminations`, { entry_id: entries[0]._id });
  assert.equal((await del(admin, `/api/tournaments/${t._id}`)).status, 200);
  assert.equal(await TournamentEntry.countDocuments({ tournament_id: t._id }), 3);
  assert.equal(await Elimination.countDocuments({ tournament_id: t._id }), 1);
});

test('o modelo bloqueia apagar entradas e eliminações (deleteOne/deleteMany/findOneAndDelete)', async () => {
  const { t, entries } = await scene(2);
  await assert.rejects(TournamentEntry.deleteMany({ tournament_id: t._id }), /cancele com motivo/);
  await assert.rejects(TournamentEntry.deleteOne({ _id: entries[0]._id }), /cancele com motivo/);
  await assert.rejects(TournamentEntry.findOneAndDelete({ _id: entries[0]._id }), /cancele com motivo/);
  await assert.rejects((await TournamentEntry.findById(entries[0]._id)).deleteOne(), /cancele com motivo/);
  await assert.rejects(Elimination.deleteMany({}), /cancele com motivo/);
  assert.equal(await TournamentEntry.countDocuments({ tournament_id: t._id }), 2);
});
