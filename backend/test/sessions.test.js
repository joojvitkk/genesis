// G4 — Evento → Torneio → Sessões/Fases (spec §3.5, §18.8).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect, makeUser, makeChip } = require('./helpers');

const request = require('supertest');
const app = require('../app');
const { Event, Tournament, TournamentSession, TournamentEntry, Seat } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

const as = async (role = 'admin') => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, url, body) => request(app).post(url).set(h).send(body);
const put = (h, url, body) => request(app).put(url).set(h).send(body);
const get = (h, url) => request(app).get(url).set(h);
const del = (h, url) => request(app).delete(url).set(h);

const newEvent = (h, extra = {}) => post(h, '/api/events', { name: 'KSOP Rio', ...extra });
// Warm Up com 4 sessões, como no exemplo da spec
async function warmUp(h, extra = {}) {
  const t = await post(h, '/api/tournaments', {
    name: 'Warm Up', date: '2026-10-01', sessions: ['Dia 1A', 'Dia 1B', 'Dia 1C Turbo', 'Dia Final'], ...extra,
  });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  return { t: t.body, s: Object.fromEntries(t.body.sessions.map((x) => [x.name, x])) };
}

// ─── eventos ─────────────────────────────────────────────────────────────────

test('evento: admin cria/edita; nome único; datas coerentes', async () => {
  const h = await as('admin');
  const ev = await newEvent(h, { start_date: '2026-10-01', end_date: '2026-10-10', location: 'Rio' });
  assert.equal(ev.status, 201, JSON.stringify(ev.body));
  assert.equal((await newEvent(h, { name: 'ksop rio' })).status, 409);
  assert.equal((await post(h, '/api/events', { name: '  ' })).status, 400);
  assert.equal((await post(h, '/api/events', {})).status, 400);
  assert.equal((await newEvent(h, { name: 'Outro', start_date: '2026-10-10', end_date: '2026-10-01' })).status, 400);

  const upd = await put(h, `/api/events/${ev.body._id}`, { location: 'Barra' });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.location, 'Barra');
  assert.equal((await put(h, `/api/events/${ev.body._id}`, { end_date: '2026-09-01' })).status, 400, 'fim antes do início');
});

test('evento: material e salão leem, mas não criam/editam/excluem', async () => {
  const admin = await as('admin');
  const ev = (await newEvent(admin)).body;
  for (const role of ['material', 'salao']) {
    const h = await as(role);
    assert.equal((await newEvent(h, { name: 'X' })).status, 403, `${role} POST`);
    assert.equal((await put(h, `/api/events/${ev._id}`, { name: 'Z' })).status, 403, `${role} PUT`);
    assert.equal((await del(h, `/api/events/${ev._id}`)).status, 403, `${role} DELETE`);
    assert.equal((await get(h, '/api/events')).status, 200, `${role} GET`);
  }
  assert.equal(await Event.countDocuments(), 1);
});

