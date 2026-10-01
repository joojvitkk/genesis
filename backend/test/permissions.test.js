const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Tournament } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

test('GET /api/users: salão recebe 403, admin recebe 200', async () => {
  const salao = await makeUser('salao');
  const admin = await makeUser('admin');

  const denied = await request(app).get('/api/users').set('Authorization', `Bearer ${salao.token}`);
  assert.equal(denied.status, 403);

  const ok = await request(app).get('/api/users').set('Authorization', `Bearer ${admin.token}`);
  assert.equal(ok.status, 200);
});

test('sem token: 401', async () => {
  const res = await request(app).get('/api/users');
  assert.equal(res.status, 401);
});

test('POST /api/tournaments ignora campos fora da whitelist', async () => {
  const { token } = await makeUser('admin');
  const created = await request(app)
    .post('/api/tournaments')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Etapa 1', date: '2026-10-01', hacker: 'x', deleted_at: '2000-01-01', __proto__: {} });

  assert.equal(created.status, 201);
  assert.equal(created.body.hacker, undefined);

  const inDb = await Tournament.findById(created.body._id);
  assert.equal(inDb.deleted_at, null, 'deleted_at não pode ser setado pelo cliente');
});

test('material não pode acessar /api/usuarios mas pode /api/relatorios', async () => {
  const { token } = await makeUser('material');
  const u = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
  assert.equal(u.status, 403);
  const r = await request(app).get('/api/reports/data').set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 200);
});

// ─── matriz área × nível (G11) ───────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');
const { PERMISSIONS, LEVELS, hasLevel } = require('../middlewares/authMiddleware');

test('a matriz do backend e a do frontend (config.js) são IDÊNTICAS', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'config.js'), 'utf8');
  const block = src.match(/export const PERMISSIONS = (\{[\s\S]*?\n\});/)[1];
  const front = new Function(`return ${block}`)();
  assert.deepEqual(front, PERMISSIONS);
  const lv = src.match(/export const LEVELS = (\[[^\]]*\])/)[1];
  assert.deepEqual(new Function(`return ${lv}`)(), LEVELS);
});

test('hasLevel: cumulativo; papel/área desconhecidos → false', () => {
  assert.equal(hasLevel('material', 'estoque', 'operate'), true);
  assert.equal(hasLevel('material', 'estoque', 'manage'), false);
  assert.equal(hasLevel('material', 'estoque'), true);
  assert.equal(hasLevel('salao', 'ficharios'), false);
  assert.equal(hasLevel('x', 'estoque'), false);
  assert.equal(hasLevel('admin', 'nao_existe'), false);
});

const authOf = async (role) => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const call = (m, h, url, body) => request(app)[m](url).set(h).send(body);

test('ACEITE: material tenta CRIAR ficha, torneio, evento, stack, modelo, fichário → 403 (só operar)', async () => {
  const mat = await authOf('material');
  const attempts = [
    ['post', '/api/chips', { value: 100, color: '#000000' }],
    ['post', '/api/tournaments', { name: 'X', date: '2026-10-01' }],
    ['post', '/api/events', { name: 'E', start_date: '2026-10-01', end_date: '2026-10-02' }],
    ['post', '/api/stacks', { name: 'S', composition: [] }],
    ['post', '/api/binder-models', { name: 'M', composition: [] }],
    ['post', '/api/binders', { name: 'B' }],
    ['post', '/api/blind-templates', { name: 'x', rows: [] }],
    ['post', '/api/payout-templates', { name: 'x', rows: [] }],
    ['post', '/api/users', { name: 'a', email: 'a@a.com', password: 'secret1', role: 'salao' }],
  ];
  for (const [m, url, body] of attempts) assert.equal((await call(m, mat, url, body)).status, 403, `${m} ${url}`);
  assert.equal(await Tournament.countDocuments(), 0);
});

