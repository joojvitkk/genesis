// G2 — motor de movimentações e saldo derivado (spec §6, §15, §18.1–3).
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Chip, Binder, Movement, BinderModel } = require('../models');
const mv = require('../lib/movements');

before(async () => { await connect(); await Movement.init(); await Chip.init(); });
after(disconnect);
beforeEach(clearDb);
afterEach(() => mv._setTransactionMode(null));

async function as(role = 'admin') {
  const { token } = await makeUser(role);
  return { Authorization: `Bearer ${token}` };
}
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);
const bal = async (binder, chip) => mv.balanceAt({ kind: 'binder', id: binder._id }, chip._id);

// ─── saldo derivado ──────────────────────────────────────────────────────────

test('montagem: o saldo do fichário é derivado dos movimentos (externo → fichário)', async () => {
  const h = await as('admin');
  const chip = await makeChip({ value: 100 });
  const binder = await makeBinder('LISA 1');

  const res = await post(h, '/api/movements', { type: 'ASSEMBLY', binder_id: binder._id, items: [{ chip_id: chip._id, quantity: 3000 }], reason: 'montagem inicial' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const m = res.body.movements[0];
  assert.equal(m.type, 'ASSEMBLY');
  assert.deepEqual([m.from.kind, m.to.kind, String(m.to.id)], ['external', 'binder', String(binder._id)]);

  assert.equal(await bal(binder, chip), 3000);
  const b = await get(h, `/api/balances?binder_id=${binder._id}`);
  assert.equal(b.body.rows.length, 1);
  assert.equal(b.body.rows[0].quantity, 3000);
  assert.equal(b.body.rows[0].chip.value, 100);
  assert.deepEqual(b.body.totals, { quantity: 3000, value: 300000 });

  // o conteúdo do fichário lido pela API é derivado dos movimentos (sem cache gravado)
  const listed = (await get(h, '/api/binders')).body.find((x) => x._id === String(binder._id));
  assert.deepEqual(listed.chips.map((l) => [l.chip_id.value, l.quantity]), [[100, 3000]]);
  assert.equal((await Binder.findById(binder._id)).toObject().chips, undefined, 'nada é gravado no fichário');
  assert.equal((await Chip.findById(chip._id)).toObject().total_quantity, undefined, 'nem na ficha');
});

// ─── nunca saldo negativo ────────────────────────────────────────────────────

test('saída acima do saldo → 409 com o saldo real, e nada é gravado', async () => {
  const h = await as('admin');
  const chip = await makeChip({ value: 100 });
  const binder = await makeBinder('B', [{ chip, quantity: 50 }]);
  const before = await Movement.countDocuments();

  const res = await post(h, '/api/movements', { type: 'WITHDRAWAL', binder_id: binder._id, chip_id: chip._id, quantity: 51, reason: 'teste' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Saldo insuficiente/);
  assert.equal(res.body.details[0].available, 50);
  assert.equal(res.body.details[0].requested, 51);
  assert.equal(await Movement.countDocuments(), before);
  assert.equal(await bal(binder, chip), 50);
});

test('lote é tudo-ou-nada: um item sem saldo derruba o lote inteiro', async () => {
  const h = await as('admin');
  const c1 = await makeChip({ value: 5, color: '#111111' });
  const c2 = await makeChip({ value: 10, color: '#222222' });
  const binder = await makeBinder('B', [{ chip: c1, quantity: 100 }, { chip: c2, quantity: 5 }]);
  const before = await Movement.countDocuments();

  const res = await post(h, '/api/movements', {
    type: 'WITHDRAWAL', binder_id: binder._id, reason: 'x',
    items: [{ chip_id: c1._id, quantity: 10 }, { chip_id: c2._id, quantity: 6 }],
  });
  assert.equal(res.status, 409);
  assert.equal(await Movement.countDocuments(), before, 'nem o item válido foi gravado');
  assert.equal(await bal(binder, c1), 100);
});

test('o mesmo item repetido no lote conta junto contra o saldo', async () => {
  const h = await as('admin');
  const chip = await makeChip({ value: 5 });
  const binder = await makeBinder('B', [{ chip, quantity: 100 }]);
  const res = await post(h, '/api/movements', {
    type: 'WITHDRAWAL', binder_id: binder._id, reason: 'x',
    items: [{ chip_id: chip._id, quantity: 60 }, { chip_id: chip._id, quantity: 60 }],
  });
  assert.equal(res.status, 409);
  assert.equal(await bal(binder, chip), 100);
});

for (const mode of ['auto', 'mutex']) {
  test(`concorrência (${mode}): 6 retiradas simultâneas de 30 sobre 100 → exatamente 3 passam`, async () => {
    if (mode === 'mutex') mv._setTransactionMode(false);
    const h = await as('admin');
    const chip = await makeChip({ value: 5 });
    const binder = await makeBinder('B', [{ chip, quantity: 100 }]);

    const results = await Promise.all(Array.from({ length: 6 }, () =>
      post(h, '/api/movements', { type: 'WITHDRAWAL', binder_id: binder._id, chip_id: chip._id, quantity: 30, reason: 'corrida' })));
    const codes = results.map((r) => r.status).sort();
    assert.deepEqual(codes, [201, 201, 201, 409, 409, 409], JSON.stringify(results.map((r) => r.body.error)));
    assert.equal(await bal(binder, chip), 10, 'saldo nunca fica negativo');
  });
}

// ─── imutabilidade ───────────────────────────────────────────────────────────

test('movimentação é imutável: sem rota de escrita e sem hook que permita alterar/apagar', async () => {
  const h = await as('admin');
  const chip = await makeChip({ value: 5 });
  const binder = await makeBinder('B', [{ chip, quantity: 10 }]);
  const m = await Movement.findOne();

  assert.equal((await request(app).put(`/api/movements/${m._id}`).set(h).send({ quantity: 999 })).status, 404);
  assert.equal((await request(app).patch(`/api/movements/${m._id}`).set(h).send({ quantity: 999 })).status, 404);
  assert.equal((await request(app).delete(`/api/movements/${m._id}`).set(h)).status, 404);

  const blocked = /imutáveis/;
  await assert.rejects(Movement.updateOne({ _id: m._id }, { quantity: 999 }), blocked);
  await assert.rejects(Movement.updateMany({}, { quantity: 999 }), blocked);
  await assert.rejects(Movement.findOneAndUpdate({ _id: m._id }, { quantity: 999 }), blocked);
  await assert.rejects(Movement.replaceOne({ _id: m._id }, { quantity: 999 }), blocked);
  await assert.rejects(Movement.deleteOne({ _id: m._id }), blocked);
  await assert.rejects(Movement.deleteMany({}), blocked);
  await assert.rejects(Movement.findOneAndDelete({ _id: m._id }), blocked);
  m.quantity = 999;
  await assert.rejects(m.save(), blocked);
  await assert.rejects((await Movement.findOne()).deleteOne(), blocked);

  assert.equal((await Movement.findOne()).quantity, 10);
  assert.equal(await bal(binder, chip), 10);
});

// ─── estorno ─────────────────────────────────────────────────────────────────

test('estorno: cria o inverso vinculado ao original, que permanece intacto', async () => {
  const h = await as('admin');
  const chip = await makeChip({ value: 5 });
  const binder = await makeBinder('B', [{ chip, quantity: 50 }]);
  const original = await Movement.findOne();
  const snapshot = JSON.stringify(original.toObject());

  const res = await post(h, `/api/movements/${original._id}/reverse`, { reason: 'lancei no fichário errado' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const rev = res.body.movements[0];
  assert.equal(rev.type, 'REVERSAL');
  assert.equal(String(rev.reverses), String(original._id));
  assert.deepEqual([rev.from.kind, rev.to.kind], ['binder', 'external'], 'sentido invertido');
  assert.equal(rev.quantity, 50);

  assert.equal(await Movement.countDocuments(), 2, 'nada foi apagado');
  assert.equal(JSON.stringify((await Movement.findById(original._id)).toObject()), snapshot, 'original intacto');
  assert.equal(await bal(binder, chip), 0);

  const list = await get(h, `/api/movements?binder_id=${binder._id}`);
  const shown = list.body.find((x) => x._id === String(original._id));
  assert.equal(shown.reversed_by.reason, 'lancei no fichário errado');
  assert.equal(list.body.find((x) => x.type === 'REVERSAL').reversed_by, null);

  // correção = estorno + NOVO lançamento no fichário certo
  const right = await makeBinder('Certo');
  const fix = await post(h, '/api/movements', { type: 'ASSEMBLY', binder_id: right._id, chip_id: chip._id, quantity: 50, reason: 'correção' });
  assert.equal(fix.status, 201);
  assert.equal(await bal(right, chip), 50);
});

test('estorno: 2ª vez → 409; estorno de estorno → 400; motivo obrigatório; só admin', async () => {
  const admin = await as('admin');
  const chip = await makeChip({ value: 5 });
  await makeBinder('B', [{ chip, quantity: 10 }]);
  const original = await Movement.findOne();

  assert.equal((await post(admin, `/api/movements/${original._id}/reverse`, {})).status, 400, 'sem motivo');
  for (const role of ['material', 'salao']) {
    assert.equal((await post(await as(role), `/api/movements/${original._id}/reverse`, { reason: 'x' })).status, 403, role);
  }
  const first = await post(admin, `/api/movements/${original._id}/reverse`, { reason: 'erro' });
  assert.equal(first.status, 201);

  const again = await post(admin, `/api/movements/${original._id}/reverse`, { reason: 'erro de novo' });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /já foi estornado/);

  const ofReversal = await post(admin, `/api/movements/${first.body.movements[0]._id}/reverse`, { reason: 'desfazer' });
  assert.equal(ofReversal.status, 400);
  assert.match(ofReversal.body.error, /não pode ser estornado/);
  assert.equal(await Movement.countDocuments({ type: 'REVERSAL' }), 1);
});

test('estorno duplicado também é barrado pelo índice único do banco', async () => {
  const chip = await makeChip({ value: 5 });
  await makeBinder('B', [{ chip, quantity: 10 }]);
  const original = await Movement.findOne();
  const doc = () => ({
    type: 'REVERSAL', chip_id: chip._id, quantity: 10, from: original.to, to: original.from,
    reverses: original._id, batch_id: new mongoose.Types.ObjectId(), reason: 'x',
  });
  await Movement.create(doc());
  await assert.rejects(Movement.create(doc()), (e) => e.code === 11000);
});

test('não estorna se as fichas já foram movimentadas depois (409 com o saldo atual)', async () => {
  const admin = await as('admin');
  const chip = await makeChip({ value: 5 });
  const binder = await makeBinder('B', [{ chip, quantity: 100 }]);
  const assembly = await Movement.findOne();
  await post(admin, '/api/movements', { type: 'WITHDRAWAL', binder_id: binder._id, chip_id: chip._id, quantity: 70, reason: 'usou' });

  const res = await post(admin, `/api/movements/${assembly._id}/reverse`, { reason: 'erro' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Não é possível estornar/);
  assert.equal(res.body.details[0].available, 30);
  assert.equal(await bal(binder, chip), 30, 'nada mudou');
});

test('estorno de lote inteiro (whole_batch) desfaz uma montagem completa', async () => {
  const admin = await as('admin');
  const c1 = await makeChip({ value: 5, color: '#111111' });
  const c2 = await makeChip({ value: 10, color: '#222222' });
  const binder = await Binder.create({ name: 'B' });
  const built = await post(admin, '/api/movements', { type: 'ASSEMBLY', binder_id: binder._id, items: [{ chip_id: c1._id, quantity: 7 }, { chip_id: c2._id, quantity: 9 }], reason: 'montagem' });
  assert.equal(built.body.movements.length, 2);

  const res = await post(admin, `/api/movements/${built.body.movements[0]._id}/reverse`, { reason: 'montagem errada', whole_batch: true });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.movements.length, 2);
  assert.equal(await bal(binder, c1), 0);
  assert.equal(await bal(binder, c2), 0);
});

// ─── regras por tipo ─────────────────────────────────────────────────────────

test('regras: quantidade, motivo, origem/destino e referências inválidas são recusadas', async () => {
  const h = await as('admin');
  const chip = await makeChip({ value: 5 });
  const inactive = await makeChip({ value: 7, color: '#070707' });
  await Chip.updateOne({ _id: inactive._id }, { active: false });
  const a = await makeBinder('A', [{ chip, quantity: 10 }]);
  const b = await makeBinder('B');
  const base = { binder_id: a._id, chip_id: chip._id };

  const bad = [
    { ...base, type: 'ASSEMBLY', quantity: 0, reason: 'x' },
    { ...base, type: 'ASSEMBLY', quantity: 1.5, reason: 'x' },
    { ...base, type: 'ASSEMBLY', quantity: -3, reason: 'x' },
    { ...base, type: 'WITHDRAWAL', quantity: 1 },                       // sem motivo
    { ...base, type: 'ASSEMBLY', quantity: 1 },                         // montagem também exige motivo (G11)
    { ...base, type: 'LOSS', quantity: 1 },                             // sem motivo
    { ...base, type: 'ADJUSTMENT', quantity: 1, reason: 'x' },          // sem direction
    { ...base, type: 'REVERSAL', quantity: 1, reason: 'x' },            // não é lançável à mão
    { ...base, type: 'NOPE', quantity: 1 },
    { type: 'ASSEMBLY', chip_id: chip._id, quantity: 1 },               // sem fichário
    { binder_id: a._id, type: 'ASSEMBLY', chip_id: inactive._id, quantity: 1 }, // ficha inativa
    { binder_id: '64b000000000000000000000', type: 'ASSEMBLY', chip_id: chip._id, quantity: 1 },
    { binder_id: a._id, type: 'ASSEMBLY', chip_id: '64b000000000000000000000', quantity: 1 },
  ];
  for (const body of bad) assert.equal((await post(h, '/api/movements', body)).status >= 400, true, JSON.stringify(body));

  // LOSS só pode ir para as divergências do MESMO fichário (regra da tabela de tipos)
  await assert.rejects(mv.postBatch([{
    type: 'LOSS', chip_id: chip._id, quantity: 1, reason: 'x',
    from: { kind: 'binder', id: a._id }, to: { kind: 'lost', id: b._id },
  }]), /incompatíveis/);
  await assert.rejects(mv.postBatch([{
    type: 'ASSEMBLY', chip_id: chip._id, quantity: 1, from: { kind: 'external' }, to: { kind: 'lost', id: a._id },
  }]), /incompatíveis/);
  await assert.rejects(mv.postBatch([{
    type: 'WITHDRAWAL', chip_id: chip._id, quantity: 1, reason: 'x', from: { kind: 'binder', id: a._id }, to: { kind: 'binder', id: a._id },
  }]), /incompatíveis/);

  assert.equal(await bal(a, chip), 10, 'nenhuma tentativa inválida gravou algo');
  assert.equal(await Movement.countDocuments(), 1);
});

test('fichário excluído não recebe fichas; excluir exige fichário vazio', async () => {
  const h = await as('admin');
  const chip = await makeChip({ value: 5 });
  const binder = await makeBinder('B', [{ chip, quantity: 10 }]);

  const blocked = await request(app).delete(`/api/binders/${binder._id}`).set(h);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /ainda contém fichas/);

  await post(h, '/api/movements', { type: 'WITHDRAWAL', binder_id: binder._id, chip_id: chip._id, quantity: 10, reason: 'devolvido' });
  assert.equal((await request(app).delete(`/api/binders/${binder._id}`).set(h)).status, 200);
  assert.equal((await post(h, '/api/movements', { type: 'ASSEMBLY', binder_id: binder._id, chip_id: chip._id, quantity: 1 })).status, 400);
});

test('a ficha movimentada fica com valor/cor/tipo travados', async () => {
  const h = await as('admin');
  const chip = await makeChip({ value: 5 });
  await makeBinder('B', [{ chip, quantity: 10 }]);
  const res = await request(app).put(`/api/chips/${chip._id}`).set(h).send({ value: 6 });
  assert.equal(res.status, 409);
});

// ─── permissões (spec §13) ───────────────────────────────────────────────────

test('permissões: só admin monta/retira/ajusta; material lança perda; salão só lê', async () => {
  const chip = await makeChip({ value: 5 });
  const binder = await makeBinder('B', [{ chip, quantity: 20 }]);
  const body = (type, extra = {}) => ({ type, binder_id: binder._id, chip_id: chip._id, quantity: 1, reason: 'x', ...extra });

  const mat = await as('material');
  for (const t of [body('ASSEMBLY'), body('WITHDRAWAL'), body('ADJUSTMENT', { direction: 'in' })]) {
    assert.equal((await post(mat, '/api/movements', t)).status, 403, t.type);
  }
  assert.equal((await post(mat, `/api/binders/${binder._id}/assemble`, { items: [{ chip_id: chip._id, quantity: 1 }] })).status, 403);
  assert.equal((await post(mat, '/api/movements', body('LOSS', { reason: '' }))).status, 400, 'perda exige motivo');
  assert.equal((await post(mat, '/api/movements', body('LOSS'))).status, 201);

  const sal = await as('salao');
  for (const t of ['ASSEMBLY', 'WITHDRAWAL', 'LOSS']) assert.equal((await post(sal, '/api/movements', body(t))).status, 403, `salao ${t}`);

  for (const h of [mat, sal]) {
    assert.equal((await get(h, '/api/movements')).status, 200);
    assert.equal((await get(h, '/api/balances')).status, 200);
  }
  assert.equal((await request(app).get('/api/movements')).status, 401);
  assert.equal(await bal(binder, chip), 19);
});

// ─── conferência ─────────────────────────────────────────────────────────────

test('conferência: falta vira LOSS (divergência), sobra vira FOUND; nada é sobrescrito', async () => {
  const mat = await as('material');
  const c1 = await makeChip({ value: 5, color: '#111111' });
  const c2 = await makeChip({ value: 10, color: '#222222' });
  const c3 = await makeChip({ value: 25, color: '#333333' });
  const binder = await makeBinder('B', [{ chip: c1, quantity: 200 }, { chip: c2, quantity: 50 }, { chip: c3, quantity: 10 }]);

  const res = await post(mat, `/api/binders/${binder._id}/count`, {
    reason: 'fim do turno',
    counts: [{ chip_id: c1._id, counted: 188 }, { chip_id: c2._id, counted: 53 }, { chip_id: c3._id, counted: 10 }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.diffs.map((d) => [d.expected, d.counted, d.diff]).sort((a, b) => a[2] - b[2]), [[200, 188, -12], [50, 53, 3]]);

  assert.equal(await bal(binder, c1), 188);
  assert.equal(await bal(binder, c2), 53);
  assert.equal(await bal(binder, c3), 10, 'sem diferença → sem movimento');
  const loss = await Movement.findOne({ type: 'LOSS' });
  assert.deepEqual([loss.from.kind, loss.to.kind, loss.quantity], ['binder', 'lost', 12]);
  assert.match(loss.reason, /esperado 200, contado 188.*fim do turno/);
  assert.equal((await Movement.findOne({ type: 'FOUND' })).quantity, 3);
  assert.equal(await Movement.countDocuments({ chip_id: c3._id }), 1);

  // as fichas faltantes ficam visíveis como divergência do fichário
  const lost = await get(mat, '/api/balances?kind=lost');
  assert.equal(lost.body.rows.length, 1);
  assert.equal(lost.body.rows[0].quantity, 12);
  assert.equal(await bal(binder, c1), 188);
});

test('conferência: diferença VERMELHA exige justificativa (verde não); contagem inválida é recusada; sem diferença não exige', async () => {
  const mat = await as('material');
  const chip = await makeChip({ value: 5000 }); // ficha de alta criticidade: faixa vermelha
  const binder = await makeBinder('B', [{ chip, quantity: 20 }]);
  const url = `/api/binders/${binder._id}/count`;

  assert.equal((await post(mat, url, { counts: [{ chip_id: chip._id, counted: 19 }] })).status, 400);
  assert.equal((await post(mat, url, { counts: [{ chip_id: chip._id, counted: -1 }], reason: 'x' })).status, 400);
  assert.equal((await post(mat, url, { counts: [{ chip_id: chip._id, counted: 1.5 }], reason: 'x' })).status, 400);
  assert.equal((await post(mat, url, { counts: [{ chip_id: chip._id, counted: 1 }, { chip_id: chip._id, counted: 2 }], reason: 'x' })).status, 400);
  assert.equal(await bal(binder, chip), 20);

  const ok = await post(mat, url, { counts: [{ chip_id: chip._id, counted: 20 }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.diffs, []);
  assert.equal(await Movement.countDocuments({ type: { $in: ['LOSS', 'FOUND'] } }), 0);
});

// ─── listagem ────────────────────────────────────────────────────────────────

test('GET /movements: filtros, paginação e dados populados', async () => {
  const h = await as('admin');
  const c1 = await makeChip({ value: 5, color: '#111111' });
  const c2 = await makeChip({ value: 10, color: '#222222' });
  const a = await makeBinder('A', [{ chip: c1, quantity: 10 }, { chip: c2, quantity: 10 }]);
  const b = await makeBinder('B', [{ chip: c1, quantity: 5 }]);
  await post(h, '/api/movements', { type: 'WITHDRAWAL', binder_id: a._id, chip_id: c1._id, quantity: 3, reason: 'x' });

  assert.equal((await get(h, '/api/movements')).body.length, 4);
  assert.equal((await get(h, `/api/movements?binder_id=${a._id}`)).body.length, 3);
  assert.equal((await get(h, `/api/movements?binder_id=${b._id}`)).body.length, 1);
  assert.equal((await get(h, `/api/movements?chip_id=${c2._id}`)).body.length, 1);
  assert.equal((await get(h, '/api/movements?type=WITHDRAWAL')).body.length, 1);
  assert.equal((await get(h, '/api/movements?type=all')).body.length, 4);

  const page = await get(h, '/api/movements?page=1&limit=2');
  assert.equal(page.body.data.length, 2);
  assert.equal(page.body.pagination.total, 4);
  const first = page.body.data[0];
  assert.equal(first.type, 'WITHDRAWAL', 'mais recente primeiro');
  assert.equal(first.chip_id.value, 5);
  assert.equal(first.binder_id.name, 'A');
  assert.equal(first.user_name, 'Test admin');
});

// ─── propriedade: modelo × motor ─────────────────────────────────────────────

test('propriedade: sequência aleatória de operações — o motor aceita/rejeita como o modelo e conserva as fichas', async () => {
  const rnd = (() => { let a = 0xC0FFEE; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const chips = [await makeChip({ value: 5, color: '#111111' }), await makeChip({ value: 10, color: '#222222' })];
  const binders = [await makeBinder('A'), await makeBinder('B'), await makeBinder('C')];
  const model = new Map(); // "binder:chip" -> saldo esperado
  const lost = new Map();
  const key = (b, c) => `${b._id}:${c._id}`;
  let assembled = 0; let withdrawn = 0;
  const done = [];

  for (let i = 0; i < 70; i++) {
    const b = pick(binders); const c = pick(chips); const q = 1 + Math.floor(rnd() * 40);
    const op = pick(['ASSEMBLY', 'ASSEMBLY', 'WITHDRAWAL', 'LOSS', 'ADJ_IN', 'ADJ_OUT', 'REVERSE']);
    const have = model.get(key(b, c)) || 0;
    const ext = { kind: 'external' }; const bin = { kind: 'binder', id: b._id };
    let spec; let expectOk;
    if (op === 'ASSEMBLY') { spec = { type: 'ASSEMBLY', from: ext, to: bin, reason: 'a' }; expectOk = true; }
    else if (op === 'ADJ_IN') { spec = { type: 'ADJUSTMENT', from: ext, to: bin, reason: 'a' }; expectOk = true; }
    else if (op === 'WITHDRAWAL') { spec = { type: 'WITHDRAWAL', from: bin, to: ext, reason: 'a' }; expectOk = have >= q; }
    else if (op === 'ADJ_OUT') { spec = { type: 'ADJUSTMENT', from: bin, to: ext, reason: 'a' }; expectOk = have >= q; }
    else if (op === 'LOSS') { spec = { type: 'LOSS', from: bin, to: { kind: 'lost', id: b._id }, reason: 'a' }; expectOk = have >= q; }
    else {
      const target = done.filter((d) => !d.reversed).pop();
      if (!target) continue;
      const cur = model.get(key(target.b, target.c)) || 0;
      const lostCur = lost.get(key(target.b, target.c)) || 0;
      const needs = target.dir === 'in' ? cur >= target.q : target.dir === 'lost' ? lostCur >= target.q : true;
      const res = await mv.reverseMovements([target.id], { reason: 'r', user: { name: 't' } }).then(() => true, (e) => (e.status === 409 ? false : Promise.reject(e)));
      assert.equal(res, needs, `estorno #${i}`);
      if (res) {
        target.reversed = true;
        const d = target.dir === 'in' ? -target.q : target.dir === 'out' ? target.q : target.dir === 'lost' ? target.q : 0;
        model.set(key(target.b, target.c), cur + d);
        if (target.dir === 'lost') lost.set(key(target.b, target.c), lostCur - target.q);
        if (target.type === 'ASSEMBLY') assembled -= target.q;
        if (target.type === 'WITHDRAWAL') withdrawn -= target.q;
      }
      continue;
    }
    const ok = await mv.postBatch([{ ...spec, chip_id: c._id, quantity: q }], { user: { name: 't' } }).then((docs) => docs, (e) => (e.status === 409 ? null : Promise.reject(e)));
    assert.equal(!!ok, expectOk, `${op} ${q} com saldo ${have} (#${i})`);
    if (ok) {
      const dir = spec.to.kind === 'binder' ? 'in' : spec.to.kind === 'lost' ? 'lost' : 'out';
      model.set(key(b, c), have + (dir === 'in' ? q : -q));
      if (dir === 'lost') lost.set(key(b, c), (lost.get(key(b, c)) || 0) + q);
      if (spec.type === 'ASSEMBLY') assembled += q;
      if (spec.type === 'WITHDRAWAL') withdrawn += q;
      done.push({ id: ok[0]._id, b, c, q, dir, type: spec.type, reversed: false });
    }
    // invariante: nenhum saldo negativo, em nenhum momento
    for (const r of await mv.balances({})) assert.ok(r.quantity > 0, `saldo negativo/zero listado: ${JSON.stringify(r)}`);
  }

  // saldos do motor == saldos do modelo
  const engine = new Map((await mv.balances({})).map((r) => [`${r.binder_id}:${r.chip_id}`, r.quantity]));
  for (const [k, v] of model) assert.equal(engine.get(k) || 0, v, `saldo ${k}`);
  for (const [k, v] of engine) assert.equal(model.get(k) || 0, v, `saldo extra ${k}`);
  assert.ok(done.length > 15, 'a simulação executou operações suficientes');

  // conservação: nas fichas que entraram por montagem − saíram por retirada, o que está em fichários
  // + divergências fecha com as entradas/saídas por ajuste (tudo é rastreável no livro).
  const totals = await Movement.aggregate([{ $group: { _id: { t: '$type', f: '$from.kind', to: '$to.kind' }, q: { $sum: '$quantity' } } }]);
  const sum = (pred) => totals.filter((r) => pred(r._id)).reduce((a, r) => a + r.q, 0);
  const inflow = sum((x) => x.f === 'external' && x.to === 'binder');
  const outflow = sum((x) => x.f === 'binder' && x.to === 'external');
  const inBinders = [...engine.values()].reduce((a, v) => a + v, 0);
  const inLost = (await mv.balances({ kind: 'lost' })).reduce((a, r) => a + r.quantity, 0);
  assert.equal(inBinders + inLost, inflow - outflow, 'fichas em fichários + em divergência = entradas − saídas');
  assert.ok(assembled >= 0 && withdrawn >= 0);
});

test('montagem: exige motivo e itens; não existe mais "a partir do modelo"', async () => {
  const h = await as('admin');
  const c1 = await makeChip({ value: 5, color: '#111111' });
  const c2 = await makeChip({ value: 10, color: '#222222' });
  const binder = await Binder.create({ name: 'LISA 1' });

  assert.equal((await post(h, `/api/binders/${binder._id}/assemble`, { items: [{ chip_id: c1._id, quantity: 30 }] })).status, 400, 'sem motivo');
  assert.equal((await post(h, `/api/binders/${binder._id}/assemble`, { from_model: true, reason: 'x' })).status, 400, 'sem itens');
  const res = await post(h, `/api/binders/${binder._id}/assemble`, { items: [{ chip_id: c1._id, quantity: 30 }, { chip_id: c2._id, quantity: 20 }], reason: 'reposição do lote' });
  assert.equal(res.status, 201);
  assert.equal(res.body.movements, 2);
  const batch = await Movement.find({ batch_id: res.body.batch_id });
  assert.equal(batch.length, 2);
  assert.match(batch[0].reason, /reposição do lote/);
  assert.equal(await bal(binder, c1), 30);
  assert.equal(await bal(binder, c2), 20);
});
