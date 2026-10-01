// G8 — ocorrências, conferência física, recuperação e semáforo (spec §10, §11, §18.1/6/7).
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Occurrence, Movement, Tournament } = require('../models');
const mv = require('../lib/movements');
const sev = require('../lib/severity');
const { DEFAULTS } = require('../lib/settings');

before(async () => { await connect(); await Occurrence.init(); });
after(disconnect);
beforeEach(clearDb);
afterEach(() => { mv._setTransactionMode(null); app.set('io', undefined); });

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);
const del = (h, url) => request(app).delete(url).set(h);
const bal = (binder, chip) => mv.balanceAt({ kind: 'binder', id: binder._id }, chip._id);
const oid = (x) => new (require('mongoose').Types.ObjectId)(String(x)); // ids vindos da API são strings
const lostOf = (id, chip) => mv.balanceAt({ kind: 'lost', id: oid(id) }, chip._id);
const playOf = (t, chip) => mv.balanceAt({ kind: 'play', id: oid(t._id || t) }, chip._id);
const countB = (h, binder, chip, counted, extra = {}) => post(h, `/api/binders/${binder._id}/count`, { counts: [{ chip_id: chip._id, counted }], ...extra });

async function base() {
  const chip = await makeChip({ value: 100 });
  const binder = await makeBinder('LISA 1', [{ chip, quantity: 100 }]);
  return { chip, binder, admin: await as('admin'), mat: await as('material') };
}

// ─── semáforo: função pura ───────────────────────────────────────────────────

test('classify: faixas por valor nominal (100/500 verde, 1.000 amarelo, 5.000+ vermelho)', () => {
  const c = (value) => sev.classify({ kind: 'TOURNAMENT', value }, 1, DEFAULTS.severity).level;
  assert.deepEqual([100, 500, 1000, 5000, 25000].map(c), ['GREEN', 'GREEN', 'YELLOW', 'RED', 'RED']);
  assert.equal(c(501), 'YELLOW', 'a 1ª faixa com up_to >= valor vence');
});

test('classify: escalonamento por quantidade sobe o nível, nunca desce', () => {
  const cfg = { ...DEFAULTS.severity, escalate: { yellow_at_quantity: 10, red_at_quantity: 50 } };
  const c = (value, q) => sev.classify({ value }, q, cfg);
  assert.equal(c(100, 9).level, 'GREEN');
  assert.deepEqual([c(100, 10).level, c(100, 10).reason], ['YELLOW', 'quantity']);
  assert.equal(c(100, 50).level, 'RED');
  assert.equal(c(5000, 1).level, 'RED');
  assert.equal(c(1000, 10).level, 'YELLOW', 'já amarelo: não desce');
  assert.equal(sev.classify({ value: 100 }, 999, DEFAULTS.severity).level, 'GREEN', 'sem escalonamento configurado');
});

test('classify: sem faixa que cubra o valor → conservador (vermelho); requiresJustification respeita o nível', () => {
  assert.equal(sev.classify({ value: 100 }, 1, { bands: [] }).level, 'RED');
  const need = (level, from) => sev.requiresJustification(level, { require_justification_from: from });
  assert.deepEqual([need('GREEN', 'RED'), need('YELLOW', 'RED'), need('RED', 'RED')], [false, false, true]);
  assert.deepEqual([need('GREEN', 'YELLOW'), need('YELLOW', 'YELLOW'), need('GREEN', 'GREEN')], [false, true, true]);
});

test('validate: aceita configuração coerente e recusa a incoerente', () => {
  assert.deepEqual(sev.validate(DEFAULTS.severity), DEFAULTS.severity);
  const ok = sev.validate({ bands: [{ up_to: '200', level: 'GREEN' }, { level: 'RED' }], escalate: { yellow_at_quantity: '5' } });
  assert.deepEqual([ok.bands[0].up_to, ok.bands[1].up_to, ok.escalate.yellow_at_quantity, ok.require_justification_from], [200, null, 5, 'RED']);
  const bad = [
    null, {}, { bands: [] }, { bands: [{ up_to: 100, level: 'BLUE' }, { up_to: null, level: 'RED' }] },
    { bands: [{ up_to: null, level: 'GREEN' }, { up_to: null, level: 'RED' }] },      // sem teto no meio
    { bands: [{ up_to: 500, level: 'GREEN' }, { up_to: 100, level: 'RED' }, { up_to: null, level: 'RED' }] }, // não crescente
    { bands: [{ up_to: 500, level: 'GREEN' }] },                                        // última precisa cobrir o resto
    { bands: [{ up_to: 0, level: 'GREEN' }, { up_to: null, level: 'RED' }] },
    { bands: [{ up_to: null, level: 'RED' }], escalate: { yellow_at_quantity: 10, red_at_quantity: 5 } },
    { bands: [{ up_to: null, level: 'RED' }], escalate: { yellow_at_quantity: 1.5 } },
    { bands: [{ up_to: null, level: 'RED' }], require_justification_from: 'PINK' },
  ];
  for (const b of bad) assert.throws(() => sev.validate(b), /./, JSON.stringify(b));
});

