// Lógica pura do relógio de torneio — sem timers, sem I/O. Testável isoladamente.
//
// Modelo de tempo:
//   - level_started_at: instante em que o nível atual "começou" (deslocado a cada resume)
//   - paused_at: quando pausado, congela a contagem
//   - clock_adjust_seconds: ajuste manual do staff no nível atual (+/-)
//   remaining = duração_do_nível + ajuste - (agora_efetivo - level_started_at)

const MARKER_TYPES = ['end_registration', 'end_day'];

function ms(d) { return d ? new Date(d).getTime() : 0; }

function levelDurationMs(row) {
  if (!row || MARKER_TYPES.includes(row.row_type)) return 0;
  return (Number(row.duration) || 0) * 60_000;
}

/** Tempo restante no nível atual em ms (pode ser negativo se estourou). */
function remainingMs(t, now = Date.now()) {
  const rows = t.blind_structure || [];
  const row = rows[t.current_level || 0];
  const dur = levelDurationMs(row);
  if (!t.level_started_at) return dur + (t.clock_adjust_seconds || 0) * 1000;
  const effectiveNow = t.paused_at ? ms(t.paused_at) : now;
  const elapsed = effectiveNow - ms(t.level_started_at);
  return dur + (t.clock_adjust_seconds || 0) * 1000 - elapsed;
}

function gotoLevel(t, index, now) {
  const rows = t.blind_structure || [];
  const max = Math.max(0, rows.length - 1);
  const clamped = Math.max(0, Math.min(Math.trunc(index), max));
  return {
    current_level: clamped,
    level_started_at: new Date(now),
    paused_at: t.clock_status === 'paused' ? new Date(now) : null,
    clock_adjust_seconds: 0,
  };
}

/**
 * Aplica uma ação de controle. Retorna os campos a persistir ({} = nada muda).
 * actions: start | pause | resume | stop | next | prev | goto | adjust
 */
function applyAction(t, action, { seconds = 0, now = Date.now() } = {}) {
  switch (action) {
    case 'start':
      return {
        clock_status: 'running',
        level_started_at: new Date(now),
        paused_at: null,
        clock_adjust_seconds: 0,
        current_level: t.current_level || 0,
      };
    case 'pause':
      if (t.clock_status !== 'running') return {};
      return { clock_status: 'paused', paused_at: new Date(now) };
    case 'resume': {
      if (t.clock_status !== 'paused') return {};
      const shift = t.paused_at ? now - ms(t.paused_at) : 0;
      return {
        clock_status: 'running',
        paused_at: null,
        level_started_at: new Date(ms(t.level_started_at) + shift),
      };
    }
    case 'stop':
      return { clock_status: 'stopped', paused_at: null };
    case 'next':
      return gotoLevel(t, (t.current_level || 0) + 1, now);
    case 'prev':
      return gotoLevel(t, (t.current_level || 0) - 1, now);
    case 'goto':
      return gotoLevel(t, seconds, now); // reaproveita `seconds` como índice
    case 'adjust':
      return { clock_adjust_seconds: (t.clock_adjust_seconds || 0) + Math.trunc(seconds) };
    default:
      return null; // ação inválida
  }
}

/**
 * Chamado a cada tick. Se o nível estourou e o relógio está rodando,
 * calcula o avanço automático (pulando marcadores, parando em end_day / fim).
 * Retorna { updates, events } ou null.
 */
function autoAdvance(t, now = Date.now()) {
  if (t.clock_status !== 'running') return null;
  if (remainingMs(t, now) > 0) return null;

  const rows = t.blind_structure || [];
  const events = [];
  let idx = (t.current_level || 0) + 1;

  while (idx < rows.length && MARKER_TYPES.includes(rows[idx].row_type)) {
    events.push({ type: 'marker', row_type: rows[idx].row_type, label: rows[idx].label });
    if (rows[idx].row_type === 'end_day') {
      return { updates: { clock_status: 'stopped', current_level: idx, level_started_at: new Date(now), paused_at: null }, events };
    }
    idx += 1;
  }

  if (idx >= rows.length) {
    events.push({ type: 'ended' });
    return { updates: { clock_status: 'stopped' }, events };
  }

  events.push({ type: 'level', level: idx });
  return {
    updates: { current_level: idx, level_started_at: new Date(now), paused_at: null, clock_adjust_seconds: 0 },
    events,
  };
}

/** Payload enviado aos clientes via socket. */
function clockPayload(t, now = Date.now()) {
  const rows = t.blind_structure || [];
  const cur = t.current_level || 0;
  const players = t.actual_players || 0;
  const stack = t.starting_stack || 0;
  const chipsValue = t.chips_value_in_play != null ? t.chips_value_in_play : players * stack;
  return {
    tournament_id: String(t._id),
    name: t.name,
    clock_status: t.clock_status || 'stopped',
    current_level: cur,
    level: rows[cur] || null,
    next_level: rows[cur + 1] || null,
    remaining_ms: remainingMs(t, now),
    server_time: now,
    actual_players: players,
    starting_stack: stack,
    // valor nominal das fichas em jogo: DERIVADO no servidor (entradas × modelo de stack por ação, com reentradas e
    // add-ons — lib/tournamentChips). Torneios ainda não recalculados caem em jogadores × stack inicial.
    total_chips_in_play: chipsValue,
    avg_stack: players > 0 ? Math.round(chipsValue / players) : stack,
  };
}

module.exports = { MARKER_TYPES, levelDurationMs, remainingMs, applyAction, gotoLevel, autoAdvance, clockPayload };
