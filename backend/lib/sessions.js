// Sessões/fases de um torneio (G4): resolução da sessão "atual", ciclo de status e contadores.
//
//   Evento → Torneio → Sessões (Dia 1A, 1B, Dia Final…)
//
// A sessão tem o seu PRÓPRIO estado em execução (Simulação 2.1 §4): relógio, nível, entradas, ativos, fichas em
// jogo e Chip Race. A estrutura (blinds, fichário, modelos de stack) é do torneio e compartilhada (spec §18.8).
const { Tournament, TournamentSession, TournamentEntry } = require('../models');
const { HttpError } = require('./catalog');
const { SESSION_TYPES } = require('../models/TournamentSession');
const { escapeRegex } = require('../utils/sanitize');
const { levelNumber, indexOfLevel, remainingMs } = require('./tournamentClock');

// scheduled → running → finished. Reabrir uma sessão encerrada (finished → running) é só do admin.
const TRANSITIONS = { scheduled: ['running'], running: ['finished'], finished: ['running'] };

const listSessions = (tournamentId) => TournamentSession.find({ tournament_id: tournamentId }).sort({ order: 1, createdAt: 1 });

/**
 * Sessão a usar numa operação (entrada, mesas…).
 *  - `requested` informado → precisa pertencer ao torneio;
 *  - senão: 1 sessão → ela; várias → a única em andamento; ambíguo → 400 (exige `session_id`);
 *  - torneio SEM sessões (dados anteriores ao G4) → null (compatível).
 * `open: true` recusa sessão encerrada.
 */
async function resolveSession(tournamentId, requested, { open = false } = {}) {
  let session = null;
  if (requested) {
    session = await TournamentSession.findOne({ _id: requested, tournament_id: tournamentId });
    if (!session) throw new HttpError(404, 'Sessão não encontrada neste torneio.');
  } else {
    const all = await listSessions(tournamentId);
    if (all.length === 1) session = all[0];
    else if (all.length > 1) {
      const running = all.filter((s) => s.status === 'running');
      if (running.length !== 1) throw new HttpError(400, 'Este torneio tem várias sessões: informe a sessão (session_id).');
      session = running[0];
    }
  }
  if (session && open && session.status === 'finished') throw new HttpError(409, `A sessão "${session.name}" está encerrada.`);
  return session;
}

/** Toda consulta operacional usa a sessão; `tournament_id` só agrega. Torneio SEM sessões (dados muito antigos) → null. */
const isFinal = (session) => session?.type === 'FINAL';
/** Fase que HERDA classificados e fichas da anterior (Dia 2, 3, 4…, Final) — tudo que não é classificatório. */
const isInheriting = (session) => !!session && session.type !== 'QUALIFIER';

/**
 * Sessões de onde `session` herda: a fase não classificatória imediatamente anterior (por ordem) ou, se for a
 * primeira, todas as classificatórias. Não limita a quantidade de fases (Dia 2, 3, 4, 5, Final…).
 */
function sourceSessions(all, session) {
  const idx = all.findIndex((s) => String(s._id) === String(session._id));
  const prev = all.slice(0, idx < 0 ? all.length : idx).filter((s) => s.type !== 'QUALIFIER').pop();
  return prev ? [prev] : all.filter((s) => s.type === 'QUALIFIER');
}

/** Motivo (string) pelo qual a sessão NÃO aceita esta inscrição agora, ou null se aceita. type: 'buy-in' | 're-entry'. */
function registrationBlock(session, type, clock) {
  if (!session || type === 'add-on') return null;
  const flag = type === 'buy-in' ? session.allow_buyins : session.allow_reentries;
  const allowed = flag === null || flag === undefined ? session.type === 'QUALIFIER' : flag;
  const label = type === 'buy-in' ? 'buy-in' : 'reentrada';
  if (!allowed) return `A sessão "${session.name}" não aceita ${label} (configuração da sessão).`;
  if (clock && session.level_started_at) {
    const rows = clock.blind_structure || [];
    const cur = session.current_level || 0;
    const n = levelNumber(rows, cur);
    const num = n === null ? null : n + (session.level_offset || 0);
    if (session.registration_close_level != null && num !== null && num > session.registration_close_level) {
      return `O registro da sessão "${session.name}" encerrou no Nível ${session.registration_close_level}.`;
    }
    if (session.registration_close_marker) {
      const marker = rows.findIndex((r) => r.row_type === 'end_registration');
      if (marker >= 0 && cur > marker) return `O registro da sessão "${session.name}" está encerrado (Fim do Registro).`;
    }
  }
  return null;
}