// ─── ACEITE: perda física e recuperação ──────────────────────────────────────

test('ACEITE: perda física −3×100 → ocorrência VERDE; o saldo cai e a divergência aparece', async () => {
  const { chip, binder, mat } = await base();
  const res = await countB(mat, binder, chip, 97);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.diffs.map((d) => [d.expected, d.counted, d.diff, d.severity, d.kind]), [[100, 97, -3, 'GREEN', 'LOSS']]);

  const [o] = res.body.occurrences;
  assert.deepEqual([o.kind, o.scope, o.severity, o.status, o.quantity, o.remaining], ['LOSS', 'binder', 'GREEN', 'open', 3, 3]);
  assert.equal(await bal(binder, chip), 97);
  assert.equal(await lostOf(binder._id, chip), 3);
  const m = await Movement.findOne({ type: 'LOSS' });
  assert.deepEqual([m.from.kind, m.to.kind, m.quantity, String(m.meta.occurrence_id)], ['binder', 'lost', 3, o._id]);
  assert.equal(o.history.length, 1);
  assert.equal(o.history[0].action, 'opened');
  assert.equal(o.user_name, 'Test material');
});

test('ACEITE: recuperação +1 → o saldo sobe, a ocorrência fica recovered/parcial e o histórico é completo', async () => {
  const { chip, binder, mat } = await base();
  const o = (await countB(mat, binder, chip, 97, { reason: 'contagem do turno' })).body.occurrences[0];
  assert.equal(o.status, 'justified', 'com justificativa já nasce justificada');

  const r1 = await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 1, note: 'achada sob a mesa' });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.deepEqual([r1.body.status, r1.body.recovered_quantity, r1.body.remaining], ['partially_recovered', 1, 2]);
  assert.equal(await bal(binder, chip), 98, 'o saldo sobe');
  assert.equal(await lostOf(binder._id, chip), 2);

  const r2 = await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 2 });
  assert.deepEqual([r2.body.status, r2.body.recovered_quantity, r2.body.remaining], ['recovered', 3, 0]);
  assert.equal(await bal(binder, chip), 100);
  assert.equal(await lostOf(binder._id, chip), 0);
  assert.deepEqual(r2.body.history.map((h) => [h.action, h.quantity ?? null]), [['opened', 3], ['recovered', 1], ['recovered', 2]]);
  assert.equal(r2.body.history[1].note, 'achada sob a mesa');
  assert.ok(r2.body.history.every((h) => h.user_name && h.at));
  assert.equal(await Movement.countDocuments({ type: 'RECOVERY' }), 2);
  assert.equal(await Movement.countDocuments({ type: 'LOSS' }), 1, 'a perda original permanece — nada é apagado');

  const again = await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 1 });
  assert.equal(again.status, 409);
  assert.equal((await Occurrence.findById(o._id)).history.length, 3);
});

test('recuperar acima do que falta → 409 (mesmo havendo saldo em divergência de OUTRA ocorrência do mesmo fichário)', async () => {
  const { chip, binder, mat } = await base();
  const a = (await countB(mat, binder, chip, 97)).body.occurrences[0];
  await countB(mat, binder, chip, 94); // segunda ocorrência: −3 (o pool de divergência do fichário agora tem 6)
  assert.equal(await lostOf(binder._id, chip), 6);
  const over = await post(mat, `/api/occurrences/${a._id}/recover`, { quantity: 4 });
  assert.equal(over.status, 409);
  assert.match(over.body.error, /Só 3 ficha/);
  assert.equal(await Movement.countDocuments({ type: 'RECOVERY' }), 0);
  assert.equal((await post(mat, `/api/occurrences/${a._id}/recover`, { quantity: 3 })).status, 201);
});

for (const mode of ['auto', 'mutex']) {
  test(`concorrência (${mode}): 4 recuperações simultâneas de 2 sobre 5 faltando → exatamente 2 passam`, async () => {
    if (mode === 'mutex') mv._setTransactionMode(false);
    const { chip, binder, mat } = await base();
    const o = (await countB(mat, binder, chip, 95)).body.occurrences[0];
    const res = await Promise.all(Array.from({ length: 4 }, () => post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 2 })));
    assert.deepEqual(res.map((r) => r.status).sort(), [201, 201, 409, 409], JSON.stringify(res.map((r) => r.body.error)));
    assert.equal(await lostOf(binder._id, chip), 1);
    assert.equal(await bal(binder, chip), 99);
    assert.equal((await Occurrence.findById(o._id)).recovered_quantity, 4);
  });
}