test('evento: lista com nº de torneios; detalhe traz torneios e sessões; excluir só sem torneios', async () => {
  const h = await as('admin');
  const ev = (await newEvent(h)).body;
  const { t } = await warmUp(h, { event_id: ev._id, number: 2 });

  const list = (await get(h, '/api/events')).body;
  assert.equal(list[0].tournaments_count, 1);
  const detail = (await get(h, `/api/events/${ev._id}`)).body;
  assert.equal(detail.tournaments[0]._id, t._id);
  assert.deepEqual(detail.tournaments[0].sessions.map((s) => s.name), ['Dia 1A', 'Dia 1B', 'Dia 1C Turbo', 'Dia Final']);

  const blocked = await del(h, `/api/events/${ev._id}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /1 torneio/);
  await del(h, `/api/tournaments/${t._id}`);
  await Tournament.updateOne({ _id: t._id }, { $set: { event_id: null } }).setOptions({ withDeleted: true });
  assert.equal((await del(h, `/api/events/${ev._id}`)).status, 200);
  assert.equal((await get(h, '/api/events')).body.length, 0);
});

// ─── torneio ↔ evento ↔ sessões ──────────────────────────────────────────────

test('torneio criado sem sessões nasce com "Dia Único"', async () => {
  const h = await as('admin');
  const t = await post(h, '/api/tournaments', { name: 'Diário', date: '2026-10-01' });
  assert.equal(t.status, 201);
  assert.deepEqual(t.body.sessions.map((s) => [s.name, s.status, s.order]), [['Dia Único', 'scheduled', 1]]);
});

test('torneio: evento e número validados; número único dentro do evento', async () => {
  const h = await as('admin');
  const ev = (await newEvent(h)).body;
  const ev2 = (await newEvent(h, { name: 'Outro festival' })).body;
  const mk = (extra) => post(h, '/api/tournaments', { name: 'T', date: '2026-10-01', ...extra });

  assert.equal((await mk({ event_id: '64b000000000000000000000' })).status, 400, 'evento inexistente');
  for (const number of [0, -1, 1.5, 'x']) assert.equal((await mk({ event_id: ev._id, number })).status, 400, `número ${number}`);

  const first = await mk({ event_id: ev._id, number: 2 });
  assert.equal(first.status, 201);
  assert.equal(first.body.number, 2);
  assert.equal((await mk({ event_id: ev._id, number: 2 })).status, 409, 'mesmo número no mesmo evento');
  assert.equal((await mk({ event_id: ev2._id, number: 2 })).status, 201, 'em outro evento pode');
  assert.equal((await mk({ event_id: ev._id })).status, 201, 'sem número pode repetir');

  const moved = await put(h, `/api/tournaments/${first.body._id}`, { event_id: ev2._id });
  assert.equal(moved.status, 409, 'mover para evento onde o nº já existe');
  assert.equal((await put(h, `/api/tournaments/${first.body._id}`, { number: 3 })).status, 200);
});

test('só o admin cria torneios (e define as sessões); sem sessões nasce "Dia Único"', async () => {
  const mat = await as('material');
  assert.equal((await post(mat, '/api/tournaments', { name: 'T', date: '2026-10-01', sessions: ['A', 'B'] })).status, 403);
  assert.equal((await post(mat, '/api/tournaments', { name: 'T', date: '2026-10-01' })).status, 403, 'operador não cria torneio (G11)');
  const ok = await post(await as('admin'), '/api/tournaments', { name: 'T', date: '2026-10-01' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.sessions.length, 1);
  assert.equal((await post(await as('admin'), '/api/tournaments', { name: 'T', date: '2026-10-01', sessions: 'Dia 1' })).status, 400);
  assert.equal((await post(await as('admin'), '/api/tournaments', { name: 'T', date: '2026-10-01', sessions: ['A', 'a'] })).status, 409, 'nomes repetidos');
});

// ─── ACEITE: Warm Up com Dia 1A / 1B / 1C / Final ────────────────────────────

test('ACEITE: Warm Up com 4 sessões continua sendo o MESMO torneio; entradas da 1A não aparecem na 1B', async () => {
  const h = await as('admin');
  const { t, s } = await warmUp(h);
  assert.equal(await Tournament.countDocuments(), 1, 'um torneio só');
  assert.equal(await TournamentSession.countDocuments({ tournament_id: t._id }), 4);
  assert.ok(Object.values(s).every((x) => String(x.tournament_id) === String(t._id)));

  const url = `/api/tournaments/${t._id}/entries`;
  assert.equal((await post(h, url, { type: 'buy-in', quantity: 3, session_id: s['Dia 1A']._id })).status, 201);
  assert.equal((await post(h, url, { type: 'buy-in', quantity: 2, session_id: s['Dia 1B']._id })).status, 201);
  assert.equal((await post(h, url, { type: 're-entry', quantity: 1, session_id: s['Dia 1B']._id })).status, 201);

  const in1A = (await get(h, `${url}?session_id=${s['Dia 1A']._id}`)).body;
  const in1B = (await get(h, `${url}?session_id=${s['Dia 1B']._id}`)).body;
  assert.equal(in1A.length, 3);
  assert.equal(in1B.length, 3);
  assert.ok(in1A.every((e) => e.session_id === s['Dia 1A']._id));
  assert.ok(!in1A.some((e) => in1B.some((x) => x._id === e._id)), 'nenhuma entrada da 1A aparece na 1B');
  assert.equal((await get(h, `${url}?session_id=${s['Dia 1C Turbo']._id}`)).body.length, 0);
  assert.equal((await get(h, url)).body.length, 6, 'sem filtro: o torneio inteiro');

  // contadores de ações por sessão
  const sessions = (await get(h, `/api/tournaments/${t._id}/sessions`)).body;
  const c = (name) => sessions.find((x) => x.name === name).counts;
  assert.equal(c('Dia 1A').total, 3);
  assert.deepEqual(c('Dia 1B').by_type, { 'buy-in': 2, 're-entry': 1 });
  assert.deepEqual(c('Dia 1B').by_action, { buy_in: 2, re_entry: 1 });
  assert.equal(c('Dia Final').total, 0);
  assert.equal((await Tournament.findById(t._id)).actual_players, 6, 'ativos = inscrições (buy-ins + reentradas) de todas as sessões, sem eliminações');
});

test('fichas em jogo por sessão e do torneio (soma das sessões), com o stack no nível do torneio', async () => {
  const h = await as('admin');
  const chip = await makeChip({ value: 100 });
  const stack = (await post(h, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 10, re_entry: 5 } }] })).body;
  const { t, s } = await warmUp(h, { stack_model_id: stack._id });
  const url = `/api/tournaments/${t._id}/entries`;
  await post(h, url, { type: 'buy-in', quantity: 4, session_id: s['Dia 1A']._id });
  await post(h, url, { type: 'buy-in', quantity: 2, session_id: s['Dia 1B']._id });
  await post(h, url, { type: 're-entry', quantity: 3, session_id: s['Dia 1B']._id });

  const inPlay = async (sid) => (await get(h, `/api/tournaments/${t._id}/${sid ? `sessions/${sid}/` : ''}chips-in-play`)).body;
  const a = await inPlay(s['Dia 1A']._id);
  const b = await inPlay(s['Dia 1B']._id);
  const all = await inPlay();
  assert.equal(a.rows[0].quantity, 40);
  assert.equal(a.session_id, s['Dia 1A']._id);
  assert.equal(b.rows[0].quantity, 20 + 15);
  assert.equal(all.rows[0].quantity, a.rows[0].quantity + b.rows[0].quantity, 'torneio = soma das sessões');
  assert.equal(all.totals.value, a.totals.value + b.totals.value);
  assert.equal((await Tournament.findById(t._id)).chips_value_in_play, all.totals.value, 'cache do torneio inclui todas as sessões');
  assert.equal((await inPlay(s['Dia Final']._id)).rows.length, 0);

  const list = (await get(h, `/api/tournaments/${t._id}/sessions`)).body;
  assert.equal(list.find((x) => x.name === 'Dia 1A').chips_value, 4000);
  assert.equal((await get(h, `/api/tournaments/${t._id}/sessions/64b000000000000000000000/chips-in-play`)).status, 404);
});

// ─── qual sessão recebe a ação ───────────────────────────────────────────────

test('sessão da entrada: única → padrão; várias → a em andamento; ambíguo → 400; inválida → 404', async () => {
  const h = await as('admin');
  const single = (await post(h, '/api/tournaments', { name: 'Um dia', date: '2026-10-01' })).body;
  const e1 = await post(h, `/api/tournaments/${single._id}/entries`, { type: 'buy-in' });
  assert.equal(e1.body.session_id, single.sessions[0]._id, 'única sessão é o padrão');

  const { t, s } = await warmUp(h);
  const url = `/api/tournaments/${t._id}/entries`;
  const ambiguous = await post(h, url, { type: 'buy-in' });
  assert.equal(ambiguous.status, 400);
  assert.match(ambiguous.body.error, /session_id/);
  assert.equal(await TournamentEntry.countDocuments({ tournament_id: t._id }), 0);

  await put(h, `/api/tournaments/${t._id}/sessions/${s['Dia 1B']._id}`, { status: 'running' });
  const auto = await post(h, url, { type: 'buy-in' });
  assert.equal(auto.status, 201);
  assert.equal(auto.body.session_id, s['Dia 1B']._id, 'a única sessão em andamento');

  await put(h, `/api/tournaments/${t._id}/sessions/${s['Dia 1C Turbo']._id}`, { status: 'running' });
  assert.equal((await post(h, url, { type: 'buy-in' })).status, 400, 'duas em andamento → ambíguo');

  assert.equal((await post(h, url, { type: 'buy-in', session_id: single.sessions[0]._id })).status, 404, 'sessão de outro torneio');
  assert.equal((await post(h, url, { type: 'buy-in', session_id: '64b000000000000000000000' })).status, 404);
});

test('sessão encerrada não recebe entradas; cancelar entrada dela é só do admin', async () => {
  const admin = await as('admin');
  const { t, s } = await warmUp(admin);
  const url = `/api/tournaments/${t._id}/entries`;
  const id = s['Dia 1A']._id;
  const e = (await post(admin, url, { type: 'buy-in', session_id: id })).body;
  await put(admin, `/api/tournaments/${t._id}/sessions/${id}`, { status: 'running' });
  await put(admin, `/api/tournaments/${t._id}/sessions/${id}`, { status: 'finished' });

  const late = await post(admin, url, { type: 'buy-in', session_id: id });
  assert.equal(late.status, 409);
  assert.match(late.body.error, /encerrada/);

  const mat = await as('salao');
  assert.equal((await post(mat, `${url}/${e._id}/cancel`, { reason: 'x' })).status, 409);
  assert.equal(await TournamentEntry.countDocuments({ _id: e._id }), 1);
  assert.equal((await post(admin, `${url}/${e._id}/cancel`, { reason: 'correção' })).status, 200, 'admin corrige');
});

// ─── status e permissões da sessão ───────────────────────────────────────────

test('status da sessão: scheduled → running → finished; transições inválidas → 409; reabrir só admin', async () => {
  const admin = await as('admin');
  const { t, s } = await warmUp(admin);
  const url = `/api/tournaments/${t._id}/sessions/${s['Dia 1A']._id}`;
  const mat = await as('salao'); // o SALÃO opera a sessão; o material só consulta (MEL-03)
  assert.equal((await put(await as('material'), url, { status: 'running' })).status, 403, 'material não inicia/pausa/encerra sessão');

  assert.equal((await put(mat, url, { status: 'finished' })).status, 409, 'não pula o "em andamento"');
  const run = await put(mat, url, { status: 'running' });
  assert.equal(run.status, 200, 'operador muda o status');
  assert.ok(run.body.started_at);
  assert.equal((await put(mat, url, { status: 'scheduled' })).status, 409);
  const fin = await put(mat, url, { status: 'finished' });
  assert.equal(fin.body.status, 'finished');
  assert.ok(fin.body.finished_at);

  assert.equal((await put(mat, url, { status: 'running' })).status, 403, 'operador não reabre');
  const reopened = await put(admin, url, { status: 'running' });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.finished_at, null);
  assert.equal((await put(admin, url, { status: 'inexistente' })).status, 409);
});

test('sessão: só o admin cria, renomeia e exclui; nomes únicos por torneio', async () => {
  const admin = await as('admin');
  const { t, s } = await warmUp(admin);
  const base = `/api/tournaments/${t._id}/sessions`;

  for (const role of ['material', 'salao']) {
    const h = await as(role);
    assert.equal((await post(h, base, { name: 'Extra' })).status, 403, `${role} POST`);
    assert.equal((await put(h, `${base}/${s['Dia 1A']._id}`, { name: 'X' })).status, 403, `${role} rename`);
    assert.equal((await del(h, `${base}/${s['Dia 1A']._id}`)).status, 403, `${role} DELETE`);
    assert.equal((await get(h, base)).status, 200, `${role} GET`);
  }
  const extra = await post(admin, base, { name: 'Dia 2', starts_at: '2026-10-02T18:00:00Z' });
  assert.equal(extra.status, 201);
  assert.equal(extra.body.order, 5, 'entra no fim da sequência');
  assert.equal((await post(admin, base, { name: 'dia 2' })).status, 409);
  assert.equal((await post(admin, base, { name: '  ' })).status, 400);
  assert.equal((await put(admin, `${base}/${extra.body._id}`, { name: 'Dia 1a' })).status, 409);
  assert.equal((await put(admin, `${base}/${extra.body._id}`, { name: 'Dia 2 - Final' })).body.name, 'Dia 2 - Final');
  assert.equal((await put(admin, `${base}/${s['Dia 1A']._id}`, { name: 'Dia 1A' })).status, 200, 'manter o próprio nome é ok');
});

test('excluir sessão: não com entradas, não a última; leva as mesas junto', async () => {
  const admin = await as('admin');
  const { t, s } = await warmUp(admin);
  const base = `/api/tournaments/${t._id}/sessions`;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', session_id: s['Dia 1A']._id });

  const blocked = await del(admin, `${base}/${s['Dia 1A']._id}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /1 entrada/);

  assert.equal((await del(admin, `${base}/${s['Dia 1B']._id}`)).status, 200);
  assert.equal((await get(admin, base)).body.length, 3);
  for (const name of ['Dia 1C Turbo', 'Dia Final']) await del(admin, `${base}/${s[name]._id}`);
  const last = await del(admin, `${base}/${s['Dia 1A']._id}`);
  assert.equal(last.status, 409, 'com entrada e é a última');

  const solo = (await post(admin, '/api/tournaments', { name: 'Solo', date: '2026-10-01' })).body;
  const onlyOne = await del(admin, `/api/tournaments/${solo._id}/sessions/${solo.sessions[0]._id}`);
  assert.equal(onlyOne.status, 409);
  assert.match(onlyOne.body.error, /ao menos uma sessão/);
});

