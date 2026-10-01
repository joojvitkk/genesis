// G1 — Ficha × Modelo de Fichário × Fichário físico (spec §3, §16; João).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Chip, BinderModel, Binder, Movement } = require('../models');
const mv = require('../lib/movements');

before(async () => { await connect(); await Chip.init(); });
after(disconnect);
beforeEach(clearDb);

async function as(role = 'admin') {
  const { token } = await makeUser(role);
  return { Authorization: `Bearer ${token}` };
}
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);

// ─── Ficha ───────────────────────────────────────────────────────────────────

test('cadastro de ficha: valor + cor, SEM quantidade nem nome de modelo', async () => {
  const h = await as('admin');
  const res = await post(h, '/api/chips', { value: 100, color: '#000000' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.value, 100);
  assert.equal(res.body.color, '#000000');
  assert.equal(res.body.kind, undefined, 'não há tipo de ficha');
  assert.equal(res.body.active, true);
  assert.equal(res.body.name, 'Ficha 100', 'rótulo derivado');
  assert.ok(!Object.keys(res.body).some((k) => /quantity/i.test(k)), 'a ficha não tem campo de quantidade');
  assert.equal(await Movement.countDocuments(), 0, 'cadastrar ficha não movimenta estoque');
});

test('cadastro de ficha rejeita nome de modelo e quantidades (400)', async () => {
  const h = await as('admin');
  for (const extra of [{ name: 'Modelo A' }, { total_quantity: 500 }, { initial_quantity: 500 }, { available_quantity: 1 }]) {
    const res = await post(h, '/api/chips', { value: 100, color: '#000000', ...extra });
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.match(res.body.error, /valor nominal/);
  }
  assert.equal(await Chip.countDocuments(), 0);
});

test('valor e cor são obrigatórios e a cor precisa ser hexadecimal', async () => {
  const h = await as('admin');
  assert.equal((await post(h, '/api/chips', { color: '#000000' })).status, 400);
  assert.equal((await post(h, '/api/chips', { value: 100 })).status, 400);
  assert.equal((await post(h, '/api/chips', { value: 100, color: 'preto' })).status, 400);
  assert.equal((await post(h, '/api/chips', { value: -5, color: '#000000' })).status, 400);
  const short = await post(h, '/api/chips', { value: 100, color: '#F00' });
  assert.equal(short.status, 201);
  assert.equal(short.body.color, '#ff0000', 'cor normalizada (#F00 → #ff0000)');
});

test('não existem duas fichas ativas com o mesmo valor + cor + tipo', async () => {
  const h = await as('admin');
  assert.equal((await post(h, '/api/chips', { value: 100, color: '#000000' })).status, 201);

  const dup = await post(h, '/api/chips', { value: 100, color: '#000000' });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /valor e cor/);
  assert.match(dup.body.error, /Reutilize o cadastro existente/);

  // a mesma cor escrita de outro jeito continua sendo a mesma ficha
  assert.equal((await post(h, '/api/chips', { value: 100, color: '#000' })).status, 409);

  // cor diferente ou valor diferente são outras fichas
  assert.equal((await post(h, '/api/chips', { value: 100, color: '#111111' })).status, 201);
  assert.equal((await post(h, '/api/chips', { value: 500, color: '#000000' })).status, 201);
});

test('o índice do banco também barra a duplicata (defesa contra corrida)', async () => {
  await new Chip({ value: 25, color: '#123456' }).save();
  await assert.rejects(new Chip({ value: 25, color: '#123456' }).save(), (e) => e.code === 11000);
});