/** Último nível efetivamente jogado agora: { number (oficial), remaining_ms } ou null se o relógio nunca andou. */
function endedState(view) {
  if (!view?.level_started_at) return null;
  const rows = view.blind_structure || [];
  const lp = lastPlayable(rows, view.current_level || 0);
  if (!lp) return null;
  const onPlay = lp.index === (view.current_level || 0);
  return { number: lp.number + (view.level_offset || 0), remaining_ms: onPlay ? Math.max(0, remainingMs(view)) : 0 };
}

/**
 * "Visão de relógio" de uma sessão: a estrutura de blinds é do torneio, o estado em execução é da sessão.
 * Sem sessão devolve o próprio torneio (compatível com torneios anteriores ao G4).
 */
function clockView(tournament, session) {
  if (!session) return tournament;
  return {
    _id: tournament._id, session_id: session._id, session_name: session.name, session_type: session.type,
    name: tournament.name,
    // a fase seguinte (Dia Final) tem estrutura própria e continua a numeração dos níveis (Simulação 3.0 §4)
    blind_structure: session.blind_structure?.length ? session.blind_structure : tournament.blind_structure,
    level_offset: session.level_offset || 0,
    starting_stack: tournament.starting_stack,
    clock_status: session.clock_status, current_level: session.current_level, level_started_at: session.level_started_at,
    paused_at: session.paused_at, clock_adjust_seconds: session.clock_adjust_seconds,
    actual_players: session.actual_players, entries_initial: session.entries_initial, entries_reentries: session.entries_reentries,
    chips_value_in_play: session.chips_value_in_play,
  };
}

/** Último nível JOGÁVEL (linha `level`) até a linha `idx`: { index, number } ou null. Intervalos e marcadores não contam. */
function lastPlayable(rows, idx) {
  for (let i = Math.min(idx, rows.length - 1); i >= 0; i -= 1) {
    const n = levelNumber(rows, i);
    if (n !== null) return { index: i, number: n };
  }
  return null;
}

/** Último nível jogado de uma sessão encerrada: { number, remaining_ms }. Usa o registrado; senão deriva (dados anteriores). */
function endedOf(session, tournamentRows) {
  if (session.ended_level_number != null) return { number: session.ended_level_number, remaining_ms: session.ended_remaining_ms || 0 };
  if (!session.level_started_at) return null;
  const view = { ...clockView({ blind_structure: tournamentRows, starting_stack: 0 }, session), level_started_at: session.level_started_at };
  return endedState(view);
}

/**
 * Prepara os níveis das fases seguintes (Dia 2, 3, 4…, Final) a partir do último nível efetivamente jogado da fase anterior
 * (sem somar níveis de 1A/1B/1C…): `start_mode` 'next' (padrão) começa no nível seguinte; 'resume' retoma o mesmo nível com
 * o tempo restante. Os valores vêm da estrutura do torneio (Tracking Sheet) e continuam editáveis. Só enquanto a fase não
 * começou nem foi configurada/editada — fases com estrutura própria escolhida (blinds_edited) usam applyStartMode.
 */