// ─── fechamento do torneio ───────────────────────────────────────────────────

test('o torneio só fecha com todas as sessões encerradas (ou finish_sessions: true)', async () => {
  const admin = await as('admin');
  const { t, s } = await warmUp(admin);
  const base = `/api/tournaments/${t._id}`;

  const blocked = await put(admin, base, { status: 'finished' });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Dia 1A.*Dia 1B.*Dia 1C Turbo.*Dia Final/);
  assert.equal(blocked.body.details.length, 4);
  assert.notEqual((await Tournament.findById(t._id)).status, 'finished');

  // encerra uma a uma
  for (const name of Object.keys(s)) {
    await put(admin, `${base}/sessions/${s[name]._id}`, { status: 'running' });
    await put(admin, `${base}/sessions/${s[name]._id}`, { status: 'finished' });
  }
  assert.equal((await put(admin, base, { status: 'finished' })).status, 200);
  assert.equal((await Tournament.findById(t._id)).status, 'finished');

  // atalho: encerra as pendentes junto
  const other = await warmUp(admin, { name: 'Outro' });
  const forced = await put(admin, `/api/tournaments/${other.t._id}`, { status: 'finished', finish_sessions: true });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  const sessions = await TournamentSession.find({ tournament_id: other.t._id });
  assert.ok(sessions.every((x) => x.status === 'finished' && x.finished_at));
});

