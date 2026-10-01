// G11 — escopo por torneio (P3): quem tem `allowed_tournament_ids` só enxerga/opera esses torneios.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { User } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

const H = (u) => ({ Authorization: `Bearer ${u.token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);

async function scene() {
  const admin = await makeUser('admin');
  const mk = async (name) => (await post(H(admin), '/api/tournaments', { name, date: '2026-10-01' })).body;
  const A = await mk('Torneio A'); const B = await mk('Torneio B');
  return { admin, A, B };
}
const restricted = async (role, ids) => {
  const u = await makeUser(role);
  await User.updateOne({ _id: u.user._id }, { allowed_tournament_ids: ids });
  return u;
};

test('restrito a A: acessa os endpoints de A, é barrado nos de B (403), e a listagem mostra só A', async () => {
  const { A, B } = await scene();
  const mat = await restricted('material', [A._id]);
  const h = H(mat);

  assert.equal((await get(h, `/api/tournaments/${A._id}`)).status, 200);
  assert.equal((await get(h, `/api/tournaments/${B._id}`)).status, 403);
  for (const suffix of ['chips-in-play', 'material', 'entries', 'sessions', 'discards', 'ko-settlements', 'results']) {
    assert.equal((await get(h, `/api/tournaments/${B._id}/${suffix}`)).status, 403, suffix);
  }
  assert.equal((await post(h, `/api/tournaments/${B._id}/entries`, { type: 'buy-in' })).status, 403);
  assert.equal((await post(h, `/api/tournaments/${B._id}/sends`, { chips: [] })).status, 403);
  assert.equal((await post(h, `/api/tournaments/${B._id}/count`, { counts: [] })).status, 403);
  assert.equal((await post(h, `/api/tournaments/${A._id}/entries`, { type: 'buy-in' })).status, 201, 'no A funciona');

  const list = (await get(h, '/api/tournaments')).body;
  assert.deepEqual(list.map((t) => t.name), ['Torneio A']);
  assert.match((await get(h, `/api/tournaments/${B._id}`)).body.error, /não tem acesso a este torneio/);
});

test('conversão (Chip Race) em torneio fora do escopo → 403', async () => {
  const { A, B } = await scene();
  const mat = await restricted('material', [A._id]);
  const chip = await makeChip({ value: 100 });
  const r = await post(H(mat), '/api/conversions', { tournament_id: B._id, type: 'CHIP_RACE', outs: [{ chip_id: chip._id, quantity: 1 }], ins: [{ chip_id: chip._id, quantity: 1 }] });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /não tem acesso/);
  assert.notEqual((await post(H(mat), '/api/conversions', { tournament_id: A._id, type: 'CHIP_RACE', outs: [], ins: [] })).status, 403, 'em A não é barrado pelo escopo (falha por validação)');
});

test('lista vazia = sem restrição; admin ignora o escopo mesmo se preenchido', async () => {
  const { A, B } = await scene();
  const free = await restricted('salao', []);
  assert.equal((await get(H(free), `/api/tournaments/${B._id}`)).status, 200);
  assert.equal((await get(H(free), '/api/tournaments')).body.length, 2);

  const adm = await makeUser('admin');
  await User.updateOne({ _id: adm.user._id }, { allowed_tournament_ids: [A._id] });
  assert.equal((await get(H(adm), `/api/tournaments/${B._id}`)).status, 200);
  assert.equal((await get(H(adm), '/api/tournaments')).body.length, 2);
});

test('salão restrito: opera mesas/entradas só no torneio permitido', async () => {
  const { A, B } = await scene();
  const sal = await restricted('salao', [B._id]);
  assert.equal((await post(H(sal), `/api/tournaments/${A._id}/entries`, { type: 'buy-in' })).status, 403);
  assert.equal((await post(H(sal), `/api/tournaments/${B._id}/entries`, { type: 'buy-in' })).status, 201);
});

test('sem token → 401 (não 403); token inválido → 401', async () => {
  const { A } = await scene();
  assert.equal((await request(app).get(`/api/tournaments/${A._id}`)).status, 401);
  assert.equal((await request(app).get(`/api/tournaments/${A._id}`).set({ Authorization: 'Bearer lixo' })).status, 401);
});

test('o admin define o escopo ao criar/editar o usuário e ele vale IMEDIATAMENTE (cache limpo)', async () => {
  const { admin, A, B } = await scene();
  const created = await post(H(admin), '/api/users', { name: 'Op', email: 'op@x.com', password: 'secret123', role: 'material', allowed_tournament_ids: [A._id] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const user = await User.findOne({ email: 'op@x.com' });
  assert.deepEqual(user.allowed_tournament_ids.map(String), [A._id]);

  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: user._id, name: user.name, email: user.email, role: 'material', sv: user.session_version }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const h = { Authorization: `Bearer ${token}` };
  assert.equal((await get(h, `/api/tournaments/${B._id}`)).status, 403);

  const upd = await put(H(admin), `/api/users/${user._id}`, { allowed_tournament_ids: [B._id] });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  assert.equal((await get(h, `/api/tournaments/${B._id}`)).status, 200, 'o novo escopo já vale');
  assert.equal((await get(h, `/api/tournaments/${A._id}`)).status, 403);

  await put(H(admin), `/api/users/${user._id}`, { allowed_tournament_ids: [] });
  assert.equal((await get(h, `/api/tournaments/${A._id}`)).status, 200, 'esvaziar = liberar');
});

test('escopo inválido é recusado (lista, ids, torneio inexistente); só o admin mexe nele', async () => {
  const { admin } = await scene();
  const base = { name: 'Op', email: 'op2@x.com', password: 'secret123', role: 'salao' };
  for (const allowed of ['x', [123], ['lixo'], ['64b000000000000000000000']]) {
    assert.equal((await post(H(admin), '/api/users', { ...base, allowed_tournament_ids: allowed })).status, 400, JSON.stringify(allowed));
  }
  assert.equal(await User.countDocuments({ email: 'op2@x.com' }), 0);
  const mat = await makeUser('material');
  assert.equal((await post(H(mat), '/api/users', { ...base, allowed_tournament_ids: [] })).status, 403);
});

test('dados de outro torneio não vazam pelo material: escopo se aplica também ao estoque do torneio', async () => {
  const { A, B, admin } = await scene();
  const chip = await makeChip({ value: 100 });
  const binder = await makeBinder('LISA', [{ chip, quantity: 100 }]);
  await post(H(admin), `/api/tournaments/${B._id}/allocations`, { binder_id: binder._id, mode: 'binder' });
  const mat = await restricted('material', [A._id]);
  assert.equal((await post(H(mat), `/api/tournaments/${B._id}/discards`, { chips: [{ chip_id: chip._id, quantity: 1 }] })).status, 403);
  assert.equal((await post(H(mat), `/api/tournaments/${B._id}/ko-settlements`, { chip_id: chip._id, quantity: 1 })).status, 403);
});