async function prepareFinalLevels(tournamentId) {
  const t = await Tournament.findById(tournamentId);
  if (!t) return;
  const rows = t.blind_structure || [];
  const all = await listSessions(tournamentId);
  const map = (r) => ({ row_type: r.row_type || 'level', small_blind: r.small_blind, big_blind: r.big_blind, ante: r.ante || 0, duration: r.duration, label: r.label });
  for (const f of all) {
    if (!isInheriting(f) || f.status === 'finished' || f.level_started_at || f.blinds_edited) continue;
    let best = null; // { number, index (na estrutura do torneio), remaining_ms }
    for (const src of sourceSessions(all, f).filter((x) => x.status === 'finished' && x.level_started_at)) {
      const e = endedOf(src, rows);
      if (e && (!best || e.number > best.number)) best = { number: e.number, remaining_ms: e.remaining_ms };
    }
    if (!best) { f.level_offset = 0; f.blind_structure = []; f.current_level = 0; f.resume_remaining_ms = null; await f.save(); continue; }
    best.index = indexOfLevel(rows, best.number);
    const resume = f.start_mode === 'resume' && best.index >= 0;
    f.level_offset = resume ? best.number - 1 : best.number;
    f.current_level = 0;
    f.resume_remaining_ms = resume ? best.remaining_ms : null;
    // A fase começa DIRETO no nível configurado (ex.: 17) com os valores da estrutura do torneio.
    const from = resume ? best.index : best.index + 1;
    const after = (best.index >= 0 ? rows.slice(from) : []).filter((r) => !['end_day', 'end_registration'].includes(r.row_type));
    const firstLevel = after.findIndex((r) => !r.row_type || r.row_type === 'level');
    if (firstLevel >= 0) {
      f.blind_structure = after.slice(firstLevel).map(map);
    } else {
      // a estrutura não define o nível: parte do último nível jogado (editável), como antes
      const last = rows[best.index] || rows.filter((r) => !r.row_type || r.row_type === 'level').pop();
      f.blind_structure = last ? [map({ ...last, row_type: 'level', label: undefined })] : [];
      if (resume) { f.level_offset = best.number - 1; }
    }
    await f.save();
  }
}

/**
 * Fase com estrutura PRÓPRIA já escolhida (blinds_edited): ao iniciar, posiciona no nível conforme `start_mode`
 * (next/resume) a partir do último nível jogado da fase anterior. Devolve true se alterou a sessão.
 */
async function applyStartMode(session) {
  if (!isInheriting(session) || !session.blinds_edited || session.level_started_at) return false;
  const mode = session.start_mode;
  if (!mode || mode === 'manual' || !session.blind_structure?.length) return false;
  const all = await listSessions(session.tournament_id);
  const t = await Tournament.findById(session.tournament_id).select('blind_structure').lean();
  let best = null;
  for (const src of sourceSessions(all, session).filter((x) => x.status === 'finished' && x.level_started_at)) {
    const e = endedOf(src, t?.blind_structure || []);
    if (e && (!best || e.number > best.number)) best = e;
  }
  if (!best) return false;
  const target = mode === 'resume' ? best.number : best.number + 1;
  const idx = indexOfLevel(session.blind_structure, target, session.level_offset || 0);
  if (idx < 0) throw new HttpError(409, `A estrutura da sessão "${session.name}" não contém o Nível ${target}. Ajuste a estrutura ou o modo de início.`);
  session.current_level = idx;
  session.resume_remaining_ms = mode === 'resume' ? best.remaining_ms : null;
  await session.save();
  return true;
}

/** Grava as atualizações de relógio no dono do estado (sessão ou, sem sessões, o torneio). */
async function saveClock(tournament, session, updates) {
  const owner = session || tournament;
  Object.assign(owner, updates);
  await owner.save();
  return owner;
}

/**
 * Cache de relógio/status do TORNEIO derivado das sessões (só para listagens e Dashboard): rodando se alguma sessão
 * roda, pausado se nenhuma roda e alguma está pausada. Cada sessão continua dona do seu próprio relógio.
 */
async function syncTournamentCache(tournamentId) {
  const t = await Tournament.findById(tournamentId);
  if (!t) return null;
  const all = await listSessions(tournamentId);
  if (!all.length) return t;
  const live = all.filter((s) => s.status !== 'finished');
  const anyRunning = live.some((s) => s.clock_status === 'running');
  const anyPaused = live.some((s) => s.clock_status === 'paused');
  t.clock_status = anyRunning ? 'running' : anyPaused ? 'paused' : 'stopped';
  if (!['finished', 'finalized'].includes(t.status)) {
    if (anyRunning) t.status = 'running';
    else if (anyPaused) t.status = 'paused';
    else if (t.status === 'paused') t.status = 'running';
  }
  await t.save();
  return t;
}