test('NÃO existe tipo de ficha (nem KO): o campo `kind` é ignorado e a ficha só tem valor nominal e cor', async () => {
  const h = await as('admin');
  const ok = await post(h, '/api/chips', { value: 1, color: '#ffd700', kind: 'KO' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.kind, undefined);
  assert.equal(ok.body.name, 'Ficha 1');
  assert.equal((await Chip.findById(ok.body._id)).toObject().kind, undefined);
  assert.equal((await post(h, '/api/chips', { value: 1, color: '#ffd700', kind: 'TOURNAMENT' })).status, 409, 'mesmo valor e cor = a mesma ficha, qualquer "tipo" enviado');
});

test('JAMAIS valor monetário na ficha: o campo é recusado (400) na criação e na edição, com qualquer nome', async () => {
  const h = await as('admin');
  const chip = await makeChip({ value: 50, color: '#abcdef' });
  for (const extra of [{ monetary_value: 500 }, { monetaryValue: 1 }, { money: 1 }, { price: 2 }, { preco: 3 }, { valor_monetario: 4 }]) {
    const c = await post(h, '/api/chips', { value: 100, color: '#000000', ...extra });
    assert.equal(c.status, 400, `criar ${JSON.stringify(extra)}`);
    assert.match(c.body.error, /valor nominal/);
    assert.equal((await put(h, `/api/chips/${chip._id}`, extra)).status, 400, `editar ${JSON.stringify(extra)}`);
  }
  assert.equal(await Chip.countDocuments(), 1);
  assert.equal((await Chip.findById(chip._id)).toObject().monetary_value, undefined);
});

test('valor, cor e tipo ficam fixos depois do uso; a situação (ativa) continua editável', async () => {
  const h = await as('admin');
  const livre = await makeChip({ value: 10, color: '#aaaaaa' });
  const free = await put(h, `/api/chips/${livre._id}`, { value: 20 });
  assert.equal(free.status, 200, 'ficha nunca usada ainda pode ter o valor corrigido');
  assert.equal(free.body.name, 'Ficha 20');

  const usada = await makeChip({ value: 100, color: '#000000' });
  await BinderModel.create({ name: 'M', composition: [{ chip_id: usada._id, quantity: 10 }] });
  const blocked = await put(h, `/api/chips/${usada._id}`, { value: 200 });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /fixos/);
  assert.equal((await Chip.findById(usada._id)).value, 100);

  const same = await put(h, `/api/chips/${usada._id}`, { value: 100, color: '#000' });
  assert.equal(same.status, 200, 'reenviar os mesmos valores não é mudança');
});

test('desativar: exige saldo zero, não apaga e libera a identidade para outra ficha', async () => {
  const h = await as('admin');
  const comSaldo = await makeChip({ value: 100, color: '#000000' });
  await makeBinder('Com fichas', [{ chip: comSaldo, quantity: 50 }]);
  const blocked = await put(h, `/api/chips/${comSaldo._id}`, { active: false });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /50 unidade/);

  const zerada = await makeChip({ value: 500, color: '#ff0000' });
  const off = await put(h, `/api/chips/${zerada._id}`, { active: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.active, false);
  assert.ok(await Chip.findById(zerada._id), 'a ficha continua existindo (histórico)');

  // descontinuada não bloqueia um novo cadastro com a mesma identidade
  assert.equal((await post(h, '/api/chips', { value: 500, color: '#ff0000' })).status, 201);
  // ...e por isso não pode ser reativada em duplicidade
  const again = await put(h, `/api/chips/${zerada._id}`, { active: true });
  assert.equal(again.status, 409);

  const onlyActive = await request(app).get('/api/chips?active=true').set(h);
  assert.deepEqual(onlyActive.body.map((c) => c.value).sort((a, b) => a - b), [100, 500]);
  const onlyInactive = await request(app).get('/api/chips?active=false').set(h);
  assert.equal(onlyInactive.body.length, 1);
});

test('DELETE /chips responde 405: fichas não são excluídas', async () => {
  const h = await as('admin');
  const chip = await makeChip({ value: 5 });
  const res = await request(app).delete(`/api/chips/${chip._id}`).set(h);
  assert.equal(res.status, 405);
  assert.ok(await Chip.findById(chip._id));
});

// ─── Modelo de Fichário ──────────────────────────────────────────────────────

test('reutiliza a MESMA ficha de 100 em dois modelos com quantidades diferentes', async () => {
  const h = await as('admin');
  const c100 = await makeChip({ value: 100, color: '#000000' });
  const c500 = await makeChip({ value: 500, color: '#ff0000' });

  const a = await post(h, '/api/binder-models', { name: 'Modelo A', composition: [{ chip_id: c100._id, quantity: 1000 }, { chip_id: c500._id, quantity: 200 }] });
  const b = await post(h, '/api/binder-models', { name: 'Modelo B', composition: [{ chip_id: c100._id, quantity: 500 }] });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201, JSON.stringify(b.body));

  assert.equal(await Chip.countDocuments({ value: 100 }), 1, 'continua existindo uma única ficha de 100');
  const list = await request(app).get('/api/binder-models').set(h);
  const q = (name) => list.body.find((m) => m.name === name).composition.find((l) => l.chip_id.value === 100).quantity;
  assert.equal(q('Modelo A'), 1000);
  assert.equal(q('Modelo B'), 500);
});