test('recuperação: validações (quantidade, fichário de perda de fichário, sobra não se recupera)', async () => {
  const { chip, binder, mat } = await base();
  const other = await makeBinder('LISA 2');
  const o = (await countB(mat, binder, chip, 90)).body.occurrences[0];
  for (const quantity of [0, -1, 1.5, 'x', undefined]) assert.equal((await post(mat, `/api/occurrences/${o._id}/recover`, { quantity })).status, 400, String(quantity));
  const wrong = await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 1, binder_id: other._id });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /mesmo fichário/);
  assert.equal((await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 1, binder_id: binder._id })).status, 201);
  assert.equal((await post(mat, '/api/occurrences/64b000000000000000000000/recover', { quantity: 1 })).status, 404);
  assert.equal((await post(mat, '/api/occurrences/lixo/recover', { quantity: 1 })).status, 404);

  const surplus = (await countB(mat, binder, chip, 120)).body.occurrences[0]; // esperado 91 → +29
  assert.equal(surplus.kind, 'SURPLUS');
  const rs = await post(mat, `/api/occurrences/${surplus._id}/recover`, { quantity: 1 });
  assert.equal(rs.status, 409);
  assert.match(rs.body.error, /Só perdas/);
});

// ─── sobra e justificativa ───────────────────────────────────────────────────

test('sobra na conferência → FOUND (externo → fichário) + ocorrência SURPLUS; nada é sobrescrito', async () => {
  const { chip, binder, mat } = await base();
  const res = await countB(mat, binder, chip, 103);
  assert.deepEqual(res.body.diffs.map((d) => [d.diff, d.kind, d.severity]), [[3, 'SURPLUS', 'GREEN']]);
  const m = await Movement.findOne({ type: 'FOUND' });
  assert.deepEqual([m.from.kind, m.to.kind, m.quantity], ['external', 'binder', 3]);
  assert.equal(await bal(binder, chip), 103);
  assert.equal(res.body.occurrences[0].remaining, 0);
});

test('justificativa: obrigatória só a partir do nível configurado; ocorrência aberta pode ser justificada depois', async () => {
  const red = await makeChip({ value: 5000, color: '#00ff00' });
  const green = await makeChip({ value: 100 });
  const binder = await makeBinder('B', [{ chip: red, quantity: 10 }, { chip: green, quantity: 10 }]);
  const mat = await as('material');

  const noReason = await post(mat, `/api/binders/${binder._id}/count`, { counts: [{ chip_id: red._id, counted: 9 }] });
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /RED.*obrigatória/);
  assert.equal(await Occurrence.countDocuments(), 0);
  assert.equal(await Movement.countDocuments({ type: 'LOSS' }), 0, 'nada gravado');

  const mixed = await post(mat, `/api/binders/${binder._id}/count`, { counts: [{ chip_id: green._id, counted: 9 }, { chip_id: red._id, counted: 9 }] });
  assert.equal(mixed.status, 400, 'uma diferença vermelha sem justificativa derruba o lote inteiro');
  assert.equal(await bal(binder, green), 10);

  const g = (await countB(mat, binder, green, 9)).body.occurrences[0];
  assert.equal(g.status, 'open', 'verde sem justificativa: aberta');
  assert.equal(g.justification, undefined);

  const j = await post(mat, `/api/occurrences/${g._id}/justify`, { justification: '  caiu no chão  ' });
  assert.equal(j.status, 201);
  assert.deepEqual([j.body.status, j.body.justification, j.body.history.at(-1).action], ['justified', 'caiu no chão', 'justified']);
  assert.equal((await post(mat, `/api/occurrences/${g._id}/justify`, { justification: '  ' })).status, 400);
});

test('não existe ficha KO: nenhum tratamento especial — a severidade vem só das faixas e da quantidade', async () => {
  const chip = await makeChip({ value: 1, color: '#123456' });
  const binder = await makeBinder('B', [{ chip, quantity: 20 }]);
  const mat = await as('material');
  const events = [];
  app.set('io', { emit: (n, p) => events.push([n, p]) });
  const res = await countB(mat, binder, chip, 19);   // valor 1 → faixa verde: sem exigir justificativa
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.occurrences[0].severity, res.body.occurrences[0].severity_reason], ['GREEN', 'band']);
  const opened = events.find(([n]) => n === 'occurrenceOpened')[1];
  assert.deepEqual([opened.severity, opened.chip.kind, opened.exposed_value], ['GREEN', undefined, undefined]);
});

test('a severidade é fotografada na abertura: mudar a configuração depois não reescreve o passado', async () => {
  const { chip, binder, admin, mat } = await base();
  const before = (await countB(mat, binder, chip, 99)).body.occurrences[0];
  assert.equal(before.severity, 'GREEN');
  const put1 = await put(admin, '/api/settings/severity', { bands: [{ up_to: null, level: 'RED' }], require_justification_from: 'RED' });
  assert.equal(put1.status, 200);
  assert.equal((await Occurrence.findById(before._id)).severity, 'GREEN');
  const after = await countB(mat, binder, chip, 98, { reason: 'x' });
  assert.equal(after.body.occurrences[0].severity, 'RED');
});

// ─── configuração do semáforo ────────────────────────────────────────────────

