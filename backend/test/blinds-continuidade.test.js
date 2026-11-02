// Continuidade de blinds entre fases + Tracking Sheet (templates) — Fase B.2–B.4 do PLANO_MENU_TRACKING_SHEET.md.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { connect, clearDb, disconnect, makeUser, makeChip } = require('./helpers');
const app = require('../app');

before(connect);
after(disconnect);
beforeEach(clearDb);

const hdr = async (role) => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
const post = (h, u, b) => request(app).post(u).set(h).send(b);
const put = (h, u, b) => request(app).put(u).set(h).send(b);
const get = (h, u) => request(app).get(u).set(h);
const del = (h, u) => request(app).delete(u).set(h);

// Níveis 1–16 + Break + Níveis 17–18 com valores PRÓPRIOS (a direção pode repetir ou editar; aqui o 17 repete o 16).
const rows = () => [
  ...Array.from({ length: 16 }, (_, i) => ({ row_type: 'level', small_blind: 100 * (i + 1), big_blind: 200 * (i + 1), ante: 0, duration: 20 })),
  { row_type: 'end_day', label: 'Fim do dia' },
  { row_type: 'break', duration: 15, label: 'Break' },
  { row_type: 'level', small_blind: 1600, big_blind: 3200, ante: 3200, duration: 30 },
  { row_type: 'level', small_blind: 2000, big_blind: 4000, ante: 4000, duration: 30 },
];

async function scene() {
  const admin = await hdr('admin');
  const chip = await makeChip({ value: 1000, color: '#0000ff' });
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 10, re_entry: 10 } }] })).body;
  const t = (await post(admin, '/api/tournaments', {
    name: 'Warm Up', date: '2026-10-01', stack_model_id: stack._id,
    sessions: ['Dia 1A', 'Dia 1B', 'Dia 1C', 'Dia 1D', 'Dia Final'], blind_structure: rows(),
  })).body;
  const s = Object.fromEntries(t.sessions.map((x) => [x.name, x]));
  return { admin, t, s };
}
const clockOf = async (h, t, sess) => (await get(h, `/api/tournaments/${t._id}/clock?session_id=${sess._id}`)).body;
const finish = async (h, t, sess, q) => {
  await put(h, `/api/tournaments/${t._id}/sessions/${sess._id}`, { status: 'running' });
  return put(h, `/api/tournaments/${t._id}/sessions/${sess._id}`, { status: 'finished', qualified_count: q });
};

test('classificatórios 1A–1D rodam níveis 1–16 independentes; Dia Final abre direto no Nível 17 com os valores configurados', async () => {
  const { admin, t, s } = await scene();
  for (const n of ['Dia 1A', 'Dia 1B', 'Dia 1C', 'Dia 1D']) {
    await put(admin, `/api/tournaments/${t._id}/sessions/${s[n]._id}`, { status: 'running' });
    await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'start', session_id: s[n]._id });
    await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'goto', seconds: 15, session_id: s[n]._id }); // Nível 16
  }
  assert.equal((await clockOf(admin, t, s['Dia 1A'])).level_number, 16);
  for (const n of ['Dia 1A', 'Dia 1B', 'Dia 1C', 'Dia 1D']) await finish(admin, t, s[n], 1);
  const c = await clockOf(admin, t, s['Dia Final']);
  assert.equal(c.level_number, 17, 'níveis não são somados entre classificatórios');
  assert.equal(c.level.small_blind, 1600);
  assert.equal(c.level.big_blind, 3200);
  assert.equal(c.level.ante, 3200);
  assert.equal(c.level.duration, 30);
});

test('Dia Final: iniciar o relógio mantém o Nível 17 (sem voltar ao 1 nem exigir avanço)', async () => {
  const { admin, t, s } = await scene();
  await put(admin, `/api/tournaments/${t._id}/sessions/${s['Dia 1A']._id}`, { status: 'running' });
  await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'start', session_id: s['Dia 1A']._id });
  await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'goto', seconds: 15, session_id: s['Dia 1A']._id });
  await finish(admin, t, s['Dia 1A'], 5);
  await put(admin, `/api/tournaments/${t._id}/sessions/${s['Dia Final']._id}`, { status: 'running' });
  await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'start', session_id: s['Dia Final']._id });
  const c = await clockOf(admin, t, s['Dia Final']);
  assert.equal(c.level_number, 17);
  assert.equal(c.level.small_blind, 1600);
});