test('composição inválida é recusada: repetida, vazia, quantidade ruim, ficha inexistente/inativa', async () => {
  const h = await as('admin');
  const c = await makeChip({ value: 100, color: '#000000' });
  const off = await makeChip({ value: 25, color: '#0000ff' });
  await Chip.updateOne({ _id: off._id }, { active: false });
  const ghost = '64b000000000000000000000';

  const cases = [
    [{ chip_id: c._id, quantity: 1 }, { chip_id: c._id, quantity: 2 }],
    [],
    [{ chip_id: c._id, quantity: 0 }],
    [{ chip_id: c._id, quantity: 1.5 }],
    [{ chip_id: c._id, quantity: -3 }],
    [{ chip_id: ghost, quantity: 5 }],
    [{ chip_id: off._id, quantity: 5 }],
  ];
  for (const composition of cases) {
    const res = await post(h, '/api/binder-models', { name: `X${Math.random()}`, composition });
    assert.equal(res.status, 400, JSON.stringify(composition));
  }
  assert.equal(await BinderModel.countDocuments(), 0);
});

test('modelo: nome obrigatório e único (sem diferenciar maiúsculas); editar e excluir', async () => {
  const h = await as('admin');
  const c = await makeChip({ value: 100, color: '#000000' });
  const comp = [{ chip_id: c._id, quantity: 10 }];

  assert.equal((await post(h, '/api/binder-models', { composition: comp })).status, 400);
  const created = await post(h, '/api/binder-models', { name: 'LISA', composition: comp });
  assert.equal(created.status, 201);
  assert.equal((await post(h, '/api/binder-models', { name: 'lisa', composition: comp })).status, 409);

  const edited = await put(h, `/api/binder-models/${created.body._id}`, { composition: [{ chip_id: c._id, quantity: 99 }] });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.composition[0].quantity, 99);

  const del = await request(app).delete(`/api/binder-models/${created.body._id}`).set(h);
  assert.equal(del.status, 200);
  assert.equal((await request(app).get('/api/binder-models').set(h)).body.length, 0);
});

// ─── Fichário físico ─────────────────────────────────────────────────────────

test('vários fichários físicos seguem o mesmo modelo, cada um com sua composição', async () => {
  const h = await as('admin');
  const c100 = await makeChip({ value: 100, color: '#000000' });
  const c500 = await makeChip({ value: 500, color: '#ff0000' });
  const model = await post(h, '/api/binder-models', { name: 'LISA', composition: [{ chip_id: c100._id, quantity: 3000 }, { chip_id: c500._id, quantity: 2000 }] });

  const b1 = await post(h, '/api/binders', { name: 'LISA 1', code: 'L-01', model_id: model.body._id });
  const b2 = await post(h, '/api/binders', { name: 'LISA 2', code: 'L-02', model_id: model.body._id });
  assert.equal(b1.status, 201, JSON.stringify(b1.body));
  assert.equal(b2.status, 201);
  assert.equal(b1.body.model_id.name, 'LISA');
  assert.deepEqual(b1.body.chips, [], 'o fichário nasce vazio: o estoque físico entra por montagem');

  // montar a partir do modelo lança a composição padrão
  const built = await post(h, `/api/binders/${b1.body._id}/assemble`, { from_model: true });
  assert.equal(built.status, 201, JSON.stringify(built.body));
  assert.deepEqual(built.body.case.chips.map((l) => [l.chip_id.value, l.quantity]).sort((a, b) => a[0] - b[0]), [[100, 3000], [500, 2000]]);

  // editar o modelo depois NÃO mexe nos fichários já montados
  await put(h, `/api/binder-models/${model.body._id}`, { composition: [{ chip_id: c100._id, quantity: 1 }] });
  assert.equal(await mv.balanceAt({ kind: 'binder', id: new (require('mongoose').Types.ObjectId)(b1.body._id) }, c100._id), 3000);

  // modelo em uso não pode ser excluído
  const del = await request(app).delete(`/api/binder-models/${model.body._id}`).set(h);
  assert.equal(del.status, 409);
  assert.match(del.body.error, /2 fichário/);
});