test('torneio antigo sem sessões (dados pré-G4) continua fechando normalmente', async () => {
  const admin = await as('admin');
  const old = await Tournament.create({ name: 'Antigo', date: new Date(), status: 'running' });
  assert.equal((await put(admin, `/api/tournaments/${old._id}`, { status: 'finished' })).status, 200);
  const e = await post(admin, `/api/tournaments/${old._id}/entries`, { type: 'buy-in' });
  assert.equal(e.status, 201);
  assert.equal(e.body.session_id, null, 'sem sessões: compatível');
});

test('excluir o torneio leva as sessões junto', async () => {
  const admin = await as('admin');
  const { t } = await warmUp(admin);
  assert.equal((await del(admin, `/api/tournaments/${t._id}`)).status, 200);
  assert.equal(await TournamentSession.countDocuments({ tournament_id: t._id }), 0);
  assert.equal(await TournamentSession.countDocuments({ tournament_id: t._id }).setOptions({ withDeleted: true }), 4, 'soft-delete: fica no banco');
});

test('a eliminação que deixa uma só entrada finaliza o torneio e encerra as sessões', async () => {
  const admin = await as('admin');
  const { t, s } = await warmUp(admin);
  const sid = s['Dia 1A']._id;
  const e1 = (await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', session_id: sid })).body;
  await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', session_id: sid });

  const res = await post(admin, `/api/tournaments/${t._id}/eliminations`, { entry_id: e1._id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await Tournament.findById(t._id)).status, 'finalized');
  const sessions = await TournamentSession.find({ tournament_id: t._id });
  assert.ok(sessions.every((x) => x.status === 'finished'), 'todas encerradas');
});

// ─── financeiro segue no nível do torneio ────────────────────────────────────

test('o financeiro agrega as entradas de TODAS as sessões (um único prize pool)', async () => {
  const admin = await as('admin');
  const { t, s } = await warmUp(admin, { buy_in: 1000, rake: 100 });
  const url = `/api/tournaments/${t._id}/entries`;
  await post(admin, url, { type: 'buy-in', quantity: 3, session_id: s['Dia 1A']._id });
  await post(admin, url, { type: 'buy-in', quantity: 2, session_id: s['Dia 1B']._id });

  const fin = (await get(admin, `/api/tournaments/${t._id}/finance`)).body;
  assert.equal(fin.summary.gross, 5000);
  assert.equal(fin.summary.prize_pool, 4500);
  assert.equal(fin.summary.total_entries, 5);
});

// ─── mesas por sessão ────────────────────────────────────────────────────────

test('mesas por sessão: cada sessão tem as suas mesas e as suas entradas', async () => {
  const admin = await as('admin');
  const { t, s } = await warmUp(admin);
  const url = `/api/tournaments/${t._id}/entries`;
  const a = s['Dia 1A']._id; const b = s['Dia 1B']._id;
  await post(admin, url, { type: 'buy-in', quantity: 10, session_id: a });
  await post(admin, url, { type: 'buy-in', quantity: 4, session_id: b });

  const seating = async (sid) => (await get(admin, `/api/tournaments/${t._id}/seating?session_id=${sid}`)).body;
  const v1A = await seating(a); const v1B = await seating(b);
  assert.equal(v1A.total_seated, 10);
  assert.equal(v1B.total_seated, 4);
  assert.equal(v1A.session_id, a);
  const labels = (v) => v.tables.flatMap((tb) => tb.seats.filter((x) => x.entry_id).map((x) => x.label));
  assert.ok(labels(v1A).includes('Entrada #1') && labels(v1B).includes('Entrada #11'), 'a numeração é do TORNEIO (segue entre as sessões)');
  assert.ok(!labels(v1B).includes('Entrada #1'), 'a entrada da 1A não aparece na 1B');
  assert.equal(await Seat.countDocuments({ tournament_id: t._id }), 14);
  assert.equal((await seating(s['Dia Final']._id)).total_seated, 0);

  assert.equal((await get(admin, `/api/tournaments/${t._id}/seating`)).status, 400, 'várias sessões: exige session_id');
  await put(admin, `/api/tournaments/${t._id}/sessions/${b}`, { status: 'running' });
  assert.equal((await get(admin, `/api/tournaments/${t._id}/seating`)).body.session_id, b, 'a em andamento é o padrão');
});

test('a visão de mesas devolve o id da entrada e o rótulo "Entrada #n" (sem nomes de jogadores)', async () => {
  const admin = await as('admin');
  const t = (await post(admin, '/api/tournaments', { name: 'T', date: '2026-10-01' })).body;
  const e = (await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in' })).body;
  const view = (await get(admin, `/api/tournaments/${t._id}/seating`)).body;
  const seat = view.tables[0].seats.find((x) => x.entry_id);
  assert.deepEqual([seat.entry_id, seat.entry_number, seat.label], [String(e._id), 1, 'Entrada #1']);
  assert.equal(seat.player_id, undefined);
  assert.equal(seat.player_name, undefined);
});

test('mesas: sortear, redistribuir e mover atuam só na sessão informada', async () => {
  const admin = await as('admin');
  const { t, s } = await warmUp(admin);
  const a = s['Dia 1A']._id; const b = s['Dia 1B']._id;
  const inA = [];
  for (let i = 0; i < 8; i++) inA.push(await TournamentEntry.create({ tournament_id: t._id, session_id: a, type: 'buy-in', number: i + 1 }));
  const inB = await TournamentEntry.create({ tournament_id: t._id, session_id: b, type: 'buy-in', number: 9 });

  const draw = await post(admin, `/api/tournaments/${t._id}/seating/draw`, { session_id: a });
  assert.equal(draw.body.total_seated, 8);
  assert.equal((await Seat.countDocuments({ tournament_id: t._id, session_id: b })), 0, 'a 1B não foi sorteada');

  await post(admin, `/api/tournaments/${t._id}/seating/draw`, { session_id: b });
  assert.equal(await Seat.countDocuments({ tournament_id: t._id, session_id: b }), 1);

  const re = await post(admin, `/api/tournaments/${t._id}/seating/redraw`, { session_id: a, tables: 2 });
  assert.equal(re.body.tables.length, 2);
  assert.equal(await Seat.countDocuments({ tournament_id: t._id, session_id: b }), 1, 'redistribuir a 1A não toca a 1B');

  const moved = await post(admin, `/api/tournaments/${t._id}/seating/move`, { session_id: b, entry_id: inB._id, to_table: 3, to_seat: 4 });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const seat = await Seat.findOne({ tournament_id: t._id, session_id: b, entry_id: inB._id });
  assert.deepEqual([seat.table_number, seat.seat_number], [3, 4]);
  assert.notEqual((await Seat.findOne({ tournament_id: t._id, session_id: a, entry_id: inA[0]._id })).table_number, 3, 'na 1A continua onde estava');
});

test('cancelar a entrada libera o lugar SÓ naquela sessão', async () => {
  const admin = await as('admin');
  const { t, s } = await warmUp(admin);
  const url = `/api/tournaments/${t._id}/entries`;
  const inA = (await post(admin, url, { type: 'buy-in', session_id: s['Dia 1A']._id })).body;
  await post(admin, url, { type: 'buy-in', session_id: s['Dia 1B']._id });
  assert.equal(await Seat.countDocuments({ tournament_id: t._id }), 2);

  await post(admin, `${url}/${inA._id}/cancel`, { reason: 'engano' });
  assert.equal(await Seat.countDocuments({ tournament_id: t._id, session_id: s['Dia 1A']._id }), 0);
  assert.equal(await Seat.countDocuments({ tournament_id: t._id, session_id: s['Dia 1B']._id }), 1);
});

// ─── vínculo operacional é do torneio (§18.8) ────────────────────────────────

test('§18.8: stack e fichários são do TORNEIO e valem para todas as sessões', async () => {
  const admin = await as('admin');
  const chip = await makeChip({ value: 100 });
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 5 } }] })).body;
  const { t, s } = await warmUp(admin, { stack_model_id: stack._id });

  assert.equal(t.stack_model_id, stack._id);
  assert.equal(await TournamentSession.countDocuments({ tournament_id: t._id, stack_model_id: { $exists: true } }), 0, 'a sessão não guarda vínculo próprio');
  for (const name of ['Dia 1A', 'Dia Final']) {
    await post(admin, `/api/tournaments/${t._id}/entries`, { type: 'buy-in', session_id: s[name]._id });
  }
  const r = (await get(admin, `/api/tournaments/${t._id}/chips-in-play`)).body;
  assert.equal(r.rows[0].quantity, 10, 'as duas sessões usam o mesmo modelo do torneio');
});

test('sessão aceita horário de início (date + start_time no fuso do torneio) e permite limpar', async () => {
  const H = await as('admin');
  const t = await Tournament.create({ name: 'Horário', date: new Date('2026-10-01T00:00:00Z'), timezone: 'America/Sao_Paulo' });
  let r = await request(app).post(`/api/tournaments/${t._id}/sessions`).set(H).send({ name: 'Dia 1A', date: '2026-10-01', start_time: '20:00' });
  assert.equal(r.status, 201);
  assert.equal(new Date(r.body.starts_at).toISOString(), '2026-10-01T23:00:00.000Z');
  r = await request(app).put(`/api/tournaments/${t._id}/sessions/${r.body._id}`).set(H).send({ starts_at: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.starts_at, null);
  r = await request(app).put(`/api/tournaments/${t._id}/sessions/${r.body._id}`).set(H).send({ starts_at: 'lixo' });
  assert.equal(r.status, 400);
});
