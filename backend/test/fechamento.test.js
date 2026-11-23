// Material D/E — a fase seguinte herda a contagem do fim do dia; fechamento do torneio.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser, makeChip, makeBinder } = require('./helpers');
const app = require('../app');

before(connect);
after(disconnect);
beforeEach(clearDb);

const hdr = async (role) => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, u, b) => request(app).post(u).set(h).send(b);
const put = (h, u, b) => request(app).put(u).set(h).send(b);
const get = (h, u) => request(app).get(u).set(h);
const sp = (t, sess) => `/api/tournaments/${t._id}/sessions/${sess._id}`;

async function scene() {
  const admin = await hdr('admin');
  const chip = await makeChip({ value: 1000, color: '#0000ff' });
  const binder = await makeBinder('LISA 1', [{ chip, quantity: 1000 }]);
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 10 } }] })).body;
  const t = (await post(admin, '/api/tournaments', { name: 'Main', date: '2026-10-01', stack_model_id: stack._id, sessions: ['Dia 1A', 'Dia 2'] })).body;
  const s = Object.fromEntries(t.sessions.map((x) => [x.name, x]));
  await put(admin, sp(t, s['Dia 2']), { type: 'CONTINUATION' });
  await post(admin, `/api/tournaments/${t._id}/allocations`, { binder_id: binder._id });
  await put(admin, sp(t, s['Dia 1A']), { status: 'running' });
  await post(admin, `/api/tournaments/${t._id}/sends`, { items: [{ action: 'buy_in', count: 6 }], session_id: s['Dia 1A']._id });
  assert.equal((await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', quantity: 5, session_id: s['Dia 1A']._id })).status, 201);
  assert.equal((await put(admin, sp(t, s['Dia 1A']), { status: 'finished', qualified_count: 5 })).status, 200);
  const inPlay2 = async () => (await get(admin, `/api/tournaments/${t._id}/material?session_id=${s['Dia 2']._id}`)).body.rows.find((r) => r.chip._id === String(chip._id))?.in_play;
  const count = (sess, players) => post(admin, `/api/tournaments/${t._id}/count`, { session_id: sess._id, players: [{ chip_id: chip._id, counted: players }] });
  return { admin, t, s, chip, inPlay2, count };
}

test('D: sem contagem, a fase seguinte herda a composição CALCULADA; com contagem, a CONTADA', async () => {
  const { s, inPlay2, count } = await scene();
  assert.equal(await inPlay2(), 50 * 1);
  const c = await count(s['Dia 1A'], 55);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(await inPlay2(), 55, 'herda o que foi contado nos sacos');
});

test('D: corrigir a contagem depois que a fase seguinte começou é bloqueado (409)', async () => {
  const { admin, t, s, count } = await scene();
  assert.equal((await count(s['Dia 1A'], 55)).status, 200);
  assert.equal((await put(admin, sp(t, s['Dia 2']), { status: 'running' })).status, 200);
  const again = await count(s['Dia 1A'], 54);
  assert.equal(again.status, 409);
  assert.match(again.body.error, /já começou/);
});

test('E: fechamento aguarda a contagem final; fecha quando contagem final = entregue + trocas − descartes ± ocorrências', async () => {
  const { admin, t, s, count } = await scene();
  assert.equal((await count(s['Dia 1A'], 55)).status, 200); // sobra de 5 → ocorrência
  let c = (await get(admin, `/api/tournaments/${t._id}/closing`)).body;
  assert.equal(c.status, 'awaiting_count');
  assert.equal(c.rows[0].delivered, 50);
  assert.equal(c.rows[0].occurrences, 5);

  const d2 = await count(s['Dia 2'], 55);
  assert.equal(d2.status, 200, JSON.stringify(d2.body));
  c = (await get(admin, `/api/tournaments/${t._id}/closing`)).body;
  assert.equal(c.status, 'closes', JSON.stringify(c.rows));
  assert.equal(c.totals.diff, 0);

  // uma falta real na contagem final vira ocorrência: a conta continua fechando, mas com a diferença explicada e ocorrência aberta
  assert.equal((await count(s['Dia 2'], 53)).status, 200);
  c = (await get(admin, `/api/tournaments/${t._id}/closing`)).body;
  assert.equal(c.rows[0].occurrences, 5 - 2);
  assert.ok(c.open_occurrences >= 1, 'a ocorrência sem justificativa aparece no fechamento');
  assert.ok(c.divergences.some((d) => d.session === 'Dia 2' && d.diff === -2), 'aponta a sessão e a denominação');
});