test('/settings/severity: default, edição só do admin, validação e restauração', async () => {
  const { admin, mat } = await base();
  const sal = await as('salao');
  assert.deepEqual((await get(sal, '/api/settings/severity')).body, DEFAULTS.severity, 'qualquer usuário lê');
  assert.equal((await request(app).get('/api/settings/severity')).status, 401);

  const custom = { bands: [{ up_to: 100, level: 'GREEN' }, { up_to: null, level: 'YELLOW' }], escalate: { yellow_at_quantity: null, red_at_quantity: 20 }, require_justification_from: 'YELLOW' };
  for (const h of [mat, sal]) {
    assert.equal((await put(h, '/api/settings/severity', custom)).status, 403);
    assert.equal((await del(h, '/api/settings/severity')).status, 403);
  }
  assert.equal((await put(admin, '/api/settings/severity', { bands: [] })).status, 400);
  assert.deepEqual((await put(admin, '/api/settings/severity', custom)).body, custom);
  assert.deepEqual((await get(mat, '/api/settings/severity')).body, custom);
  assert.deepEqual((await del(admin, '/api/settings/severity')).body, DEFAULTS.severity);
  assert.deepEqual((await get(mat, '/api/settings/severity')).body, DEFAULTS.severity);
});

test('configuração muda a classificação e a exigência de justificativa das NOVAS ocorrências', async () => {
  const c1000 = await makeChip({ value: 1000, color: '#0000ff' });
  const binder = await makeBinder('B', [{ chip: c1000, quantity: 50 }]);
  const admin = await as('admin'); const mat = await as('material');
  assert.equal((await countB(mat, binder, c1000, 49)).body.occurrences[0].severity, 'YELLOW', 'default: 1.000 amarelo, sem exigir justificativa');

  await put(admin, '/api/settings/severity', { ...DEFAULTS.severity, require_justification_from: 'YELLOW', escalate: { yellow_at_quantity: null, red_at_quantity: 3 } });
  assert.equal((await countB(mat, binder, c1000, 48)).status, 400, 'agora amarelo exige justificativa');
  assert.equal((await countB(mat, binder, c1000, 48, { reason: 'ok' })).body.occurrences[0].severity, 'YELLOW');
  assert.equal((await countB(mat, binder, c1000, 44, { reason: 'ok' })).body.occurrences[0].severity, 'RED', 'perdeu 4 (≥3): escala para vermelho');
});

// ─── conferência do jogo ─────────────────────────────────────────────────────

async function tournamentScene() {
  const c100 = await makeChip({ value: 100 });
  const c1000 = await makeChip({ value: 1000, color: '#0000ff' });
  const binder = await makeBinder('LISA 1', [{ chip: c100, quantity: 1000 }, { chip: c1000, quantity: 100 }]);
  const admin = await as('admin'); const mat = await as('material');
  const t = (await post(admin, '/api/tournaments', { name: 'Warm Up', date: '2026-10-01' })).body;
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id, mode: 'binder' });
  const sent = await post(mat, `/api/tournaments/${t._id}/sends`, { chips: [{ chip_id: c100._id, quantity: 200 }, { chip_id: c1000._id, quantity: 10 }] });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  return { c100, c1000, binder, admin, mat, t };
}
const countT = (h, t, counts, extra = {}) => post(h, `/api/tournaments/${t._id}/count`, { counts, ...extra });

test('conferência do jogo: falta vira LOSS (jogo → divergência do TORNEIO) + ocorrência; o resumo mostra o perdido', async () => {
  const { c100, mat, admin, t } = await tournamentScene();
  const res = await countT(mat, t, [{ chip_id: c100._id, counted: 197 }]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const o = res.body.occurrences[0];
  assert.deepEqual([o.scope, o.kind, o.severity, o.quantity, o.tournament_id, o.binder_id ?? null], ['tournament', 'LOSS', 'GREEN', 3, t._id, null]);

  const m = await Movement.findOne({ type: 'LOSS' });
  assert.deepEqual([m.from.kind, m.to.kind, String(m.to.id), m.binder_id], ['play', 'lost', t._id, null]);
  assert.equal(await playOf(t, c100), 197);
  assert.equal(await lostOf(t._id, c100), 3);

  const row = (await get(admin, `/api/tournaments/${t._id}/material`)).body.rows.find((r) => r.chip.value === 100);
  assert.deepEqual([row.sent, row.on_table, row.lost], [200, 197, 3]);
  assert.equal(await Movement.countDocuments({ type: 'LOSS', tournament_id: t._id }), 1);
});

test('conferência do jogo: recuperar exige o fichário que recebe; volta ao fichário e fecha a ocorrência', async () => {
  const { c100, binder, mat, t } = await tournamentScene();
  const o = (await countT(mat, t, [{ chip_id: c100._id, counted: 197 }])).body.occurrences[0];
  const before = await bal(binder, c100);

  assert.equal((await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 1 })).status, 400);
  assert.equal((await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 1, binder_id: '64b000000000000000000000' })).status, 404);
  const r = await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 3, binder_id: binder._id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'recovered');
  assert.equal(await bal(binder, c100), before + 3);
  assert.equal(await lostOf(t._id, c100), 0);
  const rec = await Movement.findOne({ type: 'RECOVERY' });
  assert.deepEqual([rec.from.kind, String(rec.from.id), rec.to.kind, String(rec.binder_id)], ['lost', t._id, 'binder', String(binder._id)]);
});

