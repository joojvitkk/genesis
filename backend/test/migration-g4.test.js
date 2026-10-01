// G4 — migração 20260926000000-events-sessions: torneios antigos → evento "Legado" + sessão "Dia Único".
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connect, clearDb, disconnect } = require('./helpers');
const migration = require('../migrations/20260926000000-events-sessions');

before(connect);
// os testes mexem nos índices de `seats`; restaura os atuais para não afetar outros arquivos
after(async () => { await require('../models').Seat.syncIndexes(); await disconnect(); });
beforeEach(clearDb);

const db = () => mongoose.connection.db;
const oid = () => new mongoose.Types.ObjectId();

async function seed() {
  const [tRun, tDone, tSched, tDel, tHas] = [oid(), oid(), oid(), oid(), oid()];
  const [p1, p2] = [oid(), oid()];
  const date = new Date('2026-10-01T12:00:00Z');
  await db().collection('tournaments').insertMany([
    { _id: tRun, name: 'Rodando', date, status: 'running', deleted_at: null, starts_at: date },
    { _id: tDone, name: 'Feito', date, status: 'finalized', finalized_at: new Date('2026-10-02'), deleted_at: null },
    { _id: tSched, name: 'Agendado', date, status: 'scheduled', deleted_at: null },
    { _id: tDel, name: 'Apagado', date, status: 'scheduled', deleted_at: new Date() },
    { _id: tHas, name: 'Já migrado', date, status: 'scheduled', deleted_at: null },
  ]);
  const existing = oid();
  await db().collection('tournamentsessions').insertOne({ _id: existing, tournament_id: tHas, name: 'Dia 1A', order: 1, status: 'scheduled', deleted_at: null });
  await db().collection('tournamententries').insertMany([
    { tournament_id: tRun, type: 'buy-in', player_id: p1 },
    { tournament_id: tRun, type: 're-entry', player_id: p1 },
    { tournament_id: tDone, type: 'buy-in', player_id: p2 },
    { tournament_id: tDel, type: 'buy-in', player_id: p1 },
    { tournament_id: tHas, type: 'buy-in', player_id: p1 },
  ]);
  await db().collection('seats').insertMany([
    { tournament_id: tRun, table_number: 1, seat_number: 1, player_id: p1 },
    { tournament_id: tDone, table_number: 1, seat_number: 1, player_id: p2 },
  ]);
  return { tRun, tDone, tSched, tDel, tHas, existing, p1, p2 };
}

const sessionsOf = (t) => db().collection('tournamentsessions').find({ tournament_id: t, deleted_at: null }).toArray();

test('cada torneio ativo sem sessão ganha "Dia Único" com o status do torneio', async () => {
  const { tRun, tDone, tSched, tDel } = await seed();
  await migration.up(db());

  const one = async (t) => { const s = await sessionsOf(t); assert.equal(s.length, 1); return s[0]; };
  const run = await one(tRun);
  assert.deepEqual([run.name, run.status, run.order], ['Dia Único', 'running', 1]);
  assert.ok(run.started_at);
  const done = await one(tDone);
  assert.equal(done.status, 'finished');
  assert.ok(done.finished_at);
  const sched = await one(tSched);
  assert.equal(sched.status, 'scheduled');
  assert.equal(sched.started_at, null);
  assert.equal((await sessionsOf(tDel)).length, 0, 'torneio excluído não ganha sessão');
});

test('entradas e lugares apontam para a sessão; torneio excluído fica como estava', async () => {
  const { tRun, tDone, tDel, p1 } = await seed();
  await migration.up(db());

  const sRun = (await sessionsOf(tRun))[0]._id;
  const entries = await db().collection('tournamententries').find({ tournament_id: tRun }).toArray();
  assert.ok(entries.length === 2 && entries.every((e) => String(e.session_id) === String(sRun)));
  const seat = await db().collection('seats').findOne({ tournament_id: tRun, player_id: p1 });
  assert.equal(String(seat.session_id), String(sRun));
  assert.equal(String((await db().collection('seats').findOne({ tournament_id: tDone })).session_id), String((await sessionsOf(tDone))[0]._id));
  assert.equal((await db().collection('tournamententries').findOne({ tournament_id: tDel })).session_id ?? null, null);
});

