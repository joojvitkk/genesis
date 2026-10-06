import { locale } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Square, ChevronLeft, ChevronRight, Minus, Plus, Volume2, VolumeX } from 'lucide-react';
import { useTournamentClock, formatClock } from '../hooks/useTournamentClock';
import { apiPost } from '../lib/api';
import { beep } from '../lib/beep';

function BlindLine({ level }) {
  if (!level) return <span className="opacity-50">—</span>;
  if (level.row_type === 'break') {
    return <span>Intervalo{level.label ? ` · ${level.label}` : ''}</span>;
  }
  if (level.row_type === 'end_registration' || level.row_type === 'end_day') {
    return <span>{level.label || (level.row_type === 'end_day' ? 'Fim do dia' : 'Fim do registro')}</span>;
  }
  const ante = level.ante ? ` (ante ${level.ante.toLocaleString(locale())})` : '';
  return (
    <span>
      {(level.small_blind ?? 0).toLocaleString(locale())} / {(level.big_blind ?? 0).toLocaleString(locale())}
      <span className="text-[0.6em] opacity-70">{ante}</span>
    </span>
  );
}

// título do estado atual: só linhas de jogo têm número (o do cadastro da estrutura, não o índice da linha)
function levelTitle(level, number) {
  if (!level) return '—';
  if (level.row_type === 'break') return /dinner/i.test(level.label || '') ? 'Dinner break' : 'Intervalo';
  if (level.row_type === 'end_registration') return level.label || 'Fim do registro';
  if (level.row_type === 'end_day') return level.label || 'Fim do dia';
  return `Nível ${number ?? level.level ?? ''}`.trim();
}

const STATUS_LABEL = { running: 'Em andamento', paused: 'Pausado', stopped: 'Parado' };

/**
 * variant: "panel" (dentro do app, com controles) | "projection" (tela cheia da TV)
 */
