// Regras de duração dos blinds e níveis adicionais (item 6). A avaliação roda quando o nível muda e quando os ativos mudam.
const { BlindRule, BlindChange, Tournament, TournamentSession, TournamentEntry } = require('../models');
const sessionsLib = require('./sessions');
const clock = require('./tournamentClock');
const logger = require('./logger');
const { HttpError } = require('./catalog');

const isLevel = (r) => !r.row_type || r.row_type === 'level';
const actor = (u) => u?.name || u?.email || 'Sistema';

/** Regras que valem para a sessão: as do torneio, trocadas pelas da sessão quando têm o mesmo nome (exceção). */
async function rulesFor(session) {
  const all = await BlindRule.find({ tournament_id: session.tournament_id, active: true, $or: [{ session_id: null }, { session_id: session._id }] });
  const byName = new Map();
  for (const r of all.filter((x) => !x.session_id)) byName.set(r.name.toLowerCase(), r);
  for (const r of all.filter((x) => x.session_id)) byName.set(r.name.toLowerCase(), r); // a exceção da sessão vence
  return [...byName.values()];
}

async function conditionMet(rule, session, tournament) {
  const view = sessionsLib.clockView(tournament, session);
  const rows = view.blind_structure || [];
  if (rule.condition === 'players_lte') return (session.actual_players || 0) > 0 && session.actual_players <= rule.value;
  if (rule.condition === 'level_gte') { const n = clock.levelNumber(rows, session.current_level || 0); return n !== null && n + (session.level_offset || 0) >= rule.value; }
  if (rule.condition === 'actions_gte') return (await TournamentEntry.countDocuments({ tournament_id: session.tournament_id, session_id: session._id })) >= rule.value;
  return false;
}

/** Passa a duração dos níveis FUTUROS da sessão para `minutes` (copia a estrutura do torneio por valor se a sessão não tem uma). */
async function applyDuration(session, tournament, minutes) {
  let rows = (session.blind_structure?.length ? session.blind_structure : tournament.blind_structure).map((r) => (r.toObject ? r.toObject() : { ...r }));
  rows = rows.map(({ _id: _omit, ...r }) => r);
  let n = 0;
  rows.forEach((r, i) => { if (i > (session.current_level || 0) && isLevel(r)) { r.duration = minutes; n += 1; } });
  session.blind_structure = rows;
  session.blinds_edited = true;
  await session.save();
  return n;
}

async function record(session, kind, extra) {
  const view = sessionsLib.clockView({ blind_structure: session.blind_structure }, session);
  const n = clock.levelNumber(view.blind_structure || [], session.current_level || 0);
  return BlindChange.create({ tournament_id: session.tournament_id, session_id: session._id, kind, level_number: n === null ? null : n + (session.level_offset || 0), ...extra });
}

async function applyRule(rule, session, tournament, { auto, user, io }) {
  const rows = await applyDuration(session, tournament, rule.minutes);
  await BlindRule.updateOne({ _id: rule._id }, { $addToSet: { applied_sessions: session._id }, $pull: { pending_sessions: session._id } });
  const change = await record(session, 'rule_applied', { rule_id: rule._id, rule_name: rule.name, minutes: rule.minutes, rows_affected: rows, auto, user_name: auto ? 'Sistema' : actor(user) });
  io?.emit('blindRuleApplied', { tournament_id: String(session.tournament_id), session_id: String(session._id), rule: rule.name, minutes: rule.minutes, auto });
  io?.emit('tournamentsChanged', { tournament_id: session.tournament_id, session_id: session._id });
  return change;
}

/** Avalia as regras da sessão: aplica as automáticas e avisa o Salão das que pedem confirmação. Nunca lança (não trava o relógio). */
async function evaluate(sessionId, io) {
  try {
    const session = await TournamentSession.findById(sessionId);
    if (!session || session.status === 'finished') return [];
    const tournament = await Tournament.findById(session.tournament_id);
    if (!tournament) return [];
    const done = [];
    for (const rule of await rulesFor(session)) {
      if (rule.applied_sessions.some((s) => String(s) === String(session._id))) continue;
      if (!(await conditionMet(rule, session, tournament))) continue;
      if (rule.mode === 'auto') { done.push(await applyRule(rule, session, tournament, { auto: true, io })); continue; }
      if (!rule.pending_sessions.some((s) => String(s) === String(session._id))) {
        await BlindRule.updateOne({ _id: rule._id }, { $addToSet: { pending_sessions: session._id } });
        io?.emit('blindRulePending', { tournament_id: String(session.tournament_id), session_id: String(session._id), rule_id: String(rule._id), rule: rule.name, minutes: rule.minutes });
      }
    }
    return done;
  } catch (err) {
    logger.error({ err, sessionId: String(sessionId) }, 'blind rules evaluation failed');
    return [];
  }
}

