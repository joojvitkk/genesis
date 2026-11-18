// Endurecimento de segurança e consistência: sessão × papel, escopo por torneio, estoque por sessão e concorrência.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder, tokenFor } = require('./helpers');
const app = require('../app');
const mv = require('../lib/movements');
const { User, TournamentEntry, Elimination } = require('../models');

before(async () => { await connect(); await Elimination.syncIndexes(); });
after(disconnect);
beforeEach(clearDb);
afterEach(() => { mv._setTransactionMode(null); });

const H = (u) => ({ Authorization: `Bearer ${u.token}` });
const post = (h, u, b) => request(app).post(u).set(h).send(b);
const put = (h, u, b) => request(app).put(u).set(h).send(b);
const get = (h, u) => request(app).get(u).set(h);
const loginTok = async (email, password) => (await request(app).post('/api/login').send({ email, password })).body.token;
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

// ─── sessão × papel ──────────────────────────────────────────────────────────

test('rebaixar um admin derruba a sessão dele na hora: o token antigo não cria outro admin', async () => {
  const boss = await makeUser('admin');
  await User.create({ name: 'Ex', email: 'ex@t.com', password: 'secret1', role: 'admin' });
  const exTok = await loginTok('ex@t.com', 'secret1');
  const ex = await User.findOne({ email: 'ex@t.com' });

  const mk = (tok) => post(bearer(tok), '/api/users', { name: 'N', email: `n${Math.random()}@t.com`, password: 'secret1', role: 'admin' });
  assert.equal((await mk(exTok)).status, 201, 'enquanto admin, cria usuários');

  const dem = await put(H(boss), `/api/users/${ex._id}`, { role: 'salao' });
  assert.equal(dem.status, 200);
  assert.equal(dem.body.sessions_revoked, true);

  assert.equal((await mk(exTok)).status, 401, 'token antigo (ainda "admin") foi revogado');
  assert.equal((await get(bearer(exTok), '/api/me')).status, 401);

  const fresh = await loginTok('ex@t.com', 'secret1');
  assert.equal((await get(bearer(fresh), '/api/me')).body.role, 'salao', 'o novo login já vem com o papel certo');
  assert.equal((await mk(fresh)).status, 403, 'e sem poder de admin');
});