test('fichário: pode ser criado sem modelo; nome e código únicos; modelo inexistente é recusado', async () => {
  const h = await as('admin');
  const solo = await post(h, '/api/binders', { name: 'Avulso' });
  assert.equal(solo.status, 201);
  assert.equal(solo.body.model_id, null);
  assert.deepEqual(solo.body.chips, []);
  const withChips = await post(h, '/api/binders', { name: 'Editando chips', chips: [{ chip_id: '64b000000000000000000000', quantity: 5 }] });
  assert.equal(withChips.status, 400, 'o conteúdo do fichário não é editável pelo cadastro');
  assert.match(withChips.body.error, /derivado das movimentações/);

  assert.equal((await post(h, '/api/binders', { name: 'avulso' })).status, 409);
  await post(h, '/api/binders', { name: 'Com código', code: 'X-1' });
  assert.equal((await post(h, '/api/binders', { name: 'Outro', code: 'x-1' })).status, 409);
  assert.equal((await post(h, '/api/binders', { name: 'Sem modelo real', model_id: '64b000000000000000000000' })).status, 400);
  assert.equal((await post(h, '/api/binders', { name: '   ' })).status, 400);
});

test('o alias antigo /cases foi removido (G11): só /binders existe', async () => {
  const h = await as('admin');
  assert.equal((await post(h, '/api/cases', { name: 'Legado' })).status, 404);
  assert.equal((await request(app).get('/api/cases').set(h)).status, 404);
  assert.equal((await post(h, '/api/binders', { name: 'Novo' })).status, 201);
  assert.equal((await request(app).get('/api/binders').set(h)).body.length, 1);
});

test('fichário não aceita definir alocação/estado de torneio pelo cliente', async () => {
  const h = await as('admin');
  const res = await post(h, '/api/binders', {
    name: 'Fraude', allocations: [{ tournament_name: 'X' }], allocated_to_tournament: 'X', allocated_to_tournament_name: 'X',
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.allocations, []);
  assert.ok(!res.body.allocated_to_tournament);
});

// ─── Permissões (spec §13, §18.10) ───────────────────────────────────────────

test('material e salão NÃO criam/editam cadastros estruturais (403), mas continuam vendo', async () => {
  const admin = await as('admin');
  const chip = await makeChip({ value: 100, color: '#000000' });
  const model = (await post(admin, '/api/binder-models', { name: 'M', composition: [{ chip_id: chip._id, quantity: 5 }] })).body;
  const binder = (await post(admin, '/api/binders', { name: 'B' })).body;

  for (const role of ['material', 'salao']) {
    const h = await as(role);
    const attempts = [
      post(h, '/api/chips', { value: 5, color: '#010101' }),
      put(h, `/api/chips/${chip._id}`, { active: false }),
      post(h, '/api/binder-models', { name: 'N', composition: [{ chip_id: chip._id, quantity: 1 }] }),
      put(h, `/api/binder-models/${model._id}`, { name: 'Z' }),
      request(app).delete(`/api/binder-models/${model._id}`).set(h),
      post(h, '/api/binders', { name: 'C' }),
      put(h, `/api/binders/${binder._id}`, { name: 'Z' }),
      request(app).delete(`/api/binders/${binder._id}`).set(h),
    ];
    for (const r of await Promise.all(attempts)) assert.equal(r.status, 403, `${role}: ${r.req.method} ${r.req.path}`);
    assert.equal((await request(app).get('/api/chips').set(h)).status, 200);
  }
  assert.equal(await Chip.countDocuments(), 1);
  assert.equal(await BinderModel.countDocuments(), 1);
  assert.equal(await Binder.countDocuments(), 1);

  // material lê modelos e fichários (área "ficharios"); salão não tem a área
  const mat = await as('material');
  assert.equal((await request(app).get('/api/binder-models').set(mat)).status, 200);
  assert.equal((await request(app).get('/api/binders').set(mat)).status, 200);
  const sal = await as('salao');
  assert.equal((await request(app).get('/api/binder-models').set(sal)).status, 403);
});

test('a conferência de fichário continua sendo uma operação permitida ao material', async () => {
  const chip = await makeChip({ value: 5, color: '#010101' });
  const binder = await makeBinder('Maleta', [{ chip, quantity: 200 }]);

  const mat = await as('material');
  const res = await post(mat, `/api/binders/${binder._id}/count`, { counts: [{ chip_id: chip._id, counted: 188 }], reason: 'contagem do turno' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.diffs[0].diff, -12);

  // o alias antigo /cases foi removido (G11)
  assert.equal((await post(mat, `/api/cases/${binder._id}/count`, { counts: [{ chip_id: chip._id, counted: 180 }], reason: 'de novo' })).status, 404);
});