test('salão: não altera a ESTRUTURA do torneio nem opera o material; opera entradas/mesas/relógio', async () => {
  const admin = await authOf('admin'); const sal = await authOf('salao'); const mat = await authOf('material');
  const t = (await call('post', admin, '/api/tournaments', { name: 'T', date: '2026-10-01' })).body;

  assert.equal((await call('post', sal, '/api/tournaments', { name: 'X', date: '2026-10-01' })).status, 403, 'criar torneio');
  assert.equal((await call('delete', sal, `/api/tournaments/${t._id}`)).status, 403, 'excluir torneio');
  for (const body of [{ buy_in: 100 }, { stack_model_id: null }, { name: 'novo nome' }, { blind_structure: [] }]) {
    assert.equal((await call('put', sal, `/api/tournaments/${t._id}`, body)).status, 403, JSON.stringify(body));
    assert.equal((await call('put', mat, `/api/tournaments/${t._id}`, body)).status, 403, `material ${JSON.stringify(body)}`);
  }
  assert.equal((await call('put', admin, `/api/tournaments/${t._id}`, { buy_in: 100 })).status, 200);

  // operação de salão continua funcionando
  assert.equal((await call('put', sal, `/api/tournaments/${t._id}`, { status: 'running' })).status, 200, 'iniciar torneio');
  assert.equal((await call('put', mat, `/api/tournaments/${t._id}`, { notes: 'ok' })).status, 200);
  assert.equal((await call('post', sal, `/api/tournaments/${t._id}/entries`, { type: 'buy-in' })).status, 201, 'registrar entrada');
  assert.equal((await call('post', sal, `/api/tournaments/${t._id}/clock`, { action: 'pause' })).status < 500, true);

  // material/estoque é do material: o salão só consulta
  const chip = await require('./helpers').makeChip({ value: 100 });
  for (const url of [`/api/tournaments/${t._id}/sends`, `/api/tournaments/${t._id}/returns`, `/api/tournaments/${t._id}/discards`, `/api/tournaments/${t._id}/count`]) {
    assert.equal((await call('post', sal, url, { chips: [{ chip_id: chip._id, quantity: 1 }], counts: [] })).status, 403, url);
  }
  assert.equal((await call('post', sal, '/api/conversions', { tournament_id: t._id })).status, 403);
  assert.equal((await call('post', sal, '/api/movements', { type: 'LOSS', binder_id: t._id, chip_id: chip._id, quantity: 1, reason: 'x' })).status, 403);
  assert.equal((await call('post', sal, `/api/binders/${t._id}/count`, { counts: [] })).status, 403);
});

test('operate ≠ manage: material opera movimentos e conferências mas não faz montagem/estorno', async () => {
  const admin = await authOf('admin'); const mat = await authOf('material');
  const chip = await require('./helpers').makeChip({ value: 100 });
  const binder = await require('./helpers').makeBinder('B', [{ chip, quantity: 50 }]);
  const mov = (type, extra = {}) => call('post', mat, '/api/movements', { type, binder_id: binder._id, chip_id: chip._id, quantity: 1, reason: 'x', ...extra });
  assert.equal((await mov('LOSS')).status, 201, 'perda é operação');
  for (const t of ['ASSEMBLY', 'WITHDRAWAL']) assert.equal((await mov(t)).status, 403, t);
  assert.equal((await mov('ADJUSTMENT', { direction: 'in' })).status, 403);
  assert.equal((await call('post', mat, `/api/binders/${binder._id}/count`, { counts: [{ chip_id: chip._id, counted: 49 }] })).status, 200, 'conferir é operação');
  assert.ok(await Tournament.countDocuments() === 0);
});

test('nenhuma rota DELETE de movimentação existe (spec §18.3)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'index.js'), 'utf8');
  assert.equal(/router\.delete\(\s*['"`]\/movements/.test(src), false);
  assert.equal(/Movement\.(deleteOne|deleteMany|findByIdAndDelete|findOneAndDelete)/.test(src), false);
});