test('conferência do jogo: sobra → FOUND (externo → jogo); por sessão só compara a sessão', async () => {
  const { c100, mat, admin, t } = await tournamentScene();
  const sess = (await get(admin, `/api/tournaments/${t._id}/sessions`)).body;
  assert.ok(sess.length >= 1);
  const res = await countT(mat, t, [{ chip_id: c100._id, counted: 205 }]);
  assert.deepEqual(res.body.diffs.map((d) => [d.diff, d.kind]), [[5, 'SURPLUS']]);
  const m = await Movement.findOne({ type: 'FOUND' });
  assert.deepEqual([m.from.kind, m.to.kind], ['external', 'play']);
  assert.equal(await playOf(t, c100), 205);

  assert.equal((await countT(mat, t, [{ chip_id: c100._id, counted: 205 }], { session_id: '64b000000000000000000000' })).status, 404);
});

test('ACEITE: a quebra matemática do Chip Race (+500) NÃO gera ocorrência — a conferência bate por quantidade', async () => {
  const { c100, c1000, binder, mat, t } = await tournamentScene();
  // 5×100 (=500) saem e 1×1000 entra: quebra matemática de +500 (valor colocado − valor retirado)
  const conv = await post(mat, '/api/conversions', {
    tournament_id: t._id, type: 'CHIP_RACE', binder_id: binder._id,
    outs: [{ chip_id: c100._id, quantity: 5 }], ins: [{ chip_id: c1000._id, quantity: 1 }],
  });
  assert.equal(conv.status, 201, JSON.stringify(conv.body));
  assert.equal(conv.body.math_breakage, 500);

  // esperado agora: 100 → 195 ; 1000 → 11 — o operador conta exatamente isso
  const res = await countT(mat, t, [{ chip_id: c100._id, counted: 195 }, { chip_id: c1000._id, counted: 11 }]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.diffs, []);
  assert.deepEqual(res.body.occurrences, []);
  assert.equal(await Occurrence.countDocuments(), 0);
  assert.equal(await Movement.countDocuments({ type: { $in: ['LOSS', 'FOUND'] } }), 0, 'nenhuma perda, nenhuma sobra');
  assert.equal(res.body.value.math_breakage, 500, 'a quebra é só explicação em valor');
  assert.equal(res.body.value.expected, res.body.value.counted);
});

test('conferência do jogo: validações e permissões (salão não confere)', async () => {
  const { c100, mat, t } = await tournamentScene();
  assert.equal((await countT(await as('salao'), t, [{ chip_id: c100._id, counted: 1 }])).status, 403);
  assert.equal((await request(app).post(`/api/tournaments/${t._id}/count`).send({})).status, 401);
  assert.equal((await post(mat, '/api/tournaments/64b000000000000000000000/count', { counts: [] })).status, 404);
  for (const counts of [undefined, [], [{ chip_id: c100._id, counted: -1 }], [{ chip_id: c100._id, counted: 1.5 }], [{ chip_id: 'x', counted: 1 }], [{ chip_id: c100._id, counted: 1 }, { chip_id: c100._id, counted: 2 }]]) {
    assert.equal((await countT(mat, t, counts)).status, 400, JSON.stringify(counts));
  }
  assert.equal(await playOf(t, c100), 200);
  assert.equal((await countT(mat, t, [{ chip_id: c100._id, counted: 200 }])).status, 200, 'sem diferença: tudo certo, nada gravado');
});

test('conferência do jogo também vale depois de o torneio encerrar (fim de operação)', async () => {
  const { c100, mat, t } = await tournamentScene();
  await Tournament.updateOne({ _id: t._id }, { status: 'finished' });
  assert.equal((await countT(mat, t, [{ chip_id: c100._id, counted: 199 }])).status, 200);
});

// ─── perda manual, estorno, encerramento ─────────────────────────────────────

