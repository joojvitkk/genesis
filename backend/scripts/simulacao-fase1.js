// Simulação 1.0 (Relatório da fase 1) repetida contra uma CÓPIA do banco da simulação (genesis_sim).
// Uso (dentro do container do backend):
//   MONGO_URI_TEST=mongodb://genesis-db:27017/genesis_sim?replicaSet=rs0 node scripts/simulacao-fase1.js
// Nunca toca o banco `genesis`. Cada verificação imprime esperado × obtido; sai com código 1 se algo falhar.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
const request = require('supertest');
const { connect, disconnect, makeUser } = require('../test/helpers');
const mongoose = require('mongoose');

let falhas = 0;
const check = (ok, id, desc, esperado, obtido) => {
  if (!ok) falhas += 1;
  console.log(`${ok ? '  ✔' : '  ✘'} [${id}] ${desc}${ok ? '' : `  → esperado ${JSON.stringify(esperado)} | obtido ${JSON.stringify(obtido)}`}`);
};
const eq = (id, desc, obtido, esperado) => check(JSON.stringify(obtido) === JSON.stringify(esperado), id, desc, esperado, obtido);

(async () => {
  await connect();
  const app = require('../app');
  const { Tournament, TournamentSession, Chip, Binder, Allocation, Conversion } = require('../models');
  const { autoAdvance, clockPayload, applyAction } = require('../lib/tournamentClock');
  const mv = require('../lib/movements');
  const as = async (role) => ({ Authorization: `Bearer ${(await makeUser(role)).token}` });
  const [adm, sal, mat] = [await as('admin'), await as('salao'), await as('material')];
  const call = (m, h, url, body) => request(app)[m](url).set(h).send(body);
  const get = (h, url) => request(app).get(url).set(h);

  console.log('\n1) Base conhecida — fichários e saldos');
  const binders = (await get(adm, '/api/binders')).body;
  const rows = binders.map((b) => `${b.name}: ${b.chips.reduce((s, c) => s + c.quantity, 0)} fichas`);
  console.log('   ', rows.join(' | '));
  check(binders.length >= 2 && binders.every((b) => !b.model_id?.name), 'MEL-01', 'fichários são unidades únicas (sem modelo de fichário na tela/API)', true, false);

  console.log('\n2) Relógio × Tracking Sheet (BUG-02/03) — percorre a estrutura inteira com o tempo avançando sozinho');
  for (const name of ['Warm Up', 'High Roller Light', 'Satélite de Créditos']) {
    const t = await Tournament.findOne({ name });
    const rowsT = t.blind_structure;
    let cur = { ...t.toObject(), current_level: 0, clock_status: 'running', level_started_at: new Date(0), paused_at: null, clock_adjust_seconds: 0 };
    let now = 0; const seen = []; let stoppedAt = null;
    for (let guard = 0; guard < 200; guard += 1) {
      const p = clockPayload(cur, now);
      seen.push({ nivel: p.level_number, tipo: p.level?.row_type, bb: p.level?.big_blind, break: p.is_break, prox: p.next_play_level?.level_number });
      now += p.remaining_ms + 1;
      const adv = autoAdvance(cur, now);
      if (!adv) break;
      Object.assign(cur, adv.updates);
      if (adv.updates.clock_status === 'stopped') { stoppedAt = clockPayload(cur, now); break; }
    }
    const esperado = rowsT.filter((r) => !r.row_type || r.row_type === 'level').map((r) => r.level);
    const jogo = seen.filter((s) => s.nivel !== null);
    eq('BUG-02', `${name}: sequência de níveis exibida = estrutura (${esperado.length} níveis)`, jogo.map((s) => s.nivel), esperado.slice(0, jogo.length));
    const blindsOk = jogo.every((s, i) => s.bb === rowsT.filter((r) => !r.row_type || r.row_type === 'level')[i].big_blind);
    check(blindsOk, 'BUG-02', `${name}: número e blind coincidem em todos os níveis`, true, blindsOk);
    seen.forEach((s, i) => { if (s.break) check(s.prox === seen[i + 1]?.nivel, 'BUG-02', `${name}: intervalo anuncia a retomada no nível ${seen[i + 1]?.nivel}`, seen[i + 1]?.nivel, s.prox); });
    const lastNum = Math.max(...esperado);
    if (rowsT.some((r) => r.row_type === 'end_day')) {
      check(stoppedAt && stoppedAt.clock_status === 'stopped' && stoppedAt.level?.row_type === 'end_day', 'BUG-03', `${name}: termina no fim do dia (nível ${lastNum}) e o relógio para`, 'stopped/end_day', stoppedAt && [stoppedAt.clock_status, stoppedAt.level?.row_type]);
      check(jogo.at(-1).nivel === lastNum, 'BUG-03', `${name}: último nível jogado = ${lastNum}`, lastNum, jogo.at(-1).nivel);
    }
  }
  const hrl = (await Tournament.findOne({ name: 'High Roller Light' })).blind_structure;
  const di = hrl.findIndex((r) => r.row_type === 'break' && r.duration === 60);
  const antes = hrl.slice(0, di).filter((r) => r.row_type === 'level').length;
  eq('BUG-02', 'High Roller: dinner break depois do nível 10 retoma no 11 (não 14)', [antes, hrl[di + 2].level], [10, 11]);

  console.log('\n3) "Iniciar" por qualquer ponto (BUG-01)');
  const sim = (await call('post', adm, '/api/tournaments', { name: 'Sim Iniciar', date: '2026-10-04', start_time: '14:00', blind_structure: [{ row_type: 'level', level: 1, small_blind: 100, big_blind: 200, duration: 30 }] })).body;
  const ses = (await get(adm, `/api/tournaments/${sim._id}/sessions`)).body[0];
  await call('put', sal, `/api/tournaments/${sim._id}/sessions/${ses._id}`, { status: 'running' });
  const t1 = await Tournament.findById(sim._id);
  eq('BUG-01', 'iniciar pela sessão liga o relógio e o torneio', [t1.clock_status, t1.status], ['running', 'running']);
  await call('post', sal, `/api/tournaments/${sim._id}/clock`, { action: 'start' });
  await call('put', sal, `/api/tournaments/${sim._id}`, { status: 'running' });
  const t2 = await Tournament.findById(sim._id);
  check(t2.level_started_at.getTime() === t1.level_started_at.getTime(), 'BUG-01', 'repetir Iniciar (relógio / torneio) não reinicia nem duplica', t1.level_started_at, t2.level_started_at);
  eq('MEL-03', 'Material não pausa/encerra sessão nem controla o relógio', [
    (await call('put', mat, `/api/tournaments/${sim._id}/sessions/${ses._id}`, { status: 'finished' })).status,
    (await call('post', mat, `/api/tournaments/${sim._id}/clock`, { action: 'pause' })).status,
  ], [403, 403]);

  console.log('\n4) Inscrições × ativos × eliminação (BUG-04/05) — 10 entradas + 2 reentradas + 8 ativos');
  const stack = (await get(adm, '/api/stacks')).body.find((s) => s.name === '100K');
  const e = (await call('post', adm, '/api/tournaments', { name: 'Sim Entradas', date: '2026-10-04', start_time: '14:00', stack_model_id: stack._id })).body;
  const hc = async () => (await get(mat, `/api/tournaments/${e._id}/headcount`)).body;
  eq('BUG-04', 'Material não lança entrada', (await call('post', mat, `/api/tournaments/${e._id}/entries`, { type: 'buy-in' })).status, 403);
  await call('post', sal, `/api/tournaments/${e._id}/entries`, { type: 'buy-in', quantity: 10 });
  await call('post', sal, `/api/tournaments/${e._id}/entries`, { type: 're-entry', quantity: 2 });
  let c = await hc();
  eq('BUG-04', 'inscrições: 10 iniciais + 2 reentradas = 12', [c.entries_initial, c.entries_reentries, c.entries_total], [10, 2, 12]);
  await call('put', sal, `/api/tournaments/${e._id}/active-players`, { active_players: 8 });
  c = await hc();
  eq('BUG-04', 'ativos informados = 8, inscrições seguem 12', [c.active, c.entries_total], [8, 12]);
  const chipsAntes = (await Tournament.findById(e._id)).chips_value_in_play;
  const p8 = clockPayload(await Tournament.findById(e._id));
  eq('BUG-04', 'média de fichas usa 8 como divisor', p8.avg_stack, Math.round(chipsAntes / 8));
  const ent = (await get(sal, `/api/tournaments/${e._id}/entries`)).body;
  await call('post', sal, `/api/tournaments/${e._id}/eliminations`, { entry_id: ent[0]._id });
  c = await hc();
  eq('BUG-05', 'eliminação: ativos 8 → 7; inscrições (10/2/12) intactas', [c.active, c.entries_initial, c.entries_reentries, c.entries_total], [7, 10, 2, 12]);
  eq('BUG-05', 'eliminação não tira fichas do Chip Count', (await Tournament.findById(e._id)).chips_value_in_play, chipsAntes);
  await call('put', sal, `/api/tournaments/${e._id}/active-players`, { active_players: 0 });
  eq('BUG-04', 'zero ativos: média não aplicável (sem divisão por zero)', clockPayload(await Tournament.findById(e._id)).avg_stack, null);

  console.log('\n5) Enviado × em jogo (BUG-06) — 200 fichas de 25.000 (2 por stack), 10 reentradas, devolver o resto');
  const c25 = await Chip.findOne({ value: 25000 });
  const st2 = (await call('post', adm, '/api/stacks', { name: `Sim Reentrada 2x ${Date.now()}`, composition: [{ chip_id: c25._id, quantities: { buy_in: 1, re_entry: 2 } }] })).body;
  const shen = await Binder.findOne({ name: 'Clássica' });
  const r = (await call('post', adm, '/api/tournaments', { name: 'Sim Reentradas', date: '2026-10-04', start_time: '15:00', stack_model_id: st2._id })).body;
  const al = await call('post', adm, `/api/tournaments/${r._id}/allocations`, { binder_id: shen._id, mode: 'quantities', chips: [{ chip_id: c25._id, quantity: 200 }] });
  check(al.status === 201, 'BUG-07', 'alocação de 200 × 25.000 do fichário Clássica (saldo livre)', 201, [al.status, al.body.error]);
  eq('BUG-06', 'envio de 100 reentradas (200 fichas)', (await call('post', mat, `/api/tournaments/${r._id}/sends`, { items: [{ action: 're_entry', count: 100 }] })).status, 201);
  const row = async () => { const s = (await get(mat, `/api/tournaments/${r._id}/material`)).body; return { ...s.rows.find((x) => x.chip.value === 25000), stacks: s.stacks }; };
  let m = await row();
  eq('BUG-06', 'enviado 200 · no Salão 200 · EM JOGO 0 · disponível 200', [m.sent, m.on_table, m.in_play, m.available], [200, 200, 0, 200]);
  eq('BUG-06', '100 stacks disponíveis (2 × 25.000 por stack)', m.stacks.find((x) => x.action === 're_entry').stacks, 100);
  await call('post', sal, `/api/tournaments/${r._id}/entries`, { type: 're-entry', quantity: 10 });
  m = await row();
  const chipCount = (await Tournament.findById(r._id)).chips_value_in_play;
  eq('BUG-06', '10 reentradas consumidas: 20 fichas / 500.000 em jogo; Chip Count 500.000', [m.in_play, chipCount], [20, 500000]);
  eq('BUG-06', 'restam 180 fichas = 90 stacks para devolver', [m.available, m.stacks.find((x) => x.action === 're_entry').stacks], [180, 90]);
  const rb = await call('post', mat, `/api/tournaments/${r._id}/returns`, { binder_id: shen._id, chips: [{ chip_id: c25._id, quantity: 180 }] });
  m = await row();
  eq('BUG-06', 'devolução de 180: no Salão 20, disponível 0, Chip Count mantido', [rb.status, m.on_table, m.available, (await Tournament.findById(r._id)).chips_value_in_play], [201, 20, 0, 500000]);

  console.log('\n6) Chip Race 170.000 pelo fluxo Salão → Material (MEL-02) e conservação do valor (VAL-01)');
  const wu = await Tournament.findOne({ name: 'Warm Up' });
  const chipBy = async (v) => Chip.findOne({ value: v });
  const [c100, c500, c1000, c5000] = [await chipBy(100), await chipBy(500), await chipBy(1000), await chipBy(5000)];
  // 1A e 1B rodam sobrepostas: toda ação precisa dizer a SESSÃO (sem session_id o servidor recusa em vez de adivinhar)
  const s1aId = (await TournamentSession.findOne({ tournament_id: wu._id, name: 'Dia 1A' }))._id;
  eq('Sessões', 'sem session_id em torneio com várias sessões → recusado (400)', (await call('post', sal, `/api/tournaments/${wu._id}/conversion-requests`, { type: 'CHIP_RACE', tables: 28 })).status, 400);
  const req = await call('post', sal, `/api/tournaments/${wu._id}/conversion-requests`, { type: 'CHIP_RACE', tables: 28, note: 'nível 5', session_id: s1aId });
  check(req.status === 201, 'MEL-02', 'Salão solicita Chip Race informando as mesas reais', 201, [req.status, req.body.error]);
  console.log(`      base: ${req.body.snapshot?.active_players} ativos · ${req.body.snapshot?.entries_total} inscrições · ~${req.body.estimate?.players_per_table}/mesa${req.body.snapshot?.provisional ? ' (provisório)' : ''}`);
  const fila = (await get(mat, '/api/conversion-requests?status=open')).body.filter((x) => x._id === req.body._id);
  eq('MEL-02', 'Material enxerga o chamado', fila.length, 1);
  await call('put', mat, `/api/conversion-requests/${req.body._id}`, { status: 'in_preparation' });
  await call('put', mat, `/api/conversion-requests/${req.body._id}`, { status: 'ready' });
  // o Material prepara e ENVIA ao Salão o que será trocado (envio adicional avulso: 1.000×100 + 28×500 + 56×1.000)
  const envio = await call('post', mat, `/api/tournaments/${wu._id}/sends`, { session_id: s1aId, chips: [{ chip_id: c100._id, quantity: 1000 }, { chip_id: c500._id, quantity: 28 }, { chip_id: c1000._id, quantity: 56 }] });
  check(envio.status === 201, 'MEL-02', 'Material envia as fichas preparadas ao Salão (saem da alocação do Drogon)', 201, [envio.status, envio.body.error]);
  const antesCC = (await call('get', adm, `/api/tournaments/${wu._id}/chips-in-play`)).body.totals.value;
  const conv = await call('post', mat, '/api/conversions', {
    tournament_id: wu._id, session_id: s1aId, type: 'CHIP_RACE', request_id: req.body._id, binder_id: (await Binder.findOne({ name: 'Drogon' }))._id,
    outs: [{ chip_id: c100._id, quantity: 1000 }, { chip_id: c500._id, quantity: 28 }, { chip_id: c1000._id, quantity: 56 }],
    ins: [{ chip_id: c5000._id, quantity: 34 }],
  });
  check(conv.status === 201, 'VAL-01', 'Chip Race 170.000 registrado pelo Material, vinculado ao chamado', 201, [conv.status, conv.body.error]);
  if (conv.status === 201) {
    eq('VAL-01', 'retirado 170.000 = entregue 170.000, quebra 0', [conv.body.value_out, conv.body.value_in, conv.body.math_breakage], [170000, 170000, 0]);
    eq('VAL-01', 'Chip Count preservado', (await call('get', adm, `/api/tournaments/${wu._id}/chips-in-play`)).body.totals.value, antesCC);
    eq('MEL-02', 'chamado concluído e vinculado à conversão', (await get(adm, `/api/conversion-requests?tournament_id=${wu._id}&status=completed`)).body.some((x) => String(x.conversion_id) === String(conv.body._id)), true);
  }

  console.log('\n7) Sessões 1A × 1B independentes, ordem da grade e permissões (MEL-03/05)');
  const sess = await TournamentSession.find({ tournament_id: wu._id });
  const [s1a, s1b] = ['Dia 1A', 'Dia 1B'].map((n) => sess.find((x) => x.name === n));
  const by = async (sid) => (await get(adm, `/api/tournaments/${wu._id}/entries?session_id=${sid}`)).body.length;
  const [a0, b0] = [await by(s1a._id), await by(s1b._id)];
  await call('post', sal, `/api/tournaments/${wu._id}/entries`, { type: 'buy-in', quantity: 3, session_id: s1b._id });
  eq('Sessões', 'lançar 3 entradas na 1B não altera a 1A', [await by(s1a._id), await by(s1b._id)], [a0, b0 + 3]);
  const grade = (await get(adm, '/api/tournaments')).body.filter((t) => !t.deleted_at && ['Warm Up', 'High Roller Light', 'Satélite de Créditos'].includes(t.name)).map((t) => `${t.start_time} ${t.name}`);
  console.log('      grade devolvida pelo servidor:', grade.join(' | '));
  eq('MEL-05', 'grade em ordem cronológica: 14h, 15h, 17h', grade.map((g) => g.slice(0, 5)), ['14:00', '15:00', '17:00']);
  const comAdmin = await call('put', adm, `/api/tournaments/${wu._id}`, { status: 'running' });
  const enc = await call('put', sal, `/api/tournaments/${sim._id}`, { status: 'finished', finish_sessions: true });
  eq('MEL-03', 'Salão não usa "encerrar todas as sessões" (exclusivo do admin)', enc.status, 403);
  eq('MEL-03', 'Auditoria administrativa: Material 403 / Admin 200', [(await get(mat, '/api/inventory/logs')).status, (await get(adm, '/api/inventory/logs')).status], [403, 200]);
  void comAdmin; void Allocation; void Conversion; void mv; void applyAction;

  console.log(`\n${falhas === 0 ? 'SIMULAÇÃO APROVADA — nenhuma divergência.' : `SIMULAÇÃO COM ${falhas} DIVERGÊNCIA(S).`}`);
  await disconnect();
  process.exit(falhas === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(2); });
