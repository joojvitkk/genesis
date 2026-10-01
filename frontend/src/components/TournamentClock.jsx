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
  const ante = level.ante ? ` (ante ${level.ante.toLocaleString('pt-BR')})` : '';
  return (
    <span>
      {(level.small_blind ?? 0).toLocaleString('pt-BR')} / {(level.big_blind ?? 0).toLocaleString('pt-BR')}
      <span className="text-[0.6em] opacity-70">{ante}</span>
    </span>
  );
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
  const low = clock.clock_status === 'running' && clock.remainingMs <= 60_000;
  const isProjection = variant === 'projection';

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border transition-colors
        ${isProjection ? 'border-zinc-800 bg-[#0A0A0A] text-white' : 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-[#111111]'}
        ${low ? 'ring-2 ring-genesis-red' : ''}`}
    >
      {flash && (
        <div className="absolute inset-x-0 top-0 z-10 bg-genesis-red py-2 text-center text-sm font-black uppercase tracking-widest text-white animate-pulse">
          {flash}
        </div>
      )}

      <div className={isProjection ? 'p-8 md:p-16' : 'p-6'}>
        {/* topo: status + nível */}
        <div className="flex items-center justify-between gap-4">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest
            ${status === 'running' ? 'bg-emerald-500/15 text-emerald-500'
              : status === 'paused' ? 'bg-amber-500/15 text-amber-500'
              : 'bg-gray-500/15 text-gray-400'}`}>
            <span className={`h-2 w-2 rounded-full ${status === 'running' ? 'bg-emerald-500 animate-pulse' : status === 'paused' ? 'bg-amber-500' : 'bg-gray-400'}`} />
            {STATUS_LABEL[status]}
          </span>
          <div className="text-right">
            <p className={`font-black uppercase tracking-tight ${isProjection ? 'text-2xl' : 'text-sm'}`}>
              {clock.level?.row_type === 'break' ? 'Intervalo' : `Nível ${(clock.current_level ?? 0) + 1}`}
            </p>
            {isProjection && clock.name && <p className="text-sm font-bold uppercase tracking-widest text-zinc-500">{clock.name}</p>}
          </div>
        </div>

        {/* relógio */}
        <div className="my-6 text-center">
          <p
            className={`font-black tabular-nums leading-none tracking-tighter
              ${low ? 'text-genesis-red' : isProjection ? 'text-white' : 'text-gray-900 dark:text-white'}
              ${isProjection ? 'text-[22vw] md:text-[16rem]' : 'text-6xl'}`}
          >
            {formatClock(clock.remainingMs || 0)}
          </p>
        </div>

        {/* blinds atuais / próximo */}
        <div className={`grid grid-cols-2 gap-4 ${isProjection ? 'text-2xl md:text-4xl' : 'text-lg'}`}>
          <div className={`rounded-2xl p-4 ${isProjection ? 'bg-zinc-900' : 'bg-gray-50 dark:bg-zinc-900/60'}`}>
            <p className="mb-1 text-[0.55em] font-black uppercase tracking-widest text-zinc-500">Blinds</p>
            <p className="font-black"><BlindLine level={clock.level} /></p>
          </div>
          <div className={`rounded-2xl p-4 ${isProjection ? 'bg-zinc-900/60' : 'bg-gray-50 dark:bg-zinc-900/40'}`}>
            <p className="mb-1 text-[0.55em] font-black uppercase tracking-widest text-zinc-500">Próximo</p>
            <p className="font-black opacity-70"><BlindLine level={clock.next_level} /></p>
          </div>
        </div>

        {/* métricas */}
        <div className={`mt-4 grid grid-cols-3 gap-4 ${isProjection ? 'text-xl md:text-3xl' : 'text-sm'}`}>
          <Metric label="Entradas" value={(clock.actual_players ?? 0).toLocaleString('pt-BR')} projection={isProjection} />
          <Metric label="Stack médio" value={(clock.avg_stack ?? 0).toLocaleString('pt-BR')} projection={isProjection} />
          <Metric label="Fichas em jogo" value={(clock.total_chips_in_play ?? 0).toLocaleString('pt-BR')} projection={isProjection} />
        </div>

        {/* controles */}
        {canControl && !isProjection && (
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-5 dark:border-zinc-800">
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
              className="ml-auto rounded-xl p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title={muted ? 'Ativar som' : 'Silenciar'}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>
        )}

        {isProjection && !clock.connected && (
          <p className="mt-4 text-center text-sm font-bold uppercase tracking-widest text-amber-500">Reconectando…</p>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, projection }) {
  return (
    <div className={`rounded-2xl p-3 ${projection ? 'bg-zinc-900/40' : 'bg-gray-50 dark:bg-zinc-900/40'}`}>
      <p className="text-[0.5em] font-black uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="font-black tabular-nums">{value}</p>
    </div>
  );
}

function Btn({ children, primary, danger, ...props }) {
  const base = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wide transition-all active:scale-95 disabled:opacity-40';
  const style = primary
    ? 'bg-genesis-red text-white hover:bg-red-700 shadow-lg shadow-red-500/20'
    : danger
    ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10'
    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-200 dark:hover:bg-zinc-700';
  return <button type="button" className={`${base} ${style}`} {...props}>{children}</button>;
}