test('torneio que já tem UMA sessão: só as entradas sem sessão são vinculadas; nada é recriado', async () => {
  const { tHas, existing } = await seed();
  await migration.up(db());
  const sessions = await sessionsOf(tHas);
  assert.equal(sessions.length, 1);
  assert.equal(String(sessions[0]._id), String(existing));
  assert.equal(sessions[0].name, 'Dia 1A');
  assert.equal(String((await db().collection('tournamententries').findOne({ tournament_id: tHas })).session_id), String(existing));
});

test('torneios sem evento entram no evento "Legado" (criado uma vez)', async () => {
  const { tRun, tDel } = await seed();
  await migration.up(db());
  const events = await db().collection('events').find({}).toArray();
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'Legado');
  const t = await db().collection('tournaments').findOne({ _id: tRun });
  assert.equal(String(t.event_id), String(events[0]._id));
  assert.equal((await db().collection('tournaments').findOne({ _id: tDel })).event_id ?? null, null, 'excluído não entra');
});

test('sem torneios: não cria o evento Legado', async () => {
  await migration.up(db());
  assert.equal(await db().collection('events').countDocuments(), 0);
});

test('é idempotente', async () => {
  await seed();
  await migration.up(db());
  const snap = async () => JSON.stringify({
    s: (await db().collection('tournamentsessions').find({}).sort({ _id: 1 }).toArray()),
    e: (await db().collection('tournamententries').find({}).sort({ _id: 1 }).toArray()),
    ev: (await db().collection('events').find({}).toArray()),
    t: (await db().collection('tournaments').find({}).sort({ _id: 1 }).toArray()),
  });
  const first = await snap();
  await migration.up(db());
  assert.equal(await snap(), first);
});

test('índices do Seat: os antigos (por torneio) caem e os por sessão passam a valer', async () => {
  const seats = () => db().collection('seats');
  await seats().createIndex({ tournament_id: 1, player_id: 1 }, { unique: true }); // índice antigo
  await seats().createIndex({ tournament_id: 1, table_number: 1, seat_number: 1 }, { unique: true });
  await migration.up(db());

  const names = (await seats().indexes()).map((i) => i.name);
  assert.ok(!names.includes('tournament_id_1_player_id_1'));
  assert.ok(!names.includes('tournament_id_1_table_number_1_seat_number_1'));
  assert.ok(names.includes('tournament_id_1_session_id_1_player_id_1'));

  const [t, p, a, b] = [oid(), oid(), oid(), oid()];
  await seats().insertOne({ tournament_id: t, session_id: a, table_number: 1, seat_number: 1, player_id: p });
  await seats().insertOne({ tournament_id: t, session_id: b, table_number: 1, seat_number: 1, player_id: p }); // mesma vaga/jogador, outra sessão
  await assert.rejects(seats().insertOne({ tournament_id: t, session_id: a, table_number: 2, seat_number: 5, player_id: p }), (e) => e.code === 11000, 'mesmo jogador 2× na mesma sessão');
});

test('down: remove as sessões/evento migrados e desvincula entradas e lugares', async () => {
  const { tRun, tHas } = await seed();
  await migration.up(db());
  await migration.down(db());

  assert.equal(await db().collection('tournamentsessions').countDocuments({ tournament_id: tRun }), 0);
  assert.equal(await db().collection('tournamentsessions').countDocuments({ tournament_id: tHas }), 1, 'a sessão que já existia permanece');
  assert.equal((await db().collection('tournamententries').findOne({ tournament_id: tRun })).session_id, null);
  assert.equal(await db().collection('events').countDocuments(), 0);
  assert.equal((await db().collection('tournaments').findOne({ _id: tRun })).event_id, null);
});