export default function TournamentClock({ tournamentId, variant = 'panel', canControl = false, onFlash }) {
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const doFlash = (text, sound = 3) => {
    setFlash(text);
    onFlash?.(text);
    if (!muted) beep(sound);
    setTimeout(() => setFlash(null), 6000);
  };

  const clock = useTournamentClock(tournamentId, {
    onLevel: () => doFlash('Novo nível'),
    onMarker: (p) => doFlash(p.label || (p.row_type === 'end_day' ? 'Fim do dia' : 'Registro encerrado'), 5),
    onEnded: () => doFlash('Torneio encerrado', 4),
  });

  // alerta nos últimos 60s
  const warnedRef = useRef(false);
  useEffect(() => {
    if (clock.clock_status !== 'running') { warnedRef.current = false; return; }
    if (clock.remainingMs <= 60_000 && clock.remainingMs > 0 && !warnedRef.current) {
      warnedRef.current = true;
      if (!muted) beep(1, 660);
    }
    if (clock.remainingMs > 60_000) warnedRef.current = false;
  }, [clock.remainingMs, clock.clock_status, muted]);

  const send = async (action, seconds) => {
    if (busy) return;
    setBusy(true);
    try {
      beep(0); // "acorda" o AudioContext no primeiro clique
      await apiPost(`/tournaments/${tournamentId}/clock`, { action, seconds });
    } catch { /* toast é responsabilidade da página */ }
    finally { setBusy(false); }
  };

  const status = clock.clock_status || 'stopped';
  const onBreak = !!clock.is_break; // intervalo / dinner break: não pode ser confundido com um nível em andamento
  const breakName = /dinner/i.test(clock.level?.label || '') ? 'Dinner break' : 'Intervalo';
  const nextPlay = clock.next_play_level;
  const low = clock.clock_status === 'running' && clock.remainingMs <= 60_000;
  const isProjection = variant === 'projection';

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border transition-colors
        ${onBreak
          ? 'border-warn bg-warn-soft text-fg'
          : 'border-line bg-surface text-fg'}
        ${low && !onBreak ? 'ring-2 ring-brand' : ''}`}
      data-break={onBreak ? 'true' : undefined}
    >
      {onBreak && (
        <div role="status" className="bg-warn py-2 text-center text-sm font-bold tracking-wide text-[var(--on-warn)]">
          {breakName}{nextPlay ? ` · volta no Nível ${nextPlay.level_number} (${(nextPlay.small_blind ?? 0).toLocaleString(locale())} / ${(nextPlay.big_blind ?? 0).toLocaleString(locale())})` : ''}
        </div>
      )}
      {flash && (
        <div className="absolute inset-x-0 top-0 z-10 bg-brand py-2 text-center text-sm font-bold tracking-wide text-white">
          {flash}
        </div>
      )}

      <div className={isProjection ? 'p-8 md:p-16' : 'p-6'}>
        {/* topo: status + nível */}
        <div className="flex items-center justify-between gap-4">
          <span className={`badge ${status === 'running' ? 'badge-ok' : status === 'paused' ? 'badge-warn' : 'badge-neutral'}`}>
            <span className="dot" aria-hidden="true" />
            {STATUS_LABEL[status]}
          </span>
          <div className="text-right">
            <p className={`font-bold ${isProjection ? 'text-2xl' : 'text-sm'}`}>
              {levelTitle(clock.level, clock.level_number)}
            </p>
            {isProjection && clock.name && <p className="text-sm font-semibold text-fg-subtle">{clock.name}</p>}
          </div>
        </div>

        {/* relógio */}
        <div className="my-6 text-center">
          <p
            className={`font-mono font-semibold tabular-nums leading-none tracking-tight
              ${low ? 'text-brand-fg' : 'text-fg'}
              ${isProjection ? 'text-[22vw] md:text-[16rem]' : 'text-6xl'}`}
          >
            {formatClock(clock.remainingMs || 0)}
          </p>
        </div>

        {/* blinds atuais / próximo */}
        <div className={`grid grid-cols-2 gap-4 ${isProjection ? 'text-2xl md:text-4xl' : 'text-lg'}`}>
          <div className={`rounded-2xl p-4 bg-sunken`}>
            <p className="mb-1 text-[0.55em] font-semibold uppercase tracking-wide text-fg-subtle">Blinds</p>
            <p className="font-bold"><BlindLine level={clock.level} /></p>
          </div>
          <div className={`rounded-2xl p-4 bg-sunken`}>
            <p className="mb-1 text-[0.55em] font-semibold uppercase tracking-wide text-fg-subtle">Próximo</p>
            <p className="font-bold opacity-70"><BlindLine level={clock.next_level} /></p>
          </div>
        </div>

        {/* métricas */}
        <div className={`mt-4 grid grid-cols-3 gap-4 ${isProjection ? 'text-xl md:text-3xl' : 'text-sm'}`}>
          <Metric label="Jogando" value={(clock.actual_players ?? 0).toLocaleString(locale())} projection={isProjection} />
          <Metric label="Stack médio" value={clock.avg_stack == null ? 'N/A' : clock.avg_stack.toLocaleString(locale())} projection={isProjection} />
          <Metric label="Fichas em jogo" value={(clock.total_chips_in_play ?? 0).toLocaleString(locale())} projection={isProjection} />
        </div>

        {/* controles */}
        {canControl && !isProjection && (
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line-soft pt-5">
            {status !== 'running' && (
              <Btn onClick={() => send(status === 'paused' ? 'resume' : 'start')} disabled={busy} primary>
                <Play size={15} /> {status === 'paused' ? 'Retomar' : 'Iniciar'}
              </Btn>
            )}
            {status === 'running' && (
              <Btn onClick={() => send('pause')} disabled={busy}><Pause size={15} /> Pausar</Btn>
            )}
            <Btn onClick={() => send('prev')} disabled={busy}><ChevronLeft size={15} /> Nível</Btn>
            <Btn onClick={() => send('next')} disabled={busy}>Nível <ChevronRight size={15} /></Btn>
            <Btn onClick={() => send('adjust', -60)} disabled={busy}><Minus size={13} />1&nbsp;min</Btn>
            <Btn onClick={() => send('adjust', 60)} disabled={busy}><Plus size={13} />1&nbsp;min</Btn>
            {status !== 'stopped' && (
              <Btn onClick={() => send('stop')} disabled={busy} danger><Square size={13} /> Encerrar</Btn>
            )}
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="ml-auto rounded-xl p-2 text-fg-subtle hover:text-fg"
              title={muted ? 'Ativar som' : 'Silenciar'}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>
        )}

        {isProjection && !clock.connected && (
          <p className="mt-4 text-center text-sm font-bold uppercase tracking-wide text-warn">Reconectando…</p>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, projection }) {
  return (
    <div className={`rounded-2xl p-3 ${'bg-sunken'}`}>
      <p className="text-[0.5em] font-semibold uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Btn({ children, primary, danger, ...props }) {
  const variant = primary ? 'btn-primary' : danger ? 'btn-danger' : 'btn-secondary';
  return <button type="button" className={`btn btn-sm ${variant}`} {...props}>{children}</button>;
}