test('perda lançada à mão (Estoque) também vira ocorrência; o motivo é obrigatório e vale como justificativa', async () => {
  const { chip, binder, mat } = await base();
  const body = { type: 'LOSS', binder_id: binder._id, chip_id: chip._id, quantity: 3 };
  assert.equal((await post(mat, '/api/movements', body)).status, 400);
  const res = await post(mat, '/api/movements', { ...body, reason: 'caiu no ralo' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const o = res.body.occurrences[0];
  assert.deepEqual([o.source, o.status, o.justification, o.expected, o.severity, o.quantity], ['manual', 'justified', 'caiu no ralo', null, 'GREEN', 3]);
  assert.equal(await bal(binder, chip), 97);
  assert.equal((await post(mat, '/api/movements', { ...body, chip_id: 'lixo', reason: 'x' })).status, 400);
  assert.equal((await post(mat, '/api/movements', { ...body, binder_id: '64b000000000000000000000', reason: 'x' })).status, 404);
  assert.equal((await post(mat, '/api/movements', { ...body, quantity: 1000, reason: 'x' })).status, 409, 'não perde mais do que existe');
});

test('movimentos de uma ocorrência não se estornam pela rota de movimentos — só pela ocorrência', async () => {
  const { chip, binder, admin, mat } = await base();
  const o = (await countB(mat, binder, chip, 97)).body.occurrences[0];
  const m = await Movement.findOne({ type: 'LOSS' });
  const r = await post(admin, `/api/movements/${m._id}/reverse`, { reason: 'x' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, new RegExp(o._id));
  const batch = await post(admin, `/api/movements/${m._id}/reverse`, { reason: 'x', whole_batch: true });
  assert.equal(batch.status, 409);
  assert.equal(await Movement.countDocuments({ type: 'REVERSAL' }), 0);
});

test('estornar a ocorrência (admin): contagem errada — o saldo volta, o registro permanece como voided; 2× → 409', async () => {
  const { chip, binder, admin, mat } = await base();
  const o = (await countB(mat, binder, chip, 97)).body.occurrences[0];
  const url = `/api/occurrences/${o._id}/reverse`;
  assert.equal((await post(mat, url, { reason: 'x' })).status, 403);
  assert.equal((await post(admin, url, {})).status, 400, 'motivo obrigatório');

  const r = await post(admin, url, { reason: 'contei errado' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'voided');
  assert.equal(await bal(binder, chip), 100);
  assert.equal(await lostOf(binder._id, chip), 0);
  assert.equal(await Occurrence.countDocuments(), 1, 'a ocorrência nunca é apagada (§18.6)');
  assert.equal(await Movement.countDocuments({ type: 'LOSS' }), 1);
  assert.equal(r.body.history.at(-1).action, 'voided');

  assert.equal((await post(admin, url, { reason: 'de novo' })).status, 409);
  assert.equal((await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 1 })).status, 409, 'estornada: nada mais a fazer');
  assert.equal((await post(mat, `/api/occurrences/${o._id}/justify`, { justification: 'x' })).status, 409);
});

test('estornar a ocorrência exige estornar antes as recuperações; estorno de recuperação reabre a divergência', async () => {
  const { chip, binder, admin, mat } = await base();
  const o = (await countB(mat, binder, chip, 97, { reason: 'x' })).body.occurrences[0];
  const rec = await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 2 });
  const batch = rec.body.history.find((h) => h.action === 'recovered').batch_id;

  const blocked = await post(admin, `/api/occurrences/${o._id}/reverse`, { reason: 'x' });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /recuperações/);

  const url = `/api/occurrences/${o._id}/recoveries/reverse`;
  assert.equal((await post(mat, url, { batch_id: batch, reason: 'x' })).status, 403);
  assert.equal((await post(admin, url, { batch_id: batch })).status, 400);
  assert.equal((await post(admin, url, { batch_id: '64b000000000000000000000', reason: 'x' })).status, 404);
  const back = await post(admin, url, { batch_id: batch, reason: 'era outra ficha' });
  assert.equal(back.status, 201, JSON.stringify(back.body));
  assert.deepEqual([back.body.status, back.body.recovered_quantity, back.body.remaining], ['justified', 0, 3]);
  assert.equal(await bal(binder, chip), 97);
  assert.equal(await lostOf(binder._id, chip), 3);
  assert.deepEqual(back.body.history.map((h) => h.action), ['opened', 'recovered', 'recovery_reversed']);
  assert.equal((await post(admin, url, { batch_id: batch, reason: 'de novo' })).status, 409, 'a recuperação só se estorna uma vez');

  assert.equal((await post(admin, `/api/occurrences/${o._id}/reverse`, { reason: 'agora pode' })).status, 201);
});

test('estorno de recuperação é barrado se o fichário já não tem as fichas', async () => {
  const { chip, binder, admin, mat } = await base();
  const o = (await countB(mat, binder, chip, 97, { reason: 'x' })).body.occurrences[0];
  const rec = await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 3 });
  await post(admin, '/api/movements', { type: 'WITHDRAWAL', binder_id: binder._id, chip_id: chip._id, quantity: 100, reason: 'retirada' });
  const r = await post(admin, `/api/occurrences/${o._id}/recoveries/reverse`, { batch_id: rec.body.history[1].batch_id, reason: 'x' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Não é possível estornar/);
});

test('encerrar (admin): exige justificativa, deixa a divergência como perda definitiva e trava as demais ações', async () => {
  const { chip, binder, admin, mat } = await base();
  const o = (await countB(mat, binder, chip, 97)).body.occurrences[0];
  const url = `/api/occurrences/${o._id}/close`;
  assert.equal((await post(mat, url, { justification: 'x' })).status, 403);
  assert.equal((await post(admin, url, {})).status, 400, 'sem justificativa nova nem anterior');

  const c = await post(admin, url, { justification: 'perda definitiva, aceita pela gerência' });
  assert.equal(c.status, 201);
  assert.deepEqual([c.body.status, c.body.remaining, c.body.history.at(-1).action], ['closed', 0, 'closed']);
  assert.equal(await lostOf(binder._id, chip), 3, 'a perda continua registrada nas divergências');
  assert.equal((await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 1 })).status, 409);
  assert.equal((await post(admin, url, { justification: 'x' })).status, 409);

  // usa a justificativa anterior quando já existe
  const j = (await countB(mat, binder, chip, 90, { reason: 'já explicada' })).body.occurrences[0];
  assert.equal((await post(admin, `/api/occurrences/${j._id}/close`, {})).body.justification, 'já explicada');

  // totalmente recuperada não se encerra
  const r = (await countB(mat, binder, chip, 80, { reason: 'x' })).body.occurrences[0];
  await post(mat, `/api/occurrences/${r._id}/recover`, { quantity: r.quantity });
  assert.equal((await post(admin, `/api/occurrences/${r._id}/close`, { justification: 'x' })).status, 409);
});