/** Soma dos classificados das sessões de origem ENCERRADAS = jogadores iniciais da fase (sem `session`: das classificatórias). */
async function qualifiedTotal(tournamentId, session = null) {
  let rows;
  if (session) rows = sourceSessions(await listSessions(tournamentId), session).filter((s) => s.status === 'finished');
  else rows = await TournamentSession.find({ tournament_id: tournamentId, type: 'QUALIFIER', status: 'finished' }).select('qualified_count').lean();
  return rows.reduce((sum, r) => sum + (r.qualified_count || 0), 0);
}

async function assertUniqueName(tournamentId, name, excludeId) {
  const q = { tournament_id: tournamentId, name: new RegExp(`^${escapeRegex(name)}$`, 'i') };
  if (excludeId) q._id = { $ne: excludeId };
  if (await TournamentSession.exists(q)) throw new HttpError(409, `Já existe a sessão "${name}" neste torneio.`);
}

/** Cria uma sessão no fim da sequência. */
async function createSession(tournamentId, { name, starts_at, notes, type, ...config } = {}) {
  const clean = String(name || '').trim();
  if (!clean) throw new HttpError(400, 'Nome da sessão é obrigatório.');
  if (type !== undefined && !SESSION_TYPES.includes(type)) throw new HttpError(400, `Tipo de sessão inválido. Use: ${SESSION_TYPES.join(', ')}.`);
  await assertUniqueName(tournamentId, clean);
  const last = await TournamentSession.findOne({ tournament_id: tournamentId }).sort({ order: -1 });
  return new TournamentSession({
    tournament_id: tournamentId, name: clean, order: (last?.order || 0) + 1,
    starts_at: starts_at || null, notes, type: type || (/final/i.test(clean) ? 'FINAL' : 'QUALIFIER'), ...config,
  }).save();
}

/** Aplica uma mudança de status respeitando o ciclo. */
function applyStatus(session, next, { isAdmin }) {
  if (next === session.status) return session;
  if (!TRANSITIONS[session.status]?.includes(next)) {
    throw new HttpError(409, `Uma sessão "${session.status}" não pode ir para "${next}".`);
  }
  if (session.status === 'finished' && !isAdmin) throw new HttpError(403, 'Só o administrador reabre uma sessão encerrada.');
  session.status = next;
  if (next === 'running') { session.started_at = session.started_at || new Date(); session.finished_at = null; }
  if (next === 'finished') session.finished_at = new Date();
  return session;
}

/** Sessões que ainda não foram encerradas. */
const pendingSessions = (tournamentId) => TournamentSession.find({ tournament_id: tournamentId, status: { $ne: 'finished' } }).sort({ order: 1 });

/** Encerra todas as sessões pendentes (usado ao fechar o torneio). Devolve quantas encerrou. */
async function finishAll(tournamentId) {
  const pending = await pendingSessions(tournamentId);
  const now = new Date();
  for (const s of pending) {
    s.started_at = s.started_at || now;
    s.finished_at = now;
    s.status = 'finished';
    await s.save();
  }
  return pending.length;
}

/** Contadores de ações por sessão: { [sessionId|'none']: { total, by_type, by_action } }. */
async function sessionCounters(tournamentId) {
  const rows = await TournamentEntry.aggregate([
    { $match: { tournament_id: tournamentId, status: { $ne: 'cancelled' } } },
    { $group: { _id: { s: '$session_id', t: '$type', a: '$action' }, n: { $sum: 1 } } },
  ]);
  const out = {};
  for (const r of rows) {
    const k = r._id.s ? String(r._id.s) : 'none';
    const c = out[k] || (out[k] = { total: 0, by_type: {}, by_action: {} });
    c.total += r.n;
    c.by_type[r._id.t] = (c.by_type[r._id.t] || 0) + r.n;
    if (r._id.a) c.by_action[r._id.a] = (c.by_action[r._id.a] || 0) + r.n;
  }
  return out;
}

module.exports = { lastPlayable, prepareFinalLevels, applyStartMode, endedState, endedOf, sourceSessions, registrationBlock, isInheriting, isFinal, clockView, saveClock, syncTournamentCache, qualifiedTotal, TRANSITIONS, listSessions, resolveSession, createSession, applyStatus, pendingSessions, finishAll, sessionCounters, assertUniqueName };