test('mesmo um token com papel adulterado/antigo é ignorado: o papel vem do banco', async () => {
  const jwt = require('jsonwebtoken');
  const op = await makeUser('salao');
  const forged = jwt.sign({ id: op.user._id, name: 'x', email: 'x', role: 'admin', sv: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const r = await post(bearer(forged), '/api/users', { name: 'N', email: 'n@t.com', password: 'secret1', role: 'admin' });
  assert.equal(r.status, 403);
});

test('excluir o usuário invalida o token na hora; token sem `sv` não vale', async () => {
  const boss = await makeUser('admin');
  const op = await makeUser('material');
  assert.equal((await get(H(op), '/api/me')).status, 200);
  assert.equal((await request(app).delete(`/api/users/${op.user._id}`).set(H(boss))).status, 200);
  assert.equal((await get(H(op), '/api/me')).status, 401);

  const jwt = require('jsonwebtoken');
  const other = await makeUser('salao');
  const old = jwt.sign({ id: other.user._id, role: 'salao' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await get(bearer(old), '/api/me')).status, 401);
});

// ─── escopo por torneio nas rotas fora de /tournaments/:tid ──────────────────

test('operador restrito ao torneio A não justifica/recupera ocorrência do torneio B, nem a vê', async () => {
  const admin = await makeUser('admin');
  const mkT = async (name) => (await post(H(admin), '/api/tournaments', { name, date: '2026-10-01' })).body;
  const A = await mkT('A'); const B = await mkT('B');
  const chip = await makeChip({ value: 100 });
  const binder = await makeBinder('LISA', [{ chip, quantity: 100 }]);
  await post(H(admin), `/api/tournaments/${B._id}/allocations`, { binder_id: binder._id });
  const sent = await post(H(admin), `/api/tournaments/${B._id}/sends`, { chips: [{ chip_id: chip._id, quantity: 50 }] });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const cnt = await post(H(admin), `/api/tournaments/${B._id}/count`, { counts: [{ chip_id: chip._id, counted: 40 }], reason: 'faltou' });
  assert.equal(cnt.status, 200, JSON.stringify(cnt.body));
  const occ = cnt.body.occurrences[0];

  const mat = await makeUser('material');
  await User.updateOne({ _id: mat.user._id }, { allowed_tournament_ids: [A._id] });
  for (const [path, body] of [['justify', { justification: 'x' }], ['recover', { quantity: 1, binder_id: binder._id }]]) {
    const r = await post(H(mat), `/api/occurrences/${occ._id}/${path}`, body);
    assert.equal(r.status, 403, path);
  }
  assert.equal((await get(H(mat), `/api/occurrences/${occ._id}`)).status, 403);
  assert.equal((await get(H(mat), '/api/occurrences')).body.length, 0, 'a listagem não mostra a ocorrência de B');
  assert.equal((await get(H(mat), `/api/occurrences?tournament_id=${B._id}`)).status, 403);
  assert.equal((await get(H(mat), `/api/movements?tournament_id=${B._id}`)).status, 403);
  assert.equal((await get(H(admin), `/api/occurrences/${occ._id}`)).status, 200);
});

// ─── estoque por sessão ──────────────────────────────────────────────────────

test('devolver pela sessão 1B fichas que só a 1A recebeu é recusado: saldo nunca fica negativo', async () => {
  const admin = await makeUser('admin');
  const chip = await makeChip({ value: 1000, color: '#0000ff' });
  const binder = await makeBinder('LISA', [{ chip, quantity: 500 }]);
  const stack = (await post(H(admin), '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 10, re_entry: 10 } }] })).body;
  const t = (await post(H(admin), '/api/tournaments', { name: 'Main', date: '2026-10-01', stack_model_id: stack._id, sessions: ['Dia 1A', 'Dia 1B'] })).body;
  const s = Object.fromEntries(t.sessions.map((x) => [x.name, x]));
  await post(H(admin), `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id });

  const sent = await post(H(admin), `/api/tournaments/${t._id}/sends`, { chips: [{ chip_id: chip._id, quantity: 100 }], session_id: s['Dia 1A']._id });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  const bad = await post(H(admin), `/api/tournaments/${t._id}/returns`, { binder_id: binder._id, chips: [{ chip_id: chip._id, quantity: 50 }], session_id: s['Dia 1B']._id });
  assert.equal(bad.status, 409, JSON.stringify(bad.body));
  assert.match(bad.body.error, /Dia 1B/);

  const played = (sid) => mv.playBalances({ tournament_id: t._id, session_id: sid }).then((r) => r[0]?.quantity || 0);
  assert.equal(await played(s['Dia 1B']._id), 0, '1B continua em 0, não −50');
  assert.equal(await played(s['Dia 1A']._id), 100);

  const ok = await post(H(admin), `/api/tournaments/${t._id}/returns`, { binder_id: binder._id, chips: [{ chip_id: chip._id, quantity: 50 }], session_id: s['Dia 1A']._id });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(await played(s['Dia 1A']._id), 50);
});

// ─── concorrência ────────────────────────────────────────────────────────────

test('duas conferências simultâneas: só uma registra a perda (contar 90 de 100 termina em 90, não 80)', async () => {
  const admin = await makeUser('admin');
  const chip = await makeChip({ value: 100 });
  const binder = await makeBinder('LISA', [{ chip, quantity: 100 }]);
  const count = () => post(H(admin), `/api/binders/${binder._id}/count`, { counts: [{ chip_id: chip._id, counted: 90 }] });
  const rs = await Promise.all([count(), count()]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409], JSON.stringify(rs.map((r) => r.body)));
  assert.equal(await mv.balanceAt({ kind: 'binder', id: binder._id }, chip._id), 90);
});

test('eliminações simultâneas da mesma entrada: só uma é registrada', async () => {
  const admin = await makeUser('admin');
  const chip = await makeChip({ value: 100 });
  const stack = (await post(H(admin), '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 10, re_entry: 10 } }] })).body;
  const t = (await post(H(admin), '/api/tournaments', { name: 'T', date: '2026-10-01', stack_model_id: stack._id })).body;
  await post(H(admin), `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 8 });
  const entry = await TournamentEntry.findOne({ tournament_id: t._id });
  const elim = () => post(H(admin), `/api/tournaments/${t._id}/eliminations`, { entry_id: entry._id });
  const rs = await Promise.all(Array.from({ length: 6 }, elim));
  assert.equal(rs.filter((r) => r.status === 201).length, 1, JSON.stringify(rs.map((r) => r.status)));
  assert.equal(await Elimination.countDocuments({ entry_id: entry._id }), 1);
});