test('imutável: ocorrência não se edita nem se apaga (405 e bloqueio no modelo)', async () => {
  const { chip, binder, admin, mat } = await base();
  const o = (await countB(mat, binder, chip, 97)).body.occurrences[0];
  for (const h of [admin, mat]) {
    assert.equal((await put(h, `/api/occurrences/${o._id}`, { quantity: 1 })).status, 405);
    assert.equal((await del(h, `/api/occurrences/${o._id}`)).status, 405);
  }
  await assert.rejects(Occurrence.deleteMany({}), /não podem ser apagadas/);
  await assert.rejects(Occurrence.deleteOne({ _id: o._id }), /não podem ser apagadas/);
  assert.equal(await Occurrence.countDocuments(), 1);
});

// ─── consulta, permissões, sockets ───────────────────────────────────────────

test('listagem com filtros (status, severidade, tipo, fichário, torneio) e resumo para o semáforo', async () => {
  const c100 = await makeChip({ value: 100 });
  const c5000 = await makeChip({ value: 5000, color: '#00ff00' });
  const b1 = await makeBinder('B1', [{ chip: c100, quantity: 50 }, { chip: c5000, quantity: 50 }]);
  const b2 = await makeBinder('B2', [{ chip: c100, quantity: 50 }]);
  const admin = await as('admin'); const mat = await as('material'); const sal = await as('salao');
  await countB(mat, b1, c100, 48);                                   // verde, aberta
  const red = (await countB(mat, b1, c5000, 47, { reason: 'x' })).body.occurrences[0]; // vermelha
  await countB(mat, b2, c100, 52);                                   // sobra
  await post(mat, `/api/occurrences/${red._id}/recover`, { quantity: 3 }); // recuperada

  const q = async (qs) => (await get(sal, `/api/occurrences${qs}`)).body;
  assert.equal((await q('')).length, 3);
  assert.deepEqual((await q('?severity=RED')).map((o) => o.status), ['recovered']);
  assert.equal((await q('?status=active')).length, 2, 'ativas = fora de recovered/closed/voided');
  assert.equal((await q('?status=recovered')).length, 1);
  assert.equal((await q('?kind=SURPLUS')).length, 1);
  assert.equal((await q(`?binder_id=${b2._id}`)).length, 1);
  assert.equal((await q(`?chip_id=${c5000._id}`)).length, 1);
  assert.equal((await q('?status=all&severity=all')).length, 3);
  const first = (await q(''))[0];
  assert.equal(first.chip_id.value, 100, 'chip populado');
  assert.equal(first.binder_id.name, 'B2', 'mais recente primeiro; fichário populado');
  assert.equal((await get(sal, `/api/occurrences/${red._id}`)).body.history.length, 2);
  assert.equal((await get(sal, '/api/occurrences/64b000000000000000000000')).status, 404);

  const sum = (await get(sal, '/api/occurrences/summary')).body;
  assert.deepEqual([sum.red_open, sum.pending_justification, sum.by_status.recovered, sum.by_status.open], [0, 2, 1, 2]);
  await countB(mat, b1, c5000, 40, { reason: 'x' }); // −4×5000
  assert.equal((await get(admin, '/api/occurrences/summary')).body.red_open, 1);
  assert.equal((await request(app).get('/api/occurrences')).status, 401);
});

test('permissões: material justifica e recupera; admin estorna, encerra e configura; o salão só consulta', async () => {
  const { chip, binder, mat } = await base();
  const sal = await as('salao');
  const o = (await countB(mat, binder, chip, 97)).body.occurrences[0];
  for (const [url, body] of [['justify', { justification: 'x' }], ['recover', { quantity: 1 }], ['close', { justification: 'x' }], ['reverse', { reason: 'x' }]]) {
    assert.equal((await post(sal, `/api/occurrences/${o._id}/${url}`, body)).status, 403, `salão ${url}`);
    assert.equal((await request(app).post(`/api/occurrences/${o._id}/${url}`).send(body)).status, 401);
  }
  assert.equal((await countB(sal, binder, chip, 90)).status, 403, 'salão não confere fichário');
  assert.equal((await get(sal, `/api/occurrences/${o._id}`)).status, 200);
});