test('Adicionar Nível na fase copia o último nível (sem dobrar, sem voltar ao Nível 1), numera +1 e preserva edições', async () => {
  const { admin, t, s } = await scene();
  await put(admin, `/api/tournaments/${t._id}/sessions/${s['Dia 1A']._id}`, { status: 'running' });
  await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'start', session_id: s['Dia 1A']._id });
  await post(admin, `/api/tournaments/${t._id}/clock`, { action: 'goto', seconds: 15, session_id: s['Dia 1A']._id });
  await finish(admin, t, s['Dia 1A'], 5);
  const F = s['Dia Final'];
  await put(admin, `/api/tournaments/${t._id}/sessions/${F._id}/level`, { small_blind: 1700, big_blind: 3400, ante: 3400 });
  const ap = await put(admin, `/api/tournaments/${t._id}/sessions/${F._id}/level`, { append: true });
  assert.equal(ap.status, 200);
  const sess = (await get(admin, `/api/tournaments/${t._id}/sessions`)).body.find((x) => x._id === F._id);
  const lv = sess.blind_structure.filter((r) => r.row_type === 'level');
  const last = lv[lv.length - 1];
  assert.equal(last.small_blind, 2000, 'copia o último nível configurado (18), não o 1');
  // mudanças de status posteriores não descartam a edição manual
  await put(admin, `/api/tournaments/${t._id}/sessions/${s['Dia 1B']._id}`, { status: 'running' });
  const again = await clockOf(admin, t, F);
  assert.equal(again.level_number, 17);
  assert.equal(again.level.small_blind, 1700);
});

test('Tracking Sheet: template salvo e copiado para o torneio; editar a cópia não altera o template nem outro torneio', async () => {
  const admin = await hdr('admin');
  const tpl = await post(admin, '/api/blind-templates', { name: 'Warm Up 2026', rows: rows() });
  assert.equal(tpl.status, 201, JSON.stringify(tpl.body));
  const chip = await makeChip({ value: 1000, color: '#0000ff' });
  const stack = (await post(admin, '/api/stacks', { name: 'S', composition: [{ chip_id: chip._id, quantities: { buy_in: 1, re_entry: 1 } }] })).body;
  const list = (await get(admin, '/api/blind-templates')).body;
  const saved = list.find((x) => x.name === 'Warm Up 2026');
  const mk = async (name) => (await post(admin, '/api/tournaments', { name, date: '2026-10-01', stack_model_id: stack._id, blind_structure: saved.rows.map(({ _id, ...r }) => r) })).body;
  const a = await mk('A'); const b = await mk('B');
  const edit = a.blind_structure.map((r, i) => (i === 0 ? { ...r, small_blind: 999 } : r));
  assert.equal((await put(admin, `/api/tournaments/${a._id}`, { blind_structure: edit })).status, 200);
  const after = (await get(admin, '/api/blind-templates')).body.find((x) => x.name === 'Warm Up 2026');
  assert.equal(after.rows[0].small_blind, 100, 'template intacto');
  assert.equal((await get(admin, `/api/tournaments/${b._id}`)).body.blind_structure[0].small_blind, 100, 'outro torneio intacto');
});

test('Tracking Sheet: Material e Salão só leem; escrita é do admin (backend)', async () => {
  const admin = await hdr('admin');
  const tpl = (await post(admin, '/api/blind-templates', { name: 'T', rows: rows() })).body;
  for (const role of ['material', 'salao']) {
    const h = await hdr(role);
    assert.equal((await get(h, '/api/blind-templates')).status, 200, `${role} consulta`);
    assert.equal((await post(h, '/api/blind-templates', { name: 'X', rows: rows() })).status, 403, `${role} não cria`);
    assert.equal((await put(h, `/api/blind-templates/${tpl._id}`, { name: 'Y' })).status, 403, `${role} não edita`);
    assert.equal((await del(h, `/api/blind-templates/${tpl._id}`)).status, 403, `${role} não exclui`);
  }
});