async function confirm(ruleId, sessionId, user, io) {
  const rule = await BlindRule.findById(ruleId);
  if (!rule) throw new HttpError(404, 'Regra não encontrada.');
  const session = await TournamentSession.findOne({ _id: sessionId, tournament_id: rule.tournament_id });
  if (!session) throw new HttpError(404, 'Sessão não encontrada.');
  if (session.status === 'finished') throw new HttpError(409, `A sessão "${session.name}" está encerrada.`);
  if (rule.applied_sessions.some((s) => String(s) === String(session._id))) throw new HttpError(409, 'Esta regra já foi aplicada nesta sessão.');
  const tournament = await Tournament.findById(session.tournament_id);
  return applyRule(rule, session, tournament, { auto: false, user, io });
}

/** Níveis adicionais no FIM da estrutura, durante a sessão ("blinds adicionais a critério da direção"). */
async function appendLevels(sessionId, rowsIn, user, io) {
  const session = await TournamentSession.findById(sessionId);
  if (!session) throw new HttpError(404, 'Sessão não encontrada.');
  if (session.status === 'finished') throw new HttpError(409, `A sessão "${session.name}" está encerrada.`);
  if (!Array.isArray(rowsIn) || !rowsIn.length || rowsIn.length > 50) throw new HttpError(400, 'Informe de 1 a 50 níveis.');
  const tournament = await Tournament.findById(session.tournament_id);
  const base = (session.blind_structure?.length ? session.blind_structure : tournament.blind_structure).map((r) => { const o = r.toObject ? r.toObject() : { ...r }; delete o._id; return o; });
  const clean = rowsIn.map((r) => {
    const sb = Number(r.small_blind); const bb = Number(r.big_blind); const dur = Number(r.duration);
    if (!Number.isFinite(sb) || !Number.isFinite(bb) || sb <= 0 || bb < sb) throw new HttpError(400, 'Blinds inválidos: o big blind não pode ser menor que o small blind.');
    if (!Number.isFinite(dur) || dur < 1) throw new HttpError(400, 'A duração do nível deve ser de pelo menos 1 minuto.');
    return { row_type: 'level', small_blind: sb, big_blind: bb, ante: Number(r.ante) || 0, duration: dur, label: 'Adicional' };
  });
  session.blind_structure = [...base, ...clean];
  session.blinds_edited = true;
  await session.save();
  const change = await record(session, 'levels_added', { rows_affected: clean.length, user_name: actor(user), auto: false });
  io?.emit('tournamentsChanged', { tournament_id: session.tournament_id, session_id: session._id });
  return { session, change };
}

/**
 * Nível EXTRA (rótulo "Adicional"): editável e removível enquanto ainda não começou (linha depois da atual, ou relógio nunca iniciado).
 * Toda edição/remoção fica no registro de mudanças com autor e horário.
 */
async function changeExtraLevel(sessionId, index, patch, user, io) {
  const session = await TournamentSession.findById(sessionId);
  if (!session) throw new HttpError(404, 'Sessão não encontrada.');
  if (session.status === 'finished') throw new HttpError(409, `A sessão "${session.name}" está encerrada.`);
  const rows = (session.blind_structure || []).map((r) => { const o = r.toObject ? r.toObject() : { ...r }; return o; });
  const i = Number(index);
  const row = rows[i];
  if (!Number.isInteger(i) || !row || row.label !== 'Adicional') throw new HttpError(404, 'Nível adicional não encontrado.');
  if (session.level_started_at && i <= (session.current_level || 0)) throw new HttpError(409, 'Este nível já começou: não pode mais ser alterado.');
  let kind = 'level_removed';
  if (patch) {
    const sb = Number(patch.small_blind ?? row.small_blind); const bb = Number(patch.big_blind ?? row.big_blind); const dur = Number(patch.duration ?? row.duration);
    if (!Number.isFinite(sb) || !Number.isFinite(bb) || sb <= 0 || bb < sb) throw new HttpError(400, 'Blinds inválidos: o big blind não pode ser menor que o small blind.');
    if (!Number.isFinite(dur) || dur < 1) throw new HttpError(400, 'A duração do nível deve ser de pelo menos 1 minuto.');
    rows[i] = { ...row, small_blind: sb, big_blind: bb, ante: Number(patch.ante ?? row.ante) || 0, duration: dur };
    kind = 'level_edited';
  } else {
    rows.splice(i, 1);
  }
  rows.forEach((r) => { delete r._id; });
  session.blind_structure = rows;
  session.blinds_edited = true;
  await session.save();
  const change = await record(session, kind, { rows_affected: 1, user_name: actor(user), auto: false });
  io?.emit('tournamentsChanged', { tournament_id: session.tournament_id, session_id: session._id });
  return { session, change };
}

module.exports = { evaluate, confirm, appendLevels, changeExtraLevel, rulesFor };