test('sockets: abrir, justificar e recuperar avisam o painel', async () => {
  const { chip, binder, mat } = await base();
  const events = [];
  app.set('io', { emit: (n, p) => events.push([n, p]) });
  const o = (await countB(mat, binder, chip, 97)).body.occurrences[0];
  assert.deepEqual(events.filter(([n]) => n === 'occurrenceOpened').map(([, p]) => [p.severity, p.quantity]), [['GREEN', 3]]);
  await post(mat, `/api/occurrences/${o._id}/recover`, { quantity: 1 });
  const upd = events.filter(([n]) => n === 'occurrenceUpdated').map(([, p]) => p.status);
  assert.deepEqual(upd, ['partially_recovered']);
  assert.ok(events.filter(([n]) => n === 'balancesChanged').length >= 2);
});

// ─── regras do motor e conservação ───────────────────────────────────────────

test('regras do motor: LOSS/FOUND/RECOVERY só nas rotas de origem/destino previstas', async () => {
  const { chip, binder } = await base();
  const other = await makeBinder('LISA 2');
  const t = await Tournament.create({ name: 'T', date: '2026-10-01' });
  const bin = { kind: 'binder', id: binder._id }; const play = { kind: 'play', id: t._id };
  const bad = [
    { type: 'LOSS', from: play, to: { kind: 'lost', id: binder._id } },     // perda do jogo vai para a divergência do TORNEIO
    { type: 'LOSS', from: bin, to: { kind: 'lost', id: other._id } },
    { type: 'LOSS', from: { kind: 'external' }, to: { kind: 'lost', id: binder._id } },
    { type: 'FOUND', from: bin, to: play },
    { type: 'FOUND', from: { kind: 'external' }, to: { kind: 'lost', id: binder._id } },
    { type: 'RECOVERY', from: bin, to: { kind: 'lost', id: binder._id } },
    { type: 'RECOVERY', from: { kind: 'external' }, to: bin },
    { type: 'RECOVERY', from: { kind: 'lost', id: binder._id }, to: play },
  ];
  for (const w of bad) await assert.rejects(mv.postBatch([{ ...w, chip_id: chip._id, quantity: 1, reason: 'x' }]), /incompatíveis/, JSON.stringify(w));
  await assert.rejects(mv.postBatch([{ type: 'FOUND', from: { kind: 'external' }, to: bin, chip_id: chip._id, quantity: 1 }]), /motivo/, 'FOUND exige motivo');
  assert.equal(await Movement.countDocuments({ type: { $in: ['LOSS', 'FOUND', 'RECOVERY'] } }), 0);
});

test('perda em jogo não pode passar do que está em jogo; recuperação não passa do que está em divergência', async () => {
  const { c100, t } = await tournamentScene();
  const play = { kind: 'play', id: t._id };
  await assert.rejects(mv.postBatch([{ type: 'LOSS', chip_id: c100._id, quantity: 201, from: play, to: { kind: 'lost', id: t._id }, reason: 'x' }]), /Saldo insuficiente/);
  await assert.rejects(mv.postBatch([{ type: 'RECOVERY', chip_id: c100._id, quantity: 1, from: { kind: 'lost', id: t._id }, to: { kind: 'binder', id: (await require('../models').Binder.findOne())._id }, reason: 'x' }]), /Saldo insuficiente/);
});

test('conservação: fichários + em jogo + divergência = montadas + sobras achadas, após conferências, recuperações e estornos', async () => {
  const { c100, c1000, binder, admin, mat, t } = await tournamentScene();
  const a = (await countB(mat, binder, c100, 795)).body.occurrences[0];               // fichário: −5 (esperado 800)
  const b = (await countT(mat, t, [{ chip_id: c100._id, counted: 190 }, { chip_id: c1000._id, counted: 12 }])).body; // jogo: −10 e +2
  await post(mat, `/api/occurrences/${a._id}/recover`, { quantity: 2 });
  const jl = b.occurrences.find((o) => o.kind === 'LOSS');
  await post(mat, `/api/occurrences/${jl._id}/recover`, { quantity: 4, binder_id: binder._id });
  const sur = b.occurrences.find((o) => o.kind === 'SURPLUS');
  await post(admin, `/api/occurrences/${sur._id}/reverse`, { reason: 'contei errado' });

  for (const chip of [c100, c1000]) {
    const inBinders = await mv.chipTotal(chip._id);
    const inPlay = await playOf(t, chip);
    const lost = (await lostOf(binder._id, chip)) + (await lostOf(t._id, chip));
    const sum = async (type) => (await Movement.aggregate([{ $match: { chip_id: chip._id, type } }, { $group: { _id: null, q: { $sum: '$quantity' } } }]))[0]?.q || 0;
    const reversedFound = (await Movement.aggregate([{ $match: { chip_id: chip._id, type: 'REVERSAL', 'meta.original_type': 'FOUND' } }, { $group: { _id: null, q: { $sum: '$quantity' } } }]))[0]?.q || 0;
    assert.equal(inBinders + inPlay + lost, (await sum('ASSEMBLY')) + (await sum('FOUND')) - reversedFound, `ficha ${chip.value}`);
  }
});
