import { locale } from '../lib/i18n';
import { Clock3, Coffee } from 'lucide-react';
import { useTournamentClock, formatClock } from '../hooks/useTournamentClock';

const n = (v) => (v ?? 0).toLocaleString(locale());

/** Um torneio em andamento com o relógio ao vivo (socket). Em intervalo o cartão muda de cor e diz quando volta o jogo. */
function ClockCard({ tournament }) {
  const clock = useTournamentClock(tournament._id);
  const status = clock.clock_status || tournament.clock_status || 'stopped';
  const onBreak = !!clock.is_break;
  const paused = status === 'paused';
  const lvl = clock.level;
  const breakName = /dinner/i.test(lvl?.label || '') ? 'Dinner break' : 'Intervalo';
  const next = clock.next_play_level;
  const low = status === 'running' && !onBreak && clock.remainingMs > 0 && clock.remainingMs <= 60_000;

  const tone = onBreak ? 'border-warn bg-warn-soft ring-1 ring-warn' : paused ? 'border-line bg-sunken' : 'border-line bg-surface';
  return (
    <li data-testid="running-clock" data-break={onBreak ? 'true' : undefined} className={`rounded-xl border p-4 transition-colors ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-semibold text-fg">{tournament.name}</p>
        {onBreak
          ? <span className="badge badge-warn"><Coffee size={14} aria-hidden="true" /> {breakName}</span>
          : paused ? <span className="badge badge-warn">Pausado</span>
          : status === 'running' ? <span className="badge badge-ok"><span className="dot" aria-hidden="true" /> Em andamento</span>
          : <span className="badge badge-neutral">Parado</span>}
      </div>

      <p className={`mt-2 font-mono text-4xl font-semibold tabular-nums leading-none ${low ? 'text-brand-fg' : 'text-fg'}`} aria-label="Tempo restante do nível">
        {formatClock(clock.remainingMs ?? 0)}
      </p>

      <p className="mt-2 text-sm text-fg-muted">
        {onBreak
          ? <>Volta no {next ? <>Nível {next.level_number} · <span className="num">{n(next.small_blind)} / {n(next.big_blind)}</span></> : 'próximo nível'}</>
          : lvl && lvl.row_type === 'level'
            ? <>Nível {clock.level_number} · <span className="num">{n(lvl.small_blind)} / {n(lvl.big_blind)}</span>{lvl.ante ? <span className="text-fg-subtle"> (ante {n(lvl.ante)})</span> : null}</>
            : <span className="text-fg-subtle">{lvl?.label || '—'}</span>}
      </p>
      <p className="mt-1 text-xs text-fg-subtle"><span className="num">{n(clock.actual_players ?? tournament.actual_players)}</span> jogando</p>
    </li>
  );
}

/** Seção do Dashboard: torneios rodando agora com relógio. `tournaments` = [{ _id, name, ... }] */
export default function RunningClocks({ tournaments = [] }) {
  return (
    <section data-testid="running-clocks" className="card">
      <h2 className="card-title flex items-center gap-2"><Clock3 size={18} aria-hidden="true" /> Torneios em andamento</h2>
      <p className="card-hint mb-4">Relógio ao vivo de cada torneio. Em intervalo, o cartão fica âmbar.</p>
      {tournaments.length === 0
        ? <p className="py-4 text-sm italic text-fg-subtle">Nenhum torneio em andamento.</p>
        : <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{tournaments.map((t) => <ClockCard key={t._id} tournament={t} />)}</ul>}
    </section>
  );
}
